-- 0093_sku_match_normalize.sql
-- Fix SKU matching in the line-item transform so the "Thai IME leftover
-- character" bug doesn't come back next month.
--
-- Root cause: Shipnity exports carry a stray leading Thai vowel/tone mark on
-- some SKUs because the keyboard was still set to Thai when the code was
-- typed, e.g. `์NC20-1` (should be `NC20-1`), `ืNC22-3M` (should be
-- `NC22-3M`). analytics.transform_pending_order_lines (0041/0042) matched
-- SKUs with a bare `vp.sku = v_item.sku_raw` string comparison and never
-- filtered on `is_active`. Today (2026-08-27) the Tech Lead manually merged
-- 18 dirty/clean product pairs (fact_order_item repointed to the clean
-- active product, dirty duplicate set is_active=false) and is renaming 8
-- more dirty-but-unpaired SKUs to clean ones. Left as-is, the exact-match
-- lookup would undo both fixes on the very next import:
--   1. Shipnity still sends `์NC20-1` -> exact match still finds the
--      CLOSED duplicate (no is_active filter) -> sales split across two
--      products again, silently.
--   2. The 8 renamed SKUs -> Shipnity still sends the old dirty spelling
--      -> exact match finds nothing -> product_id null -> cost 0 -> profit
--      overstated, silently.
--
-- Fix: 3-tier match, tier 1 always wins if it hits.
--   Tier 1 — exact sku match AND is_active. The normal case, unchanged
--            behavior for every already-clean SKU.
--   Tier 2 — deliberately SKIPPED. An exact match against an INACTIVE
--            product is exactly the closed duplicate we want to stop
--            reviving, so we do not fall back to it; go straight to tier 3.
--   Tier 3 — normalize (strip only a LEADING run of non [A-Za-z0-9] chars,
--            both sides) and compare against active products. Guarded two
--            ways because normalization is lossy:
--            a) if the normalized staging SKU is EMPTY (e.g. an
--               intentionally all-Thai SKU like `กรอบสมเด็จ` or
--               `ทองจีน-ลายจีน53` normalizes to ''), tier 3 is skipped
--               entirely — an empty needle would match nothing usefully
--               but must never be allowed to match "the first active row"
--               by accident.
--            b) if normalization yields MORE THAN ONE active candidate
--               (e.g. `.B-15` normalizes to `B-15`, which could coincide
--               with an unrelated real SKU `B-15`), treat it as no match.
--               Ambiguous is safer as unknown_sku than as a silent
--               misattribution.
--   When tier 3 is what matched (not tier 1), the row is still marked
--   'transformed' (cost/profit must not be blocked), but error_detail is
--   set to a short Thai note so the owner can see the source file still has
--   a typo, e.g.:
--     'จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า: ์NC20-1 -> NC20-1'
--
-- Body copied from 0042 (confirmed latest definition — grep of
-- `create or replace function analytics.transform_pending_order_lines`
-- across supabase/migrations shows only 0041 then 0042; 0043/0047 only
-- mention the function name in comments, they don't redefine it). Only the
-- per-item matching block (declare + the single select) and the final
-- update's error_detail are changed; everything else — including the 0042
-- silver-bar spot-cost override — is byte-identical.
--
-- Signature (p_shop_id uuid, p_batch_id uuid) is unchanged from 0041/0042,
-- so plain `create or replace` is safe here (see 3j-migration-traps #1) —
-- no `drop function` needed. Grant is re-issued anyway per trap #2 (grants
-- do not survive `create or replace`).

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
  v_norm_match_count int;                  -- 0093: how many ACTIVE products normalize to v_sku_norm
  v_match_note text;                       -- 0093: tier-3 breadcrumb for error_detail, else null
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
        v_product_id := null; v_unit_cost := null; v_category := null; v_match_note := null;

        -- 0093 tier 1: exact sku match, active products only. Unchanged
        -- happy path for every SKU that is already clean.
        select vp.product_id, vp.effective_unit_cost, vp.category
          into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          where vp.shop_id = p_shop_id and vp.is_active and vp.sku = v_item.sku_raw;

        if v_product_id is null then
          -- 0093 tier 3 (tier 2 deliberately skipped — see header comment):
          -- normalize both sides, strip a LEADING run of non-alphanumeric
          -- chars only, compare against active products, require a unique
          -- hit.
          v_sku_norm := regexp_replace(v_item.sku_raw, '^[^A-Za-z0-9]+', '');
          if v_sku_norm <> '' then
            select count(*) into v_norm_match_count
              from analytics.v_dim_product vp
              where vp.shop_id = p_shop_id and vp.is_active
                and regexp_replace(vp.sku, '^[^A-Za-z0-9]+', '') = v_sku_norm;
            if v_norm_match_count = 1 then
              select vp.product_id, vp.effective_unit_cost, vp.category
                into v_product_id, v_unit_cost, v_category
                from analytics.v_dim_product vp
                where vp.shop_id = p_shop_id and vp.is_active
                  and regexp_replace(vp.sku, '^[^A-Za-z0-9]+', '') = v_sku_norm;
              v_match_note := 'จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า: ' || v_item.sku_raw || ' -> ' || v_sku_norm;
            end if;
          end if;
        end if;

        if v_product_id is null then v_unknown := v_unknown + 1; end if;
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
