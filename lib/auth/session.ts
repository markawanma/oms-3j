// lib/auth/session.ts — A2-lite (owner-approval auth gate). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md and the
// owner decision log, 16 ก.ย. 69.
//
// server-only: reads the REAL Supabase Auth session (getUserClient()) and
// the REAL shop_member row (service client). Deliberately separate from
// lib/dev/context.ts (DEV_ROLE/DEV_SHOP_ID) — that seam is UNCHANGED by this
// phase. Every existing page/action still reads DEV_ROLE/DEV_SHOP_ID; the
// functions here are only consumed by middleware.ts (the login/register/
// pending gate) and lib/actions/members.ts (the owner-only approval
// actions) — a deliberately small, auditable surface for the one place role
// actually has to be enforced for real in this phase.
import "server-only";
import { getServiceClient, getUserClient } from "@/lib/supabase/server";

export type ShopRole = "owner" | "admin" | "staff";

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface SessionMembership {
  shopId: string;
  role: ShopRole;
}

export interface OwnerSession {
  userId: string;
  shopId: string;
}

/** Current Supabase Auth user for this request, or null if unauthenticated
 * or the session cookie is missing/invalid. Never throws on "no session" —
 * that is the expected, common case (every anonymous page load). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * shop_member row for a user, via the service client — same
 * bypasses-RLS-but-filters-explicitly pattern as every lib/actions/*.ts read
 * (see lib/supabase/server.ts's header). This app is single-shop (design
 * §A.5 / scripts/provision-member.mjs resolves "the" shop as the oldest
 * row), so a user has at most one membership row; `.maybeSingle()` reflects
 * that — if it ever throws PGRST116 (>1 row), that is a real data-integrity
 * bug worth surfacing, not something to silently .limit(1) away.
 */
export async function getMembership(userId: string): Promise<SessionMembership | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("shop_member")
    .select("shop_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return { shopId: data.shop_id as string, role: data.role as ShopRole };
}

/**
 * Throws unless the current request has a real Supabase Auth session AND
 * that user is `owner` of a shop. Every export in lib/actions/members.ts
 * must call this FIRST, before touching any data — it is the only thing
 * standing between a pending/staff user and: the full list of every
 * unapproved signup email in the system (listPendingUsers), and the power
 * to grant/revoke shop access (approveMember/removeMember). A pending user
 * has a valid Supabase Auth session (that's how they got past middleware to
 * /pending at all) but no shop_member row, so getMembership() returning
 * null for them is load-bearing, not an edge case.
 */
export async function requireOwnerSession(): Promise<OwnerSession> {
  const user = await getSessionUser();
  if (!user) throw new Error("ไม่ได้เข้าสู่ระบบ");

  const membership = await getMembership(user.id);
  if (!membership || membership.role !== "owner") {
    throw new Error("ต้องเป็นเจ้าของร้านเท่านั้น");
  }

  return { userId: user.id, shopId: membership.shopId };
}

/**
 * 6-char uppercase code the owner reads back from the pending user
 * out-of-band (e.g. asked over LINE/phone: "โค้ดยืนยันของคุณคืออะไร") before
 * approving them. Not a secret in itself — the owner can already see the
 * full pending list via listPendingUsers() — it's a low-friction "is this
 * really the person who signed up, not someone else's email" check that
 * costs nothing to implement as a pure derivation of the user id.
 */
export function verifyCodeFor(userId: string): string {
  return userId.slice(-6).toUpperCase();
}
