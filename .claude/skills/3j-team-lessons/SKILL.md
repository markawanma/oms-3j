---
name: 3j-team-lessons
description: เหตุผลเบื้องหลังกติกาใน CLAUDE.md + บทเรียนจริง (วันที่/เหตุการณ์) ที่ทำให้เกิดกติกาแต่ละข้อ + Roster persona เต็ม — โหลดเมื่อจะเขียน brief ให้ subagent · เมื่อสงสัยว่า "ทำไมต้องทำแบบนี้" · หรือเมื่อจะแก้กติกาทีม
---

# บทเรียนและเหตุผลของทีม — 3J Insight

CLAUDE.md เก็บแต่ **กติกา** (สั้น โหลดทุก session) · ไฟล์นี้เก็บ **ทำไม** (โหลดเฉพาะเมื่อต้องใช้)
จะเพิ่มกติกาใหม่ใน CLAUDE.md → เขียนบทเรียนที่มาไว้ที่นี่ ไม่ใช่เล่าเรื่องใน CLAUDE.md

## 1. agent แก้โค้ดขนานต้องใช้ `isolation: "worktree"` (27 ส.ค. · 17 ก.ย. · 25 ก.ย. 69)

27 ส.ค.: ส่ง backend-dev + frontend-dev ทำงานคนละ branch พร้อมกันใน working directory เดียวกัน
ตัวหนึ่ง `git checkout` สลับ branch ขณะอีกตัวยังไม่ commit — รอบนั้นรอดเพราะบังเอิญไม่ชนไฟล์กัน
เกิดซ้ำอีก 2 ครั้ง ครั้งที่ 3 (25 ก.ย.) ถึง production จริง
**ข้อระวังเพิ่ม**: `isolation: worktree` ตอน spawn ไม่การันตีว่า agent ยังอยู่ใน worktree ตอนถูกปลุกด้วย
`SendMessage` — ดู memory `parallel-agents-worktree` · scheduled task (weekly-brief / trend-radar) ก็รันใน
working directory เดียวกันนี้ ก่อนแตะไฟล์ใหญ่ให้เช็คว่าไม่มี task รันอยู่
agent ที่อ่านอย่างเดียว (security / review / docs) ไม่ต้องใช้ worktree

## 2. brief งาน gate/validation ต้องไล่ "เคสที่ห้ามผ่าน" เป็นข้อๆ (26 ส.ค. 69)

security ตีกลับ 2 รอบในวันเดียว ต้นเหตุคือ brief ทั้งคู่ — บอกแค่เจตนา ("ห้ามย้อนงวดภาษี")
ไม่พอ ต้องไล่: ยอดต่าง / ดีลอื่น / ผู้ซื้ออื่น / วันยืมมา — แต่ละเคสต้องตกที่ด่านไหน
ด่านที่มีข้อยกเว้น → ข้อยกเว้นต้องแคบพอที่พิสูจน์ได้ว่าเป็นเคสที่ตั้งใจอนุญาตจริง ไม่ใช่เช็คเงื่อนไขเดียว
**เคสที่ต้อง "ไม่พัง" สำคัญเท่าเคสที่ต้อง "ถูกปฏิเสธ"** — ด่านแน่นเกินก็ฆ่า use case จริง ทดสอบทั้งสองฝั่ง
**ทุก brief ปิดท้ายด้วย "ถ้าคิดว่าสั่งผิดหรือมีช่องเหลือ บอกทันที"** — ทีมเถียงกลับ 6 ครั้ง ถูกทั้ง 6
review/audit agents เคยตายกลางงาน 4 ครั้ง ⇒ สั่งเสมอว่าใกล้หมดเวลาให้สรุปเท่าที่ได้ + ห้าม browser automation

## 3. สาย content ต้องมี 3 ด่านของตัวเอง (29 ส.ค. 69)

สาย dev มีด่านครบ (design → security+QA → review) แต่สาย content ไม่มีด่านเลย — คนสั่ง คนตรวจ
คนอนุมัติ เป็นคนเดียวกัน วันนั้นเกือบปล่อยตัวเลขผิดขึ้นเว็บ 1 ครั้ง และคำที่ชี้ขาดกฎหมายภาษีแทนลูกค้า
อีก 1 ครั้ง · Tech Lead เองก็ถอดค่า "1 บาทน้ำหนัก = 15.16 ก." จาก**อัตราส่วนราคา** แล้วบอกทีมว่า
"ยืนยันแล้ว" ⇒ กติกา "ห้ามอนุมานค่าคงที่/มาตรฐาน/หน่วยวัดจากตัวเลขราคา — ราคาคือสิ่งที่คนตั้ง ไม่ใช่ฟิสิกส์"
และ **subagent เรียก subagent ไม่ได้** ⇒ CMO สั่งทีมเองไม่ได้ การประสานงานตกที่ session หลักเสมอ
แก้ด้วยการเพิ่มตำแหน่งไม่ได้ ต้องแก้ด้วยระเบียบ = skill `3j-content-orchestration`
**เจ้าของกลับมติทีม → เขียนทับเอกสารทันที**: CMO เคยเขียน "IG ❌ ไม่ทำ" เจ้าของกลับมติ (IG = สินทรัพย์แบรนด์)
ถ้าจบที่แชท อีก 2 เดือน agent ตัวเดิมอ่านเอกสารเก่าแล้วเสนอของเดิมซ้ำ

## 4. ห้ามทดสอบตรงบน DB จริง

ทดสอบการออกใบเสร็จบน production → ตัวนับเลขที่เอกสารภาษีเดินหน้า 4 เลข ถอยไม่ได้ (กฎหมายห้ามข้าม/ซ้ำ)
ใบจริงใบแรกของร้านเลยต้องเริ่มที่เลข 16 ⇒ do-block + `raise` บังคับ rollback เสมอ (skill `3j-migration-traps` ข้อ 11)
โปรเจกต์นี้มี DB เดียว ไม่มี dev/prod แยก — ทุก live test ของ agent เขียนแถวจริง ต้องเก็บกวาดด้วย id เจาะจง

## 5. งานแตะเงิน/ภาษี/สิทธิ์ ต้องให้ security ผ่านก่อน merge (27 ส.ค. 69)

เจ้าของเคยสั่ง merge ก่อน security เสร็จ แล้วทีมบอกความเสี่ยงทีหลัง — ผิดลำดับ
กติกา: บอกความเสี่ยงให้ชัด**ก่อน merge** แล้วให้เจ้าของตัดสิน จะ merge ก็ได้แต่ต้องรู้ว่าแลกกับอะไร
ตกลงเรื่อง QA scope (S/M/L/💰) และรูปแบบรายงาน UAT (✅/⚠️/🎯) วันเดียวกัน — ดู memory `qa-workflow-rules`

## 6. วินัยการอ่าน — อ่านเท่าที่งานต้องใช้ (5 ต.ค. 69)

เจ้าของสังเกตว่า "แต่ละงานเริ่มทำงานนานขึ้น และกิน token มากขึ้น" สำรวจแล้วพบว่า
CLAUDE.md + MEMORY.md ที่โหลดทุก session บวมถึง ~40 KB (MEMORY.md กลายเป็นที่เก็บเนื้อหาแทนดัชนี)
และ agent มักถูกสั่งแบบ "ดูใน docs/" จนกวาดอ่านทั้งโฟลเดอร์ ⇒ กติกา:
- ดัชนี (MEMORY.md / INDEX.md) บอกแค่ "มีอะไร เมื่อไหร่ควรเปิด" เนื้อหาอยู่ในไฟล์
- brief ระบุรายชื่อไฟล์ที่ให้อ่าน ไม่รู้ว่าไฟล์ไหนให้ `Explore` หาก่อน
- สถานะที่ git ตอบได้ (merge แล้ว/commit ไหน) ไม่ต้องจดใน memory

## 7. Model routing — เหตุผล

"fable คิดและตัดสิน → sonnet ลงมือ → haiku วิ่งงาน"
- **fable** = จุดที่ตัดสินใจ: main session · ceo (ทิศทางธุรกิจผิดแพงกว่า design) · cmo/coo/cfo (C-level
  เฉพาะด้านใต้ CEO) · architect (design ผิดแพงทั้งโปรเจกต์)
- **opus** = safety net ก่อน merge: security-auditor (เชิงรับ) · red-team (โจมตีเชิงรุกพิสูจน์ว่าทนจริง) ·
  code-reviewer · sre (root-cause ใน production ต้องการ reasoning แน่น)
- **sonnet** = execute ตาม design ที่ชัดแล้ว: backend/frontend/ux-ui/qa/devops · jewelry-designer (ใต้ ux-ui) ·
  seo-specialist/brand-strategist (ใต้ CMO — SEO = ช่องทางที่เป็นสินทรัพย์ของร้าน · brand = ตัวตนระยะยาว) ·
  content-strategist/copywriter/content-repurposer (ทีม content AI-first ใต้ CMO)
- **haiku** = docs-researcher: งานขนข้อมูล คอขวดอยู่ที่ network ไม่ใช่ model
- **Fable fallback**: request โดน safety classifier flag จะถูกส่งไปรันบน Opus และ session ค้างบน Opus
  จนกว่าจะสั่ง `/model fable` ใหม่ — งาน security คุยใน subagent ที่ pin opus ไว้แล้ว ไม่กระทบ session หลัก
- แก้ `.claude/agents/*.md` มีผล **session ถัดไป** ไม่ใช่ทันที — ห้ามรายงาน capability ที่ยังไม่ได้ verify

## 8. Roster — Rebel Alliance Dev Squad

| ตำแหน่ง | persona | ทำไมถึงเข้ากับตำแหน่ง |
|---|---|---|
| ceo | Mon Mothma | ผู้นำสูงสุด วางวิสัยทัศน์ + จัดสรรกำลังพล + go/no-go |
| cmo | Leia Organa | การตลาด/growth — live selling, channel mix, แคมเปญ, brand |
| coo | Admiral Ackbar | ปฏิบัติการ — fulfillment, SLA จัดส่ง, สต็อก ops, return, OEM→คลัง |
| cfo | Hondo Ohnaka | การเงิน — margin/pricing, unit economics, ค่าคอม, COD/cash flow |
| Tech Lead (main) | Obi-Wan Kenobi | นายพลคุมทัพ ประสาน Jedi ทั้งหมดลงสนาม |
| architect | Yoda | ปรมาจารย์ วางรากฐาน คิดลึก — design ผิดแพงทั้งโปรเจกต์ |
| ux-ui | Padmé Amidala | เข้าใจประชาชน/ผู้ใช้ สื่อสารสง่างาม |
| jewelry-designer | Sabé | องครักษ์ผู้ชำนาญเครื่องทรงราชสำนัก — ออกแบบเครื่องประดับ 3J → CAD spec + RhinoPython |
| backend-dev | Han Solo | ช่างเครื่อง Falcon ทำให้ระบบวิ่งจริง แก้เฉพาะหน้าเก่ง |
| frontend-dev | Luke Skywalker | หน้าตาฮีโร่ของทีม ฝั่งที่ผู้ใช้เห็น |
| security-auditor | Mace Windu | ล่า Sith ไม่ประนีประนอม เจอภัยตัดจบ (defensive review) |
| red-team | Darth Vader | ศัตรูภายใน โจมตีเชิงรุก พิสูจน์ว่าระบบทนจริงก่อน attacker จริงมา |
| qa-tester | R2-D2 | ไล่ diagnostic ทุกระบบ หาจุดพังก่อนพัง |
| code-reviewer | C-3PO | จู้จี้ protocol/ความถูกต้อง ก่อนปล่อยผ่าน |
| devops | Lando Calrissian | ดูแล Cloud City = infra/deploy/ops |
| sre | Din Djarin (Mando) | นักล่า bug/incident ใน production — ดับไฟจริง + root-cause "This is the Way" |
| docs-researcher | Jocasta Nu | บรรณารักษ์หอจดหมายเหตุ Jedi — ค้นข้อมูลภายนอก |
| content-strategist | Bail Organa | วุฒิสมาชิกวางแผนสื่อสารมีชั้นเชิง — content calendar/cadence ใต้ CMO |
| copywriter | Maz Kanata | ผู้เล่าเรื่องมองทะลุใจคน — script/hook/caption คุม brand voice |
| seo-specialist | K-2SO | droid วิเคราะห์ยุทธการ คำนวณความน่าจะเป็นตรงไปตรงมา — ทำให้คนค้นเจอเรา |
| brand-strategist | Chirrut Îmwe | ผู้ถือศรัทธาและตัวตน — อัตลักษณ์แบรนด์ + ตัวตนเจ้าของ |
| content-repurposer | BB-8 | droid ขยันวิ่งกระจายข่าว — แตกวัตถุดิบ 1 ชิ้นเป็น content หลายชิ้น |
