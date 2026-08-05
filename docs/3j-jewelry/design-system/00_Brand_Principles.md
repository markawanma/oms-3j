# 00 — Brand Principles (AUTHORITATIVE — อ่านก่อนไฟล์อื่นทุกครั้ง)

> **สถานะ**: ยืนยันจากเจ้าของแบรนด์แล้ว — ไม่ใช่ draft ไฟล์นี้มีน้ำหนักเหนือ `02_3J_Design_Language.md` เดิมทุกข้อที่ขัดกัน
> **ใช้ตอนไหน**: อ่านก่อนออกแบบ/ทำ CAD ทุกครั้ง ทั้งฝั่ง ChatGPT และ Claude — เป็นตัวกรองแรกก่อนตัดสินใจทุกจุด
> **ระดับของไฟล์นี้**: **brand-level** — หลักการที่ใช้กับ**ทุก collection** ของ 3J ไม่เปลี่ยนตามธีม ต่างจาก motif/metaphor เฉพาะ (เช่น "folded satin") ที่เป็นของแต่ละ collection เท่านั้น

---

## กฎสำคัญที่สุดของระบบนี้ — 2 ชั้นเสมอ

> **3J กำลังออก collection ใหม่เรื่อยๆ — แต่ละ collection มี motif/design-intent เฉพาะของตัวเอง ไม่ใช่ทุก collection ต้องเหมือนกัน**

ทุกครั้งที่จะออกแบบ/ทำ CAD ต้องอ่าน **2 ชั้นคู่กันเสมอ**:

1. **ชั้นแบรนด์ (ไฟล์นี้ + `01`/`02`/`03`)** — หลักที่ใช้ร่วมกันทุก collection: วัสดุ, feeling, บทบาท AI, หลักผิว/curve สากล, ลำดับความสำคัญเวลา trade-off, มาตรฐานผลิต
2. **ชั้น collection (`collections/<ชื่อ>/design-intent.md`)** — motif/metaphor เฉพาะ, test คำถามเฉพาะ, NEVER-DO เฉพาะ motif, กฎโครงสร้างเฉพาะของ collection นั้น

> **ตัวอย่าง**: ถ้ากำลังทำงาน collection **Satin Flow** → อ่านไฟล์นี้ (`00`) ควบคู่กับ [`collections/satin-flow/design-intent.md`](./collections/satin-flow/design-intent.md) เสมอ **ห้ามเอา motif "folded satin" ไปใช้เป็นกฎของ collection อื่นที่ไม่ใช่ Satin Flow** — นี่คือความผิดพลาดที่เคยเกิดในระบบเดิม (เอา satin ไปตั้งเป็น DNA ทั้งแบรนด์) และได้แก้ไขแล้วในโครงสร้างนี้

ถ้าเริ่ม collection ใหม่และยังไม่มีไฟล์ design-intent เฉพาะ → ดู `09_Collection_Template.md` เพื่อสร้างไฟล์ `collections/<ชื่อ>/design-intent.md` ก่อนเริ่มออกแบบ

---

## บทบาทของ AI ที่ทำงานนี้

Senior Jewelry Product Designer & CAD Engineer — **reproduce design language อย่างซื่อสัตย์**
ห้าม redesign / reinterpret / optimize appearance ตามใจตัวเอง
**ไม่แน่ใจจุดไหน → รักษาภาษาเดิมไว้** (อย่าเดาแล้วเปลี่ยนเป็นทางที่ตัวเองคิดว่าสวยกว่า)

## ตัวตนสินค้า (ทุก collection)

- Sterling Silver 925 — **timeless** ใส่ทุกวัน ส่งต่อรุ่นสู่รุ่น
- Feeling ที่ต้องได้: **Elegant / Soft / Premium / Timeless / Comfortable / Refined**
- Feeling ที่ **ห้าม**เป็น: fashion / trendy / sculpture (งานประติมากรรมโชว์ ไม่ใช่ของใส่จริง)

---

## หลักผิว/curve สากล (ใช้กับทุก collection — รายละเอียด motif เฉพาะดูที่ collection file)

- ผิวใหญ่ ขัดเงา **calm** (สงบ ไม่รก ไม่แสงสะท้อนแตกกระจาย)
- Curve ต่อเนื่อง (one continuous motion) — ไม่มีเปลี่ยนทิศมั่ว ไม่มีมุมหักฉับพลัน ไม่แข็งทื่อ
- มินิมอล — ไม่มี detail เกินจำเป็น (ไม่ใส่ลาย/ร่อง/texture เสริมที่ไม่ได้ทำหน้าที่)
- Comfort-fit ต้องมาก่อนความจัดจ้านของทรงเสมอ (ดู `03_3J_CAD_Guideline.md` เกณฑ์ตัวเลข)

## Visual Priority (ลำดับความสำคัญเมื่อต้อง trade-off — ใช้กับทุก collection)

1. **Elegance** — ความสง่างามต้องมาก่อน
2. **Flow** — ความลื่นไหลต่อเนื่องของเส้น
3. **Simplicity** — ความเรียบง่าย ไม่รก
4. **Comfort** — ใส่สบาย ไม่บาด/เกี่ยว
5. **Manufacturing** — ผลิตได้จริง

> ถ้าข้อจำกัดการผลิต (Manufacturing) บังคับให้ต้องแก้ไขจากดีไซน์ต้นฉบับ **ให้คงหน้าตาใกล้เคียงของเดิมที่สุด** — แก้จากด้านในที่มองไม่เห็นก่อนเสมอ (ดู `03_3J_CAD_Guideline.md` หัวข้อ suggestions without changing appearance) อย่าปรับ silhouette ที่มองเห็นจากด้านนอกถ้าไม่จำเป็นจริงๆ

---

## Final Goal (สากลทุก collection)

> ลูกค้าเห็นแล้วต้องรู้สึกว่านี่คือของใส่ได้จริงทุกวัน หรูแบบเรียบ ไม่ใช่ของโชว์/ประติมากรรม — **การแปล motif ให้เป็นความรู้สึกนี้คือหน้าที่ของแต่ละ collection file** (เช่น Satin Flow แปลเป็น "ผ้าซาตินกลายเป็นเงิน")

---

## ความสัมพันธ์กับไฟล์อื่นในระบบ

- ไฟล์นี้ (`00`) เป็น **ฐานอ้างอิงสูงสุดระดับแบรนด์** — ถ้า `02_3J_Design_Language.md` ข้อไหนขัดแย้ง ให้ยึดไฟล์นี้เป็นหลัก
- **motif/metaphor เฉพาะ, NEVER-DO เฉพาะ motif, กฎโครงสร้างเฉพาะ ไม่ได้อยู่ในไฟล์นี้อีกต่อไป** — ย้ายไปอยู่ใน `collections/<ชื่อ>/design-intent.md` ของแต่ละ collection แล้ว (เช่น folded satin ทั้งหมดอยู่ที่ [`collections/satin-flow/design-intent.md`](./collections/satin-flow/design-intent.md))
- `04_Claude_Master_Prompt.md` และ `05_Ring_Workflow.md` (และ workflow อื่น) ต้องอ้างทั้งไฟล์นี้ **และ** design-intent ของ collection ที่กำลังทำงานอยู่เสมอ — ไม่ใช่แค่ไฟล์นี้ไฟล์เดียว
- เอกสารนี้ยืนยันจากเจ้าของแบรนด์แล้ว (ต่างจาก `02` ที่ยังเป็น v1 draft ในหัวข้อที่ไม่ใช่ brand default)
