-- scripts/verify-0115-missing-orders.sql
-- Rehearsal + proof for 0113/0114/0115 (cancel-detection Phase 1) BEFORE
-- Tech Lead applies them for real via apply_migration.
--
-- ASSUMES 0112 is ALREADY APPLIED to the live DB (the 'tombstoned' enum
-- value and analytics.fact_order_deleted table already exist and are
-- committed) — per 3j-migration-traps, `alter type ... add value` cannot be
-- used in the same transaction that adds it, so this script deliberately
-- does NOT replay 0112's DDL. It replays 0113 + 0114 + 0115 verbatim, then
-- runs every check inside ONE do-block that ends in `raise exception`,
-- forcing a full rollback (3j-migration-traps #11) — this touches
-- analytics.fact_order, the table carrying every real order's revenue.
--
-- shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7' (3J Jewelry, the only
-- shop_id in this project). Fixtures use a fake order-number PREFIX 'ZZ'
-- (real data only ever uses '' through 'G', per A3, 6,510/6,510) so they can
-- never collide with real orders' candidate computation, and a random
-- per-run tag 'VERIFY-0115-<uuid>' on every non-order-number identifying
-- field (file_hash/file_name/reason/shop name) for traceability and to
-- guarantee two runs never collide with each other either.
--
-- Why the DDL sits OUTSIDE the do block: `create or replace function` is
-- DDL and cannot appear as a direct statement inside PL/pgSQL (same
-- reasoning as verify-0109.sql / verify-0111-upsert-rules.sql). The DDL
-- below must stay byte-identical to 0113/0114/0115 — if you edit those
-- migrations, copy the change here too or this rehearsal stops proving what
-- actually ships.

begin;

-- ============================================================================
-- STEP 0: replay 0113 + 0114 + 0115 DDL verbatim.
-- ============================================================================

create or replace function analytics.import_order_no_parts(p_order_no text)
returns table (prefix text, num integer)
language sql
immutable
strict
set search_path to pg_catalog, pg_temp
as $$
  select
    (regexp_match(p_order_no, '^([A-Z]*)([0-9]+)$'))[1],
    ((regexp_match(p_order_no, '^([A-Z]*)([0-9]+)$'))[2])::integer
$$;

revoke execute on function analytics.import_order_no_parts(text) from public, anon, authenticated;
grant execute on function analytics.import_order_no_parts(text) to service_role, authenticated;

create or replace function analytics.import_missing_orders_candidates(p_shop_id uuid, p_batch_id uuid)
returns table (
  fact_order_id uuid,
  source_order_no text,
  order_date date,
  channel_id uuid,
  revenue numeric,
  customer_id uuid,
  tracking_no text,
  prefix text,
  num integer,
  group_lo integer,
  group_hi integer,
  group_date_lo date,
  group_date_hi date,
  file_order_count integer,
  file_channels uuid[]
)
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_batch record;
  v_unparsed_count int;
  v_pending_error_count int;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_missing_orders_candidates: p_shop_id and p_batch_id are required';
  end if;

  select b.id, b.shop_id, b.source_type, b.status, b.imported_at, b.file_name
    into v_batch
    from analytics.stg_import_batch b
    where b.id = p_batch_id;

  if v_batch.id is null
     or v_batch.shop_id is distinct from p_shop_id
     or v_batch.source_type is distinct from 'excel_order_report'
  then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'shop_or_source_mismatch';
  end if;

  if v_batch.status is distinct from 'transformed' then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'batch_not_transformed';
  end if;

  select count(*) into v_pending_error_count
    from analytics.stg_order_import s
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('pending', 'error');
  if v_pending_error_count > 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'batch_has_unresolved_rows';
  end if;

  select count(*) into v_unparsed_count
    from analytics.stg_order_import s
    left join lateral analytics.import_order_no_parts(s.source_order_no) p on true
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
      and p.num is null;
  if v_unparsed_count > 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'unparseable_order_no';
  end if;

  return query
  with f_rows as (
    select p.prefix, p.num, s.order_created_at::date as order_date, dca.channel_id,
           s.printed_at, s.paid_at, s.source_order_no
    from analytics.stg_order_import s
    join lateral analytics.import_order_no_parts(s.source_order_no) p on true
    left join analytics.dim_channel_alias dca on lower(dca.alias_raw) = lower(trim(coalesce(s.channel_raw, '')))
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
  ),
  f_groups as (
    select prefix, min(num) as lo, max(num) as hi,
           min(order_date) as dlo, max(order_date) as dhi
    from f_rows
    group by prefix
  ),
  f_meta as (
    select
      count(*)::integer as file_order_count,
      array_agg(distinct channel_id) filter (where channel_id is not null) as file_channels,
      min(printed_at) filter (where printed_at is not null) as printed_lo,
      max(printed_at) filter (where printed_at is not null) as printed_hi,
      min(paid_at) filter (where paid_at is not null) as paid_lo,
      max(paid_at) filter (where paid_at is not null) as paid_hi
    from f_rows
  )
  select
    fo.id, fo.source_order_no, fo.order_date, fo.channel_id, fo.revenue, fo.customer_id, fo.tracking_no,
    fg.prefix, p2.num, fg.lo, fg.hi, fg.dlo, fg.dhi,
    fm.file_order_count, fm.file_channels
  from analytics.fact_order fo
  cross join lateral analytics.import_order_no_parts(fo.source_order_no) p2
  join f_groups fg on fg.prefix = p2.prefix
  cross join f_meta fm
  where fo.shop_id = p_shop_id
    and p2.num is not null
    and not exists (select 1 from f_rows f2 where f2.source_order_no = fo.source_order_no)
    and p2.num > fg.lo and p2.num < fg.hi
    and fo.order_date between fg.dlo and fg.dhi
    and (fm.file_channels is null or fo.channel_id = any (fm.file_channels))
    and (fo.printed_at is null or fm.printed_lo is null or fo.printed_at between fm.printed_lo and fm.printed_hi)
    and (fo.paid_at is null or fm.paid_lo is null or fo.paid_at between fm.paid_lo and fm.paid_hi)
    and not exists (
      select 1
      from analytics.stg_order_import s2
      join analytics.stg_import_batch b2 on b2.id = s2.batch_id
      where s2.shop_id = p_shop_id and s2.source_order_no = fo.source_order_no
        and b2.imported_at > v_batch.imported_at
    )
    and not exists (
      select 1 from analytics.fact_order_deleted fod
      where fod.shop_id = p_shop_id and fod.source_order_no = fo.source_order_no and fod.restored_at is null
    );
end;
$$;

revoke execute on function analytics.import_missing_orders_candidates(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.import_missing_orders_candidates(uuid, uuid) to authenticated, service_role;

create or replace function analytics.import_missing_orders(p_shop_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_batch record;
  v_blocked_reason text;
  v_candidates jsonb := '[]'::jsonb;
  v_candidate_count int := 0;
  v_candidate_revenue numeric := 0;
  v_file_order_count int := 0;
  v_channels jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_monotonic_warnings int := 0;
  v_detail text;
  v_cap int;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_missing_orders: p_shop_id and p_batch_id are required';
  end if;

  select b.id, b.file_name, b.imported_at into v_batch
    from analytics.stg_import_batch b
    where b.id = p_batch_id and b.shop_id = p_shop_id;

  begin
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'fact_order_id', c.fact_order_id,
        'source_order_no', c.source_order_no,
        'order_date', c.order_date,
        'channel_id', c.channel_id,
        'channel_name', dc.name,
        'revenue_thb', c.revenue,
        'tracking_no', c.tracking_no,
        'customer_id', c.customer_id,
        'customer_display_name', dcu.display_name,
        'last_seen_file', lb.file_name,
        'last_seen_at', lb.imported_at
      ) order by c.order_date, c.source_order_no), '[]'::jsonb),
      coalesce(count(*), 0),
      coalesce(sum(c.revenue), 0)
    into v_candidates, v_candidate_count, v_candidate_revenue
    from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id) c
    left join analytics.dim_channel dc on dc.id = c.channel_id
    left join analytics.dim_customer dcu on dcu.id = c.customer_id
    left join analytics.stg_order_import ls on ls.shop_id = p_shop_id and ls.source_order_no = c.source_order_no
    left join analytics.stg_import_batch lb on lb.id = ls.batch_id;
  exception
    when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      if v_detail in ('shop_or_source_mismatch', 'batch_not_transformed', 'batch_has_unresolved_rows', 'unparseable_order_no') then
        v_blocked_reason := v_detail;
      else
        raise;
      end if;
  end;

  if v_blocked_reason is null and v_batch.id is not null then
    select count(*) into v_file_order_count
      from analytics.stg_order_import s
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned');

    select coalesce(jsonb_agg(jsonb_build_object(
             'prefix', g.prefix, 'lo', g.lo, 'hi', g.hi,
             'date_lo', g.dlo, 'date_hi', g.dhi, 'row_count', g.row_count
           ) order by g.prefix), '[]'::jsonb)
      into v_groups
      from (
        select p.prefix, min(p.num) as lo, max(p.num) as hi,
               min(s.order_created_at::date) as dlo, max(s.order_created_at::date) as dhi,
               count(*) as row_count
        from analytics.stg_order_import s
        join lateral analytics.import_order_no_parts(s.source_order_no) p on true
        where s.shop_id = p_shop_id and s.batch_id = p_batch_id
          and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
        group by p.prefix
      ) g;

    select coalesce(jsonb_agg(distinct jsonb_build_object('channel_id', dc.id, 'code', dc.code, 'name', dc.name)), '[]'::jsonb)
      into v_channels
      from analytics.stg_order_import s
      join analytics.dim_channel_alias dca on lower(dca.alias_raw) = lower(trim(coalesce(s.channel_raw, '')))
      join analytics.dim_channel dc on dc.id = dca.channel_id
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned');

    with day_groups as (
      select p.prefix, (s.order_created_at at time zone 'Asia/Bangkok')::date as day,
             min(p.num) as day_min, max(p.num) as day_max
      from analytics.stg_order_import s
      join lateral analytics.import_order_no_parts(s.source_order_no) p on true
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
      group by p.prefix, (s.order_created_at at time zone 'Asia/Bangkok')::date
    ),
    ordered as (
      select prefix, day, day_min, day_max,
             lag(day_max) over (partition by prefix order by day) as prev_day_max
      from day_groups
    )
    select count(*) into v_monotonic_warnings
    from ordered
    where prev_day_max is not null and day_min < prev_day_max;

    v_cap := greatest(20, ceil(coalesce(v_file_order_count, 0) * 0.15));
    if v_candidate_count > v_cap then
      v_blocked_reason := 'too_many';
    end if;
  end if;

  return jsonb_build_object(
    'ok', v_blocked_reason is null,
    'blocked_reason', v_blocked_reason,
    'evidence', jsonb_build_object(
      'file_name', v_batch.file_name,
      'imported_at', v_batch.imported_at,
      'file_order_count', v_file_order_count,
      'groups', v_groups,
      'channels', v_channels
    ),
    'monotonic_warnings', v_monotonic_warnings,
    'candidate_count', v_candidate_count,
    'candidate_revenue_thb', v_candidate_revenue,
    'candidates', v_candidates
  );
end;
$$;

revoke execute on function analytics.import_missing_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.import_missing_orders(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION analytics.transform_pending_orders(p_shop_id uuid, p_batch_id uuid)
 RETURNS TABLE(transformed_count integer, errored_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_row analytics.stg_order_import%rowtype;
  v_channel_id uuid; v_customer_id uuid; v_customer_name text; v_phone_norm text; v_phone_hash text;
  v_profile_source text; v_tiktok_uid text; v_province_code text; v_order_date date; v_discount_code text;
  v_tags text[]; v_fact_order_id uuid; v_is_new_customer boolean; v_transformed int := 0; v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_orders: p_shop_id and p_batch_id are required';
  end if;
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));
  for v_row in
    select * from analytics.stg_order_import
    where shop_id = p_shop_id and batch_id = p_batch_id and source_kind = 'excel' and import_status in ('pending', 'error')
    order by source_row_no
  loop
    begin
      if exists (
        select 1 from analytics.fact_order_deleted fod
        where fod.shop_id = p_shop_id and fod.source_order_no = v_row.source_order_no and fod.restored_at is null
      ) then
        update analytics.stg_order_import set import_status = 'tombstoned', fact_order_id = null, error_detail = null, error_code = null where id = v_row.id;
        continue;
      end if;
      v_channel_id := null; v_customer_id := null; v_phone_norm := null; v_phone_hash := null; v_profile_source := null;
      select dca.channel_id into v_channel_id from analytics.dim_channel_alias dca
        where lower(dca.alias_raw) = lower(trim(coalesce(v_row.channel_raw, '')));
      if v_channel_id is null then
        update analytics.stg_order_import set import_status = 'error',
              error_detail = 'no dim_channel_alias match for channel_raw: ' || coalesce(v_row.channel_raw, '<null>'), error_code = 'channel_alias_missing'
          where id = v_row.id;
        v_errored := v_errored + 1; continue;
      end if;
      if v_row.order_created_at is null then
        update analytics.stg_order_import set import_status = 'error',
              error_detail = 'order_created_at is null, cannot derive order_date', error_code = 'order_date_missing'
          where id = v_row.id;
        v_errored := v_errored + 1; continue;
      end if;
      v_order_date := v_row.order_created_at::date;
      v_discount_code := nullif(nullif(btrim(coalesce(v_row.discount_code, '')), ''), '-');
      v_phone_norm := analytics.normalize_th_phone(v_row.phone_raw);
      v_customer_name := nullif(trim(coalesce(v_row.customer_name_raw, '')), '');
      v_tiktok_uid := nullif(trim(coalesce(v_row.contact_display_name_raw, '')), '');
      if v_tiktok_uid is null or v_tiktok_uid !~ '^[0-9]{15,}$' then v_tiktok_uid := null; end if;
      if v_phone_norm is not null then
        v_phone_hash := encode(digest(v_phone_norm, 'sha256'), 'hex');
        insert into analytics.dim_customer (shop_id, display_name, primary_phone_hash, first_touch_channel_id)
        values (p_shop_id, v_row.customer_name_raw, v_phone_hash, v_channel_id)
        on conflict (shop_id, primary_phone_hash) where primary_phone_hash is not null and merged_into_id is null
        do update set display_name = case when analytics.dim_customer.profile_source = 'import'
            then coalesce(excluded.display_name, analytics.dim_customer.display_name) else analytics.dim_customer.display_name end,
          updated_at = now()
        returning id, profile_source into v_customer_id, v_profile_source;
        insert into analytics.dim_customer_identity (shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence)
        values (p_shop_id, v_customer_id, 'phone', v_phone_norm, v_phone_hash, 'exact')
        on conflict (shop_id, identity_type, identity_value_norm) do update set customer_id = excluded.customer_id, updated_at = now();
        insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name)
        values (v_customer_id, p_shop_id, v_phone_norm, v_row.customer_name_raw)
        on conflict (customer_id) do update set phone_e164 = excluded.phone_e164,
          full_name = case when v_profile_source = 'import' then coalesce(excluded.full_name, analytics.pii_customer.full_name) else analytics.pii_customer.full_name end,
          updated_at = now();
      elsif v_tiktok_uid is not null then
        select ci.customer_id, dc.profile_source into v_customer_id, v_profile_source
          from analytics.dim_customer_identity ci
          join analytics.dim_customer dc on dc.id = ci.customer_id and dc.merged_into_id is null
          where ci.shop_id = p_shop_id and ci.identity_type = 'tiktok_handle' and ci.identity_value_norm = v_tiktok_uid limit 1;
        if v_customer_id is null then
          insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
          values (p_shop_id, v_customer_name, v_channel_id) returning id into v_customer_id;
          insert into analytics.dim_customer_identity (shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence)
          values (p_shop_id, v_customer_id, 'tiktok_handle', v_tiktok_uid, encode(digest(v_tiktok_uid, 'sha256'), 'hex'), 'exact')
          on conflict (shop_id, identity_type, identity_value_norm) do update set customer_id = excluded.customer_id, updated_at = now();
          if v_customer_name is not null then
            insert into analytics.pii_customer (customer_id, shop_id, full_name) values (v_customer_id, p_shop_id, v_customer_name)
            on conflict (customer_id) do nothing;
          end if;
        else
          update analytics.dim_customer set display_name = case when profile_source = 'import' then coalesce(v_customer_name, display_name) else display_name end, updated_at = now()
            where id = v_customer_id;
          if v_customer_name is not null then
            insert into analytics.pii_customer (customer_id, shop_id, full_name) values (v_customer_id, p_shop_id, v_customer_name)
            on conflict (customer_id) do update set full_name = case when v_profile_source = 'import' then coalesce(excluded.full_name, analytics.pii_customer.full_name) else analytics.pii_customer.full_name end, updated_at = now();
          end if;
        end if;
      elsif v_customer_name is not null then
        insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
        values (p_shop_id, v_customer_name, v_channel_id) returning id into v_customer_id;
        insert into analytics.pii_customer (customer_id, shop_id, full_name) values (v_customer_id, p_shop_id, v_customer_name);
      else
        v_customer_id := null;
      end if;
      select ga.province_code into v_province_code from analytics.dim_geo_alias ga where ga.alias_raw = trim(coalesce(v_row.province_raw, ''));
      v_province_code := coalesce(v_province_code, 'TH-XX');
      if v_row.tags_raw is null or trim(v_row.tags_raw) = '' then v_tags := null;
      else select array_agg(trim(t)) into v_tags from unnest(string_to_array(v_row.tags_raw, ',')) as t where trim(t) <> ''; end if;
      if v_customer_id is not null then
        select not exists (select 1 from analytics.fact_order fo where fo.customer_id = v_customer_id and fo.shop_id = p_shop_id and fo.order_date < v_order_date) into v_is_new_customer;
      else v_is_new_customer := null; end if;
      insert into analytics.fact_order (
        shop_id, source_order_no, customer_id, channel_id, order_date, paid_at, printed_at,
        province_code, carrier_code, tracking_no, item_count, revenue, discount,
        shipping_fee_customer, shipping_cost_shop, profit, profit_status, bank, tags, is_new_customer, discount_code
      ) values (
        p_shop_id, v_row.source_order_no, v_customer_id, v_channel_id, v_order_date, v_row.paid_at, v_row.printed_at,
        v_province_code, analytics.import_text_or_null(v_row.carrier_raw), analytics.import_text_or_null(v_row.tracking_no), v_row.item_count_total, coalesce(v_row.revenue, 0), coalesce(v_row.discount_total, 0),
        v_row.shipping_fee_customer, v_row.shipping_cost_shop, round(coalesce(v_row.revenue, 0) * 0.20, 2), 'estimated', analytics.import_text_or_null(v_row.bank_raw), v_tags, v_is_new_customer, v_discount_code
      )
      on conflict (shop_id, source_order_no) do update set
        customer_id = coalesce(excluded.customer_id, analytics.fact_order.customer_id), channel_id = excluded.channel_id, order_date = excluded.order_date,
        paid_at = coalesce(excluded.paid_at, analytics.fact_order.paid_at), printed_at = coalesce(excluded.printed_at, analytics.fact_order.printed_at),
        province_code = case when excluded.province_code = 'TH-XX' then analytics.fact_order.province_code else excluded.province_code end,
        carrier_code = coalesce(excluded.carrier_code, analytics.fact_order.carrier_code), tracking_no = coalesce(excluded.tracking_no, analytics.fact_order.tracking_no), item_count = coalesce(excluded.item_count, analytics.fact_order.item_count),
        revenue = excluded.revenue, discount = excluded.discount,
        shipping_fee_customer = coalesce(excluded.shipping_fee_customer, analytics.fact_order.shipping_fee_customer),
        shipping_cost_shop = coalesce(excluded.shipping_cost_shop, analytics.fact_order.shipping_cost_shop),
        profit_status = (case when analytics.fact_order.profit_status = 'actual' then 'actual' else 'estimated' end)::analytics.profit_status_t,
        profit = case when analytics.fact_order.profit_status = 'actual' then round(excluded.revenue - analytics.fact_order.cogs, 2) else round(excluded.revenue * 0.10, 2) end,
        cogs = analytics.fact_order.cogs,
        bank = coalesce(excluded.bank, analytics.fact_order.bank), tags = coalesce(excluded.tags, analytics.fact_order.tags), discount_code = coalesce(excluded.discount_code, analytics.fact_order.discount_code), updated_at = now()
      returning id into v_fact_order_id;
      update analytics.stg_order_import set fact_order_id = v_fact_order_id, import_status = 'transformed', error_detail = null, error_code = null where id = v_row.id;
      v_transformed := v_transformed + 1;
    exception when others then
      update analytics.stg_order_import set import_status = 'error', error_detail = sqlerrm, error_code = 'exception' where id = v_row.id;
      v_errored := v_errored + 1;
    end;
  end loop;
  perform analytics.recompute_is_new_customer(p_shop_id);
  return query select v_transformed, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_orders(uuid, uuid) to service_role;

create or replace function analytics.import_delete_orders(
  p_shop_id uuid,
  p_batch_id uuid,
  p_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_reason text;
  v_cap int;
  v_file_order_count int;
  v_candidate_count int;
  v_invalid_ids uuid[];
  v_batch_file_name text;
  v_c record;
  v_deleted_ids uuid[] := '{}';
  v_deleted_revenue numeric := 0;
  v_deleted_count int := 0;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_delete_orders: p_shop_id and p_batch_id are required';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) = 0 then
    raise exception 'import_delete_orders: p_ids must contain at least one id';
  end if;
  if array_length(p_ids, 1) > 200 then
    raise exception 'import_delete_orders: cannot delete more than 200 orders in one call (got %)', array_length(p_ids, 1);
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'import_delete_orders: reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  select b.file_name into v_batch_file_name from analytics.stg_import_batch b where b.id = p_batch_id;

  select count(*), max(file_order_count)
    into v_candidate_count, v_file_order_count
    from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id);

  v_cap := greatest(20, ceil(coalesce(v_file_order_count, 0) * 0.15));
  if v_candidate_count > v_cap then
    raise exception 'import_delete_orders: % candidates exceeds the safety cap of % for this batch (file_order_count=%) — investigate before bulk-deleting, nothing was deleted',
      v_candidate_count, v_cap, v_file_order_count;
  end if;

  select array_agg(x) into v_invalid_ids
    from unnest(p_ids) as x
    where x not in (select fact_order_id from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id));
  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'import_delete_orders: % of the requested id(s) are not in the current candidate set (e.g. %) — refusing the whole request, nothing was deleted',
      array_length(v_invalid_ids, 1), v_invalid_ids[1];
  end if;

  perform 1 from analytics.fact_order where id = any (p_ids) and shop_id = p_shop_id for update;

  for v_c in
    select * from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id) c
    where c.fact_order_id = any (p_ids)
  loop
    insert into analytics.fact_order_deleted (
      shop_id, fact_order_id, source_order_no, channel_id, order_date, revenue, customer_id,
      order_row, item_rows, override_row, stg_order_import_ids, stg_line_links,
      detected_by_batch_id, detected_by_file_name, evidence, reason, deleted_by
    )
    select
      p_shop_id, fo.id, fo.source_order_no, fo.channel_id, fo.order_date, fo.revenue, fo.customer_id,
      to_jsonb(fo),
      coalesce(
        (select jsonb_agg(to_jsonb(foi) order by foi.id) from analytics.fact_order_item foi where foi.fact_order_id = fo.id),
        '[]'::jsonb
      ),
      (select to_jsonb(co) from analytics.crm_order_override co where co.fact_order_id = fo.id),
      coalesce(
        (select array_agg(si.id) from analytics.stg_order_import si where si.shop_id = p_shop_id and si.fact_order_id = fo.id),
        '{}'
      ),
      coalesce(
        (select jsonb_agg(jsonb_build_object('stg_order_line_import_id', sli.id, 'fact_order_item_id', sli.fact_order_item_id))
           from analytics.stg_order_line_import sli
           where sli.shop_id = p_shop_id and sli.source_order_no = fo.source_order_no and sli.fact_order_item_id is not null),
        '[]'::jsonb
      ),
      p_batch_id, v_batch_file_name,
      jsonb_build_object(
        'prefix', v_c.prefix, 'lo', v_c.group_lo, 'hi', v_c.group_hi,
        'date_lo', v_c.group_date_lo, 'date_hi', v_c.group_date_hi,
        'channels', v_c.file_channels, 'file_order_count', v_c.file_order_count,
        'candidate_count', v_candidate_count
      ),
      v_reason, auth.uid()
    from analytics.fact_order fo
    where fo.id = v_c.fact_order_id and fo.shop_id = p_shop_id;

    update analytics.stg_order_import
      set import_status = 'tombstoned'
      where shop_id = p_shop_id and fact_order_id = v_c.fact_order_id;

    update analytics.stg_order_line_import
      set import_status = 'orphan'
      where shop_id = p_shop_id and source_order_no = v_c.source_order_no and fact_order_item_id is not null;

    v_deleted_ids := array_append(v_deleted_ids, v_c.fact_order_id);
    v_deleted_revenue := v_deleted_revenue + coalesce(v_c.revenue, 0);
    v_deleted_count := v_deleted_count + 1;
  end loop;

  delete from analytics.fact_order where id = any (v_deleted_ids) and shop_id = p_shop_id;

  with affected as (
    select distinct fod.customer_id
    from analytics.fact_order_deleted fod
    where fod.fact_order_id = any (v_deleted_ids) and fod.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'deleted_revenue_thb', v_deleted_revenue,
    'deleted_ids', to_jsonb(v_deleted_ids)
  );
end;
$$;

revoke execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) to authenticated, service_role;

create or replace function analytics.import_restore_orders(
  p_shop_id uuid,
  p_deleted_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_del analytics.fact_order_deleted%rowtype;
  v_fo analytics.fact_order%rowtype;
  v_item record;
  v_link record;
  v_resolved_customer_id uuid;
  v_conflict_id uuid;
  v_restored_ids uuid[] := '{}';
  v_restored_revenue numeric := 0;
  v_restored_count int := 0;
  v_id uuid;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null then
    raise exception 'import_restore_orders: p_shop_id is required';
  end if;
  if p_deleted_ids is null or array_length(p_deleted_ids, 1) is null or array_length(p_deleted_ids, 1) = 0 then
    raise exception 'import_restore_orders: p_deleted_ids must contain at least one id';
  end if;
  if array_length(p_deleted_ids, 1) > 200 then
    raise exception 'import_restore_orders: cannot restore more than 200 orders in one call (got %)', array_length(p_deleted_ids, 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  foreach v_id in array p_deleted_ids
  loop
    select * into v_del
      from analytics.fact_order_deleted
      where id = v_id and shop_id = p_shop_id and restored_at is null
      for update;
    if not found then
      raise exception 'import_restore_orders: deleted-order record % not found (already restored, or belongs to another shop) — refusing the whole request, nothing was restored', v_id;
    end if;

    select fo2.id into v_conflict_id
      from analytics.fact_order fo2
      where fo2.shop_id = p_shop_id and fo2.source_order_no = v_del.source_order_no;
    if v_conflict_id is not null then
      raise exception 'import_restore_orders: a live order already exists for source_order_no % (id %) — Shipnity may have reused this number for a new sale; refusing the whole request, nothing was restored',
        v_del.source_order_no, v_conflict_id;
    end if;

    v_resolved_customer_id := null;
    if (v_del.order_row ->> 'customer_id') is not null then
      select coalesce(dc.merged_into_id, dc.id) into v_resolved_customer_id
        from analytics.dim_customer dc
        where dc.id = (v_del.order_row ->> 'customer_id')::uuid;
    end if;

    v_fo := jsonb_populate_record(null::analytics.fact_order, v_del.order_row);
    v_fo.customer_id := v_resolved_customer_id;
    insert into analytics.fact_order select (v_fo).*;

    for v_item in select * from jsonb_array_elements(v_del.item_rows)
    loop
      insert into analytics.fact_order_item
      select (jsonb_populate_record(null::analytics.fact_order_item, v_item.value)).*;
    end loop;

    if v_del.override_row is not null then
      insert into analytics.crm_order_override
      select (jsonb_populate_record(null::analytics.crm_order_override, v_del.override_row)).*;
    end if;

    if v_del.stg_order_import_ids is not null and array_length(v_del.stg_order_import_ids, 1) > 0 then
      update analytics.stg_order_import
        set fact_order_id = v_fo.id, import_status = 'transformed', error_detail = null, error_code = null
        where id = any (v_del.stg_order_import_ids) and shop_id = p_shop_id;
    end if;

    for v_link in select * from jsonb_array_elements(v_del.stg_line_links)
    loop
      update analytics.stg_order_line_import
        set fact_order_item_id = (v_link.value ->> 'fact_order_item_id')::uuid,
            import_status = 'transformed', error_detail = null
        where id = (v_link.value ->> 'stg_order_line_import_id')::uuid and shop_id = p_shop_id;
    end loop;

    update analytics.fact_order_deleted
      set restored_at = now(), restored_by = auth.uid()
      where id = v_del.id;

    v_restored_ids := array_append(v_restored_ids, v_fo.id);
    v_restored_revenue := v_restored_revenue + coalesce(v_fo.revenue, 0);
    v_restored_count := v_restored_count + 1;
  end loop;

  with affected as (
    select distinct fo3.customer_id
    from analytics.fact_order fo3
    where fo3.id = any (v_restored_ids) and fo3.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'restored_count', v_restored_count,
    'restored_revenue_thb', v_restored_revenue,
    'restored_ids', to_jsonb(v_restored_ids)
  );
end;
$$;

revoke execute on function analytics.import_restore_orders(uuid, uuid[]) from public, anon, authenticated;
grant execute on function analytics.import_restore_orders(uuid, uuid[]) to authenticated, service_role;

-- ============================================================================
-- STEP 1: single do-block — fixtures, every required assertion, forced
-- rollback. See scripts/verify-0111-upsert-rules.sql for the pattern this
-- follows (T0/T8 golden-snapshot pairing, per-case OK/FAIL log lines,
-- unconditional raise at the end).
-- ============================================================================

do $verify$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_tag text := 'VERIFY-0115-' || replace(gen_random_uuid()::text, '-', '');
  v_log text := E'\n=== verify-0115 missing-orders/delete/restore rehearsal ===\n';
  v_fail_count int := 0;

  v_chan_a_id uuid; v_chan_a_alias text;
  v_chan_b_id uuid; v_chan_b_alias text;

  v_t0_count bigint; v_t0_revenue numeric; v_t0_discount numeric; v_t0_cogs numeric; v_t0_profit numeric; v_t0_items bigint;
  v_t8_count bigint; v_t8_revenue numeric; v_t8_discount numeric; v_t8_cogs numeric; v_t8_profit numeric; v_t8_items bigint;

  v_batch_old uuid; v_batch_main uuid; v_batch_error uuid; v_batch_wrongsrc uuid;
  v_batch_newer uuid; v_batch_notdone uuid; v_batch_cap uuid;

  v_stg_old_id uuid; -- ZZ150's staging row (batch_old) — reused by re-transform test

  v_id_zz150 uuid; v_id_zz155 uuid; v_id_zz160 uuid; v_id_zz165 uuid; v_id_zz170 uuid;
  v_id_zz050 uuid; v_id_zz250 uuid; v_id_zz190 uuid;
  v_item_id uuid;

  v_other_shop_id uuid;

  v_candidates_result uuid[];
  v_missing_json jsonb;
  v_delete_result jsonb;
  v_restore_result jsonb;

  v_before_ts timestamptz;
  v_new_cust_count int;

  v_revenue_before numeric; v_revenue_after numeric;
  v_dash_before jsonb; v_dash_after jsonb;

  v_row analytics.fact_order%rowtype;
  v_fake_phone text := '0891234567';
begin
  -- run as service_role, matching how the app actually calls these RPCs.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select dca.channel_id, dca.alias_raw into v_chan_a_id, v_chan_a_alias
    from analytics.dim_channel_alias dca limit 1;
  select dca.channel_id, dca.alias_raw into v_chan_b_id, v_chan_b_alias
    from analytics.dim_channel_alias dca where dca.channel_id <> v_chan_a_id limit 1;

  if v_chan_a_id is null or v_chan_b_id is null then
    raise exception 'verify-0115: need at least 2 distinct dim_channel_alias rows for fixtures -- environment problem, not a 0113/0114/0115 bug. Stop and check seed data.';
  end if;

  -- ==========================================================================
  -- STEP 1: T0 golden snapshot (whole shop, BEFORE any fixture exists).
  -- ==========================================================================
  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_t0_count, v_t0_revenue, v_t0_discount, v_t0_cogs, v_t0_profit
    from analytics.fact_order where shop_id = v_shop_id;
  select count(*) into v_t0_items from analytics.fact_order_item where shop_id = v_shop_id;
  v_log := v_log || format(E'T0 golden: count=%s revenue=%s items=%s\n', v_t0_count, v_t0_revenue, v_t0_items);

  -- ==========================================================================
  -- STEP 2: fixtures.
  -- ==========================================================================

  -- batches
  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-old.xlsx', v_tag || '-old', 'transformed', now() - interval '10 days')
  returning id into v_batch_old;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-main.xlsx', v_tag || '-main', 'transformed', now())
  returning id into v_batch_main;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-err.xlsx', v_tag || '-err', 'transformed', now())
  returning id into v_batch_error;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_line_item_report', v_tag || '-wrongsrc.xlsx', v_tag || '-wrongsrc', 'transformed', now())
  returning id into v_batch_wrongsrc;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-newer.xlsx', v_tag || '-newer', 'transformed', now() + interval '1 hour')
  returning id into v_batch_newer;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-notdone.xlsx', v_tag || '-notdone', 'loaded', now())
  returning id into v_batch_notdone;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-cap.xlsx', v_tag || '-cap', 'transformed', now())
  returning id into v_batch_cap;

  -- batch_main's F: ZZ100/ZZ120/ZZ180/ZZ200, dates 2026-01-10..2026-01-15,
  -- channel = v_chan_a_id -> defines prefix ZZ: lo=100 hi=200 dlo=01-10 dhi=01-15.
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, discount_total, import_status)
  values
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ100', v_chan_a_alias, '2026-01-10 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ120', v_chan_a_alias, '2026-01-11 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ180', v_chan_a_alias, '2026-01-14 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ200', v_chan_a_alias, '2026-01-15 09:00:00+07', 100, 0, 'transformed');
  -- these 4 rows also need a live fact_order row each (their own source_order_no
  -- must exist so C2 excludes them, and so P4 has real rows to parse) --
  -- content doesn't matter beyond satisfying not-null columns.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values
    (v_shop_id, 'ZZ100', v_chan_a_id, '2026-01-10', 100),
    (v_shop_id, 'ZZ120', v_chan_a_id, '2026-01-11', 100),
    (v_shop_id, 'ZZ180', v_chan_a_id, '2026-01-14', 100),
    (v_shop_id, 'ZZ200', v_chan_a_id, '2026-01-15', 100);

  -- G686-analog: ZZ150, mid-range num, date in range, channel in file,
  -- printed_at null -- the ONE order that should show up as a candidate.
  -- Already-transformed via batch_old (simulates "imported before, missing
  -- from today's file"). phone_raw set so the re-transform test below can
  -- prove no dim_customer gets created when a tombstoned row is skipped.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ150', v_chan_a_id, '2026-01-12', 250.00, null)
  returning id into v_id_zz150;

  insert into analytics.fact_order_item (shop_id, fact_order_id, sku_snapshot, product_name_snapshot, qty, unit_price)
  values (v_shop_id, v_id_zz150, v_tag || '-SKU', 'verify fixture item', 1, 250.00)
  returning id into v_item_id;

  insert into analytics.crm_order_override (fact_order_id, shop_id, overrides, reason)
  values (v_id_zz150, v_shop_id, jsonb_build_object('tags', jsonb_build_array('verify-fixture')), v_tag || ' override');

  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, phone_raw, order_created_at, revenue, discount_total, import_status, fact_order_id)
  values (v_batch_old, v_shop_id, '{}'::jsonb, 'excel', 'ZZ150', v_chan_a_alias, v_fake_phone, '2026-01-01 09:00:00+07', 250.00, 0, 'transformed', v_id_zz150)
  returning id into v_stg_old_id;

  insert into analytics.stg_order_line_import (batch_id, shop_id, source_order_no, line_no, sku_raw, product_name_raw, qty, raw, import_status, fact_order_item_id)
  values (v_batch_old, v_shop_id, 'ZZ150', 1, v_tag || '-SKU', 'verify fixture item', 1, '{}'::jsonb, 'transformed', v_item_id);

  -- 8 "must NOT delete" fixtures --------------------------------------------

  -- #1 C4: date outside [dlo,dhi].
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ155', v_chan_a_id, '2025-01-01', 100) returning id into v_id_zz155;

  -- #2 C5: channel not in file's channel set.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ160', v_chan_b_id, '2026-01-12', 100) returning id into v_id_zz160;

  -- #3 C1: different shop entirely (temp shop, created+dropped in this transaction).
  insert into public.shop (name) values (v_tag || ' temp shop') returning id into v_other_shop_id;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_other_shop_id, 'ZZ165', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz165;

  -- #4/#5 P3: batch_error has one 'error' row -> whole batch blocked
  -- (brief cases 4 "batch มี error row" and 5 "แถว error ในไฟล์" are the same
  -- precondition -- one fixture covers both).
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status, error_detail)
  values (v_batch_error, v_shop_id, '{}'::jsonb, 'excel', 'ZZ666', v_chan_a_alias, '2026-02-01 09:00:00+07', 100, 'error', v_tag || ' fixture error row');

  -- #6 P1: batch_wrongsrc has source_type <> excel_order_report entirely.

  -- #7 C7: ZZ170 exists live, but its (only) staging row currently belongs
  -- to batch_newer (imported AFTER batch_main) -- a newer file already
  -- re-confirmed it, so it must not read as "missing" from batch_main.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ170', v_chan_a_id, '2026-01-12', 100, null) returning id into v_id_zz170;
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status, fact_order_id)
  values (v_batch_newer, v_shop_id, '{}'::jsonb, 'excel', 'ZZ170', v_chan_a_alias, '2026-01-16 09:00:00+07', 100, 'transformed', v_id_zz170);

  -- #8 C3 strict: below lo / above hi.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ050', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz050;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ250', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz250;

  -- extra valid candidate reserved for the "invalid id mixed in" test below.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ190', v_chan_a_id, '2026-01-12', 100, null) returning id into v_id_zz190;

  -- cap-test batch: F = ZZ500/ZZ600 (defines lo=500 hi=600), 21 live
  -- "missing" candidates ZZ501..ZZ521 -> candidate_count(21) > cap(20).
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ500', v_chan_a_id, '2026-03-01', 100), (v_shop_id, 'ZZ600', v_chan_a_id, '2026-03-10', 100);
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status)
  values
    (v_batch_cap, v_shop_id, '{}'::jsonb, 'excel', 'ZZ500', v_chan_a_alias, '2026-03-01 09:00:00+07', 100, 'transformed'),
    (v_batch_cap, v_shop_id, '{}'::jsonb, 'excel', 'ZZ600', v_chan_a_alias, '2026-03-10 09:00:00+07', 100, 'transformed');
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  select v_shop_id, 'ZZ' || (500 + g)::text, v_chan_a_id, '2026-03-05'::date, 10
  from generate_series(1, 21) as g;

  -- ==========================================================================
  -- STEP 3: candidates helper — G686-analog must appear, all 8 must not.
  -- ==========================================================================
  select array_agg(fact_order_id) into v_candidates_result
    from analytics.import_missing_orders_candidates(v_shop_id, v_batch_main);

  if v_candidates_result is null or not (v_id_zz150 = any (v_candidates_result)) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL G686-analog: ZZ150 not found in candidates\n';
  else
    v_log := v_log || E'OK   G686-analog: ZZ150 found in candidates\n';
  end if;

  if v_candidates_result is not null and (
       v_id_zz155 = any (v_candidates_result) or v_id_zz160 = any (v_candidates_result)
       or v_id_zz165 = any (v_candidates_result) or v_id_zz170 = any (v_candidates_result)
       or v_id_zz050 = any (v_candidates_result) or v_id_zz250 = any (v_candidates_result)
     ) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL exclusions: one of the 6 fact_order-level must-not-delete fixtures leaked into candidates\n';
  else
    v_log := v_log || E'OK   exclusions: C1/C4/C5/C7/C3(lo)/C3(hi) fixtures all correctly excluded\n';
  end if;

  -- P1 (batch_wrongsrc): must raise blocked/shop_or_source_mismatch.
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_wrongsrc);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P1: wrong source_type batch did not raise\n';
  exception when others then
    if sqlstate = 'P0001' then
      v_log := v_log || E'OK   P1: wrong source_type batch raised as expected\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format(E'FAIL P1: raised but unexpected sqlstate=%s sqlerrm=%s\n', sqlstate, sqlerrm);
    end if;
  end;

  -- P2 (batch_notdone, status='loaded'): must raise.
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_notdone);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P2: not-yet-transformed batch did not raise\n';
  exception when others then
    v_log := v_log || E'OK   P2: not-yet-transformed batch raised as expected\n';
  end;

  -- P3 (batch_error, has one error row): must raise (covers brief cases 4+5).
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_error);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P3: batch with an error row did not raise\n';
  exception when others then
    v_log := v_log || E'OK   P3: batch with an error row raised as expected\n';
  end;

  -- ==========================================================================
  -- STEP 4: import_missing_orders (jsonb wrapper) — ok path + evidence.
  -- ==========================================================================
  select analytics.import_missing_orders(v_shop_id, v_batch_main) into v_missing_json;
  if (v_missing_json ->> 'ok')::boolean is not true then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL import_missing_orders(batch_main): ok=false, blocked_reason=%s\n', v_missing_json ->> 'blocked_reason');
  elsif (v_missing_json ->> 'candidate_count')::int <> 1 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL import_missing_orders(batch_main): candidate_count=%s, want 1\n', v_missing_json ->> 'candidate_count');
  else
    v_log := v_log || E'OK   import_missing_orders(batch_main): ok=true, candidate_count=1 (ZZ150 only)\n';
  end if;

  -- cap test: batch_cap must be blocked with too_many but STILL return the
  -- 21 candidates (brief: "cap too_many (blocked แต่ยังคืน candidates)").
  select analytics.import_missing_orders(v_shop_id, v_batch_cap) into v_missing_json;
  if (v_missing_json ->> 'ok')::boolean is not false or v_missing_json ->> 'blocked_reason' is distinct from 'too_many' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL cap: expected ok=false blocked_reason=too_many, got ok=%s blocked_reason=%s\n', v_missing_json ->> 'ok', v_missing_json ->> 'blocked_reason');
  elsif jsonb_array_length(v_missing_json -> 'candidates') <> 21 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL cap: expected 21 candidates still returned despite block, got %s\n', jsonb_array_length(v_missing_json -> 'candidates'));
  else
    v_log := v_log || E'OK   cap: batch_cap blocked with too_many, still returned all 21 candidates\n';
  end if;

  -- ==========================================================================
  -- STEP 5: delete-with-invalid-id — must raise, must delete NOTHING.
  -- ==========================================================================
  select coalesce(sum(revenue), 0) into v_revenue_before from analytics.fact_order where shop_id = v_shop_id;
  begin
    perform analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz190, gen_random_uuid()], v_tag || ' invalid-id test');
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL invalid-id: call with a bogus id mixed in did not raise\n';
  exception when others then
    v_log := v_log || E'OK   invalid-id: call with a bogus id mixed in raised as expected\n';
  end;
  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if v_revenue_before is distinct from v_revenue_after then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL invalid-id: revenue moved (%s -> %s) -- a partial delete happened, "raise ทั้งก้อน" was violated\n', v_revenue_before, v_revenue_after);
  else
    v_log := v_log || E'OK   invalid-id: revenue unchanged, nothing was deleted (all-or-nothing held)\n';
  end if;
  if exists (select 1 from analytics.fact_order where id = v_id_zz190 and shop_id = v_shop_id) then
    v_log := v_log || E'OK   invalid-id: ZZ190 (the one valid id in the mixed call) is still live\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL invalid-id: ZZ190 got deleted despite the whole call being expected to abort\n';
  end if;

  -- ==========================================================================
  -- STEP 6: real delete of ZZ150 -- snapshot correctness + side effects.
  -- ==========================================================================
  select coalesce(sum(revenue), 0) into v_revenue_before from analytics.fact_order where shop_id = v_shop_id;
  select analytics.dashboard_summary(v_shop_id, '2000-01-01'::date, '2035-12-31'::date, null, true) into v_dash_before;

  select analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz150], v_tag || ' delete test') into v_delete_result;

  if (v_delete_result ->> 'deleted_count')::int <> 1 or (v_delete_result ->> 'deleted_revenue_thb')::numeric is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: deleted_count=%s deleted_revenue_thb=%s (want 1 / 250.00)\n', v_delete_result ->> 'deleted_count', v_delete_result ->> 'deleted_revenue_thb');
  else
    v_log := v_log || E'OK   delete: deleted_count=1, deleted_revenue_thb=250.00\n';
  end if;

  if exists (select 1 from analytics.fact_order where id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: fact_order row for ZZ150 still exists\n';
  else v_log := v_log || E'OK   delete: fact_order row for ZZ150 is gone\n'; end if;

  if exists (select 1 from analytics.fact_order_item where fact_order_id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: fact_order_item for ZZ150 still exists (cascade did not fire)\n';
  else v_log := v_log || E'OK   delete: fact_order_item for ZZ150 cascaded away\n'; end if;

  if exists (select 1 from analytics.stg_order_import where id = v_stg_old_id and import_status = 'tombstoned') then
    v_log := v_log || E'OK   delete: stg_order_import row for ZZ150 marked tombstoned\n';
  else
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: stg_order_import row for ZZ150 is not tombstoned\n';
  end if;

  if not exists (select 1 from analytics.fact_order_deleted where fact_order_id = v_id_zz150 and restored_at is null) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: no active fact_order_deleted row for ZZ150\n';
  else
    v_log := v_log || E'OK   delete: fact_order_deleted row created for ZZ150\n';
  end if;

  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if (v_revenue_before - v_revenue_after) is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: sum(revenue) dropped by %s, want 250.00\n', v_revenue_before - v_revenue_after);
  else
    v_log := v_log || E'OK   delete: sum(revenue) dropped by exactly the deleted amount\n';
  end if;

  select analytics.dashboard_summary(v_shop_id, '2000-01-01'::date, '2035-12-31'::date, null, true) into v_dash_after;
  if ((v_dash_before -> 'kpi' ->> 'revenue')::numeric - (v_dash_after -> 'kpi' ->> 'revenue')::numeric) is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: dashboard_summary revenue dropped by %s, want 250.00\n',
      (v_dash_before -> 'kpi' ->> 'revenue')::numeric - (v_dash_after -> 'kpi' ->> 'revenue')::numeric);
  else
    v_log := v_log || E'OK   delete: dashboard_summary kpi.revenue dropped by exactly the deleted amount\n';
  end if;

  -- ==========================================================================
  -- STEP 7: re-import (re-transform) the tombstoned row -> must NOT resurrect.
  -- ==========================================================================
  update analytics.stg_order_import set import_status = 'pending' where id = v_stg_old_id;
  v_before_ts := clock_timestamp();
  perform analytics.transform_pending_orders(v_shop_id, v_batch_old);

  select * into v_row from analytics.stg_order_import where id = v_stg_old_id;
  if v_row.import_status is distinct from 'tombstoned' or v_row.fact_order_id is not null then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL re-transform: stg row ended status=%s fact_order_id=%s (want tombstoned / null)\n', v_row.import_status, v_row.fact_order_id);
  else
    v_log := v_log || E'OK   re-transform: re-imported row landed back on tombstoned, fact_order_id stayed null\n';
  end if;

  if exists (select 1 from analytics.fact_order where shop_id = v_shop_id and source_order_no = 'ZZ150') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL re-transform: a NEW fact_order for ZZ150 was created -- tombstone did not block resurrection\n';
  else
    v_log := v_log || E'OK   re-transform: no fact_order was resurrected for ZZ150\n';
  end if;

  select count(*) into v_new_cust_count from analytics.dim_customer where shop_id = v_shop_id and created_at > v_before_ts;
  if v_new_cust_count > 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL re-transform: %s new dim_customer row(s) created from the tombstoned row''s phone_raw -- the guard did not short-circuit before customer resolution\n', v_new_cust_count);
  else
    v_log := v_log || E'OK   re-transform: no dim_customer created (tombstone check ran before customer resolution)\n';
  end if;

  -- ==========================================================================
  -- STEP 8: restore -- id/items/links/revenue all come back.
  -- ==========================================================================
  select analytics.import_restore_orders(v_shop_id, array[(select id from analytics.fact_order_deleted where fact_order_id = v_id_zz150 and restored_at is null)])
    into v_restore_result;

  if (v_restore_result ->> 'restored_count')::int <> 1 or (v_restore_result ->> 'restored_revenue_thb')::numeric is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL restore: restored_count=%s restored_revenue_thb=%s (want 1 / 250.00)\n', v_restore_result ->> 'restored_count', v_restore_result ->> 'restored_revenue_thb');
  else
    v_log := v_log || E'OK   restore: restored_count=1, restored_revenue_thb=250.00\n';
  end if;

  if not exists (select 1 from analytics.fact_order where id = v_id_zz150 and shop_id = v_shop_id and revenue = 250.00) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL restore: fact_order row for ZZ150 not back with original id/revenue\n';
  else
    v_log := v_log || E'OK   restore: fact_order row for ZZ150 back with original id + revenue\n';
  end if;

  if not exists (select 1 from analytics.fact_order_item where fact_order_id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: fact_order_item did not come back\n';
  else v_log := v_log || E'OK   restore: fact_order_item came back\n'; end if;

  if not exists (select 1 from analytics.stg_order_import where id = v_stg_old_id and fact_order_id = v_id_zz150 and import_status = 'transformed') then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: stg_order_import link/status not restored\n';
  else v_log := v_log || E'OK   restore: stg_order_import link + status restored\n'; end if;

  if not exists (
    select 1 from analytics.stg_order_line_import
    where shop_id = v_shop_id and source_order_no = 'ZZ150' and import_status = 'transformed' and fact_order_item_id is not null
  ) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: stg_order_line_import link/status not restored\n';
  else v_log := v_log || E'OK   restore: stg_order_line_import link + status restored\n'; end if;

  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if v_revenue_after is distinct from v_revenue_before then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL restore: sum(revenue)=%s, want back to pre-delete %s\n', v_revenue_after, v_revenue_before);
  else
    v_log := v_log || E'OK   restore: sum(revenue) back to exactly the pre-delete amount\n';
  end if;

  -- ==========================================================================
  -- STEP 9: cleanup every fixture this script created, then re-snapshot.
  -- ==========================================================================
  delete from analytics.crm_order_override where fact_order_id = v_id_zz150;
  delete from analytics.fact_order_item where shop_id = v_shop_id and sku_snapshot = v_tag || '-SKU';
  delete from analytics.fact_order where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.fact_order where shop_id = v_other_shop_id;
  delete from analytics.stg_order_line_import where shop_id = v_shop_id and source_order_no = 'ZZ150';
  delete from analytics.stg_order_import where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.fact_order_deleted where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.stg_import_batch where id in (v_batch_old, v_batch_main, v_batch_error, v_batch_wrongsrc, v_batch_newer, v_batch_notdone, v_batch_cap);
  delete from public.shop where id = v_other_shop_id;

  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_t8_count, v_t8_revenue, v_t8_discount, v_t8_cogs, v_t8_profit
    from analytics.fact_order where shop_id = v_shop_id;
  select count(*) into v_t8_items from analytics.fact_order_item where shop_id = v_shop_id;

  v_log := v_log || format(E'T8 post-cleanup: count=%s revenue=%s items=%s\n', v_t8_count, v_t8_revenue, v_t8_items);

  if v_t8_count <> v_t0_count or v_t8_revenue is distinct from v_t0_revenue
     or v_t8_discount is distinct from v_t0_discount or v_t8_cogs is distinct from v_t0_cogs
     or v_t8_profit is distinct from v_t0_profit or v_t8_items <> v_t0_items then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T8: post-cleanup snapshot does NOT match T0 (count %s->%s revenue %s->%s items %s->%s) -- a fixture leaked or an unrelated real order was touched. STOP -- do not ship.\n',
      v_t0_count, v_t8_count, v_t0_revenue, v_t8_revenue, v_t0_items, v_t8_items);
  else
    v_log := v_log || E'OK   T8: post-cleanup snapshot matches T0 exactly (count/revenue/discount/cogs/profit/items) -- no fixture leaked\n';
  end if;

  if exists (select 1 from analytics.fact_order where shop_id = v_shop_id and source_order_no like 'ZZ%') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: a ZZ-prefixed fixture order leaked\n';
  end if;
  if exists (select 1 from analytics.fact_order_item where shop_id = v_shop_id and sku_snapshot = v_tag || '-SKU') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: a fixture fact_order_item leaked\n';
  end if;
  if exists (select 1 from public.shop where id = v_other_shop_id) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: temp shop was not cleaned up\n';
  end if;

  -- ==========================================================================
  -- forced rollback.
  -- ==========================================================================
  if v_fail_count > 0 then
    v_log := v_log || format(E'\n=== %s CHECK(S) FAILED -- 0113/0114/0115 are NOT safe to ship as-is ===\n', v_fail_count);
  else
    v_log := v_log || E'\n=== ALL CHECKS PASSED -- safe to apply 0113/0114/0115 for real (apply_migration) ===\n';
  end if;

  raise exception '%', v_log;
end;
$verify$;

rollback;
