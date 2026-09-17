"use server";

// app/(auth)/login/actions.ts — Phase A1, extended for A2-lite (owner-
// approval auth gate, 2026-09-16). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
//
// Bootstrap prerequisite (design §A.5): the Supabase Auth user this signs in
// must already exist (Supabase dashboard -> Authentication -> Users, or
// self-serve via app/(auth)/register/actions.ts) and have a corresponding
// shop_member row (scripts/provision-member.mjs, or owner approval via
// lib/actions/members.ts) before they resolve to a shop. Signing in with an
// unprovisioned user still "succeeds" against Supabase Auth — middleware.ts
// (AUTH_GATE=on) is what sends them to /pending instead of a real page.

import { redirect } from "next/navigation";
import { getUserClient } from "@/lib/supabase/server";
import { sanitizeNextParam } from "@/lib/auth/sanitize-next";
import type { ActionResult } from "@/lib/types";

export interface SignInInput {
  email: string;
  password: string;
  // Where to send the user after a successful sign-in — middleware.ts sets
  // this when it redirects an unauthenticated request to /login?next=<path>.
  // Sanitized with the SAME rule as middleware.ts (sanitizeNextParam) before
  // ever reaching redirect() below: this is the one place in the app that
  // takes attacker-controlled input and feeds it into a server-side
  // redirect target, so an unvalidated `next` here would be a textbook
  // open-redirect (?next=//evil.com or ?next=http://evil.com).
  next?: string | null;
}

export async function signInWithPassword(input: SignInInput): Promise<ActionResult> {
  const email = input.email.trim();
  const password = input.password;
  const next = sanitizeNextParam(input.next);

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

  redirect(next);
}
