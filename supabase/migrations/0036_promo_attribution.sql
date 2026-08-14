-- 0036_promo_attribution.sql
-- Manual promo-code attribution log (e.g. "รับสิทธิ์99"). There is no automatic
-- tracking link for a LINE broadcast, so the owner logs each order whose buyer
-- typed the code in chat (per copywriter's 9.9 scripts + CMO plan §metric). This
-- is deliberately separate from analytics.dim_campaign (which models paid-ad /
-- UTM campaigns) — this is a lightweight owner-entered tally, not ad data.

-- ============================================================================
-- 1. Table — one row per logged order/sale attributed to a code.
-- ============================================================================

create table analytics.promo_attribution (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  occurred_on date not null default current_date,
  amount numeric(12, 2) not null check (amount >= 0),
  channel_id uuid references analytics.dim_channel (id) on delete set null,
  customer_ref text,   -- free text: ชื่อ/LINE handle (optional, no PII constraint)
  note text,
  logged_by uuid references auth.users (id) on delete set null,
  logged_at timestamptz not null default now()
);

create index idx_promo_attr_shop_code on analytics.promo_attribution (shop_id, code);

alter table analytics.promo_attribution enable row level security;

create policy tenant_isolation_select on analytics.promo_attribution
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_insert on analytics.promo_attribution
  for insert
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

create policy owner_admin_delete on analytics.promo_attribution
  for delete
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 2. Rollup view — per code totals for the "how much did the broadcast drive"
--    readout. security_invoker.
-- ============================================================================

create or replace view analytics.v_promo_attribution_summary
  with (security_invoker = true) as
select
  shop_id,
  code,
  count(*) as entries,
  sum(amount) as total_amount,
  round(avg(amount), 2) as avg_amount,
  min(occurred_on) as first_on,
  max(occurred_on) as last_on
from analytics.promo_attribution
group by shop_id, code;

-- ============================================================================
-- 3. RPCs (SECURITY DEFINER + crm_require_owner_admin gate) — add / delete.
-- ============================================================================

create or replace function analytics.promo_attribution_add(
  p_shop_id uuid,
  p_code text,
  p_amount numeric,
  p_occurred_on date default current_date,
  p_channel_id uuid default null,
  p_customer_ref text default null,
  p_note text default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if p_shop_id is null or p_code is null or btrim(p_code) = '' then
    raise exception 'promo_attribution_add: p_shop_id and p_code are required';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'promo_attribution_add: p_amount must be >= 0';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  insert into analytics.promo_attribution
    (shop_id, code, amount, occurred_on, channel_id, customer_ref, note, logged_by)
  values
    (p_shop_id, btrim(p_code), p_amount, coalesce(p_occurred_on, current_date),
     p_channel_id, nullif(btrim(coalesce(p_customer_ref, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function analytics.promo_attribution_add(uuid, text, numeric, date, uuid, text, text)
  from public, anon, authenticated;
grant execute on function analytics.promo_attribution_add(uuid, text, numeric, date, uuid, text, text)
  to authenticated, service_role;

create or replace function analytics.promo_attribution_delete(
  p_id uuid,
  p_shop_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_id is null or p_shop_id is null then
    raise exception 'promo_attribution_delete: p_id and p_shop_id are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  delete from analytics.promo_attribution where id = p_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.promo_attribution_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.promo_attribution_delete(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 4. Grants — cover the new table + view.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
