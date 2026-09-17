import { Lock } from "lucide-react";
import { listPendingUsers, listMembers } from "@/lib/actions/members";
import { getSessionUser } from "@/lib/auth/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MembersPanel } from "@/components/domain/settings/MembersPanel";

export const dynamic = "force-dynamic";

// requireOwnerSession() (lib/auth/session.ts, called by both
// listPendingUsers/listMembers) throws exactly these two messages for "not
// an owner" — anything else caught below is an unexpected failure (DB down,
// listUsers() against Supabase Auth failing, etc.) and must NOT be shown as
// the same calm "owner only" empty state, or a real outage looks identical
// to normal access-denied UX and nobody notices it's broken.
const OWNER_ONLY_MESSAGES = new Set(["ไม่ได้เข้าสู่ระบบ", "ต้องเป็นเจ้าของร้านเท่านั้น"]);

// /settings/members — A2-lite. Owner-only: listPendingUsers()/listMembers()
// (lib/actions/members.ts) are expected to throw for non-owner callers
// (contract, not this file's job to re-check role) — caught below and shown
// as a plain "owner only" empty state instead of a scary error/crash, same
// UX choice as /settings (SettingsForm) and /crm/merge use for their
// owner/admin-gated pages.
export default async function MembersSettingsPage() {
  let pending, members, currentUserId: string | null;
  try {
    const [p, m, sessionUser] = await Promise.all([listPendingUsers(), listMembers(), getSessionUser()]);
    pending = p;
    members = m;
    currentUserId = sessionUser?.id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (OWNER_ONLY_MESSAGES.has(message)) {
      return (
        <EmptyState
          icon={Lock}
          title="เฉพาะเจ้าของ"
          description="หน้านี้ใช้จัดการสมาชิกได้เฉพาะเจ้าของร้านเท่านั้น"
        />
      );
    }
    console.error("MembersSettingsPage: load failed", err);
    return <ErrorState message="โหลดข้อมูลสมาชิกไม่สำเร็จ ลองรีเฟรชหน้าใหม่อีกครั้ง" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">จัดการสมาชิก</h1>
        <p className="mt-0.5 text-sm text-zinc-500">อนุมัติสมาชิกใหม่ที่สมัครเข้ามา และจัดการคนในทีม</p>
      </div>
      <MembersPanel pending={pending} members={members} currentUserId={currentUserId} />
    </div>
  );
}
