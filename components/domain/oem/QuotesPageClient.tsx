"use client";

// QuotesPageClient — /oem/quotes (T6): registry table + won/lost status
// change. "lost" requires a reason (DB-enforced, oem_quote_set_status) — a
// dialog collects it rather than a bare confirm().

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import { setQuoteStatus } from "@/lib/actions/oem";
import type { OemQuoteRow, OemQuoteStatus } from "@/lib/oem/types";
import { OEM_QUOTE_STATUS_LABEL_TH } from "@/lib/oem/types";
import { fmtPct } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { LostQuoteDialog } from "./LostQuoteDialog";

const STATUS_TONE: Record<OemQuoteStatus, BadgeTone> = {
  draft: "slate",
  quoted: "blue",
  won: "green",
  lost: "red",
  expired: "orange",
  rejected: "slate",
  superseded: "slate",
};

const FILTER_TABS: { value: OemQuoteStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "draft", label: "ร่าง" },
  { value: "quoted", label: "เสนอราคาแล้ว" },
  { value: "won", label: "ปิดงาน" },
  { value: "lost", label: "แพ้งาน" },
  { value: "expired", label: "หมดอายุ" },
  { value: "superseded", label: "ถูกแทนที่" },
];

function DaysLeftCell({ daysLeft, isExpired }: { daysLeft: number | null; isExpired: boolean }) {
  if (daysLeft == null) return <span className="text-zinc-400">—</span>;
  if (isExpired) return <span className="font-semibold text-red-600">หมดอายุแล้ว</span>;
  const tone = daysLeft <= 3 ? "text-amber-600 font-semibold" : "text-zinc-700";
  return <span className={tone}>{daysLeft} วัน</span>;
}


export function QuotesPageClient({ quotes }: { quotes: OemQuoteRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<OemQuoteStatus | "all">("all");
  const [lostTarget, setLostTarget] = useState<OemQuoteRow | null>(null);
  const [wonPendingId, setWonPendingId] = useState<string | null>(null);
  const [, startWon] = useTransition();

  const visible = useMemo(() => (filter === "all" ? quotes : quotes.filter((q) => q.status === filter)), [quotes, filter]);

  function markWon(q: OemQuoteRow) {
    setWonPendingId(q.id);
    startWon(async () => {
      const result = await setQuoteStatus({ quoteId: q.id, status: "won" });
      setWonPendingId(null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`ปิดงาน ${q.quoteNo} แล้ว`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">ใบเสนอราคา OEM</h1>
          <p className="mt-0.5 text-sm text-zinc-500">ทะเบียนใบเสนอราคา — ติดตามสถานะและวันหมดอายุ</p>
        </div>
        <Link href="/oem/quote">
          <Button type="button" variant="primary" size="sm">
            คิดราคาใหม่
          </Button>
        </Link>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {FILTER_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setFilter(t.value)}
            className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors ${
              filter === t.value ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={quotes.length === 0 ? ClipboardList : Search}
          title={quotes.length === 0 ? "ยังไม่มีใบเสนอราคา" : "ไม่พบใบเสนอราคาในสถานะนี้"}
          description={quotes.length === 0 ? "เริ่มคิดราคางาน OEM ที่หน้า “คิดราคา”" : "ลองเปลี่ยนตัวกรองสถานะ"}
          action={
            quotes.length === 0 ? (
              <Link href="/oem/quote">
                <Button type="button" variant="primary" size="sm">
                  คิดราคางานแรก
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pl-3.5 pr-3">เลขที่</th>
                <th scope="col" className="py-2 pr-3">ลูกค้า</th>
                <th scope="col" className="py-2 pr-3 text-right">รายการ</th>
                <th scope="col" className="py-2 pr-3 text-right">ยอดรวม</th>
                <th scope="col" className="py-2 pr-3 text-right">ส่วนลด</th>
                <th scope="col" className="py-2 pr-3 text-right">margin</th>
                <th scope="col" className="py-2 pr-3">สถานะ</th>
                <th scope="col" className="py-2 pr-3">เหลือ</th>
                <th scope="col" className="py-2 pr-3.5">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q) => (
                <tr
                  key={q.id}
                  className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 ${q.status === "superseded" ? "opacity-50" : ""}`}
                >
                  <td className="py-2 pl-3.5 pr-3 font-medium text-zinc-800">
                    <Link href={`/oem/quotes/${q.id}`} className="text-primary-700 hover:underline">
                      {q.quoteNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">{q.customerName || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{q.itemCount || 1}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-800">
                    {q.grandTotal != null ? formatTHB(q.grandTotal) : q.quoteTotal != null ? formatTHB(q.quoteTotal) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-600">{q.discountThb > 0 ? formatTHB(q.discountThb) : "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtPct(q.marginChargedPct)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={STATUS_TONE[q.status]}>{OEM_QUOTE_STATUS_LABEL_TH[q.status]}</Badge>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <DaysLeftCell daysLeft={q.daysLeftTh} isExpired={q.isExpiredTh} />
                  </td>
                  <td className="py-2 pr-3.5">
                    {q.status === "quoted" && (
                      <div className="flex gap-1.5">
                        <Button type="button" variant="secondary" size="sm" loading={wonPendingId === q.id} onClick={() => markWon(q)}>
                          ปิดงาน
                        </Button>
                        <Button type="button" variant="danger" size="sm" onClick={() => setLostTarget(q)}>
                          แพ้งาน
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quotes.length > 0 && <p className="text-xs text-zinc-400">แสดง {visible.length}/{quotes.length} ใบ</p>}

      {lostTarget && (
        <LostQuoteDialog
          quote={lostTarget}
          onClose={() => setLostTarget(null)}
          onConfirmed={() => {
            setLostTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
