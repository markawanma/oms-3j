import { Logo } from "@/components/brand/Logo";
import { LoginForm } from "@/components/domain/LoginForm";

// app/(auth)/login/page.tsx — Phase A1 (auth infra, additive). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
// Reachable today, but nobody is forced here yet (middleware.ts does not
// gate — hard-gate is A2). No signup link on purpose: provisioning is
// service-role-only (design §A.5), invite-only via scripts/provision-member.mjs.
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-4 text-center text-lg font-bold text-zinc-900">เข้าสู่ระบบ</h1>
        <LoginForm />
      </div>
    </div>
  );
}
