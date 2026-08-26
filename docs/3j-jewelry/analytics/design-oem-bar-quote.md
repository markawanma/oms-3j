# Design — โหมดเงินแท่งในใบเสนอราคา OEM (v2) · migration 0078

> Architect (Yoda) · 2026-08-25 · อ่านคู่กับ 0075/0076 (gates), 0072/0074 (silver_price_daily — branch feature/silver-price-daily), 0066 (oem_price_calc v3)
> มติเจ้าของ (final): ยืนราคาวันเดียว · 1 กก. ใช้ kilo_sell_vat · WA-1B ราคาเดียวกับแท่งปกติ · เลเซอร์ 2 ช่องกรอกเอง optional · **ส่วนลดใส่ได้ทุกใบเหมือนเดิม** · **margin เงินแท่งฝังในราคาเว็บ ~19% ใช้เป็นฐานอนุมานต้นทุนได้**

## หลักการเดียวที่คุมทั้ง design

เงินแท่ง = สินค้าราคาตายตัวจากเว็บ ราคาต้องมาจาก `silver_price_daily` ของ "วันนี้เวลาไทย" เท่านั้น
(lookup แบบ `=` ไม่มี fallback ราคาเมื่อวาน) · margin ไม่ใช่ตัวตั้งราคา แต่**อนุมานต้นทุนย้อนกลับ**
(`cost = price × (1 − bar_margin_pct)`) เพื่อให้รายการเงินแท่งไหลเข้า aggregation เดิมของ 0076
ได้เหมือนรายการปกติ → ด่านส่วนลด/hard floor ทำงานเองโดยแทบไม่แก้ gate

---

## D1 — Representation: `metal = 'silver999'` + `bar_size` (ไม่ใช่ field `mode`)

```
OemMetal = 'silver' | 'gold' | 'brass' | 'silver999'
```

- ทุกจุดตัดสินใจใน 0075/0076 switch บน `input->>'metal'` อยู่แล้ว (valid_days case, ex_gold branch
  ทั้ง save/renegotiate) — เพิ่มค่าใหม่ = แก้ที่ switch เดิม ไม่เพิ่มมิติใหม่
- **fail-closed:** `oem_price_calc` ปัจจุบัน raise ทันทีถ้า metal แปลก → deploy เหลื่อม (frontend ใหม่
  + DB เก่า) ได้ error ดัง ไม่ใช่คิดราคาผิดเงียบ
- ทางที่ตัดทิ้ง: `mode:'bar'` โดย metal คง 'silver' — consumer เดิมทุกตัว (valid_days 30 วัน,
  margin gate) จะกินเป็นงานผลิตเงินทันทีถ้าลืมเช็ค mode = fail-open ทุกจุดที่ลืม
- ราคาที่จ่าย: `OemMetal` type + `OEM_METAL_LABEL_TH` + ทุก `case metal` เพิ่ม 1 ค่า — TS compiler
  ไล่ให้ผ่าน exhaustive Record, ฝั่ง SQL ไล่ตามรายการงาน Han

## D2 — bar_margin_pct: setting เดียว ไม่ผูกราย SKU (จุดที่ต่างจากข้อเสนอ Tech Lead)

Tech Lead เสนอ: ใช้ `margin_pct` ของ SKU (v_dim_product) เป็นหลัก + setting เป็น fallback
**ผมเลือก: `oem_setting.bar_margin_pct` (คอลัมน์ใหม่ default 0.19) เป็นแหล่งเดียว** เหตุผล:

1. margin_pct ใน v_dim_product คำนวณจาก cost/list_price ใน catalog ซึ่ง**ล้าสมัยหนัก**
   (S-1bath: cost 1,713 สูงกว่าราคาขายจริงวันนี้ 1,455 · S-1kg.: 98,000 vs จริง 78,966) —
   อัตราส่วนวันนี้ถูกโดยบังเอิญที่เจ้าของเคยตั้งใจตั้ง แต่ใครแก้ catalog เมื่อไหร่ gate ของใบเสนอราคา
   จะเพี้ยนตามเงียบๆ — อย่าผูกความถูกต้องของ gate ไว้กับสุขภาพของ catalog
2. SKU เงินแท่งทั้ง 8 ตัว margin แทบเท่ากัน (0.1896–0.1901) — ค่าราย SKU ซื้อความละเอียด ~0.05%
   แลกกับ 2 แหล่งข้อมูล + lookup เพิ่มใน calc = YAGNI
3. ไม่รับ margin จาก client ใน input (ต่างจากงานผลิตที่ margin เป็นตัวตั้งราคาจึง self-consistent) —
   สำหรับเงินแท่ง margin ไม่กระทบราคา กระทบแต่ gate ถ้ารับจาก client = ปลอมค่าเพื่อเลี่ยง gate ได้
4. โชว์/แก้ได้ในการ์ด settings หน้า /oem เหมือน margin setting อื่น ไม่ใช่ค่าลับ (ตรงเจตนา Tech Lead)

ถ้าวันหน้าเว็บตั้ง margin ต่างกันตามขนาดจริงๆ ค่อย extend เป็นราย size — จุด extend ชัด (ฟังก์ชันเดียว)

## D3 — Contract ของ input / calc jsonb

### input (เก็บใน `oem_quote_item.input` — key snake_case ตาม `toCalcInputPayload`)

```json
{
  "metal": "silver999",
  "bar_size": "1_baht",
  "qty": 3,
  "engrave_image_thb": 100,
  "engrave_text_thb": 50,
  "as_of_date": "2026-08-25"
}
```

- `bar_size` ∈ `0_5_baht | 1_baht | 3_baht | 5_baht | 10_baht | 1_kg` → map ตรงคอลัมน์
  `bar_0_5_baht … bar_10_baht`, `1_kg` → **kilo_sell_vat** (มติข้อ 2 — ทั้งใบ VAT-inclusive)
- `engrave_*_thb` = บาท/ชิ้น optional ต้อง >= 0 ไม่งั้น raise (caller bug)
- **ไม่มี** item_kind / polish_tier / weight_g / margin_pct / plating / gem — branch silver999
  ต้องแยกออก**ก่อน**ถึง validation เดิมของ field เหล่านั้น
- `as_of_date` เป็นแค่บันทึกว่า client เห็นราคาวันไหน — **server ไม่ใช้ lookup** (กัน client ปักวันเก่า)
  server lookup วันนี้ (BKK) เสมอแล้ว snapshot ลง calc

### calc (top-level shape เดิมเป๊ะ — save 0076 กินได้แทบไม่แก้)

```json
{
  "is_complete": true,
  "missing": [],
  "breakdown": {
    "q_run": null,
    "reject_pct_total": null,
    "margin_pct_used": null,
    "metal": { "per_piece": null, "price_used": null, "price_source": "silver_price_daily" },
    "labor": { "per_piece": 0, "steps": [] },
    "batch": { "per_piece": 0, "lines": [] },
    "nre":   { "cad": null, "print3d": null, "mold": null, "cost": 0, "price": 0 },
    "bar": {
      "size": "1_baht",
      "price_column": "bar_1_baht",
      "bar_price_per_piece": 1455,
      "engrave_image_thb": 100,
      "engrave_text_thb": 50,
      "margin_pct_embedded": 0.19,
      "as_of_date": "2026-08-25",
      "sheet_time": "13:02",
      "captured_at": "2026-08-25T06:02:11+00:00",
      "source": "feed"
    },
    "cost_piece": 1300.05,
    "price_per_piece": 1605,
    "quote_total": 4815,
    "margin_actual_pct": 0.19
  },
  "floors": {
    "qty":          { "pass": true,  "moq": null, "actual": 3 },
    "job_value":    { "pass": true,  "min": 0 },
    "metal_weight": { "pass": true,  "applies": false },
    "margin":       { "state": null, "value": null, "blended": 0.19, "target": 0.30 },
    "price_fresh":  { "pass": true,  "as_of_date": "2026-08-25", "today_bkk": "2026-08-25" }
  },
  "warnings": ["ราคาเงินแท่งยืนเฉพาะวันนี้เท่านั้น"],
  "formula_version": 4
}
```

สูตรและกติกา:
- `price_per_piece = ราคาต่อขนาดจาก feed + engrave_image + engrave_text` — **ห้าม**คูณจากต่อกรัม/
  ต่อน้ำหนักบาท (bar_10 จริงถูกกว่า bar_1×10 ~6%) · **ห้าม**แตะ sell_per_baht (null เมื่อ source=feed)
- `cost_piece = price_per_piece × (1 − bar_margin_pct)` — กติกาเดียวทั้งก้อนรวม engrave
  (ไม่แยก leg — engrave เล็กมากเทียบราคาแท่ง ความเพี้ยนไม่คุ้ม branch เพิ่ม)
- **`floors.margin.value = null` (จงใจ — จุดชี้ขาด):** value คือ margin ที่"เลือกคิด"ซึ่งใบเงินแท่ง
  ไม่มีใครเลือก ถ้าใส่ 0.19 ลงไป ด่าน `v_min_margin_charged < margin_floor (0.20)` ใน save จะบังคับ
  approval note **ทุกใบเงินแท่ง** ทั้งที่ไม่มีการตัดสินใจอะไรให้ justify — margin แฝงไปโผล่ที่
  `blended` และ `margin_pct_embedded` แทน (รายงานเห็น, gate รายตัวไม่แตะ)
- ราคาวันนี้ไม่มี → `missing[] = [{"rate_key":"silver_bar_price","scope":"1_baht","question_th":"ยังไม่มีราคาเงินแท่งของวันนี้ (สคริปต์ดึง 09/13/20 น. หรือกรอกผ่าน silver_price_set)","priority":"P0"}]`
  → is_complete=false → **ด่าน is_complete เดิมของ save บล็อก quoted ให้ฟรี** — "ด่านความสด"
  จึงไม่ใช่ gate ใหม่ แต่คือ (lookup เฉพาะวันนี้ BKK) + (is_complete เดิม) · draft ยังบันทึกได้ตามเดิม
- snapshot ใน `breakdown.bar` เก็บ**เฉพาะราคาขายที่ใช้** — ห้ามมี kilo_buy/buy_per_baht เด็ดขาด
  (calc ก้อนนี้ถูก copy ลง rate_snapshot ของ header ด้วย — กันที่ producer ไม่ใช่หวังพึ่ง mapper)

## D4 — ปฏิสัมพันธ์กับ gates ใน oem_quote_save / renegotiate (0076) — ไล่ทีละด่าน

เพราะ cost_piece อนุมานมีค่าจริง รายการเงินแท่งตกลง branch `else` ของ aggregation เดิม
(price_ex += item_total, cost_ex += cost_piece×qty) **ถูกต้องเองโดยไม่แก้โค้ด** — นี่คือกำไรหลัก
ของแนว inferred-cost:

| ด่าน | พฤติกรรมกับเงินแท่ง | 0078 ต้องแก้? |
|---|---|---|
| ex_gold aggregation | เข้า branch else ด้วย cost จริง → margin รวมไม่พองปลอม | ❌ ไม่แก้ |
| C1 discount guard (`discount >= price_ex_sum`) | ใบแท่งล้วน price_ex_sum = มูลค่าแท่งเต็ม → ส่วนลดปกติผ่านตามมติใหม่ | ❌ ไม่แก้ |
| hard floor aggregate (null=ตก) | ใบแท่งล้วนไม่ลด: margin_after ≈ 0.19 ≥ 0.15 ผ่าน · ส่วนลดกินทะลุจน margin < 15% → โดนปฏิเสธเอง = การคุ้มครองที่ได้ฟรี | ❌ ไม่แก้ |
| margin hard floor รายตัว | value=null → ข้ามเอง (โค้ดเช็ค is not null อยู่แล้ว) | ❌ ไม่แก้ |
| **note tier (floor 20%)** | **phantom note:** margin แฝง 0.19 < floor 0.20 → ใบแท่งล้วนแม้ไม่ลดสักบาทก็โดนบังคับใส่เหตุผล | ✅ เปลี่ยนเงื่อนไข clause ฝั่ง aggregate เป็น `(p_discount_thb > 0 and v_margin_after_discount < margin_floor_pct)` |
| job value min | grand_total รวมมูลค่าแท่ง → งานผลิตจิ๋วอาศัยแท่งพยุงผ่าน min ได้ / ใบแท่งล้วน 1 แท่ง 746 บ. ชน min 5,000 | ✅ gate เฉพาะส่วนงานผลิต (ดูล่าง) |
| valid_days | else → silver 30 วัน = แท่งยืนราคา 30 วัน ❌ | ✅ `when 'silver999' then 0` (least() เดิมดึงทั้งใบเหลือวันนี้เอง = มติข้อ 1) |
| timezone | current_date = UTC เหลื่อมวันก่อน 07:00 ไทย | ✅ 4 จุด (ดูล่าง) |

**ทำไมเติม `p_discount_thb > 0` แล้วไม่เสียการคุ้มครองใบงานผลิต:** ใบงานผลิตล้วนที่ item ไหน
margin < floor จะโดน clause แรก (`v_min_margin_charged < floor`) บังคับ note อยู่แล้วโดยไม่เกี่ยว
ส่วนลด — และถ้าทุก item ≥ floor แล้ว blended ex-gold ต่ำกว่า floor ที่ discount=0 เป็นไปไม่ได้
(weighted avg ของ margin ที่ ≥ floor ทุกตัว ย่อม ≥ floor) — เคสเดียวที่ clause aggregate ยิงตอน
discount=0 คือ margin แฝงของแท่งดึงลง = phantom พอดี · hard floor aggregate คงไว้ไม่มีเงื่อนไข
(แนวรับสุดท้ายต้องไม่มี if) · **renegotiate ใช้เงื่อนไขเดียวกัน** (`p_new_discount_thb > 0 and ...`)

**job value min:** นับ `v_production_total = Σ item_total ของ item ที่ metal <> 'silver999'
+ v_nre_price_sum` — ถ้า > 0 ให้ gate `v_production_total >= v_jobvalue_min` (ก่อนหักส่วนลด —
ส่วนลดเป็นเลขระดับใบ แบ่งส่วนให้งานผลิตไม่ได้โดยไม่มั่ว; จุดประสงค์ของด่านคือ "ขนาดงานผลิตขั้นต่ำ"
ไม่ใช่ยอดเก็บเงิน และ margin หลังส่วนลดมีด่านของตัวเองคุมแล้ว) — ถ้า = 0 (ใบแท่งล้วน) ข้ามด่านนี้
· **ใบงานผลิตล้วนพฤติกรรมเดิมเป๊ะ** (gate v_grand_total ตามเดิม) — branch เฉพาะเมื่อมี item แท่ง
· renegotiate: คิด production sum จาก loop items จริง — **ห้าม**ใช้ v_old.quote_total (รวมแท่ง)

**timezone 4 จุด** ใช้ `(now() at time zone 'Asia/Bangkok')::date`:
1. lookup ราคาใน oem_price_calc (นิยาม "วันนี้")
2. `quote_valid_until = bkk_today + v_valid_days` ใน save
3. เช็คหมดอายุใน renegotiate (`quote_valid_until < bkk_today`)
4. `quote_valid_until` ของใบใหม่ใน renegotiate
ถ้าพลาดจุดใดจุดหนึ่ง จะมีหน้าต่าง 00:00–07:00 ไทยของวันถัดไปที่ใบแท่ง "ยังไม่หมดอายุ" และ
ต่อราคาด้วยราคาเมื่อวานได้

**renegotiate ใบมีเงินแท่ง (โจทย์ข้อ 5):** logic เดิม + timezone fix ให้ผลตามมติเอง —
valid_until = วันออกใบ (BKK) → ต่อราคาวันเดียวกัน: ไม่หมดอายุ, copy verbatim, ราคา snapshot
ยังคือราคาวันนี้ → ถูกต้อง · ข้ามวัน: ด่านหมดอายุเดิม raise → ออกใบใหม่ (recompute ราคาใหม่)
**ไม่ต้องเพิ่มด่านใหม่** — timezone fix เป็นเงื่อนไขจำเป็นของข้อสรุปนี้ · loop aggregate ของ
renegotiate อ่าน cost_piece จากแถวจริง (แท่งมี cost แล้ว) → branch else เดิมถูกต้องเอง

## D5 — oem_quote_item: **ไม่เพิ่มคอลัมน์**

bar_size + engrave อยู่ใน input · ราคา/margin แฝง snapshot อยู่ใน calc.breakdown.bar —
reprint เที่ยงตรงด้วยกลไก snapshot เดิมของ v2 · `margin_charged_pct` null โดยไม่ต้องแก้ schema
(nullable ตั้งแต่ 0075) · ไม่แตะ v_oem_quote_item (`i.*` — เพิ่มคอลัมน์ตารางจะเปลี่ยน shape view
โดยไม่ตั้งใจ) · query "ขนาดไหนขายดี" ใช้ `input->>'bar_size'` ได้ — YAGNI คอลัมน์จริง

**v_oem_quote:** append ท้ายเท่านั้น (42P16): `is_expired_th`, `days_left_th` (เทียบ BKK date) —
UI เปลี่ยนไปอ่านคู่นี้ทุกใบ (ถูกกว่าเดิมสำหรับใบงานผลิตด้วย) · is_expired/days_left เดิมคงไว้
· **ลอกคอลัมน์จากฉบับ 0077 (ล่าสุด) ไม่ใช่ 0075**

**oem_setting:** เพิ่มคอลัมน์ `bar_margin_pct numeric default 0.19`
(check `> 0 and < 1`) + เพิ่มใน fallback seed block ของทั้ง save/renegotiate/oem_price_calc

## D6 — หน้า print (PrintableQuote)

เพิ่มใน PrintableQuoteItem: `barSizeLabel: string | null` ("เงินแท่ง 99.99% ขนาด 1 บาท"),
`engraveImageThb`, `engraveTextThb` (บรรทัดค่ายิงเลเซอร์แยกใต้รายการ — ลูกค้าจ่ายจริง โชว์ได้) ·
item แท่งไม่มี weightG → โชว์ขนาดเป็น label ไม่ใช่เลขกรัม
เพิ่มใน PrintableQuote: `silverPriceAsOf` + `silverPriceCapturedAt` (มีค่าเมื่อใบมี item แท่ง —
"อ้างอิงราคาเงินแท่ง ณ 25 ส.ค. 2569 13:02 น. · ใบเสนอราคานี้ยืนราคาเฉพาะวันดังกล่าว")
**ห้ามเด็ดขาด:** kilo_buy / buy_per_baht / margin_pct_embedded / cost ใดๆ — และต้อง map
field-by-field ใน toPrintableQuote เท่านั้น (security boundary เดิม ห้าม spread)

---

## งานของ Han (backend — migration `0078_oem_bar_quote.sql` ไฟล์เดียว + lib/actions)

1. **ก่อนเริ่ม:** ยืนยัน 0072/0074 (branch feature/silver-price-daily) apply บน DB จริงแล้ว และ
   merge เข้า branch นี้ก่อน 0078 — ตอนนี้ไฟล์ไม่อยู่ใน working tree ของ feature/oem-quote-v2 ·
   ยืนยัน shop_id ใน silver_price_daily ตรงกับ shop_id ที่ออกใบ OEM
2. `alter table analytics.oem_setting add column if not exists bar_margin_pct numeric default 0.19`
   + check constraint + comment อธิบายว่าเป็น margin แฝงในราคาเว็บ ใช้อนุมานต้นทุน ไม่ใช่ตัวตั้งราคา
3. `create or replace analytics.oem_price_calc(uuid, jsonb)` — **signature (uuid, jsonb) เดิมเป๊ะ
   = replace แท้ ไม่ overload** — เพิ่ม branch silver999 บนสุดก่อน validation งานผลิต:
   validate bar_size/qty/engrave>=0 → lookup silver_price_daily ด้วย
   `shop_id = p_shop_id and as_of_date = (now() at time zone 'Asia/Bangkok')::date` (strict `=`)
   → คืน shape ตาม D3 (cost_piece อนุมาน, floors.margin.value = null) · formula_version = 4 ·
   **branch งานผลิตเดิมห้ามแตะแม้แต่บรรทัดเดียว**
4. `create or replace analytics.oem_quote_save(...)` — **arg list เดิม 9 ตัวเป๊ะ** — แก้ตาม D4:
   note-tier clause aggregate เติม `p_discount_thb > 0` / job value production-only branch /
   valid_days `when 'silver999' then 0` / bkk date ใน quote_valid_until · **ห้ามแตะ ex_gold
   aggregation** (branch else ถูกต้องเองแล้ว) · จบด้วย revoke/grant ซ้ำ (CREATE OR REPLACE
   ไม่รักษา grant — บทเรียน 0076 §5)
5. `create or replace analytics.oem_quote_renegotiate(...)` — arg list เดิม 4 ตัว — ชุดเดียวกัน
   (production sum จาก loop items จริง, bkk date เช็คหมดอายุ + valid_until ใหม่,
   note-tier เติม `p_new_discount_thb > 0`) + revoke/grant ซ้ำ
6. `create or replace view analytics.v_oem_quote` — คอลัมน์เดิมทุกตัวลำดับเดิมเป๊ะจากฉบับ 0077
   + append `is_expired_th`, `days_left_th` ท้ายสุด
7. `lib/actions/oem.ts`: `toCalcInputPayload` branch silver999 (ส่งเฉพาะ key ใน D3) ·
   `fromCalcResult` อ่าน breakdown.bar + floors.price_fresh แบบ defensive (undefined ได้ในใบเก่า) ·
   settings action รับ/ส่ง barMarginPct
8. ทดสอบกับข้อมูลจริงก่อนบอกเสร็จ:
   (a) ใบแท่งล้วน ไม่ลด → quoted ผ่าน **โดยไม่ถูกบังคับใส่ note**
   (b) ใบแท่งล้วน + ส่วนลดพอประมาณ (margin หลังลดยัง ≥ 20%... จริงๆ ≥ 15% แต่ < 20% ต้องมี note) → ตรวจทั้งสองช่วง
   (c) ใบแท่งล้วน + ส่วนลดกินทะลุจน margin < 15% → โดนปฏิเสธ
   (d) แท่ง 0.5 บาท 1 แท่ง (746 บ.) → ผ่าน ไม่ชน min 5,000
   (e) ผสม: งานผลิต 3,000 + แท่ง 30,000 → **ตก** job value
   (f) ลบแถวราคาวันนี้ → quoted โดน block ด้วยข้อความ missing ราคา, draft บันทึกได้
   (g) renegotiate ใบแท่งวันเดียวกันผ่าน / mock ข้ามวัน (BKK) ตก
   (h) ใบงานผลิตล้วน → พฤติกรรมเดิมทุกด่านไม่เปลี่ยน (regression)

## งานของ Luke (frontend)

1. `lib/oem/types.ts`: OemMetal + 'silver999' · OEM_METAL_LABEL_TH.silver999 = "เงินแท่ง 99.99%" ·
   type OemBarSize + OEM_BAR_SIZE_LABEL_TH (0.5/1/3/5/10 บาท / 1 กก.) · OemPriceCalcInput เพิ่ม
   barSize?/engraveImageThb?/engraveTextThb? · OemPriceBreakdown เพิ่ม bar?: {...} | null ·
   OemFloors เพิ่ม priceFresh? · OemSettingData เพิ่ม barMarginPct
2. `lib/oem/quoteForm.ts`: JobForm เพิ่ม barSize/engraveImageThb/engraveTextThb (string) ·
   buildJobInput branch silver999 (validate แค่ barSize+qty; engrave ว่าง = null, ติดลบ = invalid) ·
   aggregateQuotePreview **ไม่ต้อง branch พิเศษ** — calc ของแท่งมี costPiece จริง สูตร else เดิม
   ถูกต้องเอง (mirror D4) · min margin ไม่รับผลจากแท่ง (floors.margin.value null อยู่แล้ว)
3. `QuoteJobItemCard`: เลือก "เงินแท่ง 99.99%" → ซ่อน ขัด/พลอย/ชุบ/NRE/margin/weight/itemKind
   ทั้งยวง เหลือ ขนาด + จำนวน + ช่องเลเซอร์ 2 ช่อง (optional บาท/ชิ้น) · โชว์ราคา ณ วันนี้ + เวลา
   จาก breakdown.bar และสถานะ "ราคาวันนี้ยังไม่เข้า" จาก missing
4. SKU auto-switch (mapping ฝั่ง frontend): S-0.5bath→0_5_baht · S-1bath→1_baht · S-3bath→3_baht ·
   S-5bath→5_baht · S-10bath→10_baht · S-1kg.→1_kg · WA-1B→1_baht (มติข้อ 3) ·
   Silver999-1-Baht และ Silver999-1Baht→1_baht · **S-1A ไม่ auto** (ขนาดไม่ชัด ให้เลือกเอง)
5. `QuoteResultPanel`: ช่องส่วนลดใช้ได้ทุกใบตามเดิม (มติใหม่ — ไม่มี disable พิเศษ) · ใบมีแท่ง →
   banner "ยืนราคาถึงวันนี้เท่านั้น"
6. settings card หน้า /oem: เพิ่มช่อง bar_margin_pct (โชว์เป็น % พร้อมคำอธิบาย "margin แฝงใน
   ราคาเว็บ ใช้อนุมานต้นทุนเงินแท่ง")
7. `printableQuote.ts` + `PrintQuoteClient`: ตาม D6 (field-by-field เท่านั้น)
8. หน้า list/detail อ่าน is_expired_th/days_left_th แทนคู่เดิม
9. `npm run typecheck` ผ่านก่อนส่ง QA

## จุดเสี่ยงที่คนต่อไปจะพลาด

1. **ห้ามดึง cost/list_price จาก catalog มาคิดราคาหรือต้นทุนเงินแท่งเด็ดขาด** — ตัวเลขล้าสมัยหนัก
   (S-1bath: catalog cost 1,713 **สูงกว่า** ราคาขายจริงวันนี้ 1,455 · S-1kg.: 98,000 vs 78,966)
   ราคาต้องมาจาก silver_price_daily เท่านั้น ต้นทุนต้องอนุมานจาก bar_margin_pct เท่านั้น —
   margin_pct ใน catalog เชื่อได้เฉพาะในฐานะ "อัตราส่วนที่เจ้าของตั้งใจ" และ design นี้ก็จงใจ
   ไม่ผูก runtime กับมัน (ดู D2)
2. **floors.margin.value ของแท่งต้องเป็น null ไม่ใช่ 0.19** — ใส่ค่าเมื่อไหร่ ด่าน
   min_margin_charged < floor 20% จะบังคับ approval note ทุกใบเงินแท่ง (phantom note ทาง clause แรก)
   — margin แฝงอยู่ที่ blended/margin_pct_embedded เท่านั้น
3. **อย่าลืมเติม `p_discount_thb > 0` ที่ note-tier clause ฝั่ง aggregate** — ไม่งั้น phantom note
   กลับมาทาง clause ที่สอง (0.19 < 0.20 แม้ไม่ลดสักบาท) · แต่ hard floor aggregate ต้องคง
   ไม่มีเงื่อนไข — มันคือแนวรับสุดท้าย
4. **renegotiate ห้ามใช้ v_old.quote_total คิด job value** — รวมมูลค่าแท่ง ต้อง sum production
   จาก items จริง
5. **replace ฟังก์ชันต้อง arg list เดิมเป๊ะ + revoke/grant ซ้ำท้ายไฟล์** — เปลี่ยน arg = overload
   (ทีมเจอมา 2 รอบ) และ CREATE OR REPLACE ไม่รักษา grant
6. **อย่า "ปรับปรุง" 1 กก. เป็น kilo_sell** — มติคือ kilo_sell_vat (ใบ VAT-inclusive) ·
   อย่าคิดราคาแท่งจาก sell_per_baht (null เมื่อ feed) หรือคูณข้ามขนาด (ราคาไม่ linear ต่าง ~6%)
7. **timezone ครบ 4 จุดหรือ renegotiate รั่ว** — จุดไหนยังเป็น current_date (UTC) จะเกิดหน้าต่าง
   00:00–07:00 ไทยที่ใบแท่งเมื่อวานยังต่อราคาได้
8. **buy price ห้ามเข้า calc ตั้งแต่ต้นทาง** — breakdown.bar ห้ามมี kilo_buy/buy_per_baht เพราะ
   calc ถูก copy ลง rate_snapshot ของ header และเป็นก้อนที่คนชอบ map ต่อ · หน้า print ห้ามมี
   margin_pct_embedded/cost ด้วย
9. **สคริปต์ดึงราคาพังเงียบ = ออก quoted ไม่ได้ทั้งวัน — by design** (ดีกว่าออกราคาเก่า) ทางหนีไฟคือ
   กรอก manual ผ่าน silver_price_set (source='manual') ซึ่ง grant เฉพาะ service_role → ต้องทำเป็น
   server action ฝั่งแอป ไม่ใช่เปิด grant ให้ authenticated
10. **ถ้าเจ้าของตั้ง bar_margin_pct < 0.15 (hard floor)** ใบแท่งทุกใบจะโดน hard floor aggregate
    ปฏิเสธ — นั่นคือสัญญาณจริงว่านโยบายราคาเว็บกับ floor ของร้านขัดกัน ไม่ใช่ bug ห้ามไปหรี่ gate
11. **migration 0072/0074 อยู่คนละ branch** — 0078 อ้าง silver_price_daily ถ้า merge ลำดับผิด
    รันบน fresh DB ไม่ผ่าน
