# ref_sku_prefix — ตารางจัดหมวดสินค้าจากรหัส SKU (draft v1)

> ใช้ auto-จัดหมวดสินค้าใหม่ทุกตัวจาก prefix ของรหัส (seed ให้ `analytics.ref_sku_prefix`)
> จาก `SKU 3J Shipnity.xlsx` (306 SKU) · **✅ = มั่นใจ · ⚠️ = ให้เจ้าของเติม/ยืนยัน**
> `product_line` = มิติหลักสำหรับยิงแอด (แฟชั่น vs มงคล คนละกลุ่มลูกค้า)

## โครงตาราง (schema)
`ref_sku_prefix (prefix text PK, category text, subcategory_hint text, product_line text, is_product boolean, note text)`
- `product_line` ∈ `fashion` / `auspicious` (มงคล) / `bullion` (เงินแท่ง) / `non_product` / `live_weight`

## ทำงานยังไง (auto-categorize)

ตารางนี้ทำให้ **สินค้าใหม่ทุกตัวถูกจัดหมวดอัตโนมัติจากรหัส** โดยไม่ต้องแท็กมือ:

1. เวลามีสินค้า/ออเดอร์เข้ามา ระบบเอา **รหัส SKU** ไปหาแถวใน `ref_sku_prefix` ที่ prefix ตรง
2. Match แบบ **longest-prefix-first** (prefix ยาวสุดที่ตรงชนะ) — กันชนกัน เช่น
   - `S-ANC1` → ตรง `S-ANC` (สร้อยข้อเท้า) **ไม่ใช่** `S-` (ต้อง match ตัวที่เจาะจงกว่าก่อน)
   - `NC20-21` → ตรง `NC` → สร้อยคอ, fashion
   - `AT-guanyin5` → ตรง `AT-` → จี้องค์เทพ, auspicious
3. ได้ `category` + `product_line` ติดไปกับ order/สินค้านั้นทันที → ใช้ group ใน dashboard/mart และ **ตั้งเป้า audience ยิงแอด**
4. เจอ prefix ใหม่ที่ยังไม่มีในตาราง → เข้า **คิว "ยังไม่จัดหมวด"** ให้คนเพิ่มแถว (ไม่เดา ไม่เงียบหาย)

> **เชื่อมกับ DB ยังไง:** `ref_sku_prefix` เป็นตาราง reference ใน schema `analytics` · `v_dim_product` (ดู design §12) เอา `public.product.sku` มา match prefix → เติมคอลัมน์ `category` + `product_line` ให้ product ทุกตัว · fact/mart join ผ่านตรงนี้

---

## หมวดที่ยืนยันได้ ✅

| prefix | ตัวอย่างรหัส | หมวดหลัก | product_line | subcategory (จากชื่อ) | มั่นใจ |
|---|---|---|---|---|---|
| `NC` | NC20-21 | สร้อยคอ | fashion | ลายโซ่: ฟิกาโร่/ดิสโก้/ห่วงคู่/curb + ขนาด(M/ใหญ่) | ✅ |
| `BL-` | BL-fgl75 | สร้อยข้อมือ | fashion | ลาย + ความยาว(นิ้ว) | ✅ |
| `BO` | BO64 | สร้อยข้อมือ (จี้หลายชิ้น) | fashion | จำนวนจี้ + ความยาว(นิ้ว) | ✅ |
| `B-` | B-1, B-ktl | สร้อยข้อมือ/กำไล | fashion | จี้พร้อมสร้อยข้อมือ | ✅ |
| `S-ANC` | S-ANC1 | สร้อยข้อเท้า | fashion | เด็ก 1/2 ข้าง | ✅ |
| `R-` | R-D56 | แหวน | fashion | + ไซซ์ (56) | ✅ |
| `E-` | E-kt | ต่างหู | fashion | | ✅ |
| `P-kt` | P-ktc, P-ktf | จี้ (เรียบ/แฟชั่น) | fashion | จี้นูน / จี้แบน | ✅ |
| `AT-` | AT-guanyin5, AT-Caishen15 | จี้องค์เทพ (Art Toy) | **auspicious** | กวนอิม/ไฉ่ซิ้ง/พิฆเนศ/ปี่เซียะ/เห้งเจีย/มาจู่/กวนอู/ลักษมี | ✅ |
| `SE-piu` | SE-piu13TG | จี้ปี่เซียะ | **auspicious** | ขนาด(มิล) + ชุบ(TG/TQ) | ✅ |
| `SP-` | SP-fu, SP-shou | จี้อักษรมงคลจีน (เงิน 99.99, 0.8g) | **auspicious** | ฮก/ซิ่ว/บ๊วง/ซังฮี้(shuangxi) | ✅ |
| `SPC-` | SPC-fu | จี้อักษรมงคลจีน (variant ของ SP · น่าจะมีสร้อย) | **auspicious** | ฮก/ซิ่ว/บ๊วง/ซังฮี้ | ✅ |
| `GLC` | GLC1-B, GLC2-R | จี้มงคล/เครื่องราง (มีเชือก) | **auspicious** | เต็งลั้ง/ไฉ่ซิ่ง/ถุงเงิน/กิมตุ๊ง + สีเชือก(ดำ/แดง) | ✅ |
| `WA-` · `S-<น>bath` · `S-1kg` · `S-1A` | WA-1B, S-1bath, S-1kg, S-1A | **เงินแท่ง (fine 99.99, รุ่นวัดอรุณฯ)** | **bullion** | ตามน้ำหนัก บาท/กก. — **นี่คือ hero ที่ล้ม** | ✅ |
| `C` | C1–C6 | สร้อยคอ "หัวจรวด" **ทองจีน** | fashion | ⚠️ **material=ทองจีน ไม่ใช่เงิน** · ต้นทุนต่ำ ค่าแรง ~60% ของราคา |
| `S-pixiuelectro` | S-pixiuelectro | ปี่เซียะ electroforming (เงิน 99.99 เบา) | **auspicious** | งานหล่อไฟฟ้า น้ำหนักเบา |
| `S-<น>g…` | S-3G, S-3gchain, S-3gball, S-3gP | จี้/โซ่/เม็ด ขายตามกรัม | fashion | by-gram (92.5) |
| `Clan` | ClanS, ClanL | น้ำยาล้างเงิน (ใหญ่/เล็ก) | non_product | อุปกรณ์ดูแล (care) |
| `LiveS` | LiveS2 | Live เงินตามกรัม | **live_weight** | น้ำหนัก = เลข/10 กรัม (@~150฿/g) | ✅ |
| `live` | live1 | Live เงินตามกรัม (รุ่นเก่า) | **live_weight** | @120฿/g | ✅ |
| `box` | box3j | บรรจุภัณฑ์/กล่อง | non_product | | ✅ |
| `Deliver` | Deliver | ค่าจัดส่ง | non_product | | ✅ |
| `laser` | laser | บริการสลักเลเซอร์ | non_product | | ✅ |

---

## ✅ เคลียร์ครบแล้ว (เจ้าของยืนยัน) — ไม่มีตัวกำกวมค้าง

## ⚠️ 2 เรื่องสำคัญที่ต้องรู้เวลาใช้ตาราง

**1. `S-` เป็น bucket ผสม — ต้อง match ตัวเต็ม ไม่ใช่แค่ "S-"**
prefix `S-` เดี่ยวไม่มีความหมายเดียว ต้อง longest-prefix เสมอ:
| ขึ้นต้น | คือ | line |
|---|---|---|
| `S-ANC…` | สร้อยข้อเท้า | fashion |
| `S-<น>bath` / `S-1kg` / `S-1A` | เงินแท่ง 99.99 | bullion |
| `S-<น>g…` (3G/3gchain/3gball/3gP) | จี้/โซ่/เม็ด by-gram | fashion |
| `S-pixiuelectro` | ปี่เซียะ electroforming | auspicious |

**2. วัสดุมีหลายแบบ — เพิ่มมิติ `material` ต่อ SKU** (กระทบต้นทุน/margin)
- **เงิน 92.5** (Sterling) — สินค้าหลักส่วนใหญ่
- **เงิน 99.99** (fine silver) — เงินแท่ง, ปี่เซียะ electro, อักษรจีน SP/SPC
- **ทองจีน** (imitation/gold-tone) — สร้อย C "หัวจรวด" · **ต้นทุนวัสดุต่ำ ค่าแรง ~60% ของราคา** (คนละสูตรกับ material×1.6 ของเงิน)
> → costing model (design §12) ต้องแยกสูตรตาม material: เงิน = weight×silver_price×1.6 · ทองจีน = price×0.6 (labor-driven)

---

## product_line ใช้ยิงแอดยังไง (นี่คือเหตุผลหลักที่แยก line)

แต่ละ line = **คนละกลุ่มลูกค้า → คนละแคมเปญ/ครีเอทีฟ/audience** ไม่ควรยิงรวมกัน:

| product_line | ลูกค้าเป็นใคร | แนวยิงแอด |
|---|---|---|
| **fashion** (สร้อย/แหวน/ต่างหู) | ผู้หญิงใส่สวย ซื้อเอง/เป็นของขวัญ | ครีเอทีฟแฟชั่น มินิมอล · lookalike จากลูกค้า LINE แฟชั่น · geo คอนโด/เมือง |
| **auspicious** (มงคล ~40 SKU) | สายเสริมดวง/ฮวงจุ้ย จีน-ไทย ยอมจ่ายตามความเชื่อ | ครีเอทีฟความหมาย/พลังองค์เทพ · จับช่วงเทศกาลจีน/ปีชง · audience ความสนใจสายมู · **margin มักดีกว่า** |
| **bullion** (เงินแท่ง) | สายออม/สะสม/ทำบุญ (รุ่นวัด) | ครีเอทีฟการออม/มูลค่า · จับช่วงราคาเงินขึ้น |
| **live_weight** | คนดูไลฟ์ ซื้อตามน้ำหนัก | ไม่ใช่หมวดสินค้าจริง — ใช้ดู yield ไลฟ์/กรัม ไม่ใช่ยิงแอดตามแบบ |

> โยงกับ flywheel: `mv_geo_performance` + `mv_rfm` แตกตาม `product_line` ได้ → รู้ว่า "ลูกค้าสายมงคล" vs "สายแฟชั่น" อยู่ที่ไหน มูลค่าเท่าไร แล้ว seed audience/lookalike แยก line

## หมายเหตุการใช้งาน
- **subcategory (สไตล์/ลาย)** — derive จาก **ชื่อสินค้า** (keyword: ฟิกาโร่/ดิสโก้/ห่วงคู่/curb…) ไม่ใช่จาก prefix → ทำเป็นตาราง `ref_style_keyword (keyword, style)` แยกได้ทีหลัง match กับชื่อ
- **`live_weight`** = ไม่ผูกดีไซน์ (ขายตามกรัม) → product-analytics ได้แค่ weight tier · แต่ estimate ต้นทุนจากกรัมได้ (ดู design §12)
- **การดูแลตาราง:** สินค้าใหม่ที่ prefix เดิม = จัดหมวดอัตโนมัติทันที · prefix ใหม่ = เพิ่ม 1 แถวครั้งเดียว ใช้ได้ตลอด · เปลี่ยนหมวด = แก้แถวเดียว กระทบทั้งระบบพร้อมกัน (single source of truth)
