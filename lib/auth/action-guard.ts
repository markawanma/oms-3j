// lib/auth/action-guard.ts — shared write-gate for server actions.
// Extracted from lib/actions/catalog.ts / lib/actions/hero-stock.ts
// (code-review 2026-09-16, A2-lite): both modules had an identical
// requireWriteAccess() wrapper, only the "denied" message inside their own
// requireOwnerAdmin() differed — so that owner/admin check stays local to
// each action module (feature-specific message) and only the shared
// session+DEV_ROLE combo moves here.
import "server-only";
import { requireSessionIfGateOn } from "@/lib/auth/session";
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
