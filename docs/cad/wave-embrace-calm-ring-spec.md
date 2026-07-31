# Wave Embrace (Calm) — Ring Spec · WE-R001

> **แนวคิด:** คลื่นทะเลสงบ · แรกเห็นเหมือน wedding band ธรรมดา ต้องมองใกล้ๆถึงเห็นคลื่นนุ่ม **เส้นเดียว** · พลอยซ่อนด้านในสำหรับคนใส่เท่านั้น
> **สไตล์:** Minimal · Calm · Timeless · Scandinavian / Japanese simplicity · แนว Georg Jensen / COS — *Less is more*
> **สถานะ:** self-contained spec (อ่านไฟล์นี้ไฟล์เดียวพอ) · หน่วยเป็น mm ทั้งหมด

---

## 1. หลักการออกแบบ (ต้องยึด)

- คลื่นต้องเป็น **เส้นโค้งเรียบเส้นเดียว (one single smooth curve)** — โผล่ที่ผิวบนของ band เท่านั้น
- **ห้าม:** twisting · split shank · infinity symbol · rope · braid · เส้นตกแต่ง (decorative lines)
- band **ต่อเนื่องทั้งวง** ไม่ขาด · ครึ่งล่างเป็น band ปกติ (comfort fit ด้านใน)
- ด้านนอก **สะอาดสนิท** — พลอยอยู่ด้านในเท่านั้น ห้ามมองเห็นจากภายนอกทุกมุม
- คลื่น subtle — สังเกตได้เมื่อมองใกล้ ไม่ใช่จุดเด่นสะดุดตา

## 2. สเปกหลัก

| รายการ | ค่า |
|---|---|
| Metal | Sterling Silver 925 |
| Finish | High Polish (นอก + ใน) |
| Ring size | 54 · inner diameter 17.20 |
| Band width | 2.00 (ทั่วไป) → 2.10 (ยอดคลื่น) |
| Band thickness | 1.80 |
| Cross-section | วงรีมน (oval) 2.00–2.10 (W) × 1.80 (H) · ขอบมน G2 |
| Wave | ยอดเดียวที่ด้านบน · wave height ~1.10–1.60 · ลาดเรียบลงสู่ band ปกติ (single smooth curve, no trough) |
| Comfort fit | ผิวในโค้งมน ไม่บาดนิ้ว · fillet ขอบที่เห็น ≥ 0.25 |
| Weight (est.) | ~2.0–2.4 g ±15% (⚠️ band ตันบาง — ยืนยันด้วย Rhino MassProperties จริง) |

## 3. Hidden Stones (ประกายซ่อน)

- **White Sapphire Ø1.3 × 1–2 เม็ด** · flush-set **ด้านในวงแหวน** (ตำแหน่งกลางล่างด้านในใกล้ยอดคลื่น)
- ต้องเสมอผิวใน (flush) ไม่ยื่น/ไม่นูน → ไม่บาดนิ้ว + มองจากนอกไม่เห็น
- ผนังรองพลอยด้านใน **≥ 0.5** (เจาะ seat เข้าผนัง 1.80 ต้องเหลือเนื้อพอ) — เช็คในโมเดล 3D ก่อนหล่อ

## 4. Manufacturing (เงิน 925)

- Lost-wax casting · min wall thickness **0.80** ทุกจุด (คลื่นต้องไม่ทำให้ผนังบางกว่านี้)
- ทุกผิวต่อเนื่อง **G1/G2** — ไม่มี tangent break / curvature spike ที่จุดเปลี่ยนคลื่น
- ขัด high polish ทั้งชิ้น · seat พลอยด้านในเนียน flush ไม่สะดุดนิ้ว
- ลำดับงาน: base band → form wave (ผิวบน) → refine G2 → เจาะ seat + flush-set พลอยใน → final polish

## 5. จุดที่ต้องเช็คก่อนอนุมัติแม่พิมพ์

1. **พลอยห้ามเห็นจากนอกทุกมุม** (ตรง / เฉียง 45° / มองจากล่าง) — เห็นแม้มุมเดียว = ผิด concept
2. **น้ำหนักจริง** จาก Rhino หลังปั้น G2 — ถ้าต่ำกว่า 2.04 g เพิ่มความหนาเป็น ~1.90 (ไม่กระทบหน้าตานอก)
3. ผนังรองพลอยด้านใน ≥ 0.5 · min wall ≥ 0.80 ทั่วชิ้น
4. คลื่นยัง subtle + smooth เส้นเดียว (ไม่กลายเป็นสัน/ร่องคม)

## ไฟล์ประกอบ
- 3D preview (WebGL) + OBJ mesh: `wave-embrace-preview.html` · `wave-embrace-ring.obj`
- RhinoPython blockout: `wave-embrace-ring.py`
