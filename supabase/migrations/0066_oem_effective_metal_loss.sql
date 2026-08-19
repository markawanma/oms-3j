-- 0066_oem_effective_metal_loss.sql
-- CFO decision: oem_price_calc's metal-loss term was computed on GROSS sprue
-- loss, not net. §2.1 defines the formula's own variable, L_eff, as "อัตรา
-- สูญเสียโลหะสุทธิ" (net) — the code never matched its own spec. Three pieces
-- of evidence say this is a bug, not an intentional simplification:
--   (a) §2.1 names the variable L_eff = net loss; 0062/0063 fed it v_sprue,
--       which is gross (asked "ต้นเทียนหนักเท่าไหร่ ชิ้นงานหนักเท่าไหร่" —
--       no recovery in that question at all).
--   (b) the SAME formula already discounts the reject term by recovery
--       (`1 - r_total * (1 - recovery)`) — charging gross sprue while
--       simultaneously crediting recovery on rejects is internally
--       inconsistent: one term believes scrap comes back, the other doesn't.
--   (c) §4.1 prices deposits assuming scrap is remeltable working capital, not
--       a sunk cost — the deposit math only balances if the price math also
--       treats it that way.
-- The strongest argument is gold: §2.3 makes gold pass-through (margin on the
-- metal = 0 by design). Inflating gold's metal weight makes every gold quote
-- more expensive with ZERO extra margin captured — 100% of the harm, 0% of
-- the benefit, on the one material where a 0.5% error is the whole job's
-- profit (§1.5).
--
-- sprue คูณด้วย (1 − recovery) โดยเจตนา — ก้านต้นถูกหลอมกลับเข้าสายผลิต
-- การคิดเต็ม = ขายโลหะก้อนเดิมซ้ำทุกงาน · เงินสดที่จมในเศษเป็น working
-- capital (วงเงินสด §7.1 + metal_scrap_ledger §8.8) ไม่ใช่ต้นทุนต่อชิ้น ·
-- ห้ามเปลี่ยนกลับเป็น gross โดยไม่ผ่าน CFO
--
-- What changes:
--   1. New rate_key `polish_loss_pct` (P0, always) — the dust lost during
--      finishing, which sprue never counted (sprue is measured pre-polish;
--      §1.5's W is post-polish net weight). Recovery on polish dust is ~0 in
--      practice (dust vs. a clean bar) so it is charged in FULL, not netted
--      by recovery — see comment at the seed row below. Bundling this with
--      the sprue fix is required, not optional: netting sprue alone while
--      leaving polish dust uncounted would make prices UNDER-shoot cost
--      (worse than today's gross-sprue over-shoot).
--   2. recovery_rate_pct's label/question redefined as NET (after melt fee +
--      loss), matching §2.1's own definition. No new fee field — a separate
--      melt-fee input would double-count the same haircut the CFO already
--      folds into "recovery."
--   3. oem_rate_upsert now REQUIRES p_note for sprue_loss_pct /
--      recovery_rate_pct / polish_loss_pct — these three are the ones people
--      systematically over-estimate (same failure mode as under-estimating
--      reject rates); a note forces "from the last melt-house statement", not
--      "from memory".
--
-- Fail-safe preserved on purpose: if recovery_rate_pct is still unset,
-- coalesce(v_recovery,0) makes v_loss_eff = v_sprue + polish_loss, i.e. the
-- gross-loss behaviour is UNCHANGED until recovery is answered. Anyone
-- reading only the diff of v_metal_per_piece could mistake this for "prices
-- move today" — they do not, for any shop that has not yet filled recovery.

-- ============================================================================
-- 1. New rate_key polish_loss_pct — insert directly after recovery_rate_pct
--    (seq 13) in production-line order. seq is a plain int with no gap left
--    for it, so seq 14..33 shift up by 1 to 15..34. Guarded by the old seq
--    range so re-running this migration is a no-op the second time.
-- ============================================================================

update analytics.oem_rate_def
set seq = seq + 1
where seq between 14 and 33
  and rate_key in (
    'reject_rate_cast_pct', 'reject_rate_polish_pct', 'reject_rate_plate_pct',
    'wax_inject_pieces_per_hour', 'wax_material_thb_per_piece', 'cut_sprue_minutes_per_piece',
    'gem_setting_seeds_per_hour', 'gem_price_thb_per_seed', 'qc_pieces_per_day',
    'pack_cost_thb_per_piece', 'admin_hours_per_job', 'metal_purchase_premium_pct',
    'metal_supplier_credit_days', 'gold_min_purchase_lot_g', 'gold_alloy_cost_thb_per_piece',
    'capacity_pieces_per_day', 'own_line_gp_thb_per_day', 'lead_time_days_total',
    'fx_buffer_pct', 'moq_pieces'
  );

insert into analytics.oem_rate_def
  (rate_key, group_code, seq, label_th, question_th, input_unit, scope_kind, cost_bucket, priority, applies_when, depends_on, value_min, value_max)
values
  ('polish_loss_pct', 'metal', 14, 'โลหะที่หายตอนแต่ง/ขัด (% ของน้ำหนักชิ้น)',
   'ชิ้นงานก่อนขัดหนักเท่าไหร่ ขัดเสร็จแล้วหนักเท่าไหร่ · ฝุ่นขัดเก็บไปหลอมได้ไหม',
   'pct', 'material', 'piece', 'P0', 'always', null, 0, 1)
on conflict (rate_key) do update set
  group_code = excluded.group_code, seq = excluded.seq, label_th = excluded.label_th,
  question_th = excluded.question_th, input_unit = excluded.input_unit, scope_kind = excluded.scope_kind,
  cost_bucket = excluded.cost_bucket, priority = excluded.priority, applies_when = excluded.applies_when,
  depends_on = excluded.depends_on, value_min = excluded.value_min, value_max = excluded.value_max;

insert into analytics.oem_rate_scope_option (rate_key, scope_value, label_th, seq) values
  ('polish_loss_pct', 'silver', 'เงิน 925', 1),
  ('polish_loss_pct', 'gold', 'ทอง', 2),
  ('polish_loss_pct', 'brass', 'ทองเหลือง', 3)
on conflict (rate_key, scope_value) do update set label_th = excluded.label_th, seq = excluded.seq;

-- ============================================================================
-- 2. recovery_rate_pct — redefine as NET recovery (matches §2.1's own L_eff
--    definition: what actually comes back after melt-house fee + loss).
--    No new fee field on purpose (§ CFO note): a separate melt-fee input
--    would be double-counted against this same haircut.
-- ============================================================================

update analytics.oem_rate_def set
  label_th = 'อัตราหลอมคืนเศษโลหะ (สุทธิ หลังหักค่าธรรมเนียม/ของหาย)',
  question_th = 'เศษก้านต้น/เศษตัด ส่งใครหลอม · ส่ง 100 กรัม ได้กลับมากี่กรัม (ขอใบสรุปรอบล่าสุด ไม่เอาจากความจำ) · ทองเหลืองหลอมคืนไหม หรือทิ้ง'
where rate_key = 'recovery_rate_pct';

-- ============================================================================
-- 3. oem_rate_upsert — require p_note for the 3 loss/recovery keys people
--    systematically mis-estimate. Signature unchanged (p_note already
--    existed as the trailing optional param) so this is a plain replace.
-- ============================================================================

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

  -- CFO: recovery is systematically over-estimated, the same failure mode as
  -- under-estimating reject rates — force a cited source, not a guess.
  if p_rate_key in ('recovery_rate_pct', 'sprue_loss_pct', 'polish_loss_pct')
     and (p_note is null or btrim(p_note) = '') then
    raise exception 'oem_rate_upsert: % ต้องระบุแหล่งที่มา (p_note) เช่น ใบชั่งจริง/ใบสรุปโรงหลอมรอบล่าสุด — ห้ามกรอกจากความจำ', p_rate_key
      using errcode = '22023';
  end if;

  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value, note, updated_by, updated_at)
  values (p_shop_id, p_rate_key, v_scope, coalesce(p_effective_from, current_date), p_value, p_note, auth.uid(), now())
  on conflict (shop_id, rate_key, scope, effective_from) do update set
    value = excluded.value, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- ============================================================================
-- 4. oem_price_calc — the actual formula fix (§ above). Signature (uuid,
--    jsonb) unchanged -> plain replace, no drop needed. Body is otherwise
--    identical to 0063; only the metal-loss block and the breakdown.metal /
--    formula_version fields change.
-- ============================================================================

create or replace function analytics.oem_price_calc(p_shop_id uuid, p_input jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_metal         text;
  v_item_kind     text;
  v_polish_tier   text;
  v_plating_type  text;
  v_gem_tier      text;
  v_gem_count     numeric;
  v_qty           int;
  v_weight_g      numeric;
  v_purity        numeric;
  v_is_new_design boolean;
  v_as_of         date;
  v_m             numeric;
  v_set analytics.oem_setting%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_r_cast numeric; v_r_polish numeric; v_r_plate numeric; v_r_total numeric;
  v_q_run  numeric;
  v_price_used numeric; v_price_source text;
  v_sprue numeric; v_recovery numeric; v_polish_loss numeric; v_loss_eff numeric; v_metal_per_piece numeric;
  v_labor_dt numeric; v_labor_hrs numeric; v_hr numeric;
  v_wax_pph numeric; v_wax_mat numeric; c_wax numeric; c_wax_minutes numeric;
  v_cut_min numeric; c_cut numeric; c_cut_minutes numeric;
  v_polish_ppd numeric; c_polish numeric; c_polish_minutes numeric;
  v_qc_ppd numeric; c_qc numeric; c_qc_minutes numeric;
  v_gem_sph numeric; v_gem_price numeric; c_gem numeric; c_gem_minutes numeric;
  v_pack numeric; c_pack numeric;
  v_gold_alloy numeric; c_gold_alloy numeric;
  v_labor_sum numeric; v_labor_per_piece numeric;
  v_labor_steps jsonb := '[]'::jsonb;
  v_flask_cap numeric; v_flask_cost numeric; v_flask_count int; v_flask_total numeric;
  v_plate_cap numeric; v_plate_cost numeric; v_plate_count int; v_plate_total numeric;
  v_batch_per_piece numeric; v_batch_lines jsonb := '[]'::jsonb;
  v_cad numeric; v_print3d numeric; v_mold numeric;
  v_nre_cost numeric := 0; v_nre_price numeric := 0;
  v_cost_piece numeric; v_price_piece numeric; v_quote_total numeric; v_pieces_subtotal numeric;
  v_margin_actual numeric; v_is_complete boolean;
  v_moq numeric; v_qty_pass boolean;
  v_jobvalue_min numeric; v_jobvalue_pass boolean;
  v_metalweight_applies boolean := false; v_metalweight_pass boolean;
  v_gold_lot numeric; v_total_gold_g numeric;
  v_margin_state text;
begin
  if p_shop_id is null then
    raise exception 'oem_price_calc: p_shop_id is required';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'oem_price_calc: p_input must be a json object';
  end if;

  v_metal := p_input->>'metal';
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_price_calc: p_input.metal must be silver/gold/brass';
  end if;
  v_item_kind := nullif(btrim(p_input->>'item_kind'), '');
  if v_item_kind is null then
    raise exception 'oem_price_calc: p_input.item_kind is required';
  end if;
  v_polish_tier := nullif(btrim(p_input->>'polish_tier'), '');
  if v_polish_tier is null then
    raise exception 'oem_price_calc: p_input.polish_tier is required';
  end if;
  v_qty := nullif(p_input->>'qty', '')::int;
  if v_qty is null or v_qty <= 0 then
    raise exception 'oem_price_calc: p_input.qty must be > 0';
  end if;
  v_weight_g := nullif(p_input->>'weight_g', '')::numeric;
  if v_weight_g is null or v_weight_g <= 0 then
    raise exception 'oem_price_calc: p_input.weight_g must be > 0';
  end if;
  v_is_new_design := coalesce((p_input->>'is_new_design')::boolean, true);
  v_as_of := coalesce((p_input->>'as_of_date')::date, current_date);
  v_plating_type := nullif(btrim(p_input->>'plating_type'), '');
  v_gem_tier := nullif(btrim(p_input->>'gem_tier'), '');
  v_gem_count := coalesce(nullif(p_input->>'gem_count', '')::numeric, 0);
  if v_gem_count > 0 and v_gem_tier is null then
    raise exception 'oem_price_calc: p_input.gem_count > 0 requires p_input.gem_tier';
  end if;

  v_purity := nullif(p_input->>'purity', '')::numeric;
  if v_purity is null then
    v_purity := case v_metal when 'silver' then 0.925 when 'brass' then 1.0 else null end;
  end if;
  if v_metal = 'gold' and v_purity is null then
    raise exception 'oem_price_calc: p_input.purity is required for gold (no safe default across K)';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
  end if;

  -- The margin actually charged. Bug 1 (0063): without this the price was
  -- pinned to the target and the §3.1 floor tiers were unreachable. A
  -- malformed value is a caller bug -> raise (unlike shop data, which returns
  -- is_complete=false).
  v_m := nullif(p_input->>'margin_pct', '')::numeric;
  if v_m is null then v_m := v_set.margin_target_pct; end if;
  if v_m < 0 or v_m >= 1 then
    raise exception 'oem_price_calc: p_input.margin_pct must be in [0,1)';
  end if;

  v_r_cast := analytics.oem_rate_value(p_shop_id, 'reject_rate_cast_pct', '-', v_as_of);
  v_r_polish := analytics.oem_rate_value(p_shop_id, 'reject_rate_polish_pct', '-', v_as_of);
  if v_r_cast is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_cast_pct', '-'); end if;
  if v_r_polish is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_polish_pct', '-'); end if;
  if v_plating_type is not null then
    v_r_plate := analytics.oem_rate_value(p_shop_id, 'reject_rate_plate_pct', '-', v_as_of);
    if v_r_plate is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_plate_pct', '-'); end if;
  else
    v_r_plate := 0;
  end if;
  v_r_total := 1 - (1 - coalesce(v_r_cast, 0)) * (1 - coalesce(v_r_polish, 0)) * (1 - coalesce(v_r_plate, 0));

  v_q_run := ceiling(v_qty::numeric / (1 - v_r_total));

  select price_thb_per_gram, source into v_price_used, v_price_source
    from analytics.oem_metal_price
    where shop_id = p_shop_id and metal = v_metal and as_of_date <= v_as_of
    order by as_of_date desc limit 1;
  if v_price_used is null and v_metal = 'silver' then
    select silver_spot_thb_per_gram into v_price_used
      from analytics.shop_setting where shop_id = p_shop_id;
    if v_price_used is not null then v_price_source := 'shop_setting.silver_spot_thb_per_gram (fallback)'; end if;
  end if;
  if v_price_used is null then
    v_missing := v_missing || jsonb_build_object(
      'rate_key', 'metal_price', 'scope', v_metal,
      'question_th', 'ราคา' || v_metal || ' ต่อกรัม ณ วันที่คำนวณ ยังไม่ได้ตั้งค่า (บันทึกผ่าน saveMetalPrice)',
      'priority', 'P0');
  end if;

  v_sprue := analytics.oem_rate_value(p_shop_id, 'sprue_loss_pct', v_metal, v_as_of);
  v_recovery := analytics.oem_rate_value(p_shop_id, 'recovery_rate_pct', v_metal, v_as_of);
  v_polish_loss := analytics.oem_rate_value(p_shop_id, 'polish_loss_pct', v_metal, v_as_of);
  if v_sprue is null then v_missing := v_missing || analytics.oem_missing_item('sprue_loss_pct', v_metal); end if;
  if v_recovery is null then v_missing := v_missing || analytics.oem_missing_item('recovery_rate_pct', v_metal); end if;
  if v_polish_loss is null then v_missing := v_missing || analytics.oem_missing_item('polish_loss_pct', v_metal); end if;

  -- L_eff (§2.1's own definition = NET loss), not gross sprue alone.
  -- Polish dust is charged in FULL (not x(1-recovery)) on purpose: recovery
  -- on fine dust swept off a bench is ~0 in practice, unlike sprue which is a
  -- clean, dense bar the melt house actually wants (§1.5). Fail-safe: while
  -- recovery_rate_pct is unset, coalesce(...,0) collapses this back to
  -- v_sprue + polish_loss — i.e. today's gross behaviour, unchanged, until
  -- the owner answers recovery. Do not "fix" that coalesce to a nonzero
  -- default; it is the intended no-price-movement guard.
  v_loss_eff := coalesce(v_sprue, 0) * (1 - coalesce(v_recovery, 0)) + coalesce(v_polish_loss, 0);

  v_metal_per_piece := v_weight_g * v_purity * coalesce(v_price_used, 0) * (1 + v_loss_eff)
                        * (1 / (1 - v_r_total * (1 - coalesce(v_recovery, 0))));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ฉีดเทียน', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ฉีดเทียน', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ฉีดเทียน'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ฉีดเทียน'); end if;
  v_wax_pph := analytics.oem_rate_value(p_shop_id, 'wax_inject_pieces_per_hour', '-', v_as_of);
  v_wax_mat := analytics.oem_rate_value(p_shop_id, 'wax_material_thb_per_piece', '-', v_as_of);
  if v_wax_pph is null then v_missing := v_missing || analytics.oem_missing_item('wax_inject_pieces_per_hour', '-'); end if;
  if v_wax_mat is null then v_missing := v_missing || analytics.oem_missing_item('wax_material_thb_per_piece', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_wax_minutes := case when v_wax_pph is not null and v_wax_pph <> 0 then round(60 / v_wax_pph, 2) end;
  c_wax := coalesce(case when v_hr is not null and v_wax_pph is not null and v_wax_pph <> 0
                         then v_hr / v_wax_pph end, 0) + coalesce(v_wax_mat, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'wax_inject', 'minutes', c_wax_minutes, 'thb', round(c_wax, 4));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'หล่อ', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'หล่อ', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'หล่อ'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'หล่อ'); end if;
  v_cut_min := analytics.oem_rate_value(p_shop_id, 'cut_sprue_minutes_per_piece', '-', v_as_of);
  if v_cut_min is null then v_missing := v_missing || analytics.oem_missing_item('cut_sprue_minutes_per_piece', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_cut := coalesce(case when v_hr is not null and v_cut_min is not null then (v_hr / 60) * v_cut_min end, 0);
  c_cut_minutes := v_cut_min;
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'cut_sprue', 'minutes', c_cut_minutes, 'thb', round(c_cut, 4));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ขัด', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ขัด', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ขัด'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ขัด'); end if;
  v_polish_ppd := analytics.oem_rate_value(p_shop_id, 'polish_pieces_per_day', v_polish_tier, v_as_of);
  if v_polish_ppd is null then v_missing := v_missing || analytics.oem_missing_item('polish_pieces_per_day', v_polish_tier); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_polish_minutes := case when v_polish_ppd is not null and v_labor_hrs is not null and v_polish_ppd <> 0
                            then round((v_labor_hrs * 60) / v_polish_ppd, 2) end;
  c_polish := coalesce(case when v_hr is not null and v_polish_ppd is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                            then v_hr / (v_polish_ppd / v_labor_hrs) end, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'polish', 'minutes', c_polish_minutes, 'thb', round(c_polish, 4));

  if v_gem_tier is not null then
    v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ฝังพลอย', v_as_of);
    v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ฝังพลอย', v_as_of);
    if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ฝังพลอย'); end if;
    if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ฝังพลอย'); end if;
    v_gem_sph := analytics.oem_rate_value(p_shop_id, 'gem_setting_seeds_per_hour', v_gem_tier, v_as_of);
    v_gem_price := analytics.oem_rate_value(p_shop_id, 'gem_price_thb_per_seed', v_gem_tier, v_as_of);
    if v_gem_sph is null then v_missing := v_missing || analytics.oem_missing_item('gem_setting_seeds_per_hour', v_gem_tier); end if;
    if v_gem_price is null then v_missing := v_missing || analytics.oem_missing_item('gem_price_thb_per_seed', v_gem_tier); end if;
    v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                 then v_labor_dt / v_labor_hrs end;
    c_gem_minutes := case when v_gem_sph is not null and v_gem_sph <> 0 then round((60 / v_gem_sph) * v_gem_count, 2) end;
    c_gem := coalesce(case when v_hr is not null and v_gem_sph is not null and v_gem_sph <> 0
                           then (v_hr / v_gem_sph) * v_gem_count end, 0)
             + coalesce(v_gem_price, 0) * v_gem_count;
    v_labor_steps := v_labor_steps || jsonb_build_object('key', 'gem_setting', 'minutes', c_gem_minutes, 'thb', round(c_gem, 4));
  else
    c_gem := 0;
  end if;

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'QC', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'QC', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'QC'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'QC'); end if;
  v_qc_ppd := analytics.oem_rate_value(p_shop_id, 'qc_pieces_per_day', '-', v_as_of);
  if v_qc_ppd is null then v_missing := v_missing || analytics.oem_missing_item('qc_pieces_per_day', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_qc_minutes := case when v_qc_ppd is not null and v_labor_hrs is not null and v_qc_ppd <> 0
                        then round((v_labor_hrs * 60) / v_qc_ppd, 2) end;
  c_qc := coalesce(case when v_hr is not null and v_qc_ppd is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                        then v_hr / (v_qc_ppd / v_labor_hrs) end, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'qc', 'minutes', c_qc_minutes, 'thb', round(c_qc, 4));

  v_pack := analytics.oem_rate_value(p_shop_id, 'pack_cost_thb_per_piece', '-', v_as_of);
  if v_pack is null then v_missing := v_missing || analytics.oem_missing_item('pack_cost_thb_per_piece', '-'); end if;
  c_pack := coalesce(v_pack, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'pack', 'minutes', null, 'thb', round(c_pack, 4));

  if v_metal = 'gold' then
    v_gold_alloy := analytics.oem_rate_value(p_shop_id, 'gold_alloy_cost_thb_per_piece', '-', v_as_of);
    if v_gold_alloy is null then v_missing := v_missing || analytics.oem_missing_item('gold_alloy_cost_thb_per_piece', '-'); end if;
    c_gold_alloy := coalesce(v_gold_alloy, 0);
    v_labor_steps := v_labor_steps || jsonb_build_object('key', 'gold_alloy', 'minutes', null, 'thb', round(c_gold_alloy, 4));
  else
    c_gold_alloy := 0;
  end if;

  v_labor_sum := c_wax + c_cut + c_polish + c_gem + c_qc + c_pack + c_gold_alloy;
  v_labor_per_piece := v_labor_sum / (1 - v_r_total);

  v_flask_cap := analytics.oem_rate_value(p_shop_id, 'flask_capacity_pieces', v_item_kind, v_as_of);
  v_flask_cost := analytics.oem_rate_value(p_shop_id, 'flask_cost_thb', '-', v_as_of);
  if v_flask_cap is null then v_missing := v_missing || analytics.oem_missing_item('flask_capacity_pieces', v_item_kind); end if;
  if v_flask_cost is null then v_missing := v_missing || analytics.oem_missing_item('flask_cost_thb', '-'); end if;
  v_flask_count := case when v_flask_cap is not null and v_flask_cap > 0 then ceiling(v_q_run / v_flask_cap)::int end;
  v_flask_total := case when v_flask_count is not null and v_flask_cost is not null then v_flask_count * v_flask_cost end;
  v_batch_lines := v_batch_lines || jsonb_build_object(
    'key', 'flask', 'capacity', v_flask_cap, 'count', v_flask_count, 'cost', v_flask_total);

  if v_plating_type is not null then
    v_plate_cap := analytics.oem_rate_value(p_shop_id, 'plating_pieces_per_batch', v_plating_type, v_as_of);
    v_plate_cost := analytics.oem_rate_value(p_shop_id, 'plating_cost_per_batch', v_plating_type, v_as_of);
    if v_plate_cap is null then v_missing := v_missing || analytics.oem_missing_item('plating_pieces_per_batch', v_plating_type); end if;
    if v_plate_cost is null then v_missing := v_missing || analytics.oem_missing_item('plating_cost_per_batch', v_plating_type); end if;
    v_plate_count := case when v_plate_cap is not null and v_plate_cap > 0 then ceiling(v_q_run / v_plate_cap)::int end;
    v_plate_total := case when v_plate_count is not null and v_plate_cost is not null then v_plate_count * v_plate_cost end;
    v_batch_lines := v_batch_lines || jsonb_build_object(
      'key', 'plating', 'capacity', v_plate_cap, 'count', v_plate_count, 'cost', v_plate_total);
  else
    v_plate_total := 0; v_plate_count := 0;
  end if;

  v_batch_per_piece := (coalesce(v_flask_total, 0) + coalesce(v_plate_total, 0)) / v_qty;

  if v_is_new_design then
    v_cad := analytics.oem_rate_value(p_shop_id, 'cad_fee_thb', '-', v_as_of);
    v_print3d := analytics.oem_rate_value(p_shop_id, 'print3d_cost_thb', '-', v_as_of);
    v_mold := analytics.oem_rate_value(p_shop_id, 'rubber_mold_cost_thb', '-', v_as_of);
    if v_cad is null then v_missing := v_missing || analytics.oem_missing_item('cad_fee_thb', '-'); end if;
    if v_print3d is null then v_missing := v_missing || analytics.oem_missing_item('print3d_cost_thb', '-'); end if;
    if v_mold is null then v_missing := v_missing || analytics.oem_missing_item('rubber_mold_cost_thb', '-'); end if;
    v_nre_cost := coalesce(v_cad, 0) + coalesce(v_print3d, 0) + coalesce(v_mold, 0);
    v_nre_price := case when v_nre_cost > 0 then round(v_nre_cost / (1 - v_m), 2) else 0 end;
  else
    v_cad := 0; v_print3d := 0; v_mold := 0; v_nre_cost := 0; v_nre_price := 0;
  end if;

  v_cost_piece := coalesce(v_metal_per_piece, 0) + coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0);
  if v_metal = 'gold' then
    -- §2.3 pass-through: margin on ค่ากำเหน็จ only, never on the metal.
    v_price_piece := coalesce(v_metal_per_piece, 0)
                      + (coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0)) / (1 - v_m);
    v_warnings := v_warnings || to_jsonb('งานทองเป็น pass-through: มาร์จิ้นคิดเฉพาะค่ากำเหน็จ ไม่คิดทับเนื้อทอง — margin รวมทั้งงานจึงต่ำกว่ามาก และเป็นตัวเลขที่ถูกต้อง ไม่ได้ใช้ตัดสิน floor'::text);
  else
    v_price_piece := v_cost_piece / (1 - v_m);
  end if;

  v_moq := analytics.oem_rate_value(p_shop_id, 'moq_pieces', v_metal, v_as_of);
  if v_moq is null then v_missing := v_missing || analytics.oem_missing_item('moq_pieces', v_metal); end if;
  v_qty_pass := case when v_moq is not null then v_qty >= v_moq end;

  if v_metal = 'gold' then
    v_metalweight_applies := true;
    v_gold_lot := analytics.oem_rate_value(p_shop_id, 'gold_min_purchase_lot_g', '-', v_as_of);
    if v_gold_lot is null then v_missing := v_missing || analytics.oem_missing_item('gold_min_purchase_lot_g', '-'); end if;
    v_total_gold_g := v_qty * v_weight_g;
    v_metalweight_pass := case when v_gold_lot is not null then v_total_gold_g >= v_gold_lot end;
  else
    v_metalweight_applies := false;
    v_metalweight_pass := true;
  end if;

  v_is_complete := (jsonb_array_length(v_missing) = 0);

  if v_is_complete then
    v_pieces_subtotal := round(v_qty * v_price_piece, 2);
    v_quote_total := round(v_nre_price + v_pieces_subtotal, 2);
    v_margin_actual := case when v_price_piece <> 0 then round((v_price_piece - v_cost_piece) / v_price_piece, 4) end;
  else
    v_pieces_subtotal := null; v_quote_total := null; v_margin_actual := null;
  end if;

  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when v_nre_cost > 0 then v_nre_cost / v_set.nre_max_share_pct else 0 end
  );
  v_jobvalue_pass := case when v_quote_total is not null then v_quote_total >= v_jobvalue_min end;

  -- Bug 2 (0063): the floor judges the margin we CHOSE to charge (v_m), not
  -- the blended margin. For silver/brass they are the same number; for gold
  -- the blended one is diluted by pass-through metal and would fail every
  -- quote.
  v_margin_state := case
    when v_m < v_set.margin_hard_floor_pct then 'hard_floor_breach'
    when v_m < v_set.margin_floor_pct then 'needs_approval_note'
    when v_m < v_set.margin_discount_cap_pct then 'discount_zone'
    else 'ok'
  end;
  if v_margin_state <> 'ok' then
    v_warnings := v_warnings || to_jsonb(('margin ที่คิด ' || round(v_m * 100, 1)::text || '% อยู่ในโซน ' || v_margin_state)::text);
  end if;

  return jsonb_build_object(
    'is_complete', v_is_complete,
    'missing', v_missing,
    'breakdown', jsonb_build_object(
      'q_run', v_q_run,
      'reject_pct_total', round(v_r_total, 4),
      'margin_pct_used', v_m,
      'metal', jsonb_build_object(
        'per_piece', round(v_metal_per_piece, 4),
        'loss_basis', 'effective',
        'gross_loss_pct', v_sprue,
        'polish_loss_pct', v_polish_loss,
        'effective_loss_pct', round(v_loss_eff, 4),
        'metal_loss_multiplier', round(1 + v_loss_eff, 4),
        'price_used', v_price_used,
        'price_source', v_price_source
      ),
      'labor', jsonb_build_object('per_piece', round(v_labor_per_piece, 4), 'steps', v_labor_steps),
      'batch', jsonb_build_object('per_piece', round(v_batch_per_piece, 4), 'lines', v_batch_lines),
      'nre', jsonb_build_object('cad', v_cad, 'print3d', v_print3d, 'mold', v_mold, 'cost', v_nre_cost, 'price', v_nre_price),
      'cost_piece', round(v_cost_piece, 4),
      'price_per_piece', round(v_price_piece, 4),
      'quote_total', v_quote_total,
      'margin_actual_pct', v_margin_actual
    ),
    'floors', jsonb_build_object(
      'qty', jsonb_build_object('pass', v_qty_pass, 'moq', v_moq, 'actual', v_qty),
      'job_value', jsonb_build_object('pass', v_jobvalue_pass, 'min', v_jobvalue_min),
      'metal_weight', jsonb_build_object('pass', v_metalweight_pass, 'applies', v_metalweight_applies),
      'margin', jsonb_build_object(
        'state', v_margin_state,
        'value', v_m,
        'blended', v_margin_actual,
        'target', v_set.margin_target_pct
      )
    ),
    'warnings', v_warnings,
    'formula_version', 3
  );
end;
$$;

revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_price_calc(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
