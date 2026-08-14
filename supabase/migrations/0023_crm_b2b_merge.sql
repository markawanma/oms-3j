-- 0023_crm_b2b_merge.sql
-- Phase B2b (CRM customer merge) — DB layer only, per:
--   docs/3j-jewelry/analytics/phase-b-crm-design.md
--     §3 (Merge Flow) · Decisions LOCKED Q4 (manual confirm + remember every
--     verdict, both "merged" and "not_same", so the candidate queue never
--     re-surfaces a pair a human already ruled on)
--
-- Scope of this file (backend-dev / Han Solo):
--   1. crm_merge_decision — remembers every decided pair (merged or not_same).
--   2. analytics.crm_normalize_customer_name() — shared name-normalization
--      helper for the "medium"/"low" confidence tiers below.
--   3. analytics.v_merge_candidate — candidate queue view, confidence-ranked,
--      excludes pairs already in crm_merge_decision.
--   4. RPC analytics.crm_merge_customer(p_shop_id, p_survivor_id, p_victim_id)
--      — security definer, atomic repoint + soft-delete + decision + audit.
--   5. RPC analytics.crm_dismiss_merge_candidate(p_shop_id, p_customer_a,
--      p_customer_b) — records verdict='not_same' + audit, no data mutation.
--   6. ALTER analytics.crm_audit_log's action CHECK to add 'customer_merge'
--      and 'merge_dismiss' (kept all 7 existing values from 0021 verbatim).
--   7. Grants.
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. crm_audit_log.action CHECK — add customer_merge / merge_dismiss
--
-- ASSUMPTION: the check constraint on analytics.crm_audit_log.action was
-- declared inline in 0021 (`action text not null check (action in (...))`)
-- with no explicit CONSTRAINT name, so Postgres auto-named it using its
-- default `<table>_<column>_check` convention:
-- `crm_audit_log_action_check`. Tech Lead: please confirm the actual name via
-- `\d analytics.crm_audit_log` (or pg_constraint) before applying — if it
-- differs, this DROP is a silent no-op and the ADD below will then fail with
-- "constraint already exists" instead of quietly leaving two constraints.
-- ============================================================================

alter table analytics.crm_audit_log
  drop constraint if exists crm_audit_log_action_check;

alter table analytics.crm_audit_log
  add constraint crm_audit_log_action_check check (
    action in (
      -- verbatim from 0021 (do not reorder/drop — existing rows depend on these)
      'order_override_set', 'order_override_clear', 'customer_edit',
      'pii_edit', 'note_add', 'note_edit', 'note_delete',
      -- new in this migration (§3)
      'customer_merge', 'merge_dismiss'
    )
  );

-- ============================================================================
-- 2. crm_merge_decision (§3, Decision Q4) — append-ish table (RPCs upsert on
--    the normalized pair so a later re-decision on the same pair overwrites
--    the verdict rather than creating a duplicate row).
--
-- Pair normalization: customer_a is ALWAYS the smaller uuid, customer_b the
-- larger (enforced by chk_crm_merge_decision_ordered below) — both write RPCs
-- compute least()/greatest() before insert, so "A,B" and "B,A" always land on
-- the same row and uq_crm_merge_decision_pair can never be bypassed by a
-- caller passing the pair in the opposite order.
-- ============================================================================

create table analytics.crm_merge_decision (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  customer_a uuid not null references analytics.dim_customer (id) on delete cascade,
  customer_b uuid not null references analytics.dim_customer (id) on delete cascade,
  verdict text not null check (verdict in ('merged', 'not_same')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint chk_crm_merge_decision_ordered check (customer_a < customer_b)
);

create unique index uq_crm_merge_decision_pair
  on analytics.crm_merge_decision (shop_id, customer_a, customer_b);

create index idx_crm_merge_decision_shop_id on analytics.crm_merge_decision (shop_id);

alter table analytics.crm_merge_decision enable row level security;

create policy tenant_isolation_select on analytics.crm_merge_decision
  for select
  using (shop_id in (select shop_id from public.shop_member where user_id = auth.uid()));

-- No direct write policy — crm_merge_customer / crm_dismiss_merge_candidate
-- (both SECURITY DEFINER below) are the only write path, same pattern as
-- every other CRM write table since 0021.

-- ============================================================================
-- 3. analytics.crm_normalize_customer_name() — shared helper for the
--    "medium"/"low" confidence tiers of v_merge_candidate (§3): lower + trim +
--    strip a leading Thai honorific (คุณ/นาย/นาง/นางสาว/น.ส.). Returns NULL
--    for blank/null input so callers can filter those out (blank names should
--    never confidence-match on "name equality").
-- ============================================================================

create or replace function analytics.crm_normalize_customer_name(p_name text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select nullif(
    regexp_replace(
      lower(trim(coalesce(p_name, ''))),
      '^(คุณ|นางสาว|นาง|นาย|น\.ส\.)\s*',
      ''
    ),
    ''
  )
$$;

revoke execute on function analytics.crm_normalize_customer_name(text) from public, anon, authenticated;
grant execute on function analytics.crm_normalize_customer_name(text) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.v_merge_candidate (§3) — candidate queue, confidence-ranked.
--
-- Join shape note (perf, per task brief's explicit warning): this is a
-- same-shop self-join of dim_customer (master rows only), NOT a cross join —
-- `b.shop_id = a.shop_id and b.id > a.id` is the join condition, which also
-- guarantees each unordered pair appears exactly once (no A-B/B-A duplicate,
-- no self-pair). At today's ~310 master rows/shop that's a worst case of
-- ~48k candidate row-pairs evaluated inside the view before the confidence
-- CASE/WHERE filters almost all of them out — fine at this scale per
-- architect's note; revisit (e.g. restrict the name-only join to customers
-- sharing a first name-normalize prefix) if a shop grows an order of
-- magnitude and this view gets slow.
--
-- Confidence tiers (§3, highest first):
--   high   — dim_customer_identity has the same (identity_type,
--            identity_value_norm) pointing at two different customer_ids in
--            the same shop. NOTE: under the current uq_dim_customer_identity
--            index (shop_id, identity_type, identity_value_norm) — which does
--            NOT include customer_id — this case should be structurally rare
--            today (the transform's ON CONFLICT re-points an existing
--            identity row to the new customer_id rather than leaving a
--            duplicate). Kept per design spec anyway: it's cheap to evaluate
--            and covers any future identity-writing path that doesn't use
--            that same upsert pattern.
--   medium — normalized display_name matches AND both sides' most recent
--            order province matches.
--   low    — normalized display_name matches, nothing else.
--
-- Excludes any pair already recorded in crm_merge_decision (either verdict) —
-- Decision Q4's "candidate queue ไม่เด้งคู่ที่ตัดสินแล้วซ้ำ".
-- ============================================================================

create or replace view analytics.v_merge_candidate
  with (security_invoker = true) as
with pairs as (
  select
    a.shop_id,
    a.id as customer_a_id,
    b.id as customer_b_id,
    case
      when exists (
        select 1
        from analytics.dim_customer_identity ia
        join analytics.dim_customer_identity ib
          on ib.shop_id = ia.shop_id
         and ib.identity_type = ia.identity_type
         and ib.identity_value_norm = ia.identity_value_norm
         and ib.customer_id = b.id
        where ia.customer_id = a.id
      ) then 'high'
      when analytics.crm_normalize_customer_name(a.display_name) is not null
        and analytics.crm_normalize_customer_name(a.display_name)
          = analytics.crm_normalize_customer_name(b.display_name)
        and pa.province_code is not null
        and pa.province_code = pb.province_code
      then 'medium'
      when analytics.crm_normalize_customer_name(a.display_name) is not null
        and analytics.crm_normalize_customer_name(a.display_name)
          = analytics.crm_normalize_customer_name(b.display_name)
      then 'low'
      else null
    end as confidence
  from analytics.dim_customer a
  join analytics.dim_customer b
    on b.shop_id = a.shop_id
   and b.id > a.id
   and b.merged_into_id is null
  left join lateral (
    select fo.province_code
    from analytics.v_fact_order fo
    where fo.customer_id = a.id
    order by fo.order_date desc
    limit 1
  ) pa on true
  left join lateral (
    select fo.province_code
    from analytics.v_fact_order fo
    where fo.customer_id = b.id
    order by fo.order_date desc
    limit 1
  ) pb on true
  where a.merged_into_id is null
)
select
  p.shop_id,
  p.customer_a_id,
  ca.display_name as customer_a_name,
  ida.identities as customer_a_identities,
  pa2.province_code as customer_a_province,
  coalesce(ma.order_count, 0) as customer_a_order_count,
  coalesce(ma.revenue_sum, 0) as customer_a_revenue_sum,
  p.customer_b_id,
  cb.display_name as customer_b_name,
  idb.identities as customer_b_identities,
  pb2.province_code as customer_b_province,
  coalesce(mb.order_count, 0) as customer_b_order_count,
  coalesce(mb.revenue_sum, 0) as customer_b_revenue_sum,
  p.confidence
from pairs p
join analytics.dim_customer ca on ca.id = p.customer_a_id
join analytics.dim_customer cb on cb.id = p.customer_b_id
left join analytics.v_customer_master ma on ma.customer_id = p.customer_a_id
left join analytics.v_customer_master mb on mb.customer_id = p.customer_b_id
left join lateral (
  select array_agg(ci.identity_type || ':' || ci.identity_value_norm order by ci.identity_type) as identities
  from analytics.dim_customer_identity ci
  where ci.customer_id = p.customer_a_id
) ida on true
left join lateral (
  select array_agg(ci.identity_type || ':' || ci.identity_value_norm order by ci.identity_type) as identities
  from analytics.dim_customer_identity ci
  where ci.customer_id = p.customer_b_id
) idb on true
left join lateral (
  select fo.province_code
  from analytics.v_fact_order fo
  where fo.customer_id = p.customer_a_id
  order by fo.order_date desc
  limit 1
) pa2 on true
left join lateral (
  select fo.province_code
  from analytics.v_fact_order fo
  where fo.customer_id = p.customer_b_id
  order by fo.order_date desc
  limit 1
) pb2 on true
where p.confidence is not null
  and not exists (
    select 1
    from analytics.crm_merge_decision d
    where d.shop_id = p.shop_id
      and d.customer_a = least(p.customer_a_id, p.customer_b_id)
      and d.customer_b = greatest(p.customer_a_id, p.customer_b_id)
  )
order by
  case p.confidence when 'high' then 1 when 'medium' then 2 else 3 end,
  p.customer_a_id,
  p.customer_b_id;

-- ============================================================================
-- 5. RPC crm_merge_customer(p_shop_id, p_survivor_id, p_victim_id) (§3)
--
-- Repoints, per task brief / design §3, into all FK tables that carry a bare
-- analytics.dim_customer FK today (verified against 0010/0011/0021 column
-- lists, not guessed):
--   fact_order.customer_id, dim_customer_identity.customer_id,
--   dim_address.customer_id, crm_customer_note.customer_id,
--   fact_touchpoint.customer_id.
-- fact_touchpoint has no updated_at column (0010) — left untouched there,
-- unlike the other four tables which do have one.
--
-- Atomicity: this whole function body runs in the single implicit transaction
-- of the RPC call — any exception raised anywhere below (e.g. the not-found/
-- authz checks) aborts the entire statement, so partial repoints can't be
-- committed. No explicit BEGIN/COMMIT needed (and none should be added —
-- PL/pgSQL functions already run inside the caller's transaction).
-- ============================================================================

create or replace function analytics.crm_merge_customer(
  p_shop_id uuid,
  p_survivor_id uuid,
  p_victim_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_survivor_shop uuid;
  v_victim_shop uuid;
  v_survivor_merged uuid;
  v_victim_merged uuid;
  v_before_survivor jsonb;
  v_before_victim jsonb;
  v_before_survivor_pii jsonb;
  v_before_victim_pii jsonb;
  v_moved_order_ids uuid[];
  v_pair_lo uuid;
  v_pair_hi uuid;
begin
  if p_shop_id is null or p_survivor_id is null or p_victim_id is null then
    raise exception 'crm_merge_customer: p_shop_id, p_survivor_id and p_victim_id are required';
  end if;
  if p_survivor_id = p_victim_id then
    raise exception 'crm_merge_customer: survivor and victim must be different customers';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- lock both rows for the duration of the merge (row-level, not table-level)
  -- so a concurrent second merge touching either id can't interleave.
  select shop_id, merged_into_id into v_survivor_shop, v_survivor_merged
    from analytics.dim_customer where id = p_survivor_id for update;
  select shop_id, merged_into_id into v_victim_shop, v_victim_merged
    from analytics.dim_customer where id = p_victim_id for update;

  if v_survivor_shop is null then
    raise exception 'crm_merge_customer: survivor customer % not found', p_survivor_id;
  end if;
  if v_victim_shop is null then
    raise exception 'crm_merge_customer: victim customer % not found', p_victim_id;
  end if;
  if v_survivor_shop <> p_shop_id or v_victim_shop <> p_shop_id then
    raise exception 'crm_merge_customer: survivor/victim must both belong to shop %', p_shop_id
      using errcode = '42501';
  end if;
  if v_survivor_merged is not null then
    raise exception 'crm_merge_customer: survivor % is itself already merged into %', p_survivor_id, v_survivor_merged;
  end if;
  if v_victim_merged is not null then
    raise exception 'crm_merge_customer: victim % is already merged into %', p_victim_id, v_victim_merged;
  end if;

  -- snapshot full before-state of both rows (audit needs enough to unmerge by hand, §3)
  select to_jsonb(dc) into v_before_survivor from analytics.dim_customer dc where dc.id = p_survivor_id;
  select to_jsonb(dc) into v_before_victim from analytics.dim_customer dc where dc.id = p_victim_id;
  select to_jsonb(pc) into v_before_survivor_pii from analytics.pii_customer pc where pc.customer_id = p_survivor_id;
  select to_jsonb(pc) into v_before_victim_pii from analytics.pii_customer pc where pc.customer_id = p_victim_id;

  select array_agg(id) into v_moved_order_ids
    from analytics.fact_order where customer_id = p_victim_id;

  -- 1) fact_order
  update analytics.fact_order
    set customer_id = p_survivor_id, updated_at = now()
    where customer_id = p_victim_id;

  -- 2) dim_customer_identity — defensively skip a row that would duplicate one
  --    the survivor already owns under uq_dim_customer_identity (shop_id,
  --    identity_type, identity_value_norm); see view comment above for why
  --    this should be structurally unreachable today, kept as defense-in-depth.
  --    Any victim row that can't move (true duplicate) is then discarded —
  --    the surviving identical row on the survivor side already covers it.
  update analytics.dim_customer_identity src
    set customer_id = p_survivor_id, updated_at = now()
    where src.customer_id = p_victim_id
      and not exists (
        select 1 from analytics.dim_customer_identity dup
        where dup.customer_id = p_survivor_id
          and dup.shop_id = src.shop_id
          and dup.identity_type = src.identity_type
          and dup.identity_value_norm = src.identity_value_norm
      );
  delete from analytics.dim_customer_identity where customer_id = p_victim_id;

  -- 3) dim_address
  update analytics.dim_address
    set customer_id = p_survivor_id, updated_at = now()
    where customer_id = p_victim_id;

  -- 4) crm_customer_note
  update analytics.crm_customer_note
    set customer_id = p_survivor_id, updated_at = now()
    where customer_id = p_victim_id;

  -- 5) fact_touchpoint (no updated_at column, per 0010)
  update analytics.fact_touchpoint
    set customer_id = p_survivor_id
    where customer_id = p_victim_id;

  -- 6) pii_customer — survivor field wins if non-null, else fill from victim;
  --    upsert (not plain UPDATE) so this still works if the survivor somehow
  --    has no pii_customer row yet.
  insert into analytics.pii_customer (customer_id, shop_id, phone_e164, full_name, address, updated_at)
  select
    p_survivor_id,
    p_shop_id,
    coalesce(sp.phone_e164, vp.phone_e164),
    coalesce(sp.full_name, vp.full_name),
    coalesce(sp.address, vp.address),
    now()
  from (select 1) d
  left join analytics.pii_customer sp on sp.customer_id = p_survivor_id
  left join analytics.pii_customer vp on vp.customer_id = p_victim_id
  on conflict (customer_id) do update set
    phone_e164 = excluded.phone_e164,
    full_name = excluded.full_name,
    address = excluded.address,
    updated_at = now();

  delete from analytics.pii_customer where customer_id = p_victim_id;

  -- 7) soft-delete victim (partial unique index on dim_customer already
  --    excludes merged_into_id is not null rows, per 0010's own comment)
  update analytics.dim_customer
    set merged_into_id = p_survivor_id, updated_at = now()
    where id = p_victim_id;

  -- 8) recompute survivor rollups from fact_order — the real source of truth.
  --    dim_customer.first_order_at/last_order_at are never populated by
  --    transform_pending_orders (confirmed in 0020's own comment on
  --    v_customer_master) so there's no "stale value to preserve" here; if
  --    the survivor ends up with zero fact_order rows the aggregate legitimately
  --    resolves to NULL and this correctly clears any prior value.
  update analytics.dim_customer
    set first_order_at = agg.first_order_at,
        last_order_at = agg.last_order_at,
        updated_at = now()
    from (
      select
        min(order_date)::timestamptz as first_order_at,
        max(order_date)::timestamptz as last_order_at
      from analytics.fact_order
      where customer_id = p_survivor_id
    ) agg
    where id = p_survivor_id;

  update analytics.dim_customer
    set first_touch_channel_id = fc.channel_id, updated_at = now()
    from (
      select channel_id
      from analytics.fact_order
      where customer_id = p_survivor_id
      order by order_date asc, created_at asc
      limit 1
    ) fc
    where id = p_survivor_id;

  -- 9) record decision (normalized pair — upsert so a stale not_same verdict
  --    for this exact pair, if one ever existed, is now overwritten by merged)
  v_pair_lo := least(p_survivor_id, p_victim_id);
  v_pair_hi := greatest(p_survivor_id, p_victim_id);

  insert into analytics.crm_merge_decision (shop_id, customer_a, customer_b, verdict, decided_by)
  values (p_shop_id, v_pair_lo, v_pair_hi, 'merged', auth.uid())
  on conflict (shop_id, customer_a, customer_b) do update set
    verdict = 'merged', decided_by = excluded.decided_by, decided_at = now();

  -- 10) audit — before = full snapshot of both rows (dim_customer + pii),
  --     after = survivor id + every fact_order id that moved. That's enough
  --     to unmerge by hand per §3 (no unmerge RPC in scope).
  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_shop_id, auth.uid(), 'customer_merge', 'dim_customer', p_survivor_id,
    jsonb_build_object(
      'survivor', v_before_survivor,
      'survivor_pii', v_before_survivor_pii,
      'victim', v_before_victim,
      'victim_pii', v_before_victim_pii
    ),
    jsonb_build_object(
      'survivor_id', p_survivor_id,
      'victim_id', p_victim_id,
      'moved_fact_order_ids', to_jsonb(coalesce(v_moved_order_ids, array[]::uuid[]))
    )
  );
end;
$$;

revoke execute on function analytics.crm_merge_customer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.crm_merge_customer(uuid, uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 6. RPC crm_dismiss_merge_candidate(p_shop_id, p_customer_a, p_customer_b)
--    — records verdict='not_same' + audit only, no data mutation elsewhere.
-- ============================================================================

create or replace function analytics.crm_dismiss_merge_candidate(
  p_shop_id uuid,
  p_customer_a uuid,
  p_customer_b uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_a_shop uuid;
  v_b_shop uuid;
  v_pair_lo uuid;
  v_pair_hi uuid;
begin
  if p_shop_id is null or p_customer_a is null or p_customer_b is null then
    raise exception 'crm_dismiss_merge_candidate: p_shop_id, p_customer_a and p_customer_b are required';
  end if;
  if p_customer_a = p_customer_b then
    raise exception 'crm_dismiss_merge_candidate: customer_a and customer_b must be different customers';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select shop_id into v_a_shop from analytics.dim_customer where id = p_customer_a;
  select shop_id into v_b_shop from analytics.dim_customer where id = p_customer_b;
  if v_a_shop is null then
    raise exception 'crm_dismiss_merge_candidate: customer_a % not found', p_customer_a;
  end if;
  if v_b_shop is null then
    raise exception 'crm_dismiss_merge_candidate: customer_b % not found', p_customer_b;
  end if;
  if v_a_shop <> p_shop_id or v_b_shop <> p_shop_id then
    raise exception 'crm_dismiss_merge_candidate: both customers must belong to shop %', p_shop_id
      using errcode = '42501';
  end if;

  v_pair_lo := least(p_customer_a, p_customer_b);
  v_pair_hi := greatest(p_customer_a, p_customer_b);

  insert into analytics.crm_merge_decision (shop_id, customer_a, customer_b, verdict, decided_by)
  values (p_shop_id, v_pair_lo, v_pair_hi, 'not_same', auth.uid())
  on conflict (shop_id, customer_a, customer_b) do update set
    verdict = 'not_same', decided_by = excluded.decided_by, decided_at = now();

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_shop_id, auth.uid(), 'merge_dismiss', 'dim_customer', p_customer_a,
    null,
    jsonb_build_object('customer_a', p_customer_a, 'customer_b', p_customer_b, 'verdict', 'not_same')
  );
end;
$$;

revoke execute on function analytics.crm_dismiss_merge_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.crm_dismiss_merge_candidate(uuid, uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 7. Grants — crm_merge_decision (table) + v_merge_candidate (view) are new
--    relations in schema analytics since the last blanket grant (0020).
--    RLS on crm_merge_decision (and on the underlying tables v_merge_candidate
--    reads through) still does the real row-level filtering — this only
--    clears the outer "can you touch this relation at all" gate, same as
--    every prior migration's re-run of this statement.
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;
