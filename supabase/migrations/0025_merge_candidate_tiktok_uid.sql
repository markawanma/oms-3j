-- 0025_merge_candidate_tiktok_uid.sql
-- Add a reliable TikTok-uid tier to analytics.v_merge_candidate.
--
-- Discovery: TikTok orders carry a stable per-account id in
-- stg_order_import.contact_display_name_raw (a 15+ digit number, e.g.
-- '7494008609741768392'). Because TikTok masks the phone, the transform never
-- built a dim_customer_identity for these buyers, so a single buyer who ordered
-- N times became N separate dim_customer rows. That uid is an EXACT identifier
-- (same as a phone) — customers sharing one are the same person, not a
-- name-similarity guess.
--
-- We can't backfill it into dim_customer_identity: uq_dim_customer_identity is
-- unique on (shop_id, identity_type, identity_value_norm), so the same uid
-- can't point at two customers there. Instead the candidate view derives the
-- customer->uid map straight from staging and treats a shared uid as 'high'
-- confidence (ranked above the existing name-based medium/low tiers).
--
-- Only the confidence CASE changes vs 0023 (new cust_uid CTE + first WHEN);
-- everything below the pairs CTE is identical to 0023.

create or replace view analytics.v_merge_candidate
  with (security_invoker = true) as
with cust_uid as (
  -- one row per (customer, TikTok uid) seen across that customer's orders
  select distinct fo.customer_id, s.contact_display_name_raw as uid
  from analytics.stg_order_import s
  join analytics.fact_order fo on fo.id = s.fact_order_id
  where s.contact_display_name_raw ~ '^[0-9]{15,}$'
),
pairs as (
  select
    a.shop_id,
    a.id as customer_a_id,
    b.id as customer_b_id,
    case
      -- exact TikTok-uid match = same account = same person (safe, not a guess)
      when exists (
        select 1 from cust_uid ua
        join cust_uid ub on ub.uid = ua.uid and ub.customer_id = b.id
        where ua.customer_id = a.id
      ) then 'high'
      -- same normalized identity row pointing at two customers (rare today —
      -- kept from 0023 as defense-in-depth for future identity writers)
      when exists (
        select 1
        from analytics.dim_customer_identity ia
        join analytics.dim_customer_identity ib
          on ib.shop_id = ia.shop_id
         and ib.identity_type = ia.identity_type
         and ib.identity_value_norm = ia.identity_value_norm
         and ib.customer_id = b.id
        where ia.customer_id = a.id
      ) then 'high'
      when analytics.crm_normalize_customer_name(a.display_name) is not null
        and analytics.crm_normalize_customer_name(a.display_name)
          = analytics.crm_normalize_customer_name(b.display_name)
        and pa.province_code is not null
        and pa.province_code = pb.province_code
      then 'medium'
      when analytics.crm_normalize_customer_name(a.display_name) is not null
        and analytics.crm_normalize_customer_name(a.display_name)
          = analytics.crm_normalize_customer_name(b.display_name)
      then 'low'
      else null
    end as confidence
  from analytics.dim_customer a
  join analytics.dim_customer b
    on b.shop_id = a.shop_id
   and b.id > a.id
   and b.merged_into_id is null
  left join lateral (
    select fo.province_code
    from analytics.v_fact_order fo
    where fo.customer_id = a.id
    order by fo.order_date desc
    limit 1
  ) pa on true
  left join lateral (
    select fo.province_code
    from analytics.v_fact_order fo
    where fo.customer_id = b.id
    order by fo.order_date desc
    limit 1
  ) pb on true
  where a.merged_into_id is null
)
select
  p.shop_id,
  p.customer_a_id,
  ca.display_name as customer_a_name,
  ida.identities as customer_a_identities,
  pa2.province_code as customer_a_province,
  coalesce(ma.order_count, 0) as customer_a_order_count,
  coalesce(ma.revenue_sum, 0) as customer_a_revenue_sum,
  p.customer_b_id,
  cb.display_name as customer_b_name,
  idb.identities as customer_b_identities,
  pb2.province_code as customer_b_province,
  coalesce(mb.order_count, 0) as customer_b_order_count,
  coalesce(mb.revenue_sum, 0) as customer_b_revenue_sum,
  p.confidence
from pairs p
join analytics.dim_customer ca on ca.id = p.customer_a_id
join analytics.dim_customer cb on cb.id = p.customer_b_id
left join analytics.v_customer_master ma on ma.customer_id = p.customer_a_id
left join analytics.v_customer_master mb on mb.customer_id = p.customer_b_id
left join lateral (
  select array_agg(ci.identity_type || ':' || ci.identity_value_norm order by ci.identity_type) as identities
  from analytics.dim_customer_identity ci
  where ci.customer_id = p.customer_a_id
) ida on true
left join lateral (
  select array_agg(ci.identity_type || ':' || ci.identity_value_norm order by ci.identity_type) as identities
  from analytics.dim_customer_identity ci
  where ci.customer_id = p.customer_b_id
) idb on true
left join lateral (
  select fo.province_code
  from analytics.v_fact_order fo
  where fo.customer_id = p.customer_a_id
  order by fo.order_date desc
  limit 1
) pa2 on true
left join lateral (
  select fo.province_code
  from analytics.v_fact_order fo
  where fo.customer_id = p.customer_b_id
  order by fo.order_date desc
  limit 1
) pb2 on true
where p.confidence is not null
  and not exists (
    select 1
    from analytics.crm_merge_decision d
    where d.shop_id = p.shop_id
      and d.customer_a = least(p.customer_a_id, p.customer_b_id)
      and d.customer_b = greatest(p.customer_a_id, p.customer_b_id)
  )
order by
  case p.confidence when 'high' then 1 when 'medium' then 2 else 3 end,
  p.customer_a_id,
  p.customer_b_id;
