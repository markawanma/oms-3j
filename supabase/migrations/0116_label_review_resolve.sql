-- 0116_label_review_resolve.sql
-- Phase A of "คิวใบปะหน้ากดได้ + แก้/ย้อนจังหวัด + เก็บการสอน"
-- (design: scratchpad design-label-teach-loop-yoda-11sep.md §5 A, owner
-- decisions 11 ก.ย. 69 — verbatim quoted inline below at each decision point).
--
-- ⚠️ DO NOT APPLY — file only, per task instructions. Tech Lead applies via
-- MCP (supabase-migrate skill: pre-check -> apply_migration -> verify ->
-- get_advisors). scripts/verify-0116-label-resolve.sql calls the new RPCs
-- this file creates, so it can only run AFTER this file is applied — it
-- rehearses every guard below against throwaway fixture data inside a
-- do-block + forced rollback (trap #11), so it never touches real rows
-- regardless of pass/fail. This file's own §7 data migration is a separate,
-- deliberate exception to "test before touching real data" (see its header)
-- since it is itself the real, permanent correction — not a test of one.
--
-- 🔴 APPLY ORDER (H2, 12 ก.ย. 69 security review): this file (0116) MUST be
-- applied BEFORE migrations 0112-0115 (cancel-detection branch), which
-- rewrite analytics.transform_pending_orders entirely and are being given a
-- line that reads province_source (`province_source = case when
-- excluded.province_code = 'TH-XX' then analytics.fact_order.province_source
-- else 'import' end`) — that line only makes sense if the province_source
-- column already exists (§2 below creates it). This file does NOT patch
-- transform_pending_orders itself — the "import re-import respects manual
-- edits" fix (H2) is being done there instead, in 0114, not duplicated here.
--
-- ============================================================================
-- What this file does
-- ============================================================================
-- 1) stg_label_page: 2 new match_status values (manual_applied, ignored) +
--    4 new columns (applied_source, applied_reason, applied_note, applied_by)
--    so a human can act on a review-queue row, not just look at it.
-- 2) fact_order.province_source (import|label|manual) — which layer last
--    wrote this order's province, for the "ทุกแถวต้องบอกที่มา" requirement
--    downstream (getPendingLabelReviews / findOrdersByTracking, app layer)
--    and so a future teach-loop backfill can tell "never verified by a human"
--    apart from "a human already looked at this."
-- 3) crm_audit_log.action gains province_set / province_revert.
-- 4) analytics.label_text_rule (new table) — "เก็บการสอน" collection-only
--    (active always false this phase, nothing reads it yet).
-- 5) RPCs: label_write_province / label_revert_province_audit (internal,
--    service_role only) · label_set_order_province / label_revert_order_province
--    (direct edit, e.g. search-by-tracking panel) · label_resolve_page /
--    label_ignore_page / label_revert_page (review-queue actions).
-- 6) crm_set_order_override: province_code REMOVED from the write whitelist
--    (owner 11 ก.ย.: "ถอดเลย") — plain `create or replace`, same (uuid,
--    jsonb, text) signature, so no drop-then-create needed (trap #1); grants
--    re-asserted anyway (trap #2, grants never survive replace on Supabase).
-- 7) One-time data migration: any analytics.crm_order_override row still
--    carrying a province_code key is resolved BEFORE the whitelist closes
--    the door on it (see §7 below for the exact rule + why it is NOT wrapped
--    in the verify script's forced-rollback do-block).
-- 8) (added 12 ก.ย. 69, H1) analytics.label_apply_matched (0097, the
--    auto/bulk apply path) now also stamps province_source='label'.
--
-- Touches: analytics.stg_label_page (alter) · analytics.fact_order (alter +
-- data write via new RPCs, §7's one-time migration, and §9's
-- label_apply_matched) · analytics.crm_audit_log (alter check constraint) ·
-- analytics.label_text_rule (new) · analytics.crm_order_override (data
-- migration only, §7) · analytics.crm_set_order_override (replace) ·
-- analytics.label_apply_matched (replace, §9).
--
-- 3j-migration-traps checklist:
--  - crm_set_order_override / label_apply_matched signatures unchanged ->
--    plain `create or replace` is correct for both (trap #1). All 9 new/
--    replaced functions in this file get explicit revoke+grant regardless
--    (trap #2).
--  - No view touched (trap #3 n/a).
--  - Every text param that becomes a jsonb value or gets compared is a plain
--    string, not client-supplied numeric -> no new NaN surface (trap #4).
--  - No new ratio/division introduced (trap #5).
--  - No "today"/current_date logic introduced (trap #6).
--  - Grants below are scoped to the exact objects this file touches, never
--    schema-wide (trap #7).
--  - `found` is checked immediately after the single UPDATE it reflects in
--    every guard below, never after a loop (trap #8).
--  - No array-concat-with-possibly-null-lookup pattern (trap #9).
--  - search_path pinned on every function (existing + new).
--  - Idempotent: `add column if not exists`, `create table if not exists`,
--    `create or replace function`, `drop policy if exists` + create,
--    dynamic constraint-name lookup before drop+recreate (see §1/§3) — all
--    safe to re-run. §7's data migration is naturally idempotent too: once a
--    crm_order_override row's `province_code` key is stripped, the loop's
--    `WHERE overrides ? 'province_code'` no longer selects it on a re-run.
--  - Touches money-ADJACENT (not money itself — province, not revenue) state
--    on fact_order -> scripts/verify-0116-label-resolve.sql follows trap
--    #11's do-block + forced-rollback pattern for every guard EXCEPT §7's
--    one-time real migration, which is a deliberate permanent correction
--    (see §7 header for why it can't be rehearsed-then-rolled-back like the
--    rest of this file).

-- ============================================================================
-- 1. stg_label_page — 2 new match_status values + 4 new audit columns
-- ============================================================================

do $$
declare
  v_conname text;
  v_match_count int;
begin
  -- dynamic lookup instead of assuming Postgres's default auto-generated
  -- constraint name (`<table>_<col>_check`) — this table has TWO check
  -- constraints (page_no > 0, match_status in (...)), so the ILIKE narrows
  -- to the one that actually mentions match_status; safe to re-run (2nd run
  -- finds+drops+recreates the identical new definition, a no-op net effect).
  select count(*) into v_match_count
    from pg_constraint
   where conrelid = 'analytics.stg_label_page'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%match_status%';
  if v_match_count > 1 then
    -- L2: don't silently pick one out of several matches — abort loudly.
    raise exception 'stg_label_page: % check constraints matched %%match_status%% — refusing to guess, fix manually', v_match_count;
  end if;

  select conname into v_conname
    from pg_constraint
   where conrelid = 'analytics.stg_label_page'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%match_status%'
   order by conname
   limit 1;
  if v_conname is not null then
    execute format('alter table analytics.stg_label_page drop constraint %I', v_conname);
  end if;
end $$;

alter table analytics.stg_label_page
  add constraint stg_label_page_match_status_check
  check (
    match_status in (
      'matched', 'needs_review', 'conflict', 'order_not_found',
      'undetected', 'parse_failed',
      -- new this migration — a human acted on this page:
      'manual_applied', -- province was written to >=1 fact_order via label_resolve_page
      'ignored'         -- owner confirmed "not a label" / not worth resolving
    )
  );

-- Owner 11 ก.ย. 69, decision #1 ("เหตุผลจะเป็นยังไงไม่ทราบ ... ⇒ applied_reason
-- เป็น code จากชุดคงที่"): fixed reason-code set, enforced as a real CHECK
-- constraint here (not just a TS union) — 3 independent enforcement points
-- total (this constraint, the RPC-level IF check below, and the TS
-- LABEL_REASON_OPTIONS the UI renders from) all must list the same 5 codes;
-- flagged as a duplication-risk single-source-of-truth gap in the handoff.
alter table analytics.stg_label_page
  add column if not exists applied_source text
    check (applied_source is null or applied_source in ('auto', 'manual')),
  add column if not exists applied_reason text
    check (
      applied_reason is null or applied_reason in (
        'no_data_yet', 'unreadable', 'wrong_label', 'customer_moved', 'other'
      )
    ),
  add column if not exists applied_note text,
  add column if not exists applied_by uuid references auth.users (id) on delete set null;

comment on column analytics.stg_label_page.applied_source is
  'auto = written by label_apply_matched (0097, unsupervised). manual = a '
  'human resolved this page via label_resolve_page/label_ignore_page.';
comment on column analytics.stg_label_page.applied_reason is
  'Fixed code set (see CHECK) — only meaningful when applied_source=manual. '
  'null for auto and for manual resolves that did not need a reason (current '
  'province was TH-XX, nothing real was overwritten).';
comment on column analytics.stg_label_page.applied_by is
  'auth.uid() of the human who resolved/ignored this page. NULL under the '
  'service-role dev shortcut this app currently runs on (no real auth yet — '
  'Auth A2) — same limitation as every other applied_by/actor/uploaded_by '
  'column in this schema, not new to this migration.';

-- ============================================================================
-- 2. fact_order.province_source — which layer last wrote province_code
-- ============================================================================

alter table analytics.fact_order
  add column if not exists province_source text not null default 'import'
    check (province_source in ('import', 'label', 'manual'));

comment on column analytics.fact_order.province_source is
  'import = last written by transform_pending_orders (Excel/Shipnity re-import '
  'can still overwrite it with a non-TH-XX value — out of scope for this '
  'migration per design §4, "patch transform ให้เคารพ province_source=''manual'''' '
  'is explicitly deferred). label = analytics.label_apply_matched (auto, '
  'guarded to only ever write over TH-XX). manual = a human wrote it via '
  'label_set_order_province / label_resolve_page (this migration).';

-- One-time backfill: rows that already got their province from a label
-- upload BEFORE this column existed are still tagged 'import' by the
-- default above, which is misleading (they show as "never enriched by
-- label" when they were). stg_label_page.fact_order_ids + applied_at already
-- record exactly which fact_order rows label_apply_matched wrote to — this
-- is a real, permanent, deterministic correction from that existing audit
-- trail (not a guess), so it runs here rather than being left "good enough
-- going forward." Guarded to province_source='import' (the only value that
-- can exist pre-migration) and province_code<>'TH-XX' (a page that matched
-- but got skipped_has_province never actually wrote anything, so its
-- fact_order_ids — if populated at all in that edge case — must not be
-- reclassified).
--
-- Expected effect on the live DB (Tech Lead, 12 ก.ย. 69, verified against
-- the count of applied stg_label_page rows): 286 fact_order rows relabeled
-- 'import' -> 'label'. If a real apply produces a materially different
-- number, stop and ask before proceeding — that means the assumption this
-- backfill's guard is built on (every applied fact_order_ids entry is
-- currently still 'import') doesn't hold.
update analytics.fact_order fo
   set province_source = 'label'
  from (
    select distinct unnest(slp.fact_order_ids) as fact_order_id
      from analytics.stg_label_page slp
     where slp.applied_at is not null
       and slp.fact_order_ids is not null
  ) applied
 where fo.id = applied.fact_order_id
   and fo.province_source = 'import'
   and fo.province_code <> 'TH-XX';

-- ============================================================================
-- 3. crm_audit_log.action — add province_set / province_revert
-- ============================================================================
-- 🔴 security fix (C1, 12 ก.ย. 69): the first cut of this constraint copied
-- 0021's check list verbatim and MISSED 'customer_merge'/'merge_dismiss' —
-- added later by 0023, a DIFFERENT migration that touched the SAME object.
-- crm_audit_log already had 72 real 'customer_merge' rows on the live DB —
-- the old version of this ALTER would have FAILED validation on apply (or,
-- if it had somehow succeeded, silently broken the merge-customers feature
-- for every call after). Confirmed against the live table's current
-- constraint (Tech Lead, 12 ก.ย.) — full 9-value list carried forward below.
--
-- LESSON (write it down so it doesn't repeat): when re-issuing a CHECK/
-- constraint on an existing object, copy the list from the LATEST migration
-- that touched that object, never from the migration that originally
-- created it — `grep -rl` the object name across supabase/migrations/ and
-- read the newest match, or better, pull the live definition via
-- pg_get_constraintdef()/pg_get_functiondef() before writing the replacement
-- (see H1's label_apply_matched below for that exact technique).

do $$
declare
  v_conname text;
  v_match_count int;
begin
  select count(*) into v_match_count
    from pg_constraint
   where conrelid = 'analytics.crm_audit_log'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%action%';
  if v_match_count > 1 then
    -- L2: ambiguous match = don't guess which one to drop — abort loudly.
    raise exception 'crm_audit_log: % check constraints matched %%action%% — refusing to guess, fix manually', v_match_count;
  end if;

  select conname into v_conname
    from pg_constraint
   where conrelid = 'analytics.crm_audit_log'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%action%'
   order by conname
   limit 1;
  if v_conname is not null then
    execute format('alter table analytics.crm_audit_log drop constraint %I', v_conname);
  end if;
end $$;

alter table analytics.crm_audit_log
  add constraint crm_audit_log_action_check
  check (
    action in (
      -- 0021 (original 7):
      'order_override_set', 'order_override_clear', 'customer_edit',
      'pii_edit', 'note_add', 'note_edit', 'note_delete',
      -- 0023 (customer merge, +2 — the values this file's first cut missed):
      'customer_merge', 'merge_dismiss',
      -- this migration (+2):
      'province_set', 'province_revert'
    )
  );

-- ============================================================================
-- 4. analytics.label_text_rule — "เก็บการสอน" (channel 3, design §3)
--    Collection-only this phase: active is ALWAYS false here, nothing in
--    lib/labels/match.ts reads this table yet (owner 11 ก.ย.: "active=false
--    เสมอในเฟสนี้ ... เฟส C ค่อยเปิดหลัง dry-run"). No write policy — the
--    only write path is label_resolve_page's optional p_taught_snippet.
-- ============================================================================

create table if not exists analytics.label_text_rule (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  -- 'alias' is the only kind this phase ever inserts (owner 11 ก.ย.: "insert
  -- analytics.label_text_rule (kind='alias', ...)"). 'strip_codepoint' is
  -- listed per design §3 layer 3's documented shape for forward-compat with
  -- Phase C — no code path writes it yet.
  kind text not null check (kind in ('strip_codepoint', 'alias')),
  -- PDPA guard (owner 11 ก.ย.): a taught snippet must be short and
  -- non-numeric-ish enough that it can never itself carry a tracking
  -- number/phone/zip run. M3 fix (12 ก.ย. 69, security): originally only
  -- blocked runs of >=3 consecutive digits — a 1-2 digit number (a soi/lane
  -- number, e.g. "ซอย 12") still slipped through, and no legitimate place
  -- name ever needs ANY digit (Thai numerals ๐-๙ included — a snippet using
  -- Thai digits would sail straight past a plain `\d` check, which only
  -- matches ASCII 0-9). Tightened to a POSITIVE allow-list instead of a
  -- digit-run block: length <=25 AND every character is a Unicode letter or
  -- whitespace, full stop — this is now a strict superset of the old rule
  -- (blocks every digit of every script, plus punctuation) with no loss of
  -- any legitimate place-name pattern. Enforced here as a real CHECK
  -- (backstop) in addition to the RPC-level pre-validation in
  -- label_resolve_page (friendlier error message there — same rule, kept in
  -- sync manually, same duplication-risk note as the reason-code CHECKs).
  pattern text not null check (
    length(pattern) > 0 and length(pattern) <= 25 and pattern ~ '^[[:alpha:][:space:]]+$'
  ),
  province_code text not null references analytics.dim_geo (province_code),
  active boolean not null default false,
  evidence_count int not null default 1 check (evidence_count > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_label_text_rule_shop_kind_pattern_province
    unique (shop_id, kind, pattern, province_code)
);

create index if not exists idx_label_text_rule_shop_id on analytics.label_text_rule (shop_id);

alter table analytics.label_text_rule enable row level security;

drop policy if exists owner_admin_select on analytics.label_text_rule;
create policy owner_admin_select on analytics.label_text_rule
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
-- Deliberately no insert/update/delete policy — the only write path is
-- label_resolve_page (SECURITY DEFINER), same "no RLS write policy at all,
-- RPC is the only legal writer" pattern as crm_order_override/crm_customer_note
-- (0021). This table did not exist before this migration, so unlike every
-- other table in this schema it needs an explicit grant — `grant select on
-- all tables in schema analytics` from past migrations only covers tables
-- that existed AT THE TIME that grant ran (trap #7's flip side: new objects
-- are never covered retroactively).
grant select on analytics.label_text_rule to authenticated, service_role;

-- ============================================================================
-- 5. Internal helpers (service_role only — never exposed to authenticated
--    directly; only called from the public-facing RPCs in §6 below). Same
--    "helper granted to service_role only" pattern as
--    analytics.import_text_or_null (0111).
-- ============================================================================

-- label_write_province — the ONE place that actually writes
-- fact_order.province_code from a human-authorized action + logs the audit
-- row. Shared by label_set_order_province (direct edit) and
-- label_resolve_page's per-order loop (review-queue resolve) so both paths
-- enforce the exact same guard the exact same way (same reasoning as
-- crm_require_owner_admin being factored out in 0021).
--
-- Guards (§ "เคสห้ามผ่าน" this migration must satisfy):
--   - order not found for THIS shop -> raise (kills cross-shop writes)
--   - p_province_code not a real analytics.dim_geo row -> raise (friendly
--     message; the FK on fact_order.province_code is the hard backstop)
--   - current province_code <> 'TH-XX' (i.e. overwriting real data, whether
--     that data came from import/label/a previous manual edit) AND
--     p_reason is null -> raise ("reason required")
--   - p_reason not null but outside the fixed code set -> raise
--   - concurrent write raced us (province_code changed between the SELECT
--     FOR UPDATE and our UPDATE's WHERE) -> raise, never silently no-op
create or replace function analytics.label_write_province(
  p_shop_id uuid,
  p_fact_order_id uuid,
  p_province_code text,
  p_reason text,
  p_note text,
  p_page_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_before_code text;
  v_before_source text;
  v_updated_id uuid;
begin
  if p_shop_id is null or p_fact_order_id is null then
    raise exception 'label_write_province: p_shop_id and p_fact_order_id are required';
  end if;
  if p_province_code is null or btrim(p_province_code) = '' then
    raise exception 'label_write_province: p_province_code is required';
  end if;
  if not exists (select 1 from analytics.dim_geo g where g.province_code = p_province_code) then
    raise exception 'label_write_province: unknown province_code %', p_province_code;
  end if;
  if p_reason is not null and p_reason not in (
    'no_data_yet', 'unreadable', 'wrong_label', 'customer_moved', 'other'
  ) then
    raise exception 'label_write_province: invalid reason code %', p_reason;
  end if;
  -- M1 fix (12 ก.ย. 69): p_note lands in crm_audit_log.after, an
  -- append-only table (no update/delete path — see 0021 §2.3) — an
  -- unbounded note would be permanent, unremovable bloat on a table that
  -- already carries PII in other rows (pii_edit). Cap it here so a bad
  -- caller/copy-paste accident can't write an essay into forever-storage.
  if p_note is not null and length(p_note) > 500 then
    raise exception 'label_write_province: p_note too long (% chars, max 500)', length(p_note);
  end if;

  select fo.province_code, fo.province_source into v_before_code, v_before_source
    from analytics.fact_order fo
   where fo.id = p_fact_order_id and fo.shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'label_write_province: order % not found for this shop', p_fact_order_id;
  end if;

  if v_before_code <> 'TH-XX' and p_reason is null then
    raise exception
      'label_write_province: order % already has a province (%) — a reason code is required to overwrite it',
      p_fact_order_id, v_before_code;
  end if;

  update analytics.fact_order as fo
     set province_code = p_province_code,
         province_source = 'manual',
         updated_at = now()
   where fo.id = p_fact_order_id
     and fo.shop_id = p_shop_id
     and fo.province_code = v_before_code -- optimistic-concurrency guard
  returning fo.id into v_updated_id;

  if v_updated_id is null then
    raise exception 'label_write_province: order % province changed concurrently, retry', p_fact_order_id;
  end if;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_shop_id, auth.uid(), 'province_set', 'fact_order', p_fact_order_id,
    jsonb_build_object('province_code', v_before_code, 'province_source', v_before_source),
    jsonb_build_object(
      'province_code', p_province_code, 'province_source', 'manual',
      'reason', p_reason, 'note', p_note, 'page_id', p_page_id
    )
  );
end;
$$;

revoke execute on function analytics.label_write_province(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function analytics.label_write_province(uuid, uuid, text, text, text, uuid) to service_role;

-- label_revert_province_audit — undoes exactly ONE crm_audit_log
-- province_set row, IFF the order's current value still matches that row's
-- `after` (structural guard against reverting stale/superseded state —
-- "เคสห้ามผ่าน: revert เมื่อค่าปัจจุบัน ≠ after ของ audit").
create or replace function analytics.label_revert_province_audit(
  p_shop_id uuid,
  p_fact_order_id uuid,
  p_audit_log_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_audit record;
  v_current_code text;
  v_updated_id uuid;
begin
  select shop_id, entity_id, before, after into v_audit
    from analytics.crm_audit_log
   where id = p_audit_log_id
     and shop_id = p_shop_id
     and entity_type = 'fact_order'
     and entity_id = p_fact_order_id
     and action = 'province_set';
  if not found then
    raise exception 'label_revert_province_audit: audit row % not found for order % in this shop', p_audit_log_id, p_fact_order_id;
  end if;

  select fo.province_code into v_current_code
    from analytics.fact_order fo
   where fo.id = p_fact_order_id and fo.shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'label_revert_province_audit: order % not found for this shop', p_fact_order_id;
  end if;

  if v_current_code is distinct from (v_audit.after ->> 'province_code') then
    raise exception
      'label_revert_province_audit: order % province is % now, not % from this audit row — revert refused',
      p_fact_order_id, v_current_code, v_audit.after ->> 'province_code';
  end if;

  update analytics.fact_order as fo
     set province_code = v_audit.before ->> 'province_code',
         province_source = coalesce(v_audit.before ->> 'province_source', 'import'),
         updated_at = now()
   where fo.id = p_fact_order_id
     and fo.shop_id = p_shop_id
     and fo.province_code = v_current_code
  returning fo.id into v_updated_id;

  if v_updated_id is null then
    raise exception 'label_revert_province_audit: order % province changed concurrently, retry', p_fact_order_id;
  end if;

  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (
    p_shop_id, auth.uid(), 'province_revert', 'fact_order', p_fact_order_id,
    v_audit.after,
    jsonb_build_object(
      'province_code', v_audit.before ->> 'province_code',
      'province_source', coalesce(v_audit.before ->> 'province_source', 'import'),
      'reverted_audit_log_id', p_audit_log_id
    )
  );
end;
$$;

revoke execute on function analytics.label_revert_province_audit(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.label_revert_province_audit(uuid, uuid, uuid) to service_role;

-- ============================================================================
-- 6. Public RPCs — every one: crm_require_owner_admin first, revoke from
--    public/anon/authenticated then grant to service_role ONLY (H3, 12 ก.ย.
--    69 security review — one decision applied to every write RPC in this
--    file, including label_apply_matched in §9 and crm_set_order_override in
--    §8): this app has no real end-user auth yet and calls every RPC through
--    the service client (lib/supabase/server.ts) exclusively — an
--    `authenticated` grant on a WRITE RPC was dead privilege surface that
--    only mattered the day real auth ships, and until then it's one more
--    role that can be handed a leaked/misused anon-tier JWT and still call a
--    province-writing RPC directly via PostgREST. crm_require_owner_admin's
--    service_role short-circuit (0021) means the app's actual authorization
--    story doesn't change. READ-only grants (analytics.label_text_rule
--    SELECT in §4, and every plain `grant select on <table>` elsewhere in
--    this schema) are unaffected — this narrowing is write-RPCs only.
-- ============================================================================

-- --------------------------------------------------------------------------
-- label_set_order_province — direct edit (e.g. ProvinceFixPanel / search by
-- tracking number), not tied to any stg_label_page row (p_page_id = null).
-- --------------------------------------------------------------------------
create or replace function analytics.label_set_order_province(
  p_shop_id uuid,
  p_fact_order_id uuid,
  p_province_code text,
  p_reason text default null,
  p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.label_write_province(p_shop_id, p_fact_order_id, p_province_code, p_reason, p_note, null);
end;
$$;

revoke execute on function analytics.label_set_order_province(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function analytics.label_set_order_province(uuid, uuid, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- label_revert_order_province — undoes the MOST RECENT province_set audit
-- row for this order, regardless of whether it came from a direct edit or a
-- page resolve (from the order's point of view there is only one current
-- value; "undo the last change" is coherent either way). Contrast with
-- label_revert_page below, which is scoped to ONLY the audit rows a
-- specific page created (so reverting a page never accidentally undoes an
-- unrelated later direct edit on the same order).
-- --------------------------------------------------------------------------
create or replace function analytics.label_revert_order_province(
  p_shop_id uuid,
  p_fact_order_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_audit_id uuid;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  select id into v_audit_id
    from analytics.crm_audit_log
   where shop_id = p_shop_id
     and entity_type = 'fact_order'
     and entity_id = p_fact_order_id
     and action = 'province_set'
   order by created_at desc
   limit 1;
  if v_audit_id is null then
    raise exception 'label_revert_order_province: no province_set history for order %', p_fact_order_id;
  end if;

  perform analytics.label_revert_province_audit(p_shop_id, p_fact_order_id, v_audit_id);
end;
$$;

revoke execute on function analytics.label_revert_order_province(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.label_revert_order_province(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- label_resolve_page — the review-queue "กดได้" action. Finds every
-- fact_order row sharing this page's tracking_no (set-based, same pattern
-- as label_apply_matched — a tracking number can cover >1 order, e.g.
-- combined shipments) and writes province to ALL of them via
-- label_write_province. Optionally records a taught snippet into
-- label_text_rule (owner 11 ก.ย., channel 2).
--
-- Guards:
--   - page not found for shop -> raise
--   - page.match_status not one of the "still open" statuses -> raise
--     ("เคสห้ามผ่าน: resolve page ที่ apply แล้ว")
--   - page.tracking_no is null -> raise (nothing to resolve province onto;
--     the queue's answer for a page with no tracking is label_ignore_page)
--   - tracking_no matches zero fact_order rows in this shop -> raise (the
--     order genuinely doesn't exist yet — honest failure beats a silent
--     no-op, same principle as oem-quote-invariants' "ยอมให้ทำงานไม่ได้
--     ดีกว่าเสนอราคาผิด")
--   - p_taught_snippet provided but fails the PDPA-shape check (>25 chars or
--     a run of 3+ digits) -> raise, whole call rolls back (province is NOT
--     applied either) — deliberately atomic: a malformed taught snippet is
--     the caller sending something they should not, treat the whole
--     request as suspect rather than silently drop just the teaching part.
-- --------------------------------------------------------------------------
create or replace function analytics.label_resolve_page(
  p_shop_id uuid,
  p_page_id uuid,
  p_province_code text,
  p_reason text default null,
  p_note text default null,
  p_taught_snippet text default null
)
 returns table(applied_orders int)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_page analytics.stg_label_page%rowtype;
  v_fact_order_ids uuid[];
  v_fact_order_id uuid;
  v_pattern text;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_page
    from analytics.stg_label_page
   where id = p_page_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'label_resolve_page: page % not found for this shop', p_page_id;
  end if;

  if v_page.match_status not in (
    'needs_review', 'conflict', 'order_not_found', 'undetected', 'parse_failed'
  ) then
    raise exception 'label_resolve_page: page % is already %, cannot resolve again', p_page_id, v_page.match_status;
  end if;

  if v_page.tracking_no is null then
    raise exception 'label_resolve_page: page % has no tracking number — use label_ignore_page instead', p_page_id;
  end if;

  -- PDPA shape check BEFORE any write, so a bad taught_snippet aborts the
  -- whole call (see header). Table CHECK on label_text_rule.pattern is the
  -- backstop; this is just the friendlier error message.
  if p_taught_snippet is not null then
    v_pattern := btrim(p_taught_snippet);
    if v_pattern = '' then
      v_pattern := null; -- caller sent whitespace-only — treat as "no snippet"
    -- M3: kept in sync with label_text_rule.pattern's CHECK above — letters
    -- + whitespace only (any script), length <=25. No digit of any kind.
    elsif length(v_pattern) > 25 or v_pattern !~ '^[[:alpha:][:space:]]+$' then
      raise exception
        'label_resolve_page: taught snippet invalid — must be <=25 chars, letters/spaces only, no digits of any kind (got % chars)',
        length(v_pattern);
    end if;
  end if;

  -- FOR UPDATE cannot be combined with an aggregate in one query (Postgres
  -- hard restriction) — lock the rows in an inner subquery first, then
  -- aggregate the (now-locked) ids in the outer query.
  select array_agg(locked.id) into v_fact_order_ids
    from (
      select fo.id
        from analytics.fact_order fo
       where fo.shop_id = p_shop_id
         and fo.tracking_no = v_page.tracking_no
       for update of fo
    ) locked;
  if v_fact_order_ids is null or array_length(v_fact_order_ids, 1) = 0 then
    raise exception
      'label_resolve_page: no orders found with tracking number % yet — import the order first',
      v_page.tracking_no;
  end if;

  foreach v_fact_order_id in array v_fact_order_ids loop
    perform analytics.label_write_province(p_shop_id, v_fact_order_id, p_province_code, p_reason, p_note, p_page_id);
  end loop;

  update analytics.stg_label_page
     set match_status = 'manual_applied',
         province_code = p_province_code,
         applied_source = 'manual',
         applied_reason = p_reason,
         applied_note = p_note,
         applied_by = auth.uid(),
         applied_at = now(),
         fact_order_ids = v_fact_order_ids,
         -- H4 fix (12 ก.ย. 69): stash BOTH the pre-resolve status AND the
         -- pre-resolve province_code so label_revert_page can restore the
         -- page to its exact prior state, not just its status. Without
         -- prev_province_code, revert used to null out province_code
         -- unconditionally — for a page that started 'conflict' (which DOES
         -- carry the parser's real candidate province_code, set at parse
         -- time), that destroyed the parser's answer permanently: a
         -- reverted conflict page could never auto-apply again on a later
         -- re-parse (label_apply_matched requires province_code is not
         -- null), it would just sit there with a real tracking match and no
         -- province forever until someone resolved it by hand again.
         match_detail = coalesce(match_detail, '{}'::jsonb)
           || jsonb_build_object('prev_status', v_page.match_status, 'prev_province_code', v_page.province_code)
   where id = p_page_id
     and shop_id = p_shop_id; -- L1: defense in depth (already scoped by the earlier SELECT ... FOR UPDATE)

  if v_pattern is not null then
    insert into analytics.label_text_rule (shop_id, kind, pattern, province_code, active, evidence_count, note)
    values (p_shop_id, 'alias', v_pattern, p_province_code, false, 1, null)
    on conflict (shop_id, kind, pattern, province_code)
    do update set evidence_count = analytics.label_text_rule.evidence_count + 1, updated_at = now();
  end if;

  applied_orders := array_length(v_fact_order_ids, 1);
  return next;
end;
$$;

revoke execute on function analytics.label_resolve_page(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function analytics.label_resolve_page(uuid, uuid, text, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- label_ignore_page — "ไม่ใช่ใบปะหน้า" / not worth resolving. Never touches
-- fact_order — no crm_audit_log entry (nothing about an order changed); the
-- who/when/why lives on the page row itself via applied_by/applied_at/
-- applied_reason/applied_note.
-- --------------------------------------------------------------------------
create or replace function analytics.label_ignore_page(
  p_shop_id uuid,
  p_page_id uuid,
  p_reason text default null,
  p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_page analytics.stg_label_page%rowtype;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_reason is not null and p_reason not in (
    'no_data_yet', 'unreadable', 'wrong_label', 'customer_moved', 'other'
  ) then
    raise exception 'label_ignore_page: invalid reason code %', p_reason;
  end if;
  -- M1 fix (12 ก.ย. 69): p_note here lands in stg_label_page.applied_note
  -- (not audit_log, but still no user-facing edit/delete path in this
  -- phase) — same cap as label_write_province for the same reason.
  if p_note is not null and length(p_note) > 500 then
    raise exception 'label_ignore_page: p_note too long (% chars, max 500)', length(p_note);
  end if;

  select * into v_page
    from analytics.stg_label_page
   where id = p_page_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'label_ignore_page: page % not found for this shop', p_page_id;
  end if;

  if v_page.match_status not in (
    'needs_review', 'conflict', 'order_not_found', 'undetected', 'parse_failed'
  ) then
    raise exception 'label_ignore_page: page % is already %, cannot ignore again', p_page_id, v_page.match_status;
  end if;

  update analytics.stg_label_page
     set match_status = 'ignored',
         applied_source = 'manual',
         applied_reason = p_reason,
         applied_note = p_note,
         applied_by = auth.uid(),
         applied_at = now(),
         match_detail = coalesce(match_detail, '{}'::jsonb) || jsonb_build_object('prev_status', v_page.match_status)
   where id = p_page_id
     and shop_id = p_shop_id; -- L1: defense in depth (already scoped by the earlier SELECT ... FOR UPDATE)
end;
$$;

revoke execute on function analytics.label_ignore_page(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function analytics.label_ignore_page(uuid, uuid, text, text) to service_role;

-- --------------------------------------------------------------------------
-- label_revert_page — undoes a label_resolve_page call: for every order in
-- the page's fact_order_ids, finds the audit row THIS PAGE specifically
-- created (after->>'page_id' = p_page_id — NOT just "latest for the order",
-- which could belong to an unrelated later direct edit on the same order)
-- and reverts it via the shared helper (which itself refuses if the order's
-- current value has since drifted from that audit's `after`). Atomic across
-- the whole page: if any one order's revert is refused, the entire call
-- raises and nothing is reverted (no partial-revert state).
-- --------------------------------------------------------------------------
create or replace function analytics.label_revert_page(
  p_shop_id uuid,
  p_page_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_page analytics.stg_label_page%rowtype;
  v_prev_status text;
  v_prev_province_code text;
  v_fact_order_id uuid;
  v_audit_id uuid;
begin
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_page
    from analytics.stg_label_page
   where id = p_page_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'label_revert_page: page % not found for this shop', p_page_id;
  end if;

  if v_page.match_status <> 'manual_applied' then
    raise exception 'label_revert_page: page % is not manual_applied (is %), nothing to revert', p_page_id, v_page.match_status;
  end if;

  v_prev_status := coalesce(v_page.match_detail ->> 'prev_status', 'needs_review');
  -- H4 fix (12 ก.ย. 69): restore the parser's own province_code from before
  -- resolve, not null — null used to permanently destroy a 'conflict' page's
  -- real candidate answer (see label_resolve_page's stash comment above for
  -- why that broke future auto-apply). Legitimately null when the page never
  -- had a parser-matched province to begin with (e.g. started as
  -- 'order_not_found'/'undetected'/'parse_failed').
  v_prev_province_code := v_page.match_detail ->> 'prev_province_code';

  if v_page.fact_order_ids is not null then
    foreach v_fact_order_id in array v_page.fact_order_ids loop
      select id into v_audit_id
        from analytics.crm_audit_log
       where shop_id = p_shop_id
         and entity_type = 'fact_order'
         and entity_id = v_fact_order_id
         and action = 'province_set'
         and (after ->> 'page_id') = p_page_id::text
       order by created_at desc
       limit 1;
      if v_audit_id is null then
        raise exception
          'label_revert_page: no province_set audit row found for order % via page % — cannot revert',
          v_fact_order_id, p_page_id;
      end if;
      perform analytics.label_revert_province_audit(p_shop_id, v_fact_order_id, v_audit_id);
    end loop;
  end if;

  update analytics.stg_label_page
     set match_status = v_prev_status,
         province_code = v_prev_province_code,
         applied_source = null,
         applied_reason = null,
         applied_note = null,
         applied_by = null,
         applied_at = null,
         fact_order_ids = null,
         match_detail = (coalesce(match_detail, '{}'::jsonb) - 'prev_status' - 'prev_province_code')
   where id = p_page_id
     and shop_id = p_shop_id; -- L1: defense in depth (already scoped by the earlier SELECT ... FOR UPDATE)
end;
$$;

revoke execute on function analytics.label_revert_page(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.label_revert_page(uuid, uuid) to service_role;

-- ============================================================================
-- 7. crm_order_override — data migration (owner 11 ก.ย., decision #4:
--    "ถอด province_code ออกจาก whitelist ... ก่อนถอด migration ต้องนับ
--    crm_order_override where overrides ? 'province_code'; ถ้ามี ให้ย้ายค่า
--    เข้า raw fact_order.province_code (เฉพาะแถวที่ raw = TH-XX) พร้อม audit
--    province_set source 'crm_override_migrated' แล้วลบ key ออกจาก jsonb —
--    ทำใน migration เดียวกัน") — L4 fix (12 ก.ย.): the actual `reason` value
--    written below is 'other' (one of the 5 fixed codes), not the literal
--    string 'crm_override_migrated' this quote names — the specific label
--    moved into `note` instead, see the INSERT below for why.
--
--    ⚠️ NOT wrapped in a forced-rollback do-block like verify script's other
--    cases — this IS the real, intended, permanent effect of this migration
--    (closing the override whitelist without this step would silently drop
--    already-corrected province data with no trace). It is naturally
--    idempotent (see checklist above) and each write goes through the exact
--    same structural TH-XX-only guard label_apply_matched uses, so a
--    mid-migration failure/retry cannot double-apply or clobber real data.
--
--    Tech Lead: run this BEFORE apply to know the blast radius —
--      select
--        count(*) filter (where fo.province_code = 'TH-XX') as will_migrate_to_raw,
--        count(*) filter (where fo.province_code <> 'TH-XX') as will_drop_conflicting,
--        count(*) as total_with_province_override
--      from analytics.crm_order_override ov
--      join analytics.fact_order fo on fo.id = ov.fact_order_id
--      where ov.overrides ? 'province_code';
-- ============================================================================

do $$
declare
  v_row record;
  v_new_overrides jsonb;
  v_migrated int := 0;
  v_dropped int := 0;
  v_rows_cleared int := 0;
begin
  for v_row in
    select ov.fact_order_id, ov.shop_id, ov.overrides, fo.province_code as raw_province
      from analytics.crm_order_override ov
      join analytics.fact_order fo on fo.id = ov.fact_order_id
     where ov.overrides ? 'province_code'
     for update of ov
  loop
    -- L5 fix (12 ก.ย. 69): the OLD crm_set_order_override never validated a
    -- province_code VALUE against analytics.dim_geo (jsonb has no FK) — only
    -- that the KEY was in the whitelist — so a malformed/stale value is
    -- theoretically possible even though live data has 0 such rows today
    -- (Tech Lead, 12 ก.ย.). Checking it here, BEFORE the write, means a bad
    -- value is treated the same as any other "can't safely migrate" case
    -- (falls to the else branch, dropped not applied) instead of hitting
    -- fact_order.province_code's FK mid-loop and aborting the WHOLE
    -- migration over one bad row.
    if v_row.raw_province = 'TH-XX'
       and (v_row.overrides ->> 'province_code') is not null
       and exists (select 1 from analytics.dim_geo g where g.province_code = v_row.overrides ->> 'province_code')
    then
      -- same structural guard as label_apply_matched: only ever write over
      -- the blank sentinel, never a real value — belt-and-suspenders on top
      -- of the `raw_province = 'TH-XX'` filter already in the cursor query.
      update analytics.fact_order
         set province_code = v_row.overrides ->> 'province_code',
             province_source = 'manual',
             updated_at = now()
       where id = v_row.fact_order_id
         and shop_id = v_row.shop_id
         and province_code = 'TH-XX';

      if found then
        insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
        values (
          v_row.shop_id, null, 'province_set', 'fact_order', v_row.fact_order_id,
          jsonb_build_object('province_code', 'TH-XX', 'province_source', 'import'),
          jsonb_build_object(
            'province_code', v_row.overrides ->> 'province_code', 'province_source', 'manual',
            -- L4 fix (12 ก.ย. 69): 'crm_override_migrated' is NOT one of the
            -- 5 fixed reason codes the CHECK/RPCs enforce elsewhere in this
            -- file (this INSERT is a raw jsonb write inside a migration
            -- do-block, so nothing stops it from drifting off that set —
            -- but drifting off it defeats the whole point of having a fixed
            -- set the UI renders as a closed dropdown). Use 'other' + put
            -- the specific explanation in note instead, so every province
            -- audit row in this table always has a reason from the same
            -- closed set, no exceptions.
            'reason', 'other',
            'note', 'ย้ายจาก crm_order_override ตอนถอด province_code ออกจาก whitelist (0116, ค่าเดิมของ reason ก่อนแก้ตาม L4 = crm_override_migrated)'
          )
        );
        v_migrated := v_migrated + 1;
      end if;
    else
      -- One of: raw already carries a real (non-TH-XX) province that
      -- disagrees with (or duplicates) the override, OR (L5) the override's
      -- province_code value isn't a real analytics.dim_geo row — either way
      -- the override is simply dropped, not applied. Its prior existence is
      -- still visible via the order_override_set audit row written when it
      -- was originally set (0021) — nothing is silently erased from
      -- history, it just stops being an active override going forward.
      v_dropped := v_dropped + 1;
    end if;

    v_new_overrides := v_row.overrides - 'province_code';
    if v_new_overrides = '{}'::jsonb then
      -- nothing else was overridden on this order — delete the row rather
      -- than leave a `{}` husk, so v_fact_order.is_edited stops reporting
      -- "edited" for an order with zero active overrides left.
      delete from analytics.crm_order_override where fact_order_id = v_row.fact_order_id;
      insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
      values (v_row.shop_id, null, 'order_override_clear', 'fact_order', v_row.fact_order_id, v_row.overrides, null);
      v_rows_cleared := v_rows_cleared + 1;
    else
      update analytics.crm_order_override
         set overrides = v_new_overrides, updated_at = now()
       where fact_order_id = v_row.fact_order_id;
    end if;
  end loop;

  raise notice
    'crm_order_override.province_code migration (0116): migrated_to_raw=%, dropped_conflicting=%, override_rows_cleared=%',
    v_migrated, v_dropped, v_rows_cleared;
end $$;

-- ============================================================================
-- 8. crm_set_order_override — province_code removed from the write
--    whitelist. Same (uuid, jsonb, text) signature as 0021 -> plain
--    `create or replace` (trap #1), body otherwise byte-identical except the
--    whitelist array losing one element.
-- ============================================================================

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
  -- province_code REMOVED (owner 11 ก.ย., "ถอดเลย") — province is now
  -- edited exclusively via label_set_order_province/label_resolve_page,
  -- which write the raw fact_order.province_code directly instead of an
  -- overlay, closing the "two truths" gap (raw vs v_fact_order) design §0.2
  -- flagged.
  v_whitelist text[] := array['channel_id', 'revenue', 'discount', 'tags', 'order_date', 'bank'];
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
grant execute on function analytics.crm_set_order_override(uuid, jsonb, text) to service_role;

-- ============================================================================
-- 9. label_apply_matched — stamp province_source='label' (H1, 12 ก.ย. 69)
-- ============================================================================
-- Without this, every auto-applied province (the label_apply_matched path,
-- 0097 — the bulk/unsupervised path that runs on every upload/re-parse)
-- stays tagged province_source='import' by the column's DEFAULT (§2 above),
-- indistinguishable from an order whose province has NEVER been verified by
-- anything. That directly breaks the "ทุกแถวต้องบอกที่มา" requirement this
-- whole migration exists for (design decision #3) and the teach-loop's
-- future ability to tell "never checked" apart from "label already said
-- this and it was TH-XX -> real."
--
-- Body below is BYTE-IDENTICAL to the live analytics.label_apply_matched(uuid,
-- uuid) on the DB (pulled via pg_get_functiondef by Tech Lead, 12 ก.ย. 69 —
-- md5 8841871c0b43471d35fa63ebc4c26c66; source kept at
-- scratchpad/label_apply_matched_live.sql) EXCEPT for exactly one added line
-- in the UPDATE (`province_source = 'label',`) — everything else, including
-- comments/whitespace inside the function body, is untouched on purpose so a
-- future diff against the live definition only ever shows that one line.
-- Trap #1 n/a (signature unchanged, (uuid, uuid)) -> plain `create or
-- replace` is correct. Trap #2: re-grant below, narrowed to service_role
-- only (this write RPC follows the same H3 policy as the other write RPCs
-- in this file — the app only ever calls it via the service client, and
-- crm_require_owner_admin's service_role short-circuit means an
-- `authenticated` grant here was never actually needed).
create or replace function analytics.label_apply_matched(p_shop_id uuid, p_file_id uuid)
 returns table(applied integer, skipped_has_province integer, conflict_cnt integer)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_page          record;
  v_applied       int := 0;
  v_skipped       int := 0;
  v_conflict      int := 0;
  v_updated_ids   uuid[];
  v_has_conflict  boolean;
  v_has_any_order boolean;
begin
  if p_shop_id is null or p_file_id is null then
    raise exception 'label_apply_matched: p_shop_id and p_file_id are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if not exists (
    select 1 from analytics.label_file lf
     where lf.id = p_file_id and lf.shop_id = p_shop_id
  ) then
    raise exception 'label_apply_matched: label file not found for this shop' using errcode = '22023';
  end if;

  for v_page in
    select slp.id, slp.tracking_no, slp.province_code
      from analytics.stg_label_page slp
     where slp.label_file_id = p_file_id
       and slp.shop_id = p_shop_id
       and slp.match_status = 'matched'
       and slp.applied_at is null
       and slp.tracking_no is not null
       and slp.province_code is not null
     order by slp.page_no
     for update
  loop
    v_has_any_order := exists (
      select 1 from analytics.fact_order fo
       where fo.shop_id = p_shop_id and fo.tracking_no = v_page.tracking_no
    );

    if not v_has_any_order then
      update analytics.stg_label_page set match_status = 'order_not_found' where id = v_page.id;
      continue;
    end if;

    v_has_conflict := exists (
      select 1 from analytics.fact_order fo
       where fo.shop_id = p_shop_id
         and fo.tracking_no = v_page.tracking_no
         and fo.province_code <> 'TH-XX'
         and fo.province_code <> v_page.province_code
    );

    if v_has_conflict then
      update analytics.stg_label_page set match_status = 'conflict' where id = v_page.id;
      v_conflict := v_conflict + 1;
      continue;
    end if;

    with updated as (
      update analytics.fact_order as fo
         set province_code = v_page.province_code,
             province_source = 'label',
             updated_at = now()
       where fo.shop_id = p_shop_id
         and fo.tracking_no = v_page.tracking_no
         and fo.province_code = 'TH-XX'
      returning fo.id
    )
    select array_agg(id) into v_updated_ids from updated;

    if v_updated_ids is not null and array_length(v_updated_ids, 1) > 0 then
      update analytics.stg_label_page
         set applied_at = now(),
             applied_prev_code = 'TH-XX',
             fact_order_ids = v_updated_ids
       where id = v_page.id;
      v_applied := v_applied + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  applied := v_applied;
  skipped_has_province := v_skipped;
  conflict_cnt := v_conflict;
  return next;
end;
$function$;

revoke execute on function analytics.label_apply_matched(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.label_apply_matched(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
