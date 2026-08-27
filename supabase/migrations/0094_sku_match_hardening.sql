-- 0094_sku_match_hardening.sql
-- Security review of 0093 found two live footguns, both landing in the same
-- place: profit that looks fine but isn't. This migration closes them by
-- adding two more tiers/guards on top of 0093's 3-tier match, without
-- touching the tier-1 happy path or the 0042 silver-bar cost override.
--
-- ============================================================================
-- CORRECTION to 0093's header comment (lines 32-33 of 0093): it claimed
-- `ทองจีน-ลายจีน53` normalizes to `''`. That is wrong -- verified against a
-- live run: `regexp_replace('ทองจีน-ลายจีน53', '^[^A-Za-z0-9]+', '')` strips
-- only the LEADING run of non-alnum characters and stops at the first
-- alnum char it hits, which here is the digit `5`. The result is `53`, not
-- `''`. The SKU that actually normalizes to `''` is `กรอบสมเด็จ` (no
-- trailing digits at all).
--
-- This is not a cosmetic correction -- it exposes a real hole in 0093's
-- tier 3 guard. Any Thai SKU that happens to END in digits (a common
-- 3J naming pattern) normalizes down to just those trailing digits, e.g.
-- `ทองจีน-ลายจีน53` -> `53`, `เงินแท่ง1บาท-05` -> `05`. If there happens to
-- be exactly one ACTIVE product elsewhere in the catalog whose sku also
-- normalizes to that same short numeric tail (e.g. sku `B-53` or a stray
-- barcode-only sku `53`), tier 3 will silently misattribute the order line
-- to that unrelated product -- and stamp error_detail with a note that
-- *looks like* a confirmed match, hiding the mistake completely.
--
-- ============================================================================
-- Fix 1 (problem 1 in the review) -- two more guards on tier 3, in addition
-- to 0093's existing "normalized needle is empty -> skip" and "more than one
-- active candidate -> skip" guards:
--   a) the LEADING run stripped off must be at most 2 characters. A stray
--      Thai IME vowel/tone mark (0093's original bug, e.g. `์NC20-1`) is
--      always 1 character. Anything longer means the whole SKU is Thai text
--      that got reduced to a coincidental digit/letter tail, not a genuine
--      1-2 char keyboard-layout accident -- must not be used as a match key.
--   b) the normalized needle must contain at least one A-Z letter
--      (`~ '[A-Za-z]'`). A needle that is pure digits (`53`, `05`, ...) is
--      far too easy to collide with an unrelated real SKU; refuse it.
--
-- Fix 2 (problem 2) -- new tier 2' placed AFTER tier 3 (order matters): an
-- EXACT (non-normalized) match against an INACTIVE product, used only when
-- tier 1 AND tier 3 both found nothing. 0093 deliberately never fell back to
-- inactive products because doing so at tier 2 (before tier 3) would revive
-- the exact closed-duplicate bug it was fixing. Placing it after tier 3
-- instead of removing it entirely closes a different hole: when the owner
-- discontinues a product with NO clean active twin (not a dirty/clean pair,
-- just an end-of-life SKU), the old behavior gave product_id = null ->
-- unit_cost = null -> that line contributes $0 COGS -> profit is overstated,
-- silently, and still stamped profit_status = 'actual'. This is safe
-- specifically because it runs after tier 3: if tier 3 (which searches
-- ACTIVE products only) already proved no active product normalizes to this
-- SKU, then an exact hit on an inactive product cannot be the closed half of
-- a dirty/clean pair -- tier 3 would have caught the clean twin first, every
-- time. It can only be a genuine discontinued SKU with no replacement.
--
-- Fix 3 (problem 3) -- error_detail must never be silent for a true unknown.
-- When v_product_id is still null after every tier, error_detail is now
-- always set to a note naming the raw SKU and stating cost was counted as 0,
-- so an owner scanning stg_order_line_import can find every order whose
-- profit is currently unreliable instead of finding out by accident.
--
-- Fix 4 (problem 4) -- 0093's tier 3 ran `count(*)` and `select ... into` as
-- two separate statements against the same mutable table, which can observe
-- two different snapshots if a row is edited in between (extremely unlikely
-- in this single-batch-import flow, but cheap to close and the review flagged
-- it explicitly). Both tier 3 and the new tier 2' now run a SINGLE query
-- (a subquery with `count(*) over ()`, `limit 1`) so the row(s) considered for
-- the count and the row selected are guaranteed to come from one snapshot. If
-- the count is not exactly 1, product_id/unit_cost/category are explicitly
-- cleared and match_note is left unset for that tier (the tier is treated as
-- "did not match", not as a lucky first-row guess).
--
-- ============================================================================
-- Kept unchanged from 0093 (verified byte-identical except the declare block
-- and the per-item matching block below):
--   - tier 1 (exact sku + is_active) -- unchanged happy path
--   - 0042 silver-bar spot-cost override (v_category = 'เงินแท่ง' -> price / 1.2)
--   - skipped_blank / orphan / error bookkeeping in the first loop
--   - delete-then-reinsert of fact_order_item per source order
--   - cogs / profit / profit_status = 'actual' recompute
--   - the 5 return counters
--   - search_path pin to 'public','analytics','extensions','pg_temp'
--
-- Signature (p_shop_id uuid, p_batch_id uuid) is unchanged, so plain
-- `create or replace` is safe (3j-migration-traps #1). Grant is re-issued
-- anyway (#2 -- grants do not survive `create or replace`).
--
-- NOTE: [[:alnum:]] is intentionally never used anywhere in this file --
-- Postgres's POSIX character classes treat Thai letters as alnum, which would
-- silently defeat every guard above. Only literal A-Za-z0-9 ranges are used.

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
  v_match_count int;                       -- 0094: count(*) over() from the single-statement tier 3 / tier 2' lookup
  v_match_note text;                       -- 0093: tier-3/tier-2' breadcrumb for error_detail, else null
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
    for v_item in
      select * from analytics.stg_order_line_import s
      where s.shop_id = p_shop_id and s.source_order_no = v_fo.source_order_no and s.sku_raw is not null and s.import_status <> 'skipped_blank'
      order by s.line_no
    loop
      begin
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null; v_match_count := null;

        -- 0093 tier 1: exact sku match, active products only. Unchanged
        -- happy path for every SKU that is already clean.
        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          -- 0093 tier 3 (tier 2 deliberately skipped here -- see header
          -- comment): normalize both sides, strip a LEADING run of
          -- non-alphanumeric chars only, compare against active products,
          -- require a unique hit.
          -- 0094: two extra guards before this tier is even attempted --
          -- stripped prefix must be <= 2 chars, and the normalized needle
          -- must contain at least one letter. See header comment for why.
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          v_stripped_len := length(v_item.sku_raw) - length(v_sku_norm);

          if v_sku_norm <> '' and v_stripped_len <= 2 and v_sku_norm ~ '[A-Za-z]' then
            -- 0094: single statement (count(*) over () + limit 1) instead of
            -- 0093's separate count(*) then select ... into -- avoids the
            -- two-statement race described in the header comment.
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
              -- cnt is 0 (no active candidate) or > 1 (ambiguous) -- treat
              -- as no match, do not guess, do not leave a fake match_note.
              v_product_id := null; v_unit_cost := null; v_category := null;
            end if;
          end if;
        end if;

        if v_product_id is null then
          -- 0094 tier 2': exact (non-normalized) match against an INACTIVE
          -- product, only reached when tier 1 and tier 3 both found
          -- nothing. Safe here specifically because tier 3 already proved no
          -- ACTIVE product normalizes to this SKU -- a dirty/clean pair would
          -- always have been caught by tier 3 first, so an exact inactive
          -- hit at this point can only be a genuine discontinued SKU with no
          -- replacement. See header comment.
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
            v_match_note := 'จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม): ' || v_item.sku_raw;
          else
            v_product_id := null; v_unit_cost := null; v_category := null;
          end if;
        end if;

        if v_product_id is null then
          v_unknown := v_unknown + 1;
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
      end;
    end loop;
    update analytics.fact_order set cogs = v_cogs, profit = round(revenue - v_cogs, 2), profit_status = 'actual' where id = v_fo.fact_order_id;
  end loop;

  return query select v_transformed, v_orphan, v_skipped_blank, v_unknown, v_errored;
end;
$function$;

revoke execute on function analytics.transform_pending_order_lines(uuid, uuid) from public, anon, authenticated;
grant execute on function analytics.transform_pending_order_lines(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
