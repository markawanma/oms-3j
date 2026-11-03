// lib/auth/role.ts — the single source of truth for "what role is the
// current request acting as", now that A2-lite (16 ก.ย. 69) gives every
// dashboard page a real Supabase Auth session to check.
//
// Bug this fixes (17 ก.ย. 69, prod): every page/action in this app decided
// role by calling lib/dev/context.ts's getDevRole(), which reads ONLY the
// `DEV_ROLE` env var — never the actual session. Once AUTH_GATE=on shipped,
// the owner logged in for real (shop_member.role = 'owner') but every
// owner-only page still read process.env.DEV_ROLE (default 'staff', and
// Vercel never had it set to 'owner') and showed "หน้านี้จำกัดสิทธิ์".
//
// getEffectiveRole() is the fix: prefer the REAL session's shop_member.role
// whenever a session exists, and only fall back to the DEV_ROLE env var when
// there is no session at all (AUTH_GATE=off, local dev, one-off scripts —
// the same cases lib/dev/context.ts's header describes). This directly
// implements the CLAUDE.md rule "ห้ามอนุมานค่าคงที่จากราคา"'s sibling for
// auth: env vars must never override a real, authenticated identity.
//
// Precedence (all cases covered by lib/auth/role.test.ts):
//   (a) real session + shop_member row exists -> that row's role, ALWAYS.
//       DEV_ROLE is never consulted here — an owner who is logged in must
//       never be demoted by a stray env var, and a pending/staff user must
//       never be promoted by one either.
//   (b) real session but no shop_member row (pending user, or a user whose
//       membership was revoked) -> 'staff' (fail-closed — same reasoning as
//       getDevRole()'s own fallback: unknown role must never default to
//       elevated access, even if DEV_ROLE=owner is set in the environment).
//   (c) no session AND no error, with AUTH_GATE=on -> 'staff'. Security
//       review 2026-09-17 (H1): once the login gate is actually enforced,
//       "nobody is logged in" must never fall back to an env var — DEV_ROLE
//       has zero authority while the gate is on, full stop. Only when the
//       gate itself is off AND this is not a real deployment (local dev,
//       scripts) do we defer to getDevRole(), matching pre-A2-lite flows.
//   (d) getSessionUser() itself throws (H2 — e.g. Supabase Auth env vars not
//       configured yet in this deployment) -> same rule as (c) (and (e) on a
//       real deployment): 'staff' if AUTH_GATE=on, else getDevRole(). A
//       misconfigured auth environment must never be indistinguishable from
//       "logged in as owner".
//   (e) no session on a REAL deployment -> 'staff' regardless of AUTH_GATE.
//       Real = VERCEL_ENV set and != 'development' (production, preview, any
//       future value) OR NODE_ENV === 'production' (backup signal: Next
//       inlines it at build so it can't be forged at runtime — covers Vercel
//       not exposing system env vars, and self-hosted `next start`). NODE_ENV
//       === 'production' wins even over VERCEL_ENV='development' (fail-closed).
//       Side effect: a local `next build && next start` also ignores DEV_ROLE.
//       Security audit 3 พ.ย. 69: middleware.ts used to document turning
//       AUTH_GATE off as the emergency fallback, and Vercel production has
//       DEV_ROLE set — so on that day (c)/(d) alone would hand every
//       anonymous request DEV_ROLE's authority (owner => money/tax docs).
//       Preview counts: one DB, no dev/prod split, previews write real data.
//       Owner decision 3 พ.ย. 69 (A-narrow): the action layer (session.ts
//       requireSessionIfGateOn / requireMemberIfGateOn) uses the same
//       actionGateEnforced() from lib/auth/deployment.ts, so on a real
//       deployment AUTH_GATE no longer switches the action layer off either.
//   (f) shop_member.role outside owner|admin|staff -> 'staff'. The DB enum may
//       grow; a value this code doesn't know must never pass an owner/admin
//       gate (see also isOwnerOrAdmin, lib/auth/owner-admin.ts).
import "server-only";
import { cache } from "react";
import { getSessionUser, getMembership, type SessionUser } from "@/lib/auth/session";
import { getDevRole, type DevRole } from "@/lib/dev/context";
import { actionGateEnforced } from "@/lib/auth/deployment";

/** (c)/(d)/(e) shared fallback: env only gets a vote when the gate is off AND we're not on a real deployment.
 * actionGateEnforced() = isRealDeployment() || AUTH_GATE=on (lib/auth/deployment.ts) — same truth table as before. */
function noSessionRole(): DevRole {
  return actionGateEnforced() ? "staff" : getDevRole();
}

/**
 * Cached per request (React.cache — dedupes across every call within the
 * same render/action, same lifetime as `fetch` request memoization) so a
 * page that gates itself AND gates several server actions it calls doesn't
 * hit Supabase Auth + shop_member for the same answer multiple times.
 */
export const getEffectiveRole = cache(async (): Promise<DevRole> => {
  let user: SessionUser | null;
  try {
    user = await getSessionUser();
  } catch {
    // H2: getUserClient() can throw outright (e.g. missing Supabase Auth
    // env vars) — getSessionUser()'s own try/catch only covers the
    // "session cookie missing/invalid" case, not "client couldn't even be
    // constructed". Treat it exactly like "no session" rather than letting
    // an unrelated exception bubble into a page and crash it.
    return noSessionRole();
  }
  if (!user) return noSessionRole();

  const membership = await getMembership(user.id);
  if (!membership) return "staff";

  // session.ts casts the DB value without checking it — validate here, the one
  // place every gate reads from.
  const role: unknown = membership.role;
  return role === "owner" || role === "admin" || role === "staff" ? role : "staff";
});
