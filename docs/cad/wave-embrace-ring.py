"""
WAVE EMBRACE RING (WE-R001)
Base geometry / blockout script สำหรับ Rhino Python Editor
สร้างจาก spec sheet ของ 3J Jewelry "WAVE EMBRACE COLLECTION" (New Signature Collection)

*** สำคัญ: นี่คือ BASE/BLOCKOUT เท่านั้น ***
- Wave surface ที่ได้จาก loft นี้เป็นทรงประมาณ (approximation) จาก cosine interpolation
  ไม่ใช่ G1/G2 continuous surface สมบูรณ์ - ช่างต้องเก็บผิวต่อด้วย sculpt tool/T-Splines
  ให้คลื่นนุ่มลื่นไหลจริงตาม design-intent (soft single peak, ไม่มี facet เห็นรอยต่อ)
- Stone seat (hidden flush setting ด้านใน) ในสคริปต์นี้เป็นแค่ sphere cutter ตำแหน่งประมาณ
  ต้องไปเก็บ seat จริงด้วยมือ (setting bur, girdle-fit, fillet รอบขอบ) ก่อนส่งหล่อ
- ใช้เพื่อเช็คสัดส่วน/ขนาดโดยรวมเทียบ spec เท่านั้น ไม่ใช่ production file
- ห้ามให้ script นี้สร้างพลอยที่ "เห็นจากภายนอก" - ต้องอยู่ฝั่งในของ inner surface เท่านั้น
  (ดู docs/3j-ai-system/collections/wave-embrace/design-intent.md ข้อ NEVER-DO: visible stone)
"""

import rhinoscriptsyntax as rs
import Rhino.Geometry as rg
import math

# ============================================================
# พารามิเตอร์หลัก (แก้ตรงนี้ที่เดียว) - หน่วย mm ทั้งหมด
# ============================================================
ring_size_id_mm   = 17.20    # inner diameter, ring size 54
band_w_bottom     = 2.00     # ความกว้าง band จุดต่ำสุด (ตรงข้ามยอดคลื่น)
band_w_peak       = 2.10     # ความกว้าง band ที่ยอดคลื่น (wave peak)
band_t            = 1.80     # ความหนา band (แนวตั้ง, คงที่)
wave_height       = 1.60     # ความสูงยอดคลื่นเหนือ baseline
num_profiles      = 48       # จำนวน cross-section รอบวง (ยิ่งมาก ยิ่งลื่น ลด facet)

stone_dia         = 1.30     # เส้นผ่านศูนย์กลาง White Sapphire
stone_count       = 2        # จำนวนเม็ด (1-2 ตาม spec) - ตั้งค่านี้ 1 หรือ 2
stone_angle_span  = 12.0     # มุมห่างระหว่างเม็ดพลอย (องศา) ถ้ามี 2 เม็ด วางเรียงใกล้ยอดคลื่น

# ============================================================
# STEP 1: ตำแหน่ง rail (วงกลม inner diameter = ring size 54)
#   มุมอ้างอิง: angle = 0 คือตำแหน่ง "ยอดคลื่น" (wave peak)
#              angle = pi คือตำแหน่ง "บางสุด/bottom" (ตรงข้ามยอดคลื่น)
# ============================================================
inner_radius = ring_size_id_mm / 2.0
center = rg.Point3d(0, 0, 0)
rail_id = rs.AddCircle(center, inner_radius)
rs.ObjectName(rail_id, "rail_inner_diameter_size54")

# ============================================================
# STEP 2: สร้าง cross-section profile (วงรีมน) รอบวง
#   - s(angle) = (1 + cos(angle)) / 2  -> 1.0 ที่ยอดคลื่น (angle=0), 0.0 ที่จุดตรงข้าม (angle=pi)
#     ใช้ cosine interpolation แทน linear เพื่อให้คลื่นดู "นุ่ม" ต่อเนื่อง (single soft peak)
#   - ความกว้าง band ไล่จาก band_w_bottom -> band_w_peak ตาม s
#   - จุดศูนย์กลางหน้าตัดยกขึ้นตาม wave_height * s (จำลองยอดคลื่นที่ผิวบน)
# ============================================================
profiles = []
for i in range(num_profiles):
    angle = 2.0 * math.pi * float(i) / num_profiles
    s = (1.0 + math.cos(angle)) / 2.0   # 1 ที่ยอดคลื่น, 0 ที่จุดตรงข้าม - โค้งนุ่มแบบ cosine

    current_w = band_w_bottom + (band_w_peak - band_w_bottom) * s
    z_lift = wave_height * s            # ยกจุดศูนย์กลางหน้าตัดขึ้นตามตำแหน่งบนวง (ผิวบนเท่านั้น)

    px = inner_radius * math.cos(angle)
    py = inner_radius * math.sin(angle)

    # local plane ตั้งฉากกับ rail ที่ตำแหน่งนี้ (radial normal = แกนของหน้าตัด)
    tangent_dir = rg.Vector3d(-math.sin(angle), math.cos(angle), 0)
    radial_dir = rg.Vector3d(math.cos(angle), math.sin(angle), 0)
    center_pt = rg.Point3d(px, py, z_lift)
    plane = rg.Plane(center_pt, radial_dir, rg.Vector3d(0, 0, 1))

    # วงรีมน: กว้าง current_w (แนว radial) x สูง band_t (แนว Z)
    ellipse = rg.Ellipse(plane, current_w / 2.0, band_t / 2.0)
    ellipse_crv = ellipse.ToNurbsCurve()
    profiles.append(ellipse_crv)

# ปิด loop ให้ profile แรกซ้ำท้ายสุด (loft แบบวงปิด)
profiles.append(profiles[0])

# แปลงเป็น Rhino object ids เพื่อใช้ Loft
profile_ids = []
for crv in profiles:
    added_id = rs.AddCurve(crv)
    profile_ids.append(added_id)

# ============================================================
# STEP 3: Loft ตลอด profiles ให้เป็น band/wave blockout surface (closed loft)
# ============================================================
band_srf = rs.AddLoftSrf(profile_ids, loft_type=5, closed=True)  # loft_type 5 = uniform, closed loop
if band_srf:
    for gid in band_srf if isinstance(band_srf, list) else [band_srf]:
        rs.ObjectName(gid, "wave_band_BLOCKOUT_soft_single_peak")

# ============================================================
# STEP 4: Stone seat placeholder (hidden flush setting ด้านใน)
#   ตำแหน่ง: กลางล่างด้านในวงแหวนใกล้ยอดคลื่น (angle ใกล้ 0, ฝั่ง inner surface)
#   *** ต้องอยู่ด้านในเท่านั้น ห้ามยื่น/โผล่จากผิวนอก ***
# ============================================================
stone_offsets_deg = []
if stone_count == 1:
    stone_offsets_deg = [0.0]
else:
    half_span = stone_angle_span / 2.0
    stone_offsets_deg = [-half_span, half_span]

for idx, offset_deg in enumerate(stone_offsets_deg):
    angle = math.radians(offset_deg)
    s = (1.0 + math.cos(angle)) / 2.0
    px = inner_radius * math.cos(angle)
    py = inner_radius * math.sin(angle)
    z_lift = wave_height * s

    # ตำแหน่งพลอย: ที่ผิวในของ band (inner radius, ต่ำกว่าศูนย์กลางหน้าตัดเล็กน้อยเข้าหาผิวใน)
    inner_surface_r = inner_radius - (band_t / 2.0) + (stone_dia / 2.0) * 0.4  # ฝังลึกเข้าเนื้อโลหะจากผิวใน
    stone_x = inner_surface_r * math.cos(angle)
    stone_y = inner_surface_r * math.sin(angle)
    stone_z = z_lift

    stone_center = rg.Point3d(stone_x, stone_y, stone_z)
    stone_id = rs.AddSphere(stone_center, stone_dia / 2.0)
    rs.ObjectName(stone_id, "stone_placeholder_WhiteSapphire_1.3mm_HIDDEN_flush_inner_%d" % (idx + 1))
    rs.ObjectColor(stone_id, (255, 255, 255))  # สีขาวคร่าวๆ แทน White Sapphire

    print("Stone %d placeholder ที่ angle %.1f deg (offset จากยอดคลื่น) - ตรวจสอบว่าไม่โผล่จากผิวนอกทุกมุม" % (idx + 1, offset_deg))

# ============================================================
# STEP 5: สรุปสิ่งที่ต้องเก็บต่อด้วยมือ
# ============================================================
print("=" * 60)
print("BASE GEOMETRY สร้างเสร็จแล้ว (BLOCKOUT ONLY)")
print("สิ่งที่ต้องเก็บต่อด้วยมือก่อนส่งหล่อ:")
print("1. Wave surface G1/G2 continuity จริง (loft นี้เป็นแค่ cosine approximation)")
print("2. เจาะ seat พลอยจริง (setting bur) ให้ flush เสมอผิวใน - ห้ามยื่น/ห้ามโผล่จากผิวนอก")
print("3. Fillet ขอบในทั้งหมด R0.25-0.30mm (comfort fit, โดยเฉพาะรอบ seat พลอย)")
print("4. เช็คผนังรอบ seat พลอยไม่ต่ำกว่า ~0.5mm (ดู spec Part 5)")
print("5. ตรวจสอบทุกมุมมอง (ตรง/เฉียง/ล่าง) ว่าไม่เห็นพลอยจากภายนอกเลย")
print("6. เช็คน้ำหนักจริงจาก volume calculation หลัง detail เสร็จ (target 2.40g +/-15%)")
print("=" * 60)
