# Design — รายการในใบผลิตเลือก โลหะ · เนื้อ % · น้ำหนัก/ชิ้น ได้ ("ให้เหมือนหน้าผลิต OEM") · 19 ต.ค. 69

> architect (Yoda) · สถานะ: **design เท่านั้น — ไม่มี migration/โค้ด** · เจ้าของ 19 ต.ค.: *"หน้าใบผลิตเองในบ้านไม่เห็นมีให้เลือกประเภทโลหะเลย … ทำไมเราไม่ทำให้เหมือนๆ กับหน้าผลิต OEM"*
> ฐานที่ต่อยอด: ใบผลิต `0131`/`0132`/`0138`/`0139`/`0141`–`0144` (💰 ต้นทุน+สต็อก) · ใบงาน M1 `0175`–`0178` (merge main แล้ว) · เอกสารพี่น้อง: `design-production-order.md` · `design-own-production-costing.md` · `design-inventory-lot-costing.md` · `design-job-lots-shopfloor.md` (L1/L3 — งานคู่ขนาน ห้ามชน)
> 🔴 ไม่มีตัวเลขต้นทุน/ราคาในไฟล์นี้ · ช่วงราคาทอง/ทองเหลือง · แหล่งราคาทอง · ค่าเริ่มเนื้อทอง = **[ต้องยืนยัน]** จากเจ้าของ ห้ามแต่ง · ชื่อคอลัมน์/ฟังก์ชันเป็นข้อเสนอ ชื่อจริงตามไฟล์ migration ที่ apply

## 0. ของจริงที่ตรวจก่อนออกแบบ (19 ต.ค. 69 · SELECT อย่างเดียวผ่าน `run-sql.mjs` dry-run) → ผลต่อ design

| พบ | ผลต่อ design |
|---|---|
| โลหะของใบงานจากใบผลิต = `product.make_spec->>'metal'` · SKU fixed/spot ถือเป็น `'silver'` เสมอ (`job_source_info` 0175 บ.576–580) · `target_piece_g` = `silver_weight_g` เฉพาะเงิน | ต้องย้าย "โลหะ/น้ำหนัก" มาอยู่ที่**รายการในใบ** แล้วให้ `job_source_info` อ่านจากที่นั่น — SKU เป็นแค่ค่าเริ่ม |
| `production_spot_resolve` อ่าน `oem_metal_price` เฉพาะ `metal='silver'` (0131 บ.399–405) · override ของใบ `spot_override_thb_per_gram` = เงิน (CHECK 5–500) | ต้องมีตัว resolve ราคา**ต่อโลหะ** · ของเดิมคงไว้เป็น wrapper เงิน (L3 อ้างชื่อนี้) |
| `oem_metal_price`: เงิน 20 แถว (sheet+manual ถึงวันนี้ · 9 วันใน 14 วันล่าสุด) · **ทอง 1 แถว · ทองเหลือง 1 แถว (manual 25 ส.ค.)** · มีคอลัมน์ `purity_basis` แต่**ไม่มีโค้ดไหนอ่าน** | ทองไม่มีราคารายวัน ⇒ ใบผลิตทองวันนี้**ปิดไม่ได้จนมีคนกรอกราคาทองของวันนั้น** (กติกาไม่ fallback) · ฐานความบริสุทธิ์ของราคาทองต้องถามเจ้าของ (§7 Q2) |
| `oem_cost_calc` (0140) รองรับ silver/gold/brass อยู่แล้ว: rate `sprue_loss/recovery/polish_loss` มี scope ครบ 3 โลหะ · `gold_alloy_cost_thb_per_piece` มีค่า · ทองบังคับ purity (ไม่มี default) | โหมดสเปคกับทองคิดได้ทันทีถ้ามีราคา — เหลือแค่ด่าน 0142 ที่ล็อก `metal='silver'` ต้องเปลี่ยนเป็น `in (silver,gold,brass)` |
| SKU active: `spot` 7 (เงินแท่งล้วน purity 0.999) · `fixed` 284 (**0 น้ำหนัก · 0 เนื้อ · 0 สเปค**) · `spec` 0 | ค่าเริ่มจาก SKU จะว่างเกือบทุกตัว ⇒ ช่องน้ำหนัก/เนื้อต้องกรอกเองได้ในใบ (ห้ามเดา — invariant ข้อ 9) · **ความจริงที่ต้องบอกเจ้าของ**: เลือกโลหะบน SKU โหมด `fixed` **ไม่เปลี่ยนต้นทุน** (ต้นทุน = เลขที่กรอกใน /catalog) มีผลเฉพาะใบงาน (ชั่ง/ด่านทอง) — ต้นทุนจะตามโลหะก็ต่อเมื่อ SKU เป็น `spot`/`spec` (§7 Q4) |
| `production_order_item` 36 แถว · `cost_calc` 0 · PO open 4 (PO-0003/PO-0015 มี spot) · `stock_lot` 0 · job production = silver ทั้งหมด | ไม่ backfill · ไม่ UPDATE แถวเดิม (ข้อ 19) — แถวเดิม `metal` null ⇒ helper คืนค่าเดิมเป๊ะ (§2.2) · ใบ open 4 ใบคือ golden ของ "ไม่พัง" |
| `cost_calc` snapshot (0142) มี `metal_per_piece/labor_per_piece/batch_per_piece/nre_cost/nre_per_piece/batch_lines` แยกแล้ว | ตอบข้อสงสัย L3 §5.3 ได้เลย: **component แยกพร้อมแล้ว** ไม่ต้องเพิ่ม key · งานนี้เพิ่มแค่ `metal/purity/weight_g` (additive) |
| `job_profile_default_for(shop,'gold')` → profile "ทอง — ชั่งทุกขั้น + สุทธิ" (`is_default_gold`) · `weigh_required = p_metal in ('gold','silver')` · ด่าน ±0.05 g (N1) ผูก `job.metal` | ทองในใบผลิต → แค่ให้ `job.metal='gold'` ถูก ด่านทองทุกตัว**ทำงานเองโดยไม่แก้ 0175/0176** |
| `schema_migrations` ล่าสุด 0180 · L1 จอง **0181** (ยังไม่ apply) · `job_source_info` ไม่อยู่ในรายการที่ L1 replace (W1 แตะทีหลัง) | งานนี้ = **0184** (ลอก def `job_source_info` จาก 0175 บน main · 1 แถว `pg_proc` หลัง replace) · L3 เลื่อนเป็น 0185 (§5) |
| `MakeSpec.metal: "silver"` (TS) · `product_make_spec_set` whitelist silver · `ProductionSpecCostCard` hardcode "เนื้อเงิน" | สเปค SKU ยังเงินอย่างเดียวได้ (ไม่แตะ /catalog รอบนี้) — โลหะของ**รายการ**ทับตอนคิด · ป้าย "เนื้อเงิน" → "เนื้อ<โลหะ>" |

## 1. หลักการ (ตัดสินแล้ว)

1. **SKU = ค่าเริ่ม · รายการในใบ = ความจริงของรอบนี้** — แก้ในใบไม่เขียนกลับ catalog (memory `sku-autofill-decisions` · ใบผลิตเขียนกลับ catalog เฉพาะ `track_stock` ตามเดิม) · ใบที่ done แล้วเก็บ snapshot ครบใน `production_order_item` + `cost_calc` (ตรงกับที่ `deny_mutation` ล็อกอยู่)
2. **สูตรต้นทุนไม่เปลี่ยน แค่เปลี่ยนที่มาของ 3 ตัวแปร** (โลหะ · เนื้อ · น้ำหนัก) จาก `product.*` → `production_order_item.*` · `fixed` = เลขที่กรอก (โลหะไม่มีผล) · `spot` = น้ำหนัก × ราคาโลหะวันปิด × เนื้อ + ค่าแรง (นิพจน์เดิม 0028) · `spec` = `oem_cost_calc` เดิม
3. **ราคาโลหะ = ของวันปิด (เวลาไทย) ต่อโลหะ · ไม่มี = raise** (0131 §6 / invariant ข้อ 5) — ขยายจากเงินเป็น 3 โลหะด้วยกติกาเดียว · กลไก "เข้าสต็อกก่อน ประทับราคาทีหลัง" (มติ Q12 ของ L3) **นิยามไว้ที่นี่ครั้งเดียว ใช้ร่วมกัน** (§4) แต่ **ไม่เปิดให้ฝั่งออฟฟิศในเฟสนี้** (ออฟฟิศมีทาง: override เงินในใบ / กรอกราคาทองที่ `/oem/rates`) — §7 Q6
4. **ใบผลิตเดิม (เงินล้วน) ต้องได้เลขเดิมทุกสตางค์** — ด่านคือ golden replay บน 4 ใบ open ที่มีจริง + ชุดสังเคราะห์ ในทรานแซกชันที่ rollback (ข้อ 11/17)
5. ไม่มีราคาขาย/margin/floor ในใบผลิต (มติ 19 ก.ย.) — type ฝั่งจอไม่มี field พวกนี้ตั้งแต่โครง (type boundary ไม่ใช่ rendering choice)

## 2. Data model (`analytics` · grant `service_role` เท่านั้น · ข้อ 18)

### 2.1 คอลัมน์ใหม่บน `production_order_item` (`add column` ล้วน — ไม่ UPDATE แถวเดิม)

| คอลัมน์ | ชนิด / CHECK | ความหมาย |
|---|---|---|
| `metal text null` | `in ('silver','gold','brass')` | โลหะของรอบนี้ · null = แถวเดิมก่อน 0184 ⇒ helper §2.2 คืนกติกาเดิม · แถวใหม่ `item_set` เติมเสมอ (ไม่ null) |
| `purity numeric(6,4) null` | `purity >= 0.3750 and purity <= 1` · `(metal is distinct from 'gold') or purity is not null` | สัดส่วน 0..1 (DB คงหน่วยเดิม — `lib/units/purity.ts` แปลงที่ขอบ UI) · **ขั้นต่ำ 37.50% ฝั่ง DB ครั้งแรก** (หนี้ที่ purity.ts จดไว้ — ปิดเฉพาะตารางนี้ ไม่แตะ `product`) · ทองต้องมีเสมอ (เหมือน OEM) |
| `weight_g numeric(10,3) null` | `> 0 and <= 10000` | น้ำหนัก/ชิ้น · null ได้ (SKU fixed ที่ยังไม่รู้น้ำหนัก) · **ต้องมีตอน done/preview เมื่อ cost_type ∈ {spot, spec}** (ด่านเดิมที่เคยเช็ค `silver_weight_g` ย้ายมาเช็คค่า effective) |
| `weight_source text null` | `in ('product','input')` · `(weight_g is null) = (weight_source is null)` | ที่มา: ลอกจาก SKU หรือพิมพ์เอง — ป้อนต่อเป็น `target_piece_g_source` ของใบงาน (0175 guard รับ `'product'`/`'input'` อยู่แล้ว ไม่ต้องเพิ่มค่าใหม่) |

ไม่เพิ่ม `metal_source/purity_source`: โลหะเป็นค่าเชิงหมวด · เนื้อ default ต่อโลหะคือกติการ้าน (เงิน 92.50 · ทองเหลือง 100 · ทองไม่มี default) ไม่ใช่การเดาตัวเลขเฉพาะชิ้น — ตรงกับ `OEM_DEFAULT_PURITY`

`prev_cost_type` CHECK มี `spec` อยู่แล้ว (ตรวจ DB) — ไม่แตะ · `v_production_order_item` **ต่อท้าย** 4 คอลัมน์ (42P16) · `v_production_order` ไม่เปลี่ยน

### 2.2 helper `production_item_spec(poi, p) → (metal, purity, weight_g, weight_source)` (ภายใน · stable · ไม่ grant ใคร)

ค่า effective ที่ preview/done/job ใช้ **จุดเดียว** — นิยามให้แถวเดิม (ทุกคอลัมน์ null) ได้พฤติกรรมเดิมเป๊ะ:
- `metal = coalesce(poi.metal, p.make_spec->>'metal', case when p.cost_type in ('fixed','spot') then 'silver' end)` → null = raise `metal_unsupported` (ข้อความเดิมของ 0175)
- `purity = coalesce(poi.purity, case metal when 'silver' then coalesce(p.silver_purity, 0.925) when 'brass' then 1.0 end)` → ทอง null = raise "ทองต้องระบุเนื้อ"
- `weight_g = coalesce(poi.weight_g, case when metal = 'silver' then nullif(p.silver_weight_g, 0) end)` · `weight_source = coalesce(poi.weight_source, case when weight_g is not null then 'product' end)` — `silver_weight_g` ใช้เฉพาะเงิน (คอมเมนต์ 0175 บ.497 "ห้ามเอาไปเป็นน้ำหนักทอง")
- ค่าเริ่มตอน `item_set` แถวใหม่ก็มาจาก helper ตัวนี้ (server ตัดสิน client แค่ prefill ให้เห็น) ⇒ กติกาเดียว ไม่มีสูตร default ซ้ำในฟอร์ม

### 2.3 ราคาโลหะ — `production_metal_price_resolve(p_shop_id, p_metal, p_override numeric default null) → numeric` (security definer)

| โลหะ | override | ไม่มี override |
|---|---|---|
| silver | ของใบ `spot_override_thb_per_gram` (5–500 เดิม) | `oem_metal_price` silver `as_of_date = วันนี้ไทย` (เดิมเป๊ะ) |
| gold / brass | **เฟสนี้ไม่มี** (§7 Q3) · ส่งมา = raise 22023 | `oem_metal_price` <metal> วันนี้ไทย · ไม่มี = raise "ยังไม่มีราคา<โลหะ>ของวันนี้ — กรอกที่ /oem/rates (ทอง/ทองเหลืองไม่มี feed จึงไม่ล็อกชีต)" |

- `production_spot_resolve(uuid, numeric)` **คง signature** · body = `return production_metal_price_resolve(p_shop_id, 'silver', p_override)` (L3 §5.2 อ้างชื่อนี้ · md5 เปลี่ยนแต่ผลเท่าเดิม — verify) · ขอบเขตราคาทอง/ทองเหลือง sanity (กัน "ต่อบาท" หลุดเป็น "ต่อกรัม" แบบบั๊ก 1,097 ของเงิน) = **[ต้องยืนยัน ค่า]** จากเจ้าของ ก่อนหน้านั้นใช้ `> 0 and <= 1000000` ของ `oem_cost_calc` เป็นเพดานเดียว
- 🔴 **ฐานความบริสุทธิ์**: `oem_cost_calc` คูณ `weight × purity × price` ⇒ `price_thb_per_gram` = **ต่อกรัมเนื้อโลหะบริสุทธิ์** — ถ้าเจ้าของกรอกราคาทองรูปพรรณ (ฐานอื่น/ต่อบาท) ต้นทุนเพี้ยนเงียบ · `purity_basis` ที่มีอยู่ไม่ถูกอ่าน ⇒ หน้า `/oem/rates` ช่องทองต้องเขียนหน่วยชัด + (ทางเลือก) ช่องช่วยแปลงที่ **ไม่คิดเอง** นอกจากค่าที่เจ้าของยืนยัน (§7 Q2) — **ห้ามอนุมานฐานจากตัวเลขราคา**

### 2.4 RPC ที่เปลี่ยน (✱ = drop signature เดิม + re-grant · เทียบ `pg_proc` 1 แถว · `check-analytics-grants.sql`)

| ฟังก์ชัน | เปลี่ยนอะไร |
|---|---|
| `production_order_item_set(…, p_is_new_design, p_metal text default null, p_purity numeric default null, p_weight_g numeric default null, p_weight_source text default null)` ✱ | null = ไม่แตะค่าเดิม (แพทเทิร์น 0144) · แถวใหม่: ค่าที่ไม่ส่ง → §2.2 default · ตรวจ `not(between)` ทุก numeric (ข้อ 4) · **เปลี่ยน `metal` ไม่ได้เมื่อมี `job` ที่ไม่ cancelled ผูก item นี้** (ใบงานล็อก metal/profile แล้ว) → raise บอกให้ยกเลิกใบงานก่อน · เปลี่ยน `weight_g` หลังมีใบงาน = อนุญาต แต่ไม่เขียนทับ `job.target_piece_g` (0175 `job_plan_set` เป็นทางแก้แผน) |
| `production_cost_calc(p_shop_id, p_product_id, p_metal_price numeric, p_qty, p_is_new_design, p_metal text, p_purity numeric, p_weight_g numeric)` ✱ | รับ 3 ตัวแปรจาก caller แทนอ่าน `product.silver_*` · `spot`: นิพจน์เดิม `round(weight × price × purity + labor_cost, 2)` · `spec`: `make_spec || {metal, purity, weight_g, qty, is_new_design, metal_price_thb_per_gram, as_of_date}` (metal ของรายการ**ทับ** make_spec) · ด่าน 0142 "metal ต้องเป็น silver" → `in ('silver','gold','brass')` · `cost_calc` เพิ่ม key `metal/purity/weight_g/weight_source` (additive) · ข้อความ "ยังไม่กรอกน้ำหนักเงิน" → "ยังไม่ระบุน้ำหนัก/ชิ้นของรายการนี้ — กรอกในใบผลิต" · ไม่มี caller ตรงจาก TS (grep: อ้างในคอมเมนต์เท่านั้น) |
| `production_order_preview(p_shop_id, p_id, p_items)` (signature เดิม) | resolve ราคา**ต่อโลหะที่ใบใช้จริง** (`distinct metal` ของรายการ spot/spec ที่ qty_used > 0) · คืน `metal_prices jsonb` `{silver: n, gold: n}` (additive) · `spot_price_thb_per_gram` = ราคาเงิน หรือ null ถ้าใบไม่มีเงิน (ความหมายเดิม) · ต่อรายการเพิ่ม `metal/purity/weight_g/weight_source` |
| `production_order_done(p_shop_id, p_id, p_items, p_expected_metal_prices jsonb, p_actor)` ✱ | แทน `p_expected_spot_thb_per_gram numeric` — M1 fail-closed **ต่อโลหะ**: ทุกโลหะที่ `v_needs_price` ต้องมี key และต่างไม่เกิน 0.0001 · key เกิน = raise (กัน payload เพี้ยน) · ใบ fixed ล้วน ไม่แตะ · ลำดับ load-bearing เดิมทุกบรรทัด (snapshot item → `central_stock` → `adjust_stock` → `track_stock` → `stock_lot` → พลิกสถานะ) · M-b ขยาย: `cost_type in (spot,spec)` แต่ราคาโลหะของรายการนั้นไม่มีใน map = raise · `catalog_audit_log.before/after` เพิ่ม `metal` · caller เดียว = `doneProductionOrder` (0132 lesson: ไม่มี caller เก่าให้ปกป้อง) |
| `job_source_info` branch production (ลอก 0175 def) | `metal/target_piece_g/target_piece_g_source` จาก §2.2 (ทุกโลหะ ไม่ใช่เฉพาะเงิน) · เพิ่ม `purity` ใน output (ใบงานยังไม่ใช้ — เผื่อ G2) · branch oem ไม่แตะ |
| trigger `production_order_item_deny_mutation` | ไม่แก้ (คอลัมน์ใหม่อยู่ใต้กติกา "ห้าม UPDATE หลังปลายทาง" อัตโนมัติ) · `job_guard` 0175 เทียบ `new.metal` กับ `job_source_info` ตอน INSERT — ยังตรงเพราะทั้งคู่อ่าน helper เดียวกัน |

### 2.5 ต้นทุนแคตตาล็อก (`v_dim_product`) **ไม่แตะ** — ยังเป็น "ต้นทุนถ้าผลิตวันนี้ตามข้อมูล SKU" (เงิน) · ความจริงอยู่ที่ `stock_lot.unit_cost` ของรอบ (D1) ⇒ SKU เดียวที่ผลิตคนละโลหะจะมี lot คนละราคาใต้ SKU เดียว — เป็นเหตุผลให้ถาม §7 Q1

## 3. หน้าจอ — เลียนแบบการ์ดรายการ OEM ด้วย "primitive ร่วม" ไม่ใช่ component ร่วม

| ทางเลือก | ตัดสิน | เหตุผล |
|---|---|---|
| (ก) reuse `QuoteJobItemCard` | ❌ | ผูก `JobForm` 25 field ราคา/margin/override + `OemPriceCalcResult` (type **พก** floors/margin) — ซ่อนด้วย prop = anti-pattern ที่ `ProductionSpecCostCard` ปฏิเสธไว้แล้ว · แตะไฟล์ OEM 💰 เพื่องานใบผลิต = ขยาย QA เข้า flow ใบเสนอราคาโดยไม่จำเป็น |
| (ข) แยก `MetalPurityWeightFields` ออกจาก OEM แล้วใช้ 2 ที่ | ⏸ ทีหลัง | ดีในระยะยาว แต่รอบนี้ต้อง refactor OEM form (QA L บน /oem/quote) — ทำเมื่อมีจอที่ 3 ต้องใช้ |
| **(ค) `ProductionItemCard` ใหม่ใน `components/domain/production/`** ใช้ primitive เดิม: `PurityPctInput` · `OEM_METAL_LABEL_TH` กรองเหลือ `OemProductionMetal` · `OEM_DEFAULT_PURITY` · `inputCls/labelCls` เดียวกัน · ลำดับช่อง/ป้ายคำเดียวกับ OEM | ✅ | OEM diff = 0 ไฟล์ (หลักเดิมของ P1) · หน้าตา/ลำดับเหมือนกันพอที่เจ้าของจะรู้สึกว่า "หน้าเดียวกัน" · type ของการ์ดไม่มีช่องราคาเลย |

การ์ด 1 ใบ/รายการ (แทนตารางแถวเดียว + ฟอร์มเพิ่มด้านล่าง): หัวการ์ด = `SKU · ชื่อ · <โลหะ> · n ชิ้น` + ป้ายโหมดต้นทุน (เดิม) · ตัวการ์ด = **วัสดุ** (select 3 ค่า) · **ความบริสุทธิ์ (%)** (`PurityPctInput` · ทอง `*บังคับกรอก`) · **น้ำหนัก/ชิ้น (กรัม)** · **จำนวน** · ติ๊ก **แบบใหม่** (spec เท่านั้น — เดิม) · แถวสเปคอ่านอย่างเดียวจาก SKU (ประเภท/ระดับขัด/พลอย/ชุบ + "แก้สเปคที่ /catalog") · ป้ายต่อช่อง `จาก SKU` / `แก้ในใบนี้` (เทียบค่ากับ product ที่โหลดมา — แสดงผล ไม่ตัดสิน) · ช่องต้นทุน = ของเดิม (`fixed` โชว์เลข · spot/spec "คำนวณตอนกดผลิตเสร็จ") · **ไม่มี** ราคา/margin/floor/override
- บันทึก = `setProductionOrderItem` ต่อการ์ด (RPC สด ตามแพทเทิร์น 0131 — ไม่มี draft) · "เพิ่มรายการ" = เลือก SKU → การ์ดใหม่ prefill จาก `v_dim_product` + `product.make_spec/silver_*` (ที่ `getProductionOrder` อ่าน side-channel อยู่แล้ว) → กด "เพิ่ม" ส่งค่าทั้ง 3 ชัดเจน
- `ProductionDoneDialog`: หัวกล่องเปลี่ยนจาก "ราคาเงินที่จะใช้" เป็นรายการ**ราคาต่อโลหะ** จาก `preview.metalPrices` · ส่ง `expectedMetalPrices` (object เดียวกับที่โชว์) · ต่อรายการโชว์ `โลหะ · เนื้อ · น้ำหนัก` ที่จะถูกล็อก · `ProductionSpecCostCard` ป้าย "เนื้อเงิน" → `เนื้อ${OEM_METAL_LABEL_TH[metal]}`
- ใบ done: การ์ดอ่านจาก snapshot ใน `production_order_item` (ไม่ใช่ product ปัจจุบัน) — ปิดช่องเดิมที่ `currentSilverWeightG` เป็น "สภาพ catalog วันนี้"
- ใบผลิตนี้เป็นจอใช้ทุกวัน → **ux-ui ก่อน frontend** (memory `ui-through-ux-first`) · mobile: การ์ดเรียงแนวตั้ง (หน้างาน W1 จะใช้ชุดช่องเดียวกัน)
- ข้อความ `humanizeProductionError`: เพิ่มกรณี "ยังไม่มีราคา<ทอง/ทองเหลือง>ของวันนี้" → ทางออก "กรอกที่ /oem/rates" (ต่างจากเงินที่ห้ามชี้ไป /oem/rates เพราะล็อกชีต — ทอง/ทองเหลืองไม่มีชีต)

## 4. กลไกร่วมกับ L3 มติ Q12 — "เข้าสต็อกก่อน ประทับราคาทีหลัง" (นิยามครั้งเดียว · implement ใน migration ของ L3 · เฟสนี้ไม่สร้าง lot แบบนี้)

- `stock_lot.cost_status text not null default 'final' check in ('final','pending_price')` · `pending_metal text null` · `pending_basis jsonb null` (= input ครบทุกตัว**ยกเว้นราคา**: metal/purity/weight_g/qty/labor/is_new_design/make_spec/as_of = `received_on`) · CHECK `(cost_status='pending_price') = (pending_metal is not null and pending_basis is not null)` · `unit_cost` ของ lot pending = **null** (ไม่ใช่ 0 — ข้อ 13) ⇒ `stock_lot.unit_cost` ต้อง nullable เมื่อ pending · trigger "แก้ได้เฉพาะ `qty_remaining`" ผ่อนให้ RPC ประทับเท่านั้น (`set_config` key เดียวกับ §5.4 ของ L3)
- `stock_lot_price_stamp(p_shop_id, p_lot_id, p_actor)` ✱: ราคา = `oem_metal_price` ของ `pending_metal` **ณ `received_on`** (ไม่ใช่วันนี้ · ห้าม fallback) → `production_cost_calc` ด้วย `pending_basis` → `unit_cost` + `cost_calc` → `final` · ไม่มีราคาวันนั้น = ยังค้าง · `stock_lot_price_set_manual(..., p_price, p_reason)` ✱ ออฟฟิศ (`oem_note_present`) เมื่อราคาวันนั้นไม่เข้าเลย
- งานอัตโนมัติ: `silver_spot_sync_from_history` (trigger ราคาเงินเข้า) **ไม่** ยิง stamp เอง (trigger ข้าม schema ที่แตะเงิน = หาบั๊กยาก) → ปุ่ม "ประทับราคาที่ค้าง" บน `/production` + ป้ายจำนวน lot ค้าง · (ทางเลือก cron ทีหลัง)
- ด่านฝั่งอ่าน: `v_stock_lot` เพิ่ม `cost_status` · `v_dim_product.lot_cost_avg/lot_next_unit_cost` **ไม่นับ** lot pending + เพิ่ม `lot_pending_count` (ต่อท้าย) · FIFO consumption (ยังหลับ) เมื่อตื่น: กิน lot pending ได้แต่ `unit_cost_snapshot` null ⇒ COGS ของออเดอร์นั้น `estimated` ไม่ใช่ 0 → เขียนไว้ใน security scope L3
- ช่องทางที่สร้าง lot pending: **ช่าง `job_worker_stock_in` เท่านั้น** (มติ Q12) · ออฟฟิศ `production_order_done`/`production_receipt_create` ยัง fail-closed (§7 Q6)

## 5. ลำดับ phase เทียบ L1 / L3 / G1 (เสนอ — Tech Lead ตัดสิน)

| phase | ขอบเขต | migration | ขนาด | QA | security | พึ่ง / ชน |
|---|---|---|---|---|---|---|
| **L1** (กำลังทำ) | ส่วนย่อยในร้าน | 0181 | L | L | บังคับ | — · ไม่แตะ `production_*`/`job_source_info` ⇒ **ไม่ชน** งานนี้ · ทำคู่ขนานได้ (worktree แยก · apply 0181 ก่อน 0184) |
| **PM-A ฝั่ง DB (งานนี้) 💰** | §2 ทั้งหมด + `verify-0184.sql` (golden 4 ใบ open + สังเคราะห์ 3 โลหะ × 3 โหมด) | **0184** | M (DB ~500 บรรทัด · 6 ฟังก์ชัน) | L (ใบผลิตทุก flow + สร้างใบงานจากใบผลิต + `/catalog` ไม่ขยับ) | **บังคับก่อน merge** (แตะ `production_order_done` · ราคาโลหะใหม่ · signature 3 ตัว) | หลัง L1 apply · **ก่อน L3** |
| **PM-B ฝั่งจอ** | §3 (ux-ui → frontend) | — | M | L | ไม่ (ไม่มีเงินใน client) · grep RSC payload ไม่มี `_raw`/ราคา OEM | PM-A apply ก่อน deploy (named args — PGRST202 ถ้าสลับ · บทเรียน 0132) |
| **L3** 💰 (เลื่อนเลข) | งวด + `production_receipt` + §4 pending lot | **0185** (เดิม 0182 → เลื่อนเป็น 0183 → เลื่อนอีกครั้ง 20 ต.ค. เพราะ 0182 = รูปงาน · 0183 = ส่วนต่าง "ได้รับเพิ่มแล้ว") | L | 💰 | บังคับ | `production_receipt_core` เรียก `production_cost_calc` **signature ใหม่** + `production_metal_price_resolve` ต่อโลหะของรายการ · `p_expected_metal_prices` แบบเดียวกับ done — ต้องแก้ `design-job-lots-shopfloor.md` §5.2/§12 ตามนี้ |
| L2 / W1 / L4 | ตามเดิม | 0186 / 0187 / 0188 | | | | W1 `job_worker_open(p_metal …)` ใบไม่มี SKU → ลง `production_order_item.metal/purity/weight_g` ตรงๆ (คอลัมน์พร้อมแล้ว — ลดงาน W1) |
| G1 พลอย | หลัง W1 | ถัดไป | L 💰 | | | BOM พลอยต่อรายการใบผลิตจะวางบน `production_order_item` ตัวเดียวกัน |

**ทำไม PM-A ก่อน L3**: L3 ลอกเส้นต้นทุนของ done ไปใช้ในงวด — ถ้าทำ L3 ก่อน ต้องแก้สองครอบครัว RPC สองรอบ (done + receipt) และ `p_expected_spot` ของ L3 จะเกิดมาเป็นแบบเงินเดี่ยวแล้วต้องรื้อ · PM-A เล็กกว่า L3 มาก และตอบคำสั่งตรงของเจ้าของ 19 ต.ค. · ความเสี่ยงของการสลับ: ถ้า L1 ลากยาว PM-A รอ 0181 เปล่าๆ — ทางออก: PM-A ไม่พึ่ง L1 เชิงโค้ด (คนละ object) จองเลข 0184 แล้ว dry-run บน main ได้เลย apply ตามลำดับเลข

## 6. เคสห้ามผ่าน / ต้องไม่พัง (verify = do-block + `raise` rollback · fixture ผ่าน RPC เท่านั้น · ตารางแมป "ข้อในบรีฟ → เทสต์" บังคับ)

### 6.1 ห้ามผ่าน → ด่าน
| # | เคส | ด่าน |
|---|---|---|
| 1 | `item_set` purity < 0.375 / > 1 / NaN / Infinity · weight ≤ 0 / > 10000 / NaN · metal นอก 3 ค่า · `weight_source` นอกชุด · มี weight ไม่มี source (และกลับกัน) | CHECK + `not(between)` ใน RPC (ข้อ 4) |
| 2 | ทองไม่มี purity (ตอน set และตอน done ผ่าน helper) | CHECK `(metal<>'gold') or purity not null` + raise ใน §2.2 |
| 3 | เปลี่ยน `metal` ของรายการที่มี `job` ไม่ cancelled ผูกอยู่ | `item_set` raise · ข้อความบอกให้ยกเลิกใบงานก่อน |
| 4 | done/preview รายการ spot/spec ที่ effective `weight_g` null (SKU fixed-ไม่มีน้ำหนัก ถูกพลิกเป็น spec แล้วใส่ใบโดยไม่กรอกน้ำหนัก) | `production_cost_calc` raise 22023 (ด่านเดิมย้ายที่) |
| 5 | ใบมีทอง · ไม่มีราคาทองวันนี้ (มีแค่แถว 25 ส.ค.) · ไม่มี override | `production_metal_price_resolve` raise — **ห้ามหยิบแถวล่าสุด** (ต่างจาก `oem_cost_calc` lookup `<=` ที่ใบผลิตไม่ใช้) |
| 6 | ส่ง override ทอง/ทองเหลือง (ยังไม่มีในเฟสนี้) · `spot_override` ของใบถูกใช้คิดทอง | resolve raise · ทดสอบใบผสม เงิน+ทอง ที่มี `spot_override`: เงินใช้ override ทองไม่ใช้ |
| 7 | done: `p_expected_metal_prices` ขาด key ของโลหะที่ใช้ · ราคาต่าง > 0.0001 · key เกิน · ไม่ใช่ object · ใบ fixed ล้วนส่ง `{}`/null ต้องผ่าน | M1 ต่อโลหะ (fail-closed) |
| 8 | ราคาทองถูก upsert ระหว่าง preview→done | เคสเดียวกับ 7 (ราคาต่าง) |
| 9 | `cost_type` พลิกเป็น spot/spec ระหว่าง done แต่โลหะนั้นไม่อยู่ใน map (M-b) | raise ไม่เดา |
| 10 | spec + metal gold แต่ rate scope gold ว่าง (`sprue_loss_pct[gold]` ฯลฯ) | `is_complete=false` → raise พร้อม `missing[]` (ข้อ 13: เช็ค `is not true`) |
| 11 | `_raw`/ราคา OEM/margin หลุดใน `cost_calc` หรือ response preview/done · `metal_prices` มี key นอก 3 โลหะ | `jsonb_path_exists` assert |
| 12 | job จากรายการทอง: รับงานน้ำหนักต่าง > 0.05 g ต้องถูกปฏิเสธ · profile default = ทอง · `weigh_required` ทุกขั้นที่ `metal_present` · `require_final_weight` | ด่าน 0175/0176 เดิม (ทดสอบว่า**ทำงานกับ metal จาก item** ไม่ใช่จาก make_spec) |
| 13 | UPDATE คอลัมน์ใหม่ตรงบนใบ done/cancelled · anon/authenticated execute ฟังก์ชันใหม่/ที่ replace · overload (ทุกตัวที่ drop ต้อง 1 แถว) | `deny_mutation` · `check-analytics-grants.sql` (18.5 จำลองกำแพงหลุด) · `pg_proc` count |
| 14 | ค่าในใบเขียนกลับ `product.silver_weight_g/silver_purity/make_spec` | assert md5 แถว product ก่อน/หลัง item_set+done (ยกเว้น `track_stock*` ที่ done เขียนตามเดิม) |

### 6.2 ต้องไม่พัง (ยิงของใหม่ใส่ของเก่าจริง — ข้อ 17)
- **4 ใบ open บน prod** (PO-0003/0015 มี spot เงินแท่ง · PO-0032/0033 fixed): `production_order_preview` ก่อน/หลัง apply → jsonb เท่ากันทุก key เดิม (key ใหม่ตัดออกก่อนเทียบ) · `production_order_done` จำลองใน rollback ให้ `unit_cost`/`stock_lot.unit_cost` เท่ากับที่ฉบับ 0141 คิด (รัน legacy ที่ rename ไว้ก่อน drop — แพทเทิร์น golden 0140)
- SKU ทุกโหมดที่มีจริง (spot เงินแท่ง 7 · fixed) ใส่ใบใหม่โดย**ไม่ส่ง** metal/purity/weight → ค่าใน `production_order_item` = ค่าที่ helper คืน (เงิน · 0.999 · น้ำหนักแท่ง / เงิน · 0.925 · null) และ done ได้เลขเดิม
- ใบเงินล้วน: `metal_prices = {silver: x}` และ `spot_price_thb_per_gram = x` · ด่าน M1 เดิมผ่านเมื่อส่ง `{silver: x}`
- สร้างใบงานจากใบผลิตเดิม (`job_create_from_production_item`) → `job.metal='silver'` · `target_piece_g` เท่าเดิม (`'product'` source) · ใบงานบน prod ทุกสถานะ: `job_source_info` ก่อน/หลัง เท่าเดิมทุก key เดิม
- `v_dim_product` ไม่ขยับแม้คอลัมน์เดียว (md5 view def + ค่าทุก SKU) · `/catalog` · OEM quote/receipt/invoice ไม่แตะ (0 ไฟล์ · `oem_cost_calc` ไม่ถูก replace)
- FIFO ที่ยังหลับ: `stock_lot` คอลัมน์ไม่เปลี่ยนในเฟสนี้ · `adjust_stock` key `po:` เดิม · `stock_sync_sales` ไม่ถูกเรียก (ยืนยัน 0 แถว `stock_sale_applied` ก่อน/หลัง)
- 00:00–07:00 ไทย: ราคาทอง "วันนี้" = วันไทย (ข้อ 6)
- Windows: ไฟล์ LF (`tr -dc '\r' | wc -c` = 0) ก่อน dry-run (ข้อ 20)

## 7. คำถามเจ้าของ (ถามรอบเดียว · ไม่บล็อก PM-A ยกเว้น Q2/Q8)

| # | คำถาม | ตัวเลือก | แนะนำ + เหตุผล |
|---|---|---|---|
| Q1 | ของทองเข้าสต็อก **แยก SKU** ทอง/เงิน หรือใช้ SKU เดิมเลือกโลหะในใบ | ① แยก SKU เสมอ (ระบบเตือนเมื่อโลหะในใบ ≠ โลหะ SKU แต่ไม่บล็อก) ② SKU เดียวหลายโลหะ | ① — สต็อก/ต้นทุนเฉลี่ย/`v_dim_product` ยึดต่อ SKU · SKU เดียวสองโลหะ = ยอดคงเหลือรวมของคนละราคาคนละสินค้า · ตรงกติกา variant (สี/ไซส์ = คนละ SKU) |
| Q2 🔴 | ราคาทองที่จะกรอก คือ **ต่อกรัมเนื้อทอง 100%** หรือราคาตลาดอื่น (เช่น ทองรูปพรรณต่อบาท) · แหล่งไหน | ① กรอกมือต่อกรัมเนื้อ 100% ที่ /oem/rates (ระบบคิดต่อ) ② กรอกราคาที่ร้านเห็น + ให้ระบบแปลง [ต้องยืนยันสูตร/ค่าคงที่] ③ feed อัตโนมัติ (งานแยก) | ① ตอนนี้ (ตรงสูตร `oem_cost_calc` ไม่มีชั้นแปลง) · ② ต้องให้เจ้าของยืนยันค่าคงที่เอง ห้ามทีมอนุมาน · ③ ทีหลังเมื่อผลิตทองประจำ |
| Q3 | ต้องมีช่อง "ราคาทองเฉพาะใบนี้" (เหมือนเงิน) ไหม | ① ไม่ — กรอกที่ /oem/rates (ทองไม่มีชีต ไม่มีผลข้างเคียง) ② มี | ① เฟสนี้ · ② เพิ่มเป็นคอลัมน์ `gold_override_thb_per_gram` ได้ภายหลังโดยไม่รื้อ |
| Q4 | SKU โหมด `fixed` (284 ตัว) เลือกโลหะแล้ว **ต้นทุนไม่เปลี่ยน** (ต้นทุน = เลขใน /catalog) ยอมรับไหม | ① ยอมรับ — ต้นทุนตามโลหะต่อเมื่อ SKU เป็น spot/spec (ตั้งใจย้าย SKU ที่ผลิตเองเป็น spec) ② เพิ่ม "คิดจากสเปคในใบนี้" ต่อรายการ (กรอกประเภท/ระดับขัด/พลอย/ชุบในใบ — เหมือน OEM เต็มรูป · กลับมติ C4 19 ก.ย. บางส่วน) | ① เฟสนี้ + บอกตรงๆ ใน UAT · ② = PM-D (ขนาด L 💰) ถ้าเจ้าของต้องการ "เหมือน OEM" ถึงระดับสูตร |
| Q5 | SKU ที่ไม่มีข้อมูลโลหะ ค่าเริ่ม | ① เงิน 925 อัตโนมัติ (ร้านเงิน · พฤติกรรมเดิมของใบงาน) ② บังคับเลือกทุกครั้ง | ① — น้ำหนัก/เนื้อยังห้ามเดา (ว่าง = ต้องกรอก) · เฉพาะหมวดโลหะที่ default ได้ |
| Q6 | ออฟฟิศปิดใบโดยไม่มีราคาโลหะวันนั้น (ประทับทีหลังแบบช่าง Q12) | ① ไม่ (ออฟฟิศมี override/กรอก /oem/rates) ② ใช่ | ① — คนที่ตั้งราคาต้นทุนได้ไม่ควรมีทางเลี่ยงด่านราคา |
| Q7 | เนื้อทองค่าเริ่มของร้าน | ① ว่าง บังคับกรอกทุกใบ (เหมือน OEM) ② ตั้งค่าเริ่ม [ต้องยืนยัน ค่า] | ① — ทองหลาย K · ค่าเริ่มผิดครั้งเดียว = ต้นทุนผิดทั้ง lot |
| Q8 🔴 | ช่วงราคา sanity ทอง/ทองเหลือง ต่อกรัม (เงินใช้ 5–500) กันพิมพ์ "ต่อบาท" | [ต้องยืนยัน ค่า] | ไม่มีค่า = ใช้เพดาน `oem_cost_calc` (0 < p ≤ 1,000,000) ชั่วคราว + ป้ายหน่วยหนาบนจอ |

### 7.1 มติเจ้าของ 19 ต.ค. 69 (ทับข้อแนะนำใน §7)
| # | มติ |
|---|---|
| Q4 | "เหมือน OEM" = **โลหะ + เนื้อ % + น้ำหนักต่อรายการ** (ไม่ใช่สเปคทั้งชุด) · SKU fixed ต้นทุนเดิม → ไม่มี PM-D |
| Q2 | ราคาทองที่ /oem/rates = **บาทต่อกรัม ทองบริสุทธิ์ 100%** (ตรงสูตร weight × purity × price) |
| Q1 | **แยก SKU ทองกับเงิน** (เจ้าของเลือก "SKU เดียว" ก่อน → Tech Lead ชี้ว่าสต็อก/ต้นทุนเฉลี่ยปน + ขัดมติ variant สีละ SKU → เจ้าของยืนยันแยก) · ใบผลิตเลือกโลหะต่างจาก SKU → **เตือน ไม่บล็อก** |
| Q5 | SKU ไม่มีข้อมูลโลหะ → ค่าเริ่ม **เงิน 925** · ช่องโลหะอยู่บนสุด |
| Q6 | ปิดใบทองแต่วันนั้นไม่มีราคาทอง → **ต้องกรอกราคาวันนั้นที่ /oem/rates ก่อน** (ไม่มี override ต่อใบ · ไม่ fallback) |
| Q7 | เนื้อทองค่าเริ่ม **ว่าง บังคับกรอก** |
| Q8 | ช่วง sanity ราคาทอง/ทองเหลืองต่อกรัม → **ทีมเสนอจากราคาตลาดจริง (docs-researcher + URL) แล้วเจ้าของยืนยันก่อนใช้** · ระหว่างรอ = [ต้องยืนยัน] |
| Q3 | ไม่มี override ราคาทองต่อใบในเฟสนี้ (ตาม Q6) |
⚠️ แจ้งเจ้าของแล้ว 19 ต.ค.: ใบเสนอราคา OEM งานทอง/ทองเหลืองยังใช้ราคากรอกมือ 25 ส.ค. เงียบๆ (หนี้ H2(ข)) — ระหว่างนี้ให้อัปเดต /oem/rates ก่อนออกใบทองทุกครั้ง · ปิดถาวรพร้อม PM-A

## 8. ความเสี่ยงต้นทุน · หนี้ · ไฟล์

**ความเสี่ยงตอน implement (💰)**
- R1 **ฐาน/หน่วยราคาทอง** (Q2/Q8): ผิดฐานความบริสุทธิ์ = เพี้ยนเงียบไม่กี่ % · ผิดหน่วยต่อบาท/ต่อกรัม = ×15 (เกิดจริงกับเงิน 17 ก.ย.) — ด่านเดียวที่กันได้คือ bound จากเจ้าของ + verify เคสพิมพ์ "ต่อบาท"
- R2 **ราคาทองค้างจาก ส.ค.**: ด่าน "วันนี้ไทย" กันอยู่ · แต่ `oem_cost_calc` ที่ใบเสนอราคาเรียกเอง (ไม่ผ่านใบผลิต) ยัง lookup `<=` → ใบเสนอราคา OEM ทองวันนี้ใช้ราคา ส.ค. เงียบๆ (หนี้ H2(ข) เดิม — **นอก scope แต่ควรแจ้งเจ้าของพร้อมกัน**)
- R3 **ลอกผิดฉบับ**: `job_source_info` ต้องลอกจาก 0175 (apply แล้ว · บน main) · `production_order_done/preview/cost_calc` จาก 0141/0142 · เทียบ md5 ก่อน replace (ข้อ 21) · drop signature 3 ตัว → `pg_proc` 1 แถว (ข้อ 1)
- R4 **L3 เปลี่ยนตาม**: `design-job-lots-shopfloor.md` §5.2/§12 อ้าง `p_expected_spot`/`production_spot_resolve` — ต้องอัปเดตให้ใช้ `p_expected_metal_prices` + resolve ต่อโลหะ ไม่งั้นงวดใบทองปิดไม่ได้
- R5 **โลหะในใบ ≠ โลหะ SKU** (Q1 ①): lot คนละราคาใต้ SKU เดียว · `lot_cost_avg` ปน · เตือนแต่ไม่บล็อกจน Q1 ตอบ
- R6 **ค่า default เงินสำหรับ fixed** (Q5 ①): ชิ้นทองที่ลืมเปลี่ยน dropdown → ใบงานได้ profile เงิน ด่านทองหาย — UI ต้องวาง dropdown โลหะเป็นช่องแรกของการ์ด + ป้ายสีต่างต่อโลหะ
- R7 signature `production_cost_calc` เปลี่ยน → TS ไม่เรียกตรง แต่ `verify-0141/0142` เดิมจะล้ม → ปั๊มหัวไฟล์ SUPERSEDED เหมือน `verify-0131`

**หนี้ที่รู้ตั้งแต่ design**: สเปค SKU (`make_spec`) ยังเงินอย่างเดียวที่ /catalog · ไม่มี override ราคาทองต่อใบ · `v_dim_product` "ต้นทุนถ้าผลิตวันนี้" ยังสูตรเงิน · ไม่มี feed ราคาทอง · pending-price lot (§4) รอ L3 · `purity_basis` ยังไม่มีใครอ่าน

**ไฟล์ที่แตะ (คาด)**: `supabase/migrations/0184_production_item_metal.sql` + `scripts/verify/verify-0184.sql` · `lib/production/types.ts` (+`metal/purity/weightG/weightSource` · `metalPrices` · `ProductionMetal`) · `lib/actions/production.ts` (`setProductionOrderItem` 4 arg · `previewProductionOrder`/`doneProductionOrder` map) · `components/domain/production/ProductionItemCard.tsx` (ใหม่) · `ProductionAddItemForm.tsx` · `ProductionOrderDetailClient.tsx` · `ProductionDoneDialog.tsx` · `ProductionSpecCostCard.tsx` (ป้ายโลหะ) · `lib/production/types.test.ts` · `docs/3j-jewelry/oms/design-job-lots-shopfloor.md` (§5.2/§9/§12 เลขและ signature)
