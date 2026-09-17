-- 0120_crm_retention.sql
--
-- ⚠️ APPLIED 14 ก.ย. 69 (version 20260914104229). หมายเลข 0120 ชนกับ
-- 0120_seed_content_calendar_202610.sql (version 20260916092640) เพราะสองงาน
-- เดินคู่กันคนละ branch แล้วอีกฝั่ง merge เข้า main ก่อน ไฟล์นี้ค้างนอก main
-- 3 วัน — ชื่อไฟล์ทั้งสองยังตรงกับชื่อใน migration history ของ DB เป๊ะ จึง
-- **ไม่เปลี่ยนเลข** (เปลี่ยนแล้วไฟล์จะไม่ตรงกับ DB ซึ่งเป็นกับดักที่แพงกว่า
-- ดู migrations-0107-0109-off-main) · ลำดับ apply จริง: ไฟล์นี้มาก่อน
-- 0120_seed_content_calendar_202610 สองวัน
--
-- CRM retention data layer — 2 views the owner asked for before 14 ก.ย. 69:
--   1. "recency ladder" — how many customers sit at each distance-since-
--      last-order bucket, crossed with reachability + product affinity.
--   2. "repeat-purchase cohort" — of customers newly acquired in week W on
--      channel C, what % came back within 7/14/30 days.
--
-- Design approved by Yoda (architect), 4 open questions answered by Tech
-- Lead (Obi-Wan) before this file was written — see PR/brief for the full
-- reasoning. Summary of the 5 decisions this file encodes:
--   1. Uses analytics.v_product_affinity (0099) as the ONLY source for
--      bar/jewelry classification — never re-derives the CASE WHEN here.
--   2. `reachable` is LIFETIME (bool_or across every order the customer has
--      ever placed, not just their latest channel) — labelled honestly as
--      "ordered through a contactable channel at some point", not a live
--      guarantee (block/unfriend isn't tracked).
--   3. Recency bucket top band is "91+" (not "90+"), with "≈" semantics —
--      never asserted as "= churned".
--   4. Shopee has 0 orders in this shop today (confirmed by query, not
--      assumed) — `is_contactable` defaults to false and Shopee is left at
--      that default rather than special-cased.
--   5. "2nd purchase" = the customer's first order dated strictly AFTER
--      their first order (gap_days > 0) — same definition Tech Lead already
--      used for the 6-day median reported to the owner, so this file's
--      repeat-rate numbers won't contradict that baseline.
--
-- 🔴 Dry-run bug (caught on a real DB, 14 ก.ย. 69, invisible to static
-- review): the `cust` CTE in Part D originally used `max(first_dt)` /
-- `max(first_channel_id)` to collapse `orders`' window-function output down
-- to one row per customer. `first_channel_id` is `uuid` — Postgres has NO
-- `max(uuid)`/`min(uuid)` aggregate (42883, raised at CALL time since this
-- is a plain SQL statement, not caught by CREATE FUNCTION's parse). Fixed by
-- grouping BY `first_dt`/`first_channel_id` instead of aggregating them —
-- they're already constant per customer_id partition (window function
-- output), so GROUP BY collapses the rows for free with no aggregate call
-- needed at all. General rule for next time: to collapse a column that's
-- already constant within a group, GROUP BY it — never wrap it in
-- max()/min(), which silently doesn't exist for uuid (and isn't guaranteed
-- to exist for every future column type either). Verified after the fix on
-- a real DB (rolled back): 49ms, as_of = 2026-09-14, immature weeks
-- correctly withhold a rate, baseline = 2,576 new customers / 29.9% repeat
-- within 30 days (line_oa 31.6% · tiktok 28.6% · facebook 20.0%).
--
-- ลำดับที่ทำจริง (แก้ 17 ก.ย. 69 — เดิมบรรทัดนี้เขียนว่า "DO NOT APPLY"
-- ซึ่งขัดกับหัวไฟล์บรรทัดบนที่บอกว่า apply แล้ว คนอ่านรอบหน้าจะตอบไม่ได้ว่า
-- ไฟล์นี้ลง DB หรือยัง = คำถามที่ทีมนี้เคยจ่ายแพงที่สุด ดู 0107-0109):
--   dry-run ด้วย scripts/verify-0120.sql (do-block + forced rollback)
--   → apply ผ่าน MCP apply_migration 14 ก.ย. 69
--   → บันทึกใน supabase_migrations.schema_migrations version 20260914104229
--     (ยืนยันด้วย list_migrations แล้ว 17 ก.ย. — ไม่ใช่ execute_sql ที่ไม่เขียนประวัติ)
--
-- ============================================================================
-- Part A — analytics.dim_channel.is_contactable
--
-- Which channels can realistically receive an outbound broadcast/DM from the
-- shop today: LINE OA (official broadcast) and Facebook (Messenger) — yes.
-- TikTok (no bulk-DM tooling the shop uses) and Shopee (checked: 0 orders in
-- this shop, so this flag has never been exercised for it) — no, left at the
-- column default. A new channel added later starts false until someone
-- explicitly flips it, which is the safe direction to fail in (never claim
-- reachability we haven't verified).
-- ============================================================================

alter table analytics.dim_channel
  add column if not exists is_contactable boolean not null default false;

update analytics.dim_channel
   set is_contactable = true
 where code in ('line_oa', 'facebook');

-- ============================================================================
-- Part B — analytics.v_audience: append `reachable` + `recency_bucket`
--
-- 🔴 Column list below (everything up to jewelry_order_count) is copied
-- BYTE-FOR-BYTE from 0099_customer_product_affinity.sql's v_audience block —
-- that is the latest migration to touch this view (0100 only touched
-- v_customer_affinity, confirmed by grep). Per skill 3j-migration-traps #3,
-- `create or replace view` may only APPEND columns — Tech Lead must diff
-- this SELECT list against `information_schema.columns` for the live view
-- before applying; a mismatch anywhere in the first 20 columns means this
-- file drifted from the real current view and must NOT be applied as-is.
--
-- `reach` is a pre-aggregated CTE (one row per customer_id), joined with a
-- plain LEFT JOIN — NOT a correlated subquery evaluated per output row. This
-- is the exact perf lesson 0107 already paid for on this same view's
-- cust_province CTE (a per-customer LATERAL cost 18,376 buffers before it
-- was folded into a single aggregate pass) — `reach` follows cust_province's
-- own pattern (pre-aggregate, not lateral) rather than repeating that bug.
-- ============================================================================

create or replace view analytics.v_audience
  with (security_invoker = true) as
with cust_province as (
  select distinct on (v.customer_id)
    v.customer_id,
    v.province_code
  from analytics.v_fact_order v
  where v.customer_id is not null
  order by v.customer_id, v.order_date desc, v.id desc
),
reach as (
  -- Lifetime reachability: TRUE if the customer has EVER placed an order on
  -- a channel we can currently contact them through (line_oa/facebook),
  -- even if their most recent order was via a non-contactable channel
  -- (e.g. they first ordered via LINE OA, later switched to TikTok — still
  -- a LINE OA friend today). Deliberately NOT scoped to "most recent
  -- channel" — that's `channel_code` a few columns up, a different concept.
  select
    fo.customer_id,
    bool_or(dch.is_contactable) as reachable
  from analytics.v_fact_order fo
  join analytics.dim_channel dch on dch.id = fo.channel_id
  where fo.customer_id is not null
  group by fo.customer_id
)
select
  cm.shop_id,
  cm.customer_id,
  cm.display_name,
  rfm.segment,
  cm.order_count,
  cm.revenue_sum,
  rfm.recency_days,
  cm.first_order_at,
  cm.last_order_at,
  dch.code as channel_code,
  dch.name as channel_name,
  cp.province_code,
  g.province_name_th,
  coalesce(ca.bought_bar, false) as bought_bar,
  coalesce(ca.bought_jewelry, false) as bought_jewelry,
  coalesce(ca.bar_revenue, 0)::numeric(14, 2) as bar_revenue,
  coalesce(ca.jewelry_revenue, 0)::numeric(14, 2) as jewelry_revenue,
  coalesce(ca.affinity, 'unknown') as affinity,
  coalesce(ca.bar_order_count, 0)::int as bar_order_count,
  coalesce(ca.jewelry_order_count, 0)::int as jewelry_order_count,
  -- ---- 0120 additions below (append-only) --------------------------------
  -- "เคยสั่งผ่านช่องทางที่ติดต่อได้" — NOT "ติดต่อได้แน่นอนวันนี้" (block/
  -- unfriend ไม่มีข้อมูล) — ป้ายต้องซื่อสัตย์ต่อสิ่งที่วัดได้จริงเท่านั้น
  coalesce(rc.reachable, false) as reachable,
  -- "91+" (ไม่ใช่ "90+") และเป็น "≈" ไม่ใช่ "= เสี่ยงหาย" — ตัวเลขจริงต้องมา
  -- จากรอบข้างจอ ไม่ใช่ view นี้ตัดสินแทน
  case
    when rfm.recency_days is null then null
    when rfm.recency_days <= 7 then '0-7'
    when rfm.recency_days <= 14 then '8-14'
    when rfm.recency_days <= 30 then '15-30'
    when rfm.recency_days <= 60 then '31-60'
    when rfm.recency_days <= 90 then '61-90'
    else '91+'
  end as recency_bucket
from analytics.v_customer_master cm
join analytics.v_rfm_segment rfm on rfm.customer_id = cm.customer_id
left join analytics.dim_channel dch on dch.id = cm.first_touch_channel_id
left join cust_province cp on cp.customer_id = cm.customer_id
left join analytics.dim_geo g on g.province_code = cp.province_code
left join analytics.v_customer_affinity ca on ca.customer_id = cm.customer_id and ca.shop_id = cm.shop_id
left join reach rc on rc.customer_id = cm.customer_id;

-- Scoped grant — NOT `grant select on all tables in schema analytics` (skill
-- 3j-migration-traps #7: that blanket form has re-exposed cost/PII tables
-- twice in this repo's history already). Defensive/idempotent: a bare
-- `create or replace view` preserves existing relation grants in Postgres
-- (0107's own confirmed note), so this line is a no-op in practice today —
-- kept explicit so this migration is self-sufficient if ever replayed
-- against a DB state where it isn't.
--
-- 🔴 17 ก.ย. 69 (security review): `authenticated` ตรงนี้คือสิ่งที่
-- 0123_analytics_no_rest_for_users ปิดไปแล้ว (16 ก.ย.) และ v_audience ถือ
-- PII (display_name) + THB (revenue_sum/bar_revenue/jewelry_revenue)
-- **ของจริงบน production ไม่รั่ว** — ตรวจ 17 ก.ย. แล้วได้
-- has_table_privilege('authenticated','analytics.v_audience','select') = false
-- และ has_schema_privilege('authenticated','analytics','usage') = false
-- เพราะ 0123 ลงหลังไฟล์นี้ 2 วัน
-- ความเสี่ยงที่เหลือคือ **replay**: rebuild staging/`db reset` จะรันบรรทัดนี้
-- อีกครั้ง ⇒ ปิดด้วย 0130_v_audience_revoke_authenticated.sql ที่ต่อท้าย
-- ลำดับ migration (ไม่แก้บรรทัดนี้ เพราะไฟล์ที่ apply แล้วต้องตรงกับสิ่งที่
-- รันจริง — ดู skill supabase-migrate "never rewrite applied history")
grant select on analytics.v_audience to authenticated, service_role;

-- ============================================================================
-- Part C — analytics.crm_recency_ladder(p_shop_id, p_include_money)
--
-- One row per (recency_bucket, reachable, affinity) combination that
-- actually occurs among customers with order_count > 0. No zero-fill here
-- (unlike Part D's weeks) — an empty combination simply doesn't appear,
-- which is fine for a ladder (the UI sums what's there; it isn't a
-- week-over-week timeseries that needs a continuous x-axis).
--
-- `as_of` = today (Thai business date) — when this ladder was computed.
-- `max_order_date` = freshest order date in the underlying data — a
-- SEPARATE, honest signal of import lag (Shipnity imports trail "today" by
-- design — skill 3j-migration-traps #6). recency_days itself (v_rfm_segment,
-- 0055) is `now() - last_order_at`, i.e. genuinely wall-clock, which is
-- correct for "how long has this customer been silent" — so as_of does NOT
-- need to be clamped to max_order_date the way Part D's cohort maturity
-- does; the two dates are reported side by side so the UI/owner can see
-- both truths (recency is real-time, the data underneath it is not).
-- ============================================================================

create or replace function analytics.crm_recency_ladder(
  p_shop_id uuid,
  p_include_money boolean default true
)
 returns jsonb
 language sql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
  with base as (
    select
      customer_id,
      revenue_sum,
      recency_bucket,
      reachable,
      affinity,
      last_order_at
    from analytics.v_audience
    where shop_id = p_shop_id and order_count > 0
  ),
  cells as (
    select
      recency_bucket as bucket,
      reachable,
      affinity,
      count(*) as customers,
      sum(revenue_sum) as revenue_sum
    from base
    group by recency_bucket, reachable, affinity
  )
  select jsonb_build_object(
    'as_of', (now() at time zone 'Asia/Bangkok')::date,
    'max_order_date', (select max(last_order_at) from base),
    'customers_total', (select count(*) from base),
    'cells', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bucket', bucket,
          'reachable', reachable,
          'affinity', affinity,
          'customers', customers,
          'revenue', case when p_include_money then revenue_sum end
        )
        order by bucket, reachable, affinity
      )
      from cells
    ), '[]'::jsonb)
  );
$$;

revoke execute on function analytics.crm_recency_ladder(uuid, boolean) from public, anon, authenticated;
grant  execute on function analytics.crm_recency_ladder(uuid, boolean) to service_role;

-- ============================================================================
-- Part D — analytics.crm_repeat_cohort(p_shop_id, p_weeks default 26)
--
-- No money anywhere in this function — pure counts/rates.
--
-- Single window-function pass over analytics.v_fact_order (`orders` CTE
-- below) resolves each customer's first order date + first order's channel
-- in the same scan that later computes their 7/14/30-day repeat flags — no
-- second per-customer subquery/lateral (same discipline as Part B's `reach`
-- and the 0107 lesson it's copying).
--
-- "2nd purchase" = an order dated strictly AFTER the customer's first order
-- (`order_date > first_dt`) — same gap_days > 0 definition Tech Lead already
-- reported to the owner as the 6-day median baseline, so this repeat-rate
-- number is comparable to that, not a silently different definition.
--
-- 🔴 as_of = max(order_date) for THIS shop, never current_date — Shipnity
-- imports trail real time, so a cohort week that's actually too recent to
-- have had a chance to repeat would show a false 0% if "today" were used
-- (skill 3j-migration-traps #6, plus this project's own import-lag history).
-- A (week, N) cell is "mature" — i.e. its rate is trustworthy — only once
-- every customer in that week has had at least N days to repeat: the
-- worst case is a customer acquired on the LAST day of that week
-- (week_start + 6), so maturity requires `week_start + 6 + N <= as_of`.
-- Immature cells return rate = null, never 0 or any other number — the RPC
-- itself enforces this, not a UI convention that could be forgotten.
--
-- baseline pools ONLY cohort weeks mature for the STRICTEST window (30
-- days) — a week mature for 30 days is, by construction, always mature for
-- 14 and 7 too (mature_30 ⇒ mature_14 ⇒ mature_7), so this gives w7/w14/w30
-- baseline rates an IDENTICAL denominator (new_n), making the three numbers
-- comparable to each other. This specific pooling rule was not spelled out
-- in the brief (it only said "pooled from cohorts mature across all
-- history") — flagged to Tech Lead as the gap-filling call made here, not
-- guessed silently: the alternative (each window pools its own
-- independently-mature set) would let w7's baseline include more recent,
-- possibly-different-mix cohorts than w30's, undermining "baseline" as a
-- single comparable number. baseline is NEVER filtered by p_weeks — it
-- pools all of history, per the brief.
-- ============================================================================

create or replace function analytics.crm_repeat_cohort(
  p_shop_id uuid,
  p_weeks int default 26
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
declare
  v_as_of date;
  v_excluded int;
  v_week_end date;
  v_week_start_floor date;
  v_result jsonb;
begin
  if p_weeks is null or not (p_weeks between 1 and 104) then
    raise exception 'p_weeks must be between 1 and 104, got %', p_weeks;
  end if;

  select max(order_date) into v_as_of
  from analytics.v_fact_order
  where shop_id = p_shop_id;

  select count(*) into v_excluded
  from analytics.v_fact_order
  where shop_id = p_shop_id and customer_id is null;

  -- No orders at all for this shop yet: nothing to cohort. Short-circuits
  -- before any window function runs (the main query below would also
  -- degrade to empty results even without this guard, since
  -- generate_series/date_trunc on a null bound return no rows — but this
  -- branch is explicit and cheap, not relying on that implicit behaviour).
  if v_as_of is null then
    return jsonb_build_object(
      'as_of', null,
      'excluded_orders_no_customer', coalesce(v_excluded, 0),
      'weeks', '[]'::jsonb,
      'baseline', '[]'::jsonb
    );
  end if;

  v_week_end := date_trunc('week', v_as_of)::date;
  v_week_start_floor := v_week_end - ((p_weeks - 1) * 7);

  with orders as (
    select
      fo.customer_id,
      fo.order_date,
      fo.channel_id,
      first_value(fo.order_date) over w as first_dt,
      first_value(fo.channel_id) over w as first_channel_id
    from analytics.v_fact_order fo
    where fo.shop_id = p_shop_id and fo.customer_id is not null
    window w as (partition by fo.customer_id order by fo.order_date, fo.id)
  ),
  cust as (
    -- first_dt/first_channel_id are constant per customer_id partition
    -- already (window function output), so they're grouped, NOT aggregated
    -- with max()/min() — first_channel_id is uuid, and Postgres has no
    -- max(uuid)/min(uuid) (42883 at call time, not at CREATE FUNCTION time,
    -- since this is a plain SQL statement, not a static type error — caught
    -- by dry-run 14 ก.ย. 69, invisible to static review). The general rule:
    -- to collapse a value that's already constant per group, GROUP BY it,
    -- never aggregate it — max()/min() only work on orderable types anyway
    -- and silently exclude uuid.
    select
      customer_id, first_dt, first_channel_id,
      bool_or(order_date > first_dt and order_date <= first_dt + 7)  as repeat_7,
      bool_or(order_date > first_dt and order_date <= first_dt + 14) as repeat_14,
      bool_or(order_date > first_dt and order_date <= first_dt + 30) as repeat_30
    from orders
    group by customer_id, first_dt, first_channel_id
  ),
  cohort_base as (
    select
      date_trunc('week', c.first_dt)::date as week_start,
      coalesce(dch.code, 'unknown') as channel_code,
      c.repeat_7, c.repeat_14, c.repeat_30
    from cust c
    left join analytics.dim_channel dch on dch.id = c.first_channel_id
  ),
  agg as (
    -- Single aggregation pass computing BOTH the per-channel rows and the
    -- 'all' rollup via grouping sets, rather than two separate group-bys.
    select
      week_start,
      case when grouping(channel_code) = 1 then 'all' else channel_code end as channel_code,
      count(*) as new_n,
      count(*) filter (where repeat_7)  as n7,
      count(*) filter (where repeat_14) as n14,
      count(*) filter (where repeat_30) as n30
    from cohort_base
    group by grouping sets ((week_start, channel_code), (week_start))
  ),
  weeks_range as (
    select gs::date as week_start
    from generate_series(v_week_start_floor::timestamp, v_week_end::timestamp, interval '7 days') as gs
  ),
  channels_grid as (
    -- Only channels that have EVER acquired a new customer for this shop
    -- (plus the literal 'all' rollup) — not every code in dim_channel, so a
    -- channel with zero history (e.g. this shop's Shopee) doesn't appear as
    -- a row of all-zero weeks that implies it was tried and failed.
    select distinct channel_code from cohort_base
    union
    select 'all'
  ),
  weeks_grid as (
    select wr.week_start, cg.channel_code
    from weeks_range wr cross join channels_grid cg
  ),
  weeks_out as (
    select
      wg.week_start,
      wg.channel_code,
      coalesce(a.new_n, 0) as new_n,
      coalesce(a.n7, 0)  as n7,
      coalesce(a.n14, 0) as n14,
      coalesce(a.n30, 0) as n30,
      (wg.week_start + 6 + 7  <= v_as_of) as mature_7,
      (wg.week_start + 6 + 14 <= v_as_of) as mature_14,
      (wg.week_start + 6 + 30 <= v_as_of) as mature_30
    from weeks_grid wg
    left join agg a on a.week_start = wg.week_start and a.channel_code = wg.channel_code
  ),
  baseline_pool as (
    select *
    from agg
    where week_start + 6 + 30 <= v_as_of
  ),
  baseline_out as (
    select
      channel_code,
      sum(new_n) as new_n,
      sum(n7)  as n7,
      sum(n14) as n14,
      sum(n30) as n30
    from baseline_pool
    group by channel_code
  )
  select jsonb_build_object(
    'as_of', v_as_of,
    'excluded_orders_no_customer', coalesce(v_excluded, 0),
    'weeks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'week_start', week_start,
          'channel_code', channel_code,
          'new_n', new_n,
          'w7', jsonb_build_object(
            'n', n7,
            'rate', case when mature_7 and new_n > 0 then round(n7::numeric / new_n, 4) else null end,
            'mature', mature_7
          ),
          'w14', jsonb_build_object(
            'n', n14,
            'rate', case when mature_14 and new_n > 0 then round(n14::numeric / new_n, 4) else null end,
            'mature', mature_14
          ),
          'w30', jsonb_build_object(
            'n', n30,
            'rate', case when mature_30 and new_n > 0 then round(n30::numeric / new_n, 4) else null end,
            'mature', mature_30
          )
        )
        order by week_start, channel_code
      )
      from weeks_out
    ), '[]'::jsonb),
    'baseline', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'channel_code', channel_code,
          'new_n', new_n,
          'w7', jsonb_build_object('n', n7, 'rate', case when new_n > 0 then round(n7::numeric / new_n, 4) else null end),
          'w14', jsonb_build_object('n', n14, 'rate', case when new_n > 0 then round(n14::numeric / new_n, 4) else null end),
          'w30', jsonb_build_object('n', n30, 'rate', case when new_n > 0 then round(n30::numeric / new_n, 4) else null end)
        )
        order by channel_code
      )
      from baseline_out
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function analytics.crm_repeat_cohort(uuid, int) from public, anon, authenticated;
grant  execute on function analytics.crm_repeat_cohort(uuid, int) to service_role;

notify pgrst, 'reload schema';
