-- 0040_auto_attribution.sql
-- Auto-attribution from the Excel order-report discount-code column (col R,
-- "รหัสส่วนลด" — parsed by lib/import/order-report.ts into
-- stg_order_import.discount_code, 0011:73, already wired, not touched here).
-- Design: docs/3j-jewelry/analytics/phase-auto-attribution-design.md
--
-- This is a SEPARATE data source from 0036's manual promo_attribution log:
--   auto   = code the platform recorded in the order file (marketplace voucher)
--   manual = code the buyer typed in LINE chat (never appears in the file —
--            the original reason 0036 exists)
-- Never merge/sum auto + manual into one number (design §D4) — the app layer
-- shows them as two tables plus an overlap warning, not a combined total.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via
-- MCP after diffing part 2 (transform_pending_orders) against 0026: every
-- line must be byte-identical except the 4 points marked "-- 0040:" below.

-- ============================================================================
-- 1. fact_order.discount_code (design §D1) — nullable, no default. Orders
--    with no promo (the overwhelming majority, incl. every OMS-sourced row)
--    are null by nature, not a missing-data gap.
-- ============================================================================

alter table analytics.fact_order add column discount_code text;

-- ============================================================================
-- 2. transform_pending_orders — copy of 0026's body, byte-identical except
--    the 4 points below (design §3 item 2):
--      (a) declare v_discount_code text;
--      (b) compute it (same normalize rule as the backfill in part 3 below:
--          "-" / "" / whitespace-only -> null, case preserved)
--      (c) carry it into the fact_order insert's column list + values
--      (d) carry it into the upsert's on-conflict do-update set (the easiest
--          point to miss — without it, re-importing a file never updates an
--          already-transformed order's code)
--    Everything else (channel-alias lookup, TikTok-uid customer dedup, phone
--    dedup, profit-estimate placeholder, error handling) is unchanged from
--    0026 and must stay that way.
-- ============================================================================

create or replace function analytics.transform_pending_orders(p_shop_id uuid, p_batch_id uuid)
 returns table(transformed_count integer, errored_count integer)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_import%rowtype;
  v_channel_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_phone_norm text;
  v_phone_hash text;
  v_profile_source text;
  v_tiktok_uid text;
  v_province_code text;
  v_order_date date;
  v_discount_code text; -- 0040: point (a)
  v_tags text[];
  v_fact_order_id uuid;
  v_is_new_customer boolean;
  v_transformed int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_orders: p_shop_id and p_batch_id are required';
  end if;

  for v_row in
    select *
    from analytics.stg_order_import
    where shop_id = p_shop_id
      and batch_id = p_batch_id
      and source_kind = 'excel'
      and import_status in ('pending', 'error')
    order by source_row_no
  loop
    begin
      v_channel_id := null;
      v_customer_id := null;
      v_phone_norm := null;
      v_phone_hash := null;
      v_profile_source := null;

      select dca.channel_id into v_channel_id
        from analytics.dim_channel_alias dca
        where lower(dca.alias_raw) = lower(trim(coalesce(v_row.channel_raw, '')));

      if v_channel_id is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'no dim_channel_alias match for channel_raw: ' || coalesce(v_row.channel_raw, '<null>'),
              error_code = 'channel_alias_missing'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;

      if v_row.order_created_at is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'order_created_at is null, cannot derive order_date',
              error_code = 'order_date_missing'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      v_order_date := v_row.order_created_at::date;
      v_discount_code := nullif(nullif(btrim(coalesce(v_row.discount_code, '')), ''), '-'); -- 0040: point (b)

      v_phone_norm := analytics.normalize_th_phone(v_row.phone_raw);
      v_customer_name := nullif(trim(coalesce(v_row.customer_name_raw, '')), '');
      v_tiktok_uid := nullif(trim(coalesce(v_row.contact_display_name_raw, '')), '');
      if v_tiktok_uid is null or v_tiktok_uid !~ '^[0-9]{15,}$' then
        v_tiktok_uid := null;
      end if;

      if v_phone_norm is not null then
        -- dedup by real phone (LINE etc.)
        v_phone_hash := encode(digest(v_phone_norm, 'sha256'), 'hex');
        insert into analytics.dim_customer (shop_id, display_name, primary_phone_hash, first_touch_channel_id)
        values (p_shop_id, v_row.customer_name_raw, v_phone_hash, v_channel_id)
        on conflict (shop_id, primary_phone_hash) where primary_phone_hash is not null and merged_into_id is null
        do update set
          display_name = case when analytics.dim_customer.profile_source = 'import'
            then coalesce(excluded.display_name, analytics.dim_customer.display_name)
            else analytics.dim_customer.display_name end,
          updated_at = now()
        returning id, profile_source into v_customer_id, v_profile_source;

        insert into analytics.dim_customer_identity (shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence)
        values (p_shop_id, v_customer_id, 'phone', v_phone_norm, v_phone_hash, 'exact')
        on conflict (shop_id, identity_type, identity_value_norm)
        do update set customer_id = excluded.customer_id, updated_at = now();

        insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name)
        values (v_customer_id, p_shop_id, v_phone_norm, v_row.customer_name_raw)
        on conflict (customer_id)
        do update set
          phone_e164 = excluded.phone_e164,
          full_name = case when v_profile_source = 'import'
            then coalesce(excluded.full_name, analytics.pii_customer.full_name)
            else analytics.pii_customer.full_name end,
          updated_at = now();
      elsif v_tiktok_uid is not null then
        -- dedup by TikTok account id (masked phone -> this is the stable key)
        select ci.customer_id, dc.profile_source into v_customer_id, v_profile_source
          from analytics.dim_customer_identity ci
          join analytics.dim_customer dc on dc.id = ci.customer_id and dc.merged_into_id is null
          where ci.shop_id = p_shop_id
            and ci.identity_type = 'tiktok_handle'
            and ci.identity_value_norm = v_tiktok_uid
          limit 1;

        if v_customer_id is null then
          insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
          values (p_shop_id, v_customer_name, v_channel_id)
          returning id into v_customer_id;

          insert into analytics.dim_customer_identity (shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence)
          values (p_shop_id, v_customer_id, 'tiktok_handle', v_tiktok_uid, encode(digest(v_tiktok_uid, 'sha256'), 'hex'), 'exact')
          on conflict (shop_id, identity_type, identity_value_norm)
          do update set customer_id = excluded.customer_id, updated_at = now();

          if v_customer_name is not null then
            insert into analytics.pii_customer (customer_id, shop_id, full_name)
            values (v_customer_id, p_shop_id, v_customer_name)
            on conflict (customer_id) do nothing;
          end if;
        else
          -- reuse existing customer; only import-owned profiles get refreshed
          update analytics.dim_customer
            set display_name = case when profile_source = 'import'
              then coalesce(v_customer_name, display_name) else display_name end,
                updated_at = now()
            where id = v_customer_id;

          if v_customer_name is not null then
            insert into analytics.pii_customer (customer_id, shop_id, full_name)
            values (v_customer_id, p_shop_id, v_customer_name)
            on conflict (customer_id) do update set
              full_name = case when v_profile_source = 'import'
                then coalesce(excluded.full_name, analytics.pii_customer.full_name)
                else analytics.pii_customer.full_name end,
              updated_at = now();
          end if;
        end if;
      elsif v_customer_name is not null then
        -- no phone, no uid: name-only, always a new customer (unchanged)
        insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
        values (p_shop_id, v_customer_name, v_channel_id)
        returning id into v_customer_id;
        insert into analytics.pii_customer (customer_id, shop_id, full_name)
        values (v_customer_id, p_shop_id, v_customer_name);
      else
        v_customer_id := null;
      end if;

      select ga.province_code into v_province_code
        from analytics.dim_geo_alias ga
        where ga.alias_raw = trim(coalesce(v_row.province_raw, ''));
      v_province_code := coalesce(v_province_code, 'TH-XX');

      if v_row.tags_raw is null or trim(v_row.tags_raw) = '' then
        v_tags := null;
      else
        select array_agg(trim(t)) into v_tags
          from unnest(string_to_array(v_row.tags_raw, ',')) as t where trim(t) <> '';
      end if;

      if v_customer_id is not null then
        select not exists (select 1 from analytics.fact_order fo
          where fo.customer_id = v_customer_id and fo.shop_id = p_shop_id and fo.order_date < v_order_date)
          into v_is_new_customer;
      else
        v_is_new_customer := null;
      end if;

      insert into analytics.fact_order (
        shop_id, source_order_no, customer_id, channel_id, order_date, paid_at, printed_at,
        province_code, carrier_code, tracking_no, item_count, revenue, discount,
        shipping_fee_customer, shipping_cost_shop, profit, profit_status, bank, tags, is_new_customer, discount_code
      ) values (
        p_shop_id, v_row.source_order_no, v_customer_id, v_channel_id, v_order_date, v_row.paid_at, v_row.printed_at,
        v_province_code, v_row.carrier_raw, v_row.tracking_no, v_row.item_count_total, coalesce(v_row.revenue, 0), coalesce(v_row.discount_total, 0),
        v_row.shipping_fee_customer, v_row.shipping_cost_shop, round(coalesce(v_row.revenue, 0) * 0.20, 2), 'estimated', v_row.bank_raw, v_tags, v_is_new_customer, v_discount_code
      ) -- 0040: point (c) — discount_code appended to column list + values
      on conflict (shop_id, source_order_no) do update set
        customer_id = excluded.customer_id, channel_id = excluded.channel_id, order_date = excluded.order_date,
        paid_at = excluded.paid_at, printed_at = excluded.printed_at, province_code = excluded.province_code,
        carrier_code = excluded.carrier_code, tracking_no = excluded.tracking_no, item_count = excluded.item_count,
        revenue = excluded.revenue, discount = excluded.discount, shipping_fee_customer = excluded.shipping_fee_customer,
        shipping_cost_shop = excluded.shipping_cost_shop, profit = excluded.profit, profit_status = excluded.profit_status,
        bank = excluded.bank, tags = excluded.tags, discount_code = excluded.discount_code, updated_at = now()
      -- 0040: point (d) — discount_code = excluded.discount_code (re-import must refresh the code)
      returning id into v_fact_order_id;

      update analytics.stg_order_import
        set fact_order_id = v_fact_order_id, import_status = 'transformed', error_detail = null, error_code = null
        where id = v_row.id;
      v_transformed := v_transformed + 1;
    exception
      when others then
        update analytics.stg_order_import
          set import_status = 'error', error_detail = sqlerrm, error_code = 'exception'
          where id = v_row.id;
        v_errored := v_errored + 1;
    end;
  end loop;

  return query select v_transformed, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_orders(uuid,uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_orders(uuid,uuid) to service_role;

-- ============================================================================
-- 3. Backfill (design §D2) — best-effort, idempotent (only touches rows still
--    null so re-running this migration file is a no-op the second time).
--    staging has unique (shop_id, dedup_key) (0011:101) -> 1 excel order = 1
--    staging row -> the s.fact_order_id join is already 1:1, no DISTINCT ON
--    needed (indexed: idx_stg_order_import_fact_order_id).
--    Real August data has "-" in every row -> this backfill is expected to
--    update 0 rows there (see design §6 verify query).
-- ============================================================================

update analytics.fact_order fo
set discount_code = nullif(nullif(btrim(coalesce(s.discount_code, '')), ''), '-')
from analytics.stg_order_import s
where s.fact_order_id = fo.id
  and s.source_kind = 'excel'
  and fo.discount_code is null;

-- ============================================================================
-- 4. v_promo_attribution_auto (design §D3/§4) — grain (shop_id, code).
--    security_invoker: relies on fact_order's tenant RLS (0012:89), same
--    pattern as every other view in this family (incl. 0036's summary view).
-- ============================================================================

create or replace view analytics.v_promo_attribution_auto
  with (security_invoker = true) as
with per_channel as (
  select fo.shop_id, fo.discount_code as code, fo.channel_id,
         ch.name as channel_name,
         count(*) as orders, sum(fo.revenue) as revenue,
         min(fo.order_date) as first_on, max(fo.order_date) as last_on
  from analytics.fact_order fo
  left join analytics.dim_channel ch on ch.id = fo.channel_id
  where fo.discount_code is not null
  group by fo.shop_id, fo.discount_code, fo.channel_id, ch.name
)
select shop_id, code,
       sum(orders)::int as orders,
       sum(revenue)     as total_revenue,
       round(sum(revenue) / nullif(sum(orders), 0), 2) as avg_revenue,
       min(first_on)    as first_on,
       max(last_on)     as last_on,
       jsonb_agg(jsonb_build_object(
         'channel_name', coalesce(channel_name, 'ไม่ระบุ'),
         'orders', orders, 'revenue', revenue)
         order by revenue desc) as channel_breakdown
from per_channel
group by shop_id, code;

-- ============================================================================
-- 5. Grants — 0036's `grant select on all tables in schema analytics` was a
--    one-shot at that migration's time and does not cover a view created
--    later, so this view needs its own grant.
-- ============================================================================

grant select on analytics.v_promo_attribution_auto to authenticated, service_role;

notify pgrst, 'reload schema';
