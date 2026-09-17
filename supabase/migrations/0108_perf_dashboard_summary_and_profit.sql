-- 0108_perf_dashboard_summary_and_profit.sql
-- ✅ APPLIED 4 ก.ย. 69 (version 20260904084431) — ไฟล์ถูกเก็บเข้า main 14 ก.ย. 69
--    หลังค้างอยู่บน branch feature/dashboard-perf
-- 🔴 ไฟล์นี้คือนิยามล่าสุดของ analytics.v_fact_order ไม่ใช่ 0028 — ตอนที่ไฟล์นี้ยัง
--    ไม่อยู่ใน main มีคนอ่าน repo แล้วสรุปว่า 0028 คือตัวล่าสุดจริง (security review
--    12 ก.ย. 69) ใครแก้ view นี้โดยลอกจาก 0028 จะลบงาน perf ของ 0108 ทิ้งเงียบๆ
--    ⇒ แก้ครั้งหน้าให้ลอกจาก pg_get_viewdef สดจาก DB เสมอ
-- Perf fix (architect-approved design, Tech Lead handoff 2026-09-04),
-- second of two root causes behind the measured 279ms / 56,136 buffers on
-- /dashboard (shop a7c850ee-6776-4c3e-ba72-ba9e8caba2b7):
--
-- (a) analytics.v_fact_order computed `profit` for estimated-status rows
--     with a correlated subquery `(select ss.blended_margin_pct from
--     analytics.shop_setting ss where ss.shop_id = fo.shop_id)` -- Postgres
--     runs this as a SubPlan re-executed on every row that projects
--     `profit`, i.e. everywhere v_fact_order (or anything built on it,
--     which is almost every analytics view) is read. shop_setting has a
--     single-column PRIMARY KEY on shop_id (confirmed in
--     0028_sku_cost_margin.sql: `shop_id uuid primary key references
--     public.shop (id) ...`), so replacing the subquery with a plain
--     `LEFT JOIN analytics.shop_setting ss on ss.shop_id = fo.shop_id`
--     cannot add or drop rows -- at most one shop_setting row per shop_id,
--     ever. This exact join pattern is already live in this same file
--     (v_channel_perf_roas, a few sections below the old profit subquery)
--     so it's a proven-safe join shape in production today, not new risk.
--
-- (b) analytics.dashboard_summary's repeat_rate computed lifetime order
--     count with `join lateral (select count(*) ... where f.customer_id =
--     c.customer_id) lt on true` -- re-executed once per customer in the
--     [p_from,p_to]+channel scope. Replaced with a single GROUP BY pass
--     over v_fact_order (`lt`), joined once. Provably identical to the old
--     lateral for every row: the lateral had no WHERE beyond
--     `f.customer_id = c.customer_id and f.shop_id = p_shop_id`, always
--     returned exactly one row (count(*) never returns zero rows), so it
--     behaved as an inner join with a guaranteed match on `lt` -- exactly
--     what `join ... using (customer_id)` gives when every customer_id in
--     `c` is guaranteed present in `lt` (true here: `c` selects distinct
--     customer_id from the SAME view/shop with the SAME customer_id is not
--     null filter `lt` uses, just also date/channel-scoped -- a customer in
--     `c` has at least the one order that put them there, so they always
--     have >=1 lifetime order and always appear in `lt`).
--
-- Signature of dashboard_summary is UNCHANGED (uuid, date, date, text,
-- boolean) -- a bare `create or replace function`, not a drop+recreate --
-- so no risk of the overload trap (3j-migration-traps #1). EXECUTE grants
-- on functions do NOT survive `create or replace function` even when the
-- signature is unchanged (skill supabase-migrate gotcha #1 / 3j-migration-
-- traps #2) -- re-granted explicitly below, and this time also revoked from
-- `anon` (0054's original revoke only listed `public, authenticated` --
-- Supabase grants EXECUTE to `anon` separately from `public` by default, so
-- that revoke was incomplete; fixed here per the two migration skills).
--
-- v_marketing_reco is explicitly OUT of scope for this file (separate
-- ticket, ~425ms, has its own trade-off per architect) -- dashboard_summary
-- still reads it unchanged.
--
-- ⚠️ DO NOT APPLY -- file only. Tech Lead applies via MCP after running
-- scripts/verify-0107-0108.sql (which embeds this DDL and rolls back).

-- ============================================================================
-- (a) analytics.v_fact_order -- profit: correlated subquery -> LEFT JOIN
--     Column list, order, and every other expression copied verbatim from
--     0028_sku_cost_margin.sql (the migration that created this view's
--     current shape) -- ONLY the `profit` case expression's margin lookup
--     changes, and the new `ss` join added to the FROM clause.
-- ============================================================================

create or replace view analytics.v_fact_order
  with (security_invoker = true) as
select fo.id,
    fo.shop_id,
    fo.oms_order_id,
    fo.source_order_no,
    fo.customer_id,
    coalesce((ov.overrides ->> 'channel_id')::uuid, fo.channel_id) as channel_id,
    fo.campaign_id_first,
    fo.campaign_id_last,
    coalesce((ov.overrides ->> 'order_date')::date, fo.order_date) as order_date,
    fo.paid_at,
    fo.printed_at,
    fo.ship_date,
    fo.estimated_delivery_date,
    coalesce(ov.overrides ->> 'province_code', fo.province_code) as province_code,
    fo.carrier_code,
    fo.tracking_no,
    fo.item_count,
    coalesce((ov.overrides ->> 'revenue')::numeric(12,2), fo.revenue) as revenue,
    coalesce((ov.overrides ->> 'discount')::numeric(12,2), fo.discount) as discount,
    fo.shipping_fee_customer,
    fo.shipping_cost_shop,
    fo.cogs,
    case
      when fo.profit_status = 'estimated'::analytics.profit_status_t then
        round(coalesce((ov.overrides ->> 'revenue')::numeric(12,2), fo.revenue)
              * coalesce(ss.blended_margin_pct, 0.20), 2)::numeric(12,2)
      else fo.profit
    end as profit,
    fo.profit_status,
    fo.payment_method,
    coalesce(ov.overrides ->> 'bank', fo.bank) as bank,
    fo.is_new_customer,
    coalesce((select array_agg(t.value) from jsonb_array_elements_text(ov.overrides -> 'tags') t(value)), fo.tags) as tags,
    fo.created_at,
    fo.updated_at,
    ov.fact_order_id is not null as is_edited
   from analytics.fact_order fo
     left join analytics.crm_order_override ov on ov.fact_order_id = fo.id
     left join analytics.shop_setting ss on ss.shop_id = fo.shop_id;

-- Defensive/idempotent re-grant, same reasoning as 0107 -- bare
-- create-or-replace preserves grants, this is belt-and-suspenders scoped to
-- the one view touched, NOT a schema-wide grant.
grant select on analytics.v_fact_order to authenticated, service_role;

-- ============================================================================
-- (b) analytics.dashboard_summary -- repeat_rate: lateral -> GROUP BY + join
--     Everything else copied verbatim from
--     0054_dashboard_range_channel_filter.sql (the migration that created
--     this function's current signature/body).
-- ============================================================================

create or replace function analytics.dashboard_summary(
  p_shop_id uuid,
  p_from date,
  p_to date,
  p_channel text default null,
  p_include_money boolean default true
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
declare
  v_channel_id uuid;
  v_min_date date;
  v_max_date date;
  v_channels jsonb;
  v_scope jsonb;
  v_kpi jsonb := null;
  v_action jsonb;
  v_reco jsonb := '[]'::jsonb;
  v_rfm jsonb := '{}'::jsonb;
  v_channel jsonb := null;
begin
  v_channel_id := case when p_channel is null then null
                        else (select id from analytics.dim_channel where code = p_channel) end;

  -- scope: all-time min/max order_date + every channel this shop has ever
  -- sold on (NOT scoped to p_from/p_to/p_channel) -- feeds the filter UI
  -- (date-input bounds + channel chips) so chips never disappear just
  -- because the currently-selected window/channel has zero orders.
  select min(order_date), max(order_date) into v_min_date, v_max_date
  from analytics.v_fact_order where shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by name), '[]'::jsonb)
    into v_channels
  from ( select distinct dch.code, dch.name
         from analytics.v_fact_order v
         join analytics.dim_channel dch on dch.id = v.channel_id
         where v.shop_id = p_shop_id ) t;

  v_scope := jsonb_build_object(
    'min_order_date', to_char(v_min_date, 'YYYY-MM-DD'),
    'max_order_date', to_char(v_max_date, 'YYYY-MM-DD'),
    'channels', v_channels,
    'requested_from', to_char(p_from, 'YYYY-MM-DD'),
    'requested_to', to_char(p_to, 'YYYY-MM-DD'),
    'requested_channel', p_channel
  );

  -- action-needed (always shown, incl. staff; not scoped -- outstanding queue is realtime)
  select jsonb_build_object(
    'oversold', (select count(*) from analytics.v_oversold_hold_queue where shop_id = p_shop_id),
    'oversold_breached', (select count(*) from analytics.v_oversold_hold_queue where shop_id = p_shop_id and hours_held > 48),
    'low_stock', (select count(*) from analytics.v_hero_stock where shop_id = p_shop_id and (is_low or is_out))
  ) into v_action;

  if p_include_money then
    select jsonb_build_object(
      'revenue', coalesce(sum(revenue), 0),
      'orders', count(*),
      'profit', coalesce(sum(profit), 0),
      'aov', case when count(*) > 0 then round(sum(revenue) / count(*), 2) else 0 end,
      'customers', (select count(distinct customer_id) from analytics.v_fact_order
                    where shop_id = p_shop_id and order_date between p_from and p_to and customer_id is not null
                      and (v_channel_id is null or channel_id = v_channel_id)),
      -- Repeat Rate (0108 perf fix): base set = customers active in
      -- [p_from,p_to]+channel; `lt` still counts LIFETIME orders across ALL
      -- channels for this shop (unchanged from 0044/0054) -- repeat-buyer
      -- status is a lifetime property, not something that resets per
      -- channel/window. UI label must keep reading "ลูกค้าช่วงนี้ที่เป็น
      -- ขาประจำ", not "ซื้อซ้ำในช่วงนี้". See file header for the proof this
      -- join is equivalent to the lateral it replaces.
      'repeat_rate', (select case when count(*) > 0
                        then round(count(*) filter (where lt.cnt >= 2)::numeric / count(*), 4)
                        else 0 end
                      from (
                        select distinct customer_id from analytics.v_fact_order
                        where shop_id = p_shop_id and order_date between p_from and p_to and customer_id is not null
                          and (v_channel_id is null or channel_id = v_channel_id)
                      ) c
                      join (
                        select customer_id, count(*) cnt from analytics.v_fact_order
                        where shop_id = p_shop_id and customer_id is not null
                        group by customer_id
                      ) lt using (customer_id))
    ) into v_kpi
    from analytics.v_fact_order
    where shop_id = p_shop_id and order_date between p_from and p_to
      and (v_channel_id is null or channel_id = v_channel_id);

    -- reco/rfm/top_channel: unchanged, NOT scoped to [from,to]/channel -- all
    -- represent current/all-time state (reco rules, RFM segments as-of-today,
    -- this-month channel leaderboard), same as 0044/0039/0054.
    select coalesce(jsonb_agg(x order by pr), '[]'::jsonb) into v_reco from (
      select priority as pr,
        jsonb_build_object('title', title, 'severity', severity, 'rule_code', rule_code) as x
      from analytics.v_marketing_reco
      where shop_id = p_shop_id and is_blocked = false
      order by priority asc
      limit 2
    ) t;

    select coalesce(jsonb_object_agg(segment, c), '{}'::jsonb) into v_rfm from (
      select segment, count(*) as c from analytics.v_rfm_segment where shop_id = p_shop_id group by segment
    ) t;

    select to_jsonb(t) into v_channel from (
      select channel_name, revenue, roas
      from analytics.v_channel_perf_roas
      where shop_id = p_shop_id and month = date_trunc('month', current_date)::date
      order by revenue desc nulls last
      limit 1
    ) t;
  end if;

  return jsonb_build_object(
    'scope', v_scope,
    'kpi', v_kpi,
    'action', v_action,
    'reco', v_reco,
    'rfm', v_rfm,
    'top_channel', v_channel
  );
end;
$$;

-- Grants do NOT survive create-or-replace-function even with an unchanged
-- signature (skill supabase-migrate gotcha #1, 3j-migration-traps #2) --
-- re-grant is mandatory here, every time. Also closes a gap in 0054's
-- original revoke, which only listed `public, authenticated` -- Supabase
-- grants EXECUTE to `anon` separately from `public` by default, so `anon`
-- must be revoked explicitly too.
revoke execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) from public, anon, authenticated;
grant execute on function analytics.dashboard_summary(uuid, date, date, text, boolean) to service_role;

notify pgrst, 'reload schema';
