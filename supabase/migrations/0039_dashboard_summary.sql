-- 0039_dashboard_summary.sql
-- Home/Dashboard aggregate (docs/3j-jewelry/design/ui-refresh-plan.md §1).
-- One round-trip returning jsonb: period-scoped KPI + action-needed counts +
-- top recos + RFM mix + top channel. p_include_money=false (staff) omits the
-- money sections (KPI/reco/rfm/channel), leaving only action-needed. Reads the
-- existing analytics views (security_invoker; app calls via service-role).

create or replace function analytics.dashboard_summary(
  p_shop_id uuid,
  p_period text default 'month',
  p_include_money boolean default true
)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'analytics', 'public', 'pg_temp'
as $$
declare
  v_from date;
  v_kpi jsonb := null;
  v_action jsonb;
  v_reco jsonb := '[]'::jsonb;
  v_rfm jsonb := '{}'::jsonb;
  v_channel jsonb := null;
begin
  v_from := case p_period
    when 'today' then current_date
    when '7d' then current_date - 6
    else date_trunc('month', current_date)::date
  end;

  -- action-needed (always shown, incl. staff)
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
      'aov', case when count(*) > 0 then round(sum(revenue) / count(*), 2) else 0 end
    ) into v_kpi
    from analytics.v_fact_order
    where shop_id = p_shop_id and order_date >= v_from;

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
    'period', p_period,
    'kpi', v_kpi,
    'action', v_action,
    'reco', v_reco,
    'rfm', v_rfm,
    'top_channel', v_channel
  );
end;
$$;

grant execute on function analytics.dashboard_summary(uuid, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
