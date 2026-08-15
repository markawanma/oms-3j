-- 0042_silverbar_spot_cost.sql
-- Fix silver-bar (เงินแท่ง) costing in the line-item transform.
--
-- Silver bars are SPOT-priced: sold at roughly (silver spot + 20%), while the
-- shop's silver cost is ~spot. So the real per-sale margin is a stable
-- 20/120 = 16.7%, and the true cost of any given bar sale is price / 1.2 —
-- it tracks that day's sale price, NOT a fixed catalog cost.
--
-- 0041 used v_dim_product.effective_unit_cost for every SKU, which for bars is
-- a FIXED cost derived from the Aug catalog list price. Applied to earlier
-- months (when silver was cheaper and bars sold for less) that fixed cost
-- often exceeded the sale price -> fake per-order losses, and since bars are
-- ~90% of revenue it dragged the whole store's "actual" profit to a distorted
-- 4-7%. This migration makes the line-item transform derive bar cost from the
-- line's own sale price (price / 1.2), and recomputes the already-backfilled
-- rows. Owner-confirmed model (2026-08-14): "ขายออก spot +20%, รับซื้อ spot −30บ".
--
-- Only part 1 (the proc) is DDL; part 2 is a one-off data recompute of the
-- 5,411 line items already imported by the 0041 backfill.

-- ============================================================================
-- 1. transform_pending_order_lines — bar cost override (byte-identical to
--    0041's body except: declare v_category, fetch category in the product
--    lookup, and the "-- 0042:" branch that overrides bar cost to price/1.2).
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
        v_product_id := null; v_unit_cost := null; v_category := null;
        select vp.product_id, vp.effective_unit_cost, pr.category into v_product_id, v_unit_cost, v_category
          from analytics.v_dim_product vp
          join public.product pr on pr.id = vp.product_id
          where vp.shop_id = p_shop_id and vp.sku = v_item.sku_raw;
        if v_product_id is null then v_unknown := v_unknown + 1; end if;
        -- 0042: silver bars are spot-priced (sold ~spot+20%); real cost tracks
        -- the sale price, not the fixed catalog cost -> price / 1.2 (16.7% margin).
        if v_category = 'เงินแท่ง' then
          v_unit_cost := round(coalesce(v_item.unit_price, 0) / 1.2, 2);
        end if;
        insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, sku_snapshot, product_name_snapshot, qty, unit_price, unit_cost_snapshot)
        values (p_shop_id, v_fo.fact_order_id, v_product_id, v_item.sku_raw, v_item.product_name_raw, coalesce(v_item.qty, 1), coalesce(v_item.unit_price, 0), v_unit_cost)
        returning id into v_new_item_id;
        update analytics.stg_order_line_import set fact_order_item_id = v_new_item_id, import_status = 'transformed', error_detail = null where id = v_item.id;
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

-- ============================================================================
-- 2. Recompute the already-backfilled data (0041's 5,411 items).
--    a. bar item costs -> price / 1.2
--    b. every fact_order that has items -> cogs = sum(qty*cost), profit = rev - cogs
-- ============================================================================

update analytics.fact_order_item i
  set unit_cost_snapshot = round(i.unit_price / 1.2, 2), updated_at = now()
  from public.product p
  where p.id = i.product_id and p.category = 'เงินแท่ง';

update analytics.fact_order fo
  set cogs = agg.cogs, profit = round(fo.revenue - agg.cogs, 2)
  from (
    select fact_order_id, sum(qty * coalesce(unit_cost_snapshot, 0)) as cogs
    from analytics.fact_order_item group by fact_order_id
  ) agg
  where fo.id = agg.fact_order_id and fo.profit_status = 'actual';

notify pgrst, 'reload schema';
