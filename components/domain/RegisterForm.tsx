"use client";

// components/domain/RegisterForm.tsx — A2-lite (register → pending →
// owner-approves). See app/(auth)/register/actions.ts for the server-side
// contract (registerAction). Self-service signup: new accounts land in
// "pending" (app/(auth)/pending/page.tsx), which shows the new user their
// own 6-char verify code — they relay it to the owner out-of-band (e.g.
// LINE), and the owner enters it at /settings/members to approve them.
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { registerAction } from "@/app/(auth)/register/actions";

const MIN_PASSWORD_LENGTH = 8;

export function RegisterForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
      return;
    }
    if (password !== confirmPassword) {
      setError("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    let result;
    try {
      result = await registerAction({}, formData);
    } catch (err) {
      // registerAction() is expected to redirect() (e.g. to /pending) on
      // success — Next.js implements that by throwing NEXT_REDIRECT, which
      // must be allowed to propagate up to the framework, not swallowed as
      // an app error here.
      if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;
      setSubmitting(false);
      setError("เกิดข้อผิดพลาดที่ไม่คาดคิด — ลองใหม่อีกครั้ง");
      return;
    }
    setSubmitting(false);
    if (result.error) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4" noValidate>
      {error && <ErrorBanner message={error} />}

      {/* Honeypot — invisible to real users (aria-hidden + not tab-reachable).
          Bots that blind-fill every field in the DOM trip this; a real user
          never sees or touches it. Server side (registerAction) is expected
          to silently reject/soft-fail when this is non-empty. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-3 text-base"
          placeholder="you@3jthailand.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-3 text-base"
        />
        <p className="mt-1 text-xs text-zinc-500">อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-700">
          ยืนยันรหัสผ่าน
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-3 text-base"
        />
      </div>

      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        สมัคร
      </Button>

      <p className="text-center text-sm text-zinc-500">
        มีบัญชีแล้ว?{" "}
        <Link href="/login" className="font-medium text-primary-700 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </form>
  );
}
