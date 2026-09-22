-- 0145_content_taxonomy.sql
-- P1 ของชั้นวัดผล content (design approved, Tech Lead brief 22 ก.ย. 69).
-- เหตุผล: campaign_step.goal_kpi เป็น free text (0057) — 40+ ค่าไม่ซ้ำ วัดผล
-- ไม่ได้จริง. ไฟล์นี้เพิ่มชั้น "โครงสร้าง" คู่ขนาน (goal_kpi_code) ที่ backfill
-- ได้จาก step_kind อย่างปลอดภัย โดยไม่แตะ goal_kpi เดิมแม้แต่ตัวอักษรเดียว —
-- เจ้าของ/ทีมยังอ่านข้อความเดิมได้ครบ ส่วนแดชบอร์ดในอนาคตวัดผลจาก _code แทน.
--
-- Additive only: create table ใหม่ + alter table แบบเพิ่มคอลัมน์ (nullable) +
-- create or replace view ที่ต่อท้ายคอลัมน์เดิมเท่านั้น ไม่ drop/rename/แก้ชนิด
-- คอลัมน์เดิมที่ไหนเลย.
--
-- ============================================================================
-- 🔴 ของจริงชนะบรีฟ — ผลตรวจ DB สดที่ต่างจาก skill/brief ตัวอย่างเดิม:
--
-- 1. หลัง 0122→0123→0124 (16 ก.ย. 69, "A2-lite") ทั้งสคีมา analytics ถูก
--    revoke usage/select จาก anon+authenticated แล้ว "ทุกจุด" (grepped แล้ว:
--    ทุก reader ของ analytics.* ผ่าน getServiceClient() เท่านั้น ไม่มี
--    getUserClient()/anon-key ตรงเข้า schema นี้) + default privilege ก็ถูก
--    revoke ไว้ล่วงหน้าไม่ให้ตารางใหม่ auto-grant authenticated อีก (0123 M-1).
--    migrations หลัง 0123 ทุกตัว (ตรวจแล้ว 0131/0138/0140/0141/0143/0144)
--    grant ให้ service_role อย่างเดียว ไม่มี `to authenticated` แล้ว —
--    brief นี้/สกิล 3j-migration-traps อ้างแพตเทิร์นเก่าของ live_session_log
--    (0121, ก่อน 0123) ที่ grant ให้ authenticated ด้วย ถ้าทำตามนั้นตรงๆ
--    = เปิดรูที่ 0123 เพิ่งปิดกลับมาใหม่สำหรับอ็อบเจกต์ในไฟล์นี้. ไฟล์นี้จึง
--    grant table/view select ให้ service_role อย่างเดียว ตาม convention ล่าสุด
--    (RLS policy ยังเขียนไว้เผื่ออนาคต role มาจาก session เต็มรูปแบบแล้ว
--    analytics ถูกเปิด REST อีกครั้ง — แต่วันนี้ policy เป็นแค่ defense-in-depth
--    เพราะ GRANT/USAGE ระดับ schema ยังปิดอยู่).
--
-- 2. v_campaign_board ปัจจุบัน (query pg_get_viewdef สดวันนี้) มี reloption
--    security_invoker=true และ 33 คอลัมน์ — ตรงกับที่บรีฟบอก (ยืนยันด้วย
--    query จริง ไม่ได้ลอกจากไฟล์ 0060) จึงใช้ select list ที่ลอกจากนิยามสดนี้
--    ต่อท้าย 3 คอลัมน์ตามบรีฟ.
-- ============================================================================

-- ============================================================================
-- 1. analytics.content_type — reference lookup, เพิ่มประเภทใหม่ด้วย INSERT
--    (ไม่ต้อง deploy) เหมือนแพตเทิร์น campaign_template (0057) / oem_rate_def
--    (0061). ไม่ shop-scoped (สีเป็นมาตรฐานของแบรนด์ ไม่ใช่ต่อร้าน).
-- ============================================================================

create table if not exists analytics.content_type (
  code       text primary key,
  label_th   text not null,
  -- lower-case บังคับ: กัน '#A2191D' ปนกับ '#a2191d' เป็นคีย์คนละตัวเงียบๆ —
  -- ตัดสินใจเองนอกบรีฟ: เติม not null ให้ sort_order/is_active (บรีฟบอกแค่
  -- "default") เพราะทุกตาราง lookup อื่นในโปรเจกต์นี้ (oem_rate_def เป็นต้น)
  -- ไม่ยอมให้ค่าพวกนี้เป็น null โดยไม่ตั้งใจ.
  color_hex  text not null check (color_hex ~ '^#[0-9a-f]{6}$'),
  sort_order int not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table analytics.content_type is
  'Reference: ประเภทเนื้อหาสำหรับแท็กคอนเทนต์ (campaign_step.content_type_code) — '
  'สีคุมโดยเจ้าของ (0145 seed) ห้าม re-palette เอง. เพิ่มประเภทใหม่ = insert แถวใหม่.';

alter table analytics.content_type enable row level security;

drop policy if exists read_all on analytics.content_type;
create policy read_all on analytics.content_type
  for select
  using (true);

grant select on analytics.content_type to service_role;

insert into analytics.content_type (code, label_th, color_hex, sort_order) values
  ('drive_live', 'พาเข้าไลฟ์', '#a2191d', 10),
  ('knowledge', 'ความรู้', '#1f3a5f', 20),
  ('craft', 'ช่าง/โรงงาน', '#6b4a2e', 30),
  ('customer', 'ลูกค้า/ความสัมพันธ์', '#4f7f6a', 40),
  ('announce', 'เทศกาล/ประกาศ', '#8a8f94', 50)
on conflict (code) do update set
  label_th = excluded.label_th,
  color_hex = excluded.color_hex,
  sort_order = excluded.sort_order;

-- ============================================================================
-- 2. analytics.campaign_step — เพิ่ม 3 คอลัมน์ nullable ล้วน (additive)
--    goal_kpi เดิมไม่ถูกแตะ — ใส่ comment บอก deprecated-as-a-metric เท่านั้น.
-- ============================================================================

alter table analytics.campaign_step add column if not exists goal_kpi_code text;
alter table analytics.campaign_step add column if not exists goal_kpi_code_source text;
alter table analytics.campaign_step add column if not exists content_type_code text
  references analytics.content_type (code);

alter table analytics.campaign_step drop constraint if exists campaign_step_goal_kpi_code_check;
alter table analytics.campaign_step add constraint campaign_step_goal_kpi_code_check
  check (goal_kpi_code is null or goal_kpi_code in ('drive_live', 'drive_sku', 'collect_line', 'brand_no_sales'));

alter table analytics.campaign_step drop constraint if exists campaign_step_goal_kpi_code_source_check;
alter table analytics.campaign_step add constraint campaign_step_goal_kpi_code_source_check
  check (goal_kpi_code_source is null or goal_kpi_code_source in ('auto_step_kind', 'owner'));

comment on column analytics.campaign_step.goal_kpi is
  'DEPRECATED เป็นตัววัดผล (0145) — free text 40+ ค่าไม่ซ้ำ วัดผลอัตโนมัติไม่ได้. '
  'ข้อความเดิมยังอยู่ครบทุกแถว (ห้ามแตะ) — ใช้ goal_kpi_code สำหรับวัดผล/แดชบอร์ดแทน.';

comment on column analytics.campaign_step.goal_kpi_code is
  'ตัววัดผลแบบโครงสร้าง 4 ค่า (drive_live/drive_sku/collect_line/brand_no_sales) หรือ null '
  '= ยังไม่จัดประเภท. backfill อัตโนมัติจาก step_kind เฉพาะ kind ที่แปลความหมายได้ชัด (0145) — '
  'kind ที่กำกวม (content_task/vip_private_access/reconnect) ปล่อย null ตั้งใจ ไม่เดา.';

comment on column analytics.campaign_step.goal_kpi_code_source is
  '''auto_step_kind'' = ระบบ backfill ให้จาก step_kind (0145) · ''owner'' = เจ้าของ/ทีมกำหนดเอง '
  'ผ่านหน้าจอในอนาคต · null = ยังไม่มีการกำหนดใดๆ';

-- ============================================================================
-- 3. Backfill goal_kpi_code จาก step_kind เท่านั้น (structured, ไม่ parse
--    goal_kpi เดิม) — where guard กันทับค่าที่มีอยู่แล้ว (idempotent, และเผื่อ
--    อนาคตมี owner override ก่อน migration ถูกรันซ้ำ).
-- ============================================================================

update analytics.campaign_step
set
  goal_kpi_code = case step_kind
    when 'pre_live_hook' then 'drive_live'
    when 'teaser'        then 'drive_live'
    when 'live_cta'      then 'drive_live'
    when 'segment_offer' then 'drive_sku'
    when 'last_call'     then 'drive_sku'
    when 'main_day'      then 'drive_sku'
    when 'post_sale'     then 'drive_sku'
    when 'followup_nudge' then 'drive_sku'
    when 'insert_card'   then 'collect_line'
    else null
  end,
  goal_kpi_code_source = case
    when step_kind in (
      'pre_live_hook', 'teaser', 'live_cta',
      'segment_offer', 'last_call', 'main_day', 'post_sale', 'followup_nudge',
      'insert_card'
    ) then 'auto_step_kind'
    else null
  end
where goal_kpi_code is null
  and goal_kpi_code_source is null;

-- ============================================================================
-- 4. analytics.v_campaign_board — create or replace, ต่อท้าย 3 คอลัมน์ใหม่
--    เท่านั้น. select list ก่อนคอลัมน์ใหม่ = ลอกจาก
--    pg_get_viewdef('analytics.v_campaign_board'::regclass, true) สด
--    วันที่ 22 ก.ย. 69 คำต่อคำ (ยืนยันด้วย query จริง — คนละฉบับกับ 0060 ในไฟล์
--    ถ้าเคยมีคนแก้ view นี้นอก git history ให้เชื่อผลตรวจสดนี้เป็นหลัก)
--    ห้ามแทรกกลาง/เปลี่ยนชื่อ-ลำดับ-ชนิดคอลัมน์เดิมแม้แต่ตัวเดียว (42P16).
-- ============================================================================

create or replace view analytics.v_campaign_board
  with (security_invoker = true) as
select
  cs.id as step_id,
  cs.campaign_id,
  cs.shop_id,
  cp.name as campaign_name,
  cp.campaign_type,
  cp.trigger_kind,
  cp.status as campaign_status,
  cp.anchor_date,
  cp.primary_channels,
  cp.blocked_reason as campaign_blocked_reason,
  cp.note as campaign_note,
  cs.seq,
  cs.step_kind,
  cs.offset_start_days,
  cs.offset_end_days,
  case
    when cp.anchor_date is null then null::date
    else cp.anchor_date + cs.offset_start_days
  end as resolved_start,
  case
    when cp.anchor_date is null or cs.offset_end_days is null then null::date
    else cp.anchor_date + cs.offset_end_days
  end as resolved_end,
  case
    when cp.anchor_date is null then null::integer
    else cp.anchor_date + cs.offset_start_days - current_date
  end as days_until,
  cs.audience_segment,
  case
    when cs.audience_segment = any (array['champion'::text, 'loyal'::text, 'new'::text, 'at_risk'::text])
      then coalesce(rfm.live_count, 0)
    else null::integer
  end as audience_live_count,
  cs.channel,
  cs.goal_kpi,
  cs.status as step_status,
  cs.blocked_reason as step_blocked_reason,
  coalesce(art.artifacts, '[]'::jsonb) as artifacts,
  coalesce(art.art_total, 0::bigint) as art_total,
  coalesce(art.art_done, 0::bigint) as art_done,
  coalesce(gt.gates, '[]'::jsonb) as gates,
  case
    when coalesce(art.art_blocked, 0::bigint) > 0 or coalesce(gt.gate_blocked, 0::bigint) > 0 then 'blocked'::text
    when cs.audience_segment is not null and cp.trigger_kind = 'data_driven'::text
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'::text
    when (cs.audience_segment = any (array['silver_bar'::text, 'tiktok_buyer'::text, 'line_follower'::text]))
      and coalesce(rfm.live_count, 0) = 0 then 'waiting_data'::text
    else cs.status
  end as effective_status,
  cs.title as step_title,
  cp.source_reco_key,
  cs.origin as step_origin,
  to_char(cs.start_time::interval, 'HH24:MI'::text) as start_time,
  -- ---- 0145: คอลัมน์ใหม่ ต่อท้ายเท่านั้น ----
  cs.goal_kpi_code,
  cs.goal_kpi_code_source,
  cs.content_type_code
from analytics.campaign_step cs
  join analytics.campaign cp on cp.id = cs.campaign_id
  left join lateral (
    select count(*)::integer as live_count
    from analytics.v_rfm_segment r
    where cs.audience_segment is not null and r.shop_id = cs.shop_id and r.segment = cs.audience_segment
  ) rfm on true
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'id', sa.id, 'artifact_type', sa.artifact_type, 'owner_role', sa.owner_role,
        'source_doc', sa.source_doc, 'status', sa.status, 'is_dynamic', sa.is_dynamic,
        'dynamic_source', sa.dynamic_source, 'dynamic_ref', sa.dynamic_ref,
        'discount_pct', sa.discount_pct, 'note', sa.note, 'content_body', sa.content_body,
        'clip_brief', sa.clip_brief, 'generated_by', sa.generated_by, 'generated_model', sa.generated_model,
        'human_edited', sa.human_edited, 'reviewed_at', sa.reviewed_at
      ) order by sa.created_at) as artifacts,
      count(*) as art_total,
      count(*) filter (where sa.status = 'done'::text) as art_done,
      count(*) filter (where sa.status = 'blocked'::text) as art_blocked
    from analytics.step_artifact sa
    where sa.step_id = cs.id
  ) art on true
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'gate_kind', sg.gate_kind, 'status', sg.status, 'passed_by', sg.passed_by,
        'passed_at', sg.passed_at, 'note', sg.note
      ) order by sg.gate_kind) as gates,
      count(*) filter (where sg.status = 'blocked'::text) as gate_blocked
    from analytics.step_gate sg
    where sg.step_id = cs.id
  ) gt on true;

comment on view analytics.v_campaign_board is
  'Content/campaign board รวม step+artifact+gate เป็น 1 แถว/step (0057, ต่อคอลัมน์ล่าสุด 0145: '
  'goal_kpi_code/goal_kpi_code_source/content_type_code — คอลัมน์เดิมทั้งหมดคงที่ ห้ามแทรกกลาง).';

grant select on analytics.v_campaign_board to service_role;

notify pgrst, 'reload schema';
