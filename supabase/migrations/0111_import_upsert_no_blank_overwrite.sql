-- 0111_import_upsert_no_blank_overwrite.sql
-- analytics.transform_pending_orders currently upserts every field
-- unconditionally on re-import (`on conflict ... do update set x = excluded.x`
-- for every column) — it never checks whether the NEW value is actually
-- data or just a blank placeholder from a source that doesn't have that
-- field yet. Two concrete real-world losses from this:
--   1. Shipnity exports TikTok orders with province = "Unknown" (66/69 rows
--      in a typical file) before the label-upload flow (0097/0098) has had
--      a chance to fill in the real province from the printed label. If the
--      monthly order-report Excel is re-imported AFTER label upload has
--      already enriched an order, this upsert silently wipes the real
--      province back to TH-XX.
--   2. Shipnity only assigns a real tracking number once staff print the
--      shipping label in Shipnity — before that it exports '-'. Re-importing
--      an older/earlier-exported file after tracking numbers exist wipes
--      them back to '-'. This has already happened once in production
--      (9 ก.ย. 69); 222 rows in fact_order currently hold the literal
--      string '-' in tracking_no as a result.
--
-- Owner's rule (10 ก.ย. 69): "ไม่มีข้อมูล" ห้ามทับ "มีข้อมูล" — a blank/
-- placeholder value coming in from a new import must never overwrite a real
-- value already on the row. If BOTH sides have real data, the new file
-- still wins (that's the whole point of allowing re-import to correct
-- mistakes) — this migration is strictly about not regressing already-good
-- data with blanks, not about freezing fields once set.
--
-- 🔴 revenue, discount, profit_status, profit, cogs are explicitly OUT OF
-- SCOPE and their update-clause lines are byte-for-byte unchanged from the
-- live function (see scripts/verify-0111-upsert-rules.sql's DDL replay,
-- which must match this file's DDL exactly, and in turn must match the
-- source-of-truth dump this migration was written against). Only line-break
-- placement around them changed for diff readability — no expression text
-- was touched.
--
-- ⚠️ PREPARED, NOT APPLIED — written for Tech Lead to review and apply via
-- the Supabase MCP (supabase-migrate skill: pre-check -> apply_migration ->
-- self-verify -> get_advisors). Do not run this against a live project as
-- part of writing it. scripts/verify-0111-upsert-rules.sql rehearses this
-- exact DDL (replay + do-block + forced rollback) and should be run FIRST,
-- as a read-only proof, before apply_migration touches the live function.
--
-- Written against analytics.transform_pending_orders(uuid,uuid) as it
-- existed live on the DB on 10 ก.ย. 69 (pulled via
-- pg_get_functiondef — 0107/0108/0109/0110 are already applied live but
-- none of them touch this function; confirmed by object name, not assumed).
--
-- 3j-migration-traps checklist:
--  - signature unchanged (still (uuid, uuid)) -> plain `create or replace`
--    is correct here, no drop-then-create needed (trap #1).
--  - grants do NOT survive `create or replace` on Supabase -> explicit
--    revoke+grant below for BOTH functions this file touches (trap #2).
--  - no view touched, nothing to worry about re: 42P16 (trap #3).
--  - no client-supplied numeric input added -> no new NaN surface (trap #4).
--  - no new ratio/division introduced (trap #5).
--  - no new "today" logic introduced -> UTC/Asia-Bangkok not a concern here
--    (trap #6).
--  - grants below are scoped to the two functions this file actually
--    touches, not a schema-wide sweep (trap #7).
--  - `found` is not relied on anywhere in this change (trap #8).
--  - no array-concat-with-possibly-null-lookup pattern introduced (trap #9).
--  - search_path applied to both `create or replace function` statements
--    below (search_path hygiene item on the checklist).
--  - idempotent: re-running this file is safe — `create or replace` on both
--    functions, `revoke`/`grant` are safe to repeat, and the backfill UPDATE
--    at the bottom only touches rows still holding the literal '-' (so a
--    second run is a no-op there too).
--  - this migration was applied by whoever runs it via `apply_migration`,
--    which records migration history automatically (trap #10 only bites
--    `execute_sql`, not used here).
--  - touches money-adjacent state (fact_order, a table that also carries
--    revenue/profit) -> scripts/verify-0111-upsert-rules.sql follows trap
--    #11's do-block + forced-rollback pattern, never writing to the table
--    outside a rolled-back transaction.

-- ============================================================================
-- 1. Helper: normalize an import-sourced text value to NULL if it carries no
--    real information (blank string or the literal placeholder '-' that
--    Shipnity/other sources use for "not yet known"). `strict` means NULL in
--    -> NULL out for free, so callers don't need a separate null check.
-- ============================================================================

create or replace function analytics.import_text_or_null(p text)
returns text
language sql
immutable
strict
set search_path = pg_temp
as $$
  select nullif(nullif(btrim(p), ''), '-')
$$;

revoke execute on function analytics.import_text_or_null(text) from public, anon, authenticated;
grant execute on function analytics.import_text_or_null(text) to service_role;

-- ============================================================================
-- 2. analytics.transform_pending_orders — same (uuid, uuid) signature, body
--    changed in exactly two places:
--    a) the INSERT ... VALUES tuple: tracking_no / carrier_code / bank now
--       go through analytics.import_text_or_null() so a fresh insert never
--       writes the literal '-' in the first place (this is the one place
--       the brief explicitly allows the insert side to change).
--    b) the ON CONFLICT ... DO UPDATE SET clause: every field that Shipnity
--       can legitimately export as "not yet known" now uses
--       coalesce(excluded.x, analytics.fact_order.x) (or, for province_code,
--       an equivalent case comparing against its blank sentinel 'TH-XX')
--       instead of an unconditional excluded.x. channel_id and order_date
--       are left as unconditional overwrites (both are guaranteed non-null
--       by the validation earlier in the function, so there is no blank
--       case to guard against). revenue, discount, profit_status, profit,
--       cogs are untouched.
-- ============================================================================

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
-- 3. Backfill — the 222 fact_order rows that already hold the literal '-'
--    from a pre-fix import are real "not yet known" placeholders, same as
--    what the new insert-side helper now prevents going forward. Cleaning
--    them to NULL here matches the new convention and stops them showing up
--    as fake tracking numbers on the /orders and /tiktok pages. Scoped to
--    the exact placeholder string only — never touches a row with a real
--    tracking number, and is naturally idempotent (0 rows match on a
--    second run).
-- ============================================================================

update analytics.fact_order set tracking_no = null where tracking_no = '-';

notify pgrst, 'reload schema';
