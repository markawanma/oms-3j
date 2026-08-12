-- 0035_campaign_calendar_view.sql
-- Full-year calendar view for the /marketing/calendar page. Unlike
-- v_mkt_reco_seasonal (0034), which only emits events inside their lead_days
-- window (for the copilot feed), this exposes EVERY active event with its next
-- occurrence + days_until, so the page can show the whole year's plan.
-- Reuses the same next-occurrence CASE as 0034 (single source of the rule).

create or replace view analytics.v_campaign_calendar
  with (security_invoker = true) as
select
  x.code,
  x.name_th,
  x.event_type,
  x.recur_month,
  x.recur_day,
  x.specific_date,
  x.duration_days,
  x.lead_days,
  x.prep_note_th,
  x.event_date,
  (x.event_date - current_date) as days_until,
  -- true when the event is currently within its lead window (i.e. it IS showing
  -- as a card in the copilot feed right now) — lets the page mark "active".
  (x.event_date - current_date) <= x.lead_days as in_lead_window
from (
  select
    cc.code, cc.name_th, cc.event_type, cc.recur_month, cc.recur_day,
    cc.specific_date, cc.duration_days, cc.lead_days, cc.prep_note_th,
    case
      when cc.specific_date is not null then cc.specific_date
      when make_date(extract(year from current_date)::int, cc.recur_month, cc.recur_day) >= current_date
        then make_date(extract(year from current_date)::int, cc.recur_month, cc.recur_day)
      else make_date(extract(year from current_date)::int + 1, cc.recur_month, cc.recur_day)
    end as event_date
  from analytics.campaign_calendar cc
  where cc.is_active
) x;

grant select on analytics.v_campaign_calendar to authenticated, service_role;

notify pgrst, 'reload schema';
