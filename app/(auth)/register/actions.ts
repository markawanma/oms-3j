"use server";

// app/(auth)/register/actions.ts — A2-lite (owner-approval auth gate). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md and the
// owner decision log, 16 ก.ย. 69.
//
// Self-serve signup: anyone can create a Supabase Auth account here, but
// middleware.ts (AUTH_GATE=on) locks them out of every real page until the
// owner approves them in /settings/members (lib/actions/members.ts
// approveMember). "Confirm email" must be turned OFF in the Supabase
// dashboard (Authentication -> Providers -> Email) per the owner's 16 ก.ย.
// decision — that is a project-setting choice, not something this file can
// enforce; if it's ever turned back on, signUp() below still succeeds and
// still redirects to /pending, it's just that the user won't be able to
// sign in again until they click the confirmation email (middleware.ts's
// "no session -> /login" branch covers that gracefully, so this isn't a
// broken state, just a slower one).
//
// Same (prevState, formData) -> state shape as React's useActionState, one
// level up from app/(auth)/login/actions.ts's plain-args pattern because the
// register form needs field-level validation errors without a client-side
// duplicate of the email/password rules.

import { redirect } from "next/navigation";
import { getUserClient } from "@/lib/supabase/server";

export type RegisterState = { error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function registerAction(_prevState: RegisterState, formData: FormData): Promise<RegisterState> {
  // Honeypot: a real visitor never sees or fills this field (form must hide
  // it off-screen / via CSS, not `type="hidden"` — some bots skip those).
  // Bots that blindly fill every input trip it. Fail with the SAME generic
  // message a real validation error shows, and never call signUp() at all —
  // don't let a bot learn its payload was recognized.
  const honeypot = (formData.get("website") ?? "").toString();
  if (honeypot.trim() !== "") {
    return { error: "สมัครไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }

  const email = (formData.get("email") ?? "").toString().trim().toLowerCase();
  const password = (formData.get("password") ?? "").toString();

  if (!email || !EMAIL_RE.test(email)) return { error: "รูปแบบอีเมลไม่ถูกต้อง" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` };
  }

  let supabase;
  try {
    supabase = await getUserClient();
  } catch (err) {
    console.error("registerAction: getUserClient() failed", err);
    return { error: "ระบบสมัครสมาชิกยังไม่พร้อมใช้งาน (ขาด Supabase anon key) — แจ้งผู้ดูแลระบบ" };
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // Deliberately generic for EVERY signUp failure, including "email
    // already registered" — a distinct message there is an account-
    // enumeration oracle (lets anyone probe which emails already have an
    // account at this shop). If someone with an existing account lands
    // here, they're pointed at /login instead of told why signup failed.
    console.error("registerAction: signUp failed", error);
    return {
      error: "สมัครไม่สำเร็จ ตรวจสอบอีเมล/รหัสผ่านแล้วลองใหม่ หรือเข้าสู่ระบบถ้ามีบัญชีอยู่แล้ว",
    };
  }

  // With "Confirm email" off (owner's decision), signUp() above already
  // attached an active session via getUserClient()'s cookie-writing client
  // — same mechanism as login/actions.ts's signInWithPassword(). /pending
  // is reachable with a session but no shop_member row (middleware.ts rule
  // (b)); the owner approves from /settings/members.
  redirect("/pending");
}
