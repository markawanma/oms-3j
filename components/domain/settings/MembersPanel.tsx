"use client";

// MembersPanel — /settings/members (A2-lite). Reads (`pending`/`members`)
// are server-fetched by the page and used directly as props (no local copy
// of the lists), same pattern as ProductsPageClient/SkuPrefixPageClient:
// every mutation calls router.refresh() to re-run the RSC page and pass
// fresh props back down. This matters here specifically because approving
// someone moves them from the "pending" table to the "members" table — a
// single server refetch is the only way to keep both tables consistent
// without hand-rolling cross-list optimistic updates.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2, UserPlus, Users2 } from "lucide-react";
import type { PendingUser, Member } from "@/lib/actions/members";
import { approveMember, removeMember } from "@/lib/actions/members";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { formatBangkokTime } from "@/lib/format";

const ROLE_LABEL_TH: Record<Member["role"], string> = {
  owner: "เจ้าของ",
  admin: "แอดมิน",
  staff: "พนักงาน",
};

const ROLE_BADGE_TONE: Record<Member["role"], BadgeTone> = {
  owner: "black",
  admin: "blue",
  staff: "slate",
};

function PendingRow({ user }: { user: PendingUser }) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleApprove() {
    const trimmed = code.trim();
    if (trimmed.length !== 6) {
      setError("กรอกรหัสยืนยัน 6 ตัวให้ครบ");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await approveMember({ userId: user.id, role, code: trimmed.toUpperCase() });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`อนุมัติ ${user.email} แล้ว`);
      router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-3 py-2 text-zinc-800">{user.email}</td>
      <td className="px-3 py-2 whitespace-nowrap text-zinc-600">{formatBangkokTime(user.createdAt)}</td>
      <td className="px-3 py-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ABC123"
          aria-label={`รหัสยืนยันของ ${user.email}`}
          className="min-h-11 w-24 rounded-md border border-zinc-300 px-2 text-center font-mono text-sm uppercase tracking-widest"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "staff")}
          aria-label={`role สำหรับ ${user.email}`}
          className="min-h-11 rounded-md border border-zinc-300 px-2 text-sm"
        >
          <option value="staff">พนักงาน</option>
          <option value="admin">แอดมิน</option>
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <Button type="button" size="sm" loading={pending} onClick={handleApprove}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            อนุมัติ
          </Button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

function PendingTable({ pending }: { pending: PendingUser[] }) {
  if (pending.length === 0) {
    return <EmptyState icon={UserPlus} title="ไม่มีคนรออนุมัติ" description="สมัครใหม่จะมาแสดงที่นี่" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
              อีเมล
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
              สมัครเมื่อ
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
              รหัสยืนยัน
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
              role
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold text-zinc-600">
              จัดการ
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {pending.map((u) => (
            <PendingRow key={u.id} user={u} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersTable({ members, currentUserId }: { members: Member[]; currentUserId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    startTransition(async () => {
      const result = await removeMember(target.userId);
      if (!result.ok) {
        toast.push(result.error, "error");
        setRemoving(null);
        return;
      }
      toast.push(`ถอด ${target.email} ออกจากทีมแล้ว`);
      setRemoving(null);
      router.refresh();
    });
  }

  if (members.length === 0) {
    return <EmptyState icon={Users2} title="ยังไม่มีสมาชิก" />;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                อีเมล
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                role
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold text-zinc-600">
                จัดการ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {members.map((m) => {
              const isSelfOwner = m.role === "owner" && m.userId === currentUserId;
              return (
                <tr key={m.userId}>
                  <td className="px-3 py-2 text-zinc-800">{m.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={ROLE_BADGE_TONE[m.role]}>{ROLE_LABEL_TH[m.role]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!isSelfOwner && (
                      <button
                        type="button"
                        onClick={() => setRemoving(m)}
                        aria-label={`ถอด ${m.email} ออกจากทีม`}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title="ถอดสมาชิกออก">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            ต้องการถอด <span className="font-medium">{removing?.email}</span> ออกจากทีมใช่ไหม?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button type="button" variant="danger" onClick={confirmRemove} loading={pending}>
              ถอดออก
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function MembersPanel({
  pending,
  members,
  currentUserId,
}: {
  pending: PendingUser[];
  members: Member[];
  currentUserId: string | null;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">รออนุมัติ ({pending.length})</h2>
        <PendingTable pending={pending} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">สมาชิก ({members.length})</h2>
        <MembersTable members={members} currentUserId={currentUserId} />
      </section>

      <p className="text-xs text-zinc-400">role ตอนนี้เป็นป้าย ยังไม่จำกัดสิทธิ์หน้าไหน (A2)</p>
    </div>
  );
}
