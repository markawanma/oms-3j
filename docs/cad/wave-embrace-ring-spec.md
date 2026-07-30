# WAVE EMBRACE RING (WE-R001) — Reverse-Engineering CAD Spec

**Collection**: New Signature Collection — "WAVE EMBRACE"
**Item**: RING — Code WE-R001 — "Soft wave. Hidden sparkle."
**หมายเหตุขอบเขตงาน**: เอกสารนี้ reverse-engineer จาก spec sheet ต้นฉบับที่เจ้าของแบรนด์ส่งมา **ห้าม redesign / simplify / เพิ่ม detail / เปลี่ยน proportion / เปลี่ยน setting / เปลี่ยน wave flow** เป้าหมายคือ reproduce ให้ตรงตาม spec
**ต้องอ่านคู่กับ**: [`../3j-ai-system/00_Brand_Principles.md`](../3j-ai-system/00_Brand_Principles.md) + [`../3j-ai-system/collections/wave-embrace/design-intent.md`](../3j-ai-system/collections/wave-embrace/design-intent.md)

---

## Part 1 — Design Analysis (18 หัวข้อ)

**1. Overall concept**
"WAVE EMBRACE" — จำลองการไหลนุ่มนวลของคลื่นทะเล ด้านนอกมินิมอลเรียบหรู มีพลอยเม็ดจิ๋วซ่อนอยู่ด้านในวงแหวน เป็นประกายลับที่มีแต่คนใส่รู้เอง ไม่โชว์ให้คนนอกเห็น

**2. Shape language**
ผิวบนของ band ไหลเป็นคลื่นนุ่ม soft peak เดียว ต่อเนื่องแบบ G1/G2 continuity ไม่มีมุมหักคม transition ทุกจุดต้อง fillet ลื่นไหล

**3. Wave flow**
Band ไล่ความกว้างจาก 2.00mm (จุดต่ำสุด/bottom, ตรงข้ามยอดคลื่น) ขึ้นไป 2.10mm (จุดสูงสุด/wave peak) แบบค่อยเป็นค่อยไป (gradual, ไม่ใช่ step) — wave height (ความสูงจากผิวล่างถึงยอดคลื่น) = 1.60mm มี **soft peak เดียว** ต่อรอบวง ไม่ใช่หลายลอน

**4. Metal thickness**
Band thickness คงที่ 1.80mm ทั้งเส้น (ผ่านเกณฑ์หล่อขั้นต่ำ 0.8–1.0mm สบาย) ผนังรอบ seat พลอยด้านในต้องเช็คแยก (ดู Part 5) เพราะเป็นจุดที่เจาะเนื้อโลหะออกเพื่อฝังพลอย

**5. Surface transition**
Polish (High Polish) ทั้งผิวนอกและผิวใน — ไม่มีเส้นแบ่ง 2 โทนแบบ Satin Flow เพราะ Wave Embrace ไม่มี motif ที่ต้องแยกโซนขัด ยกเว้นบริเวณ seat พลอยด้านในที่ต้อง polish ให้เนียนเสมอผิว (flush) ไม่สะดุดนิ้ว

**6. Cross section (band)**
วงรีมน (rounded oval) ตลอดเส้นรอบวง ไม่ใช่สี่เหลี่ยม — ไล่ขนาดจาก 2.00×1.80mm (bottom) ไป 2.10×1.80mm (wave peak, cross-section A-A') กว้างขึ้นเล็กน้อยที่ยอดคลื่นเพื่อรองรับ mass ของคลื่นที่นูนขึ้น

**7. Cross section A-A' (ผ่านยอดคลื่น)**
กว้าง 2.10mm × สูง 1.80mm วงรีมน — จุดที่ wave height ขึ้นสูงสุด 1.60mm เหนือเส้น baseline ของ band

**8. Cross section B-B' (band bottom)**
กว้าง 2.00mm × สูง 1.80mm วงรีมน — จุดฝั่งตรงข้ามยอดคลื่น เป็น band ปกติไม่มีการยกตัว

**9. Stone position**
White Sapphire 1.3mm × 1–2 เม็ด วางตำแหน่ง **กลางล่างด้านในวงแหวนใกล้ยอดคลื่น** (inner surface ใกล้จุดที่ wave peak อยู่ด้านนอกตรงข้าม) — เลือกตำแหน่งนี้เพราะเป็นจุดที่เนื้อโลหะหนาที่สุด (รองรับจาก wave mass ด้านนอก) มีที่พอสำหรับเจาะ seat โดยไม่กระทบผนังบางเกินเกณฑ์

**10. Stone setting**
**Flush setting ฝังด้านในเท่านั้น** — เจาะ seat เข้าไปในผิวในของ band ให้พลอยฝังเสมอผิว (girdle อยู่ระดับเดียวกับผิวโลหะรอบข้าง) ไม่มีส่วนใดของพลอยยื่นออกมาสัมผัสนิ้วหรือมองเห็นจากภายนอก — **ไม่ใช่ prong ไม่ใช่ bezel ที่ยื่นขึ้น** เพราะจะขัดกับ concept "hidden" และเสี่ยงบาดนิ้ว/เกี่ยวเสื้อผ้า

**11. Curvature**
Wave surface ต้อง smooth G1/G2 continuity ทุกจุดเปลี่ยนจาก bottom cross-section ไป wave-peak cross-section — ไม่มี curvature spike หรือจุดสะดุดสายตา/สายนิ้ว เป็นจุดที่ RhinoPython blockout ทำได้แค่ประมาณ รายละเอียดสุดท้ายต้อง sculpt มือ

**12. Radius**
ขอบในทุกจุด (โดยเฉพาะรอบ seat พลอย) ต้อง fillet R0.25–0.30mm ขั้นต่ำ (ตามเกณฑ์ CAD guideline ของ Wave Embrace: min fillet 0.25mm สำหรับขอบที่มองเห็น) — comfort fit บังคับไม่ให้มีขอบคมสัมผัสนิ้ว โดยเฉพาะขอบรอบ seat พลอยด้านใน

**13. Comfort fit**
Inner diameter 17.20mm (ring size 54/US size ~7) ผิวในต้อง polish เนียน โค้งมนต่อเนื่อง ไม่มีขอบคม seat พลอยด้านในต้องฝัง flush สนิทไม่สะดุดนิ้วขณะสวมใส่/ถอด — จุดนี้สำคัญกว่าปกติเพราะพลอยอยู่ฝั่งที่สัมผัสนิ้วโดยตรง (ต่างจาก Satin Flow ที่พลอยอยู่ด้านนอก)

**14. Estimated weight**
2.40g (+/-15%) ตามสเปกต้นฉบับ — **หมายเหตุความเสี่ยง**: ประมาณการ volumetric อย่างง่าย (torus จาก cross-section วงรี ~2.05×1.80mm รอบ mean diameter ~19.0mm) ให้ค่าประมาณ ~1.8–2.0g ก่อนรวม wave bump volume ส่วนเพิ่ม + fillet — ตัวเลขจริงต้องยืนยันด้วย Rhino MassProperties หลังโมเดลรวม wave geometry เต็มรูปแบบ ถ้าต่ำกว่า 2.40g -15% (2.04g) อย่างมีนัยสำคัญ ให้แจ้งเจ้าของแบรนด์เทียบกับ spec ต้นฉบับ

**15. Manufacturing feasibility**
Lost-wax casting ทำได้ปกติ — จุดที่ต้องระวังคือ seat พลอยด้านใน (เจาะเนื้อโลหะออกจากผนัง 1.80mm) ต้องเหลือผนังรองพลอยพอ (ดู Part 5) และ wave surface ต้องขึ้นรูป wax ให้เนียนก่อนหล่อ ไม่ให้มีรอยต่อ profile ที่มองเห็นได้จาก loft แบบ segment

**16. Casting considerations**
Geometry เป็น solid band ไม่มี undercut รุนแรง (ต่างจาก twist ของ Satin Flow) ความเสี่ยงหลักอยู่ที่จุดบาง (thin spot) รอบ seat พลอยด้านใน — ควรเดินเกท (sprue) จากจุดที่หนาที่สุดคือบริเวณ wave peak (cross-section 2.10×1.80mm) ให้โลหะไหลไปถึงจุดบางสุด (รอบ seat) ก่อนแข็งตัว

**17. Polishing access**
Full polish ทั้งวง เข้าถึงง่ายกว่า Satin Flow (ไม่มีร่องโค้งอับ) ยกเว้นภายใน seat พลอยที่ต้องใช้ hand tool/rubber bur ขนาดเล็กขัดให้เนียนเสมอผิวรอบเม็ดพลอย ไม่ทิ้งรอยขัดคมรอบขอบ seat

**18. Assembly process**
Single-piece casting — ลำดับงาน: hand-finish จาก wax/cast → ขัด polish ทั้งวง (นอก+ใน) → เจาะ/เก็บ seat พลอยด้านในให้ได้ dimension 1.3mm พอดี girdle → set พลอย flush (burnish/press เสมอผิว) → ขัดเก็บรอบ seat อีกรอบให้เนียน → ตรวจสอบมุมมองรอบวงว่าไม่เห็นพลอยจากภายนอก (มุมตรง + มุมเฉียง) → ชั่งน้ำหนักเทียบ spec 2.40g ±15%

---

## Part 2 — CAD Specification

| พารามิเตอร์ | ค่า |
|---|---|
| Metal | Silver 925 |
| Finish | Polish (นอก + ใน) |
| Stone | White Sapphire, round, Ø 1.30mm × 1–2 เม็ด |
| Setting | Flush setting, ฝังด้านในเท่านั้น (hidden จากภายนอกทุกมุม) |
| Ring size | 54, inner diameter 17.20mm |
| Band width | 2.00mm (bottom) → 2.10mm (wave peak) |
| Band thickness | 1.80mm คงที่ |
| Wave height | 1.60mm |
| Top-view span (outer) | 21.20mm |
| Cross-section A-A' (wave peak) | 2.10mm (W) × 1.80mm (H) วงรีมน |
| Cross-section B-B' (band bottom) | 2.00mm (W) × 1.80mm (H) วงรีมน |
| Min wall (brand/collection floor) | 0.80mm |
| Min fillet (ขอบมองเห็น) | 0.25mm |
| Weight est. | 2.40g ±15% (spec ต้นฉบับ — ดู Part 1 ข้อ 14 เรื่องความเสี่ยง estimate) |

---

## Part 3 — Manufacturing Notes

- **Casting**: Lost-wax, เดินเกทจากจุดหนาสุด (wave peak, cross-section 2.10×1.80mm) ให้โลหะไหลไปถึง seat พลอยด้านใน (จุดเสี่ยงบางสุด) ก่อนแข็งตัว ลด porosity/misrun
- **Seat พลอยด้านใน**: เจาะด้วย setting bur ขนาดพอดี girdle ของ White Sapphire 1.3mm เหลือผนังรองพลอย (seat floor) ไม่ต่ำกว่า ~0.5mm เพื่อไม่ให้ผนังบางเกินจนหักหรือหล่อไม่ติด — ถ้าตำแหน่งที่เลือกทำให้ผนังเหลือน้อยกว่านี้ ต้องขยับตำแหน่ง seat เข้าหาจุดที่ band หนาที่สุด (ใกล้ wave peak) มากขึ้น
- **Polishing**: full polish รอบวงรวดเดียว ยกเว้น seat พลอยที่ต้องขัดหลัง set เม็ดเสร็จด้วย hand tool/rubber wheel ขนาดเล็ก เพื่อไม่ให้ polish wheel ใหญ่ไปกระทบพลอยหรือทิ้งรอยขอบ seat ให้เห็น

---

## Part 4 — Dimensions สรุป (mm)

- Inner diameter (ring size 54): 17.20
- Top-view span (outer): 21.20
- Band width: 2.00 (bottom) – 2.10 (wave peak)
- Band thickness: 1.80 (คงที่)
- Wave height: 1.60
- Cross-section A-A' (wave peak): 2.10 × 1.80 (oval)
- Cross-section B-B' (band bottom): 2.00 × 1.80 (oval)
- Stone: Ø 1.30 × 1–2 เม็ด, flush ด้านใน

---

## Part 5 — Potential Problems

1. **ผนังรอบ seat พลอยบางเกินไป** — ถ้าเจาะ seat ลึกเกินไปในผนัง 1.80mm อาจเหลือผนังรองพลอยต่ำกว่าเกณฑ์ปลอดภัย (~0.5mm) เสี่ยงหล่อไม่ติด/พลอยหลุดจาก seat ตอนใช้งานจริง — ต้องเช็คใน 3D model จริงก่อนส่งหล่อ ไม่ใช่แค่ดูจากภาพ 2D
2. **Wave surface ไม่ต่อเนื่อง G1/G2** — ถ้า loft/blockout จาก script สร้างผิวเป็น segment เห็นรอยต่อ (facet) ลูกค้าจะเห็นแสงสะท้อนไม่ลื่นไหลแบบคลื่นจริง ต้องให้ช่างเก็บผิวด้วยมือ (T-Splines/sculpt) ก่อนหล่อ
3. **Stone อาจโผล่ให้เห็นจากมุมมองบางมุม** — ถ้า seat วางตำแหน่งไม่ลึกพอหรือ girdle สูงกว่าผิวโลหะแม้เล็กน้อย จะขัดกับ concept "hidden sparkle" ทั้งหมด (visible stone คือ NEVER-DO อันดับหนึ่งของ collection นี้) — ต้องตรวจทุกมุม (ตรง, เฉียง 45°, มองจากด้านล่าง) ก่อนอนุมัติแม่พิมพ์
4. **Comfort-fit ที่จุด seat** — พลอยอยู่ฝั่งสัมผัสนิ้วโดยตรง (ต่างจาก Satin Flow ที่พลอยอยู่นอก) ถ้า flush ไม่เนียนสนิทจะรู้สึกสะดุดตอนสวมใส่ ต้องทดสอบใส่จริงก่อนผลิต lot ใหญ่
5. **น้ำหนักอาจไม่ถึง spec 2.40g** — ดู Part 1 ข้อ 14 ประมาณการ volumetric อย่างง่ายต่ำกว่า spec ~15-25% ต้องยืนยันด้วย volume calculation จริงหลังโมเดล wave เต็มรูปแบบ ถ้ายังต่ำกว่าเป้าต้องคุยกับเจ้าของแบรนด์ว่าจะเพิ่ม thickness เล็กน้อย (ยังอยู่ในเกณฑ์หล่อ) หรือยอมรับน้ำหนักที่ต่ำกว่า spec เดิม

---

## Part 6 — Suggestions WITHOUT changing appearance

- เพิ่มความหนา seat floor (ผนังรองพลอยด้านหลัง) เฉพาะจุดรับพลอยจากด้านในที่มองไม่เห็นจากภายนอกอยู่แล้ว (เพิ่ม ~0.1mm เฉพาะจุด) โดยไม่กระทบ outer silhouette ของคลื่น
- ถ้าน้ำหนักจริงต่ำกว่า spec ให้เพิ่ม band thickness จาก 1.80mm เป็นสูงสุด ~1.90mm (ยังผ่านเกณฑ์และแทบไม่เปลี่ยนสัดส่วนที่มองเห็นจากภายนอก) แทนการเปลี่ยน wave height/silhouette ที่มองเห็น
- ปรับตำแหน่ง sprue/gate ให้เข้าที่ wave peak (จุดหนาสุด) เป็นการปรับ production process ไม่กระทบ geometry ที่มองเห็น
- ลำดับขัด: polish ทั้งวงก่อน แล้วค่อย set พลอย แล้วขัดเก็บรอบ seat เป็นรอบสุดท้ายด้วย hand tool — ลดความเสี่ยง polish wheel ใหญ่ไปกระทบพลอย โดยไม่เปลี่ยน design ใดๆ

---

## ไฟล์ที่เกี่ยวข้อง

RhinoPython base geometry script: [`wave-embrace-ring.py`](./wave-embrace-ring.py)
(สร้าง band หน้าตัดวงรี sweep รอบ ID 17.20mm + wave bump ที่ผิวบน + seat พลอยด้านใน placeholder — เป็น **blockout เท่านั้น** ช่างต้องเก็บ G1/G2 wave surface และ flush setting จริงต่อด้วยมือ)

Collection design-intent (authoritative เฉพาะ collection นี้): [`../3j-ai-system/collections/wave-embrace/design-intent.md`](../3j-ai-system/collections/wave-embrace/design-intent.md)
