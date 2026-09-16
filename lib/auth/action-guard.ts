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
 * owner/admin check (the DEV_ROLE gate). getServiceClient() bypasses RLS
 * and short-circuits crm_require_owner_admin() inside the RPCs, so this
 * combo is the ONLY thing gating writes in this app today — every WRITE
 * server action must call this first, passing its own requireOwnerAdmin.
 */
export async function requireWriteAccess(
  requireOwnerAdmin: () => ActionResult<never> | null,
): Promise<ActionResult<never> | null> {
  try {
    await requireSessionIfGateOn();
  } catch {
    return { ok: false, error: "ต้องเข้าสู่ระบบก่อน" };
  }
  return requireOwnerAdmin();
}
