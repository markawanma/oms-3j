# ref_sku_prefix — ตารางจัดหมวดสินค้าจากรหัส SKU (draft v1)

> ใช้ auto-จัดหมวดสินค้าใหม่ทุกตัวจาก prefix ของรหัส (seed ให้ `analytics.ref_sku_prefix`)
> จาก `SKU 3J Shipnity.xlsx` (306 SKU) · **✅ = มั่นใจ · ⚠️ = ให้เจ้าของเติม/ยืนยัน**
> `product_line` = มิติหลักสำหรับยิงแอด (แฟชั่น vs มงคล คนละกลุ่มลูกค้า)

## โครงตาราง (schema)
`ref_sku_prefix (prefix text PK, category text, subcategory_hint text, product_line text, is_product boolean, note text)`
- `product_line` ∈ `fashion` / `auspicious` (มงคล) / `bullion` (เงินแท่ง) / `non_product` / `live_weight`

---

## หมวดที่ยืนยันได้ ✅

| prefix | ตัวอย่างรหัส | หมวดหลัก | product_line | subcategory (จากชื่อ) | มั่นใจ |
|---|---|---|---|---|---|
| `NC` | NC20-21 | สร้อยคอ | fashion | ลายโซ่: ฟิกาโร่/ดิสโก้/ห่วงคู่/curb + ขนาด(M/ใหญ่) | ✅ |
| `BL-` | BL-fgl75 | สร้อยข้อมือ | fashion | ลาย + ความยาว(นิ้ว) | ✅ |
| `BO` | BO64 | สร้อยข้อมือ (จี้หลายชิ้น) | fashion | จำนวนจี้ + ความยาว | ✅ (เด็ก?) ⚠️ |
| `B-` | B-1, B-ktl | สร้อยข้อมือ/กำไล | fashion | จี้พร้อมสร้อยข้อมือ | ✅ |
| `S-ANC` | S-ANC1 | สร้อยข้อเท้า | fashion | เด็ก 1/2 ข้าง | ✅ |
| `R-` | R-D56 | แหวน | fashion | + ไซซ์ (56) | ✅ |
| `E-` | E-kt | ต่างหู | fashion | | ✅ |
| `P-kt` | P-ktc, P-ktf | จี้ (เรียบ/แฟชั่น) | fashion | จี้นูน / จี้แบน | ✅ |
| `AT-` | AT-guanyin5, AT-Caishen15 | จี้องค์เทพ (Art Toy) | **auspicious** | กวนอิม/ไฉ่ซิ้ง/พิฆเนศ/ปี่เซียะ/เห้งเจีย/มาจู่/กวนอู/ลักษมี | ✅ |
| `SE-piu` | SE-piu13TG | จี้ปี่เซียะ | **auspicious** | ขนาด(มิล) + ชุบ(TG/TQ) | ✅ |
| `SP-` | SP-fu, SP-shou | จี้อักษรมงคลจีน | **auspicious** | ฮก(fu)/ซิ่ว(shou)/บ๊วง(wang) | ✅ |
| `SPC-` | SPC-fu | จี้อักษรมงคลจีน (variant) | **auspicious** | ⚠️ ต่างจาก SP- ยังไง? | ✅หมวด |
| `GLC` | GLC1-B, GLC2-R | จี้มงคล/เครื่องราง (มีเชือก) | **auspicious** | เต็งลั้ง/ไฉ่ซิ่งเอี๊ยะ + สีเชือก(ดำ/แดง) | ✅ (probable) |
| `WA-` | WA-1B | เงินแท่ง | **bullion** | รุ่นวัด (วัดอรุณฯ) | ✅ |
| `LiveS` | LiveS2 | Live เงินตามกรัม | **live_weight** | น้ำหนัก = เลข/10 กรัม (@~150฿/g) | ✅ |
| `live` | live1 | Live เงินตามกรัม (รุ่นเก่า) | **live_weight** | @120฿/g | ✅ |
| `box` | box3j | บรรจุภัณฑ์/กล่อง | non_product | | ✅ |
| `Deliver` | Deliver | ค่าจัดส่ง | non_product | | ✅ |
| `laser` | laser | บริการสลักเลเซอร์ | non_product | | ✅ |

---

## ⚠️ ต้องเจ้าของเติม/ยืนยัน (เว้นไว้)

| prefix | ตัวอย่างรหัส | ชื่อที่เห็น | เดา | หมวดหลัก (เติม) | product_line (เติม) |
|---|---|---|---|---|---|
| `S-` (ที่ไม่ใช่ ANC) | S-1A | "ค่าเริ่มต้น" | ค่าตั้งต้น/generic? | ______ | ______ |
| `S-pixiuelectro` | S-pixiuelectro | (ปี่เซียะ?) | น่าจะ auspicious | ______ | ______ |
| `C` | C1, C2, C3 | "1 / 2 / 3" | ? | ______ | ______ |
| `Clan` | ClanS, ClanL | — | ? (S/L = size?) | ______ | ______ |
| `SP` vs `SPC` | SP-fu / SPC-fu | อักษรมงคล | ต่างกันตรงไหน (มีสร้อย/ขนาด/พลอย?) | (subcategory) | ______ |
| `BO` | BO64 | จี้ 4 ชิ้น | กำไลเด็กใช่ไหม? | (ยืนยัน) | ______ |
| `GLC` | GLC1-B | เต็งลั้ง | ยืนยันว่ามงคล? | (ยืนยัน) | ______ |
| `(ตัวเลขล้วน)` | (1 รายการ) | — | ? | ______ | ______ |

---

## หมายเหตุการใช้งาน
- **subcategory (สไตล์/ลาย)** — derive จาก **ชื่อสินค้า** (keyword: ฟิกาโร่/ดิสโก้/ห่วงคู่/curb…) ไม่ใช่จาก prefix → ทำเป็น `ref_style_keyword` แยกได้ทีหลัง
- **`product_line=auspicious` (มงคล ~40 SKU)** = insight การตลาด: คนละ audience กับแฟชั่น → ยิงแอดคนละครีเอทีฟ (สายเสริมดวง/ฮวงจุ้ย จีน-ไทย)
- **`live_weight`** = ไม่ผูกดีไซน์ (ขายตามกรัม) → product-analytics ได้แค่ weight tier · แต่ estimate ต้นทุนจากกรัมได้ (ดู design §12)
- prefix ที่ยาว (เช่น `S-ANC` vs `S-`) → match แบบ **longest-prefix-first** กันชนกัน
