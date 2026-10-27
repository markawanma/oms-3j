// lib/auth/action-guard.ts — shared write-gate for server actions.
// Extracted from lib/actions/catalog.ts / lib/actions/hero-stock.ts
// (code-review 2026-09-16, A2-lite): both modules had an identical
// requireWriteAccess() wrapper, only the "denied" message inside their own
// requireOwnerAdmin() differed — so that owner/admin check stays local to
// each action module (feature-specific message) and only the shared
// session+DEV_ROLE combo moves here.
import "server-only";
import { cache } from "react";
import { getMembership, getSessionUser, requireSessionIfGateOn } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/types";

/**
 * Combines both auth layers active in this app right now:
 * requireSessionIfGateOn() (real Supabase Auth session, only enforced once
 * AUTH_GATE=on — see lib/auth/session.ts) then a caller-supplied
 * owner/admin check (the real-session-aware role gate — lib/auth/role.ts's
 * getEffectiveRole()). getServiceClient() bypasses RLS and short-circuits
 * crm_require_owner_admin() inside the RPCs, so this combo is the ONLY
 * thing gating writes in this app today — every WRITE server action must
 * call this first, passing its own requireOwnerAdmin.
 *
 * requireOwnerAdmin may be sync or async (17 ก.ย. 69: callers now check
 * `await getEffectiveRole()`, which hits the DB for shop_member — so this
 * must await whatever the caller returns, not assume it's synchronous).
 */
export async function requireWriteAccess(
  requireOwnerAdmin: () => ActionResult<never> | null | Promise<ActionResult<never> | null>,
): Promise<ActionResult<never> | null> {
  try {
    await requireSessionIfGateOn();
  } catch {
    return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };
  }
  return await requireOwnerAdmin();
}

/**
 * READ gate for server actions that any shop member (owner/admin/staff) may
 * call, but nobody else. H1 root cause (Phase 2): a server action is a public
 * POST endpoint — middleware/page gates are bypassed when the action id is
 * dispatched directly, so the action itself must authenticate.
 *
 * "Has a session" is NOT enough: a pending user holds a real Supabase session
 * (that is how they reach /pending) but has no shop_member row, and
 * getEffectiveRole() collapses pending -> "staff" on purpose (45 files depend
 * on that), so a role check can't tell pending from a real staff member. This
 * helper checks membership directly.
 *
 *  - AUTH_GATE !== "on"        -> null (DEV flow unchanged; no auth calls made)
 *  - no session                -> "ต้องเข้าสู่ระบบก่อน" (same text as requireWriteAccess)
 *  - getSessionUser() throws   -> treated as no session (fail-closed, same as
 *                                 getEffectiveRole case (d))
 *  - session, no shop_member   -> "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน"
 *  - member of ANY role        -> null (staff members keep what they had)
 *
 * Call as the FIRST statement of the action, OUTSIDE its try/catch, so the
 * guard message is never overwritten by the action's generic "load failed".
 * Cached per request (React.cache) like getEffectiveRole(): a page that fans
 * out several actions pays one getUser + one shop_member lookup.
 */
export const requireMemberAccess = cache(async (): Promise<ActionResult<never> | null> => {
  if (process.env.AUTH_GATE !== "on") return null;

  let user: Awaited<ReturnType<typeof getSessionUser>>;
  try {
    user = await getSessionUser();
  } catch {
    return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };
  }
  if (!user) return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };

  // getMembership() swallows query errors into null -> fail-closed. The
  // service client constructor can still throw (missing env), so guard it too.
  let membership: Awaited<ReturnType<typeof getMembership>>;
  try {
    membership = await getMembership(user.id);
  } catch {
    return { ok: false, error: "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน" };
  }
  if (!membership) return { ok: false, error: "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน" };

  return null;
});
