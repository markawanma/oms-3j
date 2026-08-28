-- 0095_profit_honesty.sql
-- Security review round 2b of 0094 found 3 issues, all in
-- analytics.transform_pending_order_lines. This migration closes them
-- without touching tier 1, the 0042 silver-bar override, or any of the
-- bookkeeping/counter logic. Verified against the live DB before writing
-- this file: 3 fact_order rows for August currently have
-- profit_status = 'actual' with cogs = 0 -- exactly the lie fix 1 below
-- stops from happening again.
--
-- ============================================================================
-- Fix 1 (the one that matters most) -- profit_status = 'actual' was written
-- UNCONDITIONALLY at the end of the per-order loop, even for orders that
-- have an item with product_id = null (unit_cost counted as 0) or an item
-- matched only through an unproven tier 2' hit. analytics.profit_status_t
-- already has an 'estimated' member (0010) for exactly this; 0094 never
-- used it here.
--
-- Fix: new per-order flag v_weak_order, reset to false alongside v_cogs :=
-- 0 (top of the per-order loop). Set true when either:
--   (a) an item never matched any tier (the existing v_unknown branch), or
--   (b) an item matched via tier 2' without tier 3 having conclusively
--       proven no active twin exists (see fix 2).
-- The final UPDATE now writes
--   profit_status = case when v_weak_order then 'estimated' else 'actual' end
-- cast to analytics.profit_status_t explicitly -- a bare CASE produces
-- `text`, and text -> enum is not an implicit cast in an UPDATE SET (see
-- 0047's header comment, which hit the identical error on a sibling
-- function). Enum member names verified against 0010 line 49
-- (`create type analytics.profit_status_t as enum ('missing', 'estimated',
-- 'actual')`) -- not guessed.
--
-- Fix 2 -- 0094's tier 2' comment claimed safety on the grounds that "tier 3
-- already proved no active product normalizes to this SKU". 0094's own
-- CORRECTION block (added after the same review round) already flagged that
-- claim as false: tier 3 is skipped entirely whenever any of its guards
-- fail, and even when it runs, cnt > 1 proves ambiguity, not absence. So
-- tier 2' could revive a closed duplicate having proved nothing.
--
-- Fix: new per-item flag v_tier3_conclusive, reset to false alongside the
-- other per-item match variables. Set true ONLY in the branch where tier 3
-- actually ran (passed all three guards) AND came back with zero
-- candidates (coalesce(v_match_count, 0) = 0 -- v_match_count is null, not
-- 0, when the subquery has no rows at all, which is why coalesce is
-- required here; see the tier 3 block below). A cnt > 1 result is
-- ambiguous, not conclusive, so it does NOT set the flag.
-- At tier 2', a match is still accepted and costed exactly as before
-- (0094's trade-off stands: a wrong-but-costed match beats a silent $0
-- COGS) -- but if v_tier3_conclusive is false, the breadcrumb now says so
-- explicitly and v_weak_order is set true, so the order can no longer claim
-- profit_status = 'actual'.
--
-- Fix 3 -- the tier 3 "leading run stripped <= 2 chars" guard let Thai
-- consonants through (`ตล53AB`: strips `ตล`, 2 chars, passes) even though
-- the guard's entire intent (0094 header) was to catch a *stray IME
-- accident* (a lone tone/vowel mark), not two real letters that happen to
-- prefix a numeric-looking SKU.
--
-- Fix: the stripped run itself must contain no real letter --
--   v_stripped := left(v_item.sku_raw, v_stripped_len);
--   ... and (v_stripped_len = 0 or v_stripped !~ '[[:alpha:]]') ...
-- ⚠️ THE ONE EXCEPTION to 0094's "never use POSIX classes" rule (see the
-- updated NOTE at the bottom of this header): here we WANT Thai letters to
-- count as alpha, because the whole point is to reject a stripped run that
-- contains real Thai text (`ตล`) while still allowing a stripped run that
-- is a lone combining tone/vowel mark (`์`, case `์NC20-1` -- not classified
-- as alpha, still passes) or ASCII punctuation. Every other guard in this
-- function keeps using literal A-Za-z0-9 ranges, exactly as before.
--
-- ============================================================================
-- Kept unchanged from 0094 (verified byte-identical except the declare
-- block and the per-order / per-item matching block below):
--   - tier 1 (exact sku + is_active) -- unchanged happy path
--   - 0042 silver-bar spot-cost override (v_category = 'เงินแท่ง' -> price / 1.2)
--   - skipped_blank / orphan / error bookkeeping in the first loop
--   - delete-then-reinsert of fact_order_item per source order
--   - the 5 return counters
--   - single-statement (count(*) over () + limit 1) tier 3 / tier 2' lookups
--   - fix 3 from 0094 (error_detail always set for a true unknown)
--   - search_path pin to 'public','analytics','extensions','pg_temp'
--
-- Signature (p_shop_id uuid, p_batch_id uuid) is unchanged, so plain
-- `create or replace` is safe (3j-migration-traps #1). Grant is re-issued
-- anyway (#2 -- grants do not survive `create or replace`).
--
-- NOTE (updated from 0094): [[:alnum:]] / [[:alpha:]] are NOT used anywhere
-- in this file EXCEPT the single tier-3 "stripped run has no real letter"
-- guard added in fix 3 above, where treating Thai letters as alpha is
-- exactly the desired behavior. Every other guard (tier 3's `v_sku_norm ~
-- '[A-Za-z]'`, the leading-strip regex itself, etc.) still uses only
-- literal A-Za-z0-9 ranges, because Postgres's POSIX classes treating Thai
-- as alnum would silently defeat those.

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

notify pgrst, 'reload schema';
