# 05 — Ring Workflow (แหวน)

> **ใช้ตอนไหน**: ทำแหวนชิ้นใหม่ — ใช้คู่กับ `04_Claude_Master_Prompt.md` (prompt template) และ `03_3J_CAD_Guideline.md` (เกณฑ์ผลิต)
> **ต้องอ่าน [`00_Brand_Principles.md`](./00_Brand_Principles.md) ก่อนเริ่มทุกครั้ง** (brand-level) **พร้อมกับ `collections/<ชื่อ collection>/design-intent.md`** ของ collection ที่กำลังทำ (collection-level) — กฎโครงสร้างเฉพาะ motif (เช่น split เฉพาะใกล้หัวแหวน/ห้ามบิดทั้งวงของ Satin Flow) มาจากไฟล์ collection ไม่ใช่ทุกแหวนของทุก collection ต้องมีกฎนี้
> ตัวอย่างจริงทั้ง workflow (collection **Satin Flow**): **SATIN FLOW – HALF TURN RING** — [design-intent](./collections/satin-flow/design-intent.md) · [spec](../cad/satin-flow-half-turn-ring-spec.md) · [RhinoPython](../cad/satin-flow-half-turn-ring.py) · [3D preview](../cad/satin-flow-preview.html)
> ⚠️ หมายเหตุ: spec/script ของ Satin Flow อ้างอิงจากช่วงที่ยังตีความ ribbon เป็น "twist ตลอดวง" — ถือเป็นบทเรียนของความผิดพลาดที่แก้แล้ว เวลาใช้ไฟล์นี้เป็นตัวอย่าง ให้ดู "โครงสร้างและมิติ" เป็นแนวทาง แต่ **ตำแหน่ง twist ต้องแก้ตามกฎใหม่ของ Satin Flow: split เฉพาะใกล้หัวแหวน ครึ่งวงตรงข้ามเป็น band ปกติ**

---

## Test ก่อนเริ่ม + NEVER-DO (มาจาก collection design-intent — ตัวอย่างด้านล่างคือของ Satin Flow)

> กฎในหัวข้อนี้เป็น**ตัวอย่างอ้างอิงจาก collection Satin Flow เท่านั้น** ถ้าทำแหวน collection อื่น ให้แทนที่ด้วย test/NEVER-DO/กฎโครงสร้างจาก `collections/<ชื่อ>/design-intent.md` ของ collection นั้นแทน — อย่าใช้กฎ Satin Flow กับ collection ที่ไม่ใช่ Satin Flow

**ตัวอย่าง (Satin Flow)**:
- Test ทุกจุดของ geometry: **"ยังดูเหมือนผ้าซาตินพับอยู่ไหม?"** — ถ้าไม่ใช่ ห้ามใช้วิธีนั้น
- **ห้าม**: บิดทั้งวง (full twist ตลอดเส้นรอบวง), ริบบิ้นเป็นเชือก/rope, ลาย Celtic/woven/braided, prong เทอะทะ, แยกพลอยออกจากริบบิ้นชัดเจน
- **กฎโครงสร้างบังคับ**: split (ริบบิ้นแยก/เปิดโอบพลอย) เกิด**เฉพาะบริเวณใกล้หัวแหวน** — ครึ่งวงฝั่งตรงข้ามพลอยต้องเป็น **band ต่อเนื่องธรรมดา ใส่สบาย** ไม่มี motif ริบบิ้น
  ```
  Normal band (ต่อเนื่อง เรียบ) → เปิดออกใกล้พลอย → ริบบิ้นซาติน 2 เส้นโอบพลอย → band รวมกลับ
  ```

---

## ขั้นตอน end-to-end

### 1. Reference image (ChatGPT)
สร้างภาพ 2 มุม (3/4 perspective + top-down) ตาม prompt ใน [`docs/3j-jewelry/brand-ops/3j-jewelry-design-prompts.md`](../brand-ops/3j-jewelry-design-prompts.md) ①
ตัวอย่าง Satin Flow: ธีม "ริบบิ้นซาตินพับครึ่งรอบ (half turn) โอบเม็ดพลอยกลม"

### 2. Design analysis (ChatGPT)
ใช้ prompt ② วิเคราะห์ 8 หัวข้อ — สำหรับแหวนต้องได้คำตอบชัดเรื่อง band profile (คงที่หรือไล่ระดับ), ตำแหน่งพลอย, setting type
ตัวอย่าง Satin Flow: band บิด 180°, ไล่กว้าง 3.80→5.20mm, semi-bezel เปิด 2 ฝั่ง

### 3. ส่งต่อ Claude (`jewelry-designer`)
ใช้ `04_Claude_Master_Prompt.md` เติมข้อมูลเพิ่มที่ **แหวนต้องรู้ก่อนเริ่มเสมอ**:
- **Ring size** → inner diameter (mm) อ้างมาตรฐาน อย่ามั่ว (ตัวอย่าง: size 54 = ID 17.20mm)
- **Band width/thickness**: คงที่หรือไล่ระดับ ระบุค่าต่ำสุด-สูงสุด (ตัวอย่าง: thickness คงที่ 1.25mm, width 3.80–5.20mm)
- **Setting**: prong/bezel/semi-bezel/pavé + ขนาดพลอย
- **Comfort fit**: inner edge fillet R0.3–0.5mm เสมอ (ตาม `03_3J_CAD_Guideline.md`)

### 4. CAD spec + RhinoPython (Claude output)
ได้ Part 1–7 ตาม `04_Claude_Master_Prompt.md` — ตรวจว่าครอบคลุมจุดเฉพาะแหวนครบ (ดู checklist ด้านล่าง)

### 5. Rhino
Paste script → ได้ shank loft + placeholder bezel/prong + placeholder พลอย (blockout เท่านั้น)

### 6. ช่างเก็บ detail
Sculpt organic curve/twist ที่ script ทำไม่ถึง, ตัด setting เปิด/ปิดจริง, ขัด 2 โทน finish, burnish พลอย

---

## Checklist เฉพาะแหวน

- [ ] Ring size ระบุชัด + inner diameter (mm) แปลงถูกต้องตามตาราง size มาตรฐาน
- [ ] Band width/thickness ระบุทั้งค่าต่ำสุด-สูงสุด (ถ้าไล่ระดับ) พร้อมเช็คว่า thickness ทุกจุด ≥ 0.8–1.0mm
- [ ] ถ้ามีพลอย: ระบุ setting type, ขนาด mm, จำนวน, bezel/prong wall ≥ 0.7mm
- [ ] Comfort fit: inner edge fillet R0.3–0.5mm ระบุชัด ไม่ปล่อยขอบคม
- [ ] น้ำหนักเงินประมาณ (กรัม ±15%) + เทียบงบที่ลูกค้ากำหนด
- [ ] Casting/sprue direction ระบุจากจุดหนาสุด
- [ ] Finish 2 โทน (ถ้ามี) ระบุตำแหน่งเส้นแบ่งชัดบน cross-section

## อ้างอิงตัวเลข ring size ↔ inner diameter (มาตรฐานทั่วไป — ยืนยันกับตารางจริงก่อนใช้ผลิต)

| Ring size (TH/Intl ~) | Inner diameter (mm) โดยประมาณ |
|---|---|
| 50 | 15.90 |
| 52 | 16.55 |
| 54 | 17.20 |
| 56 | 17.85 |
| 58 | 18.50 |

> ตัวเลขนี้เป็นค่ามาตรฐานทั่วไป ใช้ประกอบการคิดเบื้องต้น — ก่อนส่งผลิตจริงควรเทียบกับ ring sizer/มาตรฐานที่ 3J ใช้จริงอีกครั้ง
