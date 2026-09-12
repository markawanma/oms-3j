# lib/actions/labels.ts — สัญญา action เฟส A (สำหรับ frontend-dev)

อ้างอิง: design scratchpad `design-label-teach-loop-yoda-11sep.md` §5 A · owner decisions 11 ก.ย. 69 ·
migration `supabase/migrations/0116_label_review_resolve.sql` · types ทั้งหมดอยู่ใน `lib/labels/types.ts`

ทุก action: `requireOwnerAdmin()` ก่อนเสมอ (staff เรียกไม่ได้) · คืน `ActionResult<T>` (`{ ok:true, data:T }` หรือ `{ ok:false, error:string }`)
เหมือน action อื่นในแอปทั้งหมด · error message เป็นข้อความไทยทั่วไปเสมอ (ไม่ใช่ raw Postgres error — ดูหมายเหตุท้ายไฟล์
เรื่อง "reason required" ที่อาจอยากรู้ล่วงหน้าฝั่ง UI แทนรอ error กลับมา)

---

## 1. `findOrdersByTracking(query: string): Promise<ActionResult<OrderSourceRef[]>>`

ค้นเลขพัสดุ **หรือ** เลขที่ออเดอร์ (exact match ทั้งคู่ — ไม่ใช่ partial/LIKE) ใช้ใน ProvinceFixPanel ที่ `/tiktok/upload`

- Input: `query` — trim เองแล้วในแอ็กชัน, ยาวเกิน 100 ตัวอักษร หรือมีอักขระ `"`/`\` → `ok:false`
- Output: array ของ `OrderSourceRef` (0 รายการ = ไม่พบ, **ไม่ใช่ error**)
- `OrderSourceRef`:
  ```ts
  {
    factOrderId: string;
    sourceOrderNo: string;
    trackingNo: string | null;
    provinceCode: string;        // ค่าปัจจุบัน (raw fact_order.province_code)
    provinceSource: "import" | "label" | "manual";
    importFileName: string | null;  // stg_import_batch.file_name ของแถวนำเข้าล่าสุด — null ถ้าไม่มี
    sourceRowNo: number | null;     // stg_order_import.source_row_no ของแถวเดียวกัน
  }
  ```
- ใช้ผลลัพธ์นี้แสดง "ที่มา" ของออเดอร์ก่อนให้เจ้าของกดแก้จังหวัด (owner 11 ก.ย. decision #3)

## 2. `setOrderProvince(factOrderId, provinceCode, reason?, note?): Promise<ActionResult>`

แก้จังหวัดตรงจากผลค้นหาข้อ 1 (ไม่ผูกกับ stg_label_page ใดๆ)

- `reason?: LabelReasonCode | null` — ดูข้อ 7 (LABEL_REASON_OPTIONS)
- `note?: string | null` — free text เสริม, optional
- **กฎสำคัญที่ UI ควรรู้ล่วงหน้า**: ถ้าออเดอร์นี้ `provinceCode` ปัจจุบัน **ไม่ใช่** `TH-XX` (คือมีค่าจริงอยู่แล้ว
  ไม่ว่าจะมาจาก import/label/manual รอบก่อน) → **`reason` เป็นข้อบังคับ** ไม่ส่ง = โดนปฏิเสธ (error message ทั่วไป
  "ตั้งค่าจังหวัดไม่สำเร็จ" — ไม่บอกสาเหตุละเอียด) ⇒ **เช็คฝั่ง UI ก่อน**: ถ้า `provinceCode !== 'TH-XX'` บังคับกรอก
  dropdown เหตุผลก่อนกดยืนยัน จะได้ไม่ต้อง round-trip ไปเจอ error
- ผิดจังหวัดที่ไม่มีจริงใน `dim_geo` ก็โดนปฏิเสธเช่นกัน — ใช้ dropdown 77 จังหวัดจาก `getCrmEditOptions()` (มีอยู่แล้วใน `lib/actions/crm.ts`) ไม่ใช่ free text

## 3. `revertOrderProvince(factOrderId: string): Promise<ActionResult>`

ย้อนการแก้ **ล่าสุด** ของออเดอร์นี้ (ไม่ว่าจะแก้ผ่าน `setOrderProvince` หรือผ่านการ resolve หน้าใบปะหน้า) กลับเป็นค่าก่อนหน้า

- ปฏิเสธถ้าไม่มีประวัติ `province_set` เลย, หรือค่าปัจจุบันถูกแก้ไปอีกทีหลังจากนั้นแล้ว (revert ได้แค่รอบล่าสุดจริงๆ เท่านั้น)
- ไม่มี input อื่นนอกจาก factOrderId — ไม่ต้องเลือกว่าจะย้อนไปค่าไหน (ระบบรู้เองจากประวัติ)

## 4. `resolveLabelPage(input): Promise<ActionResult<ResolveLabelPageResult>>`

ปุ่มหลักของคิวรอตรวจ — เลือกจังหวัดให้หน้าที่ `needs_review`/`conflict`/`order_not_found`/`undetected`/`parse_failed`

```ts
type ResolveLabelPageInput = {
  pageId: string;
  provinceCode: string;
  reason?: LabelReasonCode | null;
  note?: string | null;
  taughtSnippet?: string | null; // ดูข้อ 8
};
// ผลลัพธ์:
type ResolveLabelPageResult = { appliedOrders: number };
```

- ใช้ได้เฉพาะหน้าที่ยัง**ไม่**ถูก resolve/ignore มาก่อน (เรียกซ้ำ = ปฏิเสธ)
- หน้าต้องมี `trackingNo` (มาจาก `LabelReviewRow.trackingNo` ที่คิวแสดงอยู่แล้ว) — ถ้า `null` ต้องใช้ `ignoreLabelPage` แทน (แปลว่าไม่ใช่ใบปะหน้าที่จับคู่ได้)
- ตรวจว่ามีออเดอร์จริงตรง tracking นี้แล้วหรือยัง (ถ้ายังไม่มี → ปฏิเสธ พร้อมข้อความบอกให้ import ออเดอร์ก่อน)
- **tracking เดียวอาจตรงหลาย fact_order** (พัสดุรวม) — `appliedOrders` บอกจำนวนใบที่เขียนจริง ทุกใบได้ค่าเดียวกัน
- กฎ reason เหมือนข้อ 2 (ทับค่าจริง = ต้องมี reason) แต่ใช้ reason **เดียว** ครอบทุกออเดอร์ที่ tracking นี้ครอบคลุม
- `taughtSnippet` ถ้าใส่: UI ควรจำกัดความยาว ≤25 ตัวอักษรและเตือนถ้ามีเลขติดกัน ≥3 หลัก ก่อนส่ง (DB จะปฏิเสธ**ทั้งคำสั่ง**
  ถ้าไม่ผ่าน — province ก็จะไม่ถูกตั้งด้วย ไม่ใช่แค่ข้าม snippet เฉยๆ) — เว้นว่างได้เสมอ ไม่บังคับ

## 5. `ignoreLabelPage(input): Promise<ActionResult>`

"ไม่ใช่ใบปะหน้า" — เอาออกจากคิวถาวร ไม่แตะออเดอร์ใดเลย

```ts
type IgnoreLabelPageInput = { pageId: string; reason?: LabelReasonCode | null; note?: string | null };
```

- reason/note ไม่บังคับ (ต่างจาก resolve)
- เรียกซ้ำกับหน้าที่ ignore ไปแล้ว = ปฏิเสธ

## 6. `revertLabelPage(pageId: string): Promise<ActionResult>`

ย้อนหน้าที่ resolve ไปแล้ว (`manual_applied`) กลับสู่คิว — คืนสถานะเดิมก่อน resolve + คืนจังหวัดของทุกออเดอร์ที่เพจนี้เคยเขียนให้

- ใช้ได้เฉพาะหน้าที่สถานะ = `manual_applied` เท่านั้น (ปฏิเสธถ้าไม่ใช่ รวมถึงหน้า `ignored` — ยังไม่มีปุ่ม "ยกเลิกการ ignore" ในเฟสนี้ ดูหัวข้อ "ยังไม่ได้ทำ")
- ถ้าออเดอร์ตัวใดตัวหนึ่งถูกแก้จังหวัดซ้ำอีกทีหลัง resolve (เช่นผ่าน `setOrderProvince` ตรงๆ) → revert ทั้งก้อนถูกปฏิเสธ (all-or-nothing ไม่มี partial revert)

## 7. `LABEL_REASON_OPTIONS` (จาก `lib/labels/types.ts`)

```ts
[
  { code: "no_data_yet", label: "ยังไม่มีข้อมูล/รอใบปะหน้า" },
  { code: "unreadable", label: "ใบอ่านไม่ชัด" },
  { code: "wrong_label", label: "ใบปะหน้าผิดออเดอร์" },
  { code: "customer_moved", label: "ลูกค้าแจ้งย้ายที่อยู่" },
  { code: "other", label: "อื่นๆ" },
]
```

ใช้ render เป็น dropdown ที่กดเลือกเท่านั้น (**ห้ามให้พิมพ์เอง** — owner 11 ก.ย. ยืนยันชัดเจน) `code` คือค่าที่ส่งเข้า action, `label` คือข้อความไทยที่โชว์

## 8. `getLabelPageViewUrl(pageId) / getLabelPageSnippet(pageId)` — "เข้ามาช่วยดูหน่อย"

- `getLabelPageViewUrl(pageId): Promise<ActionResult<{ url: string }>>` — signed URL อายุ **60 วินาที** ไปที่ไฟล์ PDF ทั้งไฟล์ ต่อท้ายด้วย
  `#page=N` (browser ส่วนใหญ่กระโดดไปหน้านั้นให้อัตโนมัติถ้าเปิดด้วย native PDF viewer — ฝัง `<iframe>`/เปิด tab ใหม่ก็ได้) เรียกตอนกดปุ่ม
  "ดูใบ" เท่านั้น (อย่า prefetch ทั้งคิว — URL หมดอายุเร็ว)
- `getLabelPageSnippet(pageId): Promise<ActionResult<{ snippet: string | null; zipcodeFound: boolean }>>` — ข้อความ ±80
  ตัวอักษรรอบ zipcode ของหน้านั้น (เลขยาว ≥9 หลักถูก mask เป็น `•••••••••` แล้ว) `snippet: null` = อ่านหน้านี้ไม่ได้เลย/หาเลข
  5 หลักไม่เจอ (ไม่ใช่ error, แสดงข้อความ "ไม่มีตัวอย่างข้อความให้ดู") — **⚠️ ห้าม log/เก็บค่า `snippet` ที่ frontend เช่นกัน**
  (ไม่ใส่ analytics, ไม่ใส่ error tracking, ไม่ใส่ localStorage) — เจตนาออกแบบคือ "โชว์แล้วทิ้ง"

## 9. `getPendingLabelReviews()` — ของเดิม เพิ่ม field

เพิ่ม `orderSources: OrderSourceRef[]` เข้า `PendingLabelReviewRow` แต่ละแถว (ว่างเปล่าถ้าหน้านั้นยังไม่มี `trackingNo`
หรือยังไม่มีออเดอร์ตรง tracking ในระบบ) — ใช้แสดง "ที่มาฝั่งออเดอร์" คู่กับ `fileName`/`pageNo` ที่มีอยู่แล้ว (ฝั่งใบปะหน้า)
ตาม decision #3 ("ทุกแถวต้องบอกที่มาให้เจ้าของเปิดอ่านเองได้")

---

## ลำดับ UX ที่แนะนำ (ไม่บังคับ แต่สอดคล้อง guard ที่มี)

1. คิว `getPendingLabelReviews()` → แต่ละแถวมีปุ่ม: chip จังหวัด candidate (ถ้ามี) + dropdown 77 จังหวัดเต็ม + ปุ่ม "ดูใบ"
   (`getLabelPageViewUrl`) + ปุ่ม "ดูข้อความ" (`getLabelPageSnippet`) + ปุ่ม "ไม่ใช่ใบปะหน้า" (`ignoreLabelPage`)
2. กดจังหวัด → ถ้า `orderSources` มีแถวที่ `provinceCode !== 'TH-XX'` → โชว์ dropdown reason **ก่อน** ปุ่มยืนยัน (บังคับเลือก)
   → ค่อยเรียก `resolveLabelPage`
3. หน้าที่ resolve แล้ว (ไม่โผล่ในคิวอีก — `manual_applied`/`ignored` ไม่อยู่ใน `PENDING_REVIEW_STATUSES`) ต้องมีที่ทาง
   ดูประวัติ + ปุ่มย้อน (`revertLabelPage`) แยกต่างหาก — เฟสนี้ backend ยังไม่มี action "list ทุกหน้าที่ resolve แล้ว"
   (ดู "ยังไม่ได้ทำ")

---

## ยังไม่ได้ทำ / ข้อจำกัดที่ frontend-dev ควรรู้

- ไม่มี action list หน้าที่ `manual_applied`/`ignored` (สำหรับหน้าที่จะทำปุ่ม revert) — ต้อง query เพิ่มเอง หรือขอ backend เพิ่ม action `getResolvedLabelPages()` ในรอบถัดไป
- `label_revert_page` ไม่รองรับ "ยกเลิกการ ignore" (เฉพาะย้อน `manual_applied`)
- `label_text_rule` (เก็บการสอน) เขียนอย่างเดียว ไม่มี UI แสดงผลในเฟสนี้ — `active` เป็น `false` เสมอ ยังไม่มีผลต่อการ parse จริง
- `setOrderProvince`/`resolveLabelPage` ไม่คืน error message เฉพาะเจาะจง (เช่น "ต้องมี reason") — คืนข้อความทั่วไปเสมอ
  ต้อง guard ด้วย logic ฝั่ง UI ตามข้อ 2/4 ด้านบนแทน
