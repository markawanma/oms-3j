-- 0021_crm_b2a_write.sql
-- Phase B2a (CRM write foundation) — DB layer only, per:
--   docs/3j-jewelry/analytics/phase-b-crm-design.md
--     §0 (raw never touched directly, all human edits via override/audit tables
--         + RPC security definer) · §2.1 (override layer) · §2.2 (notes)
--     §2.3 (audit log) · §2.7 (RLS tier) · Decisions LOCKED (Q1 override, Q7 no
--     new staff role)
--
-- Scope of this file (backend-dev / Han Solo):
--   1. crm_audit_log — append-only, owner/admin SELECT only, no write policy
--      at all (write path = RPC, security definer, same transaction as the
--      mutation it's logging).
--   2. crm_order_override — jsonb override layer keyed on fact_order_id, plus
--      the analytics.v_fact_order swap from the 0020 passthrough to an
--      override-aware view (marts downstream already read v_fact_order, not
--      fact_order directly, so this swap is transparent to them).
--   3. crm_customer_note.
--   4. dim_customer.profile_source + transform proc patch so a manually-edited
--      customer name never gets silently reverted by the next import.
--   5. RPC set: crm_set_order_override / crm_clear_order_override /
--      crm_edit_customer / crm_edit_pii / crm_add_note / crm_edit_note /
--      crm_delete_note — every one of these is the ONLY legal write path into
--      its table (no direct insert/update/delete RLS policy exists for any of
--      the tables above); each does its own owner/admin membership check
--      in-function (helper below) rather than relying on RLS to gate writes,
--      because RLS on these tables intentionally has no write policy to check.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. dim_customer.profile_source (§2.1 tail) — added before the tables below
--    so nothing downstream references a column that doesn't exist yet.
-- ============================================================================

alter table analytics.dim_customer
  add column if not exists profile_source text not null default 'import'
    check (profile_source in ('import', 'manual'));

comment on column analytics.dim_customer.profile_source is
  'import = ELT/transform owns display_name (safe to overwrite on re-import). '
  'manual = a human edited it via crm_edit_customer — transform_pending_orders '
  'must never overwrite display_name/pii_customer.full_name again for this row.';

-- ============================================================================
-- 2. crm_audit_log (§2.3) — append-only, before/after may carry PII (pii_edit)
-- ============================================================================

create table analytics.crm_audit_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (
    action in (
      'order_override_set', 'order_override_clear', 'customer_edit',
      'pii_edit', 'note_add', 'note_edit', 'note_delete'
    )
  ),
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index idx_crm_audit_log_shop_entity_created
  on analytics.crm_audit_log (shop_id, entity_type, entity_id, created_at desc);

alter table analytics.crm_audit_log enable row level security;

-- SELECT = owner/admin only (before/after may contain PII, e.g. pii_edit).
create policy owner_admin_select on analytics.crm_audit_log
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Deliberately NO insert/update/delete policy for any role — writes happen
-- exclusively inside the SECURITY DEFINER RPCs below, in the same transaction
-- as the mutation they're logging. authenticated has no direct write path.

-- ============================================================================
-- 3. crm_order_override (§2.1) — override layer of fact_order
-- ============================================================================

create table analytics.crm_order_override (
  fact_order_id uuid primary key references analytics.fact_order (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  overrides jsonb not null,
  reason text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index idx_crm_order_override_shop_id on analytics.crm_order_override (shop_id);

alter table analytics.crm_order_override enable row level security;

create policy tenant_isolation_select on analytics.crm_order_override
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- No direct write policy — crm_set_order_override / crm_clear_order_override
-- (SECURITY DEFINER) are the only write path; the whitelist check on
-- `overrides` keys lives in those RPCs, not here (jsonb has no column-level
-- CHECK to enforce it at the table level).

-- ============================================================================
-- 4. crm_customer_note (§2.2)
-- ============================================================================

create table analytics.crm_customer_note (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  customer_id uuid not null references analytics.dim_customer (id) on delete cascade,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_crm_customer_note_shop_customer_created
  on analytics.crm_customer_note (shop_id, customer_id, created_at desc);

create trigger trg_crm_customer_note_updated_at
  before update on analytics.crm_customer_note
  for each row execute function public.set_updated_at();

alter table analytics.crm_customer_note enable row level security;

create policy tenant_isolation_select on analytics.crm_customer_note
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- No direct write policy — crm_add_note / crm_edit_note / crm_delete_note only.

-- ============================================================================
-- 5. v_fact_order swap (§2.1) — passthrough (0020) -> override-aware view.
--    Column set is unchanged from analytics.fact_order plus one addition
--    (is_edited) so marts (v_customer_master, v_rfm_segment, v_customer_ltv,
--    v_channel_perf_monthly — all already SELECT * / named-column reads
--    against v_fact_order, never fact_order directly) keep working unmodified
--    and automatically inherit overrides + the recomputed profit.
-- ============================================================================

create or replace view analytics.v_fact_order
  with (security_invoker = true) as
select
  fo.id,
  fo.shop_id,
  fo.oms_order_id,
  fo.source_order_no,
  fo.customer_id,
  coalesce((ov.overrides ->> 'channel_id')::uuid, fo.channel_id) as channel_id,
  fo.campaign_id_first,
  fo.campaign_id_last,
  coalesce((ov.overrides ->> 'order_date')::date, fo.order_date) as order_date,
  fo.paid_at,
  fo.printed_at,
  fo.ship_date,
  fo.estimated_delivery_date,
  coalesce(ov.overrides ->> 'province_code', fo.province_code) as province_code,
  fo.carrier_code,
  fo.tracking_no,
  fo.item_count,
  -- cast overrides to numeric(12,2) to MATCH fact_order's column types: `create
  -- or replace view` refuses to change an existing column type, and a bare
  -- ::numeric widens to unconstrained precision.
  coalesce((ov.overrides ->> 'revenue')::numeric(12, 2), fo.revenue) as revenue,
  coalesce((ov.overrides ->> 'discount')::numeric(12, 2), fo.discount) as discount,
  fo.shipping_fee_customer,
  fo.shipping_cost_shop,
  fo.cogs,
  -- Profit is recomputed from the (possibly overridden) revenue, not carried
  -- over from fo.profit as-is: if an admin corrects revenue, the 20%-margin
  -- estimate must follow it, otherwise profit/LTV would silently drift out of
  -- sync with the number actually shown as "revenue" everywhere else.
  case when fo.profit_status = 'estimated'
    then round(coalesce((ov.overrides ->> 'revenue')::numeric(12, 2), fo.revenue) * 0.20, 2)::numeric(12, 2)
    else fo.profit end as profit,
  fo.profit_status,
  fo.payment_method,
  coalesce(ov.overrides ->> 'bank', fo.bank) as bank,
  fo.is_new_customer,
  -- tags override is a JSON array of strings (whitelist key `tags`); when the
  -- override row/key is absent, jsonb_array_elements_text(null) yields zero
  -- rows (strict SRF on NULL input), so array_agg(...) is NULL and coalesce
  -- falls through to fo.tags exactly as before B2.
  coalesce(
    (select array_agg(t) from jsonb_array_elements_text(ov.overrides -> 'tags') as t),
    fo.tags
  ) as tags,
  fo.created_at,
  fo.updated_at,
  (ov.fact_order_id is not null) as is_edited
from analytics.fact_order fo
left join analytics.crm_order_override ov on ov.fact_order_id = fo.id;

-- ============================================================================
-- 6. transform_pending_orders patch — respect profile_source = 'manual'
--    (§2.1 tail). Identical to 0020's version (profit 20%, error_code,
--    case-insensitive channel_raw lookup) except the two upserts inside the
--    phone-present branch now check profile_source before touching
--    display_name / pii_customer.full_name.
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

      v_phone_norm := analytics.normalize_th_phone(v_row.phone_raw);

      if v_phone_norm is not null then
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
      else
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

      -- province via dim_geo_alias (Shipnity spelling + ISO en/th) -> code, TH-XX fallback
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
        shipping_fee_customer, shipping_cost_shop, profit, profit_status, bank, tags, is_new_customer
      ) values (
        p_shop_id, v_row.source_order_no, v_customer_id, v_channel_id, v_order_date, v_row.paid_at, v_row.printed_at,
        v_province_code, v_row.carrier_raw, v_row.tracking_no, v_row.item_count_total, coalesce(v_row.revenue, 0), coalesce(v_row.discount_total, 0),
        v_row.shipping_fee_customer, v_row.shipping_cost_shop, round(coalesce(v_row.revenue, 0) * 0.20, 2), 'estimated', v_row.bank_raw, v_tags, v_is_new_customer
      )
      on conflict (shop_id, source_order_no) do update set
        customer_id = excluded.customer_id, channel_id = excluded.channel_id, order_date = excluded.order_date,
        paid_at = excluded.paid_at, printed_at = excluded.printed_at, province_code = excluded.province_code,
        carrier_code = excluded.carrier_code, tracking_no = excluded.tracking_no, item_count = excluded.item_count,
        revenue = excluded.revenue, discount = excluded.discount, shipping_fee_customer = excluded.shipping_fee_customer,
        shipping_cost_shop = excluded.shipping_cost_shop, profit = excluded.profit, profit_status = excluded.profit_status,
        bank = excluded.bank, tags = excluded.tags, updated_at = now()
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
-- 7. RPCs — all SECURITY DEFINER, pinned search_path, revoke public/anon/
--    authenticated then grant authenticated (+ service_role) explicitly,
--    because each RPC does its own owner/admin membership check in-body
--    instead of relying on a table RLS write policy (none exists for these
--    tables — see §2/§3/§4 above).
-- ============================================================================

-- Shared helper: raises if the calling user is not owner/admin of p_shop_id.
-- Kept as its own SECURITY DEFINER function (not inlined) so every RPC below
-- enforces the exact same rule the same way — one place to fix if the
-- membership check ever changes.
create or replace function analytics.crm_require_owner_admin(p_shop_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null then
    raise exception 'crm_require_owner_admin: p_shop_id is required';
  end if;
  -- Trusted server path: the service_role key is server-only (never exposed to
  -- the browser), already bypasses RLS, and the app layer does its own
  -- owner/admin gate (getDevRole) until real auth ships. Authenticated end users
  -- still go through the membership check below. When real auth lands and the
  -- app moves off the service client, this short-circuit stops applying to them.
  if auth.role() = 'service_role' then
    return;
  end if;
  if not exists (
    select 1 from public.shop_member
    where shop_id = p_shop_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) then
    raise exception 'crm: caller is not owner/admin of shop %', p_shop_id using errcode = '42501';
  end if;
end;
$$;

revoke execute on function analytics.crm_require_owner_admin(uuid) from public, anon, authenticated;
grant execute on function analytics.crm_require_owner_admin(uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- crm_set_order_override — upsert + audit. Whitelist enforced here (jsonb has
-- no column-level CHECK): channel_id, province_code, revenue, discount, tags,
-- order_date, bank. Any other key raises.
-- --------------------------------------------------------------------------
create or replace function analytics.crm_set_order_override(
  p_fact_order_id uuid,
  p_overrides jsonb,
  p_reason text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before jsonb;
  v_key text;
  v_whitelist text[] := array['channel_id', 'province_code', 'revenue', 'discount', 'tags', 'order_date', 'bank'];
begin
  if p_fact_order_id is null or p_overrides is null then
    raise exception 'crm_set_order_override: p_fact_order_id and p_overrides are required';
  end if;
  if jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'crm_set_order_override: p_overrides must be a JSON object';
  end if;

  select shop_id into v_shop_id from analytics.fact_order where id = p_fact_order_id;
  if v_shop_id is null then
    raise exception 'crm_set_order_override: fact_order % not found', p_fact_order_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  for v_key in select jsonb_object_keys(p_overrides) loop
    if not (v_key = any (v_whitelist)) then
      raise exception 'crm_set_order_override: key "%" is not in the override whitelist', v_key;
    end if;
  end loop;

  select overrides into v_before from analytics.crm_order_override where fact_order_id = p_fact_order_id;

  insert into analytics.crm_order_override (fact_order_id, shop_id, overrides, reason, updated_by, updated_at)
  values (p_fact_order_id, v_shop_id, p_overrides, p_reason, auth.uid(), now())
  on conflict (fact_order_id) do update set
    overrides = excluded.overrides,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (v_shop_id, auth.uid(), 'order_override_set', 'fact_order', p_fact_order_id, v_before, p_overrides);
end;
$$;

revoke execute on function analytics.crm_set_order_override(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function analytics.crm_set_order_override(uuid, jsonb, text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- crm_clear_order_override — delete + audit (before = the override that
-- existed, after = null).
-- --------------------------------------------------------------------------
create or replace function analytics.crm_clear_order_override(p_fact_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before jsonb;
begin
  if p_fact_order_id is null then
    raise exception 'crm_clear_order_override: p_fact_order_id is required';
  end if;

  select shop_id, overrides into v_shop_id, v_before
    from analytics.crm_order_override where fact_order_id = p_fact_order_id;
  if v_shop_id is null then
    raise exception 'crm_clear_order_override: no override exists for fact_order %', p_fact_order_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  delete from analytics.crm_order_override where fact_order_id = p_fact_order_id;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (v_shop_id, auth.uid(), 'order_override_clear', 'fact_order', p_fact_order_id, v_before, null);
end;
$$;

revoke execute on function analytics.crm_clear_order_override(uuid) from public, anon, authenticated;
grant execute on function analytics.crm_clear_order_override(uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- crm_edit_customer — dim_customer.display_name is edited directly (not via
-- override layer, §2.1 tail); flips profile_source to 'manual' so the next
-- import never reverts it.
-- --------------------------------------------------------------------------
create or replace function analytics.crm_edit_customer(p_customer_id uuid, p_display_name text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_old_name text;
  v_old_source text;
begin
  if p_customer_id is null then
    raise exception 'crm_edit_customer: p_customer_id is required';
  end if;

  select shop_id, display_name, profile_source into v_shop_id, v_old_name, v_old_source
    from analytics.dim_customer where id = p_customer_id and merged_into_id is null;
  if v_shop_id is null then
    raise exception 'crm_edit_customer: customer % not found (or already merged)', p_customer_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  update analytics.dim_customer
    set display_name = p_display_name, profile_source = 'manual', updated_at = now()
    where id = p_customer_id;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    v_shop_id, auth.uid(), 'customer_edit', 'dim_customer', p_customer_id,
    jsonb_build_object('display_name', v_old_name, 'profile_source', v_old_source),
    jsonb_build_object('display_name', p_display_name, 'profile_source', 'manual')
  );
end;
$$;

revoke execute on function analytics.crm_edit_customer(uuid, text) from public, anon, authenticated;
grant execute on function analytics.crm_edit_customer(uuid, text) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- crm_edit_pii — owner/admin only (crm_require_owner_admin already enforces
-- that; called out explicitly per design because this is the PII path).
-- before/after in the audit row carry raw PII — crm_audit_log SELECT is
-- already owner/admin-only (§2), so this doesn't widen exposure.
-- --------------------------------------------------------------------------
create or replace function analytics.crm_edit_pii(
  p_customer_id uuid,
  p_phone_e164 text,
  p_full_name text,
  p_address jsonb
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before jsonb;
begin
  if p_customer_id is null then
    raise exception 'crm_edit_pii: p_customer_id is required';
  end if;

  select shop_id into v_shop_id
    from analytics.dim_customer where id = p_customer_id and merged_into_id is null;
  if v_shop_id is null then
    raise exception 'crm_edit_pii: customer % not found (or already merged)', p_customer_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  select to_jsonb(pc) - 'customer_id' - 'shop_id' into v_before
    from analytics.pii_customer pc where pc.customer_id = p_customer_id;

  insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name, address, updated_at)
  values (p_customer_id, v_shop_id, p_phone_e164, p_full_name, p_address, now())
  on conflict (customer_id) do update set
    phone_e164 = excluded.phone_e164,
    full_name = excluded.full_name,
    address = excluded.address,
    updated_at = now();

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    v_shop_id, auth.uid(), 'pii_edit', 'pii_customer', p_customer_id,
    v_before,
    jsonb_build_object('phone_e164', p_phone_e164, 'full_name', p_full_name, 'address', p_address)
  );
end;
$$;

revoke execute on function analytics.crm_edit_pii(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function analytics.crm_edit_pii(uuid, text, text, jsonb) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- crm_add_note / crm_edit_note / crm_delete_note
-- --------------------------------------------------------------------------
create or replace function analytics.crm_add_note(p_customer_id uuid, p_body text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_note_id uuid;
begin
  if p_customer_id is null or p_body is null or trim(p_body) = '' then
    raise exception 'crm_add_note: p_customer_id and a non-empty p_body are required';
  end if;

  select shop_id into v_shop_id
    from analytics.dim_customer where id = p_customer_id and merged_into_id is null;
  if v_shop_id is null then
    raise exception 'crm_add_note: customer % not found (or already merged)', p_customer_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  insert into analytics.crm_customer_note (shop_id, customer_id, body, created_by)
  values (v_shop_id, p_customer_id, p_body, auth.uid())
  returning id into v_note_id;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (v_shop_id, auth.uid(), 'note_add', 'crm_customer_note', v_note_id, null, jsonb_build_object('body', p_body));

  return v_note_id;
end;
$$;

revoke execute on function analytics.crm_add_note(uuid, text) from public, anon, authenticated;
grant execute on function analytics.crm_add_note(uuid, text) to authenticated, service_role;

create or replace function analytics.crm_edit_note(p_note_id uuid, p_body text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before text;
begin
  if p_note_id is null or p_body is null or trim(p_body) = '' then
    raise exception 'crm_edit_note: p_note_id and a non-empty p_body are required';
  end if;

  select shop_id, body into v_shop_id, v_before
    from analytics.crm_customer_note where id = p_note_id;
  if v_shop_id is null then
    raise exception 'crm_edit_note: note % not found', p_note_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  update analytics.crm_customer_note set body = p_body, updated_at = now() where id = p_note_id;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    v_shop_id, auth.uid(), 'note_edit', 'crm_customer_note', p_note_id,
    jsonb_build_object('body', v_before), jsonb_build_object('body', p_body)
  );
end;
$$;

revoke execute on function analytics.crm_edit_note(uuid, text) from public, anon, authenticated;
grant execute on function analytics.crm_edit_note(uuid, text) to authenticated, service_role;

create or replace function analytics.crm_delete_note(p_note_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_shop_id uuid;
  v_before jsonb;
begin
  if p_note_id is null then
    raise exception 'crm_delete_note: p_note_id is required';
  end if;

  select shop_id into v_shop_id from analytics.crm_customer_note where id = p_note_id;
  if v_shop_id is null then
    raise exception 'crm_delete_note: note % not found', p_note_id;
  end if;

  perform analytics.crm_require_owner_admin(v_shop_id);

  select to_jsonb(n) into v_before from analytics.crm_customer_note n where n.id = p_note_id;

  delete from analytics.crm_customer_note where id = p_note_id;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (v_shop_id, auth.uid(), 'note_delete', 'crm_customer_note', p_note_id, v_before, null);
end;
$$;

revoke execute on function analytics.crm_delete_note(uuid) from public, anon, authenticated;
grant execute on function analytics.crm_delete_note(uuid) to authenticated, service_role;

-- ============================================================================
-- 8. Grants — new tables/view for this migration (crm_audit_log,
--    crm_order_override, crm_customer_note, v_fact_order re-create). RLS on
--    the underlying tables still does the real row-level filtering; this only
--    clears the outer "can you touch this relation at all" gate, same as
--    0020's re-run of this grant.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;
