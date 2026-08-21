"""
MARKAWAN JEWELRY BY 3J — THE JOURNEY SERIES: GANESHA
แหวนเงิน 925 freesize 3 พลอย (Amethyst / White Zircon / Citrine) — SKU งานร่าง GJ-R001

Base geometry / blockout script สำหรับ Rhino Python Editor
คู่กับสเปกเต็ม: docs/3j-jewelry/design-system/collections/markawan-ganesha-ring.md

*** สำคัญ: นี่คือ BASE/BLOCKOUT เท่านั้น ไม่ใช่ production file สำเร็จรูป ***
สิ่งที่ script นี้ "ไม่ได้ทำ" ต้องให้ช่างเก็บต่อด้วยมือ (ดูรายละเอียดใน print summary ท้ายไฟล์):
  1. Comfort-fit fillet R0.3mm บนขอบ 2 เส้นที่ flat bottom ต่อกับโดม (script ปล่อยเป็นมุมคม)
  2. Ball-tip fillet R0.4mm ที่ปลายเปิดทั้ง 2 ฝั่ง (freesize opening) — script แค่ cap ปิดหน้าตัดแบน
  3. Bezel seat (ledge รับ girdle พลอย ลึก ~0.3mm) — bezel ในสคริปต์เป็น full wall ยังไม่มี seat
  4. Boolean union รวม shank + gallery + bezel ให้เป็นชิ้นเดียว (สคริปต์ปล่อยแยกชิ้นตั้งใจ เพื่อให้เช็คสัดส่วนก่อน)
  5. Facet cut ของพลอยจริง (สคริปต์ใช้ sphere วางตำแหน่ง/สัดส่วนเท่านั้น)
"""

import rhinoscriptsyntax as rs
import Rhino.Geometry as rg
import math

# ============================================================
# พารามิเตอร์หลัก (แก้ตรงนี้ที่เดียว) - หน่วย mm ทั้งหมด
# ============================================================
ring_size_id_mm      = 17.20   # inner diameter ที่ fabricate จริง (freesize baseline = size 54)
gap_mm                = 3.00    # ช่องเปิดด้านหลัง (freesize) ที่ 6 นาฬิกา ตรงข้ามกลุ่มพลอย
band_width            = 3.30    # ความกว้าง band ตามแนวแกนนิ้ว (คงที่ตลอดวง)
band_height           = 1.65    # ความสูงโดมจาก rail (= band_width/2 -> half-round แท้)
profile_count         = 48      # จำนวน cross-section รอบวง (ยิ่งมากยิ่งลื่น)
dome_segments         = 10      # จำนวนช่วงเส้นโค้งครึ่งวงกลมใน 1 cross-section

stone_center_dia      = 3.00    # White Zircon (กลาง)
stone_center_height   = 1.95    # ประเมิน table-culet (ยืนยันกับ supplier จริงก่อนผลิต)
stone_side_dia        = 2.60    # Amethyst (ซ้าย) / Citrine (ขวา)
stone_side_height     = 1.55    # ประเมิน

bezel_wall_center     = 0.75    # >= 0.7mm ตามเกณฑ์ 03_3J_CAD_Guideline
bezel_wall_side       = 0.70    # ที่ขั้นต่ำพอดี — เผื่อ QC เข้ม
bezel_cup_h_center    = 2.40
bezel_cup_h_side      = 2.00
stone_gap             = 0.35    # ช่องว่างเนื้อโลหะระหว่าง bezel ที่ติดกัน (ต้องเช็ค porosity จุดนี้)
gallery_thickness     = 1.00    # ฐานเชื่อม bezel 3 ตัว + ไหล่ band

# ============================================================
# ค่าที่คำนวณต่อ (ห้ามแก้ตรงนี้ — คำนวณจากพารามิเตอร์ด้านบน)
# ============================================================
inner_radius   = ring_size_id_mm / 2.0
half_width     = band_width / 2.0

bezel_center_od = stone_center_dia + 2.0 * bezel_wall_center
bezel_side_od   = stone_side_dia + 2.0 * bezel_wall_side
cluster_offset  = (bezel_center_od / 2.0) + stone_gap + (bezel_side_od / 2.0)
gallery_length  = (2.0 * bezel_side_od) + bezel_center_od + (2.0 * stone_gap)

gap_half_angle  = math.asin((gap_mm / 2.0) / inner_radius)     # radians
start_angle     = math.radians(270.0) + gap_half_angle          # ปลายเปิดฝั่งที่ 1 (6 นาฬิกา)
end_angle       = math.radians(270.0) - gap_half_angle + 2.0 * math.pi  # ปลายเปิดฝั่งที่ 2
top_angle       = math.radians(90.0)                            # ตำแหน่งกลุ่มพลอย (12 นาฬิกา)


def rail_point(angle):
    """จุดบน rail circle (inner diameter) ที่มุม angle (rad) — z=0"""
    return rg.Point3d(inner_radius * math.cos(angle), inner_radius * math.sin(angle), 0.0)


def local_frame(angle):
    """คืนค่า (normal_dir, tangent_dir) ที่มุม angle
    normal_dir = แนวรัศมี ชี้ออกจากศูนย์กลางแหวน (ทิศทางที่โดมยกตัว)
    tangent_dir = แนวสัมผัสวง (ทิศทางเดินไปตามความยาว shank)
    """
    normal_dir = rg.Vector3d(math.cos(angle), math.sin(angle), 0.0)
    tangent_dir = rg.Vector3d(-math.sin(angle), math.cos(angle), 0.0)
    return normal_dir, tangent_dir


def build_half_round_profile(angle):
    """สร้าง closed curve หน้าตัด half-round (โดมครึ่งวงกลม + ฐานแบน)
    วางบน rail ที่มุม angle — ระนาบตั้งฉากกับ tangent (perpendicular cross-section จริง
    ไม่ใช่ tangent-plane approximation) เพื่อให้ Loft ได้ tube ที่ถูกสัดส่วน
    """
    base_pt = rail_point(angle)
    normal_dir, tangent_dir = local_frame(angle)
    # plane: XAxis = normal (แนวรัศมี = แกนความสูงโดม), YAxis = Z global (แกนความกว้าง band)
    # -> plane.Normal จะขนานกับ tangent_dir โดยอัตโนมัติ = ตั้งฉากกับเส้นทางวงแหวนจริง
    plane = rg.Plane(base_pt, normal_dir, rg.Vector3d(0.0, 0.0, 1.0))

    pts = []
    for i in range(dome_segments + 1):
        t = math.pi * float(i) / dome_segments   # 0 (ขวา) -> pi (ซ้าย)
        h_val = band_height * math.sin(t)          # 0 ที่ขอบ, สูงสุดตรงกลางโดม
        w_val = half_width * math.cos(t)            # +half_width -> -half_width
        pts.append(plane.PointAt(h_val, w_val))
    pts.append(pts[0])  # ปิดกลับฐานแบน (เส้นตรงจาก h=0,w=-half_width กลับไป h=0,w=+half_width)
    return rs.AddCurve(pts)


# ============================================================
# STEP 1: สร้าง cross-section profiles รอบวง (เว้นช่อง freesize opening ที่ 6 นาฬิกา)
# ============================================================
profile_ids = []
for i in range(profile_count + 1):
    t = float(i) / profile_count
    ang = start_angle + (end_angle - start_angle) * t
    profile_ids.append(build_half_round_profile(ang))

rs.ObjectName(profile_ids[0], "shank_open_end_A_needs_ball_tip_fillet_R0.4")
rs.ObjectName(profile_ids[-1], "shank_open_end_B_needs_ball_tip_fillet_R0.4")

# ============================================================
# STEP 2: Loft ตลอด profiles -> shank (half-round band) BLOCKOUT
# ============================================================
band_srf = rs.AddLoftSrf(profile_ids, loft_type=0)
if band_srf:
    band_ids = band_srf if isinstance(band_srf, list) else [band_srf]
    for gid in band_ids:
        rs.ObjectName(gid, "shank_half_round_BLOCKOUT_freesize_52_58_base_size54")
    capped = rs.CapPlanarHoles(band_ids[0])  # ปิดหัวท้าย (ยังเป็นหน้าตัดแบน ไม่ใช่ ball-tip จริง)

# ============================================================
# STEP 3: Gallery base plate (ฐานเชื่อม bezel 3 ตัวเข้ากับไหล่ band) ที่ 12 นาฬิกา
# ============================================================
gallery_base = rail_point(top_angle)
n90, tan90 = local_frame(top_angle)
gallery_origin = gallery_base + n90 * band_height  # เริ่มจากยอดโดม ณ ตำแหน่ง 12 นาฬิกา

half_len = gallery_length / 2.0
half_wid = band_width / 2.0
corners = [
    gallery_origin - tan90 * half_len - rg.Vector3d(0, 0, half_wid),
    gallery_origin + tan90 * half_len - rg.Vector3d(0, 0, half_wid),
    gallery_origin + tan90 * half_len + rg.Vector3d(0, 0, half_wid),
    gallery_origin - tan90 * half_len + rg.Vector3d(0, 0, half_wid),
    gallery_origin - tan90 * half_len - rg.Vector3d(0, 0, half_wid) + n90 * gallery_thickness,
    gallery_origin + tan90 * half_len - rg.Vector3d(0, 0, half_wid) + n90 * gallery_thickness,
    gallery_origin + tan90 * half_len + rg.Vector3d(0, 0, half_wid) + n90 * gallery_thickness,
    gallery_origin - tan90 * half_len + rg.Vector3d(0, 0, half_wid) + n90 * gallery_thickness,
]
gallery_id = rs.AddBox(corners)
rs.ObjectName(gallery_id, "gallery_base_plate_BLOCKOUT_connects_3_bezels_to_shoulders")

# ============================================================
# STEP 4: 3 bezel cups (center = White Zircon, side = Amethyst/Citrine) + stone placeholders
#   วางเรียงตามแนว tangent ที่ 12 นาฬิกา บน gallery (local flat approximation - บริเวณแคบ ใช้ได้)
# ============================================================
cup_base_z = gallery_origin + n90 * gallery_thickness  # ผิวบนของ gallery


def build_bezel(offset_along_tangent, stone_dia, stone_height, wall_t, cup_h, label, rgb):
    center_pt = cup_base_z + tan90 * offset_along_tangent
    cup_plane = rg.Plane(center_pt, n90)

    outer_r = (stone_dia / 2.0) + wall_t
    inner_r = stone_dia / 2.0

    outer_cyl = rs.AddCylinder(cup_plane, cup_h, outer_r, cap=True)
    inner_cyl = rs.AddCylinder(
        rg.Plane(center_pt - n90 * 0.1, n90), cup_h + 0.3, inner_r, cap=True
    )
    wall_id = rs.BooleanDifference(outer_cyl, inner_cyl, delete_input=True)
    if wall_id:
        rs.ObjectName(wall_id, "bezel_wall_%s_BLOCKOUT_seat_ledge_TODO_manual" % label)

    stone_center = center_pt + n90 * (stone_height / 2.0 + 0.2)
    stone_id = rs.AddSphere(stone_center, stone_dia / 2.0)
    rs.ObjectName(stone_id, "stone_placeholder_%s_NOT_faceted" % label)
    rs.ObjectColor(stone_id, rgb)


build_bezel(0.0, stone_center_dia, stone_center_height, bezel_wall_center,
            bezel_cup_h_center, "white_zircon_center", (225, 230, 235))
build_bezel(-cluster_offset, stone_side_dia, stone_side_height, bezel_wall_side,
            bezel_cup_h_side, "amethyst_left", (150, 80, 200))
build_bezel(cluster_offset, stone_side_dia, stone_side_height, bezel_wall_side,
            bezel_cup_h_side, "citrine_right", (240, 175, 60))

# ============================================================
# สรุปงานที่เหลือให้ช่างเก็บด้วยมือ
# ============================================================
print("=" * 64)
print("GANESHA RING - BASE GEOMETRY สร้างเสร็จ (BLOCKOUT ONLY)")
print("ring size freesize 52-58, fabricate ที่ size 54 (ID %.2fmm)" % ring_size_id_mm)
print("ช่องเปิด freesize ~%.2fmm ที่ 6 นาฬิกา (ตรงข้ามกลุ่มพลอยที่ 12 นาฬิกา)" % gap_mm)
print("สิ่งที่ต้องเก็บต่อด้วยมือก่อนหล่อจริง:")
print("1. Fillet R0.3mm ขอบ flat-bottom<->โดม ตลอดความยาว shank (comfort fit)")
print("2. Ball-tip fillet R0.4mm ที่ปลายเปิดทั้ง 2 ฝั่ง (ตอนนี้ script cap แบนไว้เฉยๆ)")
print("3. เจาะ bezel seat ลึก ~0.3mm ในแต่ละ bezel wall ให้รับ girdle พลอยพอดี")
print("4. Boolean union shank + gallery + bezel ให้เป็นชิ้นเดียว หลังเช็คสัดส่วนผ่านแล้ว")
print("5. เช็คน้ำหนักจริงจาก volume calculation หลัง detail เสร็จ (เป้า 2.9-3.4g)")
print("   ความแข็งแรงมาก่อนน้ำหนักเสมอ - ห้ามลดความหนาก้าน/bezel เพื่อลดน้ำหนัก")
print("   ถ้าเกิน 3.4g แจ้งทีมกลับก่อนสั่งผลิต เพราะกระทบต้นทุนเนื้อเงินที่คิดไว้")
print("6. ลำดับงานมาตรฐานร้าน: หล่อ -> แต่ง/ขัด -> ชุบ -> ฝังพลอย (ฝังทีหลังเสมอทุก SKU)")
print("=" * 64)
