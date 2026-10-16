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
