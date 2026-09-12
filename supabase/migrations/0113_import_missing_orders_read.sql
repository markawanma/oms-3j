-- 0113_import_missing_orders_read.sql
-- Cancel-detection Phase 1 (design: Yoda, 11 ก.ย. 69) — read-only detection
-- layer. Three functions, per design §3/§4:
--   1. analytics.import_order_no_parts(text) — regex split helper.
--   2. analytics.import_missing_orders_candidates(shop, batch) — the ONE
--      place the C1-C8 candidate-selection rule lives (design §3's "S").
--      Also owns the P1-P4 hard-block precondition checks (raises on
--      failure) — both this migration's read RPC AND 0115's
--      import_delete_orders call this same function, so a delete can never
--      select a different (looser) candidate set than what the owner saw
--      on screen.
--   3. analytics.import_missing_orders(shop, batch) returns jsonb — the
--      read RPC backing the UI panel: wraps #2's blocking decision +
--      candidates into one response, adds the P5 monotonic WARN and the
--      count-based "too_many" cap (design §3), and enriches each candidate
--      row with display-only fields (channel name, customer name, last-seen
--      file) that #2 deliberately does not carry (keeps #2 focused on the
--      selection rule, not presentation).
--
-- Owner-confirmed facts this migration relies on (11 ก.ย. 69, see design
-- doc §0): order numbers match ^[A-Z]*[0-9]+$ for 6,510/6,510 real rows: prefix
-- resets to 0 each time it advances ('' -> A -> ... -> G); the 3 "monotonic
-- inversions" found are Asia/Bangkok vs UTC timestamp artifacts on
-- channel_raw='Tiktok' rows, not real out-of-order numbering -- hence P5 is
-- WARN, not a hard block (see import_missing_orders below).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via MCP.

-- ============================================================================
-- 1. analytics.import_order_no_parts — split a Shipnity order number into
--    (prefix, num) per the proven format ^[A-Z]*[0-9]+$ (A3, 6,510/6,510).
--    Always returns exactly one row for any non-null input (a plain scalar
--    SELECT, not an unnest) — prefix/num both NULL when the input doesn't
--    match, so callers can test `num is null` for "unparseable" without a
--    separate branch. STRICT means a NULL order number yields zero rows
--    (not a row of nulls) — deliberately different from "doesn't match the
--    pattern", so callers that need to catch BOTH cases (0113's P4 check)
--    join with LEFT JOIN LATERAL ... ON true, not a plain CROSS JOIN.
-- ============================================================================

create or replace function analytics.import_order_no_parts(p_order_no text)
returns table (prefix text, num integer)
language sql
immutable
strict
set search_path to pg_catalog, pg_temp
as $$
  select
    (regexp_match(p_order_no, '^([A-Z]*)([0-9]+)$'))[1],
    ((regexp_match(p_order_no, '^([A-Z]*)([0-9]+)$'))[2])::integer
$$;

revoke execute on function analytics.import_order_no_parts(text) from public, anon, authenticated;
-- H-1 (security review 12 ก.ย. 69): service_role only — this helper is only
-- ever called from inside other SECURITY DEFINER functions (all of which
-- run as service_role via getServiceClient()); no server action calls it
-- directly over PostgREST, so authenticated execute was unnecessary surface.
grant execute on function analytics.import_order_no_parts(text) to service_role;

-- ============================================================================
-- 2. analytics.import_missing_orders_candidates — design §3's C1-C8, P1-P4.
--
--    F = stg_order_import rows for THIS batch with import_status in
--    ('transformed','tombstoned') (a re-imported file that flags its own
--    previously-tombstoned rows again should not choke on them), grouped by
--    prefix into (lo, hi, date_lo, date_hi) via import_order_no_parts +
--    order_created_at::date (deliberately the SAME cast transform_pending_
--    orders itself uses for order_date — no Asia/Bangkok adjustment here:
--    introducing a different timezone rule on this side than the one that
--    actually produced fact_order.order_date would create a NEW off-by-one-
--    day mismatch between F's date range and the order_date it is compared
--    against, which is worse than the existing (pre-existing, unrelated to
--    this migration) UTC-vs-Bangkok imprecision elsewhere).
--
--    S = analytics.fact_order rows passing every one of C1-C8. Returned
--    columns carry each row's own prefix-group bounds (group_lo/hi/date_lo/
--    date_hi) plus batch-wide file_order_count/file_channels, repeated on
--    every row — so a caller building fact_order_deleted.evidence per row
--    (0115) never needs a second query against this function's internals.
--
--    P1-P4 are hard blocks: on failure this function RAISES (errcode
--    'P0001', detail = the precondition code) instead of returning an empty
--    set, specifically so 0115's import_delete_orders — which must NEVER
--    silently proceed as "0 candidates, nothing to check" when the batch
--    itself is unsound — is forced to see the same exception the read RPC
--    catches. P5 (monotonic) is NOT checked here: it never blocks anything,
--    so it lives only in import_missing_orders below (the read side), not
--    on this shared correctness-critical path.
-- ============================================================================

create or replace function analytics.import_missing_orders_candidates(p_shop_id uuid, p_batch_id uuid)
returns table (
  fact_order_id uuid,
  source_order_no text,
  order_date date,
  channel_id uuid,
  revenue numeric,
  customer_id uuid,
  tracking_no text,
  prefix text,
  num integer,
  group_lo integer,
  group_hi integer,
  group_date_lo date,
  group_date_hi date,
  file_order_count integer,
  file_channels uuid[]
)
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_batch record;
  v_unparsed_count int;
  v_pending_error_count int;
  v_resolved_channels uuid[];
  v_f_row_count int;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_missing_orders_candidates: p_shop_id and p_batch_id are required';
  end if;

  -- P1: batch belongs to this shop and is an order-report batch (excel_
  -- order_report) — a line-item batch or another shop's batch id has no F
  -- to compute this rule from at all.
  select b.id, b.shop_id, b.source_type, b.status, b.imported_at, b.file_name, b.row_count_skipped
    into v_batch
    from analytics.stg_import_batch b
    where b.id = p_batch_id;

  if v_batch.id is null
     or v_batch.shop_id is distinct from p_shop_id
     or v_batch.source_type is distinct from 'excel_order_report'
  then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'shop_or_source_mismatch';
  end if;

  -- P2: batch must have finished transform.
  if v_batch.status is distinct from 'transformed' then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'batch_not_transformed';
  end if;

  -- P3: no row in this batch still pending/error (order-report rows only —
  -- pdf-sourced rows in the same batch, if any, are out of scope for this
  -- rule and never occur for source_type='excel_order_report' in practice).
  select count(*) into v_pending_error_count
    from analytics.stg_order_import s
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('pending', 'error');
  if v_pending_error_count > 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'batch_has_unresolved_rows';
  end if;

  -- H-2 (security review 12 ก.ย. 69) "staging ≠ file": lib/import/order-
  -- report.ts drops every row with a blank source_order_no before it ever
  -- reaches stg_order_import (order-orders.ts persists the count as
  -- row_count_skipped, 0112). A genuine order sitting on one of those
  -- dropped rows is invisible to F/S below and would be indistinguishable
  -- from an actually-cancelled order — refuse to run detection on a batch
  -- this function cannot fully account for.
  if coalesce(v_batch.row_count_skipped, 0) > 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'file_rows_skipped';
  end if;

  -- P4: every row must parse (A3 format) — LEFT JOIN LATERAL so a NULL
  -- source_order_no (0 rows from the strict function) is still counted as
  -- unparseable, not silently skipped.
  select count(*) into v_unparsed_count
    from analytics.stg_order_import s
    left join lateral analytics.import_order_no_parts(s.source_order_no) p on true
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
      and p.num is null;
  if v_unparsed_count > 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'unparseable_order_no';
  end if;

  -- M-1 (security review 12 ก.ย. 69): if F's channel set cannot be resolved
  -- at all (every row's channel_raw fails the dim_channel_alias lookup, or
  -- the batch has zero transformed|tombstoned rows), C5 below used to read
  -- `fm.file_channels is null or ...` — "cannot compute this rule" silently
  -- became "pass everything", which is backwards for a safety gate. In
  -- practice this should never fire for a real batch: transform_pending_
  -- orders itself requires the same alias match (case-insensitively) before
  -- a row can reach 'transformed', so every transformed row already proves
  -- its channel_raw resolves. This is defense-in-depth, same posture as
  -- P1-P4 above, not a rule expected to trip on real data.
  --
  -- Low (security review 12 ก.ย. 69): count(*) alongside the channel
  -- array so "zero F rows at all" can raise its own distinct detail
  -- ('empty_batch') instead of being lumped into 'channels_unresolved' —
  -- an empty batch and a batch whose rows all fail channel resolution are
  -- different failure modes with different fixes, worth telling apart in
  -- the blocked_reason the UI shows the owner.
  select array_agg(distinct dca.channel_id) filter (where dca.channel_id is not null), count(*)
    into v_resolved_channels, v_f_row_count
    from analytics.stg_order_import s
    left join analytics.dim_channel_alias dca on lower(dca.alias_raw) = lower(trim(coalesce(s.channel_raw, '')))
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned');
  if v_f_row_count = 0 then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'empty_batch';
  end if;
  if v_resolved_channels is null then
    raise exception 'import_missing_orders_candidates: blocked'
      using errcode = 'P0001', detail = 'channels_unresolved';
  end if;

  -- F (this batch's transformed|tombstoned excel rows), grouped by prefix,
  -- plus the file's global channel set / printed_at / paid_at ranges
  -- (channel resolved via dim_channel_alias, same lookup transform_pending_
  -- orders itself uses) — all computed in ONE statement below via CTEs, not
  -- a temp table: this function has no precedent for temp tables anywhere
  -- in this codebase and gets called multiple times per statement from
  -- 0115's import_delete_orders, so a single self-contained query is the
  -- safer, simpler choice here.
  return query
  with f_rows as (
    select p.prefix, p.num, s.order_created_at::date as order_date, dca.channel_id,
           s.printed_at, s.paid_at, s.source_order_no
    from analytics.stg_order_import s
    join lateral analytics.import_order_no_parts(s.source_order_no) p on true
    left join analytics.dim_channel_alias dca on lower(dca.alias_raw) = lower(trim(coalesce(s.channel_raw, '')))
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id
      and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
  ),
  f_groups as (
    select prefix, min(num) as lo, max(num) as hi,
           min(order_date) as dlo, max(order_date) as dhi
    from f_rows
    group by prefix
  ),
  f_meta as (
    select
      count(*)::integer as file_order_count,
      array_agg(distinct channel_id) filter (where channel_id is not null) as file_channels,
      min(printed_at) filter (where printed_at is not null) as printed_lo,
      max(printed_at) filter (where printed_at is not null) as printed_hi,
      min(paid_at) filter (where paid_at is not null) as paid_lo,
      max(paid_at) filter (where paid_at is not null) as paid_hi
    from f_rows
  )
  select
    fo.id, fo.source_order_no, fo.order_date, fo.channel_id, fo.revenue, fo.customer_id, fo.tracking_no,
    fg.prefix, p2.num, fg.lo, fg.hi, fg.dlo, fg.dhi,
    fm.file_order_count, fm.file_channels
  from analytics.fact_order fo
  cross join lateral analytics.import_order_no_parts(fo.source_order_no) p2
  join f_groups fg on fg.prefix = p2.prefix
  cross join f_meta fm
  where fo.shop_id = p_shop_id                                                        -- C1
    and p2.num is not null
    and not exists (select 1 from f_rows f2 where f2.source_order_no = fo.source_order_no) -- C2
    and p2.num > fg.lo and p2.num < fg.hi                                             -- C3 (strict)
    and fo.order_date between fg.dlo and fg.dhi                                       -- C4
    and fo.channel_id = any (fm.file_channels)                                        -- C5 (M-1: fm.file_channels is guaranteed non-null past the channels_unresolved check above)
    and (fo.printed_at is null or fm.printed_lo is null or fo.printed_at between fm.printed_lo and fm.printed_hi) -- C6a
    and (fo.paid_at is null or fm.paid_lo is null or fo.paid_at between fm.paid_lo and fm.paid_hi)                -- C6b
    and not exists (                                                                   -- C7
      select 1
      from analytics.stg_order_import s2
      join analytics.stg_import_batch b2 on b2.id = s2.batch_id
      where s2.shop_id = p_shop_id and s2.source_order_no = fo.source_order_no
        and b2.imported_at > v_batch.imported_at
    )
    and not exists (                                                                   -- C8
      select 1 from analytics.fact_order_deleted fod
      where fod.shop_id = p_shop_id and fod.source_order_no = fo.source_order_no and fod.restored_at is null
    );
end;
$$;

revoke execute on function analytics.import_missing_orders_candidates(uuid, uuid) from public, anon, authenticated;
-- H-1: service_role only — called only from import_missing_orders below and
-- from 0115's import_delete_orders/import_restore_orders, both of which run
-- as service_role; no server action calls this one directly.
grant execute on function analytics.import_missing_orders_candidates(uuid, uuid) to service_role;

-- ============================================================================
-- 3. analytics.import_missing_orders — read RPC for the UI panel. Wraps #2,
--    turning a raised P1-P4 block into {ok:false, blocked_reason, ...}
--    instead of an error the client has to parse, adds the P5 monotonic
--    WARN (day-granularity, per A1's finding that the 3 real inversions
--    were Asia/Bangkok-vs-UTC timestamp artifacts, not real numbering
--    gaps), and the count-based cap. Enriches each candidate with display-
--    only fields #2 does not carry.
-- ============================================================================

create or replace function analytics.import_missing_orders(p_shop_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_batch record;
  v_blocked_reason text;
  v_candidates jsonb := '[]'::jsonb;
  v_candidate_count int := 0;
  v_candidate_revenue numeric := 0;
  v_file_order_count int := 0;
  v_channels jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_monotonic_warnings int := 0;
  v_detail text;
  -- design §3 cap: count(S) > greatest(20, 15% of file_order_count)
  v_cap int;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_missing_orders: p_shop_id and p_batch_id are required';
  end if;

  select b.id, b.file_name, b.imported_at, b.row_count_skipped into v_batch
    from analytics.stg_import_batch b
    where b.id = p_batch_id and b.shop_id = p_shop_id;

  begin
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'fact_order_id', c.fact_order_id,
        'source_order_no', c.source_order_no,
        'order_date', c.order_date,
        'channel_id', c.channel_id,
        'channel_name', dc.name,
        'revenue_thb', c.revenue,
        'tracking_no', c.tracking_no,
        'customer_id', c.customer_id,
        'customer_display_name', dcu.display_name,
        'last_seen_file', lb.file_name,
        'last_seen_at', lb.imported_at
      ) order by c.order_date, c.source_order_no), '[]'::jsonb),
      coalesce(count(*), 0),
      coalesce(sum(c.revenue), 0)
    into v_candidates, v_candidate_count, v_candidate_revenue
    from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id) c
    left join analytics.dim_channel dc on dc.id = c.channel_id
    left join analytics.dim_customer dcu on dcu.id = c.customer_id
    -- Low (security review 12 ก.ย. 69): scope to source_kind='excel' — this
    -- is presentation-only ("last seen in file X"), but a PDF-sourced
    -- stg_order_import row (source_kind<>'excel') sharing the same
    -- source_order_no should never be attributed as the last-seen EXCEL
    -- file.
    left join analytics.stg_order_import ls on ls.shop_id = p_shop_id and ls.source_order_no = c.source_order_no and ls.source_kind = 'excel'
    left join analytics.stg_import_batch lb on lb.id = ls.batch_id;
  exception
    when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      if v_detail in ('shop_or_source_mismatch', 'batch_not_transformed', 'batch_has_unresolved_rows', 'unparseable_order_no', 'channels_unresolved', 'file_rows_skipped', 'empty_batch') then
        v_blocked_reason := v_detail;
      else
        raise; -- unexpected error, do not swallow
      end if;
  end;

  -- Evidence (groups[]/channels[]/file_order_count) is recomputed here from
  -- F directly, deliberately NOT threaded through the candidates helper
  -- above (see migration header) — this is presentation only and never
  -- feeds a delete decision, so it degrades to "unavailable" (empty arrays)
  -- when the batch is blocked rather than duplicating the P1-P4 checks.
  --
  -- v_file_order_count is recomputed here too, NOT trusted from the
  -- candidates aggregate above: max(c.file_order_count) over ZERO candidate
  -- rows (a valid "nothing missing" outcome) is NULL, which would silently
  -- report file_order_count=0 (looks like an empty file) instead of the
  -- file's real row count.
  if v_blocked_reason is null and v_batch.id is not null then
    select count(*) into v_file_order_count
      from analytics.stg_order_import s
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned');

    select coalesce(jsonb_agg(jsonb_build_object(
             'prefix', g.prefix, 'lo', g.lo, 'hi', g.hi,
             'date_lo', g.dlo, 'date_hi', g.dhi, 'row_count', g.row_count
           ) order by g.prefix), '[]'::jsonb)
      into v_groups
      from (
        select p.prefix, min(p.num) as lo, max(p.num) as hi,
               min(s.order_created_at::date) as dlo, max(s.order_created_at::date) as dhi,
               count(*) as row_count
        from analytics.stg_order_import s
        join lateral analytics.import_order_no_parts(s.source_order_no) p on true
        where s.shop_id = p_shop_id and s.batch_id = p_batch_id
          and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
        group by p.prefix
      ) g;

    select coalesce(jsonb_agg(distinct jsonb_build_object('channel_id', dc.id, 'code', dc.code, 'name', dc.name)), '[]'::jsonb)
      into v_channels
      from analytics.stg_order_import s
      join analytics.dim_channel_alias dca on lower(dca.alias_raw) = lower(trim(coalesce(s.channel_raw, '')))
      join analytics.dim_channel dc on dc.id = dca.channel_id
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned');

    -- P5 (WARN, day-granularity per A1/Tech Lead instruction): within each
    -- prefix, a later calendar day (Asia/Bangkok) whose minimum order number
    -- is lower than an earlier day's maximum is an inversion. Day-level
    -- (not exact-timestamp) specifically to absorb the UTC-vs-Bangkok
    -- artifact A1 already proved out on real data.
    with day_groups as (
      select p.prefix, (s.order_created_at at time zone 'Asia/Bangkok')::date as day,
             min(p.num) as day_min, max(p.num) as day_max
      from analytics.stg_order_import s
      join lateral analytics.import_order_no_parts(s.source_order_no) p on true
      where s.shop_id = p_shop_id and s.batch_id = p_batch_id
        and s.source_kind = 'excel' and s.import_status in ('transformed', 'tombstoned')
      group by p.prefix, (s.order_created_at at time zone 'Asia/Bangkok')::date
    ),
    ordered as (
      select prefix, day, day_min, day_max,
             lag(day_max) over (partition by prefix order by day) as prev_day_max
      from day_groups
    )
    select count(*) into v_monotonic_warnings
    from ordered
    where prev_day_max is not null and day_min < prev_day_max;

    -- cap: only meaningful once we actually have a candidate set to judge.
    v_cap := greatest(20, ceil(coalesce(v_file_order_count, 0) * 0.15));
    if v_candidate_count > v_cap then
      v_blocked_reason := 'too_many';
    end if;
  end if;

  return jsonb_build_object(
    'ok', v_blocked_reason is null,
    'blocked_reason', v_blocked_reason,
    'evidence', jsonb_build_object(
      'file_name', v_batch.file_name,
      'imported_at', v_batch.imported_at,
      'file_order_count', v_file_order_count,
      'groups', v_groups,
      'channels', v_channels,
      -- H-2: always surfaced (not just when blocked) so the UI can show
      -- "N แถวถูกข้ามตอนนำเข้า" context even on an otherwise-ok result.
      'skipped_rows', coalesce(v_batch.row_count_skipped, 0)
    ),
    'monotonic_warnings', v_monotonic_warnings,
    'candidate_count', v_candidate_count,
    'candidate_revenue_thb', v_candidate_revenue,
    'candidates', v_candidates
  );
end;
$$;

revoke execute on function analytics.import_missing_orders(uuid, uuid) from public, anon, authenticated;
-- H-1: service_role only — getMissingOrders (lib/actions/import-missing-
-- orders.ts) always calls this via getServiceClient(), never a user session.
grant execute on function analytics.import_missing_orders(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
