-- 0013_analytics_transform.sql
-- Phase A2 import pilot — staging (excel only) -> dims/facts transform proc.
-- Per docs/3j-jewelry/analytics/stg-import-schema.md §5,6,7 + task brief.
--
-- Pilot scope: source_kind='excel' ONLY (LINE/FB/TikTok Excel order report).
-- PDF label/slip merge and fact_order_item are explicitly OUT of scope here
-- (spec §5: "PDF ไม่มีคู่ Excel -> pdf_orphan" — that merge step + slip-driven
-- fact_order_item population is a later phase; this migration never touches
-- stg_order_item_import).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- analytics.normalize_th_phone — small pure helper, split out of the main
-- proc for testability/readability. Rejects masked numbers BEFORE any
-- stripping (stg-import-schema.md §"ความเสี่ยง" #2: "เบอร์ Excel ของ TikTok
-- อาจ mask ที่ดูเหมือนจริง -> validator reject pattern */สั้นผิดปกติ ก่อน
-- hash กัน false-merge identity"). Returns E.164 (+66...) or null if the
-- input can't be confidently normalized — callers must treat null as "no
-- usable phone", never hash a null.
-- ============================================================================

create or replace function analytics.normalize_th_phone(p_phone_raw text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  if p_phone_raw is null or trim(p_phone_raw) = '' then
    return null;
  end if;

  -- Masked patterns (e.g. "081***5678", "081xxx5678") — reject pre-strip so
  -- the mask characters can't accidentally get silently dropped and produce
  -- a plausible-looking-but-wrong digit string.
  if p_phone_raw ~ '[*xX]{2,}' then
    return null;
  end if;

  v_digits := regexp_replace(p_phone_raw, '[^0-9]', '', 'g');

  if v_digits = '' or length(v_digits) < 9 then
    return null;
  end if;

  if left(v_digits, 2) = '66' and length(v_digits) = 11 then
    return '+' || v_digits;
  elsif left(v_digits, 1) = '0' and length(v_digits) = 10 then
    return '+66' || substring(v_digits from 2);
  elsif length(v_digits) = 9 then
    -- Mobile number typed without the leading 0 (e.g. "812345678").
    return '+66' || v_digits;
  else
    return null;
  end if;
end;
$$;

revoke execute on function analytics.normalize_th_phone(text) from public, anon, authenticated;
grant execute on function analytics.normalize_th_phone(text) to service_role;

-- ============================================================================
-- analytics.transform_pending_orders
-- ============================================================================

create or replace function analytics.transform_pending_orders(
  p_shop_id uuid,
  p_batch_id uuid
)
returns table (transformed_count int, errored_count int)
language plpgsql
security definer
set search_path = public, analytics, extensions, pg_temp
as $$
declare
  v_row analytics.stg_order_import%rowtype;
  v_channel_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_phone_norm text;
  v_phone_hash text;
  v_province_code text;
  v_order_date date;
  v_tags text[];
  v_fact_order_id uuid;
  v_is_new_customer boolean;
  v_transformed int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_orders: p_shop_id and p_batch_id are required';
  end if;

  -- import_status in ('pending','error') so a rerun (e.g. after fixing a
  -- missing dim_channel_alias row) picks up previously-errored rows too, not
  -- just brand-new ones — required for the "idempotent, rerun ปลอดภัย" spec.
  for v_row in
    select *
    from analytics.stg_order_import
    where shop_id = p_shop_id
      and batch_id = p_batch_id
      and source_kind = 'excel'
      and import_status in ('pending', 'error')
    order by source_row_no
  loop
    -- Each row processed inside its own exception block (implicit savepoint)
    -- so one bad row (bad channel alias, bad dates, etc.) never aborts the
    -- rest of the batch — same defensive pattern as 0003's per-item loops.
    begin
      v_channel_id := null;
      v_customer_id := null;
      v_phone_norm := null;
      v_phone_hash := null;

      -- ---- channel -------------------------------------------------------
      select dca.channel_id
        into v_channel_id
        from analytics.dim_channel_alias dca
        where dca.alias_raw = v_row.channel_raw;

      if v_channel_id is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'no dim_channel_alias match for channel_raw: ' || coalesce(v_row.channel_raw, '<null>')
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;

      -- ---- order_created_at required (fact_order.order_date not null) ----
      if v_row.order_created_at is null then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = 'order_created_at is null, cannot derive order_date'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      v_order_date := v_row.order_created_at::date;

      -- ---- customer --------------------------------------------------------
      v_phone_norm := analytics.normalize_th_phone(v_row.phone_raw);

      if v_phone_norm is not null then
        v_phone_hash := encode(digest(v_phone_norm, 'sha256'), 'hex');

        insert into analytics.dim_customer (shop_id, display_name, primary_phone_hash, first_touch_channel_id)
        values (p_shop_id, v_row.customer_name_raw, v_phone_hash, v_channel_id)
        on conflict (shop_id, primary_phone_hash) where primary_phone_hash is not null and merged_into_id is null
        do update set
          display_name = coalesce(excluded.display_name, analytics.dim_customer.display_name),
          updated_at = now()
        returning id into v_customer_id;

        insert into analytics.dim_customer_identity (
          shop_id, customer_id, identity_type, identity_value_norm, identity_value_hash, confidence
        )
        values (p_shop_id, v_customer_id, 'phone', v_phone_norm, v_phone_hash, 'exact')
        on conflict (shop_id, identity_type, identity_value_norm)
        do update set customer_id = excluded.customer_id, updated_at = now();

        insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name)
        values (v_customer_id, p_shop_id, v_phone_norm, v_row.customer_name_raw)
        on conflict (customer_id)
        do update set
          phone_e164 = excluded.phone_e164,
          full_name = coalesce(excluded.full_name, analytics.pii_customer.full_name),
          updated_at = now();
      else
        -- No usable phone. Spec §6: "ไม่มีเบอร์ -> dim_customer by row
        -- (probable, ไม่มี identity) หรือ null customer" — ambiguous on which
        -- of the two. OWN DECISION (flagged for Tech Lead review): if a name
        -- is present, create a fresh per-row dim_customer (no identity, no
        -- dedup — every no-phone row is its own "probable" customer, since
        -- there is no key to merge on); if no name either, leave customer_id
        -- null entirely rather than manufacture an anonymous customer row.
        v_customer_name := nullif(trim(coalesce(v_row.customer_name_raw, '')), '');

        if v_customer_name is not null then
          insert into analytics.dim_customer (shop_id, display_name, first_touch_channel_id)
          values (p_shop_id, v_customer_name, v_channel_id)
          returning id into v_customer_id;

          insert into analytics.pii_customer (customer_id, shop_id, full_name)
          values (v_customer_id, p_shop_id, v_customer_name);
        else
          v_customer_id := null;
        end if;
      end if;

      -- ---- province --------------------------------------------------------
      -- dim_geo is only seeded with the 'TH-XX' unknown fallback as of 0010
      -- (full 77-province seed is a flagged Phase A2 gap) — this lookup is
      -- forward-compatible: once that seed lands, matching province rows
      -- start resolving automatically with no change needed here.
      select dg.province_code
        into v_province_code
        from analytics.dim_geo dg
        where dg.province_name_th = trim(coalesce(v_row.province_raw, ''));

      v_province_code := coalesce(v_province_code, 'TH-XX');

      -- ---- tags --------------------------------------------------------
      if v_row.tags_raw is null or trim(v_row.tags_raw) = '' then
        v_tags := null;
      else
        select array_agg(trim(t))
          into v_tags
          from unnest(string_to_array(v_row.tags_raw, ',')) as t
          where trim(t) <> '';
      end if;

      -- ---- is_new_customer --------------------------------------------------
      -- "เคยมี fact_order ก่อนหน้าไหม" — approximated as: no other fact_order
      -- for this customer with an earlier order_date. Only computed when we
      -- have a customer_id at all; left null otherwise (can't be determined).
      if v_customer_id is not null then
        select not exists (
          select 1
          from analytics.fact_order fo
          where fo.customer_id = v_customer_id
            and fo.shop_id = p_shop_id
            and fo.order_date < v_order_date
        ) into v_is_new_customer;
      else
        v_is_new_customer := null;
      end if;

      -- ---- fact_order upsert --------------------------------------------------
      insert into analytics.fact_order (
        shop_id, source_order_no, customer_id, channel_id,
        order_date, paid_at, printed_at,
        province_code, carrier_code, tracking_no,
        item_count, revenue, discount,
        shipping_fee_customer, shipping_cost_shop,
        profit, profit_status, bank, tags, is_new_customer
      )
      values (
        p_shop_id, v_row.source_order_no, v_customer_id, v_channel_id,
        v_order_date, v_row.paid_at, v_row.printed_at,
        v_province_code, v_row.carrier_raw, v_row.tracking_no,
        v_row.item_count_total, coalesce(v_row.revenue, 0), coalesce(v_row.discount_total, 0),
        v_row.shipping_fee_customer, v_row.shipping_cost_shop,
        round(coalesce(v_row.revenue, 0) * 0.10, 2), 'estimated', v_row.bank_raw, v_tags, v_is_new_customer
      )
      on conflict (shop_id, source_order_no) do update set
        customer_id = excluded.customer_id,
        channel_id = excluded.channel_id,
        order_date = excluded.order_date,
        paid_at = excluded.paid_at,
        printed_at = excluded.printed_at,
        province_code = excluded.province_code,
        carrier_code = excluded.carrier_code,
        tracking_no = excluded.tracking_no,
        item_count = excluded.item_count,
        revenue = excluded.revenue,
        discount = excluded.discount,
        shipping_fee_customer = excluded.shipping_fee_customer,
        shipping_cost_shop = excluded.shipping_cost_shop,
        profit = excluded.profit,
        profit_status = excluded.profit_status,
        bank = excluded.bank,
        tags = excluded.tags,
        -- is_new_customer deliberately NOT overwritten on conflict — it's a
        -- point-in-time determination made once at first transform; re-running
        -- the proc later (e.g. after more orders exist) must not flip it.
        updated_at = now()
      returning id into v_fact_order_id;

      update analytics.stg_order_import
        set fact_order_id = v_fact_order_id,
            import_status = 'transformed',
            error_detail = null
        where id = v_row.id;

      v_transformed := v_transformed + 1;
    exception
      when others then
        update analytics.stg_order_import
          set import_status = 'error',
              error_detail = sqlerrm
          where id = v_row.id;
        v_errored := v_errored + 1;
    end;
  end loop;

  return query select v_transformed, v_errored;
end;
$$;

revoke execute on function analytics.transform_pending_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_orders(uuid, uuid) to service_role;

-- ============================================================================
-- Verify (example only — commented out, Tech Lead runs manually after apply).
-- Self-cleaning: wraps in a transaction that's rolled back so it never leaves
-- test data behind. Replace the two uuids with a real shop_id / batch_id
-- from a loaded batch before running.
-- ============================================================================

-- do $$
-- declare
--   v_shop_id uuid := '00000000-0000-0000-0000-000000000000'; -- replace
--   v_batch_id uuid := '00000000-0000-0000-0000-000000000000'; -- replace
--   v_transformed int;
--   v_errored int;
-- begin
--   select transformed_count, errored_count
--     into v_transformed, v_errored
--     from analytics.transform_pending_orders(v_shop_id, v_batch_id);
--   raise notice 'transformed=%, errored=%', v_transformed, v_errored;
--
--   -- Idempotency check: rerun immediately, should transform 0 new rows
--   -- (everything already 'transformed', not 'pending'/'error').
--   select transformed_count, errored_count
--     into v_transformed, v_errored
--     from analytics.transform_pending_orders(v_shop_id, v_batch_id);
--   raise notice 'rerun: transformed=%, errored=%', v_transformed, v_errored;
--
--   raise exception 'rollback verify block, no data changes committed';
-- exception
--   when others then
--     raise notice 'verify block finished (rolled back): %', sqlerrm;
-- end;
-- $$;
