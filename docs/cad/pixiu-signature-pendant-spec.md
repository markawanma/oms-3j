# Pixiu Signature Pendant — CAD Spec (v1, PRE-REFERENCE-IMAGE)

> **Part ตาม pipeline บังคับ**: Reverse Engineer → Construction → Manufacturing → CAD (`03_3J_CAD_Guideline.md`)
> อ่านคู่กับ `docs/3j-ai-system/00_Brand_Principles.md` + `docs/3j-ai-system/collections/auspicious-pixiu/design-intent.md` เสมอ
> **สถานะ**: v1 — สเปกนี้เขียนขึ้น**ก่อน**มี reference image จริงจาก ChatGPT (ยังไม่มีภาพให้ reverse-engineer) จึงเป็น **design brief + มิติเป้าหมาย** ไม่ใช่ spec จาก reverse-engineer ภาพจริงแบบ Satin Flow/Wave Embrace — เมื่อได้ reference image แล้วต้องกลับมาแก้ Part 1 ให้ตรงภาพจริงตาม pipeline

---

## Part 1 — Concept (Reverse Engineer / Design Brief)

- **ชิ้นงาน**: จี้ปี่เซียะ (Pixiu Pendant), tier **Signature**
- **Concept**: ปี่เซียะท่าหมอบ ย่อรูปทรงเหลือ 3 สัญลักษณ์บังคับ (เขาเดี่ยว, ปีกพับแนบตัว, หน้าสงบปากปิด) ผิวโค้งเรียบต่อเนื่องแบบ river-stone ขัดเงา — motif เต็มอยู่ที่ `collections/auspicious-pixiu/design-intent.md` ข้อ 3
- **ท่าทาง**: หมอบ มองด้านข้าง (side profile silhouette) — สัดส่วนกว้าง:สูง ≈ 1.4:1 (compact มั่นคง ไม่ยืดเพรียว)
- **ทิศทางที่แขวน**: ตัวปี่เซียะหันหน้าออก ด้านข้างลำตัวขนานกับผู้สวมใส่ (แบนพอสมควรด้านหลัง เพื่อแนบตัวเวลาสวม ไม่ดันเสื้อ)
- **Unisex**: silhouette กลาง ไม่มี texture/สีสันที่ดู gender-specific

## Part 2 — Construction (มิติ mm)

### Overall
- ความยาวตัว (nose ถึงหาง): **24.0mm**
- ความสูง (ฐานท้องถึงหลังโก่งสูงสุด): **17.0mm**
- ความหนาลำตัวสูงสุด (front-to-back ตรงกลางลำตัว): **7.5mm**
- ความหนาต่ำสุด (จุดคอดคอ/ขา — ต้องเช็คกับเกณฑ์ผนัง): **1.2mm** (เผื่อเหนือเกณฑ์ 0.8–1.0mm เพราะเป็นจุดรับแรงกดกระแทกจากการห้อยชน)

### Bail (ห่วงร้อยสร้อย) — ตำแหน่งเหนือหลังปี่เซียะ
- Inner opening: **3.0mm** (รับสร้อยเส้นมาตรฐาน 1.2–1.5mm ผ่านได้สบาย ตามเกณฑ์ ≥2× เส้นผ่านศูนย์กลางลวดสร้อย)
- Bail wire thickness: **1.0mm** (ตามเกณฑ์ขั้นต่ำ 0.8–1.0mm พอดี — เป็นจุดรับน้ำหนักทั้งชิ้น)
- ตำแหน่ง: วางแนวดิ่งตรงกับ centroid มวลของตัวปี่เซียะ (ต้องเช็คจริงหลังโมเดล 3D เสร็จ — ห้อยแล้วต้องหน้าตรง ไม่บิดข้าง ตาม `06_Pendant_Workflow.md`)

### ดวงตา (Gemstone setting)
- ชนิด: CZ black onyx (ตัวเลือกหลัก) หรือ clear CZ (ตัวเลือกรอง — ต้องเลือกยืนยันกับเจ้าของแบรนด์)
- ขนาด: **1.2mm** dia × 2 เม็ด (ซ้าย-ขวา)
- Setting: **flush bezel** ฝังเสมอผิวหน้า — bezel wall **0.7mm** (ตามเกณฑ์ขั้นต่ำ) ไม่มี prong ยื่น เพราะ design-intent ห้าม prong เทอะทะ

### Ring size / ไม่เกี่ยวข้อง (เป็นจี้ ไม่มี ring size)

## Part 3 — Manufacturing

- **วัสดุ**: Sterling Silver 925
- **Finish**: High Polish ทั้งชิ้น (หน้า+หลัง) ตามที่ design-intent ระบุ (พื้นที่เล็ก ไม่ hairline) + Rhodium plating กัน oxidize
- **Casting**: Lost-wax casting — gate/sprue เดินจากจุดลำตัวหนาที่สุด (ท้อง/อกใต้บริเวณขาหน้า ~7.5mm) ให้โลหะไหลไปถึงจุดคอด/ขา (1.2mm) ก่อนแข็งตัว ลด porosity
- **จุดเสี่ยงการผลิต**:
  1. **ขา 4 ข้างเป็น undercut เล็ก** (organic sculpt) — เสี่ยง wax investment ไม่ทั่วถึง ต้องระบุให้ช่างเช็ค vent เพิ่มที่ปลายขาแต่ละข้าง
  2. **คอ/ขา thin point (1.2mm)** — จุดที่หักง่ายสุดถ้าโดนกระแทก ต้องเน้นในการ QC หลังหล่อ (เคาะเช็ค porosity)
  3. **Bezel eyes ขนาดเล็ก 1.2mm** — ช่างต้องระวังไม่กดบี้ตัวปี่เซียะรอบข้างตอน burnish setting
  4. **ด้านหลังเกือบเรียบ** อาจบางกว่าที่คิดถ้าลดมวลมากไป — ให้เผื่อ rib เสริมด้านในซ่อนใต้ผิวหลัง (ไม่กระทบ silhouette หน้า) ตามหลัก "แก้จากด้านในที่มองไม่เห็นก่อน" ใน `00_Brand_Principles.md`

## Part 4 — น้ำหนักเงินโดยประมาณ

- ประมาณจาก bounding volume แบบง่าย (24 × 17 × 7.5mm solid ~40% fill factor เพราะเป็น organic ที่มีช่องว่างขา/คอด) ≈ **0.6cm³** (±15%)
- น้ำหนัก ≈ 0.6 × 10.36 g/cm³ ≈ **~6.2g** (ประมาณ ±15% — ตรงกับเป้า CFO 6g สำหรับ Signature)
- **COGS ประมาณ**: material (6g × ราคาเงินตลาดวันนี้) × 1.6 ≈ ฿317 (ตามสูตร CFO ณ ราคาเงิน ~฿33/g) — **⚠️ ตัวคูณ 1.6 อิงงานเงินมาตรฐาน งานแกะองค์เทพ/สัตว์มงคลละเอียดกว่า แรงงานสูงกว่า อาจต้องใช้ตัวคูณ 2–2.5× จริง** (ต้องยืนยันกับช่างที่ทำจริง/กรอก standard_cost จริงตาม CFO ก่อน launch) → ถ้า COGS จริงพุ่งเกิน ฿450 จะกิน margin gate 55% ของ Signature ที่ราคาขาย ฿2,000 ต่ำสุด ต้องเช็คก่อนตั้งราคาต่ำสุดของ range

## Part 5 — Scaling เป็น 3 Tier (สำคัญ — ห้ามแค่ resize เฉยๆ)

| Tier | ความยาว | รายละเอียด | ตา | น้ำหนักเป้า |
|---|---|---|---|---|
| **Live** | ~15mm | ลด curve detail ให้ simple ที่สุด (silhouette กลม เรียบกว่า Signature) — cast ง่าย ต้นทุนต่ำ | CZ clear 0.8mm ×2 หรือไม่มีตาเลย (จุดเดียวสลักตื้น) | ~2g |
| **Signature** | ~24mm | ตาม spec นี้เต็ม — 3 สัญลักษณ์บังคับครบ, river-stone finish ชัดเจน | CZ black onyx 1.2mm ×2 bezel | ~6g |
| **Heirloom** | ~32mm | สัดส่วนเดิมขยาย + เก็บ curvature ละเอียดขึ้น (transition นุ่มกว่า, ผิวใหญ่ขึ้นทำให้เห็น reflection ชัดกว่า) **ยังคง 0 detail ขน/ลายเมฆ** — ความหรูมาจากขนาด+ความสมบูรณ์ของ sculpt ไม่ใช่การเพิ่ม motif | Diamond หรือ CZ เกรดสูง 1.5mm ×2 bezel, อาจเสริม pavé เล็กจุดเดียวที่คอ (ต้องตัดสินใจร่วมกับเจ้าของแบรนด์ — เสี่ยงขัดกฎ "ห้ามพลอยจุดอื่นนอกจากตา" ถ้าไม่ระวัง) |

> กฎ scaling: **ห้าม uniform-scale แล้วจบ** — สัดส่วนกว้าง:สูง 1.4:1 ต้องคงเดิมทุก tier (เป็นตัวบอก "ท่าหมอบมั่นคง") มิติที่ปรับได้คือความหนา/ความละเอียดผิว ไม่ใช่สัดส่วนโครง

## Part 6 — RhinoPython (Base Geometry/Blockout เท่านั้น)

⚠️ **สำคัญที่สุด**: ปี่เซียะเป็น **organic sculpt** (สัตว์มีท่าทาง กล้ามเนื้อ curvature ซับซ้อน) — **RhinoPython/procedural ทำได้แค่ bail + placeholder mass เท่านั้น** ห้ามพยายามสร้างตัวสัตว์ทั้งตัวด้วยโค้ด (บทเรียนจาก Satin Flow: สิ่งที่ทำด้วย primitive/loft ง่ายเกินไปจะดูแข็ง ไม่ river-stone) ตัวสัตว์ต้องปั้นด้วย **T-Splines/Sub-D ในมือช่าง** โดยอ้างอิง reference image จาก ChatGPT

Script ด้านล่างสร้าง:
1. Bail (ห่วงร้อยสร้อย) — geometry จริงพร้อมใช้
2. Bounding placeholder mass (กล่อง/ellipsoid คร่าวๆ ตามสัดส่วน 1.4:1 เป็น "กรอบอ้างอิงขนาด" ให้ช่างเทียบตอน sculpt) — **ไม่ใช่ตัวปี่เซียะจริง**
3. จุดตำแหน่งดวงตา (marker points) สำหรับวาง bezel setting ในขั้นถัดไป

```python
# -*- coding: utf-8 -*-
"""
Pixiu Signature Pendant — Base Geometry / Blockout Script
สร้าง: (1) bail จริง (2) bounding placeholder mass ของตัวปี่เซียะ (3) จุดอ้างอิงตา

⚠️ Script นี้ให้ base geometry/blockout เท่านั้น ไม่ใช่ production file สำเร็จรูป
   ตัวปี่เซียะ (organic sculpt) ต้องปั้นด้วย T-Splines/Sub-D โดยช่าง อ้างอิง reference image
   Bounding mass ด้านล่างใช้เป็น "กรอบขนาดอ้างอิง" เทียบสัดส่วนตอน sculpt เท่านั้น
"""

import rhinoscriptsyntax as rs

# ========== พารามิเตอร์หลัก (แก้ตรงนี้เพื่อปรับ tier) ==========
tier = "signature"          # "live" / "signature" / "heirloom"

body_length = 24.0           # ความยาวลำตัว nose-to-tail (mm)
body_height = 17.0           # ความสูงลำตัว (mm)
body_depth  = 7.5            # ความหนาลำตัว front-to-back (mm)

bail_inner_dia = 3.0         # inner opening ของ bail (mm) — รับสร้อย 1.2-1.5mm
bail_wire_dia  = 1.0         # ความหนาลวด bail (mm) — ต้อง >= 0.8-1.0mm ตามเกณฑ์ขั้นต่ำ

eye_dia = 1.2                # เส้นผ่านศูนย์กลางดวงตา CZ (mm)
eye_offset_from_nose = 4.0   # ระยะจากปลายจมูกถึงตำแหน่งตา (mm) — ประมาณ ปรับตาม sculpt จริง
eye_gap = 4.0                # ระยะห่างระหว่างตาซ้าย-ขวา (mm)
eye_height_from_base = 12.0  # ความสูงตำแหน่งตาจากฐานท้อง (mm)

# ========== 1. Bounding placeholder mass (กรอบอ้างอิงขนาด ไม่ใช่ตัวปี่เซียะจริง) ==========
# ใช้ ellipsoid คร่าวๆ แทนมวลลำตัว — ช่างใช้เทียบสัดส่วนตอนปั้น T-Splines เท่านั้น
center = rs.AddPoint([0, 0, body_height / 2.0])
placeholder_mass = rs.AddSphere(center, body_length / 2.0)
# บีบสัดส่วนให้ตรง 24 x 17 x 7.5 (non-uniform scale จาก sphere -> ellipsoid)
if placeholder_mass:
    xform = rs.XformScale(
        (body_length / (body_length)),  # x คงตามยาวอ้างอิง (sphere dia = body_length)
        (body_height / body_length),    # y ปรับสัดส่วนความสูง
        (body_depth / body_length),     # z ปรับสัดส่วนความหนา
        center
    )
    rs.TransformObject(placeholder_mass, xform)
    rs.ObjectLayer(placeholder_mass, "PLACEHOLDER_MASS_do_not_cast")
    rs.ObjectColor(placeholder_mass, [200, 200, 200])

# ========== 2. Bail (ห่วงร้อยสร้อย) — geometry จริง พร้อมใช้ ==========
bail_center = [0, 0, body_height + bail_wire_dia]  # วางเหนือหลังปี่เซียะ
bail_plane = rs.WorldXYPlane()
bail_plane.Origin = bail_center
bail_plane = rs.RotatePlane(bail_plane, 90, [1, 0, 0])  # หมุนให้ห่วงตั้งฉากแนวห้อย

# centerline ของห่วง bail (รัศมีเส้นกลาง = inner radius + ครึ่งความหนาลวด)
bail_centerline_radius = (bail_inner_dia / 2.0) + (bail_wire_dia / 2.0)
bail_center_circle = rs.AddCircle(bail_plane, bail_centerline_radius)
# pipe ให้ได้หน้าตัดกลมรอบ centerline -> ได้ห่วง bail ทรงโดนัท
bail_solid = rs.AddPipe(bail_center_circle, 0, bail_wire_dia / 2.0, cap=2)
if bail_solid:
    rs.ObjectLayer(bail_solid, "BAIL_ready_to_cast")
    rs.ObjectColor(bail_solid, [180, 180, 190])

# ========== 3. จุดอ้างอิงตำแหน่งดวงตา (marker) ==========
eye_z = eye_height_from_base
eye_x_left  = -eye_gap / 2.0
eye_x_right =  eye_gap / 2.0
eye_y = body_length / 2.0 - eye_offset_from_nose  # นับจากกึ่งกลางลำตัวไปทาง "จมูก" (+Y = หน้า)

left_eye_marker  = rs.AddPoint([eye_x_left, eye_y, eye_z])
right_eye_marker = rs.AddPoint([eye_x_right, eye_y, eye_z])
left_eye_circle  = rs.AddCircle([eye_x_left, eye_y, eye_z], eye_dia / 2.0)
right_eye_circle = rs.AddCircle([eye_x_right, eye_y, eye_z], eye_dia / 2.0)
for obj in [left_eye_marker, right_eye_marker, left_eye_circle, right_eye_circle]:
    if obj:
        rs.ObjectLayer(obj, "EYE_REFERENCE_bezel_1.2mm")

print("Base geometry สร้างเสร็จ: bail (ready to cast) + placeholder mass (อ้างอิงเท่านั้น) + eye reference markers")
print("ขั้นถัดไป: ส่งไฟล์นี้ให้ช่าง sculpt ตัวปี่เซียะจริงด้วย T-Splines อ้างอิง placeholder mass + reference image จาก ChatGPT")
```

**หมายเหตุการใช้งานสคริปต์**:
- Layer `PLACEHOLDER_MASS_do_not_cast` = ห้ามหล่อจริง เป็นแค่กรอบเทียบสัดส่วน ต้องลบทิ้งก่อนส่งไฟล์ผลิตจริง
- Layer `BAIL_ready_to_cast` = geometry จริงใช้ผลิตได้
- Layer `EYE_REFERENCE_bezel_1.2mm` = จุดอ้างอิงให้ช่างวาง bezel setting หลัง sculpt ตัวเสร็จ
- ปรับ tier โดยเปลี่ยนตัวแปร `body_length/body_height/body_depth/bail_*` ตาม Part 5 (คง proportion 1.4:1)

### ถ้าต้องการทำหลาย variation พร้อมกัน (3 tier + ปรับสด)
แนะนำ **Grasshopper** แทนการรันสคริปต์ซ้ำ — component chain ที่ใช้:
`Number Slider (body_length/height/depth) → Construct Point (bail position, eye positions) → Circle → Pipe (bail) → Sphere + Box Morph (placeholder mass scaling ตาม slider)` — ให้ปรับ 3 tier พร้อมกันเห็นผลสดใน viewport ก่อนส่งให้ช่าง sculpt ตัวจริงทีละ tier

## Part 7 — Prompt สำหรับ ChatGPT สร้าง Reference Image (ทำก่อน CAD spec ฉบับสมบูรณ์)

ใช้ prompt นี้ (แนบ `00_Brand_Principles.md` + `collections/auspicious-pixiu/design-intent.md` เป็น context/knowledge ก่อน):

> "สร้างภาพเครื่องประดับเงิน 925 จี้รูปปี่เซียะ (Pixiu) สไตล์มินิมอลโมเดิร์นแบบ Scandinavian ท่าหมอบ (crouching), มีเขาเดี่ยวกลางหัว, ปีกพับแนบลำตัว (ไม่กางโชว์), หน้าสงบปากปิด (ไม่อ้าปาก ไม่มีเขี้ยวยื่น), ผิวโค้งเรียบต่อเนื่องแบบก้อนหินแม่น้ำขัดมัน ไม่มีลายเมฆ ไม่มีลายขน ไม่มีฐาน ไม่มีพู่ห้อย ไม่มีเหรียญประกอบ ดวงตาเป็นจุดเล็กสีดำ 2 จุดเท่านั้นที่มีรายละเอียด โทนเงินขัดเงา (high polish silver) พื้นหลังขาวสะอาด ถ่าย 2 มุม: side profile และ 3/4 มุมสูงเล็กน้อย ให้ดูเหมือนเครื่องประดับใส่ทำงานได้ทุกวัน ไม่ใช่รูปปั้นเครื่องราง"

จากนั้นให้ ChatGPT วิเคราะห์ภาพที่ได้ตาม 8 หัวข้อใน `04_Claude_Master_Prompt.md` แล้ว copy analysis กลับมาให้ jewelry-designer แก้ Part 1–2 ของสเปกนี้ให้ตรงภาพจริง
