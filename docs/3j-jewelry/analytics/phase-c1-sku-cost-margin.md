# Phase C1 — SKU Cost Master + Blended Margin + ROAS Target

> ต่อจาก Phase B3 (marketing activation). เป้าหมาย: เลิกใช้ margin ตายตัว 20% →
> ใช้ **ต้นทุนจริงต่อ SKU** มาคำนวณ margin แล้ว feed เข้ากำไร/ROAS + ตั้ง ROAS
> target แบบ margin-based. เจ้าของมีหน้าจอกดแก้ราคา/ต้นทุน SKU เองได้.

## 0. ข้อเท็จจริงจาก DB (สำรวจ 2026-08-12) — ตัวกำหนด scope

- `analytics.fact_order_item` = **0 แถว** → 334 ออเดอร์ ส.ค. import มาแค่ยอดรวม
  ต่อออเดอร์ **ไม่มี line-item ผูก SKU**. `public.product` = 2 แถว.
- จุด hardcode `* 0.20`:
  - `v_fact_order` — read-time recompute `revenue*0.20` เมื่อ `profit_status='estimated'`
    (ทับค่าที่ transform เขียนลง `fo.profit`) → **จุดหลัก** ที่ขับ CRM/LTV/overview.
  - `v_channel_perf_roas` (0027) — `profit_roas = revenue*0.20/spend`.
  - transform proc (0020/21/26) เขียน `fo.profit=revenue*0.20` ตอน import — **แต่ถูก
    v_fact_order recompute ทับ** (ทุกแถว estimated) → **ไม่ต้องแตะ transform** (เสี่ยง).
- `v_customer_ltv` sum `v_fact_order.profit` → **inherit อัตโนมัติ** เมื่อแก้ v_fact_order.

## 1. Decisions (เจ้าของเคาะ 2026-08-12)

| # | คำถาม | ตัดสิน |
|---|-------|--------|
| D1 | ต้นทุนไหลเข้า ROAS/กำไรยังไง (ไม่มี line-item) | **Blended margin ก่อน** — product master → margin เฉลี่ย → แทน 20% ทั้ง v_fact_order + ROAS. เฟสถัดไปค่อย import line-item ให้เป็น per-SKU จริง |
| D2 | โมเดลต้นทุนต่อ SKU | **2 โหมด**: `fixed` (แหวน/เครื่องประดับ = ต้นทุนคงที่) + `spot` (เงินแท่ง = น้ำหนัก × ราคาเงินสปอต × ความบริสุทธิ์ + ค่ากำเหน็จ) |
| D3 | ROAS target | **คุมสัดส่วนแอด/กำไรขั้นต้น**: `target_roas = 1 / (margin × ad_share)`. margin 20%, ad_share 50% → target 10; break-even = 1/margin = 5 |

**⚠️ ข้อจำกัดที่ต้องรู้ (D1):** blended margin เป็น "ค่าเดียวทั้งร้าน" — เงินแท่ง margin
บางมาก (buy-back หัก 30/บาท) ต่างจากเครื่องประดับที่ margin หนา. ตอนนี้แยกไม่ได้เพราะ
ออเดอร์ไม่ผูก SKU/หมวด → **ใช้ค่าเฉลี่ยรวมไปก่อน**. เมื่อมี line-item (เฟสถัดไป) margin
จะกลายเป็น per-หมวด/per-SKU จริง. product master ที่สร้างเฟสนี้ = เครื่องมือให้เจ้าของ
"ตั้ง blended margin ให้แม่นขึ้น" (ระบบ suggest = ค่าเฉลี่ย margin ของสินค้า active).

## 2. Data model (migration 0028)

### 2.1 ขยาย `public.product` (master — มี sku/name/barcode/unit_cost/is_active อยู่แล้ว)

| column ใหม่ | type | ใช้ทำอะไร |
|---|---|---|
| `category` | text | หมวด (แหวน/สร้อย/กำไล/จี้/ต่างหู/เงินแท่ง/อื่นๆ) — จัดกลุ่ม + วิเคราะห์ margin |
| `cost_type` | text NOT NULL default `'fixed'` check in (`fixed`,`spot`) | โหมดต้นทุน (D2) |
| `silver_weight_g` | numeric(10,3) | น้ำหนักเงิน (กรัม) — ใช้คิดต้นทุน spot + metadata |
| `silver_purity` | numeric(5,4) | ความบริสุทธิ์ (jewelry .925 / bar .999) — default coalesce 0.925 |
| `labor_cost` | numeric(12,2) | ค่ากำเหน็จ/ค่าแรงต่อชิ้น (บวกเพิ่มในโหมด spot) |
| `list_price` | numeric(12,2) | ราคาตั้ง/ป้าย (อ้างอิง — ราคาไลฟ์จริงเก็บที่ line unit_price) |
| `supplier` | text | ซัพพลายเออร์/OEM |
| `note` | text | หมายเหตุ |

`unit_cost` (เดิม) = ต้นทุนคงที่ ใช้เมื่อ `cost_type='fixed'`.

### 2.2 `analytics.shop_setting` (ตั้งค่าราคา/margin ต่อร้าน) — ใหม่

```
shop_id PK → public.shop
silver_spot_thb_per_gram numeric(12,4)   -- ราคาเงินสปอตปัจจุบัน (เจ้าของอัปเดต)
silver_spot_updated_at   timestamptz
blended_margin_pct numeric(5,4) NOT NULL default 0.20  -- ใช้แทน 20% ใน view
target_ad_gp_share numeric(5,4) NOT NULL default 0.50  -- สัดส่วนแอด/กำไรขั้นต้นสูงสุด
updated_by uuid, updated_at timestamptz
```
RLS: SELECT = tenant member; INSERT/UPDATE = owner/admin. seed 1 แถว/ร้าน (default).

### 2.3 `v_dim_product` (recompute — security_invoker) 

เพิ่ม `effective_unit_cost` + `margin_pct`:
```
effective_unit_cost =
  case cost_type
    when 'spot' then round(silver_weight_g × spot × coalesce(purity,0.925) + coalesce(labor_cost,0), 2)
    else unit_cost
  end
margin_pct = case when list_price>0 then (list_price - effective_unit_cost)/list_price else null end
```
คง column `unit_cost` (= effective) ไว้ backward-compat.

### 2.4 wire margin เข้า view (แทน literal 0.20)

- `v_fact_order.profit` (estimated): `revenue × coalesce((select blended_margin_pct from shop_setting where shop_id=fo.shop_id), 0.20)`
- `v_channel_perf_roas.profit_roas`: เช่นเดียวกัน
- เพิ่มใน `v_channel_perf_roas`: `break_even_roas = round(1/margin,2)`, `target_roas = round(1/(margin×ad_share),2)`

### 2.5 RPC (SECURITY DEFINER + gate `crm_require_owner_admin`)

- `analytics.product_upsert(...)` — create/update product master (owner/admin)
- `analytics.shop_setting_upsert(p_shop_id, p_silver_spot, p_blended_margin, p_ad_share)` — owner/admin

## 3. หน้าจอ (frontend — เฟสถัดจาก DB)

1. **`/products`** — ตาราง SKU: sku, ชื่อ, หมวด, โหมดต้นทุน, ต้นทุน effective, ราคาตั้ง,
   margin% (+ป้ายเตือน margin ต่ำ), active. ค้นหา/กรอง + ปุ่มเพิ่ม + modal แก้ไข (ทุก field §2.1).
2. **`/settings` (Pricing & Margin)** — ราคาเงินสปอต (+เวลาอัปเดต), blended margin
   (ช่องกรอก + suggestion = ค่าเฉลี่ย margin สินค้า active), ROAS target (ad GP share) +
   แสดง break-even/target ROAS ที่คำนวณได้.
3. Marketing copilot/ROAS: แสดง target_roas เทียบ actual + ป้าย "ประมาณการ (blended margin X%)".

## 4. Phasing

- **C1a (DB, 0028)** — extend product + shop_setting + v_dim_product + wire margin + ROAS target + RPC + seed. ← เริ่มก่อน
- **C1b** — หน้า `/products` (CRUD)
- **C1c** — หน้า `/settings` (spot/margin/ROAS)
- **C1d** — เชื่อม marketing UI แสดง target vs actual

## 5. Debt / future

- blended margin = ค่าเดียวทั้งร้าน (ดู §1). per-หมวด/per-SKU จริงต้องรอ line-item import.
- ราคาเงินสปอต = กรอกเอง; 3J มี realtime spot (Google Sheet→Wix) — เฟสหลังต่อ auto-sync.
- product master ยังไม่ผูกกับ oversell/central_stock (คนละ concern — OMS).
- unknown-SKU alert (เจอ SKU ใหม่จากไลฟ์ → เด้งเพิ่ม) = เฟสหลัง เมื่อมี line-item.
