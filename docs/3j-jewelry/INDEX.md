# INDEX — docs/3j-jewelry (ปรับปรุง 31 ส.ค. 2569)

> **กติกาการใช้: เปิดไฟล์นี้ก่อนเสมอ แล้วเปิดเฉพาะไฟล์ที่เกี่ยวกับงานตรงหน้า**
> ห้ามกวาดอ่านทั้งโฟลเดอร์ — เปลือง context และเสี่ยงหยิบไฟล์ที่ถูกแทนที่แล้วไปใช้
> (เกิดจริงมาแล้ว: สมมติฐาน OEM ผิดจากเอกสารเก่า · "LINE audience ทองคำ" จากข้อมูล ม.ค.)
> **ทางลัดตามหัวข้องาน: `READING-LISTS.md`** (5 ต.ค. 69) — 13 หัวข้อ แต่ละหัวข้อรวม memory + skill + docs + migration + code ที่ต้องอ่าน ไฟล์นี้ (INDEX) คือแผนที่ตามโฟลเดอร์ ส่วนนั้นคือแผนที่ตามงาน

## สถาปัตยกรรมความรู้ 4 ชั้น — fact หนึ่งอยู่ที่เดียว ชั้นอื่นชี้ลิงก์

| ชั้น | เก็บอะไร | โหลดเมื่อไหร่ |
|---|---|---|
| **DB (Supabase)** | ตัวเลข operational ทุกชนิด (ยอดขาย/ลูกค้า/แคมเปญ/ต้นทุน) | query สดเสมอ — **ห้ามจดตัวเลขซ้ำลง docs** (ตัวเลขใน docs = snapshot ระบุวันที่เท่านั้น) |
| **memory/** (นอก repo) | ข้อเท็จจริงข้าม session + สถานะโปรเจกต์ + บทเรียน | index โหลดอัตโนมัติทุก session — เขียนสั้น ชี้ลิงก์มาที่ docs |
| **.claude/skills/** | กติกา/วิธีทำงาน ที่ใช้ซ้ำ (brand rules, SEO playbook, migration traps) | โหลดเมื่อเรียกใช้ — **ห้ามเก็บ "สถานะ" ใน skill** (สถานะเปลี่ยนบ่อย skill จะเน่า) |
| **docs/** (ที่นี่) | งานส่งมอบ: design, แผน, ผลวิเคราะห์, content พร้อมใช้ | เปิดเฉพาะที่ INDEX ชี้ |

**วงจรชีวิตไฟล์**: ถูกแทนที่ → คนที่แทนที่**ย้ายเข้า `_archive/` + อัปเดต INDEX ทันที** ไม่ทิ้งปนของจริง

---

## 🗂️ marketing/ — สาย content/แคมเปญ

### ✅ ใช้งานอยู่ (current)
| ไฟล์ | คือ |
|---|---|
| `ai-marketing-os-decision-31aug.md` | 🔝 มติ C-level + แผน 90 วัน — **ทิศทางใหญ่สุดตอนนี้** |
| `weekly-brief/` | Weekly Marketing Brief ทุกจันทร์ (scheduled task `weekly-marketing-brief`) — แม่แบบ `TEMPLATE.md` · ฉบับรายสัปดาห์ตั้งชื่อตามวันที่ (ฉบับแรก `2026-09-11.md`, CMO กำหนดแม่แบบ · #2 `2026-09-16.md` สัปดาห์ 7–13 ก.ย. — ใช้กฎ live-SKU ครั้งแรก · #3 `2026-09-28.md` สัปดาห์ 21–27 ก.ย. — ฉบับ 21 ก.ย. ไม่ได้ออก · ⚠️ #3 ค้างนอก main 6–7 วัน เพราะ branch ไม่ถูก merge แก้แล้วใน #4 · #4 `2026-10-05.md` สัปดาห์ 28 ก.ย.–4 ต.ค. — พบ regime break ยอดขาย 26 ก.ย.–2 ต.ค.) · ข้อเสนอลง `analytics.recommendation_log` |
| `content-calendar/` | ปฏิทินโพสต์รายเดือนแบบชุนหลี (เจ้าของสั่ง 16 ก.ย. 69) — แม่แบบ `TEMPLATE.md` (ต้นฉบับ = md ใน repo, artifact = หน้าอ่าน) · ฉบับรายเดือนตั้งชื่อ ปี-เดือน — ฉบับแรก `2026-10.md` (ร่าง 3 · เคาะ Lean · ลง campaign board แล้ว migration 0120 · รอเจ้าของยืนยัน §6d) · ทุกโพสต์ผูก `campaign_step.id` = execution log |
| `trend-radar/` | เรดาร์ข่าว/เทรนรายวัน (scheduled task `daily-trend-radar` ทุกวัน 07:30) — ไฟล์ละวัน ตั้งชื่อตามวันที่ · **วัตถุดิบที่ผ่าน 3 ด่านแล้ว ให้เจ้าของ/CMO หยิบเข้าปฏิทินเอง** 🔴 ระบบไม่แทรกปฏิทินเอง · วันไหนไม่มีอะไรใหม่ให้เขียนว่าไม่มี ห้ามปั้นให้ครบ · **ของจริง = branch `trend-radar-feed`** (เว็บ `/marketing/trend-radar` อ่านจาก GitHub) — บน main โฟลเดอร์นี้อยู่ใน `.gitignore` ตั้งแต่ 5 ต.ค. 69 · บนดิสก์เก็บ 14 วัน task ลบเอง |
| `content-workflow-v1.md` | 🆕 **วงจร workflow content 8 ขั้น ฉบับภายใน** (6 ต.ค. 69, CMO Leia + ผลสำรวจโค้ด) — S1 สัญญาณ → S2 คัด+สมมติฐาน (ฐาน ณ วันตั้ง) → S3 ปฏิทิน → S4 brief/hook A-B → S5 ถ่าย batch → S6 3 ด่าน+อนุมัติ → S7 โพสต์+log หลังไลฟ์ → S8 วัดผล · mass = view÷follower ≥2 · hook 8 ประเภท · ช่องว่างกับแอป (มีชื่อตาราง) · MVP M1–M5 · คำถามเจ้าของ Q1–Q5 | ✅ current — ยังไม่ implement |
| `content-workflow-ui-brief.md` | 🆕 **UI brief สำหรับส่งออกนอกทีม** (6 ต.ค. 69) — workflow ฉบับเดียวกันแต่ตัดของภายในทั้งหมด (ไม่มีชื่อตาราง/ยอดจริง/ต้นทุน) · object model · **สถานะชุดเดียวทั้งระบบ** · 8 ขั้นพร้อมของที่ต้องติดไป · 11 หน้าจอ (A inbox … K ผลลัพธ์) · IA 6 หมวด · กติกา UI · ปัญหาระบบเดิมเป็น checklist · ข้อมูลตัวอย่างสมมติ | ✅ current — เจ้าของเอาไปเทียบกับ UI ภายนอก แล้วกลับมาออกแบบ/implement |
| `content-ui-round2-request.md` | 🆕 คำขอออกแบบรอบ 2 ถึง UI ภายนอก (6 ต.ค. 69) — กล่องข้อความ copy ไปวางได้ · หน้า E แคมเปญที่ยังไม่มี · แบบมือถือที่ขาด · ปฏิทิน 3 มุมมอง · ผลลัพธ์ต่อ hook/สรุปสัปดาห์ · สถานะโหลด/ว่าง/ผิดพลาด · board สเปกสถานะ · มุมมองตามบทบาท · sitemap + 3 เส้นทาง | ✅ current — รวมผลตรวจ Padmé 15 board แล้ว · ส่งคู่กับ brief ฉบับ 1.1 |
| `audit-and-replan-28aug.md` | โครง 3 เสา + บัญชีทรัพย์สิน content (CMO+Bail) — รวมมติ IG ที่เจ้าของกลับ |
| `plan-sep69-revised.md` | แผน ก.ย. ฉบับปรับหลังมีป้ายลูกค้า — win-back 411 |
| `pricing-disclosure-policy.md` | กติกาเปิดราคา — **อ่านก่อนเขียนอะไรที่มีตัวเลขเสมอ** |
| `market-research-raw.md` | research ตลาด/คู่แข่ง (ฉบับมี web tool) |
| `action-plan-from-research.md` | action จาก research |
| `oem-pricing-floor.md` | floor ราคา OEM (ภายใน — ห้ามขึ้นสาธารณะ) |
| `campaign-playbook-taxonomy.md` · `campaign-tracking-taxonomy-v2.md` | taxonomy แคมเปญใน DB (v2 ทับส่วนที่ชนกัน) |
| `phase-content-calendar-design.md` · `ux-content-calendar.md` | design ปฏิทินแคมเปญใน 3J Insight |

### 🎬 Content พร้อมใช้ (asset — สถานะ ณ 29 ส.ค.)
| ไฟล์ | สถานะ |
|---|---|
| `clip-script-v2-silver-bar.md` · `clip-script-v9-wholesale.md` · `clip-scripts-v1-v6-v8.md` | ✅ พร้อมถ่าย — ยังไม่ได้ถ่าย |
| `content-winback-set1.md` | ⚠️ สคริปต์ใช้ได้ แต่ **ต้อง re-brief audience เป็น 411 คน** ก่อนใช้ |
| `content-calendar-sep69.md` | ⚠️ เหมือนกัน — audience เก่า ถูก `plan-sep69-revised.md` ทับส่วน win-back |
| `broadcast-scripts-99.md` · `campaign-plan-99-winback.md` · `discount-policy-99.md` · `ops-plan-99.md` | แคมเปญ 9.9 — ใช้ตามช่วงเวลา |
| `content-cadence-month1.md` · `journey-series-launch-30day.md` · `ai-visual-prompt-pack.md` | แผนเสริม — เช็ควันที่ก่อนใช้ |

## 🌐 web/ — เว็บ 3jthailand.com

### ✅ ชุดปัจจุบัน (29 ส.ค. — ทับของเก่าทั้งหมดในโฟลเดอร์นี้)
| ไฟล์ | คือ |
|---|---|
| `seo-audit-29aug.md` | 🔝 ออดิต SEO + ข้อมูล GSC จริง + สถานะราคา/ทางเข้า |
| `keyword-research-29aug.md` | keyword 3 เสา (K-2SO) + ลำดับงาน 10 อันดับ |
| `ia-3pillar-design.md` | ผังเว็บ 3 เสา + journey + วงจรเนื้อเงิน (Padmé) |
| `content-silverbar-2pieces.md` | เนื้อหาพร้อม paste: ตารางแปลงหน่วย + วงจรเนื้อเงิน + FAQ ขายคืน |
| `backups/wix-prices-usd-2026-08-29.tsv` | สำรองราคาส่งออก USD 122 ตัว (ตัวไฟล์ 28 ส.ค. มีแต่ header — ใช้ตัวนี้) |

### ⚠️ เก่ากว่า — ใช้เฉพาะอ้างประวัติ อย่าใช้วางแผน
`HANDOFF-wix.md` (ข้อมูล API ผิดหลายจุด — เคยพาพลาดมาแล้ว) · `audit-silver-pages.md` ·
`content-plan-silver-bar.md` · `silver-bar-copy-batch1.md` (paste ไปแล้วบางส่วน) ·
`price-system-analysis.md` · `sell-back-page-redesign.md` (+ mockup ใน `mockups/`) · `shop-route-design.md` ·
`tech-design-silver-bar.md` · `velo-fixed/SETUP.md`

## 📝 content/ — คลัง content กลาง
| ไฟล์ | สถานะ |
|---|---|
| `3j-educational-series.md` | ✅ 22 หัวข้อ เขียนสคริปต์แล้ว 2 — **ยังไม่มีใครใช้ · CEO สั่ง: ใช้ให้หมดก่อนผลิตใหม่** |
| `3j-jewelry-clip-ideas.md` · `3j-educational-week1-scripts.md` · `3j-scripts-batch2.md` · `3j-week1-content.md` | ✅ วัตถุดิบพร้อมใช้ — เช็คทับซ้อนกับ educational series ก่อนสั่งเขียนใหม่ |
| `3j-content-master.md` | โครงกลาง — เช็ควันที่ก่อนอ้าง |
| `srt/` (7 ไฟล์) | ✅ ซับไตเติลคลิปพร้อมใช้ — 925/การ์เนต/CZ/เงินดำ/ดูแลเงิน/โรสควอตซ์/ขายส่ง |

## 📁 โฟลเดอร์อื่น (สถานะระดับโฟลเดอร์)
| โฟลเดอร์ | คือ | หมายเหตุ |
|---|---|---|
| `analytics/` | design docs ของ 3J Insight ทุก phase | ✅ ใช้อ้าง design — ตัวเลขในนั้นคือ snapshot ห้ามใช้แทน query |
| `analytics/content-kpi-definition.md` | 🔝 **เอกสารชี้ขาดว่าวัดผล content ยังไง** (22 ก.ย. 69) — 4 ตัวเลขบนจอ · กติกา T+7/T+3 · **สิ่งที่วัดไม่ได้ถาวร** (CTR/ROAS/SKU lift/คอมเมนต์ถามซื้อ) · "บันทึก" คือสัญญาณดีสุดและ API ไม่ให้ · ตารางเห็นแบบนี้ทำแบบนี้ | ✅ current — **ใครจะเสนอ KPI ชุดใหม่ ต้องอ่านก่อนแล้วบอกว่าแทนที่ข้อไหน** |
| `analytics/ux-content-measurement.md` | UX design ชั้นวัดผล content (25 ก.ย. 69, Padmé) — คิวกรอกตัวเลข mobile-first (`/marketing/content/entry`) + ช่องวางลิงก์โพสต์ + สีประเภท (outline+dot กันชนสี primary) — **หน้าสรุปผลเลื่อนออกจากรอบนี้** (เหตุผล+เกณฑ์กลับมาทำใน §4) · `content_type_code` ของ `campaign_step` ยังไม่มี RPC เขียน (§0.3) | 🆕 design เท่านั้น ยังไม่ implement |
| `analytics/content-kpi-screen-design.md` | UX design หน้า "ดู KPI ของคลิป + suggestion" (28 ก.ย. 69, Padmé) — ขยาย `/marketing/content/history` ด้วยหน้าใหม่ `/marketing/content/history/[postId]` · suggestion แมปตรง §5 ของ `content-kpi-definition.md` (auto ได้เต็มแค่แถว 1/2/7 — แถว 3/4/5/6/8 ต้องข้อมูลที่ schema ยังไม่มี ดู §0) · ออกแบบสถานะ "ข้อมูลไม่พอ" (4<10 คลิปตอนนี้) เป็นสถานะปกติ + badge ความมั่นใจ 3-4 ระดับ | 🆕 design เท่านั้น ยังไม่ implement — มีคำถามเปิดค้าง §11 |
| `analytics/upload-page-layout-design.md` | UX design จัดวางใหม่ `/tiktok/upload` (4 ต.ค. 69, Padmé) — accordion 3 section · **อนุมัติแล้ว + implement merge main แล้ว 4 ต.ค. 69** | ✅ current — ใช้อ้างประวัติ design |
| `analytics/design-gem-quiz.md` | Architect design แบบทดสอบเลือกพลอย v1 (4 ต.ค. 69, Yoda) — หน้าสาธารณะ `/gem-quiz` ผ่าน QR บนการ์ดขอบคุณ · ไม่เก็บตัวตน (ไม่มี IP/free text ใน DB) · เขียนผ่าน route handler → RPC `analytics.gem_quiz_submit` · ต้องแก้ middleware matcher · หน้าสถิติ `/marketing/gem-quiz` | ⚠️ **ถูกแทนบางส่วน (§3.1 seed 12 พลอย · §4.2 flow · §4.3 slot หน้าผล · §4.4 · §7) โดย `design-gem-quiz-v2-reconcile.md`** — §1 (F1-F14)/§1.2/§2/§5 (anti-bot)/§6 (QR) ยังมีผลเต็ม |
| `analytics/design-gem-quiz-v2-reconcile.md` | Architect reconcile แพ็กเกจ UI/UX ภายนอกที่เจ้าของส่งมา กับ backend v1 ที่ merge main ไปแล้ว (5 ต.ค. 69, Yoda) — เจ้าของเคาะ: 5 พลอยตามแพ็กเกจ (ไม่ใช่ 12) + ใช้ UI/เนื้อหา/scoring ตามแพ็กเกจเป๊ะ + **เก็บ backend/สถิติเดิมไว้** · schema ไม่เปลี่ยน ไม่แตะ `gem_quiz_submit` · migration เดียว 0157 · scoring พิสูจน์ด้วย oracle test 21,420 combination | ✅ O1/O2/O3/O6 เคาะครบแล้ว 5 ต.ค. 69 — **backend เสร็จแล้วบน branch `feature/gem-quiz-v2`** (config/recommend/result/validate + migration 0157 เขียนแล้ว ยังไม่ apply — รอ dry-run จริงบน DB) · UI (frontend-dev) ยังไม่เริ่ม |
| `analytics/design-content-workflow-schema-gap.md` | Architect gap analysis schema vs หน้าจอ content ชุดใหม่ (6 ต.ค. 69, Yoda) — **ชิ้นงาน = `campaign_step`** + `piece_status` (สถานะวัดผลเป็น derived) · RPC เดียว `content_piece_advance` บังคับลำดับ/อนุมัติ/[ต้องยืนยัน] ที่ DB + event log · ตารางใหม่ `content_signal` · `content_hook` (แยกตาราง) · `live_host` · phase 0160 signal+hook+host (M) → 0161 piece workflow (L, 💰) → 0162 measure+feedback (M) → 0163 month mix (S) · 🔴 เขียนตอน DB ต่อไม่ได้ — §0 มี 5 query ต้องรันก่อน DDL | 🆕 design เท่านั้น — รอเจ้าของเคาะ §9 Q1–Q5 |
| `analytics/design-rfm-snapshot.md` | Architect design snapshot RFM รายสัปดาห์ (6 ต.ค. 69, Yoda) — ต่อลูกค้า · `as_of` = อาทิตย์ (เวลาไทย) · `rfm_snapshot_capture` ตัวเดียวใช้ทั้ง cron จันทร์ 00:05 ไทย + backfill · **ไม่ recompute ย้อน** (เลขไม่เปลี่ยนใต้เท้า — ยอมให้ new/champion สัปดาห์ล่าสุดต่ำกว่าจริงตาม import lag) · view `v_rfm_segment_weekly` / `v_rfm_flow_weekly` ตอบ "คนเข้า/ออก at_risk แยกเหตุ" ใน query เดียว · cohort = `rfm_cohort` + member ชุดเดียวทุกแคมเปญ (Phase 2) | 🆕 design เท่านั้น — รอเคาะ O1-O4 (§13) ก่อนเขียน 0158/0159 |
| `analytics/gem-quiz-v2-handoff/` | สำเนาแพ็กเกจ UI/UX ที่เจ้าของส่งมา (CLAUDE.md + quiz-config.json + design/*.dc.html + specs/*.md) — เก็บไว้เพื่อ provenance และเป็น fixture ของ oracle test ใน `lib/gem-quiz/recommend.test.ts` **ห้ามแก้ไฟล์ในนี้** (ถ้าแพ็กเกจเปลี่ยน ให้เจ้าของส่งมาใหม่ทับทั้งโฟลเดอร์ + อัปเดต fixture คู่กัน) ไม่มี `canvas.json` (เป็น metadata ของเครื่องมือออกแบบ ไม่มีข้อมูลที่ใช้จริง) | ✅ current |
| `analytics/rfm-at-risk-and-new-cohort-2026-10-06.md` | วิเคราะห์ T1+T6 ของ Weekly Brief (6 ต.ค. 69, Han Solo) — **at_risk โตเพราะ aging ล้วน** (+400 ช่วง 28 ส.ค.→11 ก.ย. = เข้า 409 · ออก 8 · อื่น ±1) แต่ 68% เป็นคนซื้อครั้งเดียว ไม่ใช่แค่ "แก่ตัวตามเวลา" · คาดการณ์ inflow 4 สัปดาห์ ≈255 · **cohort new freeze 8 ก.ย. = 531 คน ซื้อซ้ำ 14 วัน 7.5%** เทียบ baseline ไม่มีแคมเปญ 9.5% (8 มิ.ย./ก.ค./ส.ค.) → ไม่ต่างจาก baseline · มีส่วน "วัดไม่ได้/ข้อจำกัด" | ✅ snapshot 6 ต.ค. 69 (ข้อมูลถึง order_date 3 ต.ค.) — ตัวเลขห้ามใช้แทน query สด · รันซ้ำด้วย `scripts/analysis/rfm-asof.sql` |
| `analytics/cohorts/new-freeze-2026-09-08.csv` | รายชื่อ cohort `new` ณ 8 ก.ย. 69 23:59 น. (531 แถว) — `customer_id, first_order_at, channel, second_order_at, second_within_14d` · **ไม่มี PII** | ✅ snapshot 6 ต.ค. 69 — สร้างย้อนจาก `v_fact_order` (replay) ไม่ใช่ cohort ที่ทีมเห็นจริง ณ 8 ก.ย. (as-known = 488) |
| `scripts/analysis/rfm-asof.sql` | SQL อ่านอย่างเดียว: RFM segment "ณ วันที่ใดๆ" (as-of) ตรงกับ `v_rfm_segment` เป๊ะเมื่อ as_of = now() · ซีรีส์รายสัปดาห์ · แยก delta at_risk · cohort freeze · รันผ่าน `node scripts/query-sql.mjs` | ✅ current — แก้บรรทัด `-- << EDIT` เพื่อเปลี่ยนวันที่ |
| `design-system/` + `cad/` | ระบบออกแบบเครื่องประดับ (Sabé) | ✅ current |
| `brand-ops/` | brand brief / NAP / prompt | ✅ current |
| `oms/` · `ops-app/` · `oem/` · `design/` | design docs ตามระบบ — `oms/system-flow-2026-09.md` = วงจรระบบ + **มติเจ้าของ 17 ก.ย. 69** (สต็อก opt-in ต่อ SKU / live-SKU ไม่นับ / ขายดี qty+THB แยกช่องทาง / เตือน LINE / variant แม่-ลูกตาม TikTok) — ขัดกับ memory ให้ถือไฟล์นี้ | ✅ ใช้อ้าง design |
| `oms/design-production-order.md` | design ใบผลิตเข้าสต็อก — **P1 ทำเสร็จแล้ว** (0131+0132 apply+merge 18 ก.ย.) · Q1 เจ้าของตอบแล้ว "ล๊อค" 17 ก.ย. · §P1.5 = หักสต็อกจากยอดขาย (0133 apply+merge 18 ก.ย. ยังไม่ wiring) | ✅ ใช้อ้าง design |
| `oms/design-inventory-lot-costing.md` | **ต้นทุนตามรอบผลิต (FIFO)** — 🔴 เจอว่ากำไรเงินแท่งคิดจาก "ราคาขาย÷1.2" มาตลอด ต้นทุนแคตตาล็อกไม่เคยถึงกำไรเลย · **D1/D2/D3/D6 เจ้าของอนุมัติแล้ว 19 ก.ย.** · 0138+0139 apply+merge แล้ว · หนี้ที่เหลือดู memory stock-and-lot-costing-status | ✅ ใช้อ้าง design |
| `oms/design-own-production-costing.md` | **เครื่องคิดต้นทุนสำหรับผลิตเอง** 19 ก.ย. 69 — เจ้าของสั่งเอง: เอาเครื่องคิด OEM มาวาง **ตัดชั้นราคาขายทิ้งทั้งชั้น** (ไม่เอา margin/floor) · สเปคผูกกับ SKU กรอกครั้งเดียว · ติ๊ก "แบบใหม่" = คิดค่าแบบเต็ม ไม่ติ๊ก = ศูนย์ | ✅ ครบวงจรแล้ว 21 ก.ย. (0140-0144 + UI) |
| `legal/` | **ร่าง Privacy Policy + Terms of Service** (22 ก.ย. 69) — ทำเพราะ TikTok บังคับว่าต้องมีทั้งสอง URL ก่อนส่ง developer app เข้ารีวิว · เว็บ 3jthailand.com **ยังไม่มีทั้งคู่** | 🔴 **ร่างตุ๊กตา ห้ามเผยแพร่** — มี `[ต้องยืนยัน]` ค้างอยู่ + ต้องให้ผู้ดูกฎหมายตรวจก่อน |
| **`_archive/`** | **ไฟล์ที่ถูกแทนที่/ห้ามใช้** | ⛔ อ่านได้เพื่อประวัติเท่านั้น |

## ⛔ _archive/ — ย้ายมา 31 ส.ค. เพราะอะไร
| ไฟล์ | เหตุที่ถูกถอน |
|---|---|
| `positioning-2pillar.md` | หัวหอกผิดยุค (เงินแท่ง+OEM ไม่มีเสาเครื่องประดับ) · "หัก 30บ." ขัดกฎ · "NFC ทุกแท่ง" ผิดข้อเท็จจริง — แทนที่โดย `audit-and-replan-28aug.md` |
| `winback-scripts.md` | ฟันธงตัวเลขรับซื้อคืนสาธารณะ + นิยาม audience ถูกแทน — แทนที่โดย `plan-sep69-revised.md` + `content-winback-set1.md` |
| `3j-month1-calendar.md` | ระบุไลฟ์ 3 ครั้ง/สัปดาห์ — ผิด (จริงคือทุกคืน) |
| `competitor-and-trend-research.md` | ว่างเปล่า (เขียนก่อนมี web tool) — แทนที่โดย `market-research-raw.md` |

## 🤖 กลไกบังคับวินัย (ไม่พึ่งคนสังเกต — ติดตั้ง 31 ส.ค. 69)
| ชั้น | กลไก | จับอะไร |
|---|---|---|
| ตอน commit | `.githooks/pre-commit` (เปิดด้วย `git config core.hooksPath .githooks` — ทำครั้งเดียวต่อเครื่อง) | เพิ่ม/ลบ/ย้ายไฟล์โดยไม่อัปเดต INDEX → **บล็อก** · ข้ามได้ด้วย `SKIP_DOC_INDEX=1` |
| ตอน agent อ่านไฟล์ | `.claude/settings.json` → `scripts/hooks/warn-archive-read.mjs` | อ่านไฟล์ใน `_archive/` → เตือนอัตโนมัติทั้งผู้ใช้และ model |
| รายสัปดาห์ | `node scripts/doc-index-check.mjs` (บรรทัด "สุขภาพคลังเอกสาร" ใน Weekly Brief) | ไฟล์หลุด INDEX · INDEX ชี้ไฟล์ที่ไม่มีจริง |
