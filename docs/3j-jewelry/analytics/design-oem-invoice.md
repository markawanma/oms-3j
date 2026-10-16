# Design — ใบแจ้งหนี้ (Invoice) ของใบเสนอราคา OEM: แจ้งยอดมัดจำ + แจ้งยอดคงเหลือ

> Architect (Yoda) · 16 ต.ค. 69 · branch `feature/oem-invoice` · **design เท่านั้น ยังไม่มีโค้ด/migration**
> เจ้าของสั่ง 16 ต.ค. 69: "จะออก invoice ต่อจากใบเสนอราคา" ใช้ **ทั้งแจ้งยอดมัดจำ และแจ้งยอดคงเหลือ**
> ต่อจาก `design-oem-payment-invoice.md` (ใบเสร็จ 0084-0088 — ตอนนั้นมติ "ไม่ทำใบแจ้งหนี้รอบนี้ แต่ไม่ปิดทาง") — รอบนี้เปิดประตูนั้น
> ⚠️ เลข migration ถัดไป = **0179** (0175-0178 ของระบบใบงาน apply บน prod แล้ว ไฟล์อยู่ branch อื่น ห้ามใช้ซ้ำ) · ใบแจ้งหนี้ใช้ **0179** (เอกสาร) + **0180** (ผูกใบเสร็จกับใบแจ้งหนี้)
> 🔴 ใบแจ้งหนี้ **ไม่ใช่ใบกำกับภาษี** — ใบกำกับภาษียังออกตอนรับเงินแบบเดิม (0084) · เรื่องที่เป็นการตีความกฎหมายภาษี **ทีมไม่ตัดสิน** รวมไว้ที่ §12 Q1

---

## 0. สรุปการตัดสินใจ (อ่านตารางนี้อันเดียวพอ)

| เรื่อง | ตัดสิน | เหตุผลสั้น |
|---|---|---|
| ชนิด | `kind in ('deposit','balance')` — 2 ชนิด ไม่มีหลายงวด | เคสจริงของร้าน = มัดจำ 1 + ปิดยอด 1 (หลัก 0084 เดิม) · constraint ขยายได้ทีหลัง |
| ยอด | **DB คำนวณเอง client ส่งแค่ `kind`** — deposit = `v_oem_quote.deposit_amount_thb` · balance = `v_oem_quote.outstanding_thb` | ไม่มีช่องให้พิมพ์ยอดเอง = ไม่มีช่องให้ยอดใบแจ้งหนี้เถียงกับใบเสนอราคา |
| ออกได้เมื่อ | quote สถานะ `quoted / expired / won` (เซ็ตเดียวกับ `oem_receipt_issue`) · **ไม่พลิกสถานะใบ** | ใบแจ้งหนี้มัดจำคือสิ่งที่*นำไปสู่* won (ลูกค้าโอน → ใบเสร็จพลิก won) ถ้าบังคับ won ก่อนจะต้องกดมือ |
| แก้ได้ไหม | **ไม่ได้** — `issued → void` ทางเดียว เหมือนใบเสร็จ · ผิด = ยกเลิก + ออกใหม่ (เลขใหม่) | ลูกค้าถือกระดาษแล้ว เลขเดียวสองยอดคือหายนะฝั่งบัญชีลูกค้า · ใช้ trigger ชุดเดิมที่พิสูจน์แล้ว |
| เปิดค้างได้กี่ใบ | **ต่อดีล เปิดค้าง (issued + ยังไม่มีใบเสร็จอ้าง) ได้ 1 ใบ** | ลูกค้าต้องไม่ถือสองยอดพร้อมกัน · ล็อกที่แถว quote (`for update`) ด่านเดียวกับกันจ่ายเกิน |
| เลขที่ | `IV-YYMM-NNN` จาก `oem_doc_counter` doc_key `IV-YYMM` แถวแยกจาก `RT-` | trigger 0088 คุม counter ทุก doc_key อยู่แล้ว · ตัวนับใบเสร็จไม่ขยับ · void เลขคงอยู่ |
| จับคู่กับใบเสร็จ | **ใบเสร็จชี้ใบแจ้งหนี้** `oem_receipt.invoice_id` (nullable) + ยอดต้อง**เท่ากันเป๊ะ** · สถานะ paid/unpaid/stale ของ invoice เป็น **derived** ใน view | ทิศ FK ตามเวลา (ใบเสร็จเกิดทีหลัง) · ใบแจ้งหนี้ไม่ต้องถูก UPDATE เลยนอกจาก void · void ใบเสร็จ → invoice กลับเป็น unpaid เองไม่ต้องเขียนอะไร |
| ยอดเปลี่ยนหลังออก (ต่อราคา/รับเงินไม่อ้างใบ) | ใบเดิมคง `issued` แต่ view ตีเป็น `is_stale=true` → หน้าพิมพ์**บล็อก** → ต้อง void แล้วออกใหม่ | ไม่ซ่อนปัญหา (หลักข้อ 8 ของ invariants) · ไม่ล็อก renegotiate เพราะใบแจ้งหนี้ไม่ใช่สัญญา |
| VAT | เก็บ `vat_display in ('none','included','breakdown')` **แช่แข็งตอนออก** = `none` ถ้า `seller_vat_registered=false` ไม่งั้นตาม `vat_mode` ของใบเสนอราคา · พาดหัว "ใบแจ้งหนี้ / Invoice" เท่านั้น | กระดาษหน้าตาเหมือนใบเสนอราคาที่ลูกค้าเห็นอยู่แล้ว · คำว่าภาษีมูลค่าเพิ่มโผล่ได้เฉพาะ `vat_display<>'none'` ตัดสินที่ DB ครั้งเดียว |
| ช่องทางชำระ | คอลัมน์ใหม่ `oem_setting.seller_payment_lines text[]` + RPC ตั้งค่าแยก · **ว่าง = ออกใบแจ้งหนี้ไม่ได้** · ค่าจริงเจ้าของกรอกเองในหน้าตั้งค่า **repo ห้ามมีเลขบัญชี** | ตอนนี้ไม่มี field บัญชีธนาคารที่ไหนเลย (มีแค่ placeholder ใน `seller_terms` free text) · ไม่แตะ `oem_setting_upsert` 24 พารามิเตอร์ |
| กำหนดชำระ | `due_date` บังคับ ≥ วันนี้ (ไทย) ≤ +365 · UI prefill +7 วัน **[ต้องยืนยัน]** | ค่า default เป็นนโยบายเจ้าของ (§12 Q3) |
| Phase | **0179** ใบแจ้งหนี้ + ตั้งค่าช่องทางชำระ → **0180** ผูกใบเสร็จ (`oem_receipt_issue` 10 args) → UI | แยกไฟล์ให้ review/verify เล็ก · 0180 แตะ RPC เอกสารภาษี = 💰 security ก่อน merge |

---

## 1. Design overview + data flow

```
oem_quote (deal มีชีวิต · ต่อราคาได้ · chain ผ่าน root_quote_id)
   | 1 deal -> 0..N ใบแจ้งหนี้ (เปิดค้างได้ทีละ 1)
   v
oem_invoice  (1 แถว = เอกสาร 1 ใบ · frozen snapshot · issued -> void เท่านั้น)   <- เลข IV-YYMM-NNN จาก oem_doc_counter
   ^ อ้างอิง (nullable)
oem_receipt.invoice_id  (ใบเสร็จ/ใบกำกับภาษี 0084 — ตารางเดิม เพิ่ม 2 คอลัมน์ · ยอดต้องเท่า invoice)

flow A — มัดจำ:  quote quoted --oem_invoice_issue(kind=deposit)--> IV-2610-001 (ยอด = deposit_amount_thb)
                 ลูกค้าโอน --oem_receipt_issue(p_invoice_id=IV-001, amount=ยอดเดียวกัน)--> RT-2610-016 + quote -> won
flow B — ปิดยอด: --oem_invoice_issue(kind=balance)--> IV-2610-002 (ยอด = outstanding_thb = grand - paid)
                 --oem_receipt_issue(p_invoice_id=IV-002)--> RT-2610-017 · is_fully_paid
flow C — ไม่ใช้ใบแจ้งหนี้: oem_receipt_issue แบบเดิม (p_invoice_id null) ทำงานเหมือน 0088 ทุกประการ
```

**หลักการเดียวที่คุมทั้ง design (ยกจาก 0084):** ใบเสนอราคา = เอกสารมีชีวิต · ใบแจ้งหนี้ = เอกสารตายตัว
เก็บผลลัพธ์ที่คำนวณแล้ว + snapshot ทั้งสองฝ่าย · พิมพ์ซ้ำอีก 5 ปีต้องได้เหมือนเดิม
**ต่างจากใบเสร็จตรงเดียว:** ใบแจ้งหนี้ไม่ใช่เอกสารภาษี จึง *ไม่มี* ด่าน VAT/tax_id/สาขา/งวดภาษี/5-way reissue lock —
แต่ความ immutable + เลขห้ามข้าม **คงไว้เท่าเดิม** เพราะเหตุผลไม่ได้มาจากกฎหมาย แต่มาจาก "ลูกค้าถือกระดาษไปแล้ว"

---

## 2. ชนิดเอกสาร + ที่มาของยอด (คำถามข้อ 1)

| kind | ยอด (DB อ่านจาก `v_oem_quote` แถว active ของดีล) | ด่านเพิ่ม |
|---|---|---|
| `deposit` | `deposit_amount_thb` (0081: pct → `round(grand*pct,2)` · thb → ตามที่ตั้ง) | ต้องมี `deposit_mode` · `paid_thb = 0` (ยังไม่เคยรับเงินในดีล) · `0 < deposit <= grand_total` |
| `balance` | `outstanding_thb` = `grand_total - paid_thb` | `outstanding > 0` · **ถ้ามี `deposit_mode` แต่ `paid_thb = 0` → ปฏิเสธ** ("ยังไม่ได้รับมัดจำ — ออกใบแจ้งหนี้มัดจำก่อน หรือตั้งมัดจำ 100% / ล้างเงื่อนไขมัดจำ") |

- **ปัดเศษ remainder:** ยอด balance = ส่วนที่เหลือ ไม่ใช่ "อีก 50%" → มัดจำ 5,000.50 + คงเหลือ 4,999.50 = 10,001 เป๊ะ (เหมือน 0084 §5)
  · ทั้งสองค่าอ่านจาก view **ไม่คำนวณซ้ำใน RPC** — สูตรอยู่ชั้นเดียว (0081/0084) ใบแจ้งหนี้กับหน้า quote ไม่มีวันเถียงกัน (0172 ก็อ่าน `paid_thb` จาก view แบบนี้อยู่แล้ว)
- **ไม่รับ `p_amount_thb`** จาก client เลย — ต่างจาก `oem_receipt_issue` ที่ต้องรับเพราะเงินที่โอนมาจริงคือข้อเท็จจริงภายนอก ส่วนยอดที่*ขอ* เป็นผลของใบเสนอราคาล้วน
- **ใบหลายงวด / ใบแจ้งหนี้ยอดเต็มใบเดียว:** ไม่ทำรอบนี้ · ประตูเปิดไว้ที่ `kind` CHECK (เพิ่มค่า installment + คอลัมน์ input ทีหลังได้โดยไม่รื้อ) · ใบที่ไม่ตั้งมัดจำ → `balance` = ยอดเต็ม ใช้แทน "ใบแจ้งหนี้เต็มจำนวน" ได้เลย
- `outstanding_thb < 0` (มัดจำแบบ thb แล้วราคาลดทีหลัง — 0084 §6 ปล่อยให้ติดลบได้ตั้งใจ) → ปฏิเสธทั้ง 2 kind พร้อมข้อความ "ยอดบวกไม่ลง แก้มัดจำก่อน"

## 3. วงจรสถานะ (คำถามข้อ 2)

- `oem_invoice.status`: **`issued -> void`** เท่านั้น · ไม่มี draft (draft ที่ถือเลข = เลขข้าม — บทเรียน 0084 §4) · ไม่มี RPC แก้เนื้อหา
- **ทำไมไม่ให้แก้ทั้งที่ไม่ใช่เอกสารภาษี:** (ก) ลูกค้าถือฉบับเดิมแล้ว — บัญชีฝั่งลูกค้าจับคู่ใบตามเลข เลขเดียวสองยอดจะถูกตีกลับ (ข) trigger/verify/UI ของใบเสร็จมีอยู่แล้ว ลอกได้ทั้งชุด — "แก้ได้บางคอลัมน์" ต้องออกแบบด่านใหม่ทั้งชุด (ค) ยกเลิก+ออกใหม่ทิ้งร่องรอยว่าเคยแจ้งยอดไหนไปบ้าง ซึ่งคือสิ่งที่อยากได้ตอนทะเลาะเรื่องยอด
- **สถานะการชำระ = derived ใน `v_oem_invoice`** ไม่เก็บในตาราง:
  `payment_state` = `void` | `paid` (มี `oem_receipt` status `issued` ที่ `invoice_id` = ใบนี้) | `unpaid`
  `is_stale` = issued AND unpaid AND (`grand_total` ของแถว active <> `grand_total_snapshot` OR `paid_thb` ของดีล <> `paid_before_thb`)
  → ครอบทั้ง "ต่อราคาหลังออกใบ" และ "รับเงินไปแล้วโดยไม่อ้างใบนี้" · `is_overdue` = unpaid AND `due_date` < วันนี้ไทย (ป้ายเท่านั้น ไม่มี state ใหม่)
- **ออกได้เมื่อ** quote `quoted/expired/won` · ปฏิเสธ `draft` (ยังไม่ผ่าน gate ราคา) `lost/rejected/superseded` (superseded → ข้อความชี้ไปใบ active) · **ไม่พลิกสถานะ quote** และไม่แตะ `quote_valid_until`
  · `expired` ยอมให้ออกเหมือนใบเสร็จ (รับเงินบนใบหมดอายุได้อยู่แล้ว ใบแจ้งหนี้อ่อนกว่าใบเสร็จ) + หน้าพิมพ์มีแถบเตือนพนักงาน `print:hidden` — เจ้าของกลับได้ (§12 Q3)
- **due_date:** `p_due_date` บังคับ · >= วันนี้ (Asia/Bangkok) · <= วันนี้ + 365 · ห้าม `current_date` (traps ข้อ 6)
- **ยอดเปลี่ยนหลังออก:** ไม่บล็อก `oem_quote_renegotiate` (ใบแจ้งหนี้ไม่ใช่สัญญา · การล็อกจะบังคับให้ void ก่อนต่อราคาซึ่งกลับลำดับงานจริง) → ใบเดิม `is_stale` → หน้าพิมพ์บล็อก + หน้า quote เตือน "ยกเลิกแล้วออกใหม่" · void ต้องมีเหตุผล (`oem_note_present` whitelist — invariants §6.2)
- **จับคู่ใบเสร็จ** (0180): `oem_receipt_issue(..., p_invoice_id)` ด่านเมื่อส่งมา: ใบแจ้งหนี้อยู่ร้านเดียวกัน · `issued` · ยังไม่มีใบเสร็จ issued อ้าง (ล็อก `for update` + partial unique index เป็นกำแพงสุดท้าย) · ดีลเดียวกัน (`root_quote_id`) · `round(p_amount_thb,2) = amount_thb` **เป๊ะ** · kind map deposit→`deposit` / balance→`final` · reissue (`p_reissued_from`) ต้องอ้าง invoice **เดียวกับใบเสร็จเดิม** (เดิม null ก็ต้อง null) = ล็อกตัวที่ 6 ต่อจาก 5 ตัวของ 0087/0088
  · โอนมาไม่ตรงยอด → บันทึกรับเงิน**ไม่อ้างใบ** (flow C) แล้ว invoice กลาย stale → void ด้วยเหตุผล "ลูกค้าโอนยอดต่าง" (§12 Q4)
  · `oem_receipt_void` **ไม่แก้** — ใบเสร็จ void แล้ว invoice กลับเป็น unpaid เองผ่าน view (ไม่มี mutation ข้ามตาราง)

## 4. เลขที่เอกสาร (คำถามข้อ 3)

- `IV-YYMM-NNN` · YYMM เวลาไทย · `insert ... on conflict do update set last_no = c.last_no + 1 returning` บนแถว doc_key `IV-YYMM` ของ `oem_doc_counter` ใน transaction เดียวกับ insert invoice — pattern 0084 §3 คำต่อคำ
- แถวตัวนับแยกจาก `RT-YYMM` → **ตัวนับใบเสร็จไม่ขยับ** (verify: `last_no` ของทุกแถว `RT-%` เท่าเดิมก่อน/หลัง)
- `trg_oem_doc_counter_deny_mutation` (0088) คุมทุก doc_key อยู่แล้ว (last_no +1 เท่านั้น · ห้ามลบ · ห้ามเปลี่ยนคีย์) — **ไม่ต้องแก้ trigger** · ข้อความ error ของมันอ้าง `oem_receipt_issue` ตายตัว ยอมรับ (แก้ = replace trigger function ของเอกสารภาษี ไม่คุ้ม) จดเป็นหนี้ §14
- void แล้วเลขคงอยู่ (ไม่ลบแถว) · ใบ void ต้องโชว์ในรายการพร้อมลายน้ำ "ยกเลิก" เสมอ (ไล่ความต่อเนื่องของเลขได้)
- 🔴 ทดสอบทุกเคสใน do-block + `raise` บังคับ rollback (traps ข้อ 11) — เลข IV ไม่ใช่เลขภาษี แต่กติกา "ห้ามเผาเลขบน prod" ใช้เท่ากัน

## 5. Snapshot (คำถามข้อ 4)

แช่แข็งตอน issue ทั้งหมด · view **ห้าม** เติมค่าคำนวณสดทับ (0084 §14 ข้อ 2):

| กลุ่ม | คอลัมน์ | ที่มา |
|---|---|---|
| ผู้ขาย | `seller_snapshot jsonb` = `{legal_name, display_name, branch_label, address_lines, tax_id, phone, vat_registered}` | `oem_setting` — ชุดเดียวกับใบเสร็จ **+ `vat_registered`** (ใบเสร็จไม่ต้องเก็บเพราะบังคับ true · ใบแจ้งหนี้ต้องรู้ตอนพิมพ์ว่าตอนออกเป็นอะไร) |
| ช่องทางชำระ | `payment_lines text[]` | `oem_setting.seller_payment_lines` ณ วันออก — เปลี่ยนบัญชีทีหลัง ใบเก่าไม่ขยับ |
| ผู้ซื้อ | `buyer_legal_name` (not null) · `buyer_tax_id` · `buyer_branch_label` · `buyer_address jsonb` | `oem_customer` ผ่าน `quote.customer_id` — ต้องผูกแล้ว + มี legal_name (ด่านเดียวกับใบเสร็จขั้นแรก) · tax_id/ที่อยู่/สาขา **ไม่บังคับ** (ไม่ใช่เอกสารภาษี) |
| รายการ | `lines_snapshot jsonb` = array ของ `{seq, name, sku, qty, unit_price_thb, line_total_thb}` **คีย์ whitelist นี้เท่านั้น** RPC ประกอบทีละคีย์จาก `oem_quote_item` (`product_name_snapshot` / `sku_snapshot` / `qty` / `price_per_piece` / `item_total` — name fallback = item_kind ใน `input` แบบ `v_label` ของ 0172) · **ห้าม** `to_jsonb(item)` · ห้ามแตะ `calc`, `cost_piece`, `margin_charged_pct`, `input` ส่วนอื่น | เงินแท่ง: name ต่อท้ายขนาดตามที่ `PrintableQuoteItem.barSizeLabel` แสดงอยู่แล้ว · ค่ายิงเลเซอร์รวมใน unit_price (ไม่แตกบรรทัด — ลูกค้าเห็นยอดเดียวกับใบเสนอราคา) |
| ยอดใบเสนอราคา | `quote_no_snapshot` · `pieces_subtotal_snapshot` · `nre_price_snapshot` · `discount_thb_snapshot` · `grand_total_snapshot` · `deposit_amount_snapshot` (null ถ้าไม่มีเงื่อนไขมัดจำ) · `deposit_pct_snapshot` | `v_oem_quote` แถว active — **ไม่มี** discount_reason / approval_note / margin |
| ยอดใบนี้ | `amount_thb` · `paid_before_thb` · `balance_after_thb` = `grand - (paid_before + amount)` (ใบ balance = 0 เสมอ) · `vat_display` · `vat_rate` · `vat_base_thb` · `vat_amount_thb` | §6 |
| เอกสาร | `invoice_no` · `kind` · `issue_date` (วันนี้ไทย) · `due_date` · `description` (RPC generate: "เงินมัดจำ X% ตามใบเสนอราคา OEM-…" / "ยอดคงเหลือตามใบเสนอราคา OEM-…") · `note` (ลูกค้าเห็น <=500 · รูปร่างผ่าน `oem_note_valid`) | |

- พิมพ์ซ้ำ = อ่านแถวนี้อย่างเดียว · `PrintableInvoice` ประกอบทีละ field จาก `OemInvoiceRow` ห้าม spread (กฎหัวไฟล์ `printableReceipt.ts` ทั้งดุ้น)
- `quote_id` ชี้แถว quote ที่ออก ณ ตอนนั้น · ต่อราคาแล้ว**ไม่ re-point** (เหมือนใบเสร็จ) · view join หาแถว active ของ chain เอง

## 6. VAT บนใบแจ้งหนี้ (คำถามข้อ 5)

- ตัดสิน**ครั้งเดียวตอน issue** ที่ DB: `vat_display := case when not seller_vat_registered then 'none' else quote.vat_mode end` แล้วแช่แข็ง — หน้าพิมพ์อ่าน `vat_display` อย่างเดียว ไม่ดู setting ปัจจุบัน
- `none` → `vat_base_thb`/`vat_amount_thb` = **null** · กระดาษไม่มีคำว่าภาษีมูลค่าเพิ่ม/VAT/อัตรา ที่ไหนเลย (รวม description ที่ RPC generate)
- `included` → บรรทัดเดียว "ราคารวมภาษีมูลค่าเพิ่มแล้ว" ใต้ยอด (ตรงกับที่ใบเสนอราคาโหมด included พิมพ์อยู่ — `PrintQuoteClient` บรรทัด 404)
- `breakdown` → ก่อนภาษี / ภาษีมูลค่าเพิ่ม X% / ยอดรวม ของ**ยอดใบนี้** (`vat_base = round(amount/(1+rate),2)` · `vat_amount = amount - vat_base` remainder + CHECK `base + vat = amount`) — สูตรเดียวกับใบเสร็จ 0084 §5 และมติ "ผลรวม VAT รายใบต่างจากระดับ quote ได้ 1 สตางค์" ใช้ต่อ
- CHECK รูปร่าง: `(vat_display='none' and base is null and vat is null) or (vat_display<>'none' and base + vat = amount)`
- **ไม่ใช่ใบกำกับภาษี — กันด้วยโครงสร้าง:** พาดหัวคงที่ "ใบแจ้งหนี้ / Invoice" ไม่มีเงื่อนไข `isFullTaxInvoice` ในหน้าพิมพ์นี้เลย · ไม่มีคำ "ต้นฉบับ/สำเนา" · ไม่มีบรรทัดอ้าง ม.86/4 · `PrintableInvoice` ไม่มี field ที่ชื่อสื่อว่าเป็นเอกสารภาษี
- 🔴 **สิ่งที่ทีมไม่ตัดสิน (ถามผู้เชี่ยวชาญ — §12 Q1):** (ก) ใบแจ้งหนี้ที่แสดงบรรทัด VAT แยก มีผลทางภาษีอะไรไหมเมื่อยังไม่ได้รับเงิน (ข) ลูกค้าบริษัทที่ขอ "ใบแจ้งหนี้/ใบกำกับภาษี" ก่อนจ่าย ร้านควรออกแบบไหน (ค) ควรพิมพ์ข้อความ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" ท้ายใบหรือไม่ — ✅ **เจ้าของตอบแล้ว 16 ต.ค. → พิมพ์** (ดู §15.1 — ทับข้อความเดิม)
  · ประตูที่เปิดไว้ถ้าคำตอบ (ข) คือ "ต้องมี": เพิ่ม `doc_type` ให้ `oem_invoice` ภายหลัง + ด่านชุดใบเสร็จ (tax_id/สาขา/ที่อยู่/VAT registered) + ตัวนับแยก — ไม่ต้องรื้อตารางนี้ แต่**ห้ามทำในรอบนี้**

## 7. ข้อมูลบนใบ + ช่องทางชำระ (คำถามข้อ 6)

**บนกระดาษ (ทั้งหมดจาก snapshot แถวเดียว):** พาดหัว "ใบแจ้งหนี้ / Invoice" · เลขที่ · วันที่ออก · **กำหนดชำระ** · อ้างอิงใบเสนอราคา (`quote_no_snapshot`) · ผู้ขาย (ชื่อ/ที่อยู่/เลขผู้เสียภาษี/โทร — ชุดเดียวกับที่ใบเสนอราคาพิมพ์อยู่แล้ว บรรทัด 240 `PrintQuoteClient`) · ผู้ซื้อ (ชื่อ/ที่อยู่ · เลขผู้เสียภาษี**ถ้ามี** — ใบเสนอราคาพิมพ์แบบนี้อยู่แล้ว บรรทัด 258) · ตารางรายการ (`lines_snapshot`) · รวมค่าสินค้า / ค่าแบบ (NRE price) / ส่วนลด (ตัวเลขเท่านั้น **ไม่มีเหตุผล**) / ยอดรวมใบเสนอราคา · ท่อน VAT ตาม §6 · **กล่อง "ยอดที่ต้องชำระครั้งนี้"**: deposit → "มัดจำ X% (หรือ ตามที่ตกลง)" = amount · balance → ยอดรวม − รับแล้ว = amount · **ช่องทางชำระเงิน** (`payment_lines` ทีละบรรทัด) · หมายเหตุ (`note`) · ยอดตัวอักษรไทย (reuse bahttext ของใบเสร็จ)
**ห้ามมีเด็ดขาด (type boundary ไม่ใช่วินัย):** ต้นทุน/margin ทุกชนิด · `approval_note` · `discount_reason` · `price_reason` · ราคาแคตตาล็อก · `calc`/`rate_snapshot` · ราคารับซื้อคืน · `void_reason` (จอเท่านั้น) · ผู้ออก/ผู้ยกเลิก (user id)
**บนจอเท่านั้น (`print:hidden`):** ลายน้ำ "ยกเลิก" พิมพ์ได้ (เหมือนใบเสร็จ) แต่เหตุผล void ไม่พิมพ์ · แถบ "ยอดเปลี่ยนแล้ว (stale) — ยกเลิกแล้วออกใหม่" **บล็อกปุ่มพิมพ์** · แถบ "ใบเสนอราคาหมดอายุ" เตือนเฉยๆ · แถบ "เลยกำหนดชำระ"

**ช่องทางชำระเงิน — ของจริงตอนนี้:** grep ทั้ง `oem_setting` / `shop_setting` / UI OEM **ไม่มี field บัญชีธนาคาร** มีแค่ placeholder "โอนเข้าบัญชี ..." ใน `seller_terms` (free text เงื่อนไขใบเสนอราคา)
- ตัดสิน: เพิ่ม `oem_setting.seller_payment_lines text[] not null default '{}'` (บรรทัดละ 1 เช่น "ธนาคาร … เลขที่ … ชื่อบัญชี …") + RPC `oem_setting_set_payment_lines` แยก **ไม่ขยาย `oem_setting_upsert`** (24 args — เปลี่ยน arg list = drop signature + ความเสี่ยง overload traps ข้อ 1 โดยไม่จำเป็น) + append ท้าย `v_oem_seller`
- ทำไมไม่ใช้ `seller_terms`: มันคือเงื่อนไขใบเสนอราคา (พิมพ์บนใบเสนอราคาอยู่แล้ว) ปนกันแล้วแก้เงื่อนไขจะลากเลขบัญชีเพี้ยนและกลับกัน · ทำไมไม่แตกเป็น bank/account_no/account_name: ร้านอาจมีพร้อมเพย์/หลายบัญชี/ข้อความอิสระ — text[] พอดีตัว ไม่ต้องเดาโครง
- 🔴 **ค่าจริงต้องมาจากเจ้าของ**: dev/QA ห้าม seed · หน้าตั้งค่าแสดงช่องว่าง + ข้อความ "ยังไม่ได้ตั้งช่องทางชำระเงิน — ออกใบแจ้งหนี้ไม่ได้" · DB gate: `cardinality(seller_payment_lines) = 0` → 22023 · QA grep diff หาเลขบัญชี/ชื่อธนาคารจริง = ตีตก (memory `no-realistic-placeholders`) · placeholder ใน UI ใช้ `TODO_OWNER_BANK_ACCOUNT` เท่านั้น
- แต่ละบรรทัด: `oem_note_valid` (ห้าม control/bidi/ล่องหน) · <= 200 ตัวอักษร · <= 6 บรรทัด · ว่างทั้งหมด = ล้างค่า

## 8. Data model + RPC (คำถามข้อ 7) — DDL ตัวอย่าง Han เขียนจริงใน 0179/0180

```sql
-- 0179 §1 ตั้งค่าช่องทางชำระ
alter table analytics.oem_setting add column if not exists seller_payment_lines text[] not null default '{}';
-- v_oem_seller: copy select list จาก DB (ตรวจ ordinal_position ก่อน — traps ข้อ 3) แล้ว append seller_payment_lines ท้ายสุด
-- RPC analytics.oem_setting_set_payment_lines(p_shop_id uuid, p_lines text[], p_actor_id uuid default null) returns void
--   security definer · search_path pinned · crm_require_owner_admin · ตรวจแต่ละบรรทัดด้วย oem_note_valid · revoke public/anon/authenticated · grant service_role

-- 0179 §2 ตารางเอกสาร
create table analytics.oem_invoice (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  quote_id uuid not null references analytics.oem_quote (id) on delete restrict,
  invoice_no text not null,
  kind text not null check (kind in ('deposit','balance')),
  status text not null default 'issued' check (status in ('issued','void')),
  amount_thb numeric(14,2) not null check (amount_thb > 0),
  vat_display text not null check (vat_display in ('none','included','breakdown')),
  vat_rate numeric(6,4) not null,
  vat_base_thb numeric(14,2), vat_amount_thb numeric(14,2),
  constraint oem_invoice_vat_shape check (
    (vat_display = 'none' and vat_base_thb is null and vat_amount_thb is null)
    or (vat_display <> 'none' and vat_base_thb + vat_amount_thb = amount_thb)),
  issue_date date not null, due_date date not null, check (due_date >= issue_date),
  description text not null, note text,
  seller_snapshot jsonb not null, payment_lines text[] not null check (cardinality(payment_lines) > 0),
  buyer_legal_name text not null, buyer_tax_id text, buyer_branch_label text, buyer_address jsonb,
  quote_no_snapshot text not null, lines_snapshot jsonb not null check (jsonb_typeof(lines_snapshot) = 'array'),
  pieces_subtotal_snapshot numeric(14,2), nre_price_snapshot numeric(14,2), discount_thb_snapshot numeric(14,2) not null default 0,
  grand_total_snapshot numeric(14,2) not null, deposit_amount_snapshot numeric(14,2), deposit_pct_snapshot numeric(5,4),
  paid_before_thb numeric(14,2) not null default 0, balance_after_thb numeric(14,2) not null,
  constraint oem_invoice_balance_exact check (paid_before_thb + amount_thb + balance_after_thb = grand_total_snapshot),
  void_reason text, voided_at timestamptz, voided_by uuid,
  replaces_invoice_id uuid references analytics.oem_invoice (id),
  created_by uuid, created_at timestamptz not null default now(),
  unique (shop_id, invoice_no)
);
-- RLS enable · ไม่มี policy · revoke all from public, anon, authenticated · grant select on oem_invoice to service_role (insert/update ผ่าน definer เท่านั้น)
-- revoke truncate on analytics.oem_invoice from service_role (0018 default privilege ยังครอบ — หนี้ที่ memory oem-quote-v2-status เตือนไว้)
-- trigger: before update or delete → oem_invoice_deny_mutation() ลอก 0086 (issued->void เท่านั้น · to_jsonb(new) - [status,void_reason,voided_at,voided_by] ต้องเท่า old)
-- trigger: before truncate for each statement → reuse analytics.oem_receipt_deny_truncate() (แค่ raise ใช้ร่วมได้)

-- 0179 §3 RPC
-- analytics.oem_invoice_issue(p_shop_id uuid, p_quote_id uuid, p_kind text, p_due_date date,
--   p_note text default null, p_replaces_invoice_id uuid default null, p_actor_id uuid default null) returns uuid
-- analytics.oem_invoice_void(p_shop_id uuid, p_invoice_id uuid, p_reason text, p_actor_id uuid default null) returns void
-- view analytics.v_oem_invoice (security_invoker) · grant select to service_role

-- 0180 ผูกใบเสร็จ
alter table analytics.oem_receipt add column if not exists invoice_id uuid references analytics.oem_invoice (id) on delete restrict,
                                  add column if not exists invoice_no_snapshot text;
create unique index oem_receipt_one_issued_per_invoice on analytics.oem_receipt (invoice_id) where status = 'issued' and invoice_id is not null;
drop function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid);   -- 9 args เดิม (traps ข้อ 1)
-- create function ... 10 args (+ p_invoice_id uuid default null) — body ลอกจาก DB จริง (pg_get_functiondef) ไม่ใช่ไฟล์ 0088 (traps ข้อ 21)
-- revoke ... from public, anon, authenticated; grant ... to service_role;  -- 0088 ยัง grant authenticated อยู่ ต้องแก้ตรงนี้ (traps ข้อ 18)
```

**ลำดับใน `oem_invoice_issue`:** validate args (kind ∈ 2 ค่า · due_date ช่วง · note รูปร่าง) → `crm_require_owner_admin(p_shop_id)` + `v_actor := coalesce(auth.uid(), (select id from auth.users where id = p_actor_id))` (pattern 0165/0172) → **lock แถว quote `for update`** (แถว active ของ chain — ล็อกตัวเดียวกับ `oem_receipt_issue` ⇒ ออกใบแจ้งหนี้กับบันทึกรับเงินพร้อมกันถูก serialize) → gate สถานะ quote → gate seller (legal_name + address ไม่ว่าง · payment_lines ไม่ว่าง) → gate buyer (customer_id + legal_name) → อ่าน `v_oem_quote` แถวนั้น (deposit_amount_thb / outstanding_thb / paid_thb / grand_total / vat_mode / vat_rate) → gate ตาม §2 → gate "ไม่มี invoice เปิดค้างในดีล" (issued และไม่มี receipt issued อ้าง) → `p_replaces_invoice_id` ถ้ามี: ต้อง void แล้ว + ดีลเดียวกัน → ประกอบ `lines_snapshot` ทีละคีย์ → VAT ตาม §6 → ออกเลข (counter) → insert → audit → return id
**`oem_invoice_void`:** `for update` แถว invoice → issued เท่านั้น → `oem_note_present(p_reason)` → ถ้ามี receipt issued อ้างอยู่ → **ปฏิเสธ** ("ใบนี้ถูกชำระแล้ว ยกเลิกใบเสร็จก่อน") → update 4 คอลัมน์ → audit
**Audit:** ขยาย CHECK ของ `oem_quote_audit.action` ให้รับ `'invoice_issue'`, `'invoice_void'` (ALTER constraint — ตาราง append-only แต่ DDL ไม่ติด trigger) · `after` = `{invoice_id, invoice_no, kind, amount_thb}` ไม่มี PII เกินนี้ · ทำไมไม่สร้างตาราง audit ใหม่: 0165 สร้างตารางนี้ไว้เพื่อ OEM โดยเฉพาะแล้ว

**`v_oem_invoice`** = `i.*` + `q.quote_no` (ปัจจุบัน) + `q.status as quote_status` + `is_deal_active` + จาก lateral ใบเสร็จ issued ที่อ้าง: `receipt_id / receipt_no / received_date` + จาก lateral แถว active ของ chain + sum receipt ของดีล: `payment_state` · `is_stale` · `is_overdue` (วันนี้ = Asia/Bangkok) · **ไม่แตะ `v_oem_quote`** (0172-0174 join มันอยู่ 9 จุด — UI ดึงรายการ invoice ของดีลจาก `v_oem_invoice` แยก เหมือนที่ `receipts` ถูกส่งแยกเข้า `ReceiptSection` อยู่แล้ว)
**Grant/RLS (traps ข้อ 18):** ทุก object ใหม่ grant ให้ `service_role` เท่านั้น · หน้าเว็บอ่านผ่าน server action (`requireOwnerAdmin` + service client) เหมือน receipts · ปิดท้าย migration รัน `scripts/check-analytics-grants.sql`

## 9. เคสห้ามผ่าน + เคสต้องไม่พัง (คำถามข้อ 8) — ล็อกใน `scripts/verify/verify-0179.sql` / `verify-0180.sql`

ทุกเคสรันใน do-block เดียว ปิดด้วย `raise` (traps ข้อ 11) · เก็บ `last_no` ของทุกแถว `RT-%` + `count(*)` ของ `oem_receipt`/`oem_invoice` + md5 ของ `updated_at` ก่อน/หลัง · 🔴 ต้องมีเคส "ยิง RPC ใหม่ใส่ใบจริง OEM-2610-004 ใน rollback" (traps ข้อ 17)

| # | เคสห้ามผ่าน | ตกที่ด่าน | errcode |
|---|---|---|---|
| 1 | issue บน quote `draft` / `lost` / `rejected` / `superseded` | gate สถานะ (superseded → ชี้ใบ active) | 22023 |
| 2 | issue กับ `p_kind` อื่นนอกจาก deposit/balance · due_date < วันนี้ไทย · > +365 · null | validate args | 22023 |
| 3 | deposit เมื่อ `deposit_mode is null` / `paid_thb > 0` / `deposit_amount_thb <= 0` / `> grand_total` | gate §2 | 22023 |
| 4 | balance เมื่อ `outstanding_thb <= 0` · มี deposit_mode แต่ยังไม่รับมัดจำ · `outstanding < 0` (มัดจำ thb > ยอด) | gate §2 | 22023 |
| 5 | seller: legal_name ว่าง / address ว่าง / **payment_lines ว่าง** | gate seller | 22023 |
| 6 | quote ไม่มี `customer_id` / customer ไม่มี legal_name | gate buyer | 22023 |
| 7 | ดีลมี invoice `issued` + unpaid อยู่แล้ว → issue ใบที่สอง (ทั้ง kind เดิมและต่าง kind) | gate เปิดค้าง 1 ใบ (หลัง lock quote) | 22023 |
| 8 | 2 session issue พร้อมกันบนดีลเดียว → ได้ 1 ใบ อีกใบตกข้อ 7 · เลขไม่ชน | row lock quote + counter | — (ไม่มีเทสต์ใน do-block เดียว — ต้อง 2 connection · บอกตรงๆ ในตารางแมป) |
| 9 | `p_replaces_invoice_id` ชี้ใบที่ยัง issued / คนละดีล / คนละร้าน | gate replaces | 22023 |
| 10 | note / void reason มีแต่อักขระล่องหน · control/bidi · > 500 | `oem_note_present` / `oem_note_valid` | 22023 |
| 11 | UPDATE ตรงคอลัมน์ใดนอกจาก 4 คอลัมน์ void · DELETE · TRUNCATE (ทั้งในฐานะ postgres และ service_role) | trigger deny_mutation / deny_truncate / revoke | 22023 |
| 12 | void ใบที่ void แล้ว · void ใบที่มีใบเสร็จ issued อ้าง | `oem_invoice_void` | 22023 |
| 13 | `lines_snapshot` มีคีย์นอก whitelist 6 ตัว · มีคำว่า cost/margin/calc ในค่าใดๆ ของ jsonb | assert ในเทสต์ (`jsonb_object_keys` ทุก element) | — |
| 14 | `seller_vat_registered=false` → `vat_display='none'` + base/vat null · description ไม่มี "ภาษี"/"VAT" | assert | — |
| 15 | role `authenticated` (จำลอง grant usage กลับ — traps 18.5) ยิง `oem_invoice_issue(null,...)` / select `oem_invoice` / `v_oem_invoice` | 42501 | 42501 |
| 16 | **0180** receipt อ้าง invoice: คนละร้าน / void / มีใบเสร็จ issued อ้างแล้ว / คนละดีล / `p_amount_thb` ต่าง 0.01 / kind ไม่แมป (deposit invoice + p_kind=final) | gate p_invoice_id | 22023 |
| 17 | **0180** reissue ใบเสร็จที่เคยอ้าง IV-001 โดยส่ง p_invoice_id อื่น/null · reissue ใบเสร็จที่ไม่เคยอ้างแต่ส่ง p_invoice_id | ล็อกตัวที่ 6 | 22023 |
| 18 | **0180** insert ใบเสร็จ issued ใบที่สองอ้าง invoice เดียวกัน (ทะลุ RPC) | partial unique index | 23505 |
| 19 | **0180** ไม่มี overload `oem_receipt_issue` เหลือ 2 signature (traps ข้อ 1) | `pg_proc` count = 1 | — |

| # | เคสต้องไม่พัง |
|---|---|
| A | `oem_receipt_issue` 9 ค่าเดิม (ไม่ส่ง p_invoice_id) บนใบจริง OEM-2610-004 ใน rollback → ได้ใบเสร็จ + quote พลิก won + `invoice_id` null — พฤติกรรม 0088 เป๊ะ |
| B | ใบที่ไม่มี invoice เลย รับเงินมัดจำ → ปิดยอด → `is_fully_paid` เหมือนเดิม · `oem_receipt_void` / reissue 5-way lock ผ่านเหมือนเดิม |
| C | `oem_doc_counter` แถว `RT-%` `last_no` เท่าเดิมทุกแถวหลังออกใบแจ้งหนี้ · แถว `IV-%` เริ่ม 1 และ +1 ทีละใบ · void แล้วใบถัดไปได้เลขถัดไป (ไม่ reuse) |
| D | flow A/B เต็ม: ยอดคี่ 10,001 → IV deposit 5,000.50 → RT อ้าง IV ยอดเท่ากัน → IV balance 4,999.50 → RT อ้าง → `is_fully_paid` · `paid_before + amount + balance_after = grand` ทุกใบ |
| E | ต่อราคาหลังออก IV → ใบใหม่ของ chain ออกได้ · IV เดิม `is_stale=true` · void IV เดิมแล้วออก IV ใหม่ด้วย `replaces_invoice_id` · ยอดใหม่ = outstanding ของแถว active |
| F | void ใบเสร็จที่อ้าง IV → IV กลับเป็น `unpaid` (ไม่มี UPDATE ที่ `oem_invoice`) → ออกใบเสร็จใหม่ reissue อ้าง IV เดิมได้ |
| G | `v_oem_quote` ไม่เปลี่ยน (ordinal_position + md5 นิยาม view) · `v_oem_seller` append ท้ายเท่านั้น · RPC job_* ของ 0172-0174 ที่ join `v_oem_quote` ยังเรียกได้ |
| H | `seller_vat_registered=true` + `vat_mode='breakdown'` → base+vat = amount ทุกยอดที่หาร 1.07 ไม่ลงตัว (100 · 5,000.50 · 33.33) |
| I | ใบเสร็จเดิมบน prod (RT-2608-016 เป็นต้นไป) `invoice_id`/`invoice_no_snapshot` = null หลัง 0180 · `count(distinct updated_at)` ของ `oem_receipt`/`oem_quote` เท่าเดิม (traps ข้อ 19 — 0180 ไม่มี UPDATE) |
| J | `oem_setting_upsert` 24 args เดิมยังเรียกได้ · `seller_payment_lines` ไม่ถูกทับเป็น `{}` ตอน upsert ค่าอื่น |

## 10. หน้าจอระดับรายการ (คำถามข้อ 9 — ส่ง ux-ui ทำ wireframe)

1. **หน้าตั้งค่า > ข้อมูลร้าน (`SellerProfileSection.tsx`)** — เพิ่มกล่อง "ช่องทางชำระเงิน (พิมพ์บนใบแจ้งหนี้)" textarea บรรทัดละช่องทาง · ว่าง = ข้อความเตือนว่าออกใบแจ้งหนี้ไม่ได้ · placeholder `TODO_OWNER_BANK_ACCOUNT` · บันทึกผ่าน `setSellerPaymentLines` (RPC แยก)
2. **หน้าใบเสนอราคา (`QuoteDetailClient`)** — `InvoiceSection.tsx` วางเหนือ `ReceiptSection` (ลำดับเวลาจริง: แจ้งหนี้ → รับเงิน) · ตารางใบแจ้งหนี้ของดีล (เลขที่ · ชนิด · ยอด · กำหนดชำระ · สถานะ: รอชำระ/ชำระแล้ว(RT-…)/ยอดเปลี่ยน/เลยกำหนด/ยกเลิก · ปุ่มพิมพ์ · ปุ่มยกเลิก) · ปุ่ม "ออกใบแจ้งหนี้" โชว์เมื่อ status ∈ quoted/expired/won และไม่มีใบเปิดค้าง · ใบ void โชว์จาง ไม่ซ่อน
3. **`InvoiceIssueDialog.tsx`** — เลือกชนิด (radio): "มัดจำ — ยอด X" (disabled + เหตุผลถ้า DB จะปฏิเสธ: ยังไม่ตั้งมัดจำ / รับเงินแล้ว) · "ยอดคงเหลือ — ยอด Y" (disabled ถ้า outstanding<=0 หรือมีมัดจำที่ยังไม่รับ) — ตัวเลขอ่านจาก `quote.depositAmountThb` / `quote.outstandingThb` **แสดงอย่างเดียว ไม่ส่งไป RPC** · กำหนดชำระ (date, prefill +7 วัน [ต้องยืนยัน]) · หมายเหตุถึงลูกค้า (optional) · preview ท่อน VAT ตาม vatMode/vatRegistered · เตือน "ออกแล้วแก้ไม่ได้ ยกเลิกได้อย่างเดียว" · ถ้า payment lines ว่าง → ปุ่มบันทึก disabled + ลิงก์ไปตั้งค่า
4. **`VoidInvoiceDialog.tsx`** — ลอก `VoidReceiptDialog` (เหตุผลบังคับ) · ถ้าใบถูกชำระแล้ว ปุ่มไม่โชว์ (DB ปฏิเสธอยู่ดี)
5. **`ReceiptIssueDialog.tsx` (แก้)** — เมื่อดีลมี invoice เปิดค้าง: แถว "อ้างอิงใบแจ้งหนี้ IV-… ยอด X" ติ๊กไว้เป็นค่าเริ่มต้น → ช่องยอด**ล็อก**เท่ากับ invoice + kind ตามใบ · ติ๊กออก = โหมดเดิม (ยอดอิสระ) พร้อมเตือน "ใบแจ้งหนี้จะถูกตีเป็นยอดเปลี่ยน ต้องยกเลิกเอง" · ส่ง `invoiceId` เฉพาะตอนติ๊ก
6. **หน้ารวม `/oem/invoices` (`InvoicesPageClient.tsx`)** — รายการทุกใบ กรองเดือน/สถานะชำระ (ลอก `ReceiptsPageClient`) · แท็บใหม่ "ใบแจ้งหนี้" ใน `OemSubNav` ระหว่าง ใบเสนอราคา กับ ใบเสร็จ · เพิ่ม `/oem/invoices` ใน `OEM_PATHS` ของ actions
7. **หน้าพิมพ์ `/oem/invoices/[id]/print` (`PrintInvoiceClient.tsx`)** — A4 copy CSS จาก `PrintReceiptClient` (ไม่ share component — เหตุผล 0084 §8) · โครงตาม §7 · แถบจอ `print:hidden`: stale (บล็อกพิมพ์) / หมดอายุ / เลยกำหนด · ลายน้ำ "ยกเลิก" พิมพ์ได้ · ไม่มี toggle ต้นฉบับ/สำเนา
8. **`ReceiptSection` + หน้าพิมพ์ใบเสร็จ** — โชว์ "อ้างอิงใบแจ้งหนี้ IV-…" จาก `invoice_no_snapshot` (บรรทัดเล็กใต้รายการ — เป็น field ใหม่ของ `PrintableReceipt` ที่ต้องตัดสินใจเพิ่มเอง field-by-field)

## 11. ไฟล์ที่ต้องสร้าง/แก้

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/0179_oem_invoice.sql` | §8: `seller_payment_lines` + RPC ตั้งค่า + `v_oem_seller` append · `oem_invoice` + RLS/grant/trigger · `oem_invoice_issue` / `oem_invoice_void` · `v_oem_invoice` · ขยาย CHECK `oem_quote_audit.action` · `notify pgrst, 'reload schema'` |
| `supabase/migrations/0180_oem_receipt_invoice_link.sql` | `oem_receipt.invoice_id` + `invoice_no_snapshot` · partial unique index · drop 9-arg + create 10-arg `oem_receipt_issue` (body จาก DB) · revoke/grant ถูกต้อง · `v_oem_receipt` ใช้ `r.*` อยู่แล้ว ได้คอลัมน์ใหม่เอง (ตรวจว่า view ไม่ต้อง recreate) |
| `scripts/verify/verify-0179.sql` · `verify-0180.sql` | §9 ทุกเคส + ตารางแมป "ข้อในบรีฟ → เทสต์" |
| `lib/oem/types.ts` | `OemInvoiceRow` · `OemInvoiceKind` · `OemInvoiceStatus` · `OemInvoicePaymentState` · `IssueInvoiceInput` · `VoidInvoiceInput` · เพิ่ม `invoiceId?` ใน `IssueReceiptInput` · เพิ่ม `invoiceId/invoiceNoSnapshot` ใน `OemReceiptRow` · `sellerPaymentLines` ใน seller type |
| `lib/actions/oem.ts` | `issueInvoice` / `voidInvoice` / `getInvoices(quoteId?)` / `getInvoice(id)` / `setSellerPaymentLines` (pattern `issueReceipt`: `requireOwnerAdmin` → validate รูปร่าง → rpc + `p_actor_id` จาก `getActorId()` → `ActionResult` · ห้าม log error ทั้งก้อน) · `issueReceipt` ส่ง `p_invoice_id` เฉพาะเมื่อมี |
| `lib/oem/printableInvoice.ts` | `PrintableInvoice` + `toPrintableInvoice()` field-by-field (copy header กฎจาก `printableReceipt.ts`) |
| `components/domain/oem/InvoiceSection.tsx` · `InvoiceIssueDialog.tsx` · `VoidInvoiceDialog.tsx` · `InvoicesPageClient.tsx` · `PrintInvoiceClient.tsx` | §10 |
| `components/domain/oem/ReceiptIssueDialog.tsx` · `ReceiptSection.tsx` · `PrintReceiptClient.tsx` · `lib/oem/printableReceipt.ts` · `SellerProfileSection.tsx` · `OemSubNav.tsx` · `QuoteDetailClient.tsx` | แก้ตาม §10 ข้อ 1/5/6/8 |
| `app/(dashboard)/oem/invoices/page.tsx` · `loading.tsx` · `[id]/print/page.tsx` | ลอกโครง `receipts/` |
| `app/(dashboard)/oem/quotes/[id]/page.tsx` (หรือที่โหลด receipts) | โหลด `getInvoices(quoteId)` ส่งเข้า `InvoiceSection` |
| `docs/3j-jewelry/INDEX.md` · `READING-LISTS.md` หัวข้อ 1 | ชี้ไฟล์นี้ (ทำแล้วในรอบ design) · ตอน apply ให้เพิ่ม `0179-0180` ในบรรทัด migrations |
| memory `oem-quote-v2-status` | ตอนส่งมอบ: 1 บรรทัดสถานะ (ไม่ใช่รอบนี้) |

## 12. แผน phase + ระดับ QA/security + คำถามเจ้าของ (คำถามข้อ 10)

| phase | งาน | ระดับ | ทำไมลำดับนี้ |
|---|---|---|---|
| **I1** | 0179 (ตั้งค่าช่องทางชำระ + ใบแจ้งหนี้ + view) + verify-0179 | **💰** — แตะตัวนับเอกสาร + เอกสารส่งออกนอกร้าน → security ก่อน merge | ใช้งานได้ทันทีแบบ flow C (ออกใบแจ้งหนี้ · รับเงินแบบเดิมไม่อ้างใบ · ใบกลายเป็น stale แล้ว void) — คุณค่าออกก่อนโดยยังไม่แตะ RPC ภาษี |
| **I2** | 0180 (ผูกใบเสร็จ: 10-arg `oem_receipt_issue` + partial unique index) + verify-0180 | **💰** — replace RPC ใบกำกับภาษี · drop signature | แยกไฟล์ให้ diff ของ RPC ภาษีเล็กและ review ได้ทีละอย่าง · ถ้า I2 ตีกลับ I1 ยังอยู่ได้ |
| **I3** | UI ทั้งหมด (§10) — แตก 2 worktree ถ้าขนาน: (a) ตั้งค่า + invoice section/dialog/list/print (b) receipt dialog/print แก้ตาม 0180 | QA **L** (ทุก flow ที่ผูก: quote detail · receipts · settings · print ทั้ง 3 เอกสาร · view-source RSC payload ของหน้าพิมพ์ใหม่หาเลขต้นทุนจาก DB) | UI หลัง DB apply + security GO เท่านั้น |

ก่อน UAT: ✅ verify ผ่านใน rollback + `check-analytics-grants` สะอาด · ⚠️ ช่องทางชำระยังว่างจนเจ้าของกรอก · 🎯 ให้เจ้าของดูกระดาษใบแจ้งหนี้มัดจำของ OEM-2610-004 (ออกจริง 1 ใบ = เลข IV-2610-001 เผาจริง — ยืนยันก่อน)

**คำถามเจ้าของ (จำเป็นจริง 4 ข้อ):**
- **Q1 (ภาษี — ส่งนักบัญชี/สรรพากร ทีมไม่ตอบ):** (ก) ลูกค้านิติบุคคลที่ขอ "ใบแจ้งหนี้/ใบกำกับภาษี" ก่อนจ่าย ร้านจะออกไหม — ถ้าใช่ เป็นงานอีกรอบ (doc_type ใหม่ + ด่านชุดใบเสร็จ) (ข) ใบแจ้งหนี้ที่แสดงบรรทัด VAT แยกตามใบเสนอราคา มีผลทางภาษีไหมเมื่อยังไม่รับเงิน (ค) ต้องพิมพ์ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" หรือไม่ — ✅ **เจ้าของตอบแล้ว 16 ต.ค. (§15.1): VAT ตามใบเสนอราคา · พิมพ์ข้อความ (ค) · (ก) ออกใบกำกับภาษีพร้อมสินค้า = phase แยก**
- **Q2 (ค่าจริง):** ข้อความช่องทางชำระเงินทุกบรรทัด (ธนาคาร/เลขบัญชี/ชื่อบัญชี/พร้อมเพย์) — เจ้าของกรอกเองในหน้าตั้งค่าก่อน UAT · ทีมไม่ใส่ค่าใดๆ
- **Q3 (นโยบาย):** กำหนดชำระเริ่มต้นกี่วัน (design ใส่ 7 วันเป็น prefill แก้ได้) · ออกใบแจ้งหนี้ให้ใบเสนอราคาที่**หมดอายุแล้ว**ได้ไหม (design: ได้ + เตือนพนักงาน)
- **Q4 (ยอดไม่ตรง):** ลูกค้าโอนขาด/เกินจากยอดใบแจ้งหนี้ — design: บันทึกรับเงินโดยไม่อ้างใบ แล้วยกเลิกใบแจ้งหนี้ด้วยเหตุผล (ไม่มี "ชำระบางส่วนต่อใบ") รับได้ไหม หรืออยากได้ชำระบางส่วน/ค่าธรรมเนียมโอนในรอบถัดไป

## 13. Trade-offs — ทางเลือกที่ตัดทิ้ง

| ตัดทิ้ง | เพราะ |
|---|---|
| ใบแจ้งหนี้ "แก้ได้" (ไม่ใช่เอกสารภาษี) | ลูกค้าถือกระดาษแล้ว · ต้องออกแบบด่าน "แก้ได้บางคอลัมน์" ใหม่ทั้งชุดแทนที่จะลอก trigger/verify ของใบเสร็จ · ประวัติยอดที่เคยแจ้งหายไป |
| `oem_invoice.settled_receipt_id` (invoice ชี้ receipt) | ต้อง UPDATE invoice ตอนออกใบเสร็จ**และ**ตอน void ใบเสร็จ → `oem_receipt_void` (RPC ภาษี) ต้องรู้จักตารางอื่น · เลือก receipt → invoice แล้ว derive แทน |
| รับ `p_amount_thb` ในใบแจ้งหนี้ (ยอดอิสระ/หลายงวด) | เปิดช่องให้ยอดใบแจ้งหนี้ ≠ ใบเสนอราคา · เคสจริง = มัดจำ 1 + ปิด 1 · ประตูเปิดที่ `kind` CHECK |
| append คอลัมน์ invoice เข้า `v_oem_quote` | 0172-0174 join view นี้ 9 จุด · 42P16 risk · UI ดึง `v_oem_invoice` แยกได้เหมือน receipts |
| ขยาย `oem_setting_upsert` รับ payment lines | 24 args · drop signature + overload risk (traps 1) เพื่อ field เดียว · RPC เล็กแยกปลอดภัยกว่า |
| bank/account_no/account_name แยกคอลัมน์ | ไม่รู้โครงจริงของร้าน (พร้อมเพย์? หลายบัญชี?) — text[] ไม่เดา (memory `no-realistic-placeholders`) |
| ล็อก renegotiate เมื่อมีใบแจ้งหนี้เปิดค้าง | กลับลำดับงานจริง (ต่อราคาก่อนค่อยออกใบใหม่) · `is_stale` + บล็อกพิมพ์ ให้ผลเดียวกันโดยไม่ขวาง |
| ใบแจ้งหนี้พลิก quote เป็น won | ใบแจ้งหนี้ = ขอเงิน ไม่ใช่ตกลง · won เกิดที่ใบเสร็จ (0084) เหมือนเดิม |
| ใบเสร็จอ้าง invoice แบบ "ยอดใกล้เคียง" (ค่าธรรมเนียมโอน) | ด่านที่มีข้อยกเว้นต้องแคบพอพิสูจน์ได้ (invariants §7) — เท่ากันเป๊ะ ไม่งั้นไม่อ้าง (Q4) |
| ทำ 0179+0180 เป็นไฟล์เดียว | diff ของ RPC ใบกำกับภาษีควรถูก review โดดๆ · I1 ใช้ได้เองแบบ flow C |

## 14. ความเสี่ยงตอน implement (จุดที่คนต่อไปจะพลาด)

1. **`oem_receipt_issue` 10 args** — ต้อง `drop function` signature 9 args ก่อน (traps 1) · body ลอกจาก `pg_get_functiondef` บน DB ไม่ใช่ไฟล์ 0088 (traps 21 — ตรวจก่อนว่าไม่มี migration หลัง 0088 replace มันอีก: grep ตอนนี้ = ไม่มี แต่เช็ค DB อีกครั้ง) · grant ใหม่ต้องเป็น `service_role` เท่านั้น (0088 ยังเขียน `authenticated` — ลอกมา = เปิดรูกลับ traps 18) · caller เดิมใน `lib/actions/oem.ts` ไม่ส่ง `p_invoice_id` ต้องยังทำงาน (PostgREST match ชื่อพารามิเตอร์ + default)
2. **`v_oem_seller` append** — ลอก select list จาก DB ตรวจ `ordinal_position` (traps 3) · ห้ามแทรกกลาง
3. **`lines_snapshot` รั่วต้นทุน** — ห้าม `to_jsonb(item)`/`row_to_json` · เทสต์ข้อ 13 ไล่ `jsonb_object_keys` ทุก element · QA view-source หน้าพิมพ์หาเลข `cost_piece` จริงของ OEM-2610-004 ใน RSC payload
4. **เผาเลข IV บน prod ตอนทดสอบ** — do-block + raise เท่านั้น (บทเรียน RT-2608-016) · เทสต์ UI บน prod ออกใบจริงได้ 1 ใบเดียวที่เจ้าของยืนยัน
5. **วันที่** — `issue_date` / due gate / `is_overdue` / YYMM ใช้ `(now() at time zone 'Asia/Bangkok')::date` ทุกจุด · เทสต์อย่า assert `now()` ไล่เพิ่ม (traps 22)
6. **ด่านตาบอด** — `deposit_amount_thb`/`outstanding_thb` จาก view เป็น null ได้ (ไม่มี grand_total) ใช้ `not (x > 0 and x <= 100000000)` ไม่ใช่ `is null` (traps 4/13) · `payment_lines` ต้องเช็ค `cardinality` และแต่ละบรรทัด `oem_note_present` ไม่ใช่ `<> ''`
7. **0018 default privilege** `grant all to service_role` ครอบ `oem_invoice` → ต้อง `revoke truncate/insert/update/delete from service_role` ชัดๆ + trigger (เหมือน 0087 §3)
8. **UI คำนวณเงินเอง** — dialog โชว์ยอดจาก `quote.depositAmountThb`/`outstandingThb` อย่างเดียว ห้ามบวกลบ · ใบเสร็จที่อ้าง invoice ล็อกยอดจาก `invoice.amountThb` ไม่ใช่จาก outstanding
9. **หน้าพิมพ์ใบแจ้งหนี้ลอก `isFullTaxInvoice` มาด้วย** — ห้าม · ไม่มี branch ใดที่ทำให้พาดหัวกลายเป็นใบกำกับภาษี
10. **ข้อความ error ของ `trg_oem_doc_counter_deny_mutation` อ้าง `oem_receipt_issue`** — หนี้เล็ก ยอมรับ จดไว้ · และ `v_oem_receipt` ใช้ `r.*` — คอลัมน์ใหม่โผล่ใน view เอง ตรวจว่า `OemReceiptRow`/`toPrintableReceipt` ไม่ spread

## 15. มติเจ้าของ (16 ต.ค. 69) — ทับค่าเริ่มใน §12

| # | มติ | ผลต่อ design |
|---|---|---|
| Q3 กำหนดชำระ | **มัดจำ = ชำระก่อนเริ่มงาน** · **ยอดคงเหลือ = 7 วันหลังส่งมอบ** | ใบมัดจำ: `due_date` ค่าเริ่ม = วันที่ออก + พิมพ์ข้อความ "ชำระก่อนเริ่มงาน" · ใบคงเหลือ: ค่าเริ่ม = วันที่ออก + 7 วัน (ออกตอนส่งมอบ) · แก้ได้ทุกใบตอนออก |
| Q3 ใบหมดอายุ | **ออกได้ แต่มีเตือน** | ตามค่าเริ่ม |
| Q4 รูปแบบชำระ | ปกติ **มัดจำ + จ่ายเต็มตอนจบ** · สัญญาที่จ่ายหลายงวด → ออกใบแจ้งหนี้แยกไปทีละงวด | รอบนี้ทำ deposit + balance ตามเดิม · โอนไม่ตรงยอด = บันทึกรับเงินไม่อ้างใบ + void ใบแจ้งหนี้ (ค่าเริ่ม — เจ้าของไม่ได้คัดค้าน) · **งวดหลายรอบ (kind `installment` ยอดกำหนดเอง) = phase ถัดไป** ประตูเปิดที่ CHECK `kind` + ด่าน "เปิดค้าง 1 ใบต่อดีล" ต้องทบทวนตอนนั้น |
| Q1 ภาษี | ยังไม่ได้คำตอบ — ส่งนักบัญชีของเจ้าของ (ทีมไม่ตอบ) | ตาม §12 |
| Q2 ช่องทางชำระ | เจ้าของกรอกเองในหน้าตั้งค่าก่อน UAT | ตาม §12 |

### 15.1 มติเจ้าของเรื่องภาษี (16 ต.ค. 69 — เจ้าของตอบ Q1 เอง)

| คำถาม | มติ | ผล |
|---|---|---|
| ใบแจ้งหนี้แสดง VAT ยังไง | **แสดงตามใบเสนอราคา** | ตาม §6 (`vat_display` แช่แข็งจาก `vat_mode`) |
| พิมพ์ "ไม่ใช่ใบกำกับภาษี" ไหม | **พิมพ์** | หน้าพิมพ์ใบแจ้งหนี้มีบรรทัดคงที่ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" ทุกใบ (ไม่ขึ้นกับ vat_display) — เป็นข้อความบนกระดาษ ไม่ใช่ print:hidden |
| ลูกค้าบริษัทขอใบกำกับภาษีก่อนจ่ายเงิน | **ออกใบกำกับภาษีพร้อมสินค้า (ตอนส่งมอบ)** | ⏸ **ไม่อยู่ใน I1/I2** — ระบบปัจจุบันออกใบกำกับภาษีได้ตอนรับเงินเท่านั้น (0084) · การออกใบกำกับภาษีตอนส่งของก่อนรับเงิน = เอกสารใหม่ (ใบส่งของ/ใบกำกับภาษี) + จุดเกิดภาษีย้ายจากวันรับเงินเป็นวันส่งมอบ + การรับเงินภายหลังต้องออกเป็นใบเสร็จที่ไม่ใช่ใบกำกับ → ต้อง design แยก (phase ถัดไป · 💰 security) · แนะนำให้นักบัญชียืนยันวิธีบันทึกภาษีขายก่อน implement |
