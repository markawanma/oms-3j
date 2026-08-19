-- 0064_oem_quote_customer_fields.sql
-- Frontend phase (T5, /oem/quote) hits a gap in 0062/0063: analytics.oem_quote
-- has customer_name/customer_contact columns (0062 §4) but oem_quote_save has
-- no parameter to set them — every quote would be saved with both null
-- forever, even though the T5 design brief requires "ชื่อลูกค้า/ช่องทางติดต่อ"
-- as the first two form fields. This migration ONLY adds two optional,
-- trailing, defaulted parameters to oem_quote_save (Postgres allows this via
-- CREATE OR REPLACE FUNCTION without touching the function's identity/grants
-- — old callers omitting them are unaffected). No pricing logic changes.

-- The old 5-arg signature is DROPPED first, on purpose. CREATE OR REPLACE
-- FUNCTION identifies a function by (name, argument types) — adding parameters
-- creates a SECOND function rather than replacing the first, even when the new
-- ones are defaulted. Both would then match a 5-argument call and Postgres
-- would reject it as "function is not unique", i.e. every save would break the
-- moment this shipped. Same trap 0060 hit with campaign_create_task; dropping
-- the old signature explicitly is the fix there too.
drop function if exists analytics.oem_quote_save(uuid, jsonb, uuid, text, text);

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
      select 'OEM-' || to_char(current_date, 'YYMM') || '-' ||
             lpad((coalesce(max(substring(quote_no from 10 for 3)::int), 0) + 1)::text, 3, '0')
        into v_quote_no
      from analytics.oem_quote
      where shop_id = p_shop_id and quote_no like 'OEM-' || to_char(current_date, 'YYMM') || '-%';

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

-- Same OID as before (CREATE OR REPLACE with only-appended-defaulted-params
-- keeps identity + existing grants); re-stating revoke/grant against the new
-- 7-arg signature anyway so this migration is correct standalone/idempotent
-- even if that assumption is ever wrong on a given Postgres version.
revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
