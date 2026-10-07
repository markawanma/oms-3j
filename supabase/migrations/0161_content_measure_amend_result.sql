-- 0161_content_measure_amend_result.sql  (C3 ส่วนแรก — แก้ยอดย้อนหลัง + ผลต่อโพสต์ + rollup hook + metric ออเดอร์)
--
-- สถานะ: DRAFT ยังไม่ apply — พึ่ง 0159 + 0160 (apply แล้ว) · ต้องผ่าน security (💰-class: "แก้ตัวเลขย้อนหลัง" = เสี่ยงปลอมประวัติ KPI
-- ที่เจ้าของถูกวัด + "ยืนยันผลต่อโพสต์" = AI ห้ามตัดสินแทนเจ้าของ) + QA scope L ก่อน merge
-- Design: docs/3j-jewelry/analytics/design-content-workflow-schema-gap.md §13.0-§13.3 · §13.7 (Y1-Y12 · Y23 · Y24) · §13.8 (N1-N7 · N10 · N14 · N17 · N18) · §13.x มติ Q9-Q12
--
-- ทำอะไร:
--   1. content_post_metric.amended_cols + ตาราง content_post_metric_amend_log (append-only) + RPC content_post_metric_amend (owner เท่านั้น)
--      + trigger ด่านระดับตาราง content_post_metric_guard (กัน service_role แก้/ลบยอดตรง · บันทึกเมื่อ tiktok_api ทับค่าที่เจ้าของแก้มือ)
--   2. content_post.result_* + trigger content_post_result_guard + RPC content_post_verdict_confirm (owner เท่านั้น · compare-and-set · บทเรียน → content_signal)
--   3. view ใหม่: v_content_post_missed_window · v_content_post_result · v_content_hook_type_rollup · v_content_order_daily (metric ออเดอร์)
--   4. metric_code ระดับชิ้นเพิ่มค่า 'orders' (CHECK ของ campaign_step + content_piece_enum_ok_ ที่ตรวจค่าใน RPC ของ 0159)
--
-- 🔴 มติเจ้าของ 7 ต.ค. 69 ที่ทับสเปกเดิม:
--   Q9  ยอดจาก source='tiktok_api' ทับค่าที่แก้มือได้ ⇒ ไม่มีกลไก "คืนค่าที่คนล็อก" · แต่ต้องเก็บประวัติการทับ: trigger เขียนแถว amend_log
--       (change_kind='api_override' · actor_role='system' · before → after) และถอดคอลัมน์ที่ถูกทับออกจาก amended_cols (ค่านั้นไม่ใช่ค่าที่คนยืนยันแล้ว)
--   Q11 ไม่ผูกโฮสต์กับผลของโพสต์ ⇒ v_content_post_result / v_content_hook_type_rollup ไม่มี host_* และไม่ join live_session_log
--   (Q10/Q12 เป็นของ 0162)
--
-- 🔴 ตัดสินใจเองนอกสเปก (เหตุผลอยู่ที่จุดนั้น + สรุปส่งมอบ):
--   A  แทนที่ content_piece_enum_ok_ (helper ของ 0159 · signature เดิม · ไม่มี overload) เพียงตัวเดียว: เพิ่ม 'orders' ใน metric_code — ถ้าไม่ทำ CHECK
--      รับ 'orders' แต่ content_piece_set_plan ปฏิเสธ 22023 ⇒ metric ใหม่ตั้งไม่ได้จริง · ฟังก์ชันนี้ไม่ถูก pin md5 ใน verify-0159/0160 (ตรวจแล้ว)
--      และไม่มีฟังก์ชันอื่นของ 0148/0158/0159/0160 ถูกแตะ — ด่านท้ายไฟล์ยก content_piece_enum_ok_ ออกจาก snapshot แล้วเทียบที่เหลือทุกตัว
--   B  amend_log.change_kind ('amend' | 'api_override') — แยก "เจ้าของแก้" ออกจาก "API ทับ" ให้อ่านประวัติได้โดยไม่เดาจาก actor_role
--   C  guard ตาราง content_post / content_post_metric ดักเพิ่ม INSERT ตรงจาก service_role/authenticated/anon ที่ตั้ง result_* / amended_cols —
--      ไม่งั้นปลอมการยืนยันของเจ้าของหรือธง "แก้มือ" ได้ด้วย INSERT (สเปกกัน UPDATE อย่างเดียว) · DELETE ตรงถูกกัน ยกเว้นตอน cascade จากการลบโพสต์
--   D  บทเรียนต่อโพสต์ (p_lesson) ≤ 300 ตัวอักษร (สเปก 500) — content_signal.summary จำกัด 1-300 · ถ้ารับ 500 แล้วส่งต่อสัญญาณจะล้มทีหลัง · คอลัมน์ result_lesson
--      ยัง CHECK ≤ 500 ตามสเปก · ยืนยันซ้ำข้อความเดิม คืน signal_id ของสัญญาณเดิม (signal_created=false) แทน null
--   E  v_content_hook_type_rollup.verdict ใช้ข้อความเดียวกับ v_content_hook_library.type_verdict ('ยังสรุปไม่ได้'/'สรุปได้' — verify N6 เทียบเท่ากันได้จริง)
--      ส่วน "(n/4)" แยกเป็นคอลัมน์ verdict_detail · v_content_post_result เพิ่ม baseline_share_n (ฐานของ share_rate อาจน้อยกว่าฐานของ save_rate)
--   F  metric ออเดอร์: view v_content_order_daily อย่างเดียว (ไม่มี RPC) — นับ distinct ออเดอร์ต่อ (shop · order_date · channel · affinity) · affinity 'all' คือนับทุกออเดอร์
--      'bar' / 'jewelry' = ออเดอร์ที่มีสินค้าฝั่งนั้นอย่างน้อย 1 รายการ (ตะกร้าผสมนับทั้งสองแถว ⇒ bar+jewelry อาจ > all) · ผ่าน v_product_affinity จุดเดียว (ไม่ hardcode category)
--   G  1e3 ใน p_set ของ amend ถูก jsonb แปลงเป็น 1000 ตั้งแต่รับพารามิเตอร์ (แยกไม่ออกจาก 1000) ⇒ รับเป็น 1000 · 12.5 / 1.0 / -1 / "12" / true ถูกปฏิเสธ
--
-- Grant model (3j-migration-traps #18): ทุก object ใหม่ grant ให้ service_role อย่างเดียว · revoke ครบสามชื่อ (public/anon/authenticated)
-- ⚠️ ห้ามมี `to authenticated` ในไฟล์นี้ (สคีมา analytics ปิด REST ของ anon/authenticated ทั้งสคีมา — 0123)
-- 🔴 view ใหม่ "ไม่กรองร้านให้" — security_invoker + service_role ข้าม RLS ⇒ frontend ต้อง .eq('shop_id', shopId) ทุก query
-- 🔴 map error จาก errcode: 22023 = อินพุตผิด · 42501 = ไม่ใช่เจ้าของ/append-only · 55000 = สถานะไม่เอื้อ/ด่านตาราง (ห้าม match ข้อความ)
-- ไฟล์ไม่มี UPDATE/backfill (trap #19) · idempotent (รันซ้ำ 2 รอบในทรานแซกชันเดียวผ่าน) · LF
-- 🔴 ห้ามรันนอก `node scripts/run-sql.mjs` — ด่านท้ายไฟล์เทียบกับ snapshot ใน GUC ระดับทรานแซกชัน (c4.snap_* — 0160 ใช้ c3.snap_* ไปแล้ว)

-- ============================================================================
-- 0. ด่านต้นไฟล์ (พึ่ง 0159/0160) + snapshot ก่อนแตะอะไร
-- ============================================================================

do $c4pre$
begin
  if to_regprocedure('analytics.content_piece_post(uuid,uuid,text,text,text,timestamptz,text,uuid,text,text,text)') is null
     or to_regprocedure('analytics.content_post_metric_upsert(uuid,uuid,bigint,bigint,bigint,bigint,bigint,text)') is null
     or to_regprocedure('analytics.content_piece_enum_ok_(text,text)') is null
     or to_regprocedure('analytics.content_actor_assert(text,text[],text)') is null
     or to_regprocedure('analytics.crm_require_owner_admin(uuid)') is null
     or to_regprocedure('analytics.content_text_clean(text)') is null
     or to_regprocedure('analytics.content_marker_present(text)') is null
     or not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'content_signal_capture')
     or to_regclass('analytics.v_content_hook_library') is null
     or to_regclass('analytics.v_content_post_t7') is null
     or to_regclass('analytics.v_content_entry_queue') is null
     or to_regclass('analytics.v_product_affinity') is null
     or to_regclass('analytics.fact_order_item') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'content_post' and column_name = 'hook_id')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'analytics' and table_name = 'campaign_step' and column_name = 'piece_status') then
    raise exception '0161: ต้อง apply 0159 + 0160 ก่อน — ไม่พบ content_piece_post / content_piece_enum_ok_ / v_content_hook_library / content_post.hook_id / campaign_step.piece_status';
  end if;
end
$c4pre$;

do $c4snap$
begin
  perform set_config('c4.snap_metric', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
             is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    from analytics.content_post_metric), true);
  perform set_config('c4.snap_post', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    from analytics.content_post), true);
  perform set_config('c4.snap_step', (
    select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
           md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    from analytics.campaign_step), true);
  perform set_config('c4.snap_campaign', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, updated_at),
             E'\n' order by id), ''))
    from analytics.campaign), true);
  perform set_config('c4.snap_reco', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, updated_at),
             E'\n' order by id), ''))
    from analytics.recommendation_log), true);
  perform set_config('c4.snap_views', (
    select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    from pg_class c
    where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
      and c.relname not in ('v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily')), true);
  perform set_config('c4.snap_funcs', (
    select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
             order by p.oid::regprocedure::text), ''))
    from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
      and p.proname !~ '^(content_post_metric_regression_$|content_post_metric_guard$|content_post_metric_amend_log_append_only$|content_post_result_guard$|content_post_metric_amend$|content_post_verdict_confirm$|content_piece_enum_ok_$)'), true);
end
$c4snap$;

-- ============================================================================
-- 1. คอลัมน์/ตารางใหม่ (additive ล้วน · ไม่มี UPDATE · add column มี default/nullable = ไม่ rewrite)
-- ============================================================================

-- amended_cols: คอลัมน์ที่เจ้าของยืนยันค่าด้วย amend (ที่มาของค่า ไม่ใช่ตัวล็อก — Q9: tiktok_api ทับได้ + มี log)
alter table analytics.content_post_metric
  add column if not exists amended_cols text[] not null default '{}';

alter table analytics.content_post_metric drop constraint if exists content_post_metric_amended_cols_check;
alter table analytics.content_post_metric add constraint content_post_metric_amended_cols_check
  check (amended_cols <@ array['view_count', 'like_count', 'comment_count', 'save_count', 'share_count']::text[]);

comment on column analytics.content_post_metric.amended_cols is
  'คอลัมน์ที่เจ้าของยืนยันค่าด้วย content_post_metric_amend (ที่มาของค่า — ไม่ใช่ตัวล็อก) · แหล่ง tiktok_api ทับได้ (มติ Q9 7 ต.ค. 69) แต่ trigger '
  'content_post_metric_guard บันทึกการทับลง content_post_metric_amend_log (change_kind=api_override) แล้วถอดคอลัมน์ที่ถูกทับออกจากรายการนี้ · '
  'ล้างค่า (json null) ไม่ใส่ธง เพราะ null ไม่ใช่คำยืนยัน';

-- ประวัติแก้ยอด (append-only) — before/after เก็บ 5 คอลัมน์เต็ม อ่านประวัติได้โดยไม่ต้องไล่ย้อน
create table if not exists analytics.content_post_metric_amend_log (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shop (id) on delete cascade,
  metric_id    uuid not null references analytics.content_post_metric (id) on delete cascade,
  post_id      uuid not null references analytics.content_post (id) on delete cascade,
  captured_on  date not null,
  before       jsonb not null,
  after        jsonb not null,
  changed_cols text[] not null,
  reason       text not null,
  change_kind  text not null default 'amend',
  actor_role   text not null,
  actor_uid    uuid,
  created_at   timestamptz not null default now(),
  constraint content_post_metric_amend_log_before_check check (jsonb_typeof(before) = 'object'),
  constraint content_post_metric_amend_log_after_check check (jsonb_typeof(after) = 'object'),
  constraint content_post_metric_amend_log_changed_check
    check (cardinality(changed_cols) >= 1
       and changed_cols <@ array['view_count', 'like_count', 'comment_count', 'save_count', 'share_count']::text[]),
  constraint content_post_metric_amend_log_reason_check check (length(reason) between 3 and 500),
  constraint content_post_metric_amend_log_kind_check check (change_kind in ('amend', 'api_override')),
  constraint content_post_metric_amend_log_actor_check check (actor_role in ('owner', 'system')),
  constraint content_post_metric_amend_log_kind_actor_check
    check ((change_kind = 'amend' and actor_role = 'owner') or (change_kind = 'api_override' and actor_role = 'system'))
);

create index if not exists idx_content_post_metric_amend_log_post on analytics.content_post_metric_amend_log (post_id, created_at desc);
create index if not exists idx_content_post_metric_amend_log_metric on analytics.content_post_metric_amend_log (metric_id);

comment on table analytics.content_post_metric_amend_log is
  'ประวัติแก้ยอดย้อนหลัง (append-only) — change_kind=amend: เจ้าของแก้ผ่าน content_post_metric_amend · api_override: ยอดจาก tiktok_api ทับค่าที่เจ้าของแก้มือ '
  '(trigger เขียน · actor_role=system) · before/after = 5 คอลัมน์เต็ม · เขียนผ่าน RPC/trigger เท่านั้น (ไม่มี grant เขียนให้ role ใด)';

-- append-only: ห้าม UPDATE/DELETE/TRUNCATE (42501) · ยกเว้น DELETE ตอน cascade (แถว metric หรือโพสต์แม่หายไปแล้ว) — แบบ content_piece_event ของ 0159
-- เช็คทั้งสองแม่ เพราะลำดับ cascade ของ FK สองเส้นไม่การันตี (ถ้าเช็คแค่ metric แล้ว FK post_id ยิงก่อน การลบโพสต์จะถูกขวางด้วย 42501 งงๆ)
create or replace function analytics.content_post_metric_amend_log_append_only()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if not exists (select 1 from analytics.content_post_metric m where m.id = old.metric_id)
       or not exists (select 1 from analytics.content_post p where p.id = old.post_id) then
      return old;
    end if;
  end if;
  raise exception 'analytics.content_post_metric_amend_log is append-only (% blocked)', tg_op using errcode = '42501';
end;
$f$;

drop trigger if exists trg_content_post_metric_amend_log_append_only on analytics.content_post_metric_amend_log;
create trigger trg_content_post_metric_amend_log_append_only
  before update or delete on analytics.content_post_metric_amend_log
  for each row execute function analytics.content_post_metric_amend_log_append_only();
drop trigger if exists trg_content_post_metric_amend_log_deny_truncate on analytics.content_post_metric_amend_log;
create trigger trg_content_post_metric_amend_log_deny_truncate
  before truncate on analytics.content_post_metric_amend_log
  for each statement execute function analytics.content_post_metric_amend_log_append_only();

alter table analytics.content_post_metric_amend_log enable row level security;
drop policy if exists tenant_isolation_select on analytics.content_post_metric_amend_log;
create policy tenant_isolation_select on analytics.content_post_metric_amend_log
  for select using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));
-- service_role ได้สิทธิ์เขียนทั้งหมดมาจาก default privileges ตอน create table — ถอนก่อนแล้วให้แค่ SELECT (ไม่งั้น INSERT ตรงปลอมประวัติ "เจ้าของแก้" ได้)
-- RPC/trigger เขียนได้เพราะรันเป็นเจ้าของฟังก์ชัน (definer) ไม่ใช่ service_role
revoke all on analytics.content_post_metric_amend_log from public, anon, authenticated, service_role;
grant select on analytics.content_post_metric_amend_log to service_role;

-- ผลต่อโพสต์ที่เจ้าของยืนยัน — nullable ล้วน · ตั้งผ่าน content_post_verdict_confirm เท่านั้น (ด่านตาราง trg_content_post_result_guard ด้านล่าง)
alter table analytics.content_post
  add column if not exists result_label_override   text,
  add column if not exists result_confirmed_at     timestamptz,
  add column if not exists result_confirmed_by_role text,
  add column if not exists result_lesson           text;

alter table analytics.content_post drop constraint if exists content_post_result_label_check;
alter table analytics.content_post add constraint content_post_result_label_check
  check (result_label_override is null or result_label_override in ('above', 'normal', 'below'));
alter table analytics.content_post drop constraint if exists content_post_result_role_check;
alter table analytics.content_post add constraint content_post_result_role_check
  check (result_confirmed_by_role is null or result_confirmed_by_role = 'owner');
alter table analytics.content_post drop constraint if exists content_post_result_lesson_check;
alter table analytics.content_post add constraint content_post_result_lesson_check
  check (result_lesson is null or length(result_lesson) <= 500);
-- ป้าย + เวลายืนยัน + ผู้ยืนยัน ต้องมาพร้อมกันหรือไม่มีเลย · บทเรียนมีได้เฉพาะเมื่อมีการยืนยัน (null-safe: เทียบด้วย is null ทั้งคู่)
alter table analytics.content_post drop constraint if exists content_post_result_consistency_check;
alter table analytics.content_post add constraint content_post_result_consistency_check
  check ((result_label_override is null) = (result_confirmed_at is null)
     and (result_confirmed_at is null) = (result_confirmed_by_role is null)
     and (result_lesson is null or result_label_override is not null));

comment on column analytics.content_post.result_label_override is
  'ป้ายผลต่อโพสต์ที่เจ้าของยืนยัน (above/normal/below) — ชนะป้ายที่ระบบคำนวณ (v_content_post_result.effective_label) · ตั้งผ่าน content_post_verdict_confirm เท่านั้น';

-- metric_code ระดับชิ้นเพิ่ม 'orders' (จำนวนออเดอร์ — นับจาก v_content_order_daily) · drop+add constraint ไม่ยิง trigger ของ campaign_step
alter table analytics.campaign_step drop constraint if exists campaign_step_metric_code_check;
alter table analytics.campaign_step add constraint campaign_step_metric_code_check
  check (metric_code is null or metric_code in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none'));

-- ตัดสินใจ A: content_piece_set_plan ตรวจค่า metric_code ผ่าน helper ตัวนี้ (0159) — เนื้อหาเหมือนเดิมทุกบรรทัด เพิ่มแค่ 'orders'
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
    when 'metric_code' then p_val in ('save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'orders', 'none')
    when 'pass_op' then p_val in ('>=', '<=')
    when 'line_audience' then p_val in ('all', 'segment')
    when 'footage_status' then p_val in ('needs_shoot', 'has_footage', 'shot')
    when 'shoot_location' then p_val in ('factory', 'product_table', 'host_cam', 'other')
    else false
  end, false)
$f$;

-- ============================================================================
-- 2. helper — สูตร is_regression
-- ⚠️ D22: สูตรนี้อยู่ 2 ที่ — body ของ content_post_metric_upsert (0148 H1 · replace ไม่ได้ เพราะ verify-0159 pin md5) กับตัวนี้
--    ต้องเท่ากันเสมอ (verify Y24/N4 เทียบกับ is_regression ของแถวจริง) · แก้สูตรที่ upsert ภายหลัง = ต้องแก้ตัวนี้ + verify-0161 ด้วย
-- ค่าที่ส่งมา (ไม่ null) ต่ำกว่า max(col) ของแถว captured_on < p_captured_on ของโพสต์นั้น (ไม่รวมวันเดียวกัน — แก้เลขพิมพ์ผิดวันเดียวกันไม่ใช่ถดถอย)
-- ============================================================================

create or replace function analytics.content_post_metric_regression_(
  p_post_id uuid, p_captured_on date,
  p_view bigint, p_like bigint, p_comment bigint, p_save bigint, p_share bigint
) returns boolean
 language sql
 stable
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
  select coalesce(
           (p_view is not null and m.mv is not null and p_view < m.mv)
        or (p_like is not null and m.ml is not null and p_like < m.ml)
        or (p_comment is not null and m.mc is not null and p_comment < m.mc)
        or (p_save is not null and m.ms is not null and p_save < m.ms)
        or (p_share is not null and m.mh is not null and p_share < m.mh), false)
    from (select max(x.view_count) as mv, max(x.like_count) as ml, max(x.comment_count) as mc,
                 max(x.save_count) as ms, max(x.share_count) as mh
            from analytics.content_post_metric x
           where x.post_id = p_post_id and x.captured_on < p_captured_on) m
$f$;

-- ============================================================================
-- 3. trigger ด่านตาราง content_post_metric — ครอบทุกเส้นทาง (รวม API ในอนาคตที่ยังไม่เขียน) · ไม่ replace content_post_metric_upsert
--    ด่านใช้ current_user อย่างเดียว (ไม่มี GUC — D18): "เขียนตรงจาก service key/REST = ไม่ผ่าน · ฟังก์ชัน definer ใดๆ = ผ่าน"
--    ข้อ API-ทับ (Q9) ทำงานทุก role: เป็นแค่การบันทึกประวัติ ไม่ใช่การปฏิเสธ
-- ============================================================================

create or replace function analytics.content_post_metric_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_direct constant boolean := current_user in ('service_role', 'authenticated', 'anon');
  v_over   text[] := '{}';
  v_c      text;
begin
  if tg_op = 'DELETE' then
    -- ลบตรงโดย 3 role ไม่ผ่าน (ค่าผิดให้แก้ ไม่ใช่ลบ) · cascade จากการลบโพสต์ไม่โดน เพราะ RI trigger รันด้วยสิทธิ์เจ้าของตาราง (current_user = postgres) — พิสูจน์ใน verify Y10g (mutant ถอดเงื่อนไขนี้ก็ยังผ่าน)
    if v_direct then
      raise exception 'ลบยอดไม่ได้ — ค่าผิดให้แก้ผ่าน content_post_metric_amend' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- ตัดสินใจ C: INSERT ตรงที่ใส่ธง amended_cols = ปลอมว่าเจ้าของยืนยันค่า (ไม่มี log รองรับ)
    if v_direct and cardinality(new.amended_cols) > 0 then
      raise exception 'ตั้ง amended_cols ตรงไม่ได้ — ต้องผ่าน content_post_metric_amend' using errcode = '55000';
    end if;
    return new;
  end if;

  -- UPDATE ตรงโดย 3 role ที่เปลี่ยนค่าตัวเลข/ธง/คีย์ → ไม่ผ่าน · เปลี่ยนเฉพาะ raw/source/sources/captured_at ปล่อย
  if v_direct and (
       new.view_count is distinct from old.view_count
    or new.like_count is distinct from old.like_count
    or new.comment_count is distinct from old.comment_count
    or new.save_count is distinct from old.save_count
    or new.share_count is distinct from old.share_count
    or new.is_regression is distinct from old.is_regression
    or new.amended_cols is distinct from old.amended_cols
    or new.captured_on is distinct from old.captured_on
    or new.age_days is distinct from old.age_days
    or new.post_id is distinct from old.post_id
    or new.shop_id is distinct from old.shop_id) then
    raise exception 'แก้ยอดต้องผ่าน content_post_metric_amend' using errcode = '55000';
  end if;

  -- Q9: ยอดจาก tiktok_api ทับค่าที่เจ้าของแก้มือได้ — แต่ห้ามเงียบ: บันทึก before → after + ถอดธงของคอลัมน์ที่ถูกทับ
  -- (เทียบเฉพาะคอลัมน์ใน old.amended_cols · ค่าเท่าเดิม = ไม่ทับ = ไม่ log · is distinct from → null-safe)
  if new.source = 'tiktok_api' and cardinality(old.amended_cols) > 0 then
    foreach v_c in array old.amended_cols loop
      if (case v_c
           when 'view_count' then new.view_count is distinct from old.view_count
           when 'like_count' then new.like_count is distinct from old.like_count
           when 'comment_count' then new.comment_count is distinct from old.comment_count
           when 'save_count' then new.save_count is distinct from old.save_count
           when 'share_count' then new.share_count is distinct from old.share_count
           else false
         end) then
        v_over := v_over || v_c;
      end if;
    end loop;

    if cardinality(v_over) > 0 then
      new.amended_cols := array(select c from unnest(old.amended_cols) as c where not (c = any (v_over)) order by c);
      insert into analytics.content_post_metric_amend_log
        (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, change_kind, actor_role, actor_uid)
      values (
        old.shop_id, old.id, old.post_id, old.captured_on,
        jsonb_build_object('view_count', old.view_count, 'like_count', old.like_count, 'comment_count', old.comment_count,
                           'save_count', old.save_count, 'share_count', old.share_count),
        jsonb_build_object('view_count', new.view_count, 'like_count', new.like_count, 'comment_count', new.comment_count,
                           'save_count', new.save_count, 'share_count', new.share_count),
        array(select c from unnest(v_over) as c order by c),
        'ยอดจาก TikTok API ทับค่าที่เจ้าของแก้มือ (มติเจ้าของ 7 ต.ค. 69)', 'api_override', 'system', auth.uid());
    end if;
  end if;

  return new;
end;
$f$;

drop trigger if exists trg_content_post_metric_guard on analytics.content_post_metric;
create trigger trg_content_post_metric_guard
  before insert or update or delete on analytics.content_post_metric
  for each row execute function analytics.content_post_metric_guard();

-- ด่านตาราง content_post.result_* — ตัวที่ 3 บนตาราง (ไม่แตะ trg_content_post_link_guard ของ 0160 / trg_content_post_updated_at)
-- เปลี่ยน result_* ทำให้ trg_content_post_updated_at ยิง = ถูก (แถวเปลี่ยนจริง)
create or replace function analytics.content_post_result_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  if current_user in ('service_role', 'authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.result_label_override is not null or new.result_confirmed_at is not null
         or new.result_confirmed_by_role is not null or new.result_lesson is not null then
        raise exception 'ยืนยันผลต่อโพสต์ผ่าน content_post_verdict_confirm เท่านั้น' using errcode = '55000';
      end if;
    elsif (new.result_label_override, new.result_confirmed_at, new.result_confirmed_by_role, new.result_lesson)
          is distinct from
          (old.result_label_override, old.result_confirmed_at, old.result_confirmed_by_role, old.result_lesson) then
      raise exception 'ยืนยันผลต่อโพสต์ผ่าน content_post_verdict_confirm เท่านั้น' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_content_post_result_guard on analytics.content_post;
create trigger trg_content_post_result_guard
  before insert or update on analytics.content_post
  for each row execute function analytics.content_post_result_guard();

-- ============================================================================
-- 4. content_post_metric_amend — แก้ยอดย้อนหลัง (owner เท่านั้น · หนี้ P2.1) — AI แก้ตัวเลขที่คนกรอก = ห้าม · tiktok_api ใช้ upsert ไม่ใช่ตัวนี้
--    ไม่ทำ: เปลี่ยน captured_on · ลบแถว · แก้ age_days · ย้อนกรอกวันที่พลาด (C3-7: ตัวเลขใน Studio วันนี้ ≠ เมื่อ 3 วันก่อน = แต่ง snapshot)
-- ============================================================================

create or replace function analytics.content_post_metric_amend(
  p_shop_id     uuid,
  p_post_id     uuid,
  p_captured_on date,
  p_set         jsonb,
  p_reason      text,
  p_actor_role  text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_cols          constant text[]  := array['view_count', 'like_count', 'comment_count', 'save_count', 'share_count'];
  c_max_days_back constant int     := 30;                     -- ค่าคงที่ที่เดียว: เกินนี้ = ตัวเลขถูกอ้างใน Weekly Brief แล้ว
  c_max_val       constant numeric := 1000000000000;
  v_today         date := (now() at time zone 'Asia/Bangkok')::date;
  v_reason        text;
  v_post          analytics.content_post%rowtype;
  v_m             analytics.content_post_metric%rowtype;
  v_k             text;
  v_v             jsonb;
  v_t             text;
  v_txt           text;
  v_bad           text;
  v_cleared       text[] := '{}';
  v_set_nums      text[] := '{}';
  v_before        jsonb;
  v_after         jsonb;
  v_changed       jsonb := '{}'::jsonb;
  v_changed_cols  text[] := '{}';
  v_amended       text[];
  v_reg           boolean;
  v_new_reg       boolean;
  v_recomputed    int := 0;
  v_log_id        uuid;
  r               record;
begin
  if p_shop_id is null or p_post_id is null or p_captured_on is null or p_set is null or p_reason is null then
    raise exception 'content_post_metric_amend: ต้องระบุร้าน โพสต์ วันที่ ค่าที่แก้ และเหตุผล' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_post_metric_amend');

  -- p_set: object ที่มี key ≥ 1 · key ทุกตัว ∈ 5 ชื่อ (key แปลกระบุชื่อ — กัน typo เงียบ) · ค่า: json null = ล้าง / number จำนวนเต็ม 0..1e12
  -- 🔴 ห้ามใช้ `p_set->>'x' is null` แยกสองกรณีไม่ได้ (SQL NULL vs JSON null — trap #13) ⇒ ใช้ jsonb_typeof
  if jsonb_typeof(p_set) is distinct from 'object' or p_set = '{}'::jsonb then
    raise exception 'content_post_metric_amend: ต้องส่ง object ที่มี key อย่างน้อย 1 (view_count/like_count/comment_count/save_count/share_count)'
      using errcode = '22023';
  end if;
  select string_agg(k.key, ', ' order by k.key) into v_bad
    from jsonb_object_keys(p_set) as k(key)
   where not (k.key = any (c_cols));
  if v_bad is not null then
    raise exception 'content_post_metric_amend: key ไม่รู้จัก: % (รับเฉพาะ %)', v_bad, array_to_string(c_cols, ', ') using errcode = '22023';
  end if;
  for v_k, v_v in select e.key, e.value from jsonb_each(p_set) as e loop
    v_t := jsonb_typeof(v_v);
    if v_t = 'null' then
      v_cleared := v_cleared || v_k;
    elsif v_t = 'number' then
      v_txt := v_v #>> '{}';
      -- ตัด 12.5 · 1.0 · ติดลบ · เกิน 13 หลัก (1e3 ถูก jsonb แปลงเป็น 1000 ก่อนถึงตรงนี้ — ตัดสินใจ G)
      if v_txt !~ '^[0-9]{1,13}$' or v_txt::numeric > c_max_val then
        raise exception 'content_post_metric_amend: % ต้องเป็นจำนวนเต็ม 0 ถึง 1,000,000,000,000 (ได้รับ %)', v_k, v_txt using errcode = '22023';
      end if;
      v_set_nums := v_set_nums || v_k;
    else
      raise exception 'content_post_metric_amend: % ตัวเลขต้องส่งเป็น number (หรือ null เพื่อล้าง) ไม่ใช่ข้อความ/ค่าจริงเท็จ/array/object', v_k
        using errcode = '22023';
    end if;
  end loop;

  v_reason := analytics.content_text_clean(p_reason);
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'content_post_metric_amend: ต้องระบุเหตุผล 3-500 ตัวอักษร' using errcode = '22023';
  end if;
  if analytics.content_marker_present(v_reason) then
    raise exception 'content_post_metric_amend: เหตุผลมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
  end if;

  select * into v_post from analytics.content_post where id = p_post_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_metric_amend: ไม่พบโพสต์ในร้านนี้' using errcode = '22023';
  end if;
  if v_post.status <> 'active' then
    raise exception 'content_post_metric_amend: โพสต์ถูกลบ/ซ่อน — เปิดกลับ (content_post_set_status) ก่อน' using errcode = '55000';
  end if;

  -- ขอบวัน (วันไทย): infinity / อนาคต = 22023 · เกิน 30 วัน = 55000 (จำเป็นจริงให้ Tech Lead ทำผ่าน SQL พร้อมบันทึก)
  if not isfinite(p_captured_on) then
    raise exception 'content_post_metric_amend: วันที่ต้องเป็นวันจริง (ไม่ใช่ infinity)' using errcode = '22023';
  end if;
  if p_captured_on > v_today then
    raise exception 'content_post_metric_amend: วันในอนาคต (%) — วันนี้ (ไทย) คือ %', p_captured_on, v_today using errcode = '22023';
  end if;
  if p_captured_on < v_today - c_max_days_back then
    raise exception 'content_post_metric_amend: เกิน % วัน — ตัวเลขถูกอ้างใน Weekly Brief แล้ว (จำเป็นจริงให้ Tech Lead ทำผ่าน SQL พร้อมบันทึก)', c_max_days_back
      using errcode = '55000';
  end if;

  select * into v_m from analytics.content_post_metric where post_id = p_post_id and captured_on = p_captured_on for update;
  if not found then
    raise exception 'content_post_metric_amend: ไม่มีแถวยอดวันที่ % — ย้อนกรอกไม่ได้ (ตัวเลขวันนั้นไม่มี snapshot)', p_captured_on using errcode = '22023';
  end if;

  -- ค่าหลังแก้ = ค่าเดิม ทับด้วย p_set (jsonb || ทับ key ซ้ำ · json null คงเป็น json null ⇒ ->> ได้ SQL NULL ตอนอ่านกลับ)
  v_before := jsonb_build_object('view_count', v_m.view_count, 'like_count', v_m.like_count, 'comment_count', v_m.comment_count,
                                 'save_count', v_m.save_count, 'share_count', v_m.share_count);
  v_after := v_before || p_set;
  if num_nonnulls((v_after->>'view_count')::bigint, (v_after->>'like_count')::bigint, (v_after->>'comment_count')::bigint,
                  (v_after->>'save_count')::bigint, (v_after->>'share_count')::bigint) = 0 then
    raise exception 'content_post_metric_amend: ล้างครบทุกช่องไม่ได้ — แถวว่างทำให้คิวกรอกยอดคิดว่าอ่านแล้ว (0149 H3)' using errcode = '55000';
  end if;
  if v_after = v_before then
    raise exception 'content_post_metric_amend: ไม่มีค่าเปลี่ยน — ห้ามบันทึกประวัติเปล่า' using errcode = '22023';
  end if;
  foreach v_k in array c_cols loop
    if (v_after -> v_k) is distinct from (v_before -> v_k) then
      v_changed_cols := v_changed_cols || v_k;
      v_changed := v_changed || jsonb_build_object(v_k, jsonb_build_object('from', v_before -> v_k, 'to', v_after -> v_k));
    end if;
  end loop;

  v_reg := analytics.content_post_metric_regression_(p_post_id, p_captured_on,
             (v_after->>'view_count')::bigint, (v_after->>'like_count')::bigint, (v_after->>'comment_count')::bigint,
             (v_after->>'save_count')::bigint, (v_after->>'share_count')::bigint);
  -- amended_cols = (เดิม ∪ key ที่ตั้งเป็น number) − key ที่ล้าง
  v_amended := coalesce((select array_agg(u.c order by u.c)
                           from (select unnest(v_m.amended_cols) as c union select unnest(v_set_nums) as c) as u
                          where not (u.c = any (v_cleared))), '{}'::text[]);

  update analytics.content_post_metric
     set view_count    = (v_after->>'view_count')::bigint,
         like_count    = (v_after->>'like_count')::bigint,
         comment_count = (v_after->>'comment_count')::bigint,
         save_count    = (v_after->>'save_count')::bigint,
         share_count   = (v_after->>'share_count')::bigint,
         source        = 'manual',
         sources       = (select array_agg(distinct s order by s) from unnest(sources || 'manual'::text) as s),
         amended_cols  = v_amended,
         is_regression = v_reg
   where id = v_m.id;

  -- คิด is_regression ใหม่ให้แถววันหลังของโพสต์นี้ (ค่าฐานเปลี่ยนแล้ว) · UPDATE เฉพาะแถวที่ธงเปลี่ยนจริง (trap #19)
  for r in select m.id, m.captured_on, m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count, m.is_regression
             from analytics.content_post_metric m
            where m.post_id = p_post_id and m.captured_on > p_captured_on
            order by m.captured_on
  loop
    v_new_reg := analytics.content_post_metric_regression_(p_post_id, r.captured_on, r.view_count, r.like_count, r.comment_count,
                                                           r.save_count, r.share_count);
    if r.is_regression is distinct from v_new_reg then
      update analytics.content_post_metric set is_regression = v_new_reg where id = r.id;
      v_recomputed := v_recomputed + 1;
    end if;
  end loop;

  insert into analytics.content_post_metric_amend_log
    (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, change_kind, actor_role, actor_uid)
  values (p_shop_id, v_m.id, p_post_id, p_captured_on, v_before, v_after, v_changed_cols, v_reason, 'amend', 'owner', auth.uid())
  returning id into v_log_id;

  return jsonb_build_object('metric_id', v_m.id, 'log_id', v_log_id, 'captured_on', p_captured_on, 'changed', v_changed,
                            'is_regression', v_reg, 'regression_recomputed', v_recomputed);
end;
$f$;

comment on function analytics.content_post_metric_amend(uuid, uuid, date, jsonb, text, text) is
  'แก้ยอดย้อนหลังของแถวที่มีอยู่ (owner เท่านั้น · เหตุผล 3-500 · ไม่เกิน 30 วันไทย · ไม่ย้อนกรอกวันที่ไม่มีแถว) · p_set = object ของ view_count/like_count/comment_count/'
  'save_count/share_count (number จำนวนเต็ม หรือ null เพื่อล้าง) · เขียน amend_log (before/after 5 คอลัมน์) + คิด is_regression ของแถววันหลังใหม่ · errcode 22023/42501/55000';

-- ============================================================================
-- 5. content_post_verdict_confirm — เจ้าของยืนยันป้ายผลต่อโพสต์ + บทเรียน (owner เท่านั้น) · AI ห้ามยืนยันแทน
--    ต้องมี snapshot T+7 (ยังสรุปไม่ได้ = ยืนยันไม่ได้) · compare-and-set กับป้ายที่ระบบคำนวณ (p_expected_computed) · ยืนยันซ้ำ/เปลี่ยนใจได้
--    ไม่เขียน content_piece_event · ไม่แตะ piece_status
-- ============================================================================

create or replace function analytics.content_post_verdict_confirm(
  p_shop_id           uuid,
  p_post_id           uuid,
  p_label             text,
  p_lesson            text,
  p_actor_role        text,
  p_expected_computed text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  c_lesson_max constant int := 300;   -- ตัดสินใจ D: = เพดาน content_signal.summary (สเปก 500 · ส่งต่อสัญญาณไม่ได้ถ้ายาวกว่านี้)
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_lesson     text;
  v_post       analytics.content_post%rowtype;
  v_t7_on      date;
  v_t7_why     text;
  v_computed   text;
  v_group      text;
  v_signal     uuid;
  v_created    boolean := false;
begin
  if p_shop_id is null or p_post_id is null or p_label is null then
    raise exception 'content_post_verdict_confirm: ต้องระบุร้าน โพสต์ และป้าย' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.content_actor_assert(p_actor_role, array['owner'], 'content_post_verdict_confirm');

  if p_label not in ('above', 'normal', 'below') then
    raise exception 'content_post_verdict_confirm: ป้ายต้องเป็น above / normal / below' using errcode = '22023';
  end if;
  if p_expected_computed is not null and p_expected_computed not in ('above', 'normal', 'below') then
    raise exception 'content_post_verdict_confirm: p_expected_computed ต้องเป็น above / normal / below (หรือ null = ไม่เทียบ)' using errcode = '22023';
  end if;

  -- null / ว่าง = ไม่มีบทเรียน · ข้อความที่ AI เขียนได้ใช้ content_text_clean (บทเรียน C1)
  v_lesson := nullif(analytics.content_text_clean(p_lesson), '');
  if v_lesson is not null then
    if length(v_lesson) > c_lesson_max then
      raise exception 'content_post_verdict_confirm: บทเรียนยาวเกิน % ตัวอักษร (ได้รับ %)', c_lesson_max, length(v_lesson) using errcode = '22023';
    end if;
    if analytics.content_marker_present(v_lesson) then
      raise exception 'content_post_verdict_confirm: บทเรียนมี [ต้องยืนยัน — ตอบให้ครบก่อนบันทึก' using errcode = '22023';
    end if;
  end if;

  select * into v_post from analytics.content_post where id = p_post_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'content_post_verdict_confirm: ไม่พบโพสต์ในร้านนี้' using errcode = '22023';
  end if;
  if v_post.status <> 'active' then
    raise exception 'content_post_verdict_confirm: โพสต์ถูกลบ/ซ่อน — ยืนยันผลไม่ได้' using errcode = '55000';
  end if;

  select t.t7_captured_on, t.t7_unavailable_reason into v_t7_on, v_t7_why
    from analytics.v_content_post_t7 t where t.post_id = p_post_id;
  if v_t7_on is null then
    raise exception 'content_post_verdict_confirm: ยังสรุปไม่ได้: ไม่มี snapshot ช่วง T+7 (%)', coalesce(v_t7_why, 'ไม่ทราบเหตุ') using errcode = '55000';
  end if;

  -- compare-and-set: UI ส่งป้ายที่ระบบคำนวณซึ่งเจ้าของเห็นมา · ต่างจากปัจจุบัน (รวม null ↔ มีค่า) = ปฏิเสธ
  select r.computed_label into v_computed from analytics.v_content_post_result r where r.post_id = p_post_id;
  if p_expected_computed is not null and v_computed is distinct from p_expected_computed then
    raise exception 'content_post_verdict_confirm: ป้ายที่ระบบคำนวณเปลี่ยนไปแล้ว (ตอนนี้ %) — รีเฟรชก่อนยืนยัน', coalesce(v_computed, 'ยังไม่มี') using errcode = '55000';
  end if;

  update analytics.content_post
     set result_label_override = p_label, result_confirmed_at = now(), result_confirmed_by_role = 'owner', result_lesson = v_lesson
   where id = p_post_id;

  -- บทเรียน → สัญญาณ insight (เฉพาะเมื่อยังไม่มีข้อความเดียวกันของโพสต์นี้ · ข้อความต่างกัน = สัญญาณใหม่ · ของเก่าเจ้าของ set_status เอง)
  if v_lesson is not null then
    select s.id into v_signal
      from analytics.content_signal s
     where s.shop_id = p_shop_id and s.kind = 'insight' and s.origin_post_id = p_post_id and s.summary = v_lesson
     limit 1;
    if v_signal is null then
      select cs.customer_group into v_group from analytics.campaign_step cs where cs.id = v_post.step_id;
      v_signal := analytics.content_signal_capture(
        p_shop_id => p_shop_id, p_kind => 'insight', p_summary => v_lesson, p_source => 'owner', p_seen_on => v_today,
        p_customer_group => v_group, p_origin_post_id => p_post_id, p_confidence => 'observation', p_actor_role => 'owner');
      v_created := true;
    end if;
  end if;

  return jsonb_build_object('post_id', p_post_id, 'label', p_label, 'computed_label', v_computed,
                            'previous_label', v_post.result_label_override, 'previous_lesson', v_post.result_lesson,
                            'signal_id', v_signal, 'signal_created', v_created);
end;
$f$;

comment on function analytics.content_post_verdict_confirm(uuid, uuid, text, text, text, text) is
  'เจ้าของยืนยันป้ายผลต่อโพสต์ (above/normal/below) + บทเรียน ≤300 ตัวอักษร (owner เท่านั้น) · ต้องมี snapshot T+7 · p_expected_computed = compare-and-set กับป้ายที่ระบบคำนวณ '
  '(null = ไม่เทียบ) · บทเรียน → content_signal insight (ไม่สร้างซ้ำถ้าข้อความเดิม) · ยืนยันซ้ำทับ result_* ได้ (previous_* คืนค่าเก่า) · errcode 22023/42501/55000';

-- ============================================================================
-- 6. view — ใหม่ทั้งหมด · security_invoker · ไม่ replace view เดิม (0149/0160 คงเดิม · trap #3) · ไม่กรองร้าน (frontend .eq('shop_id'))
--    วันไทยทุกจุด (trap #6 — ไม่มี current_date) · ไม่ซ้อนบน v_content_piece (D15) · ไม่มี host_* (มติ Q11)
-- ============================================================================

-- หน้า J "พลาดรอบไปแล้ว" — 1 แถว/โพสต์/หน้าต่างที่ปิดแล้วและไม่มีตัวเลข · ตารางหน้าต่าง (read_round, lo, hi) ลอกตรงจาก v_content_entry_queue (0149)
-- ⚠️ สองที่ต้องเท่ากันเสมอ (verify N3 เทียบ viewdef) · สูตร "มีตัวเลข" = num_nonnulls(5 col) > 0 เดียวกับคิว (0149 H3)
-- หน้าต่าง 3 (T+7) พลาด = โพสต์ตกจากการเทียบถาวร — view ไม่แต่งค่าแทน (KPI def 2.1)
create or replace view analytics.v_content_post_missed_window
  with (security_invoker = true) as
select
  p.id as post_id,
  p.shop_id,
  p.platform,
  p.post_url,
  p.posted_at,
  p.posted_date_th,
  p.step_id,
  p.hook_id,
  ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) as age_days_today,
  r.read_round,
  r.lo as window_lo,
  r.hi as window_hi,
  (p.posted_date_th + r.hi) as window_closed_on
from analytics.content_post p
cross join lateral (values (1, 1, 2), (2, 3, 4), (3, 5, 9)) as r (read_round, lo, hi)
where p.status = 'active'
  and ((now() at time zone 'Asia/Bangkok')::date - p.posted_date_th) > r.hi
  and not exists (
    select 1 from analytics.content_post_metric m
     where m.post_id = p.id
       and m.age_days >= r.lo and m.age_days <= r.hi
       and num_nonnulls(m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count) > 0)
order by p.posted_at desc;

-- หน้า K ต่อโพสต์ — 1 แถว/โพสต์ active ทุก platform (LINE ไม่มีแถว content_post = ไม่มีผลรายชิ้นโดยโครงสร้าง)
-- ฐานเทียบ = 10 โพสต์ "ก่อนหน้า" โพสต์นั้น (platform เดียวกัน · มี T+7 + save_rate) — ป้ายนิ่ง ไม่สั่นเมื่อโพสต์ใหม่เข้ามา (C3-6)
-- above = save_rate > p75 · below = < p25 · normal = ระหว่าง · ฐาน < 4 = ยังสรุปไม่ได้ · computed_label = save_label (สัญญาณหลัก KPI def §4)
-- เทียบด้วย p25/p75 ที่ปัดแล้ว (4 ตำแหน่ง) = ตัวเลขเดียวกับที่ UI แสดง ⇒ คำนวณซ้ำด้วยมือได้ตรง
-- perf (D19): lateral ×(≤10) บน v_content_post_t7 ซึ่ง lateral เองอีกชั้น — วันนี้ 10 โพสต์ ≈ ms · เกิน ~300 โพสต์ค่อย materialize
create or replace view analytics.v_content_post_result
  with (security_invoker = true) as
select
  x.post_id, x.shop_id, x.platform, x.external_id, x.post_url, x.posted_at, x.posted_date_th, x.content_type_code,
  x.caption_snapshot, x.step_id, x.hook_id,
  x.t7_captured_on, x.t7_age_days, x.t7_view_count, x.t7_save_count, x.t7_share_count,
  x.save_rate, x.share_rate, x.t7_is_regression, x.t7_unavailable_reason,
  x.baseline_n, x.baseline_save_p25, x.baseline_save_p50, x.baseline_save_p75,
  x.baseline_share_n, x.baseline_share_p25, x.baseline_share_p50, x.baseline_share_p75,
  l1.save_label,
  l1.share_label,
  l1.save_label as computed_label,
  case
    when x.t7_captured_on is null then 'ไม่มี snapshot T+7: ' || coalesce(x.t7_unavailable_reason, 'ไม่ทราบเหตุ')
    when x.save_rate is null then 'ไม่มีค่า save ที่ T+7'
    when x.baseline_n < 4 then format('ยังสรุปไม่ได้ (%s/4)', x.baseline_n)
  end as computed_reason,
  x.result_label_override, x.result_confirmed_at, x.result_lesson,
  coalesce(x.result_label_override, l1.save_label) as effective_label,
  case when x.result_label_override is not null then 'owner'
       when l1.save_label is not null then 'computed'
       else 'none' end as label_source,
  x.hook_text, x.hook_type, x.hook_label, x.hook_origin,
  x.step_title, x.piece_kind, x.customer_group, x.campaign_id, x.campaign_name,
  x.regression_any
from (
  select
    p.id as post_id, p.shop_id, p.platform, p.external_id, p.post_url, p.posted_at, p.posted_date_th, p.content_type_code,
    p.caption_snapshot, p.step_id, p.hook_id,
    t7.t7_captured_on, t7.t7_age_days, t7.t7_view_count, t7.t7_save_count, t7.t7_share_count,
    t7.save_rate, t7.share_rate, t7.t7_is_regression, t7.t7_unavailable_reason,
    b.baseline_n, b.baseline_save_p25, b.baseline_save_p50, b.baseline_save_p75,
    b.baseline_share_n, b.baseline_share_p25, b.baseline_share_p50, b.baseline_share_p75,
    p.result_label_override, p.result_confirmed_at, p.result_lesson,
    h.text as hook_text, h.hook_type, h.label as hook_label, h.origin as hook_origin,
    cs.title as step_title, cs.piece_kind, cs.customer_group, c.id as campaign_id, c.name as campaign_name,
    exists (select 1 from analytics.content_post_metric m where m.post_id = p.id and m.is_regression) as regression_any
  from analytics.content_post p
  join analytics.v_content_post_t7 t7 on t7.post_id = p.id
  left join lateral (
    select
      count(q.save_rate)::int as baseline_n,
      round((percentile_cont(0.25) within group (order by q.save_rate))::numeric, 4) as baseline_save_p25,
      round((percentile_cont(0.5) within group (order by q.save_rate))::numeric, 4) as baseline_save_p50,
      round((percentile_cont(0.75) within group (order by q.save_rate))::numeric, 4) as baseline_save_p75,
      count(q.share_rate)::int as baseline_share_n,
      round((percentile_cont(0.25) within group (order by q.share_rate))::numeric, 4) as baseline_share_p25,
      round((percentile_cont(0.5) within group (order by q.share_rate))::numeric, 4) as baseline_share_p50,
      round((percentile_cont(0.75) within group (order by q.share_rate))::numeric, 4) as baseline_share_p75
    from (
      select b0.save_rate, b0.share_rate
        from analytics.v_content_post_t7 b0
       where b0.shop_id = p.shop_id and b0.platform = p.platform and b0.status = 'active'
         and b0.t7_captured_on is not null and b0.save_rate is not null
         and (b0.posted_at, b0.post_id) < (p.posted_at, p.id)
       order by b0.posted_at desc, b0.post_id desc
       limit 10
    ) q
  ) b on true
  left join analytics.content_hook h on h.id = p.hook_id
  left join analytics.campaign_step cs on cs.id = p.step_id
  left join analytics.campaign c on c.id = cs.campaign_id
  where p.status = 'active'
) x
cross join lateral (
  select
    case when x.t7_captured_on is null or x.save_rate is null or x.baseline_n < 4 then null
         when x.save_rate > x.baseline_save_p75 then 'above'
         when x.save_rate < x.baseline_save_p25 then 'below'
         else 'normal' end as save_label,
    case when x.t7_captured_on is null or x.share_rate is null or x.baseline_share_n < 4 then null
         when x.share_rate > x.baseline_share_p75 then 'above'
         when x.share_rate < x.baseline_share_p25 then 'below'
         else 'normal' end as share_label
) l1
order by x.posted_at desc;

-- หน้า K ต่อ hook_type (ตารางดิบ) — เฉพาะ hook ของเรา (ours) ที่ติดประเภทและผูกโพสต์ active · ไม่มีมิติโฮสต์ (มติ Q11)
-- นิยาม n เดียวกับ v_content_hook_library.type_n_pieces (distinct step ที่มี T+7) ⇒ verdict ตรงกับ type_verdict (verify N6)
-- ตัดสินใจ E: verdict = ข้อความเดียวกับ library · verdict_detail มี (n/4) · library เก็บ avg (ของเดิม ไม่แตะ — D21) rollup ให้ median + ป้าย
create or replace view analytics.v_content_hook_type_rollup
  with (security_invoker = true) as
select
  r.shop_id,
  r.hook_type,
  count(*)::int as posts_n,
  count(distinct r.step_id)::int as pieces_n,
  (count(distinct r.step_id) filter (where r.t7_captured_on is not null))::int as measured_pieces_n,
  (count(*) filter (where r.t7_captured_on is not null))::int as measured_posts_n,
  (count(*) filter (where r.effective_label is not null))::int as labeled_n,
  (count(*) filter (where r.effective_label = 'above'))::int as above_n,
  (count(*) filter (where r.effective_label = 'normal'))::int as normal_n,
  (count(*) filter (where r.effective_label = 'below'))::int as below_n,
  round((percentile_cont(0.5) within group (order by r.save_rate) filter (where r.t7_captured_on is not null))::numeric, 4) as median_save_rate,
  round((percentile_cont(0.5) within group (order by r.share_rate) filter (where r.t7_captured_on is not null))::numeric, 4) as median_share_rate,
  max(r.t7_captured_on) as last_measured_on,
  case when (count(distinct r.step_id) filter (where r.t7_captured_on is not null)) < 4
       then 'ยังสรุปไม่ได้' else 'สรุปได้' end as verdict,
  case when (count(distinct r.step_id) filter (where r.t7_captured_on is not null)) < 4
       then format('ยังสรุปไม่ได้ (%s/4)', count(distinct r.step_id) filter (where r.t7_captured_on is not null))
       else format('สรุปได้ (%s ชิ้น)', count(distinct r.step_id) filter (where r.t7_captured_on is not null)) end as verdict_detail
from analytics.v_content_post_result r
where r.hook_id is not null and r.hook_origin = 'ours' and r.hook_type is not null
group by r.shop_id, r.hook_type;

-- metric ออเดอร์ (ตัดสินใจ F) — นับ distinct ออเดอร์จาก fact_order ต่อ (shop · order_date · ช่องทาง · affinity) · ไม่มีเงิน/ต้นทุน/PII
-- affinity: 'all' = ทุกออเดอร์ · 'bar' / 'jewelry' = ออเดอร์ที่มีสินค้าฝั่งนั้นอย่างน้อย 1 รายการ (ตะกร้าผสมนับทั้งสองแถว ⇒ bar + jewelry อาจ > all)
-- จัดฝั่งผ่าน v_product_affinity จุดเดียว (SKU ไม่รู้จัก/neutral ไม่นับเป็น bar หรือ jewelry — กันเดาผิดตาม 0099) · ออเดอร์ไม่มี line item = นับใน 'all' เท่านั้น
-- ใช้: sum(orders_n) where shop_id = ? and order_date between ? and ? and channel_code = ? and affinity = ? (ช่วงวัน = order_date ตามที่ import มา)
-- not materialized: ให้ predicate shop_id/order_date ของ frontend ถูกดันลงไปกรอง fact_order ก่อน group
create or replace view analytics.v_content_order_daily
  with (security_invoker = true) as
with ord as not materialized (
  select
    fo.shop_id,
    fo.id as order_id,
    fo.order_date,
    dc.code as channel_code,
    coalesce(bool_or(pa.affinity_group = 'bar'), false) as has_bar,
    coalesce(bool_or(pa.affinity_group = 'jewelry'), false) as has_jewelry
  from analytics.fact_order fo
  join analytics.dim_channel dc on dc.id = fo.channel_id
  left join analytics.fact_order_item fi on fi.fact_order_id = fo.id
  left join analytics.v_product_affinity pa on pa.product_id = fi.product_id
  group by fo.shop_id, fo.id, fo.order_date, dc.code
)
select o.shop_id, o.order_date, o.channel_code, 'all'::text as affinity, count(*)::int as orders_n
  from ord o group by o.shop_id, o.order_date, o.channel_code
union all
select o.shop_id, o.order_date, o.channel_code, 'bar'::text, count(*)::int
  from ord o where o.has_bar group by o.shop_id, o.order_date, o.channel_code
union all
select o.shop_id, o.order_date, o.channel_code, 'jewelry'::text, count(*)::int
  from ord o where o.has_jewelry group by o.shop_id, o.order_date, o.channel_code;

-- ============================================================================
-- 7. grant — revoke ครบสามชื่อ แล้ว grant service_role อย่างเดียว (trap #2/#18)
--    ฟังก์ชันวนจาก pg_proc ตามรายชื่อเดียวกับ snapshot/ด่านท้ายไฟล์ ⇒ ฟังก์ชันที่เพิ่ม/ลืม ไม่หลุด grant · รวม content_piece_enum_ok_ ที่ replace ในไฟล์นี้
-- ============================================================================

do $c4grant$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_post_metric_regression_$|content_post_metric_guard$|content_post_metric_amend_log_append_only$|content_post_result_guard$|content_post_metric_amend$|content_post_verdict_confirm$|content_piece_enum_ok_$)'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$c4grant$;

revoke all on analytics.v_content_post_missed_window, analytics.v_content_post_result, analytics.v_content_hook_type_rollup,
  analytics.v_content_order_daily from public, anon, authenticated;
grant select on analytics.v_content_post_missed_window, analytics.v_content_post_result, analytics.v_content_hook_type_rollup,
  analytics.v_content_order_daily to service_role;

comment on view analytics.v_content_post_missed_window is
  'หน้า J "พลาดรอบไปแล้ว" — 1 แถว/โพสต์/หน้าต่างอ่านยอด (1=T+1..2, 2=T+3..4, 3=T+5..9) ที่ปิดแล้วและไม่มีตัวเลข · หน้าต่างเดียวกับ v_content_entry_queue · '
  'ไม่กรองร้าน (frontend .eq(shop_id)) · หน้าต่าง 3 พลาด = โพสต์ตกจากการเทียบถาวร ไม่แต่งค่าแทน';
comment on view analytics.v_content_post_result is
  'ผลต่อโพสต์ (หน้า K) — save_rate/share_rate ที่ T+7 เทียบฐาน 10 โพสต์ก่อนหน้า (platform เดียวกัน) · computed_label = ป้ายตาม save (above>p75 · below<p25) · ฐาน<4 = null + computed_reason · '
  'effective_label = ป้ายที่เจ้าของยืนยัน ถ้ามี · ไม่มีมิติโฮสต์ (มติ Q11) · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on view analytics.v_content_hook_type_rollup is
  'rollup ต่อ hook_type ของเรา (หน้า K) — n = ชิ้นที่มี T+7 (นิยามเดียวกับ v_content_hook_library.type_n_pieces) · median save/share + จำนวนป้าย · '
  'verdict ตรงกับ type_verdict ของ library · ไม่มีมิติโฮสต์ (มติ Q11) · ไม่กรองร้าน';
comment on view analytics.v_content_order_daily is
  'จำนวนออเดอร์ต่อวัน (order_date) × ช่องทาง (dim_channel.code) × affinity (all/bar/jewelry) จาก fact_order — metric_code=orders · bar/jewelry = มีสินค้าฝั่งนั้น ≥1 รายการ '
  '(ตะกร้าผสมนับทั้งสองแถว) · ไม่มีเงิน/PII · ไม่กรองร้าน (frontend .eq(shop_id))';
comment on function analytics.content_post_metric_regression_(uuid, date, bigint, bigint, bigint, bigint, bigint) is
  'สูตร is_regression เดียวกับ content_post_metric_upsert (0148 H1) — ต่ำกว่า max ของแถววันก่อนหน้า · ⚠️ สองที่ต้องเท่ากัน (D22) · verify-0161 Y24/N4 เทียบกับข้อมูลจริง';

-- ============================================================================
-- 8. ด่านท้ายไฟล์ — ของเดิมต้องไม่ขยับ + ผลลัพธ์ต้องถูก (raise = ถอยทั้งก้อน · แบบ 0160 §8)
--    ไม่ assert "amended_cols ว่างทุกแถว" ที่นี่ — ไฟล์ idempotent รันซ้ำหลังเจ้าของแก้ยอดแล้วต้องผ่าน (ส่วนนั้นอยู่ verify-0161 N1)
-- ============================================================================

do $c4final$
declare
  v_now text;
  v_bad text;
  v_k   text;
  c_fn  constant text := '^(content_post_metric_regression_$|content_post_metric_guard$|content_post_metric_amend_log_append_only$|content_post_result_guard$|content_post_metric_amend$|content_post_verdict_confirm$)';
  c_rel constant text[] := array['v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily'];
begin
  foreach v_k in array array['c4.snap_metric', 'c4.snap_post', 'c4.snap_step', 'c4.snap_campaign', 'c4.snap_reco', 'c4.snap_views', 'c4.snap_funcs'] loop
    if coalesce(current_setting(v_k, true), '') = '' then
      raise exception '0161 ด่านท้าย: ไม่พบ snapshot % — ไฟล์นี้ต้องรันทั้งไฟล์ในทรานแซกชันเดียวผ่าน scripts/run-sql.mjs เท่านั้น', v_k;
    end if;
  end loop;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, view_count, like_count, comment_count, save_count, share_count,
           is_regression, source, array_to_string(sources, ','), captured_at, captured_on, age_days), E'\n' order by id), ''))
    into v_now from analytics.content_post_metric;
  if v_now is distinct from current_setting('c4.snap_metric', true) then
    raise exception '0161 ด่านท้าย: content_post_metric เดิมเปลี่ยน (ไฟล์นี้ไม่มี UPDATE/backfill — ยอด/ธง/แหล่งต้องไม่ขยับ)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, step_id, hook_id, post_url, posted_at, updated_at), E'\n' order by id), ''))
    into v_now from analytics.content_post;
  if v_now is distinct from current_setting('c4.snap_post', true) then
    raise exception '0161 ด่านท้าย: content_post เปลี่ยน (trap #19 — add column/constraint ต้องไม่ยิง updated_at)';
  end if;

  select count(*)::text || ':' || count(distinct updated_at)::text || ':' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, piece_status, metric_code, hold_reason, updated_at), E'\n' order by id), ''))
    into v_now from analytics.campaign_step;
  if v_now is distinct from current_setting('c4.snap_step', true) then
    raise exception '0161 ด่านท้าย: campaign_step เปลี่ยน (drop/add CHECK ต้องไม่แตะแถว)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, status, result_verdict, result_note, hypothesis, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.campaign;
  if v_now is distinct from current_setting('c4.snap_campaign', true) then
    raise exception '0161 ด่านท้าย: campaign เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, owner_action, acted_at, outcome_note, updated_at),
           E'\n' order by id), ''))
    into v_now from analytics.recommendation_log;
  if v_now is distinct from current_setting('c4.snap_reco', true) then
    raise exception '0161 ด่านท้าย: recommendation_log เปลี่ยน';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname), ''))
    into v_now
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname <> all (c_rel);
  if v_now is distinct from current_setting('c4.snap_views', true) then
    raise exception '0161 ด่านท้าย: definition ของ view เดิมเปลี่ยน (รวม v_content_post_t7 / v_content_entry_queue / v_content_hook_library — trap #3 ห้ามแตะ view เดิม)';
  end if;

  select count(*)::text || ':' || md5(coalesce(string_agg(p.oid::regprocedure::text || '=' || pg_get_functiondef(p.oid), E'\n'
           order by p.oid::regprocedure::text), ''))
    into v_now
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.proname !~ '^(content_post_metric_regression_$|content_post_metric_guard$|content_post_metric_amend_log_append_only$|content_post_result_guard$|content_post_metric_amend$|content_post_verdict_confirm$|content_piece_enum_ok_$)';
  if v_now is distinct from current_setting('c4.snap_funcs', true) then
    raise exception '0161 ด่านท้าย: มีฟังก์ชันเดิมที่ไม่ใช่ของไฟล์นี้ถูกเปลี่ยน/เพิ่ม/หาย (รวม 0148 content_post_metric_upsert / 0158 / 0159 / 0160) — ยกเว้นเฉพาะ content_piece_enum_ok_ ที่ตั้งใจแทนที่';
  end if;

  -- trap #1: ฟังก์ชันของไฟล์นี้ (+ enum_ok_) ต้องมี signature เดียวต่อชื่อ · ครบ 6 ตัวใหม่
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) as n from pg_proc p
           where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and (p.proname ~ c_fn or p.proname = 'content_piece_enum_ok_')
           group by p.proname having count(*) > 1) x;
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: ฟังก์ชันมี overload ค้าง — หยุดแล้วรายงาน: %', v_bad;
  end if;
  select count(*) into v_now from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn;
  if v_now::int <> 6 then
    raise exception '0161 ด่านท้าย: คาดฟังก์ชันของไฟล์นี้ 6 ตัว (helper 1 + trigger 3 + RPC 2) พบ %', v_now;
  end if;

  -- trigger ด่านตารางต้องมี เปิดอยู่ (tgenabled = 'O') ชี้ฟังก์ชันถูกตัว และชนิดครบ (ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32)
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_post_metric'::regclass and t.tgname = 'trg_content_post_metric_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_post_metric_guard()'::regprocedure and (t.tgtype & 31) = 31) then
    raise exception '0161 ด่านท้าย: trigger trg_content_post_metric_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_post'::regclass and t.tgname = 'trg_content_post_result_guard' and not t.tgisinternal
                    and t.tgenabled = 'O' and t.tgfoid = 'analytics.content_post_result_guard()'::regprocedure and (t.tgtype & 23) = 23) then
    raise exception '0161 ด่านท้าย: trigger trg_content_post_result_guard ไม่ครบ (ต้อง BEFORE INSERT OR UPDATE FOR EACH ROW เปิดอยู่)';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_post_metric_amend_log'::regclass and t.tgname = 'trg_content_post_metric_amend_log_append_only'
                    and not t.tgisinternal and t.tgenabled = 'O' and (t.tgtype & 27) = 27)
     or not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'analytics.content_post_metric_amend_log'::regclass and t.tgname = 'trg_content_post_metric_amend_log_deny_truncate'
                    and not t.tgisinternal and t.tgenabled = 'O' and (t.tgtype & 34) = 34) then
    raise exception '0161 ด่านท้าย: trigger append-only ของ content_post_metric_amend_log ไม่ครบ (UPDATE/DELETE แถว + TRUNCATE)';
  end if;
  -- trigger เดิมของ content_post ต้องยังอยู่ครบ (link_guard · updated_at) — ไม่ถูก drop/แทนโดยไฟล์นี้
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.content_post'::regclass and not t.tgisinternal) <> 3 then
    raise exception '0161 ด่านท้าย: trigger บน content_post ต้องเหลือ 3 ตัว (link_guard · result_guard · updated_at)';
  end if;

  -- metric 'orders': CHECK + helper ตรงกัน และค่าเดิมยังใช้ได้
  if pg_get_constraintdef((select c.oid from pg_constraint c where c.conrelid = 'analytics.campaign_step'::regclass
                            and c.conname = 'campaign_step_metric_code_check')) !~ 'orders'
     or not (analytics.content_piece_enum_ok_('metric_code', 'orders') and analytics.content_piece_enum_ok_('metric_code', 'none')
             and analytics.content_piece_enum_ok_('metric_code', 'save_rate') and analytics.content_piece_enum_ok_('metric_code', 'line_reply_count')
             and not analytics.content_piece_enum_ok_('metric_code', 'nope')) then
    raise exception '0161 ด่านท้าย: metric_code orders ไม่ตรงกันระหว่าง CHECK ของ campaign_step กับ content_piece_enum_ok_';
  end if;

  -- trap #18: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (coalesce proacl — default = PUBLIC execute)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and (p.proname ~ c_fn or p.proname = 'content_piece_enum_ok_') and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: grant รั่ว (PUBLIC/anon/authenticated) บนฟังก์ชัน %', v_bad;
  end if;
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and (c.relname = any (c_rel) or c.relname = 'content_post_metric_amend_log')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: grant รั่วบน view/ตาราง: %', v_bad;
  end if;
  -- amend_log: service_role ต้องอ่านได้อย่างเดียว (เขียนผ่าน RPC/trigger เท่านั้น)
  select string_agg(a.privilege_type, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_post_metric_amend_log'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: service_role เขียนตรงลง amend_log ได้ (%) — ต้องมีแค่ SELECT', v_bad;
  end if;
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel)
     and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: view ไม่ได้เป็น security_invoker: %', v_bad;
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.content_post_metric_amend_log'::regclass) then
    raise exception '0161 ด่านท้าย: content_post_metric_amend_log ไม่ได้เปิด RLS';
  end if;

  -- N18: วันไทย — ไม่มี current_date ใน view/ฟังก์ชันใหม่ · view ที่คิดวันต้องมี Asia/Bangkok · ไม่มีชื่อจริงโฮสต์/live_session_log ในผลต่อโพสต์ (Q11)
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname = any (c_rel)
     and (pg_get_viewdef(c.oid) ~* 'current_date' or pg_get_viewdef(c.oid) ~* 'display_name'
          or (c.relname in ('v_content_post_result', 'v_content_hook_type_rollup')
              and (pg_get_viewdef(c.oid) ~* 'live_session_log' or pg_get_viewdef(c.oid) ~* 'host_')));
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: view มี current_date / display_name / โฮสต์ (วันไทยเท่านั้น · ผลต่อโพสต์ไม่ผูกโฮสต์ มติ Q11): %', v_bad;
  end if;
  if pg_get_viewdef('analytics.v_content_post_missed_window'::regclass) !~ 'Asia/Bangkok' then
    raise exception '0161 ด่านท้าย: v_content_post_missed_window ต้องใช้ Asia/Bangkok';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname ~ c_fn and pg_get_functiondef(p.oid) ~* 'current_date';
  if v_bad is not null then
    raise exception '0161 ด่านท้าย: ฟังก์ชันมี current_date: %', v_bad;
  end if;
  if pg_get_functiondef('analytics.content_post_metric_amend(uuid,uuid,date,jsonb,text,text)'::regprocedure) !~ 'Asia/Bangkok'
     or pg_get_functiondef('analytics.content_post_verdict_confirm(uuid,uuid,text,text,text,text)'::regprocedure) !~ 'Asia/Bangkok' then
    raise exception '0161 ด่านท้าย: RPC ที่คิดวันต้องใช้ Asia/Bangkok';
  end if;

  raise notice '0161 ด่านท้าย: ผ่าน — ของเดิมไม่ขยับ (metric/post/step/campaign/reco/view/ฟังก์ชัน รวม 0148 upsert · 0158 · 0159 · 0160) · '
               'ไม่มี overload · trigger ครบ · grant สะอาด · view security_invoker · วันไทย · ไม่มีโฮสต์ในผลต่อโพสต์';
end
$c4final$;

-- ให้ PostgREST รู้จักฟังก์ชัน/view ใหม่ทันที — ใน dry-run ที่ ROLLBACK ไม่ถูกส่งออกไป
notify pgrst, 'reload schema';
