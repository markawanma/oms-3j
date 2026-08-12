"use client";

// PromoAttributionPageClient — /marketing/attribution: log form + per-code
// summary cards + recent-entries table. Owner/admin only (page-gated).
// Summary + entries are server-fetched once; delete calls the server action
// then router.refresh() to re-pull both (mirrors AdSpendForm/AudiencePageClient).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ticket, Trash2 } from "lucide-react";
import { deletePromoAttribution } from "@/lib/actions/marketing";
import type { PromoAttributionEntry, PromoAttributionSummary } from "@/lib/marketing/types";
import type { CrmChannelOption } from "@/lib/crm/order-override";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { PromoAttributionForm } from "./PromoAttributionForm";

function fmtBaht(n: number): string {
  return `฿${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function PromoAttributionPageClient({
  summary,
  entries,
  channels,
}: {
  summary: PromoAttributionSummary[];
  entries: PromoAttributionEntry[];
  channels: CrmChannelOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<PromoAttributionEntry | null>(null);

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deletePromoAttribution(target.id);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ลบรายการแล้ว");
      setDeleteTarget(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Header />

      <PromoAttributionForm channels={channels} />

      {summary.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="ยังไม่มีรายการบันทึก"
          description='เมื่อลูกค้าพิมพ์โค้ด (เช่น "รับสิทธิ์99") ในแชทหลังดู LINE broadcast ให้บันทึกยอดขายที่นี่ — จะรวมยอดเป็นการ์ดสรุปต่อโค้ดให้อัตโนมัติ'
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {summary.map((s) => (
              <div key={s.code} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
                <p className="truncate text-sm font-semibold text-zinc-700" title={s.code}>
                  {s.code}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-primary-700">{fmtBaht(s.totalAmount)}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {s.entries.toLocaleString("en-US")} รายการ · เฉลี่ย {fmtBaht(s.avgAmount)}/รายการ
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {s.firstOn === s.lastOn ? s.firstOn : `${s.firstOn} – ${s.lastOn}`}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-zinc-800">รายการล่าสุด</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                    <th className="py-2 pr-3">วันที่</th>
                    <th className="py-2 pr-3">โค้ด</th>
                    <th className="py-2 pr-3 text-right">ยอด</th>
                    <th className="py-2 pr-3">ช่องทาง</th>
                    <th className="py-2 pr-3">ลูกค้า</th>
                    <th className="py-2 pr-3">หมายเหตุ</th>
                    <th className="py-2 text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{e.occurredOn}</td>
                      <td className="py-2 pr-3 font-medium text-zinc-800">{e.code}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(e.amount)}</td>
                      <td className="py-2 pr-3 text-zinc-600">{e.channelName ?? "—"}</td>
                      <td className="py-2 pr-3 text-zinc-600">{e.customerRef ?? "—"}</td>
                      <td className="max-w-[160px] truncate py-2 pr-3 text-zinc-500" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(e)}
                          aria-label={`ลบรายการ ${e.code} วันที่ ${e.occurredOn}`}
                          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="ลบรายการนี้?">
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">
              ลบรายการโค้ด <span className="font-semibold text-zinc-800">{deleteTarget.code}</span> ยอด{" "}
              <span className="font-semibold text-zinc-800">{fmtBaht(deleteTarget.amount)}</span> วันที่{" "}
              {deleteTarget.occurredOn} — ยกเลิกไม่ได้
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={pending}>
                ยกเลิก
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={pending}>
                ลบรายการ
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-lg font-bold text-zinc-900">วัดผลโค้ด (Attribution)</h1>
      <p className="mt-0.5 text-sm text-zinc-500">
        LINE broadcast ไม่มี tracking link อัตโนมัติ — บันทึกยอดขายที่ลูกค้าพิมพ์โค้ดในแชทด้วยมือ เพื่อดูว่าแคมเปญได้ผลแค่ไหน
      </p>
    </div>
  );
}
