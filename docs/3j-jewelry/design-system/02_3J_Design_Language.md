# 02 — 3J Design Language (หมวดภาษาดีไซน์ที่ทุก collection ต้องนิยาม)

> **ใช้ตอนไหน**: ตอนคิดทรง/เส้น/สัดส่วนของชิ้นงานใหม่ — ทั้งฝั่ง ChatGPT (สร้างภาพ) และ Claude (ทำ CAD)
> **ต้องอ่าน [`00_Brand_Principles.md`](./00_Brand_Principles.md) ก่อนไฟล์นี้เสมอ** — ไฟล์ `00` เป็น authoritative ระดับแบรนด์
> **ไฟล์นี้ไม่ใช่ภาษาดีไซน์ของ collection ใด collection หนึ่ง** — เป็น**หมวด/checklist** (Curve/Ribbon/Surface/Stone/Metal/Proportion/Balance/Negative Space/Finish/Symmetry) ที่**ทุก collection ต้องนิยามค่าของตัวเอง** บางหมวดมี **brand default** ที่ใช้ได้เลยถ้า collection ไม่ได้ระบุต่าง (เช่น Surface calm, Metal เงิน 925) ส่วนหมวดที่ผูกกับ motif เฉพาะ (เช่น Ribbon) ต้องไปดูตัวอย่าง/นิยามจริงใน `collections/<ชื่อ>/design-intent.md`

---

## วิธีอ่านไฟล์นี้

- ตัวหมวดด้านล่าง = สิ่งที่ต้องคิด ไม่ใช่คำตอบสำเร็จรูปของทุกชิ้น
- ตอนเริ่ม collection ใหม่ ใช้ `09_Collection_Template.md` เพื่อกรอกค่าของแต่ละหมวดสำหรับ collection นั้นๆ ลงใน `collections/<ชื่อ>/design-intent.md`
- ตัวอย่างที่ยกในไฟล์นี้ (เช่น Ribbon = folded satin) เป็น**ตัวอย่างอ้างอิงจาก Satin Flow เท่านั้น** ไม่ใช่ค่าบังคับของทุก collection

---

## 1. Curve Language (ภาษาเส้นโค้ง) — brand default
เส้นโค้งต่อเนื่องเส้นเดียว (one continuous motion) — ไม่มีเปลี่ยนทิศมั่ว ไม่มีมุมหักฉับพลัน ไม่แข็งทื่อ (ดู `00_Brand_Principles.md`)
- **GOOD**: curvature ต่อเนื่องแบบ G1/G2, โค้งนุ่มนวล
- **BAD**: มุมหักคม, เปลี่ยนทิศทางกะทันหันแบบไม่มีเหตุผลของ flow
- แต่ละ collection อาจตีความ "ต้นเหตุ" ของ curve ต่างกัน (เช่น Satin Flow = ผ้าพับ) — ระบุ metaphor เฉพาะใน collection file

## 2. Ribbon/Motif Language — **แต่ละ collection นิยามเอง (ไม่ใช่ brand default)**

หมวดนี้**ไม่มีค่าตั้งต้นระดับแบรนด์** เพราะ motif เป็นของเฉพาะแต่ละ collection — บาง collection อาจไม่มี ribbon/motif เลยก็ได้ (เช่น geometric เรียบ)

**ตัวอย่างอ้างอิง — Satin Flow** (ดูฉบับเต็มที่ authoritative ใน [`collections/satin-flow/design-intent.md`](./collections/satin-flow/design-intent.md)):

| GOOD (ใช้ได้ใน Satin Flow) | BAD (ห้ามเด็ดขาดใน Satin Flow) |
|---|---|
| Folded satin — ผ้าพับซ้อนเป็นชั้น | Rope / cable — ดูเป็นเชือกกลม |
| Flowing sheet — แผ่นผ้าไหลลื่น | Spiral — บิดเป็นเกลียวรอบแกน |
| Continuous reflection — แสงสะท้อนไหลต่อเนื่องเป็นเส้นยาว | Braided / woven — ลายถักสาน |

> **สำคัญ**: ตาราง GOOD/BAD ข้างบนใช้กับ**เฉพาะ collection Satin Flow** ห้ามนำไปใช้เป็นกฎบังคับของ collection อื่น — collection ใหม่ต้องตั้งตาราง GOOD/BAD ของ motif ตัวเองใน `collections/<ชื่อ>/design-intent.md`

## 3. Surface Language (ภาษาผิว) — brand default
ผิวใหญ่ ขัดเงา **calm** (สงบ ไม่รก ไม่แสงสะท้อนแตกกระจาย) — transition ระหว่างส่วนต้อง**นุ่ม** ไม่มีรอยตัดคม ไม่มี detail เกินจำเป็น (ดู `00_Brand_Principles.md`)
- ถ้าต้องมี 2 โทนผิว (เช่น จุดสัมผัสผิวหนังเป็น matte/hairline เพื่อความทนทาน) เส้นแบ่งโซนต้องนุ่มไม่ใช่เส้นตัดคม — อย่าให้ requirement การผลิต (2 finish) ทำให้ดูเป็นชิ้นส่วนแยก
- **GOOD**: ผิวใหญ่เนียน จับแสงเป็นแนวยาวต่อเนื่อง
- **BAD**: ผิวแตกเป็นแฉกเล็กๆ, facet เยอะจนดูรก

ตัวอย่างเฉพาะ collection (เช่น "เหมือนผ้าซาติน") ดูใน collection file — brand default ข้างบนคือพื้นฐานที่ต้องมีเสมอ

## 4. Stone Language (ภาษาพลอย) — brand default บางส่วน + collection นิยามเพิ่ม
พลอยเป็น**ศูนย์กลางภาพ** เสมอ ไม่ว่า collection ไหน — setting ต้องไม่แข่งกับพลอย (brand default)
- **ห้าม prong เทอะทะ** เป็นเกณฑ์ผลิต (ดู `03_3J_CAD_Guideline.md`)
- โฟกัสเม็ดเดียวชัดเจน มากกว่า pavé รกหลายเม็ดเล็ก เป็นค่าเริ่มต้น เว้นแต่ collection ระบุอื่น
- ลักษณะเฉพาะว่า setting "กลืนกับอะไร" (เช่น Satin Flow = กลืนกับริบบิ้น) เป็นเรื่องของแต่ละ collection — ดู collection file

## 5. Metal Language (ภาษาโลหะ) — brand default
เงิน 92.5 เท่านั้นเป็นค่าตั้งต้นของทุก collection — ไม่ mix โลหะสี ไม่ plating สีทองเว้นแต่สั่งเฉพาะ (ดู `01_3J_Brand_DNA.md`)

## 6. Proportion (สัดส่วน) — collection นิยามเอง
Band/shank thickness เป็นตัวเลขที่**ต่างกันได้ตาม collection** — ตัวเลขอ้างอิงจาก Satin Flow (1.25mm คงที่) เป็นตัวอย่าง 1 collection เท่านั้น ไม่ใช่ค่ามาตรฐานของทุกชิ้น ระบุตัวเลขจริงใน `collections/<ชื่อ>/design-intent.md` (เกณฑ์ขั้นต่ำ 0.8–1.0mm ยังบังคับเสมอ — ดู `03_3J_CAD_Guideline.md`)

## 7. Balance (ความสมดุล) — brand default
งานไม่จำเป็นต้องสมมาตรซ้าย-ขวาสมบูรณ์แบบ แต่**น้ำหนักภาพ (visual weight)** ต้องสมดุลเสมอ ไม่ว่า motif จะเป็นอะไร

## 8. Negative Space (พื้นที่ว่าง) — brand default
มินิมอลแปลว่าเว้นพื้นที่ว่างให้ตา "พัก" สอดคล้องกับ Simplicity ใน visual priority — ไม่อัด detail เต็มทุกจุด ช่องว่างคือส่วนหนึ่งของ flow ไม่ใช่พื้นที่เหลือ

## 9. Finish (การเก็บผิว) — brand default
ค่าตั้งต้น: High Polish calm surface (ตาม Surface Language ข้อ 3) — ตัวเลือกอื่น (matte/oxidized/rhodium) ต้องระบุชัดเสมอ และต้องไม่ทำลาย feeling ของ collection นั้น (เช่น oxidized เข้มทั้งชิ้นอาจขัดกับ "ผ้าเบา" ของ Satin Flow — เช็คกับ test ของ collection นั้นก่อนใช้)

## 10. Symmetry (สมมาตร) — brand default + exception ต่อ collection
ค่าตั้งต้น: radial/mirror symmetry เรียบง่าย เว้นแต่ collection ระบุ asymmetric ชัดเจนแบบมีเหตุผล (เช่น Satin Flow: split เฉพาะจุดใกล้หัวแหวน — "asymmetric ที่ตั้งใจ" ไม่ใช่ backup แบบสุ่ม ดูรายละเอียดใน collection file)

---

## สรุป: อะไรคือ brand default vs อะไรคือของแต่ละ collection

| หมวด | brand default (ใช้ได้เลยถ้าไม่ระบุอื่น) | ต้องนิยามเฉพาะ collection |
|---|---|---|
| Curve | โค้งต่อเนื่อง ไม่หักมุม | metaphor ของ curve (เช่น "ผ้าพับ") |
| Ribbon/Motif | — (ไม่มี default) | ทั้งหมด — GOOD/BAD list, NEVER-DO |
| Surface | calm, ผิวใหญ่, transition นุ่ม | ลักษณะเปรียบเทียบเฉพาะ |
| Stone | เป็นศูนย์กลาง, ไม่ prong เทอะทะ | ลักษณะ setting กลืนกับอะไร |
| Metal | เงิน 925 | — (เปลี่ยนได้เฉพาะสั่งพิเศษ) |
| Proportion | เกณฑ์ขั้นต่ำ 0.8–1.0mm | ตัวเลข thickness/width จริง |
| Balance | visual weight สมดุล | — |
| Negative Space | เว้นพื้นที่ว่าง | — |
| Finish | High Polish default | ทางเลือกอื่นที่เข้ากับ motif |
| Symmetry | mirror symmetry default | exception ที่มีเหตุผลตาม motif |

> ตัวอย่างที่กรอกครบแล้วของ collection แรก: [`collections/satin-flow/design-intent.md`](./collections/satin-flow/design-intent.md)
