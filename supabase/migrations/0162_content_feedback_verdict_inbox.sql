-- 0162_content_feedback_verdict_inbox.sql  (C3 ส่วนที่สอง — คำตัดสินแคมเปญ + กล่องข้อเสนอ/คำถาม + Weekly Brief ฉบับเต็ม + metric ออเดอร์ระดับแคมเปญ)
--
-- สถานะ: DRAFT ยังไม่ apply — พึ่ง 0161 (ยังไม่ apply เช่นกัน ⇒ dry-run ต้องต่อ 0161 ก่อนเสมอ) · ต้องผ่าน security (AI ตัดสินแทนเจ้าของ = ความเสี่ยงหลัก) + QA scope L ก่อน merge
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §13.0 · §13.4-§13.6 · §13.7 (Y13-Y22 · Y23) · §13.8 (N8 · N10-N13 · N16-N18) · §13.x มติ Q10 + Q12 + metric ออเดอร์
--
-- ทำอะไร:
--   1. ตาราง content_weekly_summary (Weekly Brief ฉบับเต็ม — มติ Q10) + RPC content_weekly_summary_upsert
--   2. campaign: metric + baseline + เกณฑ์ + ขอบเขตนับออเดอร์ + คำตัดสินที่ AI เสนอ / เจ้าของยืนยัน + trigger ด่านตาราง
--      RPC campaign_plan_set · campaign_verdict_propose · campaign_verdict_confirm (owner เท่านั้น · compare-and-set)
--   3. recommendation_log: kind / respond_by / default_action / related_step_id / summary_id / created_by_role / acted_by_role + trigger ด่านตาราง
--      RPC recommendation_create (กันซ้ำ) · recommendation_respond (owner เท่านั้น)
--   4. view ใหม่: v_campaign_summary (หน้า E) · v_recommendation_inbox (inbox: ข้อเสนอ + ด่านความเสี่ยง + แคมเปญรอยืนยัน)
--
-- 🔴 มติเจ้าของ 7 ต.ค. 69 ที่ทับสเปกเดิม (§13.x):
--   Q10 เก็บ Weekly Brief ฉบับเต็ม (markdown) ในแอป ⇒ content_weekly_summary.body_md
--   Q12 ปิดแคมเปญได้ทุกเมื่อ แม้มีชิ้นค้าง ⇒ campaign_verdict_confirm ไม่ปฏิเสธ · บันทึกจำนวนชิ้นค้างตอนปิด (campaign.result_open_pieces + payload open_pieces / open_by_status)
--       และชิ้นค้างไม่นับในผล (v_campaign_summary + ด่าน 4 ชิ้น นับเฉพาะชิ้นที่ posted หรือแคมเปญเก่าที่ไม่มี piece_status) — ตัดด่าน C3-5 ของสเปกเดิมทิ้ง
--   metric ออเดอร์ระดับแคมเปญ: metric_code = 'orders' + ขอบเขต (ช่องทาง · กลุ่มสินค้า · ช่วงวัน) · view นับจาก v_content_order_daily (0161)
--       ⚠️ ไม่ตั้ง metric ให้แคมเปญ 10.10 (75a252d4-…) ใน migration นี้ — Tech Lead ตั้งภายหลังผ่าน campaign_plan_set
--
-- 🔴 ตัดสินใจเองนอกสเปก (เหตุผลอยู่ที่จุดนั้น + สรุปส่งมอบ):
--   A  ขอบเขตนับออเดอร์เป็นคอลัมน์ของ campaign (metric_channel_code · metric_affinity · metric_date_from/to) — ช่วงวันขายของแคมเปญ ≠ ช่วงวันของ step
--      (10.10: ขาย 7-10 ต.ค. แต่ step เดียวอยู่ 7 ต.ค.) ⇒ ไม่ตั้ง = ใช้ช่วง step · ไม่มี step = anchor_date วันเดียว · ตั้งได้เฉพาะเมื่อ metric_code = 'orders' (CHECK + RPC)
--   B  ด่านคำตัดสิน (campaign_verdict_gate_ — helper ตัวเดียวที่ propose + confirm ใช้ร่วม): validated/invalidated บน save_rate/share_rate ต้องมี ≥ 4 ชิ้น (distinct step) ที่มี T+7 ·
--      บน orders ต้องตั้ง pass_threshold + pass_op ก่อน และรู้ช่วงวัน — ไม่บล็อกด้วย "ข้อมูลออเดอร์ยังไม่ถึงวันสุดท้าย" (ออเดอร์ 0 ในวันท้าย = ผลจริงของแคมเปญที่ล้มเหลว
--      ⇒ เดาจาก max(order_date) บล็อกผิด) · แต่ payload/view คืน orders_data_through + orders_data_covers_window ให้หน้าจอเตือน
--   C  campaign_verdict_confirm บังคับ p_expected_proposed ไม่เป็น null (22023) — รับ 'none' หรือ '' = "คาดว่าไม่มีข้อเสนอ" (สเปกใช้ '' · 0161 ใช้ 'none' ⇒ รับทั้งคู่ กัน form ส่งค่าว่าง)
--   D  p_lesson ของ confirm ≤ 300 ตัวอักษร (สเปก 500) — content_signal.summary จำกัด 1-300 · คอลัมน์ campaign.lesson ยัง CHECK ≤ 500 ตามสเปก (แบบเดียวกับ 0161 ข้อ D)
--   E  ไม่ใช่ owner ทับของ owner ไม่ได้: propose โดย ai/system ทับข้อเสนอของ owner = 42501 · weekly_summary_upsert โดย ai/system ทับฉบับที่ owner เป็นคนเขียนล่าสุด = 42501 (ห้ามทับเงียบ)
--   F  content_weekly_summary_upsert คืน jsonb {id, created, changed, revision} แทน uuid (สเปกเขียน uuid) — ให้ผู้เรียกเห็นว่า "สร้างใหม่ / ทับ / ไม่มีอะไรเปลี่ยน" · เพิ่มคอลัมน์ revision + updated_by_role ·
--      ส่งเนื้อหาเดิมซ้ำ = ไม่เขียน (changed=false)
--   G  recommendation_log: partial unique index (shop_id, lower(btrim(title))) where owner_action = 'pending' — กันซ้ำที่ระดับตารางจริง (race ของ create 2 คำสั่ง + MCP insert ตรง) ·
--      ตรวจแล้ว 7 ต.ค.: pending จริงไม่มีชื่อซ้ำ ⇒ สร้าง index ได้ · RPC ตรวจก่อนเพื่อข้อความที่มี id (23505)
--   H  detail/body ไม่ผ่าน content_text_clean (มันยุบ newline ทั้งหมด) — ใช้ btrim + ปฏิเสธอักขระ bidi/ล่องหน (content_bidi_present_) แทน · ZWJ/ZWNJ (U+200C-D) ยอมให้ผ่าน (emoji ต่อกัน) ·
--      ข้อความสั้น (title/hypothesis/lines/note/reason) ผ่าน content_text_clean ตามเดิม
--   I  hypothesis / baseline_note ห้ามมี [ต้องยืนยัน (สเปกกำหนดเฉพาะบทเรียน/คำตอบ) — สมมติฐานที่ยังมีข้อเท็จจริงรอยืนยันไม่ควรบันทึกเป็นแผน
--   J  ฝั่งเขียนตรงของ service_role ถอนสิทธิ์ที่ระดับ GRANT (บทเรียน 0161 H1/M3): recommendation_log (insert/update/delete/truncate) · content_weekly_summary (ทั้งหมดยกเว้น select) ·
--      trigger ด่านตารางเป็นชั้นที่สอง (พิสูจน์ใน verify โดย grant กลับชั่วคราว) · FK ที่วิ่งเข้าประวัติ: ทุกตัว ON DELETE SET NULL (reco → step/summary/campaign) หรือ CASCADE จาก public.shop เท่านั้น
--      (ลบร้านถูกถอดจาก service_role แล้วใน 0161) ⇒ ไม่มีทางลบแถวประวัติ reco/summary ด้วยการลบตารางแม่ · ผลข้างเคียง: แก้คำผิด title/detail ของข้อเสนอ pending ผ่าน service_role ตรงไม่ได้แล้ว
--      (สเปกให้แก้ได้) — ใช้ MCP (postgres) เหมือนเดิม
--   K  campaign.result_open_pieces = จำนวนชิ้นค้างตอนยืนยัน (Q12) — คอลัมน์ ผูก all-or-nothing กับ result_verdict_confirmed_at (CHECK)
--   L  แถว recommendation_log ที่เจ้าของตอบแล้ว: แก้ title/detail/source/kind/shop ไม่ได้ทุก role รวม postgres (สเปก Y20 — เขียนประวัติ "เจ้าของตอบอะไร" ย้อนหลังไม่ได้) ·
--      postgres ยังปิดข้อเสนอเก่าตรง (owner_action/acted_at) และแก้ outcome_note ได้ · RI SET NULL (related_*/summary_id) ผ่าน
--   M  ชื่อ helper bidi = content_bidi_present_ (ไม่ใช่ content_text_*) — verify-0158 A3c นับฟังก์ชันด้วย prefix content_text_ ต้องได้ 9 พอดี
--   N  ด่าน 4 ชิ้นนับ count(distinct step) ที่มี T+7 (KPI def = "ชิ้น" · สเปกเขียน "โพสต์") · ช่วงวัน step ใน v_campaign_summary = min(resolved_start) .. max(coalesce(resolved_end, resolved_start))
--      (สเปกเขียน min/max resolved_start) · ผลต่อโพสต์ในแคมเปญนับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ไม่มี piece_status
--   O  ข้อเสนอ recommendation_respond หมดเวลา = ตอบได้ (สเปก 13.5: คำตอบจริงชนะค่าเริ่มต้น) — "ใช้ค่าเริ่มต้น" = view แสดง expired + default_action ไม่ใช่ RPC ปฏิเสธ/เขียนแทน
--
-- ไม่มีเทสต์ครอบ (บอกตรงๆ — ดูท้าย verify-0162): ถอด `for update` ของ RPC (ต้องใช้ 2 connection) · TRUNCATE เมื่อมีคน grant กลับ (กันที่ชั้น GRANT เท่านั้น) · เวลาคร่อม 00:00-07:00 ไทยจริง
--
-- Grant model (3j-migration-traps #18): ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ครบสามชื่อ (public/anon/authenticated)
-- ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics ปิด REST ของ anon/authenticated ทั้งสคีมา — 0123)
-- 🔴 view ใหม่ "ไม่กรองร้านให้" — security_invoker + service_role ข้าม RLS ⇒ frontend ต้อง .eq('shop_id', shopId) ทุก query
-- 🔴 map error จาก errcode: 22023 = อินพุตผิด · 42501 = ไม่ใช่เจ้าของ/สิทธิ์ · 23505 = ซ้ำ · 55000 = สถานะไม่เอื้อ/ด่านตาราง (ห้าม match ข้อความ)
-- ไฟล์ไม่มี UPDATE/backfill (trap #19) · add column ทุกตัว nullable/มี default คงที่ = ไม่ rewrite · idempotent (รันซ้ำในทรานแซกชันเดียวผ่าน) · LF
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` — ด่านท้ายไฟล์เทียบกับ snapshot ใน GUC ระดับทรานแซกชัน (c5.snap_* — 0160 ใช้ c3.* · 0161 ใช้ c4.*)

-- ============================================================================
-- 0. ด่านต้นไฟล์ (พึ่ง 0161) + snapshot ก่อนแตะอะไร
-- ============================================================================

do $c5pre$
begin
  if to_regclass('analytics.v_content_post_result') is null
     or to_regclass('analytics.v_content_order_daily') is null
     or to_regclass('analytics.v_content_piece') is null
     or to_regprocedure('analytics.content_post_verdict_confirm(uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('analytics.content_piece_try_numeric_(text)') is null
     or to_regprocedure('analytics.content_actor_assert(text,text[],text)') is null
     or to_regprocedure('analytics.crm_require_owner_admin(uuid)') is null
     or to_regprocedure('analytics.content_text_clean(text)') is null
     or to_regprocedure('analytics.content_marker_present(text)') is null
     or to_regprocedure('public.set_updated_at()') is null
     or not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'content_signal_capture')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'content_post' and column_name = 'result_label_override')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'campaign_step' and column_name = 'piece_status') then
    raise exception '0162: ต้อง apply 0161 ก่อน — ไม่พบ v_content_post_result / v_content_order_daily / content_post.result_label_override / content_post_verdict_confirm (dry-run ให้ต่อ 0161 ก่อน 0162 ในไฟล์เดียว)';
  end if;
end
$c5pre$;

do $c5snap$
begin
  perform set_config('c5.snap_metric', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
             is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    from analytics.content_post_metric), true);
  perform set_config('c5.snap_post', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  perform set_config('c5.snap_step', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c5.snap_campaign', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, anchor_date, updated_at),
             E'\n' order by id), ''))
    from analytics.campaign), true);
  perform set_config('c5.snap_reco', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, title, detail, updated_at),
             E'\n' order by id), ''))
    from analytics.recommendation_log), true);
  perform set_config('c5.snap_gate', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    from analytics.step_gate), true);
  perform set_config('c5.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
      and c.relname not in ('v_campaign_summary', 'v_recommendation_inbox')), true);
  perform set_config('c5.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|content_weekly_summary_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$'), true);
end
$c5snap$;

-- ============================================================================
-- 1. ตาราง content_weekly_summary (มติ Q10 — ฉบับเต็ม) — สร้างก่อน recommendation_log เพราะมี FK ชี้มา
--    เขียนผ่าน RPC definer เท่านั้น (guard trigger + ถอนสิทธิ์เขียนจาก service_role) · ไม่มี FK ไป reco (ทิศเดียว reco → summary)
-- ============================================================================

create table if not exists analytics.content_weekly_summary (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shop (id) on delete cascade,
  week_start      date not null,
  brief_date      date not null,
  brief_no        int,
  summary_lines   text[] not null,
  body_md         text not null,
  source_path     text,
  revision        int not null default 1,
  created_by_role text not null,
  created_by      uuid,
  updated_by_role text not null,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint content_weekly_summary_shop_week_key unique (shop_id, week_start),
  constraint content_weekly_summary_week_check
    check (extract(isodow from week_start) = 1 and week_start >= date '2025-01-01' and week_start < date '2100-01-01'),
  constraint content_weekly_summary_brief_date_check
    check (brief_date >= week_start and brief_date <= week_start + 14),
  constraint content_weekly_summary_brief_no_check
    check (brief_no is null or brief_no between 1 and 9999),
  -- ความยาว/ความว่างของแต่ละบรรทัดตรวจใน RPC (CHECK ใส่ subquery/unnest ไม่ได้) · ที่นี่กัน array หลายมิติ + element null ซึ่ง cardinality ไม่จับ
  constraint content_weekly_summary_lines_check
    check (cardinality(summary_lines) between 1 and 5 and array_ndims(summary_lines) = 1 and array_position(summary_lines, null::text) is null),
  constraint content_weekly_summary_body_check
    check (length(body_md) between 1 and 80000 and length(btrim(body_md)) >= 1),
  constraint content_weekly_summary_source_path_check
    check (source_path is null or source_path ~ '^docs/3j-jewelry/marketing/weekly-brief/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$'),
  constraint content_weekly_summary_created_role_check check (created_by_role in ('owner', 'ai', 'system')),
  constraint content_weekly_summary_updated_role_check check (updated_by_role in ('owner', 'ai', 'system')),
  constraint content_weekly_summary_revision_check check (revision >= 1)
);

comment on table analytics.content_weekly_summary is
  'Weekly Brief ฉบับเต็ม (markdown) + สรุป 1-5 บรรทัด — สำเนาที่เผยแพร่ในแอป (มติ Q10) · เอกสารต้นทางยังเป็น md ใน git (source_path) · '
  'เขียนผ่าน content_weekly_summary_upsert เท่านั้น (service_role ไม่มีสิทธิ์เขียนตรง) · revision เพิ่มทุกครั้งที่เนื้อหาเปลี่ยน';

alter table analytics.content_weekly_summary enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_weekly_summary;
create policy tenant_isolation_select on analytics.content_weekly_summary
  for select using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop trigger if exists trg_content_weekly_summary_updated_at on analytics.content_weekly_summary;
create trigger trg_content_weekly_summary_updated_at
  before update on analytics.content_weekly_summary
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. campaign — คอลัมน์ใหม่ (nullable ล้วน · add column ไม่ยิง trigger) + CHECK ชื่อ campaign_<col>_check (drop-if-exists ก่อน add)
--    result_verdict (0101 · not null default not_measured) / result_note คงเดิมเป็น "ค่าที่เจ้าของยืนยัน" — 12 แถวเก่าอ่านว่ายังไม่ได้วัด ถูกต้องอยู่แล้ว
-- ============================================================================

alter table analytics.campaign
  add column if not exists metric_code                       text,
  add column if not exists baseline_value                    numeric,
  add column if not exists baseline_spread                   numeric,
  add column if not exists baseline_as_of                    date,
  add column if not exists baseline_note                     text,
  add column if not exists pass_threshold                    numeric,
  add column if not exists pass_op                           text,
  add column if not exists metric_channel_code               text,
  add column if not exists metric_affinity                   text,
  add column if not exists metric_date_from                  date,
  add column if not exists metric_date_to                    date,
  add column if not exists result_verdict_proposed           text,
  add column if not exists result_proposed_note              text,
  add column if not exists result_proposed_at                timestamptz,
  add column if not exists result_proposed_by_role           text,
  add column if not exists result_verdict_confirmed_at       timestamptz,
  add column if not exists result_verdict_confirmed_by_role  text,
  add column if not exists lesson                            text,
  add column if not exists result_open_pieces                int;

-- ชุด metric_code เดียวกับ campaign_step (0161) — ใช้ 'orders' ได้ทั้งสองระดับ
alter table analytics.campaign drop constraint if exists campaign_metric_code_check;
alter table analytics.campaign add constraint campaign_metric_code_check
  check (metric_code is null or metric_code in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none'));

-- ตัวเลข: (x >= a and x <= b) — NaN ตกทั้งสองข้าง (Postgres ถือ NaN มากกว่าทุกค่า) · trap #4
alter table analytics.campaign drop constraint if exists campaign_baseline_value_check;
alter table analytics.campaign add constraint campaign_baseline_value_check
  check (baseline_value is null or (baseline_value >= -1000000000000 and baseline_value <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_pass_threshold_check;
alter table analytics.campaign add constraint campaign_pass_threshold_check
  check (pass_threshold is null or (pass_threshold >= -1000000000000 and pass_threshold <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_baseline_spread_check;
alter table analytics.campaign add constraint campaign_baseline_spread_check
  check (baseline_spread is null or (baseline_spread >= 0 and baseline_spread <= 1000000000000));
alter table analytics.campaign drop constraint if exists campaign_baseline_as_of_check;
alter table analytics.campaign add constraint campaign_baseline_as_of_check
  check (baseline_as_of is null or (baseline_as_of >= date '2020-01-01' and baseline_as_of < date '2100-01-01'));
alter table analytics.campaign drop constraint if exists campaign_baseline_note_check;
alter table analytics.campaign add constraint campaign_baseline_note_check
  check (baseline_note is null or length(baseline_note) <= 500);
alter table analytics.campaign drop constraint if exists campaign_pass_op_check;
alter table analytics.campaign add constraint campaign_pass_op_check
  check (pass_op is null or pass_op in ('>=', '<='));
-- เกณฑ์ต้องมาเป็นคู่ (ค่า + ทิศทาง) — ไม่งั้น "ผ่านหรือไม่" อ่านไม่ได้
alter table analytics.campaign drop constraint if exists campaign_pass_pair_check;
alter table analytics.campaign add constraint campaign_pass_pair_check
  check ((pass_threshold is null) = (pass_op is null));

-- ขอบเขตนับออเดอร์ (ตัดสินใจ A)
alter table analytics.campaign drop constraint if exists campaign_metric_channel_code_check;
alter table analytics.campaign add constraint campaign_metric_channel_code_check
  check (metric_channel_code is null or length(metric_channel_code) between 1 and 40);
alter table analytics.campaign drop constraint if exists campaign_metric_affinity_check;
alter table analytics.campaign add constraint campaign_metric_affinity_check
  check (metric_affinity is null or metric_affinity in ('all', 'bar', 'jewelry'));
-- ช่วงวันเป็นคู่ · to >= from · ไม่เกิน 366 วัน · ตัด infinity ด้วยขอบบน/ล่าง
alter table analytics.campaign drop constraint if exists campaign_metric_dates_check;
alter table analytics.campaign add constraint campaign_metric_dates_check
  check ((metric_date_from is null) = (metric_date_to is null)
         and (metric_date_from is null
              or (metric_date_from >= date '2020-01-01' and metric_date_to <= date '2100-01-01'
                  and metric_date_to >= metric_date_from and metric_date_to - metric_date_from <= 366)));
-- ขอบเขตตั้งได้เฉพาะ metric 'orders' — coalesce กัน metric_code null ทำให้ (null or false) = null แล้ว CHECK ผ่านเงียบ (trap #13)
alter table analytics.campaign drop constraint if exists campaign_metric_scope_needs_orders_check;
alter table analytics.campaign add constraint campaign_metric_scope_needs_orders_check
  check (coalesce(metric_code = 'orders', false)
         or (metric_channel_code is null and metric_affinity is null and metric_date_from is null and metric_date_to is null));

-- คำตัดสิน: ที่ AI/ผู้ช่วยเสนอ (proposed — ยังไม่ใช่คำตัดสิน) แยกจากที่เจ้าของยืนยัน (confirmed)
alter table analytics.campaign drop constraint if exists campaign_result_proposed_check;
alter table analytics.campaign add constraint campaign_result_proposed_check
  check (result_verdict_proposed is null or result_verdict_proposed in ('validated', 'invalidated', 'inconclusive', 'not_measured'));
alter table analytics.campaign drop constraint if exists campaign_result_proposed_note_check;
alter table analytics.campaign add constraint campaign_result_proposed_note_check
  check (result_proposed_note is null or length(result_proposed_note) between 3 and 1000);
alter table analytics.campaign drop constraint if exists campaign_result_proposed_role_check;
alter table analytics.campaign add constraint campaign_result_proposed_role_check
  check (result_proposed_by_role is null or result_proposed_by_role in ('owner', 'ai', 'system'));
alter table analytics.campaign drop constraint if exists campaign_result_proposed_consistency_check;
alter table analytics.campaign add constraint campaign_result_proposed_consistency_check
  check ((result_verdict_proposed is null) = (result_proposed_at is null)
         and (result_proposed_at is null) = (result_proposed_by_role is null)
         and (result_verdict_proposed is null) = (result_proposed_note is null));
alter table analytics.campaign drop constraint if exists campaign_result_confirmed_role_check;
alter table analytics.campaign add constraint campaign_result_confirmed_role_check
  check (result_verdict_confirmed_by_role is null or result_verdict_confirmed_by_role = 'owner');
-- ยืนยัน = เวลา + role + จำนวนชิ้นค้างตอนปิด (Q12) ครบชุดหรือไม่มีเลย
alter table analytics.campaign drop constraint if exists campaign_result_confirmed_consistency_check;
alter table analytics.campaign add constraint campaign_result_confirmed_consistency_check
  check ((result_verdict_confirmed_at is null) = (result_verdict_confirmed_by_role is null)
         and (result_verdict_confirmed_at is null) = (result_open_pieces is null));
alter table analytics.campaign drop constraint if exists campaign_result_open_pieces_check;
alter table analytics.campaign add constraint campaign_result_open_pieces_check
  check (result_open_pieces is null or result_open_pieces between 0 and 10000);
alter table analytics.campaign drop constraint if exists campaign_lesson_check;
alter table analytics.campaign add constraint campaign_lesson_check
  check (lesson is null or length(lesson) <= 500);

comment on column analytics.campaign.metric_code is 'ตัวชี้วัดหลักของแคมเปญ (ชุดเดียวกับ campaign_step.metric_code รวม orders) — ตั้งผ่าน campaign_plan_set';
comment on column analytics.campaign.metric_channel_code is 'เฉพาะ metric orders: dim_channel.code ที่นับ (null = ทุกช่องทาง) — ตรวจกับ dim_channel ใน campaign_plan_set';
comment on column analytics.campaign.metric_affinity is 'เฉพาะ metric orders: all/bar/jewelry ตาม v_content_order_daily.affinity (null = all)';
comment on column analytics.campaign.metric_date_from is 'เฉพาะ metric orders: ช่วงวันขายของแคมเปญ (ตามคู่ metric_date_to) · null = ใช้ช่วงวันของ step · ไม่มี step = anchor_date วันเดียว';
comment on column analytics.campaign.result_verdict_proposed is 'คำตัดสินที่ AI/ผู้ช่วยเสนอ — ยังไม่ใช่คำตัดสิน · ยืนยันโดยเจ้าของผ่าน campaign_verdict_confirm เท่านั้น (result_verdict คือค่าที่ยืนยัน)';
comment on column analytics.campaign.result_open_pieces is 'จำนวนชิ้นงานที่ค้าง (ไม่ใช่ posted/cancelled) ตอนเจ้าของยืนยันคำตัดสิน (มติ Q12 ปิดได้ทุกเมื่อ) — ชิ้นค้างไม่นับในผล';

-- ============================================================================
-- 3. recommendation_log — คอลัมน์ใหม่ (ไม่แตะ v_recommendation_acceptance · ไม่แตะ CHECK source เดิม 3 ค่า)
--    12 แถวเก่า = kind 'proposal' (ถูก: ทั้งหมดเป็นข้อเสนอ R1-R12) · created_by_role / acted_by_role เก่า = null (ไม่รู้ ไม่เดา)
--    คอลัมน์เดิมที่ใช้ต่อ: outcome_note = คำตอบ (Δ7) · acted_by = auth.uid() (null จนกว่า A2)
-- ============================================================================

alter table analytics.recommendation_log
  add column if not exists kind            text not null default 'proposal',
  add column if not exists respond_by      date,
  add column if not exists default_action  text,
  add column if not exists related_step_id uuid,
  add column if not exists summary_id      uuid,
  add column if not exists created_by_role text,
  add column if not exists acted_by_role   text;

alter table analytics.recommendation_log drop constraint if exists recommendation_log_kind_check;
alter table analytics.recommendation_log add constraint recommendation_log_kind_check
  check (kind in ('proposal', 'question'));   -- ไม่มี risk_gate: ด่านความเสี่ยงอ่านจาก step_gate ตรงใน v_recommendation_inbox (C3-2)
alter table analytics.recommendation_log drop constraint if exists recommendation_log_respond_by_check;
alter table analytics.recommendation_log add constraint recommendation_log_respond_by_check
  check (respond_by is null or (respond_by >= date '2020-01-01' and respond_by < date '2100-01-01'));
alter table analytics.recommendation_log drop constraint if exists recommendation_log_default_action_check;
alter table analytics.recommendation_log add constraint recommendation_log_default_action_check
  check (default_action is null or length(btrim(default_action)) between 1 and 500);
-- มีเส้นตายต้องประกาศค่าเริ่มต้น (หมดเวลาแล้วถือว่าทำอะไร) — brief §3.4
alter table analytics.recommendation_log drop constraint if exists recommendation_log_deadline_needs_default_check;
alter table analytics.recommendation_log add constraint recommendation_log_deadline_needs_default_check
  check (respond_by is null or default_action is not null);
alter table analytics.recommendation_log drop constraint if exists recommendation_log_created_role_check;
alter table analytics.recommendation_log add constraint recommendation_log_created_role_check
  check (created_by_role is null or created_by_role in ('owner', 'ai', 'system'));
alter table analytics.recommendation_log drop constraint if exists recommendation_log_acted_role_check;
alter table analytics.recommendation_log add constraint recommendation_log_acted_role_check
  check (acted_by_role is null or acted_by_role = 'owner');

-- FK ที่ชี้เข้าประวัติ: SET NULL ทั้งคู่ (ลบ step/summary ไม่พาข้อเสนอที่เจ้าของเคยตอบหาย) · ไม่มี CASCADE ใดนอกจาก public.shop (ถอนสิทธิ์ลบร้านจาก service_role แล้วใน 0161)
alter table analytics.recommendation_log drop constraint if exists recommendation_log_related_step_id_fkey;
alter table analytics.recommendation_log add constraint recommendation_log_related_step_id_fkey
  foreign key (related_step_id) references analytics.campaign_step (id) on delete set null;
alter table analytics.recommendation_log drop constraint if exists recommendation_log_summary_id_fkey;
alter table analytics.recommendation_log add constraint recommendation_log_summary_id_fkey
  foreign key (summary_id) references analytics.content_weekly_summary (id) on delete set null;

create index if not exists idx_recommendation_log_step on analytics.recommendation_log (related_step_id) where related_step_id is not null;
create index if not exists idx_recommendation_log_summary on analytics.recommendation_log (summary_id) where summary_id is not null;
-- ตัดสินใจ G: กันข้อเสนอซ้ำที่ยังรอตอบ ระดับตาราง (เทียบชื่อแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย)
create unique index if not exists uq_recommendation_log_pending_title
  on analytics.recommendation_log (shop_id, lower(btrim(title))) where owner_action = 'pending';

comment on column analytics.recommendation_log.kind is
  'proposal = ข้อเสนอให้ทำ · question = คำถามให้เจ้าของตัดสิน (ด่านความเสี่ยง/คำตัดสินแคมเปญอ่านจาก step_gate/campaign ใน v_recommendation_inbox ไม่ใช่แถวนี้)';
comment on column analytics.recommendation_log.respond_by is
  'เส้นตายตอบ (วันไทย) · null = ใช้กติกา 14 วันของ 0101 · หมดเวลา = effective_action expired ใน v_recommendation_inbox (ไม่ mutate แถว) · เจ้าของตอบช้าได้ (is_late)';
comment on column analytics.recommendation_log.default_action is
  'สิ่งที่ถือเป็นค่าเริ่มต้นเมื่อหมดเวลาโดยเจ้าของไม่ตอบ — บังคับเมื่อมี respond_by · ระบบไม่ทำอะไรเองจากค่านี้ แค่แสดงให้เจ้าของเห็น';

-- ============================================================================
-- 4. helper + trigger ด่านตาราง
--    ด่านระดับตารางของ C3 ใช้ current_user อย่างเดียว ไม่มี GUC (D18): ฟังก์ชัน definer ใดๆ ผ่าน · service_role/authenticated/anon เขียนตรงไม่ผ่าน
--    ชั้นแรกคือ GRANT (§8 ถอนสิทธิ์เขียนจาก service_role) — trigger คือชั้นที่สองเมื่อมีคน grant กลับ
-- ============================================================================

-- อักขระควบคุมทิศทาง/ล่องหนที่ใช้ปลอมข้อความ (trojan-source) — ปฏิเสธ ไม่แก้เงียบ · ไม่รวม U+200C/200D (ZWNJ/ZWJ ใช้ต่อ emoji) — ตัดสินใจ H
create or replace function analytics.content_bidi_present_(p_text text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $f$
  select coalesce(p_text, '') ~ '[\u200B\u200E\u200F\u061C\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'
$f$;

-- trigger: content_weekly_summary — เขียนผ่าน content_weekly_summary_upsert เท่านั้น
create or replace function analytics.content_weekly_summary_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    raise exception 'สรุปสัปดาห์เขียนผ่าน content_weekly_summary_upsert เท่านั้น' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_content_weekly_summary_guard on analytics.content_weekly_summary;
create trigger trg_content_weekly_summary_guard
  before insert or update or delete on analytics.content_weekly_summary
  for each row execute function analytics.content_weekly_summary_guard();

-- trigger: campaign — สมมติฐาน/metric/เกณฑ์/คำตัดสิน เขียนผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น
-- ปล่อย status / anchor / blocked_reason / note ฯลฯ (บอร์ดเดิม) · INSERT ตรง: ตั้งคอลัมน์เหล่านี้ไม่ได้ (กันปลอม "เจ้าของยืนยันแล้ว" ด้วย INSERT — แบบ 0161 ข้อ C)
-- ตรวจแล้ว 7 ต.ค.: โค้ดแอป (lib/ app/ components/ scripts/ packages/) ไม่มีที่ไหนเขียน hypothesis/result_* ของ campaign — RPC เดิมที่เขียน (0057/0060/0159) เป็น definer
create or replace function analytics.campaign_result_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.result_verdict is distinct from 'not_measured'
         or num_nonnulls(new.result_note, new.hypothesis, new.metric_code, new.baseline_value, new.baseline_spread, new.baseline_as_of,
                         new.baseline_note, new.pass_threshold, new.pass_op, new.metric_channel_code, new.metric_affinity,
                         new.metric_date_from, new.metric_date_to, new.result_verdict_proposed, new.result_proposed_note,
                         new.result_proposed_at, new.result_proposed_by_role, new.result_verdict_confirmed_at,
                         new.result_verdict_confirmed_by_role, new.lesson, new.result_open_pieces) > 0 then
        raise exception 'ตั้งสมมติฐาน/เกณฑ์/คำตัดสินแคมเปญผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น' using errcode = '55000';
      end if;
    elsif (new.result_verdict, new.result_note, new.hypothesis, new.metric_code, new.baseline_value, new.baseline_spread, new.baseline_as_of,
           new.baseline_note, new.pass_threshold, new.pass_op, new.metric_channel_code, new.metric_affinity, new.metric_date_from,
           new.metric_date_to, new.result_verdict_proposed, new.result_proposed_note, new.result_proposed_at, new.result_proposed_by_role,
           new.result_verdict_confirmed_at, new.result_verdict_confirmed_by_role, new.lesson, new.result_open_pieces)
          is distinct from
          (old.result_verdict, old.result_note, old.hypothesis, old.metric_code, old.baseline_value, old.baseline_spread, old.baseline_as_of,
           old.baseline_note, old.pass_threshold, old.pass_op, old.metric_channel_code, old.metric_affinity, old.metric_date_from,
           old.metric_date_to, old.result_verdict_proposed, old.result_proposed_note, old.result_proposed_at, old.result_proposed_by_role,
           old.result_verdict_confirmed_at, old.result_verdict_confirmed_by_role, old.lesson, old.result_open_pieces) then
      raise exception 'แก้สมมติฐาน/เกณฑ์/คำตัดสินแคมเปญผ่าน campaign_plan_set / campaign_verdict_propose / campaign_verdict_confirm เท่านั้น' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_campaign_result_guard on analytics.campaign;
create trigger trg_campaign_result_guard
  before insert or update on analytics.campaign
  for each row execute function analytics.campaign_result_guard();

-- trigger: recommendation_log — INSERT/DELETE ตรงจาก 3 role = ห้าม (0101: แถว rejected/expired ห้ามหายก่อนวัน 90) · UPDATE ที่เปลี่ยนอะไรก็ตาม (นอกจาก updated_at) = ห้าม
-- ตอบผ่าน recommendation_respond · สร้างผ่าน recommendation_create · postgres (MCP ของ Tech Lead) + ฟังก์ชัน definer + RI (SET NULL ตอนลบ step/summary/campaign) ผ่านทุกข้อ — D18
create or replace function analytics.recommendation_log_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    if tg_op = 'INSERT' then
      raise exception 'สร้างข้อเสนอผ่าน recommendation_create เท่านั้น' using errcode = '55000';
    elsif tg_op = 'DELETE' then
      raise exception 'ลบข้อเสนอไม่ได้ (ประวัติการตัดสินของเจ้าของ — 0101: เก็บอย่างน้อย 90 วัน)' using errcode = '55000';
    elsif (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'ตอบข้อเสนอผ่าน recommendation_respond เท่านั้น (แก้เนื้อหาข้อเสนอทำผ่านเจ้าของตาราง)' using errcode = '55000';
    end if;
  end if;
  -- ทุก role (รวม postgres): ข้อเสนอที่เจ้าของตอบแล้ว แก้เนื้อหาไม่ได้ — เขียนประวัติ "เจ้าของตอบอะไร" ใหม่ย้อนหลังไม่ได้ (สเปก Y20) · RI SET NULL แตะแค่คอลัมน์ related_*/summary_id จึงไม่ติด
  if tg_op = 'UPDATE' and old.owner_action <> 'pending'
     and (new.title, new.detail, new.source, new.kind, new.shop_id) is distinct from (old.title, old.detail, old.source, old.kind, old.shop_id) then
    raise exception 'ข้อเสนอที่ตอบแล้วแก้เนื้อหาไม่ได้ (ประวัติการตัดสินของเจ้าของ)' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_recommendation_log_guard on analytics.recommendation_log;
create trigger trg_recommendation_log_guard
  before insert or update or delete on analytics.recommendation_log
  for each row execute function analytics.recommendation_log_guard();

-- ============================================================================
-- 5. helper ภายใน (ไม่ใช่ API ของหน้าจอ) — ด่านคำตัดสิน + นับชิ้นค้าง
--    ฟังก์ชันใหม่ทั้งหมด (ไม่ replace ของ 0148/0158/0159/0160/0161) — ด่านท้ายไฟล์เทียบ md5 ของฟังก์ชันเดิมทุกตัว
-- ============================================================================

-- ชิ้นที่ค้าง = มี piece_status และยังไม่ posted/cancelled · แคมเปญเก่า (piece_status null) ไม่นับ · `not in` บนค่าที่ไม่ null จึงปลอดภัย
create or replace function analytics.campaign_open_pieces_(p_campaign_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select jsonb_build_object('open', coalesce(sum(x.n), 0)::int, 'by_status', coalesce(jsonb_object_agg(x.piece_status, x.n), '{}'::jsonb))
    from (select s.piece_status, count(*)::int as n
            from analytics.campaign_step s
           where s.campaign_id = p_campaign_id and s.piece_status is not null and s.piece_status not in ('posted', 'cancelled')
           group by s.piece_status) x
$f$;

-- ด่านเนื้อหาของคำตัดสิน (ตัดสินใจ B) — null = ผ่าน · ข้อความ = เหตุผลที่ตก (ผู้เรียก raise 55000) · ใช้ร่วมกันทั้ง propose และ confirm (owner ก็ฟันธงจากข้อมูลน้อยไม่ได้)
--   ด่านใช้เฉพาะ validated/invalidated — inconclusive/not_measured เสนอ/ยืนยันได้เสมอ (ยอมรับว่ายังตัดสินไม่ได้)
--   save_rate/share_rate: ≥ 4 ชิ้น (distinct step) ที่มี T+7 · นับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ไม่มี piece_status (Q12: ชิ้นค้าง/ยกเลิกไม่นับในผล)
--   orders: ต้องตั้ง pass_threshold + pass_op และรู้ช่วงวัน (v_campaign_summary.orders_window_*) · metric อื่น/null (peak_viewers · line_reply_count · none · แคมเปญเก่า) = วัดนอกตารางนี้ ไม่เดา ไม่ติดด่าน
create or replace function analytics.campaign_verdict_gate_(p_campaign_id uuid, p_verdict text)
 returns text
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_min_pieces constant int := 4;
  v_c   analytics.campaign%rowtype;
  v_n   int;
  v_win record;
begin
  if p_campaign_id is null or p_verdict is null or p_verdict not in ('validated', 'invalidated') then
    return null;
  end if;
  select * into v_c from analytics.campaign where id = p_campaign_id;
  if not found then
    return null;   -- ผู้เรียกล็อก/ตรวจแถวเองก่อนแล้ว
  end if;

  if v_c.metric_code in ('save_rate', 'share_rate') then
    select count(distinct r.step_id) into v_n
      from analytics.v_content_post_result r
      join analytics.campaign_step s on s.id = r.step_id
     where s.campaign_id = p_campaign_id and r.t7_captured_on is not null
       and (s.piece_status is null or s.piece_status = 'posted');
    if v_n < c_min_pieces then
      return format('ยังไม่ครบ %s ชิ้นที่มีผล T+7 (มี %s) — ฟันธง validated/invalidated ไม่ได้ เสนอได้แค่ inconclusive/not_measured', c_min_pieces, v_n);
    end if;
  elsif v_c.metric_code = 'orders' then
    if v_c.pass_threshold is null or v_c.pass_op is null then
      return 'metric orders ยังไม่ได้ตั้งเกณฑ์ผ่าน (pass_threshold + pass_op) — ตั้งผ่าน campaign_plan_set ก่อนฟันธง validated/invalidated';
    end if;
    select s.orders_window_from, s.orders_window_to into v_win from analytics.v_campaign_summary s where s.campaign_id = p_campaign_id;
    if v_win.orders_window_from is null or v_win.orders_window_to is null then
      return 'metric orders ยังไม่รู้ช่วงวันของแคมเปญ (ไม่มี metric_date_from/to · ไม่มี step · ไม่มี anchor_date) — ตั้งผ่าน campaign_plan_set ก่อน';
    end if;
  end if;
  return null;
end;
$f$;

-- ============================================================================
-- 6. campaign RPC — สมมติฐาน/เกณฑ์ (หน้า E) · เสนอคำตัดสิน (AI ได้) · ยืนยันคำตัดสิน (เจ้าของเท่านั้น)
-- ============================================================================

-- campaign_plan_set — สมมติฐาน + metric + ฐาน + เกณฑ์ + ขอบเขตนับออเดอร์ · json null = ล้าง (trap #13 ใช้ jsonb_typeof) · ค่าที่ไม่ส่ง key = คงเดิม
-- owner: ทุกสถานะที่ยังไม่ปิด · ai/system: เฉพาะแคมเปญที่ยังไม่มีชิ้น posted และไม่มีโพสต์ active (AI เสนอสมมติฐานก่อนเริ่ม — ไม่ย้ายเสาเกณฑ์หลังผลออก)
-- ปิดแล้ว (เจ้าของยืนยันคำตัดสิน) = แก้ไม่ได้ทุก actor · ไม่มีประวัติ diff ระดับแคมเปญ (หนี้ D20 — updated_at พอรอบแรก)
create or replace function analytics.campaign_plan_set(
  p_shop_id     uuid,
  p_campaign_id uuid,
  p_set         jsonb,
  p_actor_role  text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_keys    constant text[]  := array['hypothesis', 'metric_code', 'baseline_value', 'baseline_as_of', 'baseline_note', 'pass_threshold', 'pass_op',
                                      'baseline_spread', 'metric_channel_code', 'metric_affinity', 'metric_date_from', 'metric_date_to'];
  c_max_val constant numeric := 1000000000000;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_c       analytics.campaign%rowtype;
  v_k       text;
  v_v       jsonb;
  v_t       text;
  v_txt     text;
  v_bad     text;
  v_d       date;
  v_num     numeric;
  v_lo      numeric;
  v_maxlen  int;
  v_hyp     text;
  v_mcode   text;
  v_bval    numeric;
  v_bas     date;
  v_bnote   text;
  v_thr     numeric;
  v_op      text;
  v_spread  numeric;
  v_chan    text;
  v_aff     text;
  v_df      date;
  v_dt      date;
  v_changed jsonb := '{}'::jsonb;
begin
  if p_shop_id is null or p_campaign_id is null or p_set is null then
    raise exception 'campaign_plan_set: ต้องระบุร้าน แคมเปญ และค่าที่แก้' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'campaign_plan_set');

  if jsonb_typeof(p_set) is distinct from 'object' or p_set = '{}'::jsonb then
    raise exception 'campaign_plan_set: ต้องส่ง object ที่มี key อย่างน้อย 1 (รับ: %)', array_to_string(c_keys, ', ') using errcode = '22023';
  end if;
  select string_agg(k.key, ', ' order by k.key) into v_bad from jsonb_object_keys(p_set) as k(key) where not (k.key = any (c_keys));
  if v_bad is not null then
    raise exception 'campaign_plan_set: key ไม่รู้จัก: % (รับเฉพาะ %)', v_bad, array_to_string(c_keys, ', ') using errcode = '22023';
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_plan_set: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  if v_c.result_verdict_confirmed_at is not null then
    raise exception 'campaign_plan_set: แคมเปญนี้ปิดแล้ว (เจ้าของยืนยันคำตัดสิน %) — แก้แผนไม่ได้', v_c.result_verdict using errcode = '55000';
  end if;
  if p_actor_role <> 'owner' and (
       exists (select 1 from analytics.campaign_step s where s.campaign_id = p_campaign_id and s.piece_status = 'posted')
       or exists (select 1 from analytics.content_post p join analytics.campaign_step s on s.id = p.step_id
                   where s.campaign_id = p_campaign_id and p.status = 'active')) then
    raise exception 'campaign_plan_set: แคมเปญนี้มีชิ้นที่โพสต์แล้ว — AI/ระบบย้ายเสาสมมติฐาน/เกณฑ์หลังผลออกไม่ได้ (เจ้าของเท่านั้น)' using errcode = '42501';
  end if;

  v_hyp := v_c.hypothesis; v_mcode := v_c.metric_code; v_bval := v_c.baseline_value; v_bas := v_c.baseline_as_of; v_bnote := v_c.baseline_note;
  v_thr := v_c.pass_threshold; v_op := v_c.pass_op; v_spread := v_c.baseline_spread; v_chan := v_c.metric_channel_code;
  v_aff := v_c.metric_affinity; v_df := v_c.metric_date_from; v_dt := v_c.metric_date_to;

  -- 🔴 ห้าม `p_set->>'x' is null` แยก SQL NULL กับ JSON null ไม่ได้ (trap #13) ⇒ jsonb_typeof · 'null' = ตั้งใจล้าง
  for v_k, v_v in select e.key, e.value from jsonb_each(p_set) as e loop
    v_t := jsonb_typeof(v_v);
    v_txt := v_v #>> '{}';
    if v_k in ('hypothesis', 'baseline_note') then
      if v_t = 'null' then
        v_txt := null;
      elsif v_t = 'string' then
        v_txt := analytics.content_text_clean(v_txt);
        -- ห้ามเขียน CASE ใน IF โดยตรง: plpgsql ตัดนิพจน์ที่ THEN ตัวแรก ⇒ THEN ของ CASE ทำให้ syntax error (42601)
        v_maxlen := 500;
        if v_k = 'hypothesis' then
          v_maxlen := 1000;
        end if;
        if v_txt = '' or length(v_txt) > v_maxlen then
          raise exception 'campaign_plan_set: % ต้องยาว 1-% ตัวอักษร', v_k, v_maxlen using errcode = '22023';
        end if;
        if analytics.content_marker_present(v_txt) then
          raise exception 'campaign_plan_set: % มี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึกเป็นแผน', v_k using errcode = '22023';
        end if;
      else
        raise exception 'campaign_plan_set: % ต้องเป็นข้อความ (หรือ null เพื่อล้าง)', v_k using errcode = '22023';
      end if;
      if v_k = 'hypothesis' then v_hyp := v_txt; else v_bnote := v_txt; end if;

    elsif v_k in ('baseline_value', 'pass_threshold', 'baseline_spread') then
      if v_t = 'null' then
        v_num := null;
      elsif v_t = 'number' then
        v_num := v_txt::numeric;
        v_lo := -c_max_val;
        if v_k = 'baseline_spread' then
          v_lo := 0;
        end if;
        -- not(between): NaN/Infinity ตกให้เอง (trap #4) — jsonb number ไม่มี NaN อยู่แล้ว แต่คงด่านไว้
        if not (v_num >= v_lo and v_num <= c_max_val) then
          raise exception 'campaign_plan_set: % ต้องอยู่ในช่วง % ถึง % (ได้รับ %)', v_k, v_lo, c_max_val, v_txt using errcode = '22023';
        end if;
      else
        raise exception 'campaign_plan_set: % ต้องส่งเป็น number (หรือ null เพื่อล้าง) ไม่ใช่ข้อความ/ค่าจริงเท็จ', v_k using errcode = '22023';
      end if;
      if v_k = 'baseline_value' then v_bval := v_num; elsif v_k = 'pass_threshold' then v_thr := v_num; else v_spread := v_num; end if;

    elsif v_k in ('baseline_as_of', 'metric_date_from', 'metric_date_to') then
      if v_t = 'null' then
        v_d := null;
      else
        if v_t <> 'string' or v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'campaign_plan_set: % ต้องเป็นวันที่รูปแบบ YYYY-MM-DD (หรือ null เพื่อล้าง)', v_k using errcode = '22023';
        end if;
        begin
          v_d := v_txt::date;
        exception when others then
          v_d := null;
        end;
        if v_d is null then
          raise exception 'campaign_plan_set: % ไม่ใช่วันที่ที่มีจริง (%)', v_k, v_txt using errcode = '22023';
        end if;
        if v_k = 'baseline_as_of' and (v_d > v_today or v_d < date '2020-01-01') then
          raise exception 'campaign_plan_set: baseline_as_of ต้องไม่เป็นวันในอนาคต (ไทย) และไม่ก่อน 2020-01-01 (ได้รับ %)', v_txt using errcode = '22023';
        end if;
        if v_k <> 'baseline_as_of' and (v_d < date '2020-01-01' or v_d > v_today + 366) then
          raise exception 'campaign_plan_set: % ต้องอยู่ระหว่าง 2020-01-01 ถึงวันไทย+366 (ได้รับ %)', v_k, v_txt using errcode = '22023';
        end if;
      end if;
      if v_k = 'baseline_as_of' then v_bas := v_d; elsif v_k = 'metric_date_from' then v_df := v_d; else v_dt := v_d; end if;

    elsif v_k = 'metric_code' then
      if v_t = 'null' then
        v_mcode := null;
      elsif v_t = 'string' and v_txt in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none') then
        v_mcode := v_txt;
      else
        raise exception 'campaign_plan_set: metric_code ต้องเป็น save_rate / share_rate / peak_viewers / line_reply_count / orders / none (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'pass_op' then
      if v_t = 'null' then
        v_op := null;
      elsif v_t = 'string' and v_txt in ('>=', '<=') then
        v_op := v_txt;
      else
        raise exception 'campaign_plan_set: pass_op ต้องเป็น >= หรือ <= (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'metric_affinity' then
      if v_t = 'null' then
        v_aff := null;
      elsif v_t = 'string' and v_txt in ('all', 'bar', 'jewelry') then
        v_aff := v_txt;
      else
        raise exception 'campaign_plan_set: metric_affinity ต้องเป็น all / bar / jewelry (หรือ null เพื่อล้าง)' using errcode = '22023';
      end if;

    elsif v_k = 'metric_channel_code' then
      if v_t = 'null' then
        v_chan := null;
      elsif v_t = 'string' and exists (select 1 from analytics.dim_channel dc where dc.code = v_txt) then
        v_chan := v_txt;
      else
        select string_agg(dc.code, ' / ' order by dc.code) into v_bad from analytics.dim_channel dc;
        raise exception 'campaign_plan_set: metric_channel_code ต้องเป็นรหัสช่องทางที่มีจริง (% — หรือ null = ทุกช่องทาง)', coalesce(v_bad, '-') using errcode = '22023';
      end if;
    end if;
  end loop;

  -- ด่านสถานะสุดท้าย (หลังรวมค่าเดิมกับค่าใหม่) — ตกที่นี่เป็น 22023 พร้อมข้อความ ไม่ปล่อยให้ไปตก CHECK (23514)
  if (v_thr is null) <> (v_op is null) then
    raise exception 'campaign_plan_set: เกณฑ์ต้องมาเป็นคู่ — pass_threshold กับ pass_op ต้องมีทั้งคู่หรือล้างทั้งคู่' using errcode = '22023';
  end if;
  if v_mcode is distinct from 'orders' and num_nonnulls(v_chan, v_aff, v_df, v_dt) > 0 then
    raise exception 'campaign_plan_set: ช่องทาง/กลุ่มสินค้า/ช่วงวันที่นับ ใช้ได้เฉพาะ metric_code = orders (ถ้าเปลี่ยน metric ให้ล้างค่าเหล่านั้นในคำสั่งเดียวกัน)' using errcode = '22023';
  end if;
  if (v_df is null) <> (v_dt is null) then
    raise exception 'campaign_plan_set: metric_date_from กับ metric_date_to ต้องมาเป็นคู่' using errcode = '22023';
  end if;
  if v_df is not null and (v_dt < v_df or v_dt - v_df > 366) then
    raise exception 'campaign_plan_set: ช่วงวัน metric ต้อง to >= from และไม่เกิน 366 วัน (ได้รับ % ถึง %)', v_df, v_dt using errcode = '22023';
  end if;

  if v_hyp is distinct from v_c.hypothesis then
    v_changed := v_changed || jsonb_build_object('hypothesis', jsonb_build_object('from', v_c.hypothesis, 'to', v_hyp));
  end if;
  if v_mcode is distinct from v_c.metric_code then
    v_changed := v_changed || jsonb_build_object('metric_code', jsonb_build_object('from', v_c.metric_code, 'to', v_mcode));
  end if;
  if v_bval is distinct from v_c.baseline_value then
    v_changed := v_changed || jsonb_build_object('baseline_value', jsonb_build_object('from', v_c.baseline_value, 'to', v_bval));
  end if;
  if v_bas is distinct from v_c.baseline_as_of then
    v_changed := v_changed || jsonb_build_object('baseline_as_of', jsonb_build_object('from', v_c.baseline_as_of, 'to', v_bas));
  end if;
  if v_bnote is distinct from v_c.baseline_note then
    v_changed := v_changed || jsonb_build_object('baseline_note', jsonb_build_object('from', v_c.baseline_note, 'to', v_bnote));
  end if;
  if v_thr is distinct from v_c.pass_threshold then
    v_changed := v_changed || jsonb_build_object('pass_threshold', jsonb_build_object('from', v_c.pass_threshold, 'to', v_thr));
  end if;
  if v_op is distinct from v_c.pass_op then
    v_changed := v_changed || jsonb_build_object('pass_op', jsonb_build_object('from', v_c.pass_op, 'to', v_op));
  end if;
  if v_spread is distinct from v_c.baseline_spread then
    v_changed := v_changed || jsonb_build_object('baseline_spread', jsonb_build_object('from', v_c.baseline_spread, 'to', v_spread));
  end if;
  if v_chan is distinct from v_c.metric_channel_code then
    v_changed := v_changed || jsonb_build_object('metric_channel_code', jsonb_build_object('from', v_c.metric_channel_code, 'to', v_chan));
  end if;
  if v_aff is distinct from v_c.metric_affinity then
    v_changed := v_changed || jsonb_build_object('metric_affinity', jsonb_build_object('from', v_c.metric_affinity, 'to', v_aff));
  end if;
  if v_df is distinct from v_c.metric_date_from then
    v_changed := v_changed || jsonb_build_object('metric_date_from', jsonb_build_object('from', v_c.metric_date_from, 'to', v_df));
  end if;
  if v_dt is distinct from v_c.metric_date_to then
    v_changed := v_changed || jsonb_build_object('metric_date_to', jsonb_build_object('from', v_c.metric_date_to, 'to', v_dt));
  end if;
  if v_changed = '{}'::jsonb then
    raise exception 'campaign_plan_set: ไม่มีค่าเปลี่ยน — ไม่เขียน' using errcode = '22023';
  end if;

  update analytics.campaign
     set hypothesis = v_hyp, metric_code = v_mcode, baseline_value = v_bval, baseline_as_of = v_bas, baseline_note = v_bnote,
         pass_threshold = v_thr, pass_op = v_op, baseline_spread = v_spread, metric_channel_code = v_chan, metric_affinity = v_aff,
         metric_date_from = v_df, metric_date_to = v_dt, updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  return jsonb_build_object('campaign_id', p_campaign_id, 'changed', v_changed);
end;
$f$;

-- campaign_verdict_propose — เสนอคำตัดสิน (AI เป็นผู้เสนอหลัก) · ยังไม่ใช่คำตัดสิน: ไม่แตะ result_verdict/status · เสนอซ้ำได้ (previous_proposed คืนค่าเก่า — ไม่ทับเงียบ)
-- ไม่สร้างแถว recommendation_log — v_recommendation_inbox ดึงแคมเปญที่เสนอแล้วแต่ยังไม่ยืนยันให้เอง (C3-2)
create or replace function analytics.campaign_verdict_propose(
  p_shop_id     uuid,
  p_campaign_id uuid,
  p_verdict     text,
  p_note        text,
  p_actor_role  text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_note text;
  v_c    analytics.campaign%rowtype;
  v_gate text;
begin
  if p_shop_id is null or p_campaign_id is null or p_verdict is null or p_note is null then
    raise exception 'campaign_verdict_propose: ต้องระบุร้าน แคมเปญ คำตัดสิน และหลักฐาน/เหตุผล' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'campaign_verdict_propose');

  if p_verdict not in ('validated', 'invalidated', 'inconclusive', 'not_measured') then
    raise exception 'campaign_verdict_propose: คำตัดสินต้องเป็น validated / invalidated / inconclusive / not_measured' using errcode = '22023';
  end if;
  -- ข้อเสนอเปล่าไม่รับ: ต้องมีหลักฐาน/เหตุผล 3-1000 ตัวอักษร (หลัง clean) และไม่มี [ต้องยืนยัน
  v_note := analytics.content_text_clean(p_note);
  if length(v_note) < 3 or length(v_note) > 1000 then
    raise exception 'campaign_verdict_propose: ต้องระบุหลักฐาน/เหตุผล 3-1000 ตัวอักษร (ได้รับ % หลัง clean)', length(v_note) using errcode = '22023';
  end if;
  if analytics.content_marker_present(v_note) then
    raise exception 'campaign_verdict_propose: หลักฐานมี [ต้องยืนยัน — ตอบให้ครบก่อนเสนอคำตัดสิน' using errcode = '22023';
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_verdict_propose: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  if v_c.result_verdict_confirmed_at is not null then
    raise exception 'campaign_verdict_propose: เจ้าของยืนยันแล้ว (%) — แก้ผ่าน campaign_verdict_confirm เท่านั้น', v_c.result_verdict using errcode = '55000';
  end if;
  -- ตัดสินใจ E: ข้อเสนอที่เจ้าของเป็นคนเสนอเอง AI/ระบบทับเงียบๆ ไม่ได้
  if p_actor_role <> 'owner' and v_c.result_proposed_by_role = 'owner' then
    raise exception 'campaign_verdict_propose: ข้อเสนอปัจจุบันเป็นของเจ้าของ — AI/ระบบทับไม่ได้' using errcode = '42501';
  end if;
  v_gate := analytics.campaign_verdict_gate_(p_campaign_id, p_verdict);
  if v_gate is not null then
    raise exception 'campaign_verdict_propose: %', v_gate using errcode = '55000';
  end if;

  update analytics.campaign
     set result_verdict_proposed = p_verdict, result_proposed_note = v_note, result_proposed_at = now(), result_proposed_by_role = p_actor_role,
         updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  return jsonb_build_object('campaign_id', p_campaign_id, 'proposed', p_verdict, 'previous_proposed', v_c.result_verdict_proposed,
                            'previous_proposed_by_role', v_c.result_proposed_by_role, 'awaiting_owner', true,
                            'open_pieces', (analytics.campaign_open_pieces_(p_campaign_id) ->> 'open')::int);
end;
$f$;

-- campaign_verdict_confirm — เจ้าของยืนยันคำตัดสิน (owner เท่านั้น · AI ห้ามยืนยันแทน) · compare-and-set กับข้อเสนอที่เจ้าของเห็น (บังคับ ห้าม null)
-- Q12: ปิดได้ทุกเมื่อ แม้มีชิ้นค้าง — ไม่ปฏิเสธ · บันทึกจำนวนชิ้นค้างลง campaign.result_open_pieces + คืนใน payload · ชิ้นค้างไม่นับในผล (ด่านเนื้อหานับเฉพาะ posted)
-- ยืนยันซ้ำ/เปลี่ยนใจได้ (ทับ — previous_* คืนค่าเก่า) · proposed_* ไม่ล้าง (ประวัติว่า AI เสนออะไร) · status → done เฉพาะเมื่อยังไม่ done
create or replace function analytics.campaign_verdict_confirm(
  p_shop_id           uuid,
  p_campaign_id       uuid,
  p_verdict           text,
  p_lesson            text,
  p_actor_role        text,
  p_note              text default null,
  p_expected_proposed text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_lesson_max constant int := 300;   -- ตัดสินใจ D: = เพดาน content_signal.summary (สเปก 500 · ส่งต่อสัญญาณไม่ได้ถ้ายาวกว่านี้)
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_lesson     text;
  v_note       text;
  v_c          analytics.campaign%rowtype;
  v_gate       text;
  v_open       jsonb;
  v_open_n     int;
  v_signal     uuid;
  v_created    boolean := false;
  v_orders     jsonb;
  v_expected   text;
begin
  if p_shop_id is null or p_campaign_id is null or p_verdict is null then
    raise exception 'campaign_verdict_confirm: ต้องระบุร้าน แคมเปญ และคำตัดสิน' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'campaign_verdict_confirm');

  if p_verdict not in ('validated', 'invalidated', 'inconclusive', 'not_measured') then
    raise exception 'campaign_verdict_confirm: คำตัดสินต้องเป็น validated / invalidated / inconclusive / not_measured' using errcode = '22023';
  end if;
  -- compare-and-set ห้ามข้ามด้วย null (ตัดสินใจ C) · 'none' หรือ '' = เจ้าของเห็นว่าไม่มีข้อเสนอ
  -- (parameter ยังมี default null เพื่อให้ signature ตรงสเปก — null ตกที่นี่เป็น 22023 ไม่ใช่ 42883)
  if p_expected_proposed is null or p_expected_proposed not in ('validated', 'invalidated', 'inconclusive', 'not_measured', 'none', '') then
    raise exception 'campaign_verdict_confirm: p_expected_proposed ต้องเป็นคำตัดสินที่เจ้าของเห็นบนจอ (validated/invalidated/inconclusive/not_measured) หรือ none (ไม่มีข้อเสนอ) — ห้าม null' using errcode = '22023';
  end if;

  -- null / ว่าง = ไม่มี · ข้อความที่ AI เขียนได้ผ่าน content_text_clean (บทเรียน C1) · marker = 22023
  v_lesson := nullif(analytics.content_text_clean(p_lesson), '');
  if v_lesson is not null then
    if length(v_lesson) > c_lesson_max then
      raise exception 'campaign_verdict_confirm: บทเรียนยาวเกิน % ตัวอักษร (ได้รับ %)', c_lesson_max, length(v_lesson) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_lesson) then
      raise exception 'campaign_verdict_confirm: บทเรียนมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
  end if;
  v_note := nullif(analytics.content_text_clean(p_note), '');
  if v_note is not null then
    if length(v_note) > 1000 then
      raise exception 'campaign_verdict_confirm: หมายเหตุยาวเกิน 1000 ตัวอักษร (ได้รับ %)', length(v_note) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_note) then
      raise exception 'campaign_verdict_confirm: หมายเหตุมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
  end if;

  select * into v_c from analytics.campaign where id = p_campaign_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'campaign_verdict_confirm: ไม่พบแคมเปญในร้านนี้' using errcode = '22023';
  end if;
  -- (ไม่เขียน CASE ใน IF โดยตรง — THEN ของ CASE ทำให้ plpgsql ตัดนิพจน์ผิดที่)
  v_expected := coalesce(nullif(p_expected_proposed, ''), 'none');
  if coalesce(v_c.result_verdict_proposed, 'none') <> v_expected then
    raise exception 'campaign_verdict_confirm: ข้อเสนอเปลี่ยนไปแล้ว (ตอนนี้ %) — รีเฟรชก่อนยืนยัน', coalesce(v_c.result_verdict_proposed, 'ไม่มีข้อเสนอ') using errcode = '55000';
  end if;
  v_gate := analytics.campaign_verdict_gate_(p_campaign_id, p_verdict);
  if v_gate is not null then
    raise exception 'campaign_verdict_confirm: %', v_gate using errcode = '55000';
  end if;

  -- Q12: ไม่ปฏิเสธเมื่อมีชิ้นค้าง — นับแล้วบันทึกไว้
  v_open := analytics.campaign_open_pieces_(p_campaign_id);
  v_open_n := (v_open ->> 'open')::int;

  update analytics.campaign
     set result_verdict = p_verdict,
         result_note = coalesce(v_note, result_note),
         result_verdict_confirmed_at = now(),
         result_verdict_confirmed_by_role = 'owner',
         lesson = v_lesson,
         result_open_pieces = v_open_n,
         status = case when status <> 'done' then 'done' else status end,
         updated_by = coalesce(auth.uid(), updated_by)
   where id = p_campaign_id;

  -- บทเรียน → สัญญาณ insight (ไม่สร้างซ้ำถ้ามีข้อความเดียวกันของแคมเปญนี้แล้ว)
  if v_lesson is not null then
    select s.id into v_signal
      from analytics.content_signal s
     where s.shop_id = p_shop_id and s.kind = 'insight' and s.origin_campaign_id = p_campaign_id and s.summary = v_lesson
     limit 1;
    if v_signal is null then
      v_signal := analytics.content_signal_capture(
        p_shop_id => p_shop_id, p_kind => 'insight', p_summary => v_lesson, p_source => 'owner', p_seen_on => v_today,
        p_origin_campaign_id => p_campaign_id, p_confidence => 'observation', p_actor_role => 'owner');
      v_created := true;
    end if;
  end if;

  if v_c.metric_code = 'orders' then
    select jsonb_build_object('actual', s.orders_actual, 'window_from', s.orders_window_from, 'window_to', s.orders_window_to,
                              'data_through', s.orders_data_through, 'data_covers_window', s.orders_data_covers_window,
                              'threshold_met', s.orders_threshold_met)
      into v_orders from analytics.v_campaign_summary s where s.campaign_id = p_campaign_id;
  end if;

  return jsonb_build_object('campaign_id', p_campaign_id, 'verdict', p_verdict, 'proposed_was', v_c.result_verdict_proposed,
                            'previous_verdict', case when v_c.result_verdict_confirmed_at is not null then v_c.result_verdict end,
                            'previous_lesson', v_c.lesson, 'status', 'done', 'signal_id', v_signal, 'signal_created', v_created,
                            'open_pieces', v_open_n, 'open_by_status', v_open -> 'by_status', 'excluded_from_result', v_open_n,
                            'orders', v_orders);
end;
$f$;

-- ============================================================================
-- 7. recommendation RPC — สร้างข้อเสนอ/คำถาม (กันซ้ำ) · เจ้าของตอบ (compare-and-set ในตัว)
--    หมดเวลา = view แสดง expired + default_action (ไม่ mutate แถว · หลัก 0101) · เจ้าของตอบช้าได้ — คำตอบจริงชนะค่าเริ่มต้น (is_late)
-- ============================================================================

create or replace function analytics.recommendation_create(
  p_shop_id             uuid,
  p_title               text,
  p_detail              text,
  p_actor_role          text,
  p_kind                text default 'proposal',
  p_source              text default 'agent',
  p_effort_minutes_est  int  default null,
  p_respond_by          date default null,
  p_default_action      text default null,
  p_related_campaign_id uuid default null,
  p_related_step_id     uuid default null,
  p_summary_id          uuid default null
) returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_title  text;
  v_detail text;
  v_def    text;
  v_dup    uuid;
  v_step   analytics.campaign_step%rowtype;
  v_id     uuid;
begin
  if p_shop_id is null or p_title is null or p_detail is null then
    raise exception 'recommendation_create: ต้องระบุร้าน หัวข้อ และรายละเอียด' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'recommendation_create');

  -- `p_x not in (...)` กับ null ได้ null แล้วข้ามด่านเงียบ ⇒ ตรวจ is null แยกเสมอ
  if p_kind is null or p_kind not in ('proposal', 'question') then
    raise exception 'recommendation_create: kind ต้องเป็น proposal หรือ question (ด่านความเสี่ยง/คำตัดสินแคมเปญเป็นของ step_gate/campaign — ไม่สร้างเป็นแถวที่นี่)' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('weekly_brief', 'agent', 'adhoc') then
    raise exception 'recommendation_create: source ต้องเป็น weekly_brief / agent / adhoc' using errcode = '22023';
  end if;
  v_title := analytics.content_text_clean(p_title);
  if length(v_title) < 1 or length(v_title) > 200 then
    raise exception 'recommendation_create: หัวข้อต้องยาว 1-200 ตัวอักษร (หลัง clean ได้ %)', length(v_title) using errcode = '22023';
  end if;
  if analytics.content_marker_present(v_title) then
    raise exception 'recommendation_create: หัวข้อมี [ต้องยืนยัน' using errcode = '22023';
  end if;
  -- รายละเอียดอาจหลายบรรทัด (content_text_clean ยุบ newline ทั้งหมด) ⇒ ไม่แก้ข้อความ ปฏิเสธอักขระ bidi/ล่องหนแทน (ตัดสินใจ H) · marker อนุญาต —
  -- คำถามถึงเจ้าของอาจอ้าง [ต้องยืนยัน] ของชิ้นงาน
  if analytics.content_bidi_present_(p_detail) then
    raise exception 'recommendation_create: รายละเอียดมีอักขระควบคุมทิศทาง/ล่องหน (bidi · ZWSP · BOM) — ลบออกก่อน' using errcode = '22023';
  end if;
  v_detail := btrim(replace(p_detail, E'\r', ''));
  if length(v_detail) < 1 or length(v_detail) > 4000 then
    raise exception 'recommendation_create: รายละเอียดต้องยาว 1-4000 ตัวอักษร (ได้ %)', length(v_detail) using errcode = '22023';
  end if;
  if p_effort_minutes_est is not null and (p_effort_minutes_est < 1 or p_effort_minutes_est > 480) then
    raise exception 'recommendation_create: effort_minutes_est ต้องเป็น 1-480 หรือ null' using errcode = '22023';
  end if;

  if p_respond_by is not null then
    if not isfinite(p_respond_by) or p_respond_by < v_today or p_respond_by > v_today + 90 then
      raise exception 'recommendation_create: respond_by ต้องเป็นวันไทยตั้งแต่วันนี้ถึง +90 วัน (ได้รับ %)', p_respond_by using errcode = '22023';
    end if;
    v_def := analytics.content_text_clean(p_default_action);
    if length(v_def) < 1 or length(v_def) > 500 then
      raise exception 'recommendation_create: มีเส้นตายต้องบอกค่าเริ่มต้น (default_action 1-500 ตัวอักษร) — หมดเวลาแล้วถือว่าทำอะไร' using errcode = '22023';
    end if;
  elsif p_default_action is not null then
    raise exception 'recommendation_create: ส่ง default_action โดยไม่มี respond_by ไม่ได้ (ค่าเริ่มต้นไม่มีความหมายถ้าไม่มีเส้นตาย)' using errcode = '22023';
  end if;

  if p_related_campaign_id is not null
     and not exists (select 1 from analytics.campaign c where c.id = p_related_campaign_id and c.shop_id = p_shop_id) then
    raise exception 'recommendation_create: ไม่พบแคมเปญที่อ้างถึงในร้านนี้' using errcode = '22023';
  end if;
  if p_related_step_id is not null then
    select * into v_step from analytics.campaign_step s where s.id = p_related_step_id and s.shop_id = p_shop_id;
    if not found then
      raise exception 'recommendation_create: ไม่พบชิ้นงานที่อ้างถึงในร้านนี้' using errcode = '22023';
    end if;
    if v_step.piece_status is null then
      raise exception 'recommendation_create: ข้อเสนอผูกได้เฉพาะชิ้นงานใน workflow ใหม่ (piece_status ว่าง = ขั้นของแคมเปญเก่า)' using errcode = '22023';
    end if;
    if p_related_campaign_id is not null and v_step.campaign_id <> p_related_campaign_id then
      raise exception 'recommendation_create: ชิ้นงานที่อ้างถึงไม่อยู่ในแคมเปญที่อ้างถึง' using errcode = '22023';
    end if;
  end if;
  if p_summary_id is not null
     and not exists (select 1 from analytics.content_weekly_summary w where w.id = p_summary_id and w.shop_id = p_shop_id) then
    raise exception 'recommendation_create: ไม่พบสรุปสัปดาห์ที่อ้างถึงในร้านนี้' using errcode = '22023';
  end if;

  -- กันซ้ำ: Brief รันซ้ำ / Tech Lead เรียกสองรอบ ไม่ได้แถวคู่ (index uq_recommendation_log_pending_title กันซ้ำอีกชั้นเมื่อสองคำสั่งแข่งกัน)
  select r.id into v_dup from analytics.recommendation_log r
   where r.shop_id = p_shop_id and lower(btrim(r.title)) = lower(v_title) and r.owner_action = 'pending'
   limit 1;
  if v_dup is not null then
    raise exception 'recommendation_create: ข้อเสนอชื่อนี้ยังรอตอบอยู่ (id %) — ตอบ/ปิดอันเดิมก่อน หรือใช้ชื่อใหม่ถ้ายกระดับข้อเสนอ', v_dup using errcode = '23505';
  end if;

  insert into analytics.recommendation_log
    (shop_id, source, title, detail, effort_minutes_est, related_campaign_id, kind, respond_by, default_action,
     related_step_id, summary_id, created_by_role, created_by)
  values
    (p_shop_id, p_source, v_title, v_detail, p_effort_minutes_est, p_related_campaign_id, p_kind, p_respond_by, v_def,
     p_related_step_id, p_summary_id, p_actor_role, auth.uid())
  returning id into v_id;
  return v_id;
end;
$f$;

-- recommendation_respond — เจ้าของตอบ (owner เท่านั้น · AI ตอบแทนไม่ได้) · done / rejected เท่านั้น (expired = view คำนวณ ไม่เขียน)
-- compare-and-set ในตัว: แถวที่ไม่ใช่ pending ตอบซ้ำไม่ได้ (55000) · เขียน owner_action+acted_at+acted_by+acted_by_role+outcome_note ในคำสั่งเดียว
create or replace function analytics.recommendation_respond(
  p_shop_id    uuid,
  p_id         uuid,
  p_action     text,
  p_response   text,
  p_actor_role text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_resp    text;
  v_r       analytics.recommendation_log%rowtype;
  v_late    boolean;
  v_expired boolean;
  v_at      timestamptz := now();
begin
  if p_shop_id is null or p_id is null or p_action is null then
    raise exception 'recommendation_respond: ต้องระบุร้าน ข้อเสนอ และคำตอบ (done/rejected)' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'recommendation_respond');

  if p_action not in ('done', 'rejected') then
    raise exception 'recommendation_respond: คำตอบต้องเป็น done หรือ rejected (expired = ระบบคำนวณใน view ไม่ใช่คำตอบ · pending ไม่ใช่คำตอบ)' using errcode = '22023';
  end if;
  v_resp := nullif(analytics.content_text_clean(p_response), '');
  if v_resp is not null then
    if length(v_resp) > 1000 then
      raise exception 'recommendation_respond: คำตอบยาวเกิน 1000 ตัวอักษร (ได้ %)', length(v_resp) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_resp) then
      raise exception 'recommendation_respond: คำตอบมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
  end if;
  if p_action = 'rejected' and (v_resp is null or length(v_resp) < 3) then
    raise exception 'recommendation_respond: ปฏิเสธต้องระบุเหตุผล 3-1000 ตัวอักษร' using errcode = '22023';
  end if;

  select * into v_r from analytics.recommendation_log where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'recommendation_respond: ไม่พบข้อเสนอในร้านนี้' using errcode = '22023';
  end if;
  if v_r.owner_action <> 'pending' then
    raise exception 'recommendation_respond: ตอบแล้ว (% เมื่อ %)', v_r.owner_action, v_r.acted_at using errcode = '55000';
  end if;

  v_late := v_r.respond_by is not null and v_today > v_r.respond_by;
  v_expired := v_late or (v_r.respond_by is null and v_at - v_r.created_at > interval '14 days');

  update analytics.recommendation_log
     set owner_action = p_action, acted_at = v_at, acted_by = auth.uid(), acted_by_role = 'owner', outcome_note = v_resp
   where id = p_id;

  return jsonb_build_object('id', p_id, 'owner_action', p_action, 'acted_at', v_at, 'late', v_late, 'was_expired', v_expired,
                            'default_action_was', v_r.default_action);
end;
$f$;

-- ============================================================================
-- 8. content_weekly_summary_upsert — Weekly Brief ฉบับเต็ม (มติ Q10) · ทับได้เมื่อ Brief แก้แล้วส่งใหม่ (ประวัติอยู่ใน git ของ md) แต่ "ไม่ทับเงียบ":
--    คืน created/changed/revision · ส่งเนื้อหาเดิมซ้ำ = ไม่เขียน · ai/system ทับฉบับที่ owner เขียนล่าสุดไม่ได้ (ตัดสินใจ E/F)
-- ============================================================================

create or replace function analytics.content_weekly_summary_upsert(
  p_shop_id       uuid,
  p_week_start    date,
  p_brief_date    date,
  p_summary_lines text[],
  p_body_md       text,
  p_actor_role    text,
  p_brief_no      int  default null,
  p_source_path   text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_lines text[] := '{}';
  v_line  text;
  v_body  text;
  v_old   analytics.content_weekly_summary%rowtype;
  v_id    uuid;
begin
  if p_shop_id is null or p_week_start is null or p_brief_date is null or p_summary_lines is null or p_body_md is null then
    raise exception 'content_weekly_summary_upsert: ต้องระบุร้าน สัปดาห์ วันที่ Brief สรุป และเนื้อหา' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner', 'ai', 'system'], 'content_weekly_summary_upsert');

  if not isfinite(p_week_start) or not isfinite(p_brief_date) then
    raise exception 'content_weekly_summary_upsert: วันที่ต้องเป็นวันจริง (ไม่รับ infinity)' using errcode = '22023';
  end if;
  if extract(isodow from p_week_start) <> 1 or p_week_start < date '2025-01-01' or p_week_start > v_today then
    raise exception 'content_weekly_summary_upsert: week_start ต้องเป็นวันจันทร์ ตั้งแต่ 2025-01-01 ถึงวันนี้ (ไทย) (ได้รับ %)', p_week_start using errcode = '22023';
  end if;
  if p_brief_date < p_week_start or p_brief_date > p_week_start + 14 or p_brief_date > v_today then
    raise exception 'content_weekly_summary_upsert: brief_date ต้องอยู่ใน week_start..week_start+14 และไม่เป็นวันในอนาคต (ได้รับ %)', p_brief_date using errcode = '22023';
  end if;
  if p_brief_no is not null and (p_brief_no < 1 or p_brief_no > 9999) then
    raise exception 'content_weekly_summary_upsert: brief_no ต้องเป็น 1-9999 หรือ null' using errcode = '22023';
  end if;
  if p_source_path is not null and p_source_path !~ '^docs/3j-jewelry/marketing/weekly-brief/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$' then
    raise exception 'content_weekly_summary_upsert: source_path ต้องเป็น docs/3j-jewelry/marketing/weekly-brief/YYYY-MM-DD.md หรือ null' using errcode = '22023';
  end if;

  -- array_ndims ของ '{}' เป็น null ⇒ is distinct from 1 จับทั้งว่างและหลายมิติ
  if array_ndims(p_summary_lines) is distinct from 1 or cardinality(p_summary_lines) not between 1 and 5 then
    raise exception 'content_weekly_summary_upsert: สรุปต้องเป็น array มิติเดียว 1-5 บรรทัด' using errcode = '22023';
  end if;
  foreach v_line in array p_summary_lines loop
    v_line := analytics.content_text_clean(v_line);   -- element null → '' → ตกด่านความยาวด้านล่าง (ไม่ปล่อยบรรทัดว่าง)
    if length(v_line) < 1 or length(v_line) > 300 then
      raise exception 'content_weekly_summary_upsert: แต่ละบรรทัดสรุปต้องยาว 1-300 ตัวอักษรหลัง clean (ไม่ว่าง/ZWSP ล้วน)' using errcode = '22023';
    end if;
    v_lines := v_lines || v_line;
  end loop;

  -- markdown ต้องคง whitespace/newline ⇒ ไม่ clean · ปฏิเสธ bidi/ล่องหนแทน (ไม่แก้เงียบ) · CRLF → LF (ไฟล์ md บน Windows)
  if analytics.content_bidi_present_(p_body_md) then
    raise exception 'content_weekly_summary_upsert: เนื้อหามีอักขระควบคุมทิศทาง/ล่องหน (bidi · ZWSP · BOM) — ลบออกก่อน' using errcode = '22023';
  end if;
  v_body := replace(replace(p_body_md, E'\r\n', E'\n'), E'\r', E'\n');
  if length(btrim(v_body)) < 1 or length(v_body) > 80000 then
    raise exception 'content_weekly_summary_upsert: เนื้อหาต้องยาว 1-80000 ตัวอักษร ไม่ว่างเปล่า (ได้ %)', length(v_body) using errcode = '22023';
  end if;

  select * into v_old from analytics.content_weekly_summary w where w.shop_id = p_shop_id and w.week_start = p_week_start for update;
  if found then
    if p_actor_role <> 'owner' and v_old.updated_by_role = 'owner' then
      raise exception 'content_weekly_summary_upsert: ฉบับนี้เจ้าของเป็นคนเขียนล่าสุด — AI/ระบบทับไม่ได้' using errcode = '42501';
    end if;
    if v_old.brief_date = p_brief_date and v_old.brief_no is not distinct from p_brief_no and v_old.summary_lines = v_lines
       and v_old.body_md = v_body and v_old.source_path is not distinct from p_source_path then
      return jsonb_build_object('id', v_old.id, 'created', false, 'changed', false, 'revision', v_old.revision);
    end if;
    update analytics.content_weekly_summary
       set brief_date = p_brief_date, brief_no = p_brief_no, summary_lines = v_lines, body_md = v_body, source_path = p_source_path,
           revision = revision + 1, updated_by_role = p_actor_role, updated_by = coalesce(auth.uid(), updated_by)
     where id = v_old.id
     returning id into v_id;
    return jsonb_build_object('id', v_id, 'created', false, 'changed', true, 'revision', v_old.revision + 1, 'previous_revision', v_old.revision);
  end if;

  insert into analytics.content_weekly_summary
    (shop_id, week_start, brief_date, brief_no, summary_lines, body_md, source_path, created_by_role, created_by, updated_by_role, updated_by)
  values
    (p_shop_id, p_week_start, p_brief_date, p_brief_no, v_lines, v_body, p_source_path, p_actor_role, auth.uid(), p_actor_role, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true, 'changed', true, 'revision', 1);
end;
$f$;

-- ============================================================================
-- 9. view — ใหม่ทั้งหมด · security_invoker · ไม่ replace view เดิม (0149/0159/0160/0161 คงเดิม · trap #3) · ไม่กรองร้าน (frontend .eq('shop_id'))
--    วัน "วันนี้" = (now() at time zone 'Asia/Bangkok')::date · ไม่ซ้อนบน v_content_piece (D15) · perf: D19 (ซ้อนบน v_content_post_result — วันนี้ 10 โพสต์)
-- ============================================================================

-- หน้า E รายการ+รายละเอียดแคมเปญ — 1 แถว/campaign ทุกแถว (รวมแคมเปญเก่า 12 แถวที่ pieces_total = 0)
-- ชิ้นค้าง/ยกเลิกไม่นับในผล (Q12): ผลโพสต์นับเฉพาะชิ้น posted หรือแคมเปญเก่าที่ piece_status ว่าง
-- orders_*: เฉพาะ metric_code = orders · ช่วงวัน = metric_date_from/to > ช่วงวันของ step (min start .. max end) > anchor_date วันเดียว · ไม่มีข้อมูลพอ = null (ไม่เดา)
--   orders_data_through = วันล่าสุดที่มีออเดอร์ของร้าน/ช่องทางนั้น (ออเดอร์เข้าจากไฟล์ import รายเดือน — ยอดวันท้ายอาจยังไม่เข้า) · orders_data_covers_window = through >= วันสุดท้ายของช่วง
--   orders_threshold_met = ผลเทียบเกณฑ์ (>= / <=) เป็นคำใบ้ให้หน้าจอ ไม่ใช่คำตัดสิน
create or replace view analytics.v_campaign_summary
  with (security_invoker = true) as
select
  c.id as campaign_id, c.shop_id, c.name, c.campaign_type, c.trigger_kind, c.status, c.anchor_date, c.primary_channels,
  c.hypothesis, c.metric_code, c.baseline_value, c.baseline_as_of, c.baseline_note, c.pass_threshold, c.pass_op, c.baseline_spread,
  c.metric_channel_code, c.metric_affinity, c.metric_date_from, c.metric_date_to,
  c.result_verdict, c.result_note, c.result_verdict_proposed, c.result_proposed_note, c.result_proposed_at, c.result_proposed_by_role,
  c.result_verdict_confirmed_at, c.lesson, c.result_open_pieces, c.created_at, c.updated_at,
  (c.baseline_spread is not null and c.pass_threshold is not null and c.baseline_value is not null
     and abs(c.pass_threshold - c.baseline_value) < c.baseline_spread) as threshold_too_narrow,
  ps.pieces_total, ps.pieces_posted, ps.pieces_cancelled, ps.pieces_open, ps.pieces_in_progress,
  po.pieces_measured,
  ps.date_from, ps.date_to,
  po.posts_active_n, po.posts_measured_n, po.posts_above_n, po.posts_normal_n, po.posts_below_n, po.latest_t7_on,
  case when c.metric_code = 'orders' and w.ok then w.wf end as orders_window_from,
  case when c.metric_code = 'orders' and w.ok then w.wt end as orders_window_to,
  case when c.metric_code = 'orders' then c.metric_channel_code end as orders_channel,
  case when c.metric_code = 'orders' then coalesce(c.metric_affinity, 'all') end as orders_affinity,
  case when c.metric_code = 'orders' and w.ok then oa.n end as orders_actual,
  case when c.metric_code = 'orders' then od.d end as orders_data_through,
  case when c.metric_code = 'orders' and w.ok then coalesce(od.d >= w.wt, false) end as orders_data_covers_window,
  case when c.metric_code = 'orders' and w.ok and c.pass_threshold is not null and c.pass_op is not null
       then case c.pass_op when '>=' then oa.n >= c.pass_threshold else oa.n <= c.pass_threshold end end as orders_threshold_met,
  case when c.result_verdict_confirmed_at is not null then c.result_verdict
       when c.result_verdict_proposed is not null then 'proposed:' || c.result_verdict_proposed
       else null end as verdict_display,
  case when c.result_verdict_confirmed_at is not null or c.status = 'done' then 'closed'
       when ps.pieces_total > 0 and ps.pieces_open = 0 and ps.pieces_posted > 0 then 'awaiting_read'
       when ps.pieces_posted > 0 or ps.pieces_in_progress > 0 or c.status in ('active', 'blocked', 'waiting_data') then 'running'
       else 'draft' end as stage,
  (c.result_verdict_proposed is not null and c.result_verdict_confirmed_at is null) as awaiting_confirm
from analytics.campaign c
left join lateral (
  select
    (count(*) filter (where s.piece_status is not null))::int as pieces_total,
    (count(*) filter (where s.piece_status = 'posted'))::int as pieces_posted,
    (count(*) filter (where s.piece_status = 'cancelled'))::int as pieces_cancelled,
    (count(*) filter (where s.piece_status is not null and s.piece_status not in ('posted', 'cancelled')))::int as pieces_open,
    (count(*) filter (where s.piece_status in ('drafting', 'in_review', 'approved', 'produced')))::int as pieces_in_progress,
    min(c.anchor_date + s.offset_start_days) as date_from,
    max(c.anchor_date + coalesce(s.offset_end_days, s.offset_start_days)) as date_to
  from analytics.campaign_step s
  where s.campaign_id = c.id
) ps on true
left join lateral (
  select
    (count(*))::int as posts_active_n,
    (count(*) filter (where r.t7_captured_on is not null))::int as posts_measured_n,
    (count(distinct r.step_id) filter (where r.t7_captured_on is not null))::int as pieces_measured,
    (count(*) filter (where r.effective_label = 'above'))::int as posts_above_n,
    (count(*) filter (where r.effective_label = 'normal'))::int as posts_normal_n,
    (count(*) filter (where r.effective_label = 'below'))::int as posts_below_n,
    max(r.t7_captured_on) as latest_t7_on
  from analytics.v_content_post_result r
  join analytics.campaign_step s on s.id = r.step_id
  where s.campaign_id = c.id and (s.piece_status is null or s.piece_status = 'posted')
) po on true
cross join lateral (
  select q.wf, q.wt, (q.wf is not null and q.wt is not null and q.wt >= q.wf) as ok
  from (select coalesce(c.metric_date_from, ps.date_from, c.anchor_date) as wf,
               coalesce(c.metric_date_to, ps.date_to, c.anchor_date) as wt) q
) w
left join lateral (
  select (coalesce(sum(o.orders_n), 0))::int as n
  from analytics.v_content_order_daily o
  where c.metric_code = 'orders' and w.ok
    and o.shop_id = c.shop_id and o.order_date between w.wf and w.wt
    and (c.metric_channel_code is null or o.channel_code = c.metric_channel_code)
    and o.affinity = coalesce(c.metric_affinity, 'all')
) oa on true
left join lateral (
  select max(o.order_date) as d
  from analytics.v_content_order_daily o
  where c.metric_code = 'orders' and o.shop_id = c.shop_id and o.affinity = 'all'
    and (c.metric_channel_code is null or o.channel_code = c.metric_channel_code)
) od on true;

-- inbox กอง 4 + หน้า K "ข้อเสนอในสรุปตอบได้" — union 3 แหล่ง ชนิดคอลัมน์ตรงกันทุกแขน · เรียง created_at desc
--   ตัวนับกอง 4 ของ UI = count(*) where effective_action = 'pending' จากview นี้ (ไม่ใช่ owner_questions ของ 0160 ที่นับแค่ด่าน)
--   reco: ทุกแถวของ recommendation_log (ประวัติด้วย — UI กรอง pending) · pending + เลยเส้นตาย = expired · pending ไม่มีเส้นตาย + เกิน 14 วัน = expired (กติกา 0101 คงไว้)
--   risk_gate: ด่าน risk_owner ที่รอ/ติดของชิ้นที่ยังร่าง/รอรีวิว (เงื่อนไขเดียวกับ v_content_inbox_counts.owner_questions) · ตอบผ่าน content_gate_record — ไม่มีค่าเริ่มต้น (AI ตัดสินแทนไม่ได้)
--   campaign_verdict: แคมเปญที่ AI เสนอคำตัดสินแล้วแต่เจ้าของยังไม่ยืนยัน · ตอบผ่าน campaign_verdict_confirm
--   ไม่ mutate แถว (หลัก 0101) · ไม่มี cron expire
create or replace view analytics.v_recommendation_inbox
  with (security_invoker = true) as
select u.*
from (
  select
    'reco'::text as item_kind,
    rl.id as item_id,
    rl.shop_id,
    rl.kind,
    rl.title,
    rl.detail,
    rl.effort_minutes_est,
    rl.respond_by,
    rl.default_action,
    rl.related_campaign_id,
    rl.related_step_id,
    rl.summary_id,
    rl.source,
    rl.created_at,
    rl.owner_action,
    case when rl.owner_action <> 'pending' then rl.owner_action
         when rl.respond_by is not null and rl.respond_by < (now() at time zone 'Asia/Bangkok')::date then 'expired'
         when rl.respond_by is null and now() - rl.created_at > interval '14 days' then 'expired'
         else 'pending' end as effective_action,
    case when rl.respond_by is null then null::integer
         else rl.respond_by - (now() at time zone 'Asia/Bangkok')::date end as days_left,
    coalesce(rl.acted_at is not null and rl.respond_by is not null
             and (rl.acted_at at time zone 'Asia/Bangkok')::date > rl.respond_by, false) as is_late,
    rl.outcome_note,
    rl.acted_at,
    'recommendation_respond'::text as respond_via
  from analytics.recommendation_log rl

  union all

  select
    'risk_gate'::text,
    s.id,
    g.shop_id,
    'question'::text,
    'ด่านความเสี่ยง: ' || coalesce(s.title, '(ไม่มีชื่อ)'),
    coalesce(nullif(btrim(g.detail ->> 'question'), ''), nullif(btrim(g.note), ''), '(ไม่มีคำถาม)'),
    null::integer,
    null::date,
    null::text,
    s.campaign_id,
    s.id,
    null::uuid,
    'agent'::text,
    g.created_at,
    'pending'::text,
    'pending'::text,
    null::integer,
    false,
    null::text,
    null::timestamptz,
    'content_gate_record'::text
  from analytics.step_gate g
  join analytics.campaign_step s on s.id = g.step_id
  where g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review')

  union all

  select
    'campaign_verdict'::text,
    c.id,
    c.shop_id,
    'question'::text,
    'ยืนยันคำตัดสินแคมเปญ: ' || c.name,
    c.result_verdict_proposed || ' — ' || c.result_proposed_note,
    null::integer,
    null::date,
    null::text,
    c.id,
    null::uuid,
    null::uuid,
    case c.result_proposed_by_role when 'ai' then 'agent' else 'adhoc' end,
    c.result_proposed_at,
    'pending'::text,
    'pending'::text,
    null::integer,
    false,
    null::text,
    null::timestamptz,
    'campaign_verdict_confirm'::text
  from analytics.campaign c
  where c.result_verdict_proposed is not null and c.result_verdict_confirmed_at is null
) u
order by u.created_at desc;

-- ============================================================================
-- 10. grant — revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--     ฟังก์ชันวนจาก pg_proc ตามรายชื่อเดียวกับ snapshot/ด่านท้ายไฟล์ ⇒ ฟังก์ชันที่เพิ่ม/ลืม ไม่หลุด grant
-- ============================================================================

do $c5grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|content_weekly_summary_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$c5grant$;

revoke all on analytics.v_campaign_summary, analytics.v_recommendation_inbox from public, anon, authenticated;
grant select on analytics.v_campaign_summary, analytics.v_recommendation_inbox to service_role;

-- J: ตารางใหม่ที่เป็นประวัติ — service_role อ่านได้อย่างเดียว เขียนผ่าน RPC definer เท่านั้น (บทเรียน 0161 H1/M3) · trigger guard เป็นชั้นที่สอง
revoke all on analytics.content_weekly_summary from public, anon, authenticated, service_role;
grant select on analytics.content_weekly_summary to service_role;

-- recommendation_log = ประวัติการตัดสินของเจ้าของ (0101: ห้ามหายก่อนวัน 90) — เดิม service_role เขียน/ลบตรงได้ทั้งหมด ⇒ ถอน insert/update/delete/truncate
-- ผู้เขียนที่เหลือ: RPC definer (recommendation_create / recommendation_respond) · postgres (MCP ของ Tech Lead) · RI SET NULL ตอนลบ step/summary/campaign (รันด้วยสิทธิ์เจ้าของตาราง)
-- ตรวจแล้ว 7 ต.ค.: โค้ดแอป (lib/ app/ components/ scripts/ packages/) ไม่มีที่ไหนอ้าง recommendation_log
revoke insert, update, delete, truncate on analytics.recommendation_log from service_role;

comment on view analytics.v_campaign_summary is
  'หน้า E — 1 แถว/แคมเปญ: แผน (hypothesis/metric/baseline/เกณฑ์) · ชิ้นงาน (total/posted/cancelled/open) · ผลโพสต์ (นับเฉพาะชิ้น posted หรือแคมเปญเก่า — ชิ้นค้างไม่นับ Q12) · '
  'orders_* (metric orders: ช่วงวัน/ช่องทาง/กลุ่มสินค้า จาก v_content_order_daily + orders_data_covers_window เตือนข้อมูลยังไม่ถึง) · verdict_display/stage/awaiting_confirm · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on view analytics.v_recommendation_inbox is
  'inbox กอง 4 — ข้อเสนอ/คำถาม (recommendation_log) + ด่านความเสี่ยง risk_owner (step_gate) + แคมเปญรอยืนยันคำตัดสิน · ตัวนับ = count(*) where effective_action = pending · '
  'หมดเวลา = expired (ไม่ mutate แถว) พร้อม default_action · respond_via บอกว่าตอบผ่าน RPC ไหน · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on function analytics.campaign_plan_set(uuid, uuid, jsonb, text) is
  'ตั้งสมมติฐาน/metric/ฐาน/เกณฑ์/ขอบเขตนับออเดอร์ของแคมเปญ (json null = ล้าง · key ไม่ส่ง = คงเดิม) · owner ทุกสถานะที่ยังไม่ปิด · ai/system เฉพาะแคมเปญที่ยังไม่มีชิ้นโพสต์ · ปิดแล้วแก้ไม่ได้ · errcode 22023/42501/55000';
comment on function analytics.campaign_verdict_propose(uuid, uuid, text, text, text) is
  'เสนอคำตัดสินแคมเปญ (ยังไม่ใช่คำตัดสิน) — ต้องมีหลักฐาน 3-1000 ตัวอักษร · validated/invalidated ติดด่านเนื้อหา (save/share ≥4 ชิ้นมี T+7 · orders ต้องตั้งเกณฑ์) · เสนอซ้ำทับได้ (previous_proposed คืนค่าเก่า) · AI ทับข้อเสนอของ owner ไม่ได้';
comment on function analytics.campaign_verdict_confirm(uuid, uuid, text, text, text, text, text) is
  'เจ้าของยืนยันคำตัดสิน (owner เท่านั้น) · p_expected_proposed บังคับ (none/ว่าง = ไม่มีข้อเสนอ · null = 22023) = compare-and-set · ปิดได้ทุกเมื่อแม้มีชิ้นค้าง (Q12): บันทึก open_pieces + ชิ้นค้างไม่นับในผล · '
  'status → done · บทเรียน ≤300 → content_signal insight (ไม่สร้างซ้ำ) · ยืนยันซ้ำทับได้ (previous_* คืนค่าเก่า)';
comment on function analytics.recommendation_create(uuid, text, text, text, text, text, integer, date, text, uuid, uuid, uuid) is
  'สร้างข้อเสนอ/คำถามถึงเจ้าของ — กันซ้ำชื่อที่ยังรอตอบ (23505) · เส้นตายต้องมี default_action · อ้างแคมเปญ/ชิ้น/สรุปสัปดาห์ต้องอยู่ร้านเดียวกัน · ชิ้นต้องอยู่ใน workflow ใหม่ · คืน uuid';
comment on function analytics.recommendation_respond(uuid, uuid, text, text, text) is
  'เจ้าของตอบ done/rejected (owner เท่านั้น · rejected ต้องมีเหตุผล) · ตอบซ้ำไม่ได้ (55000 = compare-and-set ในตัว) · ตอบช้ากว่า respond_by ได้ (late/was_expired ใน payload — คำตอบจริงชนะค่าเริ่มต้น)';
comment on function analytics.content_weekly_summary_upsert(uuid, date, date, text[], text, text, integer, text) is
  'เก็บ Weekly Brief ฉบับเต็ม (มติ Q10) — สรุป 1-5 บรรทัด + markdown ≤80000 · ทับสัปดาห์เดิมได้ (revision+1) แต่ไม่ทับเงียบ: คืน created/changed/revision · เนื้อหาเดิมซ้ำ = ไม่เขียน · ai/system ทับฉบับที่ owner เขียนล่าสุดไม่ได้';
comment on function analytics.campaign_verdict_gate_(uuid, text) is
  'ด่านเนื้อหาของคำตัดสิน (ภายใน — propose/confirm ใช้ร่วม): null = ผ่าน · ข้อความ = เหตุผลที่ตก (ผู้เรียก raise 55000) · เฉพาะ validated/invalidated';

-- ============================================================================
-- 11. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน · แบบ 0161 §8)
--     ไม่ assert "ไม่มีแถว kind=question / ไม่มี content_weekly_summary" ที่นี่ — ไฟล์ idempotent รันซ้ำหลังมีการใช้งานแล้วต้องผ่าน (ส่วนนั้นอยู่ verify-0162)
-- ============================================================================

do $c5final$
declare
  v_now text;
  v_bad text;
  v_k   text;
  v_n   bigint;
  c_fn  constant text := '^(content_bidi_present_|campaign_open_pieces_|campaign_verdict_gate_|content_weekly_summary_guard|campaign_result_guard|recommendation_log_guard|campaign_plan_set|campaign_verdict_propose|campaign_verdict_confirm|recommendation_create|recommendation_respond|content_weekly_summary_upsert)$';
  c_rel constant text[] := array['v_campaign_summary', 'v_recommendation_inbox'];
begin
  foreach v_k in array array['c5.snap_metric', 'c5.snap_post', 'c5.snap_step', 'c5.snap_campaign', 'c5.snap_reco', 'c5.snap_gate', 'c5.snap_views', 'c5.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0162 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
           is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    into v_now from analytics.content_post_metric;
  if v_now is distinct from current_setting('c5.snap_metric', true) then
    raise exception '0162 ด่านท้าย: content_post_metric เดิมเปลี่ยน (ไฟล์นี้ไม่แตะตารางนี้)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c5.snap_post', true) then
    raise exception '0162 ด่านท้าย: content_post เปลี่ยน (ไฟล์นี้ไม่แตะตารางนี้)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c5.snap_step', true) then
    raise exception '0162 ด่านท้าย: campaign_step เปลี่ยน (FK ใหม่ชี้เข้ามาจาก recommendation_log ต้องไม่แตะแถว)';
  end if;

  -- trap #19: add column/constraint บน campaign ต้องไม่ยิง trg_campaign_updated_at — count(distinct updated_at) ต้องเท่าเดิม
  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, anchor_date, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.campaign;
  if v_now is distinct from current_setting('c5.snap_campaign', true) then
    raise exception '0162 ด่านท้าย: campaign เปลี่ยน (trap #19 — add column/constraint ต้องไม่ยิง updated_at · ไฟล์นี้ไม่มี UPDATE)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, title, detail, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.recommendation_log;
  if v_now is distinct from current_setting('c5.snap_reco', true) then
    raise exception '0162 ด่านท้าย: recommendation_log เปลี่ยน (add column kind default ต้องไม่ยิง updated_at · ไฟล์นี้ไม่มี UPDATE)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', step_id, gate_kind, status, note, updated_at), E'\n' order by step_id, gate_kind), ''))
    into v_now from analytics.step_gate;
  if v_now is distinct from current_setting('c5.snap_gate', true) then
    raise exception '0162 ด่านท้าย: step_gate เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname <> all (c_rel);
  if v_now is distinct from current_setting('c5.snap_views', true) then
    raise exception '0162 ด่านท้าย: definition ของ view เดิมเปลี่ยน (รวม v_campaign_board / v_content_piece / v_recommendation_acceptance / v_content_post_result / v_content_order_daily — trap #3 ห้ามแตะ view เดิม)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname !~ c_fn;
  if v_now is distinct from current_setting('c5.snap_funcs', true) then
    raise exception '0162 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย (รวม 0148 upsert · 0158 · 0159 · 0160 · 0161) — ไฟล์นี้ไม่ replace ฟังก์ชันเดิมใดเลย';
  end if;

  -- trap #1: ฟังก์ชันของไฟล์นี้ต้องมี signature เดียวต่อชื่อ · ครบ 12 ตัว (helper 3 + trigger 3 + RPC 6)
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) as n from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname ~ c_fn
           group by p.proname having count(*) > 1) x;
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: ฟังก์ชันมี overload ค้าง — หยุดแล้วรายงาน: %', v_bad;
  end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn;
  if v_n <> 12 then
    raise exception '0162 ด่านท้าย: คาดฟังก์ชันของไฟล์นี้ 12 ตัว (helper 3 + trigger 3 + RPC 6) พบ %', v_n;
  end if;

  -- trigger ด่านตารางต้องมี เปิดอยู่ (tgenabled = 'O') ชี้ฟังก์ชันถูกตัว และชนิดครบ (ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32)
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.campaign'::regclass and t.tgname = 'trg_campaign_result_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.campaign_result_guard()'::regprocedure and (t.tgtype & 23) = 23) then
    raise exception '0162 ด่านท้าย: trigger trg_campaign_result_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.recommendation_log'::regclass and t.tgname = 'trg_recommendation_log_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.recommendation_log_guard()'::regprocedure and (t.tgtype & 31) = 31) then
    raise exception '0162 ด่านท้าย: trigger trg_recommendation_log_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_weekly_summary'::regclass and t.tgname = 'trg_content_weekly_summary_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_weekly_summary_guard()'::regprocedure and (t.tgtype & 31) = 31) then
    raise exception '0162 ด่านท้าย: trigger trg_content_weekly_summary_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW เปิดอยู่)';
  end if;
  -- trigger เดิมยังอยู่ครบ (updated_at ของสามตาราง) — ไม่ถูก drop/แทนโดยไฟล์นี้
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.campaign'::regclass and not t.tgisinternal) <> 2
     or (select count(*) from pg_trigger t where t.tgrelid = 'analytics.recommendation_log'::regclass and not t.tgisinternal) <> 2
     or (select count(*) from pg_trigger t where t.tgrelid = 'analytics.content_weekly_summary'::regclass and not t.tgisinternal) <> 2 then
    raise exception '0162 ด่านท้าย: trigger บน campaign / recommendation_log / content_weekly_summary ต้องเหลือตารางละ 2 (guard + updated_at)';
  end if;

  -- FK ที่ชี้เข้าประวัติ reco ต้องเป็น SET NULL (confdeltype n) ทั้งสามเส้น — ไม่มี CASCADE ที่ลบแถวประวัติ (บทเรียน 0161 H1)
  select string_agg(c.conname || ':' || c.confdeltype::text, ', ') into v_bad
    from pg_constraint c
   where c.conrelid = 'analytics.recommendation_log'::regclass and c.contype = 'f'
     and c.confrelid in ('analytics.campaign_step'::regclass, 'analytics.content_weekly_summary'::regclass, 'analytics.campaign'::regclass)
     and c.confdeltype <> 'n';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: FK จาก recommendation_log ต้อง ON DELETE SET NULL: %', v_bad;
  end if;
  if (select count(*) from pg_constraint c where c.conrelid = 'analytics.recommendation_log'::regclass and c.contype = 'f'
         and c.confrelid in ('analytics.campaign_step'::regclass, 'analytics.content_weekly_summary'::regclass, 'analytics.campaign'::regclass)) <> 3 then
    raise exception '0162 ด่านท้าย: FK จาก recommendation_log → campaign / campaign_step / content_weekly_summary ต้องมีครบ 3 เส้น';
  end if;

  -- CHECK ข้ามคอลัมน์ที่เป็นด่านจริงต้องมี · unique index กันซ้ำต้องเป็น partial unique
  select string_agg(x.n, ', ') into v_bad
    from (values ('analytics.campaign'::regclass, 'campaign_metric_scope_needs_orders_check'),
                 ('analytics.campaign'::regclass, 'campaign_result_proposed_consistency_check'),
                 ('analytics.campaign'::regclass, 'campaign_result_confirmed_consistency_check'),
                 ('analytics.campaign'::regclass, 'campaign_pass_pair_check'),
                 ('analytics.campaign'::regclass, 'campaign_metric_dates_check'),
                 ('analytics.recommendation_log'::regclass, 'recommendation_log_deadline_needs_default_check'),
                 ('analytics.content_weekly_summary'::regclass, 'content_weekly_summary_lines_check')) as x (rel, n)
   where not exists (select 1 from pg_constraint c where c.conrelid = x.rel and c.conname = x.n and c.convalidated);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: CHECK ที่ต้องมีหายหรือยังไม่ validated: %', v_bad;
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where i.indrelid = 'analytics.recommendation_log'::regclass and c.relname = 'uq_recommendation_log_pending_title'
                    and i.indisunique and i.indpred is not null and i.indisvalid) then
    raise exception '0162 ด่านท้าย: uq_recommendation_log_pending_title ต้องเป็น partial unique index ที่ valid';
  end if;

  -- trap #18: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (coalesce proacl — default = PUBLIC execute)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บนฟังก์ชัน %', v_bad;
  end if;
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and (c.relname = any (c_rel) or c.relname = 'content_weekly_summary')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: grant รั่วบน view/ตาราง: %', v_bad;
  end if;
  -- J: content_weekly_summary — service_role อ่านอย่างเดียว · recommendation_log — ต้องถอน insert/update/delete/truncate แต่ยังอ่านได้
  select string_agg(a.privilege_type, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_weekly_summary'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: service_role เขียนตรงลง content_weekly_summary ได้ (%) — ต้องมีแค่ SELECT', v_bad;
  end if;
  select string_agg(x.priv, ', ') into v_bad
    from (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as x (priv)
   where has_table_privilege('service_role', 'analytics.recommendation_log'::regclass, x.priv);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: service_role ยังมีสิทธิ์เขียน/ลบตรงบน recommendation_log (%) — ต้องถอด (J)', v_bad;
  end if;
  if not has_table_privilege('service_role', 'analytics.recommendation_log'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.content_weekly_summary'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.v_campaign_summary'::regclass, 'SELECT')
     or not has_table_privilege('service_role', 'analytics.v_recommendation_inbox'::regclass, 'SELECT') then
    raise exception '0162 ด่านท้าย: service_role ต้องยังอ่าน recommendation_log / content_weekly_summary / view ใหม่ได้ (SELECT)';
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel)
     and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: view ไม่ได้เป็น security_invoker: %', v_bad;
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.content_weekly_summary'::regclass) then
    raise exception '0162 ด่านท้าย: content_weekly_summary ไม่ได้เปิด RLS';
  end if;

  -- view ต้อง "รันได้จริง" (ambiguous ref / ชนิดไม่ตรงในแขน union โผล่ตอนวางแผน ไม่ใช่ตอน create) · จำนวนแถวต้องสมเหตุผล
  select count(*) into v_n from analytics.v_campaign_summary;
  if v_n <> (select count(*) from analytics.campaign) then
    raise exception '0162 ด่านท้าย: v_campaign_summary ต้องมี 1 แถวต่อแคมเปญทุกแถว (view % · campaign %)', v_n, (select count(*) from analytics.campaign);
  end if;
  select count(*) into v_n from analytics.v_recommendation_inbox where item_kind = 'reco';
  if v_n <> (select count(*) from analytics.recommendation_log) then
    raise exception '0162 ด่านท้าย: v_recommendation_inbox แขน reco ต้องมีทุกแถวของ recommendation_log (view % · log %)', v_n, (select count(*) from analytics.recommendation_log);
  end if;

  -- N18: วันไทย — ไม่มี current_date ใน view/ฟังก์ชันใหม่ · ที่คิดวันต้องมี Asia/Bangkok
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel) and pg_get_viewdef(c.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: view มี current_date (วันไทยเท่านั้น): %', v_bad;
  end if;
  if pg_get_viewdef('analytics.v_recommendation_inbox'::regclass) !~ 'Asia/Bangkok' then
    raise exception '0162 ด่านท้าย: v_recommendation_inbox ต้องใช้ Asia/Bangkok';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0162 ด่านท้าย: ฟังก์ชันมี current_date: %', v_bad;
  end if;
  if pg_get_functiondef('analytics.campaign_plan_set(uuid,uuid,jsonb,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.campaign_verdict_confirm(uuid,uuid,text,text,text,text,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.recommendation_create(uuid,text,text,text,text,text,integer,date,text,uuid,uuid,uuid)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.recommendation_respond(uuid,uuid,text,text,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.content_weekly_summary_upsert(uuid,date,date,text[],text,text,integer,text)'::regprocedure) !~ 'Asia/Bangkok' then
    raise exception '0162 ด่านท้าย: RPC ที่คิดวันต้องใช้ Asia/Bangkok';
  end if;

  raise notice '0162 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ (metric/post/step/campaign/reco/gate/view/ฟังก์ชัน รวม 0148-0161) · ไม่มี overload · trigger ครบ · FK SET NULL · '
               'grant สะอาด · service_role เขียน reco/summary ตรงไม่ได้ · view รันได้จริง · วันไทย';
end
$c5final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/view ใหม่ทันที — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';
