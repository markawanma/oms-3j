# 3J Jewelry — Prompt ชุดออกแบบ Collection (ใช้ซ้ำทุกครั้ง)

> Workflow: **ChatGPT** (สร้างรูป + วิเคราะห์) → **Claude / `jewelry-designer`** (CAD spec + RhinoPython) → **Rhino**
>
> ใช้กับแบรนด์ 3J — เงิน 92.5 (Sterling Silver 925), โทนขาว/แดง/เทา, ขายไลฟ์ Shopee/TikTok

---

## Flow เต็ม (ภาพรวม)

```
ChatGPT ①  →  reference image (2 มุม)
ChatGPT ②  →  design analysis (8 หัวข้อ)
     ↓  copy ทั้งก้อน
[session ใหม่]  "ให้ jewelry-designer ออกแบบจาก analysis นี้ + ring size 52, งบ X"
     ↓
Claude  →  CAD spec + RhinoPython
     ↓
Rhino  →  paste รัน → เก็บ detail ต่อ
```

---

## ① Prompt สร้าง Reference Image (ChatGPT / DALL·E)

ก็อปแล้วเติมช่อง `[...]`:

```text
Product photography of a sterling silver 925 [ประเภท: ring / pendant / earrings / bracelet],
[สไตล์: minimal modern / vintage / nature-inspired / geometric] style.
Design theme: [ธีม collection เช่น "lotus / ocean wave / art deco"].
[ถ้ามีพลอย] Set with [ชนิดพลอย เช่น round CZ / blue sapphire] stone.
High polish finish, clean white studio background, soft even lighting, no shadow clutter.
Show TWO angles in one image: a 3/4 perspective view AND a top-down view.
Sharp focus, high detail, jewelry catalog quality, centered composition.
```

**เคล็ด:**
- ยืนยัน **"silver 925"** เสมอ — ไม่งั้น AI ชอบเปลี่ยนเป็นทอง
- **"two angles"** สำคัญมาก → analysis แม่นขึ้นเยอะ
- อยากได้หลายแบบ เติมท้าย: `Generate 4 variations` แล้วเลือกอันที่ชอบ

---

## ② Prompt วิเคราะห์ Design (ป้อนรูปกลับเข้า ChatGPT)

อัปโหลดรูปที่เลือกกลับเข้า ChatGPT แล้วใช้ prompt นี้ (หัวข้อ 1–8 แมตช์ input ที่ `jewelry-designer` ต้องการพอดี):

```text
วิเคราะห์เครื่องประดับในรูปนี้ให้เป็นสเปกเชิงเทคนิคสำหรับทำ CAD เงิน 925
ตอบเป็นหัวข้อตามนี้เท่านั้น อย่าเพิ่มความเห็นการตลาด:

1. ประเภทชิ้นงาน + concept (1 ประโยค)
2. รูปทรงหลัก + องค์ประกอบ (แยกเป็นชิ้นๆ ว่ามีอะไรบ้าง)
3. สัดส่วน/proportion โดยประมาณ (อัตราส่วน เช่น band หนา:กว้าง, ขนาดพลอยเทียบตัวเรือน)
4. Gemstone (ถ้ามี): ชนิด, รูปทรงเจียระไน, จำนวน, ชนิด setting (prong/bezel/pavé)
5. Finish ที่เห็น (polish/matte/oxidized)
6. รายละเอียดลวดลาย/texture ที่ต้องแกะ
7. จุดที่น่าจะผลิต/หล่อยาก + ข้อควรระวัง
8. องค์ประกอบที่รูปไม่ชัด/ต้องตัดสินใจเพิ่ม (list ออกมา)

ตอบเป็นภาษาไทย ตัวเลข/สัดส่วนใส่หน่วยหรืออัตราส่วนให้ชัด
```

**ทำไมข้อ 8 สำคัญ:** ดักจุดที่รูปบอกไม่ได้ (ring size, ความหนาจริง, น้ำหนักเงิน) → คุณเติมค่าพวกนี้ตอนสั่ง Claude

---

## ③ ส่งต่อให้ Claude (`jewelry-designer`) — เปิด session ใหม่

วาง analysis จากข้อ ② แล้วเติมค่าที่รูปไม่บอก:

```text
ให้ jewelry-designer ออกแบบ [ประเภทชิ้น] collection "[ชื่อธีม]" จาก design analysis นี้:

[วาง analysis 8 หัวข้อจาก ChatGPT]

ข้อมูลเพิ่ม:
- ring size / ขนาดสวมใส่: [เช่น US 6 / 52]
- พลอย: [ชนิด + ขนาด mm + จำนวน]
- finish: [polish / matte / oxidized / rhodium]
- งบต่อชิ้น: ไม่เกิน [X] บาท
```

จะได้กลับมา: **CAD spec (สำหรับช่าง)** + **RhinoPython (paste เข้า Rhino รันได้)** + design decision/trade-off

---

## Checklist ก่อนเริ่มแต่ละ collection
- [ ] ธีม collection ชัดแล้ว
- [ ] reference image มี **2 มุม** อย่างน้อย
- [ ] analysis ครบ 8 หัวข้อ (โดยเฉพาะข้อ 8)
- [ ] รู้ ring size / ขนาดสวมใส่
- [ ] รู้งบต่อชิ้น (คุมน้ำหนักเงิน)
- [ ] เปิด session ใหม่ (ไม่ปนงานอื่น) แล้วเรียก `jewelry-designer`
