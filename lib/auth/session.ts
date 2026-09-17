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
import { createHash, createHmac } from "node:crypto";
import { getServiceClient, getUserClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";

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
 * row), so a user has at most one membership row FOR THIS SHOP; `.maybeSingle()`
 * reflects that — if it ever throws PGRST116 (>1 row), that is a real
 * data-integrity bug worth surfacing, not something to silently .limit(1)
 * away.
 *
 * Security review 2026-09-17 (M1): `.eq("shop_id", getDevShopId())` — a user
 * with a shop_member row for a DIFFERENT shop (future multi-shop data, a
 * stale row, anything) must never be treated as a member of THIS shop just
 * because their user_id happens to match. Belt-and-suspenders alongside
 * getServiceClient() bypassing RLS: without this filter, that other shop's
 * role would flow straight into getEffectiveRole().
 */
export async function getMembership(userId: string): Promise<SessionMembership | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("shop_member")
    .select("shop_id, role")
    .eq("user_id", userId)
    .eq("shop_id", getDevShopId())
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
 * Second layer of defense for every MUTATION in lib/actions/catalog.ts
 * (security review 2026-09-16, C1). C1(a) already stops /stock/hero from
 * pulling those actions into its bundle in the first place — this is the
 * belt-and-suspenders check so a future page/route that legitimately does
 * import catalog.ts (or any other server action file that starts calling
 * this) can't reach a write with no session, even if it forgets to check
 * getDevRole() itself.
 *
 * AUTH_GATE !== "on" -> no-op (matches every other A1 page/action: this
 * phase does not change behavior for the current dev/DEV_ROLE flow at all).
 * AUTH_GATE === "on" -> throws unless there's a real Supabase Auth session.
 * Deliberately does NOT check shop_member here (unlike requireOwnerSession)
 * — role/membership stays whatever lib/dev/context.ts's requireOwnerAdmin()
 * already gates in that file; this only closes the "no session at all"
 * gap, same fail-closed shape as middleware.ts.
 */
export async function requireSessionIfGateOn(): Promise<void> {
  if (process.env.AUTH_GATE !== "on") return;
  const user = await getSessionUser();
  if (!user) throw new Error("ไม่ได้เข้าสู่ระบบ");
}

/**
 * SIGNUP_CODE_SECRET if set; otherwise sha256(SUPABASE_SERVICE_ROLE_KEY) as
 * a fallback so this still works in an environment that never set the
 * dedicated secret (dev/preview). Never returns the raw service-role key
 * itself as the HMAC key — only its hash — so a leaked verify code can't be
 * worked backwards toward the service key. server-only module, never
 * imported client-side (see file header).
 */
function signupCodeSecret(): string {
  const explicit = process.env.SIGNUP_CODE_SECRET;
  if (explicit) return explicit;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(serviceKey).digest("hex");
}

/**
 * 6-char uppercase code the owner reads back from the pending user
 * out-of-band (e.g. asked over LINE/phone: "โค้ดยืนยันของคุณคืออะไร") before
 * approving them.
 *
 * Security review 2026-09-16 (M4): this USED to be `userId.slice(-6)` — a
 * literal substring of the id, so anyone who ever saw a user's id (e.g. in
 * a URL, a log line, or Supabase Auth's dashboard) could derive their
 * "verify code" without ever talking to them, defeating the whole point of
 * an out-of-band check. Now HMAC-SHA256(userId, secret) truncated to 6 hex
 * chars — deterministic per userId (same input always reproduces the same
 * code, so the owner and the pending user always see the same 6 characters)
 * but not derivable from the id alone without the server-side secret.
 * lib/actions/members.ts's PendingUser type no longer ships this value to
 * the owner's browser either (M4) — approveMember() recomputes it
 * server-side from userId, so reading it off the /settings/members screen
 * is no longer possible; the owner must actually get it from the pending
 * user.
 */
export function verifyCodeFor(userId: string): string {
  const digest = createHmac("sha256", signupCodeSecret()).update(userId).digest("hex");
  return digest.slice(0, 6).toUpperCase();
}
