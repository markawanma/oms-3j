-- 0172_job_tracking_j1.sql — ระบบใบงานผลิต J1 (ฝั่ง DB) · ตารางใหม่ล้วน ไม่แตะ RPC/ตารางเดิมแม้บรรทัดเดียว
--
-- Design (สัญญา): docs/3j-jewelry/oms/design-job-tracking.md §2 §3 §5 §7 + §11 (มติเจ้าของ 12 ต.ค. 69 ทับ §8)
-- ชุดทดสอบ:       scripts/verify/verify-0172.sql (do-block + raise rollback · ตารางแมป "ข้อ design -> เทสต์" หัวไฟล์)
--
-- ทำไมต้องแยกตารางใหม่ ไม่ต่อกับ production_order/oem_quote_item: OEM 0 diff (golden replay 0140 ยังจริง) ·
-- trigger deny-mutation ของ production_order จะขวางการเดินขั้น · ใบงานผูก item ด้วย FK restrict ลบ item ไม่ได้
--
-- สิ่งที่ migration นี้ทำ
--   1. ตาราง: job_counter · job_stage_def (seed 13 ขั้น) · worker · worker_audit · worker_session · job · job_stage
--      · job_event (append-only) · job_token · worker_rate_limit — RLS เปิดไม่มี policy · service_role อ่านได้อย่างเดียว
--      (เขียนผ่าน RPC security definer เท่านั้น · worker.pin_hash / job_token.token_hash / worker_session ไม่เปิดให้ select)
--   2. trigger: deny mutation (job/job_stage/job_token/worker) · append-only (job_event/worker_audit) · ลำดับขั้น/จำนวน/น้ำหนักต่อขั้น
--      · sync current_stage_code · derive/validate shop (composite FK) — กัน service key เขียนตรงข้าม RPC
--   3. RPC ออฟฟิศ (job_*, worker_*): crm_require_owner_admin + p_actor (pattern 0132 M4) · raise exception 22023 เมื่อผิดกติกา
--      RPC ฝั่งช่าง (job_worker_*, worker_pin_verify): ไม่มี auth.uid() · ตรวจ token hash + worker session hash ·
--      🔴 คืน jsonb {ok:false, code, message} แทน raise ทุกกรณีที่คาดได้ — raise = rollback ตัวนับ PIN ผิด/rate limit ที่เพิ่งเขียน
--   4. view: v_job_board · v_job_stage_loss · v_job_stage_from_events (ตรวจ drift) · v_production_order_job_mismatch (R2)
--   5. ท้ายไฟล์: เทียบ md5 ฟังก์ชัน oem_*/production_* เดิม + schema ตาราง OEM/ผลิตเดิม ก่อน-หลัง = เท่ากัน ไม่งั้น raise (rollback)
--
-- คำสั่งนี้ idempotent ไม่ได้ (create table เปล่า ๆ) โดยตั้งใจ — ถ้ารันซ้ำให้ error ทันที ดีกว่าเงียบแล้ว schema เพี้ยน
-- ไฟล์เป็น LF (migration-traps ข้อ 20) · regex ใช้ \uXXXX ไม่ฝังอักขระล่องหนจริง

-- ============================================================================
-- 0. baseline: ฟังก์ชัน oem_*/production_* + โครงสร้างตาราง OEM/ผลิตเดิม (เทียบตอนท้ายไฟล์)
-- ============================================================================
create temp table _j172_fn_base on commit drop as
select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace
  and p.prokind = 'f'
  and (p.proname like 'oem\_%' or p.proname like 'production\_%');

create temp table _j172_col_base on commit drop as
select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                      ',' order by table_name, ordinal_position)) as h,
       count(*) as n
from information_schema.columns
where table_schema = 'analytics'
  and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%');

-- ============================================================================
-- 1. ตัวนับเลขใบงาน (เลขข้ามได้ ไม่ใช่เอกสารภาษี — แบบ production_order_counter 0131)
-- ============================================================================
create table analytics.job_counter (
  shop_id uuid primary key references public.shop (id) on delete restrict,
  last_no int not null default 0 check (last_no >= 0)
);
alter table analytics.job_counter enable row level security;

-- ============================================================================
-- 2. job_stage_def — ทะเบียนขั้นตอนต่อร้าน (seed 13 ขั้น · แก้ที่ /jobs/stages เฟสหลัง)
--    weigh_default  = เงินบังคับชั่งขั้นนี้ (มติ Q1: หล่อ -> ตัดต้น -> ขัด)
--    metal_present  = โลหะอยู่ในมือช่างขั้นนี้ -> ทองบังคับชั่ง (design §3 ข้อ 8: cast..pack) · ทองเหลืองไม่บังคับที่ใดเลย
--    loss_warn_pct  = null = ไม่เตือน (ตัวเลขรอเจ้าของ Q2 — ห้ามเดา)
-- ============================================================================
create table analytics.job_stage_def (
  shop_id       uuid not null references public.shop (id) on delete restrict,
  code          text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name_th       text not null check (length(btrim(name_th)) between 1 and 60),
  seq_default   int  not null check (seq_default between 1 and 1000),
  cost_block    text not null check (cost_block in ('nre', 'per_piece', 'batch')),
  batch_kind    text check (batch_kind is null or batch_kind in ('flask', 'plating_tank')),
  weigh_default boolean not null default false,
  metal_present boolean not null default false,
  loss_warn_pct numeric(5, 2) check (loss_warn_pct is null or (loss_warn_pct > 0 and loss_warn_pct <= 100)),
  is_active     boolean not null default true,
  primary key (shop_id, code),
  unique (shop_id, seq_default)
);
alter table analytics.job_stage_def enable row level security;

create or replace function analytics.job_stage_def_ensure(p_shop_id uuid)
 returns void
 language sql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  insert into analytics.job_stage_def (shop_id, code, name_th, seq_default, cost_block, batch_kind, weigh_default, metal_present)
  select p_shop_id, v.code, v.name_th, v.seq, v.cost_block, v.batch_kind, v.weigh_default, v.metal_present
  from (values
    ('cad',            'ออกแบบ CAD',               1,  'nre',       null,           false, false),
    ('print3d',        'ปริ้น 3D ต้นแบบ',          2,  'nre',       null,           false, false),
    ('mold',           'อัดก้อนยาง',               3,  'nre',       null,           false, false),
    ('wax_inject',     'ฉีดเทียน',                 4,  'per_piece', null,           false, false),
    ('wax_tree',       'ติดต้นเทียน',              5,  'batch',     null,           false, false),
    ('invest_burnout', 'ปั่นปูน เทปูน เผา',        6,  'batch',     'flask',        false, false),
    ('cast',           'หล่อ',                     7,  'batch',     'flask',        true,  true),
    ('cut_sprue',      'ตัดต้น',                   8,  'per_piece', null,           true,  true),
    ('polish',         'แต่ง ขัด',                 9,  'per_piece', null,           true,  true),
    ('gem_set',        'ฝังพลอย',                  10, 'per_piece', null,           false, true),
    ('plating',        'ชุบ',                      11, 'batch',     'plating_tank', false, true),
    ('qc',             'ตรวจ QC',                  12, 'per_piece', null,           false, true),
    ('pack',           'แพ็ก',                     13, 'per_piece', null,           false, true)
  ) as v(code, name_th, seq, cost_block, batch_kind, weigh_default, metal_present)
  on conflict (shop_id, code) do nothing
$f$;

select analytics.job_stage_def_ensure(s.id) from public.shop s;

-- ============================================================================
-- 3. worker — ทะเบียนช่าง (ไม่ใช่ auth.users · ไม่แตะ shop_member/AUTH_GATE) + audit + session
-- ============================================================================
create table analytics.worker (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shop (id) on delete restrict,
  display_name    text not null check (length(btrim(display_name)) between 1 and 60),
  stage_codes     text[] not null default '{}',
  pin_hash        text not null,
  is_active       boolean not null default true,
  failed_attempts int not null default 0 check (failed_attempts between 0 and 100),
  last_failed_at  timestamptz,
  locked_until    timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  deactivated_at  timestamptz,
  updated_at      timestamptz not null default now(),
  unique (id, shop_id)
);
create unique index uq_worker_shop_name on analytics.worker (shop_id, lower(display_name));
alter table analytics.worker enable row level security;

-- ประวัติจัดการช่าง (เพิ่ม/ปิด/เปิด/รีเซ็ต PIN) — append-only · ไม่เก็บ PIN/hash
create table analytics.worker_audit (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shop (id) on delete restrict,
  worker_id   uuid not null,
  action      text not null check (action in ('create', 'update', 'deactivate', 'reactivate', 'pin_set')),
  actor       uuid not null,
  detail      jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict
);
create index idx_worker_audit_worker on analytics.worker_audit (worker_id, recorded_at desc);
alter table analytics.worker_audit enable row level security;

-- session ช่าง: เก็บ sha256 ของ token สุ่ม (token ดิบอยู่ใน cookie httpOnly ของ server เท่านั้น) · อายุ 12 ชม. · เพิกถอนได้
create table analytics.worker_session (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null,
  worker_id    uuid not null,
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  issued_at    timestamptz not null default clock_timestamp(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  device_hint  text check (device_hint is null or length(device_hint) <= 120),
  check (expires_at > issued_at and expires_at <= issued_at + interval '13 hours'),
  foreign key (worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict
);
create index idx_worker_session_worker on analytics.worker_session (worker_id);
alter table analytics.worker_session enable row level security;

-- ============================================================================
-- 4. job — ใบงาน (1 ใบ = 1 source item)
-- ============================================================================
create table analytics.job (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references public.shop (id) on delete restrict,
  seq                      int  not null check (seq > 0),
  job_no                   text generated always as ('JB-' || lpad(seq::text, 4, '0')) stored,
  source_kind              text not null check (source_kind in ('oem', 'production')),
  oem_quote_item_id        uuid references analytics.oem_quote_item (id) on delete restrict,
  root_quote_id            uuid,
  oem_item_seq             int,
  production_order_item_id uuid references analytics.production_order_item (id) on delete restrict,
  product_id               uuid references public.product (id) on delete restrict,
  design_label             text not null check (length(btrim(design_label)) between 1 and 200),
  sku_snapshot             text check (sku_snapshot is null or length(sku_snapshot) <= 100),
  metal                    text not null check (metal in ('silver', 'gold', 'brass')),
  qty_planned              int  not null check (qty_planned between 1 and 100000),
  qty_good                 int  check (qty_good is null or (qty_good between 0 and 100000)),
  qty_scrap                int  check (qty_scrap is null or (qty_scrap between 0 and 100000)),
  weight_start_g           numeric(10, 3) check (weight_start_g is null or (weight_start_g > 0 and weight_start_g <= 100000)),
  weight_final_g           numeric(10, 3) check (weight_final_g is null or (weight_final_g > 0 and weight_final_g <= 100000)),
  weigh_required           boolean not null,
  due_date                 date,
  status                   text not null default 'open' check (status in ('open', 'in_progress', 'on_hold', 'done', 'cancelled')),
  current_stage_code       text,
  start_gate_note          text,
  created_by               uuid not null,
  created_at               timestamptz not null default now(),
  done_at                  timestamptz,
  cancelled_at             timestamptz,
  cancel_reason            text,
  note                     text,
  updated_at               timestamptz not null default now(),
  unique (id, shop_id),
  unique (shop_id, seq),
  -- แหล่งที่มา: OEM ผูก item + ดีล + ลำดับ item · ผลิตเอง ผูก production item · ห้ามปนกัน (แน่นกว่า xor ของ design)
  constraint job_source_ck check (
    (source_kind = 'oem' and oem_quote_item_id is not null and root_quote_id is not null and oem_item_seq is not null
       and production_order_item_id is null)
    or
    (source_kind = 'production' and production_order_item_id is not null
       and oem_quote_item_id is null and root_quote_id is null and oem_item_seq is null)
  ),
  -- ทองต้องชั่งเสมอ (มติ Q1) · เงินชั่งเฉพาะขั้นที่ def กำหนด · ทองเหลืองไม่บังคับ
  constraint job_gold_weigh_ck check (metal <> 'gold' or weigh_required),
  constraint job_done_ck check (
    status <> 'done' or (
      done_at is not null and qty_good is not null and qty_scrap is not null
      and qty_good + qty_scrap = qty_planned
      and (metal <> 'gold' or weight_final_g is not null)
    )
  ),
  constraint job_cancel_ck check (status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null)),
  constraint job_gate_note_ck check (
    start_gate_note is null
    or (source_kind = 'oem' and analytics.oem_note_present(start_gate_note) and analytics.oem_note_valid(start_gate_note))
  )
);
-- 1 item = 1 job (ที่ยังไม่ยกเลิก) · OEM กันซ้ำระดับดีล+ลำดับ item ด้วย (renegotiate สร้าง item ใหม่ — R1)
create unique index uq_job_oem_item on analytics.job (oem_quote_item_id)
  where status <> 'cancelled' and oem_quote_item_id is not null;
create unique index uq_job_oem_deal_seq on analytics.job (root_quote_id, oem_item_seq)
  where status <> 'cancelled' and root_quote_id is not null;
create unique index uq_job_production_item on analytics.job (production_order_item_id)
  where status <> 'cancelled' and production_order_item_id is not null;
create index idx_job_shop_status on analytics.job (shop_id, status);
alter table analytics.job enable row level security;

-- ============================================================================
-- 5. job_stage — ขั้นที่ใบงานนี้ต้องผ่าน (สร้างทั้งชุดตอน job_create · ลำดับล็อก)
-- ============================================================================
create table analytics.job_stage (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null,
  shop_id        uuid not null,
  stage_code     text not null,
  seq            int  not null check (seq between 1 and 100),
  status         text not null default 'pending' check (status in ('pending', 'received', 'sent', 'skipped')),
  weigh_required boolean not null default false,
  received_on    date,
  sent_on        date,
  worker_id      uuid,
  assignee_name  text check (assignee_name is null or length(btrim(assignee_name)) between 1 and 60),
  auto_closed    boolean not null default false,
  qty_in         int check (qty_in is null or (qty_in between 1 and 100000)),
  qty_out        int check (qty_out is null or (qty_out between 0 and 100000)),
  qty_scrap      int not null default 0 check (qty_scrap between 0 and 100000),
  scrap_reason   text,
  weight_in_g    numeric(10, 3) check (weight_in_g is null or (weight_in_g > 0 and weight_in_g <= 100000)),
  weight_out_g   numeric(10, 3) check (weight_out_g is null or (weight_out_g > 0 and weight_out_g <= 100000)),
  metal_added_g  numeric(10, 3) not null default 0 check (metal_added_g >= 0 and metal_added_g <= 100000),
  weight_note    text,
  scrap_weight_g numeric(10, 3) check (scrap_weight_g is null or (scrap_weight_g > 0 and scrap_weight_g <= 100000)),
  skip_reason    text,
  due_date       date,
  updated_at     timestamptz not null default now(),
  unique (job_id, seq),
  unique (job_id, stage_code),
  unique (id, job_id),
  foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  foreign key (shop_id, stage_code) references analytics.job_stage_def (shop_id, code) on delete restrict,
  foreign key (worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  -- pending/skipped: ยังไม่มีความคืบหน้าใดเลย
  constraint js_idle_ck check (
    status in ('received', 'sent') or (
      received_on is null and sent_on is null and worker_id is null and assignee_name is null
      and weight_in_g is null and weight_out_g is null and qty_in is null and qty_out is null
      and qty_scrap = 0 and scrap_reason is null and metal_added_g = 0 and scrap_weight_g is null
      and weight_note is null and not auto_closed
    )
  ),
  constraint js_skip_ck check (
    (status = 'skipped' and analytics.oem_note_present(skip_reason) and analytics.oem_note_valid(skip_reason))
    or (status <> 'skipped' and skip_reason is null)
  ),
  -- รับแล้วต้องรู้ว่าใครถือ (ช่างผ่าน QR หรือชื่อที่ออฟฟิศพิมพ์) + วัน + จำนวนเข้า
  constraint js_received_ck check (
    status not in ('received', 'sent')
    or (received_on is not null and qty_in is not null and (worker_id is not null or assignee_name is not null))
  ),
  -- ยังไม่ส่ง: ห้ามมีค่าฝั่งออก
  constraint js_not_sent_ck check (
    status = 'sent' or (
      sent_on is null and qty_out is null and weight_out_g is null and qty_scrap = 0 and scrap_reason is null
      and scrap_weight_g is null and metal_added_g = 0 and weight_note is null and not auto_closed
    )
  ),
  -- ส่งแล้ว: จำนวนเข้า = ออก + เสีย · วันส่ง >= วันรับ
  constraint js_sent_ck check (
    status <> 'sent'
    or (sent_on is not null and sent_on >= received_on and qty_out is not null and qty_out + qty_scrap = qty_in)
  ),
  constraint js_scrap_reason_ck check (
    (qty_scrap = 0 and scrap_reason is null)
    or (qty_scrap > 0 and (
          scrap_reason in ('porosity', 'broken', 'wrong_design', 'missing', 'other')
          or (analytics.oem_note_present(scrap_reason) and analytics.oem_note_valid(scrap_reason) and length(scrap_reason) <= 200)
       ))
  ),
  -- น้ำหนักออก <= เข้า + เติมโลหะ · เติมโลหะต้องมีหมายเหตุ
  constraint js_weight_ck check (weight_out_g is null or weight_in_g is null or weight_out_g <= weight_in_g + metal_added_g),
  constraint js_metal_added_ck check (
    metal_added_g = 0 or (analytics.oem_note_present(weight_note) and analytics.oem_note_valid(weight_note))
  ),
  constraint js_note_ck check (weight_note is null or (analytics.oem_note_valid(weight_note) and length(weight_note) <= 200)),
  -- ขั้นที่บังคับชั่ง: รับต้องมีน้ำหนักเข้า · ส่งต้องมีน้ำหนักออก (ยกเว้นเงิน/ทองเหลืองที่ถูกปิดอัตโนมัติ — ทองห้ามปิดอัตโนมัติ ดู trigger)
  constraint js_weigh_in_ck check (not weigh_required or status not in ('received', 'sent') or weight_in_g is not null),
  constraint js_weigh_out_ck check (not weigh_required or status <> 'sent' or weight_out_g is not null or auto_closed)
);
create index idx_job_stage_job on analytics.job_stage (job_id, seq);
-- ขั้น received ได้ทีละ 1 ขั้นต่อใบงาน (ผู้ถือปัจจุบัน)
create unique index uq_job_stage_one_received on analytics.job_stage (job_id) where status = 'received';
alter table analytics.job_stage enable row level security;

-- ============================================================================
-- 6. job_event — ประวัติ append-only (ชั้นที่เชื่อถือได้) · 2 เวลา: occurred_on (วันจริง) + recorded_at (clock_timestamp)
-- ============================================================================
create table analytics.job_event (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null,
  job_id       uuid not null,
  job_stage_id uuid,
  event_type   text not null check (event_type in (
                 'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join',
                 'batch_leave', 'due_set', 'hold', 'resume', 'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke')),
  occurred_on  date not null,
  recorded_at  timestamptz not null default clock_timestamp(),
  actor        uuid,
  worker_id    uuid,
  channel      text not null check (channel in ('worker_qr', 'daily_sheet', 'job_page', 'rpc')),
  device_hint  text check (device_hint is null or length(device_hint) <= 120),
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- ทุก event มีคนรับผิดชอบ (create/token_issue ยอมให้ว่างตาม design §2.4)
  constraint je_who_ck check (actor is not null or worker_id is not null or event_type in ('create', 'token_issue')),
  constraint je_qr_ck check (channel <> 'worker_qr' or worker_id is not null),
  foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  foreign key (job_stage_id, job_id) references analytics.job_stage (id, job_id) on delete restrict,
  foreign key (worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict
);
create index idx_job_event_job on analytics.job_event (job_id, recorded_at);
create index idx_job_event_recent on analytics.job_event (shop_id, recorded_at desc);
alter table analytics.job_event enable row level security;

-- ============================================================================
-- 7. job_token — QR บนกระดาษ: sha256 ของ token สุ่ม 32 bytes (ไม่เก็บ token ดิบ) · เพิกถอนได้
-- ============================================================================
create table analytics.job_token (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null,
  job_id        uuid not null,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  print_no      int  not null check (print_no > 0),
  issued_at     timestamptz not null default clock_timestamp(),
  issued_by     uuid not null,
  revoked_at    timestamptz,
  revoke_reason text,
  unique (job_id, print_no),
  check ((revoked_at is null) = (revoke_reason is null)),
  foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict
);
create index idx_job_token_job_active on analytics.job_token (job_id) where revoked_at is null;
alter table analytics.job_token enable row level security;

-- ============================================================================
-- 8. worker_rate_limit — หน้าต่างคงที่ 10 นาทีต่อ key (ip_hash / token_hash) · ล้างแบบ opportunistic ใน RPC
-- ============================================================================
create table analytics.worker_rate_limit (
  key          text not null check (length(key) <= 80),
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
create index idx_worker_rate_limit_window on analytics.worker_rate_limit (window_start);
alter table analytics.worker_rate_limit enable row level security;
