# Phase Line-item Import — Technical Design (architect / Yoda)

> เป้า: ปลดล็อก **กำไรจริงต่อ SKU/ต่อออเดอร์** แทน blended margin 10–20% ที่เดาไว้
> Source: Shipnity "สินค้าในออเดอร์" 8 ไฟล์ · 5,732 line · 196 SKU · 20 คอลัมน์ positional
> Join key: [4] เลขที่ออเดอร์ E771 -> analytics.fact_order.source_order_no
> Migration ใหม่เริ่ม **0041** (auth เลื่อนไป 0042+)

---

## 1. Data flow (reuse vs ใหม่)

```
xlsx (20-col line report)
  -> parseOrderLineReportXlsx()             [ใหม่  lib/import/order-line-report.ts]
     -> upsert stg_order_line_import         [ใหม่ table 0041]  dedup (shop_id,source_order_no,line_no)
        -> transform_pending_order_lines()   [ใหม่ proc 0041]
           - join public.product (shop_id,sku) -> product_id + effective_unit_cost (v_dim_product)
           - join fact_order (shop_id,source_order_no) -> fact_order_id
               orphan (ไม่มี order) -> status 'orphan' (skip, รอ order-level)
           - DELETE+INSERT fact_order_item ต่อ fact_order ที่ batch แตะ  [reuse table 0010]
           - recompute fact_order: cogs, profit, profit_status='actual'
```

Reuse ของเดิม (ไม่แตะ struct): fact_order_item (0010, 0 แถว = target), v_dim_product.effective_unit_cost (0028), public.product uq(shop_id,sku), v_sku_order_alert (0031 dormant -> ตื่นเอง), pattern batch/preview/commit (import-orders.ts), หน้า /crm/import.

**ใหม่:** staging table + parser + transform proc + reconcile + **แก้ transform_pending_orders** (กัน downgrade) + ปุ่ม UI.

---

## 2. Migration 0041 — spec

### 2.1 stg_order_line_import (ใหม่ — ทำไมไม่ reuse stg_order_item_import)
ตารางเดิม stg_order_item_import (0011) grain คนละเรื่อง: key = (marketplace_order_id, line_no), มี seller_sku_raw/qty **แต่ไม่มี price** และ marketplace_order_id NOT NULL — ออกแบบสำหรับ **TikTok Packing-Slip PDF**. Shipnity line report join ด้วย source_order_no (E771) + **มี price**. Overload ตารางเดิมต้อง drop NOT NULL + เปลี่ยน unique = เลอะกว่า สร้างใหม่. เดิมยัง 0 แถว เก็บไว้ให้ PDF path.

```sql
create table analytics.stg_order_line_import (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references analytics.stg_import_batch(id) on delete cascade,
  shop_id uuid not null references public.shop(id) on delete cascade,
  source_order_no text,               -- E771 (nullable: blank-SKU/ปรับมือ อาจไม่มี)
  line_no int not null,               -- ลำดับใน order (parser กำหนด, stable ต่อไฟล์) -> idempotency
  sku_raw text,                       -- [0] (blank ได้)
  product_name_raw text,              -- [1]
  unit_price numeric(12,2),           -- [2]
  qty int,                            -- [3]
  raw jsonb not null,
  import_status text not null default 'pending' check (
    import_status in ('pending','transformed','orphan','skipped_blank','sku_unmapped','error')),
  error_detail text,
  fact_order_item_id uuid references analytics.fact_order_item(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_stg_line_shop_order_lineno unique (shop_id, source_order_no, line_no)
);
```
+ index (batch_id), (shop_id, source_order_no).
+ status เป็น text check (ไม่ต้อง alter enum).
+ stg_import_batch.source_type check เพิ่มค่า 'excel_line_item_report'.

### 2.2 transform_pending_order_lines(p_shop_id, p_batch_id)
security definer, grant service_role เท่านั้น (เหมือน transform_pending_orders). Logic:

1. เลือก stg rows ของ batch ที่ status in ('pending','orphan','error') — rerun ปลอด (orphan ตื่นเองหลัง order import).
2. **แยก blank**: sku_raw is null -> status skipped_blank, continue (ไม่ใช่สินค้า — ค่าส่ง/ปรับมือ; revenue มาจาก order-level อยู่แล้ว ไม่กระทบ).
3. **join fact_order** (shop_id, source_order_no). ไม่เจอ -> status orphan, continue (ไม่สร้าง fact_order จาก line — line report ไม่มี channel/customer/date พอสร้าง).
4. **lookup product** (shop_id, sku_raw). เจอ -> product_id + unit_cost_snapshot = effective_unit_cost (จาก v_dim_product ณ เวลา transform = ล็อกต้นทุน ณ วันนำเข้า). ไม่เจอ (3 unknown) -> product_id null, unit_cost_snapshot null, ยัง transform ได้ (โผล่ v_sku_order_alert reason='unknown').
5. เก็บ set ของ fact_order_id ที่ batch นี้แตะ.
6. **ต่อ fact_order**: delete from fact_order_item where fact_order_id = X แล้ว insert ใหม่จาก staging (idempotent, ไม่ต้อง upsert per-row — fact_order_item ไม่มี natural key). อัปเดต stg.fact_order_item_id.
7. **recompute fact_order** (ดูข้อ 3).

### 2.3 v_sku_order_alert — ตื่นเอง ไม่ต้องแก้ (0031 มีอยู่)
unknown SKU (product_id null) + inactive จะโผล่ทันทีที่ fact_order_item มีข้อมูล.

---

## 3. Profit model ใหม่ (หัวใจ) — SQL logic

**หลักการ 3 ชั้น (per-order):** actual (line-item) > estimated (blended) > missing

**สูตร (ใน transform_pending_order_lines, ต่อ fact_order):**
```
v_cogs   = sum(qty * unit_cost_snapshot)   -- unknown SKU cost=null -> coalesce 0
v_profit = fact_order.revenue - v_cogs     -- revenue คงเป็นตัวตั้งจาก order-level
update analytics.fact_order set
   cogs = v_cogs,
   profit = round(revenue - v_cogs, 2),
   profit_status = 'actual'
 where id = X;
```

**ทำไม revenue - cogs ไม่ใช่ sum(line_price) - cogs:** order-level revenue (col ยอดขายออเดอร์) reconcile ส่วนลด/ค่าส่งเสร็จแล้ว = authoritative. line price sum อาจไม่ตรง (blank-SKU rows, ปรับมือ) -> ถ้าเอา line sum เป็นตัวตั้งกำไรจะ drift. เราแทนแค่ **COGS** จากเดา -> จริง เท่านั้น.

**ทำไม v_fact_order ไม่ต้องเขียนใหม่ (elegant reuse):**
v_fact_order (0028) ปัจจุบัน:
```sql
case when fo.profit_status = 'estimated' then round(revenue * blended_margin_pct, 2)
     else fo.profit end as profit
```
พอ transform เซ็ต profit_status='actual' + เก็บ profit จริง -> view คืน fo.profit (ค่าจริง) เอง. **downstream ทุกตัวอ่าน v_fact_order** (0027 marketing, 0033 audience, 0034 seasonal, 0039 dashboard, 0020/0023/0025 CRM) -> ได้กำไรจริงฟรี ไม่ต้องแตะ view เดียว. นี่คือเหตุผลที่ store-at-transform ชนะ compute-at-read.

**Trade-off (store snapshot vs compute live):**
- เลือก **store snapshot** (เขียน cogs/profit ตอน transform) เพราะ: (1) 0 churn ต่อ ~8 views downstream, (2) read hot-path (dashboard) ไม่ต้อง join aggregate ทุกครั้ง, (3) ต้นทุน ณ เวลาขายถูกต้องกว่าสำหรับ spot silver.
- ตัดทิ้ง compute-at-read (v_fact_order LEFT JOIN rollup live): ได้ค่าตาม cost master ล่าสุดเสมอ แต่ read หนักทุก query + ต้องแก้ precedence ใน view. ถ้า owner แก้ต้นทุน SKU ย้อนหลัง -> snapshot ไม่ขยับ (ต้อง re-run transform) = ยอมรับได้ เพราะสั่ง re-import ได้.

---

## 4. HAZARD ที่ต้องแก้: order re-import ล้าง actual
transform_pending_orders (0013) on-conflict เซ็ต profit_status='estimated', profit=revenue*0.10 เสมอ. **ถ้านำเข้า order-level ไฟล์เดิมซ้ำหลังมี line-item แล้ว -> actual ถูกทับกลับเป็น estimated + กำไรเดา.** ต้องแก้ใน 0041:

```sql
-- ใน on conflict ของ transform_pending_orders:
profit_status = case when analytics.fact_order.profit_status = 'actual'
                     then 'actual' else 'estimated' end,
profit = case when analytics.fact_order.profit_status = 'actual'
              then round(excluded.revenue - analytics.fact_order.cogs, 2)  -- revenue ใหม่ - cogs เดิม
              else round(excluded.revenue * 0.10, 2) end,
cogs = analytics.fact_order.cogs   -- อย่าล้าง cogs
```
= order re-import ที่แก้ revenue จะ recompute กำไรจาก cogs จริงที่มีอยู่. **แตะ proc ที่ tested แล้ว -> ต้องให้ qa รัน regression order-import ซ้ำ.**

---

## 5. Parser + Action contract

**lib/import/order-line-report.ts** (port pattern จาก order-report.ts — reuse toNumberOrNull/toIntOrNull/toTextOrNull):
- parseOrderLineReportXlsx(buf): ParsedLineReport
- positional map: [0]sku_raw [1]product_name_raw [2]unit_price [3]qty [4]source_order_no (5-19 เก็บใน raw jsonb)
- **shape validate:** col count = 20, anchor header: col0 has "รหัสสินค้า", col4 has "เลขที่ออเดอร์", col2 has "ราคา", col3 has "จำนวน". ผิด -> shapeIssues (fail-loud เหมือนเดิม).
- line_no: running index ต่อ source_order_no (reset ต่อ order) -> stable ต่อไฟล์.
- rollup preview: rowCount, distinctOrders, blankSkuCount, periodHint.

**lib/actions/import-line-items.ts** (มิเรอร์ import-orders.ts):
- previewLineImport(fd) -> { rowCount, distinctOrders, blankSkuCount, orphanOrderCount, unknownSkus[], duplicateFile }
  - orphanOrderCount = distinct source_order_no ที่ยังไม่มีใน fact_order (เตือน "นำเข้า order-level ก่อน")
  - unknownSkus = sku_raw ที่ไม่มีใน product master
- commitLineImport(fd) -> batch(source_type='excel_line_item_report') -> upsert stg -> transform_pending_order_lines -> mark. คืน { transformed, orphan, skippedBlank, unknown }.
- gate requireOwnerAdmin() เหมือนเดิม; service client; revalidate /crm/import,/dashboard,/catalog,/crm/orders.

---

## 6. UI change
extend /crm/import (ไม่ทำหน้าใหม่): auto-detect **20-col (line) vs 23-25-col (order)** จาก header anchor -> route ไป action ที่ถูก. Preview แยกการ์ด. Trade-off: อัปโหลดที่เดียว owner ไม่ต้องจำ = UX ดีกว่า; แลกกับ detection ต้องแม่น (ยึด col count + col0/col4 anchor, ผิด = reject ไม่เดา).

---

## 7. Decision list (เคาะ)
| # | Decision | เหตุผล/trade-off |
|---|----------|------------------|
| 1 | Staging: **table ใหม่** stg_order_line_import | grain/key ต่างจาก stg_order_item_import (E771+price vs marketplace_id) — overload เลอะกว่า |
| 2 | Transform: SKU->product_id, join fact_order(shop_id,source_order_no); orphan -> **skip 'orphan'** | line report ไม่มีข้อมูลพอสร้าง fact_order; rerun ตื่นเองหลัง order import |
| 3 | Profit: **revenue - sum(qty*cost)**, status='actual', เก็บ cogs; v_fact_order ไม่แก้ | revenue authoritative; downstream อ่าน v_fact_order ได้ฟรี |
| 4 | Unknown(3) -> insert product_id null (โผล่ alert); blank(~109) -> **skip 'skipped_blank'** | ไม่บล็อก; owner เติม master แล้ว re-import |
| 5 | Idempotency: dedup (shop_id,source_order_no,line_no); **DELETE+INSERT per fact_order** | fact_order_item ไม่มี natural key; delete-reinsert ปลอดภัยสุด |
| 6 | UI: extend /crm/import auto-detect 20 vs 25 col | ที่เดียว UX ดี; detection ยึด col count+anchor |
| 7 | Dependency: line ต้องหลัง order; **soft-enforce** (orphan report ไม่ hard-block) | partial ได้, re-run เก็บ orphan; แก้ transform_pending_orders กัน downgrade (ข้อ 4) |

---

## 8. Phase breakdown
- **P1 (DB):** 0041 — table + proc + แก้ transform_pending_orders (ข้อ 4) + grants. qa regression order-import.
- **P2 (parser):** order-line-report.ts + unit test กับ fixture 8 ไฟล์ (baseline 5,732 line/196 SKU).
- **P3 (action+UI):** import-line-items.ts + detect ที่ /crm/import.
- **P4 (verify):** import จริง 8 เดือน -> เทียบ profit ก่อน/หลัง; ตรวจ ส.ค. orphan (497 line vs 334 order).

## 9. ความเสี่ยง (พูดตรง)
1. **Profit เปลี่ยนทั้งระบบ** — dashboard/CRM/ROAS ทุกหน้าที่โชว์กำไรขยับจาก 10-20% เดา -> จริง. เดือนที่มี line-item ครบจะกระโดด, เดือนที่ไม่มียัง blended = **กราฟมีรอยต่อ**. ต้อง label "actual vs ประมาณการ" ต่อ order (มี profit_status อยู่แล้ว) และเตือน CFO/CMO ก่อนดูตัวเลข.
2. **Orphan line (ส.ค. 497 vs 334)** — ~163 line ค้าง orphan จนกว่า import order ส.ค. 1-14 ครบ. ถ้าไม่ครบ กำไรเดือนนั้นบางส่วน actual บางส่วนไม่มี. Preview ต้องตีเลข orphan ให้เห็นก่อน commit.
3. **Line-item ไม่ครบต่อ order -> cogs ต่ำ -> profit สูงเกินจริง.** ถ้า import line บาง SKU (unknown นับ cost=0) cogs หาย. Mitigation: reconcile sum(line qty) vs fact_order.item_count; unknown 3 SKU x 1 = กระทบต่ำ แต่ต้องเตือน.
4. **Order re-import ล้าง actual** (ข้อ 4) — ลืมแก้ transform_pending_orders = กำไรจริงหายเงียบ. จุดพังเงียบอันตรายสุด ต้องทำใน 0041 พร้อมกัน + qa regression.
5. **unit_cost_snapshot = spot ณ วัน transform** — silver spot ขยับรายวัน. import ย้อนหลัง ส.ค. ด้วย spot วันนี้ = ต้นทุนเงินแท่งเพี้ยนจากวันขายจริง. ต้อง feed spot ย้อนหลัง หรือยอมรับ proxy (flag CFO).

## 10. คำถามที่ต้องเคาะก่อน implement
- **Q1:** เงินแท่ง (cost_type='spot') import ย้อนหลัง — ใช้ spot ปัจจุบัน (proxy) หรือกรอก spot ย้อนหลังต่อเดือน? กระทบกำไรเงินแท่งโดยตรง.
- **Q2:** unknown 3 SKU (NC26-3M ฯลฯ) — auto-add เข้า product master ตอน transform (cost=null) หรือให้ owner เพิ่มเองก่อน? (แนะนำ: เพิ่มเอง เพราะต้องกรอกต้นทุน).
