# Design — รับชำระเงิน + ใบเสร็จรับเงิน/ใบกำกับภาษี (OEM) — migration 0084

> Architect (Yoda) · 2026-08-26 · ต่อจาก 0075–0083 (ทั้งหมด applied แล้ว, 0083 กำลังเขียนคู่ขนาน)
> การตัดสินใจเจ้าของที่ถือเป็น final: (1) เอกสาร = "ใบเสร็จรับเงิน/ใบกำกับภาษี" รวมใบเดียว
> (2) ขอบเขต = รับมัดจำ + เก็บก้อนที่เหลือจนปิดงาน ไม่ทำใบแจ้งหนี้/ใบลดหนี้รอบนี้ แต่ไม่ปิดทาง
> สมมติฐานทั้งไฟล์: grand_total **รวม VAT แล้ว** (ดู §10 ถ้าคำตอบพลิก)

---

## 1. Design overview

**หลักการเดียวที่คุมทั้ง design:** ใบเสนอราคาเป็น "เอกสารมีชีวิต" (ต่อราคาได้ view คำนวณสด)
แต่ใบเสร็จ/ใบกำกับภาษีเป็น "เอกสารตายตัว" (ออกแล้วห้ามขยับแม้แต่สตางค์เดียว) —
ดังนั้นตาราง oem_receipt **เก็บผลลัพธ์ที่คำนวณแล้ว + snapshot คู่สัญญาทั้งสองฝั่ง**
ซึ่งตรงข้ามกับหลักการ 0081/0082 ("เก็บ input ไม่เก็บผลลัพธ์") โดยตั้งใจ — คนละชนิดเอกสาร คนละกติกา

```
oem_quote (deal, ต่อราคาได้, chain ผ่าน root_quote_id)
   | 1 deal -> N งวดชำระ
   v
oem_receipt (1 แถว = รับเงิน 1 ครั้ง = เอกสาร 1 ใบ, immutable, void ได้อย่างเดียว)
   ^ เลขที่จาก oem_doc_counter (row-lock, gap-free)

Flow: กด "บันทึกรับเงิน" บนหน้า quote detail
  -> oem_receipt_issue (RPC: lock quote -> gate -> snapshot -> คำนวณฐาน/VAT -> ออกเลข -> insert 'issued')
  -> ถ้าใบยังไม่ won: ตั้ง won อัตโนมัติ (จ่ายมัดจำ = รับงาน)
  -> v_oem_quote โชว์ paid_thb / outstanding_thb / is_fully_paid (คำนวณสดระดับ deal)
  -> พิมพ์ที่ /oem/receipts/[id]/print (อ่านจาก snapshot บนแถว receipt เท่านั้น)
```

**Payment กับ Receipt เป็นตารางเดียว ไม่แยกสอง** — เพราะกฎหมายบังคับให้สองสิ่งนี้เกิดพร้อมกันเสมอ
(รับเงินมัดจำงานบริการ = ภาระ VAT เกิดทันที = ต้องออกใบกำกับทันที) ไม่มี state "รับเงินแล้วยังไม่ออกใบ"
ที่ถูกกฎหมายให้ model · void เอกสาร = void การรับเงินครั้งนั้นในเชิงบัญชีด้วย แล้วออกใบใหม่ (reissue)
· **Trade-off:** ถ้าวันหน้ามี "รับเงินหลายก้อนออกใบเดียว" ต้องแตกตาราง — ยอมรับ เพราะ YAGNI
และเคสจริงของร้านคือมัดจำ 1 + ปิดยอด 1 · ใบลดหนี้ในอนาคต = ตารางใหม่ oem_credit_note
FK ชี้กลับ oem_receipt.id — โครงปัจจุบันไม่มีอะไรขวาง (ประตูเปิดไว้แล้วโดยไม่ต้องสร้างอะไรวันนี้)

---

## 2. โครงข้อมูล (DDL ตัวอย่าง — Han เขียนจริงใน 0084)

```sql
-- 2.1 ตัวนับเลขเอกสาร (gap-free) — client ห้ามแตะตรงๆ (RLS เปิดแต่ไม่มี policy;
--     ฟังก์ชัน security definer เท่านั้นที่อ่าน/เขียน)
create table analytics.oem_doc_counter (
  shop_id  uuid not null references public.shop (id) on delete cascade,
  doc_key  text not null,          -- เช่น 'RT-2608' (prefix + YYMM เวลาไทย)
  last_no  int  not null default 0,
  primary key (shop_id, doc_key)
);
alter table analytics.oem_doc_counter enable row level security;  -- no policies = ปิดตาย

-- 2.2 ใบเสร็จรับเงิน/ใบกำกับภาษี — 1 แถว = รับเงิน 1 ครั้ง = เอกสาร 1 ใบ
create table analytics.oem_receipt (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references public.shop (id) on delete cascade,
  quote_id                 uuid not null references analytics.oem_quote (id) on delete restrict,
  receipt_no               text not null,                  -- 'RT-YYMM-###'
  kind                     text not null check (kind in ('deposit','partial','final')),
  status                   text not null default 'issued' check (status in ('issued','void')),
  -- ---- ตัวเงิน: คำนวณครั้งเดียวตอน issue แล้วแช่แข็ง (ต่างจาก v_oem_quote โดยตั้งใจ) ----
  amount_thb               numeric(14,2) not null check (amount_thb > 0),   -- ยอดรับจริง (รวม VAT)
  vat_rate                 numeric(6,4)  not null,          -- snapshot จาก oem_quote.vat_rate
  vat_base_thb             numeric(14,2) not null,          -- round(amount/(1+rate), 2)
  vat_amount_thb           numeric(14,2) not null,          -- amount - vat_base (remainder แบบ 0082)
  constraint oem_receipt_sum_exact check (vat_base_thb + vat_amount_thb = amount_thb),
  -- ---- ข้อมูลรับเงิน ----
  received_date            date not null,                   -- วันรับเงิน (tax point ของงานบริการ)
  issue_date               date not null,                   -- วันออกเอกสาร (ปกติ = received_date)
  payment_method           text check (payment_method in ('transfer','cash','other')),
  payment_ref              text,                            -- เลขอ้างอิงโอน (optional)
  description              text not null,                   -- บรรทัดรายการบนเอกสาร (RPC generate, override ได้ตอน issue)
  -- ---- snapshot คู่สัญญา ณ วันออก (oem_setting/oem_customer แก้ทีหลังได้ เอกสารห้ามขยับตาม) ----
  seller_snapshot          jsonb not null,  -- {legal_name, address_lines, tax_id, branch_label, phone}
  buyer_legal_name         text  not null,
  buyer_tax_id             text,            -- nullable (บุคคลธรรมดาไม่บังคับ) — ห้ามเก็บข้อมูลอ่อนไหวเกินนี้
  buyer_branch_label       text,            -- 'สำนักงานใหญ่' / 'สาขา 00001' — จำเป็นเมื่อผู้ซื้อจด VAT
  buyer_address            jsonb,
  -- ---- ข้อมูลประกอบ (informational snapshot — กัน reprint เพี้ยนเมื่อ deal ขยับทีหลัง) ----
  quote_no_snapshot        text not null,
  grand_total_snapshot     numeric(14,2) not null,          -- ยอดทั้ง deal ณ วันออกใบนี้
  paid_before_thb          numeric(14,2) not null default 0,
  balance_after_thb        numeric(14,2) not null,
  -- ---- void (ห้าม delete — เลขต้องอยู่ครบตลอดไป) ----
  void_reason              text,
  voided_at                timestamptz,
  voided_by                uuid,
  reissued_from_receipt_id uuid references analytics.oem_receipt (id),
  created_by               uuid, created_at timestamptz not null default now(),
  unique (shop_id, receipt_no)
);
create index on analytics.oem_receipt (shop_id);
create index on analytics.oem_receipt (quote_id);
```

RLS ของ oem_receipt: **tier เดียวกับ oem_customer** (select เฉพาะ owner/admin — มี tax_id/ที่อยู่ผู้ซื้อ)
· ไม่มี insert/update/delete policy เลย — เขียนผ่าน RPC security definer เท่านั้น (แน่นกว่า oem_quote_item
เพราะเอกสารภาษีไม่มีเหตุให้ client เขียนตรง) · ไม่มี retention/auto-delete (เหตุผลเดียวกับ oem_customer
ใน 0075 — เก็บตามประมวลรัษฎากร 5 ปี+)

---

## 3. เลขที่เอกสาร — ทำไมไม่ใช้แบบ oem_quote_next_no

ประเมิน pattern เดิม (max()+1 + unique + retry 5 รอบ): จริงๆ มัน **gap-free อยู่แล้ว**
(rollback ไม่กินเลขเพราะ max คำนวณใหม่ทุกครั้ง) แต่มีจุดอ่อน 2 ข้อสำหรับเอกสารภาษี:
(1) พึ่ง split_part(no,'-',3)::int — ถ้า format เพี้ยนแถวเดียว (มีคน insert ตรงในอนาคต) เลขทั้งเดือนเพี้ยน
(2) retry แล้วยัง fail ได้ (raise หลัง 5 รอบ) — สำหรับใบเสนอราคา "ลองใหม่" รับได้
สำหรับใบกำกับภาษีที่ออกต่อหน้าลูกค้า ไม่ควรมี failure mode นี้เลย

**ตัดสิน: ใช้ counter-row lock** ภายใน oem_receipt_issue เอง:

```sql
insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
values (p_shop_id, v_doc_key, 1)
on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
returning last_no into v_no;
```

transaction เดียวกันกับการ insert receipt — ถ้า issue fail ทั้งก้อน rollback ตัวนับถอยกลับด้วย
= ไม่มีเลขข้าม · concurrent 2 คน: คนที่สองรอ row lock แล้วได้เลขถัดไป — ไม่มี retry ไม่มีชน พิสูจน์ง่าย
· รูปแบบเลข: RT-YYMM-### (YYMM จาก **เวลาไทย** ผ่าน now() at time zone 'Asia/Bangkok' —
บทเรียน 0079/0081) รันแยกรายเดือนต่อ shop เหมือน quote · void แล้วเลขคงอยู่ (แถวไม่ถูกลบ)
· **ไม่แตะ oem_quote_next_no เดิม** — ใบเสนอราคาไม่ใช่เอกสารภาษี ไม่มีเหตุต้อง migrate
· **Trade-off:** counter เพิ่มตาราง 1 ใบ + เลขใบเสนอราคากับใบเสร็จใช้กลไกต่างกัน (สองแบบใน codebase) —
ยอมรับ เพราะ requirement ทางกฎหมายต่างกันจริง และการย้าย quote มาใช้ counter คือ scope creep

---

## 4. สถานะ + transition

oem_receipt.status: แค่ 2 ค่า — **issued -> void** (ทางเดียว จบ)
- **ไม่มี draft** โดยตั้งใจ — draft ที่ถือเลขเอกสารไว้ = ประตูสู่เลขข้าม (draft ถูกทิ้ง เลขหาย)
  การ "ดูก่อนออก" ทำที่ UI (preview ตัวเลขใน dialog ก่อนกดยืนยัน) ไม่ใช่ที่ DB
- แก้เอกสาร = **ไม่มี path** — ไม่มี RPC update เนื้อหาใดๆ ทั้งสิ้น ผิด -> oem_receipt_void
  (เหตุผลบังคับ) แล้ว oem_receipt_issue ใหม่ (ส่ง p_reissued_from ผูก chain, ได้เลขใหม่)
- void **ไม่** ถอยสถานะ quote จาก won — ชนะงานแล้วคือชนะ ตัวเลข paid ลดเองผ่าน view

Transition ฝั่ง oem_quote (ไม่รื้อ table 0076): oem_receipt_issue รับใบสถานะ
**quoted / expired / won** เท่านั้น (ตรงกับเซ็ตที่ 0076 อนุญาตให้ไป won อยู่แล้ว) —
ถ้ายังไม่ won ให้ตั้ง won ในตัว (update ตรงในฟังก์ชัน ไม่เรียก oem_quote_set_status
เพราะจะไปติดข้อความ/ด่านที่ออกแบบมาสำหรับ manual path — แต่เขียนเฉพาะ transition
ที่ 0076 รับรองว่า legal เท่านั้น จึงไม่ได้เจาะ gate ใคร) · draft = ปฏิเสธ
(เลขไม่เคยผ่าน gate) · lost/rejected/superseded = ปฏิเสธ (superseded -> ข้อความชี้ไปใบ active ของ chain)

---

## 5. การคำนวณ — กติกาปัดเศษที่ทำให้ "บวกลงเป๊ะ" ทุกระดับ

- **ระดับเอกสาร (หน่วยที่กฎหมายสน):** vat_base = round(amount/(1+vat_rate), 2) ·
  vat_amount = amount - vat_base (remainder ไม่ปัดซ้ำ — สูตรเดียวกับ 0082) + CHECK บังคับใน DB
  -> ทุกใบ base+VAT = ยอดรับ เป๊ะ 100% ไม่มีข้อยกเว้น
- **ระดับ deal:** งวดสุดท้าย UI prefill = outstanding_thb (= grand_total - paid) ไม่ใช่ "อีก 50%"
  -> มัดจำ 50% ของยอดคี่ (10001 -> 5000.50) + งวดปิด (4999.50) รวมกลับ = 10001 พอดีเสมอ
  เพราะงวดปิดคือ **ส่วนที่เหลือ** ไม่ใช่ผลคูณเปอร์เซ็นต์อีกรอบ — หลัก remainder เดียวกันยกระดับขึ้นมา
- **สิ่งที่ตั้งใจปล่อย:** ผลรวม vat_base_thb ของทุกงวด อาจต่างจาก vat_base_thb ระดับใบเสนอราคา
  (0082 view) บวกลบ 1 สตางค์ — ถูกต้องตามกฎหมาย (ใบกำกับแต่ละใบยืนของมันเอง ภาษีขายยื่นตามใบกำกับ)
  ห้ามใครมา "แก้" ให้ตรงกันทีหลัง — บันทึกไว้กันคนถัดไปเข้าใจว่าเป็นบั๊ก
- vat_rate snapshot จาก **ใบ quote** (ไม่ใช่ default คอลัมน์) — deal เดียวกันอัตราเดียวกันตลอด
  ตามหลัก 0082 §2
- **เก็บครบ** = paid_thb >= grand_total (ควบกับ gate จ่ายเกินใน §6 ทำให้ในทางปฏิบัติคือเท่ากับพอดี)

## 6. กันจ่ายเกิน + ต่อราคาหลังรับมัดจำ

- ยอดรับสะสมนับ **ระดับ deal** ไม่ใช่ระดับแถว quote:
  paid = sum(amount_thb) ของ oem_receipt status='issued' ทุกใบใน chain เดียวกัน
  (join oem_quote ด้วย root_quote_id เดียวกัน) — เพราะ renegotiate สร้างแถว quote ใหม่
  แต่มัดจำที่รับไว้เป็นของ deal ไม่ใช่ของแถว · **ไม่ re-point FK ของ receipt** ตอนต่อราคา
  (เอกสารออกแล้วห้ามแตะ แม้แต่ FK) — aggregation ฉลาดแทน mutation
- Gate ใน oem_receipt_issue (หลัง for update lock แถว quote — กันสอง request ออกใบพร้อมกัน
  แล้วอ่าน paid เก่าทั้งคู่): paid + p_amount ต้องไม่เกิน grand_total ของใบ active — เกิน = ปฏิเสธ
- Gate ใหม่ใน oem_quote_renegotiate (plain replace, signature เดิม 4 args, **base จากฉบับ 0083**):
  grand_total ใหม่ต้องไม่ต่ำกว่า paid ของ deal — ไม่งั้นปฏิเสธพร้อมข้อความ "ยอดใหม่ต่ำกว่าเงินที่
  รับแล้ว ต้องคืนเงิน/ใบลดหนี้ ซึ่งระบบยังไม่รองรับ" -> invariant "paid ไม่เกิน grand_total"
  เป็นจริงทั้งระบบ
  **Trade-off:** เจ้าของลดราคาต่ำกว่ามัดจำที่รับแล้วไม่ได้เลยจนกว่าจะมีใบลดหนี้ — ถูกต้องแล้ว
  เพราะทางเลือก (ปล่อย outstanding ติดลบ) = สัญญาว่าจะคืนเงินโดยไม่มีเอกสารรองรับ

## 7. "ชนะงาน" vs "เก็บเงินครบ" — ไม่เพิ่มค่า status ใหม่

won = ชนะงาน (คงเดิม 0076 ทุกอย่าง) · "เก็บครบ/ปิดงานการเงิน" = **derived** ผ่านคอลัมน์ append
ท้าย v_oem_quote (กติกา 42P16 — ต่อท้ายเท่านั้น): paid_thb / outstanding_thb /
is_fully_paid / receipt_count (คำนวณสดระดับ deal ตาม §6)
**ทำไมไม่เพิ่ม status closed:** ต้องรื้อ constraint 0075 + transition 0076 + ทุก UI ที่ switch
ตาม status — แลกกับ boolean ที่ derive ได้ฟรีและไม่มีวัน stale · ถ้าวันหน้าต้องการ report
"งานที่ปิดแล้ว" ก็ query จาก status = won ควบกับ is_fully_paid ได้เลย

## 8. หน้าจอ + type boundary

- **บันทึกรับเงิน:** อยู่ในหน้า quote detail (/oem/quotes/[id]) — ไม่สร้างหน้าใหม่ เพราะ context
  ครบอยู่แล้ว (ยอด/มัดจำ/ลูกค้า) และ pattern Dialog มีอยู่แล้ว 4 ตัว (Deposit/VatMode/Billing/Renegotiate)
  -> ReceiptIssueDialog ตัวที่ 5: prefill ยอด (งวดแรก = deposit_amount_thb, งวดต่อไป =
  outstanding_thb), โชว์ preview ฐาน/VAT ก่อนกด, คำเตือน "ออกแล้วแก้ไม่ได้ ยกเลิกได้อย่างเดียว"
- **รายการเอกสาร:** ตาราง receipts ในหน้า quote detail (ต่องาน) + หน้าใหม่ /oem/receipts
  (รวมทุกใบ กรองรายเดือน — สำหรับทำรายงานภาษีขาย ต้องไล่ตามเลขที่ได้) + ปุ่ม void พร้อมเหตุผล
- **หน้าพิมพ์:** /oem/receipts/[id]/print — **แยกไฟล์ใหม่** (PrintReceiptClient +
  lib/oem/printableReceipt.ts) ไม่ต่อยอด PrintQuoteClient · เหตุผล: แหล่งข้อมูลคนละขั้ว
  (receipt อ่าน snapshot แช่แข็งบนแถวตัวเอง / quote อ่านค่าคำนวณสด) + ฟิลด์บังคับทางกฎหมายคนละชุด
  — ถ้า share component เดียว การแก้ใบเสนอราคาในอนาคตจะลากเอกสารภาษีเพี้ยนตามโดยไม่มีใครตั้งใจ
  · ใช้ CSS/A4 pattern เดิมโดย **copy** ไม่ abstract (สองเอกสารจะ diverge อีกแน่นอน)
- **สิ่งบังคับบนเอกสาร:** คำว่า "ใบเสร็จรับเงิน/ใบกำกับภาษี" + "ต้นฉบับ" (และปุ่มพิมพ์ "สำเนา"),
  ชื่อ/ที่อยู่/เลขผู้เสียภาษี + สาขา ทั้งสองฝ่าย, เลขที่, วันที่, รายการ (description),
  มูลค่าก่อน VAT, จำนวน VAT (ระบุอัตราจาก vat_rate snapshot ห้าม hardcode 7%), ยอดรวม,
  ยอดตัวอักษรไทย ("ห้าพันบาทห้าสิบสตางค์") — เพิ่มความน่าเชื่อถือ + กันแก้ตัวเลข
- **Type boundary:** PrintableReceipt สร้าง field-by-field จากแถว receipt เท่านั้น (ตาราง
  ไม่มี cost/margin อยู่แล้วโดยโครงสร้าง — แต่กฎ "ห้าม spread, ห้ามส่ง row ตรง" ยังบังคับ
  เหมือน printableQuote.ts ทุกประการ) · **ห้าม** ส่ง OemQuoteRow เข้า print page ของ receipt
  เด็ดขาด (มันพา margin/cost มาใน RSC payload)

## 9. VAT gates ตอน issue (บังคับที่ DB ไม่ใช่เตือนที่ปุ่ม)

- seller_vat_registered = true ไม่งั้นปฏิเสธ (แบบเดียวกับด่าน breakdown ใน 0082 §4)
- seller_legal_name + seller_tax_id + seller_address_lines ไม่ว่าง — เอกสารไม่ครบองค์ = ไม่ออก
- quote ต้องมี customer_id และ oem_customer.legal_name ไม่ว่าง · tax_id/address ของผู้ซื้อ
  ไม่บังคับที่ DB (บุคคลธรรมดาไม่ต้องมี) แต่ UI เตือนเหลืองถ้าว่าง
- vat_mode ของ quote **ไม่เกี่ยว** กับ receipt — เอกสารนี้แยกจำนวน VAT เสมอ (กฎหมายบังคับ
  สำหรับใบกำกับภาษี ต่างจากใบเสนอราคาที่เลือกได้) quote โหมด included ก็ออก receipt
  แบบแยกบรรทัดได้ เพราะเลขคณิตหารถอยหลังจากยอดรับจริงเหมือนกัน

## 10. ถ้าคำตอบเจ้าของพลิกเป็น "ราคายังไม่รวม VAT" ต้องแก้อะไร

โครง oem_receipt **ไม่ต้องแก้เลย** — เงินที่รับจริงย่อมเป็นยอด gross (รวม VAT) เสมอ
สูตร base/VAT ของเอกสารจึงถูกทั้งสองโลก สิ่งที่เปลี่ยนคือ "เพดานและตัวตั้ง":
1. เพดานจ่ายเกิน + ตัวตั้ง outstanding เปลี่ยนจาก grand_total -> round(grand_total*(1+vat_rate),2)
   — Han เขียนนิพจน์นี้เป็น **ตัวแปรเดียว** (v_deal_gross) ใน oem_receipt_issue ตั้งแต่แรก
   จะได้แก้บรรทัดเดียว
2. deposit_amount_thb (0081 view) และ vat_base/vat_amount (0082 view) ต้องนิยามใหม่ทั้งคู่
   (0082 จะพลิกจาก "หารถอยหลัง" เป็น "บวกเพิ่ม") — งานของ migration แยกต่างหาก ไม่ใช่ 0084
3. คอลัมน์ view §7 (paid/outstanding/is_fully_paid) เทียบกับ gross ตามข้อ 1
**สั่ง Han: อย่าเริ่มเขียน 0084 จนกว่า Tech Lead ยืนยันคำตอบข้อนี้** — มันคือตัวตั้งของ gate ทุกด่าน

---

## 11. งานของ Han (SQL — migration 0084 ไฟล์เดียว)

ก่อนเริ่ม: (ก) รอคำตอบ VAT §10 (ข) 0083 ต้อง apply ก่อน — 0084 แก้ oem_quote_renegotiate
แบบ plain replace ต้อง **copy body จากฉบับ 0083 ที่ apply แล้วจริง** (ดึงจาก DB ไม่ใช่จากไฟล์ 0082)

1. create table analytics.oem_doc_counter + enable RLS (ไม่มี policy) — ห้าม grant ใดๆ ให้ authenticated
2. create table analytics.oem_receipt ตาม §2 + RLS select เฉพาะ owner/admin (copy pattern
   oem_customer 0075 §2) + ไม่มี write policy + grant select ให้ authenticated, service_role
   เฉพาะ object นี้ (ห้าม blanket grant)
3. RPC analytics.oem_receipt_issue(p_shop_id uuid, p_quote_id uuid, p_amount_thb numeric,
   p_received_date date, p_kind text, p_payment_method text default null, p_payment_ref text
   default null, p_description text default null, p_reissued_from uuid default null) returns uuid
   — security definer + pin search_path + crm_require_owner_admin + for update แถว quote ·
   ลำดับ: lock quote -> gate สถานะ (§4) -> gate seller/buyer (§9) -> คำนวณ paid ระดับ deal (§6)
   -> gate จ่ายเกิน -> gate p_received_date ไม่เกินวันนี้เวลาไทย -> snapshot seller/buyer/vat_rate
   -> ออกเลขจาก counter (upsert returning §3) -> insert receipt -> ตั้ง won ถ้ายังไม่ won ->
   revoke + grant execute ระบุ signature เต็ม (ฟังก์ชันใหม่ยังไม่มี overload แต่ grant ต้องมีเสมอ)
4. RPC analytics.oem_receipt_void(p_shop_id uuid, p_receipt_id uuid, p_reason text) —
   issued -> void เท่านั้น, reason บังคับ, for update, เขียน voided_at/voided_by · revoke/grant
5. View analytics.v_oem_receipt (security_invoker) = receipt ทุกคอลัมน์ + quote_no ปัจจุบัน
   + is_deal_active (quote ยังไม่ superseded) · grant select
6. v_oem_quote — **append ท้ายเท่านั้น** (copy select list ฉบับ 0082 คำต่อคำ ห้ามแทรกกลาง):
   paid_thb, outstanding_thb, is_fully_paid, receipt_count (นิยาม deal-level §6 —
   subquery ผูก root_quote_id) · grant select ซ้ำ
7. oem_quote_renegotiate plain replace (base 0083): เพิ่ม gate grand_total ใหม่ >= deal paid (§6)
   · revoke/grant execute ซ้ำด้วย signature 4 args เดิม
8. notify pgrst reload schema ปิดไฟล์
9. ทดสอบทุกเคสใน §13 กับ DB จริงก่อนส่ง review

## 12. งานของ Luke (UI — หลัง 0084 apply)

1. lib/oem/types.ts — OemReceiptRow, IssueReceiptInput, VoidReceiptInput, OemReceiptKind,
   OemReceiptStatus + เติมฟิลด์ใหม่ 4 ตัว (paid/outstanding/isFullyPaid/receiptCount) ลง OemQuoteRow
2. lib/actions/oem.ts — issueReceipt / voidReceipt / getReceipts(quoteId?) / getReceipt(id)
   (pattern เดียวกับ setQuoteDeposit: validate -> rpc -> ActionResult · อย่า log error object
   ทั้งก้อน — บทเรียน M3 ของ 0076 มี tax_id ปนได้)
3. lib/oem/printableReceipt.ts — PrintableReceipt + toPrintableReceipt() field-by-field
   (ยกกฎจาก header ของ printableQuote.ts มาทั้งดุ้น) + ฟังก์ชันแปลงยอดเป็นตัวอักษรไทย (bahttext)
4. components/domain/oem/ReceiptIssueDialog.tsx — prefill ตาม §8, preview ฐาน/VAT,
   confirm 2 จังหวะ · ReceiptSection.tsx ใน QuoteDetailClient (paid/outstanding/ตารางใบ/ปุ่ม void)
5. app/(dashboard)/oem/receipts/page.tsx — รายการรวม กรองเดือน + [id]/print/page.tsx +
   PrintReceiptClient.tsx (A4, ต้นฉบับ/สำเนา, ใบ void ต้องยังโชว์ในรายการพร้อมลายน้ำ "ยกเลิก"
   ห้ามซ่อน — ต้องไล่ความต่อเนื่องของเลขได้เสมอ)
6. เพิ่มลิงก์ receipts ใน OemSubNav.tsx · typecheck + รันจริงก่อนส่ง

## 13. เคสทดสอบที่ต้องผ่าน

1. ยอดคี่: grand 10001 -> มัดจำ 5000.50 -> งวดปิด prefill 4999.50 -> รวม = 10001, is_fully_paid = true
2. ทุกใบ: vat_base + vat_amount = amount เป๊ะ (ลองยอดที่หาร 1.07 ไม่ลงตัว เช่น 100, 5000.50)
3. ยิง oem_receipt_issue 2 request พร้อมกันใบเดียวกัน -> เลขไม่ชน ไม่จ่ายเกิน (ใบหลังเห็น paid ใหม่)
4. void ใบ 002 -> ออกใบถัดไปได้ 003 (ไม่ reuse 002) -> reissue ผูก reissued_from
5. issue บน draft/lost/superseded -> ปฏิเสธ · บน quoted -> สำเร็จ + quote พลิกเป็น won
6. จ่ายเกิน outstanding 0.01 บาท -> ปฏิเสธ
7. รับมัดจำ -> renegotiate ลดราคา (ยังสูงกว่า paid) -> ใบใหม่โชว์ paid เดิม (deal-level) ->
   งวดปิด = grand ใหม่ - paid · renegotiate ต่ำกว่า paid -> ปฏิเสธ
8. seller ไม่ติ๊ก VAT / ไม่มี tax_id / quote ไม่มี customer_id -> ปฏิเสธทุกเคส
9. view-source หน้า print receipt -> ไม่มี cost/margin/calc/ราคารับซื้อคืน ใน RSC payload
10. ก่อน 07:00 เวลาไทยวันแรกของเดือน -> เลขขึ้นเดือนใหม่ถูกต้อง (Asia/Bangkok ไม่ใช่ UTC)
11. select oem_doc_counter ด้วย role authenticated -> ต้องอ่านไม่ได้

## 14. จุดเสี่ยงที่คนต่อไปจะพลาด

1. **แก้ renegotiate จากไฟล์ผิดฉบับ** — 0083 plain-replace มันอยู่ ณ ตอนนี้ · 0084 ต้อง base จาก
   DB จริงหลัง 0083 apply ไม่ใช่จากไฟล์ 0082 ไม่งั้น gate ของ 0083 (margin ติดลบ/VAT clamp) หายเงียบ
2. **เผลอยกหลัก "คำนวณสดที่ view" (0081/0082) มาใช้กับ receipt** — ตรงข้ามกัน! receipt แช่แข็ง
   ทุกตัวเลขตอน issue · ใครเติมคอลัมน์คำนวณสดทับค่า frozen ใน v_oem_receipt = เอกสารภาษี
   กลายพันธุ์ตอน reprint = ผิดกฎหมาย
3. **สร้าง "draft receipt" เพื่อ UX preview** — ห้าม เลขจะข้าม · preview คือเลขคณิตฝั่ง UI ล้วน
   (ยังไม่มีเลขที่เอกสารจนกด issue จริง)
4. **นับ paid ที่ระดับ quote_id แทน root chain** — ต่อราคา 1 ครั้ง มัดจำจะ "หาย" จากใบใหม่ทันที
   แล้ว gate จ่ายเกินจะยอมให้เก็บซ้ำเต็มยอด
5. **ลืม re-grant execute หลัง create function** (ทีมเจอมาแล้ว 3 รอบ) และ blanket grant ก็ห้าม
6. **แทรกคอลัมน์กลาง select list ของ v_oem_quote** — 42P16 ทันที ต่อท้ายเท่านั้น
7. **hardcode 7%** ที่ UI/print — ใช้ vat_rate จากแถว receipt เท่านั้น
8. **ส่ง OemQuoteRow เข้า print page ของ receipt** "เพราะอยากโชว์ยอดรวมงาน" — ใช้
   grand_total_snapshot / paid_before_thb / balance_after_thb ที่แช่แข็งบนแถว receipt แทน
9. **ลบ/ซ่อนใบ void** — เลขต้องโชว์ครบทุกใบในรายการ (ตรวจความต่อเนื่องของเลขได้เสมอ)
10. **current_date ใน DB = UTC** — ทุกจุดที่แตะวันที่ (เลขเดือน, gate received_date, issue_date)
    ต้องผ่าน Asia/Bangkok
