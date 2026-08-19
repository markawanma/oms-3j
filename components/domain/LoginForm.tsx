"use client";

// components/domain/LoginForm.tsx — Phase A1 (auth infra, additive). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { signInWithPassword } from "@/app/(auth)/login/actions";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signInWithPassword({ email, password });
    // On success the server action redirect()s (throws NEXT_REDIRECT before
    // returning) — this line only runs when sign-in actually failed.
    setSubmitting(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
          อีเมล
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-3 text-base"
        />
      </div>

      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}
