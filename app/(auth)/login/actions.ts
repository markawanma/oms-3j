"use server";

// app/(auth)/login/actions.ts — Phase A1 (auth infra, additive). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
//
// Nobody is forced through this page yet (middleware.ts does not gate — see
// its top comment). This exists so the login flow works end-to-end ahead of
// A2, which is the phase that starts actually requiring a session.
//
// Bootstrap prerequisite (design §A.5): the Supabase Auth user this signs in
// must already exist (Supabase dashboard -> Authentication -> Users) and
// have a corresponding shop_member row (scripts/provision-member.mjs) — A0,
// not this phase. Signing in with an unprovisioned user still "succeeds"
// against Supabase Auth; it just won't resolve to a shop until A2's
// getAuthContext() exists.

import { redirect } from "next/navigation";
import { getUserClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export interface SignInInput {
  email: string;
  password: string;
}

export async function signInWithPassword(input: SignInInput): Promise<ActionResult> {
  const email = input.email.trim();
  const password = input.password;

  if (!email) return { ok: false, error: "กรุณากรอกอีเมล" };
  if (!password) return { ok: false, error: "กรุณากรอกรหัสผ่าน" };

  let supabase;
  try {
    supabase = await getUserClient();
  } catch (err) {
    console.error("signInWithPassword: getUserClient() failed", err);
    return {
      ok: false,
      error: "ระบบ login ยังไม่พร้อมใช้งาน (ขาด Supabase anon key) — แจ้งผู้ดูแลระบบ",
    };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("signInWithPassword failed", error);
    return { ok: false, error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/dashboard");
}
