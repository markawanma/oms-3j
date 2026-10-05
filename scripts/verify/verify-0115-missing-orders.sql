-- scripts/verify-0115-missing-orders.sql
-- Rehearsal + proof for 0113/0114/0115 (cancel-detection Phase 1) BEFORE
-- Tech Lead applies them for real via apply_migration.
--
-- ✅ RAN FOR REAL against the live project 12 ก.ย. 69 — pre-apply: 53/53
-- checks passed (2 real bugs caught and fixed first: 0113's 42702 OUT-column
-- ambiguity, this script's own 22P02 v_row rowtype mismatch — see 0113's
-- header and this file's git history for both). Then 0113/0114/0115 were
-- applied for real (versions 20260912144344/144432/144600), and this same
-- script's assertions were re-verified post-apply. get_advisors clean.
--
-- STEP 0's DDL replay below stays valid to re-run even now that 0113-0115
-- are live: almost every statement in it is `create or replace function` /
-- `create or replace view` (idempotent — replaying the exact live
-- definition is a no-op). The one non-idempotent-looking exception is
-- 0115 section 0's `alter table ... drop constraint / add constraint`
-- (extending stg_order_line_import.import_status to allow 'tombstoned') —
-- already written `drop constraint IF EXISTS` for exactly this reason, so
-- re-running it against a DB where that constraint already has the new
-- shape is also a no-op, not an error. Safe to run again as a regression
-- check after any FUTURE edit to these functions.
--
-- ASSUMES 0112 is ALREADY APPLIED to the live DB (the 'tombstoned' enum
-- value and analytics.fact_order_deleted table already exist and are
-- committed) — per 3j-migration-traps, `alter type ... add value` cannot be
-- used in the same transaction that adds it, so this script deliberately
-- does NOT replay 0112's DDL. It replays 0113 + 0114 + 0115 verbatim, then
-- runs every check inside ONE do-block that ends in `raise exception`,
-- forcing a full rollback (3j-migration-traps #11) — this touches
-- analytics.fact_order, the table carrying every real order's revenue.
--
-- ALSO ASSUMES feature/label-review-resolve's migration 0116 is ALREADY
-- APPLIED (analytics.fact_order.province_source column) — 0114's replay
-- below now writes to that column (12 ก.ย. 69 cross-branch coordination, see
-- 0114's own header). This script runs strictly AFTER 0112-0115 apply in
-- the intended rollout order, and 0116 must already be in place before
-- 0114 itself is even applicable (see 0114's APPLY-ORDER note) — so by the
-- time this script would ever actually run for real, 0116 is guaranteed to
-- already be there. No defensive guard added for its absence (coordinator
-- instruction 12 ก.ย. 69): if 0116 is somehow missing, 0114's own replay a
-- few hundred lines below fails loudly and immediately ("column province_
-- source does not exist"), same as it would on the real apply — this script
-- is not meant to succeed in that state, only to fail in the same place the
-- real migration would.
--
-- shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7' (3J Jewelry, the only
-- shop_id in this project). Fixtures use a fake order-number PREFIX 'ZZ'
-- (real data only ever uses '' through 'G', per A3, 6,510/6,510) so they can
-- never collide with real orders' candidate computation, and a random
-- per-run tag 'VERIFY-0115-<uuid>' on every non-order-number identifying
-- field (file_hash/file_name/reason/shop name) for traceability and to
-- guarantee two runs never collide with each other either.
--
-- Why the DDL sits OUTSIDE the do block: `create or replace function` is
-- DDL and cannot appear as a direct statement inside PL/pgSQL (same
-- reasoning as verify-0109.sql / verify-0111-upsert-rules.sql). The DDL
-- below must stay byte-identical to 0113/0114/0115 — if you edit those
-- migrations, copy the change here too or this rehearsal stops proving what
-- actually ships.

begin;

-- ============================================================================
-- STEP 0: replay 0113 + 0114 + 0115 DDL verbatim.
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
  -- 🔴 dry-run caught 42702 here (supabase-migrate skill gotcha #2): this
  -- function's own `returns table (... order_date date, channel_id uuid,
  -- ..., prefix text, num integer, ...)` creates OUT-parameter variables
  -- with those exact names, in scope for every statement in this function
  -- body. f_rows' own columns (prefix/num/order_date/channel_id/printed_at/
  -- paid_at) are NOT ambiguous inside f_rows itself (built from real table
  -- aliases), but referencing them UNQUALIFIED from f_groups/f_meta below
  -- is ambiguous between "the f_rows column" and "the OUT variable" —
  -- Postgres can't tell which one you mean and refuses to guess. Every
  -- column below MUST stay qualified with the `fr` alias, including
  -- printed_at/paid_at which don't collide with an OUT name (no OUT
  -- parameter by those names) — qualified anyway so a future edit can't
  -- silently drop the alias on the ones that DO matter and reintroduce this
  -- error. Do not "clean up" these aliases.
  f_groups as (
    select fr.prefix, min(fr.num) as lo, max(fr.num) as hi,
           min(fr.order_date) as dlo, max(fr.order_date) as dhi
    from f_rows fr
    group by fr.prefix
  ),
  f_meta as (
    select
      count(*)::integer as file_order_count,
      array_agg(distinct fr.channel_id) filter (where fr.channel_id is not null) as file_channels,
      min(fr.printed_at) filter (where fr.printed_at is not null) as printed_lo,
      max(fr.printed_at) filter (where fr.printed_at is not null) as printed_hi,
      min(fr.paid_at) filter (where fr.paid_at is not null) as paid_lo,
      max(fr.paid_at) filter (where fr.paid_at is not null) as paid_hi
    from f_rows fr
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
  -- 0114: shared per-shop lock with import_delete_orders (0115) — see header.
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));
  for v_row in
    select * from analytics.stg_order_import
    where shop_id = p_shop_id and batch_id = p_batch_id and source_kind = 'excel' and import_status in ('pending', 'error')
    order by source_row_no
  loop
    begin
      -- 0114: a deliberately-deleted order must never resurrect on re-import
      -- — check BEFORE any channel/customer resolution so a tombstoned row
      -- never touches dim_customer/dim_customer_identity/pii_customer either.
      if exists (
        select 1 from analytics.fact_order_deleted fod
        where fod.shop_id = p_shop_id and fod.source_order_no = v_row.source_order_no and fod.restored_at is null
      ) then
        update analytics.stg_order_import set import_status = 'tombstoned', fact_order_id = null, error_detail = null, error_code = null where id = v_row.id;
        continue;
      end if;
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
        -- 0114: province_source (0116, feature/label-review-resolve) — see header point 3.
        province_source = case when excluded.province_code = 'TH-XX' then analytics.fact_order.province_source else 'import' end,
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
alter table analytics.stg_order_line_import
  drop constraint if exists stg_order_line_import_import_status_check;

alter table analytics.stg_order_line_import
  add constraint stg_order_line_import_import_status_check
  check (import_status in ('pending', 'transformed', 'orphan', 'skipped_blank', 'sku_unmapped', 'error', 'tombstoned'));

-- ============================================================================
-- 1. analytics.import_delete_orders(shop, batch, ids, reason)
--
--    All-or-nothing: any id outside the freshly-recomputed candidate set, or
--    a candidate_count over the cap, aborts the WHOLE call (raise rolls back
--    everything, including snapshot rows already inserted this call) —
--    design §4 "id ต้อง ⊂ S ไม่งั้น raise ทั้งก้อน". Snapshot-then-delete,
--    one order at a time inside a loop (same "explicit control flow over
--    a single giant CTE" style transform_pending_orders itself uses), so
--    each row's own prefix-group evidence lands correctly on its own
--    fact_order_deleted row.
-- ============================================================================

create or replace function analytics.import_delete_orders(
  p_shop_id uuid,
  p_batch_id uuid,
  p_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_reason text;
  v_cap int;
  v_file_order_count int;
  v_candidate_count int;
  v_invalid_ids uuid[];
  v_batch_file_name text;
  v_c record;
  v_deleted_ids uuid[] := '{}';
  v_deleted_revenue numeric := 0;
  v_deleted_count int := 0;
  v_cascade_tables text[];
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null or p_batch_id is null then
    raise exception 'import_delete_orders: p_shop_id and p_batch_id are required';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) = 0 then
    raise exception 'import_delete_orders: p_ids must contain at least one id';
  end if;
  if array_length(p_ids, 1) > 200 then
    raise exception 'import_delete_orders: cannot delete more than 200 orders in one call (got %)', array_length(p_ids, 1);
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'import_delete_orders: reason is required';
  end if;

  -- security review C-1 guard (12 ก.ย. 69, tightened Low-priority follow-up
  -- same day): the snapshot below covers exactly 3 tables whose ON DELETE
  -- CASCADE points at analytics.fact_order (dim_address, fact_order_item,
  -- crm_order_override — confirmed against pg_constraint on the live DB).
  -- Compares the actual TABLE NAMES, not just a count of 3 — a plain count
  -- would stay "3" and pass silently even if one of these three lost its
  -- cascade FK while an unrelated 4th table gained one, which is exactly
  -- the kind of change this guard exists to catch. Schema-qualified via an
  -- explicit pg_namespace join (not ::regclass::text, which renders
  -- unqualified for anything already resolvable through search_path —
  -- 'analytics' is in this function's own search_path, so that shortcut
  -- would have silently produced bare table names here). Runs on every
  -- call, not just once, so it stays correct even if this function is
  -- never touched again.
  select coalesce(array_agg(n.nspname || '.' || cl.relname order by n.nspname, cl.relname), '{}')
    into v_cascade_tables
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and c.confdeltype = 'c'
      and c.confrelid = 'analytics.fact_order'::regclass;
  if v_cascade_tables is distinct from array['analytics.crm_order_override', 'analytics.dim_address', 'analytics.fact_order_item'] then
    raise exception 'import_delete_orders: expected ON DELETE CASCADE foreign keys into analytics.fact_order from exactly {analytics.crm_order_override, analytics.dim_address, analytics.fact_order_item} but found {%} — the snapshot/restore logic in this function does not necessarily cover all cascading tables anymore; refusing to delete anything until this is reconciled',
      array_to_string(v_cascade_tables, ', ');
  end if;

  -- serialize against a concurrent import for the same shop (0114 takes the
  -- same advisory-lock key) — closes the race design §5 point 2 flags.
  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  -- M-2 (security review 12 ก.ย. 69): scope to this shop too — a batch id
  -- collision across shops is not possible (uuid pk) but an unscoped select
  -- here is inconsistent with every other lookup in this function and was
  -- flagged on review; costs nothing to add.
  select b.file_name into v_batch_file_name from analytics.stg_import_batch b where b.id = p_batch_id and b.shop_id = p_shop_id;

  -- re-derive the candidate set NOW (not trusting anything the caller sent
  -- except p_ids) — this call also re-runs P1-P4 and raises if the batch is
  -- blocked, so a delete request against a since-invalidated batch fails
  -- loudly instead of silently matching zero candidates.
  select count(*), max(file_order_count)
    into v_candidate_count, v_file_order_count
    from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id);

  v_cap := greatest(20, ceil(coalesce(v_file_order_count, 0) * 0.15));
  if v_candidate_count > v_cap then
    raise exception 'import_delete_orders: % candidates exceeds the safety cap of % for this batch (file_order_count=%) — investigate before bulk-deleting, nothing was deleted',
      v_candidate_count, v_cap, v_file_order_count;
  end if;

  -- NOT IN (uncorrelated subquery), not NOT EXISTS/a correlated join — the
  -- candidates function is VOLATILE (plpgsql default) and internally
  -- rebuilds a temp table on every call, so a correlated form here would
  -- re-run the whole candidate computation once per element of p_ids
  -- instead of once total. fact_order_id is always non-null (fo.id, a PK),
  -- so NOT IN's null-poisoning pitfall does not apply.
  select array_agg(x) into v_invalid_ids
    from unnest(p_ids) as x
    where x not in (select fact_order_id from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id));
  if v_invalid_ids is not null and array_length(v_invalid_ids, 1) > 0 then
    raise exception 'import_delete_orders: % of the requested id(s) are not in the current candidate set (e.g. %) — refusing the whole request, nothing was deleted',
      array_length(v_invalid_ids, 1), v_invalid_ids[1];
  end if;

  -- lock every target row for the rest of this transaction before snapshot.
  perform 1 from analytics.fact_order where id = any (p_ids) and shop_id = p_shop_id for update;

  for v_c in
    select * from analytics.import_missing_orders_candidates(p_shop_id, p_batch_id) c
    where c.fact_order_id = any (p_ids)
  loop
    insert into analytics.fact_order_deleted (
      shop_id, fact_order_id, source_order_no, channel_id, order_date, revenue, customer_id,
      order_row, item_rows, address_rows, override_row, stg_order_import_ids, stg_line_links,
      detected_by_batch_id, detected_by_file_name, evidence, reason, deleted_by
    )
    select
      p_shop_id, fo.id, fo.source_order_no, fo.channel_id, fo.order_date, fo.revenue, fo.customer_id,
      to_jsonb(fo),
      coalesce(
        (select jsonb_agg(to_jsonb(foi) order by foi.id) from analytics.fact_order_item foi where foi.fact_order_id = fo.id),
        '[]'::jsonb
      ),
      -- C-1: dim_address also ON DELETE CASCADEs off fact_order_id (0010:441)
      -- and must be snapshotted the same way fact_order_item is, or restore
      -- silently loses the shipping address forever.
      coalesce(
        (select jsonb_agg(to_jsonb(da) order by da.id) from analytics.dim_address da where da.fact_order_id = fo.id and da.shop_id = p_shop_id),
        '[]'::jsonb
      ),
      (select to_jsonb(co) from analytics.crm_order_override co where co.fact_order_id = fo.id),
      coalesce(
        (select array_agg(si.id) from analytics.stg_order_import si where si.shop_id = p_shop_id and si.fact_order_id = fo.id),
        '{}'
      ),
      coalesce(
        (select jsonb_agg(jsonb_build_object('stg_order_line_import_id', sli.id, 'fact_order_item_id', sli.fact_order_item_id))
           from analytics.stg_order_line_import sli
           where sli.shop_id = p_shop_id and sli.source_order_no = fo.source_order_no and sli.fact_order_item_id is not null),
        '[]'::jsonb
      ),
      p_batch_id, v_batch_file_name,
      jsonb_build_object(
        'prefix', v_c.prefix, 'lo', v_c.group_lo, 'hi', v_c.group_hi,
        'date_lo', v_c.group_date_lo, 'date_hi', v_c.group_date_hi,
        'channels', v_c.file_channels, 'file_order_count', v_c.file_order_count,
        'candidate_count', v_candidate_count
      ),
      v_reason, auth.uid()
    from analytics.fact_order fo
    where fo.id = v_c.fact_order_id and fo.shop_id = p_shop_id;

    -- tombstone the staging lineage for THIS order before delete severs it
    -- (ON DELETE SET NULL only clears the FK, never touches import_status).
    update analytics.stg_order_import
      set import_status = 'tombstoned'
      where shop_id = p_shop_id and fact_order_id = v_c.fact_order_id;

    -- QA gate (12 ก.ย. 69): 'tombstoned', not 'orphan' — see the migration
    -- header (section 0) for why conflating the two broke getOrphanBacklog.
    -- Condition unchanged from before (fact_order_item_id is not null: only
    -- rows this delete is actively un-linking) — a stray 'pending'/'error'/
    -- already-'orphan' row for this source_order_no from some OTHER batch is
    -- deliberately left alone here (its own status still means whatever it
    -- meant); getOrphanBacklog's own added filter (lib/import/orphan-
    -- backlog scope, item 3 of this gate) is what hides ALL orphan rows for
    -- a tombstoned source_order_no from the UI regardless of how they got
    -- there — that is the single place this whole class of row is excluded,
    -- so this UPDATE does not need to chase every possible prior status.
    update analytics.stg_order_line_import
      set import_status = 'tombstoned'
      where shop_id = p_shop_id and source_order_no = v_c.source_order_no and fact_order_item_id is not null;

    v_deleted_ids := array_append(v_deleted_ids, v_c.fact_order_id);
    v_deleted_revenue := v_deleted_revenue + coalesce(v_c.revenue, 0);
    v_deleted_count := v_deleted_count + 1;
  end loop;

  -- physical delete — cascades fact_order_item / dim_address /
  -- crm_order_override (all ON DELETE CASCADE per 0010/0021 — see the
  -- v_cascade_tables guard above), and ON DELETE SET NULLs stg_order_
  -- import.fact_order_id (already tombstoned above) and, transitively via
  -- fact_order_item's own cascade, stg_order_line_import.fact_order_item_id
  -- (already marked tombstoned above, not 'orphan' — QA gate 12 ก.ย. 69).
  delete from analytics.fact_order where id = any (v_deleted_ids) and shop_id = p_shop_id;

  -- recompute is_new_customer (shop-wide, set-based, only writes rows whose
  -- value actually changed — 0045) + first/last_order_at scoped to affected
  -- customers only (0069 precedent), including nulling both out for a
  -- customer left with zero remaining orders.
  with affected as (
    select distinct fod.customer_id
    from analytics.fact_order_deleted fod
    where fod.fact_order_id = any (v_deleted_ids) and fod.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo2.order_date) from analytics.fact_order fo2 where fo2.shop_id = p_shop_id and fo2.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'deleted_count', v_deleted_count,
    'deleted_revenue_thb', v_deleted_revenue,
    'deleted_ids', to_jsonb(v_deleted_ids)
  );
end;
$$;

revoke execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) from public, anon, authenticated;
-- H-1 (security review 12 ก.ย. 69): service_role ONLY — this RPC is never
-- called via a user session (lib/actions/import-missing-orders.ts always
-- uses getServiceClient()); granting authenticated execute let a logged-in
-- user call this permanently-deleting RPC directly over PostgREST, bypassing
-- the app-layer requireOwnerAdmin() gate entirely (crm_require_owner_admin
-- inside the function is defense-in-depth, not meant to be the only gate).
-- Matches 0111/0114's own pattern.
grant execute on function analytics.import_delete_orders(uuid, uuid, uuid[], text) to service_role;

-- ============================================================================
-- 2. analytics.import_restore_orders(shop, deleted_ids)
--
--    All-or-nothing, same as delete. Refuses (raises) if a LIVE fact_order
--    already occupies (shop_id, source_order_no) — design §10's own flagged
--    risk ("Shipnity ใช้เลขซ้ำ") means that slot may since have been
--    legitimately reused by an unrelated new sale; resurrecting the old
--    snapshot on top of it would either 23505 anyway (different id, same
--    unique key) or silently clobber a real order if it somehow shared the
--    id, so this is checked explicitly for a clear error instead of relying
--    on the constraint violation.
--
--    Customer re-link walks merged_into_id exactly ONE hop (design §4 "เดิน
--    merged_into_id 1 ชั้น") — not a full chain walk — so a restored order
--    lands on the customer's CURRENT canonical identity if it was merged
--    away after the delete, without silently resurrecting a reference to a
--    merged (soft-retired) dim_customer row.
-- ============================================================================

create or replace function analytics.import_restore_orders(
  p_shop_id uuid,
  p_deleted_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_del analytics.fact_order_deleted%rowtype;
  v_fo analytics.fact_order%rowtype;
  v_item record;
  v_addr record;
  v_link record;
  v_resolved_customer_id uuid;
  v_conflict_id uuid;
  v_restored_ids uuid[] := '{}';
  v_restored_revenue numeric := 0;
  v_restored_count int := 0;
  v_id uuid;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_shop_id is null then
    raise exception 'import_restore_orders: p_shop_id is required';
  end if;
  if p_deleted_ids is null or array_length(p_deleted_ids, 1) is null or array_length(p_deleted_ids, 1) = 0 then
    raise exception 'import_restore_orders: p_deleted_ids must contain at least one id';
  end if;
  if array_length(p_deleted_ids, 1) > 200 then
    raise exception 'import_restore_orders: cannot restore more than 200 orders in one call (got %)', array_length(p_deleted_ids, 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('analytics.fact_order:' || p_shop_id::text));

  foreach v_id in array p_deleted_ids
  loop
    select * into v_del
      from analytics.fact_order_deleted
      where id = v_id and shop_id = p_shop_id and restored_at is null
      for update;
    if not found then
      raise exception 'import_restore_orders: deleted-order record % not found (already restored, or belongs to another shop) — refusing the whole request, nothing was restored', v_id;
    end if;

    select fo2.id into v_conflict_id
      from analytics.fact_order fo2
      where fo2.shop_id = p_shop_id and fo2.source_order_no = v_del.source_order_no;
    if v_conflict_id is not null then
      raise exception 'import_restore_orders: a live order already exists for source_order_no % (id %) — Shipnity may have reused this number for a new sale; refusing the whole request, nothing was restored',
        v_del.source_order_no, v_conflict_id;
    end if;

    -- customer re-link, one merge hop only.
    v_resolved_customer_id := null;
    if (v_del.order_row ->> 'customer_id') is not null then
      select coalesce(dc.merged_into_id, dc.id) into v_resolved_customer_id
        from analytics.dim_customer dc
        where dc.id = (v_del.order_row ->> 'customer_id')::uuid;
      -- if the lookup finds nothing (customer row genuinely gone), fall back
      -- to NULL rather than failing the whole restore over a display-only
      -- attribute the order's own money/date/channel fields don't depend on.
    end if;

    v_fo := jsonb_populate_record(null::analytics.fact_order, v_del.order_row);
    v_fo.customer_id := v_resolved_customer_id;
    insert into analytics.fact_order select (v_fo).*;

    -- C-1 (security review 12 ก.ย. 69): restore dim_address rows before
    -- items, same insertion-order reasoning the design already used for
    -- fact_order-before-fact_order_item (fact_order_id must exist first —
    -- dim_address.fact_order_id has no NOT NULL but IS the FK the restored
    -- addresses need to point at). Restored with the SAME id the row had at
    -- delete time (jsonb_populate_record carries `id` through, exactly like
    -- v_fo/v_item above) — not re-derived from customer_id, so this does
    -- NOT walk merged_into_id the way fact_order.customer_id does above; a
    -- restored address can reference a since-merged (soft-retired)
    -- dim_customer row, same as it would have before the delete. That is a
    -- pre-existing property of dim_address, not something this restore path
    -- changes.
    for v_addr in select * from jsonb_array_elements(v_del.address_rows)
    loop
      insert into analytics.dim_address
      select (jsonb_populate_record(null::analytics.dim_address, v_addr.value)).*;
    end loop;

    for v_item in select * from jsonb_array_elements(v_del.item_rows)
    loop
      insert into analytics.fact_order_item
      select (jsonb_populate_record(null::analytics.fact_order_item, v_item.value)).*;
    end loop;

    if v_del.override_row is not null then
      insert into analytics.crm_order_override
      select (jsonb_populate_record(null::analytics.crm_order_override, v_del.override_row)).*;
    end if;

    if v_del.stg_order_import_ids is not null and array_length(v_del.stg_order_import_ids, 1) > 0 then
      update analytics.stg_order_import
        set fact_order_id = v_fo.id, import_status = 'transformed', error_detail = null, error_code = null
        where id = any (v_del.stg_order_import_ids) and shop_id = p_shop_id;
    end if;

    for v_link in select * from jsonb_array_elements(v_del.stg_line_links)
    loop
      update analytics.stg_order_line_import
        set fact_order_item_id = (v_link.value ->> 'fact_order_item_id')::uuid,
            import_status = 'transformed', error_detail = null
        where id = (v_link.value ->> 'stg_order_line_import_id')::uuid and shop_id = p_shop_id;
    end loop;

    -- QA gate (12 ก.ย. 69) + security fix M-a (12 ก.ย. 69): stg_line_links
    -- (above) only covers line rows that were ALREADY linked to a
    -- fact_order_item at delete time. A line report re-imported WHILE this
    -- order was tombstoned lands at import_status='tombstoned' with
    -- fact_order_item_id still null (see transform_pending_order_lines
    -- below) — those rows have no entry in stg_line_links at all, so the
    -- loop above never touches them.
    --
    -- 🔴 M-a: 'pending' was the WRONG target status here. transform_
    -- pending_order_lines only ever re-scans rows scoped to a SPECIFIC
    -- batch_id it was called with (`where ... batch_id = p_batch_id and
    -- import_status in ('pending','orphan','error')`) — nothing in this
    -- codebase re-transforms an arbitrary old batch on a schedule, and
    -- analytics.v_orphan_line_backlog only surfaces 'orphan' rows. A row
    -- left at 'pending' is therefore invisible to BOTH the retry path and
    -- the backlog UI: it would sit there silently forever, and the
    -- restored order would carry an understated cogs/overstated profit with
    -- no signal to the owner that an item is missing.
    --
    -- 'orphan' fixes both: transform_pending_order_lines' phase 1 already
    -- treats 'orphan' the same as 'pending' (same `in (...)` list) so it
    -- still self-heals the next time ITS OWN batch is re-transformed, AND
    -- it shows up in v_orphan_line_backlog / getOrphanBacklog as soon as
    -- this transaction commits — correctly, since that view excludes by
    -- "active (restored_at is null) tombstone for this source_order_no",
    -- and this same function sets restored_at on that tombstone a few lines
    -- below (statement order within the transaction doesn't matter here:
    -- both changes land together atomically at commit, so any reader after
    -- this function returns sees the row as both 'orphan' AND no-longer-
    -- excluded, never one without the other).
    update analytics.stg_order_line_import
      set import_status = 'orphan', error_detail = 'order restored — line needs re-transform'
      where shop_id = p_shop_id and source_order_no = v_del.source_order_no
        and import_status = 'tombstoned' and fact_order_item_id is null;

    update analytics.fact_order_deleted
      set restored_at = now(), restored_by = auth.uid()
      where id = v_del.id;

    v_restored_ids := array_append(v_restored_ids, v_fo.id);
    v_restored_revenue := v_restored_revenue + coalesce(v_fo.revenue, 0);
    v_restored_count := v_restored_count + 1;
  end loop;

  with affected as (
    select distinct fo3.customer_id
    from analytics.fact_order fo3
    where fo3.id = any (v_restored_ids) and fo3.customer_id is not null
  ),
  agg as (
    select
      a.customer_id,
      (select min(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as first_at,
      (select max(fo4.order_date) from analytics.fact_order fo4 where fo4.shop_id = p_shop_id and fo4.customer_id = a.customer_id)::timestamptz as last_at
    from affected a
  )
  update analytics.dim_customer c
  set first_order_at = agg.first_at, last_order_at = agg.last_at, updated_at = now()
  from agg
  where agg.customer_id = c.id
    and (c.first_order_at is distinct from agg.first_at or c.last_order_at is distinct from agg.last_at);

  perform analytics.recompute_is_new_customer(p_shop_id);

  return jsonb_build_object(
    'restored_count', v_restored_count,
    'restored_revenue_thb', v_restored_revenue,
    'restored_ids', to_jsonb(v_restored_ids)
  );
end;
$$;

revoke execute on function analytics.import_restore_orders(uuid, uuid[]) from public, anon, authenticated;
-- H-1: same reasoning as import_delete_orders above.
grant execute on function analytics.import_restore_orders(uuid, uuid[]) to service_role;

-- ============================================================================
-- 3. analytics.transform_pending_order_lines — tombstone-aware (QA gate,
--    12 ก.ย. 69, task brief item 2). Body is byte-identical to the LIVE
--    definition on the DB as of 12 ก.ย. 69 (pulled via pg_get_functiondef,
--    saved at .../scratchpad/transform_pending_order_lines_live.sql — NOT
--    copied from 0041/0094/0109 in this repo, per that file's own warning)
--    except ONE insertion, marked "-- QA gate 12 ก.ย. 69:" below, inside the
--    phase 1 "no matching fact_order" branch.
--
--    Case 2 from the task brief ("re-import ไฟล์รายการสินค้าหลังลบ"): before
--    this fix, a line-item file re-imported for a since-deleted order's
--    source_order_no landed on 'orphan' via the plain "not found" path below
--    — indistinguishable from a genuine "line arrived before its order
--    report" gap, so it re-polluted getOrphanBacklog exactly the way
--    import_delete_orders' own line-status fix (section 0/1 above) was
--    already fixing for the "line was already linked at delete time" case.
--    This closes the other half: lines that only ever show up AFTER the
--    order was deleted.
--
--    Signature/return shape unchanged ((uuid, uuid) -> TABLE(transformed_
--    count, orphan_count, skipped_blank_count, unknown_sku_count, errored_
--    count)) -> plain `create or replace` is correct (3j-migration-traps
--    #1); grants do not survive replace on Supabase -> explicit revoke+
--    grant below (#2).
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 RETURNS TABLE(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_category text;
  v_sku_norm text;
  v_stripped_len int;
  v_stripped text;
  v_match_count int;
  v_match_note text;
  v_tier3_conclusive boolean;
  v_weak_order boolean;
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

  for v_row in
    select * from analytics.stg_order_line_import
    where shop_id = p_shop_id and batch_id = p_batch_id and import_status in ('pending', 'orphan', 'error')
    order by source_order_no, line_no
  loop
    begin
      if v_row.sku_raw is null then
        update analytics.stg_order_line_import set import_status = 'skipped_blank', error_detail = null where id = v_row.id;
        v_skipped_blank := v_skipped_blank + 1;
        continue;
      end if;
      if v_row.source_order_no is null then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = 'source_order_no is null on a non-blank SKU row' where id = v_row.id;
        v_errored := v_errored + 1;
        continue;
      end if;
      perform 1 from analytics.fact_order fo where fo.shop_id = p_shop_id and fo.source_order_no = v_row.source_order_no;
      if not found then
        -- QA gate 12 ก.ย. 69: an order with no LIVE fact_order might still
        -- be a deliberately-deleted one, not a genuine orphan (line arrived
        -- before its order report). Check the tombstone BEFORE falling
        -- through to 'orphan' — same precedence 0114 already uses on the
        -- order-header side. Does not increment v_orphan (this is not a
        -- data-quality gap to wait out; it's an expected, permanent state
        -- until/unless the order is restored) and does not overwrite
        -- fact_order_item_id (nothing to link — 'not found' means it was
        -- already null or is being re-set null on a fresh row).
        if exists (
          select 1 from analytics.fact_order_deleted fod
          where fod.shop_id = p_shop_id and fod.source_order_no = v_row.source_order_no and fod.restored_at is null
        ) then
          update analytics.stg_order_line_import set import_status = 'tombstoned', error_detail = 'order deleted (tombstone)' where id = v_row.id;
          continue;
        end if;
        update analytics.stg_order_line_import set import_status = 'orphan', error_detail = 'no fact_order for source_order_no: ' || v_row.source_order_no where id = v_row.id;
        v_orphan := v_orphan + 1;
        continue;
      end if;
      -- 0109: a matching fact_order exists. Promote this row back to
      -- 'pending' if it is currently stuck at 'orphan' or 'error' so phase 2
      -- below (and any subsequent call) can pick it up. Rows already
      -- 'pending' (the normal happy path -- freshly inserted, order already
      -- existed) are left alone by the `is distinct from` guard: no
      -- redundant UPDATE, no behavior change on the path that already
      -- worked.
      if v_row.import_status is distinct from 'pending' then
        update analytics.stg_order_line_import
           set import_status = 'pending', error_detail = null
         where id = v_row.id;
      end if;
    exception when others then
      update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_row.id;
      v_errored := v_errored + 1;
    end;
  end loop;

  for v_fo in
    select distinct fo.id as fact_order_id, fo.source_order_no
    from analytics.stg_order_line_import s
    join analytics.fact_order fo on fo.shop_id = p_shop_id and fo.source_order_no = s.source_order_no
    where s.shop_id = p_shop_id and s.batch_id = p_batch_id and s.import_status = 'pending' and s.sku_raw is not null
  loop
    delete from analytics.fact_order_item where fact_order_id = v_fo.fact_order_id;
    v_cogs := 0;
    v_weak_order := false;
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;
        v_tier3_conclusive := false;

        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);
          v_stripped := left(v_item.sku_raw, v_stripped_len);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]'
             and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') then
            select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
              into v_product_id, v_unit_cost, v_category, v_match_count
              from (
                select vp.product_id, vp.effective_unit_cost, vp.category,
                       count(*) over () as cnt
                  from analytics.v_dim_product vp
                  where vp.shop_id = p_shop_id and vp.is_active
                    and regexp_replace(vp.sku, '^[^A-Za-z0-9]+', '') = v_sku_norm
                  limit 1
              ) sub;

            if v_match_count = 1 then
              v_match_note := 'จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า: ' || v_item.sku_raw || ' -> ' || v_sku_norm;
            else
              if coalesce(v_match_count, 0) = 0 then
                v_tier3_conclusive := true;
              end if;
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
            into v_product_id, v_unit_cost, v_category, v_match_count
            from (
              select vp.product_id, vp.effective_unit_cost, vp.category,
                     count(*) over () as cnt
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and not vp.is_active and vp.sku = v_item.sku_raw
                limit 1
            ) sub;

          if v_match_count = 1 then
            if v_tier3_conclusive then
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม): ' || v_item.sku_raw;
            else
              v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม) — ยังพิสูจน์ไม่ได้ว่าไม่มีคู่แฝดที่ยังขายอยู่ — ต้องตรวจมือ: ' || v_item.sku_raw;
              v_weak_order := true;
            end if;
          else
            v_product_id := null; v_unit_cost := null; v_category := null;
          end if;
        end if;

        if v_product_id is null then
          v_unknown := v_unknown + 1;
          v_weak_order := true;
          v_match_note := 'ไม่พบสินค้าในระบบ ต้นทุนถูกนับเป็น 0: ' || v_item.sku_raw;
        end if;
        if v_category = 'เงินแท่ง' then
          v_unit_cost := round(coalesce(v_item.unit_price, 0) / 1.2, 2);
        end if;
        insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, product_name_snapshot, qty, unit_price, unit_cost_snapshot)
        values (p_shop_id, v_fo.fact_order_id, v_product_id, v_item.sku_raw, v_item.product_name_raw, coalesce(v_item.qty, 1), coalesce(v_item.unit_price, 0), v_unit_cost)
        returning id into v_new_item_id;
        update analytics.stg_order_line_import set fact_order_item_id = v_new_item_id, import_status = 'transformed', error_detail = v_match_note where id = v_item.id;
        v_transformed := v_transformed + 1;
        v_cogs := v_cogs + coalesce(v_item.qty, 1) * coalesce(v_unit_cost, 0);
      exception when others then
        update analytics.stg_order_line_import set import_status = 'error', error_detail = sqlerrm where id = v_item.id;
        v_errored := v_errored + 1;
        v_weak_order := true;
      end;
    end loop;
    update analytics.fact_order
       set cogs = v_cogs,
           profit = round(revenue - v_cogs, 2),
           profit_status = case when v_weak_order then 'estimated' else 'actual' end::analytics.profit_status_t
     where id = v_fo.fact_order_id;
  end loop;

  return query select v_transformed, v_orphan, v_skipped_blank, v_unknown, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

-- ============================================================================
-- 4. analytics.v_orphan_line_backlog — QA gate item 3 (12 ก.ย. 69), defense
--    in depth for getOrphanBacklog (lib/actions/import-line-items.ts).
--
--    Sections 0-3 above stop NEW 'orphan' rows from being created for a
--    deleted order's line items (delete-time flip to 'tombstoned', and now
--    transform_pending_order_lines checking the tombstone before falling
--    back to 'orphan' on re-import). This view is the belt-and-suspenders
--    layer for whatever that misses — e.g. a line row that was ALREADY
--    sitting at 'orphan' (fact_order_item_id null, never linked) from BEFORE
--    its order was ever created+deleted; nothing above ever touches that
--    row's status, since import_delete_orders only flips rows it is
--    actively un-linking (fact_order_item_id is not null) and transform
--    only runs when something re-imports that specific batch. Filtering by
--    source_order_no here (not import_status alone) catches that row
--    regardless of how it got into 'orphan' or whether anything ever
--    re-processes it again.
--
--    getOrphanBacklog previously queried analytics.stg_order_line_import
--    directly over PostgREST with a plain import_status='orphan' filter —
--    per this codebase's own rule ("ห้ามดึงทั้งตารางมากรองฝั่ง TS"), the
--    NOT EXISTS exclusion belongs in the DB, not fetched-then-filtered in
--    TypeScript. A view (not an RPC) is the right shape here: this is a
--    plain filtered SELECT with no side effects and no owner-admin business
--    logic beyond what RLS on the underlying tables already provides —
--    exactly what analytics.v_silver_price_public_14d (0102) and this
--    schema's other views already use `security_invoker = true` for.
--
--    Columns are flattened (source_order_no + imported_at, no nested FK
--    embed) — getOrphanBacklog no longer needs to defensively unwrap
--    PostgREST's array-or-object embed shape for stg_import_batch.
-- ============================================================================

create or replace view analytics.v_orphan_line_backlog
  with (security_invoker = true) as
select
  sli.id,
  sli.shop_id,
  sli.source_order_no,
  sib.imported_at
from analytics.stg_order_line_import sli
join analytics.stg_import_batch sib on sib.id = sli.batch_id
where sli.import_status = 'orphan'
  and not exists (
    select 1 from analytics.fact_order_deleted fod
    where fod.shop_id = sli.shop_id
      and fod.source_order_no = sli.source_order_no
      and fod.restored_at is null
  );

comment on view analytics.v_orphan_line_backlog is
  'getOrphanBacklog''s source — analytics.stg_order_line_import rows stuck at import_status=''orphan'', EXCLUDING any whose source_order_no belongs to a currently-tombstoned (deliberately deleted, not-yet-restored) order. See migration 0115 section 4 for why this exclusion lives here and not in TypeScript.';

-- security_invoker=true means RLS on the underlying tables (stg_order_line_
-- import/stg_import_batch's existing owner_admin_select policies,
-- fact_order_deleted's from 0112) still applies to whichever role queries
-- this view — the grant below only decides WHO may query it at all, same
-- "policy filters rows, grant allows the table/view" split as every other
-- grant in this migration.
grant select on analytics.v_orphan_line_backlog to authenticated, service_role;



-- ============================================================================
-- STEP 1: single do-block — fixtures, every required assertion, forced
-- rollback. See scripts/verify-0111-upsert-rules.sql for the pattern this
-- follows (T0/T8 golden-snapshot pairing, per-case OK/FAIL log lines,
-- unconditional raise at the end).
-- ============================================================================

do $verify$
declare
  v_shop_id constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_tag text := 'VERIFY-0115-' || replace(gen_random_uuid()::text, '-', '');
  v_log text := E'\n=== verify-0115 missing-orders/delete/restore rehearsal ===\n';
  v_fail_count int := 0;

  v_chan_a_id uuid; v_chan_a_alias text;
  v_chan_b_id uuid; v_chan_b_alias text;

  v_t0_count bigint; v_t0_revenue numeric; v_t0_discount numeric; v_t0_cogs numeric; v_t0_profit numeric; v_t0_items bigint;
  v_t8_count bigint; v_t8_revenue numeric; v_t8_discount numeric; v_t8_cogs numeric; v_t8_profit numeric; v_t8_items bigint;

  v_batch_old uuid; v_batch_main uuid; v_batch_error uuid; v_batch_wrongsrc uuid;
  v_batch_newer uuid; v_batch_notdone uuid; v_batch_cap uuid;

  v_stg_old_id uuid; -- ZZ150's staging row (batch_old) — reused by re-transform test
  v_stg_line_zz150_id uuid; -- ZZ150's line-item staging row (batch_old) — QA item 4 assertions
  v_stg_line_zz150_orphan_id uuid; -- M-b(3): pre-existing 'orphan' line for ZZ150, never linked

  v_id_zz150 uuid; v_id_zz155 uuid; v_id_zz160 uuid; v_id_zz165 uuid; v_id_zz170 uuid;
  v_id_zz050 uuid; v_id_zz250 uuid; v_id_zz190 uuid;
  v_item_id uuid;
  v_addr_id uuid; -- C-1: dim_address fixture for ZZ150

  v_other_shop_id uuid;

  v_candidates_result uuid[];
  v_missing_json jsonb;
  v_delete_result jsonb;
  v_restore_result jsonb;
  v_deleted_id_zz150 uuid; -- fact_order_deleted.id for ZZ150 — captured once, reused by the duplicate-ids test and the real restore

  v_before_ts timestamptz;
  v_new_cust_count int;

  v_revenue_before numeric; v_revenue_after numeric;
  v_dash_before jsonb; v_dash_after jsonb;

  -- dry-run caught 22P02 here (12 ก.ย. 69): this was declared %rowtype
  -- against the WRONG table — used below only via select * into v_row from
  -- analytics.stg_order_import (STEP 7's re-transform check), reading
  -- v_row.import_status / v_row.fact_order_id, both stg_order_import
  -- columns (fact_order has neither). PL/pgSQL's `select * into` assigns
  -- positionally by column ORDER, not by name — fact_order%rowtype's first
  -- few columns happen to include a uuid, and stg_order_import's `raw
  -- jsonb` column (default '{}') landed on it, so this failed at EXECUTE
  -- time as "invalid input syntax for type uuid: {}", not at CREATE time.
  v_row analytics.stg_order_import%rowtype;
  v_fake_phone text := '0891234567';

  -- QA item 4 (orphan-backlog line-item tombstone assertions).
  v_orphan_count_before int; v_orphan_count_after int;
  v_batch_line_reimport uuid;
  v_stg_line_reimport_id uuid;
  v_tpol_transformed int; v_tpol_orphan int; v_tpol_skipped int; v_tpol_unknown int; v_tpol_errored int;

  -- Extra tests: restore-vs-live-conflict + duplicate ids + cross-shop id +
  -- existing-but-invalid id + merged-customer walk.
  v_deleted_id_zz400 uuid;
  v_id_zz400_live uuid;
  v_cust_a_id uuid; v_cust_b_id uuid;
  v_batch_merge uuid;
  v_batch_skipped uuid; -- M-b(1): row_count_skipped=1 gate
  v_batch_badchannel uuid; -- M-b(2): channels_unresolved gate
  v_id_zz750 uuid;
  v_deleted_id_zz750 uuid;
  v_restored_zz750_customer_id uuid;
begin
  -- run as service_role, matching how the app actually calls these RPCs.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select dca.channel_id, dca.alias_raw into v_chan_a_id, v_chan_a_alias
    from analytics.dim_channel_alias dca limit 1;
  select dca.channel_id, dca.alias_raw into v_chan_b_id, v_chan_b_alias
    from analytics.dim_channel_alias dca where dca.channel_id <> v_chan_a_id limit 1;

  if v_chan_a_id is null or v_chan_b_id is null then
    raise exception 'verify-0115: need at least 2 distinct dim_channel_alias rows for fixtures -- environment problem, not a 0113/0114/0115 bug. Stop and check seed data.';
  end if;

  -- ==========================================================================
  -- STEP 1: T0 golden snapshot (whole shop, BEFORE any fixture exists).
  -- ==========================================================================
  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_t0_count, v_t0_revenue, v_t0_discount, v_t0_cogs, v_t0_profit
    from analytics.fact_order where shop_id = v_shop_id;
  select count(*) into v_t0_items from analytics.fact_order_item where shop_id = v_shop_id;
  v_log := v_log || format(E'T0 golden: count=%s revenue=%s items=%s\n', v_t0_count, v_t0_revenue, v_t0_items);

  -- ==========================================================================
  -- STEP 2: fixtures.
  -- ==========================================================================

  -- batches
  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-old.xlsx', v_tag || '-old', 'transformed', now() - interval '10 days')
  returning id into v_batch_old;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-main.xlsx', v_tag || '-main', 'transformed', now())
  returning id into v_batch_main;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-err.xlsx', v_tag || '-err', 'transformed', now())
  returning id into v_batch_error;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_line_item_report', v_tag || '-wrongsrc.xlsx', v_tag || '-wrongsrc', 'transformed', now())
  returning id into v_batch_wrongsrc;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-newer.xlsx', v_tag || '-newer', 'transformed', now() + interval '1 hour')
  returning id into v_batch_newer;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-notdone.xlsx', v_tag || '-notdone', 'loaded', now())
  returning id into v_batch_notdone;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-cap.xlsx', v_tag || '-cap', 'transformed', now())
  returning id into v_batch_cap;

  -- batch_main's F: ZZ100/ZZ120/ZZ180/ZZ200, dates 2026-01-10..2026-01-15,
  -- channel = v_chan_a_id -> defines prefix ZZ: lo=100 hi=200 dlo=01-10 dhi=01-15.
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, discount_total, import_status)
  values
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ100', v_chan_a_alias, '2026-01-10 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ120', v_chan_a_alias, '2026-01-11 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ180', v_chan_a_alias, '2026-01-14 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_main, v_shop_id, '{}'::jsonb, 'excel', 'ZZ200', v_chan_a_alias, '2026-01-15 09:00:00+07', 100, 0, 'transformed');
  -- these 4 rows also need a live fact_order row each (their own source_order_no
  -- must exist so C2 excludes them, and so P4 has real rows to parse) --
  -- content doesn't matter beyond satisfying not-null columns.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values
    (v_shop_id, 'ZZ100', v_chan_a_id, '2026-01-10', 100),
    (v_shop_id, 'ZZ120', v_chan_a_id, '2026-01-11', 100),
    (v_shop_id, 'ZZ180', v_chan_a_id, '2026-01-14', 100),
    (v_shop_id, 'ZZ200', v_chan_a_id, '2026-01-15', 100);

  -- G686-analog: ZZ150, mid-range num, date in range, channel in file,
  -- printed_at null -- the ONE order that should show up as a candidate.
  -- Already-transformed via batch_old (simulates "imported before, missing
  -- from today's file"). phone_raw set so the re-transform test below can
  -- prove no dim_customer gets created when a tombstoned row is skipped.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ150', v_chan_a_id, '2026-01-12', 250.00, null)
  returning id into v_id_zz150;

  insert into analytics.fact_order_item (shop_id, fact_order_id, sku_snapshot, product_name_snapshot, qty, unit_price)
  values (v_shop_id, v_id_zz150, v_tag || '-SKU', 'verify fixture item', 1, 250.00)
  returning id into v_item_id;

  insert into analytics.crm_order_override (fact_order_id, shop_id, overrides, reason)
  values (v_id_zz150, v_shop_id, jsonb_build_object('tags', jsonb_build_array('verify-fixture')), v_tag || ' override');

  -- C-1 (security review 12 ก.ย. 69): dim_address fixture — proves the
  -- snapshot/restore now covers this table too (before this fix, this row
  -- would cascade away on delete and never come back).
  insert into analytics.dim_address (shop_id, fact_order_id, raw_address)
  values (v_shop_id, v_id_zz150, v_tag || ' 123 verify fixture address')
  returning id into v_addr_id;

  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, phone_raw, order_created_at, revenue, discount_total, import_status, fact_order_id)
  values (v_batch_old, v_shop_id, '{}'::jsonb, 'excel', 'ZZ150', v_chan_a_alias, v_fake_phone, '2026-01-01 09:00:00+07', 250.00, 0, 'transformed', v_id_zz150)
  returning id into v_stg_old_id;

  insert into analytics.stg_order_line_import (batch_id, shop_id, source_order_no, line_no, sku_raw, product_name_raw, qty, raw, import_status, fact_order_item_id)
  values (v_batch_old, v_shop_id, 'ZZ150', 1, v_tag || '-SKU', 'verify fixture item', 1, '{}'::jsonb, 'transformed', v_item_id)
  returning id into v_stg_line_zz150_id;

  -- M-b(3) fixture (security review 12 ก.ย. 69): a line row ALREADY sitting
  -- at 'orphan' (never linked, fact_order_item_id null) BEFORE ZZ150 is ever
  -- deleted — simulates "line arrived before the matching order-report file
  -- import_delete_orders' own status flip never touches this (it only
  -- re-flips rows it is actively un-linking, fact_order_item_id is not
  -- null), so this row is the one that actually exercises v_orphan_line_
  -- backlog's NOT EXISTS tombstone-exclusion clause after ZZ150 is deleted
  -- below — without that clause this row alone would still show up in the
  -- backlog as an "unexplained" orphan even though its order is a known,
  -- deliberate cancellation.
  insert into analytics.stg_order_line_import (batch_id, shop_id, source_order_no, line_no, sku_raw, product_name_raw, qty, raw, import_status, error_detail)
  values (v_batch_old, v_shop_id, 'ZZ150', 3, v_tag || '-SKU3', 'verify fixture pre-existing orphan item', 1, '{}'::jsonb, 'orphan', 'no fact_order for source_order_no: ZZ150 (pre-existing orphan fixture)')
  returning id into v_stg_line_zz150_orphan_id;

  -- 8 "must NOT delete" fixtures --------------------------------------------

  -- #1 C4: date outside [dlo,dhi].
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ155', v_chan_a_id, '2025-01-01', 100) returning id into v_id_zz155;

  -- #2 C5: channel not in file's channel set.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ160', v_chan_b_id, '2026-01-12', 100) returning id into v_id_zz160;

  -- #3 C1: different shop entirely (temp shop, created+dropped in this transaction).
  insert into public.shop (name) values (v_tag || ' temp shop') returning id into v_other_shop_id;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_other_shop_id, 'ZZ165', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz165;

  -- #4/#5 P3: batch_error has one 'error' row -> whole batch blocked
  -- (brief cases 4 "batch มี error row" and 5 "แถว error ในไฟล์" are the same
  -- precondition -- one fixture covers both).
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status, error_detail)
  values (v_batch_error, v_shop_id, '{}'::jsonb, 'excel', 'ZZ666', v_chan_a_alias, '2026-02-01 09:00:00+07', 100, 'error', v_tag || ' fixture error row');

  -- #6 P1: batch_wrongsrc has source_type <> excel_order_report entirely.

  -- #7 C7: ZZ170 exists live, but its (only) staging row currently belongs
  -- to batch_newer (imported AFTER batch_main) -- a newer file already
  -- re-confirmed it, so it must not read as "missing" from batch_main.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ170', v_chan_a_id, '2026-01-12', 100, null) returning id into v_id_zz170;
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status, fact_order_id)
  values (v_batch_newer, v_shop_id, '{}'::jsonb, 'excel', 'ZZ170', v_chan_a_alias, '2026-01-16 09:00:00+07', 100, 'transformed', v_id_zz170);

  -- #8 C3 strict: below lo / above hi.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ050', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz050;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ250', v_chan_a_id, '2026-01-12', 100) returning id into v_id_zz250;

  -- extra valid candidate reserved for the "invalid id mixed in" test below.
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, printed_at)
  values (v_shop_id, 'ZZ190', v_chan_a_id, '2026-01-12', 100, null) returning id into v_id_zz190;

  -- cap-test batch: F = ZZ500/ZZ600 (defines lo=500 hi=600), 21 live
  -- "missing" candidates ZZ501..ZZ521 -> candidate_count(21) > cap(20).
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ500', v_chan_a_id, '2026-03-01', 100), (v_shop_id, 'ZZ600', v_chan_a_id, '2026-03-10', 100);
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, import_status)
  values
    (v_batch_cap, v_shop_id, '{}'::jsonb, 'excel', 'ZZ500', v_chan_a_alias, '2026-03-01 09:00:00+07', 100, 'transformed'),
    (v_batch_cap, v_shop_id, '{}'::jsonb, 'excel', 'ZZ600', v_chan_a_alias, '2026-03-10 09:00:00+07', 100, 'transformed');
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  select v_shop_id, 'ZZ' || (500 + g)::text, v_chan_a_id, '2026-03-05'::date, 10
  from generate_series(1, 21) as g;

  -- ==========================================================================
  -- STEP 3: candidates helper — G686-analog must appear, all 8 must not.
  -- ==========================================================================
  select array_agg(fact_order_id) into v_candidates_result
    from analytics.import_missing_orders_candidates(v_shop_id, v_batch_main);

  if v_candidates_result is null or not (v_id_zz150 = any (v_candidates_result)) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL G686-analog: ZZ150 not found in candidates\n';
  else
    v_log := v_log || E'OK   G686-analog: ZZ150 found in candidates\n';
  end if;

  -- H-3 (security review 12 ก.ย. 69): ZZ190 (num=190, date 2026-01-12,
  -- channel A) is ALSO a genuine candidate against batch_main's F (lo=100
  -- hi=200, dlo=01-10 dhi=01-15) — it was fixtured below purely as "the
  -- valid id" for the invalid-id-mixed-in test, but it independently
  -- satisfies C1-C8 same as ZZ150 does, so it must show up here too. The
  -- original verify script asserted candidate_count=1 (ZZ150 only), which
  -- was simply wrong — it would have FAILed this rehearsal against a
  -- correct 0113 implementation.
  if v_candidates_result is null or not (v_id_zz190 = any (v_candidates_result)) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL H-3: ZZ190 not found in candidates (it is a genuine candidate, not just an invalid-id-test fixture)\n';
  else
    v_log := v_log || E'OK   H-3: ZZ190 found in candidates\n';
  end if;

  if v_candidates_result is not null and (
       v_id_zz155 = any (v_candidates_result) or v_id_zz160 = any (v_candidates_result)
       or v_id_zz165 = any (v_candidates_result) or v_id_zz170 = any (v_candidates_result)
       or v_id_zz050 = any (v_candidates_result) or v_id_zz250 = any (v_candidates_result)
     ) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL exclusions: one of the 6 fact_order-level must-not-delete fixtures leaked into candidates\n';
  else
    v_log := v_log || E'OK   exclusions: C1/C4/C5/C7/C3(lo)/C3(hi) fixtures all correctly excluded\n';
  end if;

  -- P1 (batch_wrongsrc): must raise blocked/shop_or_source_mismatch.
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_wrongsrc);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P1: wrong source_type batch did not raise\n';
  exception when others then
    if sqlstate = 'P0001' then
      v_log := v_log || E'OK   P1: wrong source_type batch raised as expected\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format(E'FAIL P1: raised but unexpected sqlstate=%s sqlerrm=%s\n', sqlstate, sqlerrm);
    end if;
  end;

  -- P2 (batch_notdone, status='loaded'): must raise.
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_notdone);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P2: not-yet-transformed batch did not raise\n';
  exception when others then
    v_log := v_log || E'OK   P2: not-yet-transformed batch raised as expected\n';
  end;

  -- P3 (batch_error, has one error row): must raise (covers brief cases 4+5).
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_error);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL P3: batch with an error row did not raise\n';
  exception when others then
    v_log := v_log || E'OK   P3: batch with an error row raised as expected\n';
  end;

  -- M-b(1) (security review 12 ก.ย. 69): H-2's file_rows_skipped gate —
  -- isolated batch (own ZZ900 number, not part of batch_main's F) with
  -- row_count_skipped=1. Must raise, THEN reset row_count_skipped to 0 and
  -- prove the SAME batch no longer raises — ties the block causally to that
  -- one column instead of some other coincidental fixture problem.
  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at, row_count_skipped)
  values (v_shop_id, 'excel_order_report', v_tag || '-skipped.xlsx', v_tag || '-skipped', 'transformed', now(), 1)
  returning id into v_batch_skipped;
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, discount_total, import_status)
  values (v_batch_skipped, v_shop_id, '{}'::jsonb, 'excel', 'ZZ900', v_chan_a_alias, '2026-05-01 09:00:00+07', 100, 0, 'transformed');

  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_skipped);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL M-b(1): batch with row_count_skipped=1 did not raise\n';
  exception when others then
    if sqlstate = 'P0001' then
      v_log := v_log || E'OK   M-b(1): batch with row_count_skipped=1 raised as expected\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format(E'FAIL M-b(1): raised but unexpected sqlstate=%s sqlerrm=%s\n', sqlstate, sqlerrm);
    end if;
  end;

  update analytics.stg_import_batch set row_count_skipped = 0 where id = v_batch_skipped;
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_skipped);
    v_log := v_log || E'OK   M-b(1) reset: row_count_skipped=0 no longer raises\n';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL M-b(1) reset: still raised after resetting row_count_skipped to 0 -- sqlerrm=%s\n', sqlerrm);
  end;

  -- M-b(2): M-1's channels_unresolved gate — isolated batch (own ZZ910
  -- number) whose sole row's channel_raw matches no dim_channel_alias at
  -- all. Must raise, then reset channel_raw to a resolvable alias and prove
  -- the SAME batch no longer raises.
  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-badchannel.xlsx', v_tag || '-badchannel', 'transformed', now())
  returning id into v_batch_badchannel;
  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, discount_total, import_status)
  values (v_batch_badchannel, v_shop_id, '{}'::jsonb, 'excel', 'ZZ910', v_tag || '-nonexistent-channel', '2026-05-02 09:00:00+07', 100, 0, 'transformed');

  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_badchannel);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL M-b(2): batch with unresolvable channel_raw did not raise\n';
  exception when others then
    if sqlstate = 'P0001' then
      v_log := v_log || E'OK   M-b(2): batch with unresolvable channel_raw raised as expected\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format(E'FAIL M-b(2): raised but unexpected sqlstate=%s sqlerrm=%s\n', sqlstate, sqlerrm);
    end if;
  end;

  update analytics.stg_order_import set channel_raw = v_chan_a_alias where batch_id = v_batch_badchannel;
  begin
    perform 1 from analytics.import_missing_orders_candidates(v_shop_id, v_batch_badchannel);
    v_log := v_log || E'OK   M-b(2) reset: resolvable channel_raw no longer raises\n';
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL M-b(2) reset: still raised after fixing channel_raw -- sqlerrm=%s\n', sqlerrm);
  end;

  -- ==========================================================================
  -- STEP 4: import_missing_orders (jsonb wrapper) — ok path + evidence.
  -- ==========================================================================
  select analytics.import_missing_orders(v_shop_id, v_batch_main) into v_missing_json;
  if (v_missing_json ->> 'ok')::boolean is not true then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL import_missing_orders(batch_main): ok=false, blocked_reason=%s\n', v_missing_json ->> 'blocked_reason');
  elsif (v_missing_json ->> 'candidate_count')::int <> 2 then
    -- H-3 fix: 2 (ZZ150 + ZZ190), not 1 — see STEP 3's H-3 comment above.
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL import_missing_orders(batch_main): candidate_count=%s, want 2 (ZZ150 + ZZ190)\n', v_missing_json ->> 'candidate_count');
  elsif not (v_missing_json -> 'candidates' @> jsonb_build_array(jsonb_build_object('fact_order_id', v_id_zz150)))
     or not (v_missing_json -> 'candidates' @> jsonb_build_array(jsonb_build_object('fact_order_id', v_id_zz190))) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL import_missing_orders(batch_main): candidates array missing ZZ150 or ZZ190: %s\n', v_missing_json -> 'candidates');
  else
    v_log := v_log || E'OK   import_missing_orders(batch_main): ok=true, candidate_count=2 (ZZ150 + ZZ190), both present in candidates[]\n';
  end if;

  -- cap test: batch_cap must be blocked with too_many but STILL return the
  -- 21 candidates (brief: "cap too_many (blocked แต่ยังคืน candidates)").
  select analytics.import_missing_orders(v_shop_id, v_batch_cap) into v_missing_json;
  if (v_missing_json ->> 'ok')::boolean is not false or v_missing_json ->> 'blocked_reason' is distinct from 'too_many' then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL cap: expected ok=false blocked_reason=too_many, got ok=%s blocked_reason=%s\n', v_missing_json ->> 'ok', v_missing_json ->> 'blocked_reason');
  elsif jsonb_array_length(v_missing_json -> 'candidates') <> 21 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL cap: expected 21 candidates still returned despite block, got %s\n', jsonb_array_length(v_missing_json -> 'candidates'));
  else
    v_log := v_log || E'OK   cap: batch_cap blocked with too_many, still returned all 21 candidates\n';
  end if;

  -- ==========================================================================
  -- STEP 5: delete-with-invalid-id — must raise, must delete NOTHING.
  -- ==========================================================================
  select coalesce(sum(revenue), 0) into v_revenue_before from analytics.fact_order where shop_id = v_shop_id;
  begin
    perform analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz190, gen_random_uuid()], v_tag || ' invalid-id test');
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL invalid-id: call with a bogus id mixed in did not raise\n';
  exception when others then
    v_log := v_log || E'OK   invalid-id: call with a bogus id mixed in raised as expected\n';
  end;
  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if v_revenue_before is distinct from v_revenue_after then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL invalid-id: revenue moved (%s -> %s) -- a partial delete happened, "raise ทั้งก้อน" was violated\n', v_revenue_before, v_revenue_after);
  else
    v_log := v_log || E'OK   invalid-id: revenue unchanged, nothing was deleted (all-or-nothing held)\n';
  end if;
  if exists (select 1 from analytics.fact_order where id = v_id_zz190 and shop_id = v_shop_id) then
    v_log := v_log || E'OK   invalid-id: ZZ190 (the one valid id in the mixed call) is still live\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL invalid-id: ZZ190 got deleted despite the whole call being expected to abort\n';
  end if;

  -- QA (12 ก.ย. 69, "เล็ก"): same all-or-nothing check, but the invalid id
  -- is a REAL, EXISTING fact_order that simply fails a candidate rule (ZZ155
  -- fails C4 — date outside range) rather than a literally nonexistent uuid.
  -- Proves the `x not in (select fact_order_id from candidates)` guard in
  -- import_delete_orders catches "exists but not a valid candidate", not
  -- just "does not exist at all".
  select coalesce(sum(revenue), 0) into v_revenue_before from analytics.fact_order where shop_id = v_shop_id;
  begin
    perform analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz190, v_id_zz155], v_tag || ' existing-invalid-id test');
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL existing-invalid-id: call mixing ZZ190 (valid) with ZZ155 (real order, fails C4) did not raise\n';
  exception when others then
    v_log := v_log || E'OK   existing-invalid-id: call raised as expected\n';
  end;
  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if v_revenue_before is distinct from v_revenue_after
     or not exists (select 1 from analytics.fact_order where id = v_id_zz190 and shop_id = v_shop_id)
     or not exists (select 1 from analytics.fact_order where id = v_id_zz155 and shop_id = v_shop_id) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL existing-invalid-id: something got deleted despite the whole call being expected to abort\n';
  else
    v_log := v_log || E'OK   existing-invalid-id: nothing deleted, both ZZ190 and ZZ155 still live\n';
  end if;

  -- M-3(a) (security review 12 ก.ย. 69): a fact_order id that belongs to a
  -- DIFFERENT shop, passed directly (not mixed with a valid id) — must raise
  -- the same way (C1 excludes it from candidates for v_shop_id entirely).
  begin
    perform analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz165], v_tag || ' cross-shop test');
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL cross-shop: deleting another shop''s order id did not raise\n';
  exception when others then
    v_log := v_log || E'OK   cross-shop: deleting another shop''s order id raised as expected\n';
  end;
  if not exists (select 1 from analytics.fact_order where id = v_id_zz165 and shop_id = v_other_shop_id) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL cross-shop: ZZ165 (other shop) got deleted despite belonging to a different shop_id\n';
  else
    v_log := v_log || E'OK   cross-shop: ZZ165 (other shop) untouched\n';
  end if;

  -- ==========================================================================
  -- STEP 6: real delete of ZZ150 -- snapshot correctness + side effects.
  -- ==========================================================================
  select coalesce(sum(revenue), 0) into v_revenue_before from analytics.fact_order where shop_id = v_shop_id;
  select analytics.dashboard_summary(v_shop_id, '2000-01-01'::date, '2035-12-31'::date, null, true) into v_dash_before;
  -- QA item 4(a): orphan-backlog row count for this shop BEFORE the delete
  -- (should not grow once ZZ150's line is deleted — it goes to 'tombstoned', not 'orphan').
  select count(*) into v_orphan_count_before
    from analytics.stg_order_line_import where shop_id = v_shop_id and import_status = 'orphan';

  select analytics.import_delete_orders(v_shop_id, v_batch_main, array[v_id_zz150], v_tag || ' delete test') into v_delete_result;

  if (v_delete_result ->> 'deleted_count')::int <> 1 or (v_delete_result ->> 'deleted_revenue_thb')::numeric is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: deleted_count=%s deleted_revenue_thb=%s (want 1 / 250.00)\n', v_delete_result ->> 'deleted_count', v_delete_result ->> 'deleted_revenue_thb');
  else
    v_log := v_log || E'OK   delete: deleted_count=1, deleted_revenue_thb=250.00\n';
  end if;

  if exists (select 1 from analytics.fact_order where id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: fact_order row for ZZ150 still exists\n';
  else v_log := v_log || E'OK   delete: fact_order row for ZZ150 is gone\n'; end if;

  if exists (select 1 from analytics.fact_order_item where fact_order_id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: fact_order_item for ZZ150 still exists (cascade did not fire)\n';
  else v_log := v_log || E'OK   delete: fact_order_item for ZZ150 cascaded away\n'; end if;

  -- C-1: dim_address cascades away the same as fact_order_item.
  if exists (select 1 from analytics.dim_address where fact_order_id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete (C-1): dim_address for ZZ150 still exists (cascade did not fire)\n';
  else v_log := v_log || E'OK   delete (C-1): dim_address for ZZ150 cascaded away\n'; end if;

  if exists (select 1 from analytics.stg_order_import where id = v_stg_old_id and import_status = 'tombstoned') then
    v_log := v_log || E'OK   delete: stg_order_import row for ZZ150 marked tombstoned\n';
  else
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: stg_order_import row for ZZ150 is not tombstoned\n';
  end if;

  -- QA item 4(b): the already-linked line-item row for ZZ150 must go to
  -- 'tombstoned', not 'orphan'.
  if exists (select 1 from analytics.stg_order_line_import where id = v_stg_line_zz150_id and import_status = 'tombstoned' and fact_order_item_id is null) then
    v_log := v_log || E'OK   delete (QA 4b): stg_order_line_import row for ZZ150 marked tombstoned, fact_order_item_id cleared\n';
  else
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete (QA 4b): stg_order_line_import row for ZZ150 is not tombstoned (cascade SET NULL + status flip did not both happen)\n';
  end if;

  -- QA item 4(a): orphan-backlog row count must NOT have grown from this delete.
  select count(*) into v_orphan_count_after
    from analytics.stg_order_line_import where shop_id = v_shop_id and import_status = 'orphan';
  if v_orphan_count_after <> v_orphan_count_before then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete (QA 4a): orphan row count changed %s -> %s -- deleting an order must not create new ''orphan'' rows\n', v_orphan_count_before, v_orphan_count_after);
  else
    v_log := v_log || format(E'OK   delete (QA 4a): orphan row count unchanged (%s)\n', v_orphan_count_after);
  end if;

  select id into v_deleted_id_zz150 from analytics.fact_order_deleted where fact_order_id = v_id_zz150 and restored_at is null;
  if v_deleted_id_zz150 is null then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL delete: no active fact_order_deleted row for ZZ150\n';
  else
    v_log := v_log || E'OK   delete: fact_order_deleted row created for ZZ150\n';
  end if;

  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if (v_revenue_before - v_revenue_after) is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: sum(revenue) dropped by %s, want 250.00\n', v_revenue_before - v_revenue_after);
  else
    v_log := v_log || E'OK   delete: sum(revenue) dropped by exactly the deleted amount\n';
  end if;

  select analytics.dashboard_summary(v_shop_id, '2000-01-01'::date, '2035-12-31'::date, null, true) into v_dash_after;
  if ((v_dash_before -> 'kpi' ->> 'revenue')::numeric - (v_dash_after -> 'kpi' ->> 'revenue')::numeric) is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL delete: dashboard_summary revenue dropped by %s, want 250.00\n',
      (v_dash_before -> 'kpi' ->> 'revenue')::numeric - (v_dash_after -> 'kpi' ->> 'revenue')::numeric);
  else
    v_log := v_log || E'OK   delete: dashboard_summary kpi.revenue dropped by exactly the deleted amount\n';
  end if;

  -- ==========================================================================
  -- STEP 7: re-import (re-transform) the tombstoned row -> must NOT resurrect.
  -- ==========================================================================
  update analytics.stg_order_import set import_status = 'pending' where id = v_stg_old_id;
  v_before_ts := clock_timestamp();
  perform analytics.transform_pending_orders(v_shop_id, v_batch_old);

  select * into v_row from analytics.stg_order_import where id = v_stg_old_id;
  if v_row.import_status is distinct from 'tombstoned' or v_row.fact_order_id is not null then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL re-transform: stg row ended status=%s fact_order_id=%s (want tombstoned / null)\n', v_row.import_status, v_row.fact_order_id);
  else
    v_log := v_log || E'OK   re-transform: re-imported row landed back on tombstoned, fact_order_id stayed null\n';
  end if;

  if exists (select 1 from analytics.fact_order where shop_id = v_shop_id and source_order_no = 'ZZ150') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL re-transform: a NEW fact_order for ZZ150 was created -- tombstone did not block resurrection\n';
  else
    v_log := v_log || E'OK   re-transform: no fact_order was resurrected for ZZ150\n';
  end if;

  select count(*) into v_new_cust_count from analytics.dim_customer where shop_id = v_shop_id and created_at > v_before_ts;
  if v_new_cust_count > 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL re-transform: %s new dim_customer row(s) created from the tombstoned row''s phone_raw -- the guard did not short-circuit before customer resolution\n', v_new_cust_count);
  else
    v_log := v_log || E'OK   re-transform: no dim_customer created (tombstone check ran before customer resolution)\n';
  end if;

  -- ==========================================================================
  -- STEP 7b: QA item 4(c) — a line-item FILE re-imported for ZZ150 while
  -- still tombstoned must land the new staging row on 'tombstoned', not
  -- 'orphan' (transform_pending_order_lines' own tombstone check).
  -- ==========================================================================
  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_line_item_report', v_tag || '-line-reimport.xlsx', v_tag || '-line-reimport', 'loaded', now())
  returning id into v_batch_line_reimport;

  insert into analytics.stg_order_line_import (batch_id, shop_id, source_order_no, line_no, sku_raw, product_name_raw, qty, raw, import_status)
  values (v_batch_line_reimport, v_shop_id, 'ZZ150', 2, v_tag || '-SKU2', 'verify fixture re-import item', 1, '{}'::jsonb, 'pending')
  returning id into v_stg_line_reimport_id;

  select transformed_count, orphan_count, skipped_blank_count, unknown_sku_count, errored_count
    into v_tpol_transformed, v_tpol_orphan, v_tpol_skipped, v_tpol_unknown, v_tpol_errored
    from analytics.transform_pending_order_lines(v_shop_id, v_batch_line_reimport);

  if v_tpol_orphan <> 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL QA 4c: transform_pending_order_lines reported orphan_count=%s, want 0 (the tombstone check must short-circuit before the orphan branch)\n', v_tpol_orphan);
  else
    v_log := v_log || E'OK   QA 4c: transform_pending_order_lines reported orphan_count=0\n';
  end if;

  if exists (
    select 1 from analytics.stg_order_line_import
    where id = v_stg_line_reimport_id and import_status = 'tombstoned' and fact_order_item_id is null
  ) then
    v_log := v_log || E'OK   QA 4c: re-imported line for ZZ150 landed on tombstoned, not orphan\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL QA 4c: re-imported line for ZZ150 did not land on tombstoned\n';
  end if;

  -- M-b(3) (security review 12 ก.ย. 69): v_orphan_line_backlog must NOT
  -- contain ANY ZZ150 row here — not the STEP 7b re-import row (already
  -- 'tombstoned', excluded by the view's own import_status='orphan' filter
  -- alone) but specifically the STEP 2 fixture that was ALREADY 'orphan'
  -- BEFORE the delete and whose status the delete never touched
  -- (v_stg_line_zz150_orphan_id) — this is the one row that actually proves
  -- the view's NOT EXISTS tombstone-exclusion clause does something, as
  -- opposed to the import_status filter alone happening to hide everything.
  if exists (select 1 from analytics.v_orphan_line_backlog where shop_id = v_shop_id and source_order_no = 'ZZ150') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL M-b(3): v_orphan_line_backlog still has a ZZ150 row after delete -- the tombstone-exclusion NOT EXISTS clause did not fire\n';
  else
    v_log := v_log || E'OK   M-b(3): v_orphan_line_backlog has no ZZ150 rows after delete (pre-existing orphan fixture correctly excluded)\n';
  end if;

  -- ==========================================================================
  -- STEP 7c: QA — duplicate id within a single import_restore_orders call
  -- must raise the whole call, leaving ZZ150 still deleted (the FOR UPDATE +
  -- restored_at is null guard on the second occurrence of the same id is
  -- what should trip this — proving that guard, not just uniqueness of
  -- p_deleted_ids, is what the function relies on).
  -- ==========================================================================
  begin
    perform analytics.import_restore_orders(v_shop_id, array[v_deleted_id_zz150, v_deleted_id_zz150]);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL duplicate-ids: restore call with the same deleted-id twice did not raise\n';
  exception when others then
    v_log := v_log || E'OK   duplicate-ids: restore call with the same deleted-id twice raised as expected\n';
  end;
  if exists (select 1 from analytics.fact_order where id = v_id_zz150) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL duplicate-ids: ZZ150 got restored despite the whole call being expected to abort (savepoint rollback on raise did not undo the first iteration)\n';
  else
    v_log := v_log || E'OK   duplicate-ids: ZZ150 still not restored (raise rolled back the first iteration''s work too)\n';
  end if;

  -- ==========================================================================
  -- STEP 8: restore -- id/items/links/revenue all come back.
  -- ==========================================================================
  select analytics.import_restore_orders(v_shop_id, array[v_deleted_id_zz150])
    into v_restore_result;

  if (v_restore_result ->> 'restored_count')::int <> 1 or (v_restore_result ->> 'restored_revenue_thb')::numeric is distinct from 250.00 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL restore: restored_count=%s restored_revenue_thb=%s (want 1 / 250.00)\n', v_restore_result ->> 'restored_count', v_restore_result ->> 'restored_revenue_thb');
  else
    v_log := v_log || E'OK   restore: restored_count=1, restored_revenue_thb=250.00\n';
  end if;

  if not exists (select 1 from analytics.fact_order where id = v_id_zz150 and shop_id = v_shop_id and revenue = 250.00) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL restore: fact_order row for ZZ150 not back with original id/revenue\n';
  else
    v_log := v_log || E'OK   restore: fact_order row for ZZ150 back with original id + revenue\n';
  end if;

  if not exists (select 1 from analytics.fact_order_item where fact_order_id = v_id_zz150) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: fact_order_item did not come back\n';
  else v_log := v_log || E'OK   restore: fact_order_item came back\n'; end if;

  if not exists (select 1 from analytics.stg_order_import where id = v_stg_old_id and fact_order_id = v_id_zz150 and import_status = 'transformed') then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: stg_order_import link/status not restored\n';
  else v_log := v_log || E'OK   restore: stg_order_import link + status restored\n'; end if;

  if not exists (
    select 1 from analytics.stg_order_line_import
    where shop_id = v_shop_id and source_order_no = 'ZZ150' and import_status = 'transformed' and fact_order_item_id is not null
  ) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore: stg_order_line_import link/status not restored\n';
  else v_log := v_log || E'OK   restore: stg_order_line_import link + status restored\n'; end if;

  select coalesce(sum(revenue), 0) into v_revenue_after from analytics.fact_order where shop_id = v_shop_id;
  if v_revenue_after is distinct from v_revenue_before then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL restore: sum(revenue)=%s, want back to pre-delete %s\n', v_revenue_after, v_revenue_before);
  else
    v_log := v_log || E'OK   restore: sum(revenue) back to exactly the pre-delete amount\n';
  end if;

  -- C-1: dim_address restored with the same content.
  if not exists (select 1 from analytics.dim_address where id = v_addr_id and fact_order_id = v_id_zz150 and raw_address = v_tag || ' 123 verify fixture address') then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore (C-1): dim_address for ZZ150 did not come back\n';
  else v_log := v_log || E'OK   restore (C-1): dim_address for ZZ150 came back with original id + content\n'; end if;

  -- M-3(ง): crm_order_override restored too (existing fixture, was never
  -- explicitly asserted before this pass — only blindly cleaned up).
  if not exists (select 1 from analytics.crm_order_override where fact_order_id = v_id_zz150 and reason = v_tag || ' override') then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore (M-3): crm_order_override for ZZ150 did not come back\n';
  else v_log := v_log || E'OK   restore (M-3): crm_order_override for ZZ150 came back\n'; end if;

  -- QA item 2 + M-a fix (import_restore_orders): the stray line row
  -- re-imported WHILE ZZ150 was tombstoned (STEP 7b, fact_order_item_id
  -- still null) has no entry in stg_line_links and so is untouched by the
  -- loop above — it must instead have been reset to 'orphan' (NOT
  -- 'pending' — M-a, 12 ก.ย. 69: nothing re-transforms an arbitrary old
  -- batch on a schedule, so 'pending' would sit invisible forever; 'orphan'
  -- both self-heals on the next re-transform of its OWN batch and surfaces
  -- in the backlog UI right now) with error_detail explaining why.
  if not exists (
    select 1 from analytics.stg_order_line_import
    where id = v_stg_line_reimport_id and import_status = 'orphan' and fact_order_item_id is null
      and error_detail = 'order restored — line needs re-transform'
  ) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore (QA item 2/M-a): stray re-imported line for ZZ150 was not reset to orphan with the expected error_detail\n';
  else v_log := v_log || E'OK   restore (QA item 2/M-a): stray re-imported line for ZZ150 reset to orphan\n'; end if;

  -- M-a follow-up: now that ZZ150's tombstone is closed (restored_at set
  -- above), v_orphan_line_backlog's NOT EXISTS exclusion no longer applies
  -- to this source_order_no — the row must actually be visible in the
  -- backlog the owner sees, not just correctly stamped internally.
  if not exists (select 1 from analytics.v_orphan_line_backlog where id = v_stg_line_reimport_id) then
    v_fail_count := v_fail_count + 1; v_log := v_log || E'FAIL restore (M-a): stray re-imported line for ZZ150 did not appear in v_orphan_line_backlog after restore\n';
  else v_log := v_log || E'OK   restore (M-a): stray re-imported line for ZZ150 now visible in v_orphan_line_backlog\n'; end if;

  -- ==========================================================================
  -- STEP 8b: restore-vs-live-conflict — a deleted-order record whose
  -- source_order_no now has a LIVE fact_order (Shipnity number reuse) must
  -- raise and touch NEITHER row. Inserted directly into fact_order_deleted
  -- (not via a full delete cycle) because the live-conflict check fires
  -- BEFORE order_row is ever populated via jsonb_populate_record — order_row
  -- only needs to satisfy the column's own NOT NULL, it is never actually
  -- parsed as a fact_order shape on this path, so a minimal '{}'::jsonb is
  -- sufficient and accurately exercises exactly the code path being tested.
  -- ==========================================================================
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (v_shop_id, 'ZZ400', v_chan_a_id, '2026-01-12', 999.00)
  returning id into v_id_zz400_live;

  insert into analytics.fact_order_deleted (
    shop_id, fact_order_id, source_order_no, channel_id, order_date, revenue, customer_id,
    order_row, item_rows, address_rows, override_row, stg_order_import_ids, stg_line_links,
    evidence, reason
  ) values (
    v_shop_id, gen_random_uuid(), 'ZZ400', v_chan_a_id, '2026-01-12', 100.00, null,
    '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, null, '{}', '[]'::jsonb,
    '{}'::jsonb, v_tag || ' restore-conflict fixture'
  ) returning id into v_deleted_id_zz400;

  begin
    perform analytics.import_restore_orders(v_shop_id, array[v_deleted_id_zz400]);
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL restore-conflict: restoring over a live same-source_order_no order did not raise\n';
  exception when others then
    v_log := v_log || E'OK   restore-conflict: restoring over a live same-source_order_no order raised as expected\n';
  end;
  if not exists (select 1 from analytics.fact_order where id = v_id_zz400_live and revenue = 999.00) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL restore-conflict: the LIVE ZZ400 order was touched despite the call being expected to abort\n';
  else
    v_log := v_log || E'OK   restore-conflict: the LIVE ZZ400 order (revenue=999.00) is untouched\n';
  end if;
  if not exists (select 1 from analytics.fact_order_deleted where id = v_deleted_id_zz400 and restored_at is null) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL restore-conflict: the fake deleted-ZZ400 record got marked restored despite the call being expected to abort\n';
  else
    v_log := v_log || E'OK   restore-conflict: the fake deleted-ZZ400 record is still unrestored\n';
  end if;

  -- ==========================================================================
  -- STEP 8c: merged-customer walk — restoring an order whose snapshot
  -- customer_id has since been merged into another customer must land on
  -- the CURRENT (merged-into) customer, not resurrect a reference to the
  -- now-soft-retired one. Goes through the REAL import_delete_orders (not a
  -- hand-crafted fact_order_deleted row) specifically so order_row is a
  -- genuine to_jsonb(fact_order) snapshot — this path DOES reach jsonb_
  -- populate_record + a real INSERT, so it needs every NOT NULL column to
  -- be real, not the '{}'::jsonb shortcut STEP 8b used.
  --
  -- Isolated batch (v_batch_merge, its own ZZ700/ZZ800 F range) so this
  -- fixture's own candidate does not add a 3rd row to batch_main's already-
  -- asserted candidate_count=2 (ZZ150 + ZZ190) above.
  -- ==========================================================================
  insert into analytics.dim_customer (shop_id, display_name) values (v_shop_id, v_tag || ' merge-source') returning id into v_cust_a_id;
  insert into analytics.dim_customer (shop_id, display_name) values (v_shop_id, v_tag || ' merge-target') returning id into v_cust_b_id;

  insert into analytics.stg_import_batch (shop_id, source_type, file_name, file_hash, status, imported_at)
  values (v_shop_id, 'excel_order_report', v_tag || '-merge.xlsx', v_tag || '-merge', 'transformed', now())
  returning id into v_batch_merge;

  insert into analytics.stg_order_import (batch_id, shop_id, raw, source_kind, source_order_no, channel_raw, order_created_at, revenue, discount_total, import_status)
  values
    (v_batch_merge, v_shop_id, '{}'::jsonb, 'excel', 'ZZ700', v_chan_a_alias, '2026-04-01 09:00:00+07', 100, 0, 'transformed'),
    (v_batch_merge, v_shop_id, '{}'::jsonb, 'excel', 'ZZ800', v_chan_a_alias, '2026-04-10 09:00:00+07', 100, 0, 'transformed');
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values
    (v_shop_id, 'ZZ700', v_chan_a_id, '2026-04-01', 100),
    (v_shop_id, 'ZZ800', v_chan_a_id, '2026-04-10', 100);

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue, customer_id)
  values (v_shop_id, 'ZZ750', v_chan_a_id, '2026-04-05', 321.00, v_cust_a_id)
  returning id into v_id_zz750;

  select analytics.import_delete_orders(v_shop_id, v_batch_merge, array[v_id_zz750], v_tag || ' merge test delete') into v_delete_result;
  select id into v_deleted_id_zz750 from analytics.fact_order_deleted where fact_order_id = v_id_zz750 and restored_at is null;

  -- merge AFTER delete, matching the real-world ordering the design brief
  -- flags as risk (§10 "แก้วันที่ออเดอร์ใน Shipnity" sibling risk: customer
  -- data can change while an order sits tombstoned).
  update analytics.dim_customer set merged_into_id = v_cust_b_id where id = v_cust_a_id;

  perform analytics.import_restore_orders(v_shop_id, array[v_deleted_id_zz750]);

  select customer_id into v_restored_zz750_customer_id from analytics.fact_order where id = v_id_zz750;
  if v_restored_zz750_customer_id is distinct from v_cust_b_id then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL merged-customer: restored ZZ750.customer_id=%s, want the merge target %s\n', v_restored_zz750_customer_id, v_cust_b_id);
  else
    v_log := v_log || E'OK   merged-customer: restored ZZ750 landed on the CURRENT (merged-into) customer\n';
  end if;

  -- ==========================================================================
  -- STEP 9: cleanup every fixture this script created, then re-snapshot.
  -- ==========================================================================
  delete from analytics.crm_order_override where fact_order_id = v_id_zz150;
  delete from analytics.fact_order_item where shop_id = v_shop_id and sku_snapshot = v_tag || '-SKU';
  delete from analytics.fact_order where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.fact_order where shop_id = v_other_shop_id;
  delete from analytics.stg_order_line_import where shop_id = v_shop_id and source_order_no = 'ZZ150';
  delete from analytics.stg_order_import where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.fact_order_deleted where shop_id = v_shop_id and source_order_no like 'ZZ%';
  delete from analytics.stg_import_batch where id in (v_batch_old, v_batch_main, v_batch_error, v_batch_wrongsrc, v_batch_newer, v_batch_notdone, v_batch_cap, v_batch_merge, v_batch_line_reimport, v_batch_skipped, v_batch_badchannel);
  -- STEP 8b/8c fixtures: dim_customer rows are not touched by the ZZ%
  -- wildcard deletes above (source_order_no lives on fact_order, not
  -- dim_customer) and are not part of the T0/T8 golden snapshot either —
  -- must be cleaned up explicitly or they leak into the real shop's
  -- customer list permanently.
  delete from analytics.dim_customer where id in (v_cust_a_id, v_cust_b_id);
  delete from public.shop where id = v_other_shop_id;

  select count(*), coalesce(sum(revenue), 0), coalesce(sum(discount), 0), coalesce(sum(cogs), 0), coalesce(sum(profit), 0)
    into v_t8_count, v_t8_revenue, v_t8_discount, v_t8_cogs, v_t8_profit
    from analytics.fact_order where shop_id = v_shop_id;
  select count(*) into v_t8_items from analytics.fact_order_item where shop_id = v_shop_id;

  v_log := v_log || format(E'T8 post-cleanup: count=%s revenue=%s items=%s\n', v_t8_count, v_t8_revenue, v_t8_items);

  if v_t8_count <> v_t0_count or v_t8_revenue is distinct from v_t0_revenue
     or v_t8_discount is distinct from v_t0_discount or v_t8_cogs is distinct from v_t0_cogs
     or v_t8_profit is distinct from v_t0_profit or v_t8_items <> v_t0_items then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T8: post-cleanup snapshot does NOT match T0 (count %s->%s revenue %s->%s items %s->%s) -- a fixture leaked or an unrelated real order was touched. STOP -- do not ship.\n',
      v_t0_count, v_t8_count, v_t0_revenue, v_t8_revenue, v_t0_items, v_t8_items);
  else
    v_log := v_log || E'OK   T8: post-cleanup snapshot matches T0 exactly (count/revenue/discount/cogs/profit/items) -- no fixture leaked\n';
  end if;

  if exists (select 1 from analytics.fact_order where shop_id = v_shop_id and source_order_no like 'ZZ%') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: a ZZ-prefixed fixture order leaked\n';
  end if;
  if exists (select 1 from analytics.fact_order_item where shop_id = v_shop_id and sku_snapshot = v_tag || '-SKU') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: a fixture fact_order_item leaked\n';
  end if;
  if exists (select 1 from public.shop where id = v_other_shop_id) then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || E'FAIL T8: temp shop was not cleaned up\n';
  end if;

  -- ==========================================================================
  -- forced rollback.
  -- ==========================================================================
  if v_fail_count > 0 then
    v_log := v_log || format(E'\n=== %s CHECK(S) FAILED -- 0113/0114/0115 are NOT safe to ship as-is ===\n', v_fail_count);
  else
    v_log := v_log || E'\n=== ALL CHECKS PASSED -- safe to apply 0113/0114/0115 for real (apply_migration) ===\n';
  end if;

  raise exception '%', v_log;
end;
$verify$;

rollback;
