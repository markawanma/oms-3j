# Design — ราคาพิเศษเงินแท่งในใบเสนอราคา OEM (0163)

> 7 ต.ค. 69 · ผู้ออกแบบ: architect (Yoda) · Tech Lead เคาะคำถามค้าง §9 แทนเจ้าของ (โหมดเร่งด่วน)
> 🔴 โหมดเร่งด่วน: เจ้าของรับความเสี่ยง ข้าม security/QA/code-review รอบนี้ → หนี้ §10
> ห้ามเขียนตัวเลขราคา/ทุน/margin จริงลงไฟล์นี้ (memory `oem-pricing`)

## มติเจ้าของ (7 ต.ค. 69)
1. ราคาพิเศษต่ำกว่าราคาเว็บวันนี้ได้ แต่**ห้ามต่ำกว่าทุน** (ทุนแท่ง = ราคารับซื้อคืน 0079/0134) — ไม่มีปุ่มปลดล็อก
2. ใบที่มีราคาพิเศษ: กรอกวันหมดอายุเอง **ไม่เกิน 30 วัน** · พิมพ์ "ยืนราคาถึง ..." บนใบ
3. หน้าพิมพ์แสดงเป็นราคาต่อแท่งตามปกติ — ราคาเว็บ/เหตุผล/ทุน เห็นเฉพาะในระบบ

เหตุผลทางธุรกิจ: งาน bid/special ต้องเสนอราคาล่วงหน้า บางทีบวกเผื่อราคาเงินขึ้น บางทีให้ราคาพิเศษ · ช่องส่วนลดเดิมลดได้อย่างเดียว

## 0. ข้อค้นพบ
- **ไม่มี DDL** — `oem_quote_item.input/calc` เป็น jsonb snapshot (0078 D5) · `oem_quote.quote_valid_until` มีแล้ว · ใบเสร็จอ่าน `grand_total` จากแถว quote (0084) ไม่อ่าน `silver_price_daily` ซ้ำ · renegotiate copy items verbatim (0085)
- ด่านเดิมที่ใช้ต่อ: ใบ `quoted` แก้ไม่ได้ (0083) · `price_fresh` ผูก `v_bar_price is not null` (0140) · margin รวมติดลบ = ปฏิเสธ · hard floor หลังส่วนลด
- ต้องแก้: branch silver999 ใน `oem_price_calc` (0140) · `v_item_valid_days ... silver999 then 0` ใน `oem_quote_save` (0083) และ `oem_quote_renegotiate` (0085) · signature save ต้องรับวันหมดอายุ

## 1. Data contract
input ต่อ item (silver999 เท่านั้น):

| key | ชนิด | ความหมาย |
|---|---|---|
| `bar_price_override_thb` | numeric, optional | ราคา/แท่ง ไม่รวม engrave · VAT-inclusive (ความหมายเดียวกับราคาเว็บ `bar_*`) |
| `bar_price_override_reason` | text, บังคับเมื่อมี override | trim แล้วห้ามว่าง · `left(...,200)` |

param ใหม่ระดับใบ: `oem_quote_save(..., p_bar_valid_until date default null)` — drop 9-arg เดิม สร้าง 10-arg (default null ⇒ app เก่าที่ส่ง 9 named params ยังเรียกได้)

snapshot ใน `oem_quote_item.calc`:
- `breakdown.bar.bar_price_per_piece` = ราคาที่คิดจริง (override ถ้ามี) — คง key เดิม ให้ print/`OemBarCalcSummary` อ่านช่องเดิม
- `breakdown.bar.web_price_per_piece` = ราคาเว็บวันนั้น · `breakdown.bar.override = {thb, reason}` · `cost_piece` สูตรเดิม (override ไม่แตะฝั่งทุน)
- `floors.bar_price = {applies:true, pass:bool}`
- 🔴 key ใหม่ emit **เฉพาะเมื่อมี override** ⇒ เคสไม่มี override ได้ jsonb byte-identical
- ผู้กรอก/เวลา = `oem_quote.updated_by/updated_at` (ไม่ stamp ซ้ำ) — 🔴 **เป็นจริงหลัง 0165 เท่านั้น**: ก่อนหน้านั้นแอปเรียก RPC ด้วย service client ⇒ `auth.uid()` เป็น null ⇒ `updated_by` ว่างทุกใบ (security M2) · หลัง 0165 ได้ค่าเมื่อ server action ส่ง `p_actor_id` จาก session — ใบที่ออกก่อน 0165 ยังว่างถาวร
- header `rate_snapshot.bar_valid_until_requested` เฉพาะใบที่มี override

## 2. `oem_price_calc` branch silver999
1. parse `v_ovr` / `v_ovr_reason` (หลัง parse engrave ก่อน lookup)
2. raise 22023: `not (v_ovr > 0 and v_ovr <= 1000000)` (not-between ฆ่า NaN/Inf) · override ไม่มีเหตุผล · เหตุผลไม่มี override
3. lookup เดิม · `v_is_complete := (v_bar_price is not null)` ไม่แตะ ⇒ ไม่มีราคาวันนี้ = ออกใบไม่ได้แม้มี override
4. มี override และ complete:
   - ไม่มี buyback วันนี้ → `v_is_complete := false` + missing `silver_bar_buyback` (ไม่ใช้ทุนประมาณตัดสิน)
   - `v_ovr > v_bar_price * 2` → raise 22023 (กันพิมพ์ศูนย์เกิน)
   - `v_bar_price_charged := v_ovr` · `floor pass := v_ovr >= buyback`
5. `v_price_piece := charged + engrave` · ทุน/margin สูตรเดิม · `floors.margin.value` คง null
6. warnings: มี override → "ราคาพิเศษ — ยืนราคาตามวันที่กรอกในใบ (ไม่เกิน 30 วัน)" แทน "ยืนเฉพาะวันนี้"

พิสูจน์ไม่มี override = เหมือนเดิม: rename → `oem_price_calc_legacy` · create ใหม่ · do-block assert jsonb `=` บน matrix 6 ขนาด × engrave {null,0,150} × qty {1,7} × {ร้านจริง, shop ไม่มี oem_setting, shop ไม่มีแถวราคา} + งานผลิต silver/gold/brass + **input จริงทุกแถว silver999 บน DB** → drop legacy → `pg_proc` 1 แถว → grant `service_role` เท่านั้น (0147)

## 3. อายุใบ
- `v_has_override` = มี item ที่ `calc->breakdown->bar->override` ไม่ null
- มี override + quoted + `p_bar_valid_until` null → raise
- `p_bar_valid_until` < วันนี้ (BKK) หรือ > วันนี้+30 → raise (ตรวจทุกครั้งที่ save)
- ไม่มี override แต่ส่งวัน → raise
- `v_item_valid_days`: silver999 มี override → `p_bar_valid_until - v_bkk_today` · ไม่มี → 0 · งานผลิตเดิม · `least()` เดิม ⇒ ใบผสม override+แท่งราคาเว็บ = วันนี้ (UI เตือน)
- renegotiate: silver999 มี override → `greatest(v_old.quote_valid_until - v_bkk_today, 0)` (สืบทอดวันเดิม)

## 4. ด่าน margin
| ด่าน | ผล |
|---|---|
| ใหม่: รายชิ้นต่ำกว่าทุน (`floors.bar_price.pass=false`) → save raise ที่ quoted | ต้องรายชิ้น — ใบผสมงานผลิต margin สูงจะกลบให้ blended มองไม่เห็น |
| margin รวมติดลบ (เดิม) | ชั้นสอง |
| hard floor หลังส่วนลด (เดิม) | ครอบ "ต่ำกว่าทุนหลังส่วนลด" อยู่แล้ว |
| note-tier (เดิม) | override ทำ blended ต่ำ → บังคับ approval_note ตามเดิม |
| บวกเผื่อ | ผ่าน ติดแค่เพดาน 2× |

## 5. ใบเสร็จ/ใบกำกับ — ไม่ต้องแก้ (อ่าน snapshot ของ quote อยู่แล้ว)

## 6. UI
- `lib/oem/types.ts` · `lib/actions/oem.ts` (ส่ง 2 key เฉพาะเมื่อมีราคา · reason ไม่ส่งถ้าราคายังว่าง) · `lib/oem/quoteForm.ts`
- `QuoteJobItemCard.tsx` บล็อก isBar: ช่อง "ราคาพิเศษ/แท่ง (บาท) ไม่บังคับ" + "เหตุผล"
- `OemBarCalcSummary.tsx`: มี override → หัวใหญ่ = ราคาพิเศษ + "ราคาเว็บวันนี้ X" + เหตุผล + badge · pass=false → alert แดง "ต่ำกว่าทุน ออกใบไม่ได้ — ขั้นต่ำ X" (admin เท่านั้น)
- `QuoteResultPanel.tsx` / `QuoteCalculatorClient.tsx`: มี override → date input "ยืนราคาถึง" min=วันนี้ max=+30 · banner ปรับตามเงื่อนไข
- print `lib/oem/printableQuote.ts`: ไม่เพิ่ม field · มี override → `silverPriceAsOf/CapturedAt = null` (ตัดประโยค "ยืนราคาเฉพาะวันดังกล่าว") เหลือ "ยืนราคาถึง"

## 7. ไฟล์
- `supabase/migrations/0163_oem_bar_price_override.sql` (LF) + `scripts/verify/verify-0163.sql`
- UI ตาม §6

## 8. เคสห้ามผ่าน → ด่าน
| เคส | ตกที่ |
|---|---|
| override < buyback | save raise ที่ quoted (ใหม่) + blended<0 (เดิม) |
| ต่ำกว่าทุนหลังส่วนลด | hard floor เดิม |
| ≤0 / NaN / Inf / >1,000,000 / >2× เว็บ | `oem_price_calc` raise |
| ไม่มีเหตุผล / เหตุผลลอย | `oem_price_calc` raise |
| ไม่มีราคาวันนี้ + override | incomplete เดิม · ไม่มี buyback → missing |
| วัน >+30 / ย้อนหลัง / null ตอน quoted | `oem_quote_save` raise |
| quoted แล้วแก้ | ด่านเดิม |
| ราคาเว็บ/ทุน/เหตุผลหลุดหน้าพิมพ์ | `PrintableQuote` ไม่มี field |
| ยิง RPC ด้วย role อื่น | grant service_role เท่านั้น + `crm_require_owner_admin` |

## 9. คำถามค้าง — Tech Lead เคาะแทน (เร่งด่วน · เจ้าของกลับมติได้)
1. เท่ากับทุนพอดี → **ผ่าน** (ตามตัวอักษรมติ "ห้ามต่ำกว่าทุน")
2. เพดาน 2× ราคาเว็บ → **ใช้** (กันพิมพ์ศูนย์เกิน · เจ้าของปรับได้)
3. draft มี override ยังไม่กรอกวัน → **บันทึกได้** ตรวจตอน quoted
4. โชว์ "ขั้นต่ำที่รับได้" ในหน้า admin → **โชว์เฉพาะตอนต่ำกว่าทุน** (หน้า admin เท่านั้น · print boundary คือด่านจริง) · แก้คอมเมนต์หัว `OemBarCalcSummary` ให้ตรง
5. ใบผสม override + แท่งราคาเว็บ → **อายุ = วันนี้ + UI เตือน**
6. 🔴 **มติเจ้าของ 7 ต.ค. 69 (security M1) — ไม่แก้**: ใบราคาพิเศษที่พ้นวันยืนราคาแล้ว **ยังออกใบเสร็จ/รับมัดจำได้ตามเดิม** (0084 ตั้งใจ — ใบเสร็จอ่าน `grand_total` จากแถว quote ไม่เช็ควันหมดอายุ)
   - เหตุผล: "เจ้าของคุมเอง" — เจ้าของเป็นคนตัดสินใจรับเงิน/ทำตามราคาที่เคยเสนอ แม้พ้นวัน (เช่น ลูกค้าประจำมาจ่ายช้า)
   - ความเสี่ยงที่รับ: ราคาเงินขึ้นหลังพ้นวันยืนราคา แต่รับเงินที่ราคาพิเศษเดิม ⇒ **ขายต่ำกว่าทุนวันรับเงินได้** (ด่าน "ห้ามต่ำกว่าทุน" ตรวจเทียบทุน ณ วันออกใบเท่านั้น ไม่ตรวจซ้ำตอนรับเงิน) · ระบบไม่เตือนที่หน้ารับเงิน
   - ไม่มีโค้ดรองรับ — ถ้าเจ้าของเปลี่ยนใจ ต้องเพิ่มด่านที่ `oem_receipt_issue` (เทียบ `quote_valid_until` กับวันนี้ BKK) แยกรอบ

## 10. หนี้ (โหมดเร่งด่วน)
- D1 ข้าม security-auditor / qa-tester / code-reviewer — ควรตรวจย้อนหลัง (เน้น RPC ตรง, ใบผสม+ส่วนลด, RSC payload หน้าพิมพ์)
- D2 รายงาน "ใบไหนใช้ราคาพิเศษ" ยังไม่มี — query `calc->'breakdown'->'bar'->'override'` ได้
- D3 (security M2 — หนี้ที่รู้ตัว ไม่แก้รอบ 0165) ฟังก์ชัน OEM อื่นที่เขียน `updated_by = auth.uid()` เป็น null เหมือนกันเมื่อเรียกผ่าน service client: `oem_quote_set_billing` · `set_deposit` · `set_vat_mode` · `set_status` · `oem_quote_renegotiate` · `oem_receipt_*` — ต้องเติม `p_actor_id` แบบเดียวกับ 0165 ทีละตัว · ใบ/แถวที่แก้ก่อน 0165 ว่างถาวร
- D4 (security L3 — ไม่แก้) ส่วนลดของใบผสมงานผลิต + แท่ง "กินส่วนแท่งได้ในเชิงเศรษฐศาสตร์": ส่วนลดเป็นก้อนเดียวระดับใบ ด่าน hard floor/blended ตรวจรวมทั้งใบ ไม่ได้บังคับให้ส่วนลดตกที่งานผลิตเท่านั้น — แท่งที่ราคาพิเศษเท่าทุนพอดีรวมกับส่วนลดอาจทำให้ส่วนของแท่งขายต่ำกว่าทุนจริงขณะที่ margin รวมยังเกินด่าน (ด่านรายชิ้น "ต่ำกว่าทุน" ตรวจก่อนหักส่วนลด)
- D5 (security L4 — ตั้งใจ) `oem_quote_renegotiate` ใบราคาพิเศษไม่เทียบทุนวันนี้ซ้ำ แต่ **ไม่ยืดวันยืนราคา** (สืบทอดวันเดิม `greatest(เดิม − วันนี้, 0)`) — ต่อรองได้แต่ราคาไม่ยืนนานกว่าที่เสนอไว้
- D6 (security L5 — ยอมรับ) หน้า admin โชว์ "ทุนต่อชิ้น" เมื่อราคาพิเศษต่ำกว่าทุน (ต้องใช้ปรับราคา) — ระวังแชร์จอ/screenshot หน้านี้ให้ลูกค้า · ด่านจริงของ "ไม่หลุดถึงลูกค้า" คือ `PrintableQuote` (ไม่มี field)

## 11. เบี่ยงจาก design ตอน implement (Han Solo · 7 ต.ค. 69 · apply แล้ว version 20261007115504)
- ราคาพิเศษทศนิยมเกิน 2 ตำแหน่ง = ปฏิเสธ (22023) — design ไม่ได้ระบุ · กัน "ราคาต่อแท่งกับยอดรวมที่ปัดแล้วบวกไม่ลง" (oem-quote-invariants ข้อ 3)
- "ขั้นต่ำ X" (§6) ไม่มีใน snapshot (ห้ามใส่ buyback) — หน้า admin โชว์ `breakdown.costPiece` (ทุนต่อชิ้น รวมค่ายิงเลเซอร์ pass-through) เฉพาะตอน pass=false แทน · ไม่มีการคำนวณใน client
- ไม่มีราคารับซื้อคืนวันนี้ + มี override → is_complete=false + missing `silver_bar_buyback` (ตาม §2.4) · เพดาน 2x ตรวจก่อน (ถ้ามีราคาเว็บ)
- UI: ช่องเหตุผล approval_note ของใบ (ระดับใบ) แสดงเมื่อ `มีรายการที่ margin รายชิ้นเป็น null (เงินแท่ง) และ margin รวม < floor` แม้ไม่ลดราคา — ให้ตรงกับ DB (0079-fix) · เดิม UI เช็คแค่ discount>0 ทำให้ใบราคาพิเศษที่ margin บางชนด่านโดยไม่มีช่องให้กรอก
- ไม่มี flow เปิดร่างกลับเป็น JobForm ในโค้ดปัจจุบัน (หน้า /oem/quote สร้างใหม่อย่างเดียว) — คำเตือน Yoda: `fromInputPayload` อ่าน override กลับครบแล้ว + `rate_snapshot.bar_valid_until_requested` เก็บวันของร่างไว้ · ใครสร้าง flow rehydrate ต้องเติม barPriceOverrideThb/Reason + barValidUntil เอง (เทสต์ getQuoteItems ล็อกฝั่งอ่านไว้)

## 12. แก้ตาม security ตรวจย้อนหลัง — 0165 (Han Solo · 7 ต.ค. 69 · branch `fix/oem-override-hardening`)
- **M2** `p_actor_id uuid default null` เพิ่มท้าย `oem_quote_save` (11-arg) และ `oem_quote_set_customer` (5-arg): `v_actor = coalesce(auth.uid(), id ที่มีอยู่จริงใน auth.users)` — ค่าที่ไม่มีใน auth.users กลายเป็น null (ไม่ล้มด้วย FK) · ใช้กับ created_by/updated_by/approved_by ของ save · server action ส่งเฉพาะ id จาก `getSessionUser()` (ไม่มี field รับจาก client) · ไม่มี session = ไม่ส่ง key = พฤติกรรมเดิม
- **audit** การแก้ชื่อ/ช่องทางติดต่อ: ตารางใหม่ `analytics.oem_quote_audit` (ไม่ใช้ `crm_audit_log` เพราะ CHECK action เฉพาะ CRM) append-only: trigger กัน UPDATE/DELETE/TRUNCATE + service_role ได้แค่ select/insert · `created_at` ใช้ `clock_timestamp()` ไม่ใช่ `now()` (หลายครั้งในทรานแซกชันเดียวต้องเรียงลำดับได้) · ไม่ใส่ FK ตั้งใจ (FK cascade/set null จะยิง UPDATE/DELETE ชน trigger)
- **M3 + L1** helper เดียว `analytics.oem_customer_text_clean` (+ `oem_text_strip_invisible`) ใช้ทั้งใน `oem_quote_save` และ `oem_quote_set_customer` · ชุดอักขระล่องหน/bidi ตามบรีฟ + C1/control · ฝั่ง JS `lib/oem/display.ts` ชุดเดียวกัน (`display-customer-text.test.ts` ล็อก 40 code point คู่กับ verify-0165) · `saveQuote` action เรียก `customerTextIssue` ด้วย
  - ⚠️ เบี่ยงจากบรีฟ: ZWJ (U+200D) อยู่ในช่วง U+200B-200F ของชุดที่สั่งห้าม แต่บรีฟสั่งให้อีโมจิ ZWJ ผ่าน — จึงยอม ZWJ เฉพาะที่ **คั่นระหว่างสัญลักษณ์/อีโมจิสองตัว** (U+2600-27BF · 2B00-2BFF · 1F000-1FAFF · FE0F) ZWJ ติดอักษรไทย/ละติน/ต้นท้ายข้อความยังถูกปฏิเสธ
  - เพิ่มเอง: ช่องว่างล้วนทุกชนิด (NBSP/em-space/ideographic) = null แทน "ชื่อล่องหน" · U+115F และ U+3164 (Hangul filler) ในชุดล่องหน
  - พฤติกรรมเปลี่ยนจาก 0164: tab/newline ท้ายข้อความถูก trim ทิ้ง (เดิมปฏิเสธ) — ยังปฏิเสธเมื่ออยู่กลางข้อความ
- **L2** เหตุผลราคาพิเศษ: ลบอักขระล่องหน/bidi ก่อน trim → ว่าง = ไม่มีเหตุผล = raise · เหตุผลปกติที่ฝังอักขระล่องหนถูกลบก่อนเก็บ · แตะ `oem_price_calc` ⇒ rename→legacy + golden replay strict (3,283 เคส)
- **L6** `typeof` ก่อน `.trim()`/regex ใน `validateBarOverride` · เช็ค `barValidUntil` · `setQuoteCustomer` (quoteId/ชื่อ/ช่องทาง) → ข้อความไทย ไม่ใช่ 500
