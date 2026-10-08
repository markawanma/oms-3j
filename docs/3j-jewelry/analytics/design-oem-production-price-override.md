# Design — งานผลิตพิมพ์ราคาต่อชิ้นทับเอง + แก้ตาม security 0168 (0169)

> 9 ต.ค. 69 · backend-dev (Han Solo) · 🔴 โหมดเร่งด่วน: เจ้าของรับความเสี่ยงข้าม security/QA/review ก่อน merge → security ตรวจย้อนหลัง
> ห้ามเขียนตัวเลขราคา/ทุนจริงลงไฟล์นี้ (memory `oem-pricing`) · แบบอย่าง: `design-oem-bar-price-override.md` (0163) · `design-oem-product-item.md` (0166-0168)

## 1. มติเจ้าของ (9 ต.ค. 69)
ระบบยังคิด **ทุน** จากสูตรงานผลิต (`oem_cost_calc`: น้ำหนัก/ค่าแรง/พลอย/ชุบ) เหมือนเดิม แต่ผู้ใช้ **พิมพ์ราคาต่อชิ้นทับ** แทนราคาที่ได้จาก margin %
| เรื่อง | มติ |
|---|---|
| ต่ำกว่า margin floor | **ได้เมื่อใส่เหตุผล** (ด่านอ่อน แบบ 0168 — approval_note) |
| ต่ำกว่าทุนต่อชิ้น | **ห้ามเสมอ** ไม่มีปุ่มปลด ไม่ปลดด้วยเหตุผล · ข้อความ error ไม่ใส่ตัวเลขทุน |
| วัสดุ | silver / gold / brass เท่านั้น (เงินแท่งมีราคาพิเศษของตัวเอง 0163 · สินค้ากรอกราคาต่อชิ้นอยู่แล้ว) |
| NRE | คงคิดจาก margin % เดิม (override ทับเฉพาะราคาต่อชิ้น) |
| หน้าพิมพ์ | `pricePerPiece` = ราคาที่พิมพ์ · ราคาจากสูตร/เหตุผล/ทุนห้ามหลุด · ห้ามเพิ่ม field ใน `PrintableQuote` |

## 2. Contract
**input** (`oem_price_calc`, metal silver/gold/brass): `unit_price_override_thb` (optional · `not (>0 and <=1,000,000)` → 22023 ฆ่า NaN/Infinity · ทศนิยม > 2 → 22023) +
`price_override_reason` (บังคับเมื่อมีราคา · ผ่าน whitelist `oem_note_present` · ≤ 200 · เหตุผลลอยไม่มีราคา → 22023 แบบ 0163) · ส่งบนเงินแท่ง/สินค้า → 22023 · ค่า null/ว่าง = ไม่ส่ง

**output** (emit เฉพาะเมื่อมี override ⇒ ไม่มี override ได้ jsonb เดิมทุก byte — golden replay strict):
- `price_per_piece` = ราคาที่พิมพ์ · `quote_total` = NRE (เดิม) + ปัดสองตำแหน่ง(จำนวน x ราคาที่พิมพ์) · `margin_actual_pct` คิดจากราคาที่พิมพ์ · `cost_piece` เท่าสูตร
- `breakdown.production_override` = {thb, reason, formula_price_per_piece} (admin เท่านั้น)
- `floors.margin.value/state` = margin **ของราคาที่พิมพ์**: เงิน/ทองเหลือง = 1 − ทุนต่อชิ้น/ราคา · ทอง (pass-through) = 1 − (แรง+batch)/(ราคา − เนื้อทอง) —
  ความหมายเดียวกับ margin % ในสูตรเดิม (ราคา = เนื้อทอง + (แรง+batch)/(1−margin)) ⇒ override เท่าราคาสูตร ได้ margin ≈ margin % ที่ใช้คิด (verify O1c/O1d)
- `floors.price_vs_cost = {applies:true, pass: ราคาที่พิมพ์ >= cost_piece}` · pass=false ⇒ state = hard_floor_breach · ต่ำกว่า floor แต่ไม่ต่ำกว่าทุน ⇒ needs_approval_note

## 3. ด่านใน `oem_quote_save` (quoted)
| ด่าน | รายการที่ราคามาจากสูตร | รายการที่มี override |
|---|---|---|
| ต่ำกว่าทุนต่อชิ้น | — | **ปฏิเสธเสมอ** (22023 "ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น ออกใบไม่ได้") |
| margin < hard floor รายชิ้น | **แข็ง** (ห้ามผ่อน — invariant ข้อ 6) | ไม่ใช้ (ผ่อน) |
| margin < floor | ต้อง approval_note (note-tier เดิม) | ต้อง approval_note (gate `override_below_floor`) |
| ด่านรวมทั้งใบ (blended < 0 · hard floor หลังส่วนลด · min_job_value · F1/F2 · MOQ/ล็อต) | เดิม | เดิม — ไม่แตะ |
renegotiate: ไม่คำนวณ margin รายชิ้นใหม่ (คัดลอก item) ⇒ ไม่มีด่านใหม่ — ใบ quoted ที่ราคาต่ำกว่าทุนเกิดไม่ได้อยู่แล้ว

## 4. แก้ตาม security ตรวจย้อนหลัง 0168 (รวมใน 0169)
| ข้อ | ที่ทำ |
|---|---|
| M1+L1 | `analytics.oem_note_present(text)` = whitelist `oem_text_strip_invisible(x) ~ '[[:alnum:]]'` (ไทย/ละติน/เลข ผ่าน · NEL/C0/U+2800/VS16/tag/"."/"👍" ล้วน ไม่ผ่าน) แทน btrim/blacklist ทุกจุด: MOQ · note-tier · F2 · approved_by · เหตุผลราคาที่พิมพ์ · renegotiate (note-tier + F2) · ฝั่ง JS `oemNotePresent` (`[\p{L}\p{N}]`) ใน QuoteResultPanel / RenegotiateDialog / server action |
| L2 | `analytics.oem_note_valid(text)`: approval_note / เหตุผลต่อราคา ห้ามมี control char (ยกเว้น tab/LF/CR) / bidi / ล่องหน และยาว > 500 → 22023 (ZWJ ในอีโมจิผ่านตาม helper 0165) · ตรวจแม้ใบนั้นไม่ต้องใช้ note |
| M2 | คอลัมน์ `analytics.oem_quote.approval_gates text[]` (moq · metal_lot · margin_note_tier · manual_cost · override_below_floor) คำนวณฝั่ง server เก็บเฉพาะใบ quoted · **ไม่อยู่ใน rate_snapshot / v_oem_quote / PrintableQuote** · UI สรุปแสดงเหตุผล **ทุกข้อ** ที่ติด · หน้ารายละเอียดแสดงด่านที่ note ครอบ |
| L3 | renegotiate คัดลอก approval_note / approved_by / approval_gates ไปใบลูก (+ ด่านอ่อนที่ใช้ตอนต่อราคา: note-tier ของส่วนลดใหม่, ทุน manual) |
| Info | ป้ายหน้ารายละเอียด "เหตุผลที่ต่ำกว่า floor:" → "เหตุผลอนุมัติ:" |

## 5. เคสที่ห้ามผ่าน → ด่าน (ล็อกใน verify-0169)
| เคส | ตกที่ |
|---|---|
| override < ทุน (quoted · ใบผสม · มี note ก็ไม่ผ่าน) | save 22023 (S1a-d) |
| override ต่ำกว่า floor ไม่มี note | save 22023 (S2a S2d) |
| override ไม่มีเหตุผล / ล่องหนล้วน / "." / 👍 / U+2800 / VS16 / tag / ลอย | calc 22023 (O2c-e) |
| override บนเงินแท่ง/สินค้า · NaN/Inf/ทศนิยม>2/≤0/>1,000,000 | calc 22023 (O2a O2f) |
| note เป็น NEL/C0/U+2800/VS16/tag/"."/"👍"/"!!!" ล้วน ทุกด่านอ่อน (MOQ · note-tier · F2 · override) | save/renegotiate 22023 (N1a-d R2a) |
| note มี bidi/control/ยาว > 500 | save/renegotiate 22023 (L2a R2b) |
| role อื่นยิง helper/RPC | 42501 (A1 Z3) |
ต้องไม่พัง: override สูงกว่า/เท่าราคาสูตรไม่ต้อง note · ต่ำกว่า floor มี note ผ่าน + gates มี override_below_floor · งานผลิตไม่มี override ต่ำกว่า floor ยังแข็ง (S4a-c) ·
note ไทย/อังกฤษ/ตัวเลข/อีโมจิ ZWJ ผ่าน · golden replay (3,698 เคส) · ใบแท่ง/สินค้า/MOQ เดิม · renegotiate คัดลอก note/gates (R1 R2c) · verify-0163/0165/0166/0167/0168 ยังผ่าน

## 6. หนี้ / ข้อจำกัด
- D1 ข้าม security/QA/review ก่อน merge (โหมดเร่งด่วน) — ตรวจย้อนหลัง · UI ยังไม่ได้ QA ด้วยตา (typecheck + unit test เท่านั้น)
- `[[:alnum:]]` ขึ้นกับ locale ของ DB (en_US.UTF-8 จับไทย) — ถ้า locale เปลี่ยนเป็น C ตัวไทยจะไม่ผ่าน: verify-0169 N0b จับ · ฝั่ง JS ใช้ \p{L}\p{N} คลาดเล็กน้อยกับ POSIX (เครื่องหมายผสม) เป็น pre-check เท่านั้น
- `approval_gates` ของ renegotiate = ด่านของใบแม่ ∪ ด่านที่ใช้ตอนต่อราคา (ด่านระดับรายการ moq/metal_lot/override_below_floor ไม่คำนวณใหม่เพราะ item คัดลอกเท่าเดิม) · ใบเก่าก่อน 0169 = null
- ใบแท่ง + งานผลิต (ไม่มีสินค้า): ด่าน min_job_value ดูยอดงานผลิตก่อนหักส่วนลด (มาตั้งแต่ 0079 — หนี้ D2 ของ 0167 ยังไม่แก้)
- ด่าน override ต่ำกว่า floor ใช้ margin_floor_pct (20%) เป็นเกณฑ์เดียว — hard floor รายชิ้น (15%) ไม่ใช้กับ override ตามมติ "ต่ำกว่าทุนเท่านั้นที่แข็ง"
- override ใช้ `formula_version` 3 เดิม (key ใหม่เป็น additive) · NRE ของรายการ override ยังคิดจาก margin % เดิม — ผู้ใช้ที่ลดราคาต่อชิ้นมากไม่ได้ลด NRE ตาม
