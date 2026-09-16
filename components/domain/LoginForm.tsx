"use client";

// components/domain/LoginForm.tsx — Phase A1 (auth infra, additive) +
// A2-lite (register/approve, 16 ก.ย. 69). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { signInWithPassword } from "@/app/(auth)/login/actions";

export interface AuthProvider {
  id: string;
  label: string;
}

export function LoginForm({
  next,
  providers = [],
}: {
  /** Post-login redirect target, from the page's `?next=` search param.
   * Carried through as a hidden form field for when signInWithPassword()
   * (app/(auth)/login/actions.ts) is wired to read + honor it — today that
   * action always redirects to /dashboard regardless of this value.
   * ⚠️ Confirm with backend-dev before relying on `next` actually working. */
  next?: string;
  /** Slot for future OAuth providers (e.g. Google). Empty by default — no
   * divider/buttons render until this is non-empty, so today's login form
   * is visually unchanged. */
  providers?: AuthProvider[];
}) {
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

      {next && <input type="hidden" name="next" value={next} />}

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

      <p className="text-center text-sm text-zinc-500">
        ยังไม่มีบัญชี?{" "}
        <Link href="/register" className="font-medium text-primary-700 hover:underline">
          สมัครสมาชิก
        </Link>
      </p>

      {providers.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-xs text-zinc-400" role="separator">
            <span className="h-px flex-1 bg-zinc-200" />
            หรือ
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <Button key={p.id} type="button" variant="secondary" className="w-full">
                {p.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </form>
  );
}
