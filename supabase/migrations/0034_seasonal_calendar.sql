-- ⚠️ DO NOT APPLY — file only, Tech Lead applies via MCP.
-- 0034_seasonal_calendar.sql
-- Seasonal calendar reco (mega_sale / festival / gift_occasion) feeding into
-- the existing marketing recommendation feed, per architect design §5 + §2:
--   docs/3j-jewelry/analytics/phase-b3-design.md
--
-- Scope of this file:
--   1. analytics.campaign_calendar — global reference table (no shop_id, same
--      tier-1 shape as dim_channel/dim_date/dim_geo in 0012) holding recurring
--      or one-off seasonal events. SEED here is a placeholder only (see §2
--      below) — Tech Lead replaces with CMO's full list before apply.
--   2. analytics.v_mkt_reco_seasonal — computes the next occurrence of each
--      active event and emits a reco row while it's within that event's
--      lead_days window.
--   3. analytics.v_marketing_reco — re-created (0027 is the only prior
--      definition; 0028-0033 do not touch it) as the exact same rule set
--      (r0-r6) plus `union all select * from analytics.v_mkt_reco_seasonal`.
--      Column shape (9 cols: shop_id, reco_key, rule_code, severity,
--      priority, title, detail, is_blocked, blocked_reason) is preserved.
--
-- ⚠️ DO NOT APPLY — file only, Tech Lead applies via MCP.

-- ============================================================================
-- 1. analytics.campaign_calendar — tier-1 global reference table (design §5).
--    No shop_id: seasonal events are the same across every shop, same
--    reasoning as dim_channel/dim_date/dim_geo in 0012.
--
--    recur_day is capped at 28 (not 31) deliberately — this column feeds
--    make_date(year, recur_month, recur_day) in the view below; capping at 28
--    guarantees make_date() never raises "date out of range" regardless of
--    month or leap year, at the cost of not being able to encode a "31st of
--    the month" event. No such event is in the initial seed, and if one is
--    ever needed, model it as event_type/specific_date rows per year instead
--    of a recur_day > 28.
-- ============================================================================

create table analytics.campaign_calendar (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_th text not null,
  event_type text not null check (event_type in ('mega_sale', 'festival', 'gift_occasion')),
  recur_month int check (recur_month between 1 and 12),
  recur_day int check (recur_day between 1 and 28),
  specific_date date,
  duration_days int not null default 1 check (duration_days >= 1),
  lead_days int not null default 21 check (lead_days >= 0),
  prep_note_th text,
  is_active boolean not null default true,
  -- Every row is either a recurring event (both recur_month AND recur_day
  -- set) or a one-off event (specific_date set) — never neither.
  constraint chk_campaign_calendar_has_date check (
    (recur_month is not null and recur_day is not null) or specific_date is not null
  )
);

alter table analytics.campaign_calendar enable row level security;

-- Tier-1 pattern from 0012 (dim_channel/dim_date/dim_geo) — global reference
-- data, readable by any authenticated (or service_role) caller, writes are
-- service-role only (no insert/update/delete policy for `authenticated`).
create policy read_all on analytics.campaign_calendar
  for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Seed = CMO's curated list (11 events: 5 mega / 2 festival / 4 gift occasion).
-- Deliberately excludes small double-days (2.2/3.3/…/8.8) — noise for a shop
-- this size. prep_note_th carries the brand-specific play + CFO/COO gates.
-- The calendar is a TABLE (not hardcode) precisely so this list can be edited
-- later without re-shipping a view.
insert into analytics.campaign_calendar
  (code, name_th, event_type, recur_month, recur_day, specific_date, duration_days, lead_days, prep_note_th)
values
  -- mega sale (lead 30d — OEM stock + follower build-up)
  ('mega_9_9', '9.9 Mega Sale', 'mega_sale', 9, 9, null, 1, 30,
    'เลือก hero SKU เครื่องประดับ margin หนา 3-5 ตัว สั่ง OEM ล่วงหน้า · teaser LINE VIP (champion+loyal) ก่อน 7 วัน · เงินแท่งห้ามลดราคา ใช้ส่งฟรี/ของแถมแทน · ส่วนลด flash ให้ CFO เคาะ margin ก่อน'),
  ('mega_10_10', '10.10 Mega Sale', 'mega_sale', 10, 10, null, 1, 30,
    'ใช้ข้อมูล 9.9 คัด SKU ที่ live viewer→order สูงสุดมาดันซ้ำ · จัด live ถี่ขึ้นสัปดาห์ก่อนงาน · เก็บลูกค้าใหม่จาก 9.9 เข้า LINE ก่อนถึงงาน'),
  ('mega_11_11', '11.11 (ใหญ่สุดของปี)', 'mega_sale', 11, 11, null, 1, 30,
    'ดีลใหญ่สุดของปี สต็อก OEM ต้องพร้อม 2 สัปดาห์ก่อน · เปิด waiting list ผ่าน LINE · bundle เครื่องประดับ (ลดตาม CFO) แยกจากเงินแท่ง (buy-back/NFC เท่านั้น)'),
  ('mega_12_12', '12.12 + ของขวัญปีใหม่', 'mega_sale', 12, 12, null, 1, 30,
    'จับ 2 กระแส: gift set พร้อมกล่องของขวัญ + คอนเทนต์ "โบนัสออกแล้ว เริ่มเก็บเงินแท่ง 999" (มุมลงทุน ไม่ลดราคา) · สต็อกกล่อง/ริบบิ้นต้องถึงก่อนงาน'),
  ('mega_6_6', '6.6 Mid-Year', 'mega_sale', 6, 6, null, 1, 30,
    'mega กลางปีตัวเดียวที่คุ้ม ใช้เคลียร์ SKU หมุนช้าจาก Q1 (ราคาลดให้ CFO เคาะ) · ทดสอบ SKU ใหม่ก่อนฤดู Q4'),
  -- festival
  ('chinese_new_year', 'ตรุษจีน', 'festival', null, null, date '2027-02-06', 3, 21,
    'เงินแท่ง 999 = แต๊ะเอียที่เก็บมูลค่าได้ + NFC สแกนดูแท่งจริง ห้ามลดราคา ขายมุม buy-back · เครื่องประดับดันจี้มงคล/ปี่เซียะ · live ธีมมงคลล่วงหน้า 2 สัปดาห์ · (จันทรคติ — ต้อง seed รายปี ถัดไป 2028-01-26)'),
  ('songkran', 'สงกรานต์', 'festival', 4, 13, null, 3, 21,
    'ของขวัญรดน้ำผู้ใหญ่ ชุดกำไล/สร้อยเงิน 925 ธีมมงคล ขายผ่าน LINE · แจ้ง COO: หยุดยาวขนส่ง ประกาศ cutoff สั่งซื้อชัดเจน กันรีวิวลบส่งช้า'),
  -- gift occasion (lead 21d — สลัก/OEM ใช้เวลา)
  ('valentine', 'วาเลนไทน์', 'gift_occasion', 2, 14, null, 1, 21,
    'โอกาสทองอันดับ 1 ของจิวเวลรี่ จี้คู่/แหวนคู่สลักชื่อ (เปิด pre-order LINE ล่วงหน้า 2 สัปดาห์ ปิดรับก่อนวันงาน 5 วัน) · target แอดกลุ่มผู้ชายซื้อให้แฟน'),
  ('mothers_day', 'วันแม่', 'gift_occasion', 8, 12, null, 1, 21,
    'ชุดมงคล/กำไลเงิน 925 "ใส่ได้ทุกวัน ไม่แพ้" สำหรับแม่ผิวแพ้ง่าย จุดที่เงินแท้ชนะแฟชั่นชุบ · ดันผ่าน LINE + gift box พร้อมการ์ด'),
  ('fathers_day', 'วันพ่อ', 'gift_occasion', 12, 5, null, 1, 21,
    'สร้อย/กำไลเงินผู้ชายเส้นหนา (craftsmanship 30+ ปี) หรือเงินแท่งเป็นของขวัญมีมูลค่าจริง · ระวังชน lead 12.12 รวม content plan เดียวกัน'),
  ('new_year_gift', 'เทศกาลของขวัญปีใหม่', 'gift_occasion', 12, 20, null, 12, 21,
    'gift set หลายช่วงราคา (฿500/฿1,000/฿2,000) · คอนเทนต์ "ปีใหม่เริ่มออมเงินแท่ง" DCA angle ไม่ลดราคา · เช็ค cutoff ส่งก่อนปีใหม่กับ COO')
on conflict (code) do nothing;

-- ============================================================================
-- 2. v_mkt_reco_seasonal (design §2) — next-occurrence calc per active event,
--    emitted while inside that event's lead_days window.
--
--    Next occurrence: specific_date used as-is if set (one-off event — if
--    it's already in the past, the outer `between 0 and lead_days` filter
--    drops it naturally, since a negative day-diff never satisfies
--    `between 0 and lead_days`). Otherwise the earlier of this year's and
--    next year's make_date(recur_month, recur_day) that is >= current_date —
--    this year's occurrence is used if it hasn't passed yet, else next
--    year's (which is always still in the future).
-- ============================================================================

create or replace view analytics.v_mkt_reco_seasonal
  with (security_invoker = true) as
with upcoming as (
  select
    cc.code,
    cc.name_th,
    cc.event_type,
    cc.duration_days,
    cc.lead_days,
    cc.prep_note_th,
    -- CASE (not coalesce) so make_date() is NEVER reached for a specific_date
    -- row (whose recur_month/recur_day are null) — the recurring branches only
    -- run when specific_date is null, which the check constraint guarantees
    -- means recur_month/recur_day are both set.
    case
      when cc.specific_date is not null then cc.specific_date
      when make_date(extract(year from current_date)::int, cc.recur_month, cc.recur_day) >= current_date
        then make_date(extract(year from current_date)::int, cc.recur_month, cc.recur_day)
      else make_date(extract(year from current_date)::int + 1, cc.recur_month, cc.recur_day)
    end as event_date
  from analytics.campaign_calendar cc
  where cc.is_active
)
select
  s.id as shop_id,
  'seasonal_calendar:' || u.code || ':' || to_char(u.event_date, 'YYYY') as reco_key,
  'seasonal_calendar' as rule_code,
  case when (u.event_date - current_date) <= 7 then 'high' else 'medium' end as severity,
  case when (u.event_date - current_date) <= 7 then 1 else 2 end as priority,
  'อีก ' || (u.event_date - current_date) || ' วันถึง ' || u.name_th ||
    ' (' || to_char(u.event_date, 'DD Mon') || ') — เตรียมสต็อก/แคมเปญ' as title,
  jsonb_build_object(
    'event_code', u.code,
    'name', u.name_th,
    'type', u.event_type,
    'date', u.event_date,
    'days_until', (u.event_date - current_date),
    'duration_days', u.duration_days,
    'prep_note', u.prep_note_th
  ) as detail,
  false as is_blocked,
  null::text as blocked_reason
from upcoming u
cross join public.shop s
where (u.event_date - current_date) between 0 and u.lead_days;

-- ============================================================================
-- 3. v_marketing_reco — re-created with the seasonal branch unioned in.
--    Everything below down to r6 is copied verbatim from 0027 (the only prior
--    definition of this view) — see that file for rule-by-rule rationale.
-- ============================================================================

create or replace view analytics.v_marketing_reco
  with (security_invoker = true) as
with province_stats as (
  -- last-60-days province performance, TH-XX (unknown) excluded — an unknown
  -- province is never a valid geo-targeting recommendation.
  select
    v.shop_id,
    v.province_code,
    count(*) as orders,
    sum(v.revenue) as revenue,
    round(sum(v.revenue) / count(*), 2) as aov
  from analytics.v_fact_order v
  where v.order_date >= current_date - interval '60 days'
    and v.province_code <> 'TH-XX'
  group by v.shop_id, v.province_code
),
province_median as (
  select shop_id, percentile_cont(0.5) within group (order by aov) as median_aov
  from province_stats
  group by shop_id
),
channel_roas_latest as (
  select
    r.*,
    row_number() over (partition by r.shop_id, r.channel_code order by r.month desc) as rn
  from analytics.v_channel_perf_roas r
  where r.spend is not null
),
geo_top as (
  select
    v.shop_id,
    v.channel_id,
    v.province_code,
    count(*) as orders,
    sum(v.revenue) as revenue,
    round(sum(v.revenue) / count(*), 2) as aov,
    row_number() over (partition by v.shop_id, v.channel_id order by count(*) desc) as rn
  from analytics.v_fact_order v
  where v.province_code <> 'TH-XX'
  group by v.shop_id, v.channel_id, v.province_code
),
geo_agg as (
  select
    gt.shop_id,
    gt.channel_id,
    jsonb_agg(
      jsonb_build_object(
        'province_code', gt.province_code,
        'province_name', coalesce(g.province_name_th, gt.province_code),
        'orders', gt.orders,
        'revenue', gt.revenue,
        'aov', gt.aov
      )
      order by gt.orders desc
    ) as top_provinces
  from geo_top gt
  left join analytics.dim_geo g on g.province_code = gt.province_code
  where gt.rn <= 5
  group by gt.shop_id, gt.channel_id
),
segment_counts as (
  -- distinct customers per (shop, channel, segment) — LEFT JOIN so a customer
  -- with no RFM row yet (e.g. edge-case transform gap) still counts as
  -- 'unknown' rather than silently dropping out of the mix.
  select
    fo.shop_id,
    fo.channel_id,
    coalesce(rfm.segment, 'unknown') as segment,
    count(distinct fo.customer_id) as customers
  from analytics.v_fact_order fo
  left join analytics.v_rfm_segment rfm on rfm.customer_id = fo.customer_id
  where fo.customer_id is not null
  group by fo.shop_id, fo.channel_id, coalesce(rfm.segment, 'unknown')
),
segment_agg as (
  select shop_id, channel_id, jsonb_object_agg(segment, customers) as segment_mix
  from segment_counts
  group by shop_id, channel_id
),
time_agg as (
  select
    v.shop_id,
    v.channel_id,
    jsonb_agg(jsonb_build_object('hour', hr, 'orders', orders) order by orders desc) as hourly_orders
  from (
    select
      shop_id, channel_id,
      extract(hour from paid_at)::int as hr,
      count(*) as orders
    from analytics.v_fact_order
    where paid_at is not null
    group by shop_id, channel_id, extract(hour from paid_at)
  ) v
  group by v.shop_id, v.channel_id
),
r0 as (
  select
    s.id as shop_id,
    'spend_missing:' || to_char(current_date, 'YYYY-MM') as reco_key,
    'spend_missing' as rule_code,
    'blocker' as severity,
    0 as priority,
    'กรอกค่าแอดก่อน — ROAS ทุกใบข้างล่างรอข้อมูลนี้' as title,
    jsonb_build_object('checked_at', current_date, 'window_days', 14) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from public.shop s
  where not exists (
    select 1 from analytics.fact_ad_spend fa
    where fa.shop_id = s.id and fa.spend_date >= current_date - interval '14 days'
  )
),
r1 as (
  select
    rfm.shop_id,
    'winback_at_risk:' || to_char(current_date, 'YYYY-MM') as reco_key,
    'winback_at_risk' as rule_code,
    'high' as severity,
    1 as priority,
    'ลูกค้าเสี่ยงหาย ' || count(*) || ' คน — ส่ง win-back broadcast ทาง LINE (AOV LINE สูงกว่าช่องอื่นราว 3 เท่า)' as title,
    jsonb_build_object('at_risk_count', count(*), 'segment', 'at_risk') as detail,
    false as is_blocked,
    null::text as blocked_reason
  from analytics.v_rfm_segment rfm
  where rfm.segment = 'at_risk'
  group by rfm.shop_id
  having count(*) >= 20
),
r2 as (
  select
    ps.shop_id,
    'geo_focus:' || ps.province_code || ':' || to_char(current_date, 'YYYY-MM') as reco_key,
    'geo_focus' as rule_code,
    'medium' as severity,
    2 as priority,
    'จังหวัด ' || coalesce(g.province_name_th, ps.province_code) || ' AOV สูงกว่าค่ากลาง ' ||
      round((ps.aov / nullif(pm.median_aov, 0))::numeric, 1) || ' เท่า — เพิ่ม geo-bid จังหวัดนี้' as title,
    jsonb_build_object(
      'province_code', ps.province_code,
      'province_name', g.province_name_th,
      'orders_60d', ps.orders,
      'aov', ps.aov,
      'median_aov', pm.median_aov
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from province_stats ps
  join province_median pm on pm.shop_id = ps.shop_id
  left join analytics.dim_geo g on g.province_code = ps.province_code
  where ps.orders >= 5 and pm.median_aov > 0 and ps.aov >= 1.5 * pm.median_aov
),
r3 as (
  select
    l.shop_id,
    'cac_vs_aov:' || l.channel_code || ':' || to_char(l.month, 'YYYY-MM') as reco_key,
    'cac_vs_aov' as rule_code,
    'medium' as severity,
    2 as priority,
    'ช่องทาง ' || l.channel_name || ' จ่ายแพงกว่าที่ลูกค้าซื้อ (CAC ' || l.cac || ' > AOV ' || l.aov || ') — ทบทวนงบ' as title,
    jsonb_build_object(
      'channel_code', l.channel_code, 'month', l.month,
      'cac', l.cac, 'aov', l.aov, 'spend', l.spend
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from channel_roas_latest l
  where l.rn = 1 and l.cac is not null and l.aov is not null and l.cac > l.aov
),
r4_blocked as (
  -- roas_drop needs >=2 months of spend to compare MoM (design §4 R4). Emit a
  -- blocked card only for shops that HAVE started entering spend (so it's not
  -- noise before R0 is even resolved), but don't have 2 distinct months yet.
  select
    fa.shop_id,
    'roas_drop:blocked' as reco_key,
    'roas_drop' as rule_code,
    'info' as severity,
    3 as priority,
    'ตรวจจับ ROAS ตก (MoM) — ยังใช้งานไม่ได้' as title,
    jsonb_build_object('spend_months_available', count(distinct date_trunc('month', fa.spend_date))) as detail,
    true as is_blocked,
    'ต้องมีค่าแอดสะสมอย่างน้อย 2 เดือนถึงจะเทียบ ROAS เดือนต่อเดือนได้' as blocked_reason
  from analytics.fact_ad_spend fa
  group by fa.shop_id
  having count(distinct date_trunc('month', fa.spend_date)) < 2
),
r5_blocked as (
  -- lookalike_seed needs PDPA consent (design §5: 0/238 customers consented
  -- today) — always blocked until a consent-collection flow exists.
  select
    rfm.shop_id,
    'lookalike_seed:blocked' as reco_key,
    'lookalike_seed' as rule_code,
    'info' as severity,
    3 as priority,
    'ส่งออก lookalike seed audience — ยังใช้งานไม่ได้' as title,
    jsonb_build_object('champion_count', count(*)) as detail,
    true as is_blocked,
    'รอ PDPA consent (ยังไม่มีลูกค้ารายใดยินยอม) และ platform match ได้เฉพาะเบอร์จริง — TikTok mask เบอร์ ใช้ได้แค่ LINE' as blocked_reason
  from analytics.v_rfm_segment rfm
  where rfm.segment = 'champion'
  group by rfm.shop_id
  having count(*) >= 10
),
r6 as (
  select
    fo.shop_id,
    'live_targeting_brief:' || dch.code || ':' || to_char(current_date, 'YYYY-MM') as reco_key,
    'live_targeting_brief' as rule_code,
    'info' as severity,
    2 as priority,
    'ยิงแอดโปรโมตไลฟ์ ' || dch.name || ' — brief จังหวัด/กลุ่มลูกค้า/ช่วงเวลาพร้อมใช้ใน Ads Manager' as title,
    jsonb_build_object(
      'channel_code', dch.code,
      'top_provinces', coalesce(ga.top_provinces, '[]'::jsonb),
      'segment_mix', coalesce(sa.segment_mix, '{}'::jsonb),
      'hourly_orders', coalesce(ta.hourly_orders, '[]'::jsonb)
    ) as detail,
    false as is_blocked,
    null::text as blocked_reason
  from (select distinct shop_id, channel_id from analytics.v_fact_order) fo
  join analytics.dim_channel dch on dch.id = fo.channel_id
  left join geo_agg ga on ga.shop_id = fo.shop_id and ga.channel_id = fo.channel_id
  left join segment_agg sa on sa.shop_id = fo.shop_id and sa.channel_id = fo.channel_id
  left join time_agg ta on ta.shop_id = fo.shop_id and ta.channel_id = fo.channel_id
)
select * from r0
union all select * from r1
union all select * from r2
union all select * from r3
union all select * from r4_blocked
union all select * from r5_blocked
union all select * from r6
union all select * from analytics.v_mkt_reco_seasonal;

-- ============================================================================
-- 4. Grants — 0018's blanket grant does not retroactively cover objects
--    created after it (documented lesson at the end of 0027). Explicit here.
-- ============================================================================

grant select on analytics.campaign_calendar, analytics.v_mkt_reco_seasonal, analytics.v_marketing_reco
  to authenticated, service_role;

notify pgrst, 'reload schema';
