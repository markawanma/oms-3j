import { Logo } from "@/components/brand/Logo";
import { RegisterForm } from "@/components/domain/RegisterForm";

// app/(auth)/register/page.tsx — A2-lite (register → pending → owner
// approves). Self-service signup replaces the old invite-only
// scripts/provision-member.mjs flow from A1. New accounts have no shop
// membership until an owner approves them from /settings/members — see
// app/(auth)/pending/page.tsx for what the new user sees while waiting.
export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo />
          <p className="text-2xl font-bold tracking-tight text-primary-700">3J Insight</p>
          <p className="text-sm text-zinc-500">CRM · การตลาด · วิเคราะห์ยอดขาย</p>
        </div>
        <h1 className="mb-4 text-center text-sm font-semibold text-zinc-600">สมัครสมาชิก</h1>
        <RegisterForm />
      </div>
    </div>
  );
}
