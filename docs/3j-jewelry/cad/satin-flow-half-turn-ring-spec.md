# SATIN FLOW – HALF TURN RING — Reverse-Engineering CAD Spec

**Collection**: THE LADIES COLLECTION — "SATIN FLOW COLLECTION"
**Item**: RING — Concept "SATIN FLOW – HALF TURN"
**หมายเหตุขอบเขตงาน**: เอกสารนี้เป็นงาน reverse-engineering ตาม spec sheet ต้นฉบับ **ห้าม redesign / simplify / เพิ่ม detail / เปลี่ยน proportion / เปลี่ยน setting / เปลี่ยน ribbon flow** เป้าหมายคือ reproduce ให้ตรง 99% visual accuracy

---

## Part 1 — Design Analysis (18 หัวข้อ)

**1. Overall concept**
"SATIN FLOW – HALF TURN" — จำลองริบบิ้นผ้าซาตินพับครึ่งรอบ (half twist) โอบรับเม็ดพลอยกลม โทนเรียบหรู อ่อนโยนแต่มีโครงสร้างแข็งแรงพอใส่ประจำวัน ออกแบบให้ผู้หญิงทุกช่วงวัยใส่ได้ สลับใส่กับแม่/ลูกสาวได้

**2. Shape language**
เส้นโค้งต่อเนื่อง ไม่มีมุมคม (organic continuous curve) — ทุก transition ต้อง fillet ลื่นไหล ไม่มี hard edge ยกเว้นจุดขอบพลอยที่ bezel wall กดยึด

**3. Ribbon flow**
Band บิดตัว (twist) จากจุดต่ำสุด (opposite stone, thin end 3.80mm) ไล่กว้างขึ้นเป็น 5.20mm เมื่อเข้าใกล้หัวแหวน แล้วแปลงร่างเป็น bezel wall ครึ่งวง — เหมือนริบบิ้นพับครึ่งรอบ (half turn ≈ 180° ไม่ใช่ full 360°)

**4. Metal thickness**
Band thickness คงที่ 1.25mm ตลอดเส้นรอบวง (เกณฑ์หล่อเงินขั้นต่ำ ~0.8–1.0mm ผ่านสบาย) — bezel wall ต้องหนากว่าจุดนี้เพื่อยึดพลอย (ดู Part 5)

**5. Surface transition**
Outer surface = High Polish (สะท้อนแสงเน้นเส้นริบบิ้น) / Inner surface (ผิวสัมผัสนิ้ว) = Hairline (satin, ลดรอยขีดข่วนจากการสวมใส่ประจำวัน) — เส้นแบ่ง finish อยู่ตรง transition ของ cross-section ต้องกำหนดชัดให้ช่างขัดแยกโซน

**6. Cross section (band)**
หน้าตัดบิด/คอดตรงกลาง (pinched twisted ribbon profile) — ไม่ใช่หน้าตัดสี่เหลี่ยมธรรมดา มี waist บาง ๆ กลางหน้าตัดคล้ายผ้าถูกบิด กว้าง 3.80–5.20mm × หนา 1.25mm

**7. Cross section A-A (ผ่านเม็ดพลอย)**
กว้าง 1.80mm × สูง 2.40mm — เป็นหน้าตัดที่ bezel wall โอบเม็ดพลอย

**8. Stone position**
เม็ด Blue Topaz Ø5.00mm วางตรงกลางหัวแหวน (top-center) ยกจากผิวนิ้วขึ้น top height รวม 2.40mm

**9. Stone setting**
Semi-bezel (half bezel) — โลหะโอบพลอยแค่ 2 ฝั่งตามแนวแกน twist เปิดอีก 2 ฝั่งให้เห็นเม็ดพลอย ทำให้ดู floating ไม่ใช่ full bezel ล้อมรอบ 360°

**10. Curvature**
รัศมีโค้งของ ribbon twist ต้อง smooth ต่อเนื่อง G2 continuity (ไม่ใช่แค่ tangent G1) เพื่อให้แสงสะท้อนไหลลื่นแบบผ้าจริง — เป็นจุดที่ CAD script ทำได้แค่ blockout รายละเอียดสุดท้ายต้องมือคน sculpt

**11. Radius**
ขอบในโค้งมน comfort-fit radius (inner band edge) ประมาณ R0.3–0.5mm ลบคมทุกขอบสัมผัสนิ้ว

**12. Twist angle**
Half turn ≈ 180° ตลอดความยาว band จากจุดเริ่ม (thin end) ถึงจุด bezel (thick end) — ไม่ใช่ full 360° twist ตามชื่อ concept "HALF TURN"

**13. Comfort fit**
Inner diameter 17.20mm (ring size 54) ผิวใน hairline + โค้งมน ไม่มีขอบคม ไม่บาดนิ้ว

**14. Estimated weight**
3.20g (+/-15%) ตามสเปกต้นฉบับ — จะยืนยันจริงต้องผ่าน volume calculation จาก 3D model ที่เก็บ detail เสร็จแล้ว × density เงิน 925 (10.36 g/cm³)

**15. Manufacturing feasibility**
Lost-wax casting ทำได้ — จุดยากคือ semi-bezel wall บางที่ต้องหนาพอยึดพลอยแต่บางพอให้ดู floating (ดู Part 5) กับผิวสองโทน (polish/hairline) ต้องขัดแยกโซนหลังหล่อ

**16. Casting considerations**
Twist geometry มี undercut เล็กน้อยบริเวณ transition band→bezel ต้องเช็ค wax tree/sprue placement ให้โลหะไหลถึงจุดบางสุด (semi-bezel wall) ไม่เกิด porosity/misrun แนะนำเดินเกทจากฝั่ง band หนา (5.20mm)

**17. Polishing access**
ร่อง twist ด้านในโค้งอาจเป็นจุดที่ polishing wheel เข้าถึงยาก ต้องใช้ hand tool/rubber wheel เก็บมุมอับ โดยเฉพาะรอยต่อ hairline/high-polish ระหว่างขัด 2 โทนต้อง masking ป้องกันเลอะข้ามโซน

**18. Assembly process**
งานนี้เป็นชิ้นเดียวหล่อรวด (single-piece casting) ไม่มีชิ้นส่วนประกอบแยก — ลำดับงานคือ hand-finish จาก wax/cast → ขัด hairline (inner) → mask → ขัด high polish (outer) → setting เม็ดพลอย (burnish bezel wall กดจาก 2 ฝั่งที่เปิดไว้) → ตรวจสอบคุณภาพและชั่งน้ำหนักสุดท้ายเทียบ spec 3.20g ±15%

---

## Part 2 — CAD Specification

| พารามิเตอร์ | ค่า |
|---|---|
| Metal | Silver 925 |
| Finish outer | High Polish |
| Finish inner | Hairline (satin) |
| Stone | Blue Topaz, Round brilliant, Ø 5.00mm |
| Stone height (table–culet) | 1.80mm (ประเมิน, pavilion จริงอาจลึกกว่า) |
| Setting | Semi-bezel (half bezel), เปิด 2 ฝั่ง |
| Ring size | 54, inner diameter 17.20mm |
| Band width | 3.80mm (thin end) → 5.20mm (ที่หัวแหวน) |
| Band thickness | 1.25mm คงที่ |
| Top height | 2.40mm |
| Cross section A-A | 1.80mm (W) × 2.40mm (H) |
| Weight est. | 3.20g ±15% |

---

## Part 3 — Manufacturing Notes

- **Casting**: Lost-wax, เดินสายสปรูให้โลหะไหลถึง bezel wall (จุดบางสุด) ก่อนแข็งตัว — เสี่ยง misrun ถ้า gate เดียวจากปลาย band บาง 3.80mm ควรเดินเกทจากฝั่งหนา (5.20mm)
- **Polishing**: แยก 2 pass — outer (high polish, buffing wheel) / inner (hairline, brush satin) ต้อง masking หรือขัดตามลำดับให้เส้นแบ่งคมชัด ไม่เลอะข้ามโซน
- **Stone setting**: burnish/press bezel wall หลังขัด (ป้องกันขนแปรงโดนพลอย) ใช้ setting bur เจาะ seat ให้พอดี girdle ก่อน press กดจาก 2 ฝั่งที่เปิดให้แรงสมดุล

---

## Part 4 — Dimensions สรุป (mm)

- Inner diameter (ring size 54): 17.20
- Band width: 3.80 – 5.20 (ไล่ระดับต่อเนื่อง)
- Band thickness: 1.25
- Top height: 2.40
- Stone: Ø 5.00, height 1.80
- Cross-section A-A: 1.80 × 2.40
- Top view head width: ~5.60
- Front view: stone 1.80 / head 2.80 / band 1.80

---

## Part 5 — Potential Problems

1. **Semi-bezel wall บางเกินไป** — ถ้าออกแบบให้ wall thin ตามภาพสวยเป๊ะ อาจ <0.6mm ที่จุดรับ girdle พลอย → เสี่ยงหล่อไม่ติด/บิ่นตอน setting/พลอยหลุดใช้งานจริง (เกณฑ์ bezel wall ควร ≥0.7mm)
2. **Ribbon twist undercut** — บริเวณ transition band→bezel มี geometry บิดซับซ้อน เสี่ยง wax investment ไม่ทั่วถึง เกิด porosity
3. **Unbalanced force ตอน setting** — semi-bezel เปิด 2 ฝั่ง แรงกดตอน burnish ไม่สมมาตรเหมือน full bezel เสี่ยงพลอยเอียง/หลุด seat
4. **จุดต่อ finish 2 โทน** — เส้นแบ่ง high polish/hairline คมชัดยาก ถ้าขัดเผลอเลยแนวจะดูลวก
5. **Band บางสุด (1.25mm thickness / 3.80mm width จุด waist)** — ถ้า cross-section คอดกลาง (pinched) มากตามภาพ อาจมีจุดที่ต่ำกว่าเกณฑ์หล่อ 0.8–1.0mm ต้องเช็คในโมเดล 3D จริงก่อนส่งหล่อ

---

## Part 6 — Suggestions WITHOUT changing appearance

- เสริมความหนา bezel seat **จากด้านใน** (มองไม่เห็นจากมุมมองด้านนอก) เพิ่ม wall thickness เฉพาะจุดรับ girdle พลอยจากด้านหลัง ~0.1–0.15mm โดยไม่เปลี่ยน outer silhouette
- เพิ่ม internal support rib บางๆ ใต้ bezel wall (ซ่อนใต้เม็ดพลอย มองไม่เห็นจากด้านบน) ช่วยกระจายแรง burnish ระหว่าง setting
- ปรับ sprue/gate position ให้เข้าที่ shank ฝั่งหนา (5.20mm) แทนฝั่งบาง — เป็นการปรับ production process ไม่กระทบ geometry ที่มองเห็น
- ลำดับขัด: ขัด hairline (inner) ก่อน mask แล้วค่อยขัด high-polish (outer) ทับ — ลดโอกาสเส้นแบ่งเลอะ (ปรับ process order ไม่ใช่ design change)

---

## ไฟล์ที่เกี่ยวข้อง

RhinoPython base geometry script: [`satin-flow-half-turn-ring.py`](./satin-flow-half-turn-ring.py)
(สร้าง shank comfort-fit loft + bezel wall placeholder + stone placeholder — เป็น **blockout เท่านั้น** ช่างต้องเก็บ organic ribbon twist detail และตัด semi-bezel เปิด 2 ฝั่งต่อด้วยมือ)
