# AI Marketing OS — มติที่ประชุม C-level + แผน 90 วัน (29 ส.ค. 2569)

> เจ้าของส่งเอกสาร BA→Tech Lead "AI Marketing Operating System" (6 pillars, 7 phases, 12 sprints)
> ที่ประชุม: CEO (Mon Mothma) · CMO (Leia) · CFO (Hondo) · COO (Ackbar) — ทำการบ้านอิสระต่อกัน
> Tech Lead (Obi-Wan) รวมมติ + ตัดสินข้อขัดแย้ง · เอกสารต้นทาง: `Downloads/AI_Marketing_OS_Tech_Lead_Handoff.md`

## 0. มติเอกฉันท์ 4/4 — ไม่มีใครเห็นต่างเลยสักคน

1. **เอกสาร BA เขียนสำหรับองค์กรที่ใหญ่กว่าเรา 5–10 เท่า** (CFO: gross profit pool เรา ~฿140k/เดือน)
2. **คอขวดจริงของร้านนี้ไม่ใช่ intelligence แต่คือ "มือเดียวของเจ้าของ"** — ทุก output จบที่เจ้าของคลิก
   (หลักฐาน: copy พร้อมตั้งแต่ 19 ส.ค. ยังค้าง · งาน SEO วันนี้ค้างรอ ~1.5 ชม. ของงานคลิก)
3. **สิ่งที่เอกสารเสนอให้สร้าง เรามีแล้ว ~60–70%** — orchestrator/skill lifecycle/human gates/model
   routing = ทีม agent 21 ตัว + skills + memory + 3 ด่าน content ที่ใช้งานจริงอยู่
4. **ห้ามสร้าง OS ใหม่ขนานกับ 3J Insight — ยุบวิสัยทัศน์เป็น feature เพิ่มเข้าระบบเดิม** (CMO)
5. 12-sprint roadmap เต็มรูป = NO-GO · n8n / object storage / vector DB แยก / video pipeline /
   autonomous Level 4–5 = **NO-GO ใน 90 วัน** (video pipeline: CEO ให้ NO-GO ถาวรสำหรับสเกลนี้)

## 1. ข้อขัดแย้ง 2 จุด + คำตัดสิน Tech Lead

### 1.1 จังหวะ Brief — CEO บอก Weekly / COO ออกแบบ Daily 17:00 / CMO ชี้เงื่อนไข

**ตัดสิน: เริ่ม Weekly (จันทร์เช้า) — daily เป็น upgrade ที่ต้องปลดล็อกด้วยข้อมูล**
เหตุผลชี้ขาดมาจาก CMO: ยอดขายเข้าระบบเป็นรายเดือน (ไฟล์ Shipnity ที่เจ้าของอัปเอง)
**"daily brief ที่ไม่มี daily data = weekly brief ที่โกหกชื่อตัวเอง"**
- เงื่อนไขปลดล็อกเป็น daily 17:00 (format COO: ≤150 คำ 1 จอมือถือ): (ก) เจ้าของตกลงกรอก 3 ตัวเลข
  หลังจบไลฟ์ (viewer สูงสุด/ออเดอร์/ยอด) และ (ข) มี pipeline ราคาเงิน Sheet→DB
- Alert เช้าแยกต่างหาก เฉพาะเมื่อมีเหตุจริง (ราคาเงินขยับแรง) — ไม่ใช่ของประจำวัน

### 1.2 Ads Intelligence — CFO เรียงอันดับ 1 ตาม ROI / CEO ให้แค่ lite

**ตัดสินด้วยเลขจริงที่ CFO ขอ: `analytics.fact_ad_spend` มีทั้งหมด 7 แถว รวม ฿500
(10–16 ส.ค. สัปดาห์เดียว) — มติ CEO ยืน: GO lite บน campaign board เดิมเท่านั้น**
- อ่านได้สองแบบ และทั้งสองแบบชี้ทางเดียวกัน: ถ้ายิงจริงแค่นี้ → ไม่มี waste ให้ประหยัด =
  Ads platform เป็นของเล่น · ถ้ายิงจริงมากกว่านี้แต่ไม่ได้บันทึก → ปัญหาคือ **ingestion ไม่ใช่ analysis**
- ⚠️ ต้องถามเจ้าของยืนยัน: ยอดยิงแอดจริง/เดือน (นอกระบบ) คือเท่าไหร่

## 2. Go/No-Go ต่อ pillar (มติรวม)

| Pillar | มติ | รูปแบบ |
|---|---|---|
| 6. Executive Intelligence | ✅ **GO — MVP ตัวจริง** | Weekly Brief agent-run · zero software ใหม่ |
| 5. Experiment & Learning | ✅ GO ครึ่งเดียว | Skill/Memory มีแล้วไปต่อ · A/B engine NO-GO (334 ออเดอร์/เดือน ไม่พอสถิติ — CFO: รอ >1,000) · แทนด้วย hypothesis+ผลจริง บน campaign board |
| 2. Content Intelligence | ✅ GO lite | ห้ามลงทุนเพิ่มจนกว่า backlog 22 หัวข้อถูกใช้หมด (CEO) |
| 4. Ads Intelligence | 🟡 GO lite | ต่อยอด board เดิม · API sync + anomaly = NO-GO |
| Customer Intelligence | 🟡 manual ก่อน | 1:1 เงินแท่ง top 20–30 ในแผน ก.ย. = customer intelligence ด้วยมือ (CMO) · ระบบ = ทบทวนวันที่ 90 |
| 1. Market Intelligence | 🟡 GO lite ท้ายแถว | weekly agent-based · ห้ามสร้าง monitoring software |
| 3. Creative Factory | ❌ NO-GO | คอขวดคือกล้อง ไม่ใช่สคริปต์ · AI video สวนทาง trust ของแบรนด์ (CMO) · repurpose = BB-8 ทำได้อยู่แล้ว |

**เพดาน Governance ใน 90 วัน = Level 2 (Recommend)** ยกเว้นรายการที่ COO อนุมัติ:
- L4 ได้เคสเดียว: ตอบราคาเงินแท่งตาม template + feed ราคา realtime (ราคามาจาก feed ไม่ใช่ AI คิด)
  — เคสนอก template (buy-back/ต่อรอง/925) = L2 เสมอ
- L4 มีเงื่อนไข: โพสต์ IG จาก asset ที่เคย approve แล้ว (claim ใหม่/ตัวเลขใหม่ = ตก L3 ทันที)
- L3 ห้ามต่ำกว่า: LINE broadcast · script ให้ทีมถ่าย (ผ่าน 3 ด่าน content) · แก้เว็บ Wix
- L2 ตายตัว: ทุกอย่างแตะราคา/ภาษี/สุขภาพ/การลงทุน · เพิ่มงบแอด/เปิดแอดใหม่

## 3. ตัวชี้วัด 90 วัน (CEO กำหนด — วัดด้วยของที่มีเท่านั้น)

1. **Execution**: 6 ข้อ "หยุดเลือด" ก.ย. เสร็จครบ (binary)
2. **Adoption — ตัวชี้ขาด**: Weekly Brief ~12 ฉบับ + **recommendation acceptance ≥ 60%**
   (ต่ำกว่า = ปัญหาที่ format/capacity — คำตอบไม่ใช่สร้างเพิ่ม)
3. **SEO**: บทความเครื่องประดับขึ้นเว็บ ≥4 ชิ้นจาก backlog + GSC มีคำ non-brand สายเครื่องประดับ
   โผล่ครั้งแรก (วัด 0→>0 เท่านั้น)
4. **Campaign discipline**: win-back ยิงตามจังหวะ 15–18 + ทุกแคมเปญมี hypothesis ก่อน/ผลจริงหลัง 100%

จงใจไม่ตั้ง KPI ยอดขายรวม (CEO: "ยอดโตจากไลฟ์อยู่แล้ว เอา revenue มาเคลมให้ OS = วัดมั่ว")
KPI การเงินกำกับ (CFO): margin ส่วนเพิ่มที่ attribute ได้ ÷ (งบ marketing + ต้นทุน OS) ≥ 1.0
— ห้ามใช้ ROAS (ที่ margin 17.5% ROAS 3 ที่ดูสวย = ขาดทุนจริง ต้อง 5.7 แค่เท่าทุน)

## 4. Guardrails มีผลทันที

**การเงิน (CFO)**: เพดานต้นทุนเพิ่ม **฿3,000/เดือน** (ปลดเป็น 10k เมื่อ attributed margin ≥ 2×
ต้นทุน 2 เดือนติด · hard ceiling 10k) · งานที่วิ่งบน subscription ได้ห้ามใช้ metered API ·
metered ทุก key ตั้ง hard cap รวม $20/เดือน · scheduled job ทุกตัวมี cost log + max runs/day +
kill switch · ห้าม loop ที่ AI trigger AI โดยไม่มีตัวนับ · cache ข้อมูลอายุ 24 ชม. ห้าม re-analyze

**กำลังคน (COO)**: งบเวลาเจ้าของ ~5 ชม./สัปดาห์ → โควตา: brief ทีมถ่าย 5–7 · โพสต์ 3–4 ·
LINE broadcast 1 · **Wix batch เดียว/สัปดาห์ 60–90 นาที ห้าม drip** ·
**WIP limit: คิวรออนุมัติเกิน 10 ชิ้น → AI หยุดผลิต (hard rule)** ·
สัญญาณอันตราย: publish-through <70% ใน 14 วัน · approve ~100% + อ่าน <1 นาที = rubber-stamp
(ด่านมนุษย์หายโดยไม่รู้ตัว — ต้องลด volume หรือยก L4 อย่างเป็นทางการ)

**ทิศ execute (COO)**: route output ไปเป็น script/hook ให้**ทีมถ่ายคลิป = แขน execute ที่สอง**
ให้มากที่สุด (เจ้าของ approve 5 นาที แทนลงมือเอง 30–90 นาที)

## 5. แผน 90 วัน

**ช่วง A — ก.ย. (ปิดของค้าง + วางจังหวะ)**
1. ปิด 6 ข้อ "หยุดเลือด" ก.ย. — precondition ของทุกอย่าง ไม่ใช่ส่วนหนึ่งของ OS
2. Weekly Brief v1 (จันทร์เช้า): ตัวเลขสัปดาห์จาก fact_order · GSC delta · สถานะ campaign board ·
   **action ≤3 ข้อ แต่ละข้อ ≤15 นาที** — ทุก recommendation ต้อง executable ในสัปดาห์นั้น
3. Recommendation log แบบเบาสุด (วันที่/ข้อเสนอ/ทำไหม/ผล) — แหล่งข้อมูลตัดสินวันที่ 90
4. เพิ่มช่อง hypothesis + ผลจริง ลง campaign board เดิม (ไม่สร้างระบบ experiment)
5. Hook log ตารางเดียว (clip id · hook text · pattern · วันปล่อย · เว้นช่อง performance) —
   **จดทันทีเพราะย้อนหลังไม่ได้** แต่ห้ามสร้าง Hook system จนมีคลิป 20–30 ชิ้นพร้อมผล (CMO)
6. Win-back 411: **กัน hold-out 40–50 คนไม่ยิง** เพื่อวัด incremental lift (CMO) ·
   ของแถม ฿80 ผ่าน CFO ก่อน · ยิงตามจังหวะ 15–18 ก.ย.

**ช่วง B — ต.ค. (ปลดคอขวด ingestion — COO ชี้ว่า priority สูงกว่าที่คิด เพราะปลด Observe+Measure
พร้อมกันโดยไม่มี governance risk)**
7. Pipeline ราคาเงิน Google Sheet → DB + backfill (data task #1 เดิมจากแผน ก.ย. — ค้างอยู่)
8. GSC weekly pull เข้า DB
9. Execution queue จัดกลุ่มตามช่องทาง (Wix กอง/LINE กอง) + copy-paste พร้อมใช้ต่อชิ้น
10. ประเมิน daily ingestion: เจ้าของกรอก 3 ตัวเลขหลังไลฟ์ไหวไหม → ตัดสิน upgrade brief เป็น daily

**ช่วง C — พ.ย. (อ่านผลรอบแรก)**
11. Experiment ที่สอง: "คลิปเย็นดันไลฟ์" (สลับวันมี/ไม่มี วัด viewer→order) — ต่อเมื่อข้อ 10 สำเร็จ
12. **Day-90 review**: acceptance rate ≥60% → คุยเฟสถัดไป (Ads ขยาย / Customer Intelligence เป็นระบบ)
    · ต่ำกว่า → แก้ format/capacity ห้ามสร้างเพิ่ม

## 6. โครงสร้างกระจัดกระจายที่ต้องจัด (Tech Lead)

1. เอกสาร marketing ~20 ไฟล์ 3 โฟลเดอร์ ไม่มี index + มีไฟล์ deprecated ปนของจริง → ทำ index กลาง
   ระบุสถานะ (ใช้ได้/แทนที่แล้ว/ห้ามใช้)
2. SKU 2 ระบบแยก 100% (Insight 303 / Wix 290) → Insight เป็นเจ้าของ (เจ้าของเคาะแล้ว 29 ส.ค.)
   ของใหม่ใช้เลขเดียวกันทุกที่ · ต้องมีที่เก็บ mapping (งาน backend เล็ก รอออกแบบตอนชัดเรื่อง catalog)
3. ความรู้ซ้ำ 3 ชั้น (memory/docs/skills) → กติกา: fact อยู่ที่เดียว ที่อื่นชี้ลิงก์
4. Content assets ไม่มีทะเบียนสถานะ → รวมใน index ข้อ 1 (พร้อมใช้/ใช้แล้ว/หมดอายุ)
5. GSC มีสิทธิ์แต่ดึงมือ → ช่วง B ข้อ 8

## 7. ต้องเรียนรู้เพิ่ม (เรียงตามความจำเป็น)

1. **LINE Messaging API** (narrowcast/tag) — ค้างตั้งแต่ 13 ส.ค. บล็อกแผน follow-up ทุกตัว
2. **GSC API** — ง่ายสุด ทำก่อน
3. **Scheduled agent runs** — ใช้ของที่มี (cron/scheduled tasks) ไม่ต้องมี n8n
4. TikTok/Meta Ads API — **เลื่อนออกไป** จนกว่ายืนยัน ad spend จริง
5. ไม่ต้องเรียนใน 90 วัน: n8n · vector DB (ถ้าจำเป็นใช้ pgvector บน Supabase ที่จ่ายแล้ว) · video pipeline

## 8. คำถามถึงเจ้าของ — **ตอบแล้ว 29 ส.ค. ค่ำ**

1. **คู่แข่งไลฟ์ 5 ชื่อ** → ⏳ เจ้าของจะไปดูมาให้ (ค้างรอ)
2. **กรอกหลังไลฟ์** → ✅ ไหว — และเจ้าของชี้ว่า **ออเดอร์+ยอดมาจากไฟล์ที่อัปโหลดวันถัดไปอยู่แล้ว**
   ⇒ เหลือกรอกมือแค่ **viewer สูงสุด ตัวเดียว** (เบากว่าที่ COO ขอ) — เปิดทาง daily brief เมื่อ
   ยกระดับการอัปไฟล์เป็นรายวัน · experiment "คลิปดันไลฟ์" ทำได้
3. **ยอดยิงแอดจริง** → ✅ **"ยังไม่ได้ยิงจริงเลย organic ล้วนๆ"** — fact_ad_spend ฿500 คือรายการทดลอง
   ⇒ ยอด ~฿802k/เดือน = **organic 100%** · มติ CEO เรื่องเสา Ads ยืนแข็งขึ้นอีก:
   ไม่มี waste ให้ประหยัด ไม่มี ROAS ให้วิเคราะห์ — เสา Ads เลื่อนไปจนกว่าจะเริ่มยิงจริง
   และเมื่อเริ่ม: บันทึกตั้งแต่บาทแรก + เป้า ROAS ≥ 5.7 (ไม่ใช่ 3) ตามสูตร margin ของ CFO

**หมายเหตุสกุลเงิน (เจ้าของสั่ง)**: ตัวเลขเงินทุกตัวในเอกสาร/รายงานทีมนี้ใช้ **THB** —
เพดาน metered API ของ CFO ($20) = **฿700/เดือน**

## 9. ท่าทีต่อเอกสาร BA (ข้อความ CEO ถึงเจ้าของ)

> เอกสารฉบับนี้มีคุณค่าเป็น **แผนที่ระยะยาวไว้เทียบทาง ไม่ใช่แผนก่อสร้าง** —
> วิสัยทัศน์ "Observe → Recommend ก่อน แล้วค่อย Execute" ถูกต้อง
> และเราจะเดินตามหลักนั้นด้วยของที่มีอยู่แล้ว ไม่ใช่ด้วยการสร้าง platform ใหม่
