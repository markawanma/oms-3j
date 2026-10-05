# Design: Gem Quiz v2 — reconcile แพ็กเกจ UI/UX ภายนอก กับ backend เดิม

> ผู้ออกแบบ: architect (Yoda) · 5 ต.ค. 2569 · สถานะ: design เท่านั้น ยังไม่ implement ยังไม่ apply migration
> แทนที่บางส่วนของ design-gem-quiz.md (v1) — ยังมีผลเต็ม: §1 (F1-F14), §1.2, §2, §5 (anti-bot ทั้งหมด), §6 (QR)
> ส่วนที่ถูกแทน: §3.1 seed 12 พลอย · §4.2 flow · §4.3 slot หน้าผล · §4.4 "ไม่ใช้ Q1 ในการคำนวณ" · §7 section หน้าสถิติ
> แหล่งความจริงด้านเนื้อหา/UI/scoring = แพ็กเกจเจ้าของ (V1 spec ชนะเมื่อขัดกับ UI_UX_Flow)
> 🔴 ขั้นแรกของ implement: copy แพ็กเกจเข้า docs/3j-jewelry/analytics/gem-quiz-v2-handoff/ (provenance + fixture ของ oracle test)

## 0. TL;DR
- schema ตารางไม่เปลี่ยน · gem_quiz_submit ไม่แตะ (md5 4aa13b85… ต้องคงเดิม)
- migration เดียว 0157: ปิด 7 พลอยด้วย is_active=false + label/sort ตามแพ็กเกจ + create or replace gem_quiz_stats (signature เดิม) เพิ่ม daily_breakdown + liked_first
- Q4 = liked_stone_codes (ลำดับมีความหมาย) · Q1/Q2/Q3/Q5 = answers 4 key · ผล = recommended_stone_codes [rank1]
- QUIZ_VERSION 1 → 2 · scoring = rank() ของ Quiz.dc.html เป๊ะ พิสูจน์ด้วย oracle test 21,420 combination
- 8 จอ = route เดียว /gem-quiz · กฎ §1.2 ยังบังคับด้วย test เดิม
- Products ไม่มีราคาใน v2
- O1/O2/O3/O6 บล็อกการเริ่ม

## 1. ข้อเท็จจริงที่ตรวจจริง (5 ต.ค. 69)
| # | เจอ | ผล |
|---|---|---|
| V1 | gem_quiz_response = 0 แถว | ไม่มีประวัติให้เสีย · เปลี่ยน answer key ได้อิสระ |
| V2 | ไม่มี trigger บน 2 ตาราง | UPDATE ใน 0157 ไม่ชน trap #19 |
| V3 | migration ล่าสุด 0156 · ไม่มีใครจอง 0157 | ใช้ 0157 (ยืนยันซ้ำตอนเขียน) |
| V4 | md5 stats=1e343326… submit=4aa13b85… | ตรวจหลัง apply |
| V5 | UI + หน้าสถิติอยู่ที่ feature/gem-quiz-ui (cdfc503, e645222) ไม่อยู่บน main · ยังไม่ผ่าน security/QA | review UI ทั้งก้อน |
| V6 | matcher exempt exact gem-quiz/?$ + api/gem-quiz/submit/?$ | ห้าม sub-route / opengraph-image.tsx · asset ต้องเป็น svg/png/jpg/jpeg/gif/webp/ico |
| V7 | RPC answers: ≤5 key, regex key/value, value ต้องเป็น JSON string, ≤512B | key/value v2 ผ่านหมด ไม่แก้ DB · array ใส่ answers ไม่ได้ ⇒ Q4 อยู่ใน liked |
| V8 | stats กรอง is_active · submit ตรวจ liked กับ is_active แต่ recommended แค่ "มีจริง" | ปิด 7 ตัวแล้ว DB ปฏิเสธ liked เอง · ช่อง recommended ยอมรับ (R3) |
| V9 | Q4 ไม่มี "ยังไม่มีในใจ" | กลับมติ B1 · validate บังคับ 1..3 |
| V10 | preference มีในคะแนน (+6/+4/+2) | กลับหลัก §4.4 · agreement ไม่สะอาด |
| V11 | mockup ไม่มีปุ่มชวนเพื่อน + บรรทัดไม่เก็บข้อมูล | O5 |
| V12 | V1 §15 มี "Feeling secondary +4" แต่ config + rank() ไม่มี | ยึด config + rank() |
| V13 | renderVals() มี fallback `complete ? a : DEMO` | ห้ามพอร์ต — ไม่ครบเด้ง landing |

## 2. Data flow
GET /gem-quiz (force-dynamic, token เดิม) → GemQuizClient: landing → q1 birth_day → q2 intention → q3 feeling → q4 preferences(1-3) → q5 jewelry_type → loading 1.5s → result (focus สลับด้วย alternative)
กด "ดูผลลัพธ์ของฉัน": rankGems() ฝั่ง client แสดงผล + POST /api/gem-quiz/submit fire-and-forget
route เดิม (L1/size/honeypot/token) → validate v2 → rankGems() ซ้ำฝั่ง server → gem_quiz_submit (ไม่เปลี่ยน)
/marketing/gem-quiz → getGemQuizStats → gem_quiz_stats (0157)

## 3. Data model + API contract
### 3.1 Mapping
| แพ็กเกจ | เก็บที่ | ค่า |
|---|---|---|
| birth_day | answers.birth_day | sun..sat (รหัสของ quiz-config.json ไม่ใช่ "sunday") |
| intention | answers.intention | love wealth career confidence calm renewal |
| feeling | answers.feeling | energy calm clarity renew open advance |
| gem_preferences | liked_stone_codes | 1..3 เรียงตามอันดับที่แตะ |
| jewelry_type | answers.jewelry_type | ring necklace earring bracelet unknown |
| primary_gem | recommended_stone_codes | [rank1] |
| alternative/third/placement | ไม่เก็บ | derive ได้จาก (version, answers, liked) |

### 3.2 ค่าคงที่
- DB (answers cap/regex/512B, liked ≤3, recommended 1..2): ไม่แก้
- validate.ts MAX_ANSWER_KEYS=5 + regex: ไม่แก้ · liked 0..3 → 1..3 (MIN_LIKED_STONES=1) · เพิ่ม "ต้องตอบครบทุกคำถามใน config"
- QUIZ_VERSION → 2 (localStorage key เป็น gemQuizDone:v2) · MAX_BODY_BYTES 2048 ไม่แก้

### 3.3 POST /api/gem-quiz/submit (status code เดิมทั้งหมด)
```json
{ "v":2, "src":"card", "token":"…", "hp":"", "liked":["garnet","citrine","amethyst"],
  "answers":{"birth_day":"sun","intention":"career","feeling":"energy","jewelry_type":"ring"}, "retake":false }
```

### 3.4 0157_gem_quiz_v2_five_stones.sql (LF · idempotent · traps 1/2/10/18/19/20/21)
1. `update gem_quiz_stone set is_active=false where code in (pearl,nil,ruby,sapphire,busarakham,iolite,kyanite) and is_active`
2. label amethyst → อเมทิสต์ · sort_order ตาม gemOrder (garnet 10, amethyst 20, citrine 30, peridot 40, blue_topaz 50) · ทุก UPDATE มี `and col is distinct from <ใหม่>`
3. create or replace gem_quiz_stats(uuid,date,date,boolean) signature เดิม · ลอก body จาก pg_get_functiondef สด · ต่อท้าย:
   - liked_first: [{code,count}] จาก liked_stone_codes[1]
   - daily_breakdown: [{date,dim,code,count}] วันไทย × dim ∈ (ทุก key ใน answers, 'liked', 'liked_first', 'recommended') เฉพาะ count>0
   - revoke … from public, anon, authenticated; grant … to service_role
4. ไม่แตะ submit · ไม่ drop price_group

หลัง apply: overload stats=1 · md5 submit คงเดิม · check-analytics-grants.sql · schema_migrations + ไฟล์ขึ้น main
ขนาด daily_breakdown ≤~39 combo/วัน → 30 วัน ~1.2k object · 366 วัน ~14k (~1MB) รับได้

## 4. Scoring + ผลลัพธ์ (pure TS)
- config.ts เขียนใหม่: พอร์ต quiz-config.json เป็น `as const satisfies` · คง export เดิม (GEM_QUIZ_STONES, GEM_QUIZ_STONE_CODES, GEM_QUIZ_QUESTIONS) แบบ derive · สี base/light/dark ย้ายเข้า config ⇒ ลบ stone-colors.ts · ห้าม priceGroup (M1)
- recommend.ts: `rankGems(input)` → GemScoreRow[5] เรียงแล้ว · `recommendStoneCodes(input)` → [rank1]
  comparator = total↓ → intention↓ → feeling↓ → preference↓ → day↓ → gemOrder↑ · ไม่บวก base 10
- result.ts (ใหม่): `buildResultView(...)` จาก renderVals() (hero/isAlt, line2, prefNote 3 กรณี, pair + fallback, alternatives, how-to-wear: unknown→defaultJewelry, ring→ringFinger, อื่น→otherPlacement, products = ชื่อเท่านั้น) ยกเว้น DEMO fallback
- test: demo → garnet 24 / citrine 21 / blue_topaz 5 · oracle = rank() ของ mockup คำต่อคำ + fixture JSON ต้นฉบับ เทียบทุก 7×6×6×85 = 21,420 combination ลำดับต้องตรงทั้ง 5 ตำแหน่ง · รายงาน % ที่แต่ละพลอยชนะอันดับ 1 (คำถามธุรกิจ)

## 5. UI 8 จอ (ทั้งหมดใต้ app/(quiz)/gem-quiz/)
- GemQuizClient.tsx = state machine เท่านั้น
- _components/: QuizHeader, OptionCard (list/grid, button aria-pressed ≥44px), GemPicker (max 3, rank badge, disabled เมื่อเต็ม), GemIcon (SVG จาก Gem.dc.html — polygon ไม่มี id)
- _screens/: Landing, QuestionScreen (Q1/2/3/5), PreferenceScreen, LoadingScreen, ResultScreen
- ../layout.tsx เขียนใหม่: shell ivory + การ์ด 500-600px + next/font/google 3 ตระกูล (self-host, subset thai/latin, เฉพาะ weight ที่ใช้) + CSS vars palette · เอา header/footer เดิมออก

กติกา:
- §1.2 ห้าม "use server" · ห้าม `<link fonts.googleapis.com>` (ส่ง IP ให้บุคคลที่สาม)
- hydration: state เริ่ม deterministic · สุ่ม Q4 / localStorage / ?src= / navigator.share ใน useEffect/handler เท่านั้น ย้ายออกจาก useState lazy init · timer เริ่มใน handler + clear ใน cleanup · reduced-motion ผ่าน CSS
- submit ครั้งเดียวต่อรอบที่ทำจบ · restart ส่งใหม่ด้วย retake:true (ref = localStorage OR ส่งแล้วในรอบนี้) · markDone เฉพาะ 204 · แตะ alternative ไม่ submit
- result เข้าได้เมื่อตอบครบเท่านั้น
- palette ผ่าน CSS variable ⇒ O1 แก้บรรทัดเดียว

หน้าผล: Products = ชื่ออย่างเดียว ตัด ฿[ราคา] (ไม่มีราคาที่ผ่าน 3 ด่าน · ลาย→SKU map ไม่ได้ · ต่อ catalog = เสี่ยง M1; ถ้าวันหน้าต่อ ใช้ projection แบบ shop_catalog ทีละ field อ่านใน server component) · disclaimer render ทุกผล · CTA ปลายทาง = O4

## 6. หน้าสถิติ
- gem-quiz-stats.ts: parser liked_first + daily_breakdown · 🔴 deploy TS หลัง apply 0157
- section: n + badge<30 · Q2 × วันในสัปดาห์ที่ทำ (weekday = new Date(date+"T00:00:00Z").getUTCDay()) · แนวโน้ม Q2 รายวัน · พลอยที่ชอบ (ทุกอันดับ + อันดับ 1) · recommended · Q1/Q3/Q5 distribution · crosstab เดิม · card vs share · daily
- ลบ: กลุ่มราคา · agreement (SQL คงไว้)

## 7. ไฟล์
Branch: feature/gem-quiz-v2 แตกจาก feature/gem-quiz-ui (e645222) · คู่ขนานต้อง isolation: worktree

| ไฟล์ | สถานะ |
|---|---|
| docs/3j-jewelry/analytics/gem-quiz-v2-handoff/** | สร้าง (สำเนาแพ็กเกจ) |
| supabase/migrations/0157_gem_quiz_v2_five_stones.sql | สร้าง |
| scripts/verify-0157.sql | สร้าง (7 inactive · ruby⇒22023 · v2 ครบ⇒insert · key ใหม่ถูก · md5 submit คงเดิม · overload=1 · R-11 42501) |
| lib/gem-quiz/config.ts, recommend.ts(+test) | เขียนใหม่ |
| lib/gem-quiz/result.ts(+test) | สร้าง |
| lib/gem-quiz/validate.ts(+test) | แก้ |
| lib/gem-quiz/stone-colors.ts | ลบ |
| lib/gem-quiz/form-token.ts, no-server-action-graph.test.ts | ไม่แตะ |
| app/api/gem-quiz/submit/route.ts | แก้เล็ก (ส่ง input รวม liked ให้ recommend) |
| route.test.ts | แก้ fixture + เคส liked ว่าง/ไม่ครบ/ruby ⇒ 400 |
| app/(quiz)/layout.tsx, gem-quiz/GemQuizClient.tsx(+test) | เขียนใหม่ |
| app/(quiz)/gem-quiz/page.tsx | แก้ metadata |
| app/(quiz)/gem-quiz/_components/*, _screens/* | สร้าง |
| public/gem-quiz/og.png | แทนที่ (ของเดิม 68 bytes) |
| lib/actions/gem-quiz-stats.ts(+test), components/domain/marketing/GemQuizStats.tsx | แก้ |
| middleware.ts, lib/auth/exempt-path.ts | ไม่แตะ |
| design-gem-quiz.md | แก้หัวไฟล์ชี้มาที่นี่ |

## 8. Trade-offs / ความเสี่ยง
- 7 พลอย: is_active=false > DELETE — ตารางว่างทั้งคู่ไม่เสียประวัติ แต่ comment ตารางกำหนดวิธีนี้ + ย้อนได้ UPDATE เดียว (มติเพิ่งกลับ 12→5 ในวันเดียว)
- Q4 ใน liked > answers — answers รับแค่ string ต้องแก้ submit ที่ audit แล้ว
- ไม่เก็บอันดับ 2-3 — derive ได้ ไม่ต้อง ALTER + แก้ submit
- stats generic 1 section > ต่อคำถาม — มิติใหม่ไม่ต้อง migration
- config TS + oracle test > import JSON — ได้ literal type + พิสูจน์ตรงแพ็กเกจ · แลกกับ 2 ที่
- layout shell เปล่า — mockup มี header ในทุกจอ

ความเสี่ยง: R1 overload/grant ตอน replace (traps 1/2/18) · R2 CRLF (#20) · R3 recommended inactive ยังผ่าน DB (ยอมรับ) · R4 hydration · R5 copy ความเชื่อ (O2) · R6 ตีความสถิติ (card=ผู้ซื้อแล้ว, preference มีผล, n น้อย) · R7 timezone weekday · R8 ลำดับ deploy · R9 ฟอนต์ไทย 3 ตระกูลบนมือถือ · R10 restart หลัง token >2 ชม. = 400 เงียบ (ยอมรับ)

ระดับตรวจ L · security: validate/route diff, 0157, M1 ใน bundle, ไม่มี request ไปบุคคลที่สาม, UI ทั้งก้อน

## 9. คำถามเปิด

บล็อกการเริ่ม — **เจ้าของเคาะแล้วทั้งหมด 5 ต.ค. 69:**
- **O1 สี** → **ใช้สีแบรนด์เดิม `#a2191d`** (ไม่ใช้ Burgundy `#8F1015` ของแพ็กเกจ) — คงความสม่ำเสมอกับทั้งเว็บ ใช้ CSS variable ตามที่ §5 ออกแบบไว้ แก้บรรทัดเดียว (map `#a2191d`→600, เฉด 700/800 derive เอง)
- **O2 copy** → **อนุมัติแล้ว** การที่เจ้าของส่งแพ็กเกจมาเองนับเป็นการอนุมัติเนื้อหาความเชื่อ ("ความสงบ & การปกป้อง", "ความรัก & เสน่ห์", "การเงิน & โอกาส") ใช้ตามแพ็กเกจได้เลย ไม่ต้องส่ง brand-strategist ตรวจซ้ำ
- **O3 ชนิดพลอย** → **พลอยแท้ธรรมชาติ** — การ์ดผลลัพธ์ ("แหวนโกเมน" ฯลฯ) ต้องสื่อว่าเป็นพลอยธรรมชาติ ไม่ใช่สังเคราะห์/CZ ถ้าจะมี disclaimer เรื่องการปรับปรุงคุณภาพ (เผาพลอย ฯลฯ) ต้องตรงกับมติ B2 เดิม ("ธรรมชาติ อย่างมากอาจจะมีเผา แต่เผาเก่า")
- **O6 นิยาม "แต่ละวัน"** → **วันที่ลูกค้าทำแบบทดสอบจริง** (ไม่ใช่วันเกิด/วันโชค) — `daily_breakdown` ใน 0157 ตามที่ออกแบบไว้แล้วตรงกับมตินี้พอดี ไม่ต้องเพิ่ม answer_pairs

ไม่บล็อกโค้ด (บล็อก prod): O4 ปลายทาง CTA/การ์ดสินค้า (ไม่ใช่ /shop) · O5 ปุ่มชวนเพื่อน + บรรทัดไม่เก็บข้อมูล (เสนอคงไว้) · O7 โลโก้ทางการ + OG · O8 สุ่ม Q4 (เสนอสุ่ม) · O9 pushState ให้ back ย้อนคำถาม (เสนอทำ) · O10 วัดการแตะ alternative (เสนอไม่ทำ) · ค้างจาก v1: P1 โดเมน QR, D1-D3

→ **ไม่มีคำถามบล็อกการเริ่มเหลืออีกแล้ว เริ่ม §10 ลำดับข้อ 2 (backend-dev) ได้เลย**

## 10. ลำดับ
1. ปิด O1-O3, O6
2. backend-dev: สำเนาแพ็กเกจ + lib + test + 0157 + verify ซ้อม rollback (ยังไม่ apply) + ตาราง brief→test
3. frontend-dev (worktree)
4. security + QA คู่ขนาน (L) → code-review
5. devops: apply 0157 + schema_migrations → merge → deploy · ยืนยัน GEM_QUIZ_TOKEN_SECRET
