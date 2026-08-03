# 3J — Hero Product ตัวใหม่แทน "เงินแท่ง" (CMO strategy)

> วิเคราะห์โดย CMO (Leia) · อิง `sales-2026-h1-summary.md` + `ref-sku-prefix.md` + `marketing-analytics-db-design.md`
> **สถานะ: hypothesis — ยังไม่มี product-level data ต้อง validate (ดูท้าย)**

## ปัญหา
เงินแท่ง (bullion) = มูลค่าผูก **ราคาตลาดเงิน (commodity)** ไม่มี pricing power · ราคาเงินร่วง → ยอดตก ~20 เท่า (ม.ค. ฿12.2M → มิ.ย. ฿975k) · hero ใหม่ต้อง **ตั้งราคาเองได้ margin นิ่ง ไม่รอราคาเงิน**

## ข้อเสนอ (จัดอันดับ)

### 🥇 อันดับ 1 — "Auspicious Signature": สายมงคล ยกเป็น designed collection + 3 tier
หมวดเดียวที่มีคุณสมบัติครบ (มูลค่าจากความเชื่อ ไม่ใช่กรัม · demand ตามปฏิทินความเชื่อ · เล่าเรื่องบน TikTok ได้ดีสุด · ปิดก้อนใหญ่บน LINE ได้ · **มี ~40 SKU อยู่แล้ว** + คนซื้อเงินแท่ง "รุ่นวัด" = สายมู migration ตรง)

| Tier | ราคา | ช่องทาง | บทบาท |
|---|---|---|---|
| **Live** | ฿300–800 | TikTok Live | จี้เล็ก impulse — แทน live-weight margin บาง |
| **Signature** | ฿2,000–5,000 | TikTok + LINE | ดีไซน์ 3J เฉพาะ (ทีม Sabé) = **margin หลัก** |
| **Heirloom** | ฿10,000+ | LINE เท่านั้น | limited/รุ่นพิเศษ = **แทน AOV เงินแท่ง** |

### 🥈 อันดับ 2 — "Blessing Gift Set" (personalization booster)
จี้มงคล + **สลักเลเซอร์** (ชื่อ/ปีเกิด/แก้ชง) + กล่องอวยพร → ของขวัญวันเกิด/รับปริญญา/แก้ชง · personalization = เทียบราคาไม่ได้ (กันสงครามราคา TikTok) · laser marginal cost ~0 · เป็นตัวถัว demand กลางปี (นอกซีซั่นตรุษจีน)

### อันดับ 3–4 (line รอง)
- Signature fashion collection เดี่ยว — สวยแต่ red ocean เงิน 925 เทียบราคา/กรัมได้ ไม่มี moat/moment
- ขายมงคล SKU เดิมเฉยๆ — ไม่มี tier บน AOV ไม่ขยับ

## Go-to-market
**TikTok (reach→acquire):** ไลฟ์ธีมมงคลประจำสัปดาห์ (เล่าความหมายองค์เทพ/ใครควรบูชา/ปีชง) · ขาย Tier Live · ทุกไลฟ์ CTA "add LINE รับรุ่น Signature ก่อนใคร" · แอด: audience สายมู/ฮวงจุ้ย + lookalike จาก LINE seed
**LINE (convert→retain):** broadcast ลูกค้าเงินแท่ง/รุ่นวัดเดิม → เปิด Tier Heirloom pre-order/limited (scarcity แทน "ราคาเงินขึ้น") · ปฏิทินปีชง 2027 personalize รายนักษัตร (LINE ทำได้ TikTok ทำไม่ได้) · gift set + สลักฟรีเมื่อซื้อ Signature+

## Validate (ทั้งหมดคือ hypothesis — ต้องพิสูจน์)
1. **ด่วนสุด:** ยอด H1 แตกตาม `product_line` → ยืนยัน ม.ค. ฿12M เป็น bullion จริงกี่ % · auspicious ขายได้เท่าไร (⚠️ export ไม่มีรายสินค้า → ทำได้เมื่อ DB import เสร็จ)
2. **Pilot 4–6 สัปดาห์:** ไลฟ์ธีมมงคล 2 ครั้ง/สัปดาห์ vs ปกติ → วัด viewer→order, AOV, GMV/ชม.
3. **LINE test:** broadcast 1 Signature collection ไป segment เงินแท่งเดิม → วัด open→reply→close, AOV (เป้ากลับโซน ฿3k–10k)
4. **เกณฑ์ผ่าน:** auspicious AOV > 2× live_weight + margin ยืนได้ **หลังกรอกต้นทุนจริง** (ต้องแก้การกรอกต้นทุนก่อน — margin ตอนนี้เชื่อไม่ได้ → CFO ตรวจ)

## ความเสี่ยง
- **positioning แคบ** (ดูเป็น "ร้านสายมู") → แยก creative/บัญชี content ตาม product_line
- **cultural sensitivity** องค์เทพ/ศาสนา เล่าผิดเสีย trust ทั้งหมวด
- **seasonality กระจุก** ตรุษจีน/ปีชง ต้นปี → gift set ถัวกลางปี
- **ต้นทุนดีไซน์ Tier Signature** ลงก่อนเห็นยอด → เริ่ม 1–2 องค์ที่ขายดีสุด (รอข้อมูลข้อ 1) ไม่ทำทั้ง 40 SKU

## มอบหมายต่อ
- **Tech Lead:** รายงานยอด/AOV ตาม product_line ย้อน 7 เดือน (เมื่อ import) + GMV/ชม.ไลฟ์แยกธีม
- **CFO (Hondo):** ตรวจ margin 3 tier + ต้นทุน laser/กล่อง ก่อน launch
- **content-strategist + copywriter:** calendar มงคล Q4 (นับถอยหลังตรุษจีน 2027) + script ไลฟ์องค์เทพ
- **jewelry-designer (Sabé):** concept Tier Signature องค์แรก หลังรู้ว่าองค์ไหนขายดีสุด

> **สรุป 1 บรรทัด:** มงคล 3 tier = ตัวเดียวที่กู้ AOV ฝั่ง LINE กลับมาโดยไม่ต้องรอราคาเงินขึ้น
