# INDEX — docs/3j-jewelry (ปรับปรุง 31 ส.ค. 2569)

> **กติกาการใช้: เปิดไฟล์นี้ก่อนเสมอ แล้วเปิดเฉพาะไฟล์ที่เกี่ยวกับงานตรงหน้า**
> ห้ามกวาดอ่านทั้งโฟลเดอร์ — เปลือง context และเสี่ยงหยิบไฟล์ที่ถูกแทนที่แล้วไปใช้
> (เกิดจริงมาแล้ว: สมมติฐาน OEM ผิดจากเอกสารเก่า · "LINE audience ทองคำ" จากข้อมูล ม.ค.)

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
| `design-system/` + `cad/` | ระบบออกแบบเครื่องประดับ (Sabé) | ✅ current |
| `brand-ops/` | brand brief / NAP / prompt | ✅ current |
| `oms/` · `ops-app/` · `oem/` · `design/` | design docs ตามระบบ | ✅ ใช้อ้าง design |
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
