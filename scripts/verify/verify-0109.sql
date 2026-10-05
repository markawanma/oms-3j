-- scripts/verify-0109.sql
-- Rehearsal + proof for supabase/migrations/0109_orphan_rematch_fix.sql
-- BEFORE Tech Lead applies it for real via apply_migration.
--
-- Per 3j-migration-traps #11: this touches analytics.fact_order_item /
-- fact_order (cogs, profit, profit_status) for real orders, which is exactly
-- the kind of "hard to reverse if wrong" state that rule warns about. So the
-- whole rehearsal -- DDL replace included -- runs inside one explicit
-- transaction that a single `raise exception` inside one `do $$ ... $$`
-- block unconditionally aborts at the end. Nothing here is meant to survive:
-- not the function replace, not the grants, not the two test calls' writes
-- to stg_order_line_import / fact_order_item / fact_order. If every check
-- passes, the log printed by the raised exception is the evidence Tech Lead
-- needs to then apply 0109 for real and call the function for real (outside
-- this script) so the 235 orphan rows actually get fixed in production.
--
-- Why the DDL (step 2) sits OUTSIDE the do block even though the brief asks
-- for "one do $$ ... raise exception $$ block": `create or replace function`
-- is DDL and cannot appear as a direct statement inside PL/pgSQL -- only via
-- dynamic `execute '...'` on a string, which would mean embedding this
-- ~200-line function body as an escaped string literal, doubling the byte-
-- identical-maintenance risk between this file and the real migration for no
-- real safety benefit. Instead: the DDL statements are plain top-level SQL
-- wrapped in an explicit `begin;` ... `rollback;` envelope, and the single
-- do block's mandatory `raise exception` aborts that *whole* transaction --
-- DDL included. There is still exactly one do-block, and it is still what
-- forces the rollback of everything, per the skill's intent.
--
-- shop_id = 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7' (3J Jewelry)
-- batch_id = '27e94d90-e114-44b4-bd15-0190fdbeb80a' (the order-report batch
--   that should retroactively rematch the 235 orphan SKU-report rows)

begin;

-- ============================================================================
-- STEP 2: apply the 0109 DDL (rehearsal only -- rolled back at the bottom).
-- Must be byte-identical to supabase/migrations/0109_orphan_rematch_fix.sql's
-- CREATE OR REPLACE + grants. If you edit the migration, copy the change
-- here too or this rehearsal stops proving what actually ships.
-- ============================================================================

create or replace function analytics.transform_pending_order_lines(p_shop_id uuid, p_batch_id uuid)
 returns table(transformed_count integer, orphan_count integer, skipped_blank_count integer, unknown_sku_count integer, errored_count integer)
 language plpgsql security definer set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $function$
declare
  v_row analytics.stg_order_line_import%rowtype;
  v_item analytics.stg_order_line_import%rowtype;
  v_fo record;
  v_product_id uuid;
  v_unit_cost numeric(12, 2);
  v_category text;                         -- 0042
  v_sku_norm text;                         -- 0093: sku_raw with leading junk stripped
  v_stripped_len int;                      -- 0094: how many leading chars were stripped
  v_stripped text;                         -- 0095 fix 3: the actual stripped leading run
  v_match_count int;                       -- 0094: count(*) over() from the single-statement tier 3 / tier 2' lookup
  v_match_note text;                       -- 0093: tier-3/tier-2' breadcrumb for error_detail, else null
  v_tier3_conclusive boolean;              -- 0095 fix 2: true only when tier 3 ran and proved cnt = 0
  v_weak_order boolean;                    -- 0095 fix 1: true when this order must not be stamped 'actual'
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
    v_weak_order := false; -- 0095 fix 1: per-order flag, reset alongside v_cogs
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;
        v_tier3_conclusive := false; -- 0095 fix 2: per-item, only tier 3's own "cnt = 0" branch sets this true

        -- 0093 tier 1: exact sku match, active products only. Unchanged
        -- happy path for every SKU that is already clean.
        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          -- 0093 tier 3 (tier 2 deliberately skipped here -- see 0094
          -- header comment): normalize both sides, strip a LEADING run of
          -- non-alphanumeric chars only, compare against active products,
          -- require a unique hit.
          -- 0094 guards: stripped prefix must be <= 2 chars, and the
          -- normalized needle must contain at least one letter.
          -- 0095 fix 3: ALSO require the stripped run itself to contain no
          -- real letter (Thai included) -- see header comment for why
          -- `[[:alpha:]]` is the one intentional exception here.
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);
          v_stripped := left(v_item.sku_raw, v_stripped_len);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]'
             and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') then
            -- 0094: single statement (count(*) over () + limit 1) instead of
            -- 0093's separate count(*) then select ... into -- avoids the
            -- two-statement race described in the 0094 header comment.
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
              -- 0095 fix 2: v_match_count is null (not 0) when the subquery
              -- returned zero rows -- coalesce is required. Only a
              -- genuine cnt = 0 proves no active twin exists; cnt > 1
              -- proves ambiguity, not absence, so it must NOT set
              -- v_tier3_conclusive.
              if coalesce(v_match_count, 0) = 0 then
                v_tier3_conclusive := true;
              end if;
              -- cnt is 0 (no active candidate) or > 1 (ambiguous) -- treat
              -- as no match, do not guess, do not leave a fake match_note.
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          -- 0094 tier 2': exact (non-normalized) match against an INACTIVE
          -- product, reached when tier 1 found nothing AND tier 3 either
          -- found nothing or was skipped by its guards.
          -- 0095 fix 2: v_tier3_conclusive (set above) now gates whether
          -- this is trustworthy enough to call 'actual'. Match is still
          -- accepted and costed either way -- 0094's trade-off stands (a
          -- wrong-but-costed match beats a silent $0 COGS) -- but an
          -- inconclusive tier 3 now flips v_weak_order so the order is
          -- stamped 'estimated', not 'actual'.
          select sub.product_id, sub.effective_unit_cost, sub.category, sub.cnt
            into v_product_id, v_unit_cost, v_category, v_match_count
            from (
              select vp.product_id, vp.effective_unit_cost, vp.category,
                     count(*) over () as cnt
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and not vp.is_active and vp.sku = v_item.sku_raw
                limit 1
            ) sub;

          -- NOTE: uq_product_shop_sku (shop_id, sku) means cnt here can only
          -- ever be 0 or 1 -- the `= 1` check (vs. `>= 1`) is therefore
          -- effectively dead code for the ">1" case. Left as-is (matches
          -- the tier 3 pattern above and costs nothing), known and
          -- intentional, not an oversight.
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
          v_weak_order := true; -- 0095 fix 1(a): unknown item -> order profit cannot be called 'actual'
          -- 0094 fix 3: unknown SKUs must always leave a breadcrumb -- 0093
          -- left error_detail null here, so a $0-cost line was invisible
          -- unless someone thought to check.
          v_match_note := 'ไม่พบสินค้าในระบบ ต้นทุนถูกนับเป็น 0: ' || v_item.sku_raw;
        end if;
        -- 0042: silver bars are spot-priced (sold ~spot+20%); real cost tracks
        -- the sale price, not the fixed catalog cost -> price / 1.2 (16.7% margin).
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
        -- 0095 fix 1(c): an item that threw is NOT inserted into
        -- fact_order_item at all -- it does not contribute $0 cost, it
        -- vanishes from the order entirely. That is strictly worse than an
        -- unknown SKU, so the order must not claim 'actual' either.
        -- (backend-dev flagged this gap; the brief only listed unknown and
        -- unproven-tier-2' -- adding it here rather than leaving a third
        -- silent path to an overstated profit.)
        v_weak_order := true;
      end;
    end loop;
    -- 0095 fix 1: 'actual' is no longer unconditional -- any item that was
    -- unknown or matched via an unproven tier 2' hit flips this order to
    -- 'estimated'. Cast is required: a bare CASE produces text, and
    -- text -> analytics.profit_status_t is not an implicit UPDATE SET cast
    -- (same error 0047 hit on the sibling function).
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
-- STEPS 1, 3-7: single do-block. Captures golden state, calls the (now
-- rehearsed) function twice, asserts, and unconditionally raises to force
-- the rollback of this whole transaction -- DDL above included.
-- ============================================================================
do $verify$
declare
  v_shop_id  constant uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7';
  v_batch_id constant uuid := '27e94d90-e114-44b4-bd15-0190fdbeb80a';
  v_log text := E'\n=== verify-0109 orphan-rematch rehearsal ===\n';
  v_fail_count int := 0;

  -- STEP 1: golden (pre-run) state. Pure SELECTs against tables -- unaffected
  -- by whether the DDL above already replaced the function, since a
  -- function-definition change does not itself touch any row.
  v_pre_items_count bigint;
  v_pre_profit_sum  numeric;
  v_pre_cogs_sum    numeric;
  v_pre_pending     bigint;
  v_pre_orphan      bigint;
  v_pre_error       bigint;
  v_pre_skipped     bigint;
  v_pre_transformed bigint;
  v_stale_orphan_ids uuid[];

  -- STEP 3: two calls
  r1_transformed int; r1_orphan int; r1_skipped int; r1_unknown int; r1_errored int;
  r2_transformed int; r2_orphan int; r2_skipped int; r2_unknown int; r2_errored int;
  v_post_run1_items bigint;
  v_post_run2_items bigint;

  -- STEP 5/6: post-run row counts
  v_post_transformed bigint;
  v_post_skipped     bigint;
begin
  -- run as service_role, matching how the app actually calls this
  -- security-definer RPC (grants above only allow service_role).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- --------------------------------------------------------------------
  -- STEP 1: golden state
  -- --------------------------------------------------------------------
  select count(*) into v_pre_items_count
    from analytics.fact_order_item where shop_id = v_shop_id;

  select coalesce(sum(profit), 0), coalesce(sum(cogs), 0)
    into v_pre_profit_sum, v_pre_cogs_sum
    from analytics.fact_order
    where shop_id = v_shop_id and order_date between date '2026-09-01' and date '2026-09-04';

  select count(*) filter (where import_status = 'pending'),
         count(*) filter (where import_status = 'orphan'),
         count(*) filter (where import_status = 'error'),
         count(*) filter (where import_status = 'skipped_blank'),
         count(*) filter (where import_status = 'transformed')
    into v_pre_pending, v_pre_orphan, v_pre_error, v_pre_skipped, v_pre_transformed
    from analytics.stg_order_line_import
    where shop_id = v_shop_id;

  v_log := v_log || format(
    E'golden: fact_order_item=%s | profit(1-4sep)=%s cogs(1-4sep)=%s | stg: pending=%s orphan=%s error=%s skipped_blank=%s transformed=%s\n',
    v_pre_items_count, v_pre_profit_sum, v_pre_cogs_sum,
    v_pre_pending, v_pre_orphan, v_pre_error, v_pre_skipped, v_pre_transformed
  );

  -- snapshot the truly-stale orphan rows (no fact_order parent at all) by id
  -- so step 6 checks each one individually, not just an aggregate count that
  -- could stay flat by coincidence.
  select array_agg(s.id) into v_stale_orphan_ids
    from analytics.stg_order_line_import s
    where s.shop_id = v_shop_id
      and s.import_status = 'orphan'
      and not exists (
        select 1 from analytics.fact_order fo
        where fo.shop_id = v_shop_id and fo.source_order_no = s.source_order_no
      );

  if coalesce(array_length(v_stale_orphan_ids, 1), 0) <> 8 then
    v_log := v_log || format(
      E'WARN: expected exactly 8 stale orphan rows with no fact_order parent, found %s -- the brief''s baseline may be stale, continuing anyway (T6 below still checks whatever set was actually found)\n',
      coalesce(array_length(v_stale_orphan_ids, 1), 0)
    );
  end if;

  -- --------------------------------------------------------------------
  -- STEP 3: call the (rehearsed) function twice
  -- --------------------------------------------------------------------
  select transformed_count, orphan_count, skipped_blank_count, unknown_sku_count, errored_count
    into r1_transformed, r1_orphan, r1_skipped, r1_unknown, r1_errored
    from analytics.transform_pending_order_lines(v_shop_id, v_batch_id);

  select count(*) into v_post_run1_items from analytics.fact_order_item where shop_id = v_shop_id;

  v_log := v_log || format(
    E'run1: transformed=%s orphan=%s skipped_blank=%s unknown_sku=%s errored=%s | fact_order_item now=%s\n',
    r1_transformed, r1_orphan, r1_skipped, r1_unknown, r1_errored, v_post_run1_items
  );

  select transformed_count, orphan_count, skipped_blank_count, unknown_sku_count, errored_count
    into r2_transformed, r2_orphan, r2_skipped, r2_unknown, r2_errored
    from analytics.transform_pending_order_lines(v_shop_id, v_batch_id);

  select count(*) into v_post_run2_items from analytics.fact_order_item where shop_id = v_shop_id;

  v_log := v_log || format(
    E'run2: transformed=%s orphan=%s skipped_blank=%s unknown_sku=%s errored=%s | fact_order_item now=%s\n',
    r2_transformed, r2_orphan, r2_skipped, r2_unknown, r2_errored, v_post_run2_items
  );

  -- --------------------------------------------------------------------
  -- STEP 4: run1 must actually fix the backlog; run2 must be a true no-op,
  -- both on the returned counter AND on the physical fact_order_item count
  -- (the counter alone would not catch a delete+reinsert that nets to the
  -- same count via a different, duplicated set of rows).
  -- --------------------------------------------------------------------
  if r1_transformed < 200 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T1: run1 transformed_count=%s, expected roughly 235 (>= 200 sanity floor) -- the fix did not rematch the orphan backlog\n', r1_transformed);
  else
    v_log := v_log || format(E'OK   T1: run1 transformed_count=%s (>= 200, matches the ~235-row orphan backlog)\n', r1_transformed);
  end if;

  if r2_transformed <> 0 then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T2: run2 transformed_count=%s, expected 0 -- rows are being re-promoted/re-transformed on a second call, fix is NOT idempotent\n', r2_transformed);
  else
    v_log := v_log || E'OK   T2: run2 transformed_count=0\n';
  end if;

  if v_post_run2_items <> v_post_run1_items then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T3: fact_order_item count changed between run1 (%s) and run2 (%s) -- phase 2 is NOT idempotent, duplicates or losses on repeat calls. STOP -- do not ship this migration.\n', v_post_run1_items, v_post_run2_items);
  else
    v_log := v_log || format(E'OK   T3: fact_order_item count unchanged across run1->run2 (%s), confirms the delete-then-reinsert-per-order pattern is idempotent\n', v_post_run2_items);
  end if;

  -- --------------------------------------------------------------------
  -- STEP 5: previously-transformed and skipped_blank rows must be untouched
  -- --------------------------------------------------------------------
  select count(*) filter (where import_status = 'transformed'),
         count(*) filter (where import_status = 'skipped_blank')
    into v_post_transformed, v_post_skipped
    from analytics.stg_order_line_import
    where shop_id = v_shop_id;

  if v_post_transformed < v_pre_transformed then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T4: transformed row count DROPPED from %s to %s -- previously-matched rows were disturbed\n', v_pre_transformed, v_post_transformed);
  else
    v_log := v_log || format(E'OK   T4: transformed row count did not drop (%s -> %s)\n', v_pre_transformed, v_post_transformed);
  end if;

  if v_pre_transformed < 6966 then
    v_log := v_log || format(E'WARN: pre-run transformed count (%s) is below the 6,966 baseline stated in the brief -- baseline may be stale, not treated as a hard failure\n', v_pre_transformed);
  end if;

  if v_post_skipped <> v_pre_skipped then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format(E'FAIL T5: skipped_blank count changed (%s -> %s) -- skipped_blank rows must never be revived by this fix\n', v_pre_skipped, v_post_skipped);
  else
    v_log := v_log || format(E'OK   T5: skipped_blank count unchanged (%s)\n', v_post_skipped);
  end if;

  -- --------------------------------------------------------------------
  -- STEP 6: stale orphan rows (no fact_order parent at all) must still be
  -- 'orphan' after both calls -- checked per-row, not just via a count.
  -- --------------------------------------------------------------------
  if v_stale_orphan_ids is not null and array_length(v_stale_orphan_ids, 1) > 0 then
    if exists (
      select 1 from analytics.stg_order_line_import s
      where s.id = any(v_stale_orphan_ids) and s.import_status <> 'orphan'
    ) then
      v_fail_count := v_fail_count + 1;
      v_log := v_log || E'FAIL T6: at least one stale orphan row (no fact_order parent) was wrongly promoted out of orphan\n';
    else
      v_log := v_log || format(E'OK   T6: all %s stale orphan rows (no fact_order parent) are still orphan\n', array_length(v_stale_orphan_ids, 1));
    end if;
  else
    v_log := v_log || E'WARN T6: no stale orphan rows found to check -- cannot verify this case (baseline in the brief may be stale)\n';
  end if;

  -- --------------------------------------------------------------------
  -- STEP 7: unconditional rollback via raise exception. Everything in this
  -- transaction -- the DDL replace/grants above and both test calls'
  -- writes -- is undone. Only the message below survives, as an error.
  -- --------------------------------------------------------------------
  if v_fail_count > 0 then
    v_log := v_log || format(E'\n=== %s CHECK(S) FAILED -- 0109 is NOT safe to ship as-is ===\n', v_fail_count);
  else
    v_log := v_log || E'\n=== ALL CHECKS PASSED -- safe to apply 0109 for real (apply_migration) and then call transform_pending_order_lines for real to fix the live orphan backlog ===\n';
  end if;

  raise exception '%', v_log;
end;
$verify$;

-- Never reached in practice (the raise exception above already aborts the
-- transaction) -- present for clarity and as a safety net if this script is
-- ever run with the do-block's raise commented out by mistake.
rollback;
