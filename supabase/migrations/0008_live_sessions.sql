-- 0008_live_sessions.sql
-- "จดออเดอร์เร็วตอน TikTok Live" — Phase A backend per architect design.
-- TikTok-only, manual entry, reuses reserve_stock (0003/0005/0006) as-is —
-- no new stock-mutation path is introduced here.

-- ============================================================================
-- live_session
-- ============================================================================

create type live_session_status as enum ('open', 'closed');

create table live_session (
  id uuid primary key default gen_random_uuid(),
  -- Derived from channel_account_id (trigger below) — never set directly by
  -- the app, same defense-in-depth pattern as orders/order_item/shipment in
  -- 0001 (a caller can't accidentally/maliciously attach a session to a shop
  -- other than the one that owns the channel_account).
  shop_id uuid not null references shop (id) on delete cascade,
  channel_account_id uuid not null references channel_account (id) on delete restrict,
  title text not null default '',
  status live_session_status not null default 'open',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_live_session_ended_at check (
    (status = 'open' and ended_at is null) or
    (status = 'closed' and ended_at is not null)
  )
);

-- Only one open live session per shop at a time — startLiveSession() catches
-- the resulting unique_violation and surfaces a friendly Thai error.
create unique index uq_live_session_one_open_per_shop on live_session (shop_id)
  where status = 'open';

create index idx_live_session_shop_started on live_session (shop_id, started_at desc);

create or replace function sync_live_session_shop_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id from channel_account where id = new.channel_account_id;
  if v_shop_id is null then
    raise exception 'live_session: channel_account % not found', new.channel_account_id;
  end if;
  new.shop_id := v_shop_id;
  return new;
end;
$$;

create trigger trg_live_session_shop_id
  before insert or update of channel_account_id on live_session
  for each row execute function sync_live_session_shop_id();

create trigger trg_live_session_updated_at
  before update on live_session
  for each row execute function set_updated_at();

-- ============================================================================
-- orders.live_session_id
-- ============================================================================

alter table orders
  add column live_session_id uuid references live_session (id) on delete set null;

create index idx_orders_live_session_id on orders (live_session_id)
  where live_session_id is not null;

-- Guard against an order's live_session_id pointing at a session belonging to
-- a different shop than the order's own channel_account (mirrors the
-- product_mapping cross-tenant guard in 0001 — sync_product_mapping_shop_id).
-- Deliberately re-derives the order's shop from channel_account_id (not
-- new.shop_id) so this doesn't depend on trigger firing order relative to
-- trg_orders_shop_id on the same INSERT.
create or replace function validate_order_live_session_shop()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_shop_id uuid;
  v_session_shop_id uuid;
begin
  if new.live_session_id is null then
    return new;
  end if;

  select shop_id into v_order_shop_id from channel_account where id = new.channel_account_id;
  if v_order_shop_id is null then
    raise exception 'orders: channel_account % not found', new.channel_account_id;
  end if;

  select shop_id into v_session_shop_id from live_session where id = new.live_session_id;
  if v_session_shop_id is null then
    raise exception 'orders: live_session % not found', new.live_session_id;
  end if;

  if v_session_shop_id <> v_order_shop_id then
    raise exception
      'orders: live_session % (shop %) does not belong to the same shop as channel_account % (shop %)',
      new.live_session_id, v_session_shop_id, new.channel_account_id, v_order_shop_id;
  end if;

  return new;
end;
$$;

create trigger trg_orders_live_session_shop
  before insert or update of live_session_id, channel_account_id on orders
  for each row execute function validate_order_live_session_shop();

-- ============================================================================
-- v_live_session_stats
--
-- security_invoker=true (PG15): the view runs with the *querying role's* own
-- privileges/RLS, not the view owner's — consistent with every other
-- read path in this schema going through RLS (or, in this MVP, the
-- service-role client with an explicit shop_id filter). Without this the
-- view would silently bypass the tenant_isolation_select policies on
-- live_session/orders/order_item.
--
-- DECISION (Tech Lead call, per task instructions): oversold_hold orders are
-- excluded from gmv (a hold on insufficient stock never actually sold
-- anything) but ARE surfaced via the separate oversold_count column so the
-- seller can see how many buyers need a manual follow-up. cancelled orders
-- are excluded from every metric (order_count, oversold_count via the status
-- filter, gmv, units_sold) — a cancelled order never happened from a
-- reporting point of view.
-- ============================================================================

create view v_live_session_stats
with (security_invoker = true) as
select
  ls.id as live_session_id,
  ls.shop_id,
  ls.channel_account_id,
  ls.title,
  ls.status,
  ls.started_at,
  ls.ended_at,
  count(o.id) filter (where o.status <> 'cancelled') as order_count,
  count(o.id) filter (where o.status = 'oversold_hold') as oversold_count,
  coalesce(
    sum(o.total_amount) filter (where o.status not in ('cancelled', 'oversold_hold')),
    0
  ) as gmv,
  coalesce(
    (
      select sum(oi.qty)
      from order_item oi
      join orders oo on oo.id = oi.order_id
      where oo.live_session_id = ls.id
        and oo.status not in ('cancelled', 'oversold_hold')
    ),
    0
  ) as units_sold,
  round(
    extract(epoch from (coalesce(ls.ended_at, now()) - ls.started_at)) / 3600.0,
    2
  ) as duration_hours
from live_session ls
left join orders o on o.live_session_id = ls.id
group by ls.id, ls.shop_id, ls.channel_account_id, ls.title, ls.status, ls.started_at, ls.ended_at;

grant select on v_live_session_stats to authenticated;

-- ============================================================================
-- RLS — live_session
--
-- Follows the 0004 H3b pattern (orders/order_item/shipment): this table is
-- only ever written by trusted server-side code (lib/actions/live.ts +
-- quick-order.ts, using the service-role client) — there is no legitimate
-- end-user-initiated direct write path in this batch. `select`-only policy,
-- same posture as orders itself.
-- ============================================================================

alter table live_session enable row level security;

create policy tenant_isolation_select on live_session
  for select
  using (shop_id in (select shop_id from shop_member where user_id = auth.uid()));
