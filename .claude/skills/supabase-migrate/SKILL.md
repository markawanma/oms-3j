---
name: supabase-migrate
description: >-
  Safe workflow for applying and verifying Postgres schema changes (migrations,
  DDL, RLS policies, SECURITY DEFINER functions/RPCs) to a live Supabase project
  through the Supabase MCP tools. Use this whenever you are about to apply a
  migration, run DDL, add/replace a database function, change RLS, or "deploy a
  schema change" to a real/cloud Supabase project — especially production —
  even if the user just says "apply this migration" or "run this SQL on the DB".
  It encodes a pre-check → apply → self-verify → advisor → rollback loop plus
  Supabase-specific pitfalls that silently break function privileges and RLS.
---

# Supabase migrate (safe apply + verify)

Applying DDL to a **live** Supabase project is easy to get wrong in ways that
pass every static review yet break at call time or leave a security hole. This
skill is the disciplined loop that catches those. Follow it whenever a change
touches the database schema on a real project.

The golden rule: **a migration isn't done when it applies — it's done when a
run proves it does what you intended and `get_advisors` is clean.** Reading SQL
is not verifying it.

## The loop

1. **Pre-check** — never apply blind.
   - `list_migrations` → confirm the expected prior migrations exist and the new
     one is *not* already applied (a duplicate name/apply from another session
     is a real hazard).
   - Sanity-check the object you're about to replace is still the version you
     think it is (so you don't clobber a newer state):
     ```sql
     select pg_get_functiondef('my_fn(uuid, integer)'::regprocedure);
     ```
     Grep the definition for a token unique to the current vs. new version. If
     it's already the new version, **stop and ask** — something applied out of
     band.

2. **Apply** — use `apply_migration` (not `execute_sql`) for DDL so it lands in
   migration history. Pass the migration file's contents verbatim. Prefer
   `create or replace` / `drop policy if exists` + `create policy` so the file
   is safe to layer on top of an already-applied base without editing history.

3. **Verify with a self-cleaning `do` block** — because the project is real,
   the verification must seed, assert, and clean up after itself in one atomic
   statement. If any assertion fails, the whole block raises and rolls back —
   no manual cleanup, no leftover test rows. Only the success path deletes.
   See `references/verify-template.sql`.

4. **Post-check with `get_advisors`** — run `get_advisors(type: "security")`
   after **every** DDL change. It catches missing RLS policies and, critically,
   functions that anon/authenticated can still execute (see gotcha #1). Compare
   against the pre-apply state: the expected diff is usually "nothing new".

5. **Have a rollback ready before you apply** — for a `create or replace`
   function, rollback is just replacing it with the previous body (< 5s, no
   data migration). Write it as the *next* migration number (e.g.
   `0008_rollback_x_to_0006.sql`) so DB state and git stay in sync — never
   rewrite applied history.

## Supabase gotchas (these cost us real bugs)

**1. `revoke ... from public` is NOT enough on Supabase.**
Supabase's default privileges grant `EXECUTE` on new public-schema functions to
`anon` and `authenticated` **separately from `PUBLIC`**. So revoking from
`public` leaves those roles able to call your `SECURITY DEFINER` RPC over
PostgREST (`/rest/v1/rpc/...`) with no login. Always revoke explicitly:
```sql
revoke execute on function my_fn(uuid, integer) from public, anon, authenticated;
grant  execute on function my_fn(uuid, integer) to service_role;
```
Verify it actually took:
```sql
select has_function_privilege('anon', 'public.my_fn(uuid,integer)', 'execute');  -- must be false
```
`get_advisors` also flags this as `anon_security_definer_function_executable`.

**2. `RETURNS TABLE (col ...)` creates OUT variables that collide with columns.**
Those output names are in-scope PL/pgSQL variables, so an unqualified column of
the same name inside `UPDATE ... WHERE col = ...` is ambiguous
(`42702: column reference "col" is ambiguous`) and the function fails on **every
call** — invisible to static review, instant on a real run. Alias the target
table:
```sql
update central_stock as cs
   set qty_reserved = cs.qty_reserved + n
 where cs.product_id = p_id
returning cs.* into v_row;
```

**3. Run `get_advisors` after every DDL.** It's the cheapest way to catch RLS
tables with no policy, exposed SECURITY DEFINER functions, and grant mistakes.
Treat a new WARN as blocking until explained. (Some are intentional/benign —
e.g. a table that's service-role-only by design, or a platform event-trigger
function — document those so they're not re-investigated each time.)

**4. Pin `search_path` on every SECURITY DEFINER function.**
```sql
create function my_fn(...) ... security definer set search_path = public, pg_temp as $$ ... $$;
```
Without it, a definer function running as owner is vulnerable to search_path
hijack if a malicious schema is ever put ahead of `public`.

## Notes
- `execute_sql` is for reads, verification blocks, and *operational* actions
  (e.g. `pg_cron` scheduling) — not schema changes. Use `apply_migration` for DDL.
- Deploying an Edge Function or scheduling pg_cron cannot be done through the
  MCP alone — flag those as steps needing the Supabase CLI/dashboard.
- Reference example in this repo: `supabase/migrations/0001`–`0007` and the
  project `udqmamplbymxnknkjnkz`. `0006`/`0007` show gotchas #1 and #2 being fixed.

Answer in the user's language; keep SQL/identifiers in English.
