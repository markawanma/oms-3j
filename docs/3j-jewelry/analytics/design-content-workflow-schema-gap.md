# Design — Schema gap: สายงาน content/แคมเปญชุดใหม่ (workflow 8 ขั้น · สถานะชุดเดียว · 11 หน้าจอ)

> architect (Yoda) · 6 ต.ค. 69 · สถานะ: **ยืนยันกับ DB สดแล้ว (§0) + เจ้าของตอบ §9.1 แล้ว ⇒ พร้อมเขียน DDL** — ยังไม่มี migration · ป้าย: ✅ = ยืนยันกับ DB 6 ต.ค. · ✏️ = แก้จากของจริง/คำตอบเจ้าของ (เดิมว่า… จริงคือ…)
> ตอบโจทย์: `content-workflow-ui-brief.md` ฉบับ 1.1 (§2 object · §3 สถานะ · §5 3 ด่าน · §6 research · §7 หน้าจอ) + `content-ui-round2-request.md` + `content-workflow-v1.md` §1/§5.2
> ยืนบน migrations จริง: 0049 · 0053 · 0057–0060 · 0101 · 0121 · 0145–0153 · `lib/marketing/clip-brief.ts` · design เดิม `phase-content-calendar-design.md` (D1 "step เป็นแกน") · `design-rfm-snapshot.md` (จอง 0158/0159)

## 0. ขอบเขตการตรวจ — อ่านก่อน

✅ **ยืนยันกับ DB สดแล้ว 6 ต.ค. 69** (ผ่าน session pooler IPv4 · `node scripts/query-sql.mjs` READ ONLY+ROLLBACK · ⚠️ ยิงขนาน >2 connection pooler ตัด `ECONNRESET` — รันทีละไฟล์) · ฉบับเช้าเขียนจากไฟล์ migration เพราะ DNS ล่ม ⇒ ทุกข้อใน §2–§7 ถูกเทียบกับ `pg_catalog` แล้ว ข้อที่ต่างติดป้าย ✏️ ในที่ · query ชุดนี้คงไว้ให้ backend-dev รันซ้ำ**ก่อน apply** (ของจริงชนะเอกสารเสมอ):

```sql
-- 1) คอลัมน์จริงของ 9 ตาราง (เทียบ §2)
select table_name, string_agg(column_name||':'||data_type, ' | ' order by ordinal_position)
from information_schema.columns where table_schema='analytics'
 and table_name in ('campaign','campaign_step','step_artifact','step_gate','recommendation_log',
   'live_session_log','content_post','content_post_metric','channel_follower_log') group by 1;
-- 2) CHECK ของ status/kind/channel จริง (เทียบ §3) — migration เก่าอาจถูกแก้ทีหลัง
select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
 where connamespace='analytics'::regnamespace and contype='c' and conname ~ 'status|kind|channel|type|verdict|action';
-- 3) RPC ที่มี + overload (trap #1)
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where pronamespace='analytics'::regnamespace and proname ~ '^(campaign|content|live|recommendation)' order by 1;
-- 4) จำนวนแถว + ค่าสถานะที่มีจริง (เทียบ §3.3 backfill) — 0148 หัวไฟล์บอก 22 ก.ย.: step 55 · artifact 65 · content_post 0
select 'step',count(*),string_agg(distinct status,',') from analytics.campaign_step
union all select 'artifact',count(*),string_agg(distinct status,',') from analytics.step_artifact
union all select 'post',count(*),string_agg(distinct status,',') from analytics.content_post
union all select 'live',count(*),null from analytics.live_session_log
union all select 'reco',count(*),string_agg(distinct owner_action,',') from analytics.recommendation_log;
-- 5) clip_brief.hooks[] ที่มีจริง (backfill §5.2) — trap #13: เช็ค jsonb_typeof ไม่ใช่ is null
select count(*) filter (where jsonb_typeof(clip_brief->'hooks')='array' and jsonb_array_length(clip_brief->'hooks')>0) hooks_n,
       count(*) filter (where clip_brief->>'chosen_hook_id' is not null) chosen_n from analytics.step_artifact;
```

### 0.1 ผลจริง 6 ต.ค. 69 — สิ่งที่**ตรง**กับไฟล์ migration ✅

grant ทุก RPC `campaign_*/content_*/live_*/channel_*` = `postgres, service_role` เท่านั้น · `has_schema_privilege` analytics: authenticated=false · anon=false · service_role=true · RLS on ทั้ง 9 ตาราง (campaign/step/artifact/gate/reco มี owner_admin_* write policy · content_post/metric/live_session_log/follower_log มีแค่ `tenant_isolation_select` ตามแบบ 0146/0148) · `v_campaign_board` 36 คอลัมน์ลำดับตรง 0145 · CHECK ทุกตัวใน §3.1 ตรง (ชื่อ constraint: `campaign_step_channel_check` · `step_artifact_artifact_type_check` · `step_gate_gate_kind_check` · `content_post_url_scheme_check` http(s)) · `live_session_upsert(p_shop uuid, p_live_date date, p_start time, p_end time, p_peak int, p_note text, p_source text)` 1 signature ไม่มี overload · `content_post_metric.source` มี `'tiktok_api'` แล้ว (รองรับ §9.1 Q5) · `set_updated_at()` ไม่มีเงื่อนไข (trap #19 ใช้กับทุก UPDATE) · `campaign.anchor_date` **nullable** (ใช้ทำ "ไอเดียไม่มีวัน" ได้ — §3.2)

### 0.2 สิ่งที่**ต่าง**จากที่เขียนเช้า ✏️ (เรียงตามผลกระทบ)

| # | เดิมว่า | จริงคือ (6 ต.ค.) | กระทบ |
|---|---|---|---|
| Δ1 | `campaign_step` มี "วัน" · ไอเดีย = step "ยังไม่มีวัน" | **step ไม่มีคอลัมน์วัน** — `resolved_start = campaign.anchor_date + offset_start_days` คำนวณใน `v_campaign_board` · `offset_start_days` NOT NULL · `campaign_create_task` บังคับ `p_date` ⇒ ไอเดียไม่มีวันต้องทำผ่าน **wrapper campaign ที่ `anchor_date` null** (nullable จริง) | §2 · §3.2 · §3.5 · §5.1 pick · R18 ใหม่ |
| Δ2 | step 55 · artifact 65 · content_post 0 (หัวไฟล์ 0148) · backfill ต.ค. มี 6 กรณี | **step 50 · artifact 53 · content_post 10** · ต.ค. (≥ 1 ต.ค.) = **26 step ทุกแถว `status='todo'` · มี artifact ตัวเดียวพอดีทุก step** · artifact ต.ค. = 13 `draft_pending_review` (short_form_clip · ai_copywriter) + 13 `todo` (human) · **ไม่มี approved/done/blocked เลย** | §3.3 เหลือ 2 กรณี · R2 หมดไป |
| Δ3 | `clip_brief.hooks[]` "คาดว่าน้อยมาก" | **13 artifact × 2 hook = 26 แถว** (ทุกตัวที่มี hooks มี 2 ตัวพอดี) · `hook_type` free-form **11 ค่า** (reveal 7 · question 6 · contrast 4 · teaser 2 · number_list/visual_contrast/callback/visual_transition/countdown/curiosity/last_chance_true_only อย่างละ 1) — ตรงกับ CHECK 8 ค่าแค่ `question` · `chosen_hook_id` = **0 แถว** | §5.2 backfill ต้องมี `hook_type_raw` ไม่ให้ข้อมูลหาย |
| Δ4 | backfill `content_post.step_id` จาก `artifact_id` | content_post 10 แถว ทั้งหมด tiktok · 21–30 ก.ย. · **`artifact_id` null ทุกแถว** ⇒ UPDATE นั้น = 0 แถว **ตัดทิ้ง** (ไม่มี trap #19 บน content_post) | §5.3 · R7 |
| Δ5 | `v_content_post_t7.t7_post_id` | ไม่มีคอลัมน์นั้น — ใช้ `t7_captured_on is not null` (วันนี้ 1/10 โพสต์มี t7) | §5.9 |
| Δ6 | `campaign_pass_gate` "ไม่เคยใช้" | `step_gate` 12 แถว · **passed 4** (coo_stock_check 2 · pdpa_consent 2) · PK = `(step_id, gate_kind)` ไม่มี `id` | §3.1 · §5.5 upsert on conflict |
| Δ7 | `recommendation_log` เพิ่ม `response text` | มี `outcome_note text` + `acted_by uuid` อยู่แล้ว ⇒ ใช้ `outcome_note` เป็นคำตอบ ไม่เพิ่มคอลัมน์ซ้ำ | §5.10 |
| Δ8 | เลขว่างถัดไป 0160 (0158/0159 จองโดย RFM) | **บนดิสก์และ DB ว่างตั้งแต่ 0158** — ไฟล์ 0158/0159 ไม่มีใน git ref ใดเลย (จองในเอกสาร design เท่านั้น) | §7 ตั้งเลขตอนเขียนจริง |
| Δ9 | — | step ต.ค. 2 แถว (สตอรี่กินเจ · ออกพรรษา) **`channel` null** (CHECK ไม่มีค่าให้ใส่) · 11/13 artifact AI มี `[ต้องยืนยัน` ในข้อความแล้ว · live_session_log 3 คืน (29/30 ก.ย. · 2 ต.ค. · admin_ui · ไม่มี note) · reco 12 แถว (done/pending) · campaign 12 (scheduled 10 · active 1 · blocked 1) | §5.3 · §5.5 · §5.4 |
| Δ10 | ก่อน ต.ค. | 24 step: ไม่มี artifact 11 · 1 ตัว 5 · 2–4 ตัว 8 — โหมด "หลาย artifact/step" และ "ไม่มี artifact" **มีจริงเฉพาะก่อน ต.ค.** ⇒ R12 ยังต้องเทสต์ แม้หน้าใหม่กรองออก | R12 |

เลขที่เหลือ: `content_type` 5 code (announce/craft/customer/drive_live/knowledge) · `content_post_metric` 5 แถว · `campaign_step.status` ใช้จริงแค่ todo/scheduled/done/waiting_data (ไม่เคยมี active/blocked) · `content_post.status` active 8 / deleted 2 · `external_id`+`post_url` **NOT NULL** (ยืนยันว่า Q3 ต้อง "ไม่สร้างแถว" ไม่ใช่ "สร้างแถวว่าง")

## 1. คำตัดสินหลัก 3 ข้อ

### D1 · **ชิ้นงาน (Piece) = `analytics.campaign_step`** — สถานะชิ้นงานเก็บที่ step ไม่ใช่ artifact

| ทางเลือก | ผล |
|---|---|
| **เลือก: step = piece** · เพิ่ม `campaign_step.piece_status` (ชุด 9 ค่า) · artifact ลดชั้นเป็น "เอกสารของชิ้นงาน" (storyboard/แคปชัน) · โพสต์ผูก `content_post.step_id` (ใหม่) | ปฏิทิน · `campaign_reschedule_step` · `content_type_code` (0145/0150) · `goal_kpi_code` · `expected_host` · วัน/ช่วงเวลา **อยู่ที่ step หมดแล้ว** — สิ่งที่ brief เรียก "ชิ้นงาน 1 ชิ้นมีบ้านเดียว" คือแถว step |
| ตัด: artifact = piece | หน้าจอทุกหน้าต้อง join ขึ้นไปหา step เพื่อเอาวัน/ช่องทาง/ประเภท · step ที่สร้างผ่าน `campaign_create_task` โดยไม่ส่ง `p_artifact_type` **ไม่มี artifact เลย** ⇒ ชิ้นงานหาย · step ของ template (promo 5 step) มี artifact หลายตัว/step ⇒ "1 piece หลายสถานะ" คือบั๊กที่ brief §12 บ่นอยู่ |
| ตัด: ตาราง `content_piece` ใหม่ | ซ้ำกับเหตุผลที่ 0057 D1 ตัดไปแล้ว — ปฏิทินต้อง union 2 แหล่ง · ต้อง re-implement reschedule/content_type/goal_kpi ทั้งชุด |

**ราคาที่จ่าย**: step มี status 2 คอลัมน์ชั่วคราว (`status` เดิม 6 ค่าที่ `v_campaign_board.effective_status`/CampaignBoard อ่าน · `piece_status` ใหม่) — RPC ใหม่ต้อง **project** ค่าเดิมให้ทุกครั้ง (ตาราง §3.2) จนกว่าบอร์ด copilot เก่าจะเลิกใช้ · `step_artifact.status` (todo/draft_pending_review/draft/approved/done/blocked) **หยุดเป็นแหล่งสถานะ** — คงไว้ให้ `campaign_set_artifact_status`/บอร์ดเก่าทำงานต่อ แต่หน้าจอใหม่ห้ามอ่าน

### D2 · สถานะที่ "ระบบเปลี่ยนเอง" ไม่เก็บ — คำนวณใน view

`กำลังวัดผล` / `วัดผลแล้ว` / `ตกรอบวัด` ขึ้นกับวันไทย + snapshot [5,9] ⇒ เก็บถึง `posted` แล้วให้ `v_content_piece.effective_piece_status` ต่อให้ (ไม่ต้อง cron · ไม่มี state ค้างผิดวัน — บทเรียนเดียวกับ `v_content_post_t7` 0149) · `รออ่านผล` ของแคมเปญก็ derived เหมือนกัน

### D3 · "เจ้าของ" ใน DB ทั้งที่สิทธิ์ยังระดับเดียว (memory `role-single-level`)

วันนี้ทุก caller เข้า DB เป็น `service_role` ⇒ `crm_require_owner_admin` แยกคนไม่ได้ · **ทางที่ทำได้ตอนนี้**: RPC เปลี่ยนสถานะรับ `p_actor_role text check in ('owner','ai','system')` (✏️ เดิม 5 ค่ารวม assistant/host — §9.1 Q2: ยังไม่มีผู้ช่วย ⇒ 3 ค่า · เพิ่มเมื่อมีคนจริง) จาก server action (ค่ามาจาก `getDevRole()`/ผู้เรียก agent) แล้ว **DB ปฏิเสธ** `approve`/`verdict_confirm`/`risk gate passed` เมื่อ actor ≠ `owner` — ด่านนี้กันเส้นทาง AI (P6 ของ brief) ได้จริงเพราะ agent เรียกด้วย `'ai'` เสมอ · กันคนปลอม role ไม่ได้จนกว่า A2 — เขียนไว้ตรงๆ ใน event log (`actor_role` + `actor_uid` ที่วันนี้เป็น null) · ไม่ใส่ logic แยก role ในหน้าจอ (ตามมติเจ้าของ) แค่ส่ง role ที่แอปรู้อยู่แล้วลงไปเป็นข้อมูล

## 2. Mapping วัตถุ (brief §2) → ตารางจริง

| วัตถุ | วันนี้อยู่ที่ | ทำ |
|---|---|---|
| สัญญาณ (5 ชนิด) | ❌ ไม่มี — trend radar = md บน branch `trend-radar-feed` · คำถามไลฟ์/โมเมนต์ช่าง/บทเรียน ไม่มีที่เก็บ | ตาราง `content_signal` (§5.1) |
| คลิปอ้างอิง | ❌ | = `content_signal` kind `reference_clip` (ไม่แยกตาราง — คอลัมน์ตัวเลข/hook/fit nullable สำหรับ kind อื่น) |
| Hook | ⚠️ `step_artifact.clip_brief->'hooks'[]` jsonb `{id,line,hook_type}` free-form + `chosen_hook_id` — FK ไม่ได้ · rollup ไม่ได้ · ย้อนไปคลิปอ้างอิงไม่ได้ · ✅ จริง: 13 artifact × 2 hook · hook_type 11 ค่า free-form · chosen 0 (Δ3) | ตาราง `content_hook` (§5.2) · jsonb `hooks[]` เลิกเป็นแหล่งจริง |
| ไอเดีย | ⚠️ ไม่มีวัตถุแยก | = `campaign_step` ที่ `piece_status='idea'` — ✏️ "ยังไม่มีวัน" ทำได้ทางเดียว: step อยู่ใน wrapper campaign (`campaign_type='content_task'`) ที่ **`anchor_date = null`** + `offset_start_days = 0` ⇒ `v_campaign_board.resolved_start` เป็น null (Δ1) · วางแผน = ตั้ง `anchor_date` · ไม่สร้างตาราง idea เพราะ ✓ แล้วคือชิ้นงานแถวเดิม (P4 "ข้อมูลไม่หล่น" ได้ฟรี) |
| แคมเปญ | ✅ `campaign` (hypothesis · result_note · result_verdict 4 ค่าตรง brief) | ⚠️ ขาด metric/ฐาน/เกณฑ์ ระดับแคมเปญ + verdict AI เสนอ vs เจ้าของยืนยัน (§5.8) |
| ชิ้นงาน | ✅ `campaign_step` (channel · content_type_code · goal_kpi_code · start_time · title · origin · ✏️ **วัน = `anchor_date + offset_start_days` ใน view ไม่ใช่คอลัมน์** Δ1) + `step_artifact` (content_body · clip_brief · provenance) | ⚠️ ขาด piece_status/piece_kind/time_slot/customer_group/สมมติฐาน/ฐาน/เกณฑ์/footage/host คาด (§5.3) · channel CHECK ไม่มี `tiktok`(คลิป)/`instagram` |
| โพสต์ | ✅ `content_post` (platform · external_id NOT NULL · post_url http(s) NOT NULL · posted_at · content_type_code · artifact_id nullable · status) · จริง 10 แถว ก.ย. artifact_id null ทั้งหมด (Δ4) | ⚠️ ขาด `step_id` · `hook_id` · RPC ผูกทีหลัง · ✏️ LINE/สตอรี่ **ไม่สร้างแถวนี้** (§9.1 Q3) |
| ยอดโพสต์ | ✅ `content_post_metric` (save มี · sources[] · is_regression) + `v_content_entry_queue` 3 หน้าต่าง + `v_content_post_t7` | ⚠️ ขาด amend + ประวัติ (หนี้ P2.1) · "พลาดรอบ" = view |
| บันทึกหลังไลฟ์ | ✅ `live_session_log` (3 คืนจริง) + `live_session_upsert` + `v_live_night` + `live_night_snapshot`/`v_live_night_locked` (0146) | ⚠️ ขาด host · คำถามซ้ำ→สัญญาณ (§5.4) · ของประมูล = `note` เดิม |
| ผลลัพธ์/บทเรียน | ⚠️ ต่อโพสต์คำนวณได้จาก t7 · ต่อ hook/เดือน ไม่มี · บทเรียนไม่มีที่เก็บ | view rollup hook_type (§5.2) · ป้ายผลที่เจ้าของยืนยัน + บทเรียน → signal kind `insight` (§5.9) |
| ข้อเสนอ AI | ✅ `recommendation_log` (title · detail · owner_action · effort_minutes_est · related_campaign_id · acted_at/acted_by · **outcome_note**) 12 แถว — **ไม่มี RPC ตอบ · ไม่มีโค้ดแอปอ่าน** | เพิ่ม `respond_by`·`default_action`·`related_step_id`·`kind` + RPC (§5.10) · ✏️ คำตอบใช้ `outcome_note` เดิม (Δ7) |
| โฮสต์ | ❌ (`step_artifact.owner_role='host'` เป็น label ไม่ใช่คน) | ตาราง `live_host` (§5.4) |
| ตัวนับ LINE | ❌ | view (§6) ไม่ต้องมีตาราง |

## 3. สถานะ — brief §3 vs DB

### 3.1 ค่าที่ DB รองรับจริงวันนี้ (จากไฟล์ · re-verify ด้วย query ข้อ 2 ใน §0)

| คอลัมน์ | CHECK | ใครอ่าน/เขียน |
|---|---|---|
| `campaign.status` (0049) | `active / scheduled / blocked / waiting_data / done` | `v_campaign_board` · CampaignBoard |
| `campaign_step.status` (0049) | `todo / scheduled / active / blocked / waiting_data / done` | `effective_status` ทับด้วย blocked/waiting_data จาก gate/RFM |
| `step_artifact.status` (0057) | `todo / draft_pending_review / draft / approved / done / blocked` | `campaign_set_artifact_status` · `campaign_ai_draft_artifact`→draft_pending_review · `campaign_set_artifact_content` todo→draft · **บอร์ด/ปฏิทิน/หน้า step เปลี่ยนคนละแบบ** (ต้นเหตุ brief §12 แถว 1) |
| `step_gate.status` (0049) | `pending / passed / blocked / na` · gate_kind 5 ค่าโดเมนโปรโม ✅ | `campaign_pass_gate` · ✏️ จริง: 12 แถว **passed 4** (coo_stock_check/pdpa_consent) ไม่ใช่ "ไม่เคยใช้" · PK `(step_id, gate_kind)` ไม่มี `id` (Δ6) |
| `content_post.status` (0148) | `active / deleted / private` ✅ ใช้จริง active 8 · deleted 2 | คิวกรอกยอด · `content_post_set_status` · `content_post_update_type` (0151/0152) |
| `recommendation_log.owner_action` (0101) | `pending / done / rejected / expired` | view นับ >14 วัน = expired เฉพาะตอนคำนวณ |
| `campaign.result_verdict` (0101) | `validated / invalidated / inconclusive / not_measured` | ไม่มีโค้ดอ่าน |

⇒ ไม่มีคอลัมน์ไหนใน 3 ตัวแรกที่ขยาย CHECK แล้วได้ 9 สถานะโดยไม่เปลี่ยนความหมายค่าเดิมที่ของเก่าอ่านอยู่ ⇒ **เพิ่มคอลัมน์ใหม่** แทนขยาย CHECK

### 3.2 `campaign_step.piece_status` + สถานะข้าง + projection ไปค่าเดิม

| brief | เก็บ | projection → `status` เดิม |
|---|---|---|
| ไอเดีย | `idea` · ✏️ "ยังไม่มีวัน" = wrapper campaign `anchor_date` null (Δ1) ⇒ `resolved_start`/`days_until` null — บอร์ดเก่าต้องไม่พัง (R18) | `todo` |
| วางแผนแล้ว | `planned` | `scheduled` |
| AI ร่าง | `drafting` | `active` |
| รอตรวจ | `in_review` | `active` |
| อนุมัติแล้ว | `approved` | `active` |
| ผลิตแล้ว | `produced` · ✏️ ข้ามได้ (`approved → posted` ตรง) เมื่อ `piece_kind in ('line_message','story')` หรือ `footage_status <> 'needs_shoot'` (§9.1 Q3) | `active` |
| โพสต์แล้ว | `posted` · ✏️ kind มี URL ต้องมีแถว `content_post.step_id` · kind ไม่มี URL (LINE/สตอรี่) **ไม่สร้าง content_post** — เวลาโพสต์อยู่ใน event `post` (§9.1 Q3) | `done` |
| กำลังวัดผล · วัดผลแล้ว · ตกรอบวัด | **ไม่เก็บ** — `v_content_piece.effective_piece_status` จาก posted + อายุวันไทย + `v_content_post_t7` | `done` |
| ⏸ รอเงื่อนไข | `hold_reason text` ซ้อนบน piece_status (กลับมาแล้วรู้ว่าค้างขั้นไหน) | `blocked` + `blocked_reason` |
| ↷ เลื่อน | **ไม่ใช่สถานะ** = `campaign_reschedule_step` เดิม + event `defer` (วันเดิม→ใหม่) | ไม่เปลี่ยน |
| ✕ ยกเลิก | `cancelled` (ค่าที่ 8) + reason ใน event | `blocked` + reason `ยกเลิก: …` |

CHECK: `piece_status in ('idea','planned','drafting','in_review','approved','produced','posted','cancelled')` · **nullable** — แถวเก่าที่ไม่ backfill = null = "ก่อน workflow ใหม่" ไม่ใช่สถานะ · view/inbox กรอง `piece_status is not null`

### 3.3 Backfill ครั้งเดียว (trap #19: ปิด `trg_campaign_step_updated_at` คร่อม UPDATE · where แคบ · md5(updated_at) ก่อน/หลังเท่าเดิม)

ขอบเขต (✏️ Δ1/Δ2 · §9.1 Q4 "ข้ามก่อน 1 ต.ค." ยืนยัน): `where c.anchor_date + s.offset_start_days >= date '2026-10-01'` (join campaign — `resolved_start` เป็นคอลัมน์ view ไม่ใช่ของ step) · เก่ากว่านั้น **ปล่อย null** · ✅ ของจริง = **26 step** ทุกแถว `status='todo'` · artifact 1 ตัวพอดี/step ⇒ ตารางเหลือ 2 กรณี + ด่านกัน:

| artifact.status (ตัวเดียว/step — ของจริง) | → piece_status | จำนวนจริง 6 ต.ค. |
|---|---|---|
| `todo` (human · fb_post 4 · teaser_image 3 · short_form_clip 3 · broadcast_script_line 2 · parcel_card 1) | `planned` | 13 |
| `draft_pending_review` (ai_copywriter · short_form_clip ทั้งหมด) | `in_review` + `drafted_by_ai = true` | 13 |
| อื่น (`draft`/`approved`/`done`/`blocked`/ไม่มี artifact/หลาย artifact) | **raise** — ไม่มีในขอบเขตวันนี้ · โผล่ตอน apply = seed เปลี่ยนหลัง 6 ต.ค. ต้องกลับมาตัดสินใหม่ ไม่เดา | 0 |

~~`done` ไม่มีลิงก์ → `produced`~~ · ~~`blocked` → hold~~ — ตัดออก (ไม่มีแถวจริง · R2 หมดไป) · UPDATE เดียวบน `campaign_step` 26 แถว: ปิด `trg_campaign_step_updated_at` คร่อม · `where id = any(รายการที่ dry-run พิมพ์)` ไม่ใช้ `where piece_status is null` (= ทุกแถว) · assert `md5(string_agg(updated_at))` เท่าเดิม · ✅ 11/13 ชิ้น in_review มี `[ต้องยืนยัน` อยู่แล้ว ⇒ รัน `content_confirm_extract` ให้ 13 ชิ้นนี้ใน migration เดียวกัน ไม่งั้น approve ชั้น 2 (regex) บล็อกโดยไม่มีรายการให้ตอบ

dry-run ต้องพิมพ์ `step_id · title · ค่าที่จะได้` ทุกแถว (26) ให้ Tech Lead ดูก่อน `--commit`

### 3.4 วัตถุอื่น

| วัตถุ | brief | ทำ |
|---|---|---|
| สัญญาณ | ใหม่/หยิบแล้ว/ไม่ใช้/เก็บไว้ก่อน | `content_signal.status in ('new','picked','rejected','deferred')` + `status_reason` + `review_on` (deferred บังคับ) + `picked_step_id` |
| แคมเปญ | ร่าง/กำลังทำ/รออ่านผล/ปิดแล้ว | **ไม่ขยาย CHECK**: ร่าง=`scheduled` · กำลังทำ=`active` · ปิดแล้ว=`done` · **รออ่านผล = derived** (piece ที่ไม่ cancelled ทุกตัว posted แล้ว แต่ยังไม่ measured ครบ) · blocked/waiting_data = "กำลังทำ + ธง" |
| ข้อเสนอ AI | รอตอบ/ตอบแล้ว/ปฏิเสธ/หมดเวลา | 4 ค่าตรงแล้ว · เพิ่ม `respond_by` ให้ view นับ expired จากวันประกาศแทน 14 วัน (เฉพาะแถวที่มี) |

### 3.5 กติกาเปลี่ยนสถานะ — บังคับที่ DB · มีอะไรแล้ว / ขาดอะไร

| กติกา (brief §3.1/§4) | RPC ที่มีวันนี้ | ขาด → RPC ใหม่ `content_piece_advance(p_shop_id, p_step_id, p_to text, p_actor_role text, p_reason text default null, p_review_seconds int default null) returns jsonb` |
|---|---|---|
| ไอเดีย→วางแผน ต้องมี สมมติฐาน+ฐาน+เกณฑ์ | ❌ (`campaign_create_task` ไม่รู้จัก) | raise ถ้า `hypothesis`/`baseline_value`/`pass_threshold` ว่าง (trap #13: เช็ค `not (x between …)` ไม่ใช่ `is null` เพราะ 0 คือค่าจริง) + ต้องมีวัน: ✏️ step ไม่มีคอลัมน์วัน (Δ1) ⇒ `content_piece_set_plan` รับ `p_date` แล้ว **set `campaign.anchor_date`** ของ wrapper (content_task 1 step — ทางเดียวกับที่ `campaign_reschedule_step` ทำอยู่) · step ใน campaign หลาย step มี anchor อยู่แล้ว ⇒ ตั้ง offset แทน · advance `planned` raise ถ้า anchor ยัง null |
| AI ร่าง→รอตรวจ ต้องมี hook ≥2 ประเภต่างกัน + shot list | ⚠️ `campaign_ai_draft_artifact` ตั้ง artifact=draft_pending_review แต่ไม่เช็ค hook | raise ถ้า `count(distinct hook_type) from content_hook where step_id=… < 2` หรือ `jsonb_array_length(clip_brief->'shots') = 0` (เฉพาะ piece_kind คลิป) |
| รอตรวจ→อนุมัติ **เจ้าของเท่านั้น** + 3 ด่านครบ + ไม่มี `[ต้องยืนยัน]` | ⚠️ `campaign_set_artifact_status('approved')` ใครก็เรียกได้ ไม่เช็ค gate | raise ถ้า `p_actor_role <> 'owner'` · ถ้า gate `fact_check`/`brand_rule`/`risk_owner` ตัวใดไม่ใช่ `passed`/`na` · ถ้า `content_confirm_item` ค้าง หรือ regex `\[ต้องยืนยัน` ยังพบใน `content_body`/`clip_brief::text` (ตรวจซ้ำ 2 ชั้น — ของจริงอยู่ในข้อความ) · บันทึก `review_seconds` ลง event (แสดง <60 วิ ไม่บล็อก) |
| รอตรวจ→ส่งกลับ ต้องมีเหตุผล | ❌ | `p_to='drafting'` + `p_reason` ว่าง → raise |
| อนุมัติ→ผลิตแล้ว เฉพาะ approved | ❌ | from ∉ {approved} → raise · รับ `footage_url`/`shoot_note` ผ่าน RPC แยก `content_piece_set_footage` (ไม่บังคับ) |
| ผลิตแล้ว→โพสต์แล้ว = วางลิงก์ + hook จริง | ⚠️ `content_post_upsert` วางลิงก์ได้แต่ไม่แตะ step/hook | ✏️ 2 ทางตาม `piece_kind` (§9.1 Q3): **(ก)** kind มี URL (`short_clip`/`live_cut`/`ig_fb_post`) → RPC แยก **`content_piece_post(p_shop_id, p_step_id, p_platform, p_external_id, p_post_url, p_posted_at, p_hook_id uuid, p_hook_other text, p_actor_role)`** = เรียก `content_post_upsert` เดิม (ไม่เขียนซ้ำ · `external_id`/`post_url` NOT NULL จริง) → set `content_post.step_id/hook_id` → piece_status `posted` ใน transaction เดียว **(ข)** kind ไม่มี URL (`line_message`/`story`) → `content_piece_advance(p_to='posted')` **ไม่สร้างแถว content_post** · event `post` เก็บ `payload.posted_at` · ไม่เข้าคิวยอด/ผลต่อโพสต์ (UI "ไม่มีการวัดผลรายชิ้น") · from ∉ {approved, produced} → raise ทั้งสองทาง · `content_piece_advance('posted')` บน kind มี URL → raise "ใช้ content_piece_post" |
| ย้อนทีละขั้น · เจ้าของเท่านั้น · อนุมัติแล้วห้ามหลุดเป็นร่างโดยไม่ตั้งใจ | ❌ (วันนี้ยกเลิก "เสร็จ" บนบอร์ด → artifact ตกเป็น draft) | ตารางลำดับใน body: `p_to` ต้องเป็นขั้นถัดไป **หรือ** ขั้นก่อนหน้า 1 ขั้นเท่านั้น (`posted` ย้อนไม่ได้ — ต้องลบโพสต์ผ่าน `content_post_set_status('deleted')` ก่อน) · ย้อนจาก approved/produced ต้อง `p_actor_role='owner'` + `p_reason` · ทุกครั้ง insert `content_piece_event` |
| hold / resume / cancel | ❌ | `p_to in ('hold','resume','cancel')` ใน RPC เดียวกัน · hold/cancel บังคับ reason · cancel จาก posted → raise |
| AI ห้ามแทรกปฏิทิน | ✅ โดยกติกา task (ไม่แตะ DB) | เพิ่มด่าน: `p_actor_role='ai'` ทำได้แค่ `drafting`/`in_review` และสร้าง step ได้เฉพาะ `piece_status='idea'` (ผ่าน `content_signal_pick`) · ✏️ ค่าที่รับ = `owner`/`ai`/`system` เท่านั้น (§9.1 Q2 · `system` = backfill/migration/cron) — ค่าอื่น raise 22023 |
| คิวรออนุมัติ >10 → AI หยุดเสนอ | — | ไม่บังคับที่ DB (เป็น WIP limit ของ process · view นับให้ inbox แสดง) |

ทำไม RPC เดียวรับ `p_to` แทน 8 ฟังก์ชัน: กติกา "ย้อนได้ทีละขั้น" ต้องรู้ตารางลำดับที่เดียว · ถ้าแยกฟังก์ชัน การย้อน/ข้ามจะหลุดจากตารางเดียวกันง่าย · แลกกับ body ยาวขึ้น (~150 บรรทัด) — ยอมรับ · ยกเว้น `content_piece_post` แยกเพราะพารามิเตอร์คนละชุด · **ทุก RPC**: security definer · `search_path = public, pg_temp` · `crm_require_owner_admin` · `for update` แถว step ที่ `shop_id` ตรงตั้งแต่ where (0150 L2) · revoke public/anon/authenticated · grant service_role · คืน jsonb ไม่ใช่ `returns table` (trap #12)

**`content_piece_event`** (append-only · ไม่มี update/delete grant): `id · shop_id · step_id · event_kind (advance/revert/hold/resume/defer/cancel/post/gate/confirm) · from_status · to_status · reason · actor_role · actor_uid (null จนกว่า A2) · review_seconds · payload jsonb (วันเดิม→ใหม่ · post_id · gate_kind) · created_at` — ตอบ "ใครอนุมัติ เมื่อไหร่ ใช้เวลาอ่านเท่าไร" + undo ทีละขั้น + เหตุผลส่งกลับ/ยกเลิก (เหตุผลคือข้อมูล) ในตารางเดียว · ทางเลือกที่ตัด: ใส่ `approved_at/approved_by/sent_back_reason` เป็นคอลัมน์บน step — เก็บได้แค่ครั้งล่าสุด ส่งกลับ 2 รอบแล้วเหตุผลแรกหาย

## 4. หน้าจอ A–K × ฟิลด์ที่ต้องใช้ (✅ มี · ⚠️ มีแต่ต้องปรับ · ❌ ไม่มี)

| หน้า | ฟิลด์/ข้อมูล | สถานะ | ที่มา (ตาราง.คอลัมน์ · view · RPC) |
|---|---|---|---|
| **A inbox** กอง 1 วันนี้ต้องโพสต์ | piece วันนี้ที่ approved/produced + ฉบับคัดลอก + เตือนค้างลิงก์ | ⚠️ | `v_content_piece` (ใหม่: step + artifact clip + hook A/B + post + effective status) กรอง `resolved_start <= วันไทย and piece_status in (approved,produced)` · ฉบับ = `step_artifact.content_body`/`clip_brief` ✅ |
| A กอง 2 รออนุมัติ | การ์ด: ชนิด·วัน·hook A/B·ผล 3 ด่าน·ปุ่มอนุมัติ/แก้/ส่งกลับ | ❌ | `piece_status='in_review'` + `content_hook` + `step_gate` (kind ใหม่ 3 ตัว) + RPC `content_piece_advance` · ตัวนับ >10 = `count(*)` ใน view |
| A กอง 3 ไอเดียรอคัด | จำนวน idea | ❌ | `piece_status='idea'` |
| A กอง 4 คำถาม AI | หัวข้อ·นาที·ค่าเริ่มต้น·วันหมดเขต·ปุ่มตอบ | ⚠️ | `recommendation_log` + `respond_by`/`default_action`/`response` ใหม่ + RPC `recommendation_respond` |
| A สรุปสัปดาห์ 5 บรรทัด · แถบสถานะสัปดาห์ · นัดถ่าย | — | ⚠️ | สรุป = ไฟล์ weekly-brief (md) อ่านจาก GitHub แบบ radar — **ไม่เข้า DB รอบนี้** · แถบสถานะ = นับจาก `v_content_piece` · นัดถ่าย = `campaign_step.shoot_date` ❌ (เพิ่ม nullable date) |
| **B Research** รายการ/กรอง | kind·source·seen_on·url·hook·hook_type·mass·fit·status·segment | ❌ | `content_signal` + `v_content_signal` (mass_ratio · save_rate · unripe) |
| B เทรนด์รายวัน (AI) | มุม ≤3 · ตัดทิ้ง · ความมั่นใจ · ปุ่มหยิบ | ⚠️ | แสดงจาก md บน branch `trend-radar-feed` (ของเดิม `/marketing/trend-radar`) · "หยิบเข้ากล่อง" = RPC `content_signal_capture(kind='trend', radar_date, angle_idx, url, summary, confidence)` — **task รายวันยังไม่แตะ DB** (กติกาเดิมคง) |
| B รายละเอียดสัญญาณ + เส้นทาง | สัญญาณ→ไอเดีย→ชิ้นงาน→ผล | ❌ | `content_signal.picked_step_id` → `v_content_piece` → `content_post` |
| B คลัง hook | ประเภท×ใช้แล้ว×เหนือ/ปกติ/ต่ำ×n/4 · hook ของคนอื่น | ❌ | `content_hook` + `v_content_hook_type_rollup` (§5.2) |
| B ฟอร์มแปะลิงก์ | 4 บังคับ · ค่าย่อ+ประมาณ · ลิงก์ซ้ำ · ใครเห็น | ❌ | `content_signal_capture` raise `23505`+id เดิมเมื่อ `url_norm` ซ้ำ · ค่าย่อ parse ฝั่งแอป → bigint + `metrics_approx` |
| **C Triage** | ไอเดีย+สมมติฐาน+ฐาน+เกณฑ์+hook ตั้งต้น 2+ต้องถ่าย+สัญญาณต้นทาง · ✓/✗/เลื่อน · โควตา · ช่องว่าง · คิวอนุมัติ · คำเตือนเกณฑ์แคบ | ❌ | `campaign_step` คอลัมน์ใหม่ §5.3 · `content_hook` (origin ours · step_id · label null = ตั้งต้น) · ✓ = `content_piece_advance('planned')` + `campaign_reschedule_step` · ✗ = `content_signal` status rejected + step cancelled · โควตา = view §6 · คำเตือน = `baseline_spread` vs `pass_threshold` (§6) |
| **D Calendar** | การ์ด: ชนิด·ช่อง·สี·ช่วงเวลา·สถานะ·ธง·แคมเปญ · โฮสต์คาด/คืน · เทศกาล · เลื่อน · LINE 4/28 · หลายวันข้ามเดือน | ⚠️ | สี/ช่อง/วัน ✅ (`v_campaign_board`) · `piece_kind`·`time_slot`·`piece_status`·ธง (`footage_status`,`hold_reason`,confirm ค้าง) ❌ · โฮสต์คาด `campaign_step.expected_host_id` ❌ · เทศกาล ✅ `campaign_calendar` (0034) · เลื่อน ✅ `campaign_reschedule_step` · หลายวัน ✅ `resolved_start/resolved_end` (บั๊กข้ามเดือนอยู่ฝั่งแอป ไม่ใช่ schema) |
| **E Campaign** | รายการ+สถานะ+x/y+คำตัดสิน · สมมติฐาน·ตัวชี้วัด·ฐาน·เกณฑ์ · timeline · verdict AI เสนอ/เจ้าของยืนยัน · บทเรียน · คำเตือนเกณฑ์แคบ | ⚠️ | `campaign.hypothesis/result_verdict/result_note` ✅ · `metric_code/baseline_value/baseline_as_of/pass_threshold/baseline_spread` ❌ · `result_verdict_proposed`/`result_verdict_confirmed_at/_by_role` ❌ · x/y = view · สถานะ map §3.4 · รออ่านผล derived |
| **F Piece** | หัว·stepper·ป้าย AI/คน·เส้นทางต้นทาง·storyboard ติ๊ก·hook A/B ชี้คลิปอ้างอิง·แคปชัน/CTA·shot list·3 ด่าน·ธงยืนยัน·ปุ่มตามสถานะ·ผลลัพธ์+โฮสต์ | ⚠️ | storyboard/ติ๊ก ✅ (`clip_brief.segments/shots` + `campaign_toggle_clip_shot`) · ป้าย AI ✅ (`generated_by`,`human_edited`) · stepper/ปุ่ม = `piece_status` ❌ · hook A/B = `content_hook.label('A','B')` + `source_signal_id` ❌ · 3 ด่าน = `step_gate` kind ใหม่ + `detail` ❌ · ธง = `content_confirm_item` ❌ · ผลลัพธ์ = `content_post`→`v_content_post_t7` ✅ + host จาก `live_session_log` join `posted_date_th` ⚠️ (host ❌) |
| **G Shoot** | shot list รวมเฉพาะ approved · กลุ่มตามสถานที่ · เวลารวม · ติ๊ก · เลื่อนต่อชิ้น · จบรอบ | ⚠️ | shots ✅ · `piece_status='approved' and footage_status='needs_shoot'` ❌ · `shoot_location` ❌ (step) · เวลารวม = `clip_brief.segments[].duration_sec` ✅ / `shoot_minutes_est` ❌ (step, AI เติม) · จบรอบ = advance `produced` ทีละชิ้น (ไม่มี entity "รอบถ่าย" — YAGNI) |
| **H Posted sheet** | ลิงก์จริง·hook จริง A/B/อื่น·นอกแผน·ผูกทีหลัง | ⚠️ | `content_piece_post` ❌ · นอกแผน ✅ `content_post_upsert` (artifact_id null) · ผูกทีหลัง = RPC `content_post_link_step` ❌ · ตรวจลิงก์ ✅ CHECK http(s) + canonicalize ฝั่งแอป (`lib/marketing/tiktok-link.ts`) |
| **I Live log** | เริ่ม·เลิก·peak·โฮสต์เลือก/เพิ่ม·ประมูล·คำถามซ้ำ→สัญญาณ · คืนที่ค้าง 7 วัน | ⚠️ | เริ่ม/เลิก/peak/note ✅ `live_session_upsert` · host ❌ `live_host` + `live_session_log.host_id` · คำถาม ❌ → `content_signal` kind live_question (RPC v2 §5.4) · คืนค้าง = `generate_series` 7 วัน left join log (view) |
| **J Metrics** | คิววันนี้ x/y · 5 ช่อง · แก้ย้อนหลัง+เหตุผล+ประวัติ · พลาดรอบ · "บันทึก = ไม่มี/0" | ⚠️ | คิว ✅ `v_content_entry_queue` · กรอก ✅ `content_post_metric_upsert` · แก้ย้อนหลัง ❌ `content_post_metric_amend` + `content_post_metric_amend_log` (§5.6) · พลาดรอบ ❌ view `v_content_post_missed_window` · null≠0 ✅ (DB ห้าม coalesce อยู่แล้ว) |
| **K Result** ต่อโพสต์ | ยอดวันที่ 7 · save/share rate vs median 10 โพสต์ · ป้าย · hook จริง · โฮสต์ · ลิงก์ชิ้นงาน · ยืนยัน+บทเรียน | ⚠️ | rate ✅ `v_content_post_t7` · median/ป้าย = view ใหม่ `v_content_post_result` (§6) · hook ❌ `content_post.hook_id` · host ❌ · ยืนยัน ❌ `content_post.result_label_override/result_confirmed_at` + RPC `content_post_verdict_confirm` → signal insight |
| K ต่อ hook / ต่อแคมเปญ / สรุปสัปดาห์ / สัดส่วนเดือนหน้า | — | ❌/⚠️ | rollup ❌ view §5.2 · แคมเปญ → E · สรุปสัปดาห์ = md (ไม่เข้า DB รอบนี้) + ข้อเสนอใน `recommendation_log` · สัดส่วน ❌ `content_month_mix` (§5.11 ทีหลัง) |

## 5. ของใหม่ที่ต้องสร้าง (โครง — DDL เต็มรอบถัดไป) · ทุกตาราง: schema `analytics` · `shop_id` denormalized · RLS on + policy select แบบ 0146 · **grant select/execute เฉพาะ `service_role`** · เขียนผ่าน RPC security definer เท่านั้น

### 5.1 `content_signal` (กล่องสัญญาณ · รวมคลิปอ้างอิง)

`id · shop_id · kind check('reference_clip','trend','live_question','craft_moment','insight') · source check('owner','host','craftsman','ai_radar','ai_web','system') (✏️ ตัด assistant — §9.1 Q2 · host/craftsman = ที่มาของสัญญาณที่เจ้าของบันทึกแทน ไม่ใช่ actor) · seen_on date · url text · url_norm text · summary text (1 บรรทัด บังคับ) · hook_text · hook_type (8 ค่า §5.2 CHECK เดียวกัน) · platform · account · account_followers bigint · views/likes/comments/saves/shares bigint · metrics_approx boolean default false · metrics_seen_on date · posted_on date · format check(9 ค่าตาม v1 §2.1) · duration_sec int · customer_group check('jewelry_925','silver_bar','other') · why_it_works · fit_3j check('usable','adapt','unusable') · fit_rule_hit text · status check('new','picked','rejected','deferred') default new · status_reason · review_on date · picked_step_id uuid → campaign_step on delete set null · origin_live_date date (live_question) · origin_post_id uuid → content_post (insight) · origin_campaign_id · radar_date date + radar_angle_idx int (trend) · confidence check('fact','observation','hypothesis') · created_by_role · audit`

- **กันลิงก์ซ้ำ**: `url_norm` = RPC ทำ lower(host) + ตัด query/utm/trailing slash (ฝั่งแอป canonicalize TikTok ก่อนด้วย `tiktok-link.ts` — 2 ชั้นคนละหน้าที่: แอปรู้รูปแบบ TikTok · DB กันซ้ำแบบไม่พึ่งแอป) · `unique (shop_id, url_norm) where url_norm is not null` · RPC `content_signal_capture` จับ 23505 แล้ว raise ข้อความไทย + id เดิมใน detail ให้ UI พาไป
- **mass ratio ไม่เก็บ**: `v_content_signal` คำนวณ `views::numeric / nullif(account_followers,0)` · `mass_label` (mass ≥2 · normal 0.5–2 · low <0.5 · unknown เมื่อ followers null/0) · `is_unripe = seen_on - posted_on < 3` · `save_rate` · เส้น 2.0 เป็น [Hypothesis] → ใส่เป็นค่าใน view ที่เดียว ไม่ใช่ CHECK
- ค่าย่อ "16K" → bigint ฝั่ง server action + `metrics_approx=true` · DB รับเฉพาะตัวเลข (CHECK ≥0 · `not (x > 1e10)` กัน NaN trap #4)
- CHECK ต่อ kind: `reference_clip` ต้องมี url+hook_text · `live_question` ต้องมี origin_live_date · `insight` ต้องมี origin_post_id หรือ origin_campaign_id · trend ต้องมี radar_date (trap #14: RPC ส่งทุกคอลัมน์ที่ CHECK อ้างไปกับ insert)
- `unique (shop_id, origin_live_date, summary) where kind='live_question'` — กัน log ส่งคำถามซ้ำตอน re-submit คืนเดิม
- ไม่เก็บ: screenshot · สคริปต์เต็ม · ชื่อคน (brief v1 §2.1) — verify ตรวจชื่อคอลัมน์ไม่มี `name|phone|email` แบบ RFM T11
- RPC: `content_signal_capture(... ) returns uuid` · `content_signal_set_status(p_id, p_status, p_reason, p_review_on, p_actor_role)` · `content_signal_pick(p_id, p_title, p_customer_group, p_channel, p_piece_kind, p_actor_role) returns step_id` = สร้าง campaign wrapper `content_task` **`anchor_date = null`** + step `offset_start_days = 0` · `status='todo'` · `piece_status='idea'` (✏️ Δ1: เรียก `campaign_create_task` ต่อ**ไม่ได้**เพราะบังคับ `p_date` และ set anchor — insert เองโดยลอก validation + `auth.uid()` จาก body เดิม · ไม่แก้ signature เดิม trap #1) + set signal picked/picked_step_id ใน transaction เดียว · "ไม่ใช้" บนสัญญาณที่ picked แล้ว → raise พร้อมรายชื่อ step ที่กระทบ (UI ให้ยืนยันแล้วส่ง `p_force`)

### 5.2 `content_hook` — **แยกตาราง** (ไม่ฝังใน clip_brief ต่อ)

`id · shop_id · text · hook_type check('question','fact','warning','process','before_after','customer_voice','direct_live','story') · origin check('reference','ours') · source_signal_id uuid → content_signal (ของเขาที่ถอดโครง) · step_id uuid → campaign_step (ของเรา) · label check('A','B') null (ตั้งต้นใน triage = null) · generated_by check('ai','human') · audit`

| ทางเลือก | ตัด/เลือก | เหตุผล |
|---|---|---|
| **ตาราง** | **เลือก** | brief ต้อง (1) `content_post.hook_id` FK (2) rollup ต่อ hook_type ข้ามโพสต์ (3) ย้อนไปคลิปอ้างอิง (4) คลัง hook ของคนอื่นด้วย — jsonb ทำ 1/2 ไม่ได้ทำ 3/4 ยาก |
| ฝัง jsonb ต่อ + `content_post.hook_json` | ตัด | fact ซ้ำ 2 ชั้น · นับต่อประเภทต้อง `jsonb_array_elements` ทุก artifact ทุกครั้ง · hook_type ใน jsonb เป็น free-form (TS บอกเอง) บังคับ 8 ค่าไม่ได้ |

- `clip_brief.hooks[]`/`chosen_hook_id`: **คงไว้อ่านได้ แต่ RPC ใหม่ไม่เขียน** · backfill ✏️ (Δ3 ของจริง **13 artifact × 2 = 26 แถว** ไม่ใช่ "น้อยมาก"): insert `content_hook` origin ours · `step_id` = artifact.step_id · `label` = ตำแหน่งใน array (ตัวที่ 1 → `A` · ตัวที่ 2 → `B` — ทุก artifact มี 2 ตัวพอดี ⇒ กำหนดได้โดยไม่เดา · เจอ ≠2 ให้ label null) · `hook_type` = ค่าเดิมเมื่ออยู่ใน 8 ค่า (จริงมีแค่ `question` 6 แถว) ไม่งั้น **null** (ห้ามเดา — reveal/contrast/teaser ฯลฯ 20 แถว ให้เจ้าของ/AI ติดป้ายทีหลัง) · เพิ่มคอลัมน์ **`hook_type_raw text`** (ค่า free-form เดิม) + **`legacy_json_id text`** (`hooks[].id` เดิม — `chosen_hook_id` ใน jsonb ยังชี้กลับได้ แม้วันนี้ 0 แถว) ⇒ ไม่มีข้อมูลหาย · `generated_by='ai'` ตาม artifact ai_copywriter · ด่าน "≥2 ประเภทต่างกัน"/rollup ต้อง**ไม่นับ null** (R19) · ไม่ขึ้น `v` ของ clip_brief เพราะไม่เปลี่ยนความหมาย field ที่ยังอ่าน (design 0057 §5)
- `campaign_ai_draft_artifact` **ไม่แก้** (signature เดิม) — AI เขียน hook ผ่าน `content_hook_upsert(p_step_id, p_label, p_text, p_hook_type, p_source_signal_id, p_actor_role)` แยก · กติกา A/B คนละประเภท = CHECK ใน RPC (`unique (step_id, label) where label is not null` + raise ถ้า type ซ้ำกับอีกตัว)
- `content_post.hook_id uuid → content_hook on delete set null` + `hook_other_text` (เลือก "อื่น" = RPC สร้างแถว content_hook origin ours label null ให้ทันที แล้ว FK — ไม่เก็บ text ลอยในโพสต์)
- **rollup** `v_content_hook_type_rollup`: ต่อ (shop, hook_type): `posts_n` (โพสต์ที่มี t7 snapshot) · `above_n/normal_n/below_n` (เทียบ `save_rate` กับ median 10 โพสต์ล่าสุดก่อนโพสต์นั้น — คำนวณใน `v_content_post_result` §6) · `verdict = case when posts_n < 4 then null else … end` · คอลัมน์ `host_mix` (จำนวนโฮสต์ต่างกันในชุด — ให้ UI เขียน "คืนที่โฮสต์ต่างกันห้ามเทียบตรงๆ") · ไม่มีกราฟ/ไม่มี A/B engine

### 5.3 `campaign_step` — คอลัมน์ใหม่ (nullable ล้วน · additive)

| คอลัมน์ | ชนิด/CHECK | ใช้ที่ |
|---|---|---|
| `piece_status` | §3.2 (8 ค่า · nullable) | ทุกหน้า |
| `hold_reason` | text | D/F/inbox ธง |
| `piece_kind` | check('short_clip','live_cut','ig_fb_post','line_message','story') | F layout · G (ต้องถ่ายไหม) · artifact_type ที่สร้างให้: short_clip→short_form_clip · live_cut→live_highlight_clip · ig_fb_post→fb_post · line_message→broadcast_script_line · story→**ต้องเพิ่ม `'story'` ใน artifact_type CHECK** (⚠️ แก้ CHECK เดิม drop+add ชื่อจริงจาก pg_constraint) |
| `time_slot` | check('morning','afternoon','before_live','during_live') | D การ์ด · `start_time` เดิมคงไว้สำหรับเวลาเป๊ะ |
| `customer_group` | check('jewelry_925','silver_bar') | C/F — **คนละอย่างกับ `audience_segment`** (CRM segment · มีค่า silver_bar อยู่แล้วแต่ความหมาย = ผู้ซื้อเงินแท่งใน RFM) ห้ามยุบรวม |
| `hypothesis` · `metric_code` check('save_rate','share_rate','peak_viewers','line_reply_count','none') · `baseline_value numeric` · `baseline_as_of date` · `baseline_note` · `pass_threshold numeric` · `pass_op check('>=','<=')` · `baseline_spread numeric` | สมมติฐานระดับชิ้นงาน (F6 ของ v1: snapshot ฐาน ณ วันตั้ง) · `baseline_spread` = ช่วงแกว่งที่ AI วัดตอนตั้ง (เก็บเพื่อให้คำเตือน "เกณฑ์แคบกว่าช่วงแกว่ง" ทำซ้ำได้ วันหน้าไม่เปลี่ยนเอง) · `metric_code='none'` = evergreen ไม่วัด (Triage ใบสำรอง) | C/E/F/K |
| `footage_status` check('needs_shoot','has_footage','shot') · `footage_url` text (http(s) CHECK เดียวกับ post_url) · `shoot_note` · `shoot_location` check('factory','product_table','host_cam','other') · `shoot_minutes_est` int · `shoot_date` date | G/D ธง "ต้องถ่าย/มีภาพแล้ว" · ลิงก์ไฟล์ (Q3 เก็บนอกระบบ) | G |
| `expected_host_id uuid → live_host` | โฮสต์ที่คาดว่าไลฟ์คืนนั้น | D แถบบน |
| `drafted_by_ai boolean` | ป้าย "ร่างโดย AI" ระดับชิ้นงาน (รอบ 2 ข้อ 5.3 แยกจากสถานะ) — artifact มี `generated_by` แล้ว แต่ step ที่ไม่มี artifact (LINE) ต้องมีที่ติดป้าย · backfill = true สำหรับ 13 step ที่ artifact `generated_by='ai_copywriter'` (UPDATE เดียวกับ piece_status §3.3) | ทุกการ์ด |

- `channel` CHECK ปัจจุบัน `('line_oa','tiktok_live','shopee','facebook','parcel_insert')` ✅ ยืนยัน · **ไม่มี `tiktok` (คลิป) / `instagram`** ⇒ drop+add เพิ่ม 2 ค่า (ชื่อ constraint `campaign_step_channel_check` ✅ จาก pg_constraint) · ไม่แตะ `campaign.primary_channels` · ✏️ ของจริง: step ต.ค. 2 แถว (สตอรี่กินเจ 10 ต.ค. · ออกพรรษา 26 ต.ค.) `channel` **null** เพราะไม่มีค่าให้ใส่ ⇒ หลัง CHECK ขยาย เจ้าของตั้ง `instagram` + `piece_kind='story'` ผ่าน Triage/หน้า F — migration **ไม่เดาให้** (`channel` nullable อยู่แล้ว)
- `content_post.step_id uuid → campaign_step on delete set null` · ✏️ **ไม่มี backfill** (Δ4: 10 แถวจริง `artifact_id` null ทั้งหมด ⇒ UPDATE = 0 แถว · ตัดทิ้งเพื่อไม่แตะ `trg_content_post_updated_at` เปล่าๆ) · verify assert `count(*) filter (where artifact_id is not null) = 0` ก่อน apply — ถ้า >0 = มีคนผูกหลัง 6 ต.ค. หยุดแล้วตัดสินใหม่ + CHECK ใน RPC ว่า artifact.step_id = step_id เมื่อทั้งคู่ไม่ null
- `campaign` เพิ่ม: `metric_code · baseline_value · baseline_as_of · pass_threshold · pass_op · baseline_spread` (ชุดเดียวกับ step) · `result_verdict_proposed` (4 ค่า nullable) · `result_verdict_confirmed_at` · `result_verdict_confirmed_by_role` · `lesson text` — brief E
- ค่าฐานกับ `rfm_snapshot_run` (0158): `baseline_as_of` เป็น date ธรรมดา **ไม่ FK** — ถ้า metric ฝั่ง retention (LINE ทักกลับ · ซื้อซ้ำ) ให้ AI ตั้ง `baseline_as_of` = `as_of` ของ snapshot ที่ใช้ แล้ว view join ได้เมื่อ 0158 ลง · ไม่ผูกตอนนี้เพราะ 0158 ยังไม่ apply และ metric หลักของ content (save_rate) ไม่ได้มาจาก RFM

### 5.4 โฮสต์ + บันทึกหลังไลฟ์

- **`live_host`**: `id · shop_id · display_name (ชื่อจริงที่เจ้าของรู้) · public_label (เช่น "โฮสต์ A" — ใช้ขึ้นจอถ้าเจ้าของตอบว่าห้ามโชว์ชื่อ) · is_active · audit` · `unique (shop_id, lower(display_name))` · RPC `live_host_upsert` · ✏️ **seed 2 แถวใน migration เดียวกัน** (§9.1 Q1 เจ้าของยืนยัน 6 ต.ค.): (1) `display_name='หมีเนย'` · `public_label='โฮสต์ A'` (เจ้าของ) (2) `display_name='ฮันนี้ ปิ๊กๆ'` · `public_label='โฮสต์ B'` (คนไลฟ์ประจำ) · `shop_id` = ร้านเดียวที่มี (select จากตาราง shop ตอน apply ไม่ hardcode uuid · >1 ร้าน → raise) · idempotent `on conflict (shop_id, lower(display_name)) do nothing` · ชื่อจริงอยู่ใน DB/UI ภายในเท่านั้น ห้ามหลุดไป brief สาธารณะ
  - ทำไม entity ไม่ใช่ text: "โฮสต์กำกับทุกชั้นการอ่านผล" (F5: +161% มาจากโฮสต์ไม่ใช่คลิป) ⇒ ต้อง group by ได้ · text พิมพ์ต่าง 1 ตัวอักษร = คนละคน · trade-off: 1 ตาราง + 1 RPC เพิ่ม · คำถามชื่อขึ้นจอ (§9 Q1) **ไม่บล็อก** เพราะเก็บทั้งสองชื่อ UI เลือกทีหลัง
- `live_session_log` + `host_id uuid → live_host` (nullable · ✅ 3 คืนจริง 29/30 ก.ย. · 2 ต.ค. ปล่อย null — เจ้าของเลือกโฮสต์ย้อนหลังผ่านหน้า I ได้ ไม่ backfill) · ไม่เพิ่มคอลัมน์คำถาม — คำถามไปอยู่ `content_signal` kind live_question (fact ชั้นเดียว)
- `live_session_upsert` v2: **drop signature เดิม `(uuid,date,time,time,int,text,text)` ก่อน** (✅ ยืนยัน 1 signature · ชื่อ param เดิม `p_shop` ไม่ใช่ `p_shop_id` — คงชื่อเดิมให้ named-arg call ฝั่งแอปไม่พัง) (trap #1 — เพิ่ม param มี default ก็ยังเป็น overload) · เพิ่ม `p_host_id uuid default null · p_questions text[] default null · p_actor_role text default 'owner'` · body เดิมคงไว้ + insert signal ต่อบรรทัด (ตัดว่าง · trim · unique กันซ้ำ) · re-grant service_role · memory `live-session-log` ต้องอัปเดตตัวอย่างเรียก
- `v_live_night` **ไม่แตะ** (trap #3) · view ใหม่ `v_live_night_host` = v_live_night + host (join) ถ้า Brief ต้องการ
- คืนที่ค้าง 7 วัน: view `v_live_log_recent` = `generate_series(วันไทย-6, วันไทย)` left join log → `logged boolean`

### 5.5 3 ด่าน + อนุมัติ + `[ต้องยืนยัน]`

- `step_gate.gate_kind` CHECK += `'fact_check','brand_rule','risk_owner'` (drop+add `step_gate_gate_kind_check` ✅) · ✅ PK = `(step_id, gate_kind)` ไม่มี `id` ⇒ `content_gate_record` = `insert … on conflict (step_id, gate_kind) do update` (trap #14: ส่งทุกคอลัมน์ที่ CHECK อ้าง) · เพิ่มคอลัมน์ `detail jsonb` (fact: `{sources:[url], flagged:[text]}` · brand: `{rules_hit:[code]}` · risk: `{question:text}`) + `checked_by_role`
- RPC `content_gate_record(p_shop_id, p_step_id, p_gate_kind, p_status, p_detail, p_actor_role)` — **`risk_owner` → passed/na ได้เฉพาะ `p_actor_role='owner'`** (AI ตั้งได้แค่ pending+question) · ด่านความเสี่ยงที่ pending = สร้างแถว `recommendation_log` (source agent · related_step_id) ให้ไปโผล่ inbox กอง 4 อัตโนมัติใน RPC เดียวกัน
- `campaign_pass_gate` เดิม **คงไว้ไม่แตะ** (โดเมนโปรโม) · approve ใน `content_piece_advance` อ่าน `step_gate` 3 kind ใหม่เท่านั้น (ไม่สนใจ cfo/pdpa ของโปรโม)
- **`content_confirm_item`**: `id · shop_id · step_id · key (hash ข้อความ) · question text · answer text · resolved_at · resolved_by_role · created_at` · `unique (step_id, key)` · RPC `content_confirm_extract(p_step_id)` (AI/ระบบเรียกหลังร่าง — regex `\[ต้องยืนยัน:\s*([^\]]+)\]` บน content_body + clip_brief::text → upsert แถว) · `content_confirm_resolve(p_id, p_answer, p_actor_role)` (✏️ owner เท่านั้นวันนี้ — §9.1 Q2 ไม่มีผู้ช่วย · เปิด role เพิ่มเมื่อมีคนจริง) · ✅ ของจริง 11/13 artifact AI มี `[ต้องยืนยัน` แล้ว ⇒ extract ต้องรันตอน backfill (§3.3)
- approve ตรวจ 2 ชั้น (§3.5): (1) ไม่มีแถว `resolved_at is null` (2) regex ไม่พบในข้อความจริง — ชั้น 2 คือด่านที่ DB พิสูจน์ได้เอง ไม่พึ่งว่า extract เคยรันไหม

### 5.6 แก้ยอดย้อนหลัง (หนี้ P2.1)

- RPC `content_post_metric_amend(p_shop_id, p_post_id, p_captured_on date, p_set jsonb, p_reason text, p_actor_role) returns uuid` — `p_set` ใช้ jsonb เพื่อแยก "ไม่ได้ส่ง" (ไม่มี key) จาก "ตั้งใจล้าง" (`jsonb_typeof(p_set->'save_count')='null'` — **ห้าม `is null`** trap #13) · reason บังคับ ≥3 ตัวอักษร · แก้ได้เฉพาะแถวที่มีอยู่ (ไม่สร้างใหม่ — สร้างใช้ upsert เดิม) · แก้ได้ย้อนไม่เกิน 30 วัน (กันแก้ประวัติที่ Brief อ้างไปแล้ว — ตัวเลขเอาจาก KPI def ไม่ใช่เดา)
- **`content_post_metric_amend_log`** append-only: `id · shop_id · metric_id · post_id · captured_on · before jsonb · after jsonb · reason · actor_role · created_at` — UI "ประวัติการแก้"
- หลังแก้ต้อง **recompute `is_regression`** ของแถวเดียวกันและแถวที่ `captured_on >` ของโพสต์นั้น (เหตุผลเดียวกับ 0148 H2) — ใน transaction เดียว · verify ต้องมีเคส "แก้ค่าผิดที่เคยเป็น prev_max แล้วธงแถวถัดไปดับ"
- รายการ "พลาดรอบ": view `v_content_post_missed_window` = โพสต์ active × หน้าต่าง (1-2/3-4/5-9) ที่ปิดแล้ว (อายุวันไทย > hi) และไม่มี metric ที่ `num_nonnulls(...)>0` ในช่วง — ไม่มีตาราง

### 5.7 ผูกโพสต์นอกแผนทีหลัง

RPC `content_post_link_step(p_shop_id, p_post_id, p_step_id, p_hook_id, p_actor_role)`: step ต้อง `piece_status in ('approved','produced')` (ยังไม่ posted) · platform ของโพสต์ต้องตรง `channel` ของ step (tiktok↔tiktok · facebook/instagram↔ig_fb_post ฯลฯ — ตาราง map ใน body) · set `step_id` + `artifact_id` (artifact clip ของ step ถ้ามี) + `hook_id` → advance `posted` + event `post` · โพสต์ที่ผูกแล้วย้ายไป step อื่น → ต้อง unlink ก่อน (RPC แยก `content_post_unlink_step` · step กลับเป็น `produced`) — ไม่ทำ "ย้าย" ในขั้นเดียวเพราะมี 2 piece เปลี่ยนสถานะพร้อมกัน

### 5.8 คำตัดสินแคมเปญ

- คอลัมน์ใน §5.3 · RPC `campaign_verdict_propose(p_campaign_id, p_verdict, p_note, p_actor_role='ai')` เขียน `result_verdict_proposed/result_note` · `campaign_verdict_confirm(p_campaign_id, p_verdict, p_lesson, p_actor_role)` **owner เท่านั้น** → เขียน `result_verdict` (คอลัมน์เดิม) + `confirmed_at/_by_role` + `status='done'` + insert `content_signal` kind insight (origin_campaign_id) ถ้า `p_lesson` ไม่ว่าง
- `result_verdict` default `'not_measured'` not null (0101) = ของเก่าทุกแถวอ่านว่า "วัดไม่ได้" — UI แสดงคำตัดสินเฉพาะ `status='done'` หรือ `confirmed_at is not null` (view ให้คอลัมน์ `verdict_display`)

### 5.9 ผลต่อโพสต์ที่เจ้าของยืนยัน + บทเรียน → สัญญาณ

- `content_post` + `result_label_override check('above','normal','below')` · `result_confirmed_at` · `result_confirmed_by_role` · `result_lesson text`
- RPC `content_post_verdict_confirm(p_shop_id, p_post_id, p_label, p_lesson, p_actor_role)` owner เท่านั้น · โพสต์ต้องมี t7 snapshot (✏️ `v_content_post_t7.t7_captured_on is not null` — Δ5 ไม่มี `t7_post_id` · วันนี้ 1/10 โพสต์) ไม่งั้น raise "ยังสรุปไม่ได้" · `p_lesson` ไม่ว่าง → insert signal insight (origin_post_id · summary = lesson · confidence 'observation')
- ป้ายที่ AI คำนวณ (above/normal/below vs median) **ไม่เก็บ** — view §6 · เก็บเฉพาะที่คนยืนยัน (fact ชั้นเดียว · ค่ากลางเปลี่ยนตามโพสต์ใหม่ ป้ายที่คำนวณจึงขยับได้ แต่ที่ยืนยันแล้วต้องนิ่ง)

### 5.10 ข้อเสนอ/คำถาม AI ตอบในแอป — `recommendation_log` ใช้ได้ (ปรับเล็ก)

- เพิ่ม: `respond_by date` · `default_action text` (ข้อความ "ถ้าไม่ตอบภายใน X จะ…") · `related_step_id uuid → campaign_step` · `kind check('proposal','question','risk_gate')` · ✏️ **ไม่เพิ่ม `response`** — ใช้ `outcome_note text` ที่มีอยู่แล้ว (Δ7) เป็นคำตอบ/ผล
- RPC `recommendation_respond(p_shop_id, p_id, p_action check('done','rejected'), p_response, p_actor_role)` → set owner_action + acted_at + acted_by(null) + outcome_note (✅ CHECK `chk_recommendation_log_acted_consistency` บังคับ acted_at not null เมื่อ ≠ pending — set พร้อมกัน) · `rejected` บังคับ outcome_note · ตอบ `risk_gate` → อัปเดต `step_gate` risk_owner ให้ด้วยในรอบเดียว (ผ่าน `content_gate_record`) · เขียนผ่าน service_role อย่างเดียววันนี้ (ไม่มี RPC create) → เพิ่ม `recommendation_create(...)` ให้ agent/Brief ใช้แทน insert ตรง
- `v_recommendation_acceptance` (0101): **ไม่แตะ select list** (trap #3) · สร้าง `v_recommendation_inbox` ใหม่: `effective_action` = expired เมื่อ `respond_by < วันไทย` (ถ้ามี) ไม่งั้นกติกา 14 วันเดิม · ไม่ mutate แถว (หลักเดิม 0101)
- Weekly Brief (task) วันนี้เขียน md อย่างเดียว · ข้อเสนอเข้า DB ได้ 2 ทาง: (ก) Tech Lead เรียก `recommendation_create` หลัง Brief ออก (ข) task เรียกเอง — **เลือก (ก) ก่อน** จนกว่ากติกา "scheduled task ห้ามแตะ DB" จะถูกทบทวน (นอก scope ไฟล์นี้)

### 5.11 สัดส่วนเดือนหน้า — ทีหลัง (หลัง M1–M3 ใช้จริง 4 สัปดาห์)

`content_month_mix(shop_id, month date, mix jsonb {content_type_code: pct}, proposed_by_role, confirmed_at, note)` pk (shop_id, month) · CHECK sum=100 ใน RPC · ไม่ทำรอบแรก — ยังไม่มีโพสต์พอให้ "ประเภทชนะ" มีความหมาย (กฎ ≥4 ชิ้น/ประเภท)

### 5.12 Trend radar — **ไม่ย้ายเข้า DB**

| ทางเลือก | ตัด/เลือก |
|---|---|
| **md บน branch `trend-radar-feed` ต่อไป · แอปอ่านจาก GitHub (ของเดิม) · เข้า DB เฉพาะมุมที่คน "หยิบเข้ากล่อง" (`content_signal` kind trend · `radar_date+radar_angle_idx` ชี้กลับไฟล์)** | **เลือก** — task ยังไม่แตะ DB ตามกติกาเดิม · ส่วน "AI ตัดทิ้ง" แสดงจาก md ได้ครบ (brief B ต้องการแค่แสดง ไม่ต้อง query) · ไม่มี write path ใหม่ที่ต้อง security review |
| task เขียน `content_signal` ตรง | ตัด — ต้องเปิด DB credential ให้ scheduled task + ทุกมุมที่ AI เสนอกลายเป็นแถว (กล่องรก · ขัด "คนหยิบ ไม่ใช่ AI ไหลเข้า") |
| import md → DB ด้วย cron | ตัด — fact 2 ชั้น · parse md เปราะ |

## 6. ไม่ต้องมี schema — คำนวณใน view / UI (กัน over-engineering)

| สิ่งที่ brief ขอ | ทำที่ไหน | เหตุผล |
|---|---|---|
| mass ratio · ป้าย mass · "ยังไม่สุก" · บันทึก÷วิว ของคลิปอ้างอิง | `v_content_signal` | สูตรเป็น [Hypothesis] จะเปลี่ยน — view แก้ครั้งเดียว ไม่ต้อง backfill |
| กำลังวัดผล / วัดผลแล้ว / ตกรอบวัด · รออ่านผล (แคมเปญ) | `v_content_piece` · `v_campaign_summary` | ขึ้นกับวันไทย + snapshot — เก็บ = state ค้างผิด (D2) |
| ป้ายผลต่อโพสต์ เหนือ/ปกติ/ต่ำ vs median 10 โพสต์ล่าสุด · "ยังสรุปไม่ได้ (n/4)" | `v_content_post_result` (`percentile_cont(0.5)` over 10 โพสต์ก่อนหน้าที่มี t7 · ต่อ platform) · rollup §5.2 | ค่ากลางเลื่อนทุกโพสต์ · เก็บเฉพาะที่เจ้าของยืนยัน (§5.9) |
| ตัวนับ LINE x/4 ใน 28 วัน | `v_line_quota_28d` = ✏️ step `piece_kind='line_message'` ที่ `piece_status='posted'` (วันจาก event `post`) + ที่ planned..approved ในหน้าต่าง 28 วันไทย — **ไม่อ่าน content_post** เพราะชิ้น LINE ไม่สร้างแถวนั้น (§9.1 Q3) | ข้อจำกัด §10.6 เป็นเลขคงที่ 4 — ใส่ใน view ที่เดียว (ย้ายเข้า `shop_setting` เมื่อมีร้านที่สอง) |
| ตัวนับ inbox 4 กอง · แถบสถานะสัปดาห์ · ช่องว่างในปฏิทิน · คิวอนุมัติ >10 | `v_content_inbox_counts` (1 แถว/shop) | นับจาก piece_status/recommendation — ไม่มี state |
| โควตาสัปดาห์ TikTok 3 / IG 1 | ค่าคงที่ใน view/แอป (จาก `content-cadence`/Lean plan) | ยังไม่มีเหตุให้เจ้าของแก้ผ่าน UI |
| คำเตือน "เกณฑ์แคบกว่าช่วงแกว่ง" | UI จาก `baseline_spread` vs `|pass_threshold − baseline_value|` | ค่าเก็บแล้ว (§5.3) การเทียบเป็น 1 บรรทัด |
| "อนุมัติทั้งชุด <1 นาที" | UI จาก `content_piece_event.review_seconds` รวมต่อ batch | แสดงไม่บล็อก |
| ค่าย่อ "16K"/"1.2M" | server action parse → bigint + approx flag | DB ไม่ควรรู้จักรูปแบบข้อความ |
| inbox ตามบทบาท | ✏️ **ตัดรอบนี้** — มีเจ้าของคนเดียว (§9.1 Q2) · เพิ่มเมื่อมีคนจริง | มติ role-single-level — ไม่มี logic role ใน DB นอกจาก actor_role ที่บันทึก/ปฏิเสธ approve |
| งานหลายวันข้ามเดือน · ปุ่มลอย · มุมมอง 3 แบบ · sitemap | UI | `resolved_start/resolved_end` มีแล้ว |
| สรุปสัปดาห์ฉบับเต็ม · เทรนด์รายวัน · ส่วน "AI ตัดทิ้ง" | md จาก GitHub (ของเดิม) | §5.12 |
| "รอบถ่าย" เป็น entity | ไม่มี | G = กรอง approved+needs_shoot ของสัปดาห์ · ติ๊ก = advance produced ทีละชิ้น |
| ไอเดีย เป็นตาราง | ไม่มี | = step ที่ piece_status idea (§2) |

## 7. แผน phase migration (✏️ เลขไฟล์: บนดิสก์/DB ว่างตั้งแต่ **0158** — 0158/0159 ของ RFM ยังไม่มีไฟล์ใน git ref ใด (Δ8) ⇒ ในเอกสารใช้ป้าย **C1–C3** · ตั้งเลขจริง**ตอนสร้างไฟล์**: RFM commit ก่อน = 0160+ · ไม่งั้น Tech Lead เคาะ — ห้ามเว้นเลขให้เกิดรู (บทเรียน 0129) · ทุกไฟล์ LF · verify = `scripts/verify/verify-NNNN.sql` do-block+raise · ตารางแมปบรีฟ→เทสต์ · `check-analytics-grants.sql` หลัง apply)

| # | ไฟล์ | ขนาด | เนื้อหา | ปลด UI | MVP v1 §5.2 |
|---|---|---|---|---|---|
| C1 | `NNNN_content_signal_hook_host.sql` (เดิม 0160) | **M** | `content_signal` + `content_hook` + `live_host` · `live_session_log.host_id` · `live_session_upsert` v2 (drop sig เดิม) · RPC capture/set_status/pick/hook_upsert/host_upsert · `v_content_signal` · `v_live_log_recent` · backfill hooks[] ✏️ 26 แถว (A/B ตามตำแหน่ง · `hook_type_raw`/`legacy_json_id`) · **seed `live_host` 2 แถว** | **B** Research ทั้งหน้า · **I** บันทึกหลังไลฟ์ · ฟอร์มแปะลิงก์ · ปุ่ม "หยิบเข้ากล่อง" บน radar · คลัง hook (ยังไม่มีผล) | **M2** ทั้งก้อน + M3 ส่วน hooks |
| C2 | `NNNN+1_content_piece_workflow.sql` (เดิม 0161) | **L** ✏️ เล็กลง (ไม่มี backfill content_post · piece_status 26 แถว 2 กรณี · actor 3 ค่า) | `campaign_step` คอลัมน์ §5.3 + channel/artifact_type CHECK · `content_post.step_id/hook_id/hook_other` + backfill · `step_gate` kind ใหม่ + detail · `content_confirm_item` · `content_piece_event` · RPC `content_piece_advance` / `content_piece_post` / `content_piece_set_footage` / `content_gate_record` / `content_confirm_extract` / `content_confirm_resolve` / `content_post_link_step` / `_unlink_step` · `v_content_piece` · `v_content_inbox_counts` · `v_line_quota_28d` · `content_piece_set_plan` (R17: ตั้ง anchor_date/channel/kind/group/สมมติฐาน) · backfill piece_status+drafted_by_ai 26 แถว + `content_confirm_extract` 13 ชิ้น (§3.3 · dry-run พิมพ์รายการก่อน) | **A** inbox กอง 1-3 · **C** Triage · **D** ปฏิทิน · **F** ชิ้นงาน · **G** รอบถ่าย · **H** โพสต์แล้ว+ผูกทีหลัง | **M1 · M3 · M4** |
| C3 | `NNNN+2_content_measure_feedback.sql` (เดิม 0162) | **M** | `content_post_metric_amend` + amend_log · `v_content_post_missed_window` · `v_content_post_result` · `v_content_hook_type_rollup` · `content_post` result_* + `content_post_verdict_confirm` · `campaign` metric/verdict คอลัมน์ + 2 RPC · `recommendation_log` คอลัมน์ + `recommendation_create/_respond` + `v_recommendation_inbox` · `v_campaign_summary` | **J** แก้ย้อนหลัง/พลาดรอบ · **K** ต่อโพสต์/ต่อ hook · **E** แคมเปญ · **A** กอง 4 | **M5** + หนี้ P2.1 |
| C4 | `content_month_mix` (ทีหลัง · ยังไม่ตั้งเลข) | **S** | `content_month_mix` + RPC | K สัดส่วนเดือนหน้า | ทีหลัง (4 สัปดาห์หลัง M1–M3 ใช้จริง) |

ทำไม 1 ก่อน 2 ทั้งที่ M1 (inbox) แรงกระแทกสูงสุด: `content_piece_post` ต้องมี `content_hook` FK · Triage ต้องอ่าน signal · ทั้งสองไฟล์ควรลงสัปดาห์เดียวกันอยู่แล้ว — ถ้าอยากเห็น inbox ก่อน ให้ frontend เริ่มจาก C1 ที่ apply แล้ว + mock `v_content_piece` ชั่วคราวไม่ได้ (ไม่มี dev DB) ⇒ ลง C1→C2 ติดกันแล้วค่อยเปิด UI · แต่ละไฟล์ security + QA แยก · C2 = 💰-class (แตะสิทธิ์อนุมัติ) ⇒ security ผ่านก่อน merge · ✅ ทบทวนหลังเห็นของจริง 6 ต.ค.: **ลำดับ C1→C2→C3 ไม่เปลี่ยน** · ขนาด C2 ลดลง (Δ2/Δ4) · C1 เพิ่ม seed host + backfill hook 26 แถว (ยังอยู่ใน M)

### 7.1 พร้อมเขียน DDL C1 ได้ทันที — ไม่ติดอะไร

ครบแล้ว: ของจริงใน DB (§0) · คำตอบเจ้าของ 5 ข้อ (§9.1) · ชื่อ constraint/signature ที่ต้อง drop (§0.1) · ค่า seed (§5.4) · ขอบเขต backfill เป็นรายการ 26+26 แถวที่ dry-run พิมพ์ได้ · เหลือแค่ **Tech Lead เคาะเลขไฟล์** (Δ8) ตอนสั่ง backend-dev — ไม่บล็อกการเขียน body

## 8. ความเสี่ยง

| # | ความเสี่ยง | กัน |
|---|---|---|
| ~~R1~~ | ✅ **ปิดแล้ว 6 ต.ค.** — ยืนยันกับ DB สด · ต่าง 10 ข้อ (§0.2) แก้ในที่แล้ว | backend-dev รัน 5 query ซ้ำเป็นขั้นแรกของ C1 (ของเปลี่ยนได้ระหว่างวัน) · ต่างจาก §0.2 = หยุดแล้วรายงาน |
| ~~R2~~ | ✅ **หมดไป** — ต.ค. ไม่มี artifact `done`/`approved`/`blocked` (Δ2) · backfill เหลือ planned 13 / in_review 13 | ด่าน raise ถ้าเจอสถานะอื่นตอน apply (§3.3) · dry-run ยังพิมพ์รายการ |
| R3 | `v_campaign_board`/CampaignBoard copilot ยังอ่าน `status` เดิม — ถ้า RPC ใหม่ลืม project (§3.2) บอร์ดเก่าจะค้าง `scheduled` ตลอด | verify: ทุก transition assert `status` เดิมตามตาราง · QA smoke บอร์ด copilot |
| R4 | `campaign_set_artifact_status` (R7) ยังเรียกได้จากบอร์ดเก่า → เปลี่ยน artifact.status โดย piece_status ไม่ขยับ = 2 แหล่งเถียงกันอีก (ปัญหาเดิม brief §12) | หน้าจอใหม่ห้ามอ่าน artifact.status · ปุ่มบนบอร์ดเก่าสำหรับ step ที่ `piece_status is not null` ให้ซ่อน/ชี้ไปหน้า F · บันทึกเป็นหนี้: ปลดระวาง R7 เมื่อบอร์ด copilot ย้ายมาใช้ piece |
| R5 | trap #1: `live_session_upsert` เพิ่ม param = overload · trap #2/#18: ทุก create or replace ต้อง re-grant service_role อย่างเดียว · `grant ... to authenticated` = ตีตก | `drop function if exists analytics.live_session_upsert(uuid,date,time,time,int,text,text)` ก่อน · ตรวจ `pg_proc` ได้ 1 แถว · `check-analytics-grants.sql` |
| R6 | trap #3: ห้ามแทรกคอลัมน์ `v_campaign_board`/`v_live_night`/`v_recommendation_acceptance`/`v_content_post_t7` | **ไม่แตะ view เดิมเลย** — ทุกอย่างเป็น view ใหม่ (`v_content_piece` ฯลฯ) · ถ้าจำเป็นต่อท้ายเท่านั้น + เทียบ ordinal_position ก่อน |
| R7 | trap #19: UPDATE backfill บน `campaign_step` 26 แถว (trigger `trg_campaign_step_updated_at` ✅ มีจริง · `set_updated_at` ไม่มีเงื่อนไข) · ✏️ `content_post`/`step_artifact` **ไม่มี UPDATE แล้ว** (Δ4 · hooks backfill = insert ตารางใหม่) | ปิด/เปิด trigger คร่อมใน transaction เดียว · where ระบุเงื่อนไขฝั่งข้อมูล (resolved_start ≥ 1 ต.ค. · artifact_id not null) · assert `md5(string_agg(updated_at))` เท่าเดิม |
| R8 | trap #13: `clip_brief->'hooks'` อาจเป็น JSON null / `[]` / ไม่มี key — `is not null` ตาบอด · `baseline_value=0` คือค่าจริง | ใช้ `jsonb_typeof(...)='array' and jsonb_array_length>0` · ด่านสมมติฐานใช้ `not (x between …)`/`is distinct from` ตามความหมาย |
| R9 | trap #14: CHECK ต่อ kind บน `content_signal` + `on conflict (shop_id,url_norm)` — คอลัมน์ที่ CHECK อ้างต้องอยู่ใน insert list | capture RPC ไม่ใช้ on conflict (จับ 23505 แล้ว raise พร้อม id เดิม — brief ต้องการ "พาไปรายการเดิม" ไม่ใช่ทับ) |
| R10 | trap #6: "วันนี้" ใน effective_piece_status · คิว · LINE 28 วัน · คืนค้าง 7 วัน | `(now() at time zone 'Asia/Bangkok')::date` ทุกจุด · verify เคสคร่อม 00:00–07:00 ไทย |
| R11 | trap #12/#22: RPC คืน jsonb · เทสต์ห้าม assert timestamp ไล่เพิ่ม | ตามสกิล |
| R12 | trap #17: RPC ใหม่ต้องยิงใส่ **step ทุกโหมดที่มีจริง** (template promo · content_task · ที่ piece_status null · ที่มี artifact หลายตัว · ที่ไม่มี artifact) · ✅ โหมดจริง: ไม่มี artifact 11 step · หลาย artifact 8 step — ทั้งหมดก่อน ต.ค. (Δ10) ⇒ RPC ใหม่ยิงใส่ step ที่ `piece_status` null ต้อง raise สุภาพ "นอก workflow" ไม่ใช่พัง/เงียบ | verify มีเคสต่อโหมดจริงจาก prod ไม่ใช่ fixture อย่างเดียว · เคส "ต้องไม่พัง": `campaign_reschedule_step`/`campaign_delete_step`/`campaign_toggle_clip_shot` เดิมยังทำงานกับ step ที่มี piece_status |
| R13 | **regex `[ต้องยืนยัน]`** กันได้เฉพาะรูปแบบที่ AI เขียนตาม brief · AI เขียน "(ต้องเช็คราคา)" = หลุด | ตัวนี้เป็นด่านชั้นสอง · ชั้นแรก = `content_confirm_extract` + กติกาใน brief ของ copywriter ("ค่าที่ไม่รู้ต้องเขียน `[ต้องยืนยัน: …]` เท่านั้น") · ไม่อ้างว่า DB กันได้ 100% |
| R14 | `p_actor_role` มาจากแอป ไม่ใช่ auth — คน/โค้ดส่ง 'owner' ปลอมได้ | เขียนตรงๆ ใน comment ฟังก์ชัน + memory · เมื่อ A2 ลง: เปลี่ยน body ให้ derive role จาก `shop_member` แทน param (signature ไม่เปลี่ยน — param กลายเป็น "ที่อ้าง" เทียบกับ "ที่จริง") |
| R15 | DB เดียว ไม่มี dev/prod — ทดสอบ RPC อนุมัติ/โพสต์บน DB จริง = เขียนแถวจริง (content_post · event · signal) | ทุกเทสต์ใน do-block+raise · live test หลัง deploy ใช้ step/signal ที่สร้างเพื่อทดสอบแล้วลบด้วย id เจาะจง (step ลบผ่าน `campaign_delete_step` ได้เฉพาะ manual) |
| R16 | url_norm 2 ชั้น (แอป canonicalize TikTok · DB normalize ทั่วไป) อาจให้ผลต่างกันระหว่างลิงก์สั้น vt.tiktok.com กับลิงก์เต็ม | แอป **ต้อง** canonicalize ก่อนส่งเสมอ (เหมือน content_post) · verify เคสลิงก์สั้น/ยาวของคลิปเดียวกัน → 1 แถว |
| R17 | `campaign_step.channel` CHECK ขยายแล้ว แต่ `campaign_create_task` เดิมรับ `p_step_kind` ไม่รับ channel — Triage ✓ ต้องตั้ง channel/piece_kind/customer_group ผ่าน `content_signal_pick` หรือ RPC set แยก | `content_signal_pick` + `content_piece_set_plan(...)` (ตั้งสมมติฐาน/ฐาน/เกณฑ์/channel/kind/group/วัน ก่อน advance planned · ✏️ "วัน" = set `campaign.anchor_date` ของ wrapper Δ1) — ระบุใน C2 |
| R18 | ✏️ ไอเดีย = wrapper campaign `anchor_date` null (Δ1) ⇒ `v_campaign_board.resolved_start/days_until` null · `campaign_reschedule_step` raise "campaign has no anchor_date" · บอร์ด copilot/ปฏิทินเดิมอาจ sort/format null พัง | QA เคส "ต้องไม่พัง": เปิดบอร์ด copilot + ปฏิทินขณะมี idea step ≥1 แถว · view ใหม่กรอง idea ออกจากปฏิทิน · `content_piece_set_plan` เป็นทางเดียวที่ตั้ง anchor (ไม่ใช้ reschedule กับ idea) |
| R19 | ✏️ hook backfill 20/26 แถว `hook_type` null (Δ3) — ด่าน "≥2 ประเภทต่างกัน" และ rollup ถ้าเขียน `count(distinct hook_type)` เฉยๆ: distinct ไม่นับ null ⇒ 13 ชิ้น in_review ที่ถูกส่งกลับ drafting แล้ว advance ใหม่จะตกด่านโดยไม่รู้สาเหตุ | ด่าน = `count(distinct hook_type) filter (where hook_type is not null) >= 2` + ข้อความ raise บอก "hook ยังไม่ติดประเภท n ตัว" · rollup `where hook_type is not null` · หน้า F แสดง `hook_type_raw` ให้ติดป้าย |

## 9. คำถามที่เจ้าของต้องเคาะก่อนเขียน DDL (ตอบผิดแล้วแก้ยาก)

| # | คำถาม | ทำไมแก้ทีหลังยาก | ถ้าไม่ตอบ ผมจะเลือก |
|---|---|---|---|
| Q1 | **ชื่อโฮสต์ขึ้นจอได้ไหม** (display_name) หรือใช้ "โฮสต์ A/B" (public_label) | เก็บได้ทั้งคู่ไม่บล็อก — แต่ถ้าห้ามทั้งใน DB (PII ของพนักงาน) ต้องตัด display_name ตั้งแต่แรก ลบทีหลัง = เคยอยู่ใน backup แล้ว | เก็บทั้งคู่ · จอใช้ public_label จนกว่าจะสั่ง |
| Q2 | **มี "ผู้ช่วย" จริงไหม** และผู้ช่วยกรอกยอด/วางลิงก์/ตอบ `[ต้องยืนยัน]` ได้ไหม | กำหนดค่า `actor_role` ที่ RPC ยอมรับต่อ action — เพิ่มทีหลังได้ แต่ถ้าเปิดกว้างก่อนแล้วมาปิด ประวัติใน event แยกไม่ได้ว่าใครทำ | รับ 'assistant' สำหรับ post/metric/confirm/signal · ไม่รับ approve/verdict |
| Q3 | **LINE broadcast ไม่มี URL** — "โพสต์แล้ว" ของชิ้น LINE นับจากอะไร (เวลาส่ง + ภาพหน้าจอ? · จำนวนผู้รับ?) | `content_post` บังคับ post_url http(s) + external_id (0148 CHECK) — ผ่อนให้ line_oa = แก้ CHECK + RPC ที่ apply แล้ว · ถ้าไม่ผ่อน ชิ้น LINE จบที่ `produced` ตลอดและไม่เข้าวัดผล/โควตา 4/28 | ผ่อนเฉพาะ `platform='line_oa'`: `post_url` null ได้ · `external_id` = `'line:'||posted_at` · ตัวนับ LINE นับจากแถวนี้ |
| Q4 | step ก่อน 1 ต.ค. 69 (โปรโม 9.9 · winback · ก.ย.) **ปล่อยไว้นอก workflow ใหม่** (null) ตามที่เสนอ หรืออยากเห็นในปฏิทินใหม่ด้วย | null = หน้าใหม่ไม่แสดง (ยังอยู่บอร์ด copilot) · ถ้าจะให้แสดงต้องแต่งสถานะให้ 55+ แถวที่ไม่เคยผ่าน workflow | null |
| Q5 | ไฟล์คลิป: เก็บแค่ **ลิงก์** (text) พอไหม หรือจะอัปโหลดเข้า Storage ของระบบ | ลิงก์ = 1 คอลัมน์ · Storage = bucket + policy + ขนาด/ค่าใช้จ่าย + PII ในคลิป — คนละ phase | ลิงก์ text (brief สมมติฐาน "ไฟล์เก็บนอกระบบ") |

ไม่ถาม (ตัดสินเองได้ · เจ้าของกลับได้ทีหลังถูก): Piece = step · hook แยกตาราง · radar ไม่เข้า DB · สถานะวัดผล derived · ไอเดีย = step · "รอบถ่าย" ไม่มี entity

### 9.1 ✅ เจ้าของตอบ 6 ต.ค. 69 — ใช้เป็นสเปกตอนเขียน DDL

| # | คำตอบเจ้าของ (สรุปความ) | ผลต่อ schema |
|---|---|---|
| Q1 | สร้าง entity โฮสต์ไว้ก่อนได้ (เก็บชื่อจริง + ป้าย A/B) · **ตอนนี้มีแค่เจ้าของคนเดียว** | `live_host` ตามที่ออกแบบ · **seed 2 แถว (เจ้าของยืนยัน 6 ต.ค.)**: (1) เจ้าของ — display_name **"หมีเนย"** · public_label "โฮสต์ A" (2) **คนไลฟ์ประจำที่กลับจากจีน (มีแฟนคลับ — Brief #4 §8)** — display_name **"ฮันนี้ ปิ๊กๆ"** · public_label "โฮสต์ B" · ชื่อนี้ใช้ภายในเท่านั้น ห้ามใส่ใน brief ที่ส่งออกนอกทีม |
| Q2 | **ยังไม่มีผู้ช่วย** · เจ้าของถ่าย+ตัดเอง · แผนต่อไป: ทำ "format clip" (แม่แบบคลิป) ไว้แล้วให้ **AI ช่วยตัดจากฟุตเทจจริง** ต่อเนื่อง | `actor_role` รอบแรกรับแค่ `owner` · `ai` · `system` (ไม่สร้าง `assistant`) · เพิ่มทีหลังเมื่อมีคนจริง · format clip = งานออกแบบถัดไป (ดูหมายเหตุล่าง) |
| Q3 | ชิ้น LINE **แค่กดว่า "โพสต์แล้ว" ก็พอ** ไม่ต้องมีลิงก์/ภาพ/จำนวนผู้รับ | **ไม่แก้ CHECK 0148** · ชิ้นที่ `piece_kind` ไม่มี URL (LINE · สตอรี่) เปลี่ยนเป็น `posted` ได้โดยไม่สร้างแถว `content_post` · ไม่มียอดให้วัด ⇒ ไม่เข้าคิวกรอกยอด/ผลลัพธ์ต่อโพสต์ (แสดง "ไม่มีการวัดผลรายชิ้น") · รับ `approved → posted` ตรงได้สำหรับชิ้นที่ไม่ต้องถ่าย (ช่องที่ Yoda ชี้ — ยืนยันแล้ว) |
| Q4 | **ข้ามของก่อน 1 ต.ค. ไปเลย** เอาของใหม่อย่างเดียว | `piece_status` = null สำหรับ step ก่อน 1 ต.ค. · หน้าจอใหม่กรองออก · ไม่ backfill |
| Q5 | เก็บ **แค่ลิงก์** · ตัวเลข วิว/ไลก์/คอมเมนต์ อยากให้ระบบ **บันทึกอัตโนมัติ** เป็นระยะ | ไฟล์คลิป = ลิงก์ text 1 คอลัมน์ · ยอดอัตโนมัติ: 🔴 **ห้ามทำด้วยการเปิดลิงก์/scraper** (ผิด ToS TikTok เสี่ยงแบนบัญชีหลัก) · ทางถูกคือ **TikTok Display API** (บัญชีตัวเอง ได้ วิว/ไลก์/คอมเมนต์/แชร์ — **ไม่ได้ "บันทึก"**) ⇒ ช่อง "บันทึก" ยังกรอกมือ · บล็อกที่: เว็บต้องมี Privacy Policy + ToS ก่อนส่งแอปรีวิว (ร่างค้างใน `docs/3j-jewelry/legal/`) = งาน P3 เดิม · schema รองรับแล้ว (`content_post_metric.source`) |

**หมายเหตุ format clip (Q2)**: "AI ช่วยตัดจากฟุตเทจจริง" ≠ "AI สร้างวิดีโอ" ที่ CEO NO-GO ถาวร (31 ส.ค.) — ไม่ขัดมติ แต่ต้องบันทึกให้ชัดเมื่อออกแบบ · format clip น่าจะเป็นแม่แบบ storyboard ที่ใช้ซ้ำ (ใกล้ `campaign_template` เดิม) — ออกแบบแยกรอบหลังเฟส C2

## 10. หนี้เทคนิคที่รับไว้ตอนทำ C1 (0158 · 6 ต.ค. 69)

| # | หนี้ | ทำไมรับได้ตอนนี้ | ต้องปิดเมื่อไหร่ |
|---|---|---|---|
| D1 | FK ของ `content_hook.step_id` / `source_signal_id` และ `content_signal.origin_*` / `picked_step_id` เป็นคอลัมน์เดียว ไม่ใช่ composite `(shop_id, id)` — กันข้ามร้านได้เฉพาะใน RPC (security L2) | ร้านเดียว · ทุก RPC เรียกได้เฉพาะ `service_role` · RPC ตรวจ shop แล้ว (verify B10/B11) | ก่อนเปิดร้านที่ 2 · ต้องเพิ่ม `unique (shop_id, id)` ที่ `campaign_step` ก่อน |
| D2 | `p_actor_role` มาจากแอป ไม่ใช่ auth — กันได้เฉพาะเส้นทาง AI (R14) | ตัวเรียกทุกตัวต้อง hardcode `p_actor_role` + `p_shop_id` ฝั่ง server · QA grep ตอนต่อ UI | Auth A2 |
| D3 | `live_session_upsert` ล้างโฮสต์ผ่าน RPC ไม่ได้ (ส่ง null = ไม่ทับ) | แอปเดิมไม่ส่ง host ต้องไม่ล้างค่าที่เจ้าของเลือก | ถ้า UI รอบ 2 ต้องการปุ่ม "ไม่ระบุโฮสต์" → เพิ่มพารามิเตอร์ล้างแบบชัดเจน |
| D4 | `youtu.be/ID` กับ `youtube.com/watch?v=ID` ไม่ถูกนับว่าซ้ำ | แอปต้อง canonicalize ลิงก์ก่อนส่ง | ตอนทำฟอร์มแปะลิงก์ (UI) |
| D5 | error 22023 / 23505 / 23514 ใหม่ยังไม่ถูก map เป็นภาษาไทยใน `live-metrics-errors.ts` (ผู้ใช้เห็นข้อความ fallback) | แอปยังไม่ส่งพารามิเตอร์ใหม่ · error เดิมยัง map ได้ | พร้อม UI บันทึกหลังไลฟ์รุ่นใหม่ |
| D6 | ด่านอักขระล่องหน (bidi/zero-width) อยู่ที่ RPC เท่านั้น — CHECK ของตารางยังไม่กัน · ช่องข้อความรอง (`why_it_works` · `account` · `note` · ชื่อ/ป้ายโฮสต์ ฯลฯ) ใช้แค่ `btrim` · ชุดอักขระยังไม่รวม U+061C · U+180E · U+00AD · U+FFF9–FFFB | ✏️ แก้ 6 ต.ค. ตาม code review: เหตุผลเดิม "ช่องรองเจ้าของกรอกเท่านั้น" ผิด — AI radar เขียนได้ ⇒ ช่องที่ AI เขียนได้ + ชื่อโฮสต์เปลี่ยนเป็น `content_text_clean` แล้ว · ที่เหลือคือ CHECK ระดับตาราง + ชุดอักขระที่ยังไม่ครบ · เขียนได้เฉพาะผ่าน RPC ฝั่ง server · React escape ตอนแสดง | ถ้ามีผู้ใช้คนที่ 2 หรือเปิด insert ตรง |
| ~~D8~~ | ✅ **ปิดแล้ว 6 ต.ค. (บ่าย) — เจ้าของเคาะทาง (ข)**: hook ทุกตัวอยู่ `content_hook` (origin ours/reference) · capture สร้างแถว reference อัตโนมัติ (trigger) · `content_signal.hook_text` = snapshot ตอนจับ ไม่ใช่แหล่งจริง · rollup นับเฉพาะ ours · รายละเอียด + ปัญหาเทคนิคที่เห็น §11 · DDL/RPC ที่ต้องทำใน 0159 §11.2 | — | ทำใน 0159 (C2) |
| D7 | verify-0158 B15a pin `md5(prosrc)` ของ `content_url_ok` — จะล้มถ้า replay ไฟล์แบบ CRLF | ไฟล์ใน repo เป็น LF · ข้อความ error ชี้ให้เช็ค `\r` ก่อน (migration trap #20) | เมื่อเคาะ `.gitattributes` `*.sql eol=lf` |
| D9 | backfill 26 แถวไม่มี hypothesis · `piece_kind` null 4 แถว (teaser_image/parcel_card) · `line_audience` null 2 แถว — approve บังคับ kind + line_audience แต่**ไม่บังคับ hypothesis** (บังคับเฉพาะ idea→planned) | ของจริงอยู่ในปฏิทินแล้ว การบล็อกอนุมัติ ต.ค. ด้วยช่องวัดผลจะหยุดงานจริง | เจ้าของเติมผ่านหน้า F · ทบทวนเมื่อ C3 ทำ rollup (ชิ้นไม่มี metric = ไม่เข้า rollup) |
| D10 | `campaign_create_task`/AddPlanForm เดิมสร้าง step `piece_status null` (นอก workflow ใหม่) | เส้นทางเดิมต้องไม่พัง (K7) · ไม่ replace signature | UI ย้ายปุ่ม "เพิ่มงาน" ไป `content_piece_create` — ตอนต่อหน้า C/D |
| D11 | เลื่อนผ่านปฏิทินเดิม (`campaign_reschedule_step`) บนชิ้น workflow ใหม่ไม่มี event `defer` | ต้องไม่พัง (K5) | UI ใหม่ใช้ `content_piece_defer` · ปุ่มเลื่อนเดิมบน step ที่มี piece_status ชี้ไป RPC ใหม่ |
| D12 | `content_confirm_item` ไม่เก็บ path ใน clip_brief — เจ้าของเห็นคำถามแต่ไม่รู้ว่าอยู่ segment ไหน | YAGNI · regex ชั้น 2 กันไม่ให้หลุดอยู่แล้ว | ถ้าเจ้าของบ่นตอน UAT → เพิ่ม `path text` + extract เดิน jsonb แทน regex บน text |
| D13 | ด่านความเสี่ยง (risk_owner pending) ยังไม่สร้าง `recommendation_log` — inbox กอง 4 นับจาก `step_gate` ตรง | ไม่แตะ 0101 ใน C2 | C3 (`related_step_id` + `kind='risk_gate'`) |
| D14 | trigger R4 ปล่อยผ่านด้วย GUC `c2.piece_rpc` — service_role ตั้งเองได้ = ข้ามได้ (R20) | กันเส้นทางโค้ด/บอร์ดเดิม ไม่ได้กันผู้ถือ service key (เหมือน D2) | A2 / เมื่อมี role จริง |
| D15 | `v_content_piece` ช้า ~4ms/แถว (ครึ่งจาก `can_approve` เรียก `approve_blockers` ทุกแถว · ครึ่งจาก lateral `mk` สแกน marker ซ้ำ) · `v_content_piece_calendar` ใช้ `p.*` จึงคำนวณครบทุกคอลัมน์ — หลายร้อยชิ้นจะเป็นวินาที (code review C2) | ตอนนี้ 26 แถว ~100ms | frontend **ต้องกรองด้วย shop + ช่วงวัน/สถานะเสมอ** · ปรับ view เมื่อชิ้นงานเกิน ~200 |
| D16 | โค้ดซ้ำที่ควรรวมเป็น helper ใน migration ถัดไป: เงื่อนไขข้าม guard (GUC + current_user) 6 ที่ · ขอบ posted_at 4 ที่ (รูปไม่เหมือนกัน) · ธง posted_before_approval 3 ที่ · `exception when others` reset GUC ที่ซ้ำซ้อนใน 0160 · `p.*` ใน view ปฏิทินไม่ตามคอลัมน์ใหม่ของ `v_content_piece` | พฤติกรรมถูกแล้ว (security GO) — เสี่ยงแค่ตอนมีคนเพิ่ม trigger/ด่านตัวที่ 7 แล้วลอกไปครึ่งเดียว | migration ถัดไปของสาย content |
| D17 | `content_piece_backfill_scope_` ค้างใน DB ถาวรหลัง backfill (verify X38 ใช้) · โพสต์ที่ไม่ผูกชิ้นยังรับ posted_at แปลกได้ถ้าเขียนตรงจาก service_role (ทางแอปปิดแล้ว) | ไม่มีผลต่อผู้ใช้ | ลบ helper เมื่อไม่ต้อง replay verify · ตัดสินเรื่องโพสต์นอกแผนเมื่อทำ backfill ย้อนหลัง |

## 11. เคาะ D8 — ✅ **เจ้าของเคาะทาง (ข)** 6 ต.ค. 69: hook ทุกตัว (ของเขา+ของเรา) อยู่ `content_hook` ตารางเดียว

**มติเจ้าของ** (ผ่าน Tech Lead): hook ของเขาและของเราอยู่ `content_hook` แยกด้วย `origin` ours/reference · capture คลิปอ้างอิงที่มี `hook_text` → สร้างแถว origin=`reference` ผูก `source_signal_id` อัตโนมัติ · `content_signal.hook_text/hook_type` **เลิกเป็นแหล่งจริง** · rollup "ประเภทไหนชนะ" นับเฉพาะ `origin='ours'` · ทำใน C2 ห้ามแก้ไฟล์ 0158 · เหตุผลที่ Tech Lead อธิบาย: (1) คลังบนจอต้องเห็นสองฝั่งในตารางเดียว (2) **คลิปเดียวมีหลาย hook ได้** — คอลัมน์เดียวบน signal รับได้ตัวเดียว (3) เส้นทางย้อน "hook ของเรา ← ถอดโครงจาก hook ตัวไหน" ต้องชี้ถึง**ตัว hook** ไม่ใช่แค่ตัวคลิป

ทาง (ก′) ที่ architect เสนอรอบแรก (signal เป็นแหล่งเดียวของ hook ของเขา · union ใน view) **ตกไป** — ข้อ (2)/(3) เป็นสิ่งที่ (ก′) ทำไม่ได้จริงโดยไม่เพิ่มตารางอยู่ดี · ของจริงตอนเคาะ: `content_signal` 0 แถว · `content_hook` 26 แถว ours ทั้งหมด ⇒ ไม่มีข้อมูลต้องย้าย

### 11.1 แหล่งจริงที่เดียว — ทำยังไงเมื่อ `content_signal.hook_text` ลบ/ว่างไม่ได้

ข้อจำกัดจาก 0158 ที่แก้ไฟล์ไม่ได้: `content_signal_kind_requirements_check` บังคับ `reference_clip` ต้องมี `hook_text` · `content_signal_capture` (32 พารามิเตอร์ apply แล้ว) รับ `p_hook_text/p_hook_type` · `v_content_signal` มีคอลัมน์ `hook_text/hook_type` (ตัดกลางไม่ได้ — trap #3)

| ทางเลือก | ตัด/เลือก | เหตุผล |
|---|---|---|
| **เลือก: `content_signal.hook_text/hook_type` = "ค่าตอนจับ" (input snapshot · เขียนครั้งเดียวตอน capture · ไม่มี RPC แก้)** · แหล่งจริง = แถว `content_hook` origin=reference · **แก้ข้อความ hook ได้ที่เดียว** = RPC `content_hook_reference_upsert` (ใหม่ 0159) · จอทุกจออ่าน hook จาก `content_hook` (ห้ามอ่าน `v_content_signal.hook_text` เป็น hook อีก — คง column ไว้เพื่อ trap #3 + ติด comment "snapshot ตอนจับ") | ✅ | ไม่ต้องแตะ CHECK/RPC/view ของ 0158 เลย · ข้อความ 2 ที่แต่**ความหมายต่างกันชัด** (ที่จับ vs ที่ใช้) ไม่ใช่ 2 แหล่งที่เถียงกัน — เหมือน `caption_snapshot` ของ content_post |
| sync 2 ทาง (แก้ hook → เขียนกลับ signal) | ✗ | = 2 แหล่งจริง · trigger ไขว้ |
| replace body `content_signal_capture` ให้ insert hook เอง | ✗ (เลือก trigger แทน) | ต้อง re-grant + re-verify RPC 32 พารามิเตอร์ที่เพิ่ง GO · และกันได้เฉพาะเส้นทาง capture — trigger กันทุกเส้นทาง insert (รวม seed/backfill วันหน้า) = กันด้วยโครงสร้าง |

### 11.2 สิ่งที่ 0159 ต้องทำ (ห้ามแก้ไฟล์ 0158 — ทุกข้อเป็น DDL ใหม่/drop+add ใน migration)

1. **`content_hook` CHECK ผ่อนให้ reference ไม่ต้องมี hook_type**: drop+add `content_hook_type_required_check` → `hook_type is not null or legacy_json_id is not null or origin = 'reference'` (capture รับ `p_hook_type` null ได้ · ติดประเภททีหลังผ่าน reference_upsert) · เพิ่ม `content_hook_reference_needs_signal_check`: `origin <> 'reference' or source_signal_id is not null` · `content_hook_reference_scope_check` เดิม (reference ไม่มี step/label) คงไว้
2. **คอลัมน์ใหม่ `content_hook.derived_from_hook_id uuid references content_hook(id) on delete set null`** + CHECK `derived_from_hook_id is null or origin = 'ours'` + index partial · = เส้นทางย้อน (3) · RPC ตรวจว่าแถวปลายทางเป็น reference ร้านเดียวกัน (CHECK ข้ามแถวทำไม่ได้)
3. **trigger `trg_content_signal_hook_mirror` AFTER INSERT on `content_signal`** · `when (new.hook_text is not null)` → insert `content_hook (shop_id, text, hook_type, origin='reference', source_signal_id=new.id, generated_by = case new.created_by_role when 'ai' then 'ai' else 'human' end, created_by=new.created_by)` · กันซ้ำ: unique partial `content_hook_reference_signal_text_uq on (source_signal_id, lower(text)) where origin='reference'` + `on conflict do nothing` · **INSERT เท่านั้น** — ไม่มี trigger บน UPDATE (ไม่มี RPC แก้ hook_text ของ signal อยู่แล้ว · ถ้าวันหน้ามี ต้องไม่ sync — แก้ที่ hook) · ลบ signal → `source_signal_id` set null (FK 0158) แถว reference ค้างไม่มีต้นทาง ⇒ trigger BEFORE DELETE on content_signal ลบ reference hook ของมันที่ `derived_from` ไม่มีใครอ้าง / ที่มีคนอ้างให้ raise 55000 "มี hook ของเราถอดโครงจากคลิปนี้" (fact ไม่หล่น)
4. **RPC `content_hook_reference_upsert(p_shop_id, p_signal_id, p_text, p_hook_type, p_actor_role, p_id uuid default null) returns uuid`** — เพิ่ม hook ตัวที่ 2..n ให้คลิปเดียว (ข้อ 2 ของเจ้าของ) · แก้ข้อความ/ติดประเภท (ส่ง p_id) · actor owner/ai/system · ai แก้แถว `generated_by='human'` ไม่ได้ (กติกาเดียวกับ `content_hook_upsert`) · signal ต้องร้านเดียวกัน + `kind='reference_clip'` · ซ้ำ (signal, lower(text)) = 23505 + id เดิม · ลบ: `content_hook_reference_delete(p_shop_id, p_id, p_actor_role)` owner เท่านั้น · มี `derived_from` ชี้มา = 55000
5. **RPC `content_hook_link_reference(p_shop_id, p_hook_id, p_reference_hook_id, p_actor_role)`** — ตั้ง `derived_from_hook_id` (+ `source_signal_id` = ของ reference นั้น) บน hook ours · ไม่แตะ signature `content_hook_upsert` (trap #1 — เพิ่ม param = overload)
6. **ด่านกัน "ใช้ซ้ำคำต่อคำ"** (comment 0158: hook ของเขาเก็บเพื่อถอดโครง): `content_piece_post`/`content_post_link_step` รับ `p_hook_id` ได้เฉพาะ `origin='ours' and step_id = p_step_id` — reference = 22023 "hook ของเขาใช้โพสต์ไม่ได้ ให้ถอดโครงเป็นของเราก่อน" · `v_content_hook_type_rollup` (C3) `where origin='ours'`
7. view `v_content_hook_library` (0160): `content_hook h left join content_signal s on s.id = h.source_signal_id` → `side = origin` · ours: step/label/derived_from · reference: `s.platform, s.views, s.account_followers, s.url, s.seen_on` (ผ่าน `v_content_signal` ไม่ได้เพราะ view ซ้อน view กับ security_invoker — join ตารางตรง) · ไม่มีชื่อคน
8. verify ต้องมีเคส: capture reference_clip → มี hook reference 1 แถว · capture ซ้ำ url = 23505 ไม่มี hook เพิ่ม · reference_upsert ตัวที่ 2 ได้ · `content_piece_post` ด้วย reference hook = 22023 · ลบ signal ที่มี derived_from = 55000

### 11.3 ปัญหาทางเทคนิคที่เห็น (เขียนไว้ตามสั่ง · ไม่เปลี่ยนมติ)

- **ข้อความ hook ของเขายังมี 2 สำเนาในระบบ** (`content_signal.hook_text` snapshot + `content_hook.text`) — ยอมรับเพราะเป็น snapshot/เจ้าของจริง ไม่ sync · แต่ **UI ต้องไม่แสดง `hook_text` ของ signal เป็น "hook"** ไม่งั้นแก้แล้วจอหนึ่งไม่เปลี่ยน → ใส่ใน brief frontend + comment column (`comment on column` ทำได้ใน 0159 แม้คอลัมน์มาจาก 0158)
- trigger เขียนตารางอื่นเงียบ = pattern ที่ reviewer ไม่ชอบ (บทเรียน 18.4) — ต่างกันตรงนี้เป็น INSERT ที่ตามรอยได้ (`source_signal_id`) ไม่ใช่ถอนสิทธิ์ · ถ้า security ตีกลับ ให้ย้ายไป replace body `content_signal_capture` (signature เดิม · drop ไม่ต้อง · re-grant) เป็น fallback ที่เตรียมไว้
- `content_hook_type_required_check` ผ่อนแล้ว reference มี `hook_type` null ได้ ⇒ rollup/ด่าน "≥2 ประเภท" กรอง `origin='ours'` อยู่แล้วไม่กระทบ · คลังบนจอต้องแสดง "ยังไม่ติดประเภท" ได้
- trap #14: trigger insert ส่งทุกคอลัมน์ที่ CHECK ของ content_hook อ้าง (origin · source_signal_id · step_id null · label null · generated_by) — ระบุชัดใน insert list


## 12. สเปก C2 (piece workflow) — พร้อมลงมือ · 2 ไฟล์ **0159** + **0160** (6 ต.ค. 69)

> ยืนยันกับ DB สดรอบบ่าย 6 ต.ค.: step ต.ค. **26** (`status=todo` ทุกแถว · artifact 1 ตัว/step: `todo/human` 13 · `draft_pending_review/ai_copywriter` 13 · `[ต้องยืนยัน: …]` อยู่ใน **`clip_brief` เท่านั้น** 11 artifact ไม่มีใน `content_body` · รูปแบบมี `:` เสมอ · ซ้ำกันในชิ้นเดียวได้ถึง 11 ครั้ง) · `content_signal` 0 · `content_hook` 26 ours · `content_post` 10 (`artifact_id` null ทั้งหมด) · `campaign` ที่ `anchor_date null` = **0** (ไอเดียแถวแรกจะเป็นเคสแรกของระบบ — R18) · trigger `set_updated_at` บน campaign/campaign_step/step_artifact/step_gate/content_post · signature เดิมทั้งหมดตาม §0.1 ไม่เปลี่ยน · step ต.ค. `channel null` 2 แถว (กินเจ/ออกพรรษา) · `trigger_kind='manual'` มีใน CHECK แล้ว (0057)

### 12.0 ขอบเขต · ทำไมแบ่ง 2 ไฟล์ · กติการ่วม

| ไฟล์ | เนื้อหา | ขนาด | ทำไมอยู่ไฟล์นี้ |
|---|---|---|---|
| **0159** `content_piece_workflow.sql` | คอลัมน์ `campaign_step` + CHECK · `step_gate` kind/detail · `content_post.step_id/hook_id` · `content_hook` CHECK D8 · ตาราง `content_piece_event` + `content_confirm_item` · trigger กันเส้นทางเดิม (R4) · RPC `content_piece_create` / `content_signal_pick` / `content_piece_set_plan` / `content_piece_advance` / `content_gate_record` / `content_confirm_extract` / `content_confirm_resolve` · view `v_content_piece` · **backfill 26 + extract 13** · ด่านท้ายไฟล์แบบ 0158 §16 | **L** (~1,400 บรรทัด) | ทุกอย่างที่ backfill และ verify ของมันต้องใช้ — apply ไฟล์เดียวแล้ว inbox กอง 2–3 + หน้า F ใช้ได้ |
| **0160** `content_piece_post_views.sql` | RPC `content_piece_post` / `content_post_link_step` / `content_post_unlink_step` / `content_piece_defer` · view `v_content_piece_calendar` · `v_content_inbox_counts` · `v_line_quota_28d` · `v_content_hook_library` (D8) | **M** (~700) | ไม่มี backfill · พึ่ง 0159 อย่างเดียว · security review แยกก้อน "ผูกโพสต์" ออกจาก "อนุมัติ" (คนละ threat) · 0159 ตีกลับ 0160 ไม่ต้องรื้อ |

ตัด: รวมไฟล์เดียว (~2,100 บรรทัด — verify ก้อนเดียวใหญ่เกินอ่าน · 0158 ที่ 1,400 บรรทัดใช้ review 3 รอบ) · แบ่ง 3 ไฟล์ (view แยกจาก RPC ที่มันต้องแสดงผล = verify ข้ามไฟล์)

กติการ่วมทุก object (ลอกจาก 0158 — ของจริงชนะเอกสาร): schema `analytics` · `shop_id` ทุกตาราง · RLS on + `tenant_isolation_select` · revoke public/anon/authenticated + grant **service_role เท่านั้น** (trap #18) · RPC `security definer` + `set search_path to 'public','analytics','extensions','pg_temp'` + `crm_require_owner_admin(p_shop_id)` + `content_actor_assert(...)` + `for update` แถว step ที่ `shop_id` ตรงใน where · ข้อความคน → `content_text_clean` · ลิงก์ → `content_url_ok` · errcode: `22023` อินพุตผิด · `42501` role ไม่มีสิทธิ์ · `23505` ซ้ำ · **`55000` (object_not_in_prerequisite_state) = เปลี่ยนสถานะไม่ได้/ด่านไม่ผ่าน** (ใหม่ — แอป map ข้อความไทยแยกจาก 22023) · คืน `jsonb` ไม่ใช่ `returns table` (trap #12) · ไฟล์ LF · idempotent · snapshot ต้นไฟล์ + ด่านท้ายไฟล์แบบ 0158 §0/§16 (GUC `c2.*`) · `notify pgrst, 'reload schema'` ท้ายไฟล์ · verify = `scripts/verify/verify-0159.sql` / `verify-0160.sql` do-block+raise + ตารางแมปบรีฟ→เทสต์ + `check-analytics-grants.sql` หลัง apply · "วันนี้" = `(now() at time zone 'Asia/Bangkok')::date` ทุกจุด

🔴 **ก่อนเขียน**: backend-dev รัน query §0 ทั้ง 5 ข้อ + ตัวเลขหัว §12 ซ้ำ ต่าง = หยุดรายงาน · **ห้ามแก้ 0158** · signature ใน §12.3–12.4 เป็น contract กับ frontend — เปลี่ยนต้องบอก

### 12.1 DDL — 0159

**`campaign_step` คอลัมน์ใหม่ (nullable ล้วน · `add column if not exists` · CHECK ชื่อ `campaign_step_<col>_check` drop-if-exists ก่อน add):**

| คอลัมน์ | ชนิด | CHECK (ทุกตัว `x is null or …`) |
|---|---|---|
| `piece_status` | text | `in ('idea','planned','drafting','in_review','approved','produced','posted','cancelled')` |
| `hold_reason` | text | `length between 1 and 500 and ~ '\S'` |
| `piece_kind` | text | `in ('short_clip','live_cut','ig_fb_post','line_message','story')` |
| `time_slot` | text | `in ('morning','afternoon','before_live','during_live')` |
| `customer_group` | text | `in ('jewelry_925','silver_bar')` — คนละคอลัมน์กับ `audience_segment` (CRM) ห้ามยุบ |
| `hypothesis` | text | `length between 1 and 1000` |
| `metric_code` | text | `in ('save_rate','share_rate','peak_viewers','line_reply_count','none')` |
| `baseline_value` · `pass_threshold` | numeric | `(x >= -1000000000000 and x <= 1000000000000)` — not(between) ฆ่า NaN/Inf (trap #4) |
| `baseline_spread` | numeric | `(x >= 0 and x <= 1000000000000)` |
| `baseline_as_of` | date | ตรวจ "ไม่เกินวันไทยวันนี้" ใน RPC (now() ใส่ CHECK ไม่ได้) |
| `baseline_note` | text | `length <= 500` |
| `pass_op` | text | `in ('>=','<=')` |
| `footage_status` | text | `in ('needs_shoot','has_footage','shot')` |
| `footage_url` | text | `analytics.content_url_ok(footage_url)` |
| `shoot_note` | text | `length <= 1000` |
| `shoot_location` | text | `in ('factory','product_table','host_cam','other')` |
| `shoot_minutes_est` | int | `between 1 and 600` |
| `shoot_date` | date | — |
| `expected_host_id` | uuid | FK **composite** `(shop_id, expected_host_id) → live_host (shop_id, id)` ลอก block `$c1fk$` ของ 0158 §2 (ดูชื่อ unique index จริงจาก `pg_indexes` ก่อน) · `on delete no action` (ปิดโฮสต์ด้วย `is_active` แทนลบ) |
| `drafted_by_ai` | boolean | — (null = ไม่รู้ · backfill ตั้ง true/false ชัด) |
| `line_audience` | text | `in ('all','segment')` **+** `campaign_step_line_audience_scope_check`: `line_audience is null or piece_kind = 'line_message'` **+** `campaign_step_line_audience_reason_check`: `line_audience is distinct from 'segment' or (audience_segment is not null and line_audience_reason is not null)` — มติเจ้าของ 6 ต.ค.: broadcast ส่งทุกคนเป็นค่าเริ่มต้น · "เฉพาะกลุ่ม" ต้องระบุกลุ่ม (คอลัมน์ `audience_segment` เดิม) + เหตุผล (ส่วนลด/exclusive) |
| `line_audience_reason` | text | `length between 1 and 300` |

CHECK ข้ามคอลัมน์ที่**ไม่ใส่**ระดับตาราง (อยู่ใน RPC แทน — backfill ต.ค. ไม่มี hypothesis/kind · ไม่อยากล็อกแถว legacy): ≥ planned ต้องมี hypothesis · piece_kind ↔ channel · approved ต้องผ่านด่าน

**CHECK เดิมที่ขยาย (drop+add ชื่อจริงจาก pg_constraint ✅):** `campaign_step_channel_check` += `'tiktok'`, `'instagram'` (5 → 7 · ค่าเดิมคงลำดับ) · `step_gate_gate_kind_check` += `'fact_check'`, `'brand_rule'`, `'risk_owner'` · **ไม่แตะ** `step_artifact_artifact_type_check` (ตัด `'story'` จาก §5.3 — ชิ้น story ใช้ artifact `fb_post` เก็บแคปชัน · YAGNI) · ไม่แตะ `campaign.primary_channels`

**`step_gate` เพิ่ม:** `detail jsonb` (`detail is null or jsonb_typeof(detail) = 'object'` — trap #13) · `checked_by_role text` (`in ('owner','ai','system')`) · PK เดิม `(step_id, gate_kind)` ใช้ upsert (Δ6)

**`content_post` เพิ่ม:** `step_id uuid references campaign_step(id) on delete set null` · `hook_id uuid references content_hook(id) on delete set null` · index partial ทั้งคู่ · **ไม่มี backfill** (Δ4 · verify assert `count(*) filter (where artifact_id is not null) = 0` ก่อน) · ไม่ใส่ unique บน step_id — ชิ้น `ig_fb_post` โพสต์ได้ 2 แพลตฟอร์ม (ชื่อ step จริง "IG+FB cross")

**`content_hook` (D8 ทาง ข — §11.2):** drop+add `content_hook_type_required_check` (ผ่อน reference) · เพิ่ม `content_hook_reference_needs_signal_check` · คอลัมน์ `derived_from_hook_id` + CHECK + index · unique partial `content_hook_reference_signal_text_uq` · trigger `trg_content_signal_hook_mirror` (AFTER INSERT บน `content_signal`) + trigger BEFORE DELETE กันลบคลิปที่มี hook ถอดโครงอ้างอยู่ · RPC `content_hook_reference_upsert` / `content_hook_reference_delete` / `content_hook_link_reference` · `comment on column content_signal.hook_text` = "snapshot ตอนจับ ไม่ใช่แหล่งจริง"

**ตารางใหม่ `content_piece_event`** (append-only): `id uuid pk · shop_id · step_id → campaign_step on delete cascade · event_kind check in ('create','advance','revert','hold','resume','defer','cancel','restore','post','unpost','gate','confirm','plan') · from_status · to_status · reason (≤500) · actor_role check in ('owner','ai','system') · actor_uid uuid (= auth.uid() · null จนกว่า A2) · review_seconds int (`>= 0 and <= 86400`) · payload jsonb (`jsonb_typeof='object'`) · created_at` · index `(step_id, created_at desc)` · trigger `trg_content_piece_event_append_only` BEFORE UPDATE OR DELETE → `raise … errcode '42501'` (ลอกแนว `crm_audit_log_append_only`) · ไม่มี updated_at · RLS select เท่านั้น

**ตารางใหม่ `content_confirm_item`:** `id uuid pk · shop_id · step_id → campaign_step cascade · key text (= md5(content_text_clean(question))) · question text (1–500) · answer text (≤1000) · resolved_at · resolved_by_role · removed_at (ข้อความถูกแก้จนไม่พบ marker แล้ว) · created_at · updated_at + trigger` · `unique (step_id, key)` · CHECK `(answer is null) = (resolved_at is null)`

**ไม่มี** ตาราง idea · รอบถ่าย · month_mix (§6)

### 12.2 RPC สร้าง/ตั้งแผน — 0159

**`content_piece_create(p_shop_id uuid, p_title text, p_piece_kind text, p_channel text, p_customer_group text, p_actor_role text, p_date date default null, p_source_signal_id uuid default null, p_campaign_id uuid default null) returns uuid`** (step_id)
- ทางเดียวที่สร้าง step ของ workflow ใหม่ (ไม่เรียก `campaign_create_task` — บังคับ p_date + ตั้ง `status='scheduled'`) · actor: owner/ai/system — **ai สร้างได้เฉพาะ `piece_status='idea'`** (ส่ง p_date มา = 22023 "AI วางปฏิทินเองไม่ได้")
- `p_campaign_id` null → insert wrapper `campaign` (`campaign_type='content_task'`, `trigger_kind='manual'`, `status='scheduled'`, `anchor_date = p_date` (null ได้ — Δ1), name=title) + step `seq=1, offset_start_days=0, offset_end_days=0, step_kind='content_task', origin='manual', status='todo'` · ไม่ null → campaign ต้องอยู่ร้านเดียวกัน + ถ้า p_date ไม่ null ต้องมี anchor (offset = p_date − anchor) · p_date null + campaign มี anchor → raise 22023 (step ใน campaign จริงต้องมีวัน)
- `piece_status` = `'idea'` เมื่อ p_date null · `'planned'` เมื่อมี p_date **และ** ผู้เรียก owner (planned ไม่ต้องมี hypothesis ตอนสร้างผ่านทางนี้ — เหมือน backfill · hypothesis บังคับที่ advance idea→planned เท่านั้น) · `line_audience='all'` อัตโนมัติเมื่อ `piece_kind='line_message'` (ค่าเริ่มต้นตามมติ)
- ตาราง kind↔channel (ใช้ซ้ำใน set_plan/post/link): `short_clip→tiktok` · `live_cut→tiktok` · `ig_fb_post→facebook|instagram` · `line_message→line_oa` · `story→instagram|facebook` — ไม่ตรง = 22023 · artifact ที่สร้างให้ (owner_role 'owner' · status 'todo'): `short_clip→short_form_clip` · `live_cut→live_highlight_clip` · `ig_fb_post|story→fb_post` · `line_message→broadcast_script_line`
- `p_source_signal_id` → ต้องเป็น signal ร้านเดียวกัน (ลิงก์เก็บใน event `create` payload `{signal_id}` — ตัว signal ถูก set picked ใน `content_signal_pick` ไม่ใช่ที่นี่) · insert event `create`

**`content_signal_pick(p_shop_id, p_signal_id, p_title, p_piece_kind, p_channel, p_customer_group, p_actor_role) returns uuid`** = `for update` แถว signal (ร้านตรง · status ต้อง `new`/`deferred` — `picked` = 55000 พร้อม `picked_step_id` ใน detail · `rejected` = 55000 "ไม่ใช้แล้ว ถ้าจะกลับใช้ set_status ก่อน") → `content_piece_create(... p_date null, p_source_signal_id)` → `update content_signal set status='picked', picked_step_id, status_reason=null, updated_by` ในทรานแซกชันเดียว · **ไม่เรียก `content_signal_set_status`** (มันกัน picked โดยตั้งใจ) · actor owner/ai/system

**`content_piece_set_plan(p_shop_id, p_step_id, p_set jsonb, p_actor_role) returns jsonb`** (คืน `{step_id, piece_status, resolved_start, changed:[keys]}`)
- `p_set` = object; key ที่รับ: `date` · `start_time` · `time_slot` · `piece_kind` · `channel` · `customer_group` · `hypothesis` · `metric_code` · `baseline_value` · `baseline_as_of` · `baseline_note` · `pass_threshold` · `pass_op` · `baseline_spread` · `expected_host_id` · `line_audience` · `line_audience_reason` · `footage_status` · `footage_url` · `shoot_note` · `shoot_location` · `shoot_minutes_est` · `shoot_date` · `content_type_code` (ผ่าน validation เดียวกับ `campaign_step_set_content_type` — มีใน content_type) · **key นอกรายการ = 22023** (กัน typo เงียบ) · key ที่ไม่ส่ง = ไม่แตะ · `jsonb_typeof(v)='null'` = ล้างค่า (trap #13 — ห้าม `->> is null`) · ตัวเลข cast จาก text: `'NaN'::numeric` ผ่าน cast ⇒ ด่าน not(between) ทุกตัว
- ใครแก้ได้เมื่อไหร่: `piece_status` null → 22023 "นอก workflow ใหม่" (หนี้ D10) · idea/planned/drafting/in_review: owner ทุก key · **ai แก้ได้เฉพาะตอน idea และเฉพาะ key** hypothesis/metric_code/baseline_*/pass_*/shoot_minutes_est/footage_status (AI เสนอสมมติฐานใน Triage · ตัดสิน = owner ✓) · approved/produced: owner แก้ได้เฉพาะ time_slot/start_time/expected_host_id/footage_*/shoot_* (ของที่ไม่เปลี่ยนเนื้อหาที่อนุมัติ) — key อื่น = 55000 "อนุมัติแล้ว ส่งกลับก่อน" · posted/cancelled: 55000 ทุก key ยกเว้น footage_url/shoot_note
- `date`: step ใน wrapper `content_task` 1 step → `update campaign set anchor_date` (ทางเดียวกับ `campaign_reschedule_step`) · step ใน campaign หลาย step ที่มี anchor → ตั้ง offset_start/end · campaign หลาย step ที่ anchor null → 22023 · `date` ใช้ได้เฉพาะ idea/planned (เลื่อนหลังจากนั้น = `content_piece_defer` 0160 ที่บันทึก event) · ตั้ง `date` ไม่เปลี่ยน piece_status เอง (idea ยังเป็น idea จนกด advance planned — "ไอเดียที่หยิบนอกรอบไปรอในหน้าคัดไอเดีย")
- validation เหมือน CHECK + เพิ่ม: `baseline_as_of <= วันไทย` · piece_kind↔channel ตารางข้างบน (ตรวจคู่ที่จะเป็น**หลัง**อัปเดต) · `line_audience='segment'` ต้องมี audience_segment (คอลัมน์เดิม — ตั้งผ่าน key? **ไม่เปิด** — audience_segment ผูก RFM live_count ของบอร์ดเก่า ให้ตั้งผ่าน UI เดิม/SQL ก่อน · ถ้าไม่มี = 22023 บอกชัด) · `expected_host_id` ต้อง live_host ร้านเดียวกัน `is_active`
- หลัง UPDATE: insert event `plan` payload = `{changed: {key: {from, to}}}` (เหตุผลที่เก็บ diff: "แก้ตัวเลขฐานหลังตั้งแล้ว" ต้องตามรอยได้ — F6 snapshot) · `updated_by = auth.uid()`

### 12.3 `content_piece_advance` — เครื่องยนต์สถานะ (0159)

**signature**: `content_piece_advance(p_shop_id uuid, p_step_id uuid, p_to text, p_actor_role text, p_reason text default null, p_review_seconds int default null) returns jsonb` (`{step_id, from, to, status_projected, hold_reason, event_id}`) — มี `p_shop_id` นำหน้าตามแบบ 0158 (brief Tech Lead ละไว้ · เพิ่มเพราะ security L2 ของ 0150: where ต้องผูก shop ตั้งแต่ lock) · **helper ภายใน** `content_piece_transition_(p_shop_id, p_step_id, p_to, p_actor_role, p_reason, p_review_seconds, p_post_id uuid)` ทำงานจริง · `content_piece_advance` = เรียก helper ด้วย `p_post_id null` · `content_piece_post` (0160) เรียก helper ด้วย post id ที่เพิ่งผูก ⇒ ไม่มีธง bypass — helper ตรวจว่า `content_post.id = p_post_id and step_id = p_step_id and status='active'` จริง (grant helper ให้ service_role เหมือนตัวอื่น — ไม่มี role อื่นเรียกได้อยู่แล้ว)

ลำดับใน body: validate input → `crm_require_owner_admin` → `content_actor_assert(p_actor_role, allowed ต่อ p_to)` → `select … from campaign_step s join campaign c … where s.id = p_step_id and s.shop_id = p_shop_id for update of s` (ไม่พบ = 22023) → `piece_status is null` = 22023 "ชิ้นงานนี้อยู่นอก workflow ใหม่ (ก่อน 1 ต.ค. หรือสร้างจากบอร์ดเดิม)" → `hold_reason is not null and p_to not in ('resume','cancelled')` = 55000 "ชิ้นงานรอเงื่อนไขอยู่ กด resume ก่อน" → ตารางด้านล่าง → UPDATE step (`piece_status`, `hold_reason`, `status` projected, `blocked_reason`, `updated_by`) → insert event → return

**ตารางลำดับ (เดินหน้า = ขั้นถัดไปเท่านั้น · ย้อน = ขั้นก่อนหน้า 1 ขั้นเท่านั้น · นอกตาราง = 55000 "จาก X ไป Y ไม่ได้")**

| from → `p_to` | actor | ด่าน (ไม่ผ่าน = 55000 ข้อความบอกสาเหตุ) | projection `status` / `blocked_reason` | event |
|---|---|---|---|---|
| idea → planned | owner | `resolved_start` ไม่ null (anchor ตั้งแล้ว) · `piece_kind`,`channel`,`customer_group` ไม่ null · `metric_code` ไม่ null · ถ้า ≠ 'none': `hypothesis` ไม่ว่าง + `baseline_value`,`pass_threshold`,`pass_op` ไม่ null (ตรวจ `is null` ตรงๆ ได้ — ค่า 0 คือค่าจริง trap #13) · `line_message` ต้องมี `line_audience` | `scheduled` | advance |
| planned → drafting | owner/ai/system | — | `active` | advance |
| drafting → in_review | owner/ai/system | เฉพาะ `piece_kind in ('short_clip','live_cut')`: `count(distinct hook_type) filter (where hook_type is not null) >= 2` จาก `content_hook where step_id = … and origin='ours' and label is not null` (R19: ข้อความบอก "hook ยังไม่ติดประเภท n ตัว") **และ** artifact clip ของ step มี `jsonb_typeof(clip_brief->'shots')='array' and jsonb_array_length(...) > 0` · kind อื่น: artifact ของ step ต้องมี `content_body ~ '\S'` อย่างน้อย 1 ตัว · ถ้า actor='ai' หรือ 'system' → `drafted_by_ai := true` · **เรียก `content_confirm_extract` ให้อัตโนมัติ** (รายการรอตอบครบตั้งแต่เข้าคิว) | `active` | advance |
| in_review → approved | **owner เท่านั้น** (42501) | (1) `step_gate` ครบ 3 kind `fact_check`,`brand_rule`,`risk_owner` และทุกตัว `status in ('passed','na')` — แถวหาย = ไม่ผ่าน (2) `content_confirm_item` ไม่มีแถว `resolved_at is null and removed_at is null` (3) regex `\[ต้องยืนยัน` **ไม่พบ**ใน `content_body` และ `clip_brief::text` ของ artifact ทุกตัวของ step (ชั้นที่ DB พิสูจน์เอง) (4) `piece_kind` ไม่ null (ของ backfill ที่ยังไม่ติด kind อนุมัติไม่ได้ — บอกชัด) · `p_review_seconds` บันทึกลง event (null ได้ · <60 ไม่บล็อก) · หลังผ่าน: artifact ของ step ที่ `status in ('draft_pending_review','draft','todo')` → set `status='approved', reviewed_at=now(), reviewed_by=auth.uid()` (projection ฝั่ง artifact — บอร์ดเก่าเห็น "approved" · UPDATE นี้ยิง trigger กัน R4 ⇒ trigger ต้องปล่อยเมื่อ GUC `c2.piece_rpc='1'` ที่ helper ตั้ง `set_config(..., true)` ก่อน UPDATE — ดู §12.5) | `active` | advance (`payload.gates` = snapshot 3 ด่าน) |
| approved → produced | owner | — (`footage_url`/`shoot_note` ตั้งผ่าน set_plan ไม่บังคับ) · set `footage_status='shot'` ถ้าเดิม `needs_shoot` | `active` | advance |
| approved/produced → posted | owner | **kind ไม่มี URL** (`line_message`,`story`): ผ่านได้ด้วย `p_post_id null` · event payload `{posted_at: now()}` · **kind มี URL** (`short_clip`,`live_cut`,`ig_fb_post`): ต้องมี `p_post_id` ที่ผูก step นี้แล้ว (มาจาก `content_piece_post` เท่านั้น) · `p_post_id null` = 55000 "ชิ้นนี้ต้องวางลิงก์ผ่าน content_piece_post" · artifact → `status='done'` (projection) | `done` | post (`payload.post_id`) |
| planned → idea · drafting → planned · in_review → drafting | owner (in_review→drafting: **reason บังคับ** = ส่งกลับแก้ · ai ส่งกลับไม่ได้) | — · ส่งกลับ: artifact `draft_pending_review` → `draft` (projection) | idea:`todo` · planned:`scheduled` · drafting:`active` | revert |
| approved → in_review · produced → approved | **owner + reason บังคับ** | — · approved→in_review: artifact `approved` → `draft` + `reviewed_at/by` คงไว้ (ประวัติ) · gate 3 ตัวคงค่า (ไม่ล้าง — เนื้อหายังไม่เปลี่ยน · trigger §12.5 ล้างเมื่อเนื้อหาเปลี่ยนจริง) | `active` | revert |
| posted → produced (หรือ approved ถ้า kind ไม่มี URL) | owner + reason | kind มี URL: ต้องไม่มี `content_post` ที่ `step_id = … and status='active'` (ต้อง `content_post_set_status('deleted')` หรือ `content_post_unlink_step` ก่อน) · artifact `done` → `approved` | `active` | unpost |
| ใดๆ ที่ไม่ใช่ posted/cancelled → `hold` | owner | **reason บังคับ** · piece_status **ไม่เปลี่ยน** · `hold_reason := reason` | `blocked` / `blocked_reason := reason` | hold |
| มี hold_reason → `resume` | owner | `hold_reason := null` | projection ของ piece_status ปัจจุบัน / `blocked_reason := null` | resume |
| ใดๆ ที่ไม่ใช่ posted → `cancelled` | owner | **reason บังคับ** · `hold_reason := null` · ถ้ามาจากสัญญาณ (event create payload.signal_id) **ไม่**แตะ signal (เจ้าของตัดสินใจแยกผ่าน set_status) | `blocked` / `'ยกเลิก: ' || reason` | cancel (`payload.from_status`) |
| cancelled → `restore` | owner + reason | กลับไป `from_status` ของ event cancel ล่าสุด (อ่านจาก event ไม่เดา) · posted ไม่เคยถูก cancel ได้จึงไม่มีเคสกลับเป็น posted | projection ของสถานะที่กลับไป | restore |

กติกาข้ามแถว: `p_to` นอกชุด {8 สถานะ, hold, resume, restore} = 22023 · `p_to = piece_status ปัจจุบัน` = 55000 "อยู่สถานะนี้แล้ว" (ไม่ no-op เงียบ — กันกดซ้ำแล้วนึกว่าทำงาน) · actor `ai`/`system` ทำได้แค่ planned→drafting และ drafting→in_review (อื่น = 42501) · `p_reason` ผ่าน `content_text_clean` ≥ 3 ตัวอักษรเมื่อบังคับ · `p_review_seconds` ใช้ได้เฉพาะ approved (ที่อื่นส่งมา = 22023) · ทุกทางเขียน `updated_by = auth.uid()`

**ทำไมไม่ 8 ฟังก์ชัน**: §3.5 (ตารางลำดับอยู่ที่เดียว) · ทำไม hold เป็น overlay ไม่ใช่สถานะ: กลับมาแล้วต้องรู้ว่าค้างขั้นไหน (brief §3.1) — ถ้าเป็นสถานะต้องเก็บ "สถานะก่อน hold" เพิ่มอีกคอลัมน์

### 12.4 3 ด่าน + `[ต้องยืนยัน]` — 0159

**`content_gate_record(p_shop_id, p_step_id, p_gate_kind, p_status, p_actor_role, p_detail jsonb default null, p_note text default null) returns jsonb`**
- `p_gate_kind in ('fact_check','brand_rule','risk_owner')` เท่านั้น (gate โปรโม 5 ตัวเดิมยังใช้ `campaign_pass_gate` — ไม่แตะ) · `p_status in ('pending','passed','blocked','na')` (CHECK เดิม · `blocked` = ⚠️ ติด) · step ต้อง `piece_status is not null` + lock
- **`risk_owner` → `passed`/`na` เฉพาะ `p_actor_role='owner'`** (ai/system = 42501 "ความเสี่ยง เจ้าของตอบเท่านั้น") · ai ตั้ง risk_owner ได้แค่ `pending`/`blocked` + `p_detail.question` (text บังคับเมื่อ ai ตั้ง) → แถวนี้คือ "คำถามถึงเจ้าของ" ใน inbox กอง 4 (view 0160 นับจาก `step_gate` ตรง — **ไม่** insert `recommendation_log` ใน C2 · ตัดจาก §5.5 เพื่อไม่แตะ 0101 รอบนี้ · ย้ายไป C3 พร้อม `related_step_id`)
- `fact_check`/`brand_rule`: owner/ai/system ตั้งได้ทุกค่า · `p_detail` รูป: fact `{sources:[url…], flagged:[text…]}` · brand `{rules_hit:[code…]}` · risk `{question:text, answer:text}` — ตรวจ `jsonb_typeof='object'` + ทุก url ใน sources ผ่าน `content_url_ok` + ข้อความผ่าน `content_text_clean` (เขียนกลับค่าที่ clean แล้ว) · ขนาด `length(p_detail::text) <= 8000`
- บันทึกเมื่อ step อยู่ `drafting`/`in_review` เท่านั้น (approved แล้วแก้ด่าน = 55000 "ส่งกลับก่อน" · idea/planned ยังไม่มีร่างให้ตรวจ = 55000)
- upsert `insert … on conflict (step_id, gate_kind) do update` — **trap #14**: insert list มี `shop_id, step_id, gate_kind, status, note, detail, checked_by_role, passed_by, passed_at` ครบ · `passed_at/passed_by` = now()/auth.uid() เมื่อ passed/na ไม่งั้น null · event `gate` payload `{gate_kind, status}`

**`content_confirm_extract(p_shop_id, p_step_id, p_actor_role default 'system') returns jsonb`** (`{found, inserted, reopened, removed}`)
- regex **`\[ต้องยืนยัน\s*:?\s*([^\]]*)\]`** (`g`) บน `content_body` และ `clip_brief::text` ของ artifact ทุกตัวของ step (ของจริง: marker อยู่ใน clip_brief เท่านั้น · มี `:` เสมอ · ยอมรับไม่มี `:` ด้วย — question = '(ไม่ระบุ)' ) · `clip_brief::text` ของ jsonb ไม่ escape ตัวไทย ⇒ regex ตรงได้ · `\"` ข้างในข้อความ = ข้อความมี `"` — clean แล้วเก็บ
- `question := content_text_clean(m[1])` ตัดที่ 500 · `key := md5(question)` · ซ้ำในชิ้นเดียว (ของจริง 11 ครั้ง/ชิ้น) = 1 แถว · upsert on `(step_id, key)`: ใหม่ → insert · เดิมที่ `removed_at not null` และกลับมาพบ → `removed_at := null` (reopened · **answer/resolved คงไว้** ถ้าเคยตอบ — ข้อความเดิมถูกแก้แล้วโผล่ใหม่ = ต้องตอบใหม่? **ไม่** — ให้ถือว่าค้าง: set `answer=null, resolved_at=null` เพราะ marker โผล่ใหม่แปลว่าคำตอบเก่าไม่ได้ถูกใส่ลงข้อความ) · แถวที่ key ไม่พบรอบนี้และยังไม่ removed → `removed_at := now()`
- step ต้อง `piece_status is not null` · ทุก role เรียกได้ (read+derive · ไม่ตัดสิน) · event `confirm` payload `{found, inserted}` เฉพาะเมื่อมีการเปลี่ยน
- ทำงานบนข้อมูลเก่า (trap #17): verify ยิงใส่ 13 step in_review จริง → 11 ชิ้นได้แถว · 2 ชิ้นได้ 0 · `step_artifact` ไม่ถูกแตะ (md5 เท่าเดิม)

**`content_confirm_resolve(p_shop_id, p_item_id, p_answer, p_actor_role) returns jsonb`** (`{item_id, replaced_in_artifacts, remaining_pending}`) — **owner เท่านั้น** (§9.1 Q2)
- `p_answer` clean ≥ 1 ≤ 1000 · ห้ามมี `[ต้องยืนยัน` ในคำตอบ (22023 — ไม่งั้นแทนแล้ววนลูป) · item ต้อง `resolved_at is null and removed_at is null` (ตอบแล้ว = 55000 · ถูกลบไปแล้ว = 55000 "ข้อความถูกแก้แล้ว ไม่มีอะไรให้ตอบ")
- **แทนที่ข้อความจริง**: ทุก artifact ของ step — `content_body := regexp_replace(content_body, pattern_ของ_key, p_answer, 'g')` · `clip_brief := regexp_replace(clip_brief::text, pattern, v_answer_json, 'g')::jsonb` โดย `v_answer_json := trim(both '"' from to_jsonb(p_answer)::text)` (escape ให้ถูก jsonb) · pattern = `\[ต้องยืนยัน\s*:?\s*` || `regexp_escape(question)` || `\s*\]` — ไม่มี `regexp_escape` ใน PG ⇒ escape เองด้วย `regexp_replace(question, '([.^$|()\[\]{}*+?\])', '\\1', 'g')` · เทียบ**หลัง clean** ⇒ ข้อความในไฟล์ที่มี whitespace ต่าง อาจไม่ match → นับ `replaced_in_artifacts`; ถ้า 0 = 55000 "หา marker ในข้อความไม่เจอ (ข้อความถูกแก้แล้ว?) ให้รัน extract ใหม่"
- หลังแทน: `assert_clip_brief_valid(clip_brief)` ทุก artifact ที่แตะ (รูปทรงต้องยังถูก) · set `human_edited = true`, `updated_by` · จากนั้น set item `answer, resolved_at=now(), resolved_by_role` · **เรียก `content_confirm_extract` ซ้ำ** (ให้ key อื่นที่เผลอหายไปด้วย/โผล่ใหม่ ถูกจัดสถานะ) · event `confirm` payload `{item_id, key}`
- ทำไมแทนในข้อความ ไม่ใช่แค่จดคำตอบ: ด่าน approve ชั้น 2 (regex ในข้อความ) ต้องผ่านได้ด้วยการตอบ 1 ครั้ง — ถ้า RPC จดอย่างเดียว เจ้าของต้องไปแก้ storyboard เองอีกรอบ ขัด "อนุมัติทั้งชุด 2–3 นาที/ชิ้น"
- UPDATE artifact นี้ยิง `trg_step_artifact_updated_at` (ถูกต้อง — คนแก้จริง) และ trigger กัน R4 (§12.5) ต้องปล่อยผ่าน (GUC `c2.piece_rpc`) และ **ไม่** ล้าง gate fact/brand (คำตอบของเจ้าของไม่ใช่เนื้อหาใหม่จาก AI) — ระบุใน trigger: ล้างเฉพาะเมื่อ GUC ไม่ได้ตั้ง

### 12.5 สองแหล่งสถานะต้องไม่เถียงกัน (R3/R4) — เลือก "ปิดเส้นทางเดิมสำหรับ step ที่มี piece_status" ไม่ใช่ sync

| ทาง | ตัด/เลือก | เหตุผล |
|---|---|---|
| **ปิด**: trigger บน `step_artifact` BEFORE UPDATE OF `status` — ถ้า step ของมัน `piece_status is not null` และ GUC `c2.piece_rpc` ไม่ใช่ `'1'` → raise 55000 "ชิ้นงานนี้อยู่ใน workflow ใหม่ — เปลี่ยนสถานะผ่านหน้าชิ้นงาน" · `campaign_set_artifact_status` (บอร์ดเก่า) จึงล้มเฉพาะ 26+ step ใหม่ · step ก่อน ต.ค. ทำงานเหมือนเดิม | ✅ | map artifact 6 ค่า → piece 8 ค่า **lossy** (`done` = produced หรือ posted? `draft` = drafting หรือส่งกลับ?) และบอร์ดเก่าจะกด approved โดยข้าม 3 ด่าน = ปัญหาเดิม brief §12 ข้อ 1 กลับมา · projection ทิศเดียว (piece → status/artifact.status) ใน RPC ใหม่ก็พอให้บอร์ดเก่า**อ่าน**ถูก |
| sync 2 ทาง | ✗ | ข้างบน |
| ไม่ทำอะไร (หวังว่า UI ซ่อนปุ่ม) | ✗ | วินัยไม่ใช่ด่าน · AI agent เรียก `campaign_set_artifact_status('approved')` ได้ตรง |

**trigger ชุด R4 (ทั้งหมดใน 0159 · ฟังก์ชัน `analytics.content_piece_guard_artifact()` / `…_guard_step()`):**

1. `trg_step_artifact_piece_guard` **BEFORE UPDATE** on `step_artifact` for each row:
   - อ่าน `piece_status` ของ `new.step_id` (ไม่ lock — trigger อยู่ในทรานแซกชันของผู้เขียนอยู่แล้ว)
   - `piece_status is null` → return new (นอก workflow ไม่ยุ่ง)
   - GUC `current_setting('c2.piece_rpc', true) = '1'` → return new (RPC ของ workflow เป็นคนเขียน — helper ตั้ง `set_config('c2.piece_rpc','1',true)` ก่อน UPDATE และ `set_config('c2.piece_rpc','',true)` หลัง ใน block `begin … exception when others then reset+re-raise` · `true` = หมดอายุพร้อมทรานแซกชัน)
   - `new.status is distinct from old.status` → raise 55000 (ข้อความบน)
   - `(new.content_body, new.clip_brief) is distinct from (old.content_body, old.clip_brief)`: `piece_status in ('approved','produced','posted')` → raise 55000 "อนุมัติแล้ว ห้ามแก้เนื้อหา — ส่งกลับ (in_review) ก่อน" · `piece_status in ('drafting','in_review')` → ปล่อย แต่ตั้งธง `new.human_edited` ตามเดิมของ 0057 (ไม่แตะ) และ **AFTER UPDATE** trigger ข้อ 2 ทำงาน · `idea/planned/cancelled` → ปล่อย (ร่างก่อนเวลาได้)
2. `trg_step_artifact_piece_stale` **AFTER UPDATE OF content_body, clip_brief** on `step_artifact`: เมื่อ piece `in ('drafting','in_review')` และ GUC ไม่ใช่ '1' และเนื้อหาเปลี่ยนจริง → `update step_gate set status='pending', note = coalesce(note,'') || ' [เนื้อหาเปลี่ยน ' || to_char(now() at time zone 'Asia/Bangkok','DD/MM HH24:MI') || ']' where step_id = new.step_id and gate_kind in ('fact_check','brand_rule') and status in ('passed','na')` (risk_owner **ไม่ล้าง** — คำตอบของเจ้าของเรื่องความเสี่ยงไม่ขึ้นกับถ้อยคำ) + `perform content_confirm_extract(new.shop_id, new.step_id, 'system')` · เหตุผลที่ทำใน trigger: `campaign_ai_draft_artifact`/`campaign_set_artifact_content` (0057/0058) ยังเป็นทางเขียนเนื้อหา — ไม่ replace ทั้งสองตัว (signature เดิม · โค้ดแอปเรียกอยู่) ⇒ ด่าน "ร่างใหม่แล้วผลตรวจเก่าต้องตก" ต้องอยู่ที่ตาราง
3. `trg_campaign_step_piece_guard` **BEFORE DELETE** on `campaign_step`: `old.piece_status in ('approved','produced','posted')` → raise 55000 "ลบไม่ได้ — ยกเลิก (cancelled) แทน" (ประวัติ event/post ต้องไม่หาย — cascade จะลบ event ทั้งหมด) · idea/planned/drafting/in_review/cancelled ลบได้ผ่าน `campaign_delete_step` เดิม (origin manual เท่านั้นตามเดิม)
4. `trg_campaign_step_piece_status_guard` **BEFORE UPDATE OF status, piece_status** on `campaign_step`: GUC ไม่ใช่ '1' และ `new.piece_status is distinct from old.piece_status` → raise 55000 (piece_status เขียนได้ผ่าน RPC workflow เท่านั้น — กัน service_role เขียนตรง/UPDATE มือ) · `new.status is distinct from old.status` และ `old.piece_status is not null` → raise 55000 (status ของ step ใหม่เป็น projection ห้ามแก้ตรง — `campaign_create_from_template`/`campaign_create_task` insert ไม่โดนเพราะเป็น INSERT) · **backfill ใน 0159 ปิด trigger นี้คร่อม UPDATE** พร้อมกับ `trg_campaign_step_updated_at`

**projection สรุป** (ใช้ใน helper ทุกทาง — verify assert ทุก transition): `idea→todo` · `planned→scheduled` · `drafting/in_review/approved/produced→active` · `posted→done` · hold→`blocked`+reason · `cancelled→blocked`+`'ยกเลิก: …'` · artifact.status: in_review→`draft_pending_review` (ถ้า ai) / `draft` (ถ้าคน) · approved→`approved` · posted→`done` · ส่งกลับ→`draft` · unpost→`approved` · `v_campaign_board.effective_status` ยังคำนวณจาก artifact blocked/gate blocked — gate 3 kind ใหม่ที่ `blocked` (⚠️ ติด) **จะทำให้บอร์ดเก่าแสดง blocked** ⇒ ตั้งใจ (ติดด่านคือ blocked จริง) · เขียนใน brief frontend

**R18 ตรวจแล้วจากโค้ดจริง 6 ต.ค.** (idea = anchor null ⇒ `resolved_start/days_until` null): `lib/actions/calendar.ts:82` `getCalendarTasks` กรอง `.gte/.lte("resolved_start")` ⇒ null หลุดจากปฏิทินเอง · `components/domain/marketing/CampaignBoard.tsx:44` `countdownText(null) = "ยังไม่กำหนดวัน"` · `:321` sort `daysUntil ?? 9999` · `app/(dashboard)/marketing/calendar/page.tsx:136` ข้าม `!t.resolvedStart` · `[stepId]/page.tsx:118` backHref รองรับ null · `CampaignCalendar.tsx` อ่าน `campaign_calendar` (เทศกาล 0034) ไม่ใช่ board · `campaign_reschedule_step` บน idea = raise "no anchor_date" (ตั้งใจ — ใช้ set_plan.date) · **query ตรวจหลัง apply**: `select count(*) from analytics.v_campaign_board where resolved_start is null` (ต้อง = จำนวน idea) + `select * from analytics.v_campaign_board where resolved_start is null limit 1` ต้องไม่ error · QA smoke: เปิด /marketing/copilot และ /marketing/calendar ขณะมี idea ≥1

### 12.6 Backfill ต.ค. — 0159 (do-block เดียว `$c2bf$` · trap #19 · ไม่เดา)

ลำดับ (ใน do-block หลัง DDL/RPC/trigger ถูกสร้างแล้ว):
1. **ขอบเขต**: temp `_c2_bf` = step ที่ `c.anchor_date + s.offset_start_days >= date '2026-10-01' and s.piece_status is null` join artifact ของมัน · ด่าน: ทุก step มี artifact **1 ตัวพอดี** (0 หรือ >1 = raise "seed เปลี่ยนหลัง 6 ต.ค. กลับมาตัดสินใหม่") · `a.status in ('todo','draft_pending_review')` เท่านั้น (อื่น = raise) · **จำนวน = 26 เป๊ะ** (ต่าง = raise) · `raise notice` รายการ `step_id · title · audience_segment · piece_status ที่จะได้` ทุกแถว (dry-run ให้ Tech Lead ดูก่อน `--commit`)
2. snapshot: `md5(string_agg(id||'|'||status||'|'||updated_at order by id))` + `count(distinct updated_at)` ของ `campaign_step` ทั้งตาราง · md5 ของ `step_artifact` (id, status, content_body, clip_brief, updated_at)
3. `alter table analytics.campaign_step disable trigger trg_campaign_step_updated_at;` + `disable trigger trg_campaign_step_piece_status_guard;`
4. **UPDATE เดียว** `where id = any(select id from _c2_bf)`: `piece_status = case a.status when 'todo' then 'planned' when 'draft_pending_review' then 'in_review' end` · `drafted_by_ai = (a.generated_by = 'ai_copywriter')` · `piece_kind = case a.artifact_type when 'short_form_clip' then 'short_clip' when 'fb_post' then 'ig_fb_post' when 'broadcast_script_line' then 'line_message' else null end` (`teaser_image` 3 · `parcel_card` 1 → **null ไม่เดา** · เจ้าของติดผ่านหน้า F) · `line_audience` **null ทั้ง 2 แถว line_oa** — แถว "LINE 1/4 — เชิญ champion+loyal" (`ea749965…`) ชื่อบอกว่าเฉพาะกลุ่ม แต่ CHECK ต้องมี reason จริง (ห้ามแต่ง) ⇒ เจ้าของเลือกในหน้า F · เพิ่มด่าน approve: `piece_kind='line_message'` ต้อง `line_audience is not null` (§12.3 แถว approved) · **ไม่แตะ `status`** (คง `todo` — projection เริ่มที่ transition แรก · บอร์ด copilot ไม่เปลี่ยนหน้าตาเพราะ apply) · `updated_at/updated_by` ไม่แตะ
5. `enable trigger` ทั้งสอง (ทรานแซกชันเดียว) · assert md5 + count(distinct updated_at) เท่าเดิม · assert `piece_status is not null` = 26 · `in_review and drafted_by_ai` = 13 · `planned` = 13
6. **extract**: `perform content_confirm_extract(shop_id, step_id, 'system')` ทุก step `in_review` (13) · assert `count(distinct step_id) from content_confirm_item` = 11 (ของจริง 6 ต.ค. · ต่าง = raise) · assert md5 `step_artifact` เท่าเดิม (extract อ่านอย่างเดียว)
7. `content_piece_event` kind `create` 1 แถว/step (26) actor `system` payload `{backfill:'0159', from_artifact_status}` — หน้า F มี timeline เริ่มต้น · **ไม่สร้าง** `step_gate`
8. idempotent: รันซ้ำ → ขั้น 1 ได้ 0 แถว → ข้ามพร้อม notice · assert 5–6 ทำเฉพาะรอบที่ `v_n_updated > 0` (เจ้าของขยับสถานะไปแล้วตัวเลขย่อมต่าง)

ด่านท้ายไฟล์ 0159 (แบบ 0158 §16): `live_session_log`/`content_signal`/`content_hook` (คอลัมน์เดิม)/`content_post` (id,status,updated_at + `step_id` null ทุกแถว) ไม่ขยับ · view เดิมทุกตัว definition เท่าเดิม (**ไม่ต่อคอลัมน์ใหม่เข้า `v_campaign_board`** — อ่านจาก `v_content_piece`) · ฟังก์ชันเดิมนอกรายการ `^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_hook_reference_|content_hook_link_)` md5 เท่าเดิม · overload RPC ใหม่ = 1 signature · grant รั่ว = raise · RLS on ทุกตารางใหม่

### 12.7 view — 0159: `v_content_piece` · 0160: ที่เหลือ · ทุกตัว `with (security_invoker = true)` · grant select service_role · **ไม่ replace view เดิม**

**`v_content_piece`** (1 แถว/step ที่ `piece_status is not null` — หน้า F · inbox กอง 1–3 · G): `step_id · campaign_id · shop_id · campaign_name · campaign_type · title · piece_status · hold_reason · piece_kind · channel · customer_group · time_slot · start_time (HH24:MI) · resolved_start/resolved_end (สูตรเดียวกับ v_campaign_board) · days_until (**วันไทย** ไม่ใช่ current_date — trap #6) · hypothesis · metric_code · baseline_value · baseline_as_of · pass_threshold · pass_op · baseline_spread · threshold_too_narrow (= `baseline_spread is not null and abs(pass_threshold - baseline_value) < baseline_spread`) · footage_status · footage_url · shoot_* · expected_host_id · expected_host_label (**public_label เท่านั้น** — ชื่อจริงไม่ออก view) · drafted_by_ai · line_audience · line_audience_reason · audience_segment · content_type_code · goal_kpi_code · artifact_id (ตัวแรกตาม created_at) · artifact_type · content_body · clip_brief · generated_by · human_edited · hooks jsonb [{id,label,text,hook_type,hook_type_raw,derived_from_hook_id,source_signal_id}] (origin ours · เรียง label) · gates jsonb {fact_check:{status,detail,note}, brand_rule, risk_owner} (ไม่มีแถว = null) · gates_passed · confirm_pending int · confirm_marker_in_text (regex ชั้น 2 คำนวณสด) · can_approve (= gates_passed and confirm_pending = 0 and not marker and piece_kind not null and (kind <> 'line_message' or line_audience not null)) · posts jsonb [{post_id, platform, post_url, posted_at, status, hook_id}] · posted_on (min posted_date_th ของ post active · kind ไม่มี URL = วันไทยของ event post) · t7_captured (จาก `v_content_post_t7.t7_captured_on` ของโพสต์แรก) · **effective_piece_status**: cancelled → 'cancelled' · hold_reason not null → 'on_hold' · posted + kind ไม่มี URL → 'posted' · posted + มี URL: t7 → 'measured' · วันไทย − posted_on in 1..9 → 'measuring' · > 9 ไม่มี t7 → 'missed_measure' · else 'posted' · อื่น = piece_status · source_signal_id (event create payload) · last_event_at · approved_at / approved_by_role (event approve ล่าสุด) · created_at · updated_at`
- `can_approve` = **สูตรเดียวกับ RPC** — verify: ยิง approve ใส่ 13 ชิ้นจริง ผลต้องตรงกับ view ทุกแถว (กันปุ่มเขียวกดแล้วไม่ผ่าน)

**0160**: `v_content_piece_calendar` = `v_content_piece` where `resolved_start is not null and piece_status <> 'cancelled'` + คอลัมน์การ์ด D (ธง needs_shoot / on_hold / confirm_pending>0 / no_link_overdue) — idea ไม่โผล่ (R18) · `v_content_inbox_counts` (1 แถว/shop): `post_today` (approved/produced · resolved_start <= วันไทย) · `post_overdue_no_link` (produced · kind มี URL · resolved_start < วันไทย · ไม่มี post active) · `review_queue` (in_review) · `review_over_limit` (= review_queue > 10 — แสดง ไม่บังคับ) · `ideas` · `owner_questions` (step_gate risk_owner pending/blocked ของ step drafting/in_review) · `shoot_this_week` (approved · needs_shoot · resolved_start ในสัปดาห์ไทย จ–อา) · `v_line_quota_28d`: `used_28d` (posted line_message · posted_on ใน 28 วันไทย) · `planned_28d` (planned..produced · resolved_start ใน 28 วัน) · `quota = 4` (ค่าคงที่ที่เดียว §6) · `v_content_hook_library` (§11.2 ข้อ 7)

### 12.8 RPC ฝั่งโพสต์ — 0160

**`content_piece_post(p_shop_id, p_step_id, p_platform, p_external_id, p_post_url, p_posted_at, p_actor_role, p_hook_id uuid default null, p_hook_other_text text default null, p_hook_other_type text default null, p_caption text default null) returns jsonb`** (`{post_id, step_id, piece_status}`) — **owner เท่านั้น**
- step: `piece_status in ('approved','produced','posted')` (posted = เพิ่มโพสต์ที่ 2 ของชิ้น ig_fb_post · kind อื่นที่ posted แล้ว = 55000) · `piece_kind in ('short_clip','live_cut','ig_fb_post')` (line/story = 55000 "ใช้ advance posted") · platform ↔ channel ตาราง §12.2 (tiktok↔tiktok · facebook/instagram↔ig_fb_post · **ตรวจกับ piece_kind ไม่ใช่ channel** — channel null ของ legacy 2 แถวไม่บล็อก)
- hook: `p_hook_id` → ต้อง `content_hook where id and shop_id and step_id = p_step_id and origin='ours'` (reference/step อื่น = 22023 §11.2 ข้อ 6) · `p_hook_other_text` (มี = สร้าง `content_hook_upsert(... p_label null ...)` ก่อน · ต้องส่ง `p_hook_other_type` ด้วย เพราะ upsert บังคับ type) · ส่งทั้งคู่ = 22023 · ส่งไม่ครบ = ยอม (hook_id null — brief H บอก "hook จริง A/B/อื่น" แต่ไม่บังคับ · เขียนไว้ว่าบังคับไหมเป็นมติ UI)
- `perform content_post_upsert(p_shop_id, p_platform, p_external_id, p_post_url, p_posted_at, s.content_type_code, artifact_clip_id, p_caption)` (ฟังก์ชันเดิม ทรานแซกชันเดียว — validation ลิงก์/วันอนาคต/สถานะ deleted ตกที่นั่น) → `update content_post set step_id, hook_id where id = v_post_id` (โพสต์เดิมที่ผูก step อื่นอยู่ = 55000 "unlink ก่อน") → ถ้า piece_status ≠ posted: `content_piece_transition_(…, 'posted', p_actor_role, null, null, v_post_id)` · ถ้า posted แล้ว: event `post` เพิ่ม 1 แถว payload `{post_id, additional:true}`
- `content_post_link_step(p_shop_id, p_post_id, p_step_id, p_actor_role, p_hook_id default null)` (โพสต์นอกแผน H): post active ร้านเดียวกัน `step_id is null` · step approved/produced · platform↔kind · hook กติกาเดียวกัน · set step_id/hook_id/artifact_id → transition posted ด้วย post id · owner เท่านั้น
- `content_post_unlink_step(p_shop_id, p_post_id, p_reason, p_actor_role)`: owner + reason · set step_id/hook_id null (artifact_id คง) · ถ้า step ไม่เหลือ post active → transition posted→produced ด้วย reason (event unpost) · โพสต์ไม่ถูกลบ (ยังอยู่คิวยอดในฐานะนอกแผน)
- `content_piece_defer(p_shop_id, p_step_id, p_new_date, p_reason, p_actor_role, p_new_time time default null)`: owner + reason · piece_status in planned..produced (idea = ใช้ set_plan.date · posted/cancelled = 55000) · `perform campaign_reschedule_step(p_step_id, p_new_date, p_new_time, false)` (เดิม — anchor null จะ raise เองสำหรับ idea) · event `defer` payload `{from_date, to_date}` · piece_status ไม่เปลี่ยน (↷ ไม่ใช่สถานะ §3.2)

### 12.9 เคสที่ "ต้องถูกปฏิเสธ" — ใช้ตรงเป็นบรีฟ backend-dev + verify (ระบุด่านที่ตก · errcode)

| # | เคส | ตกที่ด่าน | code |
|---|---|---|---|
| X1 | `content_piece_advance` ด้วย `p_actor_role='ai'` ไป `approved` | `content_actor_assert` allowed ต่อ p_to | 42501 |
| X2 | owner approve ชิ้นที่ gate `risk_owner` ไม่มีแถว | §12.3 approved (1) แถวหาย = ไม่ผ่าน | 55000 |
| X3 | owner approve ชิ้นที่ gate ครบแต่ `brand_rule='blocked'` | (1) | 55000 |
| X4 | owner approve ชิ้นที่ `content_confirm_item` ค้าง 1 แถว | (2) | 55000 |
| X5 | owner approve ชิ้นที่ item ตอบครบแต่ clip_brief ยังมี `[ต้องยืนยัน: …]` (จำลองด้วย `campaign_set_artifact_content` ใส่ marker ใหม่หลังตอบ) | (3) regex ชั้น 2 | 55000 |
| X6 | approve ชิ้น `line_message` ที่ `line_audience` null (backfill จริง `ea749965…`) | (4) | 55000 |
| X7 | approve ชิ้นที่ `piece_kind` null (backfill `teaser_image`) | (4) | 55000 |
| X8 | `advance('produced')` จาก `in_review` (ข้ามอนุมัติ) | ตารางลำดับ | 55000 |
| X9 | `advance('posted')` บน `short_clip` ที่ approved (ไม่ผ่าน content_piece_post) | §12.3 posted · p_post_id null | 55000 |
| X10 | `advance('drafting')` จาก `in_review` โดย `p_reason` null (ส่งกลับไม่มีเหตุผล) | reason บังคับ | 22023 |
| X11 | `advance('in_review')` จาก `approved` โดย actor `ai` | ย้อนจาก approved = owner | 42501 |
| X12 | `advance('idea')` จาก `drafting` (ย้อน 2 ขั้น) | ตารางลำดับ | 55000 |
| X13 | `advance('planned')` จาก idea ที่ anchor_date null | resolved_start null | 55000 |
| X14 | `advance('planned')` จาก idea ที่มีวันแต่ `metric_code='save_rate'` และ `pass_threshold` null | สมมติฐาน/ฐาน/เกณฑ์ | 55000 |
| X15 | `advance('in_review')` บน `short_clip` ที่ hook ours ติดประเภทแค่ 1 ตัว (ของจริง: 13 ชิ้นมี `question` 1 + null 1 — ถ้าส่งกลับแล้ว advance ใหม่ต้องตก **และข้อความบอก "ยังไม่ติดประเภท 1 ตัว"**) | R19 | 55000 |
| X16 | `advance('hold')` ไม่มี reason · `advance('cancelled')` จาก posted · `advance('resume')` ชิ้นที่ไม่ได้ hold · `p_to` = สถานะปัจจุบัน · `p_review_seconds` ส่งมากับ p_to ≠ approved · `p_to='banana'` | ตามแถว | 22023/55000 |
| X17 | advance ใส่ step ที่ `piece_status is null` (step ก่อน ต.ค. จริง — ทั้งโหมดไม่มี artifact 11 · หลาย artifact 8 · template promo) | "นอก workflow" | 22023 |
| X18 | advance ด้วย `p_shop_id` ต่างร้าน (uuid สุ่ม) / step_id ไม่มี | lock where shop | 22023 |
| X19 | `content_piece_create` actor ai ส่ง `p_date` | AI วางปฏิทินไม่ได้ | 22023 |
| X20 | `content_piece_create` kind `short_clip` + channel `line_oa` · `p_campaign_id` ของร้านอื่น · campaign หลาย step + p_date null | kind↔channel · shop · วัน | 22023 |
| X21 | `content_signal_pick` ใส่ signal ที่ `picked` แล้ว / `rejected` | 55000 + detail picked_step_id | 55000 |
| X22 | `content_piece_set_plan` key นอกรายการ (`"hypotesis"`) · `baseline_value: "NaN"` · `baseline_as_of` พรุ่งนี้ · `line_audience:'segment'` โดย audience_segment null | whitelist · not(between) · วันไทย · CHECK | 22023 |
| X23 | `set_plan` เปลี่ยน `hypothesis` บนชิ้น approved · ตั้ง `date` บนชิ้น drafting (ต้อง defer) · ai set_plan บนชิ้น planned | สถานะ/role | 55000/42501 |
| X24 | `content_gate_record('risk_owner','passed')` actor ai · ai ตั้ง risk pending โดยไม่มี detail.question · gate บน step approved · `p_detail` เป็น array · sources มี `javascript:` | §12.4 | 42501/22023/55000 |
| X25 | `content_confirm_resolve` actor ai · คำตอบมี `[ต้องยืนยัน` · item ที่ตอบแล้ว · item ที่ removed · คำตอบว่าง/ZWSP ล้วน | §12.4 | 42501/22023/55000 |
| X26 | `campaign_set_artifact_status('approved')` (RPC เดิม) ใส่ artifact ของ step ที่ `piece_status='in_review'` | trigger R4 ข้อ 1 | 55000 |
| X27 | `campaign_set_artifact_content` เปลี่ยน content_body ของ step `approved` | trigger R4 ข้อ 1 | 55000 |
| X28 | `update analytics.campaign_step set piece_status='approved'` ตรง (service_role) · `update … set status='done'` บน step มี piece_status | trigger R4 ข้อ 4 | 55000 |
| X29 | `campaign_delete_step` บน step approved | trigger R4 ข้อ 3 | 55000 |
| X30 | `update/delete analytics.content_piece_event` | append-only trigger | 42501 |
| X31 | `content_piece_post` actor ai · kind `line_message` · platform `tiktok` บน `ig_fb_post` · `p_hook_id` = hook ของ step อื่น · `p_hook_id` = hook origin reference (สร้างผ่าน capture จริง) · ส่ง hook_id + other_text พร้อมกัน · `p_posted_at` อนาคต (ตกที่ `content_post_upsert` เดิม L2) · โพสต์ที่ผูก step อื่นอยู่ | §12.8 | 42501/55000/22023 |
| X32 | `content_post_link_step` โพสต์ `deleted` · step `in_review` · `content_post_unlink_step` ไม่มี reason | §12.8 | 55000/22023 |
| X33 | `content_piece_defer` บน idea (anchor null) → raise จาก `campaign_reschedule_step` เดิม "no anchor_date" **ต้องไม่กลายเป็น 500 เงียบ** · บน posted | reschedule/ตาราง | P0001/55000 |
| X34 | `content_hook_reference_upsert` signal kind `trend` · ร้านอื่น · ai แก้แถว human · ข้อความซ้ำ (signal, lower(text)) | §11.2 ข้อ 4 | 22023/42501/23505 |
| X35 | `delete from content_signal` ที่มี hook ours `derived_from` ชี้มา | trigger BEFORE DELETE §11.2 ข้อ 3 | 55000 |
| X36 | insert `content_hook` origin reference โดย `source_signal_id` null · origin ours + `derived_from` ชี้ hook ours (ไม่ใช่ reference) | CHECK / RPC | 23514/22023 |
| X37 | เรียก RPC ใหม่ทุกตัวจาก `set local role authenticated` หลัง grant usage ชั่วคราว (18.5) | EXECUTE | 42501 |
| X38 | backfill: จำลอง seed เปลี่ยน (ใน verify ทรานแซกชัน: เพิ่ม artifact ตัวที่ 2 ให้ step ต.ค. 1 แถวก่อน replay block) → block ต้อง raise ไม่ UPDATE | §12.6 ข้อ 1 | P0001 |
| X39 | `v_content_piece.can_approve = true` แต่ RPC approve ตก (หรือกลับกัน) สำหรับ 13 ชิ้นจริง | สูตรต้องเท่ากัน | — (assert) |

### 12.10 เคสที่ "ต้องไม่พัง" — สำคัญเท่ากับ 12.9 (ยิง "ของใหม่ใส่ของเก่า" ทุกโหมดจริง — trap #17)

| # | เคส | พิสูจน์ด้วย |
|---|---|---|
| K1 | apply 0159 แล้ว `campaign_step` 50 แถว: md5(id,status,updated_at) + `count(distinct updated_at)` เท่าก่อน apply · 24 แถวก่อน ต.ค. `piece_status` null ทุกคอลัมน์ใหม่ null | ด่านท้ายไฟล์ + verify |
| K2 | `step_artifact` 53 แถว md5(id,status,content_body,clip_brief,updated_at) เท่าเดิม (backfill + extract ไม่แตะ) | ด่านท้ายไฟล์ |
| K3 | `v_campaign_board` definition เท่าเดิม · 36 คอลัมน์ลำดับเดิม · `select` ทั้ง 50 แถวได้ · `getCampaignBoard`/`getCalendarTasks`/`getCalendarTask` (CAMPAIGN_BOARD_SELECT) ไม่ error | ด่านท้าย + QA smoke /marketing/copilot /marketing/calendar |
| K4 | step ก่อน ต.ค. (piece_status null): `campaign_set_artifact_status` · `campaign_set_artifact_content` · `campaign_ai_draft_artifact` · `campaign_toggle_clip_shot` · `campaign_reschedule_step` · `campaign_delete_step` (manual) · `campaign_pass_gate` ทำงานเหมือนเดิม (trigger R4 ปล่อยเมื่อ piece_status null) | verify ยิงใส่ step จริงก่อน ต.ค. ทุกโหมด: ไม่มี artifact (11) · หลาย artifact (8) · template promo |
| K5 | step ต.ค. (มี piece_status): `campaign_toggle_clip_shot` (ติ๊ก shot ไม่เปลี่ยน status/เนื้อหา) · `campaign_reschedule_step` (เลื่อนจากปฏิทินเดิม — ทำงาน แต่ไม่มี event) · `campaign_step_set_content_type` · `campaign_delete_step` บน planned ทำงานเหมือนเดิม | verify |
| K6 | `campaign_ai_draft_artifact` บน step ต.ค. `drafting`/`in_review`: เขียนได้ · gate fact/brand ที่ passed ตกเป็น pending · extract รันเอง · `risk_owner` คงค่า | verify (trigger R4 ข้อ 2) |
| K7 | `campaign_create_task` (AddPlanForm เดิม) ยังสร้าง step ได้ · step นั้น piece_status null · ไม่โผล่ใน `v_content_piece` · โผล่บอร์ดเก่าเหมือนเดิม (หนี้ D10) | verify + QA |
| K8 | `content_signal_capture` reference_clip ที่มี hook_text → signal 1 แถว + hook reference 1 แถว · capture ที่ `hook_text` null (kind trend) → ไม่มี hook · `content_signal_set_status` ทุกค่า ยังทำงาน · `v_content_signal` select ได้ | verify (trigger mirror) |
| K9 | `content_hook_upsert` (0158) ยังทำงานทุกเคสเดิมของ verify-0158 (K-series) — CHECK ที่ผ่อนไม่ทำให้ ours รับ hook_type null | รัน verify-0158 ส่วน hook ซ้ำหลัง 0159 (ROLLBACK) |
| K10 | `live_session_upsert` v2 · `live_host_upsert` · `content_post_upsert` · `content_post_metric_upsert` · `content_post_set_status` · `content_post_update_type` ไม่เปลี่ยน md5 และเรียกได้ | ด่านท้าย funcs md5 + verify ยิง 1 เคส/ตัว |
| K11 | `content_post` 10 แถวจริง: `step_id/hook_id` null · คิวยอด `v_content_entry_queue`/`v_content_post_t7` ผลเท่าเดิม (snapshot ก่อน/หลัง) | verify |
| K12 | flow เต็มบน fixture: pick → set_plan(date+สมมติฐาน) → planned → drafting → hook A/B (upsert 2 ประเภท) + ai_draft (shots) → in_review (extract อัตโนมัติ) → gate 3 ตัว (risk โดย owner) → resolve ทุก item (ข้อความถูกแทน · assert_clip_brief_valid ผ่าน) → approved (review_seconds 45) → produced → `content_piece_post` (hook A) → posted · event ครบ 1 แถว/ขั้น · projection status/artifact.status ถูกทุกขั้น · `v_content_piece.effective_piece_status='measuring'` วันถัดไป (จำลองด้วย posted_at เมื่อวาน) · ลบ post (`set_status deleted`) → unpost → produced | verify do-block ใหญ่ 1 บล็อก ROLLBACK |
| K13 | flow ชิ้น `line_message`: create (line_audience='all' อัตโนมัติ) → … → approved → `advance('posted')` ไม่สร้าง content_post · `v_line_quota_28d.used_28d` +1 · effective = 'posted' ถาวร | verify |
| K14 | flow ชิ้น `ig_fb_post`: post facebook แล้ว post instagram อีกใบบนชิ้นเดียว (posted → posted + event additional) · `posts` ใน view 2 รายการ | verify |
| K15 | ส่งกลับ: in_review → drafting (reason) → แก้เนื้อหาผ่าน `campaign_set_artifact_content` ใส่ marker ใหม่ → extract เห็น item ใหม่ · item เก่าที่ยังอยู่ไม่ถูก reset · item ที่หายไป `removed_at` | verify |
| K16 | hold/resume: hold บน in_review → `status='blocked'` + reason · `v_campaign_board.effective_status='blocked'` · resume → `active` · piece_status ยัง in_review ตลอด | verify |
| K17 | cancel → restore: cancelled (from in_review) → restore → in_review + artifact status กลับ `draft_pending_review`/`draft` ตาม drafted_by_ai | verify |
| K18 | R18: สร้าง idea (anchor null) แล้ว `select * from v_campaign_board where step_id = …` ได้ 1 แถว resolved_start/days_until null · `v_content_piece` 1 แถว · `v_content_piece_calendar` 0 แถว · QA เปิดบอร์ด+ปฏิทิน | verify + QA |
| K19 | `content_confirm_resolve` บนชิ้นจริง `7e949797…` (marker 11 ครั้ง 7 key): ตอบ 1 key → ทุกตำแหน่งของ key นั้นถูกแทน · key อื่นยังค้าง · `clip_brief` ยัง valid · `human_edited=true` | verify ROLLBACK (ข้อมูลจริง) |
| K20 | รัน 0159 ซ้ำทั้งไฟล์ในทรานแซกชันเดียว 2 รอบ = ผ่าน (idempotent) · `check-analytics-grants.sql` สะอาดหลัง apply · `\r` = 0 | verify + script |
| K21 | เวลาคร่อม 00:00–07:00 ไทย: `days_until`/`effective_piece_status`/`v_line_quota_28d` ใช้วันไทย (จำลอง `set local timezone`? — ไม่พอ · ให้ assert สูตรใช้ `at time zone 'Asia/Bangkok'` ด้วย `pg_get_viewdef ~ 'Asia/Bangkok'` + ไม่มี `current_date` ใน view ใหม่) | verify static |
| K22 | ทุก RPC ใหม่ `select count(*) from pg_proc … = 1` ต่อชื่อ (trap #1) | ด่านท้าย |

### 12.11 ความเสี่ยง · หนี้ใหม่ · สิ่งที่ต้องถามเจ้าของ (เฉพาะที่แก้ทีหลังยาก)

| # | ความเสี่ยง | กัน |
|---|---|---|
| R20 | GUC `c2.piece_rpc` ที่ helper ตั้งเพื่อผ่าน trigger R4 — ถ้า RPC raise กลางทางโดยไม่ reset GUC ค้างจน transaction จบ (set_config … true = หมดอายุพร้อมทรานแซกชันอยู่แล้ว ⇒ ปลอดภัย) · แต่ **service_role เรียก `set_config('c2.piece_rpc','1')` เองได้** → ข้าม trigger ได้ทั้งหมด | เขียนตรงๆ: trigger R4 กัน "เส้นทางโค้ด/บอร์ดเดิม" ไม่ได้กัน service_role ที่ตั้งใจ (เหมือน D2) · verify X28 ยิงโดยไม่ตั้ง GUC · code review grep `c2.piece_rpc` ในโค้ดแอปต้อง = 0 |
| R21 | `content_confirm_resolve` แทนข้อความใน `clip_brief` ผ่าน regexp บน text แล้ว cast กลับ — ถ้า answer ทำให้ jsonb พัง (เช่น มี `"` ที่ escape ผิด) → cast error 22P02 | ใช้ `to_jsonb(answer)` ตัด quote · `assert_clip_brief_valid` หลังแทน · verify K19 ด้วยคำตอบที่มี `"` `\` `—` และภาษาไทย |
| R22 | regex ชั้น 2 ของ approve (`\[ต้องยืนยัน`) ตรวจ `clip_brief::text` ทั้งก้อน — ถ้า AI เขียน marker ใน field ที่ UI ไม่แสดง (เช่น `meta`) เจ้าของจะเห็น "มี marker" แต่หาไม่เจอบนจอ | หน้า F แสดง `confirm_pending` รายการพร้อม path ไม่ได้ (extract ไม่เก็บ path — YAGNI) ⇒ UI ต้องมีปุ่ม "แสดง storyboard ดิบ" · บันทึกเป็นหนี้ D12 |
| R23 | `campaign_reschedule_step` เดิมยังเลื่อนชิ้น workflow ใหม่ได้โดยไม่มี event defer (K5) | ยอมรับ (ต้องไม่พัง) · UI ใหม่ใช้ `content_piece_defer` · หนี้ D11 |
| R24 | `effective_piece_status='measured'` อิง `v_content_post_t7` ซึ่งนับเฉพาะโพสต์ตัวแรกของชิ้น — ชิ้น ig_fb_post 2 โพสต์ วัดแค่ใบแรก | เขียนไว้ใน view comment · ผลต่อโพสต์ (K) ยังดูรายโพสต์ได้ครบ |
| R25 | trigger mirror (§11.2 ข้อ 3) insert `content_hook` ที่ `generated_by` จาก `created_by_role` ของ signal — AI radar capture = hook `generated_by='ai'` ⇒ เจ้าของแก้ได้ · คนแก้แล้ว AI แก้ซ้ำไม่ได้ (กติกา 0158) ถูกต้อง · แต่ `hook_type` null จาก capture ต้องติดเอง | คลังบนจอกรอง "ยังไม่ติดประเภท" |
| R26 | ขนาด: 0159 มี RPC 9 ตัว + trigger 5 + view 1 + backfill — review 3 รอบเหมือน 0158 ใช้เวลา | แบ่ง 2 ไฟล์แล้ว · security เริ่มจาก `content_piece_advance` + trigger R4 ก่อน (💰-class: สิทธิ์อนุมัติ) |

**หนี้ใหม่ที่รับ (เพิ่มใน §10)**: D9 ชิ้น backfill 26 แถวไม่มี hypothesis/piece_kind ครบ (approve ไม่บังคับ hypothesis — บังคับเฉพาะ idea→planned) · D10 `campaign_create_task`/AddPlanForm เดิมสร้าง step นอก workflow (piece_status null) จนกว่า UI จะย้ายไป `content_piece_create` · D11 เลื่อนผ่านปฏิทินเดิมไม่มี event · D12 `content_confirm_item` ไม่เก็บ path ใน clip_brief · D13 `recommendation_log` ยังไม่รับ risk gate (C3) · D14 GUC bypass (R20)

**ถามเจ้าของ (แก้ทีหลังยาก)**:
| # | คำถาม | ถ้าไม่ตอบ ผมเลือก |
|---|---|---|
| Q6 | "โพสต์แล้ว" ของคลิป **บังคับ**เลือก hook ที่ใช้จริงไหม (A/B/อื่น) — ไม่บังคับ = rollup ต่อ hook มีรูโหว่ถาวรสำหรับโพสต์ที่ลืมเลือก · บังคับ = ปุ่ม 3 นาทีมี 1 ช่องเพิ่ม | **ไม่บังคับที่ DB** (hook_id null ได้) · UI เตือน · rollup นับเฉพาะที่มี — เพราะโพสต์นอกแผน (link ทีหลัง) ไม่มี hook อยู่แล้ว |
| Q7 | ชิ้น `line_message` "เฉพาะกลุ่ม" — กลุ่มคือ RFM segment ในระบบ (champion/loyal/at_risk…) ใช่ไหม หรือเป็นกลุ่มที่ตั้งเองใน LINE OA | ใช้ `audience_segment` เดิม (RFM) — ถ้าเป็นกลุ่มใน LINE OA ต้องเพิ่มคอลัมน์ text แยก (เพิ่มทีหลังได้ แต่ CHECK reason จะต้องแก้) |
| Q8 | ยกเลิกชิ้นที่มาจากสัญญาณ → สัญญาณกลับเป็น `new` อัตโนมัติไหม | **ไม่** (เจ้าของตัดสินแยก) — กลับได้ผ่าน set_status |

### 12.12 กติกาส่งงาน (บังคับ)
- ตารางแมป "ข้อในบรีฟ → เทสต์" ครอบ X1–X39 + K1–K22 ทุกข้อ · ข้อที่ครอบไม่ได้เขียน "ไม่มี" + เหตุผล (เช่น K3 ส่วน QA smoke · K21 ส่วนเวลาจริง)
- dry-run 0159 (ไม่ `--commit`) ส่ง notice รายการ 26 แถว + ค่า audience_segment ของ 2 แถว line_oa ให้ Tech Lead ก่อน
- ลำดับ apply: 0159 → verify-0159 → `check-analytics-grants.sql` → 0160 → verify-0160 → grants อีกรอบ · ทั้งคู่ `--commit --record` · ไฟล์ขึ้น repo รอบเดียวกับ apply (บทเรียน 0129) · memory `content-workflow-redesign` อัปเดตว่า C2 ลงแล้ว
- security ผ่านก่อน merge (💰-class: สิทธิ์อนุมัติ + ปิดเส้นทางเดิม) · QA scope **L** ทุก flow ที่ผูก `v_campaign_board`/copilot/calendar + flow ใหม่

### 12.13 ✅ มติเจ้าของ Q6–Q8 + D9 (7 ต.ค. 69) — ทับ §12.11

| # | มติ | ต่างจากสเปกไหม |
|---|---|---|
| Q6 | "โพสต์แล้ว" **ไม่บังคับ** เลือก hook ที่ DB (หน้าจอถามเสมอแต่ข้ามได้ · โพสต์ที่ไม่เลือกไม่นับในสถิติ hook) | ตามสเปก |
| Q7 | LINE "เฉพาะกลุ่ม" = **กลุ่มลูกค้าในระบบ** (`audience_segment` เดิม) | ตามสเปก |
| Q8 | **ยกเลิกชิ้นงานแล้ว สัญญาณต้นทางกลับเป็น `new` อัตโนมัติ** (ล้าง `picked_step_id` · ทำใน transaction เดียวกับ cancel · ไม่รีเซ็ตถ้าสัญญาณถูกหยิบไปชิ้นอื่นแล้ว) | 🔁 **เปลี่ยน** จากที่ architect เสนอ "ไม่กลับเอง" |
| D9 | 26 ชิ้น ต.ค. ที่ backfill **อนุมัติได้โดยไม่บังคับสมมติฐาน** · ชิ้นใหม่ต้องมีตามปกติ | ตามสเปก |

## 13. สเปก C3 (วัดผล + ป้อนกลับ) — พร้อมลงมือ · 2 ไฟล์ **0161** + **0162** (7 ต.ค. 69 · architect)

> ยืนยันกับ DB สด 7 ต.ค. (query-sql): `content_post` 10 (active 8 · `step_id`/`hook_id` **null ทุกแถว**) · `content_post_metric` **5 แถว** 4 โพสต์ ทั้งหมด `source='manual'` · `is_regression` true = 0 · **ไม่มี trigger บนตารางนี้เลย** (ไม่มี `updated_at`) · `v_content_post_t7` มี t7 **1/10** · `v_content_entry_queue` 4 แถว · `recommendation_log` 12 (`weekly_brief` ทั้งหมด · pending 9 · R1/R3 อายุ >14 วัน = expired ใน view 0101) · **authenticated ไม่มี insert/update แล้ว** (grant ของ 0101 ถูก 0123/0147 ถอน — แถวปัจจุบันเขียนตรงจาก MCP/service_role) · `campaign` 12 (`result_verdict='not_measured'` ทุกแถว · ยังไม่มีคอลัมน์ metric/proposed) · `content_signal` 0 · `step_gate.risk_owner` 0 · `live_session_log` 3 คืน `host_id` null ทุกแถว · signature เดิมทั้ง 72 ฟังก์ชัน `content_*/campaign_*/live_*` ไม่มี overload · verify-0159 pin md5 `content_post_upsert` · verify-0160 ล็อกรายชื่อ 7 ฟังก์ชัน ⇒ **C3 ห้าม replace ฟังก์ชันใดของ 0148/0159/0160** (ใช้ trigger/view/RPC ใหม่แทนทุกจุด)

### 13.0 ขอบเขต · แบ่งไฟล์ · คำตัดสินที่ต่างจากบรีฟ/§5 (บอกเหตุผล)

| ไฟล์ | เนื้อหา | ขนาด | ทำไมอยู่ไฟล์นี้ |
|---|---|---|---|
| **0161** `content_measure_amend_result.sql` | `content_post_metric.amended_cols` + trigger guard + `content_post_metric_amend` + `content_post_metric_amend_log` · `content_post.result_*` + trigger guard + `content_post_verdict_confirm` · view `v_content_post_missed_window` · `v_content_post_result` · `v_content_hook_type_rollup` · helper `content_post_metric_regression_` | **M** (~900 บรรทัด) | ปิดหนี้ P2.1 + หน้า J/K ต่อโพสต์/ต่อ hook — ไม่พึ่ง 0162 · security แยกก้อน "แก้ตัวเลขย้อนหลัง" (เสี่ยงปลอมประวัติ) ออกจาก "คำตัดสิน" |
| **0162** `content_feedback_verdict_inbox.sql` | `campaign` คอลัมน์ metric + proposed/confirmed + trigger guard · `campaign_plan_set` / `campaign_verdict_propose` / `campaign_verdict_confirm` · `recommendation_log` คอลัมน์ + trigger guard + `recommendation_create` / `recommendation_respond` · ตาราง `content_weekly_summary` + `content_weekly_summary_upsert` · view `v_campaign_summary` · `v_recommendation_inbox` | **L** (~1,100) | หน้า E + inbox กอง 4 + สรุปสัปดาห์ · `v_campaign_summary` อ่าน `v_content_post_result` ของ 0161 ⇒ ลงหลัง |

ตัด: ไฟล์เดียว (~2,000 บรรทัด — บทเรียน 0158/0159 review 3 รอบ) · 3 ไฟล์ (weekly summary แยก = ~150 บรรทัด ไม่คุ้ม verify แยก)

**คำตัดสินที่ปรับจาก §5.6–§5.11 / บรีฟ (ของจริงใน DB ชนะเอกสาร):**

| # | บรีฟ/§5 ว่า | C3 ทำ | เหตุผล |
|---|---|---|---|
| C3-1 | `source='tiktok_api'` ห้ามทับค่าที่คนแก้ — จะต้องแก้ `content_post_metric_upsert` | **ไม่ replace upsert** (verify-0159 K10 + md5 pin) → เพิ่มคอลัมน์ `amended_cols text[]` + **trigger BEFORE UPDATE** `content_post_metric_guard` คืนค่าเดิมให้คอลัมน์ที่คนล็อกเมื่อ `new.source='tiktok_api'` + คิด `is_regression` ใหม่ด้วย helper เดียวกับ amend | ด่านระดับตาราง (บทเรียน C2) ครอบทุกเส้นทาง รวม API ในอนาคตที่ยังไม่เขียน · upsert เดิมไม่รู้จัก GUC ⇒ guard ใช้ `current_user` อย่างเดียว (ดู 13.1) |
| C3-2 | D13: ด่าน `risk_owner` pending → สร้างแถว `recommendation_log` kind `risk_gate` | **ไม่สร้างแถว** — `v_recommendation_inbox` union ด่านความเสี่ยงจาก `step_gate` ตรง + คำตัดสินแคมเปญที่รอยืนยันจาก `campaign` ตรง · ตอบด่าน = `content_gate_record` เดิม · ตอบ verdict = `campaign_verdict_confirm` | fact ชั้นเดียว (gate มีสถานะของตัวเองแล้ว · copy = 2 แหล่งเถียงกัน) · ไม่ต้อง replace `content_gate_record` (0159) · ไม่มี trigger ข้ามตารางที่ต้องปิดลูป · `kind` ของ reco จึงมีแค่ `proposal`/`question` |
| C3-3 | §5.11 สัดส่วนเดือนหน้า | **เลื่อนไป C4** | KPI def §0: เดือนแรก = baseline ห้ามตัด/เพิ่ม · วันนี้ 0 โพสต์ที่มี hook_type+t7 · กฎ ≥4 ชิ้น/ประเภทยังไม่มีทางถึงก่อนสิ้น ต.ค. ⇒ ตารางที่ยังผลิตข้อมูลไม่ได้ (บทเรียน `linked_sku_ids`) |
| C3-4 | Weekly Brief = md (task ห้ามแตะ DB) | ตาราง `content_weekly_summary` (5 บรรทัด + body md + path) เขียนผ่าน RPC โดย **Tech Lead หลัง Brief ออก** (ทาง (ก) ของ §5.10) · ไม่แตะ task · md ยังเป็นเอกสารต้นทาง DB = สำเนาที่เผยแพร่ในแอป | brief K: "อ่านในแอปได้ ไม่ต้องเปิดไฟล์ · ข้อเสนอในนั้นตอบได้" — อ่านจาก GitHub ตอน runtime ผูกข้อเสนอไม่ได้/parse เปราะ · trade-off: fact 2 ชั้น (ยอมรับ · `source_path` ชี้กลับไฟล์ · upsert ทับได้เมื่อ Brief แก้) |
| C3-5 | §5.8 confirm → `status='done'` | ทำตาม **แต่มีด่าน**: ชิ้นใน workflow ใหม่ของแคมเปญต้องเป็น posted/cancelled ทั้งหมด (ชิ้นค้าง = 55000) · แคมเปญ legacy (ไม่มี piece_status) ไม่ติดด่านนี้ | ปิดแคมเปญทั้งที่ยังมีชิ้นรอโพสต์ = คำตัดสินก่อนครบ 4 ชิ้น (KPI def) |
| C3-6 | ป้าย เหนือ/ปกติ/ต่ำ "vs median 10 คลิปล่าสุด" | ใช้ **10 โพสต์ก่อนหน้าโพสต์นั้น** (platform เดียวกัน · มี t7) · เหนือ = `save_rate > p75` · ต่ำ = `< p25` · ปกติ = ระหว่าง · ฐาน <4 โพสต์ = "ยังสรุปไม่ได้ (n/4)" · median แสดงคู่ | ป้ายนิ่ง (โพสต์ใหม่ไม่เปลี่ยนป้ายเก่า — §5.9 ต้องการให้ป้ายยืนยันนิ่ง ป้ายคำนวณก็ควรไม่สั่นโดยไม่มีเหตุ) · quartile = "ช่วงแกว่งของฐาน" จริง ไม่ต้องตั้งค่าคงที่ ±x% ที่ไม่มีที่มา · เปลี่ยนทีหลัง = แก้ view ตัวเดียว |
| C3-7 | amend "แก้ได้เฉพาะแถวที่มีอยู่" | ตาม + **ไม่เปิดย้อนกรอกวันที่พลาด** | ตัวเลขใน TikTok Studio วันนี้ ≠ ตัวเลขเมื่อ 3 วันก่อน · ย้อนกรอก = แต่ง snapshot · KPI def 2.1: ไม่มี snapshot = ตก |

**กติการ่วม** = §12.0 ทุกข้อ (schema `analytics` · service_role เท่านั้น trap #18 · definer + `search_path` + `crm_require_owner_admin` + `content_actor_assert` + `for update` ผูก shop · `content_text_clean` ทุกช่องที่ AI เขียนได้ · `content_marker_present` กัน `[ต้องยืนยัน` ในบทเรียน/คำตอบ · errcode 22023/42501/23505/55000 · คืน jsonb · LF · idempotent · snapshot ต้นไฟล์ + ด่านท้ายไฟล์แบบ 0160 (GUC `c3.snap_*` — ⚠️ 0160 ใช้ชื่อ `c3.snap_*` ไปแล้ว ⇒ C3 ใช้ **`c4.snap_*`** กันชนตอน replay ในทรานแซกชันเดียว) · `notify pgrst` · verify `scripts/verify/verify-0161.sql` / `verify-0162.sql` + ตารางแมป + `check-analytics-grants.sql`) · ด่านระดับตารางของ C3 ใช้ **`current_user not in ('service_role','authenticated','anon')` อย่างเดียว ไม่มี GUC** — เพราะ RPC เดิม (0148 upsert · 0101 ไม่มี RPC) ตั้ง GUC ไม่ได้และ replace ไม่ได้ · ความหมาย: "เขียนตรงจาก service key/REST = ไม่ผ่าน · ฟังก์ชัน definer ใดๆ ผ่าน" (อ่อนกว่า 0159 หนึ่งขั้น — บันทึกเป็น D18) · 🔴 ก่อนเขียน backend-dev รัน query ตัวเลขหัว §13 ซ้ำ ต่าง = หยุด

### 13.1 DDL — 0161 (วัดผล)

**`content_post_metric` เพิ่ม** `amended_cols text[] not null default '{}'` + CHECK `content_post_metric_amended_cols_check`: `amended_cols <@ array['view_count','like_count','comment_count','save_count','share_count']` (add column มี default = ไม่ rewrite · ตารางนี้ไม่มี trigger · ไม่มี UPDATE ใน migration ⇒ ไม่มี trap #19) · comment: "คอลัมน์ที่คนยืนยันค่าด้วย amend — แหล่ง `tiktok_api` ทับไม่ได้ · ล้างค่า (json null) ไม่ล็อก เพราะ null ไม่ใช่คำยืนยัน"

**helper** `content_post_metric_regression_(p_post_id uuid, p_captured_on date, p_view bigint, p_like bigint, p_comment bigint, p_save bigint, p_share bigint) returns boolean` `language sql stable` — สูตรเดียวกับ 0148 H1 เป๊ะ: ค่าที่ส่งมา (ไม่ null) ต่ำกว่า `max(col)` ของแถว `captured_on < p_captured_on` ของโพสต์นั้น (ไม่รวมวันเดียวกัน) · ใช้โดย amend + trigger · verify N1 ต้องพิสูจน์ว่า helper ให้ค่าเท่ากับ `is_regression` ปัจจุบันของทั้ง 5 แถวจริง

**trigger `trg_content_post_metric_guard`** BEFORE UPDATE OR DELETE บน `content_post_metric` (`content_post_metric_guard()` · ไม่กัน INSERT — insert ตรงเป็นของเดิมตาม comment 0148 และ `v_content_entry_queue` H3 กันแถวว่างอยู่แล้ว):
1. **DELETE** โดย `current_user in ('service_role','authenticated','anon')` → 55000 "ลบยอดไม่ได้ — ค่าผิดให้แก้ผ่าน content_post_metric_amend" · role อื่น (postgres/definer) ผ่าน (verify/cleanup ใช้)
2. **UPDATE** โดย 3 role นั้น ที่เปลี่ยน `view_count/like_count/comment_count/save_count/share_count/is_regression/amended_cols/captured_on/age_days/post_id/shop_id` (`is distinct from` ทุกตัว) → 55000 "แก้ยอดต้องผ่าน content_post_metric_amend" · เปลี่ยนเฉพาะ `raw/source/sources/captured_at` ปล่อย
3. **กันทับค่าที่คนล็อก** (ทุก role): `new.source = 'tiktok_api' and cardinality(old.amended_cols) > 0` → ทุก col ใน `old.amended_cols`: `new.col := old.col` · `new.amended_cols := old.amended_cols` · แล้ว `new.is_regression := content_post_metric_regression_(new.post_id, new.captured_on, new.view_count, …)` (คิดจากค่าหลังคืน) · `new.raw := coalesce(new.raw,'{}') || jsonb_build_object('kept_manual', old.amended_cols)` ไม่เงียบ — เส้นทางนี้ยังไม่มีผู้เรียกจริง (API = P3) แต่ verify ต้องยิง `content_post_metric_upsert(... p_source 'tiktok_api')` ใส่แถวที่ amend แล้วใน ROLLBACK (Y9)
4. ไม่กัน `source='manual'`/`'backfill'` ทับค่าล็อก — คน vs คน ค่าล่าสุดชนะ (upsert เดิม) · `amended_cols` คงอยู่ (ล็อกต่อ API ต่อไป)

**ตารางใหม่ `content_post_metric_amend_log`** (append-only): `id uuid pk default gen_random_uuid() · shop_id → public.shop cascade · metric_id uuid → content_post_metric on delete cascade · post_id uuid → content_post on delete cascade · captured_on date · before jsonb · after jsonb (ทั้งคู่ `jsonb_typeof='object'` · เก็บ 5 คอลัมน์เต็ม ไม่ใช่เฉพาะที่เปลี่ยน — อ่านประวัติได้โดยไม่ไล่ย้อน) · changed_cols text[] (cardinality ≥1 · `<@` 5 ชื่อ) · reason text (length 3..500) · actor_role text check ('owner','system') · actor_uid uuid · created_at` · index `(post_id, created_at desc)` · trigger `trg_content_post_metric_amend_log_append_only` BEFORE UPDATE OR DELETE → 42501 + `…_deny_truncate` BEFORE TRUNCATE (ลอก `content_piece_event_append_only` 0159 §7) · RLS on + `tenant_isolation_select` · grant select service_role เท่านั้น (insert ผ่าน RPC definer)

**`content_post` เพิ่ม** (nullable · `add column if not exists`): `result_label_override text` CHECK in ('above','normal','below') · `result_confirmed_at timestamptz` · `result_confirmed_by_role text` CHECK = 'owner' · `result_lesson text` CHECK `length <= 500` · CHECK ข้ามคอลัมน์ `content_post_result_consistency_check`: `(result_label_override is null) = (result_confirmed_at is null) and (result_confirmed_at is null) = (result_confirmed_by_role is null)` · **trigger ใหม่ `trg_content_post_result_guard`** BEFORE UPDATE (ตัวที่ 3 บนตาราง — ไม่แตะ `trg_content_post_link_guard` ของ 0160): `current_user in (3 role)` และ `result_*` ตัวใดตัวหนึ่ง `is distinct from` → 55000 "ยืนยันผลต่อโพสต์ผ่าน content_post_verdict_confirm" · เปลี่ยน `result_*` ทำให้ `trg_content_post_updated_at` ยิง = ถูก (แถวเปลี่ยนจริง)

**ไม่มี**: ตารางเก็บป้ายที่คำนวณ (§5.9 — view) · ตาราง "พลาดรอบ" (view) · ตาราง rollup (view) · `updated_at` บน metric (log คือประวัติ)

### 13.2 RPC — 0161

**`content_post_metric_amend(p_shop_id uuid, p_post_id uuid, p_captured_on date, p_set jsonb, p_reason text, p_actor_role text) returns jsonb`** → `{metric_id, log_id, captured_on, changed:{col:{from,to}}, is_regression, regression_recomputed:int}` · **owner เท่านั้น** (`content_actor_assert(…, array['owner'])` — ai แก้ตัวเลขที่คนกรอก = ห้าม · 'tiktok_api' ใช้ upsert ไม่ใช่ amend)
ลำดับ body:
1. null ของ 5 พารามิเตอร์แรก → 22023 · `crm_require_owner_admin` · actor
2. `p_set`: `jsonb_typeof = 'object'` และ `p_set <> '{}'` ไม่งั้น 22023 "ต้องส่ง object ที่มี key อย่างน้อย 1" · key ทุกตัว ∈ 5 ชื่อ — key แปลก (`"saves"`, `"view"`) = 22023 ระบุชื่อ key (กัน typo เงียบ) · ค่าแต่ละ key: `jsonb_typeof(v)` = `'null'` → ตั้งใจล้าง · `'number'` → ต้องเป็นจำนวนเต็ม (`(v #>> '{}') ~ '^[0-9]{1,13}$'` — ตัด `1e3` · `12.5` · ติดลบ) และ ≤ 1,000,000,000,000 · ชนิดอื่น (string `"123"` · bool) = 22023 "ตัวเลขต้องส่งเป็น number ไม่ใช่ข้อความ" — **ห้ามใช้ `p_set->>'x' is null`** แยกสองกรณีไม่ได้ (trap #13)
3. `p_reason` = `content_text_clean` · length 3..500 · `content_marker_present` = 22023
4. ล็อกโพสต์ `… where id = p_post_id and shop_id = p_shop_id for update` → ไม่พบ 22023 · `status <> 'active'` → 55000 "โพสต์ถูกลบ/ซ่อน — เปิดกลับ (content_post_set_status) ก่อน"
5. ขอบวัน (ไทย): `not isfinite(p_captured_on)` → 22023 · `p_captured_on > วันไทย` → 22023 "วันในอนาคต" · `p_captured_on < วันไทย − 30` → 55000 "เกิน 30 วัน — ตัวเลขถูกอ้างใน Weekly Brief แล้ว (จำเป็นจริงให้ Tech Lead ทำผ่าน SQL พร้อมบันทึก)" (30 = ค่าคงที่ในฟังก์ชันที่เดียว)
6. ล็อกแถว metric `where post_id = p_post_id and captured_on = p_captured_on for update` → ไม่พบ 22023 "ไม่มีแถววันนั้น — ย้อนกรอกไม่ได้ (C3-7)"
7. after ต่อ col: มี key → ค่าใหม่ (null เมื่อล้าง) · ไม่มี key → ค่าเดิม · `num_nonnulls(after×5) = 0` → 55000 "ล้างครบทุกช่องไม่ได้ — แถวว่างทำให้คิวกรอกยอดคิดว่าอ่านแล้ว (0149 H3)" · after ทุกตัว `is not distinct from` before → 22023 "ไม่มีค่าเปลี่ยน" (ห้าม log เปล่า)
8. UPDATE แถว: 5 col · `source = 'manual'` · `sources` ∪ 'manual' (สูตร 0148) · `amended_cols = (old ∪ key ที่ตั้งเป็น number) − key ที่ล้าง` · `is_regression = content_post_metric_regression_(…after…)` · `captured_at`/`raw`/`age_days` ไม่แตะ
9. คิด `is_regression` ใหม่ให้แถวของโพสต์นี้ที่ `captured_on > p_captured_on` (ลูปเรียง captured_on · UPDATE เฉพาะ `where is_regression is distinct from <ใหม่>` — trap #19 แม้ไม่มี trigger ก็ทำให้ชิน) · นับคืนเป็น `regression_recomputed`
10. insert amend_log (`before`/`after` = `jsonb_build_object(5 col)` · `actor_uid = auth.uid()`) · return
- **ไม่ทำ**: เปลี่ยน `captured_on` · ลบแถว · แก้ `age_days` (0148 H2 จัดการตามโพสต์อยู่แล้ว)

**`content_post_verdict_confirm(p_shop_id uuid, p_post_id uuid, p_label text, p_lesson text, p_actor_role text, p_expected_computed text default null) returns jsonb`** → `{post_id, label, computed_label, previous_label, signal_id}` · **owner เท่านั้น**
- `p_label in ('above','normal','below')` ไม่งั้น 22023 · `p_lesson` = `content_text_clean` · null/'' = ไม่มีบทเรียน · ≤500 · marker = 22023 · ล็อกโพสต์ (shop) · `status <> 'active'` = 55000
- ต้องมี t7: `v_content_post_t7.t7_captured_on` null → 55000 "ยังสรุปไม่ได้: ไม่มี snapshot ช่วง T+7 (<t7_unavailable_reason>)" — ต่อท้ายเหตุผลของ 0149 ให้รู้ว่ารอได้หรือพลาดแล้ว
- `p_expected_computed` ไม่ null และ `is distinct from` `v_content_post_result.computed_label` ปัจจุบัน → 55000 "ป้ายที่ระบบคำนวณเปลี่ยนไปแล้ว รีเฟรชก่อนยืนยัน" (compare-and-set · UI ส่งป้ายที่เห็นมา) · null = ไม่เทียบ
- ยืนยันซ้ำได้ (เปลี่ยนใจ) — ทับ `result_*` ทั้ง 4 · `previous_label` คืนค่าเก่า
- บทเรียนไม่ว่าง → `content_signal_capture(p_shop_id, 'insight', <lesson>, p_source => 'owner', p_seen_on => วันไทย, p_origin_post_id => p_post_id, p_customer_group => <customer_group ของ campaign_step ที่ post.step_id ชี้ ถ้ามี>, p_confidence => 'observation', p_actor_role => 'owner')` **เฉพาะเมื่อไม่มี** signal `kind='insight' and origin_post_id = p_post_id and summary = <lesson>` (ยืนยันซ้ำข้อความเดิมไม่สร้างซ้ำ · ข้อความต่าง = สัญญาณใหม่ ของเก่าเจ้าของ set_status เอง) · คืน `signal_id` หรือ null
- ไม่เขียน `content_piece_event` · ไม่แตะ `piece_status`

### 13.3 view — 0161 · ทุกตัว `with (security_invoker = true)` · grant select service_role · **ไม่ replace view เดิม** (0149/0160 คงเดิม) · **ไม่กรองร้าน** — frontend `.eq('shop_id')` เสมอ (บทเรียน C2) · "วันนี้" = `(now() at time zone 'Asia/Bangkok')::date` · ห้ามซ้อนบน `v_content_piece` (D15)

**`v_content_post_missed_window`** (หน้า J "พลาดรอบไปแล้ว") — 1 แถว/โพสต์/หน้าต่างที่ปิดแล้วและไม่มีตัวเลข: `post_id · shop_id · platform · post_url · posted_at · posted_date_th · step_id · hook_id · age_days_today · read_round (1/2/3) · window_lo · window_hi · window_closed_on (= posted_date_th + hi)` · เงื่อนไข: `content_post.status = 'active'` · `age_days_today > hi` · `not exists metric where age_days between lo and hi and num_nonnulls(5 col) > 0` (สูตรเดียวกับ `v_content_entry_queue` H3 — ตารางค่า `(1,1,2),(2,3,4),(3,5,9)` ลอกตรงจาก 0149 · ⚠️ สองที่ต้องเท่ากันเสมอ · verify N3 เทียบ `pg_get_viewdef` ทั้งสองมี values ชุดเดียวกัน) · หน้าต่าง 3 (T+7) พลาด = โพสต์นี้ "ตกจากการเทียบถาวร" — view ไม่แต่งค่าแทน (KPI def 2.1) · เรียง `posted_at desc`

**`v_content_post_result`** (หน้า K ต่อโพสต์ · ฐานของ rollup และ `v_campaign_summary`) — 1 แถว/โพสต์ `status = 'active'` ทุก platform (LINE ไม่มีแถว `content_post` อยู่แล้ว = ไม่มีผลรายชิ้นโดยโครงสร้าง):
- จาก `content_post` p: `post_id · shop_id · platform · external_id · post_url · posted_at · posted_date_th · content_type_code · caption_snapshot · step_id · hook_id`
- จาก `v_content_post_t7` t7 (join `post_id`): `t7_captured_on · t7_age_days · t7_view_count · t7_save_count · t7_share_count · save_rate · share_rate · t7_is_regression · t7_unavailable_reason`
- ฐานเทียบ lateral `b`: จาก 10 โพสต์ **ก่อนหน้า** (`q.shop_id = p.shop_id and q.platform = p.platform and q.status = 'active' and q.t7_captured_on is not null and q.save_rate is not null and (q.posted_at, q.post_id) < (p.posted_at, p.post_id)` `order by posted_at desc, post_id desc limit 10` ใน subquery แล้ว aggregate): `baseline_n · baseline_save_p25/p50/p75 · baseline_share_p25/p50/p75` (`percentile_cont` · `round(…,4)`) · ห้ามเอาโพสต์ตัวเองหรือหลังจากตัวเองเข้าฐาน (ป้ายนิ่ง — C3-6)
- `save_label` = null เมื่อ `t7_captured_on is null` หรือ `save_rate is null` หรือ `baseline_n < 4` · ไม่งั้น `case when save_rate > p75 then 'above' when save_rate < p25 then 'below' else 'normal'` · `share_label` สูตรเดียวกับ share · **`computed_label` = `save_label`** (บันทึก = สัญญาณหลัก KPI def §4 · share เป็นตัวรอง ไม่ fallback เงียบ) · `computed_reason` text: `'ไม่มี snapshot T+7: '||t7_unavailable_reason` / `'ไม่มีค่า save ที่ T+7'` / `format('ยังสรุปไม่ได้ (%s/4)', baseline_n)` / null เมื่อมีป้าย
- จากเจ้าของ: `result_label_override · result_confirmed_at · result_lesson` · `effective_label = coalesce(result_label_override, computed_label)` · `label_source` = `'owner'` / `'computed'` / `'none'`
- hook: `hook_text · hook_type · hook_label (A/B/null) · hook_origin` (left join `content_hook`) — `hook_id` null = "ไม่ได้เลือก" (มติ Q6)
- ชิ้นงาน: `step_title · piece_kind · customer_group · campaign_id · campaign_name` (left join `campaign_step`/`campaign` ตรง — ไม่ผ่าน `v_content_piece`)
- **โฮสต์คืนนั้น**: left join `live_session_log l on l.shop_id = p.shop_id and l.live_date = p.posted_date_th` → `live_host.public_label` เป็น `host_public_label` · `host_logged boolean` (มี log คืนนั้น) · `host_id` · **ไม่มี `display_name`** (ป้าย A/B เท่านั้น — ชื่อจริงไม่ออก view ตามมติ 6 ต.ค.) · กติกา: โพสต์วันไทย D ↔ ไลฟ์คืน D (คลิปปล่อย "ก่อนไลฟ์คืนนั้น" ตาม workflow · โพสต์หลังเที่ยงคืนนับเป็นวันถัดไปทั้งคู่ — Q11)
- `regression_any boolean` = มี metric แถวใดของโพสต์ `is_regression` (ธงให้ UI เตือน "ตัวเลขเคยถอยหลัง")
- เรียง `posted_at desc` · perf: lateral ×(≤10) ต่อโพสต์บน `v_content_post_t7` ซึ่ง lateral เองอีกชั้น — 10 โพสต์วันนี้ ≈ ms · เกิน ~500 โพสต์ค่อย materialize (D19)

**`v_content_hook_type_rollup`** (หน้า K ต่อ hook_type · ตารางดิบ) — grouping sets บน `(shop_id, hook_type)` และ `(shop_id, hook_type, host_scope)`:
- ฐาน: `content_post p` active · `p.hook_id is not null` · join `content_hook h on h.id = p.hook_id and h.origin = 'ours' and h.hook_type is not null` (เฉพาะของเรา — มติ D8 · ไม่ติดประเภท = ไม่เข้า) · left join `v_content_post_result r on r.post_id = p.id` (ป้าย+โฮสต์) · `host_scope = coalesce(r.host_public_label, 'ไม่ระบุโฮสต์')`
- คอลัมน์: `shop_id · hook_type · host_scope` (`'all'` ในแถวรวมจาก `grouping(host_scope) = 1` — ไม่ใช่ null · null-safe สำหรับ UI) · `posts_n` · `pieces_n (count distinct step_id)` · `measured_pieces_n (count distinct step_id filter t7_captured_on not null)` · `measured_posts_n` · `labeled_n` · `above_n · normal_n · below_n` (จาก `effective_label` — ป้ายเจ้าของยืนยันชนะป้ายคำนวณ) · `median_save_rate · median_share_rate` (percentile_cont บน measured) · `last_measured_on` · `host_mixed boolean` (แถว all: measured กระจายมากกว่า 1 host_scope) · `verdict` = `case when measured_pieces_n < 4 then format('ยังสรุปไม่ได้ (%s/4)', measured_pieces_n) else 'สรุปได้' end`
- **นิยาม n เดียวกับ `v_content_hook_library.type_n_pieces`** (0160: distinct step ของ ours ที่ผูกโพสต์ active + มี t7) ⇒ `type_verdict` ที่นั่นกับ `verdict` ที่นี่ต้องตรงกันทุกแถว (verify N6 assert) · library เก็บ avg (ของเดิม ไม่แตะ) · rollup ให้ median + ป้าย + โฮสต์ — หน้า K ใช้ rollup · หน้า B (คลัง) ใช้ library · ไม่ replace library เพราะเลี่ยงได้ (ข้อ 9) — ถ้าวันหน้าอยากให้ library อ่าน median ให้ replace แบบต่อท้ายคอลัมน์ (trap #3) ไม่ใช่รอบนี้
- **วิธีแสดงเรื่องโฮสต์** (ข้อ 3 ของบรีฟ): UI แสดงแถว `host_scope='all'` เป็นหัว + แถวย่อยต่อโฮสต์ · ถ้า `host_mixed` ให้ติดคำเตือน "ผลรวมปนโฮสต์ต่างกัน — ดูแถวย่อย" · verdict ต่อโฮสต์ย่อยใช้ n ของโฮสต์นั้นเอง (คืนโฮสต์ต่างกันไม่เทียบตรง — F5 +161% มาจากโฮสต์) · ไม่มีการถ่วงน้ำหนัก/ปรับฐานข้ามโฮสต์ (ไม่ใช่ A/B engine · CEO NO-GO)

### 13.4 DDL — 0162 (ป้อนกลับ) · ด่านต้นไฟล์: ต้องมี `v_content_post_result` + `content_post.result_label_override` (0161 ลงแล้ว) ไม่งั้น raise

**`campaign` เพิ่ม** (nullable ล้วน · `add column if not exists` · CHECK ชื่อ `campaign_<col>_check` drop-if-exists ก่อน add · ไม่มี UPDATE ⇒ `trg_campaign_updated_at` ไม่ยิง):

| คอลัมน์ | CHECK (`x is null or …`) |
|---|---|
| `metric_code` | `in ('save_rate','share_rate','peak_viewers','line_reply_count','none')` — ชุดเดียวกับ step |
| `baseline_value` · `pass_threshold` | `(x >= -1000000000000 and x <= 1000000000000)` (trap #4) |
| `baseline_spread` | `(x >= 0 and x <= 1000000000000)` |
| `baseline_as_of` | date · ≤ วันไทย ตรวจใน RPC |
| `baseline_note` | `length <= 500` |
| `pass_op` | `in ('>=','<=')` |
| `result_verdict_proposed` | `in ('validated','invalidated','inconclusive','not_measured')` (ชุดเดียวกับ `result_verdict` เดิม 0101) |
| `result_proposed_note` | `length between 3 and 1000` |
| `result_proposed_at` timestamptz · `result_proposed_by_role` | role `in ('owner','ai','system')` · CHECK `campaign_result_proposed_consistency_check`: `(result_verdict_proposed is null) = (result_proposed_at is null) and (result_proposed_at is null) = (result_proposed_by_role is null)` |
| `result_verdict_confirmed_at` timestamptz · `result_verdict_confirmed_by_role` | role `= 'owner'` · CHECK `(result_verdict_confirmed_at is null) = (result_verdict_confirmed_by_role is null)` |
| `lesson` | `length <= 500` |

- `result_verdict` (0101 · not null default `'not_measured'`) และ `result_note` **คงเดิมเป็นค่าที่ยืนยัน** — 12 แถวเก่าอ่านว่า "ยังไม่ได้วัด" ถูกต้องอยู่แล้ว · UI แสดงคำตัดสินเฉพาะ `result_verdict_confirmed_at is not null` (ดู `verdict_display` ใน 13.6)
- **trigger `trg_campaign_result_guard`** BEFORE UPDATE: `current_user in (3 role)` และคอลัมน์ `result_verdict · result_note · result_verdict_proposed · result_proposed_note · result_proposed_at · result_proposed_by_role · result_verdict_confirmed_at · result_verdict_confirmed_by_role · lesson · hypothesis · metric_code · baseline_* · pass_*` ตัวใด `is distinct from` → 55000 "แก้สมมติฐาน/คำตัดสินแคมเปญผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm" · คอลัมน์อื่น (status/anchor/blocked_reason — บอร์ดเดิม) ปล่อย · ⚠️ ตรวจว่าแอปเดิมไม่ได้ UPDATE `hypothesis` ตรง: grep `lib/` `app/` หา `hypothesis`/`result_verdict` ก่อน apply (verify N9 + QA) — ถ้ามี ให้ย้ายไป `campaign_plan_set` ในรอบเดียวกัน

**`recommendation_log` เพิ่ม** (ไม่แตะ `v_recommendation_acceptance` — trap #3 · ไม่แตะ CHECK `source` เดิม 3 ค่า):

| คอลัมน์ | นิยาม |
|---|---|
| `kind text not null default 'proposal'` | CHECK `in ('proposal','question')` (ไม่มี `risk_gate` — C3-2) · 12 แถวเก่า = proposal (ถูก: ทั้งหมดเป็นข้อเสนอ R1–R12) |
| `respond_by date` | เส้นตาย (วันไทย) · nullable = ใช้กติกา 14 วันของ 0101 |
| `default_action text` | `length between 1 and 500` · CHECK `recommendation_log_deadline_needs_default_check`: `respond_by is null or default_action is not null` (มีเส้นตายต้องประกาศค่าเริ่มต้น — brief §3.4) |
| `related_step_id uuid` | FK → `campaign_step(id) on delete set null` · index partial |
| `summary_id uuid` | FK → `content_weekly_summary(id) on delete set null` · index partial (ข้อเสนอของ Brief ฉบับไหน) |
| `created_by_role text` | `in ('owner','ai','system')` nullable (ของเก่า null = ไม่รู้ ไม่เดา) |
| `acted_by_role text` | `= 'owner'` nullable · CHECK `owner_action = 'pending' or acted_by_role is not null or acted_at < <timestamp ของ apply>`? — **ไม่ใส่** (แถว done เก่า 3 แถวไม่มี role · ใส่ CHECK แบบมีเวลา = ค่าคงที่แปลกในสคีมา) ⇒ บังคับที่ RPC แทน |

- ใช้ `outcome_note` เดิมเป็นคำตอบ (Δ7) · `acted_by` = `auth.uid()` (null จนกว่า A2)
- **trigger `trg_recommendation_log_guard`** BEFORE INSERT OR UPDATE OR DELETE: 3 role → INSERT = 55000 "สร้างข้อเสนอผ่าน recommendation_create" · DELETE = 55000 (0101: ห้ามให้แถว rejected/expired หายก่อนวัน 90) · UPDATE ที่เปลี่ยน `owner_action/acted_at/acted_by/acted_by_role/outcome_note` = 55000 "ตอบผ่าน recommendation_respond" · UPDATE คอลัมน์อื่น (title/detail/respond_by — แก้คำผิดของข้อเสนอที่ยัง pending) ปล่อยเฉพาะเมื่อ `old.owner_action = 'pending'` ไม่งั้น 55000 "ข้อเสนอที่ตอบแล้วแก้ไม่ได้" · `postgres` (MCP ของ Tech Lead) ผ่านทุกข้อ — บันทึกใน D18

**ตารางใหม่ `content_weekly_summary`**: `id uuid pk · shop_id → shop cascade · week_start date not null` (CHECK `extract(isodow from week_start) = 1` · `>= date '2025-01-01'`) · `brief_date date not null` (CHECK `brief_date >= week_start and brief_date <= week_start + 14`) · `brief_no int` (CHECK 1..9999 · nullable) · `summary_lines text[] not null` (CHECK ระดับตาราง = `cardinality(summary_lines) between 1 and 5` เท่านั้น — ความยาว/ความว่างของแต่ละบรรทัดตรวจใน RPC เพราะ CHECK ใส่ subquery/unnest ไม่ได้ · guard trigger กันเขียนตรง) · `body_md text not null` (CHECK `length between 1 and 80000`) · `source_path text` (CHECK `~ '^docs/3j-jewelry/marketing/weekly-brief/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$'`) · `created_by_role text not null` (`in ('owner','ai','system')`) · `created_by uuid` · `created_at · updated_at` + `trg_content_weekly_summary_updated_at` (`public.set_updated_at`) · `unique (shop_id, week_start)` · RLS + `tenant_isolation_select` · grant select service_role · **guard trigger** BEFORE INSERT OR UPDATE OR DELETE: 3 role → 55000 "เขียนผ่าน content_weekly_summary_upsert" · ไม่มี FK ไป reco (ทิศเดียว reco → summary)

### 13.5 RPC — 0162 (ทุกตัว definer · service_role · `crm_require_owner_admin` · `content_actor_assert` · คืน jsonb)

**`campaign_plan_set(p_shop_id uuid, p_campaign_id uuid, p_set jsonb, p_actor_role text) returns jsonb`** → `{campaign_id, changed:{key:{from,to}}}` — สมมติฐาน+ฐาน+เกณฑ์ระดับแคมเปญ (หน้า E)
- key ที่รับ: `hypothesis · metric_code · baseline_value · baseline_as_of · baseline_note · pass_threshold · pass_op · baseline_spread` · key นอกรายการ = 22023 · `jsonb_typeof='null'` = ล้าง (trap #13) · ตัวเลขผ่าน `content_piece_try_numeric_` (0159 — reuse) แล้ว not(between) · `baseline_as_of` ≤ วันไทย · `hypothesis` = `content_text_clean` 1..1000 · ไม่มี key เปลี่ยนจริง = 22023 "ไม่มีค่าเปลี่ยน"
- ล็อก campaign (shop) · `result_verdict_confirmed_at is not null` → 55000 "ปิดแล้ว" ทุก actor
- actor: owner ทุกสถานะที่ยังไม่ปิด · **ai/system เฉพาะเมื่อแคมเปญยังไม่มีชิ้นโพสต์** (`not exists campaign_step where campaign_id and piece_status = 'posted'` และ `not exists content_post join campaign_step … status active`) — AI เสนอสมมติฐานก่อนเริ่ม ไม่ย้ายเสา (ฐาน/เกณฑ์) หลังผลออก → 42501
- ไม่เขียน `content_piece_event` (ไม่ใช่ชิ้น) · บันทึก diff ใน `campaign.note`? **ไม่** — ประวัติระดับแคมเปญยังไม่มีตาราง (หนี้ D20 · `updated_at` พอสำหรับรอบแรก)

**`campaign_verdict_propose(p_shop_id uuid, p_campaign_id uuid, p_verdict text, p_note text, p_actor_role text) returns jsonb`** → `{campaign_id, proposed, previous_proposed, awaiting_owner:true}`
- actor owner/ai/system (AI = ผู้เสนอหลัก · owner เสนอเองได้แต่ควร confirm ตรง) · `p_verdict` ใน 4 ค่า · `p_note` = `content_text_clean` 3..1000 บังคับ (หลักฐาน/เหตุผล — ข้อเสนอเปล่าไม่รับ) · marker = 22023
- ล็อก campaign (shop) · `result_verdict_confirmed_at is not null` → 55000 "เจ้าของยืนยันแล้ว (<result_verdict>) — แก้ผ่าน campaign_verdict_confirm เท่านั้น"
- ด่านเนื้อหา (กัน AI ฟันธงจาก noise — KPI def §0): `p_verdict in ('validated','invalidated')` และ `metric_code in ('save_rate','share_rate')` → ต้องมีโพสต์ของแคมเปญที่ `t7_captured_on is not null` อย่างน้อย **4** (นับจาก `v_content_post_result` join step) ไม่งั้น 55000 "ยังไม่ครบ 4 ชิ้นที่มีผล T+7 (มี n) — เสนอได้แค่ inconclusive/not_measured" · `metric_code` อื่น/null (legacy · peak_viewers วัดจาก v_live_night) ไม่ติดด่านนี้ (วัดนอกตารางนี้ · ไม่เดา)
- เสนอซ้ำได้ (ทับ proposed/note/at/by_role · `previous_proposed` คืนค่าเก่า) · ไม่เปลี่ยน `status` · ไม่แตะ `result_verdict`
- **ไม่สร้าง `recommendation_log`** — `v_recommendation_inbox` ดึงแคมเปญที่ proposed แต่ยังไม่ confirmed ให้เอง (C3-2)

**`campaign_verdict_confirm(p_shop_id uuid, p_campaign_id uuid, p_verdict text, p_lesson text, p_actor_role text, p_note text default null, p_expected_proposed text default null) returns jsonb`** → `{campaign_id, verdict, proposed_was, status, signal_id}` · **owner เท่านั้น**
- `p_verdict` 4 ค่า · `p_lesson` clean ≤500 (null ได้) · `p_note` clean ≤1000 (null = คง `result_note` เดิม) · marker ในทั้งคู่ = 22023
- ล็อก campaign (shop) · `p_expected_proposed` ไม่ null และ `is distinct from result_verdict_proposed` → 55000 "ข้อเสนอเปลี่ยนไปแล้ว รีเฟรช" (compare-and-set · `p_expected_proposed = ''` = คาดว่าไม่มีข้อเสนอ)
- ด่านชิ้นค้าง (C3-5): `exists campaign_step where campaign_id and piece_status is not null and piece_status not in ('posted','cancelled')` → 55000 "ยังมีชิ้นงานค้าง n ชิ้น (สถานะ …) — โพสต์/ยกเลิกให้ครบก่อนปิดแคมเปญ" (`not in` บนค่าที่ไม่ null — ปลอดภัย)
- ด่าน 4 ชิ้น **เหมือน propose** สำหรับ validated/invalidated + metric save/share (เจ้าของก็ไม่ควรฟันธงจาก 2 ชิ้น — KPI def "ต่อรองไม่ได้") · owner ที่ยืนยันขัดข้อเสนอ AI = ปกติ (เก็บทั้งสองค่าอยู่แล้ว)
- เขียน: `result_verdict = p_verdict` · `result_note = coalesce(p_note, result_note)` · `result_verdict_confirmed_at = now()` · `_by_role = 'owner'` · `lesson = p_lesson` · `status = 'done'` เฉพาะเมื่อ `status <> 'done'` (CHECK 0049 มี 'done') · `updated_by = auth.uid()`
- บทเรียนไม่ว่าง → `content_signal_capture(... 'insight', <lesson>, p_source 'owner', p_seen_on วันไทย, p_origin_campaign_id, p_confidence 'observation', p_actor_role 'owner')` กันซ้ำแบบเดียวกับ post (origin_campaign_id + summary เดิม = ไม่สร้าง)
- ยืนยันซ้ำได้ (เปลี่ยนใจ — ทับ) · `proposed_*` **ไม่ล้าง** (ประวัติว่า AI เสนออะไร)

**`recommendation_create(p_shop_id uuid, p_title text, p_detail text, p_actor_role text, p_kind text default 'proposal', p_source text default 'agent', p_effort_minutes_est int default null, p_respond_by date default null, p_default_action text default null, p_related_campaign_id uuid default null, p_related_step_id uuid default null, p_summary_id uuid default null) returns uuid`**
- actor owner/ai/system · `p_kind in ('proposal','question')` · `p_source` ใน 3 ค่าเดิม · title clean 1..200 · detail clean 1..4000 (marker **อนุญาต** — คำถามถึงเจ้าของอาจอ้าง `[ต้องยืนยัน]` ของชิ้น) · effort null หรือ 1..480 (CHECK 0101)
- `p_respond_by`: null ได้ · ไม่ null → `isfinite` · ≥ วันไทย · ≤ วันไทย + 90 (22023) และ `p_default_action` clean 1..500 บังคับ (22023 "มีเส้นตายต้องบอกค่าเริ่มต้น") · ส่ง default_action โดยไม่มี respond_by = 22023 (ค่าเริ่มต้นไม่มีความหมายถ้าไม่มีเส้นตาย)
- `related_campaign_id`/`related_step_id`/`summary_id` ต้องอยู่ร้านเดียวกัน (22023) · step ต้อง `piece_status is not null` (ข้อเสนอผูกชิ้นใน workflow ใหม่เท่านั้น)
- **กันซ้ำ**: มีแถว `shop_id and lower(title) = lower(v_title) and owner_action = 'pending'` → 23505 "ข้อเสนอชื่อนี้ยังรอตอบอยู่ (id …)" — Brief รันซ้ำ/Tech Lead เรียกสองรอบไม่ได้แถวคู่
- insert: `created_by_role = p_actor_role · created_by = auth.uid()` · `owner_action='pending'` (default)

**`recommendation_respond(p_shop_id uuid, p_id uuid, p_action text, p_response text, p_actor_role text) returns jsonb`** → `{id, owner_action, acted_at, late:boolean, default_action_was}` · **owner เท่านั้น**
- `p_action in ('done','rejected')` (expired = view เท่านั้น ไม่เขียน — หลัก 0101) · `p_response` clean · `rejected` → บังคับ 3..1000 (เหตุผล) · `done` → null หรือ ≤1000 · marker = 22023
- ล็อกแถว (shop) · `owner_action <> 'pending'` → 55000 "ตอบแล้ว (<owner_action> เมื่อ <acted_at>)" (compare-and-set ในตัว — แถวเดียวกันตอบซ้อนกันไม่ได้)
- เขียน `owner_action · acted_at = now() · acted_by = auth.uid() · acted_by_role = 'owner' · outcome_note = p_response` ในคำสั่งเดียว (CHECK consistency 0101 ตรวจแถวสุดท้าย) · `late = respond_by is not null and วันไทย > respond_by` (ตอบช้าได้ — คำตอบจริงชนะค่าเริ่มต้น · view แสดง `late`)

**`content_weekly_summary_upsert(p_shop_id uuid, p_week_start date, p_brief_date date, p_summary_lines text[], p_body_md text, p_actor_role text, p_brief_no int default null, p_source_path text default null) returns uuid`**
- actor owner/ai/system · `week_start` จันทร์ (isodow=1) · `isfinite` · `>= 2025-01-01` · `<= วันไทย` · `brief_date` ใน `[week_start, week_start+14]` และ ≤ วันไทย · lines: cardinality 1..5 · แต่ละตัว `content_text_clean` แล้ว length 1..300 (ว่างหลัง clean = 22023) · body `length 1..80000` (ไม่ clean — markdown ต้องคง whitespace · แต่ตรวจอักขระล่องหน bidi ด้วย regex เดียวกับ `content_text_clean` แล้ว raise 22023 ถ้าพบ — ไม่แก้เงียบ) · `source_path` regex ตาม CHECK
- `insert … on conflict (shop_id, week_start) do update` ทับ lines/body/brief_date/brief_no/source_path (Brief แก้แล้วส่งใหม่ = ตั้งใจ · ประวัติอยู่ใน git ของ md) · คืน id

### 13.6 view — 0162 · กติกาเดียวกับ 13.3 (security_invoker · service_role · ไม่กรองร้าน · วันไทย · ไม่ซ้อน `v_content_piece`)

**`v_campaign_summary`** (หน้า E รายการ+รายละเอียด) — 1 แถว/`campaign` ทุกแถว (รวม legacy 12):
- จาก `campaign`: `campaign_id · shop_id · name · campaign_type · trigger_kind · status · anchor_date · hypothesis · metric_code · baseline_value · baseline_as_of · baseline_note · pass_threshold · pass_op · baseline_spread · result_verdict · result_note · result_verdict_proposed · result_proposed_note · result_proposed_at · result_proposed_by_role · result_verdict_confirmed_at · lesson · created_at · updated_at`
- `threshold_too_narrow` = **สูตรเดียวกับ `v_content_piece`** (0159: `baseline_spread is not null and pass_threshold is not null and baseline_value is not null and abs(pass_threshold - baseline_value) < baseline_spread`) — คำเตือน "เกณฑ์นี้แยกผลจากความบังเอิญไม่ได้" (brief E) · verify N10 เทียบ `pg_get_viewdef` ทั้งสองมีนิพจน์เดียวกัน
- ชิ้นงาน (จาก `campaign_step` ตรง · นับเฉพาะ `piece_status is not null`): `pieces_total · pieces_posted · pieces_cancelled · pieces_open (= total − posted − cancelled) · pieces_measured (distinct step ที่มีโพสต์ active + t7 — จาก `v_content_post_result`)` · `date_from/date_to` = min/max `resolved_start` (สูตร anchor+offset ของ `v_campaign_board`)
- โพสต์ (จาก `v_content_post_result` r join `campaign_step` s on r.step_id = s.id and s.campaign_id): `posts_active_n · posts_measured_n · posts_above_n · posts_normal_n · posts_below_n` (จาก `effective_label`) · `latest_t7_on`
- `verdict_display` = `case when result_verdict_confirmed_at is not null then result_verdict when result_verdict_proposed is not null then 'proposed:' || result_verdict_proposed else null end` (null = ยังไม่มีคำตัดสิน · UI แสดง "—" · **ไม่แสดง `result_verdict='not_measured'` ของ legacy เป็นคำตัดสิน**)
- `stage` (brief §3.3 ร่าง→กำลังทำ→รออ่านผล→ปิดแล้ว): `'closed'` เมื่อ confirmed หรือ `status='done'` · `'awaiting_read'` เมื่อ `pieces_total > 0 and pieces_open = 0 and pieces_posted > 0` · `'running'` เมื่อ `pieces_posted > 0 or exists piece in ('drafting','in_review','approved','produced')` หรือ legacy `status in ('active','blocked','waiting_data')` · `'draft'` อื่นๆ · `awaiting_confirm boolean` = proposed ไม่ null และยังไม่ confirmed
- ไม่มี `display_name` โฮสต์ · ไม่รวมยอดเงิน (ยอดคืนอยู่ `v_live_night_locked` — หน้า E ลิงก์ไป ไม่ซ้ำ)

**`v_recommendation_inbox`** (inbox กอง 4 + หน้า K "ข้อเสนอในสรุปตอบได้") — union 3 แหล่ง ชนิดคอลัมน์ตรงกันทุกแขน:
`item_kind text ('reco'|'risk_gate'|'campaign_verdict') · item_id uuid · shop_id · kind ('proposal'|'question') · title · detail · effort_minutes_est int · respond_by date · default_action · related_campaign_id · related_step_id · summary_id · source text · created_at timestamptz · owner_action text · effective_action text · days_left int · is_late boolean · outcome_note · acted_at · respond_via text`
1. **reco**: ทุกแถว `recommendation_log` (ประวัติด้วย — UI กรอง pending) · `effective_action` = `owner_action` เมื่อ ≠ pending · pending + `respond_by < วันไทย` → `'expired'` · pending + `respond_by is null` + `now() − created_at > 14 days` → `'expired'` (กติกา 0101 คงไว้สำหรับแถวไม่มีเส้นตาย) · ไม่งั้น `'pending'` · `days_left = respond_by − วันไทย` (null เมื่อไม่มีเส้นตาย) · `is_late = acted_at is not null and respond_by is not null and (acted_at at time zone 'Asia/Bangkok')::date > respond_by` · `respond_via = 'recommendation_respond'` · UI แสดง expired ว่า "หมดเวลา — ใช้ค่าเริ่มต้น: <default_action>" (brief §3.4)
2. **risk_gate**: `step_gate g join campaign_step s` where `g.gate_kind = 'risk_owner' and g.status in ('pending','blocked') and s.piece_status in ('drafting','in_review')` (เงื่อนไขเดียวกับ `v_content_inbox_counts.owner_questions` 0160 — verify N11 นับเท่ากัน) · `item_id = s.id` · `kind='question'` · `title = 'ด่านความเสี่ยง: ' || s.title` · `detail = coalesce(g.detail->>'question', g.note, '(ไม่มีคำถาม)')` · `related_step_id = s.id` · `related_campaign_id = s.campaign_id` · `source = 'agent'` · `created_at = g.created_at` · `owner_action/effective_action = 'pending'` · `respond_by/default_action/days_left` null (ด่านไม่มีค่าเริ่มต้น — AI ตัดสินแทนไม่ได้) · `respond_via = 'content_gate_record'`
3. **campaign_verdict**: `campaign` where `result_verdict_proposed is not null and result_verdict_confirmed_at is null` · `item_id = campaign.id` · `kind='question'` · `title = 'ยืนยันคำตัดสินแคมเปญ: ' || name` · `detail = result_verdict_proposed || ' — ' || result_proposed_note` · `source` = map `result_proposed_by_role` (ai→'agent' · owner/system→'adhoc') · `created_at = result_proposed_at` · pending · `respond_via = 'campaign_verdict_confirm'`
- เรียง `created_at desc` · **ตัวนับกอง 4 ของ UI = `count(*) where effective_action = 'pending'` จาก view นี้** (ไม่ใช่ `owner_questions` ของ 0160 ซึ่งนับแค่ด่าน — บันทึกให้ frontend)
- ไม่ mutate แถว (หลัก 0101) · ไม่มี cron expire

### 13.7 เคสที่ "ต้องถูกปฏิเสธ" — บรีฟ backend-dev + verify (ด่านที่ตก · errcode) · ทุกเคสยิงใน do-block + raise (ROLLBACK)

| # | เคส | ตกที่ด่าน | code |
|---|---|---|---|
| Y1 | `content_post_metric_amend` actor `ai` / `system` | actor_assert owner | 42501 |
| Y2 | amend `p_set` = `'[]'` · `'{}'` · `{"saves": 5}` (key ผิด) · `{"save_count": "12"}` (string) · `{"save_count": 12.5}` · `{"save_count": -1}` · `{"save_count": 1e3}` · `{"view_count": true}` | ข้อ 2 | 22023 |
| Y3 | amend `p_reason` = `''` · `'ok'` (2 ตัว) · ZWSP ล้วน · มี `[ต้องยืนยัน` | ข้อ 3 | 22023 |
| Y4 | amend `p_captured_on` = พรุ่งนี้ (ไทย) · `'infinity'` · วันไทย − 31 · วันที่ไม่มีแถว (ของจริง `dbf0c8be…` มีแถวเดียว 27 ก.ย. — ลองวันถัดไป) | ข้อ 5/6 | 22023/55000 |
| Y5 | amend ทั้ง 5 key เป็น json null บนแถวจริง | num_nonnulls = 0 | 55000 |
| Y6 | amend ค่าเท่าเดิมทุก key (`{"view_count": 4512}` บน `025d3fb2…` ที่เป็น 4512 อยู่แล้ว) | ไม่มีค่าเปลี่ยน | 22023 |
| Y7 | amend โพสต์ `deleted` (ของจริง 2 แถว) · โพสต์ร้านอื่น (uuid สุ่ม) | status / lock | 55000/22023 |
| Y8 | `update analytics.content_post_metric set save_count = 99` และ `delete from …` โดย `set local role service_role` (grant ชั่วคราว 18.5) | trigger guard ข้อ 1/2 | 55000 |
| Y9 | หลัง amend `save_count=20` (ล็อก) บน `025d3fb2…` → `content_post_metric_upsert(... p_save 5, p_source 'tiktok_api')` วันเดียวกัน → `save_count` ยัง 20 · `raw->'kept_manual'` มี 'save_count' · `sources` มี tiktok_api · `is_regression` คิดจากค่าที่คง ("ทับไม่ได้" — assert ไม่ใช่ raise) | trigger ข้อ 3 | — |
| Y10 | `update/delete analytics.content_post_metric_amend_log` · `truncate` | append-only | 42501 |
| Y11 | `content_post_verdict_confirm` actor ai · `p_label='great'` · โพสต์ไม่มี t7 (ของจริง 9/10 — ข้อความต้องมี `t7_unavailable_reason`) · โพสต์ deleted · `p_lesson` มี marker · `p_expected_computed='above'` ขณะ computed เป็น null | ตามแถว | 42501/22023/55000 |
| Y12 | `update analytics.content_post set result_label_override='above'` โดย service_role (`set local role`) · ตั้ง `result_label_override` โดย `result_confirmed_at` null (postgres ตรง) | guard / CHECK consistency | 55000/23514 |
| Y13 | `campaign_plan_set` key `"hypotesis"` · `baseline_value:"NaN"` · `baseline_as_of` พรุ่งนี้ · `pass_op:'>'` · บน campaign confirmed แล้ว (fixture) · actor ai บน campaign ที่มีชิ้น posted (fixture) · campaign ร้านอื่น | whitelist/not(between)/วัน/CHECK/ปิดแล้ว/role/lock | 22023/55000/42501 |
| Y14 | `campaign_verdict_propose` `p_note` null/2 ตัว · verdict `'maybe'` · `'validated'` บน campaign `metric_code='save_rate'` ที่โพสต์ t7 < 4 · บน campaign confirmed แล้ว | note/ค่า/ด่าน 4 ชิ้น/ปิดแล้ว | 22023/55000 |
| Y15 | `campaign_verdict_confirm` actor ai · `p_expected_proposed='validated'` ขณะ proposed null · campaign ที่มีชิ้น `in_review` ค้าง (fixture) · `'invalidated'` บน metric save_rate ที่ t7 < 4 | role/CAS/ชิ้นค้าง/4 ชิ้น | 42501/55000 |
| Y16 | `update analytics.campaign set result_verdict='validated'` และ `set hypothesis='x'` โดย service_role (`set local role`) · แต่ `set status='done'` โดย service_role **ต้องผ่าน** (ไม่ถูก guard — บอร์ดเดิม) | guard result | 55000 / — |
| Y17 | `recommendation_create` kind `'risk_gate'` · source `'cron'` · title ว่าง · `respond_by` = เมื่อวาน / วันไทย+91 / `'infinity'` · `respond_by` มีแต่ `default_action` null · `default_action` มีแต่ `respond_by` null · `related_step_id` ของ step `piece_status null` (ของจริงก่อน ต.ค.) · step/campaign/summary ร้านอื่น | ตามแถว | 22023 |
| Y18 | `recommendation_create` title ซ้ำแถว pending จริง ("R11 · ภาพหน้าประวัติ broadcast…" ต่างตัวพิมพ์) | กันซ้ำ | 23505 |
| Y19 | `recommendation_respond` actor ai · action `'expired'`/`'pending'` · `rejected` ไม่มีเหตุผล · แถว `done` จริง (`eac48634…` R10) ตอบซ้ำ · id ร้านอื่น | role/ค่า/เหตุผล/CAS/lock | 42501/22023/55000 |
| Y20 | `insert into analytics.recommendation_log …` · `update … set owner_action='done'` · `delete` โดย service_role (`set local role`) · `update … set title='x'` บนแถว done โดย postgres | guard | 55000 |
| Y21 | `content_weekly_summary_upsert` `week_start` อังคาร · `2024-12-30` · จันทร์หน้า · `brief_date` = week_start − 1 / + 15 · lines 6 ตัว / `{''}` / ตัวยาว 301 / ZWSP ล้วน · body ว่าง / 80,001 / มีอักขระ bidi · `source_path='docs/x.md'` · actor `'assistant'` | ตามแถว | 22023 |
| Y22 | `insert/update/delete analytics.content_weekly_summary` โดย service_role | guard | 55000 |
| Y23 | เรียก RPC ใหม่ทั้ง 9 ตัว + helper จาก `set local role authenticated` หลัง `grant usage on schema` ชั่วคราว (18.5) | EXECUTE | 42501 |
| Y24 | `content_post_metric_regression_` ให้ค่า ≠ `is_regression` ของแถวจริงแถวใดใน 5 แถว | assert สูตรเท่า 0148 | — |

### 13.8 เคสที่ "ต้องไม่พัง" — ยิงของใหม่ใส่ของเก่าทุกโหมดจริง (trap #17) · สำคัญเท่า 13.7

| # | เคส | พิสูจน์ด้วย |
|---|---|---|
| N1 | apply 0161/0162 แล้ว: `content_post_metric` 5 แถว md5(id,5 col,is_regression,source,sources,captured_at) เท่าเดิม · `amended_cols='{}'` ทุกแถว · `content_post` 10 แถว md5(id,status,step_id,hook_id,updated_at) + `count(distinct updated_at)` เท่าเดิม · `campaign` 12 แถว md5(id,status,result_verdict,result_note,hypothesis,updated_at) เท่าเดิม · `recommendation_log` 12 แถว md5(id,owner_action,acted_at,outcome_note,updated_at) เท่าเดิม + `kind='proposal'` ทุกแถว | ด่านท้ายไฟล์ (snapshot `c4.snap_*`) + verify |
| N2 | `v_content_post_t7` · `v_content_entry_queue` · `v_content_hook_library` · `v_content_inbox_counts` · `v_content_piece` · `v_campaign_board` · `v_recommendation_acceptance` · `v_live_log_recent`: md5(`pg_get_viewdef`) เท่าเดิม + select ได้ + จำนวนแถว/คอลัมน์เท่าก่อน apply | ด่านท้าย |
| N3 | `v_content_post_missed_window` กับ `v_content_entry_queue` ใช้ตาราง values หน้าต่างชุดเดียวกัน (regex บน viewdef) · โพสต์จริง 10 แถว: แถวที่อยู่ใน entry_queue ต้องไม่อยู่ใน missed ของ round เดียวกัน | verify |
| N4 | `content_post_metric_upsert` ทุกโหมดเดิม (ครั้งแรก · ซ้ำวันเดียวกัน null-preserving · regression จริง · `tiktok_api` บนแถวที่ **ไม่** amend = ทับได้ปกติ) ผลเท่า verify-0148 T-series · md5 ฟังก์ชันไม่เปลี่ยน | รัน verify-0148 ส่วน T ซ้ำหลัง 0161 (ROLLBACK) + md5 |
| N5 | flow amend บนแถวจริง `95f5aff4…` (25/26 ก.ย.): amend 25 ก.ย. `view_count` 2346→3000 → แถว 26 ก.ย. (2645) `is_regression` พลิกเป็น **true** · amend กลับ 3000→2346 → false · log 2 แถว before/after ครบ 5 คอลัมน์ · `regression_recomputed=1` ทั้งสองครั้ง | verify ROLLBACK |
| N6 | `v_content_hook_type_rollup.verdict` = `v_content_hook_library.type_verdict` ทุก (shop, hook_type) · rollup วันนี้ 0 แถว **select ไม่ error** · fixture: 4 ชิ้น hook_type `question` → `content_piece_post` → metric อายุ 7 วัน (posted_at ย้อน) → `verdict='สรุปได้'` · `host_scope` 'all' + 'ไม่ระบุโฮสต์' · `live_session_upsert` คืนหนึ่งพร้อม host → แถว 'โฮสต์ A' โผล่ · `host_mixed=true` บนแถว all | verify ROLLBACK |
| N7 | `v_content_post_result` 10 โพสต์จริง: 9 แถว `computed_label` null + reason ขึ้นต้น 'ไม่มี snapshot T+7' · `025d3fb2…` reason 'ยังสรุปไม่ได้ (0/4)' · `host_public_label` null ทุกแถว · fixture 5 โพสต์ t7 → โพสต์ที่ 5 `baseline_n=4` ป้ายตาม quartile (assert ค่าที่คำนวณมือ) · `content_post_verdict_confirm('below', lesson)` → `effective_label='below'` `label_source='owner'` · signal insight 1 แถว · ยืนยันซ้ำข้อความเดิม = ยัง 1 · ข้อความใหม่ = 2 | verify ROLLBACK |
| N8 | 12 campaign legacy: `v_campaign_summary` 12 แถว `pieces_total=0` · `verdict_display` null · `stage` map จาก status · `campaign_verdict_propose('inconclusive', note)` ใส่ campaign จริง → โผล่ inbox item_kind campaign_verdict · `campaign_verdict_confirm('not_measured', lesson, p_expected_proposed 'inconclusive')` → `status='done'` · `verdict_display='not_measured'` · signal origin_campaign_id · หายจาก inbox | verify ROLLBACK |
| N9 | grep `lib/` `app/`: ไม่มีโค้ดแอป UPDATE `campaign.hypothesis/result_*` หรือ `recommendation_log` ตรง (มี = แก้ก่อน apply) · copilot/calendar ยัง select ได้ | backend-dev grep + QA smoke /marketing/copilot /marketing/calendar /marketing/content |
| N10 | `threshold_too_narrow` ใน `v_campaign_summary` = นิพจน์เดียวกับ `v_content_piece` (regex viewdef) | verify static |
| N11 | `v_recommendation_inbox` 12 reco จริง: R1/R3 (10 ก.ย.) `expired` · R2/R5/R10 `done` · ที่เหลือ pending · นับ item_kind='risk_gate' = `v_content_inbox_counts.owner_questions` (วันนี้ 0) · fixture: `content_gate_record('risk_owner','pending',{question})` โดย ai บนชิ้น drafting → 1 แถว · owner passed → หาย | verify ROLLBACK |
| N12 | `recommendation_create` (respond_by วันไทย+7) → inbox pending `days_left=7` · respond done → `done` `is_late=false` · fixture respond_by = วันไทย−1 (update โดย postgres) → `expired` → respond rejected + เหตุผล → `rejected` `is_late=true` · `v_recommendation_acceptance` เดือนนี้นับถูก | verify ROLLBACK |
| N13 | `content_weekly_summary_upsert` 2 รอบ week เดียว → 1 แถว body ใหม่ · `recommendation_create(... p_summary_id)` ผูกได้ · ลบ summary (postgres) → `summary_id` เป็น null ไม่ลบ reco | verify ROLLBACK |
| N14 | verify-0158/0159/0160 ทั้งชุดยังผ่านหลัง 0161+0162 (ไม่มีฟังก์ชัน 0148/0158/0159/0160 ถูก replace — ด่านท้ายไฟล์นับ md5 ทุกตัวเท่าเดิม · B15a ผ่าน) | รันซ้ำ (ROLLBACK) |
| N15 | หน้าเดิม: คิววางลิงก์ (`ContentEntryQueue`) · KPI (`content-kpi.ts` ← `v_content_post_t7`) · ประวัติโพสต์ (`history/[postId]`) เหมือนเดิม · grep `select('*')` บน content_post ไม่มี | QA smoke M + grep |
| N16 | weekly brief task เดิม (md + Tech Lead insert reco ผ่าน MCP = postgres) ยังทำได้ — guard ปล่อย postgres · **ตั้งแต่ 0162 ลง Tech Lead เปลี่ยนไปเรียก `recommendation_create` + `content_weekly_summary_upsert`** (อัปเดต memory `weekly-brief-task-close-out` + skill `3j-content-orchestration`) | verify (insert ตรงโดย postgres ผ่าน) + บันทึก |
| N17 | รัน 0161→0162 ซ้ำในทรานแซกชันเดียว 2 รอบ = idempotent · `check-analytics-grants.sql` สะอาด · `\r = 0` · RPC ใหม่ `count(*) from pg_proc = 1` ต่อชื่อ (trap #1) | verify + script |
| N18 | ไม่มี `current_date` ใน view/RPC ใหม่ (regex viewdef/prosrc = 0) · มี `Asia/Bangkok` ทุกจุด "วันนี้" | verify static |

### 13.9 ความเสี่ยง · หนี้ใหม่ (D18–D22) · คำถามเจ้าของ · กติกาส่งงาน

| # | ความเสี่ยง / หนี้ | กัน / ต้องปิดเมื่อ |
|---|---|---|
| D18 | guard ระดับตารางของ C3 ใช้ `current_user` อย่างเดียว (ไม่มี GUC) — `postgres` (MCP execute_sql ของ Tech Lead · run-sql) ผ่านทุกด่าน · service_role/REST ไม่ผ่าน | อ่อนกว่า 0159 หนึ่งขั้น แต่กันเส้นทางแอป+service key ได้จริง (Y8/Y12/Y16/Y20/Y22) · Tech Lead เขียนตรงต้องผ่าน RPC ตั้งแต่ 0162 ลง (N16) · ปิดเมื่อ A2 · ⚠️ (security 0161 รอบ 2) GUC `c4.amend_metric` แยกทาง amend ใน guard — ถ้าคนต่อ DB ตรงตั้ง GUC เองแล้วเรียก upsert ในทรานแซกชันเดียวกัน ค่าจะถูกทับเงียบ**และธง amended_cols ค้าง** (ดูเหมือนเจ้าของยืนยัน) · PostgREST ทำไม่ได้ |
| D19 | `v_content_post_result` lateral ×10 บน `v_content_post_t7` (ซึ่ง lateral เอง) · `v_campaign_summary`/`rollup` ซ้อนบนมันอีกชั้น — ~500 โพสต์จะเป็นร้อย ms | วันนี้ 10 โพสต์ · frontend กรอง shop + ช่วงวันเสมอ · ถึง ~300 โพสต์ค่อย materialize t7 เป็นตาราง snapshot (ไม่ใช่ตอนนี้ — fact ชั้นเดียว) |
| D20 | สมมติฐาน/ฐาน/เกณฑ์ระดับแคมเปญ (`campaign_plan_set`) ไม่มีประวัติ diff (ชิ้นมี `content_piece_event`) | `updated_at` + trigger guard พอรอบแรก · ถ้าเจ้าของต้องการ "ใครเปลี่ยนเกณฑ์เมื่อไหร่" → ตาราง `campaign_event` (C4) |
| D21 | `v_content_hook_library.type_*` (avg · 0160) กับ `v_content_hook_type_rollup` (median) เป็น 2 สูตรบนฐาน n เดียวกัน — verdict ตรงกัน (N6) แต่ตัวเลขต่าง | หน้า K ใช้ rollup เท่านั้น · comment บน library ชี้มา rollup · รวมเป็นสูตรเดียวเมื่อแตะ library ครั้งหน้า (replace ต่อท้ายคอลัมน์ trap #3) |
| D22 | สูตร `is_regression` อยู่ 2 ที่: body ของ `content_post_metric_upsert` (0148 · replace ไม่ได้) และ helper ใหม่ — เท่ากันวันนี้ (Y24/N4) แต่ถ้า 0148 ถูกแก้ภายหลังต้องแก้ helper ด้วย | comment ใน helper + ใน verify ชี้กันและกัน · รวมเป็นที่เดียวเมื่อมีเหตุต้อง replace upsert (เช่น API P3) |
| D23 | `content_post_metric_upsert` (0148) รับ `p_source` จากผู้เรียกตรงๆ — ใครถือ service key ก็อ้าง `tiktok_api` เพื่อทับค่าที่เจ้าของแก้ได้ (security 0161 M1) · log บันทึกว่า "ยังไม่พิสูจน์ตัวตน" | ยังไม่มีผู้เรียกจริง (แอป hardcode `manual`) · แยกตัวผู้เรียกไม่ได้เพราะทุกส่วนใช้ key เดียว · replace upsert ไม่ได้ (verify-0159 pin md5) | ตอนต่อ TikTok Display API (P3): สร้าง RPC ingest แยก แล้วให้ upsert ปฏิเสธ `tiktok_api` (รวมกับ D22) |
| D24 | **กติกา frontend ตอน render `content_weekly_summary.body_md` (ยาวได้ ~80K) และ `recommendation_log.detail`** (security 0162 M4): ใช้ react-markdown **ไม่มี** rehype-raw (`skipHtml`) · `urlTransform` ยอมแค่ http/https/mailto · ปิดรูปจากภายนอก (pixel ติดตาม) · ลิงก์ `rel="noopener noreferrer nofollow"` · ห้าม `dangerouslySetInnerHTML` · render ฝั่ง server · `detail` เป็น text ธรรมดา + `whitespace-pre-wrap` · หน้าคำตัดสินต้องแสดง `orders_data_covers_window` ข้างข้อเสนอ | ยังไม่มีหน้าจอ | ใส่ใน brief ของ frontend-dev ตอนทำหน้า K/inbox |
| D25 | AI จริง (scheduled task Weekly Brief) ต่อ DB ด้วย role postgres → ข้ามด่าน "AI ทำแทนเจ้าของไม่ได้" ทุกตัว (security 0162 H3) · ชั่วคราว: SKILL ของ task ต้องเรียก `recommendation_create` / `content_weekly_summary_upsert` ด้วย `p_actor_role=>'ai'` (+ `set_config('request.jwt.claims','{"role":"service_role"}',true)` ในทรานแซกชันเดียวกัน) ห้าม INSERT/UPDATE ตรง | task ยังเป็นผู้เขียนเดียว · Tech Lead แก้ SKILL ก่อน Brief 12 ต.ค. | migration ถัดไป: login role `content_agent` ที่มีแค่ EXECUTE RPC ฝั่ง AI และ `content_actor_assert` บังคับ `'ai'` เมื่อ `session_user='content_agent'` |
| D26 | **(security R2-4 · 7 ต.ค. รอบ 2)** ด่านข้อมูลออเดอร์ของคำตัดสิน (`orders_data_covers_window`) ตรวจแค่ "วันล่าสุดที่ร้าน/ช่องมีออเดอร์" เทียบวันท้ายของช่วง — **ไม่ตรวจวันกลางช่วงที่ขาด** (import ข้ามเดือน/ขาดกลางทางแล้ววันถัดไปมีออเดอร์ ⇒ ยอดวันที่ขาดอ่านเป็น 0) · รอบ 2 เข้มขึ้นแล้วเป็น "ต้องมีข้อมูลของวันหลังวันท้าย + ช่องที่นับต้องถึงวันท้าย" (R-H1) · ผลข้างเคียง: ช่องที่เงียบจริงในวันท้ายฟัน validated/invalidated ไม่ได้ (แยก "เงียบจริง" กับ "ไฟล์ยังไม่เข้า" จากตารางออเดอร์ไม่ได้) | ปิดจริงต้องมีตารางสถานะ import ราย (วัน × ช่องทาง) — ตอนทำระบบ import ต่อเนื่อง · ตอนนี้ QA D5 บันทึกเป็น [NOTE] |
| D27 | **(security R2 · 7 ต.ค.)** `content_text_clean` ของ 0158 (ที่ 0158-0161 ใช้ — verify-0158 pin md5) ยังไม่ครอบชุดอักขระล่องหน/ควบคุมที่ 0162 เพิ่มใน `content_bidi_present_` (C1 · 034F · 17B4/5 · 1160 · 206A-206F · FFA0 · 1BCA0-3 · E0100-E01EF · Unicode Tag ฯลฯ) — ช่อง `content_signal` / `content_hook` / piece ฯลฯ ยังรับอักขระเหล่านี้ได้ · เฉพาะ RPC ใน 0162 ตรวจซ้ำด้วย `content_bidi_present_` | migration ที่ replace `content_text_clean` พร้อมอัปเดต md5 pin ใน verify-0158 + รัน regression 0158-0161 · รอเจ้าของ/Tech Lead ตัดสินว่าจะขยายไหม |
| D28 | **(security B5 · 7 ต.ค.)** ผู้ถือ service key เรียก `recommendation_respond` ในนาม `owner` ได้ (`p_actor_role` มาจากผู้เรียก — D18/D25) · รอบ 2 เพิ่ม `acted_session_user` = `session_user` ตอนตอบ (ตรวจ spoof ย้อนหลัง — ไม่ใช่การยืนยันตัวตน · `acted_by` ยัง null จนกว่า A2) | 🔴 **ห้ามใช้ `owner_response` / `acted_by_role = owner` เป็นหลักฐานยินยอมเรื่องเงิน/สิทธิ์ จนกว่า A2** (JWT ผู้ใช้จริงต่อถึง RPC) |
| D29 | **(รอบ 2 · ผลข้างเคียงที่รับ)** (ก) `recommendation_log_guard` ล็อก DELETE แถวที่เจ้าของตอบแล้ว ⇒ ลบร้านที่มีประวัติเจ้าของตอบ (CASCADE จาก `public.shop`) ถูกบล็อกโดยตั้งใจ — ต้องปิด trigger อย่างรู้ตัวก่อน (ลบร้านถูกถอดจาก service_role ใน 0161 แล้ว) (ข) `recommendation_create` ปิดข้อเสนอ pending ที่หมดเวลา (ชื่อเดียวกัน) เป็น `expired` ก่อนสร้างใหม่ — แถวเก่าตอบไม่ได้อีก (ตอบ = 55000) (ค) AI/system ตั้ง `respond_by` < วันนี้+2 ไม่ได้ (22023) (ง) `plan_set_by_role` ว่างบนแถวเก่า = ไม่เดาว่าเป็นของเจ้าของ (7 แถวที่มีสมมติฐานอยู่เริ่มไปแล้ว ด่านวันเริ่มกันอยู่) | บันทึกไว้ — เปลี่ยนเมื่อมี use case จริง |
| R27 | ป้าย quartile ของฐาน 10 โพสต์: ช่วงแรก (ฐาน 4–9 โพสต์) p25/p75 สั่นแรง — ป้าย "เหนือ/ต่ำ" ช่วง ต.ค. จะเปลี่ยนง่ายเมื่อโพสต์ถัดไปเข้าฐาน **ของโพสต์ใหม่** (ป้ายของโพสต์เก่านิ่งอยู่แล้ว) | UI แสดง `baseline_n` ข้างป้ายเสมอ ("เทียบกับ 5 โพสต์ก่อนหน้า") · KPI def §0: เดือนแรก = baseline ห้ามตัดสินจากป้าย |
| R28 | `host_public_label` ของโพสต์มาจาก log คืน **วันโพสต์** — เจ้าของไม่จด (3 คืนจริง host null ทุกแถว · Q1 ยังไม่เลือกย้อนหลัง) ⇒ rollup ต่อโฮสต์ว่างจนกว่าหน้า I จะใช้จริง | ไม่เดาโฮสต์จากตารางเวร (ไม่มี) · แถว 'ไม่ระบุโฮสต์' ทำให้เห็นว่าขาด ไม่ใช่หาย |
| R29 | `campaign_verdict_confirm` ตั้ง `status='done'` — ✅ ตรวจแล้ว 7 ต.ค.: `v_campaign_board.effective_status` (0145) คิดจาก artifact/gate/rfm/`cs.status` ของ step เท่านั้น **ไม่อ่าน `campaign.status`** ⇒ step ไม่เปลี่ยน · board ยังแสดง `campaign_status=done` เป็นคอลัมน์ (แอปกรองด้วยหรือไม่ — backend-dev grep `campaign_status` ใน lib/app ตอน N9) | ด่าน C3-5 คงเดิม · legacy step (piece_status null) ไม่ติดด่าน — เจ้าของปิดแคมเปญ ก.ย. ได้ทันที (R9/R12 ใน Brief รอ) |
| R30 | `recommendation_create` กันซ้ำด้วย `lower(title)` + pending — Brief รอบถัดไปที่ "ยกระดับ" R7→R10 ใช้ชื่อใหม่ จึงไม่ชน (ถูก) แต่ Tech Lead ต้องปิด R7 (respond rejected 'ยกระดับเป็น R10') เองเหมือนที่ทำกับ R2→R5 | กติกาใน skill content-orchestration: ยกระดับ = respond ของเก่าก่อน create ของใหม่ |

**คำถามเจ้าของ (เฉพาะที่แก้ทีหลังยาก · ≤4)**

| # | คำถาม | ทำไมแก้ทีหลังยาก | ถ้าไม่ตอบ ผมเลือก |
|---|---|---|---|
| Q9 | ตัวเลขที่เจ้าของ **แก้มือแล้ว** ให้ล็อกไม่ให้ระบบดึงอัตโนมัติ (TikTok API อนาคต) ทับใช่ไหม — หรืออยากให้ API ชนะเสมอ (แล้วค่าที่แก้ถูกทับโดยไม่ถาม) | ธง `amended_cols` ตั้งตั้งแต่การแก้ครั้งแรก — ถ้าเลือก "API ชนะ" ทีหลัง ธงที่สะสมไว้ต้องล้างทั้งตาราง | **ล็อก** (คนยืนยัน > เครื่อง · API ไม่มี save อยู่แล้ว) |
| Q10 | Weekly Brief **ฉบับเต็ม** เก็บสำเนาใน DB เพื่ออ่านในแอป (C3-4) — ยอมรับว่ามี 2 ที่ (md ใน git + DB) ไหม หรือในแอปเอาแค่ 5 บรรทัด + ลิงก์ไฟล์ | ถ้าเก็บเต็มแล้วค่อยตัด = ลบคอลัมน์ที่มีข้อมูล · ถ้าไม่เก็บแล้วค่อยเพิ่ม = ฉบับเก่าไม่มีในแอป | **เก็บเต็ม** (brief K สั่ง "ไม่ต้องเปิดไฟล์") |
| Q11 | "โฮสต์คืนนั้น" ของโพสต์ = โฮสต์ของไลฟ์ **วันเดียวกับวันโพสต์** (เวลาไทย) ใช่ไหม — คลิปที่ปล่อยเช้าวันนี้ผูกกับไลฟ์คืนนี้ · ปล่อยหลังเที่ยงคืนผูกกับคืนถัดไป | สูตร join อยู่ใน view แก้ได้ แต่ป้ายที่เจ้าของยืนยัน (`result_label_override`) ที่อ่านโดยมีโฮสต์กำกับผิดคืน จะยืนยันไปแล้ว | **วันเดียวกัน** (workflow "ก่อนไลฟ์คืนนั้น") |
| Q12 | ปิดแคมเปญ (ยืนยันคำตัดสิน) **ต้องไม่มีชิ้นค้าง** (โพสต์/ยกเลิกให้ครบก่อน) ใช่ไหม — หรือยอมปิดทั้งที่ยังมีชิ้นรออยู่ | ถ้าผ่อนทีหลัง = ด่านหาย ไม่มีผลย้อน · ถ้าเข้มทีหลัง = แคมเปญที่ปิดไปแล้วมีชิ้นค้างค้างในปฏิทิน | **ต้องไม่มีชิ้นค้าง** (C3-5) |

ไม่ถาม (ตัดสินเองได้ เปลี่ยนทีหลังถูก): quartile vs ±% (view) · 30 วัน amend (ค่าคงที่ใน RPC) · 14 วัน expire ของ 0101 (คงไว้) · เส้นตาย ≤90 วัน · body md ≤80K · risk gate ไม่เป็นแถว reco (view)

**กติกาส่งงาน (บังคับ — §12.12 + เพิ่ม)**
- ตารางแมป "ข้อในบรีฟ → เทสต์" ครอบ Y1–Y24 + N1–N18 ทุกข้อ · ครอบไม่ได้เขียน "ไม่มี" + เหตุผล (คาดว่า N9/N15 ส่วน QA · N16 ส่วนบันทึก · R29 รอ dry-run)
- 🔴 ก่อนเขียน: รัน query ตัวเลขหัว §13 ซ้ำ · อ่าน `pg_get_viewdef('analytics.v_campaign_board')` ก่อนตัดสิน R29 · grep แอป N9 · `pg_trigger` ของ `content_post`/`campaign`/`recommendation_log` (trap #19 — C3 ไม่มี UPDATE ใน migration แต่ให้ยืนยัน)
- ลำดับ: 0161 dry-run → verify-0161 → `--commit --record` → `check-analytics-grants.sql` → 0162 dry-run → verify-0162 → commit → grants · ไฟล์ขึ้น repo รอบเดียวกับ apply (บทเรียน 0129) · memory `content-measurement-project` (ปิด P2.1) + `content-workflow-redesign` (C3 ลงแล้ว) + `weekly-brief-task-close-out` (N16) อัปเดต
- security ผ่านก่อน merge: 0161 = **แก้ตัวเลขย้อนหลัง** (ปลอมประวัติ KPI ที่เจ้าของถูกวัด — 💰-class ตาม 0101) · 0162 = **คำตัดสิน/ข้อเสนอ** (AI ตัดสินแทนเจ้าของ) · QA scope **L** ทุก flow ที่ผูก `content_post`/`campaign`/`recommendation_log` + หน้าใหม่ J/K/E/inbox 4
- signature ใน 13.2/13.5 เป็น contract กับ frontend — เปลี่ยนต้องบอก · view ใหม่ 5 ตัว **ไม่กรองร้าน** (frontend `.eq('shop_id')`)

### 13.y 🔁 contract ที่เปลี่ยนในรอบแก้ 2 ของ 0162 (security NO-GO มีเงื่อนไข · 7 ต.ค. 69 — frontend/task ต้องรู้)

| ที่ | เปลี่ยนอะไร | ผลต่อผู้เรียก |
|---|---|---|
| `v_campaign_summary.orders_data_covers_window` | เข้มขึ้น: ข้อมูลร้านต้องถึง **วันหลังวันสุดท้าย** (`through > วันท้าย`) และถ้าแคมเปญระบุช่องทาง ช่องนั้นต้องมีออเดอร์ถึงวันท้าย | หน้าจอเตือน "ข้อมูลยังไม่ครบ" บ่อยขึ้น (วันท้ายของช่วงที่ไฟล์เพิ่งเข้าไม่นับว่าครบ) · validated/invalidated ตกด่านจนกว่าจะ import เพิ่ม |
| `v_campaign_summary.orders_channel_data_through` | **คอลัมน์ใหม่** (date · null = ไม่ระบุช่องทาง/ช่องนั้นไม่มีออเดอร์/metric ไม่ใช่ orders) | ใช้อธิบายว่าทำไมไม่ครอบ ("ช่อง X ข้อมูลถึง …") |
| `campaign_plan_set` (ai/system) | 42501 ใหม่ 2 แบบ: (1) แคมเปญ "เริ่มแล้ว" นับจาก **least(metric_date_from, anchor, วัน step แรก)** ไม่ใช่ anchor อย่างเดียว (2) แผนล่าสุดเจ้าของตั้ง (`plan_set_by_role = owner`) — AI/ระบบทับไม่ได้ แม้ก่อนเริ่ม · คอลัมน์ใหม่ `campaign.plan_set_by_role` (owner/ai/system · null = แถวเก่า) | แสดงว่า "เจ้าของเป็นคนตั้ง" ได้จากคอลัมน์นี้ · map errcode 42501 เหมือนเดิม |
| `v_campaign_summary.verdict_token` | ครอบ `anchor_date` + สรุป step (min offset_start · max end · count) + `plan_set_by_role` เพิ่ม | ขยับ anchor / เพิ่ม-ย้าย step หลังเปิดหน้า ⇒ ยืนยันด้วย token เก่าได้ 55000 "ข้อมูลเปลี่ยนแล้ว" (ต้องรีเฟรช) |
| `recommendation_create` | (1) ผู้เรียกที่ไม่ใช่ owner ตั้ง `respond_by` < วันนี้+2 → 22023 (2) `default_action` มี `[ต้องยืนยัน` → 22023 (3) payload เพิ่ม key `expired_previous` (int) — จำนวนข้อเสนอ pending ชื่อเดียวกันที่หมดเวลาและถูกปิดเป็น `expired` ก่อนสร้างใหม่ | ผู้เรียก (Weekly Brief task) ต้องตั้งเส้นตายที่เหลือ ≥ 2 วัน · อ่าน key เดิม (`id`/`created`/`conflict`) ได้เหมือนเดิม |
| `recommendation_log` | คอลัมน์ใหม่ `acted_session_user` (text · ตั้งตอน `recommendation_respond`) · DELETE แถวที่เจ้าของตอบแล้ว → 55000 ทุก role รวม postgres · แถวเก่าที่ถูกปิดเป็น expired อัตโนมัติมี `acted_at` แต่ `acted_by_role` ว่าง | `v_recommendation_inbox` ไม่เปลี่ยนคอลัมน์ |
| `analytics.campaign.status` | service_role/authenticated/anon เปลี่ยน status ของแคมเปญที่เจ้าของยืนยันคำตัดสินแล้วไม่ได้ (55000) — ฟังก์ชัน definer เดิมไม่ติด | ไม่มีโค้ดแอปเขียน status ตรง (grep แล้ว) |
| `content_bidi_present_` | ปฏิเสธอักขระเพิ่ม (C1 · 034F · 17B4/5 · 1160 · 206A-206F · FFA0 · 1BCA0-3 · E0100-E01EF) — **ไม่รวม FE00-FE0F** (emoji ❤️ ผ่าน) | 22023 บนข้อความที่เคยผ่าน ถ้ามีอักขระเหล่านี้ |

### 13.x ✅ มติเจ้าของ Q9–Q12 (7 ต.ค. 69) — ทับค่าเริ่มต้นใน §13

| # | มติ | ต่างจากที่ architect เสนอไหม | ผลต่อ C3 |
|---|---|---|---|
| Q9 | **ยอดที่ดึงอัตโนมัติจาก TikTok ทับค่าที่แก้มือได้** | 🔁 เปลี่ยน (เสนอ: ล็อกค่าที่แก้มือ) | ไม่ต้องมีกลไก "คืนค่าที่คนล็อก" เมื่อ `source='tiktok_api'` · ยังต้องเก็บประวัติการทับใน amend log (ใครทับ · ค่าเดิม → ใหม่) · ช่อง "บันทึก (save)" API ไม่มี จึงไม่ถูกทับอยู่แล้ว |
| Q10 | เก็บ Weekly Brief **ฉบับเต็ม**ในแอป | ตามที่เสนอ | `content_weekly_summary` เก็บ markdown ฉบับเต็ม |
| Q11 | **ไม่ผูกโฮสต์กับผลของโพสต์** | 🔁 เปลี่ยน (เสนอ: โฮสต์ = ไลฟ์วันเดียวกัน) | ตัดคอลัมน์/การ join โฮสต์ออกจาก `v_content_post_result` และ `v_content_hook_type_rollup` (ไม่มี grouping ต่อโฮสต์) · โฮสต์ยังใช้กับผลรายคืนของไลฟ์ (`live_session_log`) ตามเดิม |
| Q12 | **ปิดแคมเปญได้ทุกเมื่อ** แม้มีชิ้นค้าง | 🔁 เปลี่ยน (เสนอ: ต้องไม่มีชิ้นค้าง) | `campaign_verdict_confirm` ไม่ปฏิเสธเมื่อมีชิ้นค้าง · แต่ต้อง**บันทึกใน payload ว่ามีกี่ชิ้นค้างตอนปิด** และชิ้นค้างไม่นับในผล · หน้าจอเตือนก่อนยืนยัน |

**เพิ่มจาก Tech Lead (7 ต.ค.)**: ตัวชี้วัด `metric_code` ตอนนี้ไม่มี "จำนวนออเดอร์" (มีแค่ save_rate · share_rate · peak_viewers · line_reply_count · none) — โปรอย่าง 10.10 วัดด้วยออเดอร์ตามช่องทาง+กลุ่มสินค้า ⇒ C3 เพิ่มค่า metric ออเดอร์ (เช่น `orders`) ทั้งระดับชิ้นและระดับแคมเปญ + view สรุปนับจาก `fact_order` ตามช่วงวัน/ช่องทาง/affinity · แคมเปญ 10.10 (`75a252d4…`) บันทึกด้วย metric `none` ไปแล้ว (ฐาน 0.5 · เกณฑ์ ≥6 ออเดอร์ LINE เงินแท่งใน 4 วัน อยู่ใน baseline_note) — หลัง C3 ตั้ง metric ระดับแคมเปญเป็น orders ได้
