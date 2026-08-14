-- 0038_oversold_followup.sql
-- Oversold-hold follow-up queue (COO 9.9 ops-plan-99.md §6). A live quick-order
-- that can't reserve enough stock lands in public.orders with status
-- 'oversold_hold'. This surfaces those held orders in one queue + tracks the
-- HUMAN follow-up (contacted? what was offered? resolved?) so nothing slips the
-- 48h SLA. Deliberately does NOT change order status or stock — the actual
-- cancel/refund/fulfil still goes through the existing OMS order flow (order
-- state machine + reserve/commit/release RPCs). This is annotation only.

-- ============================================================================
-- 1. oversold_followup — one follow-up record per held order (annotation).
-- ============================================================================

create table analytics.oversold_followup (
  order_id uuid primary key references public.orders (id) on delete cascade,
  shop_id uuid not null references public.shop (id) on delete cascade,
  contact_status text not null default 'pending'
    check (contact_status in ('pending', 'contacted', 'resolved')),
  resolution text check (resolution in ('restock', 'swap', 'refund', 'other')),
  note text,
  handled_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table analytics.oversold_followup enable row level security;

create policy tenant_isolation_select on analytics.oversold_followup
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

create policy owner_admin_write on analytics.oversold_followup
  for all
  using (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')))
  with check (shop_id in (
    select shop_id from public.shop_member where user_id = auth.uid() and role in ('owner', 'admin')));

-- ============================================================================
-- 2. v_oversold_hold_queue — held orders + their follow-up, oldest first.
--    security_invoker. buyer_name/phone are order PII — the page is owner/admin
--    gated (contacting the buyer is the whole point).
-- ============================================================================

create or replace view analytics.v_oversold_hold_queue
  with (security_invoker = true) as
select
  o.id as order_id,
  o.shop_id,
  o.external_order_id,
  o.buyer_name,
  o.buyer_phone,
  o.total_amount,
  o.live_session_id,
  coalesce(o.placed_at, o.created_at) as placed_at,
  (select count(*) from public.order_item oi where oi.order_id = o.id) as item_count,
  round(extract(epoch from (now() - coalesce(o.placed_at, o.created_at))) / 3600.0, 1) as hours_held,
  coalesce(f.contact_status, 'pending') as contact_status,
  f.resolution,
  f.note,
  f.updated_at as followup_updated_at
from public.orders o
left join analytics.oversold_followup f on f.order_id = o.id
where o.status = 'oversold_hold';

-- ============================================================================
-- 3. RPC (SECURITY DEFINER + crm_require_owner_admin gate) — upsert follow-up.
--    Verifies the order belongs to the shop AND is actually oversold_hold
--    (IDOR + sanity: can't annotate another shop's or a non-held order).
-- ============================================================================

create or replace function analytics.oversold_followup_upsert(
  p_order_id uuid,
  p_shop_id uuid,
  p_contact_status text,
  p_resolution text default null,
  p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_order_id is null or p_shop_id is null then
    raise exception 'oversold_followup_upsert: p_order_id and p_shop_id are required';
  end if;
  if p_contact_status not in ('pending', 'contacted', 'resolved') then
    raise exception 'oversold_followup_upsert: invalid contact_status';
  end if;
  if p_resolution is not null and p_resolution not in ('restock', 'swap', 'refund', 'other') then
    raise exception 'oversold_followup_upsert: invalid resolution';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if not exists (
    select 1 from public.orders
    where id = p_order_id and shop_id = p_shop_id and status = 'oversold_hold'
  ) then
    raise exception 'oversold_followup_upsert: order % not found / not oversold_hold in shop', p_order_id
      using errcode = 'P0002';
  end if;

  insert into analytics.oversold_followup (order_id, shop_id, contact_status, resolution, note, handled_by, updated_at)
  values (p_order_id, p_shop_id, p_contact_status, p_resolution,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (order_id) do update set
    contact_status = excluded.contact_status,
    resolution = excluded.resolution,
    note = excluded.note,
    handled_by = excluded.handled_by,
    updated_at = now();
end;
$$;

revoke execute on function analytics.oversold_followup_upsert(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function analytics.oversold_followup_upsert(uuid, uuid, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 4. Grants — cover the new table + view.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
