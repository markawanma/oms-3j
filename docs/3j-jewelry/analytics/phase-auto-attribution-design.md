# Design: Auto-Attribution จากคอลัมน์รหัสส่วนลด (Excel import)

> Architect (Yoda) — ต่อยอด import page (commit f57f35e) + manual attribution (0036)
> Status: **proposed** | Migration ใหม่: **0040**

## 1. Design overview

**เป้าหมาย**: ทุกออเดอร์ในไฟล์ Excel ที่คอลัมน์ R ("รหัสส่วนลด", index 17) ไม่ว่าง
→ นับเข้า attribution ของโค้ดนั้นอัตโนมัติ โดย**ไม่แตะโมเดล manual เดิม** (0036)

```
Excel col 17 -- parser (lib/import/order-report.ts, map ไว้แล้ว)
   -> stg_order_import.discount_code            (0011:73 -- มีอยู่แล้ว, ไม่แก้)
   -> transform_pending_orders (0040 copy จาก 0026 + carry 1 field)
   -> fact_order.discount_code (คอลัมน์ใหม่, normalized: "-"/"" -> null)
   -> v_promo_attribution_auto (view ใหม่, security_invoker)
   -> /marketing/attribution: section auto (read-only) + section manual เดิม
```

Flywheel ครบ: อัปไฟล์ -> transform -> view คำนวณใหม่เอง ไม่มี job/table เพิ่ม

**Data-source semantics (หัวใจของ design)** — สองแหล่งนี้ตั้งใจให้เป็นคนละความจริง:
- **auto** = โค้ดที่ platform บันทึกในไฟล์ order report (marketplace voucher)
- **manual** = โค้ดที่ลูกค้าพิมพ์ในแชท LINE (ไม่โผล่ในไฟล์ — เหตุผลเดิมของ 0036)

## 2. Decisions (เคาะแล้ว + trade-off)

### D1 — ต่อท่อ discount_code -> fact_order + normalize ที่ transform (write-time)
- `alter table analytics.fact_order add column discount_code text;` (nullable, ไม่มี default — ออเดอร์ OMS/เดือนไม่มีโปร = null โดยธรรมชาติ)
- Normalize ใน proc: `nullif(nullif(btrim(coalesce(v_row.discount_code, '')), ''), '-')`
  -> sentinel `"-"` (334 แถว ส.ค. จริง), `""`, whitespace -> **null ทั้งหมด**
- **ทำไม normalize ที่ transform ไม่ใช่ view**: fact table สะอาด = ทุก consumer ในอนาคต (dashboard, export, view อื่น) ได้ค่า clean ฟรี ไม่ต้อง copy กติกา normalize ซ้ำทุก view. ทางเลือก view-side เก็บ raw fidelity ใน fact ได้ก็จริง แต่ raw มีอยู่แล้วใน staging + `raw` jsonb ไม่ต้องเก็บซ้ำ — **ตัดทิ้ง: normalize ที่ view**
- เก็บตัวพิมพ์ตามต้นฉบับ (btrim อย่างเดียว ไม่ lower) — โค้ดจาก platform เป็น canonical อยู่แล้ว ถ้า lower โค้ดที่เจ้าของตั้งจะเพี้ยนตอนแสดงผล -> case-variant split เป็น debt ที่ยอมรับ (ดู §8)

### D2 — Backfill best-effort ใน migration
- staging มี `unique (shop_id, dedup_key)` (0011:101) -> excel 1 order = 1 staging row เสมอ (re-import ทับ row เดิม) -> join 1:1 ผ่าน `s.fact_order_id = fo.id` (มี index แล้ว: idx_stg_order_import_fact_order_id) ไม่ต้อง DISTINCT ON
- ใช้ normalize เดียวกับ D1 ใน UPDATE
- ส.ค. จริงจะได้ null หมด (คอลัมน์ R = "-" ทั้ง 334 แถว) — กลไกต้องถูกเผื่อไฟล์เดือนอื่นที่ import ก่อน 0040 รัน
- Best-effort ตามโจทย์: ถ้า staging โดน retention ลบในอนาคต ออเดอร์นั้น discount_code ค้าง null จนกว่าจะ re-import — ยอมรับ ไม่สร้างกลไกเพิ่ม (YAGNI)

### D3 — View `v_promo_attribution_auto`
security_invoker, พึ่ง RLS tenant ของ fact_order (0012:89) เหมือน view ตระกูลนี้ทั้งหมด
grain = 1 row ต่อ (shop_id, discount_code), channel breakdown เป็น jsonb ใน row เดียว
(ตัดทิ้ง: grain ต่อ channel แล้วให้ frontend roll-up — ผลัก aggregation logic ไป client โดยไม่จำเป็น)

### D4 — Auto + Manual: แยก 2 section, ไม่ merge, ไม่บวกรวม + overlap warning (จุดสำคัญสุด)
- หน้า /marketing/attribution แสดง 2 ส่วน:
  1. **"จากไฟล์นำเข้า (อัตโนมัติ)"** — read-only จาก v_promo_attribution_auto
  2. **"คีย์มือ (โค้ดจากแชท LINE)"** — ฟอร์ม + ตารางเดิมของ 0036 ทุกอย่างคงเดิม
- **ห้ามรวมยอด auto+manual เป็นเลขเดียวเด็ดขาด** เหตุผล: manual entry ไม่มี source_order_no
  -> ระบบพิสูจน์ไม่ได้ว่า entry มือกับ order ในไฟล์คือออเดอร์เดียวกันหรือคนละออเดอร์
  การ merge = เดา และเดาผิด = ยอดแคมเปญโป่ง (เจ้าของตัดสินใจงบผิด) — แพงกว่า UI แยก 2 ตาราง
- **Overlap warning**: โค้ดเดียวกัน (เทียบ case-insensitive + trim) โผล่ทั้ง 2 ฝั่ง -> badge เตือนบนแถวนั้นทั้งสองตาราง: "โค้ดนี้มีข้อมูลทั้งจากไฟล์และคีย์มือ — ยอดอาจนับซ้ำ ตรวจรายการคีย์มือ" แล้วให้เจ้าของลบ manual ที่ซ้ำเอง (ปุ่มลบมีอยู่แล้ว) คำนวณ overlap ที่ client จาก 2 array — ไม่ต้องมี view เพิ่ม
- ตัดทิ้ง: merge-by-code รวมยอด (เสี่ยง double-count), auto-dedup ด้วย amount+date matching (over-engineer, heuristic เปราะ)

### D5 — Idempotency: ได้ฟรี
- fact_order upsert `on conflict (shop_id, source_order_no) do update` -> **ต้องเพิ่ม `discount_code = excluded.discount_code` ใน do-update set ด้วย** (จุดพลาดง่ายสุดของ migration นี้ — ถ้าลืม re-import จะไม่อัปเดตโค้ด)
- View คำนวณสดทุก query -> re-import แล้วถูกเสมอ, manual table แยกอิสระ ไม่กระทบ

### D6 — สิทธิ์: owner/admin ที่ app layer เหมือน 0036
- Page gate `getDevRole() === "staff"` + action gate `requireOwnerAdmin()` (pattern เดิมเป๊ะ)
- View: `grant select ... to authenticated, service_role` (grant ใน 0036 เป็น one-shot ไม่ครอบ view ใหม่ ต้อง grant ใน 0040) + RLS tenant ผ่าน security_invoker

## 3. Migration 0040 spec — `0040_auto_attribution.sql`

ลำดับใน 1 ไฟล์:

1. **ALTER**: `alter table analytics.fact_order add column discount_code text;`
   (ยังไม่มี index — ตารางระดับร้อย/พันแถวต่อเดือน เพิ่มเมื่อช้าจริง)
2. **Proc**: `create or replace function analytics.transform_pending_orders(uuid, uuid)`
   — **copy ทั้ง body จาก 0026 แบบ byte-identical** (precedent 0034) แก้เฉพาะ 4 จุด:
   - declare เพิ่ม `v_discount_code text;`
   - ใน loop (หลังบรรทัดคำนวณ v_order_date): `v_discount_code := nullif(nullif(btrim(coalesce(v_row.discount_code, '')), ''), '-');`
   - insert column list เพิ่ม `discount_code` + values เพิ่ม `v_discount_code` (0026:218-225)
   - do-update set เพิ่ม `discount_code = excluded.discount_code` (0026:227-233)
   - ปิดท้าย revoke/grant ของ proc copy จาก 0026:253-254
3. **Backfill** (best-effort, idempotent):
   ```sql
   update analytics.fact_order fo
   set discount_code = nullif(nullif(btrim(coalesce(s.discount_code, '')), ''), '-')
   from analytics.stg_order_import s
   where s.fact_order_id = fo.id
     and s.source_kind = 'excel'
     and fo.discount_code is null;
   ```
4. **View**:
   ```sql
   create or replace view analytics.v_promo_attribution_auto
     with (security_invoker = true) as
   with per_channel as (
     select fo.shop_id, fo.discount_code as code, fo.channel_id,
            ch.name as channel_name,
            count(*) as orders, sum(fo.revenue) as revenue,
            min(fo.order_date) as first_on, max(fo.order_date) as last_on
     from analytics.fact_order fo
     left join analytics.dim_channel ch on ch.id = fo.channel_id
     where fo.discount_code is not null
     group by fo.shop_id, fo.discount_code, fo.channel_id, ch.name
   )
   select shop_id, code,
          sum(orders)::int as orders,
          sum(revenue)     as total_revenue,
          round(sum(revenue) / nullif(sum(orders), 0), 2) as avg_revenue,
          min(first_on)    as first_on,
          max(last_on)     as last_on,
          jsonb_agg(jsonb_build_object(
            'channel_name', coalesce(channel_name, 'ไม่ระบุ'),
            'orders', orders, 'revenue', revenue)
            order by revenue desc) as channel_breakdown
   from per_channel
   group by shop_id, code;
   ```
5. **Grants**: `grant select on analytics.v_promo_attribution_auto to authenticated, service_role;`
6. `notify pgrst, 'reload schema';`

## 4. View contract — `v_promo_attribution_auto`

| column | type | ความหมาย |
|---|---|---|
| shop_id | uuid | tenant key |
| code | text | discount_code (normalized: ไม่มี "-"/""/null ใน view) |
| orders | int | จำนวนออเดอร์ที่ใช้โค้ด |
| total_revenue | numeric | ยอดขายรวม (fact_order.revenue) |
| avg_revenue | numeric | เฉลี่ยต่อออเดอร์ |
| first_on / last_on | date | ช่วงวันที่ order_date แรก/สุดท้าย |
| channel_breakdown | jsonb | `[{"channel_name":text,"orders":int,"revenue":numeric}]` เรียง revenue desc |

## 5. Frontend changes

**`lib/actions/marketing.ts`** — แก้ `getPromoAttribution()` เดิม (ไม่เพิ่ม action ใหม่):
```ts
export type PromoAttributionAuto = {
  code: string;
  orders: number;
  totalRevenue: number;
  avgRevenue: number;
  firstOn: string;   // date string
  lastOn: string;
  channelBreakdown: { channelName: string; orders: number; revenue: number }[];
};

export async function getPromoAttribution(): Promise<
  ActionResult<{
    summary: PromoAttributionSummary[];   // เดิม
    entries: PromoAttributionEntry[];     // เดิม
    auto: PromoAttributionAuto[];         // ใหม่ — จาก v_promo_attribution_auto
  }>
>
```
เพิ่ม query ที่ 4 ใน `Promise.all` เดิม:
`.from("v_promo_attribution_auto").select("code, orders, total_revenue, avg_revenue, first_on, last_on, channel_breakdown").eq("shop_id", shopId).order("total_revenue", { ascending: false })`

**`app/(dashboard)/marketing/attribution/page.tsx`** — ส่ง prop `auto` เพิ่ม (gate staff เดิมคงไว้) + อัปเดต comment หัวไฟล์ว่ามี 2 แหล่งแล้ว

**`components/domain/marketing/PromoAttributionPageClient.tsx`** — เพิ่ม prop `auto: PromoAttributionAuto[]`:
- Section บน: **"จากไฟล์นำเข้า (อัตโนมัติ)"** — ตาราง read-only: โค้ด / ออเดอร์ / ยอดรวม / เฉลี่ย / ช่วงวันที่ / channel chips
- **Empty state** (ข้อมูล ส.ค. จริงจะเจอแน่นอน): "ยังไม่มีออเดอร์ที่ใช้โค้ดในไฟล์ที่นำเข้า — จะขึ้นอัตโนมัติเมื่อนำเข้าไฟล์เดือนที่จัดโปร (เช่น 9.9)"
- Section ล่าง: manual เดิมทั้งหมด **ห้ามแตะ behavior** เปลี่ยนแค่หัวข้อเป็น "คีย์มือ (โค้ดจากแชท LINE)"
- Overlap badge (D4): intersection ของ autoCodes/manualCodes เทียบด้วย `code.trim().toLowerCase()`
- คำอธิบายหัวหน้า: อธิบายว่ามี 2 แหล่ง อย่าบวกรวมกันเอง

## 6. Real-data caveat (ต้องเขียนใน PR/commit ด้วย)

- ไฟล์ ส.ค. จริง: คอลัมน์ R = `"-"` **ทั้ง 334 แถว** -> หลัง 0040 + backfill: `fact_order.discount_code` = null หมด, auto section = empty state — **นี่คือพฤติกรรมถูกต้อง ไม่ใช่ bug**
- Value จริงเริ่มจากไฟล์เดือนที่จัดโปร (9.9 "รับสิทธิ์99" เป็นต้นไป)
- **Verify หลัง migrate**: `select count(*) from analytics.fact_order where discount_code is not null;` ต้องได้ **0** สำหรับข้อมูล ส.ค. — ถ้าไม่ใช่ 0 แปลว่า normalize "-" รั่ว

## 7. Phase breakdown

รอบเดียวจบ (ชิ้นเล็ก ต่อเนื่องกัน แยก phase ไม่คุ้ม):
1. backend-dev: migration 0040 (copy proc จาก 0026 — reviewer ต้อง diff proc กับ 0026 ยืนยันว่าต่างแค่ 4 จุดใน §3 ข้อ 2)
2. backend-dev: `getPromoAttribution()` + types -> frontend-dev: PageClient 2-section + empty state + badge
3. verify: `npm run typecheck` + รัน migration + query ตาม §6 + เปิดหน้าเช็ค empty state + manual flow เดิมยังคีย์/ลบได้

## 8. Technical debt / ความเสี่ยง (บอกตรงๆ)

1. **Double-count auto vs manual แก้ไม่ขาด** — ระบบเตือนได้อย่างเดียว (D4) ตัดสินใจสุดท้ายอยู่ที่เจ้าของ ถ้าเจ้าของคีย์มือโค้ดที่อยู่ในไฟล์แล้วไม่ลบ ยอด 2 ตารางซ้ำกันเงียบๆ — mitigation จริงมีอย่างเดียว: วินัย "โค้ดจากแชท LINE เท่านั้นที่คีย์มือ"
2. **Case/spacing variants** — "SILVER99" กับ "silver99" เป็นคนละแถวใน view (D1 เก็บ original case) — ยอมรับจนกว่าจะเจอจริง
3. **Staging retention** — backfill พึ่ง staging ถ้า retention ลบก่อนรัน 0040 ข้อมูลเก่าค้าง null (re-import แก้ได้)
4. **fact_order จาก OMS** (oms_order_id path) ไม่มี discount_code — null ตลอด ถ้า OMS จะเก็บโค้ดต้องต่อท่อเองภายหลัง
5. **Proc copy-modify chain** ยาวขึ้นอีกตัว (0013 -> ... -> 0026 -> 0040) — debt โครงสร้างเดิมของ repo แบกต่อ ยังไม่ถึงจุดคุ้ม refactor
