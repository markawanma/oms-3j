-- 0062_oem_quote_calc.sql
-- OEM pricing floor — the formula + the quote record (T2 of the OEM pricing
-- feature). Depends on 0061 (oem_rate_def / oem_cost_rate / oem_setting /
-- oem_metal_price / oem_rate_value).
--
-- Source: docs/3j-jewelry/marketing/oem-pricing-floor.md §2.2 (the 6-line
-- formula), §2.3 (gold pass-through), §3 (3-gate floor).
--
-- analytics.oem_price_calc is the ONLY place the formula lives. Every number
-- the app shows the owner — the live preview, the saved quote, the reprint —
-- reads through this one function so §2.2 can never drift between two
-- implementations. lib/actions/oem.ts (T3) contains zero arithmetic.
--
-- Permission model note: this app has one write-permission tier today
-- (crm_require_owner_admin — "is this caller a member of the shop with
-- owner/admin role", same gate every other RPC in this codebase uses). There
-- is deliberately NO second check anywhere below for "who is allowed to
-- approve a below-floor quote" — role-tiering is a future phase. That is why
-- the margin_hard_floor_pct rule (§3.1's <15%) is enforced unconditionally at
-- the DB layer with no override path: it is the only backstop this system has
-- today, not a placeholder for "until we add an owner-only override".

-- ============================================================================
-- 1. oem_missing_item — small formatter shared by oem_price_calc so every
--    "missing" entry it appends has the exact same shape as what
--    oem_missing_rates (§3 below) returns. Internal only (revoked from
--    PUBLIC, same as oem_rate_value in 0061).
-- ============================================================================

create or replace function analytics.oem_missing_item(p_rate_key text, p_scope text)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
  select jsonb_build_object(
    'rate_key', d.rate_key,
    'scope', coalesce(p_scope, '-'),
    'question_th', d.question_th,
    'priority', d.priority
  )
  from analytics.oem_rate_def d
  where d.rate_key = p_rate_key
$$;

revoke execute on function analytics.oem_missing_item(text, text) from public;

-- ============================================================================
-- 2. analytics.oem_price_calc — the formula. `stable` (reads only, safe to
--    call repeatedly in one statement/transaction), never raises for
--    incomplete SHOP DATA (returns is_complete=false + a `missing` list
--    instead — "กรอกไม่ครบ = สถานะปกติ ไม่ใช่ error"); DOES raise for a
--    malformed CALL (missing qty/weight/metal etc — that is a caller bug, a
--    different category from "the owner hasn't answered §6 yet").
--
-- p_input contract (documented here once — lib/oem/types.ts mirrors this,
-- does not redefine it):
--   metal            'silver'|'gold'|'brass'                     required
--   item_kind        text, matches oem_rate_scope_option          required
--                     (e.g. 'แหวน') for flask_capacity_pieces
--   polish_tier      'เรียบ'|'ปานกลาง'|'ละเอียด'                  required
--   qty              int > 0                                      required
--   weight_g         numeric > 0 (net metal weight per piece)      required
--   is_new_design    boolean (default true — see decision log:      optional
--                     "assume NRE applies unless told otherwise")
--   purity           numeric in (0,1] (required for gold; silver    optional
--                     defaults 0.925, brass defaults 1.0)
--   plating_type     'ทอง'|'โรเดียม'|'พิงค์โกลด์' | absent = no plating
--   gem_tier         'เล็ก'|'กลาง'|'ใหญ่' | absent = no gems
--   gem_count        numeric >= 0, default 0 (gems per piece)
--   as_of_date       date, default current_date (metal price / rate
--                     effective_from cutoff — what makes a saved quote
--                     reprintable at the rates that were live when quoted)
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

  v_set analytics.oem_setting%rowtype;

  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;

  v_r_cast numeric; v_r_polish numeric; v_r_plate numeric; v_r_total numeric;
  v_q_run  numeric;

  v_price_used numeric; v_price_source text;
  v_sprue numeric; v_recovery numeric; v_metal_per_piece numeric;

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

  -- ---- structural input validation (caller bug -> raise) ----
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

  -- ============================================================
  -- (1) reject rate — R1: compounded, 1-(1-a)(1-b)(1-c), NOT summed
  -- ============================================================
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
  -- each factor is provably in (0,1], so the product is too -> r_total < 1
  -- always; no divide-by-zero guard needed downstream for (1-r_total).
  v_r_total := 1 - (1 - coalesce(v_r_cast, 0)) * (1 - coalesce(v_r_polish, 0)) * (1 - coalesce(v_r_plate, 0));

  -- ============================================================
  -- (2) Q_run — R2: single ceil here; the second ceil (per-flask/per-batch
  -- run count) happens in the batch section below, on numeric throughout.
  -- ============================================================
  v_q_run := ceiling(v_qty::numeric / (1 - v_r_total));

  -- ============================================================
  -- (3) metal — formula 2. Price resolution: oem_metal_price (latest row
  -- as_of <= v_as_of) -> silver-only fallback to shop_setting's spot price
  -- (0028) -> missing.
  -- ============================================================
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
  if v_sprue is null then v_missing := v_missing || analytics.oem_missing_item('sprue_loss_pct', v_metal); end if;
  if v_recovery is null then v_missing := v_missing || analytics.oem_missing_item('recovery_rate_pct', v_metal); end if;

  v_metal_per_piece := v_weight_g * v_purity * coalesce(v_price_used, 0) * (1 + coalesce(v_sprue, 0))
                        * (1 / (1 - v_r_total * (1 - coalesce(v_recovery, 0))));

  -- ============================================================
  -- (4) labor — formula 3. Every per-time rate converts via ITS dept's
  -- labor_thb_per_day / work_hours_per_day, uniformly (see 0061's comment on
  -- polish_pieces_per_day's depends_on for why work_hours_per_day is a real
  -- completeness requirement even where the hours cancel algebraically).
  -- ============================================================

  -- ฉีดเทียน (wax injection)
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

  -- หล่อ (cut sprue — grouped with the casting/finishing dept)
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

  -- ขัด (polish, tiered)
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

  -- ฝังพลอย (gem setting — only if this job has gems)
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

  -- QC
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

  -- แพ็ก (flat per-piece, no dept/time conversion)
  v_pack := analytics.oem_rate_value(p_shop_id, 'pack_cost_thb_per_piece', '-', v_as_of);
  if v_pack is null then v_missing := v_missing || analytics.oem_missing_item('pack_cost_thb_per_piece', '-'); end if;
  c_pack := coalesce(v_pack, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'pack', 'minutes', null, 'thb', round(c_pack, 4));

  -- ค่าน้ำประสาน/อัลลอย (gold only — part of "ค่ากำเหน็จ", not pass-through)
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

  -- ============================================================
  -- (5) batch — formula 4. flask always; plating only if this job is plated.
  -- ceil(Q_run/n_j), NOT ceil(Q/n_j) — the second of R2's two ceils.
  -- ============================================================
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

  -- divided by Q (pieces the customer actually receives), not Q_run — formula 4 literally says "/ Q"
  v_batch_per_piece := (coalesce(v_flask_total, 0) + coalesce(v_plate_total, 0)) / v_qty;

  -- ============================================================
  -- (6) NRE — §1.3. Flat sum, no margin multiplier trick (Price = Cost/(1-m)
  -- like everywhere else), skipped entirely when this job reuses a shop
  -- design (§1.6: sunk cost, not billed again).
  -- ============================================================
  if v_is_new_design then
    v_cad := analytics.oem_rate_value(p_shop_id, 'cad_fee_thb', '-', v_as_of);
    v_print3d := analytics.oem_rate_value(p_shop_id, 'print3d_cost_thb', '-', v_as_of);
    v_mold := analytics.oem_rate_value(p_shop_id, 'rubber_mold_cost_thb', '-', v_as_of);
    if v_cad is null then v_missing := v_missing || analytics.oem_missing_item('cad_fee_thb', '-'); end if;
    if v_print3d is null then v_missing := v_missing || analytics.oem_missing_item('print3d_cost_thb', '-'); end if;
    if v_mold is null then v_missing := v_missing || analytics.oem_missing_item('rubber_mold_cost_thb', '-'); end if;
    v_nre_cost := coalesce(v_cad, 0) + coalesce(v_print3d, 0) + coalesce(v_mold, 0);
    v_nre_price := case when v_nre_cost > 0 then round(v_nre_cost / (1 - v_set.margin_target_pct), 2) else 0 end;
  else
    v_cad := 0; v_print3d := 0; v_mold := 0; v_nre_cost := 0; v_nre_price := 0;
  end if;

  -- ============================================================
  -- assemble cost/price. Gold (§2.3 R7): margin applies ONLY to
  -- (labor+batch) "ค่ากำเหน็จ" — the metal weight is pure pass-through, 0
  -- margin. This is why margin_actual_pct comes out lower than
  -- margin_target_pct for gold jobs by construction: that dilution is the
  -- correct, intended signal (§2.4/§2.5), not a bug.
  -- ============================================================
  v_cost_piece := coalesce(v_metal_per_piece, 0) + coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0);
  if v_metal = 'gold' then
    v_price_piece := coalesce(v_metal_per_piece, 0)
                      + (coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0)) / (1 - v_set.margin_target_pct);
    v_warnings := v_warnings || to_jsonb('งานทองเป็น pass-through: มาร์จิ้นคิดเฉพาะค่ากำเหน็จ ไม่คิดทับเนื้อทอง (§2.3) — margin_actual_pct ที่แสดงจึงต่ำกว่า margin_target_pct โดยตั้งใจ'::text);
  else
    v_price_piece := v_cost_piece / (1 - v_set.margin_target_pct);
  end if;

  -- ============================================================
  -- floor lookups (§3) happen BEFORE is_complete is decided — moq_pieces and
  -- gold_min_purchase_lot_g can still add to v_missing, and is_complete (and
  -- everything gated on it below) must reflect the FINAL missing list, not a
  -- snapshot taken mid-way through.
  -- ============================================================
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

  -- job-value floor: NRE-derived (§3.2 crit.1, ฿2,000/0.25=฿8,000) vs the
  -- flat setting floor, whichever is higher — a reorder with no NRE still
  -- respects the general minimum instead of having no job-value floor at all.
  -- pass=null (not false) when quote_total itself isn't known yet, so the UI
  -- can tell "failed" apart from "can't tell yet".
  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when v_nre_cost > 0 then v_nre_cost / v_set.nre_max_share_pct else 0 end
  );
  v_jobvalue_pass := case when v_quote_total is not null then v_quote_total >= v_jobvalue_min end;

  v_margin_state := case
    when v_margin_actual is null then null
    when v_margin_actual < v_set.margin_hard_floor_pct then 'hard_floor_breach'
    when v_margin_actual < v_set.margin_floor_pct then 'needs_approval_note'
    when v_margin_actual < v_set.margin_discount_cap_pct then 'discount_zone'
    else 'ok'
  end;
  if v_margin_state in ('discount_zone', 'needs_approval_note', 'hard_floor_breach') then
    v_warnings := v_warnings || to_jsonb(('margin อยู่ในโซน ' || v_margin_state || ' (' || coalesce(round(v_margin_actual * 100, 1)::text, '?') || '%)')::text);
  end if;

  return jsonb_build_object(
    'is_complete', v_is_complete,
    'missing', v_missing,
    'breakdown', jsonb_build_object(
      'q_run', v_q_run,
      'reject_pct_total', round(v_r_total, 4),
      'metal', jsonb_build_object(
        'per_piece', round(v_metal_per_piece, 4),
        'gross_loss_pct', v_sprue,
        'effective_loss_pct', case when v_sprue is not null and v_recovery is not null
                                    then round(v_sprue * (1 - v_recovery), 4) end,
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
      'margin', jsonb_build_object('state', v_margin_state, 'value', v_margin_actual)
    ),
    'warnings', v_warnings,
    'formula_version', 1
  );
end;
$$;

revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_price_calc(uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 3. oem_missing_rates — general-purpose gap scanner (used by the intake
--    checklist UI). p_input=null mode reuses v_oem_rate_status (0061)
--    directly (always "as of now" — a historical readiness snapshot isn't a
--    real product need, unlike a saved quote's reprint, which is why p_as_of
--    only affects the p_input-provided mode below).
--    p_input-provided mode DELEGATES to oem_price_calc rather than
--    re-implementing scope resolution — the design brief's "one
--    implementation of the formula" rule extends to "what counts as missing
--    for a given job", since that list falls straight out of the formula.
-- ============================================================================

create or replace function analytics.oem_missing_rates(
  p_shop_id uuid,
  p_input jsonb default null,
  p_as_of date default current_date
)
 returns table (rate_key text, scope text, label_th text, question_th text, priority text)
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_calc jsonb;
  v_item jsonb;
  v_input2 jsonb;
begin
  if p_shop_id is null then
    raise exception 'oem_missing_rates: p_shop_id is required';
  end if;

  if p_input is null then
    return query
      select s.rate_key, s.scope, s.label_th, s.question_th, s.priority
      from analytics.v_oem_rate_status s
      where s.shop_id = p_shop_id and s.priority = 'P0' and s.applies_when = 'always' and s.is_missing
      order by s.seq;
    return;
  end if;

  v_input2 := p_input || jsonb_build_object('as_of_date', coalesce(p_input->>'as_of_date', p_as_of::text));
  v_calc := analytics.oem_price_calc(p_shop_id, v_input2);

  for v_item in select * from jsonb_array_elements(coalesce(v_calc->'missing', '[]'::jsonb)) loop
    rate_key := v_item->>'rate_key';
    scope := v_item->>'scope';
    question_th := v_item->>'question_th';
    priority := v_item->>'priority';
    select d.label_th into label_th from analytics.oem_rate_def d where d.rate_key = rate_key;
    return next;
  end loop;
end;
$$;

revoke execute on function analytics.oem_missing_rates(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function analytics.oem_missing_rates(uuid, jsonb, date) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.oem_quote — the saved record. Keeps BOTH the full jsonb (calc
--    = oem_price_calc's return, for reprint/UI; rate_snapshot = the same
--    payload today — see decision log for why these two columns are
--    currently identical) AND flat columns, so win-rate/margin-drift queries
--    never have to reach into jsonb.
-- ============================================================================

create table if not exists analytics.oem_quote (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shop (id) on delete cascade,
  quote_no             text not null,
  customer_name        text,
  customer_contact     text,
  input                jsonb not null,
  calc                 jsonb not null,
  rate_snapshot        jsonb not null,
  cost_piece           numeric(14, 4),
  price_per_piece      numeric(14, 4),
  nre_cost             numeric(14, 2),
  nre_price            numeric(14, 2),
  pieces_subtotal      numeric(14, 2),
  quote_total          numeric(14, 2),
  margin_actual_pct    numeric(6, 4),
  q_run                int,
  flask_count          int,
  plating_batch_count  int,
  status               text not null default 'draft'
                       check (status in ('draft', 'quoted', 'won', 'lost', 'expired', 'rejected')),
  approval_note        text,
  -- Audit trail only — who wrote the approval_note, NOT a permission check.
  -- This app has one write-permission tier today (see header comment); do
  -- not add logic anywhere that branches on "is approved_by the owner".
  approved_by          uuid references auth.users (id) on delete set null,
  quote_valid_until    date,
  lost_reason          text,
  lost_to              text,
  created_by           uuid references auth.users (id) on delete set null,
  updated_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (shop_id, quote_no)
);

comment on column analytics.oem_quote.rate_snapshot is
  'Currently a duplicate of calc (both = oem_price_calc''s full jsonb return). Kept as a separate column per design so a future "recompute at today''s rates and diff against what was quoted" feature can repoint rate_snapshot at the raw resolved-rate values without a migration; calc always stays "what the customer was quoted".';

create index if not exists idx_oem_quote_shop_status on analytics.oem_quote (shop_id, status, created_at desc);

alter table analytics.oem_quote enable row level security;

drop policy if exists tenant_isolation_select on analytics.oem_quote;
create policy tenant_isolation_select on analytics.oem_quote
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

drop policy if exists owner_admin_write on analytics.oem_quote;
create policy owner_admin_write on analytics.oem_quote
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 5. oem_quote_save — the only write path to oem_quote. ALWAYS recomputes via
--    oem_price_calc server-side; p_input is the only price-relevant thing the
--    client sends, never a number.
-- ============================================================================

create or replace function analytics.oem_quote_save(
  p_shop_id uuid,
  p_input jsonb,
  p_quote_id uuid default null,
  p_status text default 'draft',
  p_approval_note text default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_calc jsonb;
  v_set  analytics.oem_setting%rowtype;
  v_quote_id uuid := p_quote_id;
  v_quote_no text;
  v_is_complete boolean;
  v_margin numeric;
  v_metal text;
  v_valid_days int;
  v_qty_pass boolean; v_jobvalue_pass boolean; v_metalweight_pass boolean;
  v_flask_count int; v_plate_count int;
  v_approved_by uuid;
  v_i int;
begin
  if p_shop_id is null or p_input is null then
    raise exception 'oem_quote_save: p_shop_id and p_input are required';
  end if;
  if p_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_save: p_status must be draft or quoted (use oem_quote_set_status to change status afterwards)';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  v_calc := analytics.oem_price_calc(p_shop_id, p_input);
  v_is_complete := (v_calc->>'is_complete')::boolean;
  v_margin := nullif(v_calc->'breakdown'->>'margin_actual_pct', '')::numeric;
  v_metal := p_input->>'metal';
  v_qty_pass := (v_calc->'floors'->'qty'->>'pass')::boolean;
  v_jobvalue_pass := (v_calc->'floors'->'job_value'->>'pass')::boolean;
  v_metalweight_pass := coalesce((v_calc->'floors'->'metal_weight'->>'pass')::boolean, true);

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
  end if;

  if p_status = 'quoted' then
    if not coalesce(v_is_complete, false) then
      raise exception 'oem_quote_save: ยังกรอกข้อมูลไม่ครบ ออกใบเสนอราคา (quoted) ไม่ได้ — บันทึกเป็น draft ก่อนได้' using errcode = '22023';
    end if;
    if not coalesce(v_qty_pass, false) or not coalesce(v_jobvalue_pass, false) or not v_metalweight_pass then
      raise exception 'oem_quote_save: ไม่ผ่านเกณฑ์ floor (จำนวนชิ้น/มูลค่างาน/น้ำหนักโลหะ ตาม §3) ออกใบเสนอราคาไม่ได้' using errcode = '22023';
    end if;

    -- Margin gate — 2 tiers, no role check (see header comment): the note
    -- requirement is "stop and write down why", not a permission wall.
    if v_margin is not null and v_margin < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: margin % ต่ำกว่า hard floor % (§3.1 <15%%) — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        round(v_margin * 100, 1) || '%', round(v_set.margin_hard_floor_pct * 100, 1) || '%'
        using errcode = '22023';
    end if;
    if v_margin is not null and v_margin < v_set.margin_floor_pct and (p_approval_note is null or btrim(p_approval_note) = '') then
      raise exception 'oem_quote_save: margin ต่ำกว่า floor (§3.1 <20%%) — ต้องใส่เหตุผล (p_approval_note) ก่อนออกใบเสนอราคา' using errcode = '22023';
    end if;
  end if;

  v_approved_by := case when p_approval_note is not null and btrim(p_approval_note) <> '' then auth.uid() else null end;

  v_valid_days := case v_metal
    when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
    when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
    else coalesce(v_set.quote_valid_days_silver, 30)
  end;

  select (l->>'count')::int into v_flask_count
    from jsonb_array_elements(coalesce(v_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
    where l->>'key' = 'flask';
  select (l->>'count')::int into v_plate_count
    from jsonb_array_elements(coalesce(v_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
    where l->>'key' = 'plating';

  if v_quote_id is not null then
    update analytics.oem_quote set
      input = p_input,
      calc = v_calc,
      rate_snapshot = v_calc,
      cost_piece = (v_calc->'breakdown'->>'cost_piece')::numeric,
      price_per_piece = (v_calc->'breakdown'->>'price_per_piece')::numeric,
      nre_cost = (v_calc->'breakdown'->'nre'->>'cost')::numeric,
      nre_price = (v_calc->'breakdown'->'nre'->>'price')::numeric,
      pieces_subtotal = nullif(v_calc->'breakdown'->>'quote_total', '')::numeric
                         - coalesce((v_calc->'breakdown'->'nre'->>'price')::numeric, 0),
      quote_total = (v_calc->'breakdown'->>'quote_total')::numeric,
      margin_actual_pct = v_margin,
      q_run = (v_calc->'breakdown'->>'q_run')::int,
      flask_count = v_flask_count,
      plating_batch_count = v_plate_count,
      status = p_status,
      approval_note = coalesce(p_approval_note, approval_note),
      approved_by = coalesce(v_approved_by, approved_by),
      quote_valid_until = case when p_status = 'quoted' then current_date + v_valid_days else quote_valid_until end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_quote_id and shop_id = p_shop_id;
    if not found then
      raise exception 'oem_quote_save: quote % not found for this shop', v_quote_id;
    end if;
  else
    for v_i in 1..5 loop
      select 'OEM-' || to_char(current_date, 'YYMM') || '-' ||
             lpad((coalesce(max(substring(quote_no from 10 for 3)::int), 0) + 1)::text, 3, '0')
        into v_quote_no
      from analytics.oem_quote
      where shop_id = p_shop_id and quote_no like 'OEM-' || to_char(current_date, 'YYMM') || '-%';

      begin
        insert into analytics.oem_quote (
          shop_id, quote_no, input, calc, rate_snapshot,
          cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
          margin_actual_pct, q_run, flask_count, plating_batch_count,
          status, approval_note, approved_by,
          quote_valid_until, created_by, updated_by
        ) values (
          p_shop_id, v_quote_no, p_input, v_calc, v_calc,
          (v_calc->'breakdown'->>'cost_piece')::numeric,
          (v_calc->'breakdown'->>'price_per_piece')::numeric,
          (v_calc->'breakdown'->'nre'->>'cost')::numeric,
          (v_calc->'breakdown'->'nre'->>'price')::numeric,
          nullif(v_calc->'breakdown'->>'quote_total', '')::numeric - coalesce((v_calc->'breakdown'->'nre'->>'price')::numeric, 0),
          (v_calc->'breakdown'->>'quote_total')::numeric,
          v_margin,
          (v_calc->'breakdown'->>'q_run')::int,
          v_flask_count, v_plate_count,
          p_status, p_approval_note, v_approved_by,
          case when p_status = 'quoted' then current_date + v_valid_days else null end,
          auth.uid(), auth.uid()
        )
        returning id into v_quote_id;
        exit;
      exception when unique_violation then
        if v_i = 5 then
          raise exception 'oem_quote_save: ออกเลขที่ใบเสนอราคาไม่สำเร็จ (เลขชนกันซ้ำหลายครั้ง) ลองใหม่อีกครั้ง';
        end if;
      end;
    end loop;
  end if;

  return v_quote_id;
end;
$$;

create or replace function analytics.oem_quote_set_status(
  p_quote_id uuid,
  p_status text,
  p_lost_reason text default null,
  p_lost_to text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare v_shop_id uuid;
begin
  if p_quote_id is null or p_status is null then
    raise exception 'oem_quote_set_status: p_quote_id and p_status are required';
  end if;
  if p_status not in ('draft', 'quoted', 'won', 'lost', 'expired', 'rejected') then
    raise exception 'oem_quote_set_status: invalid status %', p_status;
  end if;
  select shop_id into v_shop_id from analytics.oem_quote where id = p_quote_id;
  if v_shop_id is null then
    raise exception 'oem_quote_set_status: quote % not found', p_quote_id;
  end if;
  perform analytics.crm_require_owner_admin(v_shop_id);

  -- §8 (design doc): without this, next year nobody can tell "lost on price"
  -- from "lost on something else" — the whole point of tracking win-rate.
  if p_status = 'lost' and (p_lost_reason is null or btrim(p_lost_reason) = '') then
    raise exception 'oem_quote_set_status: ปฏิเสธ/แพ้งานต้องระบุเหตุผล (p_lost_reason)' using errcode = '22023';
  end if;

  update analytics.oem_quote set
    status = p_status,
    lost_reason = case when p_status = 'lost' then p_lost_reason else lost_reason end,
    lost_to = case when p_status = 'lost' then p_lost_to else lost_to end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id;
end;
$$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text) to authenticated, service_role;
revoke execute on function analytics.oem_quote_set_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_status(uuid, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 6. v_oem_quote — read view. is_expired only applies to a 'quoted' quote
--    that's past its own validity date (a draft or a won/lost quote isn't
--    "expired", it's just not live).
-- ============================================================================

create or replace view analytics.v_oem_quote
  with (security_invoker = true) as
select
  q.*,
  (q.status = 'quoted' and q.quote_valid_until is not null and q.quote_valid_until < current_date) as is_expired,
  case when q.quote_valid_until is not null then q.quote_valid_until - current_date else null end as days_left
from analytics.oem_quote q;

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
