# 03 — 3J CAD Guideline (มาตรฐานผลิตได้จริง)

> **ใช้ตอนไหน**: ตอนแปลง design analysis → CAD spec เสมอ (ทุกประเภทชิ้นงาน) — นี่คือกฎ**บังคับ** ไม่ใช่ draft เหมือน `02_3J_Design_Language.md`
> ค่าตัวเลขในไฟล์นี้เป็นเกณฑ์วิศวกรรมการหล่อเงิน 925 ทั่วไป + บทเรียนจริงจาก [`docs/3j-jewelry/cad/satin-flow-half-turn-ring-spec.md`](../cad/satin-flow-half-turn-ring-spec.md)

---

## Pipeline บังคับ 4 ขั้น

```
Reverse Engineer  →  Construction  →  Manufacturing  →  CAD
```

1. **Reverse Engineer**: วิเคราะห์ reference/analysis ให้ครบก่อน (concept, shape language, proportion, stone, finish, curvature, radius, comfort fit, weight, feasibility — ดู 18 หัวข้อใน Satin Flow spec Part 1 เป็นแม่แบบ) **ห้าม redesign/simplify** สิ่งที่เห็นในภาพ เว้นแต่เจ้าของสั่งให้ปรับ
2. **Construction**: แปลงเป็นตัวเลขมิติจริง (mm) ทุกจุด — ห้ามปล่อยค่าประมาณลอยๆ ถ้าไม่รู้ต้องถามหรือระบุว่า "ประเมิน" ชัดเจน
3. **Manufacturing**: เช็คทุกจุดกับเกณฑ์ผลิตด้านล่าง + ระบุ casting/sprue/polishing process
4. **CAD**: เขียน RhinoPython (หรือแนะนำ Grasshopper ถ้าเหมาะกว่า) เป็น base geometry/blockout ให้ช่างเก็บ detail ต่อ

---

## เกณฑ์ผลิตเงิน 925 ที่ต้องคุมทุกชิ้น (ห้ามข้าม)

| จุด | เกณฑ์ขั้นต่ำ | เหตุผล |
|---|---|---|
| ผนัง/gauge ทั่วไป (band, shank, wall บาง) | **≥ 0.8–1.0mm** | ต่ำกว่านี้เสี่ยงหล่อไม่ติด (misrun) หรือหักง่ายตอนใช้งาน |
| Prong (เล็บจับพลอย) | **≥ 0.7mm** | บางกว่านี้เล็บงอ/หักง่าย พลอยหลุด |
| Bezel wall (ผนังโอบพลอย) | **≥ 0.7mm** | เกณฑ์เดียวกับ prong — บางกว่านี้กดยึด (burnish) แล้วแตก/พลอยไม่แน่น |
| Comfort-fit fillet (ขอบสัมผัสผิวหนัง/นิ้ว) | **R0.3–0.5mm** | ลบคมทุกขอบที่สัมผัสผิว ไม่บาด/ไม่รู้สึกคาย |
| Casting gate/sprue | เดินจาก**จุดที่หนาที่สุด** ของชิ้นงาน | โลหะไหลไปถึงจุดบางสุดก่อนแข็งตัว ลด porosity/misrun ที่จุดเปราะ |

## Finish มาตรฐาน (ค่าตั้งต้น ปรับได้ตามธีม)

- **ผิวนอก (มองเห็นชัด)**: High Polish
- **ผิวใน (สัมผัสผิวหนัง/ใช้งานหนัก)**: Hairline (satin) — ลดรอยขีดข่วนจากการสวมใส่จริง
- ถ้ามี 2 โทนในชิ้นเดียว: ต้องระบุ**เส้นแบ่งโซน**ชัด (ตำแหน่งบน cross-section) ให้ช่างขัดแยกได้ + ลำดับขัด (ปกติ: ขัด hairline ก่อน mask แล้วขัด high polish ทับ — ลดโอกาสเลอะข้ามโซน)

## การคำนวณน้ำหนักเงิน (บังคับทุกชิ้น)

```
น้ำหนัก (กรัม) ≈ Volume (cm³) × 10.36 g/cm³   [density เงิน 925]
```

- ถ้ายังไม่มี 3D model volume จริง → ให้ประมาณจาก geometry ง่ายๆ (cylinder/loft) ระบุ "ประมาณ ±15%" เสมอ อย่าฟันธงเป็นตัวเลขนิ่ง
- น้ำหนักผูกกับต้นทุนตรงๆ — ถ้าดีไซน์ใหญ่จนน้ำหนักเกินงบที่ลูกค้ากำหนด **ต้องพูดตรงๆ** พร้อมเสนอทางลด (ลด thickness ในเกณฑ์ที่ยังผ่าน 0.8mm / ลดขนาดพลอย / เปลี่ยน setting ให้ใช้เนื้อโลหะน้อยลง)

## จุดเสี่ยงที่ต้องเช็คทุกครั้ง (บทเรียนจาก Satin Flow)

1. **Undercut/geometry บิดซับซ้อน** (twist, wrap) → เสี่ยง wax investment ไม่ทั่วถึง เกิด porosity — ต้องระบุใน manufacturing notes
2. **จุดคอด/waist บาง** ที่เกิดจาก organic curve → เช็คว่ายังอยู่ในเกณฑ์ 0.8–1.0mm หรือไม่ในโมเดล 3D จริง ไม่ใช่แค่ดูสวยในภาพ 2D
3. **Semi-bezel/open setting** → แรงกด burnish ไม่สมมาตรเหมือน full bezel เสี่ยงพลอยเอียง — เสนอ internal support rib ซ่อนใต้พลอย (ไม่กระทบ outer silhouette) เป็นทางแก้แบบ "ไม่เปลี่ยนหน้าตา"
4. **เส้นแบ่ง finish 2 โทน** → ถ้าไม่ระบุตำแหน่งชัดใน spec ช่างจะขัดเลยแนว ดูลวก

## RhinoPython/Grasshopper — กฎการส่งมอบ

- ทุก script ต้อง comment ภาษาไทยกำกับแต่ละส่วน + พารามิเตอร์หลักเป็นตัวแปรบนสุด (ring_size, band_width, stone_dia ฯลฯ) แก้ง่าย
- ต้องระบุชัดเสมอว่า output คือ **base geometry/blockout** — ไม่ใช่ production file สำเร็จรูป ช่างต้องเก็บ organic detail (curvature G2, setting จริง) ด้วยมือ
- ถ้าพารามิเตอร์เยอะ/ต้องปรับสดหลายค่าพร้อมกัน (เช่น ทำหลาย variation ของ collection เดียว) → แนะนำ **Grasshopper** แทน ระบุ component chain ที่ใช้ (เช่น Number Slider → Loft → Twist → Pipe)
