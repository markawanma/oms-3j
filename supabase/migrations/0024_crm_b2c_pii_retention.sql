-- 0024_crm_b2c_pii_retention.sql
-- Phase B2c — PDPA staging-PII retention (design §7(จ), and the explicit TODO
-- left in 0011's header). After an order row has been transformed into the
-- fact/dim/pii_customer layer, the raw customer PII sitting in
-- analytics.stg_order_import is no longer needed — the canonical PII lives in
-- pii_customer (owner/admin RLS) and identities are hashed. This scrubs the raw
-- staging PII 180 days after the staging row was loaded.
--
-- Scope: analytics.stg_order_import only. stg_order_item_import holds product
-- line data (name/variant/sku/qty), not customer PII, so it is untouched.
-- pii_customer is NOT touched — it is the live canonical CRM record, retained
-- for as long as the customer relationship exists (a different retention policy
-- if/when that is defined).
--
-- Idempotent: rows already scrubbed carry raw = {"_pdpa_redacted_at": ...} and
-- are skipped, so re-running (or the daily cron below firing repeatedly) only
-- ever touches newly-aged rows.

create or replace function analytics.crm_apply_pii_retention(p_older_than interval default interval '180 days')
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'pg_temp'
as $$
declare
  v_count integer;
begin
  with scrubbed as (
    update analytics.stg_order_import
      set customer_name_raw = null,
          contact_display_name_raw = null,
          phone_raw = null,
          full_address_raw = null,
          zipcode_raw = null,
          sender_raw = null,
          note_raw = null,
          bank_raw = null,
          -- raw is `not null` (0011) and holds the complete original row incl.
          -- PII — replace it with a redaction marker rather than null it.
          raw = jsonb_build_object('_pdpa_redacted_at', now())
      where import_status = 'transformed'
        and created_at < now() - p_older_than
        and not (raw ? '_pdpa_redacted_at')
      returning 1
  )
  select count(*) into v_count from scrubbed;
  return v_count;
end;
$$;

revoke execute on function analytics.crm_apply_pii_retention(interval) from public, anon, authenticated;
grant execute on function analytics.crm_apply_pii_retention(interval) to service_role;

-- Daily at 03:30 (server tz). Guarded unschedule-then-schedule so replaying this
-- migration doesn't stack duplicate jobs (cron.schedule keys on jobname in
-- recent pg_cron, but the explicit unschedule keeps it safe across versions).
do $$
begin
  perform cron.unschedule('crm-pii-retention-180d');
exception when others then
  null; -- job didn't exist yet
end;
$$;

select cron.schedule(
  'crm-pii-retention-180d',
  '30 3 * * *',
  $cron$select analytics.crm_apply_pii_retention();$cron$
);
