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
| NRE | ~~คงคิดจาก margin % เดิม~~ → **แก้โดย 0170 (มติ 9 ต.ค. เพิ่มเติม): ตาม margin ของราคาที่พิมพ์ ขึ้น-ลงตามราคา** (§7) |
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
- override ใช้ `formula_version` 3 เดิม (key ใหม่เป็น additive) · NRE ของรายการ override ตามราคาที่พิมพ์ตั้งแต่ 0170 (§7)

## 7. มติเจ้าของ 9 ต.ค. 69 (เพิ่มเติม) — ค่า NRE ตาม margin ของราคาที่พิมพ์ (migration 0170)
**ค่า NRE (CAD / ปริ้น 3D / ก้อนยาง) ของรายการงานผลิตที่พิมพ์ราคาต่อชิ้นทับ ใช้ margin เดียวกับราคาที่พิมพ์ — ตามทั้งขึ้นและลง** (0169 คง NRE ไว้ที่ margin % ในช่อง ⇒ ลดราคาต่อชิ้นแล้วค่าออกแบบยังบวก margin เต็ม)
| เรื่อง | ที่ทำ (`oem_price_calc` เท่านั้น · save/renegotiate ไม่ต้องแก้) |
|---|---|
| สูตร | margin ที่ใช้ = `v_m_eff` ของ 0169 (เงิน/ทองเหลือง 1 − ทุน/ราคา · ทอง 1 − (แรง+batch)/(ราคา − เนื้อทอง)) → `nre_price = max( round(nre_cost / (1 − margin), 2), ceil(nre_cost สองตำแหน่ง) )` ⇒ **ไม่ต่ำกว่าทุน NRE เสมอ** |
| ขอบล่าง | margin <= 0 / NULL / NaN (ราคาที่พิมพ์ <= ทุน — ถูกปฏิเสธตอน quoted อยู่แล้ว แต่ draft/preview เกิดได้) ⇒ `nre_price` = ทุน NRE + warning |
| ขอบบน | margin > 0.95 ⇒ clamp ที่ 0.95 + warning "เพดาน" (กัน 1/(1−m) ระเบิด; margin % ในช่องปกติรับได้ถึง < 1 แต่ NRE ของ override จำกัดที่ 95% = ตัดสินใจเอง ดูหนี้) |
| snapshot | `breakdown.production_override.nre_margin_used` (เฉพาะเมื่อมี override · null เมื่อไม่มี NRE) · `breakdown.nre.price` = ค่าที่คิดใหม่ · ไม่มี override ⇒ jsonb เดิมทุก byte |
| gate | ด่านที่ใช้ nre_price อ่านจาก calc รายการอยู่แล้ว: min_job_value (ยอดงานผลิตรวม NRE) · grand_total — ใช้ค่าใหม่ถูกต้อง (verify-0170 S1 S2 M1) · margin รวม/hard floor ไม่นับ NRE (item_total ตัด NRE ออก) · renegotiate คัดลอก NRE เท่าเดิม (R1) |
| UI / พิมพ์ | `OemCalcBreakdown` โชว์ "ค่าออกแบบ (NRE) คิดตาม margin ของราคาที่พิมพ์ (X%)" (ไม่มีคำนวณใน client) · บนใบลูกค้าเห็นแค่ค่า NRE ที่คิดแล้ว (nrePrice) — ทุน NRE / margin ที่ใช้ไม่หลุด (test ล็อก) |
**หนี้ / ข้อจำกัด**: เพดาน 0.95 ของ NRE เป็นค่าที่ผมเลือกเอง (ระบบรับ margin % ช่องปกติถึง < 1) · golden replay แถวที่มี override ต่างจาก 0169 เฉพาะ NRE + invariants (ตรวจทุกเคส ไม่ใช่ jsonb เท่ากันเป๊ะ) ·
ใบ quoted เดิมที่มี override ก่อน 0170 (ถ้ามี) เก็บ NRE ตาม margin % เดิมไว้ใน snapshot — ไม่ถูกคำนวณย้อนหลัง (เอกสารที่ออกแล้วห้ามแก้) · ใบที่ผ่านด่าน min_job_value ตอนออกใบไม่ถูกตรวจซ้ำ

## 8. แก้ตาม security ตรวจย้อนหลัง 0169/0170 + มติเจ้าของ 9 ต.ค. 69 (migration 0171)
**แก้ที่ `oem_price_calc` / `oem_quote_save` / `oem_quote_renegotiate` / `oem_text_strip_invisible` เท่านั้น — `oem_cost_calc` ไม่ถูกแตะ (ใบผลิต production order ยังส่ง `as_of_date` + `metal_price_thb_per_gram` ได้ตามเดิม)**

| ข้อ | ปัญหา | ที่ทำ | ทดสอบ (verify-0171) |
|---|---|---|---|
| H1 (High) | `as_of_date` จาก client ไหลถึง `oem_cost_calc` ⇒ เลือกวันเก่าที่ราคาโลหะถูกกว่าได้ ต้นทุนใบเสนอราคาต่ำเกินจริง | `oem_price_calc` ปฏิเสธ `as_of_date` ที่ไม่ใช่วันนี้ (เวลาไทย) = 22023 · ไม่ส่ง/ว่าง = วันนี้ · เรียก `oem_cost_calc` ด้วย `as_of_date` = วันนี้ (BKK) เสมอ (ไม่ใช้ `current_date` ที่เป็น UTC) · `lib/actions/oem.ts` ไม่ส่ง `as_of_date` ของงานผลิตขึ้นไปแล้ว | H1a-g (อดีต/อนาคต/2099/ขยะ/วันนี้/ไม่ส่ง · ต้นทุน = วันนี้ · `oem_cost_calc` ตรงๆ ยังย้อนวันได้) |
| M1 | `metal_price_thb_per_gram` ผ่านเส้นทางใบเสนอราคา | 22023 "ใบเสนอราคาห้ามส่งราคาโลหะเอง" | M1 |
| M2 (มติ: คงเดิม) | ราคาพิมพ์ต่ำกว่า hard floor ยังออกใบได้ (มี note) · ขายเท่าทุนได้ · ต่ำกว่าทุนห้าม | เพิ่มด่านอ่อนแยก `override_below_hard_floor` ใน `approval_gates` (save + renegotiate สืบทอด) · ป้ายใน `OEM_APPROVAL_GATE_LABEL_TH` · แก้ skill ข้อ 6: hard floor รายชิ้นแข็งเฉพาะรายการที่ราคามาจากสูตร | M2a-f |
| M3 | renegotiate ใบที่มีงานผลิตพิมพ์ราคาทับ ยืด `quote_valid_until` เกินใบแม่ได้ ⇒ ราคาที่อนุมัติบนราคาโลหะของวันหนึ่ง ถูกยืนต่อโดยไม่มีใครดูทุนใหม่ | ใบลูกที่มี override: ใบแม่ `quoted` ⇒ ไม่เกินวันยืนราคาของใบแม่ · ใบแม่ `won`/หมดอายุ ⇒ ไม่เกิน max(วันยืนราคาใบแม่, วันนี้) (ไม่ให้ใบลูกเกิดมาหมดอายุแล้ว แต่ก็ไม่ได้อายุใหม่เต็ม) · ใบที่ไม่มี override ไม่เปลี่ยน | M3a-c |
| L1 | `price_override_reason` ไม่ผ่านรูปร่างเดียวกับ note อื่น | ผ่าน `oem_note_valid` ใน `oem_price_calc` (ก่อนเช็ค present) · `p_discount_reason` ใน `oem_quote_save` ผ่าน `oem_note_valid` เช่นกัน · server action ตรวจ `discountReason` ก่อนถึง RPC | L1 L1b DR |
| L2 | ชุดอักขระล่องหนยังไม่ครบ | เพิ่ม U+180B-180F · U+FFF9-FFFB · U+1D173-1D17A · Tag block U+E0000-E007F ทั้งช่วง ทั้ง DB (`oem_text_strip_invisible`) และ JS (`OEM_INVISIBLE_RE`) | L2a-f + display-customer-text.test.ts |
| L3 (มติ: เพดาน 3 เท่า) | พิมพ์เลขเกินหลายหลัก (เช่น พิมพ์ซ้ำ) ผ่านได้ถึง 1,000,000 | ราคาที่พิมพ์ > 3 × ราคาจากสูตร = 22023 "ตรวจว่าพิมพ์เลขเกินหรือไม่" · เท่ากับ 3 เท่าเป๊ะผ่าน · UI บอกเพดานในการ์ด และแสดงข้อความจาก DB ผ่าน `calcError` (ฟอร์มไม่รู้ราคาสูตรก่อนคำนวณ จึงไม่คิดเลขเอง) | L3a |
| L4 | `QuoteDetailClient` ซ่อนด่านที่ครอบถ้าไม่มี `approval_note` | แสดงด่านแยกจากเหตุผลอนุมัติ · ใบลูกจากการเจรจาที่มีด่าน แสดง `discount_reason` ต่อท้ายด่าน | (UI — QA ด้วยตา) |

**เงินแท่ง / สินค้า**: ไม่มีช่องทางเดียวกัน — เงินแท่งหา "วันนี้" เองจาก server (ไม่อ่าน `as_of_date` ของ client · ค่าที่ส่งมาถูกเมิน) · สินค้าไม่มีราคาโลหะ

**Golden replay**: ไม่ส่ง `as_of_date` / ส่ง = วันนี้ ⇒ เท่า `oem_price_calc` ฉบับ 0170 เป๊ะทั้ง jsonb (3,779 เคส) ยกเว้น 4 กติกาใหม่ที่ตั้งใจ (as_of_date ไม่ใช่วันนี้ · metal_price · เพดาน 3 เท่า · รูปร่างเหตุผล) ซึ่งตรวจแยกว่าต้องถูกปฏิเสธจริง

**หนี้ / ข้อจำกัด**
- renegotiate `created_by = coalesce(auth.uid(), p_actor_id)` **ยังไม่ทำ** — ต้องเปลี่ยน signature 4 args (drop/create/re-grant + server action) ซึ่ง verify-0163..0170 อ้างอยู่ · เลื่อนเป็นงานแยก
- Tag block ถูกห้ามทั้งช่วง ⇒ อีโมจิธงอังกฤษ/สกอตแลนด์/เวลส์ (ลำดับ U+1F3F4 + tag) พิมพ์ในเหตุผลไม่ได้ (ธงประเทศปกติ regional indicator ใช้ได้) — บันทึกไว้ใน verify L2e
- เพดาน 3 เท่าเป็นค่าคงที่ในฟังก์ชัน (ไม่อยู่ใน `oem_setting`) — ปรับต้องออก migration
- ใบที่บันทึกไว้แล้วไม่ถูกแก้ย้อนหลัง (ตรวจก่อน/หลัง apply: จำนวนใบ/รายการ + md5 ของ oem_quote/oem_quote_item/oem_setting เท่าเดิม)
- verify-0140 (P2d P6a) และ verify-0141 ล้มทั้งก่อนและหลัง 0171 (เทียบ baseline บน DB ที่ 0170 ได้ผลเหมือนกัน — ยังไม่ได้วิเคราะห์สาเหตุราย case) — ไม่เกี่ยวกับ 0171 · 0142/0143 ผ่าน
- UI ของ L3/L4 ยังไม่ได้ QA ด้วยตา (typecheck + unit test เท่านั้น)
