"use server";

// lib/actions/members.ts — A2-lite (owner-approval auth gate). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md and the
// owner decision log, 16 ก.ย. 69.
//
// This is the ONLY write surface for shop_member in the app (replaces the
// service-role-only scripts/provision-member.mjs bootstrap script for
// day-to-day approvals — that script still exists for the very first owner,
// chicken/egg: nobody can approve the first owner from inside the app).
//
// Every export below calls requireOwnerSession() FIRST — see its doc comment
// in lib/auth/session.ts for why. role (owner/admin/staff) is still just a
// label everywhere else in the app (every other page/action reads
// DEV_ROLE/DEV_SHOP_ID unchanged, per owner decision) — these actions are
// the one place in A2-lite where role is checked against a REAL session,
// because granting/revoking shop access has to be real.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { requireOwnerSession, verifyCodeFor, type ShopRole } from "@/lib/auth/session";

export type PendingUser = { id: string; email: string; createdAt: string; verifyCode: string };
export type Member = { userId: string; email: string; role: "owner" | "admin" | "staff"; createdAt: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const MEMBERS_PATH = "/settings/members";

interface AuthUserRow {
  id: string;
  email: string;
  createdAt: string;
}

// auth.admin.listUsers() paginates (default 50/page) — walk every page, same
// as scripts/provision-member.mjs's findAuthUserId(), so a shop with more
// than one page of signups doesn't silently lose pending users off the end.
// Hard cap of 200 pages (40,000 users at perPage=200) as a runaway guard —
// nowhere near a real ceiling for this shop, just prevents an infinite loop
// if listUsers() ever stops reporting a short final page.
async function listAllAuthUsers(): Promise<AuthUserRow[]> {
  const supabase = getServiceClient();
  const users: AuthUserRow[] = [];
  for (let page = 1; page <= 200; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      users.push({ id: u.id, email: u.email ?? "", createdAt: u.created_at });
    }
    if (data.users.length < 200) break; // last page
  }
  return users;
}

function byCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

/** Every Supabase Auth user who has signed up (app/(auth)/register/actions.ts)
 * but has no shop_member row yet — i.e. still waiting on the owner. */
export async function listPendingUsers(): Promise<PendingUser[]> {
  await requireOwnerSession();

  const supabase = getServiceClient();
  const [allUsers, { data: members, error: memberErr }] = await Promise.all([
    listAllAuthUsers(),
    supabase.from("shop_member").select("user_id"),
  ]);
  if (memberErr) throw new Error(`shop_member lookup failed: ${memberErr.message}`);

  const memberIds = new Set((members ?? []).map((m) => m.user_id as string));

  return allUsers
    .filter((u) => !memberIds.has(u.id))
    .map((u) => ({ id: u.id, email: u.email, createdAt: u.createdAt, verifyCode: verifyCodeFor(u.id) }))
    .sort(byCreatedAtDesc);
}

/** Every current shop_member of the owner's shop. */
export async function listMembers(): Promise<Member[]> {
  const { shopId } = await requireOwnerSession();
  const supabase = getServiceClient();

  const { data: rows, error } = await supabase
    .from("shop_member")
    .select("user_id, role, created_at")
    .eq("shop_id", shopId);
  if (error) throw new Error(`shop_member lookup failed: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  // Email lives in auth.users, not shop_member. One listUsers() pass mapped
  // by id — NOT one auth.admin.getUserById() call per row — avoids an N+1
  // against the Auth admin API for a member list that only grows over time.
  const allUsers = await listAllAuthUsers();
  const emailById = new Map(allUsers.map((u) => [u.id, u.email]));

  return rows
    .map((r) => ({
      userId: r.user_id as string,
      email: emailById.get(r.user_id as string) ?? "(ไม่พบอีเมลใน Supabase Auth)",
      role: r.role as ShopRole,
      createdAt: r.created_at as string,
    }))
    .sort(byCreatedAtDesc);
}

export async function approveMember(input: {
  userId: string;
  role: "admin" | "staff";
  code: string;
}): Promise<ActionResult> {
  const { shopId } = await requireOwnerSession();

  const userId = (input.userId ?? "").trim();
  const code = (input.code ?? "").trim();

  if (!userId) return { ok: false, error: "ไม่พบผู้ใช้" };
  if (input.role !== "admin" && input.role !== "staff") {
    return { ok: false, error: "role ไม่ถูกต้อง" };
  }
  if (!code || code.toUpperCase() !== verifyCodeFor(userId)) {
    return { ok: false, error: "รหัสยืนยันไม่ตรง" };
  }

  const supabase = getServiceClient();

  // Confirm the user actually exists in Supabase Auth before granting
  // access — an attacker-guessable or typo'd userId must not silently
  // create a shop_member row (and therefore full app access) for a uuid
  // nobody ever signed up with.
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user) {
    return { ok: false, error: "ไม่พบบัญชีผู้ใช้นี้ใน Supabase Auth" };
  }

  const { error } = await supabase
    .from("shop_member")
    .upsert({ shop_id: shopId, user_id: userId, role: input.role }, { onConflict: "shop_id,user_id" });
  if (error) {
    console.error("approveMember: upsert failed", error);
    return { ok: false, error: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }

  revalidatePath(MEMBERS_PATH);
  return { ok: true };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const { userId: ownerId, shopId } = await requireOwnerSession();

  const target = (userId ?? "").trim();
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้" };
  if (target === ownerId) return { ok: false, error: "ห้ามลบตัวเอง" };

  const supabase = getServiceClient();

  const { data: targetRow, error: targetErr } = await supabase
    .from("shop_member")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", target)
    .maybeSingle();
  if (targetErr) {
    console.error("removeMember: lookup failed", targetErr);
    return { ok: false, error: "ตรวจสอบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  if (!targetRow) return { ok: false, error: "ไม่พบสมาชิกนี้" };

  if (targetRow.role === "owner") {
    const { count, error: countErr } = await supabase
      .from("shop_member")
      .select("user_id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("role", "owner");
    if (countErr) {
      console.error("removeMember: owner count failed", countErr);
      return { ok: false, error: "ตรวจสอบไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
    if ((count ?? 0) <= 1) return { ok: false, error: "ห้ามลบเจ้าของคนสุดท้าย" };
  }

  const { error } = await supabase.from("shop_member").delete().eq("shop_id", shopId).eq("user_id", target);
  if (error) {
    console.error("removeMember: delete failed", error);
    return { ok: false, error: "ลบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }

  revalidatePath(MEMBERS_PATH);
  return { ok: true };
}
