-- scripts/verify-0111-upsert-rules.sql
-- Rehearsal + proof for supabase/migrations/0111_import_upsert_no_blank_overwrite.sql
-- BEFORE Tech Lead applies it for real via apply_migration.
--
-- Per 3j-migration-traps #11: this rewrites the upsert path of
-- analytics.fact_order, the same table that carries revenue/discount/cogs/
-- profit for every real order in the shop. So the whole rehearsal — DDL
-- replace included — runs inside one explicit transaction that a single
-- `raise exception` inside one `do $$ ... $$` block unconditionally aborts
-- at the end. Nothing here is meant to survive: not the function replaces,
-- not the grants, not the backfill, not any of the fixture rows the test
-- cases insert. If every check passes, the log printed by the raised
-- exception is the evidence Tech Lead needs to then apply 0111 for real.
--
-- Why the DDL (step 2) sits OUTSIDE the do block, same reasoning as
-- verify-0109.sql: `create or replace function` is DDL and cannot appear as
-- a direct statement inside PL/pgSQL. The DDL below must stay byte-identical
-- to supabase/migrations/0111_import_upsert_no_blank_overwrite.sql — if you
-- edit the migration, copy the change here too or this rehearsal stops
-- proving what actually ships. (The backfill UPDATE at the migration's tail
-- is deliberately NOT replayed here — this file has nothing to backfill
-- against beyond its own fixtures, and re-running it against real data
-- inside a script meant to be run repeatedly during review would just be
-- redundant work inside a transaction that's rolled back anyway.)
--
-- shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7' (3J Jewelry — the only
-- shop_id used anywhere in this project, confirmed via
-- docs/3j-jewelry/wholesale-not-in-system.md's "retail 100%" finding).
--
-- Fixture strategy: every test order uses source_order_no
-- 'VERIFY-0111-<tag>-<random uuid>' so it can never collide with a real
-- order (dedup_key uniqueness is shop-wide, not per-batch — see
-- 0011_analytics_staging.sql's uq_stg_order_import_shop_dedup_key). "Already
-- has real data" states (T1/T2/T3/T4/T5/T7) are seeded with a direct INSERT
-- into fact_order — bypassing the function under test on purpose, since
-- that's how a row that was ALREADY correctly enriched (e.g. by label
-- upload, 0097/0098) looks before a second import file touches it. Every
-- fixture leaves customer identity fields blank (no phone_raw/
-- customer_name_raw/contact_display_name_raw), so the function's customer-
-- matching branches never fire and nothing needs cleaning up in
-- dim_customer / dim_customer_identity / pii_customer.

begin;

-- ============================================================================
-- STEP 2: apply the 0111 DDL (rehearsal only — rolled back at the bottom).
-- Must be byte-identical to supabase/migrations/0111_import_upsert_no_blank_
-- overwrite.sql's two CREATE OR REPLACE FUNCTION statements + their grants.
-- ============================================================================

create or replace function analytics.import_text_or_null(p text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select nullif(nullif(btrim(p), ''), '-')
$$;

revoke execute on function analytics.import_text_or_null(text) from public, anon, authenticated;
grant execute on function analytics.import_text_or_null(text) to service_role;

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
  for v_row in
    select * from analytics.stg_order_import
    where shop_id = p_shop_id and batch_id = p_batch_id and source_kind = 'excel' and import_status in ('pending', 'error')
    order by source_row_no
  loop
    begin
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

-- ============================================================================
-- STEPS 1, 3-8: single do-block. Captures golden state, builds fixtures for
-- every rule in the brief, calls the (now rehearsed) function once, asserts
-- every case, deletes every fixture it created, re-snapshots to prove no
-- drift, and unconditionally raises to force the rollback of this whole
-- transaction — DDL above included.
-- ============================================================================
do $verify$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_run_tag text := 'VERIFY-0111-' || replace(gen_random_uuid()::text, '-', '');
  v_batch_id uuid;
  v_log text := E'\n=== verify-0111 upsert-no-blank-overwrite rehearsal ===\n';
  v_fail_count int := 0;

  -- fixture ingredients, looked up dynamically instead of hardcoded so this
  -- script keeps working if seed data changes.
  v_channel_id uuid;
  v_channel_alias text;
  v_geo_alias_a text; v_province_a text;
  v_geo_alias_b text; v_province_b text;

  -- STEP 1: golden (pre-fixture) snapshot for the whole shop.
  v_t0_count bigint; v_t0_revenue numeric; v_t0_discount numeric; v_t0_cogs numeric; v_t0_profit numeric;

  -- order numbers, one per test case
  v_no_t1 text; v_no_t2 text; v_no_t3 text;
  v_no_t4a text; v_no_t4b text;
  v_no_t5a text; v_no_t5b text;
  v_no_t6 text;
  v_no_t7 text; v_no_t7b text;
  -- T9–T12 added 11 ก.ย. 69 after QA review: the four blank-vs-real cases the
  -- first draft never exercised (empty-string tracking, '-' discount_code,
  -- carrier/bank on the conflict path, empty-string tags_raw).
  v_no_t9 text; v_no_t10 text; v_no_t11 text; v_no_t12 text;

  v_row analytics.fact_order%rowtype;
  v_ts1 timestamptz := '2026-08-01 10:00:00+07'; v_ts3 timestamptz := '2026-08-01 11:00:00+07';
  v_ts2 timestamptz := '2026-08-02 10:00:00+07'; v_ts4 timestamptz := '2026-08-02 11:00:00+07';

  v_run_transformed int; v_run_errored int;
  v_post_count bigint; v_post_revenue numeric; v_post_discount numeric; v_post_cogs numeric; v_post_profit numeric;
begin
  -- run as service_role, matching how the app actually calls this
  -- security-definer RPC (grants above only allow service_role).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_no_t1  := v_run_tag || '-T1';  v_no_t2  := v_run_tag || '-T2';  v_no_t3  := v_run_tag || '-T3';
  v_no_t4a := v_run_tag || '-T4A'; v_no_t4b := v_run_tag || '-T4B';
  v_no_t5a := v_run_tag || '-T5A'; v_no_t5b := v_run_tag || '-T5B';
  v_no_t6  := v_run_tag || '-T6';
  v_no_t7  := v_run_tag || '-T7';  v_no_t7b := v_run_tag || '-T7B';
  v_no_t9  := v_run_tag || '-T9';  v_no_t10 := v_run_tag || '-T10';
  v_no_t11 := v_run_tag || '-T11'; v_no_t12 := v_run_tag || '-T12';

  -- --------------------------------------------------------------------
  -- fixture ingredients
  -- --------------------------------------------------------------------
  select dca.channel_id, dca.alias_raw into v_channel_id, v_channel_alias
    from analytics.dim_channel_alias dca limit 1;

  select alias_raw, province_code into v_geo_alias_a, v_province_a
    from analytics.dim_geo_alias where province_code <> 'TH-XX' order by province_code limit 1;

  select alias_raw, province_code into v_geo_alias_b, v_province_b
    from analytics.dim_geo_alias where province_code <> 'TH-XX' and province_code <> v_province_a
    order by province_code limit 1;

  if v_channel_id is null or v_geo_alias_a is null then
    raise exception 'verify-0111: no dim_channel_alias / dim_geo_alias seed rows found -- cannot build test fixtures. This is an environment problem, not a 0111 bug -- stop and check seed data before re-running.';
  end if;

  if v_geo_alias_b is null then
    -- only one distinct non-TH-XX province exists in seed data -- T2's
    -- "different real province wins" case degrades to "same province, still
    -- counts as a legitimate overwrite" rather than failing outright.
    v_geo_alias_b := v_geo_alias_a; v_province_b := v_province_a;
    v_log := v_log || E'WARN: only one distinct non-TH-XX province alias found in seed data -- T2 cannot prove "different real province wins", falling back to "same real province still overwrites"\n';
  end if;

  -- --------------------------------------------------------------------
  -- STEP 1: golden state, BEFORE any fixture exists
  -- --------------------------------------------------------------------
  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_t0_count, v_t0_revenue, v_t0_discount, v_t0_cogs, v_t0_profit
    from analytics.fact_order where shop_id = v_shop_id;

  v_log := v_log || format(E'T0 golden: count=%s revenue=%s discount=%s cogs=%s profit=%s\n',
    v_t0_count, v_t0_revenue, v_t0_discount, v_t0_cogs, v_t0_profit);

  if v_t0_count <> 6504 then
    v_log := v_log || format(E'WARN T0: count=%s, brief baseline was 6504 -- baseline may be stale, continuing (self-referential T8 check below still holds regardless)\n', v_t0_count);
  end if;
  if v_t0_revenue is distinct from 21535166.32 then
    v_log := v_log || format(E'WARN T0: revenue=%s, brief baseline was 21535166.32 -- baseline may be stale, continuing\n', v_t0_revenue);
  end if;

  -- --------------------------------------------------------------------
  -- fixtures: one shared batch, one "already has real data" fact_order row
  -- (direct insert, bypassing the function under test) + one stg_order_import
  -- row (the "new import file") per test case that needs one.
  -- --------------------------------------------------------------------
  insert into analytics.stg_import_batch (shop_id, source_type, file_hash)
  values (v_shop_id, 'excel_order_report', v_run_tag)
  returning id into v_batch_id;

  -- T1: province + tracking already real -> blank import ("Unknown" / "-")
  -- must NOT overwrite either.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tracking_no, revenue, discount, profit_status)
  values (v_shop_id, v_no_t1, v_channel_id, current_date, v_province_a, 'TRACK-REAL-T1', 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, tracking_no, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t1, v_channel_alias, v_run_tag || '-NOMATCH', '-', now(), 100, 0);

  -- T2: province + tracking already real -> import brings DIFFERENT real
  -- values -> new values must win.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tracking_no, revenue, discount, profit_status)
  values (v_shop_id, v_no_t2, v_channel_id, current_date, v_province_a, 'TRACK-OLD-T2', 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, tracking_no, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t2, v_channel_alias, v_geo_alias_b, 'TRACK-NEW-T2', now(), 100, 0);

  -- T3: revenue change must still overwrite (untouched code path), and
  -- profit/profit_status/cogs must compute exactly as before -- 'actual'
  -- order, revenue 100 -> 150, cogs stays 50, profit recomputes to 100.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, revenue, discount, cogs, profit, profit_status)
  values (v_shop_id, v_no_t3, v_channel_id, current_date, v_province_a, 100, 0, 50, 50, 'actual');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t3, v_channel_alias, v_geo_alias_a, now(), 150, 10);

  -- T4a: paid_at/printed_at already real -> blank import must NOT overwrite.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, paid_at, printed_at, revenue, discount, profit_status)
  values (v_shop_id, v_no_t4a, v_channel_id, current_date, v_province_a, v_ts1, v_ts3, 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, paid_at, printed_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t4a, v_channel_alias, v_geo_alias_a, now(), null, null, 100, 0);

  -- T4b: paid_at/printed_at null on the existing row -> import bringing a
  -- real value must set it.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, paid_at, printed_at, revenue, discount, profit_status)
  values (v_shop_id, v_no_t4b, v_channel_id, current_date, v_province_a, null, null, 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, paid_at, printed_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t4b, v_channel_alias, v_geo_alias_a, now(), v_ts2, v_ts4, 100, 0);

  -- T5a: tags already real -> blank tags_raw must NOT overwrite.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tags, revenue, discount, profit_status)
  values (v_shop_id, v_no_t5a, v_channel_id, current_date, v_province_a, array['seed-tag'], 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, tags_raw, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t5a, v_channel_alias, v_geo_alias_a, now(), null, 100, 0);

  -- T5b: tags null on the existing row -> import bringing real tags must set it.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tags, revenue, discount, profit_status)
  values (v_shop_id, v_no_t5b, v_channel_id, current_date, v_province_a, null, 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, tags_raw, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t5b, v_channel_alias, v_geo_alias_a, now(), 'new-tag', 100, 0);

  -- T6: brand new order (insert path, no pre-existing fact_order row).
  -- tracking_no/carrier/bank all '-' -> must land as NULL, not the literal
  -- string, and province "Unknown" must resolve to TH-XX exactly like
  -- before.
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, tracking_no, carrier_raw, bank_raw, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t6, v_channel_alias, v_run_tag || '-NOMATCH', '-', '-', '-', now(), 200, 0);

  -- T7: item_count/shipping_fee_customer/shipping_cost_shop already have
  -- real non-zero values -> import brings 0 for all three -> 0 IS data and
  -- must overwrite (the exact trap this migration exists to avoid: treating
  -- 0 as "blank" the way it treats NULL/'-'/'' as blank for text fields).
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, item_count, shipping_fee_customer, shipping_cost_shop, revenue, discount, profit_status)
  values (v_shop_id, v_no_t7, v_channel_id, current_date, v_province_a, 99, 88, 500, 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, item_count_total, shipping_fee_customer, shipping_cost_shop, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t7, v_channel_alias, v_geo_alias_a, now(), 0, 0, 0, 100, 0);

  -- T7b: the other direction of the same rule -- existing value is real
  -- (777), import brings NULL (field not present in this file) -> must NOT
  -- overwrite. Only shipping_cost_shop tested here; item_count and
  -- shipping_fee_customer share the exact same coalesce() expression so a
  -- second fixture would prove nothing new.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, shipping_cost_shop, revenue, discount, profit_status)
  values (v_shop_id, v_no_t7b, v_channel_id, current_date, v_province_a, 777, 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, order_created_at, shipping_cost_shop, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t7b, v_channel_alias, v_geo_alias_a, now(), null, 100, 0);

  -- T9: real tracking_no + file sends '' (empty string, NOT '-') -> must NOT
  -- overwrite. T1 only ever walked the '-' branch of import_text_or_null();
  -- this walks the nullif(btrim(p), '') branch.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tracking_no, revenue, discount, profit_status)
  values (v_shop_id, v_no_t9, v_channel_id, current_date, v_province_a, 'TRACK-REAL-T9', 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, tracking_no, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t9, v_channel_alias, v_geo_alias_a, '', now(), 100, 0);

  -- T10: real discount_code + file sends '-' -> must NOT overwrite. Note the
  -- '-' -> null normalization for this column is PRE-EXISTING code
  -- (v_discount_code := nullif(nullif(btrim(...), ''), '-')), 0111 only adds
  -- the coalesce on the conflict path — this proves the two compose.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, discount_code, revenue, discount, profit_status)
  values (v_shop_id, v_no_t10, v_channel_id, current_date, v_province_a, 'SAVE10', 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, discount_code, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t10, v_channel_alias, v_geo_alias_a, '-', now(), 100, 0);

  -- T11: real carrier_code + bank, file sends '-' for both -> must NOT
  -- overwrite (the conflict-path mirror of T6, which only proves the insert
  -- path writes NULL).
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, carrier_code, bank, revenue, discount, profit_status)
  values (v_shop_id, v_no_t11, v_channel_id, current_date, v_province_a, 'Kerry', 'SCB', 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, carrier_raw, bank_raw, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t11, v_channel_alias, v_geo_alias_a, '-', '-', now(), 100, 0);

  -- T12: real tags + file sends tags_raw = '' (empty string, NOT null) ->
  -- must NOT overwrite. T5a only covers the IS NULL branch; the function
  -- has a separate trim(tags_raw) = '' branch.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, province_code, tags, revenue, discount, profit_status)
  values (v_shop_id, v_no_t12, v_channel_id, current_date, v_province_a, array['seed-tag'], 100, 0, 'estimated');
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, province_raw, tags_raw, order_created_at, revenue, discount_total)
  values (v_batch_id, v_shop_id, '{}'::jsonb, 'excel', v_no_t12, v_channel_alias, v_geo_alias_a, '', now(), 100, 0);

  -- --------------------------------------------------------------------
  -- STEP 3: one call processes every fixture row in the shared batch.
  -- --------------------------------------------------------------------
  select transformed_count, errored_count into v_run_transformed, v_run_errored
    from analytics.transform_pending_orders(v_shop_id, v_batch_id);

  -- 14 stg rows above: T1 T2 T3 T4a T4b T5a T5b T6 T7 T7b T9 T10 T11 T12
  -- (first draft said 9 for 10 rows — the dry run on 11 ก.ย. 69 returned
  -- transformed=10 with every behavioral check green, so the expectation was
  -- the bug, not the migration; T9–T12 were added after QA review).
  v_log := v_log || format(E'run: transformed=%s errored=%s (expect transformed=14, errored=0)\n', v_run_transformed, v_run_errored);

  if v_run_errored is distinct from 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL run: %s row(s) errored -- see stg_order_import.error_detail for this batch\n', v_run_errored);
  end if;
  if v_run_transformed is distinct from 14 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL run: transformed_count=%s, expected 14 (one per fixture) -- a fixture failed to insert/match\n', v_run_transformed);
  end if;

  -- --------------------------------------------------------------------
  -- T1: real province + real tracking must survive a blank ("Unknown"/'-')
  -- re-import untouched.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t1;
  if v_row.province_code is distinct from v_province_a or v_row.tracking_no is distinct from 'TRACK-REAL-T1' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T1: province_code=%s (want %s) tracking_no=%s (want TRACK-REAL-T1)\n', v_row.province_code, v_province_a, v_row.tracking_no);
  else
    v_log := v_log || E'OK   T1: real province + real tracking_no survived a blank ("Unknown"/''-'') re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- T2: real -> different real must overwrite.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t2;
  if v_row.province_code is distinct from v_province_b or v_row.tracking_no is distinct from 'TRACK-NEW-T2' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T2: province_code=%s (want %s) tracking_no=%s (want TRACK-NEW-T2)\n', v_row.province_code, v_province_b, v_row.tracking_no);
  else
    v_log := v_log || E'OK   T2: real province + real tracking_no overwritten by a different real value\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3: revenue/discount change must overwrite; profit/profit_status/cogs
  -- formula must behave exactly as the untouched original code.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t3;
  if v_row.revenue is distinct from 150 or v_row.discount is distinct from 10 or v_row.profit_status is distinct from 'actual'::analytics.profit_status_t or v_row.cogs is distinct from 50 or v_row.profit is distinct from 100 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T3: revenue=%s discount=%s profit_status=%s cogs=%s profit=%s (want revenue=150 discount=10 profit_status=actual cogs=50 profit=100)\n',
      v_row.revenue, v_row.discount, v_row.profit_status, v_row.cogs, v_row.profit);
  else
    v_log := v_log || E'OK   T3: revenue/discount overwritten, profit_status stayed actual, cogs untouched, profit recomputed correctly\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4a: real paid_at/printed_at must survive a blank re-import.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t4a;
  if v_row.paid_at is distinct from v_ts1 or v_row.printed_at is distinct from v_ts3 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T4a: paid_at=%s printed_at=%s (want %s / %s)\n', v_row.paid_at, v_row.printed_at, v_ts1, v_ts3);
  else
    v_log := v_log || E'OK   T4a: real paid_at/printed_at survived a blank re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4b: null paid_at/printed_at must be set by a real incoming value.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t4b;
  if v_row.paid_at is distinct from v_ts2 or v_row.printed_at is distinct from v_ts4 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T4b: paid_at=%s printed_at=%s (want %s / %s)\n', v_row.paid_at, v_row.printed_at, v_ts2, v_ts4);
  else
    v_log := v_log || E'OK   T4b: null paid_at/printed_at was set by a real incoming value\n';
  end if;

  -- --------------------------------------------------------------------
  -- T5a: real tags must survive a blank tags_raw re-import.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t5a;
  if v_row.tags is distinct from array['seed-tag'] then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T5a: tags=%s (want {seed-tag})\n', v_row.tags);
  else
    v_log := v_log || E'OK   T5a: real tags survived a blank tags_raw re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- T5b: null tags must be set by a real incoming tags_raw.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t5b;
  if v_row.tags is distinct from array['new-tag'] then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T5b: tags=%s (want {new-tag})\n', v_row.tags);
  else
    v_log := v_log || E'OK   T5b: null tags was set by a real incoming tags_raw\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6: brand new order -- insert path must still write NULL for '-'
  -- placeholders (not the literal string), and TH-XX for an unmatched
  -- province, exactly as the pre-0111 insert-side behavior for province.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t6;
  if not found then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T6: brand new order was not inserted at all\n';
  elsif v_row.tracking_no is not null or v_row.carrier_code is not null or v_row.bank is not null or v_row.province_code <> 'TH-XX' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T6: tracking_no=%s carrier_code=%s bank=%s province_code=%s (want all of tracking_no/carrier_code/bank NULL, province_code=TH-XX)\n',
      v_row.tracking_no, v_row.carrier_code, v_row.bank, v_row.province_code);
  else
    v_log := v_log || E'OK   T6: brand new order inserted with NULL tracking_no/carrier_code/bank (not the literal ''-'') and TH-XX province, insert path unchanged\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7: 0 is data, not blank -- must overwrite a real non-zero value.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t7;
  if v_row.item_count is distinct from 0 or v_row.shipping_fee_customer is distinct from 0 or v_row.shipping_cost_shop is distinct from 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T7: item_count=%s shipping_fee_customer=%s shipping_cost_shop=%s (want all 0 -- 0 was wrongly treated as blank)\n',
      v_row.item_count, v_row.shipping_fee_customer, v_row.shipping_cost_shop);
  else
    v_log := v_log || E'OK   T7: shipping_cost_shop/shipping_fee_customer/item_count = 0 correctly overwrote real non-zero values (0 is data, not blank)\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7b: the mirror case -- NULL (field absent from this file) must not
  -- clobber a real existing 0-or-otherwise value.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t7b;
  if v_row.shipping_cost_shop is distinct from 777 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T7b: shipping_cost_shop=%s (want 777, NULL import must not overwrite a real value)\n', v_row.shipping_cost_shop);
  else
    v_log := v_log || E'OK   T7b: NULL shipping_cost_shop in the import did not overwrite the real existing value\n';
  end if;

  -- --------------------------------------------------------------------
  -- T9: real tracking_no must survive an empty-string ('') re-import.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t9;
  if v_row.tracking_no is distinct from 'TRACK-REAL-T9' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T9: tracking_no=%s (want TRACK-REAL-T9 -- empty string must not overwrite)\n', v_row.tracking_no);
  else
    v_log := v_log || E'OK   T9: real tracking_no survived an empty-string ('''') re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- T10: real discount_code must survive a '-' re-import.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t10;
  if v_row.discount_code is distinct from 'SAVE10' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T10: discount_code=%s (want SAVE10 -- ''-'' must not overwrite)\n', v_row.discount_code);
  else
    v_log := v_log || E'OK   T10: real discount_code survived a ''-'' re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- T11: real carrier_code + bank must survive a '-' re-import (conflict path).
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t11;
  if v_row.carrier_code is distinct from 'Kerry' or v_row.bank is distinct from 'SCB' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T11: carrier_code=%s bank=%s (want Kerry / SCB -- ''-'' must not overwrite on the conflict path)\n', v_row.carrier_code, v_row.bank);
  else
    v_log := v_log || E'OK   T11: real carrier_code + bank survived a ''-'' re-import on the conflict path\n';
  end if;

  -- --------------------------------------------------------------------
  -- T12: real tags must survive an empty-string tags_raw re-import.
  -- --------------------------------------------------------------------
  select * into v_row from analytics.fact_order where shop_id = v_shop_id and source_order_no = v_no_t12;
  if v_row.tags is distinct from array['seed-tag'] then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T12: tags=%s (want {seed-tag} -- empty tags_raw must not overwrite)\n', v_row.tags);
  else
    v_log := v_log || E'OK   T12: real tags survived an empty-string tags_raw re-import\n';
  end if;

  -- --------------------------------------------------------------------
  -- STEP 8: delete every fixture this script created, then re-snapshot and
  -- assert it matches T0 exactly -- proves no fixture leaked and no money
  -- aggregate (count/revenue/discount/cogs/profit) drifted. It does NOT
  -- prove that no other row was touched at all: updated_at / is_new_customer
  -- / tracking_no are not in the tuple. In practice nothing else moves here
  -- because every fixture has customer_id = null, so the trailing
  -- recompute_is_new_customer() call has nothing to recompute (0045:46-57
  -- guards with `is distinct from`) -- but that is reasoning, not this check.
  -- --------------------------------------------------------------------
  delete from analytics.fact_order where shop_id = v_shop_id and source_order_no like v_run_tag || '-%';
  delete from analytics.stg_order_import where batch_id = v_batch_id;
  delete from analytics.stg_import_batch where id = v_batch_id;

  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_post_count, v_post_revenue, v_post_discount, v_post_cogs, v_post_profit
    from analytics.fact_order where shop_id = v_shop_id;

  v_log := v_log || format(E'T8 post-cleanup: count=%s revenue=%s discount=%s cogs=%s profit=%s\n',
    v_post_count, v_post_revenue, v_post_discount, v_post_cogs, v_post_profit);

  if v_post_count <> v_t0_count or v_post_revenue is distinct from v_t0_revenue
     or v_post_discount is distinct from v_t0_discount or v_post_cogs is distinct from v_t0_cogs
     or v_post_profit is distinct from v_t0_profit then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: post-cleanup snapshot does NOT match T0 -- either a fixture leaked or the run touched an unrelated real order. STOP -- do not ship this migration.\n';
  else
    v_log := v_log || E'OK   T8: post-cleanup snapshot matches T0 exactly -- no fixture leaked, no money aggregate drifted\n';
  end if;

  -- --------------------------------------------------------------------
  -- forced rollback via raise exception. Everything in this transaction --
  -- the DDL replace/grants above and every fixture write -- is undone.
  -- --------------------------------------------------------------------
  if v_fail_count > 0 then
    v_log := v_log || format(E'\n=== %s CHECK(S) FAILED -- 0111 is NOT safe to ship as-is ===\n', v_fail_count);
  else
    v_log := v_log || E'\n=== ALL CHECKS PASSED -- safe to apply 0111 for real (apply_migration) ===\n';
  end if;

  raise exception '%', v_log;
end;
$verify$;

-- Never reached in practice (the raise exception above already aborts the
-- transaction) — present for clarity and as a safety net if this script is
-- ever run with the do-block's raise commented out by mistake.
rollback;
