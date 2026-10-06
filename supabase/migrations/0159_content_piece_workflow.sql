-- 0159_content_piece_workflow.sql  (ก้อน C2 ส่วนแรกของ workflow content/แคมเปญชุดใหม่ — piece workflow)
--
-- สถานะ: DRAFT ยังไม่ apply — ต้องผ่าน security (💰-class: สิทธิ์อนุมัติ + ปิดเส้นทางเดิม) + QA scope L ก่อน merge
-- 0160 (content_piece_post / content_post_link_step / unlink / defer / v_content_piece_calendar /
-- v_content_inbox_counts / v_line_quota_28d / v_content_hook_library) ยังไม่เขียน — ไฟล์นี้ไม่พึ่ง 0160
--
-- Why: ชิ้นงาน (piece) = analytics.campaign_step ที่มี piece_status (8 ค่า) · สถานะเก็บที่ step ไม่ใช่ artifact
-- · การอนุมัติต้องผ่าน 3 ด่าน (fact_check/brand_rule/risk_owner) + ไม่มี [ต้องยืนยัน] ค้าง + เจ้าของเท่านั้น
-- บังคับที่ DB (ไม่ใช่ปุ่ม) · เส้นทางเดิม (campaign_set_artifact_status ฯลฯ) ห้ามเขียนทับสถานะของ step ที่อยู่ใน
-- workflow ใหม่ · D8 ทาง (ข): hook ของเขา+ของเราอยู่ content_hook ตารางเดียว
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §11 · §12.0-§12.7 · §12.9-§12.12
-- (ยืนยันกับ DB สดอีกรอบตอนเขียน 7 ต.ค. 69: step 50 · artifact 53 · content_post 10 · hook 26 ours · signal 0 ·
--  gate 12 · step ต.ค. 26 ทุกแถว todo · campaign anchor null 0 · shop 1 — ไม่ต่างจาก §12 หัวข้อ)
--
-- ทำอะไร:
--   1. campaign_step += 23 คอลัมน์ (nullable ล้วน) + CHECK · channel CHECK 5→7 ค่า (+ tiktok · instagram)
--   2. step_gate += detail/checked_by_role · gate_kind CHECK += fact_check/brand_rule/risk_owner
--   3. content_post += step_id/hook_id (ไม่ backfill — artifact_id null ทั้ง 10 แถว)
--   4. content_hook: ผ่อน CHECK ให้ reference ไม่ต้องมี hook_type · derived_from_hook_id · unique กันซ้ำ ·
--      trigger mirror (signal.hook_text → hook origin=reference) · trigger กันลบสัญญาณที่มี hook ถอดโครงอ้างอิง
--   5. ตารางใหม่: content_piece_event (append-only) · content_confirm_item
--   6. trigger ปิดเส้นทางเดิม (R4) 4 ตัว + trigger ล้างผลตรวจเมื่อเนื้อหาเปลี่ยน (ผ่าน GUC c2.piece_rpc)
--   7. RPC: content_piece_create · content_signal_pick · content_piece_set_plan · content_piece_advance (+ helper
--      content_piece_transition_) · content_gate_record · content_confirm_extract (+ internal) · content_confirm_resolve ·
--      content_hook_reference_upsert/_delete · content_hook_link_reference
--   8. view v_content_piece (view ใหม่ตัวเดียว — ไม่แตะ view เดิมเลย · trap #3)
--   9. backfill 26 step ต.ค. (do-block เดียว · ปิด trigger คร่อม · trap #19) + extract 13 ชิ้น + event create 26 แถว
--
-- 🔴 ตัดสินใจเองนอก design (เหตุผลอยู่ที่จุดนั้น + สรุปส่งมอบ):
--   A  trigger กัน artifact (R4 ข้อ 1) ปล่อยให้ status ขยับภายในกลุ่ม todo/draft/draft_pending_review ได้
--      (ไม่ใช่ "ทุก status change = raise" ตามตัวอักษร §12.5) เพราะ K6 บังคับให้ campaign_ai_draft_artifact
--      ทำงานบน step drafting ซึ่ง artifact เป็น todo → draft_pending_review · ด่านจริงอยู่ที่ approved/done/blocked
--      (เข้า/ออก) และ piece ที่ approved/produced/posted (ทุก status/เนื้อหา) — mutant "set approved ตรง" ยังล้ม
--   B  ติ๊ก shot (campaign_toggle_clip_shot) ไม่นับเป็น "เนื้อหาเปลี่ยน": เทียบ clip_brief หลังตัด shots[].done ·
--      K5 ให้ทำงานบน step approved ได้ (รอบถ่ายต้องติ๊กได้) และไม่ล้างผลตรวจ
--   C  ตรวจ marker ผ่าน helper เดียว content_marker_* (ตัด bidi/zero-width ก่อน · ยอมช่องว่างระหว่าง ต้อง/ยืนยัน ·
--      ยอม : หรือ ：) ใช้ร่วมกัน extract / approve ชั้น 2 / view ⇒ สูตรเดียว (X39 โดยโครงสร้าง) · กัน AI แทรกอักขระล่องหน
--   D  อนุมัติใช้ฟังก์ชันเดียว content_piece_approve_blockers() ทั้ง RPC และ view (can_approve = ไม่มีข้อบล็อก)
--   E  trigger guard step ครอบ INSERT (piece_status ใหม่ต้องมาจาก RPC) + hold_reason + artifact DELETE ของชิ้นที่อนุมัติแล้ว
--   F  content_piece_event.seq (identity) — now() คงที่ทั้งทรานแซกชัน เรียงด้วย created_at ไม่ได้ (trap #22)
--      · trigger append-only ยอมลบเฉพาะตอน cascade จากการลบ step (ไม่งั้น campaign_delete_step ของ idea พัง)
--   G  gate_record: ai/system ตั้ง 'na' ไม่ได้ (42501) — "ไม่เกี่ยวข้อง" เป็นการตัดสิน ไม่ใช่ผลตรวจ
--   H  approved → posted ข้าม produced: คลิป (short_clip/live_cut) ต้อง footage_status in (has_footage, shot) ·
--      ig_fb_post ต้องไม่ใช่ needs_shoot · line/story ผ่านเสมอ (null ของคลิป = ยังไม่รู้ ⇒ ไม่ปล่อย)
--   I  kind↔channel ตรวจเฉพาะตอนสร้าง หรือเมื่อ set_plan แตะ piece_kind/channel (backfill 13 คลิปมี channel
--      'tiktok_live' คู่ short_clip ซึ่งไม่ตรงตาราง — ไม่ให้ทุก set_plan ล้มเพราะคู่เก่า · เจ้าของตั้ง channel ใหม่เอง)
--   K  มติเจ้าของ 7 ต.ค. 69 (Q8 — เปลี่ยนจากสเปก §12.11): ยกเลิกชิ้น (advance cancelled) → สัญญาณที่ picked_step_id ชี้ชิ้นนี้
--      กลับเป็น new + ล้าง picked_step_id ในทรานแซกชันเดียว (id เก็บใน payload.signal_ids ของ event cancel) · สัญญาณที่ถูกหยิบ
--      ไปชิ้นอื่นแล้วไม่แตะ · restore ผูกสัญญาณเดิมกลับเฉพาะเมื่อยังว่าง (new + ไม่ผูกชิ้นไหน) ไม่งั้นกู้ชิ้นโดยไม่มีสัญญาณต้นทาง
--      (ไม่ปฏิเสธการกู้ — สัญญาณ 1 ตัวไม่มีทางผูก 2 ชิ้น) · Q6/Q7/D9 ตามสเปกเดิม
--   J  gate_record/confirm_resolve/set_plan ตั้งได้เฉพาะสถานะที่ตรรกะเปิดให้ (ดูเมธอด) ข้อความ 55000 บอกทางออก
--
-- Grant model (3j-migration-traps #18): ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ครบสามชื่อ
-- (public/anon/authenticated) · ตาราง RLS on + tenant_isolation_select · เขียนผ่าน RPC security definer เท่านั้น
--
-- 🔴 actor_role มาจากแอป ไม่ใช่ auth (design R14/D2/D14): DB กัน "เส้นทาง AI" ได้ แต่ไม่กันผู้ถือ service key ที่ตั้งใจ
-- (ตั้ง GUC c2.piece_rpc เองก็ข้าม trigger ได้ — R20) · เมื่อ Auth A2 ลง ให้ derive role จาก shop_member
--
-- ไฟล์ idempotent (รันซ้ำ 2 รอบในทรานแซกชันเดียวผ่าน) · LF · ห้ามแก้ 0158
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` — ด่านท้ายไฟล์เทียบกับ snapshot ใน GUC ระดับทรานแซกชัน (c2.snap_*)

-- ============================================================================
-- 0. snapshot ก่อนแตะอะไร (GUC ระดับทรานแซกชัน — แบบเดียวกับ 0158 §0)
-- ============================================================================

do $c2snap$
begin
  perform set_config('c2.snap_live', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
             peak_viewers, note, source, host_id, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
    from analytics.live_session_log), true);
  perform set_config('c2.snap_artifact', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
             clip_brief::text, updated_at), E'\n' order by id), ''))
    from analytics.step_artifact), true);
  -- K1: status + updated_at ของ step ทุกแถว (รวม count(distinct updated_at) — trap #19)
  perform set_config('c2.snap_step', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c2.snap_gate', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, passed_by,
             passed_at, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    from analytics.step_gate), true);
  perform set_config('c2.snap_post', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  perform set_config('c2.snap_signal', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, kind, status, summary, hook_text,
             hook_type, picked_step_id, updated_at), E'\n' order by id), ''))
    from analytics.content_signal), true);
  -- content_hook: เฉพาะคอลัมน์เดิมของ 0158 (derived_from_hook_id ใหม่ของไฟล์นี้ไม่อยู่ใน snapshot)
  perform set_config('c2.snap_hook', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, text, hook_type, origin,
             source_signal_id, step_id, label, generated_by, hook_type_raw, legacy_json_id, updated_at), E'\n' order by id), ''))
    from analytics.content_hook), true);
  -- K11: คิวกรอกยอด + t7 ต้องให้ผลเท่าเดิม (เทียบข้อความของทุกแถว)
  perform set_config('c2.snap_queue', (
    (select count(*)::text || ':' || md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) from analytics.v_content_post_t7 t) || '/' ||
    (select count(*)::text || ':' || md5(coalesce(string_agg(q::text, E'\n' order by q::text), '')) from analytics.v_content_entry_queue q)), true);
  -- view เดิมทุกตัว (ยกเว้น v_content_piece ของไฟล์นี้) ต้อง definition เดิมเป๊ะ — trap #3 / R6 / K3
  perform set_config('c2.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname <> 'v_content_piece'), true);
  perform set_config('c2.snap_board_cols', (
    select count(*)::text from information_schema.columns
    where table_schema = 'analytics' and table_name = 'v_campaign_board'), true);
  -- ฟังก์ชันเดิมทุกตัว (รวมของ 0158 และ content_post_upsert) นอกรายการชื่อของไฟล์นี้ ต้อง definition เดิม — K10
  perform set_config('c2.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'), true);
end
$c2snap$;

-- ============================================================================
-- 1. campaign_step — คอลัมน์ใหม่ (nullable ล้วน · additive) + CHECK
--    piece_status null = "ก่อน workflow ใหม่" ไม่ใช่สถานะ — หน้าใหม่/RPC ใหม่กรอง `piece_status is not null`
--    CHECK ข้ามคอลัมน์ที่ไม่ใส่ระดับตาราง (≥ planned ต้องมี hypothesis ฯลฯ) อยู่ใน RPC แทน —
--    backfill ต.ค. ไม่มี hypothesis/kind · ไม่ล็อกแถว legacy (design §12.1)
--    trap #14: ตารางนี้ไม่มี insert ... on conflict ⇒ CHECK ข้ามคอลัมน์ (line_audience) ปลอดภัย
-- ============================================================================

alter table analytics.campaign_step
  add column if not exists piece_status         text,
  add column if not exists hold_reason          text,
  add column if not exists piece_kind           text,
  add column if not exists time_slot            text,
  add column if not exists customer_group       text,
  add column if not exists hypothesis           text,
  add column if not exists metric_code          text,
  add column if not exists baseline_value       numeric,
  add column if not exists baseline_as_of       date,
  add column if not exists baseline_note        text,
  add column if not exists pass_threshold       numeric,
  add column if not exists pass_op              text,
  add column if not exists baseline_spread      numeric,
  add column if not exists footage_status       text,
  add column if not exists footage_url          text,
  add column if not exists shoot_note           text,
  add column if not exists shoot_location       text,
  add column if not exists shoot_minutes_est    int,
  add column if not exists shoot_date           date,
  add column if not exists expected_host_id     uuid,
  add column if not exists drafted_by_ai        boolean,
  add column if not exists line_audience        text,
  add column if not exists line_audience_reason text;

-- drop-if-exists ก่อน add ทุกตัว = รันซ้ำได้ (ตรวจแถวเดิมซ้ำทุกรอบ — ถูกต้อง ไม่ใช่ข้อเสีย)
alter table analytics.campaign_step drop constraint if exists campaign_step_piece_status_check;
alter table analytics.campaign_step add constraint campaign_step_piece_status_check
  check (piece_status is null or piece_status in
    ('idea', 'planned', 'drafting', 'in_review', 'approved', 'produced', 'posted', 'cancelled'));

alter table analytics.campaign_step drop constraint if exists campaign_step_hold_reason_check;
alter table analytics.campaign_step add constraint campaign_step_hold_reason_check
  check (hold_reason is null or (length(hold_reason) between 1 and 500 and hold_reason ~ '\S'));

alter table analytics.campaign_step drop constraint if exists campaign_step_piece_kind_check;
alter table analytics.campaign_step add constraint campaign_step_piece_kind_check
  check (piece_kind is null or piece_kind in ('short_clip', 'live_cut', 'ig_fb_post', 'line_message', 'story'));

alter table analytics.campaign_step drop constraint if exists campaign_step_time_slot_check;
alter table analytics.campaign_step add constraint campaign_step_time_slot_check
  check (time_slot is null or time_slot in ('morning', 'afternoon', 'before_live', 'during_live'));

-- customer_group คนละอย่างกับ audience_segment (CRM/RFM) — ห้ามยุบรวม (design §5.3)
alter table analytics.campaign_step drop constraint if exists campaign_step_customer_group_check;
alter table analytics.campaign_step add constraint campaign_step_customer_group_check
  check (customer_group is null or customer_group in ('jewelry_925', 'silver_bar'));

alter table analytics.campaign_step drop constraint if exists campaign_step_hypothesis_check;
alter table analytics.campaign_step add constraint campaign_step_hypothesis_check
  check (hypothesis is null or (length(hypothesis) between 1 and 1000 and hypothesis ~ '\S'));

alter table analytics.campaign_step drop constraint if exists campaign_step_metric_code_check;
alter table analytics.campaign_step add constraint campaign_step_metric_code_check
  check (metric_code is null or metric_code in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'none'));

-- NaN ผ่าน cast ได้แต่ตก between: NaN >= x เป็น true / NaN <= x เป็น false ⇒ AND = false (trap #4)
alter table analytics.campaign_step drop constraint if exists campaign_step_baseline_value_check;
alter table analytics.campaign_step add constraint campaign_step_baseline_value_check
  check (baseline_value is null or (baseline_value >= -1000000000000 and baseline_value <= 1000000000000));

alter table analytics.campaign_step drop constraint if exists campaign_step_pass_threshold_check;
alter table analytics.campaign_step add constraint campaign_step_pass_threshold_check
  check (pass_threshold is null or (pass_threshold >= -1000000000000 and pass_threshold <= 1000000000000));

alter table analytics.campaign_step drop constraint if exists campaign_step_baseline_spread_check;
alter table analytics.campaign_step add constraint campaign_step_baseline_spread_check
  check (baseline_spread is null or (baseline_spread >= 0 and baseline_spread <= 1000000000000));

alter table analytics.campaign_step drop constraint if exists campaign_step_baseline_note_check;
alter table analytics.campaign_step add constraint campaign_step_baseline_note_check
  check (baseline_note is null or length(baseline_note) <= 500);

alter table analytics.campaign_step drop constraint if exists campaign_step_pass_op_check;
alter table analytics.campaign_step add constraint campaign_step_pass_op_check
  check (pass_op is null or pass_op in ('>=', '<='));

alter table analytics.campaign_step drop constraint if exists campaign_step_footage_status_check;
alter table analytics.campaign_step add constraint campaign_step_footage_status_check
  check (footage_status is null or footage_status in ('needs_shoot', 'has_footage', 'shot'));

alter table analytics.campaign_step drop constraint if exists campaign_step_footage_url_check;
alter table analytics.campaign_step add constraint campaign_step_footage_url_check
  check (footage_url is null or analytics.content_url_ok(footage_url));

alter table analytics.campaign_step drop constraint if exists campaign_step_shoot_note_check;
alter table analytics.campaign_step add constraint campaign_step_shoot_note_check
  check (shoot_note is null or length(shoot_note) <= 1000);

alter table analytics.campaign_step drop constraint if exists campaign_step_shoot_location_check;
alter table analytics.campaign_step add constraint campaign_step_shoot_location_check
  check (shoot_location is null or shoot_location in ('factory', 'product_table', 'host_cam', 'other'));

alter table analytics.campaign_step drop constraint if exists campaign_step_shoot_minutes_est_check;
alter table analytics.campaign_step add constraint campaign_step_shoot_minutes_est_check
  check (shoot_minutes_est is null or (shoot_minutes_est >= 1 and shoot_minutes_est <= 600));

-- มติเจ้าของ 6 ต.ค.: broadcast ส่งทุกคนเป็นค่าเริ่มต้น · "เฉพาะกลุ่ม" ต้องระบุกลุ่ม (audience_segment เดิม) + เหตุผล
alter table analytics.campaign_step drop constraint if exists campaign_step_line_audience_check;
alter table analytics.campaign_step add constraint campaign_step_line_audience_check
  check (line_audience is null or line_audience in ('all', 'segment'));

alter table analytics.campaign_step drop constraint if exists campaign_step_line_audience_scope_check;
alter table analytics.campaign_step add constraint campaign_step_line_audience_scope_check
  check (line_audience is null or piece_kind = 'line_message');

alter table analytics.campaign_step drop constraint if exists campaign_step_line_audience_reason_check;
alter table analytics.campaign_step add constraint campaign_step_line_audience_reason_check
  check (line_audience is distinct from 'segment' or (audience_segment is not null and line_audience_reason is not null));

alter table analytics.campaign_step drop constraint if exists campaign_step_line_audience_reason_len_check;
alter table analytics.campaign_step add constraint campaign_step_line_audience_reason_len_check
  check (line_audience_reason is null or (length(line_audience_reason) between 1 and 300 and line_audience_reason ~ '\S'));

-- channel: ขยาย 5 → 7 ค่า (ค่าเดิมคงลำดับ) — ไม่มี tiktok (คลิป) / instagram ใน CHECK เดิม (design §5.3)
alter table analytics.campaign_step drop constraint if exists campaign_step_channel_check;
alter table analytics.campaign_step add constraint campaign_step_channel_check
  check (channel in ('line_oa', 'tiktok_live', 'shopee', 'facebook', 'parcel_insert', 'tiktok', 'instagram'));

-- composite FK (shop_id, expected_host_id) → live_host (shop_id, id) · MATCH SIMPLE: null = ไม่ตรวจ
-- no action (ปิดโฮสต์ด้วย is_active แทนลบ) · ชื่อ unique index จริง live_host_shop_id_uq ตรวจจาก pg_indexes แล้ว
do $c2fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaign_step_expected_host_fk' and conrelid = 'analytics.campaign_step'::regclass
  ) then
    alter table analytics.campaign_step
      add constraint campaign_step_expected_host_fk
      foreign key (shop_id, expected_host_id) references analytics.live_host (shop_id, id);
  end if;
end
$c2fk$;

create index if not exists idx_campaign_step_piece_status
  on analytics.campaign_step (shop_id, piece_status) where piece_status is not null;
create index if not exists idx_campaign_step_expected_host
  on analytics.campaign_step (expected_host_id) where expected_host_id is not null;

comment on column analytics.campaign_step.piece_status is
  'สถานะชิ้นงานใน workflow ใหม่ (idea/planned/drafting/in_review/approved/produced/posted/cancelled) · null = ก่อน workflow ใหม่ '
  '(ไม่ใช่สถานะ) · เขียนได้ผ่าน RPC content_piece_* เท่านั้น (trigger trg_campaign_step_piece_status_guard) · '
  'status เดิมเป็น projection ทิศเดียวจากค่านี้ (บอร์ด copilot เก่าอ่านได้) ห้ามแก้ตรง';
comment on column analytics.campaign_step.hold_reason is
  'รอเงื่อนไข (overlay ซ้อนบน piece_status — กลับมาแล้วรู้ว่าค้างขั้นไหน) · ตั้ง/ล้างผ่าน advance(hold/resume) เท่านั้น';
comment on column analytics.campaign_step.customer_group is
  'กลุ่มลูกค้าของชิ้นงาน (jewelry_925/silver_bar) — คนละอย่างกับ audience_segment (CRM/RFM segment) ห้ามยุบรวม';

-- ============================================================================
-- 2. step_gate — gate_kind += 3 ด่านของ content · detail/checked_by_role · PK เดิม (step_id, gate_kind)
--    gate โปรโม 5 ตัวเดิมยังใช้ campaign_pass_gate (ไม่แตะ)
-- ============================================================================

alter table analytics.step_gate
  add column if not exists detail          jsonb,
  add column if not exists checked_by_role text;

alter table analytics.step_gate drop constraint if exists step_gate_gate_kind_check;
alter table analytics.step_gate add constraint step_gate_gate_kind_check
  check (gate_kind in ('cfo_discount_approval', 'coo_stock_check', 'pdpa_consent', 'quota_check', 'price_realtime_fill',
                       'fact_check', 'brand_rule', 'risk_owner'));

-- trap #13: jsonb 'null' ผ่าน is not null — บังคับชนิด object
alter table analytics.step_gate drop constraint if exists step_gate_detail_check;
alter table analytics.step_gate add constraint step_gate_detail_check
  check (detail is null or jsonb_typeof(detail) = 'object');

alter table analytics.step_gate drop constraint if exists step_gate_checked_by_role_check;
alter table analytics.step_gate add constraint step_gate_checked_by_role_check
  check (checked_by_role is null or checked_by_role in ('owner', 'ai', 'system'));

-- ============================================================================
-- 3. content_post — step_id / hook_id (ไม่ backfill: Δ4 artifact_id null ทั้ง 10 แถว ⇒ ไม่มี UPDATE)
--    ไม่ใส่ unique บน step_id — ชิ้น ig_fb_post โพสต์ได้ 2 แพลตฟอร์ม (FB + IG)
-- ============================================================================

alter table analytics.content_post
  add column if not exists step_id uuid references analytics.campaign_step (id) on delete set null,
  add column if not exists hook_id uuid references analytics.content_hook (id) on delete set null;

create index if not exists idx_content_post_step on analytics.content_post (step_id) where step_id is not null;
create index if not exists idx_content_post_hook on analytics.content_post (hook_id) where hook_id is not null;

-- ============================================================================
-- 4. content_hook — D8 ทาง (ข) (design §11): hook ของเขา (reference) + ของเรา (ours) อยู่ตารางเดียว
--    · ผ่อนให้ reference ไม่ต้องมี hook_type (capture รับ p_hook_type null ได้ · ติดประเภททีหลังผ่าน reference_upsert)
--      ours ยังบังคับ hook_type (หรือ legacy_json_id ของ backfill 0158) — ข้อยกเว้นแคบ ผูกกับ origin = 'reference'
--    · reference ต้องมี source_signal_id (FK เดิม on delete set null ⇒ trigger กันลบ signal ด้านล่างต้องลบแถว
--      reference ก่อน ไม่งั้น set null ชน CHECK นี้)
--    · derived_from_hook_id = เส้นทางย้อน "hook ของเรา ← ถอดโครงจาก hook ตัวไหน" (มีได้เฉพาะ ours)
-- ============================================================================

alter table analytics.content_hook drop constraint if exists content_hook_type_required_check;
alter table analytics.content_hook add constraint content_hook_type_required_check
  check (hook_type is not null or legacy_json_id is not null or origin = 'reference');

alter table analytics.content_hook drop constraint if exists content_hook_reference_needs_signal_check;
alter table analytics.content_hook add constraint content_hook_reference_needs_signal_check
  check (origin <> 'reference' or source_signal_id is not null);

alter table analytics.content_hook
  add column if not exists derived_from_hook_id uuid references analytics.content_hook (id) on delete set null;

alter table analytics.content_hook drop constraint if exists content_hook_derived_ours_only_check;
alter table analytics.content_hook add constraint content_hook_derived_ours_only_check
  check (derived_from_hook_id is null or origin = 'ours');

create index if not exists idx_content_hook_derived_from
  on analytics.content_hook (derived_from_hook_id) where derived_from_hook_id is not null;
-- กัน hook ของเขาซ้ำในคลิปเดียว (trigger mirror ใช้ on conflict ตัวนี้)
create unique index if not exists content_hook_reference_signal_text_uq
  on analytics.content_hook (source_signal_id, lower(text)) where origin = 'reference';

comment on column analytics.content_hook.derived_from_hook_id is
  'hook ของเรา (ours) ที่ถอดโครงจาก hook ของเขา (reference) ตัวนี้ — ตั้งผ่าน content_hook_link_reference';
comment on column analytics.content_signal.hook_text is
  'snapshot ตอนจับ (input เขียนครั้งเดียวตอน capture) — ไม่ใช่แหล่งจริงของ hook · แหล่งจริง = content_hook origin=reference '
  '(แก้ได้ที่เดียว: content_hook_reference_upsert) · UI ห้ามแสดงคอลัมน์นี้เป็น "hook" · ห้ามใช้ซ้ำคำต่อคำ (brief v1 §2.1)';

-- ============================================================================
-- 5. ตารางใหม่ — content_piece_event (append-only) · content_confirm_item
-- ============================================================================

create table if not exists analytics.content_piece_event (
  id             uuid primary key default gen_random_uuid(),
  -- ลำดับจริงของเหตุการณ์ (now() คงที่ทั้งทรานแซกชัน เรียงด้วย created_at ไม่ได้ — trap #22)
  seq            bigint generated always as identity,
  shop_id        uuid not null references public.shop (id) on delete cascade,
  step_id        uuid not null references analytics.campaign_step (id) on delete cascade,
  event_kind     text not null,
  from_status    text,
  to_status      text,
  reason         text,
  actor_role     text not null,
  actor_uid      uuid,
  review_seconds int,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint content_piece_event_kind_check
    check (event_kind in ('create', 'advance', 'revert', 'hold', 'resume', 'defer', 'cancel', 'restore', 'post',
                          'unpost', 'gate', 'confirm', 'plan')),
  constraint content_piece_event_from_check
    check (from_status is null or from_status in
      ('idea', 'planned', 'drafting', 'in_review', 'approved', 'produced', 'posted', 'cancelled')),
  constraint content_piece_event_to_check
    check (to_status is null or to_status in
      ('idea', 'planned', 'drafting', 'in_review', 'approved', 'produced', 'posted', 'cancelled')),
  constraint content_piece_event_reason_check check (reason is null or length(reason) <= 500),
  constraint content_piece_event_actor_check check (actor_role in ('owner', 'ai', 'system')),
  constraint content_piece_event_review_seconds_check
    check (review_seconds is null or (review_seconds >= 0 and review_seconds <= 86400)),
  constraint content_piece_event_payload_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_content_piece_event_step on analytics.content_piece_event (step_id, seq desc);
create index if not exists idx_content_piece_event_shop_kind on analytics.content_piece_event (shop_id, event_kind, seq desc);

comment on table analytics.content_piece_event is
  'บันทึกเหตุการณ์ของชิ้นงาน (append-only) — ใคร/เมื่อไหร่/ใช้เวลาอ่านกี่วินาที/เหตุผลส่งกลับ-ยกเลิก · '
  'actor_role มาจากแอป ไม่ใช่ auth (actor_uid ว่างจนกว่า A2) · เขียนผ่าน RPC content_piece_* เท่านั้น';

create table if not exists analytics.content_confirm_item (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop (id) on delete cascade,
  step_id          uuid not null references analytics.campaign_step (id) on delete cascade,
  key              text not null,
  question         text not null,
  answer           text,
  resolved_at      timestamptz,
  resolved_by_role text,
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint content_confirm_item_step_key_uq unique (step_id, key),
  constraint content_confirm_item_question_check check (length(question) between 1 and 500 and question ~ '\S'),
  constraint content_confirm_item_answer_check check (answer is null or length(answer) between 1 and 1000),
  constraint content_confirm_item_resolved_pair_check check ((answer is null) = (resolved_at is null)),
  constraint content_confirm_item_resolved_role_check
    check ((resolved_at is null) = (resolved_by_role is null)
       and (resolved_by_role is null or resolved_by_role in ('owner', 'ai', 'system')))
);

create index if not exists idx_content_confirm_item_pending
  on analytics.content_confirm_item (step_id) where resolved_at is null and removed_at is null;

comment on table analytics.content_confirm_item is
  'รายการ [ต้องยืนยัน: …] ที่พบในข้อความของชิ้นงาน — extract จากข้อความ (ไม่ใช่แหล่งจริง ข้อความคือแหล่งจริง) · '
  'อนุมัติตรวจซ้ำชั้นสองจากข้อความตรงๆ ไม่พึ่งว่า extract เคยรันไหม (design §5.5 / R13)';

drop trigger if exists trg_content_confirm_item_updated_at on analytics.content_confirm_item;
create trigger trg_content_confirm_item_updated_at
  before update on analytics.content_confirm_item
  for each row execute function public.set_updated_at();

alter table analytics.content_piece_event enable row level security;
alter table analytics.content_confirm_item enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_piece_event;
create policy tenant_isolation_select on analytics.content_piece_event
  for select using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));
drop policy if exists tenant_isolation_select on analytics.content_confirm_item;
create policy tenant_isolation_select on analytics.content_confirm_item
  for select using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

revoke all on analytics.content_piece_event, analytics.content_confirm_item from public, anon, authenticated;
grant select on analytics.content_piece_event, analytics.content_confirm_item to service_role;

-- ============================================================================
-- 6. helper (ใช้ร่วมกันทุก RPC/trigger/view) — ชุดอักขระต้องตรงกับ content_url_ok / content_text_clean ของ 0158
-- ============================================================================

-- escape อักขระพิเศษของ ARE ก่อนใส่ pattern (ไม่มีใน PG)
create or replace function analytics.content_regex_escape(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select regexp_replace(coalesce(p_text, ''), '([\\.^$|()\[\]{}*+?])', '\\\1', 'g')
$f$;

-- ตัด bidi/zero-width ออกจากข้อความก่อนหา marker (กัน AI แทรกอักขระล่องหนกลาง "[ต้อง​ยืนยัน") — ไม่แก้ข้อความจริง
create or replace function analytics.content_marker_strip(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select regexp_replace(coalesce(p_text, ''), '[​-‏‪-‮⁠-⁤⁦-⁩﻿]', '', 'g')
$f$;

-- มี marker [ต้องยืนยัน ไหม — "สูตรเดียว" ของ approve ชั้นสอง (ทนช่องว่างระหว่างคำ) · ไม่ต้องมี ] ปิด (ขึ้นต้นก็บล็อก)
create or replace function analytics.content_marker_present(p_text text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select analytics.content_marker_strip(p_text) ~ '\[\s*ต้อง\s*ยืนยัน'
$f$;

-- คำถามที่ไม่ซ้ำทั้งหมดใน marker รูป [ต้องยืนยัน: ข้อความ] (ว่าง = '(ไม่ระบุ)') · ตัดที่ 500 ตัวอักษร
create or replace function analytics.content_marker_questions(p_text text)
 returns text[]
 language sql
 immutable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select coalesce(array_agg(distinct q order by q), '{}'::text[])
  from (
    select left(coalesce(nullif(analytics.content_text_clean(m[1]), ''), '(ไม่ระบุ)'), 500) as q
    from regexp_matches(analytics.content_marker_strip(p_text),
                        '\[\s*ต้อง\s*ยืนยัน\s*[:：]?\s*([^\]]*)\]', 'g') as m
  ) t
$f$;

-- เทียบเนื้อหาชิ้นงานโดยตัดสถานะติ๊ก shot (shots[].done) — ติ๊กรอบถ่ายไม่ใช่การแก้เนื้อหา (ตัดสินใจ B)
create or replace function analytics.content_piece_brief_norm(p_brief jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select case
    when jsonb_typeof(p_brief) = 'object' and jsonb_typeof(p_brief -> 'shots') = 'array'
      then jsonb_set(p_brief, '{shots}',
             coalesce((select jsonb_agg(case when jsonb_typeof(s.e) = 'object' then s.e - 'done' else s.e end order by s.o)
                         from jsonb_array_elements(p_brief -> 'shots') with ordinality as s(e, o)), '[]'::jsonb))
    else p_brief
  end
$f$;

-- สถานะชิ้นงาน → status เดิมของ step (projection ทิศเดียว · hold/cancelled จัดการแยกใน transition)
create or replace function analytics.content_piece_project_(p_piece text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select case p_piece
    when 'idea' then 'todo'
    when 'planned' then 'scheduled'
    when 'drafting' then 'active'
    when 'in_review' then 'active'
    when 'approved' then 'active'
    when 'produced' then 'active'
    when 'posted' then 'done'
    when 'cancelled' then 'blocked'
  end
$f$;

-- ตาราง kind ↔ channel (design §12.2) · channel null = ยังไม่ตั้ง ⇒ ผ่าน (ด่าน advance planned เช็ค non-null เอง)
create or replace function analytics.content_piece_kind_channel_ok_(p_kind text, p_channel text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select case
    when p_kind is null or p_channel is null then true
    when p_kind in ('short_clip', 'live_cut') then p_channel = 'tiktok'
    when p_kind = 'ig_fb_post' then p_channel in ('facebook', 'instagram')
    when p_kind = 'line_message' then p_channel = 'line_oa'
    when p_kind = 'story' then p_channel in ('instagram', 'facebook')
    else false
  end
$f$;

create or replace function analytics.content_piece_artifact_type_(p_kind text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select case p_kind
    when 'short_clip' then 'short_form_clip'
    when 'live_cut' then 'live_highlight_clip'
    when 'ig_fb_post' then 'fb_post'
    when 'story' then 'fb_post'
    when 'line_message' then 'broadcast_script_line'
  end
$f$;

-- ============================================================================
-- 7. trigger ชุด R4 — ปิดเส้นทางเดิมสำหรับ step ที่มี piece_status (design §12.5) + ล้างผลตรวจเมื่อเนื้อหาเปลี่ยน
--    GUC c2.piece_rpc = '1' (set_config ... true — หมดอายุพร้อมทรานแซกชัน) ตั้งโดย RPC ของ workflow เท่านั้นรอบคำสั่งที่เขียน
--    คอลัมน์ที่ guard ดูแล · 🔴 กันเส้นทางโค้ด/บอร์ดเดิมได้ ไม่กันผู้ถือ service key ที่ตั้ง GUC เอง (R20/D14)
--    ข้อความ 55000 = ติดสถานะ/ด่าน (ไม่ใช่ 22023 — marketing.ts แปล 22023 เป็นข้อความ silver_bar ของเก่า)
-- ============================================================================

-- append-only: ห้าม UPDATE/DELETE/TRUNCATE (42501 แบบ crm_audit_log_append_only) · ยกเว้น DELETE ตอน cascade จากการลบ step
-- (แถว step หายไปแล้ว) — ไม่งั้น campaign_delete_step ของ idea/planned (K5) จะพังเพราะมี event create ค้าง
create or replace function analytics.content_piece_event_append_only()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if not exists (select 1 from analytics.campaign_step s where s.id = old.step_id) then
      return old;
    end if;
  end if;
  raise exception 'analytics.content_piece_event is append-only (% blocked)', tg_op using errcode = '42501';
end;
$f$;

drop trigger if exists trg_content_piece_event_append_only on analytics.content_piece_event;
create trigger trg_content_piece_event_append_only
  before update or delete on analytics.content_piece_event
  for each row execute function analytics.content_piece_event_append_only();
drop trigger if exists trg_content_piece_event_deny_truncate on analytics.content_piece_event;
create trigger trg_content_piece_event_deny_truncate
  before truncate on analytics.content_piece_event
  for each statement execute function analytics.content_piece_event_append_only();

-- R4 ข้อ 1: step_artifact ของ step ใน workflow — เปลี่ยน status/เนื้อหา/ลบ ผ่านเส้นทางเดิมไม่ได้ตามตาราง
-- (ตัดสินใจ A: status ขยับภายใน todo/draft/draft_pending_review ได้ เพราะ K6 · เข้า/ออก approved/done/blocked = raise
--  · piece approved/produced/posted = ห้ามทุก status + ห้ามแก้เนื้อหา · ตัดสินใจ B: ติ๊ก shot ไม่นับเป็นเนื้อหา)
create or replace function analytics.content_piece_guard_artifact()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_piece     text;
  v_piece_old text;
begin
  if coalesce(current_setting('c2.piece_rpc', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    select s.piece_status into v_piece from analytics.campaign_step s where s.id = old.step_id;
    if v_piece in ('approved', 'produced', 'posted') then
      raise exception 'ลบเอกสารของชิ้นงานที่อนุมัติแล้วไม่ได้ — ส่งกลับ (in_review) ก่อน' using errcode = '55000';
    end if;
    return old;
  end if;

  select s.piece_status into v_piece from analytics.campaign_step s where s.id = new.step_id;
  if new.step_id is distinct from old.step_id then
    select s.piece_status into v_piece_old from analytics.campaign_step s where s.id = old.step_id;
    if v_piece is not null or v_piece_old is not null then
      raise exception 'ย้ายเอกสารเข้า/ออกชิ้นงานใน workflow ใหม่ไม่ได้' using errcode = '55000';
    end if;
  end if;
  if v_piece is null then
    return new;   -- นอก workflow (ก่อน 1 ต.ค. / สร้างจากบอร์ดเดิม) ไม่ยุ่ง — K4
  end if;

  if new.status is distinct from old.status then
    if v_piece in ('approved', 'produced', 'posted')
       or new.status not in ('todo', 'draft', 'draft_pending_review')
       or old.status not in ('todo', 'draft', 'draft_pending_review') then
      raise exception 'ชิ้นงานนี้อยู่ใน workflow ใหม่ — เปลี่ยนสถานะผ่านหน้าชิ้นงาน (content_piece_advance) ไม่ใช่ผ่านเอกสาร'
        using errcode = '55000';
    end if;
  end if;

  if v_piece in ('approved', 'produced', 'posted')
     and (new.content_body is distinct from old.content_body
          or analytics.content_piece_brief_norm(new.clip_brief) is distinct from analytics.content_piece_brief_norm(old.clip_brief)) then
    raise exception 'อนุมัติแล้ว ห้ามแก้เนื้อหา — ส่งกลับ (in_review) ก่อน' using errcode = '55000';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_step_artifact_piece_guard on analytics.step_artifact;
create trigger trg_step_artifact_piece_guard
  before update or delete on analytics.step_artifact
  for each row execute function analytics.content_piece_guard_artifact();

-- R4 ข้อ 2: เนื้อหาเปลี่ยนจริงขณะ drafting/in_review → ผลตรวจ fact/brand ตกเป็น pending (risk_owner ไม่ล้าง) + extract ใหม่
-- campaign_ai_draft_artifact / campaign_set_artifact_content ยังเป็นทางเขียนเนื้อหา (ไม่ replace — signature เดิมแอปเรียกอยู่)
-- ⇒ ด่าน "ร่างใหม่แล้วผลตรวจเก่าต้องตก" ต้องอยู่ที่ตาราง · GUC '1' (confirm_resolve) = คำตอบเจ้าของ ไม่ใช่เนื้อหาใหม่จาก AI ⇒ ไม่ล้าง
create or replace function analytics.content_piece_stale_after_artifact()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_piece text;
  v_reset text[];
begin
  if coalesce(current_setting('c2.piece_rpc', true), '') = '1' then
    return null;
  end if;
  -- campaign_ai_draft_artifact เขียนทั้งสองคอลัมน์เสมอ (coalesce) แม้ค่าเดิม — เทียบค่าจริงก่อน
  if new.content_body is not distinct from old.content_body
     and analytics.content_piece_brief_norm(new.clip_brief) is not distinct from analytics.content_piece_brief_norm(old.clip_brief) then
    return null;
  end if;
  select s.piece_status into v_piece from analytics.campaign_step s where s.id = new.step_id;
  if v_piece not in ('drafting', 'in_review') then
    return null;
  end if;

  with u as (
    update analytics.step_gate g
       set status = 'pending',
           passed_by = null,
           passed_at = null,
           note = coalesce(g.note, '') || ' [เนื้อหาเปลี่ยน ' || to_char(now() at time zone 'Asia/Bangkok', 'DD/MM HH24:MI') || ']'
     where g.step_id = new.step_id and g.gate_kind in ('fact_check', 'brand_rule') and g.status in ('passed', 'na')
     returning g.gate_kind)
  select array_agg(u.gate_kind order by u.gate_kind) into v_reset from u;

  if v_reset is not null then
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, reason, actor_role, actor_uid, payload)
    values (new.shop_id, new.step_id, 'gate', 'เนื้อหาเปลี่ยน ผลตรวจเดิมตกเป็น pending', 'system', auth.uid(),
            jsonb_build_object('reset', true, 'gate_kinds', to_jsonb(v_reset)));
  end if;
  perform analytics.content_confirm_extract_(new.shop_id, new.step_id, 'system');
  return null;
end;
$f$;

drop trigger if exists trg_step_artifact_piece_stale on analytics.step_artifact;
create trigger trg_step_artifact_piece_stale
  after update of content_body, clip_brief on analytics.step_artifact
  for each row execute function analytics.content_piece_stale_after_artifact();

-- R4 ข้อ 3: ลบ step ที่อนุมัติ/ผลิต/โพสต์แล้วไม่ได้ (event/post จะหายตาม cascade) — ยกเลิกแทน
create or replace function analytics.content_piece_guard_step_delete()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if old.piece_status in ('approved', 'produced', 'posted') then
    raise exception 'ลบชิ้นงานที่อนุมัติ/ผลิต/โพสต์แล้วไม่ได้ — ยกเลิก (cancelled) แทน' using errcode = '55000';
  end if;
  return old;
end;
$f$;

drop trigger if exists trg_campaign_step_piece_guard on analytics.campaign_step;
create trigger trg_campaign_step_piece_guard
  before delete on analytics.campaign_step
  for each row execute function analytics.content_piece_guard_step_delete();

-- R4 ข้อ 4: piece_status/hold_reason เขียนได้ผ่าน RPC workflow เท่านั้น · status/blocked_reason ของ step ที่อยู่ใน workflow
-- เป็น projection ห้ามแก้ตรง · INSERT ที่ส่ง piece_status มาก็ต้องผ่าน RPC (ตัดสินใจ E — กัน service_role เสกชิ้นที่ approved)
create or replace function analytics.content_piece_guard_step()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if coalesce(current_setting('c2.piece_rpc', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.piece_status is not null or new.hold_reason is not null then
      raise exception 'สร้างชิ้นงานใน workflow ใหม่ต้องผ่าน content_piece_create เท่านั้น' using errcode = '55000';
    end if;
    return new;
  end if;
  if new.piece_status is distinct from old.piece_status then
    raise exception 'piece_status เปลี่ยนได้ผ่าน RPC content_piece_* เท่านั้น (ห้ามแก้ตรง)' using errcode = '55000';
  end if;
  if old.piece_status is not null
     and (new.status is distinct from old.status
          or new.hold_reason is distinct from old.hold_reason
          or new.blocked_reason is distinct from old.blocked_reason) then
    raise exception 'status/hold_reason ของชิ้นงานใน workflow ใหม่เป็น projection — เปลี่ยนผ่าน content_piece_advance เท่านั้น'
      using errcode = '55000';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_campaign_step_piece_status_guard on analytics.campaign_step;
create trigger trg_campaign_step_piece_status_guard
  before insert or update on analytics.campaign_step
  for each row execute function analytics.content_piece_guard_step();

-- ============================================================================
-- 8. trigger ฝั่ง signal ↔ hook (D8 ทาง ข · design §11.2 ข้อ 3)
--    mirror: INSERT บน content_signal ที่มี hook_text → แถว content_hook origin=reference (INSERT เท่านั้น ไม่ sync เมื่อแก้)
--    ทำเป็น trigger (ไม่ replace content_signal_capture 32 พารามิเตอร์ที่ GO แล้ว) — กันได้ทุกเส้นทาง insert
--    trap #14: insert list ครบทุกคอลัมน์ที่ CHECK ของ content_hook อ้าง (origin · source_signal_id · step_id · label · generated_by)
-- ============================================================================

create or replace function analytics.content_hook_mirror_from_signal()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  insert into analytics.content_hook
    (shop_id, text, hook_type, origin, source_signal_id, step_id, label, generated_by, created_by, updated_by)
  values
    (new.shop_id, new.hook_text, new.hook_type, 'reference', new.id, null, null,
     case new.created_by_role when 'ai' then 'ai' else 'human' end, new.created_by, new.created_by)
  on conflict (source_signal_id, lower(text)) where origin = 'reference' do nothing;
  return null;
end;
$f$;

drop trigger if exists trg_content_signal_hook_mirror on analytics.content_signal;
create trigger trg_content_signal_hook_mirror
  after insert on analytics.content_signal
  for each row when (new.hook_text is not null)
  execute function analytics.content_hook_mirror_from_signal();

-- ลบสัญญาณ: มี hook ของเราถอดโครงจาก hook ของคลิปนี้ → raise 55000 (fact ไม่หล่น) · ไม่มี → ลบ hook reference ของมันก่อน
-- (ไม่งั้น FK set null ชน content_hook_reference_needs_signal_check)
create or replace function analytics.content_signal_delete_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if exists (
    select 1 from analytics.content_hook d
      join analytics.content_hook r on r.id = d.derived_from_hook_id
     where r.source_signal_id = old.id and r.origin = 'reference'
  ) then
    raise exception 'ลบสัญญาณนี้ไม่ได้ — มี hook ของเราถอดโครงจากคลิปนี้ (ต้องปลดความเชื่อมก่อน)' using errcode = '55000';
  end if;
  delete from analytics.content_hook h where h.source_signal_id = old.id and h.origin = 'reference';
  return old;
end;
$f$;

drop trigger if exists trg_content_signal_delete_guard on analytics.content_signal;
create trigger trg_content_signal_delete_guard
  before delete on analytics.content_signal
  for each row execute function analytics.content_signal_delete_guard();

-- ============================================================================
-- 9. RPC hook ของเขา (reference) — design §11.2 ข้อ 4-5
--    กติกาเดียวกับ content_hook_upsert (0158): AI แก้/ทับ hook ที่ generated_by='human' ไม่ได้ (42501) ·
--    ซ้ำ (signal, lower(text)) = 23505 + id เดิมใน detail · ไม่ทับเงียบ
-- ============================================================================

create or replace function analytics.content_hook_reference_upsert(
  p_shop_id uuid,
  p_signal_id uuid,
  p_text text,
  p_hook_type text,
  p_actor_role text,
  p_id uuid default null
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_text  text := nullif(analytics.content_text_clean(p_text), '');
  v_kind  text;
  v_id    uuid;
  v_gen   text;
  v_dup   uuid;
begin
  if p_shop_id is null or p_signal_id is null then
    raise exception 'content_hook_reference_upsert: ต้องระบุร้านและสัญญาณ' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_hook_reference_upsert');

  if v_text is null or length(v_text) > 500 then
    raise exception 'content_hook_reference_upsert: ข้อความ hook ต้องยาว 1-500 ตัวอักษร' using errcode = '22023';
  end if;
  -- reference ไม่มี hook_type ได้ (ติดทีหลัง) แต่ถ้าส่งมาต้องอยู่ใน 8 ประเภท
  if p_hook_type is not null
     and p_hook_type not in ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story') then
    raise exception 'content_hook_reference_upsert: hook_type ต้องเป็น 1 ใน 8 ประเภท หรือเว้นว่าง' using errcode = '22023';
  end if;

  select s.kind into v_kind from analytics.content_signal s
   where s.id = p_signal_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_hook_reference_upsert: ไม่พบสัญญาณในร้านนี้' using errcode = '22023';
  end if;
  if v_kind <> 'reference_clip' then
    raise exception 'content_hook_reference_upsert: เพิ่ม hook ของเขาได้เฉพาะสัญญาณชนิดคลิปอ้างอิง (ได้รับ %)', v_kind using errcode = '22023';
  end if;

  if p_id is not null then
    select h.id, h.generated_by into v_id, v_gen from analytics.content_hook h
     where h.id = p_id and h.shop_id = p_shop_id and h.origin = 'reference' and h.source_signal_id = p_signal_id for update;
    if not found then
      raise exception 'content_hook_reference_upsert: ไม่พบ hook ของเขาตัวนี้ในคลิปนี้' using errcode = '22023';
    end if;
    if p_actor_role = 'ai' and v_gen = 'human' then
      raise exception 'content_hook_reference_upsert: AI แก้/ทับ hook ที่คนเขียนหรือแก้ไว้ไม่ได้ (ต้องเจ้าของเป็นคนแก้)' using errcode = '42501';
    end if;
  end if;

  select h.id into v_dup from analytics.content_hook h
   where h.source_signal_id = p_signal_id and h.origin = 'reference'
     and lower(h.text) = lower(v_text) and h.id is distinct from v_id;
  if v_dup is not null then
    raise exception 'content_hook_reference_upsert: คลิปนี้มี hook ข้อความเดียวกันอยู่แล้ว' using errcode = '23505', detail = v_dup::text;
  end if;

  begin
    if v_id is null then
      insert into analytics.content_hook
        (shop_id, text, hook_type, origin, source_signal_id, step_id, label, generated_by, created_by, updated_by)
      values
        (p_shop_id, v_text, p_hook_type, 'reference', p_signal_id, null, null,
         case when p_actor_role = 'ai' then 'ai' else 'human' end, auth.uid(), auth.uid())
      returning id into v_id;
    else
      update analytics.content_hook
         set text = v_text, hook_type = p_hook_type,
             generated_by = case when p_actor_role = 'ai' then 'ai' else 'human' end, updated_by = auth.uid()
       where id = v_id;
    end if;
  exception when unique_violation then
    select h.id into v_dup from analytics.content_hook h
     where h.source_signal_id = p_signal_id and h.origin = 'reference' and lower(h.text) = lower(v_text) limit 1;
    raise exception 'content_hook_reference_upsert: คลิปนี้มี hook ข้อความเดียวกันอยู่แล้ว' using errcode = '23505', detail = coalesce(v_dup::text, '');
  end;
  return v_id;
end;
$f$;

-- ลบ hook ของเขา: owner เท่านั้น · มี hook ของเราถอดโครงมาจากตัวนี้ = 55000 (fact ไม่หล่น)
create or replace function analytics.content_hook_reference_delete(
  p_shop_id uuid,
  p_id uuid,
  p_actor_role text
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null or p_id is null then
    raise exception 'content_hook_reference_delete: ต้องระบุร้านและ hook' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_hook_reference_delete');

  perform 1 from analytics.content_hook h
   where h.id = p_id and h.shop_id = p_shop_id and h.origin = 'reference' for update;
  if not found then
    raise exception 'content_hook_reference_delete: ไม่พบ hook ของเขาตัวนี้ในร้านนี้' using errcode = '22023';
  end if;
  if exists (select 1 from analytics.content_hook d where d.derived_from_hook_id = p_id) then
    raise exception 'content_hook_reference_delete: มี hook ของเราถอดโครงจากตัวนี้ — ปลดความเชื่อมก่อน' using errcode = '55000';
  end if;
  delete from analytics.content_hook where id = p_id and shop_id = p_shop_id;
  return p_id;
end;
$f$;

-- ตั้ง "hook ของเรา ← ถอดโครงจาก hook ของเขา" (ไม่แตะ signature content_hook_upsert — trap #1)
create or replace function analytics.content_hook_link_reference(
  p_shop_id uuid,
  p_hook_id uuid,
  p_reference_hook_id uuid,
  p_actor_role text
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_gen    text;
  v_signal uuid;
begin
  if p_shop_id is null or p_hook_id is null or p_reference_hook_id is null then
    raise exception 'content_hook_link_reference: ต้องระบุร้าน hook ของเรา และ hook ของเขา' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_hook_link_reference');

  select h.generated_by into v_gen from analytics.content_hook h
   where h.id = p_hook_id and h.shop_id = p_shop_id and h.origin = 'ours' for update;
  if not found then
    raise exception 'content_hook_link_reference: ไม่พบ hook ของเราในร้านนี้' using errcode = '22023';
  end if;
  if p_actor_role = 'ai' and v_gen = 'human' then
    raise exception 'content_hook_link_reference: AI แก้ hook ที่คนเขียนไว้ไม่ได้' using errcode = '42501';
  end if;
  select h.source_signal_id into v_signal from analytics.content_hook h
   where h.id = p_reference_hook_id and h.shop_id = p_shop_id and h.origin = 'reference';
  if not found or v_signal is null then
    raise exception 'content_hook_link_reference: ไม่พบ hook ของเขา (reference) ในร้านนี้' using errcode = '22023';
  end if;

  update analytics.content_hook
     set derived_from_hook_id = p_reference_hook_id, source_signal_id = v_signal, updated_by = auth.uid()
   where id = p_hook_id and shop_id = p_shop_id;
  return p_hook_id;
end;
$f$;

-- ============================================================================
-- 10. [ต้องยืนยัน] — extract (internal + public) · approve_blockers (สูตรเดียวของ RPC และ view)
--     ข้อความคือแหล่งจริง · content_confirm_item เป็นแค่รายการให้ตอบ (design §5.5 / R13)
-- ============================================================================

-- internal: ไม่ตรวจสิทธิ์ (เรียกจาก trigger/transition ที่ตรวจแล้ว) · ไม่ lock step (trigger เรียกกลาง UPDATE artifact —
-- ล็อก step จะสลับลำดับกับ transition ที่ล็อก step ก่อน artifact ⇒ เสี่ยง deadlock) · insert ใช้ on conflict กันแข่ง
create or replace function analytics.content_confirm_extract_(
  p_shop_id uuid,
  p_step_id uuid,
  p_actor_role text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_piece     text;
  v_found     text[];
  v_q         text;
  v_row       analytics.content_confirm_item%rowtype;
  v_inserted  int := 0;
  v_reopened  int := 0;
  v_removed   int := 0;
  v_n         int;
begin
  select s.piece_status into v_piece from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id;
  if not found then
    raise exception 'content_confirm_extract: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if v_piece is null then
    raise exception 'content_confirm_extract: ชิ้นงานนี้อยู่นอก workflow ใหม่' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct t.q order by t.q), '{}'::text[]) into v_found
  from (
    select unnest(analytics.content_marker_questions(a.content_body) || analytics.content_marker_questions(a.clip_brief::text)) as q
      from analytics.step_artifact a
     where a.step_id = p_step_id and a.shop_id = p_shop_id
  ) t;

  foreach v_q in array v_found loop
    select * into v_row from analytics.content_confirm_item i where i.step_id = p_step_id and i.key = md5(v_q);
    if not found then
      insert into analytics.content_confirm_item (shop_id, step_id, key, question)
      values (p_shop_id, p_step_id, md5(v_q), v_q)
      on conflict (step_id, key) do nothing;
      get diagnostics v_n = row_count;
      v_inserted := v_inserted + v_n;
    elsif v_row.removed_at is not null or v_row.resolved_at is not null then
      -- marker โผล่อีก = คำตอบเก่าไม่ได้ถูกใส่ลงข้อความ ⇒ ถือว่าค้าง (ล้างคำตอบ)
      update analytics.content_confirm_item
         set removed_at = null, answer = null, resolved_at = null, resolved_by_role = null
       where id = v_row.id;
      v_reopened := v_reopened + 1;
    end if;
  end loop;

  -- ที่ยังไม่ตอบและข้อความไม่มีแล้ว (ถูกแก้จนไม่พบ marker) → removed · ที่ตอบแล้วคงไว้เป็นประวัติ
  with u as (
    update analytics.content_confirm_item i
       set removed_at = now()
     where i.step_id = p_step_id and i.removed_at is null and i.resolved_at is null
       and not (i.key = any (select md5(x) from unnest(v_found) as x))
    returning 1)
  select count(*)::int into v_removed from u;

  if v_inserted + v_reopened + v_removed > 0 then
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, actor_role, actor_uid, payload)
    values (p_shop_id, p_step_id, 'confirm', p_actor_role, auth.uid(),
            jsonb_build_object('found', cardinality(v_found), 'inserted', v_inserted, 'reopened', v_reopened, 'removed', v_removed));
  end if;
  return jsonb_build_object('found', cardinality(v_found), 'inserted', v_inserted, 'reopened', v_reopened, 'removed', v_removed);
end;
$f$;

create or replace function analytics.content_confirm_extract(
  p_shop_id uuid,
  p_step_id uuid,
  p_actor_role text default 'system'
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null or p_step_id is null then
    raise exception 'content_confirm_extract: ต้องระบุร้านและชิ้นงาน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_confirm_extract');
  return analytics.content_confirm_extract_(p_shop_id, p_step_id, p_actor_role);
end;
$f$;

-- ข้อที่ขวางการอนุมัติ (ว่าง = อนุมัติได้) — ใช้ทั้ง content_piece_transition_ และ v_content_piece.can_approve
-- ⇒ สูตรเดียวโดยโครงสร้าง (ปุ่มเขียวกดแล้วไม่ผ่าน/กลับกัน เกิดไม่ได้) · ไม่ lock · ไม่เช็ค role/สถานะ (ผู้เรียกเช็คเอง)
create or replace function analytics.content_piece_approve_blockers(p_step_id uuid)
 returns text[]
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_out      text[] := '{}'::text[];
  v_kind     text;
  v_aud      text;
  v_k        text;
  v_st       text;
  v_pending  int;
begin
  select s.piece_kind, s.line_audience into v_kind, v_aud from analytics.campaign_step s where s.id = p_step_id;
  if not found then
    return array['ไม่พบชิ้นงาน'];
  end if;
  -- (1) 3 ด่านครบ — แถวหาย = ไม่ผ่าน
  foreach v_k in array array['fact_check', 'brand_rule', 'risk_owner'] loop
    select g.status into v_st from analytics.step_gate g where g.step_id = p_step_id and g.gate_kind = v_k;
    if not found then
      v_out := v_out || format('ด่าน %s ยังไม่มีผลตรวจ', v_k);
    elsif v_st not in ('passed', 'na') then
      v_out := v_out || format('ด่าน %s ยังไม่ผ่าน (สถานะ %s)', v_k, v_st);
    end if;
  end loop;
  -- (2) รายการ [ต้องยืนยัน] ที่ยังไม่ตอบ
  select count(*)::int into v_pending from analytics.content_confirm_item i
   where i.step_id = p_step_id and i.resolved_at is null and i.removed_at is null;
  if v_pending > 0 then
    v_out := v_out || format('มี [ต้องยืนยัน] ที่ยังไม่ตอบ %s รายการ', v_pending);
  end if;
  -- (3) ชั้นที่ DB พิสูจน์เอง: marker ยังอยู่ในข้อความจริง (ไม่พึ่งว่า extract เคยรันไหม)
  if exists (select 1 from analytics.step_artifact a
              where a.step_id = p_step_id
                and (analytics.content_marker_present(a.content_body) or analytics.content_marker_present(a.clip_brief::text))) then
    v_out := v_out || text 'ยังมี [ต้องยืนยัน] ค้างอยู่ในข้อความของชิ้นงาน';
  end if;
  -- (4) ชิ้นที่ backfill ยังไม่ติด kind อนุมัติไม่ได้ (ไม่รู้จะตรวจตามกติกาชนิดไหน)
  if v_kind is null then
    v_out := v_out || text 'ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind)';
  end if;
  if v_kind = 'line_message' and v_aud is null then
    v_out := v_out || text 'ชิ้น LINE ยังไม่ได้เลือกผู้รับ (ทุกคน/เฉพาะกลุ่ม)';
  end if;
  return v_out;
end;
$f$;

-- ============================================================================
-- 11. helper cast แบบปลอดภัย (คืน null เมื่อรูปแบบผิด — ผู้เรียก raise 22023 เอง) + enum ของ set_plan
-- ============================================================================

create or replace function analytics.content_piece_try_numeric_(p_text text)
 returns numeric
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
begin
  return btrim(p_text)::numeric;   -- 'NaN' ผ่าน cast ⇒ ผู้เรียกต้องกันด้วย not(between) (trap #4)
exception when others then
  return null;
end;
$f$;

create or replace function analytics.content_piece_try_date_(p_text text)
 returns date
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
begin
  if p_text is null or btrim(p_text) !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return btrim(p_text)::date;
exception when others then
  return null;
end;
$f$;

create or replace function analytics.content_piece_try_time_(p_text text)
 returns time
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
begin
  if p_text is null or btrim(p_text) !~ '^\d{2}:\d{2}(:\d{2})?$' then
    return null;
  end if;
  return btrim(p_text)::time;
exception when others then
  return null;
end;
$f$;

create or replace function analytics.content_piece_try_uuid_(p_text text)
 returns uuid
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
begin
  return btrim(p_text)::uuid;
exception when others then
  return null;
end;
$f$;

create or replace function analytics.content_piece_enum_ok_(p_key text, p_val text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select coalesce(case p_key
    when 'time_slot' then p_val in ('morning', 'afternoon', 'before_live', 'during_live')
    when 'piece_kind' then p_val in ('short_clip', 'live_cut', 'ig_fb_post', 'line_message', 'story')
    when 'channel' then p_val in ('line_oa', 'tiktok_live', 'shopee', 'facebook', 'parcel_insert', 'tiktok', 'instagram')
    when 'customer_group' then p_val in ('jewelry_925', 'silver_bar')
    when 'metric_code' then p_val in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'none')
    when 'pass_op' then p_val in ('>=', '<=')
    when 'line_audience' then p_val in ('all', 'segment')
    when 'footage_status' then p_val in ('needs_shoot', 'has_footage', 'shot')
    when 'shoot_location' then p_val in ('factory', 'product_table', 'host_cam', 'other')
    else false
  end, false)
$f$;

-- ============================================================================
-- 12. content_piece_create — ทางเดียวที่สร้าง step ของ workflow ใหม่ (ไม่เรียก campaign_create_task: บังคับ p_date + status scheduled)
--     AI สร้างได้เฉพาะ idea (ส่ง p_date = 22023) · owner + p_date = planned · ไม่มีวัน = idea (wrapper campaign anchor null — Δ1)
-- ============================================================================

create or replace function analytics.content_piece_create(
  p_shop_id uuid,
  p_title text,
  p_piece_kind text,
  p_channel text,
  p_customer_group text,
  p_actor_role text,
  p_date date default null,
  p_source_signal_id uuid default null,
  p_campaign_id uuid default null
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_title    text := analytics.content_text_clean(p_title);
  v_today    date := (now() at time zone 'Asia/Bangkok')::date;
  v_piece    text;
  v_campaign uuid := p_campaign_id;
  v_anchor   date;
  v_seq      int;
  v_offset   int;
  v_step     uuid;
begin
  if p_shop_id is null then
    raise exception 'content_piece_create: ต้องระบุร้าน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_piece_create');

  if length(v_title) not between 1 and 200 then
    raise exception 'content_piece_create: ชื่อชิ้นงานต้องยาว 1-200 ตัวอักษร' using errcode = '22023';
  end if;
  if p_piece_kind is not null and not analytics.content_piece_enum_ok_('piece_kind', p_piece_kind) then
    raise exception 'content_piece_create: piece_kind ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_channel is not null and not analytics.content_piece_enum_ok_('channel', p_channel) then
    raise exception 'content_piece_create: channel ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_customer_group is not null and not analytics.content_piece_enum_ok_('customer_group', p_customer_group) then
    raise exception 'content_piece_create: customer_group ต้องเป็น jewelry_925 หรือ silver_bar' using errcode = '22023';
  end if;
  if not analytics.content_piece_kind_channel_ok_(p_piece_kind, p_channel) then
    raise exception 'content_piece_create: ชนิดชิ้นงาน % ใช้กับช่องทาง % ไม่ได้', p_piece_kind, p_channel using errcode = '22023';
  end if;
  if p_date is not null then
    if p_actor_role <> 'owner' then
      raise exception 'content_piece_create: AI/ระบบวางปฏิทินเองไม่ได้ — สร้างเป็นไอเดีย (ไม่ส่งวัน) แล้วให้เจ้าของวางแผน' using errcode = '22023';
    end if;
    if p_date < date '2025-01-01' or p_date > v_today + 1100 then
      raise exception 'content_piece_create: วันที่อยู่นอกช่วงที่ยอมรับ' using errcode = '22023';
    end if;
  end if;
  v_piece := case when p_date is null then 'idea' else 'planned' end;

  if p_source_signal_id is not null
     and not exists (select 1 from analytics.content_signal s where s.id = p_source_signal_id and s.shop_id = p_shop_id) then
    raise exception 'content_piece_create: ไม่พบสัญญาณต้นทางในร้านนี้' using errcode = '22023';
  end if;

  if v_campaign is null then
    insert into analytics.campaign
      (shop_id, name, campaign_type, trigger_kind, status, anchor_date, created_by, updated_by)
    values
      (p_shop_id, v_title, 'content_task', 'manual', 'scheduled', p_date, auth.uid(), auth.uid())
    returning id into v_campaign;
    v_seq := 1;
    v_offset := 0;
  else
    select c.anchor_date into v_anchor from analytics.campaign c
     where c.id = v_campaign and c.shop_id = p_shop_id for update;
    if not found then
      raise exception 'content_piece_create: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
    end if;
    if p_date is not null then
      if v_anchor is null then
        raise exception 'content_piece_create: แคมเปญนี้ยังไม่มีวันตั้งต้น (anchor_date) จึงวางชิ้นที่มีวันไม่ได้' using errcode = '22023';
      end if;
      v_offset := p_date - v_anchor;
    else
      if v_anchor is not null then
        raise exception 'content_piece_create: แคมเปญนี้มีวันตั้งต้นแล้ว — ชิ้นงานในแคมเปญจริงต้องระบุวัน' using errcode = '22023';
      end if;
      v_offset := 0;
    end if;
    select coalesce(max(st.seq), 0) + 1 into v_seq from analytics.campaign_step st where st.campaign_id = v_campaign;
  end if;

  perform set_config('c2.piece_rpc', '1', true);
  insert into analytics.campaign_step
    (campaign_id, shop_id, seq, step_kind, title, offset_start_days, offset_end_days, channel, status, origin,
     piece_status, piece_kind, customer_group, drafted_by_ai, line_audience, created_by, updated_by)
  values
    (v_campaign, p_shop_id, v_seq, 'content_task', v_title, v_offset, v_offset, p_channel,
     analytics.content_piece_project_(v_piece), 'manual',
     v_piece, p_piece_kind, p_customer_group, (p_actor_role = 'ai'),
     case when p_piece_kind = 'line_message' then 'all' end, auth.uid(), auth.uid())
  returning id into v_step;
  perform set_config('c2.piece_rpc', '', true);

  if p_piece_kind is not null then
    insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, status, created_by, updated_by)
    values (v_step, p_shop_id, analytics.content_piece_artifact_type_(p_piece_kind), 'owner', 'todo', auth.uid(), auth.uid());
  end if;

  insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, actor_role, actor_uid, payload)
  values (p_shop_id, v_step, 'create', null, v_piece, p_actor_role, auth.uid(),
          jsonb_build_object('signal_id', p_source_signal_id, 'campaign_id', v_campaign, 'wrapper', p_campaign_id is null));
  return v_step;
end;
$f$;

-- ============================================================================
-- 13. content_signal_pick — หยิบสัญญาณเป็นไอเดีย (ทรานแซกชันเดียวกับ create) · ไม่เรียก content_signal_set_status
--     (มันกัน picked โดยตั้งใจ) · picked แล้ว = 55000 + picked_step_id ใน detail · rejected = 55000
--     ล้าง review_on ด้วย (deferred → picked: CHECK deferred ต้องมี review_on แต่ picked ไม่ต้อง — ไม่ค้างค่าเก่า)
-- ============================================================================

create or replace function analytics.content_signal_pick(
  p_shop_id uuid,
  p_signal_id uuid,
  p_title text,
  p_piece_kind text,
  p_channel text,
  p_customer_group text,
  p_actor_role text
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_status text;
  v_picked uuid;
  v_step   uuid;
begin
  if p_shop_id is null or p_signal_id is null then
    raise exception 'content_signal_pick: ต้องระบุร้านและสัญญาณ' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_signal_pick');

  select s.status, s.picked_step_id into v_status, v_picked
    from analytics.content_signal s where s.id = p_signal_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_signal_pick: ไม่พบสัญญาณในร้านนี้' using errcode = '22023';
  end if;
  if v_status = 'picked' then
    raise exception 'content_signal_pick: สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว' using errcode = '55000', detail = coalesce(v_picked::text, '');
  end if;
  if v_status = 'rejected' then
    raise exception 'content_signal_pick: สัญญาณนี้ถูกตั้งเป็น "ไม่ใช้" แล้ว — ถ้าจะกลับมาใช้ให้ตั้งสถานะใหม่ก่อน (content_signal_set_status)'
      using errcode = '55000';
  end if;

  v_step := analytics.content_piece_create(p_shop_id, p_title, p_piece_kind, p_channel, p_customer_group, p_actor_role,
                                           null, p_signal_id, null);
  update analytics.content_signal
     set status = 'picked', picked_step_id = v_step, status_reason = null, review_on = null, updated_by = auth.uid()
   where id = p_signal_id and shop_id = p_shop_id;
  return v_step;
end;
$f$;

-- ============================================================================
-- 14. content_piece_set_plan — ตั้ง/แก้แผนของชิ้นงาน (วัน · ชนิด · ช่องทาง · สมมติฐาน/ฐาน/เกณฑ์ · ภาพ/ถ่าย · โฮสต์ ฯลฯ)
--     p_set = jsonb object · key นอกรายการ = 22023 (กัน typo เงียบ) · key ที่ไม่ส่ง = ไม่แตะ ·
--     jsonb_typeof(v)='null' = ล้างค่า (trap #13 — ห้าม ->> is null) · ตัวเลขรับ number/string แล้ว cast ปลอดภัย
--     ⇒ 'NaN' ผ่าน cast แต่ตก not(between) (trap #4)
--     ใครแก้ได้เมื่อไหร่: ai/system = เฉพาะ idea + key ของ "เสนอสมมติฐาน" · owner: idea..in_review ทุก key (date เฉพาะ
--     idea/planned) · approved/produced: เฉพาะ key ที่ไม่เปลี่ยนเนื้อหาที่อนุมัติ · posted/cancelled: footage_url/shoot_note
--     บันทึก diff (from→to) ลง event 'plan' — "แก้ตัวเลขฐานหลังตั้งแล้ว" ต้องตามรอยได้
-- ============================================================================

create or replace function analytics.content_piece_set_plan(
  p_shop_id uuid,
  p_step_id uuid,
  p_set jsonb,
  p_actor_role text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today        date := (now() at time zone 'Asia/Bangkok')::date;
  c_keys         constant text[] := array['date', 'start_time', 'time_slot', 'piece_kind', 'channel', 'customer_group',
                   'hypothesis', 'metric_code', 'baseline_value', 'baseline_as_of', 'baseline_note', 'pass_threshold',
                   'pass_op', 'baseline_spread', 'expected_host_id', 'line_audience', 'line_audience_reason',
                   'footage_status', 'footage_url', 'shoot_note', 'shoot_location', 'shoot_minutes_est', 'shoot_date',
                   'content_type_code'];
  c_ai_keys      constant text[] := array['hypothesis', 'metric_code', 'baseline_value', 'baseline_as_of', 'baseline_note',
                   'baseline_spread', 'pass_threshold', 'pass_op', 'shoot_minutes_est', 'footage_status'];
  c_appr_keys    constant text[] := array['time_slot', 'start_time', 'expected_host_id', 'footage_status', 'footage_url',
                   'shoot_note', 'shoot_location', 'shoot_minutes_est', 'shoot_date'];
  c_closed_keys  constant text[] := array['footage_url', 'shoot_note'];
  v_keys         text[];
  v_bad          text;
  v_s            analytics.campaign_step%rowtype;
  v_n            analytics.campaign_step%rowtype;
  v_ctype        text;
  v_ctype_new    text;
  v_anchor       date;
  v_camp_type    text;
  v_step_count   int;
  v_old_date     date;
  v_new_date     date;
  v_has_date     boolean := false;
  v_delta        int;
  v_k            text;
  v_v            jsonb;
  v_null         boolean;
  v_txt          text;
  v_c            text;
  v_num          numeric;
  v_diff         jsonb;
  v_date_diff    jsonb;
  v_res_start    date;
begin
  if p_shop_id is null or p_step_id is null then
    raise exception 'content_piece_set_plan: ต้องระบุร้านและชิ้นงาน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_piece_set_plan');
  if p_set is null or jsonb_typeof(p_set) <> 'object' then
    raise exception 'content_piece_set_plan: p_set ต้องเป็น json object' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_set) as k;
  v_keys := coalesce(v_keys, '{}'::text[]);
  select string_agg(k, ', ') into v_bad from unnest(v_keys) as k where k <> all (c_keys);
  if v_bad is not null then
    raise exception 'content_piece_set_plan: key ที่ไม่รู้จัก: %', v_bad using errcode = '22023';
  end if;

  select * into v_s from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_piece_set_plan: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if v_s.piece_status is null then
    raise exception 'content_piece_set_plan: ชิ้นงานนี้อยู่นอก workflow ใหม่ (ก่อน 1 ต.ค. หรือสร้างจากบอร์ดเดิม)' using errcode = '22023';
  end if;

  if p_actor_role <> 'owner' then
    if v_s.piece_status <> 'idea' then
      raise exception 'content_piece_set_plan: AI/ระบบแก้แผนได้เฉพาะไอเดีย — ชิ้นนี้อยู่สถานะ %', v_s.piece_status using errcode = '42501';
    end if;
    select string_agg(k, ', ') into v_bad from unnest(v_keys) as k where k <> all (c_ai_keys);
    if v_bad is not null then
      raise exception 'content_piece_set_plan: AI/ระบบตั้งค่านี้ไม่ได้ (เจ้าของตัดสิน): %', v_bad using errcode = '42501';
    end if;
  else
    if v_s.piece_status in ('approved', 'produced') then
      select string_agg(k, ', ') into v_bad from unnest(v_keys) as k where k <> all (c_appr_keys);
      if v_bad is not null then
        raise exception 'content_piece_set_plan: อนุมัติแล้ว แก้ % ไม่ได้ — ส่งกลับ (in_review) ก่อน', v_bad using errcode = '55000';
      end if;
    elsif v_s.piece_status in ('posted', 'cancelled') then
      select string_agg(k, ', ') into v_bad from unnest(v_keys) as k where k <> all (c_closed_keys);
      if v_bad is not null then
        raise exception 'content_piece_set_plan: ชิ้นงานสถานะ % แก้ % ไม่ได้', v_s.piece_status, v_bad using errcode = '55000';
      end if;
    end if;
    if 'date' = any (v_keys) and v_s.piece_status not in ('idea', 'planned') then
      raise exception 'content_piece_set_plan: เลื่อนวันหลังวางแผนแล้วต้องใช้ content_piece_defer (บันทึกเหตุผล)' using errcode = '55000';
    end if;
  end if;

  v_n := v_s;
  for v_k, v_v in select e.key, e.value from jsonb_each(p_set) as e loop
    v_null := jsonb_typeof(v_v) = 'null';
    v_txt  := case when jsonb_typeof(v_v) in ('string', 'number') then v_v #>> '{}' end;
    if not v_null and v_txt is null then
      raise exception 'content_piece_set_plan: ค่าของ % ต้องเป็นข้อความหรือตัวเลข (หรือ null เพื่อล้าง)', v_k using errcode = '22023';
    end if;
    -- ข้อความที่ผู้ใช้/AI เขียนได้ ⇒ clean ก่อนเสมอ (ช่องว่าง/อักขระล่องหน) · ค่าว่างหลัง clean = ปฏิเสธ (ล้างต้องส่ง null)
    v_c := null;
    if not v_null and v_k in ('hypothesis', 'baseline_note', 'shoot_note', 'line_audience_reason') then
      if jsonb_typeof(v_v) <> 'string' then
        raise exception 'content_piece_set_plan: % ต้องเป็นข้อความ', v_k using errcode = '22023';
      end if;
      v_c := nullif(analytics.content_text_clean(v_txt), '');
      if v_c is null then
        raise exception 'content_piece_set_plan: % ว่างเปล่า (ถ้าจะล้างค่าให้ส่ง null)', v_k using errcode = '22023';
      end if;
    end if;
    if not v_null and v_k in ('time_slot', 'piece_kind', 'channel', 'customer_group', 'metric_code', 'pass_op', 'line_audience',
                              'footage_status', 'shoot_location')
       and (jsonb_typeof(v_v) <> 'string' or not analytics.content_piece_enum_ok_(v_k, v_txt)) then
      raise exception 'content_piece_set_plan: ค่าของ % ไม่ถูกต้อง', v_k using errcode = '22023';
    end if;

    if v_k = 'date' then
      v_new_date := case when v_null then null else analytics.content_piece_try_date_(v_txt) end;
      if v_new_date is null or v_new_date < date '2025-01-01' or v_new_date > v_today + 1100 then
        raise exception 'content_piece_set_plan: date ต้องเป็น YYYY-MM-DD ในช่วงที่ยอมรับ (ล้างไม่ได้)' using errcode = '22023';
      end if;
      v_has_date := true;
    elsif v_k = 'start_time' then
      if v_null then v_n.start_time := null;
      else
        v_n.start_time := analytics.content_piece_try_time_(v_txt);
        if v_n.start_time is null then
          raise exception 'content_piece_set_plan: start_time ต้องเป็น HH:MM' using errcode = '22023';
        end if;
      end if;
    elsif v_k = 'time_slot' then v_n.time_slot := case when v_null then null else v_txt end;
    elsif v_k = 'piece_kind' then v_n.piece_kind := case when v_null then null else v_txt end;
    elsif v_k = 'channel' then v_n.channel := case when v_null then null else v_txt end;
    elsif v_k = 'customer_group' then v_n.customer_group := case when v_null then null else v_txt end;
    elsif v_k = 'hypothesis' then
      v_n.hypothesis := v_c;
      if v_c is not null and length(v_c) > 1000 then
        raise exception 'content_piece_set_plan: hypothesis ยาวเกิน 1000 ตัวอักษร' using errcode = '22023';
      end if;
    elsif v_k = 'metric_code' then v_n.metric_code := case when v_null then null else v_txt end;
    elsif v_k in ('baseline_value', 'pass_threshold', 'baseline_spread') then
      v_num := null;
      if not v_null then
        v_num := analytics.content_piece_try_numeric_(v_txt);
        -- not(between) ฆ่า NaN/Infinity ฟรี (trap #4) · null = cast ไม่ได้
        if v_num is null
           or not (v_num >= case when v_k = 'baseline_spread' then 0 else -1000000000000 end and v_num <= 1000000000000) then
          raise exception 'content_piece_set_plan: % ต้องเป็นตัวเลขจำกัดค่า (ไม่ใช่ NaN/Infinity)', v_k using errcode = '22023';
        end if;
      end if;
      if v_k = 'baseline_value' then v_n.baseline_value := v_num;
      elsif v_k = 'pass_threshold' then v_n.pass_threshold := v_num;
      else v_n.baseline_spread := v_num;
      end if;
    elsif v_k = 'baseline_as_of' then
      if v_null then v_n.baseline_as_of := null;
      else
        v_n.baseline_as_of := analytics.content_piece_try_date_(v_txt);
        if v_n.baseline_as_of is null or v_n.baseline_as_of > v_today or v_n.baseline_as_of < date '2020-01-01' then
          raise exception 'content_piece_set_plan: baseline_as_of ต้องเป็นวันที่ (YYYY-MM-DD) ไม่เกินวันนี้' using errcode = '22023';
        end if;
      end if;
    elsif v_k = 'baseline_note' then
      v_n.baseline_note := v_c;
      if v_c is not null and length(v_c) > 500 then
        raise exception 'content_piece_set_plan: baseline_note ยาวเกิน 500 ตัวอักษร' using errcode = '22023';
      end if;
    elsif v_k = 'pass_op' then v_n.pass_op := case when v_null then null else v_txt end;
    elsif v_k = 'expected_host_id' then
      if v_null then v_n.expected_host_id := null;
      else
        v_n.expected_host_id := analytics.content_piece_try_uuid_(v_txt);
        if v_n.expected_host_id is null
           or not exists (select 1 from analytics.live_host h
                           where h.id = v_n.expected_host_id and h.shop_id = p_shop_id
                             and (h.is_active or h.id = v_s.expected_host_id)) then
          raise exception 'content_piece_set_plan: ไม่พบโฮสต์ที่ใช้งานอยู่ในร้านนี้' using errcode = '22023';
        end if;
      end if;
    elsif v_k = 'line_audience' then v_n.line_audience := case when v_null then null else v_txt end;
    elsif v_k = 'line_audience_reason' then
      v_n.line_audience_reason := v_c;
      if v_c is not null and length(v_c) > 300 then
        raise exception 'content_piece_set_plan: line_audience_reason ยาวเกิน 300 ตัวอักษร' using errcode = '22023';
      end if;
    elsif v_k = 'footage_status' then v_n.footage_status := case when v_null then null else v_txt end;
    elsif v_k = 'footage_url' then
      if v_null then v_n.footage_url := null;
      else
        if jsonb_typeof(v_v) <> 'string' or not analytics.content_url_ok(btrim(v_txt)) then
          raise exception 'content_piece_set_plan: footage_url ไม่ถูกต้อง (ต้องเป็น http/https ไม่มี user@ ช่องว่าง \ < > ")' using errcode = '22023';
        end if;
        v_n.footage_url := btrim(v_txt);
      end if;
    elsif v_k = 'shoot_note' then
      v_n.shoot_note := v_c;
      if v_c is not null and length(v_c) > 1000 then
        raise exception 'content_piece_set_plan: shoot_note ยาวเกิน 1000 ตัวอักษร' using errcode = '22023';
      end if;
    elsif v_k = 'shoot_location' then v_n.shoot_location := case when v_null then null else v_txt end;
    elsif v_k = 'shoot_minutes_est' then
      if v_null then v_n.shoot_minutes_est := null;
      else
        v_num := analytics.content_piece_try_numeric_(v_txt);
        if v_num is null or not (v_num >= 1 and v_num <= 600) or v_num <> trunc(v_num) then
          raise exception 'content_piece_set_plan: shoot_minutes_est ต้องเป็นจำนวนเต็ม 1-600' using errcode = '22023';
        end if;
        v_n.shoot_minutes_est := v_num::int;
      end if;
    elsif v_k = 'shoot_date' then
      if v_null then v_n.shoot_date := null;
      else
        v_n.shoot_date := analytics.content_piece_try_date_(v_txt);
        if v_n.shoot_date is null then
          raise exception 'content_piece_set_plan: shoot_date ต้องเป็น YYYY-MM-DD' using errcode = '22023';
        end if;
      end if;
    elsif v_k = 'content_type_code' then
      v_ctype_new := case when v_null then null else v_txt end;
      if v_ctype_new is not null and (jsonb_typeof(v_v) <> 'string'
         or not exists (select 1 from analytics.content_type t where t.code = v_ctype_new and t.is_active)) then
        raise exception 'content_piece_set_plan: content_type_code ไม่ถูกต้องหรือถูกปลดระวางแล้ว' using errcode = '22023';
      end if;
      v_n.content_type_code := v_ctype_new;
    end if;
  end loop;

  -- ตรวจคู่ kind↔channel เฉพาะตอนที่ถูกแตะ (ตัดสินใจ I — คู่เก่าของ backfill ไม่ทำให้ทุก set_plan ล้ม)
  if ('piece_kind' = any (v_keys) or 'channel' = any (v_keys))
     and not analytics.content_piece_kind_channel_ok_(v_n.piece_kind, v_n.channel) then
    raise exception 'content_piece_set_plan: ชนิดชิ้นงาน % ใช้กับช่องทาง % ไม่ได้', v_n.piece_kind, v_n.channel using errcode = '22023';
  end if;
  if v_n.line_audience is not null and v_n.piece_kind is distinct from 'line_message' then
    raise exception 'content_piece_set_plan: line_audience ใช้ได้เฉพาะชิ้นชนิด line_message' using errcode = '22023';
  end if;
  if v_n.line_audience = 'segment' then
    if v_s.audience_segment is null then
      raise exception 'content_piece_set_plan: "เฉพาะกลุ่ม" ต้องมี audience_segment ของชิ้นงานก่อน (ตั้งผ่านหน้าบอร์ดเดิม/SQL — ไม่เปิดผ่าน key นี้)' using errcode = '22023';
    end if;
    if v_n.line_audience_reason is null then
      raise exception 'content_piece_set_plan: "เฉพาะกลุ่ม" ต้องระบุเหตุผล (line_audience_reason)' using errcode = '22023';
    end if;
  end if;

  -- วัน: step ใน wrapper content_task 1 step → ตั้ง anchor ของ campaign (ทางเดียวกับ campaign_reschedule_step) ·
  -- campaign หลาย step ที่มี anchor → ตั้ง offset · หลาย step ที่ anchor null → 22023
  select c.anchor_date, c.campaign_type into v_anchor, v_camp_type
    from analytics.campaign c where c.id = v_s.campaign_id for update;
  v_old_date := case when v_anchor is null then null else v_anchor + v_s.offset_start_days end;
  if v_has_date and v_new_date is distinct from v_old_date then
    select count(*)::int into v_step_count from analytics.campaign_step st where st.campaign_id = v_s.campaign_id;
    if v_camp_type = 'content_task' and v_step_count = 1 then
      update analytics.campaign set anchor_date = v_new_date - v_s.offset_start_days, updated_by = auth.uid()
       where id = v_s.campaign_id;
    elsif v_anchor is null then
      raise exception 'content_piece_set_plan: แคมเปญนี้มีหลายชิ้นแต่ยังไม่มีวันตั้งต้น (anchor_date) — ตั้งวันให้ชิ้นเดียวไม่ได้' using errcode = '22023';
    else
      v_delta := (v_new_date - v_anchor) - v_s.offset_start_days;
      update analytics.campaign_step
         set offset_start_days = offset_start_days + v_delta,
             offset_end_days = case when offset_end_days is null then null else offset_end_days + v_delta end,
             updated_by = auth.uid()
       where id = p_step_id and shop_id = p_shop_id;
    end if;
    v_date_diff := jsonb_build_object('date', jsonb_build_object('from', to_jsonb(v_old_date), 'to', to_jsonb(v_new_date)));
  end if;

  -- diff เฉพาะคอลัมน์ที่เปลี่ยนจริง (เทียบทั้งแถว — v_n เริ่มจาก v_s ⇒ ต่างได้เฉพาะที่ตั้งใจแก้)
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), '{}'::jsonb) into v_diff
    from jsonb_each(to_jsonb(v_n)) n join jsonb_each(to_jsonb(v_s)) o on o.key = n.key
   where n.value is distinct from o.value;

  if v_diff <> '{}'::jsonb then
    update analytics.campaign_step st
       set start_time = v_n.start_time, time_slot = v_n.time_slot, piece_kind = v_n.piece_kind, channel = v_n.channel,
           customer_group = v_n.customer_group, hypothesis = v_n.hypothesis, metric_code = v_n.metric_code,
           baseline_value = v_n.baseline_value, baseline_as_of = v_n.baseline_as_of, baseline_note = v_n.baseline_note,
           pass_threshold = v_n.pass_threshold, pass_op = v_n.pass_op, baseline_spread = v_n.baseline_spread,
           expected_host_id = v_n.expected_host_id, line_audience = v_n.line_audience,
           line_audience_reason = v_n.line_audience_reason, footage_status = v_n.footage_status,
           footage_url = v_n.footage_url, shoot_note = v_n.shoot_note, shoot_location = v_n.shoot_location,
           shoot_minutes_est = v_n.shoot_minutes_est, shoot_date = v_n.shoot_date,
           content_type_code = v_n.content_type_code, updated_by = auth.uid()
     where st.id = p_step_id and st.shop_id = p_shop_id;

    -- ตั้ง piece_kind ครั้งแรกแล้วยังไม่มีเอกสาร → สร้างเอกสารชนิดที่ตรงให้ (ไม่แตะเอกสารที่มีอยู่)
    if v_n.piece_kind is not null and not exists (select 1 from analytics.step_artifact a where a.step_id = p_step_id) then
      insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, status, created_by, updated_by)
      values (p_step_id, p_shop_id, analytics.content_piece_artifact_type_(v_n.piece_kind), 'owner', 'todo', auth.uid(), auth.uid());
    end if;
  end if;

  v_diff := v_diff || coalesce(v_date_diff, '{}'::jsonb);
  if v_diff <> '{}'::jsonb then
    insert into analytics.content_piece_event (shop_id, step_id, event_kind, actor_role, actor_uid, payload)
    values (p_shop_id, p_step_id, 'plan', p_actor_role, auth.uid(), jsonb_build_object('changed', v_diff));
  end if;

  select case when c.anchor_date is null then null else c.anchor_date + st.offset_start_days end into v_res_start
    from analytics.campaign_step st join analytics.campaign c on c.id = st.campaign_id where st.id = p_step_id;
  return jsonb_build_object(
    'step_id', p_step_id, 'piece_status', v_s.piece_status, 'resolved_start', to_jsonb(v_res_start),
    'changed', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_diff) as k));
end;
$f$;

-- ============================================================================
-- 15. content_piece_transition_ / content_piece_advance — เครื่องยนต์สถานะ (design §12.3)
--     RPC เดียวรับ p_to แทน 8 ฟังก์ชัน: กติกา "ย้อนได้ทีละขั้น/ข้ามไม่ได้" ต้องรู้ตารางลำดับที่เดียว
--     helper (transition_) ทำงานจริง · advance = เรียก helper ด้วย p_post_id null · content_piece_post (0160) เรียก
--     helper ด้วย post id ที่เพิ่งผูก ⇒ ไม่มีธง bypass — helper ตรวจว่า content_post.id = p_post_id และ step_id = p_step_id
--     และ status='active' จริง
--     errcode: 22023 อินพุตผิด/นอก workflow · 42501 role ไม่มีสิทธิ์ · 55000 ติดสถานะ/ด่านไม่ผ่าน
--     GUC c2.piece_rpc='1' ตั้งเฉพาะรอบ UPDATE ที่เขียน piece_status/status/artifact (ผ่าน trigger R4 ของตัวเอง)
-- ============================================================================

create or replace function analytics.content_piece_transition_(
  p_shop_id uuid,
  p_step_id uuid,
  p_to text,
  p_actor_role text,
  p_reason text default null,
  p_review_seconds int default null,
  p_post_id uuid default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_order       constant text[] := array['idea', 'planned', 'drafting', 'in_review', 'approved', 'produced', 'posted'];
  v_reason      text := nullif(analytics.content_text_clean(p_reason), '');
  v_s           analytics.campaign_step%rowtype;
  v_resolved    date;
  v_from        text;
  v_from_i      int;
  v_to_i        int;
  v_kind        text;
  v_url_kind    boolean;
  v_backward    boolean := false;
  v_need_reason boolean := false;
  v_event_kind  text;
  v_new_piece   text;
  v_new_hold    text;
  v_new_status  text;
  v_new_blocked text;
  v_new_drafted boolean;
  v_new_footage text;
  v_art_to      text;
  v_art_from    text[];
  v_art_review  boolean := false;
  v_problems    text[];
  v_block       text[];
  v_typed       int;
  v_untyped     int;
  v_ok          boolean;
  v_payload     jsonb := '{}'::jsonb;
  v_cancel_from text;
  v_cancel_pl   jsonb;
  v_sig_ids     uuid[];
  v_event_id    uuid;
begin
  if p_shop_id is null or p_step_id is null or p_to is null then
    raise exception 'content_piece_advance: ต้องระบุร้าน ชิ้นงาน และสถานะปลายทาง' using errcode = '22023';
  end if;
  if p_to not in ('idea', 'planned', 'drafting', 'in_review', 'approved', 'produced', 'posted', 'cancelled',
                  'hold', 'resume', 'restore') then
    raise exception 'content_piece_advance: p_to ไม่ถูกต้อง (%)', p_to using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- ai/system ไปได้เฉพาะ drafting/in_review (และเฉพาะทางเดินหน้า — ตรวจซ้ำหลังรู้สถานะเดิม) · อย่างอื่น owner เท่านั้น
  perform analytics.content_actor_assert(p_actor_role,
    case when p_to in ('drafting', 'in_review') then array['owner', 'ai', 'system'] else array['owner'] end,
    'content_piece_advance');
  if p_review_seconds is not null and p_to <> 'approved' then
    raise exception 'content_piece_advance: p_review_seconds ใช้ได้เฉพาะตอนอนุมัติ' using errcode = '22023';
  end if;
  if p_review_seconds is not null and not (p_review_seconds >= 0 and p_review_seconds <= 86400) then
    raise exception 'content_piece_advance: p_review_seconds ต้องอยู่ระหว่าง 0 ถึง 86400' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'content_piece_advance: เหตุผลยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;

  -- ล็อกเฉพาะแถวที่ shop_id ตรงตั้งแต่ where (0150 L2 — ไม่เปิดช่อง timing probe ข้ามร้าน)
  select s.* into v_s from analytics.campaign_step s where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_piece_advance: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  v_from := v_s.piece_status;
  if v_from is null then
    raise exception 'content_piece_advance: ชิ้นงานนี้อยู่นอก workflow ใหม่ (ก่อน 1 ต.ค. หรือสร้างจากบอร์ดเดิม)' using errcode = '22023';
  end if;
  v_kind := v_s.piece_kind;
  v_url_kind := v_kind in ('short_clip', 'live_cut', 'ig_fb_post');
  select case when c.anchor_date is null then null else c.anchor_date + v_s.offset_start_days end into v_resolved
    from analytics.campaign c where c.id = v_s.campaign_id;

  if v_s.hold_reason is not null and p_to not in ('resume', 'cancelled') then
    raise exception 'content_piece_advance: ชิ้นงานรอเงื่อนไขอยู่ (%) — กด resume ก่อน', v_s.hold_reason using errcode = '55000';
  end if;
  if p_post_id is not null and p_to <> 'posted' then
    raise exception 'content_piece_advance: p_post_id ใช้ได้เฉพาะตอนไปสถานะ posted' using errcode = '22023';
  end if;

  v_new_piece := v_from;
  v_new_hold := v_s.hold_reason;
  v_new_status := v_s.status;
  v_new_blocked := v_s.blocked_reason;
  v_new_drafted := v_s.drafted_by_ai;
  v_new_footage := v_s.footage_status;

  if p_to = 'resume' then
    if v_s.hold_reason is null then
      raise exception 'content_piece_advance: ชิ้นงานนี้ไม่ได้รอเงื่อนไขอยู่' using errcode = '55000';
    end if;
    v_event_kind := 'resume';
    v_new_hold := null;
    v_new_status := analytics.content_piece_project_(v_from);
    v_new_blocked := null;

  elsif p_to = 'hold' then
    if v_from in ('posted', 'cancelled') then
      raise exception 'content_piece_advance: ชิ้นงานสถานะ % พักรอเงื่อนไขไม่ได้', v_from using errcode = '55000';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'content_piece_advance: การพักรอเงื่อนไขต้องมีเหตุผล (อย่างน้อย 3 ตัวอักษร)' using errcode = '22023';
    end if;
    v_event_kind := 'hold';
    v_new_hold := v_reason;
    v_new_status := 'blocked';
    v_new_blocked := v_reason;

  elsif p_to = 'cancelled' then
    if v_from = 'posted' then
      raise exception 'content_piece_advance: โพสต์แล้วยกเลิกไม่ได้ — ลบ/ปลดโพสต์ก่อน' using errcode = '55000';
    end if;
    if v_from = 'cancelled' then
      raise exception 'content_piece_advance: ชิ้นงานอยู่สถานะยกเลิกแล้ว' using errcode = '55000';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'content_piece_advance: การยกเลิกต้องมีเหตุผล (อย่างน้อย 3 ตัวอักษร)' using errcode = '22023';
    end if;
    v_event_kind := 'cancel';
    v_new_piece := 'cancelled';
    v_new_hold := null;
    v_new_status := 'blocked';
    v_new_blocked := 'ยกเลิก: ' || v_reason;
    v_payload := jsonb_build_object('from_status', v_from, 'was_on_hold', v_s.hold_reason is not null);

  elsif p_to = 'restore' then
    if v_from <> 'cancelled' then
      raise exception 'content_piece_advance: ชิ้นงานนี้ไม่ได้ถูกยกเลิก' using errcode = '55000';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'content_piece_advance: การกู้คืนต้องมีเหตุผล (อย่างน้อย 3 ตัวอักษร)' using errcode = '22023';
    end if;
    -- กลับไปสถานะก่อนยกเลิกตาม event ล่าสุด (อ่านจาก event ไม่เดา · เรียงด้วย seq ไม่ใช่ created_at — trap #22)
    select e.from_status, e.payload into v_cancel_from, v_cancel_pl from analytics.content_piece_event e
     where e.step_id = p_step_id and e.event_kind = 'cancel' order by e.seq desc limit 1;
    if v_cancel_from is null then
      raise exception 'content_piece_advance: ไม่พบประวัติการยกเลิก — กู้คืนไม่ได้' using errcode = '55000';
    end if;
    v_event_kind := 'restore';
    v_new_piece := v_cancel_from;
    v_new_hold := null;
    v_new_status := analytics.content_piece_project_(v_cancel_from);
    v_new_blocked := null;
    if v_cancel_from = 'in_review' then
      v_art_to := case when v_s.drafted_by_ai then 'draft_pending_review' else 'draft' end;
      v_art_from := array['todo', 'draft', 'draft_pending_review'];
    end if;

  else
    -- ---------- ทางเดินหน้า/ย้อนตามตารางลำดับ ----------
    if v_from = 'cancelled' then
      raise exception 'content_piece_advance: ชิ้นงานถูกยกเลิกแล้ว — ใช้ restore เพื่อกู้คืน' using errcode = '55000';
    end if;
    if p_to = v_from then
      raise exception 'content_piece_advance: ชิ้นงานอยู่สถานะ % แล้ว', v_from using errcode = '55000';
    end if;
    -- ai/system: เฉพาะ planned→drafting และ drafting→in_review (ย้อน/ข้ามจาก approved ฯลฯ = เจ้าของเท่านั้น)
    if p_actor_role <> 'owner'
       and not ((v_from = 'planned' and p_to = 'drafting') or (v_from = 'drafting' and p_to = 'in_review')) then
      raise exception 'content_piece_advance: % ไม่มีสิทธิ์เปลี่ยนจาก % ไป % (เฉพาะเจ้าของ)', p_actor_role, v_from, p_to
        using errcode = '42501';
    end if;
    v_from_i := array_position(c_order, v_from);
    v_to_i := array_position(c_order, p_to);

    if v_to_i > v_from_i then
      if v_to_i = v_from_i + 1 then
        null;
      elsif v_from = 'approved' and p_to = 'posted' then
        -- ข้าม produced ได้เมื่อไม่ต้องถ่าย (§3.2/Q3) — คลิปต้องยืนยันว่ามีภาพแล้ว (ตัดสินใจ H)
        -- coalesce: footage_status null ทำให้ `in (...)` เป็น null ⇒ `not null` ไม่ raise (ผ่านเงียบ) — ต้องตีเป็น false
        v_ok := coalesce(case
          when v_kind in ('line_message', 'story') then true
          when v_kind in ('short_clip', 'live_cut') then v_s.footage_status in ('has_footage', 'shot')
          when v_kind = 'ig_fb_post' then v_s.footage_status is distinct from 'needs_shoot'
          else false end, false);
        if not v_ok then
          raise exception 'content_piece_advance: ชิ้นนี้ยังไม่ยืนยันว่ามีภาพ/ถ่ายแล้ว — ไป produced ก่อน หรือตั้ง footage_status เป็น has_footage' using errcode = '55000';
        end if;
      else
        raise exception 'content_piece_advance: จาก % ไป % ไม่ได้ (เดินหน้าได้ทีละขั้นเท่านั้น)', v_from, p_to using errcode = '55000';
      end if;
    else
      v_backward := true;
      if v_from = 'posted' then
        -- posted ย้อนได้ทางเดียวกับสถานะที่เคยผ่าน: ชนิดมี URL → produced · ไม่มี URL → approved (ไม่เคยผ่าน produced)
        if not ((v_url_kind and p_to = 'produced') or (not v_url_kind and p_to = 'approved')) then
          raise exception 'content_piece_advance: โพสต์แล้วย้อนได้เฉพาะไป % เท่านั้น',
            case when v_url_kind then 'produced' else 'approved' end using errcode = '55000';
        end if;
      elsif v_to_i <> v_from_i - 1 then
        raise exception 'content_piece_advance: จาก % ไป % ไม่ได้ (ย้อนได้ทีละ 1 ขั้นเท่านั้น)', v_from, p_to using errcode = '55000';
      end if;
      v_need_reason := v_from in ('in_review', 'approved', 'produced', 'posted');
      if v_need_reason and (v_reason is null or length(v_reason) < 3) then
        raise exception 'content_piece_advance: การย้อนจาก % ต้องมีเหตุผล (อย่างน้อย 3 ตัวอักษร)', v_from using errcode = '22023';
      end if;
    end if;

    v_event_kind := case when v_backward and v_from = 'posted' then 'unpost'
                         when v_backward then 'revert'
                         when p_to = 'posted' then 'post'
                         else 'advance' end;
    v_new_piece := p_to;
    v_new_hold := null;
    v_new_status := analytics.content_piece_project_(p_to);
    v_new_blocked := null;

    -- ---------- ด่านเดินหน้า ----------
    if not v_backward and v_from = 'idea' and p_to = 'planned' then
      v_problems := '{}'::text[];
      if v_resolved is null then v_problems := v_problems || text 'ยังไม่ได้ตั้งวัน'; end if;
      if v_s.piece_kind is null then v_problems := v_problems || text 'ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind)'; end if;
      if v_s.channel is null then v_problems := v_problems || text 'ยังไม่ได้ระบุช่องทาง (channel)'; end if;
      if v_s.customer_group is null then v_problems := v_problems || text 'ยังไม่ได้ระบุกลุ่มลูกค้า (customer_group)'; end if;
      if not analytics.content_piece_kind_channel_ok_(v_s.piece_kind, v_s.channel) then
        v_problems := v_problems || format('ชนิด %s ใช้กับช่องทาง %s ไม่ได้', v_s.piece_kind, v_s.channel);
      end if;
      if v_s.metric_code is null then
        v_problems := v_problems || text 'ยังไม่ได้เลือกตัวชี้วัด (metric_code — ไม่วัดผลให้เลือก none)';
      elsif v_s.metric_code <> 'none' then
        -- ค่า 0 คือค่าจริงของฐาน/เกณฑ์ ⇒ ตรวจ is null ตรงๆ ได้ ไม่ใช่ตรวจความว่างของข้อความ (trap #13)
        if v_s.hypothesis is null or v_s.hypothesis !~ '\S' then v_problems := v_problems || text 'ยังไม่มีสมมติฐาน'; end if;
        if v_s.baseline_value is null then v_problems := v_problems || text 'ยังไม่มีค่าฐาน (baseline_value)'; end if;
        if v_s.pass_threshold is null then v_problems := v_problems || text 'ยังไม่มีเกณฑ์ผ่าน (pass_threshold)'; end if;
        if v_s.pass_op is null then v_problems := v_problems || text 'ยังไม่ได้เลือกทิศเกณฑ์ (pass_op)'; end if;
      end if;
      if v_s.piece_kind = 'line_message' and v_s.line_audience is null then
        v_problems := v_problems || text 'ชิ้น LINE ยังไม่ได้เลือกผู้รับ (line_audience)';
      end if;
      if cardinality(v_problems) > 0 then
        raise exception 'content_piece_advance: วางแผนไม่ได้ — %', array_to_string(v_problems, ' · ') using errcode = '55000';
      end if;

    elsif not v_backward and v_from = 'drafting' and p_to = 'in_review' then
      if v_kind in ('short_clip', 'live_cut') then
        -- R19: distinct ไม่นับ null ⇒ ต้องนับ "ตัวที่ยังไม่ติดประเภท" ให้เห็นสาเหตุ
        select count(distinct h.hook_type) filter (where h.hook_type is not null)::int,
               count(*) filter (where h.hook_type is null)::int
          into v_typed, v_untyped
          from analytics.content_hook h
         where h.step_id = p_step_id and h.shop_id = p_shop_id and h.origin = 'ours' and h.label is not null;
        if v_typed < 2 then
          raise exception 'content_piece_advance: ส่งตรวจไม่ได้ — hook A/B ต้องติดประเภทต่างกันอย่างน้อย 2 ประเภท (ตอนนี้ %; hook ยังไม่ติดประเภท % ตัว)',
            v_typed, v_untyped using errcode = '55000';
        end if;
        if not exists (select 1 from analytics.step_artifact a
                        where a.step_id = p_step_id and a.artifact_type in ('short_form_clip', 'live_highlight_clip')
                          and jsonb_typeof(a.clip_brief -> 'shots') = 'array' and jsonb_array_length(a.clip_brief -> 'shots') > 0) then
          raise exception 'content_piece_advance: ส่งตรวจไม่ได้ — คลิปต้องมี shot list อย่างน้อย 1 ช็อต' using errcode = '55000';
        end if;
      else
        if not exists (select 1 from analytics.step_artifact a where a.step_id = p_step_id and a.content_body ~ '\S') then
          raise exception 'content_piece_advance: ส่งตรวจไม่ได้ — ยังไม่มีเนื้อหา (content_body)' using errcode = '55000';
        end if;
      end if;
      if p_actor_role in ('ai', 'system') then
        v_new_drafted := true;
      end if;

    elsif not v_backward and v_from = 'in_review' and p_to = 'approved' then
      -- สูตรเดียวกับ v_content_piece.can_approve (ฟังก์ชันเดียว — ตัดสินใจ D)
      v_block := analytics.content_piece_approve_blockers(p_step_id);
      if cardinality(v_block) > 0 then
        raise exception 'content_piece_advance: อนุมัติไม่ได้ — %', array_to_string(v_block, ' · ') using errcode = '55000';
      end if;
      v_art_to := 'approved';
      v_art_from := array['draft_pending_review', 'draft', 'todo'];
      v_art_review := true;
      select jsonb_build_object('gates', coalesce(jsonb_object_agg(g.gate_kind,
               jsonb_build_object('status', g.status, 'checked_by_role', g.checked_by_role)), '{}'::jsonb))
        into v_payload
        from analytics.step_gate g
       where g.step_id = p_step_id and g.gate_kind in ('fact_check', 'brand_rule', 'risk_owner');

    elsif not v_backward and v_from = 'approved' and p_to = 'produced' then
      if v_s.footage_status = 'needs_shoot' then
        v_new_footage := 'shot';
      end if;

    elsif not v_backward and p_to = 'posted' then
      if v_kind is null then
        raise exception 'content_piece_advance: ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind) — โพสต์ไม่ได้' using errcode = '55000';
      end if;
      if v_url_kind then
        if p_post_id is null then
          raise exception 'content_piece_advance: ชิ้นนี้ต้องวางลิงก์โพสต์ผ่าน content_piece_post (ไม่ใช่ advance โดยตรง)' using errcode = '55000';
        end if;
        if not exists (select 1 from analytics.content_post cp
                        where cp.id = p_post_id and cp.shop_id = p_shop_id and cp.step_id = p_step_id and cp.status = 'active') then
          raise exception 'content_piece_advance: ไม่พบโพสต์ที่ใช้งานอยู่และผูกกับชิ้นงานนี้' using errcode = '55000';
        end if;
        v_payload := jsonb_build_object('post_id', p_post_id);
      else
        if p_post_id is not null then
          raise exception 'content_piece_advance: ชิ้นชนิด % ไม่มีลิงก์โพสต์ (ไม่สร้างแถว content_post)', v_kind using errcode = '22023';
        end if;
        v_payload := jsonb_build_object('posted_at', to_jsonb(now()));
      end if;
      v_art_to := 'done';
      v_art_from := array['approved'];

    -- ---------- ผลข้างเคียงของการย้อน (projection ฝั่ง artifact) ----------
    elsif v_backward and v_from = 'in_review' then
      v_art_to := 'draft';
      v_art_from := array['draft_pending_review'];
    elsif v_backward and v_from = 'approved' then
      v_art_to := 'draft';      -- reviewed_at/by คงไว้เป็นประวัติ
      v_art_from := array['approved'];
    elsif v_backward and v_from = 'posted' then
      v_art_to := 'approved';
      v_art_from := array['done'];
      -- ชนิดมี URL ต้องไม่เหลือโพสต์ active ผูกอยู่ (ต้อง set_status deleted หรือ unlink ก่อน)
      if v_url_kind and exists (select 1 from analytics.content_post cp
                                 where cp.step_id = p_step_id and cp.shop_id = p_shop_id and cp.status = 'active') then
        raise exception 'content_piece_advance: ยังมีโพสต์ที่ใช้งานอยู่ผูกกับชิ้นนี้ — ลบโพสต์ (content_post_set_status deleted) หรือปลดผูกก่อน'
          using errcode = '55000';
      end if;
    end if;
  end if;

  -- ---------- เขียน (GUC เปิดเฉพาะรอบ UPDATE ที่ trigger R4 ดูแล) ----------
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.campaign_step
     set piece_status = v_new_piece, hold_reason = v_new_hold, status = v_new_status, blocked_reason = v_new_blocked,
         drafted_by_ai = v_new_drafted, footage_status = v_new_footage, updated_by = auth.uid()
   where id = p_step_id and shop_id = p_shop_id;
  if v_art_to is not null then
    update analytics.step_artifact
       set status = v_art_to,
           reviewed_by = case when v_art_review then auth.uid() else reviewed_by end,
           reviewed_at = case when v_art_review then now() else reviewed_at end,
           updated_by = auth.uid()
     where step_id = p_step_id and shop_id = p_shop_id and status = any (v_art_from);
  end if;
  perform set_config('c2.piece_rpc', '', true);

  -- มติเจ้าของ Q8 (7 ต.ค. 69): ยกเลิกชิ้น → สัญญาณต้นทางที่ "หยิบเป็นชิ้นนี้" กลับเป็น new อัตโนมัติ (ล้าง picked_step_id)
  -- เฉพาะสัญญาณที่ status='picked' และ picked_step_id = step นี้ — สัญญาณที่ถูกหยิบไปชิ้นอื่นแล้วไม่แตะ · บันทึก id ใน payload
  if v_event_kind = 'cancel' then
    with u as (
      update analytics.content_signal sg
         set status = 'new', picked_step_id = null, status_reason = null, review_on = null, updated_by = auth.uid()
       where sg.shop_id = p_shop_id and sg.picked_step_id = p_step_id and sg.status = 'picked'
      returning sg.id)
    select array_agg(u.id order by u.id) into v_sig_ids from u;
    v_payload := v_payload || jsonb_build_object('signal_ids', coalesce(to_jsonb(v_sig_ids), '[]'::jsonb));
  elsif v_event_kind = 'restore' then
    -- กู้คืน: ผูกสัญญาณเดิมกลับเฉพาะเมื่อมัน "ว่าง" (new + ไม่ผูกชิ้นไหน) — ถูกหยิบไปชิ้นอื่น/ตั้งไม่ใช้/เก็บไว้ก่อนแล้ว = ไม่แตะ
    -- ชิ้นที่กู้คืนจะไม่มีสัญญาณต้นทาง (ไม่ปฏิเสธการกู้) ⇒ สัญญาณ 1 ตัวไม่มีทางผูก 2 ชิ้นพร้อมกัน
    if jsonb_typeof(v_cancel_pl -> 'signal_ids') = 'array' then
      with u as (
        update analytics.content_signal sg
           set status = 'picked', picked_step_id = p_step_id, status_reason = null, review_on = null, updated_by = auth.uid()
         where sg.shop_id = p_shop_id and sg.status = 'new' and sg.picked_step_id is null
           and sg.id::text in (select jsonb_array_elements_text(v_cancel_pl -> 'signal_ids'))
        returning sg.id)
      select array_agg(u.id order by u.id) into v_sig_ids from u;
    end if;
    v_payload := v_payload || jsonb_build_object('signal_rebound', coalesce(to_jsonb(v_sig_ids), '[]'::jsonb));
  end if;

  insert into analytics.content_piece_event
    (shop_id, step_id, event_kind, from_status, to_status, reason, actor_role, actor_uid, review_seconds, payload)
  values
    (p_shop_id, p_step_id, v_event_kind, v_from, v_new_piece, v_reason, p_actor_role, auth.uid(), p_review_seconds, v_payload)
  returning id into v_event_id;

  -- ส่งตรวจแล้ว: รายการ [ต้องยืนยัน] ต้องครบตั้งแต่เข้าคิว (ไม่งั้น approve ชั้น 2 บล็อกโดยไม่มีรายการให้ตอบ)
  if v_event_kind = 'advance' and p_to = 'in_review' then
    perform analytics.content_confirm_extract_(p_shop_id, p_step_id, 'system');
  end if;

  return jsonb_build_object('step_id', p_step_id, 'from', v_from, 'to', v_new_piece, 'status_projected', v_new_status,
                            'hold_reason', to_jsonb(v_new_hold), 'event_id', v_event_id);
end;
$f$;

create or replace function analytics.content_piece_advance(
  p_shop_id uuid,
  p_step_id uuid,
  p_to text,
  p_actor_role text,
  p_reason text default null,
  p_review_seconds int default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  return analytics.content_piece_transition_(p_shop_id, p_step_id, p_to, p_actor_role, p_reason, p_review_seconds, null);
end;
$f$;

-- ============================================================================
-- 16. content_gate_record — บันทึกผล 3 ด่าน (fact_check / brand_rule / risk_owner) · design §12.4
--     risk_owner → passed/na เฉพาะเจ้าของ · AI ตั้งได้แค่ pending/blocked + detail.question (= "คำถามถึงเจ้าของ")
--     ตัดสินใจ G: ai/system ตั้ง 'na' ไม่ได้เลย ("ไม่เกี่ยวข้อง" เป็นการตัดสิน ไม่ใช่ผลตรวจ — บทเรียน 0158 actor ฝั่ง AI)
--     บันทึกได้เมื่อ step อยู่ drafting/in_review เท่านั้น · detail ตรวจรูป+ลิงก์+ข้อความแล้วเขียนค่าที่ clean กลับ
--     trap #14: insert list ครบทุกคอลัมน์ที่ CHECK/on conflict อ้าง · detail ว่าง = คงหลักฐานเดิม (coalesce)
-- ============================================================================

create or replace function analytics.content_gate_record(
  p_shop_id uuid,
  p_step_id uuid,
  p_gate_kind text,
  p_status text,
  p_actor_role text,
  p_detail jsonb default null,
  p_note text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_note    text := nullif(analytics.content_text_clean(p_note), '');
  v_piece   text;
  v_detail  jsonb := null;
  v_allowed text[];
  v_bad     text;
  v_arr     jsonb;
  v_e       jsonb;
  v_u       text;
  v_n       int;
  v_max     int;
  v_passed  int;
begin
  if p_shop_id is null or p_step_id is null or p_gate_kind is null or p_status is null then
    raise exception 'content_gate_record: ต้องระบุร้าน ชิ้นงาน ด่าน และสถานะ' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_gate_record');
  if p_gate_kind not in ('fact_check', 'brand_rule', 'risk_owner') then
    raise exception 'content_gate_record: ด่านต้องเป็น fact_check, brand_rule หรือ risk_owner (ด่านโปรโมเดิมใช้ campaign_pass_gate)' using errcode = '22023';
  end if;
  if p_status not in ('pending', 'passed', 'blocked', 'na') then
    raise exception 'content_gate_record: สถานะต้องเป็น pending/passed/blocked/na' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'content_gate_record: หมายเหตุยาวเกิน 500 ตัวอักษร' using errcode = '22023';
  end if;
  if p_actor_role <> 'owner' then
    if p_status = 'na' then
      raise exception 'content_gate_record: AI/ระบบตั้ง "ไม่เกี่ยวข้อง" (na) ไม่ได้ — เจ้าของตัดสิน' using errcode = '42501';
    end if;
    if p_gate_kind = 'risk_owner' and p_status = 'passed' then
      raise exception 'content_gate_record: ความเสี่ยง เจ้าของตอบเท่านั้น (AI ตั้งผ่านไม่ได้)' using errcode = '42501';
    end if;
  end if;

  -- detail: object เท่านั้น (jsonb null/array = ปฏิเสธ — trap #13) · key ต่อด่านตามที่ออกแบบ · เขียนค่าที่ clean แล้วกลับ
  if p_detail is not null then
    if jsonb_typeof(p_detail) <> 'object' then
      raise exception 'content_gate_record: detail ต้องเป็น json object' using errcode = '22023';
    end if;
    if length(p_detail::text) > 8000 then
      raise exception 'content_gate_record: detail ใหญ่เกิน 8000 ตัวอักษร' using errcode = '22023';
    end if;
    v_allowed := case p_gate_kind when 'fact_check' then array['sources', 'flagged']
                                  when 'brand_rule' then array['rules_hit']
                                  else array['question', 'answer'] end;
    select string_agg(k, ', ') into v_bad from jsonb_object_keys(p_detail) as k where k <> all (v_allowed);
    if v_bad is not null then
      raise exception 'content_gate_record: detail ของด่าน % ไม่รับ key: %', p_gate_kind, v_bad using errcode = '22023';
    end if;
    v_detail := '{}'::jsonb;

    if jsonb_typeof(p_detail -> 'sources') is not null and jsonb_typeof(p_detail -> 'sources') <> 'null' then
      if jsonb_typeof(p_detail -> 'sources') <> 'array' or jsonb_array_length(p_detail -> 'sources') > 50 then
        raise exception 'content_gate_record: sources ต้องเป็น array ไม่เกิน 50 ลิงก์' using errcode = '22023';
      end if;
      v_arr := '[]'::jsonb;
      for v_e in select e.value from jsonb_array_elements(p_detail -> 'sources') as e loop
        v_u := case when jsonb_typeof(v_e) = 'string' then btrim(v_e #>> '{}') end;
        if v_u is null or not analytics.content_url_ok(v_u) then
          raise exception 'content_gate_record: ลิงก์แหล่งอ้างอิงไม่ถูกต้อง (ต้องเป็น http/https ไม่มี user@ ช่องว่าง)' using errcode = '22023';
        end if;
        v_arr := v_arr || to_jsonb(v_u);
      end loop;
      v_detail := v_detail || jsonb_build_object('sources', v_arr);
    end if;

    foreach v_u in array array['flagged', 'rules_hit'] loop
      v_max := case when v_u = 'rules_hit' then 80 else 500 end;
      if jsonb_typeof(p_detail -> v_u) is not null and jsonb_typeof(p_detail -> v_u) <> 'null' then
        if jsonb_typeof(p_detail -> v_u) <> 'array' or jsonb_array_length(p_detail -> v_u) > 50 then
          raise exception 'content_gate_record: % ต้องเป็น array ของข้อความ ไม่เกิน 50 รายการ', v_u using errcode = '22023';
        end if;
        v_arr := '[]'::jsonb;
        for v_e in select e.value from jsonb_array_elements(p_detail -> v_u) as e loop
          v_n := length(coalesce(analytics.content_text_clean(case when jsonb_typeof(v_e) = 'string' then v_e #>> '{}' end), ''));
          if jsonb_typeof(v_e) <> 'string' or v_n < 1 or v_n > v_max then
            raise exception 'content_gate_record: รายการใน % ต้องเป็นข้อความยาว 1-% ตัวอักษร', v_u, v_max
              using errcode = '22023';
          end if;
          v_arr := v_arr || to_jsonb(analytics.content_text_clean(v_e #>> '{}'));
        end loop;
        v_detail := v_detail || jsonb_build_object(v_u, v_arr);
      end if;
    end loop;

    foreach v_u in array array['question', 'answer'] loop
      v_max := case when v_u = 'question' then 500 else 1000 end;
      if jsonb_typeof(p_detail -> v_u) is not null and jsonb_typeof(p_detail -> v_u) <> 'null' then
        v_n := length(coalesce(analytics.content_text_clean(case when jsonb_typeof(p_detail -> v_u) = 'string' then p_detail ->> v_u end), ''));
        if jsonb_typeof(p_detail -> v_u) <> 'string' or v_n < 1 or v_n > v_max then
          raise exception 'content_gate_record: % ต้องเป็นข้อความยาว 1-% ตัวอักษร', v_u, v_max
            using errcode = '22023';
        end if;
        v_detail := v_detail || jsonb_build_object(v_u, analytics.content_text_clean(p_detail ->> v_u));
      end if;
    end loop;
  end if;

  -- AI ตั้งความเสี่ยงเป็นคำถามถึงเจ้าของ: ต้องมี detail.question (ไม่งั้นเจ้าของไม่รู้ว่าถามอะไร)
  if p_actor_role <> 'owner' and p_gate_kind = 'risk_owner' and p_status in ('pending', 'blocked')
     and coalesce(v_detail ->> 'question', '') = '' then
    raise exception 'content_gate_record: AI ตั้งด่านความเสี่ยงต้องระบุคำถามถึงเจ้าของใน detail.question' using errcode = '22023';
  end if;

  select s.piece_status into v_piece from analytics.campaign_step s
   where s.id = p_step_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_gate_record: ไม่พบชิ้นงานในร้านนี้' using errcode = '22023';
  end if;
  if v_piece is null then
    raise exception 'content_gate_record: ชิ้นงานนี้อยู่นอก workflow ใหม่' using errcode = '22023';
  end if;
  if v_piece not in ('drafting', 'in_review') then
    raise exception 'content_gate_record: บันทึกด่านได้เฉพาะตอน drafting/in_review (ชิ้นนี้อยู่สถานะ %) — %', v_piece,
      case when v_piece in ('idea', 'planned') then 'ยังไม่มีร่างให้ตรวจ' else 'ส่งกลับก่อนจึงจะแก้ผลตรวจได้' end
      using errcode = '55000';
  end if;

  insert into analytics.step_gate as g
    (step_id, shop_id, gate_kind, status, note, detail, checked_by_role, passed_by, passed_at)
  values
    (p_step_id, p_shop_id, p_gate_kind, p_status, v_note, v_detail, p_actor_role,
     case when p_status in ('passed', 'na') then auth.uid() end,
     case when p_status in ('passed', 'na') then now() end)
  on conflict (step_id, gate_kind) do update
    set status = excluded.status,
        note = excluded.note,
        detail = coalesce(excluded.detail, g.detail),
        checked_by_role = excluded.checked_by_role,
        passed_by = excluded.passed_by,
        passed_at = excluded.passed_at;

  insert into analytics.content_piece_event (shop_id, step_id, event_kind, actor_role, actor_uid, payload)
  values (p_shop_id, p_step_id, 'gate', p_actor_role, auth.uid(),
          jsonb_build_object('gate_kind', p_gate_kind, 'status', p_status));

  select count(*)::int into v_passed from analytics.step_gate g2
   where g2.step_id = p_step_id and g2.gate_kind in ('fact_check', 'brand_rule', 'risk_owner') and g2.status in ('passed', 'na');
  return jsonb_build_object('step_id', p_step_id, 'gate_kind', p_gate_kind, 'status', p_status, 'gates_passed', v_passed);
end;
$f$;

-- ============================================================================
-- 17. content_confirm_resolve — เจ้าของตอบ [ต้องยืนยัน] 1 รายการ · แทนที่ marker ในข้อความจริง (ไม่ใช่แค่จดคำตอบ)
--     เหตุผล: ด่าน approve ชั้น 2 ตรวจข้อความ ⇒ ตอบครั้งเดียวต้องผ่านได้ (ขัด "อนุมัติ 2-3 นาที/ชิ้น" ถ้าต้องไปแก้ storyboard เอง)
--     R21: clip_brief แทนผ่าน text แล้ว cast กลับ — ใช้ to_jsonb ตัด quote (escape ถูก jsonb) + assert_clip_brief_valid
--     UPDATE ยิง trg_step_artifact_updated_at (ถูกต้อง — คนแก้จริง) · ตั้ง GUC ผ่าน trigger R4 · ไม่ล้างผลตรวจ (คำตอบเจ้าของ ≠ เนื้อหาใหม่จาก AI)
--     ตอบได้เฉพาะ idea..in_review — อนุมัติแล้วห้ามแตะเนื้อหา (ส่งกลับก่อน)
-- ============================================================================

create or replace function analytics.content_confirm_resolve(
  p_shop_id uuid,
  p_item_id uuid,
  p_answer text,
  p_actor_role text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_answer    text := nullif(analytics.content_text_clean(p_answer), '');
  v_step      uuid;
  v_piece     text;
  v_item      analytics.content_confirm_item%rowtype;
  v_pattern   text;
  v_rep_body  text;
  v_rep_json  text;
  v_art       record;
  v_new_body  text;
  v_new_brief jsonb;
  v_new_text  text;
  v_changed   boolean;
  v_replaced  int := 0;
  v_pending   int;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'content_confirm_resolve: ต้องระบุร้านและรายการ' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_confirm_resolve');
  if v_answer is null then
    raise exception 'content_confirm_resolve: คำตอบว่างเปล่า' using errcode = '22023';
  end if;
  if length(v_answer) > 1000 then
    raise exception 'content_confirm_resolve: คำตอบยาวเกิน 1000 ตัวอักษร' using errcode = '22023';
  end if;
  -- คำตอบที่มี marker จะวนลูป (แทนแล้วยังเจอ marker)
  if analytics.content_marker_present(v_answer) then
    raise exception 'content_confirm_resolve: คำตอบห้ามมี [ต้องยืนยัน' using errcode = '22023';
  end if;

  select i.step_id into v_step from analytics.content_confirm_item i where i.id = p_item_id and i.shop_id = p_shop_id;
  if not found then
    raise exception 'content_confirm_resolve: ไม่พบรายการในร้านนี้' using errcode = '22023';
  end if;
  -- ล็อก step ก่อน item (ลำดับเดียวกับ transition_)
  select s.piece_status into v_piece from analytics.campaign_step s where s.id = v_step and s.shop_id = p_shop_id for update;
  select * into v_item from analytics.content_confirm_item i where i.id = p_item_id and i.shop_id = p_shop_id for update;
  if v_item.resolved_at is not null then
    raise exception 'content_confirm_resolve: รายการนี้ตอบไปแล้ว' using errcode = '55000';
  end if;
  if v_item.removed_at is not null then
    raise exception 'content_confirm_resolve: ข้อความถูกแก้แล้ว ไม่มีอะไรให้ตอบ (รายการนี้ถูกถอดออก)' using errcode = '55000';
  end if;
  if v_piece is null or v_piece not in ('idea', 'planned', 'drafting', 'in_review') then
    raise exception 'content_confirm_resolve: ชิ้นงานอยู่สถานะที่แก้ข้อความไม่ได้ (%) — ส่งกลับก่อน', coalesce(v_piece, 'นอก workflow') using errcode = '55000';
  end if;

  -- pattern: ช่องว่างในคำถามที่ clean แล้ว = \s+ (ข้อความจริงอาจเว้นวรรคหลายตัว) · '(ไม่ระบุ)' = marker ว่าง
  v_pattern := '\[\s*ต้อง\s*ยืนยัน\s*[:：]?\s*'
               || case when v_item.question = '(ไม่ระบุ)' then ''
                       else replace(analytics.content_regex_escape(v_item.question), ' ', '\s+') end
               || '\s*\]';
  -- replacement ของ regexp_replace ตีความ \ เป็นอักขระพิเศษ ⇒ เบิ้ล backslash
  v_rep_body := replace(v_answer, '\', '\\');
  v_rep_json := replace(substr(to_jsonb(v_answer)::text, 2, length(to_jsonb(v_answer)::text) - 2), '\', '\\');

  perform set_config('c2.piece_rpc', '1', true);
  for v_art in
    select a.id, a.content_body, a.clip_brief from analytics.step_artifact a
     where a.step_id = v_step and a.shop_id = p_shop_id order by a.id for update
  loop
    v_new_body := v_art.content_body;
    v_new_brief := v_art.clip_brief;
    v_changed := false;
    if v_art.content_body is not null then
      v_new_body := regexp_replace(v_art.content_body, v_pattern, v_rep_body, 'g');
      v_changed := v_new_body is distinct from v_art.content_body;
    end if;
    if v_art.clip_brief is not null then
      v_new_text := regexp_replace(v_art.clip_brief::text, v_pattern, v_rep_json, 'g');
      if v_new_text is distinct from v_art.clip_brief::text then
        begin
          v_new_brief := v_new_text::jsonb;
        exception when others then
          raise exception 'content_confirm_resolve: คำตอบนี้ทำให้ clip_brief เสียรูป (ลองตัดอักขระพิเศษออก)' using errcode = '22023';
        end;
        perform analytics.assert_clip_brief_valid(v_new_brief);
        v_changed := true;
      end if;
    end if;
    if v_changed then
      update analytics.step_artifact
         set content_body = v_new_body, clip_brief = v_new_brief, human_edited = true, updated_by = auth.uid()
       where id = v_art.id;
      v_replaced := v_replaced + 1;
    end if;
  end loop;
  perform set_config('c2.piece_rpc', '', true);

  if v_replaced = 0 then
    raise exception 'content_confirm_resolve: หา marker ในข้อความไม่เจอ (ข้อความถูกแก้แล้ว?) — ให้รัน content_confirm_extract ใหม่' using errcode = '55000';
  end if;

  update analytics.content_confirm_item
     set answer = v_answer, resolved_at = now(), resolved_by_role = 'owner'
   where id = p_item_id;
  insert into analytics.content_piece_event (shop_id, step_id, event_kind, actor_role, actor_uid, payload)
  values (p_shop_id, v_step, 'confirm', 'owner', auth.uid(), jsonb_build_object('item_id', p_item_id, 'key', v_item.key));
  -- จัดสถานะ key อื่นที่หาย/โผล่ใหม่ด้วย · ถ้า marker เดิมยังเหลือ (เว้นวรรค/อักขระต่างจนแทนไม่หมด) extract จะเปิดรายการกลับ ⇒ ปฏิเสธทั้งก้อน
  perform analytics.content_confirm_extract_(p_shop_id, v_step, 'system');
  if (select i.resolved_at from analytics.content_confirm_item i where i.id = p_item_id) is null then
    raise exception 'content_confirm_resolve: ยังพบ marker เดิมหลงเหลือในข้อความ (แทนไม่หมด) — ยกเลิกการตอบ' using errcode = '55000';
  end if;

  select count(*)::int into v_pending from analytics.content_confirm_item i
   where i.step_id = v_step and i.resolved_at is null and i.removed_at is null;
  return jsonb_build_object('item_id', p_item_id, 'replaced_in_artifacts', v_replaced, 'remaining_pending', v_pending);
end;
$f$;

-- ============================================================================
-- 18. v_content_piece — 1 แถว/ชิ้นงาน (step ที่ piece_status is not null) · หน้า F · inbox กอง 1-3 · G
--     view ใหม่ตัวเดียว (ไม่ replace view เดิม — trap #3; ไม่ต่อคอลัมน์เข้า v_campaign_board) · security_invoker
--     ⚠️ "วัน" ทุกจุดเป็นวันไทย (trap #6) — ไม่มี current_date · effective_piece_status คำนวณสด (D2: ไม่เก็บสถานะที่ระบบเปลี่ยนเอง)
--     ⚠️ ชื่อโฮสต์จริง (live_host.display_name) ไม่อยู่ใน view — เปิดเฉพาะ public_label
--     ⚠️ R24: 'measured' อิง v_content_post_t7 ของโพสต์แรกที่ active เท่านั้น — ชิ้น ig_fb_post 2 โพสต์วัดผลแค่ใบแรก
--        (ผลต่อโพสต์รายใบดูได้ครบจาก posts[] + v_content_post_t7)
--     can_approve = ไม่มีข้อบล็อกจาก content_piece_approve_blockers (ฟังก์ชันเดียวกับ RPC อนุมัติ) — ไม่รวมเช็คสถานะ/ role
-- ============================================================================

create or replace view analytics.v_content_piece
  with (security_invoker = true) as
select
  b.*,
  case
    when b.piece_status = 'cancelled' then 'cancelled'
    when b.hold_reason is not null then 'on_hold'
    when b.piece_status = 'posted' and b.piece_kind in ('line_message', 'story') then 'posted'
    when b.piece_status = 'posted' and b.posted_on is not null and b.t7_captured is not null then 'measured'
    when b.piece_status = 'posted' and b.posted_on is not null
         and ((now() at time zone 'Asia/Bangkok')::date - b.posted_on) between 1 and 9 then 'measuring'
    when b.piece_status = 'posted' and b.posted_on is not null
         and ((now() at time zone 'Asia/Bangkok')::date - b.posted_on) > 9 then 'missed_measure'
    else b.piece_status
  end as effective_piece_status
from (
  select
    s.id as step_id, s.campaign_id, s.shop_id, c.name as campaign_name, c.campaign_type, s.title,
    s.piece_status, s.hold_reason, s.piece_kind, s.channel, s.customer_group, s.time_slot,
    to_char(s.start_time::interval, 'HH24:MI') as start_time,
    case when c.anchor_date is null then null::date else c.anchor_date + s.offset_start_days end as resolved_start,
    case when c.anchor_date is null or s.offset_end_days is null then null::date else c.anchor_date + s.offset_end_days end as resolved_end,
    case when c.anchor_date is null then null::integer
         else (c.anchor_date + s.offset_start_days) - (now() at time zone 'Asia/Bangkok')::date end as days_until,
    s.hypothesis, s.metric_code, s.baseline_value, s.baseline_as_of, s.pass_threshold, s.pass_op, s.baseline_spread,
    (s.baseline_spread is not null and s.pass_threshold is not null and s.baseline_value is not null
       and abs(s.pass_threshold - s.baseline_value) < s.baseline_spread) as threshold_too_narrow,
    s.footage_status, s.footage_url, s.shoot_note, s.shoot_location, s.shoot_minutes_est, s.shoot_date,
    s.expected_host_id, h.public_label as expected_host_label,
    s.drafted_by_ai, s.line_audience, s.line_audience_reason, s.audience_segment, s.content_type_code, s.goal_kpi_code,
    a.id as artifact_id, a.artifact_type, a.content_body, a.clip_brief, a.generated_by, a.human_edited,
    coalesce(hk.hooks, '[]'::jsonb) as hooks,
    jsonb_build_object('fact_check', gt.fact_check, 'brand_rule', gt.brand_rule, 'risk_owner', gt.risk_owner) as gates,
    (coalesce(gt.passed_n, 0) = 3) as gates_passed,
    coalesce(cf.pending_n, 0) as confirm_pending,
    coalesce(mk.has_marker, false) as confirm_marker_in_text,
    (cardinality(analytics.content_piece_approve_blockers(s.id)) = 0) as can_approve,
    coalesce(po.posts, '[]'::jsonb) as posts,
    case when s.piece_kind in ('line_message', 'story') then ev.event_posted_on else po.posted_on_url end as posted_on,
    t7.t7_captured_on as t7_captured,
    case when ev.source_signal_txt ~ '^[0-9a-fA-F-]{36}$' then ev.source_signal_txt::uuid end as source_signal_id,
    ev.last_event_at,
    case when s.piece_status in ('approved', 'produced', 'posted') then ev.approved_at end as approved_at,
    case when s.piece_status in ('approved', 'produced', 'posted') then ev.approved_by_role end as approved_by_role,
    s.created_at, s.updated_at
  from analytics.campaign_step s
  join analytics.campaign c on c.id = s.campaign_id
  left join analytics.live_host h on h.id = s.expected_host_id and h.shop_id = s.shop_id
  left join lateral (
    select x.* from analytics.step_artifact x where x.step_id = s.id order by x.created_at, x.id limit 1
  ) a on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'label', k.label, 'text', k.text, 'hook_type', k.hook_type, 'hook_type_raw', k.hook_type_raw,
             'derived_from_hook_id', k.derived_from_hook_id, 'source_signal_id', k.source_signal_id)
           order by k.label nulls last, k.created_at, k.id) as hooks
    from analytics.content_hook k where k.step_id = s.id and k.origin = 'ours'
  ) hk on true
  left join lateral (
    select
      (array_agg(jsonb_build_object('status', g.status, 'detail', g.detail, 'note', g.note,
                                    'checked_by_role', g.checked_by_role, 'passed_at', g.passed_at))
         filter (where g.gate_kind = 'fact_check'))[1] as fact_check,
      (array_agg(jsonb_build_object('status', g.status, 'detail', g.detail, 'note', g.note,
                                    'checked_by_role', g.checked_by_role, 'passed_at', g.passed_at))
         filter (where g.gate_kind = 'brand_rule'))[1] as brand_rule,
      (array_agg(jsonb_build_object('status', g.status, 'detail', g.detail, 'note', g.note,
                                    'checked_by_role', g.checked_by_role, 'passed_at', g.passed_at))
         filter (where g.gate_kind = 'risk_owner'))[1] as risk_owner,
      (count(*) filter (where g.status in ('passed', 'na')))::integer as passed_n
    from analytics.step_gate g
    where g.step_id = s.id and g.gate_kind in ('fact_check', 'brand_rule', 'risk_owner')
  ) gt on true
  left join lateral (
    select count(*)::integer as pending_n from analytics.content_confirm_item i
    where i.step_id = s.id and i.resolved_at is null and i.removed_at is null
  ) cf on true
  left join lateral (
    select bool_or(analytics.content_marker_present(x.content_body) or analytics.content_marker_present(x.clip_brief::text)) as has_marker
    from analytics.step_artifact x where x.step_id = s.id
  ) mk on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'post_id', p.id, 'platform', p.platform, 'post_url', p.post_url, 'posted_at', p.posted_at,
             'status', p.status, 'hook_id', p.hook_id) order by p.posted_at, p.id) as posts,
           min(p.posted_date_th) filter (where p.status = 'active') as posted_on_url,
           (array_agg(p.id order by p.posted_at, p.id) filter (where p.status = 'active'))[1] as first_post_id
    from analytics.content_post p where p.step_id = s.id
  ) po on true
  left join lateral (
    select analytics_t7.t7_captured_on from analytics.v_content_post_t7 analytics_t7 where analytics_t7.post_id = po.first_post_id
  ) t7 on true
  left join lateral (
    select
      max(e.created_at) as last_event_at,
      (array_agg(e.created_at order by e.seq desc) filter (where e.event_kind = 'advance' and e.to_status = 'approved'))[1] as approved_at,
      (array_agg(e.actor_role order by e.seq desc) filter (where e.event_kind = 'advance' and e.to_status = 'approved'))[1] as approved_by_role,
      (array_agg((e.created_at at time zone 'Asia/Bangkok')::date order by e.seq desc) filter (where e.event_kind = 'post'))[1] as event_posted_on,
      (array_agg(e.payload ->> 'signal_id' order by e.seq) filter (where e.event_kind = 'create'))[1] as source_signal_txt
    from analytics.content_piece_event e where e.step_id = s.id
  ) ev on true
  where s.piece_status is not null
) b;

comment on view analytics.v_content_piece is
  '1 แถว/ชิ้นงานใน workflow ใหม่ (piece_status is not null) · effective_piece_status คำนวณสดจากวันไทย (measuring/measured/missed_measure/on_hold) · '
  'can_approve = ไม่มีข้อบล็อกจาก content_piece_approve_blockers (ฟังก์ชันเดียวกับ RPC อนุมัติ) · expected_host_label = public_label เท่านั้น · '
  'R24: measured อิงโพสต์แรกที่ active ของชิ้น (ig_fb_post 2 โพสต์วัดแค่ใบแรก)';

-- ============================================================================
-- 19. scope ของ backfill (read-only · stable) — แยกเป็นฟังก์ชันเพื่อให้ verify ทดสอบด่าน "seed เปลี่ยน" ได้ (X38)
--     ที่ do-block backfill ใช้ตัดสินใจ raise/ข้าม · ไม่เขียนอะไร
--     candidate = step ที่วัน (anchor + offset) ตั้งแต่ 1 ต.ค. 69 และ piece_status is null (Q4: ก่อนหน้านั้นปล่อย null)
--     ด่าน: artifact ต้อง 1 ตัวพอดีต่อ step · status ต้อง todo/draft_pending_review · จำนวนต้องเท่า p_expected
-- ============================================================================

create or replace function analytics.content_piece_backfill_scope_(p_expected int default 26)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_ids      uuid[];
  v_n        int;
  v_bad_cnt  text;
  v_bad_stat text;
  v_problem  text;
begin
  select array_agg(s.id order by s.id) into v_ids
    from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
   where c.anchor_date + s.offset_start_days >= date '2026-10-01' and s.piece_status is null;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n = 0 then
    return jsonb_build_object('ids', '[]'::jsonb, 'n', 0, 'problem', null);
  end if;

  select string_agg(left(x.id::text, 8) || ' มี artifact ' || x.n, ', ') into v_bad_cnt
    from (select u.id, (select count(*) from analytics.step_artifact a where a.step_id = u.id) as n
            from unnest(v_ids) as u(id)) x
   where x.n <> 1;
  select string_agg(left(a.step_id::text, 8) || ' artifact สถานะ ' || a.status, ', ') into v_bad_stat
    from analytics.step_artifact a
   where a.step_id = any (v_ids) and a.status not in ('todo', 'draft_pending_review');

  v_problem := nullif(concat_ws(' · ',
    case when v_n <> p_expected then format('พบ %s step (คาด %s)', v_n, p_expected) end,
    case when v_bad_cnt is not null then 'step ที่ artifact ไม่ใช่ 1 ตัว: ' || v_bad_cnt end,
    case when v_bad_stat is not null then 'artifact สถานะนอกขอบเขต: ' || v_bad_stat end), '');
  return jsonb_build_object('ids', to_jsonb(v_ids), 'n', v_n, 'problem', to_jsonb(v_problem));
end;
$f$;

-- ============================================================================
-- 20. grant ฟังก์ชันทั้งหมดของไฟล์นี้ — revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--     วนจาก pg_proc ตามรายการชื่อเดียวกับ snapshot/ด่านท้ายไฟล์ ⇒ ฟังก์ชันที่เพิ่ม/ลืม ไม่หลุด grant
--     ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics ปิด REST ของ anon/authenticated ทั้งสคีมา — 0123)
-- ============================================================================

do $c2grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$c2grant$;

revoke all on analytics.v_content_piece from public, anon, authenticated;
grant select on analytics.v_content_piece to service_role;

comment on function analytics.content_piece_advance(uuid, uuid, text, text, text, int) is
  'เปลี่ยนสถานะชิ้นงานตามตารางลำดับ (เดินหน้า/ย้อนทีละขั้น · hold/resume/cancelled/restore) — ด่านอนุมัติ: เจ้าของเท่านั้น + 3 ด่านผ่าน + '
  'ไม่มี [ต้องยืนยัน] ค้าง · actor_role มาจากแอป ไม่ใช่ auth (R14/D2) · errcode 22023 อินพุตผิด/นอก workflow · 42501 ไม่มีสิทธิ์ · 55000 ติดด่าน';

-- ============================================================================
-- 21. backfill step ต.ค. 69 → piece_status (do-block เดียว · design §12.6 · ไม่เดา)
--     trap #19: UPDATE บน campaign_step ยิง trg_campaign_step_updated_at แม้ค่าไม่เปลี่ยน ⇒ ปิดคร่อม (ทรานแซกชันเดียว) พร้อมปิด
--     trg_campaign_step_piece_status_guard (ตัวที่กันเขียน piece_status ตรง) · where id = any(รายการที่ scope คืน) — ไม่ใช้
--     `piece_status is null` (= ทุกแถว) · assert md5(status, updated_at) + count(distinct updated_at) เท่าเดิม
--     ไม่แตะ status (คง todo — projection เริ่มที่ transition แรก ⇒ บอร์ด copilot ไม่เปลี่ยนหน้าตาเพราะ apply)
--     piece_kind: teaser_image (3) / parcel_card (1) → null ไม่เดา · line_audience null ทั้ง 2 แถว line_oa
--       ("LINE 1/4" ชื่อบอกเฉพาะกลุ่มแต่ CHECK ต้องมีเหตุผลจริง ห้ามแต่ง) ⇒ เจ้าของเลือกในหน้า F ·
--       approve ชั้น 4 บล็อกชิ้น LINE ที่ยังไม่เลือกผู้รับ · hypothesis ไม่บังคับตอน approve (D9)
--     ขอบเขต 26 step (13 planned + 13 in_review) · ตัวเลขต่างจากนี้ = raise "seed เปลี่ยน" กลับมาตัดสินใหม่
--     idempotent: รอบสอง candidate = 0 ⇒ ข้ามพร้อม notice (assert ตัวเลขทำเฉพาะรอบที่ UPDATE จริง)
--     dry-run พิมพ์ step_id · ชื่อ · audience_segment · ค่าที่จะได้ ทุกแถวให้ Tech Lead ดูก่อน --commit
-- ============================================================================

do $c2bf$
declare
  v_scope        jsonb;
  v_ids          uuid[];
  v_n            int;
  v_step_before  text;
  v_step_after   text;
  v_art_before   text;
  v_art_after    text;
  v_in_review    int;
  v_planned      int;
  v_conf_steps   int;
  r              record;
begin
  v_scope := analytics.content_piece_backfill_scope_(26);
  if (v_scope ->> 'n')::int = 0 then
    raise notice '0159 backfill: ไม่มีชิ้นงานตั้งแต่ 1 ต.ค. ที่ piece_status ว่าง — ข้าม (รันซ้ำ/ทำไปแล้ว)';
    return;
  end if;
  if v_scope ->> 'problem' is not null then
    raise exception '0159 backfill: % — seed เปลี่ยนหลัง 6 ต.ค. ต้องกลับมาตัดสินใหม่ (ไม่เดา)', v_scope ->> 'problem';
  end if;
  select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_scope -> 'ids') as x;

  for r in
    select s.id, coalesce(s.title, '(ไม่มีชื่อ)') as title, s.audience_segment, s.channel,
           case a.status when 'todo' then 'planned' when 'draft_pending_review' then 'in_review' end as new_piece,
           case a.artifact_type when 'short_form_clip' then 'short_clip' when 'fb_post' then 'ig_fb_post'
                when 'broadcast_script_line' then 'line_message' end as new_kind,
           (a.generated_by = 'ai_copywriter') as new_ai, a.artifact_type
      from analytics.campaign_step s
      join analytics.campaign c on c.id = s.campaign_id
      join analytics.step_artifact a on a.step_id = s.id
     where s.id = any (v_ids)
     order by c.anchor_date + s.offset_start_days, s.id
  loop
    raise notice '0159 backfill [%] % | channel=% | audience_segment=% | artifact=% → piece_status=% piece_kind=% drafted_by_ai=%',
      r.id, left(r.title, 40), coalesce(r.channel, 'null'), coalesce(r.audience_segment, 'null'), r.artifact_type,
      r.new_piece, coalesce(r.new_kind, 'null (ไม่เดา)'), r.new_ai;
  end loop;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_step_before from analytics.campaign_step;
  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
           clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_art_before from analytics.step_artifact;

  alter table analytics.campaign_step disable trigger trg_campaign_step_updated_at;
  alter table analytics.campaign_step disable trigger trg_campaign_step_piece_status_guard;

  update analytics.campaign_step s
     set piece_status = case a.status when 'todo' then 'planned' when 'draft_pending_review' then 'in_review' end,
         drafted_by_ai = (a.generated_by = 'ai_copywriter'),
         piece_kind = case a.artifact_type when 'short_form_clip' then 'short_clip' when 'fb_post' then 'ig_fb_post'
                      when 'broadcast_script_line' then 'line_message' end
    from analytics.step_artifact a
   where a.step_id = s.id and s.id = any (v_ids);
  get diagnostics v_n = row_count;

  alter table analytics.campaign_step enable trigger trg_campaign_step_updated_at;
  alter table analytics.campaign_step enable trigger trg_campaign_step_piece_status_guard;

  if v_n <> cardinality(v_ids) then
    raise exception '0159 backfill: UPDATE ได้ % แถว แต่ scope มี %', v_n, cardinality(v_ids);
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_step_after from analytics.campaign_step;
  if v_step_after is distinct from v_step_before then
    raise exception '0159 backfill: status/updated_at ของ campaign_step ขยับ (trap #19) — ก่อน % / หลัง %', v_step_before, v_step_after;
  end if;

  select count(*) filter (where piece_status = 'in_review' and drafted_by_ai),
         count(*) filter (where piece_status = 'planned' and drafted_by_ai is false)
    into v_in_review, v_planned
    from analytics.campaign_step where id = any (v_ids);
  if v_in_review <> 13 or v_planned <> 13 then
    raise exception '0159 backfill: ได้ in_review+ai % / planned % (คาด 13/13) — seed เปลี่ยน', v_in_review, v_planned;
  end if;

  -- timeline เริ่มต้น: event create 1 แถว/step (ก่อน extract เพื่อให้ลำดับ seq เรียง create → confirm)
  insert into analytics.content_piece_event (shop_id, step_id, event_kind, from_status, to_status, actor_role, payload)
  select s.shop_id, s.id, 'create', null, s.piece_status, 'system',
         jsonb_build_object('backfill', '0159', 'from_artifact_status', a.status)
    from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id
   where s.id = any (v_ids);

  for r in select s.id, s.shop_id from analytics.campaign_step s where s.id = any (v_ids) and s.piece_status = 'in_review' order by s.id loop
    perform analytics.content_confirm_extract_(r.shop_id, r.id, 'system');
  end loop;
  select count(distinct i.step_id)::int into v_conf_steps from analytics.content_confirm_item i where i.step_id = any (v_ids);
  if v_conf_steps <> 11 then
    raise exception '0159 backfill: extract พบ [ต้องยืนยัน] ใน % ชิ้น (คาด 11 — 11/13 ชิ้น AI) — seed เปลี่ยน', v_conf_steps;
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
           clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_art_after from analytics.step_artifact;
  if v_art_after is distinct from v_art_before then
    raise exception '0159 backfill: step_artifact เปลี่ยนระหว่าง backfill/extract (ต้องอ่านอย่างเดียว)';
  end if;

  raise notice '0159 backfill: ตั้ง piece_status แล้ว % step (planned 13 · in_review 13 · drafted_by_ai 13) · extract พบ marker ใน % ชิ้น · '
               'status/updated_at/step_artifact ไม่ขยับ', v_n, v_conf_steps;
end
$c2bf$;

-- ============================================================================
-- 22. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน · แบบ 0158 §16)
-- ============================================================================

do $c2final$
declare
  v_now text;
  v_bad text;
  v_k   text;
  v_n   bigint;
begin
  -- snapshot ต้องอยู่ครบ (set_config ... true หมดอายุพร้อมทรานแซกชัน · GUC ที่หมดอายุกลับเป็น '' ไม่ใช่ null ⇒ เช็คทั้งสองแบบ)
  foreach v_k in array array['c2.snap_live', 'c2.snap_artifact', 'c2.snap_step', 'c2.snap_gate', 'c2.snap_post', 'c2.snap_signal',
                             'c2.snap_hook', 'c2.snap_queue', 'c2.snap_views', 'c2.snap_board_cols', 'c2.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0159 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น (อย่าวางทีละก้อน)', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
           peak_viewers, note, source, host_id, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
    into v_now from analytics.live_session_log;
  if v_now is distinct from current_setting('c2.snap_live', true) then
    raise exception '0159 ด่านท้าย: live_session_log เดิมเปลี่ยน';
  end if;

  -- K2: step_artifact (backfill + extract ไม่แตะ)
  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
           clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_now from analytics.step_artifact;
  if v_now is distinct from current_setting('c2.snap_artifact', true) then
    raise exception '0159 ด่านท้าย: step_artifact เปลี่ยน (status/เนื้อหา/updated_at ต้องไม่ขยับ)';
  end if;

  -- K1: status + updated_at ของ campaign_step ทุกแถว + count(distinct updated_at) (trap #19)
  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c2.snap_step', true) then
    raise exception '0159 ด่านท้าย: campaign_step status/updated_at ขยับ (ก่อน % / หลัง %)', current_setting('c2.snap_step', true), v_now;
  end if;
  -- K1: step ที่ยังไม่อยู่ใน workflow ทุกคอลัมน์ใหม่ต้อง null
  select count(*) into v_n from analytics.campaign_step s
   where s.piece_status is null
     and (s.hold_reason is not null or s.piece_kind is not null or s.time_slot is not null or s.customer_group is not null
          or s.hypothesis is not null or s.metric_code is not null or s.baseline_value is not null or s.baseline_as_of is not null
          or s.baseline_note is not null or s.pass_threshold is not null or s.pass_op is not null or s.baseline_spread is not null
          or s.footage_status is not null or s.footage_url is not null or s.shoot_note is not null or s.shoot_location is not null
          or s.shoot_minutes_est is not null or s.shoot_date is not null or s.expected_host_id is not null
          or s.drafted_by_ai is not null or s.line_audience is not null or s.line_audience_reason is not null);
  if v_n > 0 then
    raise exception '0159 ด่านท้าย: มี % step ที่ piece_status ว่างแต่คอลัมน์ใหม่มีค่า (ต้องเป็น null ทั้งหมด)', v_n;
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, passed_by,
           passed_at, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    into v_now from analytics.step_gate;
  if v_now is distinct from current_setting('c2.snap_gate', true) then
    raise exception '0159 ด่านท้าย: step_gate เดิมเปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c2.snap_post', true) then
    raise exception '0159 ด่านท้าย: content_post เปลี่ยน (id/status/updated_at ต้องไม่ขยับ)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, kind, status, summary, hook_text,
           hook_type, picked_step_id, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_signal;
  if v_now is distinct from current_setting('c2.snap_signal', true) then
    raise exception '0159 ด่านท้าย: content_signal เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, text, hook_type, origin,
           source_signal_id, step_id, label, generated_by, hook_type_raw, legacy_json_id, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_hook;
  if v_now is distinct from current_setting('c2.snap_hook', true) then
    raise exception '0159 ด่านท้าย: content_hook เดิมเปลี่ยน (คอลัมน์เดิมของ 0158 ต้องไม่ขยับ)';
  end if;

  select (select count(*)::text || ':' || md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) from analytics.v_content_post_t7 t) || '/' ||
         (select count(*)::text || ':' || md5(coalesce(string_agg(q::text, E'\n' order by q::text), '')) from analytics.v_content_entry_queue q)
    into v_now;
  if v_now is distinct from current_setting('c2.snap_queue', true) then
    raise exception '0159 ด่านท้าย: v_content_post_t7 / v_content_entry_queue ให้ผลต่างจากก่อน apply (K11)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname <> 'v_content_piece';
  if v_now is distinct from current_setting('c2.snap_views', true) then
    raise exception '0159 ด่านท้าย: definition ของ view เดิมเปลี่ยน (trap #3 — ห้ามแตะ view เดิม · ห้ามต่อคอลัมน์ v_campaign_board)';
  end if;
  select count(*)::text into v_now from information_schema.columns
   where table_schema = 'analytics' and table_name = 'v_campaign_board';
  if v_now is distinct from current_setting('c2.snap_board_cols', true) then
    raise exception '0159 ด่านท้าย: v_campaign_board จำนวนคอลัมน์เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.proname !~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)';
  if v_now is distinct from current_setting('c2.snap_funcs', true) then
    raise exception '0159 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย (รวม 0158 และ content_post_upsert)';
  end if;

  -- K22 / trap #1: ฟังก์ชันของไฟล์นี้ต้องมี signature เดียวต่อชื่อ
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) as n from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
             and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
           group by p.proname having count(*) > 1) x;
  if v_bad is not null then
    raise exception '0159 ด่านท้าย: ฟังก์ชันมี overload ค้าง — หยุดแล้วรายงาน: %', v_bad;
  end if;

  -- trap #18: ฟังก์ชันของไฟล์นี้ต้องไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (coalesce proacl — default = PUBLIC execute)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0159 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บนฟังก์ชัน %', v_bad;
  end if;
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('content_piece_event', 'content_confirm_item', 'v_content_piece')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0159 ด่านท้าย: grant รั่วบนตาราง/view: %', v_bad;
  end if;

  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('content_piece_event', 'content_confirm_item') and not c.relrowsecurity;
  if v_bad is not null then
    raise exception '0159 ด่านท้าย: ตารางไม่ได้เปิด RLS: %', v_bad;
  end if;

  -- trigger ทุกตัวต้องมีและเปิดอยู่ (backfill ปิด 2 ตัวคร่อม UPDATE — ต้องกลับมา enable ครบ)
  select string_agg(t.n, ', ') into v_bad
    from unnest(array['trg_campaign_step_updated_at', 'trg_campaign_step_piece_status_guard', 'trg_campaign_step_piece_guard',
                      'trg_step_artifact_piece_guard', 'trg_step_artifact_piece_stale', 'trg_step_artifact_updated_at',
                      'trg_content_piece_event_append_only', 'trg_content_piece_event_deny_truncate',
                      'trg_content_signal_hook_mirror', 'trg_content_signal_delete_guard']) as t(n)
   where not exists (select 1 from pg_trigger g where g.tgname = t.n and not g.tgisinternal and g.tgenabled = 'O');
  if v_bad is not null then
    raise exception '0159 ด่านท้าย: trigger หาย/ถูกปิด: %', v_bad;
  end if;

  raise notice '0159 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ (step/artifact/gate/post/signal/hook/live/คิวยอด/view/ฟังก์ชันเดิม) · '
               'ไม่มี overload · grant สะอาด · RLS เปิด · trigger ครบและเปิดอยู่';
end
$c2final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/ตาราง/view ใหม่ทันที (แบบเดียวกับ 0150-0158) — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';
