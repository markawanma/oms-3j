// lib/auth/action-guard.ts — shared write-gate for server actions.
// Extracted from lib/actions/catalog.ts / lib/actions/hero-stock.ts
// (code-review 2026-09-16, A2-lite): both modules had an identical
// requireWriteAccess() wrapper, only the "denied" message inside their own
// requireOwnerAdmin() differed — so that owner/admin check stays local to
// each action module (feature-specific message) and only the shared
// session+DEV_ROLE combo moves here.
import "server-only";
import { requireMemberIfGateOn, requireSessionIfGateOn } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/types";

/**
 * ActionResult-style wrapper over requireMemberIfGateOn() (lib/auth/session.ts)
 * — the second auth layer for actions that have no guard of their own:
 *
 *   const denied = await denyIfNotMember();
 *   if (denied) return denied;
 *
 * Put it as the FIRST statement (before input validation too: an outsider
 * shouldn't learn anything from validation messages). Actions that return
 * raw data / throw call requireMemberIfGateOn() directly instead.
 * One message for both "no session" and "pending, not approved" — the caller
 * can't tell which, and doesn't need to. No-op while AUTH_GATE is off.
 * The caught error is not logged (nothing in it is useful, and supabase
 * errors carry host/PII — supabase-error-logging-trap).
 */
export async function denyIfNotMember(): Promise<ActionResult<never> | null> {
  try {
    await requireMemberIfGateOn();
    return null;
  } catch {
    return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };
  }
}

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
