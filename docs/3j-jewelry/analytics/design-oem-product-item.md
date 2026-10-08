# Design — รายการสินค้าในแคตตาล็อก / ราคากำหนดเอง ในใบเสนอราคา OEM (0166)

> 8 ต.ค. 69 · architect (Yoda) · 🔴 โหมดเร่งด่วน: เจ้าของรับความเสี่ยงข้าม security/QA/review ก่อน merge → security ตรวจย้อนหลัง
> ห้ามเขียนตัวเลขราคา/ทุนจริงลงไฟล์นี้ (memory `oem-pricing`) · แบบอย่าง: `design-oem-bar-price-override.md`

## มติเจ้าของ (8 ต.ค. 69)
1. เลือก SKU → ดึงราคาขายจากแคตตาล็อกมาตั้งต้น · แก้ราคาต่อชิ้นได้อิสระ · **ต่ำกว่าราคาแคตตาล็อกต้องใส่เหตุผล** · **ไม่มีด่านทุนรายชิ้น** — ด่าน "margin รวมทั้งใบติดลบ = ปฏิเสธ" (invariant ข้อ 6) **ยังอยู่**
2. แก้ราคาในใบ = เฉพาะใบนั้น ห้ามเขียนกลับ catalog (memory `sku-autofill-decisions`)
3. ไม่มี SKU ได้: พิมพ์ชื่อ + ราคาต่อชิ้น + **ทุนต่อชิ้น (บังคับ)** (เช่น กล่องสั่งทำ ค่าส่ง)
4. หน้าพิมพ์: ชื่อ/SKU · จำนวน · ราคาต่อชิ้น · รวม — ทุน/เหตุผล/ราคาแคตตาล็อกห้ามหลุด
5. **ใบสินค้าล้วนไม่ติดด่านงานผลิต 2 ตัว**: มูลค่างานขั้นต่ำ (min_job_value) และ note-tier (ต้องใส่ approval_note เมื่อ margin รวมต่ำกว่าเกณฑ์) — ใบผสมกับงานผลิตยังติดด่านเดิมของส่วนงานผลิต

## 0. ข้อค้นพบ
- `oem_price_calc` (0165) แยก branch ด้วย `v_metal` แล้ว return → branch ใหม่แทรกหลัง silver999 ไม่แตะของเดิม · signature เดิม (re-grant)
- `oem_quote_save` (0165, 11-arg): `v_item_valid_days` else → `quote_valid_days_silver` · `v_production_total_sum` นับทุกอย่างที่ ≠ silver999 · item ที่ `floors.margin.value=null` → `v_has_ungated_item`
- `product_id` อยู่ระดับ item แต่ `oem_price_calc` เห็นแค่ `input` → ใส่ `product_id` ใน input ด้วย
- `v_dim_product` (0143) ให้ `list_price`, `unit_cost` (effective), `sku`, `name`, `category`, `cost_type`
- `OemProductOption` ไม่มี field ราคา (ตั้งใจกัน cost หลุด) · `calcPrice` กลืน 22023 เป็นข้อความ generic

## 1. Data model — `metal = 'product'` ค่าเดียว (แยกด้วย product_id มี/ไม่มี)
| key ใน input | กติกา |
|---|---|
| `product_id` | optional · ต้องเป็นของ `p_shop_id` · มี = โหมด catalog |
| `product_name` | บังคับเมื่อไม่มี product_id · `oem_customer_text_clean` · ≤200 · มี product_id → DB snapshot ชื่อจาก catalog เอง |
| `unit_price_thb` | บังคับ · `not (>0 and <=1000000)` → 22023 · ทศนิยม >2 → 22023 |
| `unit_cost_thb` | บังคับเมื่อไม่มี product_id · มี product_id แล้วส่งมา → 22023 (กันทับ catalog) |
| `price_reason` | บังคับเมื่อมี product_id และ unit_price < list_price · strip invisible + trim · ≤200 · กรณีอื่น optional |

snapshot ใน `calc` (emit เฉพาะ branch นี้):
`breakdown.product = {product_id, sku, name, category, cost_source:'catalog'|'manual', cost_basis, catalog_list_price, unit_price_thb, below_catalog, price_reason}` · `cost_piece` = ทุน · `price_per_piece` = ราคา · `quote_total = round(qty*price,2)` · `floors.margin.value = null` (ungated รายชิ้น) · floors อื่นเหมือน silver999

## 2. `oem_price_calc` branch 'product'
1. parse + ด่านรูปร่าง §1
2. มี product_id → อ่าน `v_dim_product` (shop ต้องตรง · ไม่เจอ → 22023) · `not (unit_cost > 0 …)` → `is_complete=false` + missing `catalog_unit_cost` · `list_price > 0` → `below_catalog := price < list_price` · ต่ำกว่า + ไม่มีเหตุผล → 22023 · ไม่มี list_price → `below_catalog=null` + warning · **ราคาแคตตาล็อกอ่านจาก DB เท่านั้น**
3. ไม่มี product_id → ทุน/ชื่อจาก input
4. cost > price → warning (ไม่ block รายชิ้น)
5. golden replay: rename → legacy · assert jsonb `=` strict บน input จริงทุกแถว + matrix แบบ 0165 → drop legacy → grant service_role

## 3. `oem_quote_save`
- product: `product_id` input ≠ item → 22023 · มี product_id → sku/name ทับจาก calc snapshot (ไม่เชื่อ client)
- valid_days: `when 'product' then coalesce(quote_valid_days_silver, 30)` · `least()` เดิม
- **มติ 5**: รายการ product **ไม่นับ** เข้า min_job_value และ **ไม่ทำให้** `v_has_ungated_item` เป็น true (note-tier) — ใบผสมยังตรวจส่วนงานผลิตตามเดิม · ด่าน blended<0 และ hard floor หลังส่วนลด **ไม่แตะ**
- renegotiate / receipt_issue: ไม่แก้ (copy/อ่าน snapshot) — verify มีเคส

## 4. อายุใบ = `quote_valid_days_silver` (ปกติ 30 วัน) · SKU spot ก็ 30 วัน [A2]

## 5. หน้าพิมพ์/ใบเสร็จ — ไม่เพิ่ม field ใน PrintableQuote · product → weightG null · ชื่อ fallback = productNameSnapshot · ห้ามเพิ่ม catalogListPrice

## 6. ไฟล์
`lib/oem/types.ts` (`OemMetal += 'product'` · label 'สินค้า/บริการ' · `OemProductOption.listPrice` — list_price = ราคาขายปลีกสาธารณะ อนุญาต, unit_cost/margin ยังห้าม) · `lib/actions/oem.ts` (getOemProducts + payload + calcPrice ส่ง 22023 กลับ) · `lib/oem/quoteForm.ts` · `QuoteCalculatorClient.tsx` (เลือก SKU ไม่ใช่แท่ง → metal product + ราคาตั้งต้น) · `QuoteJobItemCard.tsx` · ใหม่ `OemProductCalcSummary.tsx` (admin only) · `QuoteDetailClient.tsx` · `lib/oem/printableQuote.ts` · skill `oem-quote-invariants` ข้อ 9 · `0166_oem_product_item.sql` + `verify-0166.sql`

## 7. เคสห้ามผ่าน → ด่าน
| เคส | ตกที่ |
|---|---|
| มี SKU ต่ำกว่า list_price ไม่มีเหตุผล | calc 22023 |
| ไม่มี SKU ไม่มีทุน/ชื่อ | calc 22023 |
| มี SKU + ส่งทุนมา | calc 22023 |
| ราคา/ทุน ≤0 NaN Inf >1,000,000 ทศนิยม>2 | calc |
| SKU ร้านอื่น/ไม่มี | calc 22023 |
| SKU ทุน catalog 0/null | incomplete → quoted ไม่ได้ |
| input.product_id ≠ item.product_id | save 22023 |
| client ส่ง sku/name ปลอม | save ทับด้วย catalog |
| ใบรวม margin ติดลบ | blended<0 เดิม |
| ทุน/เหตุผล/ราคาแคตตาล็อกหลุดหน้าพิมพ์ | PrintableQuote ไม่มี field |
| catalog ถูกแก้หลัง save | snapshot ไม่ขยับ |
| role อื่นยิง RPC | service_role + crm_require_owner_admin |

ต้องไม่พัง: golden replay · ใบแท่ง/override/งานผลิตเดิม · ใบผสม product+แท่งราคาเว็บ = 0 วัน · product ล้วน = 30 วัน · product ล้วนมูลค่าต่ำกว่า min_job_value ออกใบได้ · product ล้วน margin ~18% ไม่ต้องใส่ approval_note · ใบผสม product+งานผลิต ส่วนงานผลิตยังติดด่านเดิม · renegotiate · ใบเสร็จ · ราคาเท่า list_price ไม่ต้องมีเหตุผล · ราคา > list_price ผ่าน

## 8. ความเสี่ยง
- `unit_cost` catalog = ค่าประมาณ (ราคา×(1−margin กลุ่ม)) → กำไร OEM ของรายการนี้เป็น estimate
- [A3] ไม่เช็ค `is_active` ใน DB · [A4] price_reason optional เมื่อไม่ต่ำกว่า
- หนี้ M1 เดิม (`calc` มีทุน) หนักขึ้นเพราะมี price_reason + ราคาแคตตาล็อก + ทุน manual

## 9. หนี้
- D1 ข้าม security/QA/review ก่อน merge — ตรวจย้อนหลัง
