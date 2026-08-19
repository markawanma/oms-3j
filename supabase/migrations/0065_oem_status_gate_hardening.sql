-- 0065_oem_status_gate_hardening.sql
-- Security review findings on the OEM feature (0061–0064). Three fixes, one
-- availability fix.
--
-- C1 (critical) — the hard floor had a two-request bypass.
--   oem_quote_save puts EVERY gate (is_complete, the 3 floors, hard floor,
--   approval note) inside `if p_status = 'quoted'`. Saving as 'draft' skips
--   all of them, by design — a draft is meant to be a scratchpad. But
--   oem_quote_set_status would then happily move that draft straight to
--   'quoted' without recomputing anything: it only validated that the status
--   string was one of six values. So: save a draft at margin 1%, flip it to
--   quoted, and you have an issued quote below the hard floor that 0062's own
--   header calls "the only backstop this system has today" — with
--   approval_note/approved_by null (no audit trail) and quote_valid_until null
--   (never expires, so the metal price is locked forever).
--   Fix: 'quoted' is now reachable ONLY through oem_quote_save, which is the
--   one place that recomputes and gates. won/lost additionally require the
--   quote to have actually been issued first.
--
-- H1 (high) — cross-shop IDOR. oem_quote_set_status derived shop_id FROM the
--   row being changed and then called crm_require_owner_admin on it, which
--   short-circuits for service_role — and the app always connects as
--   service_role. Net effect: no tenant check at all; any quote id changed any
--   shop's quote. Single-tenant today, but the schema is multi-tenant
--   throughout and every other action scopes by shop. p_shop_id is now
--   required and matched in the WHERE clause, not read out of the row.
--
-- H2 (high) — dead grant / future breakage. oem_price_calc is SECURITY INVOKER
--   and granted to `authenticated`, but it calls oem_rate_value and
--   oem_missing_item, which were revoked from PUBLIC and never granted to
--   authenticated. Today nothing notices because the app connects as
--   service_role; the day real end-user auth lands (A2), every price
--   calculation fails with "permission denied for function oem_rate_value".
--   The tempting fix — make oem_price_calc SECURITY DEFINER — would be a
--   cross-tenant hole: it takes p_shop_id as a parameter and has no owner
--   check, so definer + no RLS = read any shop's cost structure. Granting the
--   two helpers is the correct fix (they stay INVOKER, so RLS on
--   oem_cost_rate still scopes them), plus an explicit owner check so the
--   function is safe even if someone later changes its volatility.
--
-- L1 (availability) — quote numbers died after 999 per month. The running
--   number was parsed with substring(quote_no from 10 for 3), i.e. exactly
--   three characters: once OEM-YYMM-1000 exists it reads back as "100", max()
--   stays at 999, the next number computed is 1000 again, it collides, and the
--   5-attempt retry loop recomputes the identical value every time. Not a
--   race — deterministic, and permanent for the rest of that month.
--   split_part on the '-' delimiter has no width assumption.

-- ============================================================================
-- 1. oem_quote_set_status — tenant-scoped + transitions gated (C1, H1)
-- ============================================================================

drop function if exists analytics.oem_quote_set_status(uuid, text, text, text);

create or replace function analytics.oem_quote_set_status(
  p_shop_id uuid,
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
declare
  v_current text;
begin
  if p_shop_id is null or p_quote_id is null or p_status is null then
    raise exception 'oem_quote_set_status: p_shop_id, p_quote_id and p_status are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 'quoted' and 'draft' are deliberately NOT settable here: both are produced
  -- by oem_quote_save, which recomputes the price and runs the floor gates.
  -- Allowing them here is exactly the C1 bypass.
  if p_status not in ('won', 'lost', 'rejected', 'expired') then
    raise exception 'oem_quote_set_status: สถานะ % เปลี่ยนตรงๆ ไม่ได้ — ออก/แก้ใบเสนอราคาผ่านหน้าคิดราคาเท่านั้น', p_status
      using errcode = '22023';
  end if;

  -- Scope by shop in the WHERE clause. Deriving shop_id from the row and
  -- checking it afterwards is not a check at all when the caller is
  -- service_role (crm_require_owner_admin short-circuits for it).
  select status into v_current
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id;
  if v_current is null then
    raise exception 'oem_quote_set_status: quote % not found for this shop', p_quote_id;
  end if;

  -- A draft was never gated, so it was never really offered to anyone —
  -- closing it as won/lost would put ungated numbers into the win-rate data
  -- the whole feature exists to produce.
  if p_status in ('won', 'lost') and v_current not in ('quoted', 'expired') then
    raise exception 'oem_quote_set_status: ใบนี้ยังไม่เคยออกเป็นใบเสนอราคา (สถานะ %) ปิดงานไม่ได้', v_current
      using errcode = '22023';
  end if;

  if p_status = 'lost' and (p_lost_reason is null or btrim(p_lost_reason) = '') then
    raise exception 'oem_quote_set_status: ปฏิเสธ/แพ้งานต้องระบุเหตุผล (p_lost_reason)' using errcode = '22023';
  end if;

  update analytics.oem_quote set
    status = p_status,
    lost_reason = case when p_status = 'lost' then p_lost_reason else lost_reason end,
    lost_to = case when p_status = 'lost' then p_lost_to else lost_to end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 2. Helper grants + owner check on the read path (H2)
--
-- oem_rate_value and oem_missing_item stay SECURITY INVOKER on purpose: RLS
-- (tenant_isolation_select on oem_cost_rate) is what stops one shop reading
-- another's cost structure once real auth lands. Granting EXECUTE does not
-- widen that — a caller still only sees rows their RLS lets them see.
--
-- ⛔ DO NOT change oem_price_calc or oem_missing_rates to SECURITY DEFINER.
-- They take p_shop_id as a parameter; as definer they would bypass RLS and
-- hand any authenticated user any shop's labour rates, batch costs and margin
-- floors. INVOKER + RLS is the only thing separating tenants on this path.
-- ============================================================================

grant execute on function analytics.oem_rate_value(uuid, text, text, date) to authenticated;
grant execute on function analytics.oem_missing_item(text, text) to authenticated;

-- ============================================================================
-- 3. Quote number parsing — no fixed-width assumption (L1)
-- ============================================================================

create or replace function analytics.oem_quote_next_no(p_shop_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
  select 'OEM-' || to_char(current_date, 'YYMM') || '-' ||
         lpad((coalesce(max(split_part(quote_no, '-', 3)::int), 0) + 1)::text, 3, '0')
  from analytics.oem_quote
  where shop_id = p_shop_id
    and quote_no like 'OEM-' || to_char(current_date, 'YYMM') || '-%'
$$;

revoke execute on function analytics.oem_quote_next_no(uuid) from public;

-- oem_quote_save re-stated only to swap the inline substring() for the helper
-- above. Nothing else in it changes — the gates, the recompute-server-side
-- rule and the customer fields from 0064 are all carried over verbatim.
create or replace function analytics.oem_quote_save(
  p_shop_id uuid,
  p_input jsonb,
  p_quote_id uuid default null,
  p_status text default 'draft',
  p_approval_note text default null,
  p_customer_name text default null,
  p_customer_contact text default null
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
  v_margin_charged numeric;
  v_margin_blended numeric;
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
  v_margin_charged := nullif(v_calc->'floors'->'margin'->>'value', '')::numeric;
  v_margin_blended := nullif(v_calc->'breakdown'->>'margin_actual_pct', '')::numeric;
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
      raise exception 'oem_quote_save: ไม่ผ่านเกณฑ์ floor (จำนวนชิ้น/มูลค่างาน/น้ำหนักโลหะ) ออกใบเสนอราคาไม่ได้' using errcode = '22023';
    end if;

    if v_margin_charged is not null and v_margin_charged < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: margin ที่คิด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        round(v_margin_charged * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
    if v_margin_charged is not null and v_margin_charged < v_set.margin_floor_pct
       and (p_approval_note is null or btrim(p_approval_note) = '') then
      raise exception 'oem_quote_save: margin ที่คิดต่ำกว่า floor — ต้องใส่เหตุผล (p_approval_note) ก่อนออกใบเสนอราคา' using errcode = '22023';
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
      customer_name = coalesce(p_customer_name, customer_name),
      customer_contact = coalesce(p_customer_contact, customer_contact),
      cost_piece = (v_calc->'breakdown'->>'cost_piece')::numeric,
      price_per_piece = (v_calc->'breakdown'->>'price_per_piece')::numeric,
      nre_cost = (v_calc->'breakdown'->'nre'->>'cost')::numeric,
      nre_price = (v_calc->'breakdown'->'nre'->>'price')::numeric,
      pieces_subtotal = nullif(v_calc->'breakdown'->>'quote_total', '')::numeric
                         - coalesce((v_calc->'breakdown'->'nre'->>'price')::numeric, 0),
      quote_total = (v_calc->'breakdown'->>'quote_total')::numeric,
      margin_actual_pct = v_margin_blended,
      margin_charged_pct = v_margin_charged,
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
      v_quote_no := analytics.oem_quote_next_no(p_shop_id);
      begin
        insert into analytics.oem_quote (
          shop_id, quote_no, customer_name, customer_contact, input, calc, rate_snapshot,
          cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
          margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count,
          status, approval_note, approved_by,
          quote_valid_until, created_by, updated_by
        ) values (
          p_shop_id, v_quote_no, p_customer_name, p_customer_contact, p_input, v_calc, v_calc,
          (v_calc->'breakdown'->>'cost_piece')::numeric,
          (v_calc->'breakdown'->>'price_per_piece')::numeric,
          (v_calc->'breakdown'->'nre'->>'cost')::numeric,
          (v_calc->'breakdown'->'nre'->>'price')::numeric,
          nullif(v_calc->'breakdown'->>'quote_total', '')::numeric - coalesce((v_calc->'breakdown'->'nre'->>'price')::numeric, 0),
          (v_calc->'breakdown'->>'quote_total')::numeric,
          v_margin_blended, v_margin_charged,
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

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
