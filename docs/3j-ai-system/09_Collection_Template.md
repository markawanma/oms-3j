# 09 — Collection Template (เริ่ม collection ใหม่)

> **ใช้ตอนไหน**: จุดเริ่มก่อนออกแบบ collection ใหม่ทุกครั้ง
> **วิธีเปิด collection ใหม่**: copy เนื้อหาไฟล์นี้ทั้งหมดไปสร้างเป็นไฟล์ `docs/3j-ai-system/collections/<ชื่อ-collection>/design-intent.md` (เช่น `collections/lotus-2026/design-intent.md`) แล้วกรอกทุกช่อง `[...]` ให้ครบ — ไฟล์ที่กรอกเสร็จนี้จะกลายเป็น **authoritative เฉพาะ collection นั้น** ใช้คู่กับ `00_Brand_Principles.md` เสมอ (ดูตัวอย่างไฟล์ที่กรอกครบแล้วจริง: [`collections/satin-flow/design-intent.md`](./collections/satin-flow/design-intent.md))
> จากนั้นค่อยเข้า workflow เฉพาะประเภท (05–08)

---

## 1. ข้อมูลพื้นฐาน

- **ชื่อ Collection**: [เช่น "SATIN FLOW COLLECTION"]
- **ธีม/Story**: [แรงบันดาลใจ 1–2 ประโยค เช่น "จำลองริบบิ้นผ้าซาตินพับครึ่งรอบ โอบรับเม็ดพลอย"]
- **กลุ่มเป้าหมาย**: [เช่น "ผู้หญิงวัยทำงาน 25–40 ใส่ประจำวัน" / "ซื้อฝากแม่-ลูกสาว"]
- **ช่วงราคาขาย (บาท)**: [ต่อชิ้น ระบุช่วง เช่น 590–1,290]
- **งบต้นทุนต่อชิ้น (บาท)**: [ผูกกับน้ำหนักเงิน — ดู `03_3J_CAD_Guideline.md` การคำนวณ]

## 2. รายการชิ้นในเซ็ต

| ชิ้นงาน | มี/ไม่มีในเซ็ตนี้ | Workflow ที่ใช้ |
|---|---|---|
| แหวน | [ ] | `05_Ring_Workflow.md` |
| จี้ | [ ] | `06_Pendant_Workflow.md` |
| ต่างหู | [ ] | `07_Earrings_Workflow.md` |
| กำไล/สร้อยข้อมือ | [ ] | `08_Bracelet_Workflow.md` |

## 3. Motif/Metaphor เฉพาะ collection นี้ (หัวใจของไฟล์นี้)

> **นี่คือส่วนที่ต่างจากแบรนด์อื่น** — collection ใหม่แต่ละอันมี motif ของตัวเอง ไม่ต้องเหมือน Satin Flow หรือ collection ก่อนหน้า

- **Motif/Metaphor หลัก**: [เช่น "ผ้าซาตินพับ" / "กลีบดอกบัว" / "เส้นคลื่นทะเล" — ระบุให้ชัดว่า "ดีไซน์นี้ = X ไม่ใช่ Y"]
- **Test คำถามตัดสินใจ** (ใช้เช็คทุกจุดของงาน collection นี้): "ยังดูเหมือน [motif] อยู่ไหม?" — ถ้าไม่ → ทิ้งวิธีนั้น
- **NEVER-DO เฉพาะ motif นี้**: [ลิสต์คำ/ลักษณะที่ห้ามใช้ เช่น Satin Flow ห้าม twist/rope/spiral/braided/Celtic]
- **กฎโครงสร้างเฉพาะ** (ถ้ามี — เช่นตำแหน่งที่ motif เกิดขึ้น/ไม่เกิดขึ้นบนชิ้นงาน): [เช่น Satin Flow: split เฉพาะใกล้หัวแหวน, ครึ่งล่าง band ปกติ]

## 4. ภาษาดีไซน์ที่ยึดสำหรับ collection นี้

อ้างอิงหมวดจาก `02_3J_Design_Language.md` — ระบุค่าจริงของ collection นี้ในแต่ละหมวด (หมวดที่เป็น brand default ใน `02` ใช้ได้เลยถ้าไม่ระบุต่าง):

- Curve Language: [เช่น "โค้งต่อเนื่องแบบผ้า"]
- Ribbon/Motif Language: [ลิงก์กลับไปข้อ 3 — ระบุ GOOD/BAD list เฉพาะ collection นี้]
- Surface: [เช่น "outer high polish / inner hairline" หรือ finish อื่น]
- Stone: [ชนิด/ขนาด/setting ที่ใช้ตลอด collection เพื่อความสม่ำเสมอ]
- Metal: เงิน 92.5 (ค่าตั้งต้น — ระบุถ้าต่างจากนี้)
- Proportion/Balance/Negative Space/Symmetry: [หมายเหตุเฉพาะ collection ถ้ามี]

## 5. ตารางสเปกกลาง (กรอกเมื่อออกแบบแต่ละชิ้นเสร็จ)

| ชิ้นงาน | มิติหลัก (mm) | พลอย | Finish | น้ำหนักประมาณ (g) | ต้นทุนประมาณ (บาท) |
|---|---|---|---|---|---|
| แหวน | | | | | |
| จี้ | | | | | |
| ต่างหู | | | | | |
| กำไล | | | | | |

## 6. ขั้นตอนถัดไป

1. กรอกส่วน 1–4 ให้ครบก่อนเริ่มออกแบบชิ้นแรก — บันทึกเป็น `docs/3j-ai-system/collections/<ชื่อ-collection>/design-intent.md`
2. เข้า pipeline ตาม `README.md` (ChatGPT reference image → analysis → Claude CAD spec) — ทุกครั้งที่สั่ง Claude ต้องอ้าง `00_Brand_Principles.md` + ไฟล์ collection ที่เพิ่งสร้างคู่กัน
3. ใช้ `04_Claude_Master_Prompt.md` สั่งงานทีละชิ้น เติมชื่อ collection ในช่อง `[collection name]` เพื่อให้ Claude อ่านไฟล์ design-intent ที่ถูกต้อง
4. กรอกตารางสเปกกลาง (ข้อ 5) ทุกครั้งที่ชิ้นงานเสร็จ — ใช้เทียบ consistency ระหว่างชิ้นในเซ็ตเดียวกัน
5. อัปเดต index ใน `README.md` ให้รวม collection ใหม่นี้ไว้ด้วย
