-- 0041_lineitem_import.sql
-- Phase Line-item Import — P1 (DB layer) per:
--   docs/3j-jewelry/analytics/phase-lineitem-import-design.md (architect design, approved)
--
-- Unlocks actual per-SKU/per-order profit (vs the 10-20% blended-margin guess)
-- by parsing Shipnity's "สินค้าในออเดอร์" line-item report (20 cols, 5,732
-- rows / 196 SKU across the 8 real Jan-Aug 2026 files).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via
-- MCP after diffing part 3 (transform_pending_orders) against 0040: every
-- line must be byte-identical except the ON CONFLICT guard marked "-- 0041:"
-- below (design §4 HAZARD FIX).
--
-- Contents:
--   1. analytics.stg_order_line_import (new staging table + RLS, design §2.1)
--      + stg_import_batch.source_type extended with 'excel_line_item_report'
--   2. analytics.transform_pending_order_lines (new proc, design §2.2/§3)
--   3. HAZARD FIX: transform_pending_orders on-conflict guard (design §4)
--   4. Grants + notify pgrst
--
-- fact_order.cogs — NOT added by this migration: already exists as of
-- 0010:321 (`cogs numeric(12, 2)`), confirmed by reading that file before
-- writing this one. The task brief said "check 0010, alter add if missing"
-- — it's not missing, so there is deliberately no ALTER TABLE for it here.

-- ============================================================================
-- 1. analytics.stg_order_line_import (design §2.1) — grain: 1 row = 1 line
--    item in Shipnity's line-item report. Deliberately a NEW table, not an
--    overload of stg_order_item_import (0011): that table's grain/key is
--    (marketplace_order_id, line_no) with marketplace_order_id NOT NULL and
--    no price column — built for the TikTok Packing-Slip PDF path (still 0
--    rows). Shipnity joins by source_order_no (E771) and carries price;
--    forcing it into the existing table means dropping a NOT NULL and
--    changing the unique key, which is messier than a new table (design §7
--    decision 1).
-- ============================================================================

create table analytics.stg_order_line_import (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references analytics.stg_import_batch (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  source_order_no text,               -- E771 (nullable: blank-SKU/manual-adjust rows may lack one)
  line_no int not null,               -- parser-assigned running index per source_order_no -> idempotency key
  sku_raw text,                       -- [0] (blank ~109/5,732 real rows -> shipping/adjustment lines)
  product_name_raw text,              -- [1]
  unit_price numeric(12, 2),          -- [2]
  qty int,                            -- [3]
  raw jsonb not null,
  import_status text not null default 'pending' check (
    import_status in ('pending', 'transformed', 'orphan', 'skipped_blank', 'sku_unmapped', 'error')
  ),
  error_detail text,
  fact_order_item_id uuid references analytics.fact_order_item (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_stg_line_shop_order_lineno unique (shop_id, source_order_no, line_no)
);

create index idx_stg_order_line_import_batch_id on analytics.stg_order_line_import (batch_id);
create index idx_stg_order_line_import_shop_order on analytics.stg_order_line_import (shop_id, source_order_no);
create index idx_stg_order_line_import_fact_order_item_id
  on analytics.stg_order_line_import (fact_order_item_id);

-- RLS — Tier 4 pattern (0012), same shape as stg_order_item_import's:
-- owner/admin only (staging carries no PII itself here, but source_order_no
-- + raw jsonb are sensitive enough to gate the same way as every other
-- staging table). No delete policy — staging rows are retained for audit,
-- same reasoning as 0012's header comment.
alter table analytics.stg_order_line_import enable row level security;

create policy owner_admin_select on analytics.stg_order_line_import
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_insert on analytics.stg_order_line_import
  for insert
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy owner_admin_update on analytics.stg_order_line_import
  for update
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Extend stg_import_batch.source_type to accept the new report kind. Postgres
-- auto-names an inline column CHECK "<table>_<column>_check" (confirmed
-- pattern: 0023 dropped crm_audit_log_action_check the same way) — no prior
-- migration touched this constraint, so the default name is reliable here.
alter table analytics.stg_import_batch
  drop constraint if exists stg_import_batch_source_type_check;
alter table analytics.stg_import_batch
  add constraint stg_import_batch_source_type_check
  check (source_type in ('excel_order_report', 'tiktok_label_pdf', 'tiktok_slip_pdf', 'excel_line_item_report'));

-- ============================================================================
-- 2. analytics.transform_pending_order_lines(p_shop_id, p_batch_id)
--    (design §2.2 + §3 profit model). security definer, service_role only —
--    same auth shape as transform_pending_orders.
--
--    Two phases, not one pass, because fact_order_item has NO natural key to
--    upsert against (design §7 decision 5: "DELETE+INSERT per fact_order").
--    A naive single-pass "insert per staging row" would duplicate items on
--    every rerun (retry after a partial error, or a second file touching an
--    order already covered by an earlier batch). Splitting into
--    classify-then-rebuild fixes that:
--
--    Phase 1 (this batch's rows only): classify every 'pending'/'orphan'/
--      'error' row of batch p_batch_id -> blank SKU goes to terminal
--      'skipped_blank'; no matching fact_order goes to terminal 'orphan'
--      (design: "orphan ตื่นเองหลัง order import" -> next run's WHERE clause
--      picks it back up); everything else is left 'pending', now known to
--      have a real fact_order match.
--
--    Phase 2 (every batch, full order rebuild): for every fact_order touched
--      by a row that survived phase 1, DELETE all its existing
--      fact_order_item rows, then INSERT fresh ones from EVERY
--      stg_order_line_import row for that (shop_id, source_order_no) across
--      ALL batches (not just this one) whose sku_raw is not null and status
--      isn't 'skipped_blank'. Scoping the rebuild by order (not by batch) is
--      what makes a partial retry safe: it doesn't matter which batch a
--      given order's rows came from, the rebuild always reflects the
--      complete current staging picture for that order. Then recompute
--      fact_order.cogs/profit/profit_status (design §3).
--
--    fact_order_item.id churn on every rebuild is intentional and harmless —
--    nothing else references those ids except stg_order_line_import.
--    fact_order_item_id, which is refreshed in the same pass (and auto-nulled
--    by ON DELETE SET NULL for any row this rebuild doesn't immediately
--    re-touch, e.g. one that fails its own insert below).
--
--    NOTE (shared grain, currently inert): stg_order_item_import (0011, the
--    TikTok-PDF path) also FKs fact_order_item_id -> fact_order_item ON
--    DELETE SET NULL. That table has 0 rows in production today, so phase
--    2's delete never touches a live PDF-path row — flagged for whoever
--    wires that path up later, not a bug here.
-- ============================================================================

create or replace function analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 returns table(
   transformed_count integer,
   orphan_count integer,
   skipped_blank_count integer,
   unknown_sku_count integer,
   errored_count integer
 )
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_new_item_id uuid;
  v_cogs numeric(12, 2);
  v_transformed int := 0;
  v_orphan int := 0;
  v_skipped_blank int := 0;
  v_unknown int := 0;
  v_errored int := 0;
begin
  if p_shop_id is null or p_batch_id is null then
    raise exception 'transform_pending_order_lines: p_shop_id and p_batch_id are required';
  end if;

  -- Phase 1: classify this batch's rows.
  for v_row in
    select *
    from analytics.stg_order_line_import
    where shop_id = p_shop_id
      and batch_id = p_batch_id
      and import_status in ('pending', 'orphan', 'error')
    order by source_order_no, line_no
  loop
    begin
      if v_row.sku_raw is null then
        update analytics.stg_order_line_import
          set import_status = 'skipped_blank', error_detail = null
          where id = v_row.id;
        v_skipped_blank := v_skipped_blank + 1;
        continue;
      end if;

      if v_row.source_order_no is null then
        -- design §2.1 allows this to be null in general (blank-SKU rows),
        -- but a NON-blank SKU row with no order number has nothing to join
        -- against and nothing sane to fall back to -> fail loud, not silent.
        update analytics.stg_order_line_import
          set import_status = 'error',
              error_detail = 'source_order_no is null on a non-blank SKU row'
          where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;

      perform 1 from analytics.fact_order fo
        where fo.shop_id = p_shop_id and fo.source_order_no = v_row.source_order_no;
      if not found then
        update analytics.stg_order_line_import
          set import_status = 'orphan',
              error_detail = 'no fact_order for source_order_no: ' || v_row.source_order_no
          where id = v_row.id;
        v_orphan := v_orphan + 1;
        continue;
      end if;
      -- else: leave 'pending' here -- resolved together with every other
      -- staging row for the same order in phase 2 below.
    exception
      when others then
        update analytics.stg_order_line_import
          set import_status = 'error', error_detail = sqlerrm
          where id = v_row.id;
        v_errored := v_errored + 1;
    end;
  end loop;

  -- Phase 2: rebuild fact_order_item for every order phase 1 confirmed a
  -- match for, sourced from ALL staging rows for that order (any batch).
  for v_fo in
    select distinct fo.id as fact_order_id, fo.source_order_no
    from analytics.stg_order_line_import s
    join analytics.fact_order fo
      on fo.shop_id = p_shop_id and fo.source_order_no = s.source_order_no
    where s.shop_id = p_shop_id
      and s.batch_id = p_batch_id
      and s.import_status = 'pending'
      and s.sku_raw is not null
  loop
    delete from analytics.fact_order_item where fact_order_id = v_fo.fact_order_id;

    v_cogs := 0;
    for v_item in
      select *
      from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id
        and s.source_order_no = v_fo.source_order_no
        and s.sku_raw is not null
        and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null;
        v_unit_cost := null;
        -- v_dim_product.effective_unit_cost (0028): fixed manual cost or
        -- computed spot cost as of NOW -- locks in the cost snapshot at
        -- transform time (design §3: "ล็อกต้นทุน ณ วันนำเข้า").
        select vp.product_id, vp.effective_unit_cost into v_product_id, v_unit_cost
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          -- unknown SKU (design §7 decision 4): still transformed, cost
          -- treated as 0 in the cogs sum below, surfaces via
          -- v_sku_order_alert (0031, "reason='unknown'") automatically.
          v_unknown := v_unknown + 1;
        end if;

        insert into analytics.fact_order_item (
          shop_id, fact_order_id, product_id, sku_snapshot, product_name_snapshot,
          qty, unit_price, unit_cost_snapshot
        ) values (
          p_shop_id, v_fo.fact_order_id, v_product_id, v_item.sku_raw, v_item.product_name_raw,
          coalesce(v_item.qty, 1), coalesce(v_item.unit_price, 0), v_unit_cost
        )
        returning id into v_new_item_id;

        update analytics.stg_order_line_import
          set fact_order_item_id = v_new_item_id,
              import_status = 'transformed',
              error_detail = null
          where id = v_item.id;
        v_transformed := v_transformed + 1;

        v_cogs := v_cogs + coalesce(v_item.qty, 1) * coalesce(v_unit_cost, 0);
      exception
        when others then
          -- isolate a single bad line (e.g. qty<=0 tripping
          -- fact_order_item's check constraint) so it doesn't abort the
          -- whole batch's transaction -- every other order/item already
          -- processed in this call stays committed.
          update analytics.stg_order_line_import
            set import_status = 'error', error_detail = sqlerrm
            where id = v_item.id;
          v_errored := v_errored + 1;
      end;
    end loop;

    -- design §3: revenue stays the order-level authoritative figure; only
    -- cogs is upgraded from guessed to actual, profit derives from it.
    update analytics.fact_order
      set cogs = v_cogs,
          profit = round(revenue - v_cogs, 2),
          profit_status = 'actual'
      where id = v_fo.fact_order_id;
  end loop;

  return query select v_transformed, v_orphan, v_skipped_blank, v_unknown, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

-- ============================================================================
-- 3. HAZARD FIX (design §4, "สำคัญสุด") — transform_pending_orders currently
--    (0040's body) ALWAYS sets profit_status='estimated' + a guessed profit
--    on re-import, even for an order that already has actual, line-item-
--    derived profit. Re-importing an order-level file after line-items have
--    been transformed would silently downgrade real profit back to a guess.
--
--    Body below is 0040's transform_pending_orders BYTE-IDENTICAL except the
--    ON CONFLICT ... DO UPDATE SET block, marked "-- 0041:" at every changed
--    line. All of 0040's own "-- 0040:" markers are left untouched (proof
--    the rest of the body wasn't touched). Coordinator: diff this function
--    body against 0040's to confirm only that block moved.
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
        shipping_cost_shop = excluded.shipping_cost_shop,
        -- 0041: HAZARD FIX (design §4) — an order that already has real,
        -- line-item-derived profit must NEVER be downgraded back to a guess
        -- by a plain order-level re-import. Only an order still 'estimated'
        -- gets the placeholder refreshed; an 'actual' order keeps that
        -- status and recomputes profit from its NEW revenue against its
        -- EXISTING (untouched) cogs instead of overwriting it.
        profit_status = case when analytics.fact_order.profit_status = 'actual'
                             then 'actual' else 'estimated' end,
        profit = case when analytics.fact_order.profit_status = 'actual'
                      then round(excluded.revenue - analytics.fact_order.cogs, 2)
                      else round(excluded.revenue * 0.10, 2) end,
        cogs = analytics.fact_order.cogs,
        -- 0041: end HAZARD FIX block
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
-- 4. Grants. stg_order_line_import is written directly by the service client
--    (upsert from lib/actions/import-line-items.ts, mirroring
--    stg_order_import's pattern in import-orders.ts) — not just through a
--    SECURITY DEFINER proc — so, unlike 0028/0036/0040's view-only re-grants,
--    this needs actual DML privilege for service_role, not just SELECT.
--    0018's `alter default privileges ... grant all on tables to
--    service_role` should in theory cover this automatically, but 0036/0040
--    both needed an explicit re-grant for their new objects despite that
--    same default-privileges statement already being in place — so this
--    migration doesn't rely on it either, same defensive pattern.
-- ============================================================================

grant all on analytics.stg_order_line_import to service_role;
grant select on analytics.stg_order_line_import to authenticated;

notify pgrst, 'reload schema';
