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

-- ============================================================================
-- 9. helper (ภายใน) — ไม่ grant ให้ role ไหน ยกเว้นที่ระบุท้ายไฟล์ · security definer RPC เรียกได้เพราะรันด้วยสิทธิ์เจ้าของ
-- ============================================================================

-- วันทางธุรกิจของไทย (migration-traps ข้อ 6) — แยกฟังก์ชันที่รับเวลาเข้ามาเพื่อให้เทสต์ boundary 17:00-24:00 UTC ได้
create or replace function analytics.job_bkk_date(p_ts timestamptz)
 returns date
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$ select (p_ts at time zone 'Asia/Bangkok')::date $f$;

create or replace function analytics.job_today()
 returns date
 language sql
 stable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$ select analytics.job_bkk_date(now()) $f$;

create or replace function analytics.job_sha256_hex(p_val text)
 returns text
 language sql
 immutable
 set search_path to 'pg_catalog', 'extensions', 'pg_temp'
as $f$ select encode(extensions.digest(convert_to(p_val, 'UTF8'), 'sha256'), 'hex') $f$;

-- ข้อความสั้นที่ผู้ใช้พิมพ์ (ชื่อ/เหตุผล/โน้ต): trim ช่องว่างทุกชนิด · ห้าม control/ล่องหน/ขึ้นบรรทัดใหม่ · ยาวไม่เกิน p_max
-- p_present = true -> ต้องมีตัวอักษร/ตัวเลขจริง (oem_note_present whitelist · oem-invariants 6.2)
create or replace function analytics.job_text_clean(p_val text, p_label text, p_max int, p_present boolean)
 returns text
 language plpgsql
 immutable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v text := nullif(btrim(p_val, E' \t\r\n               　'), '');
begin
  if v is null then
    if p_present then
      raise exception '%ต้องระบุ', p_label using errcode = '22023';
    end if;
    return null;
  end if;
  if v ~ '[\r\n\t]' or not analytics.oem_note_valid(v) then
    raise exception '%ห้ามมีขึ้นบรรทัดใหม่ tab หรืออักขระควบคุม/ล่องหน', p_label using errcode = '22023';
  end if;
  if length(v) > p_max then
    raise exception '%ยาวเกินไป (% ตัวอักษร) — ไม่เกิน % ตัวอักษร', p_label, length(v), p_max using errcode = '22023';
  end if;
  if p_present and not analytics.oem_note_present(v) then
    raise exception '%ต้องมีตัวอักษรหรือตัวเลขจริง', p_label using errcode = '22023';
  end if;
  return v;
end;
$f$;

-- hint ของอุปกรณ์สำหรับ audit: UA ตัดสั้น 80 + sha256(ip) 8 ตัวแรก · ไม่เก็บ ip ดิบ (PDPA — ช่างเป็นบุคคล)
create or replace function analytics.job_device_hint(p_ua text, p_ip_hash text)
 returns text
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select nullif(btrim(
    left(regexp_replace(coalesce(p_ua, ''), '[[:cntrl:]\u007F-\u009F​-‏ -‮⁠-⁯]', '', 'g'), 80)
    || case when p_ip_hash ~ '^[0-9a-f]{64}$' then ' ip:' || left(p_ip_hash, 8) else '' end
  ), '')
$f$;

-- สถานะเต็มของ 1 ขั้น (ใช้ใน payload ของ event และเทียบ drift) — ครอบทุกคอลัมน์ความคืบหน้า
create or replace function analytics.job_stage_state(s analytics.job_stage)
 returns jsonb
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select jsonb_build_object(
    'status', s.status, 'received_on', s.received_on, 'sent_on', s.sent_on, 'worker_id', s.worker_id,
    'assignee_name', s.assignee_name, 'auto_closed', s.auto_closed, 'qty_in', s.qty_in, 'qty_out', s.qty_out,
    'qty_scrap', s.qty_scrap, 'scrap_reason', s.scrap_reason, 'weight_in_g', s.weight_in_g, 'weight_out_g', s.weight_out_g,
    'metal_added_g', s.metal_added_g, 'weight_note', s.weight_note, 'scrap_weight_g', s.scrap_weight_g, 'skip_reason', s.skip_reason)
$f$;

-- rate limit แบบ DB (ไม่เพิ่ม dependency): true = ยังไม่เกินเพดาน · เรียกใน RPC ฝั่งช่างก่อนทำงานจริงเสมอ
-- RPC ฝั่งช่าง "ไม่ raise" เมื่อเกินเพดาน (คืน ok:false) เพื่อให้ตัวนับที่เพิ่งเขียน commit จริง
create or replace function analytics.job_rate_limit_hit(p_key text, p_max int)
 returns boolean
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_win  timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_hits int;
begin
  if random() < 0.02 then
    delete from analytics.worker_rate_limit where window_start < now() - interval '1 hour';
  end if;
  insert into analytics.worker_rate_limit as r (key, window_start, hits)
  values (p_key, v_win, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_max;
end;
$f$;

-- เขียน job_event (ภายในเท่านั้น) · shop_id derive จากใบงาน · recorded_at บังคับ clock_timestamp ที่ trigger
create or replace function analytics.job_event_write(
  p_job_id uuid, p_stage_id uuid, p_type text, p_occurred_on date,
  p_actor uuid, p_worker_id uuid, p_channel text, p_device_hint text, p_payload jsonb
)
 returns uuid
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v_id uuid;
begin
  insert into analytics.job_event (shop_id, job_id, job_stage_id, event_type, occurred_on, actor, worker_id, channel, device_hint, payload)
  select j.shop_id, j.id, p_stage_id, p_type, p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
         coalesce(p_payload, '{}'::jsonb)
  from analytics.job j where j.id = p_job_id
  returning id into v_id;
  if v_id is null then
    raise exception 'job_event_write: ไม่พบใบงาน' using errcode = '22023';
  end if;
  return v_id;
end;
$f$;

-- ============================================================================
-- 10. trigger — กัน service key เขียนตรงข้าม RPC (service_role มี BYPASSRLS · กันที่ trigger เท่านั้น — บทเรียน 0086/0088)
-- ============================================================================

-- 10a. append-only (job_event, worker_audit): UPDATE/DELETE/TRUNCATE ปฏิเสธทุกกรณี รวม owner/service_role (แบบ 0165)
create or replace function analytics.job_append_only()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
begin
  raise exception 'analytics.% is append-only (% blocked)', tg_table_name, tg_op using errcode = '42501';
end;
$f$;

create or replace function analytics.job_deny_truncate()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
begin
  raise exception 'analytics.% ห้าม TRUNCATE', tg_table_name using errcode = '42501';
end;
$f$;

create trigger trg_job_event_append_only before update or delete on analytics.job_event
  for each row execute function analytics.job_append_only();
create trigger trg_job_event_deny_truncate before truncate on analytics.job_event
  for each statement execute function analytics.job_append_only();
create trigger trg_worker_audit_append_only before update or delete on analytics.worker_audit
  for each row execute function analytics.job_append_only();
create trigger trg_worker_audit_deny_truncate before truncate on analytics.worker_audit
  for each statement execute function analytics.job_append_only();
create trigger trg_job_deny_truncate before truncate on analytics.job
  for each statement execute function analytics.job_deny_truncate();
create trigger trg_job_stage_deny_truncate before truncate on analytics.job_stage
  for each statement execute function analytics.job_deny_truncate();
create trigger trg_job_token_deny_truncate before truncate on analytics.job_token
  for each statement execute function analytics.job_deny_truncate();
create trigger trg_worker_deny_truncate before truncate on analytics.worker
  for each statement execute function analytics.job_deny_truncate();

-- 10b. job_event: recorded_at ปลอมไม่ได้ (บังคับ clock_timestamp ทุกครั้ง) · shop derive จากใบงานถ้าไม่ส่งมา
create or replace function analytics.job_event_before_insert()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if new.shop_id is null then
    select j.shop_id into new.shop_id from analytics.job j where j.id = new.job_id;
  end if;
  new.recorded_at := clock_timestamp();
  if pg_column_size(new.payload) > 20000 then
    raise exception 'job_event: payload ใหญ่เกินไป' using errcode = '22023';
  end if;
  return new;
end;
$f$;
create trigger trg_job_event_before_insert before insert on analytics.job_event
  for each row execute function analytics.job_event_before_insert();

-- 10c. job: INSERT ตรวจต้นทางจริง (ร้านเดียวกัน · quote won · production order open · ลำดับ/โลหะตรง item) · UPDATE ห้ามแก้ identity ·
--      done/cancelled เป็นปลายทาง (แบบ production_order_deny_mutation 0131) · DELETE ห้ามเสมอ
create or replace function analytics.job_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_item_shop   uuid;
  v_item_seq    int;
  v_item_input  jsonb;
  v_q_status    text;
  v_q_root      uuid;
  v_po_status   text;
  v_poi_product uuid;
  v_prod_shop   uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'job: ห้ามลบใบงาน — ยกเลิกด้วย job_cancel แทน (เก็บไว้เป็นหลักฐานการผลิต)' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.done_at is not null or new.cancelled_at is not null
       or new.qty_good is not null or new.qty_scrap is not null or new.weight_final_g is not null then
      raise exception 'job: ใบงานใหม่ต้องเริ่มที่สถานะ open และยังไม่มีผลปิดงาน' using errcode = '22023';
    end if;
    if new.source_kind = 'oem' then
      select i.shop_id, i.seq, i.input, q.status, coalesce(q.root_quote_id, q.id)
        into v_item_shop, v_item_seq, v_item_input, v_q_status, v_q_root
        from analytics.oem_quote_item i
        join analytics.oem_quote q on q.id = i.quote_id
       where i.id = new.oem_quote_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการใบเสนอราคา' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบเสนอราคาเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_q_status <> 'won' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_q_status using errcode = '22023';
      end if;
      if new.root_quote_id <> v_q_root or new.oem_item_seq <> v_item_seq then
        raise exception 'job: ดีล/ลำดับรายการไม่ตรงกับใบเสนอราคา' using errcode = '22023';
      end if;
      if new.metal is distinct from (v_item_input ->> 'metal') then
        raise exception 'job: โลหะของใบงานไม่ตรงกับรายการใบเสนอราคา' using errcode = '22023';
      end if;
    else
      select poi.shop_id, po.status, poi.product_id
        into v_item_shop, v_po_status, v_poi_product
        from analytics.production_order_item poi
        join analytics.production_order po on po.id = poi.production_order_id
       where poi.id = new.production_order_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการในใบผลิต' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบผลิตเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_po_status <> 'open' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_po_status using errcode = '22023';
      end if;
      if new.product_id is distinct from v_poi_product then
        raise exception 'job: สินค้าของใบงานไม่ตรงกับรายการใบผลิต' using errcode = '22023';
      end if;
    end if;
    if new.product_id is not null then
      select p.shop_id into v_prod_shop from public.product p where p.id = new.product_id;
      if v_prod_shop is distinct from new.shop_id then
        raise exception 'job: สินค้าเป็นของร้านอื่น' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.shop_id <> old.shop_id or new.seq <> old.seq or new.source_kind <> old.source_kind
     or new.oem_quote_item_id is distinct from old.oem_quote_item_id
     or new.root_quote_id is distinct from old.root_quote_id
     or new.oem_item_seq is distinct from old.oem_item_seq
     or new.production_order_item_id is distinct from old.production_order_item_id
     or new.product_id is distinct from old.product_id
     or new.design_label <> old.design_label
     or new.sku_snapshot is distinct from old.sku_snapshot
     or new.metal <> old.metal or new.qty_planned <> old.qty_planned or new.weigh_required <> old.weigh_required
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'job: ห้ามเปลี่ยนข้อมูลตั้งต้นของใบงาน (ร้าน/เลขที่/ต้นทาง/แบบ/โลหะ/จำนวน) — ยกเลิกแล้วสร้างใหม่' using errcode = '22023';
  end if;
  if old.status in ('done', 'cancelled') then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้', old.job_no, old.status using errcode = '22023';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('open', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'on_hold' and new.status in ('open', 'in_progress', 'done', 'cancelled'))) then
    raise exception 'job: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;
  if new.status = 'done' and exists (
       select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('pending', 'received')) then
    raise exception 'job: ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่รับ/ยังไม่ส่งต่อ' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;
create trigger trg_job_guard before insert or update or delete on analytics.job
  for each row execute function analytics.job_guard();

-- 10d. job_stage: ลำดับขั้น · จำนวนเชื่อมต่อขั้นก่อนหน้า · วันเรียงกัน · ทองห้ามปิดอัตโนมัติ · ใบปิดแล้วแก้ไม่ได้
create or replace function analytics.job_stage_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
begin
  if tg_op = 'DELETE' then
    raise exception 'job_stage: ห้ามลบขั้นของใบงาน' using errcode = '22023';
  end if;
  select * into v_job from analytics.job where id = new.job_id;
  if not found then
    raise exception 'job_stage: ไม่พบใบงาน' using errcode = '22023';
  end if;
  if new.shop_id is null then
    new.shop_id := v_job.shop_id;
  elsif new.shop_id <> v_job.shop_id then
    raise exception 'job_stage: ขั้นต้องอยู่ร้านเดียวกับใบงาน' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if v_job.status <> 'open' then
      raise exception 'job_stage: เพิ่มขั้นได้เฉพาะตอนสร้างใบงาน' using errcode = '22023';
    end if;
    if new.status <> 'pending' then
      raise exception 'job_stage: ขั้นใหม่ต้องเริ่มที่ pending' using errcode = '22023';
    end if;
    if not exists (select 1 from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = new.stage_code and d.is_active) then
      raise exception 'job_stage: ขั้น % ถูกปิดใช้งานหรือไม่มีในทะเบียน', new.stage_code using errcode = '22023';
    end if;
    -- ลำดับใน job ต้องไม่ขัดกับ seq_default ของทะเบียน (design §3 ข้อ 12)
    if exists (
         select 1
           from analytics.job_stage s
           join analytics.job_stage_def d  on d.shop_id = s.shop_id and d.code = s.stage_code
           join analytics.job_stage_def dn on dn.shop_id = new.shop_id and dn.code = new.stage_code
          where s.job_id = new.job_id
            and ((s.seq < new.seq and d.seq_default > dn.seq_default) or (s.seq > new.seq and d.seq_default < dn.seq_default))) then
      raise exception 'job_stage: ลำดับขั้นต้องเรียงตามลำดับมาตรฐานของทะเบียนขั้นตอน' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code
     or new.seq <> old.seq or new.weigh_required <> old.weigh_required then
    raise exception 'job_stage: ห้ามเปลี่ยนใบงาน/ขั้น/ลำดับ/กติกาชั่งของขั้นที่สร้างแล้ว' using errcode = '22023';
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'job_stage: ใบงาน % สถานะ % แล้ว แก้ขั้นไม่ได้', v_job.job_no, v_job.status using errcode = '22023';
  end if;

  if new.status = old.status then
    if old.status in ('received', 'sent') and analytics.job_stage_state(new) is distinct from analytics.job_stage_state(old) then
      raise exception 'job_stage: ขั้นที่รับ/ส่งแล้วแก้ตรงไม่ได้ — ใช้ย้อนขั้น (job_stage_reopen) พร้อมเหตุผล' using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'pending' and new.status = 'received' then
    if v_job.status = 'on_hold' then
      raise exception 'job_stage: ใบงานถูกพักอยู่ รับงานไม่ได้' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq < new.seq and s.status = 'pending') then
      raise exception 'job_stage: รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.id <> new.id and s.status = 'received') then
      raise exception 'job_stage: ยังมีขั้นอื่นที่รับค้างอยู่ — ต้องส่งต่อก่อน' using errcode = '22023';
    end if;
    select * into v_prev from analytics.job_stage s
     where s.job_id = new.job_id and s.seq < new.seq and s.status <> 'skipped' order by s.seq desc limit 1;
    if found then
      if v_prev.status <> 'sent' then
        raise exception 'job_stage: ขั้นก่อนหน้ายังไม่ถูกส่งต่อ' using errcode = '22023';
      end if;
      v_exp_in := v_prev.qty_out;
      if new.received_on < v_prev.sent_on then
        raise exception 'job_stage: วันรับ (%) ต้องไม่ก่อนวันส่งของขั้นก่อนหน้า (%)', new.received_on, v_prev.sent_on using errcode = '22023';
      end if;
    else
      v_exp_in := v_job.qty_planned;
    end if;
    if new.qty_in is distinct from v_exp_in then
      raise exception 'job_stage: จำนวนเข้า (%) ต้องเท่าจำนวนที่ส่งออกจากขั้นก่อนหน้า (%)', new.qty_in, v_exp_in using errcode = '22023';
    end if;
  elsif old.status = 'pending' and new.status = 'skipped' then
    null;
  elsif old.status = 'received' and new.status = 'sent' then
    if new.auto_closed and v_job.metal = 'gold' then
      raise exception 'job_stage: งานทองปิดขั้นอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก' using errcode = '22023';
    end if;
  elsif (old.status = 'received' and new.status = 'pending')
     or (old.status = 'sent' and new.status = 'received')
     or (old.status = 'skipped' and new.status = 'pending') then
    -- ย้อนขั้น: ทำได้เมื่อไม่มีขั้นถัดไปที่ received/sent อยู่ (design §3 ข้อ 4)
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq > new.seq and s.status in ('received', 'sent')) then
      raise exception 'job_stage: ย้อนข้ามขั้นที่ขั้นถัดไปรับหรือส่งไปแล้วไม่ได้ — ย้อนทีละขั้นจากขั้นล่าสุด' using errcode = '22023';
    end if;
  else
    raise exception 'job_stage: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$f$;
create trigger trg_job_stage_guard before insert or update or delete on analytics.job_stage
  for each row execute function analytics.job_stage_guard();

-- 10e. current_stage_code / status (open <-> in_progress) ตามขั้นจริงเสมอ — denormalize ที่ view ตรวจ drift ได้
create or replace function analytics.job_stage_sync()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_cur    text;
  v_active boolean;
  v_status text;
  v_new    text;
begin
  select s.stage_code into v_cur from analytics.job_stage s where s.job_id = new.job_id and s.status = 'received' limit 1;
  if v_cur is null then
    select s.stage_code into v_cur from analytics.job_stage s where s.job_id = new.job_id and s.status = 'pending' order by s.seq limit 1;
  end if;
  select exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.status in ('received', 'sent')) into v_active;
  select j.status into v_status from analytics.job j where j.id = new.job_id;
  v_new := case when v_status in ('open', 'in_progress') then (case when v_active then 'in_progress' else 'open' end) else v_status end;
  update analytics.job j set current_stage_code = v_cur, status = v_new
   where j.id = new.job_id and (j.current_stage_code is distinct from v_cur or j.status <> v_new);
  return null;
end;
$f$;
create trigger trg_job_stage_sync after insert or update on analytics.job_stage
  for each row execute function analytics.job_stage_sync();

-- 10f. job_token: INSERT เฉพาะใบงานที่ยังเดินอยู่ · UPDATE ได้เฉพาะ revoked_at/revoke_reason จาก null เท่านั้น (ฟื้น token ที่เพิกถอนแล้วไม่ได้) · DELETE ห้าม
create or replace function analytics.job_token_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'job_token: ห้ามลบ token — เพิกถอนแทน' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select j.status into v_status from analytics.job j where j.id = new.job_id;
    if v_status is null or v_status in ('done', 'cancelled') then
      raise exception 'job_token: ออก token ให้ใบงานที่ปิดแล้วไม่ได้' using errcode = '22023';
    end if;
    if new.revoked_at is not null then
      raise exception 'job_token: token ใหม่ต้องยังไม่ถูกเพิกถอน' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.shop_id <> old.shop_id or new.job_id <> old.job_id or new.token_hash <> old.token_hash
     or new.print_no <> old.print_no or new.issued_at <> old.issued_at or new.issued_by <> old.issued_by then
    raise exception 'job_token: แก้ได้เฉพาะการเพิกถอน' using errcode = '22023';
  end if;
  if old.revoked_at is not null then
    raise exception 'job_token: token ที่เพิกถอนแล้วฟื้นหรือแก้ไม่ได้' using errcode = '22023';
  end if;
  return new;
end;
$f$;
create trigger trg_job_token_guard before insert or update or delete on analytics.job_token
  for each row execute function analytics.job_token_guard();

-- 10g. worker: ห้ามลบ (ประวัติอ้างถึง) · shop เปลี่ยนไม่ได้
create or replace function analytics.worker_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'worker: ห้ามลบช่าง — ปิดการใช้งานแทน (ประวัติใบงานอ้างถึงช่าง)' using errcode = '22023';
  end if;
  if new.shop_id <> old.shop_id or new.created_at <> old.created_at then
    raise exception 'worker: ห้ามเปลี่ยนร้านของช่าง' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;
create trigger trg_worker_guard before update or delete on analytics.worker
  for each row execute function analytics.worker_guard();

-- ============================================================================
-- 11. core ภายใน: รับ / ส่งต่อ ขั้น — ใช้ร่วมกันระหว่าง RPC ช่าง (QR) และ RPC ออฟฟิศ
--     ผู้เรียกต้อง lock แถว job (for update) ก่อนเสมอ · คืน jsonb {ok, code, message} ไม่ raise กรณีที่คาดได้
--     (RPC ฝั่งช่างคืนต่อให้ client ตรงๆ · RPC ออฟฟิศแปลงเป็น raise 22023 พร้อม hint = code)
-- ============================================================================

create or replace function analytics.job_fail(p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$ select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) || coalesce(p_extra, '{}'::jsonb) $f$;

-- ตรวจน้ำหนัก: null ผ่าน (ผู้เรียกตัดสินเองว่าบังคับไหม) · NaN/Infinity/<=0/>100000/ทศนิยมเกิน 3 ตำแหน่ง = ไม่ผ่าน (migration-traps ข้อ 4)
create or replace function analytics.job_weight_ok(p_w numeric, p_allow_zero boolean default false)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select p_w is null
      or (case when p_allow_zero then p_w >= 0 else p_w > 0 end and p_w <= 100000 and p_w = round(p_w, 3))
$f$;

create or replace function analytics.job_core_receive(
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in     numeric,
  p_worker_id     uuid,
  p_assignee      text,
  p_channel       text,
  p_actor         uuid,
  p_device_hint   text,
  p_enforce_scope boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_paid    numeric;
  v_def     text;
  v_auto    text := null;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if coalesce(cardinality(v_codes), 0) > 0 and not (v_t.stage_code = any (v_codes)) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if v_job.source_kind = 'oem'
     and not exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.status in ('received', 'sent')) then
    select coalesce(v.paid_thb, 0) into v_paid
      from analytics.oem_quote_item i
      join analytics.v_oem_quote v on v.id = i.quote_id
     where i.id = v_job.oem_quote_item_id;
    if coalesce(v_paid, 0) <= 0 and v_job.start_gate_note is null then
      return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
    end if;
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped): ถ้ายังถือค้าง = ปิดอัตโนมัติ (ยกเว้นทอง) — ยืนยันฝ่ายเดียว (design §5.1 ข้อ 4)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;
  if found then
    if v_p.status = 'received' then
      if v_job.metal = 'gold' then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = case when v_p.id is not null then v_p.qty_out else v_job.qty_planned end,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null);
end;
$f$;

create or replace function analytics.job_core_send(
  p_job_id         uuid,
  p_expected_seq   int,
  p_occurred_on    date,
  p_weight_out     numeric,
  p_qty_scrap      int,
  p_scrap_reason   text,
  p_metal_added    numeric,
  p_weight_note    text,
  p_scrap_weight   numeric,
  p_worker_id      uuid,
  p_channel        text,
  p_actor          uuid,
  p_device_hint    text,
  p_enforce_holder boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_today  date := analytics.job_today();
  v_scrap  int := coalesce(p_qty_scrap, 0);
  v_added  numeric := coalesce(p_metal_added, 0);
  v_reason text := null;
  v_note   text := null;
  v_name   text;
  v_def    text;
  v_next   record;
  v_codes  constant text[] := array['porosity', 'broken', 'wrong_design', 'missing', 'other'];
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว ส่งต่อไม่ได้');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  select * into v_s from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found or v_s.status = 'skipped' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_s.status = 'sent' then
    return analytics.job_fail('already_sent', 'ขั้นนี้ส่งต่อไปแล้ว');
  end if;
  if v_s.status = 'pending' then
    return analytics.job_fail('not_received', 'ขั้นนี้ยังไม่ได้รับงาน ส่งต่อไม่ได้');
  end if;

  -- ช่างส่งต่อได้เฉพาะขั้นที่ตัวเองรับ (design §3 ข้อ 18) · ออฟฟิศไม่ถูกจำกัด
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then
    select coalesce(w.display_name, v_s.assignee_name, 'ผู้ถืออื่น') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_s.worker_id;
    return analytics.job_fail('not_holder', format('งานนี้อยู่กับ %s ไม่ใช่คุณ', v_name), jsonb_build_object('by', v_name));
  end if;

  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;
  if p_occurred_on < v_s.received_on then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ก่อนวันที่รับงานของขั้นนี้');
  end if;

  -- จำนวน: เข้า = ออก + เสีย · ของหายต้องเป็นเสียเหตุผล missing (ไม่มีช่อง "หายเฉยๆ")
  if v_scrap < 0 or v_scrap > v_s.qty_in then
    return analytics.job_fail('qty_invalid', format('จำนวนของเสียต้องอยู่ระหว่าง 0 ถึง %s ชิ้น', v_s.qty_in));
  end if;
  if v_scrap > 0 then
    v_reason := nullif(btrim(p_scrap_reason), '');
    if v_reason is null or not (
         v_reason = any (v_codes)
         or (analytics.oem_note_present(v_reason) and analytics.oem_note_valid(v_reason) and length(v_reason) <= 200 and v_reason !~ '[\r\n\t]')
       ) then
      return analytics.job_fail('reason_required', 'ของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  elsif nullif(btrim(p_scrap_reason), '') is not null then
    return analytics.job_fail('reason_unexpected', 'ไม่มีของเสีย จึงไม่ต้องระบุเหตุผลของเสีย');
  end if;

  -- น้ำหนัก
  if not analytics.job_weight_ok(p_weight_out) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักออกต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if not analytics.job_weight_ok(v_added, true) or not analytics.job_weight_ok(p_scrap_weight) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเติมโลหะ/เศษที่เก็บได้ไม่ถูกต้อง (ทศนิยมไม่เกิน 3 ตำแหน่ง ไม่เกิน 100,000 กรัม)');
  end if;
  if v_s.weigh_required and p_weight_out is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ');
  end if;
  if v_added > 0 then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุเติมโลหะ', 200, true);
    exception when others then
      return analytics.job_fail('note_required', 'เติมโลหะต้องระบุหมายเหตุ');
    end;
  elsif nullif(btrim(p_weight_note), '') is not null then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุน้ำหนัก', 200, false);
    exception when others then
      return analytics.job_fail('note_invalid', 'หมายเหตุน้ำหนักมีอักขระที่ไม่อนุญาตหรือยาวเกิน 200 ตัวอักษร');
    end;
  end if;
  if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added then
    return analytics.job_fail('weight_over',
      format('น้ำหนักออกมากกว่าน้ำหนักเข้า %s g — ถ้าเติมโลหะให้ระบุเติมโลหะพร้อมหมายเหตุ',
             trim_scale(p_weight_out - v_s.weight_in_g - v_added)::text));
  end if;

  update analytics.job_stage
     set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in - v_scrap, qty_scrap = v_scrap, scrap_reason = v_reason,
         weight_out_g = p_weight_out, metal_added_g = v_added, weight_note = v_note, scrap_weight_g = p_scrap_weight
   where id = v_s.id
   returning * into v_s2;

  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_s.stage_code, 'auto_closed', false,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status = 'pending' order by s.seq limit 1;
  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_s.stage_code;

  return jsonb_build_object('ok', true, 'action', 'send', 'job_no', v_job.job_no, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'stage_name', v_def, 'sent_on', p_occurred_on, 'qty_out', v_s2.qty_out, 'qty_scrap', v_s2.qty_scrap,
                            'weight_out_g', v_s2.weight_out_g,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end);
end;
$f$;

-- ============================================================================
-- 12. RPC ออฟฟิศ — สร้างใบงาน
--     ทุกตัว: security definer · crm_require_owner_admin · p_actor ผ่าน coalesce(p_actor, auth.uid()) (0132 M4) บังคับต้องมีค่า
--     raise exception errcode 22023 + hint = code เมื่อผิดกติกา
-- ============================================================================

-- ตรวจรายการขั้นตอน + แปลงเป็นแถว (ภายใน) — คืน warnings
create or replace function analytics.job_validate_stage_codes(p_shop_id uuid, p_codes text[], p_is_new_design boolean)
 returns text[]
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_bad   text;
  v_warn  text[] := '{}';
begin
  perform analytics.job_stage_def_ensure(p_shop_id);
  if p_codes is null or cardinality(p_codes) = 0 then
    raise exception 'ต้องเลือกขั้นตอนอย่างน้อย 1 ขั้น (ต้องมี QC และแพ็ก)' using errcode = '22023', hint = 'stages_empty';
  end if;
  if cardinality(p_codes) > 20 or exists (select 1 from unnest(p_codes) c where c is null) then
    raise exception 'รายการขั้นตอนไม่ถูกต้อง' using errcode = '22023', hint = 'stages_invalid';
  end if;
  if (select count(distinct c) from unnest(p_codes) c) <> cardinality(p_codes) then
    raise exception 'รายการขั้นตอนซ้ำกัน' using errcode = '22023', hint = 'stages_duplicate';
  end if;
  select string_agg(c, ', ') into v_bad
    from unnest(p_codes) c
    left join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = c
   where d.code is null or not d.is_active;
  if v_bad is not null then
    raise exception 'ขั้นตอน % ไม่มีในทะเบียนหรือถูกปิดใช้งาน', v_bad using errcode = '22023', hint = 'stages_unknown';
  end if;
  if not ('qc' = any (p_codes)) or not ('pack' = any (p_codes)) then
    raise exception 'ใบงานต้องมีขั้น QC และแพ็กเสมอ' using errcode = '22023', hint = 'stages_need_qc_pack';
  end if;
  if exists (
       select 1
         from unnest(p_codes) with ordinality as a(code, ord)
         join unnest(p_codes) with ordinality as b(code, ord) on b.ord = a.ord + 1
         join analytics.job_stage_def da on da.shop_id = p_shop_id and da.code = a.code
         join analytics.job_stage_def db on db.shop_id = p_shop_id and db.code = b.code
        where da.seq_default >= db.seq_default) then
    raise exception 'ลำดับขั้นตอนต้องเรียงตามลำดับมาตรฐาน (CAD ถึงแพ็ก)' using errcode = '22023', hint = 'stages_order';
  end if;
  if not coalesce(p_is_new_design, false) and p_codes && array['cad', 'print3d', 'mold'] then
    v_warn := v_warn || 'งานนี้ไม่ใช่แบบใหม่ แต่เลือกขั้นออกแบบ/ปริ้น 3D/อัดก้อนยาง';
  end if;
  return v_warn;
end;
$f$;

-- สร้างใบงาน + ขั้นทั้งชุด + event create (ภายใน)
create or replace function analytics.job_create_insert(
  p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq int,
  p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty int,
  p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_seq    int;
  v_job    analytics.job%rowtype;
  v_warn   text[];
  v_today  date := analytics.job_today();
begin
  v_warn := analytics.job_validate_stage_codes(p_shop_id, p_codes, p_is_new_design);
  if p_due is not null and (p_due < v_today or p_due > v_today + 730) then
    raise exception 'กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า' using errcode = '22023', hint = 'due_invalid';
  end if;

  insert into analytics.job_counter as c (shop_id, last_no) values (p_shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;

  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id,
                             product_id, design_label, sku_snapshot, metal, qty_planned, weigh_required, due_date,
                             start_gate_note, created_by, note)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty, p_metal in ('gold', 'silver'), p_due,
          p_gate_note, p_actor, p_note)
  returning * into v_job;

  -- weigh_required ต่อขั้น: ทอง = ขั้นที่โลหะอยู่ในมือ (cast..pack) · เงิน = หล่อ/ตัดต้น/ขัด · ทองเหลือง = ไม่บังคับ (มติ Q1)
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required)
  select v_job.id, p_shop_id, a.code, a.ord::int,
         case p_metal when 'gold' then d.metal_present when 'silver' then d.weigh_default else false end
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, null, 'job_page', null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null));

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null);
end;
$f$;

-- ข้อมูลตั้งต้นของ item (ภายใน) — ใช้ทั้ง suggest และ create · คืนแถวเดียวเป็น jsonb หรือ raise
create or replace function analytics.job_source_info(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_metal     text;
  v_new       boolean;
  v_gem       int;
  v_plating   text;
  v_i         record;
  v_p         record;
  v_paid      numeric;
  v_existing  record;
  v_label     text;
  v_codes     text[];
  v_pmetal    text;
begin
  if p_source_kind = 'oem' then
    select i.id, i.shop_id, i.seq, i.qty, i.input, i.product_id, i.sku_snapshot, i.product_name_snapshot,
           q.id as quote_id, q.status as quote_status, coalesce(q.root_quote_id, q.id) as root_id
      into v_i
      from analytics.oem_quote_item i
      join analytics.oem_quote q on q.id = i.quote_id
     where i.id = p_item_id and i.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบเสนอราคา' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_i.quote_status <> 'won' then
      raise exception 'สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_i.quote_status
        using errcode = '22023', hint = 'quote_not_won';
    end if;
    v_metal := v_i.input ->> 'metal';
    if v_metal = 'product' then
      raise exception 'รายการสินค้า/บริการไม่ใช่งานผลิต สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal = 'silver999' then
      raise exception 'เงินแท่งไม่มีขั้นตอนผลิตในโรงงาน สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
      raise exception 'รายการนี้ไม่ระบุโลหะที่ใบงานรองรับ (เงิน/ทอง/ทองเหลือง)' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    v_new := coalesce((v_i.input ->> 'is_new_design') = 'true', false);
    v_gem := case when (v_i.input ->> 'gem_count') ~ '^[0-9]+$' then (v_i.input ->> 'gem_count')::int else 0 end;
    v_plating := nullif(btrim(coalesce(v_i.input ->> 'plating_type', '')), '');
    select coalesce(v.paid_thb, 0) into v_paid from analytics.v_oem_quote v where v.id = v_i.quote_id;
    select j.id, j.job_no into v_existing from analytics.job j
     where j.status <> 'cancelled' and (j.oem_quote_item_id = v_i.id or (j.root_quote_id = v_i.root_id and j.oem_item_seq = v_i.seq)) limit 1;
    v_label := coalesce(nullif(btrim(v_i.product_name_snapshot), ''), nullif(btrim(v_i.sku_snapshot), ''),
                        coalesce(nullif(v_i.input ->> 'item_kind', ''), 'งาน OEM') || ' #' || v_i.seq);
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
    if v_new then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    if v_gem > 0 then v_codes := v_codes || 'gem_set'; end if;
    if v_plating is not null and v_plating not in ('none', 'null') then v_codes := v_codes || 'plating'; end if;
    return jsonb_build_object('source_kind', 'oem', 'item_id', v_i.id, 'quote_id', v_i.quote_id, 'root_quote_id', v_i.root_id,
      'item_seq', v_i.seq, 'metal', v_metal, 'qty', v_i.qty, 'is_new_design', v_new, 'design_label', left(v_label, 200),
      'sku', left(v_i.sku_snapshot, 100), 'product_id', v_i.product_id, 'deposit_missing', coalesce(v_paid, 0) <= 0,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)));
  elsif p_source_kind = 'production' then
    select poi.id, poi.shop_id, poi.qty_planned, poi.is_new_design, poi.product_id,
           po.status as po_status, p.sku, p.name, p.cost_type, p.make_spec
      into v_p
      from analytics.production_order_item poi
      join analytics.production_order po on po.id = poi.production_order_id
      join public.product p on p.id = poi.product_id
     where poi.id = p_item_id and poi.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบผลิต' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_p.po_status <> 'open' then
      raise exception 'สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_p.po_status using errcode = '22023', hint = 'po_not_open';
    end if;
    v_pmetal := v_p.make_spec ->> 'metal';
    v_metal := case
      when v_pmetal in ('silver', 'gold', 'brass') then v_pmetal
      when v_pmetal is null and v_p.cost_type in ('fixed', 'spot') then 'silver'
      else null end;
    if v_metal is null then
      raise exception 'ระบุโลหะของสินค้านี้ไม่ได้ (ใบงานรองรับเงิน/ทอง/ทองเหลือง) — ตรวจสเปกการผลิตของสินค้าก่อน' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    select j.id, j.job_no into v_existing from analytics.job j where j.status <> 'cancelled' and j.production_order_item_id = v_p.id limit 1;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
    if coalesce(v_p.is_new_design, false) then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    return jsonb_build_object('source_kind', 'production', 'item_id', v_p.id, 'metal', v_metal, 'qty', v_p.qty_planned,
      'is_new_design', coalesce(v_p.is_new_design, false), 'design_label', left(coalesce(nullif(btrim(v_p.name), ''), v_p.sku), 200),
      'sku', left(v_p.sku, 100), 'product_id', v_p.product_id, 'deposit_missing', false,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)));
  end if;
  raise exception 'source_kind ต้องเป็น oem หรือ production' using errcode = '22023', hint = 'source_invalid';
end;
$f$;

create or replace function analytics.job_sort_stage_codes(p_shop_id uuid, p_codes text[])
 returns text[]
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select coalesce(array_agg(d.code order by d.seq_default), '{}')
    from analytics.job_stage_def d
   where d.shop_id = p_shop_id and d.code = any (p_codes) and d.is_active
$f$;

-- 12.1 ข้อเสนอรายการขั้นตอนเริ่มต้น + สถานะของ item (อ่านอย่างเดียว) — ให้ UI เปิด dialog "สร้างใบงาน"
create or replace function analytics.job_stage_suggest(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_info jsonb;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'job_stage_suggest: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.job_stage_def_ensure(p_shop_id);
  v_info := analytics.job_source_info(p_shop_id, p_source_kind, p_item_id);
  return v_info || jsonb_build_object('stages', (
    select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name_th', d.name_th, 'seq_default', d.seq_default,
                                                 'cost_block', d.cost_block, 'default_selected', d.code in (select jsonb_array_elements_text(v_info -> 'suggested_stage_codes')))
                              order by d.seq_default), '[]'::jsonb)
      from analytics.job_stage_def d where d.shop_id = p_shop_id and d.is_active));
end;
$f$;

-- 12.2 สร้างจาก OEM quote item (ใบต้อง won · ดีลที่ยังไม่มีเงินเข้าต้องมีเหตุผล start_gate_note)
create or replace function analytics.job_create_from_quote_item(
  p_shop_id         uuid,
  p_quote_item_id   uuid,
  p_stage_codes     text[],
  p_due_date        date default null,
  p_start_gate_note text default null,
  p_design_label    text default null,
  p_note            text default null,
  p_actor           uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_gate  text;
  v_label text;
  v_note  text;
  v_dup   record;
begin
  if p_shop_id is null or p_quote_item_id is null then
    raise exception 'job_create_from_quote_item: p_shop_id และ p_quote_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_quote_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- กันสร้างซ้ำพร้อมกัน: ล็อกแถวใบเสนอราคาของ item นี้ก่อนตรวจ/นับเลข
  perform 1 from analytics.oem_quote q join analytics.oem_quote_item i on i.quote_id = q.id
   where i.id = p_quote_item_id and q.shop_id = p_shop_id for share of q;
  v_info := analytics.job_source_info(p_shop_id, 'oem', p_quote_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_gate := analytics.job_text_clean(p_start_gate_note, 'เหตุผลที่เริ่มผลิตก่อนมัดจำ', 500, false);
  if (v_info ->> 'deposit_missing')::boolean and v_gate is null then
    raise exception 'ดีลนี้ยังไม่มีเงินมัดจำเข้า — ต้องระบุเหตุผลที่ยอมเริ่มผลิตก่อน (start_gate_note)' using errcode = '22023', hint = 'start_gate_required';
  end if;
  if v_gate is not null and not analytics.oem_note_present(v_gate) then
    raise exception 'เหตุผลที่เริ่มผลิตก่อนมัดจำต้องมีตัวอักษรหรือตัวเลขจริง' using errcode = '22023', hint = 'start_gate_required';
  end if;
  v_label := coalesce(analytics.job_text_clean(p_design_label, 'ชื่อแบบ', 200, false), v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);

  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', (v_info ->> 'qty')::int,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor);
end;
$f$;

-- 12.3 สร้างจาก production order item (ใบผลิตต้อง open) — ไม่แตะ production_order_done
create or replace function analytics.job_create_from_production_item(
  p_shop_id                  uuid,
  p_production_order_item_id uuid,
  p_stage_codes              text[],
  p_due_date                 date default null,
  p_design_label             text default null,
  p_note                     text default null,
  p_actor                    uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_label text;
  v_note  text;
begin
  if p_shop_id is null or p_production_order_item_id is null then
    raise exception 'job_create_from_production_item: p_shop_id และ p_production_order_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_production_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform 1 from analytics.production_order po join analytics.production_order_item poi on poi.production_order_id = po.id
   where poi.id = p_production_order_item_id and po.shop_id = p_shop_id for share of po;
  v_info := analytics.job_source_info(p_shop_id, 'production', p_production_order_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_label := coalesce(analytics.job_text_clean(p_design_label, 'ชื่อแบบ', 200, false), v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);

  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', (v_info ->> 'qty')::int,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor);
end;
$f$;

-- ============================================================================
-- 13. RPC ออฟฟิศ — วงจรชีวิตใบงาน (token · กรอกแทน · ข้าม/ย้อน · กำหนดส่ง · ปิด/ยกเลิก)
-- ============================================================================

-- prelude ร่วม: สิทธิ์ owner/admin -> ผู้ทำรายการต้องมีค่า -> lock แถวใบงานของร้านนี้ (ข้ามร้าน = ไม่พบ)
create or replace function analytics.job_office_begin(p_fn text, p_shop_id uuid, p_job_id uuid, p_actor uuid, p_allow_terminal boolean default false)
 returns analytics.job
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
begin
  if p_shop_id is null or p_job_id is null then
    raise exception '%: p_shop_id และ p_job_id จำเป็น', p_fn using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_actor is null then
    raise exception '%: ต้องระบุผู้ทำรายการ (p_actor)', p_fn using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_job from analytics.job where id = p_job_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
  end if;
  if not p_allow_terminal and v_job.status in ('done', 'cancelled') then
    raise exception 'ใบงาน % ปิดแล้ว (%) แก้ไขไม่ได้', v_job.job_no, v_job.status using errcode = '22023', hint = 'job_closed';
  end if;
  return v_job;
end;
$f$;

-- 13.1 ออก token ใหม่ให้ใบงาน (พิมพ์ใบงาน) — คืน token ดิบ "ครั้งเดียว" ให้ server ทำ QR · DB เก็บแต่ sha256
--      p_revoke_previous = true (ค่าเริ่ม, มติ Q11) -> เพิกถอน token เก่าทั้งหมด · false = พิมพ์สำเนาเพิ่ม (ไม่เกิน 5 ใบที่ใช้งานอยู่)
create or replace function analytics.job_token_issue(
  p_shop_id          uuid,
  p_job_id           uuid,
  p_revoke_previous  boolean default true,
  p_actor            uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_job     analytics.job%rowtype;
  v_paid    numeric;
  v_revoked int := 0;
  v_active  int;
  v_print   int;
  v_raw     text;
  v_hash    text;
  v_today   date := analytics.job_today();
begin
  v_job := analytics.job_office_begin('job_token_issue', p_shop_id, p_job_id, v_actor);
  if v_job.source_kind = 'oem' and v_job.start_gate_note is null then
    select coalesce(v.paid_thb, 0) into v_paid
      from analytics.oem_quote_item i join analytics.v_oem_quote v on v.id = i.quote_id
     where i.id = v_job.oem_quote_item_id;
    if coalesce(v_paid, 0) <= 0 then
      raise exception 'ดีลนี้ยังไม่มีเงินมัดจำ — บันทึกเหตุผลที่เริ่มผลิตก่อน แล้วค่อยพิมพ์ใบงาน' using errcode = '22023', hint = 'start_gate_required';
    end if;
  end if;

  if coalesce(p_revoke_previous, true) then
    with r as (
      update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'reprint'
       where job_id = p_job_id and revoked_at is null returning 1)
    select count(*) into v_revoked from r;
    if v_revoked > 0 then
      perform analytics.job_event_write(p_job_id, null, 'token_revoke', v_today, v_actor, null, 'job_page', null,
        jsonb_build_object('reason', 'reprint', 'count', v_revoked));
    end if;
  end if;
  select count(*) into v_active from analytics.job_token where job_id = p_job_id and revoked_at is null;
  if v_active >= 5 then
    raise exception 'ใบงานนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม' using errcode = '22023', hint = 'token_cap';
  end if;

  select coalesce(max(print_no), 0) + 1 into v_print from analytics.job_token where job_id = p_job_id;
  -- 32 bytes สุ่มจาก pgcrypto -> base64url 43 ตัวอักษร (ไม่มี padding)
  v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_hash := analytics.job_sha256_hex(v_raw);
  insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by)
  values (v_job.shop_id, p_job_id, v_hash, v_print, v_actor);

  perform analytics.job_event_write(p_job_id, null, 'token_issue', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('print_no', v_print, 'revoked_previous', v_revoked));

  return jsonb_build_object('token', v_raw, 'print_no', v_print, 'job_id', p_job_id, 'job_no', v_job.job_no,
                            'revoked_previous', v_revoked);
end;
$f$;

create or replace function analytics.job_token_revoke(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_reason text;
  v_n      int;
begin
  v_job := analytics.job_office_begin('job_token_revoke', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่เพิกถอน QR', 200, true);
  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = v_reason
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_n from r;
  if v_n > 0 then
    perform analytics.job_event_write(p_job_id, null, 'token_revoke', analytics.job_today(), v_actor, null, 'job_page', null,
      jsonb_build_object('reason', v_reason, 'count', v_n));
  end if;
  return jsonb_build_object('job_id', p_job_id, 'job_no', v_job.job_no, 'revoked', v_n);
end;
$f$;

-- 13.2 กรอกแทนจากกระดาษ (ทางสำรอง) — วันที่ย้อนได้ <= 14 วัน ไม่อนาคต · ต้องระบุคนถือ (ช่างในทะเบียนหรือชื่อที่พิมพ์)
create or replace function analytics.job_office_receive(
  p_shop_id       uuid,
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in_g   numeric default null,
  p_worker_id     uuid default null,
  p_assignee_name text default null,
  p_channel       text default 'job_page',
  p_actor         uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor    uuid := coalesce(p_actor, auth.uid());
  v_job      analytics.job%rowtype;
  v_assignee text;
  v_r        jsonb;
begin
  v_job := analytics.job_office_begin('job_office_receive', p_shop_id, p_job_id, v_actor);
  if p_channel is null or p_channel not in ('job_page', 'daily_sheet') then
    raise exception 'ช่องทางต้องเป็น job_page หรือ daily_sheet' using errcode = '22023', hint = 'channel_invalid';
  end if;
  v_assignee := analytics.job_text_clean(p_assignee_name, 'ชื่อผู้รับงาน', 60, false);
  if p_worker_id is not null and not exists (
       select 1 from analytics.worker w where w.id = p_worker_id and w.shop_id = p_shop_id and w.is_active) then
    raise exception 'ไม่พบช่างที่ใช้งานอยู่ในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  v_r := analytics.job_core_receive(p_job_id, p_expected_seq, p_occurred_on, p_weight_in_g, p_worker_id, v_assignee,
                                    p_channel, v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

create or replace function analytics.job_office_send(
  p_shop_id        uuid,
  p_job_id         uuid,
  p_expected_seq   int,
  p_occurred_on    date,
  p_weight_out_g   numeric default null,
  p_qty_scrap      int default 0,
  p_scrap_reason   text default null,
  p_metal_added_g  numeric default 0,
  p_weight_note    text default null,
  p_scrap_weight_g numeric default null,
  p_channel        text default 'job_page',
  p_actor          uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_r     jsonb;
begin
  v_job := analytics.job_office_begin('job_office_send', p_shop_id, p_job_id, v_actor);
  if p_channel is null or p_channel not in ('job_page', 'daily_sheet') then
    raise exception 'ช่องทางต้องเป็น job_page หรือ daily_sheet' using errcode = '22023', hint = 'channel_invalid';
  end if;
  v_r := analytics.job_core_send(p_job_id, p_expected_seq, p_occurred_on, p_weight_out_g, p_qty_scrap, p_scrap_reason,
                                 p_metal_added_g, p_weight_note, p_scrap_weight_g, null, p_channel, v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

-- 13.3 ข้ามขั้น (เฉพาะขั้น pending + เหตุผล)
create or replace function analytics.job_stage_skip(p_shop_id uuid, p_job_id uuid, p_stage_code text, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_reason text;
begin
  v_job := analytics.job_office_begin('job_stage_skip', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ข้ามขั้น', 200, true);
  select * into v_s from analytics.job_stage where job_id = p_job_id and stage_code = p_stage_code;
  if not found then
    raise exception 'ใบงานนี้ไม่มีขั้นตอนที่ระบุ' using errcode = '22023', hint = 'stage_not_found';
  end if;
  if v_s.status <> 'pending' then
    raise exception 'ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน (ขั้นนี้สถานะ %)', v_s.status using errcode = '22023', hint = 'stage_not_pending';
  end if;
  update analytics.job_stage set status = 'skipped', skip_reason = v_reason where id = v_s.id returning * into v_s2;
  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_skip', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('stage_code', v_s.stage_code, 'reason', v_reason,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'stage_code', v_s.stage_code, 'status', 'skipped');
end;
$f$;

-- 13.4 ย้อนขั้นทีละขั้นจากล่าสุด (เหตุผลบังคับ · ช่างทำไม่ได้ — ไม่มี RPC ฝั่งช่าง)
--      received->pending · sent->received · skipped->pending · ค่าเก่าเก็บใน job_event.payload.before
create or replace function analytics.job_stage_reopen(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_reason text;
begin
  v_job := analytics.job_office_begin('job_stage_reopen', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ย้อนขั้น', 200, true);
  select * into v_s from analytics.job_stage where job_id = p_job_id and status <> 'pending' order by seq desc limit 1;
  if not found then
    raise exception 'ใบงานนี้ยังไม่มีความคืบหน้าให้ย้อน' using errcode = '22023', hint = 'nothing_to_reopen';
  end if;
  if v_s.status = 'received' then
    update analytics.job_stage
       set status = 'pending', received_on = null, worker_id = null, assignee_name = null, qty_in = null, weight_in_g = null
     where id = v_s.id returning * into v_s2;
  elsif v_s.status = 'sent' then
    update analytics.job_stage
       set status = 'received', sent_on = null, qty_out = null, qty_scrap = 0, scrap_reason = null, weight_out_g = null,
           metal_added_g = 0, weight_note = null, scrap_weight_g = null, auto_closed = false
     where id = v_s.id returning * into v_s2;
  else
    update analytics.job_stage set status = 'pending', skip_reason = null where id = v_s.id returning * into v_s2;
  end if;
  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_reopen', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('stage_code', v_s.stage_code, 'reason', v_reason,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'stage_code', v_s.stage_code, 'from', v_s.status, 'to', v_s2.status);
end;
$f$;

-- 13.5 กำหนดส่ง / เหตุผลเริ่มก่อนมัดจำ
create or replace function analytics.job_set_due(p_shop_id uuid, p_job_id uuid, p_due_date date, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_today date := analytics.job_today();
begin
  v_job := analytics.job_office_begin('job_set_due', p_shop_id, p_job_id, v_actor);
  if p_due_date is not null and (p_due_date < v_today or p_due_date > v_today + 730) then
    raise exception 'กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า' using errcode = '22023', hint = 'due_invalid';
  end if;
  update analytics.job set due_date = p_due_date where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'due_set', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('before', v_job.due_date, 'after', p_due_date));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'due_date', p_due_date);
end;
$f$;

create or replace function analytics.job_start_gate_note_set(p_shop_id uuid, p_job_id uuid, p_note text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_note  text;
begin
  v_job := analytics.job_office_begin('job_start_gate_note_set', p_shop_id, p_job_id, v_actor);
  if v_job.source_kind <> 'oem' then
    raise exception 'เหตุผลเริ่มก่อนมัดจำใช้กับงาน OEM เท่านั้น' using errcode = '22023', hint = 'not_oem';
  end if;
  v_note := analytics.job_text_clean(p_note, 'เหตุผลที่เริ่มผลิตก่อนมัดจำ', 500, true);
  update analytics.job set start_gate_note = v_note where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'note', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('kind', 'start_gate_note', 'before_present', v_job.start_gate_note is not null));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no);
end;
$f$;

-- 13.6 ปิดงาน — ทุกขั้นต้อง sent/skipped · ดี + เสีย = แผน · ดี <= จำนวนที่เหลือจากขั้นสุดท้าย · ทองต้องมีน้ำหนักสุทธิ · เพิกถอน token ทั้งหมด
create or replace function analytics.job_done(
  p_shop_id        uuid,
  p_job_id         uuid,
  p_qty_good       int,
  p_qty_scrap      int,
  p_weight_final_g numeric default null,
  p_note           text default null,
  p_actor          uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor     uuid := coalesce(p_actor, auth.uid());
  v_job       analytics.job%rowtype;
  v_open      int;
  v_first     text;
  v_final_out int;
  v_note      text;
  v_tokens    int;
  v_today     date := analytics.job_today();
begin
  v_job := analytics.job_office_begin('job_done', p_shop_id, p_job_id, v_actor);
  select count(*), min(d.name_th) into v_open, v_first
    from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status in ('pending', 'received');
  if v_open > 0 then
    raise exception 'ปิดงานไม่ได้ — ยังมี % ขั้นที่ยังไม่เสร็จ (เช่น %)', v_open, v_first using errcode = '22023', hint = 'stages_open';
  end if;
  if p_qty_good is null or p_qty_scrap is null or p_qty_good < 0 or p_qty_scrap < 0 or p_qty_good > 100000 or p_qty_scrap > 100000
     or p_qty_good + p_qty_scrap <> v_job.qty_planned then
    raise exception 'จำนวนดี + จำนวนเสีย ต้องเท่ากับจำนวนที่วางแผน (% ชิ้น)', v_job.qty_planned using errcode = '22023', hint = 'qty_mismatch';
  end if;
  select s.qty_out into v_final_out from analytics.job_stage s
   where s.job_id = p_job_id and s.status = 'sent' order by s.seq desc limit 1;
  v_final_out := coalesce(v_final_out, v_job.qty_planned);
  if p_qty_good > v_final_out then
    raise exception 'จำนวนดี (%) มากกว่าจำนวนที่เหลือจากขั้นสุดท้าย (%) — ตรวจของเสียรายขั้นก่อน', p_qty_good, v_final_out
      using errcode = '22023', hint = 'qty_exceeds_final';
  end if;
  if not analytics.job_weight_ok(p_weight_final_g) then
    raise exception 'น้ำหนักสุทธิต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'weight_invalid';
  end if;
  if v_job.metal = 'gold' and p_weight_final_g is null then
    raise exception 'งานทองต้องระบุน้ำหนักสุทธิตอนปิดงาน' using errcode = '22023', hint = 'weight_required';
  end if;
  v_note := coalesce(analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false), v_job.note);

  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'job_done'
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_tokens from r;

  update analytics.job
     set status = 'done', done_at = now(), qty_good = p_qty_good, qty_scrap = p_qty_scrap,
         weight_final_g = p_weight_final_g, note = v_note
   where id = p_job_id;

  perform analytics.job_event_write(p_job_id, null, 'done', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('qty_good', p_qty_good, 'qty_scrap', p_qty_scrap, 'weight_final_g', p_weight_final_g, 'tokens_revoked', v_tokens));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'done', 'qty_good', p_qty_good, 'qty_scrap', p_qty_scrap);
end;
$f$;

create or replace function analytics.job_cancel(p_shop_id uuid, p_job_id uuid, p_reason text, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_reason text;
  v_tokens int;
begin
  v_job := analytics.job_office_begin('job_cancel', p_shop_id, p_job_id, v_actor);
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ยกเลิกใบงาน', 300, true);
  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'job_cancel'
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_tokens from r;
  update analytics.job set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason where id = p_job_id;
  perform analytics.job_event_write(p_job_id, null, 'cancel', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('reason', v_reason, 'tokens_revoked', v_tokens));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'cancelled');
end;
$f$;

-- ============================================================================
-- 14. RPC ออฟฟิศ — ทะเบียนช่าง (เพิ่ม/แก้/ปิด/เปิด/ตั้ง PIN) · PIN 4 หลัก เก็บเป็น bcrypt (pgcrypto) ไม่เก็บ PIN ดิบ
--     PIN ที่ระบบสุ่มให้คืนกลับ "ครั้งเดียว" ใน jsonb (UI แสดงแล้วทิ้ง) · ปฏิเสธ PIN เดาง่าย (เลขซ้ำ/เรียงต่อเนื่อง)
-- ============================================================================

create or replace function analytics.job_pin_ok(p_pin text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select p_pin ~ '^[0-9]{4}$'
     and p_pin !~ '^(.)\1{3}$'
     and p_pin <> all (array['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876', '0000', '2580'])
$f$;

create or replace function analytics.job_pin_generate()
 returns text
 language plpgsql
 set search_path to 'pg_catalog', 'extensions', 'pg_temp'
as $f$
declare
  b bytea;
  v text;
begin
  loop
    b := extensions.gen_random_bytes(4);
    v := lpad((((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3)) % 10000))::text, 4, '0');
    exit when analytics.job_pin_ok(v);
  end loop;
  return v;
end;
$f$;

create or replace function analytics.worker_codes_clean(p_shop_id uuid, p_codes text[])
 returns text[]
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_norm text[];
  v_bad  text;
begin
  perform analytics.job_stage_def_ensure(p_shop_id);
  select coalesce(array_agg(distinct c order by c), '{}') into v_norm from unnest(coalesce(p_codes, '{}')) c where c is not null;
  select string_agg(c, ', ') into v_bad from unnest(v_norm) c
    left join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = c where d.code is null;
  if v_bad is not null then
    raise exception 'ขั้นตอน % ไม่มีในทะเบียน', v_bad using errcode = '22023', hint = 'stages_unknown';
  end if;
  return v_norm;
end;
$f$;

create or replace function analytics.worker_upsert(
  p_shop_id      uuid,
  p_id           uuid default null,
  p_display_name text default null,
  p_stage_codes  text[] default '{}',
  p_pin          text default null,
  p_actor        uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_name  text;
  v_codes text[];
  v_pin   text;
  v_w     analytics.worker%rowtype;
  v_gen   boolean := false;
begin
  if p_shop_id is null then
    raise exception 'worker_upsert: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_upsert: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  v_name := analytics.job_text_clean(p_display_name, 'ชื่อช่าง', 60, true);
  v_codes := analytics.worker_codes_clean(p_shop_id, p_stage_codes);

  if p_id is null then
    v_pin := p_pin;
    if v_pin is null then
      v_pin := analytics.job_pin_generate();
      v_gen := true;
    elsif not analytics.job_pin_ok(v_pin) then
      raise exception 'PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย' using errcode = '22023', hint = 'pin_invalid';
    end if;
    begin
      insert into analytics.worker (shop_id, display_name, stage_codes, pin_hash, created_by)
      values (p_shop_id, v_name, v_codes, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), v_actor)
      returning * into v_w;
    exception when unique_violation then
      raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
    end;
    insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
    values (p_shop_id, v_w.id, 'create', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes), 'pin_generated', v_gen));
    return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes),
                              'pin', case when v_gen then v_pin else null end, 'pin_generated', v_gen);
  end if;

  if p_pin is not null then
    raise exception 'แก้ช่างเดิมไม่รับ PIN — ใช้ worker_pin_set เพื่อรีเซ็ต PIN' using errcode = '22023', hint = 'use_pin_set';
  end if;
  select * into v_w from analytics.worker where id = p_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  begin
    update analytics.worker set display_name = v_name, stage_codes = v_codes where id = p_id returning * into v_w;
  exception when unique_violation then
    raise exception 'มีช่างชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'worker_name_taken';
  end;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_id, 'update', v_actor, jsonb_build_object('display_name', v_name, 'stage_codes', to_jsonb(v_codes)));
  return jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name, 'stage_codes', to_jsonb(v_w.stage_codes), 'pin', null, 'pin_generated', false);
end;
$f$;

create or replace function analytics.worker_pin_set(p_shop_id uuid, p_worker_id uuid, p_pin text default null, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_pin   text;
  v_gen   boolean := false;
  v_w     analytics.worker%rowtype;
begin
  if p_shop_id is null or p_worker_id is null then
    raise exception 'worker_pin_set: p_shop_id และ p_worker_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_pin_set: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_w from analytics.worker where id = p_worker_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  v_pin := p_pin;
  if v_pin is null then
    v_pin := analytics.job_pin_generate();
    v_gen := true;
  elsif not analytics.job_pin_ok(v_pin) then
    raise exception 'PIN ต้องเป็นตัวเลข 4 หลัก และห้ามเป็นเลขซ้ำ/เรียงต่อเนื่อง/เดาง่าย' using errcode = '22023', hint = 'pin_invalid';
  end if;
  -- รีเซ็ต PIN = ปลดล็อก + ล้างตัวนับ + ทุก session เดิมของช่างคนนี้หมดอายุทันที
  update analytics.worker
     set pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, last_failed_at = null, locked_until = null
   where id = p_worker_id;
  update analytics.worker_session set revoked_at = clock_timestamp() where worker_id = p_worker_id and revoked_at is null;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_worker_id, 'pin_set', v_actor, jsonb_build_object('pin_generated', v_gen));
  return jsonb_build_object('worker_id', p_worker_id, 'pin', case when v_gen then v_pin else null end, 'pin_generated', v_gen);
end;
$f$;

create or replace function analytics.worker_set_active(p_shop_id uuid, p_worker_id uuid, p_active boolean, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_w     analytics.worker%rowtype;
begin
  if p_shop_id is null or p_worker_id is null or p_active is null then
    raise exception 'worker_set_active: p_shop_id, p_worker_id, p_active จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'worker_set_active: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  select * into v_w from analytics.worker where id = p_worker_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบช่างในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  update analytics.worker
     set is_active = p_active, deactivated_at = case when p_active then null else now() end
   where id = p_worker_id;
  if not p_active then
    -- ปิดช่าง -> session ที่ออกไปแล้วหลุดทันที (ทุก RPC เช็ค is_active สดอยู่แล้ว · นี่คือกันซ้ำอีกชั้น)
    update analytics.worker_session set revoked_at = clock_timestamp() where worker_id = p_worker_id and revoked_at is null;
  end if;
  insert into analytics.worker_audit (shop_id, worker_id, action, actor, detail)
  values (p_shop_id, p_worker_id, case when p_active then 'reactivate' else 'deactivate' end, v_actor, '{}'::jsonb);
  return jsonb_build_object('worker_id', p_worker_id, 'is_active', p_active);
end;
$f$;

-- ============================================================================
-- 15. RPC ฝั่งช่าง (route สาธารณะ /w/<token> เรียกผ่าน server action ด้วย service client)
--     สัญญา (ทุกตัว):
--       - รับ "hash" ไม่ใช่ค่าดิบ: p_token_hash = sha256 hex (ตัวพิมพ์เล็ก 64 ตัว) ของ token 43 ตัวอักษรบน QR (hash จากสตริง UTF-8 ตรงๆ)
--         p_session_hash = sha256 hex ของ session token ที่ worker_pin_verify คืนให้ · token ดิบ/เลขงาน (JB-0001) ส่งมา = ไม่ผ่านรูปแบบ
--       - ไม่มี auth.uid() · ไม่ข้ามไปเรียก RPC ออฟฟิศ · ไม่มี parameter เลือกขั้นเอง (มีแค่ p_expected_seq = ขั้นที่หน้าจอเห็น
--         ใช้กัน 2 มือถือกดพร้อมกัน/หน้าค้าง: ไม่ตรงกับสถานะจริง -> ปฏิเสธ ไม่เลื่อนไปทำขั้นถัดไปแทน)
--       - 🔴 คืน jsonb {ok:false, code, message(ไทย)} แทน raise ทุกกรณีที่คาดได้ — raise = rollback ตัวนับ PIN ผิด/rate limit
--       - ทุกครั้ง: rate limit (ip_hash 200/10 นาที · token 60/10 นาที) -> token ใช้งานได้ -> ใบงานยังไม่ปิด -> session + worker.is_active สด
-- ============================================================================

create or replace function analytics.job_worker_auth(
  p_token_hash       text,
  p_session_hash     text,
  p_ip_hash          text,
  p_require_session  boolean,
  p_lock             boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_tok analytics.job_token%rowtype;
  v_job analytics.job%rowtype;
  v_w   analytics.worker%rowtype;
begin
  if p_ip_hash is not null and p_ip_hash ~ '^[0-9a-f]{64}$' then
    if not analytics.job_rate_limit_hit('ip:' || left(p_ip_hash, 32), 200) then
      return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    end if;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
  end if;
  if not analytics.job_rate_limit_hit('tok:' || left(p_token_hash, 32), 60) then
    return analytics.job_fail('rate_limited', 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
  end if;

  select * into v_tok from analytics.job_token t where t.token_hash = p_token_hash and t.revoked_at is null;
  if not found then
    return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
  end if;
  if p_lock then
    select * into v_job from analytics.job j where j.id = v_tok.job_id for update;
    -- ระหว่างรอ lock อาจมีคนเพิกถอน token -> ตรวจซ้ำหลังได้ lock
    perform 1 from analytics.job_token t where t.id = v_tok.id and t.revoked_at is null;
    if not found then
      return analytics.job_fail('invalid_token', 'ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ');
    end if;
  else
    select * into v_job from analytics.job j where j.id = v_tok.job_id;
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว', jsonb_build_object('job_no', v_job.job_no));
  end if;

  if p_session_hash is not null and p_session_hash ~ '^[0-9a-f]{64}$' then
    select w.* into v_w
      from analytics.worker_session s
      join analytics.worker w on w.id = s.worker_id and w.shop_id = s.shop_id
     where s.session_hash = p_session_hash and s.revoked_at is null and s.expires_at > now()
       and w.is_active and w.shop_id = v_job.shop_id;
  end if;
  if p_require_session and v_w.id is null then
    return analytics.job_fail('session_required', 'กรุณาเลือกชื่อและใส่ PIN ก่อน', jsonb_build_object('job_no', v_job.job_no));
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'shop_id', v_job.shop_id, 'worker_id', v_w.id,
                            'worker_name', v_w.display_name, 'session_expired', p_session_hash is not null and v_w.id is null);
end;
$f$;

-- 15.1 ระบุตัวช่าง: ชื่อ + PIN 4 หลัก -> session token สุ่ม (เก็บแต่ sha256 · หมดอายุ 12 ชม.)
--      ผิดเกิน 5 ครั้งใน 15 นาที -> ล็อก 15 นาที (นับใน DB ต่อช่าง) · เจอช่างปิดแล้ว/ไม่มี = ข้อความเดียวกับ PIN ผิด
create or replace function analytics.worker_pin_verify(
  p_token_hash text,
  p_worker_id  uuid,
  p_pin        text,
  p_user_agent text default null,
  p_ip_hash    text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a     jsonb;
  v_w     analytics.worker%rowtype;
  v_att   int;
  v_raw   text;
  v_exp   timestamptz;
begin
  v_a := analytics.job_worker_auth(p_token_hash, null, p_ip_hash, false, false);
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_w from analytics.worker w where w.id = p_worker_id and w.shop_id = (v_a ->> 'shop_id')::uuid for update;
  if not found or not v_w.is_active then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;
  if v_w.locked_until is not null and v_w.locked_until > now() then
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', v_w.locked_until,
                                                 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_w.locked_until - now())))::int)));
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง');
  end if;

  if extensions.crypt(p_pin, v_w.pin_hash) = v_w.pin_hash then
    update analytics.worker set failed_attempts = 0, last_failed_at = null, locked_until = null where id = v_w.id;
    delete from analytics.worker_session where expires_at < now() - interval '1 day';
    v_raw := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    v_exp := now() + interval '12 hours';
    insert into analytics.worker_session (shop_id, worker_id, session_hash, expires_at, device_hint)
    values (v_w.shop_id, v_w.id, analytics.job_sha256_hex(v_raw), v_exp, analytics.job_device_hint(p_user_agent, p_ip_hash));
    return jsonb_build_object('ok', true, 'session_token', v_raw, 'expires_at', v_exp,
                              'worker', jsonb_build_object('id', v_w.id, 'display_name', v_w.display_name));
  end if;

  v_att := case when v_w.last_failed_at is null or v_w.last_failed_at < now() - interval '15 minutes' then 1 else v_w.failed_attempts + 1 end;
  if v_att >= 5 then
    update analytics.worker set failed_attempts = 0, last_failed_at = now(), locked_until = now() + interval '15 minutes' where id = v_w.id;
    return analytics.job_fail('locked', 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN',
                              jsonb_build_object('locked_until', now() + interval '15 minutes', 'retry_after_seconds', 900));
  end if;
  update analytics.worker set failed_attempts = v_att, last_failed_at = now() where id = v_w.id;
  return analytics.job_fail('bad_credentials', 'ชื่อหรือ PIN ไม่ถูกต้อง', jsonb_build_object('attempts_left', 5 - v_att));
end;
$f$;

create or replace function analytics.job_worker_logout(p_session_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_session_hash is not null and p_session_hash ~ '^[0-9a-f]{64}$' then
    update analytics.worker_session set revoked_at = clock_timestamp() where session_hash = p_session_hash and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true);
end;
$f$;

-- 15.2 อ่านข้อมูลใบงานให้หน้า /w/ (WorkerJobView) — ไม่มีราคา/ต้นทุน/margin/ชื่อลูกค้า/เลขใบเสนอราคา/เลข PO (ประกอบทีละ key ห้าม to_jsonb(row))
--      ไม่มี session: เห็นแค่เลขงาน + แถบขั้น + รายชื่อช่างที่เลือกได้ · มี session: เห็นรายละเอียดผลิต + ปุ่มที่ทำได้ (next_action)
--      next_action: identify | receive | send | awaiting_deposit | not_your_stage | held_by_other | prev_not_sent | on_hold | none
create or replace function analytics.job_worker_resolve(p_token_hash text, p_session_hash text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false);
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  if v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำขั้นถัดไปของงานนี้ได้ (ขั้นที่ถือค้างหรือขั้นที่รอรับ) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or (v_hold.id is not null and v_hold.stage_code = any (w.stage_codes))
            or (v_pend.id is not null and v_pend.stage_code = any (w.stage_codes)));
  else
    select w.stage_codes into v_wcodes from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif cardinality(v_wcodes) > 0 and not (v_pend.stage_code = any (v_wcodes)) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and v_job.metal = 'gold' then
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        if v_job.source_kind = 'oem' and not v_started then
          select coalesce(v.paid_thb, 0) into v_paid
            from analytics.oem_quote_item i join analytics.v_oem_quote v on v.id = i.quote_id where i.id = v_job.oem_quote_item_id;
          if coalesce(v_paid, 0) <= 0 and v_job.start_gate_note is null then
            v_action := 'awaiting_deposit';
          end if;
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        v_prev_w := v_prev.weight_out_g;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', v_action,
    'action_stage', case when v_seq is null then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w) end,
    'prev_weight_out_g', v_prev_w,
    'held_by', v_holder,
    'workers', v_workers,
    'scrap_reasons', case when v_action = 'send' then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end
  );
end;
$f$;

-- 15.3 รับงาน — RPC คำนวณขั้นเอง (ขั้น pending ต่ำสุด) · p_expected_seq ต้องตรงกับที่หน้าจอเห็น
create or replace function analytics.job_worker_receive(
  p_token_hash   text,
  p_session_hash text,
  p_expected_seq int,
  p_weight_in_g  numeric default null,
  p_user_agent   text default null,
  p_ip_hash      text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a jsonb;
  v_r jsonb;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true);
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_r := analytics.job_core_receive((v_a ->> 'job_id')::uuid, p_expected_seq, analytics.job_today(), p_weight_in_g,
                                    (v_a ->> 'worker_id')::uuid, null, 'worker_qr', null,
                                    analytics.job_device_hint(p_user_agent, p_ip_hash), true);
  -- 2 มือถือรับขั้นเดียวกันพร้อมกัน: ตัวหลังได้ "รับแล้วโดย X" (ok) ไม่ใช่ error
  if v_r ->> 'code' = 'already_received' then
    return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message', 'by', v_r ->> 'by');
  end if;
  return v_r;
end;
$f$;

-- 15.4 ส่งต่อ — เฉพาะขั้นที่ตัวเองรับ · น้ำหนักออก/ของเสีย/เติมโลหะ ตามกติกา
create or replace function analytics.job_worker_send(
  p_token_hash     text,
  p_session_hash   text,
  p_expected_seq   int,
  p_weight_out_g   numeric default null,
  p_qty_scrap      int default 0,
  p_scrap_reason   text default null,
  p_metal_added_g  numeric default 0,
  p_weight_note    text default null,
  p_scrap_weight_g numeric default null,
  p_user_agent     text default null,
  p_ip_hash        text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a jsonb;
  v_r jsonb;
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true);
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_r := analytics.job_core_send((v_a ->> 'job_id')::uuid, p_expected_seq, analytics.job_today(), p_weight_out_g, p_qty_scrap,
                                 p_scrap_reason, p_metal_added_g, p_weight_note, p_scrap_weight_g, (v_a ->> 'worker_id')::uuid,
                                 'worker_qr', null, analytics.job_device_hint(p_user_agent, p_ip_hash), true);
  if v_r ->> 'code' = 'already_sent' then
    return jsonb_build_object('ok', true, 'already', true, 'message', v_r ->> 'message');
  end if;
  return v_r;
end;
$f$;

-- ============================================================================
-- 16. view (security_invoker · อ่านฝั่ง server ผ่าน service role เท่านั้น — migration-traps ข้อ 18)
--     🔴 ไม่มีคอลัมน์ต้นทุน/ราคา/margin/ชื่อลูกค้า — แสดงได้แค่เลขใบเสนอราคา/เลข PO เพื่อโยงกลับ (เฉพาะออฟฟิศ)
-- ============================================================================

-- v_job_board: ข้อ 2.10 + R1 (quote_qty_mismatch: จำนวนในใบเสนอราคา active ของดีลไม่ตรงกับ qty_planned หลัง renegotiate)
--   is_stale: ไม่มี event เกิน 3 วัน (ค่าเริ่มของ Q10 · ปรับต่อขั้นได้เฟสหลัง)
create or replace view analytics.v_job_board
  with (security_invoker = true) as
select
  j.id, j.shop_id, j.job_no, j.seq, j.source_kind,
  case j.source_kind when 'oem' then aq.quote_no else po.po_no end as source_ref,
  j.design_label, j.sku_snapshot, j.metal, j.qty_planned, j.status, j.due_date,
  j.current_stage_code, d.name_th as current_stage_name, cs.status as current_stage_status,
  coalesce(w.display_name, cs.assignee_name) as holder_name,
  (analytics.job_today() - coalesce(cs.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at)))::int as days_in_stage,
  (j.due_date is not null and j.status in ('open', 'in_progress', 'on_hold') and j.due_date < analytics.job_today()) as is_overdue,
  ev.last_event_at,
  ev.last_scan_at,
  (j.status in ('open', 'in_progress') and analytics.job_bkk_date(coalesce(ev.last_event_at, j.created_at)) < analytics.job_today() - 3) as is_stale,
  st.stages_total, st.stages_done, st.has_auto_closed,
  (j.source_kind = 'oem' and coalesce(pay.paid, 0) <= 0) as deposit_missing,
  (j.start_gate_note is not null) as start_gate_note_present,
  (j.source_kind = 'oem' and j.status not in ('done', 'cancelled') and aqi.qty is distinct from j.qty_planned) as quote_qty_mismatch,
  aqi.qty as quote_item_qty,
  j.created_at, j.done_at, j.cancelled_at
from analytics.job j
left join analytics.job_stage cs on cs.job_id = j.id and cs.stage_code = j.current_stage_code
left join analytics.job_stage_def d on d.shop_id = j.shop_id and d.code = j.current_stage_code
left join analytics.worker w on w.id = cs.worker_id
left join lateral (select max(s.sent_on) as last_sent_on from analytics.job_stage s where s.job_id = j.id) ps on true
left join lateral (
  select max(e.recorded_at) as last_event_at, max(e.recorded_at) filter (where e.channel = 'worker_qr') as last_scan_at
    from analytics.job_event e where e.job_id = j.id) ev on true
left join lateral (
  select count(*)::int as stages_total,
         (count(*) filter (where s.status in ('sent', 'skipped')))::int as stages_done,
         coalesce(bool_or(s.auto_closed), false) as has_auto_closed
    from analytics.job_stage s where s.job_id = j.id) st on true
left join lateral (
  select q.id, q.quote_no from analytics.oem_quote q
   where j.source_kind = 'oem' and coalesce(q.root_quote_id, q.id) = j.root_quote_id
   order by (q.status = 'superseded'), q.created_at desc limit 1) aq on true
left join lateral (select coalesce(v.paid_thb, 0) as paid from analytics.v_oem_quote v where v.id = aq.id) pay on true
left join lateral (select i.qty from analytics.oem_quote_item i where i.quote_id = aq.id and i.seq = j.oem_item_seq) aqi on true
left join analytics.production_order_item poi on poi.id = j.production_order_item_id
left join analytics.production_order po on po.id = poi.production_order_id;

-- v_job_stage_loss: น้ำหนักหายต่อขั้น · loss_warn_pct null = ไม่เตือน (Q2 รอเจ้าของ) · not_weighed แสดงเสมอ ไม่ซ่อน (R3)
create or replace view analytics.v_job_stage_loss
  with (security_invoker = true) as
select x.*,
       case when x.loss_warn_pct is null or x.loss_pct is null then false else x.loss_pct > x.loss_warn_pct end as warn
from (
  select s.id as job_stage_id, s.job_id, s.shop_id, j.job_no, j.metal, s.stage_code, d.name_th as stage_name, s.status,
         s.worker_id, w.display_name as worker_name,
         s.weight_in_g, s.weight_out_g, s.metal_added_g, s.scrap_weight_g,
         (s.weight_in_g is not null and s.weight_out_g is not null) as weighed,
         (s.status = 'sent' and (s.weight_in_g is null or s.weight_out_g is null)) as not_weighed,
         case when s.weight_in_g is not null and s.weight_out_g is not null
              then s.weight_in_g + s.metal_added_g - s.weight_out_g - coalesce(s.scrap_weight_g, 0) end as loss_g,
         case when s.weight_in_g is not null and s.weight_out_g is not null and s.weight_in_g > 0
              then round((s.weight_in_g + s.metal_added_g - s.weight_out_g - coalesce(s.scrap_weight_g, 0)) / s.weight_in_g * 100, 2) end as loss_pct,
         d.loss_warn_pct
    from analytics.job_stage s
    join analytics.job j on j.id = s.job_id
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
) x;

-- v_job_stage_from_events: สถานะขั้นที่ reconstruct จาก event ล่าสุดเทียบกับ job_stage จริง — drift = true ต้องไม่มี
create or replace view analytics.v_job_stage_from_events
  with (security_invoker = true) as
select s.id as job_stage_id, s.job_id, s.shop_id, s.stage_code, s.status,
       le.event_id, le.after_state,
       case when le.after_state is null then s.status <> 'pending'
            else le.after_state <> analytics.job_stage_state(s) end as drift
  from analytics.job_stage s
  left join lateral (
    select e.id as event_id, e.payload -> 'after' as after_state
      from analytics.job_event e
     where e.job_stage_id = s.id and e.event_type in ('stage_receive', 'stage_send', 'stage_skip', 'stage_reopen')
     order by e.recorded_at desc, e.id desc limit 1) le on true;

-- v_production_order_job_mismatch (R2): qty_done ของใบผลิต != qty_good ของใบงานที่ปิดแล้ว — จงใจไม่บังคับเท่ากัน แค่ให้เห็น
create or replace view analytics.v_production_order_job_mismatch
  with (security_invoker = true) as
select j.id as job_id, j.shop_id, j.job_no, po.id as production_order_id, po.po_no, poi.id as production_order_item_id,
       p.sku, poi.qty_done, j.qty_good, j.qty_scrap
  from analytics.job j
  join analytics.production_order_item poi on poi.id = j.production_order_item_id
  join analytics.production_order po on po.id = poi.production_order_id
  join public.product p on p.id = poi.product_id
 where j.source_kind = 'production' and j.status = 'done' and poi.qty_done is not null and poi.qty_done <> j.qty_good;

-- ============================================================================
-- 17. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ
-- ============================================================================
revoke all on analytics.job_counter, analytics.job_stage_def, analytics.worker, analytics.worker_audit, analytics.worker_session,
              analytics.job, analytics.job_stage, analytics.job_event, analytics.job_token, analytics.worker_rate_limit
  from public, anon, authenticated, service_role;
revoke all on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_job_stage_from_events, analytics.v_production_order_job_mismatch
  from public, anon, authenticated, service_role;

-- ตาราง: อ่านได้อย่างเดียว (เขียนผ่าน RPC security definer เท่านั้น) · ไม่ให้ INSERT/UPDATE/DELETE/TRUNCATE กับ role ไหนเลย
grant select on analytics.job_stage_def, analytics.job, analytics.job_stage, analytics.job_event, analytics.worker_audit to service_role;
-- worker: ซ่อน pin_hash · job_token: ซ่อน token_hash · worker_session/worker_rate_limit/job_counter: ไม่ให้เลย
grant select (id, shop_id, display_name, stage_codes, is_active, failed_attempts, locked_until, created_by, created_at, deactivated_at, updated_at)
  on analytics.worker to service_role;
grant select (id, shop_id, job_id, print_no, issued_at, issued_by, revoked_at, revoke_reason)
  on analytics.job_token to service_role;
grant select on analytics.v_job_board, analytics.v_job_stage_loss, analytics.v_job_stage_from_events, analytics.v_production_order_job_mismatch
  to service_role;

-- ฟังก์ชัน: revoke 4 ชื่อ (public, anon, authenticated, service_role) ทุกตัวที่ migration นี้สร้าง แล้ว grant service_role เฉพาะ RPC ที่เปิดใช้จริง
-- (helper/trigger function รันด้วยสิทธิ์เจ้าของผ่าน RPC หรือ trigger — ไม่ต้องมีใครถือ execute ·
--  3 ตัวสุดท้ายในรายการเป็น helper ที่ view ใช้ — security_invoker ต้องให้ผู้เรียก view ถือ execute)
do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'job_stage_suggest', 'job_create_from_quote_item', 'job_create_from_production_item', 'job_token_issue', 'job_token_revoke',
    'job_office_receive', 'job_office_send', 'job_stage_skip', 'job_stage_reopen', 'job_set_due', 'job_start_gate_note_set',
    'job_done', 'job_cancel', 'worker_upsert', 'worker_pin_set', 'worker_set_active',
    'worker_pin_verify', 'job_worker_logout', 'job_worker_resolve', 'job_worker_receive', 'job_worker_send',
    'job_today', 'job_bkk_date', 'job_stage_state'];
  v_n int;
  v_dup text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  -- ห้ามมี overload (migration-traps ข้อ 1) และ RPC ที่ประกาศต้องมีครบ
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%')
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0172: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_rpc);
  if v_n <> cardinality(v_rpc) then
    raise exception '0172: RPC ที่ประกาศไว้ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_rpc), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 18. ยืนยันว่า migration นี้ไม่แตะของเดิม: md5 ของฟังก์ชัน oem_*/production_* ทุกตัว + schema ตาราง/view OEM/ผลิต ก่อน-หลัง ต้องเท่ากันเป๊ะ
--     ไม่เท่า = raise -> rollback ทั้งไฟล์ (run-sql ใช้ทรานแซกชันเดียว)
-- ============================================================================
do $c$
declare
  v_changed text;
  v_n_before int;
  v_n_after  int;
  v_col_h    text;
  v_col_n    int;
  v_h0       text;
  v_n0       int;
begin
  select string_agg(b.sig, ', ') into v_changed
    from _j172_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h;
  if v_changed is not null then
    raise exception '0172 แตะฟังก์ชัน OEM/production เดิม (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select count(*) into v_n_before from _j172_fn_base;
  select count(*) into v_n_after from pg_proc
   where pronamespace = 'analytics'::regnamespace and prokind = 'f' and (proname like 'oem\_%' or proname like 'production\_%');
  if v_n_before <> v_n_after then
    raise exception '0172: จำนวนฟังก์ชัน oem_*/production_* เปลี่ยน % -> % (มี overload ใหม่?)', v_n_before, v_n_after;
  end if;

  select h, n into v_h0, v_n0 from _j172_col_base;
  select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''),
                        ',' order by table_name, ordinal_position)), count(*)
    into v_col_h, v_col_n
    from information_schema.columns
   where table_schema = 'analytics'
     and (table_name like 'oem\_%' or table_name like 'v\_oem\_%' or table_name like 'production\_order%' or table_name like 'v\_production\_order%')
     and table_name <> 'v_production_order_job_mismatch';
  if v_col_h is distinct from v_h0 or v_col_n <> v_n0 then
    raise exception '0172 แตะโครงสร้างตาราง/view OEM หรือใบผลิตเดิม (คอลัมน์ % -> %)', v_n0, v_col_n;
  end if;
  raise notice '0172: ฟังก์ชัน oem_*/production_* เดิม % ตัว md5 เท่าเดิมทั้งหมด · คอลัมน์ตาราง/view OEM+ผลิตเดิม % คอลัมน์ เท่าเดิม', v_n_before, v_n0;
end;
$c$;

comment on table analytics.job is
  '0172: ใบงานผลิต 1 ใบ = 1 source item (OEM quote item หรือ production order item) · เขียนผ่าน RPC job_* เท่านั้น · done/cancelled เป็นปลายทาง (trigger job_guard)';
comment on table analytics.job_event is
  '0172: ประวัติใบงาน append-only (trigger กัน UPDATE/DELETE/TRUNCATE) · occurred_on = วันจริง · recorded_at = clock_timestamp บังคับที่ trigger';
comment on table analytics.job_token is
  '0172: QR token ของใบงาน — เก็บ sha256 ของ token 32 bytes (ไม่เก็บค่าดิบ) · เพิกถอนได้ ฟื้นไม่ได้';
comment on table analytics.worker is
  '0172: ทะเบียนช่าง (ไม่ใช่ auth.users) · pin_hash = bcrypt (pgcrypto) · ไม่เก็บ PIN ดิบ';

notify pgrst, 'reload schema';
