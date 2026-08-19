-- 0061_oem_cost_rate.sql
-- OEM pricing floor — cost-rate data model (T1 of the OEM pricing feature).
-- Source: docs/3j-jewelry/marketing/oem-pricing-floor.md (CFO, 2026-08-19).
--   §1.1/§1.2  cost has 3 buckets (NRE / batch / per-piece), not 2
--   §2.1/§2.2  the 6-line formula's variables (implemented by oem_price_calc, 0062)
--   §3         3-gate floor (qty / job value / gold weight) + margin floor
--   §6.1       22 missing numbers, with the exact factory-language question per row
--   §6.2       worksheet — tells us which UNIT the owner can actually answer in
--
-- Why the owner still can't price a single OEM job today: everything in §6 is
-- `[?]` except CAD (already confirmed ฿2,000) and the MOQ the owner already
-- picked (50/20/100). This migration's ONLY seeded values are those two —
-- every other rate starts empty on purpose (design brief: "ห้าม default
-- หลอกตา"). analytics.v_oem_readiness (bottom of this file) is what turns
-- "still empty" into a visible gate the UI/RPC layer can enforce.

-- ============================================================================
-- 1. analytics.oem_rate_def — reference data (no shop_id), same pattern as
--    campaign_template (0057): global, readable by the app, writable only by
--    migrations. `question_th` is lifted VERBATIM from §6.1/§6.2 — the whole
--    point of this feature is a form the owner will actually answer instead of
--    abandon, and factory language ("ช่างขัด 1 คน 1 วันขัดได้กี่ชิ้น") is what
--    makes that true, not accounting language ("ต้นทุนแรงงานต่อหน่วย").
-- ============================================================================

create table if not exists analytics.oem_rate_def (
  rate_key     text primary key,
  group_code   text not null,
  seq          int not null,
  label_th     text not null,
  question_th  text not null,
  input_unit   text not null check (input_unit in (
                 'pieces_per_day', 'pieces_per_hour', 'minutes_per_piece', 'thb_per_day',
                 'thb_per_batch', 'thb_per_piece', 'thb_per_unit', 'pieces_per_batch',
                 'uses_per_mold', 'pct', 'count', 'hours_per_day', 'seeds_per_hour', 'thb_per_gram')),
  scope_kind   text not null check (scope_kind in ('none', 'material', 'tier', 'dept', 'plating', 'item_kind')),
  cost_bucket  text check (cost_bucket in ('nre', 'batch', 'piece', 'seed', 'rate', 'policy')),
  priority     text not null check (priority in ('P0', 'P1', 'P2')),
  applies_when text not null default 'always'
               check (applies_when in ('always', 'if_plating', 'if_setting', 'if_new_design', 'if_gold')),
  -- Documentation only (no FK on array elements) — tells the UI "ask these
  -- together" and tells oem_price_calc which labor-rate keys a per-time rate
  -- needs to turn minutes/pieces into baht. Not used to widen the missing-list
  -- itself: every key named here is already its own independent P0/P1 row, so
  -- it surfaces on its own if empty.
  depends_on   text[],
  value_min    numeric,
  value_max    numeric,
  is_active    boolean not null default true
);

comment on table analytics.oem_rate_def is
  'Reference: every cost number the OEM formula (0062 oem_price_calc) can consume, one row per rate_key. Global — not shop-scoped. §6.1 22 items -> 33 rows (some items ask for 2 numbers, split into 2 keys; see comment block below).';

alter table analytics.oem_rate_def enable row level security;

drop policy if exists read_all on analytics.oem_rate_def;
create policy read_all on analytics.oem_rate_def
  for select to authenticated, service_role using (true);

-- ----------------------------------------------------------------------------
-- 1a. oem_rate_scope_option — reference data for WHICH scope values exist per
--     scoped rate_key (keyed by rate_key, not just scope_kind: "tier" means
--     ขัด 3 ระดับ for polish but ขนาดเม็ด 3 ระดับ for gems — two different
--     vocabularies sharing one scope_kind, so a generic scope_kind->options
--     table would collide). This is what lets v_oem_readiness below say
--     "labor_thb_per_day[ฉีดเทียน] is still missing" even before the owner has
--     entered a single row — without it, an empty scoped rate would silently
--     look "not missing" (0 rows to be missing FROM).
-- ============================================================================

create table if not exists analytics.oem_rate_scope_option (
  rate_key    text not null references analytics.oem_rate_def (rate_key) on delete cascade,
  scope_value text not null,
  label_th    text not null,
  seq         int not null default 0,
  primary key (rate_key, scope_value)
);

comment on table analytics.oem_rate_scope_option is
  'Reference: the closed set of expected scope values for a scoped oem_rate_def row (e.g. flask_capacity_pieces x item_kind = แหวน/สร้อยคอ/...). Adding an option later = INSERT one row, no code change (same pattern as campaign_template, 0057).';

alter table analytics.oem_rate_scope_option enable row level security;

drop policy if exists read_all on analytics.oem_rate_scope_option;
create policy read_all on analytics.oem_rate_scope_option
  for select to authenticated, service_role using (true);

-- ============================================================================
-- 2. analytics.oem_cost_rate — shop-scoped answers to oem_rate_def, with
--    history (effective_from). Writes go through oem_rate_upsert/delete only
--    (SECURITY DEFINER); RLS policies below are defense-in-depth, same as
--    shop_setting (0028).
--
--    scope is NOT NULL DEFAULT '-' on purpose (design brief, underlined
--    twice): NULL is not a valid PK component the way you'd want it to be —
--    two rows with scope=NULL for the same (shop_id, rate_key, effective_from)
--    do NOT collide under a unique/PK constraint (NULL <> NULL), so a rate
--    that's meant to be single-valued could silently get two "current" values
--    with nothing in the schema stopping it. '-' is a real, comparable value.
-- ============================================================================

create table if not exists analytics.oem_cost_rate (
  shop_id        uuid not null references public.shop (id) on delete cascade,
  rate_key       text not null references analytics.oem_rate_def (rate_key),
  scope          text not null default '-',
  effective_from date not null default current_date,
  value          numeric(14, 4) not null check (value >= 0),
  note           text,
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (shop_id, rate_key, scope, effective_from)
);

create index if not exists idx_oem_cost_rate_lookup
  on analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from desc);

alter table analytics.oem_cost_rate enable row level security;

drop policy if exists tenant_isolation_select on analytics.oem_cost_rate;
create policy tenant_isolation_select on analytics.oem_cost_rate
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_write on analytics.oem_cost_rate;
create policy owner_admin_write on analytics.oem_cost_rate
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 3. analytics.oem_setting — per-shop margin/floor/quote-validity knobs (§3,
--    §2.4). Defaults are the CFO's policy numbers (§3.1, §2.4), not derived
--    from cost data (there isn't any yet) — re-validate once §6 is filled
--    (doc's own words: "ต้อง re-validate ทันทีที่ §6 กรอกครบ").
--
--    NOTE on the two margin CHECKs below: the ordering check
--    (hard_floor <= floor <= discount_cap <= target) is NOT in the design
--    brief — added because §3.1's four numbers are meaningless out of that
--    order and a typo here silently breaks the floor gate in 0062.
-- ============================================================================

create table if not exists analytics.oem_setting (
  shop_id                  uuid primary key references public.shop (id) on delete cascade,
  margin_target_pct        numeric(5, 4) not null default 0.30
                            check (margin_target_pct >= 0 and margin_target_pct < 1),
  margin_discount_cap_pct  numeric(5, 4) not null default 0.25
                            check (margin_discount_cap_pct >= 0 and margin_discount_cap_pct < 1),
  margin_floor_pct         numeric(5, 4) not null default 0.20
                            check (margin_floor_pct >= 0 and margin_floor_pct < 1),
  margin_hard_floor_pct    numeric(5, 4) not null default 0.15
                            check (margin_hard_floor_pct >= 0 and margin_hard_floor_pct < 1),
  nre_max_share_pct        numeric(5, 4) not null default 0.25
                            check (nre_max_share_pct > 0 and nre_max_share_pct < 1),
  min_job_value_thb        numeric(12, 2) not null default 8000 check (min_job_value_thb > 0),
  quote_valid_days_silver  int not null default 30 check (quote_valid_days_silver > 0),
  quote_valid_days_gold    int not null default 7 check (quote_valid_days_gold > 0),
  quote_valid_days_brass   int not null default 45 check (quote_valid_days_brass > 0),
  formula_version          int not null default 1,
  updated_by               uuid references auth.users (id) on delete set null,
  updated_at               timestamptz not null default now(),
  constraint oem_setting_margin_order_check check (
    margin_hard_floor_pct <= margin_floor_pct
    and margin_floor_pct <= margin_discount_cap_pct
    and margin_discount_cap_pct <= margin_target_pct
  )
);

alter table analytics.oem_setting enable row level security;

drop policy if exists tenant_isolation_select on analytics.oem_setting;
create policy tenant_isolation_select on analytics.oem_setting
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_write on analytics.oem_setting;
create policy owner_admin_write on analytics.oem_setting
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 4. analytics.oem_metal_price — append-only price-per-gram history (§2.4:
--    quote validity is derived FROM as_of_date, so history must never be
--    overwritten across days — only same-day corrections collapse).
-- ============================================================================

create table if not exists analytics.oem_metal_price (
  shop_id            uuid not null references public.shop (id) on delete cascade,
  metal              text not null check (metal in ('silver', 'gold', 'brass')),
  as_of_date         date not null default current_date,
  price_thb_per_gram numeric(14, 4) not null check (price_thb_per_gram > 0),
  purity_basis       numeric(6, 4) check (purity_basis is null or (purity_basis > 0 and purity_basis <= 1)),
  source             text not null default 'manual' check (source in ('manual', 'feed', 'sheet')),
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (shop_id, metal, as_of_date)
);

alter table analytics.oem_metal_price enable row level security;

drop policy if exists tenant_isolation_select on analytics.oem_metal_price;
create policy tenant_isolation_select on analytics.oem_metal_price
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_write on analytics.oem_metal_price;
create policy owner_admin_write on analytics.oem_metal_price
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 5. Seed oem_rate_def — §6.1's 22 items. Where a row's own question asks for
--    two numbers ("ค่าแรงต่อคนต่อวัน + ชั่วโมงทำงาน/วัน") it becomes two
--    rate_keys so each can be validated/answered independently; a few
--    multi-part questions (e.g. flask cost = ปูน+ไฟ+ค่าแรงเท) collapse to ONE
--    number because that's the usable batch-cost figure the formula (§2.2
--    line 4) actually needs — the sub-parts in the question exist only to
--    help the owner arrive at that one number out loud.
--
--    cad_fee_thb and moq_pieces are the two numbers ALREADY confirmed
--    (§0/§3.3) — included here as rate_def rows (so the calc/RPC layer has
--    exactly one source of truth for every number it reads) and seeded with
--    values in step 7 below. Everything else stays empty.
-- ============================================================================

insert into analytics.oem_rate_def
  (rate_key, group_code, seq, label_th, question_th, input_unit, scope_kind, cost_bucket, priority, applies_when, depends_on, value_min, value_max)
values
  ('cad_fee_thb', 'nre', 1, 'ค่าออกแบบ CAD ต่อแบบ',
   '฿2,000 นี้รวมแก้ได้กี่รอบ · เกินแล้วคิดรอบละเท่าไหร่ · ทำ 1 แบบใช้เวลากี่ชั่วโมง',
   'thb_per_unit', 'none', 'nre', 'P0', 'if_new_design', null, 0, null),

  ('print3d_cost_thb', 'nre', 2, 'ค่าปริ้น 3D ต้นแบบ',
   'ปริ้น 1 ต้นแบบ กี่ชั่วโมง · น้ำยากี่บาท · ปริ้นพร้อมกันได้กี่ชิ้น',
   'thb_per_unit', 'none', 'nre', 'P0', 'if_new_design', null, 0, null),

  ('rubber_mold_cost_thb', 'nre', 3, 'ค่าอัดก้อนยาง (ต่อพิมพ์)',
   '1 ก้อนกี่บาท · ใช้เวลากี่ชั่วโมง',
   'thb_per_unit', 'none', 'nre', 'P0', 'if_new_design', null, 0, null),

  ('rubber_mold_life_uses', 'nre', 4, 'อายุก้อนยาง (ครั้ง ก่อนต้องอัดใหม่)',
   '1 ก้อนยางฉีดเทียนได้กี่ครั้งก่อนต้องอัดใหม่',
   'uses_per_mold', 'none', 'nre', 'P0', 'if_new_design', null, 0.0001, null),

  ('flask_capacity_pieces', 'batch', 5, 'ความจุแฟลสก์ (ชิ้น/แฟลสก์)',
   'งานจี้ขนาดกลาง 1 แฟลสก์ติดได้กี่ชิ้น แล้วถ้าเป็นแหวนล่ะ',
   'pieces_per_batch', 'item_kind', 'batch', 'P0', 'always', null, 0.0001, null),

  ('flask_cost_thb', 'batch', 6, 'ต้นทุนต่อแฟลสก์ (ปูน+ไฟเผา+ค่าแรงเท)',
   'หล่อ 1 แฟลสก์ ใช้ปูนกี่บาท เผากี่ชั่วโมง ใช้คนกี่คนกี่ชั่วโมง',
   'thb_per_batch', 'none', 'batch', 'P0', 'always', null, 0, null),

  ('plating_pieces_per_batch', 'batch', 7, 'ความจุถังชุบ (ชิ้น/รอบ)',
   'ชุบ 1 รอบใส่ได้กี่ชิ้น',
   'pieces_per_batch', 'plating', 'batch', 'P0', 'if_plating', null, 0.0001, null),

  ('plating_cost_per_batch', 'batch', 8, 'ต้นทุนต่อรอบชุบ',
   'น้ำยากี่บาทต่อรอบ · ชุบทอง/โรเดียม/พิงค์โกลด์ ราคาต่างกันเท่าไหร่',
   'thb_per_batch', 'plating', 'batch', 'P0', 'if_plating', null, 0, null),

  ('labor_thb_per_day', 'labor', 9, 'ค่าแรงต่อคนต่อวัน (แยกแผนก)',
   'ช่างแต่ละแผนก ค่าแรงวันละเท่าไหร่',
   'thb_per_day', 'dept', 'rate', 'P0', 'always', null, 0, null),

  ('work_hours_per_day', 'labor', 10, 'ชั่วโมงทำงานต่อวัน (แยกแผนก)',
   'ช่างแต่ละแผนก ทำงานวันละกี่ชั่วโมง',
   'hours_per_day', 'dept', 'rate', 'P0', 'always', null, 0.0001, 24),

  ('polish_pieces_per_day', 'labor', 11, 'ผลิตภาพช่างขัด (ชิ้น/วัน แยก 3 ระดับ)',
   'ช่างขัด 1 คน 1 วันขัดได้กี่ชิ้น แยกงานเรียบ / งานลายปานกลาง / งานลายละเอียด',
   'pieces_per_day', 'tier', 'piece', 'P0', 'always', array['labor_thb_per_day', 'work_hours_per_day'], 0.0001, null),

  ('sprue_loss_pct', 'metal', 12, 'น้ำหนักก้านต้น/sprue (% ของน้ำหนักชิ้น)',
   'ต้นเทียน 1 ต้นหนักเท่าไหร่ ชิ้นงานรวมกันหนักเท่าไหร่',
   'pct', 'material', 'piece', 'P0', 'always', null, 0, 1),

  ('recovery_rate_pct', 'metal', 13, 'อัตราหลอมคืนเศษโลหะ',
   'เศษเงินส่งใครหลอม หักกี่ % ได้คืนกี่วัน · ทองเหลืองหลอมคืนไหม หรือทิ้ง',
   'pct', 'material', 'piece', 'P0', 'always', null, 0, 1),

  ('reject_rate_cast_pct', 'reject', 14, 'ของเสียขั้นหล่อ (%)',
   'หล่อ 100 ชิ้น ทิ้งกี่ชิ้น (หล่อไม่เต็ม/มีรูพรุน)',
   'pct', 'none', 'rate', 'P0', 'always', null, 0, 1),

  ('reject_rate_polish_pct', 'reject', 15, 'ของเสียขั้นขัด (%)',
   'ขัดเสร็จแล้ว เสียเพิ่มอีกกี่ชิ้น',
   'pct', 'none', 'rate', 'P0', 'always', null, 0, 1),

  ('reject_rate_plate_pct', 'reject', 16, 'ของเสียขั้นชุบ (%)',
   'ชุบเสร็จแล้ว เสียเพิ่มอีกกี่ชิ้น (แพงที่สุด — ค่าแรงครบทุกขั้นแล้ว)',
   'pct', 'none', 'rate', 'P0', 'if_plating', null, 0, 1),

  ('wax_inject_pieces_per_hour', 'labor', 17, 'ผลิตภาพฉีดเทียน (ชิ้น/ชั่วโมง)',
   'ฉีดเทียน 1 คน 1 ชั่วโมงได้กี่ชิ้น',
   'pieces_per_hour', 'none', 'piece', 'P1', 'always', array['labor_thb_per_day', 'work_hours_per_day'], 0.0001, null),

  ('wax_material_thb_per_piece', 'material_cost', 18, 'ค่าเนื้อเทียนต่อชิ้น',
   'เทียนกิโลละเท่าไหร่ ได้กี่ชิ้น',
   'thb_per_piece', 'none', 'piece', 'P1', 'always', null, 0, null),

  ('cut_sprue_minutes_per_piece', 'labor', 19, 'เวลาตัดต้นต่อชิ้น',
   'ตัดต้น 1 ต้น ใช้เวลากี่นาที ได้กี่ชิ้น',
   'minutes_per_piece', 'none', 'piece', 'P1', 'always', array['labor_thb_per_day', 'work_hours_per_day'], 0, null),

  ('gem_setting_seeds_per_hour', 'labor', 20, 'ผลิตภาพฝังพลอย (เม็ด/ชั่วโมง แยกขนาด)',
   'ฝังพลอย 1 ชั่วโมงฝังกี่เม็ด แยกตามขนาดเม็ด',
   'seeds_per_hour', 'tier', 'seed', 'P1', 'if_setting', array['labor_thb_per_day', 'work_hours_per_day'], 0.0001, null),

  ('gem_price_thb_per_seed', 'material_cost', 21, 'ราคาพลอยต่อเม็ด (แยกขนาด)',
   'พลอย CZ ขนาด [x] มม. ราคาต่อเม็ดเท่าไหร่',
   'thb_per_unit', 'tier', 'seed', 'P1', 'if_setting', null, 0, null),

  ('qc_pieces_per_day', 'labor', 22, 'ผลิตภาพ QC (ชิ้น/วัน)',
   'QC 1 คนตรวจได้วันละกี่ชิ้น',
   'pieces_per_day', 'none', 'piece', 'P1', 'always', array['labor_thb_per_day', 'work_hours_per_day'], 0.0001, null),

  ('pack_cost_thb_per_piece', 'material_cost', 23, 'ค่าแพ็กต่อชิ้น',
   'ถุง/กล่อง/ป้าย ชิ้นละกี่บาท',
   'thb_per_piece', 'none', 'piece', 'P1', 'always', null, 0, null),

  ('admin_hours_per_job', 'policy', 24, 'ชั่วโมงคน (เจ้าของ+แอดมิน) ต่อ 1 job',
   'งานสั่งทำ 1 งาน ตั้งแต่คุยจนส่ง พี่กับแอดมินใช้เวลารวมกี่ชั่วโมง',
   'count', 'none', 'policy', 'P1', 'always', null, 0, null),

  ('metal_purchase_premium_pct', 'metal', 25, 'พรีเมี่ยมราคาซื้อโลหะเหนือราคาตลาด',
   'ซื้อเงินเม็ด/แผ่นจากใคร แพงกว่าราคาตลาดกี่ %',
   'pct', 'material', 'rate', 'P1', 'always', null, 0, 1),

  ('metal_supplier_credit_days', 'policy', 26, 'เครดิตการชำระค่าโลหะกับซัพพลายเออร์ (วัน)',
   'ซื้อโลหะ จ่ายสดหรือมีเครดิตกี่วัน',
   'count', 'none', 'policy', 'P1', 'always', null, 0, null),

  ('gold_min_purchase_lot_g', 'policy', 27, 'ล็อตขั้นต่ำในการซื้อทอง (กรัม)',
   'ซื้อทองขั้นต่ำครั้งละกี่กรัม',
   'count', 'none', 'policy', 'P1', 'if_gold', null, 0, null),

  ('gold_alloy_cost_thb_per_piece', 'metal', 28, 'ค่าน้ำประสาน/อัลลอยต่อชิ้น (งานทอง)',
   'ค่าน้ำประสาน/อัลลอยกี่บาท',
   'thb_per_piece', 'none', 'piece', 'P1', 'if_gold', null, 0, null),

  ('capacity_pieces_per_day', 'policy', 29, 'กำลังผลิตสูงสุดต่อวัน',
   'ถ้าเร่งเต็มที่ วันหนึ่งออกงานได้กี่ชิ้น แล้วติดที่แผนกไหนก่อน',
   'pieces_per_day', 'none', 'policy', 'P2', 'always', null, 0, null),

  ('own_line_gp_thb_per_day', 'policy', 30, 'กำไรขั้นต้นต่อวันของสายผลิตเราเอง',
   '1 วันที่โรงงานผลิตของเราเอง ได้ของมูลค่าเท่าไหร่ (กำไรขั้นต้น)',
   'thb_per_day', 'none', 'policy', 'P2', 'always', null, 0, null),

  ('lead_time_days_total', 'policy', 31, 'Lead time รวมจากรับงานถึงส่งของ (วัน)',
   'รับงานวันนี้ ส่งได้วันไหน แต่ละขั้นกินกี่วัน',
   'count', 'none', 'policy', 'P2', 'always', null, 0, null),

  ('fx_buffer_pct', 'policy', 32, 'FX buffer สำหรับลูกค้าต่างประเทศ',
   'ลูกค้าต่างประเทศขอราคาเป็น USD ต้องบวก FX buffer กี่ %',
   'pct', 'none', 'policy', 'P2', 'always', null, 0, 1),

  ('moq_pieces', 'policy', 33, 'MOQ ขั้นต่ำต่อวัสดุ (ชิ้น)',
   'MOQ ที่เจ้าของเคาะ: เงิน 50 · ทอง 20 · ทองเหลือง 100 — ยืนยันตัวเลขนี้ต่อวัสดุ',
   'count', 'material', 'policy', 'P0', 'always', null, 1, null)
on conflict (rate_key) do update set
  group_code = excluded.group_code, seq = excluded.seq, label_th = excluded.label_th,
  question_th = excluded.question_th, input_unit = excluded.input_unit, scope_kind = excluded.scope_kind,
  cost_bucket = excluded.cost_bucket, priority = excluded.priority, applies_when = excluded.applies_when,
  depends_on = excluded.depends_on, value_min = excluded.value_min, value_max = excluded.value_max;

-- ============================================================================
-- 6. Seed oem_rate_scope_option — expected scope values for every scoped
--    rate_key above. item_kind reuses lib/catalog/types.ts's CATEGORY_OPTIONS
--    vocabulary (minus เงินแท่ง, not an OEM item) so the owner isn't asked to
--    learn a second taxonomy. dept list matches §6.2 section D verbatim
--    ("แยกแผนก (ฉีด/หล่อ/ขัด/ฝัง/ชุบ/QC/แพ็ก)"); plating types and polish
--    tiers are named directly in §6.1/§6.2. Gem-size tiers (เล็ก/กลาง/ใหญ่)
--    are NOT named in the doc ("แยกตามขนาดเม็ด" with no sizes given) — this
--    3-tier default is our own call, see hand-off notes.
-- ============================================================================

insert into analytics.oem_rate_scope_option (rate_key, scope_value, label_th, seq) values
  ('sprue_loss_pct', 'silver', 'เงิน 925', 1), ('sprue_loss_pct', 'gold', 'ทอง', 2), ('sprue_loss_pct', 'brass', 'ทองเหลือง', 3),
  ('recovery_rate_pct', 'silver', 'เงิน 925', 1), ('recovery_rate_pct', 'gold', 'ทอง', 2), ('recovery_rate_pct', 'brass', 'ทองเหลือง', 3),
  ('metal_purchase_premium_pct', 'silver', 'เงิน 925', 1), ('metal_purchase_premium_pct', 'gold', 'ทอง', 2), ('metal_purchase_premium_pct', 'brass', 'ทองเหลือง', 3),
  ('moq_pieces', 'silver', 'เงิน 925', 1), ('moq_pieces', 'gold', 'ทอง', 2), ('moq_pieces', 'brass', 'ทองเหลือง', 3),

  ('flask_capacity_pieces', 'แหวน', 'แหวน', 1), ('flask_capacity_pieces', 'สร้อยคอ', 'สร้อยคอ', 2),
  ('flask_capacity_pieces', 'สร้อยข้อมือ', 'สร้อยข้อมือ', 3), ('flask_capacity_pieces', 'กำไล', 'กำไล', 4),
  ('flask_capacity_pieces', 'จี้', 'จี้', 5), ('flask_capacity_pieces', 'ต่างหู', 'ต่างหู', 6),
  ('flask_capacity_pieces', 'อื่นๆ', 'อื่นๆ', 7),

  ('polish_pieces_per_day', 'เรียบ', 'งานเรียบ', 1), ('polish_pieces_per_day', 'ปานกลาง', 'งานลายปานกลาง', 2),
  ('polish_pieces_per_day', 'ละเอียด', 'งานลายละเอียด', 3),

  ('gem_setting_seeds_per_hour', 'เล็ก', 'เม็ดเล็ก', 1), ('gem_setting_seeds_per_hour', 'กลาง', 'เม็ดกลาง', 2), ('gem_setting_seeds_per_hour', 'ใหญ่', 'เม็ดใหญ่', 3),
  ('gem_price_thb_per_seed', 'เล็ก', 'เม็ดเล็ก', 1), ('gem_price_thb_per_seed', 'กลาง', 'เม็ดกลาง', 2), ('gem_price_thb_per_seed', 'ใหญ่', 'เม็ดใหญ่', 3),

  ('labor_thb_per_day', 'ฉีดเทียน', 'ฉีดเทียน', 1), ('labor_thb_per_day', 'หล่อ', 'หล่อ/ตัดต้น', 2),
  ('labor_thb_per_day', 'ขัด', 'แต่งขัด', 3), ('labor_thb_per_day', 'ฝังพลอย', 'ฝังพลอย', 4),
  ('labor_thb_per_day', 'ชุบ', 'ชุบ', 5), ('labor_thb_per_day', 'QC', 'QC', 6), ('labor_thb_per_day', 'แพ็ก', 'แพ็ก', 7),
  ('work_hours_per_day', 'ฉีดเทียน', 'ฉีดเทียน', 1), ('work_hours_per_day', 'หล่อ', 'หล่อ/ตัดต้น', 2),
  ('work_hours_per_day', 'ขัด', 'แต่งขัด', 3), ('work_hours_per_day', 'ฝังพลอย', 'ฝังพลอย', 4),
  ('work_hours_per_day', 'ชุบ', 'ชุบ', 5), ('work_hours_per_day', 'QC', 'QC', 6), ('work_hours_per_day', 'แพ็ก', 'แพ็ก', 7),

  ('plating_cost_per_batch', 'ทอง', 'ชุบทอง', 1), ('plating_cost_per_batch', 'โรเดียม', 'ชุบโรเดียม', 2), ('plating_cost_per_batch', 'พิงค์โกลด์', 'ชุบพิงค์โกลด์', 3),
  ('plating_pieces_per_batch', 'ทอง', 'ชุบทอง', 1), ('plating_pieces_per_batch', 'โรเดียม', 'ชุบโรเดียม', 2), ('plating_pieces_per_batch', 'พิงค์โกลด์', 'ชุบพิงค์โกลด์', 3)
on conflict (rate_key, scope_value) do update set label_th = excluded.label_th, seq = excluded.seq;

-- ============================================================================
-- 7. Seed the two numbers that ARE confirmed (§0, §3.3). Everything else in
--    oem_cost_rate stays unseeded — that emptiness is the point (§6: "ห้าม
--    ตีราคางาน OEM จริงงานแรก จนกว่าข้อ P0 ครบทุกข้อ"). updated_by is left
--    null (migration-seeded, not a person's decision at a point in time).
-- ============================================================================

insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value, note)
select s.id, 'cad_fee_thb', '-', current_date, 2000, 'เจ้าของยืนยัน 2026-08-19 (oem-pricing-floor.md §0)'
from public.shop s
on conflict (shop_id, rate_key, scope, effective_from) do nothing;

insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value, note)
select s.id, 'moq_pieces', v.scope, current_date, v.val, 'เจ้าของเคาะ (oem-pricing-floor.md §3.3)'
from public.shop s
cross join (values ('silver', 50), ('gold', 20), ('brass', 100)) as v(scope, val)
on conflict (shop_id, rate_key, scope, effective_from) do nothing;

insert into analytics.oem_setting (shop_id)
select id from public.shop
on conflict (shop_id) do nothing;

-- ============================================================================
-- 8. RPCs — SECURITY DEFINER + crm_require_owner_admin (0021), same auth
--    model as every other write RPC in this app (see lib/actions/catalog.ts
--    header: the service-role client bypasses RLS, so requireOwnerAdmin() in
--    the server action is the real gate today; crm_require_owner_admin here
--    is what applies once real end-user auth lands).
-- ============================================================================

-- oem_rate_upsert — p_value has no default so it must sit before the
-- defaulted params (Postgres requires defaulted args to be trailing); Supabase
-- calls this with named JSON args so caller-side param order never matters.
create or replace function analytics.oem_rate_upsert(
  p_shop_id uuid,
  p_rate_key text,
  p_value numeric,
  p_scope text default '-',
  p_effective_from date default current_date,
  p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_def   analytics.oem_rate_def%rowtype;
  v_scope text := coalesce(nullif(btrim(p_scope), ''), '-');
begin
  if p_shop_id is null or p_rate_key is null or p_value is null then
    raise exception 'oem_rate_upsert: p_shop_id, p_rate_key, p_value are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_def from analytics.oem_rate_def where rate_key = p_rate_key and is_active;
  if v_def.rate_key is null then
    raise exception 'oem_rate_upsert: rate_key % not found or inactive', p_rate_key using errcode = '22023';
  end if;

  if v_def.scope_kind = 'none' then
    if v_scope <> '-' then
      raise exception 'oem_rate_upsert: % takes no scope (scope_kind=none), got %', p_rate_key, v_scope
        using errcode = '22023';
    end if;
  elsif v_scope = '-' then
    raise exception 'oem_rate_upsert: % requires a scope (scope_kind=%)', p_rate_key, v_def.scope_kind
      using errcode = '22023';
  end if;

  -- pct is double-enforced: the [0,1) rule is CFO policy (§2.2), not just a
  -- schema shape, so it's checked explicitly rather than relying on value_max.
  if v_def.input_unit = 'pct' and (p_value < 0 or p_value >= 1) then
    raise exception 'oem_rate_upsert: % is a percentage, must be in [0,1)', p_rate_key using errcode = '22023';
  end if;
  if v_def.value_min is not null and p_value < v_def.value_min then
    raise exception 'oem_rate_upsert: % must be >= %', p_rate_key, v_def.value_min using errcode = '22023';
  end if;
  if v_def.value_max is not null and p_value > v_def.value_max then
    raise exception 'oem_rate_upsert: % must be <= %', p_rate_key, v_def.value_max using errcode = '22023';
  end if;

  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value, note, updated_by, updated_at)
  values (p_shop_id, p_rate_key, v_scope, coalesce(p_effective_from, current_date), p_value, p_note, auth.uid(), now())
  on conflict (shop_id, rate_key, scope, effective_from) do update set
    value = excluded.value, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end;
$$;

create or replace function analytics.oem_rate_delete(
  p_shop_id uuid,
  p_rate_key text,
  p_scope text,
  p_effective_from date
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null or p_rate_key is null or p_scope is null or p_effective_from is null then
    raise exception 'oem_rate_delete: p_shop_id, p_rate_key, p_scope, p_effective_from are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  delete from analytics.oem_cost_rate
  where shop_id = p_shop_id and rate_key = p_rate_key and scope = p_scope and effective_from = p_effective_from;
end;
$$;

create or replace function analytics.oem_setting_upsert(
  p_shop_id uuid,
  p_margin_target_pct numeric default null,
  p_margin_discount_cap_pct numeric default null,
  p_margin_floor_pct numeric default null,
  p_margin_hard_floor_pct numeric default null,
  p_nre_max_share_pct numeric default null,
  p_min_job_value_thb numeric default null,
  p_quote_valid_days_silver int default null,
  p_quote_valid_days_gold int default null,
  p_quote_valid_days_brass int default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null then
    raise exception 'oem_setting_upsert: p_shop_id is required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into analytics.oem_setting as os (
    shop_id, margin_target_pct, margin_discount_cap_pct, margin_floor_pct, margin_hard_floor_pct,
    nre_max_share_pct, min_job_value_thb, quote_valid_days_silver, quote_valid_days_gold, quote_valid_days_brass,
    updated_by, updated_at
  ) values (
    p_shop_id,
    coalesce(p_margin_target_pct, 0.30), coalesce(p_margin_discount_cap_pct, 0.25),
    coalesce(p_margin_floor_pct, 0.20), coalesce(p_margin_hard_floor_pct, 0.15),
    coalesce(p_nre_max_share_pct, 0.25), coalesce(p_min_job_value_thb, 8000),
    coalesce(p_quote_valid_days_silver, 30), coalesce(p_quote_valid_days_gold, 7), coalesce(p_quote_valid_days_brass, 45),
    auth.uid(), now()
  )
  on conflict (shop_id) do update set
    margin_target_pct       = coalesce(p_margin_target_pct, os.margin_target_pct),
    margin_discount_cap_pct = coalesce(p_margin_discount_cap_pct, os.margin_discount_cap_pct),
    margin_floor_pct        = coalesce(p_margin_floor_pct, os.margin_floor_pct),
    margin_hard_floor_pct   = coalesce(p_margin_hard_floor_pct, os.margin_hard_floor_pct),
    nre_max_share_pct       = coalesce(p_nre_max_share_pct, os.nre_max_share_pct),
    min_job_value_thb       = coalesce(p_min_job_value_thb, os.min_job_value_thb),
    quote_valid_days_silver = coalesce(p_quote_valid_days_silver, os.quote_valid_days_silver),
    quote_valid_days_gold   = coalesce(p_quote_valid_days_gold, os.quote_valid_days_gold),
    quote_valid_days_brass  = coalesce(p_quote_valid_days_brass, os.quote_valid_days_brass),
    updated_by = auth.uid(), updated_at = now();
end;
$$;

create or replace function analytics.oem_metal_price_set(
  p_shop_id uuid,
  p_metal text,
  p_price numeric,
  p_as_of date default current_date,
  p_source text default 'manual'
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null or p_metal is null or p_price is null then
    raise exception 'oem_metal_price_set: p_shop_id, p_metal, p_price are required';
  end if;
  if p_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_metal_price_set: p_metal must be silver/gold/brass';
  end if;
  if p_price <= 0 then
    raise exception 'oem_metal_price_set: p_price must be > 0';
  end if;
  if p_source not in ('manual', 'feed', 'sheet') then
    raise exception 'oem_metal_price_set: p_source must be manual/feed/sheet';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- Append-only across days (§2.4 relies on real history); same-day re-entry
  -- collapses to a correction rather than stacking duplicate rows for one day.
  insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, source, updated_by, updated_at)
  values (p_shop_id, p_metal, coalesce(p_as_of, current_date), p_price, p_source, auth.uid(), now())
  on conflict (shop_id, metal, as_of_date) do update set
    price_thb_per_gram = excluded.price_thb_per_gram, source = excluded.source,
    updated_by = auth.uid(), updated_at = now();
end;
$$;

revoke execute on function analytics.oem_rate_upsert(uuid, text, numeric, text, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_rate_upsert(uuid, text, numeric, text, date, text) to authenticated, service_role;
revoke execute on function analytics.oem_rate_delete(uuid, text, text, date) from public, anon, authenticated;
grant execute on function analytics.oem_rate_delete(uuid, text, text, date) to authenticated, service_role;
revoke execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int) from public, anon, authenticated;
grant execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int) to authenticated, service_role;
revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to authenticated, service_role;

-- ============================================================================
-- 9. analytics.oem_rate_value — internal read helper (used by 0062's
--    oem_price_calc). Not meant to be called directly by the app: revoked
--    from PUBLIC so it never shows up as a callable RPC (anon/authenticated
--    inherit from PUBLIC, so this one revoke is enough — same shape as
--    assert_clip_brief_valid in 0057).
-- ============================================================================

create or replace function analytics.oem_rate_value(
  p_shop_id uuid,
  p_rate_key text,
  p_scope text default '-',
  p_as_of date default current_date
)
 returns numeric
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
  select value from analytics.oem_cost_rate
  where shop_id = p_shop_id and rate_key = p_rate_key
    and scope = coalesce(nullif(btrim(p_scope), ''), '-')
    and effective_from <= coalesce(p_as_of, current_date)
  order by effective_from desc
  limit 1
$$;

revoke execute on function analytics.oem_rate_value(uuid, text, text, date) from public;

-- ============================================================================
-- 10. v_oem_rate_status / v_oem_readiness — turn "empty row" into a visible
--     gate. Cross-joins public.shop because the reference data has no
--     shop_id of its own; security_invoker means an end-user only ever sees
--     rows for shops they're a member of via public.shop's own RLS.
-- ============================================================================

create or replace view analytics.v_oem_rate_status
  with (security_invoker = true) as
with expected_scope as (
  select d.rate_key, '-'::text as scope
  from analytics.oem_rate_def d
  where d.scope_kind = 'none' and d.is_active
  union all
  select o.rate_key, o.scope_value as scope
  from analytics.oem_rate_scope_option o
  join analytics.oem_rate_def d on d.rate_key = o.rate_key
  where d.is_active
)
select
  sh.id as shop_id,
  d.rate_key,
  es.scope,
  d.group_code,
  d.seq,
  d.label_th,
  d.question_th,
  d.input_unit,
  d.scope_kind,
  d.cost_bucket,
  d.priority,
  d.applies_when,
  d.depends_on,
  r.value,
  r.effective_from,
  r.note,
  (r.value is null) as is_missing
from public.shop sh
cross join expected_scope es
join analytics.oem_rate_def d on d.rate_key = es.rate_key
left join lateral (
  select c.value, c.effective_from, c.note
  from analytics.oem_cost_rate c
  where c.shop_id = sh.id and c.rate_key = es.rate_key and c.scope = es.scope
    and c.effective_from <= current_date
  order by c.effective_from desc
  limit 1
) r on true;

-- can_quote only counts P0 rows whose applies_when='always' — a P0 row gated
-- by if_plating/if_setting/if_gold/if_new_design only blocks the specific job
-- that needs it (checked by oem_missing_rates in 0062), not every job in the
-- shop.
create or replace view analytics.v_oem_readiness
  with (security_invoker = true) as
select
  shop_id,
  count(*) filter (where priority = 'P0' and applies_when = 'always') as p0_total,
  count(*) filter (where priority = 'P0' and applies_when = 'always' and not is_missing) as p0_filled,
  count(*) filter (where priority = 'P0' and applies_when = 'always' and is_missing) as p0_missing,
  (count(*) filter (where priority = 'P0' and applies_when = 'always' and is_missing) = 0) as can_quote
from analytics.v_oem_rate_status
group by shop_id;

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
