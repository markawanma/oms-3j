-- 0046_auth_helpers_and_revoke.sql
-- A0 (auth-hardening, docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md).
-- Scoped to the SAFE, immediately-useful pieces of A0. The big 76-policy RLS
-- recursion rewrite (F1) is DEFERRED to the A2 migration — see §C note below.
--
--   (1) SECURITY DEFINER membership helpers auth_shop_ids() / auth_has_role().
--       These are the primitive that breaks the shop_member self-referencing
--       RLS recursion (F1): a policy that needs "which shops is auth.uid() a
--       member of" calls auth_shop_ids() (which reads shop_member with RLS
--       bypassed, being SECURITY DEFINER) instead of sub-selecting shop_member
--       inline (which re-enters the same policy → infinite recursion). Created
--       now so A2 can reference them; nothing calls them yet.
--
--   (2) revoke analytics.crm_overview_summary from `authenticated`. Same latent
--       bypass already closed on dashboard_summary/dashboard_charts (PR #3):
--       its money gate is a caller-supplied p_include_money (returns profit
--       either way here), so once real auth ships an `authenticated` staff
--       could call it directly via PostgREST. The app only ever calls it via
--       the service-role client (lib/actions/crm.ts getServiceClient), so this
--       is zero-impact today and closes the debt.
--
-- DEFERRED TO A2 (design §C, revised 2026-08-16): the ALTER POLICY rewrite of
-- all 76 tenant_isolation / owner_admin policies (0002/0004/0008/0012/0021/
-- 0023/0027/0028/0031/0036/0037/0038/0049) to use these helpers. Reason: those
-- policies are NOT exercised until A2 swaps the app off the service-role client
-- (service_role has BYPASSRLS, so RLS never runs today) — writing + verifying
-- the rewrite together with that swap, under a real authenticated session, is
-- safer than shipping 76 untested ALTER POLICYs now. The helpers below are the
-- only prerequisite that's safe to land early.

-- ============================================================================
-- 1. Membership helpers (SECURITY DEFINER — bypass RLS on the lookup)
-- ============================================================================

create or replace function public.auth_shop_ids()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path = public, pg_temp
as $$
  select shop_id from public.shop_member where user_id = auth.uid()
$$;

create or replace function public.auth_has_role(p_shop_id uuid, variadic p_roles text[])
  returns boolean
  language sql
  security definer
  stable
  set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shop_member
    where shop_id = p_shop_id and user_id = auth.uid() and role::text = any(p_roles)
  )
$$;

revoke execute on function public.auth_shop_ids() from public, anon;
revoke execute on function public.auth_has_role(uuid, text[]) from public, anon;
grant execute on function public.auth_shop_ids() to authenticated, service_role;
grant execute on function public.auth_has_role(uuid, text[]) to authenticated, service_role;

-- ============================================================================
-- 2. revoke crm_overview_summary from authenticated (service_role only)
-- ============================================================================

revoke execute on function analytics.crm_overview_summary(uuid, date, date, text) from authenticated;

notify pgrst, 'reload schema';
