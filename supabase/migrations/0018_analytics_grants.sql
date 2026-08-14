-- 0018_analytics_grants.sql
-- Grant Data-API role privileges on schema analytics. A freshly created schema
-- grants nothing to Supabase's predefined roles; RLS (0012) gates rows, but the
-- roles still need schema USAGE + table privileges to reach it via PostgREST.
-- anon is deliberately excluded (no anonymous access to analytics / PII).
-- Applied via MCP 2026-08-11.
-- NOTE: exposing the schema to the Data API also requires (outside SQL):
--   alter role authenticator set pgrst.db_schemas to 'public, graphql_public, analytics';
--   notify pgrst, 'reload config';  notify pgrst, 'reload schema';

grant usage on schema analytics to authenticated, service_role;

-- service_role: full DML (BYPASSRLS) — the ELT/import job.
grant all on all tables in schema analytics to service_role;
grant execute on all routines in schema analytics to service_role;
grant usage, select on all sequences in schema analytics to service_role;

-- authenticated: SELECT only; RLS in 0012 decides which rows (staging + pii have
-- owner/admin-only policies, so non-owners get 0 rows even with this privilege).
grant select on all tables in schema analytics to authenticated;

-- future objects in this schema inherit the same grants.
alter default privileges in schema analytics grant all on tables to service_role;
alter default privileges in schema analytics grant execute on routines to service_role;
alter default privileges in schema analytics grant usage, select on sequences to service_role;
alter default privileges in schema analytics grant select on tables to authenticated;
