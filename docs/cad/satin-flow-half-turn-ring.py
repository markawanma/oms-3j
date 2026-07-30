"""
SATIN FLOW - HALF TURN RING
Base geometry / blockout script สำหรับ Rhino Python Editor
สร้างจาก spec sheet ของ 3J Jewelry "SATIN FLOW COLLECTION"

*** สำคัญ: นี่คือ BASE/BLOCKOUT เท่านั้น ***
- Ribbon twist ที่ได้จาก loft นี้เป็นทรงประมาณ (approximation) ไม่ใช่ organic satin fold จริง
- ช่างต้องเก็บรายละเอียดต่อด้วย T-Splines / sculpt tool / wax carving เพื่อให้ได้ผิวโค้งลื่นแบบผ้าจริง
- Bezel wall ในสคริปต์นี้เป็นทรงกระบอกง่าย ต้องไปเก็บ semi-bezel (เปิด 2 ฝั่ง) และ seat สำหรับ girdle
  ด้วยมือใน Rhino (Boolean + fillet + manual surface edit) ก่อนส่งหล่อจริง
- ใช้เพื่อเช็คสัดส่วน/ขนาดโดยรวมเทียบ spec เท่านั้น ไม่ใช่ production file
"""

import rhinoscriptsyntax as rs
import Rhino.Geometry as rg
import math

# ============================================================
# พารามิเตอร์หลัก (แก้ตรงนี้ที่เดียว) - หน่วย mm ทั้งหมด
# ============================================================
ring_size_id_mm = 17.20      # inner diameter, US ring size 54
band_w_min      = 3.80        # ความกว้าง band จุดบางสุด (ตรงข้ามหัวแหวน)
band_w_max      = 5.20        # ความกว้าง band จุดหัวแหวน (เข้าใกล้ bezel)
band_t          = 1.25        # ความหนา band คงที่
top_height      = 2.40        # ความสูงจากผิวนิ้วถึงยอดตัวเรือน
stone_dia       = 5.00        # เส้นผ่านศูนย์กลางพลอย (Blue Topaz round)
stone_h         = 1.80        # ความสูงเม็ดพลอย (table-culet, ประมาณ)
bezel_wall_t    = 0.80        # ความหนา bezel wall โดยประมาณ (ปรับได้ ต้อง >=0.7mm)
twist_deg       = 180.0       # half turn ~180 องศา ตามชื่อ concept
num_profiles    = 24          # จำนวน cross-section profile ตลอด loft (ยิ่งมาก ยิ่งลื่น)

# ============================================================
# STEP 1: สร้าง rail curve หลัก (เส้นวงกลม inner diameter = ring size)
# ============================================================
inner_radius = ring_size_id_mm / 2.0
center = rg.Point3d(0, 0, 0)
rail_circle = rg.Circle(center, inner_radius)
rail_curve = rail_circle.ToNurbsCurve()
rail_id = sc_add = rs.AddCircle(center, inner_radius)
rs.ObjectName(rail_id, "rail_inner_diameter_size54")

# ============================================================
# STEP 2: สร้าง cross-section profile ที่ไล่ขนาดตาม parameter t (0..1)
#   - t=0 : จุดบางสุด (band_w_min) ตรงข้ามหัวแหวน
#   - t=1 : จุดหัวแหวน (band_w_max) ก่อนเข้า bezel
#   - profile เป็นสี่เหลี่ยมมน (rectangle w x band_t) หมุน twist_deg ตาม t
#   หมายเหตุ: นี่คือ "pinched ribbon" แบบประมาณ (rectangle scaled)
#   ริบบิ้นบิดจริงที่คอดกลางหน้าตัด (waist) ต้องไปปั้นเพิ่มด้วยมือ
# ============================================================
profiles = []
for i in range(num_profiles + 1):
    t = float(i) / num_profiles
    angle_on_ring = t * 2.0 * math.pi          # ตำแหน่งรอบวงแหวน (full loop)
    twist_angle = math.radians(twist_deg) * t   # มุมบิดสะสม (half turn ตลอดความยาว)

    # ความกว้าง band ไล่จาก band_w_min -> band_w_max ตาม t (linear interp)
    # ในของจริงเส้นโค้งไล่กว้างไม่ใช่ linear เป๊ะ แต่ใช้เป็น approximation
    current_w = band_w_min + (band_w_max - band_w_min) * t

    # จุดกึ่งกลางบน rail circle ที่ตำแหน่งนี้
    px = inner_radius * math.cos(angle_on_ring)
    py = inner_radius * math.sin(angle_on_ring)
    base_pt = rg.Point3d(px, py, 0)

    # สร้าง local plane ตั้งฉากกับ rail (tangent) แล้วหมุนตาม twist_angle
    tangent_dir = rg.Vector3d(-math.sin(angle_on_ring), math.cos(angle_on_ring), 0)
    normal_dir = rg.Vector3d(math.cos(angle_on_ring), math.sin(angle_on_ring), 0)
    plane = rg.Plane(base_pt, tangent_dir, rg.Vector3d(0, 0, 1))
    plane.Rotate(twist_angle, tangent_dir)

    # สร้าง rectangle profile (width x thickness) บน plane นี้ ยกขึ้นตาม top_height
    half_w = current_w / 2.0
    half_t = band_t / 2.0
    corner_pts = [
        plane.PointAt(-half_w, -half_t),
        plane.PointAt(half_w, -half_t),
        plane.PointAt(half_w, half_t),
        plane.PointAt(-half_w, half_t),
        plane.PointAt(-half_w, -half_t),
    ]
    profile_crv = rg.PolylineCurve(corner_pts)
    profiles.append(profile_crv)

# แปลง Rhino.Geometry curves เป็น Rhino object ids เพื่อใช้ Loft
profile_ids = []
for crv in profiles:
    added_id = rs.AddCurve([rg.Point3d(pt) for pt in [crv.Point(j) for j in range(crv.PointCount)]])
    profile_ids.append(added_id)

# ============================================================
# STEP 3: Loft ตลอด profiles ให้เป็น band/ribbon blockout surface
# ============================================================
band_srf = rs.AddLoftSrf(profile_ids, loft_type=0)  # loft_type 0 = normal (ปรับเป็น 1=loose ถ้าผิวเป็นคลื่นเกิน)
if band_srf:
    for gid in band_srf if isinstance(band_srf, list) else [band_srf]:
        rs.ObjectName(gid, "band_ribbon_twist_BLOCKOUT")

# ============================================================
# STEP 4: Bezel seat placeholder (ทรงกระบอกง่าย ที่หัวแหวน)
#   ตำแหน่ง t=1 (มุม angle_on_ring ที่ t=1 คือหัวแหวน)
# ============================================================
head_angle = 2.0 * math.pi  # ตำแหน่งเดียวกับ t=1 (จุดปิด loop)
head_x = inner_radius * math.cos(head_angle)
head_y = inner_radius * math.sin(head_angle)
head_base = rg.Point3d(head_x, head_y, top_height / 2.0)

bezel_outer_r = (stone_dia / 2.0) + bezel_wall_t
bezel_inner_r = stone_dia / 2.0

bezel_outer_cyl_id = rs.AddCylinder(
    rg.Plane(head_base, rg.Vector3d(0, 0, 1)),
    stone_h + 0.3,
    bezel_outer_r,
    cap=True
)
rs.ObjectName(bezel_outer_cyl_id, "bezel_wall_outer_BLOCKOUT_seat_semi_bezel_TODO_open_2_sides")

bezel_inner_cyl_id = rs.AddCylinder(
    rg.Plane(rg.Point3d(head_x, head_y, top_height / 2.0 - 0.2), rg.Vector3d(0, 0, 1)),
    stone_h + 0.5,
    bezel_inner_r,
    cap=True
)
rs.ObjectName(bezel_inner_cyl_id, "bezel_seat_cutter_boolean_diff_TODO")

# Boolean difference (outer - inner) เพื่อได้ bezel wall คร่าวๆ - ยังเป็น full bezel
# ช่างต้องตัด 2 ฝั่งออกเองเพื่อทำ semi-bezel (open 2 sides) ตาม spec "floating look"
bezel_wall_result = rs.BooleanDifference(bezel_outer_cyl_id, bezel_inner_cyl_id, delete_input=True)
if bezel_wall_result:
    rs.ObjectName(bezel_wall_result, "bezel_wall_FULL_placeholder_MANUAL_CUT_to_semi_bezel_required")

# ============================================================
# STEP 5: Stone placeholder (sphere/cylinder ประมาณเม็ด Blue Topaz)
#   ใช้เพื่อเช็ค proportion เทียบ bezel เท่านั้น ไม่ใช่ facet cut จริง
# ============================================================
stone_center = rg.Point3d(head_x, head_y, top_height - stone_h / 2.0)
stone_id = rs.AddSphere(stone_center, stone_dia / 2.0)
rs.ObjectName(stone_id, "stone_placeholder_BlueTopaz_5mm_round_NOT_faceted")
rs.ObjectColor(stone_id, (30, 100, 220))  # สีฟ้าคร่าวๆ แทน Blue Topaz เพื่อ visualize

# ============================================================
# STEP 6: Comfort-fit inner edge (บอก radius ที่ต้อง fillet ด้วยมือ)
# ============================================================
print("=" * 60)
print("BASE GEOMETRY สร้างเสร็จแล้ว (BLOCKOUT ONLY)")
print("สิ่งที่ต้องเก็บต่อด้วยมือ:")
print("1. Ribbon twist ผิวโค้งลื่น (ใช้ T-Splines/sculpt - loft ตรงนี้เป็นแค่ approximation)")
print("2. ตัด bezel wall เปิด 2 ฝั่งให้เป็น semi-bezel (floating look)")
print("3. Fillet ขอบในทั้งหมด R0.3-0.5mm สำหรับ comfort fit")
print("4. เก็บ pinched/waist cross-section ตรงกลาง band (ตอนนี้เป็น rectangle ธรรมดา)")
print("5. เช็คน้ำหนักจริงจาก volume calculation หลัง detail เสร็จ (target 3.20g +/-15%)")
print("=" * 60)
