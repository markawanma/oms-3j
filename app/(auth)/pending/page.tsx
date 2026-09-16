import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { getSessionUser, verifyCodeFor } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";

export const dynamic = "force-dynamic"; // must re-check session + approval status on every visit

// app/(auth)/pending/page.tsx — A2-lite. Landing spot for a signed-up-but-
// not-yet-approved account: no shop_member row exists yet, so there's
// nothing to route them into. Shows the 6-char verify code
// (lib/auth/session.ts verifyCodeFor) the owner types into /settings/members
// to approve them — this is the channel the design uses instead of email
// verification (owner approves over LINE using this code as the shared
// secret that proves "this signup really is who I think it is").
export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const code = verifyCodeFor(user.id);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo />
        </div>

        <h1 className="text-lg font-bold text-zinc-900">รอเจ้าของอนุมัติ</h1>
        <p className="mt-2 text-sm text-zinc-600">
          บัญชี <span className="font-medium text-zinc-900">{user.email}</span> รอเจ้าของอนุมัติ
        </p>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">รหัสยืนยัน</p>
          <p className="mt-1 text-3xl font-bold tracking-[0.3em] text-primary-700">{code}</p>
          <p className="mt-3 text-xs text-zinc-500">ส่งรหัสนี้ให้เจ้าของทาง LINE เพื่ออนุมัติ</p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {/* Plain anchor (not next/link) — deliberately forces a full page
              reload so the server re-runs getMembership() and, once
              approved, middleware/dashboard routing takes over. */}
          <a
            href="/pending"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-700 hover:bg-zinc-50"
          >
            ตรวจสอบอีกครั้ง
          </a>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium text-zinc-500 hover:bg-zinc-100"
            >
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
