"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, CheckCircle2, X } from "lucide-react";
import { crmDismissMergeCandidate, crmMergeCustomer } from "@/lib/actions/crm";
import { MERGE_CONFIDENCE_LABEL_TH, MERGE_CONFIDENCE_TONE } from "@/lib/crm/merge";
import type { CrmMergeCandidateRow, MergeCandidateSide } from "@/lib/crm/merge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatTHB } from "@/lib/format";
import { formatCount } from "@/lib/tiktok/format";

/** Default survivor pick per design §3: the side with more complete data
 * (more orders wins; revenue is the tiebreaker) — user can still flip it. */
function defaultSurvivorIsA(row: CrmMergeCandidateRow): boolean {
  if (row.a.orderCount !== row.b.orderCount) return row.a.orderCount > row.b.orderCount;
  return row.a.revenueSum >= row.b.revenueSum;
}

function SideCard({
  side,
  isSurvivor,
  onPick,
}: {
  side: MergeCandidateSide;
  isSurvivor: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isSurvivor}
      className={`flex min-h-11 flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
        isSurvivor ? "border-primary-400 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-bold text-slate-900">{side.name ?? "(ไม่มีชื่อ)"}</p>
        {isSurvivor && (
          <span className="shrink-0 rounded-full bg-primary-600 px-2 py-0.5 text-[0.65rem] font-bold text-white">
            เก็บไว้
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">{side.province ?? "ไม่ทราบจังหวัด"}</p>
      <p className="text-xs text-slate-600">
        {formatCount(side.orderCount)} ออเดอร์ · {formatTHB(side.revenueSum)}
      </p>
      {side.identities.length > 0 && (
        <p className="truncate text-[0.68rem] text-slate-400">{side.identities.join(", ")}</p>
      )}
    </button>
  );
}

function MergeCandidateCard({
  row,
  onResolved,
}: {
  row: CrmMergeCandidateRow;
  onResolved: (aId: string, bId: string) => void;
}) {
  const { push } = useToast();
  const [survivorIsA, setSurvivorIsA] = useState(() => defaultSurvivorIsA(row));
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const survivor = survivorIsA ? row.a : row.b;
  const victim = survivorIsA ? row.b : row.a;

  function handleMerge() {
    startTransition(async () => {
      const result = await crmMergeCustomer(survivor.customerId, victim.customerId);
      if (!result.ok) {
        setError(result.error);
        push(result.error, "error");
        setConfirmingMerge(false);
        return;
      }
      push("รวมลูกค้าสำเร็จ");
      onResolved(row.a.customerId, row.b.customerId);
    });
  }

  function handleDismiss() {
    startTransition(async () => {
      const result = await crmDismissMergeCandidate(row.a.customerId, row.b.customerId);
      if (!result.ok) {
        setError(result.error);
        push(result.error, "error");
        return;
      }
      push("ทำเครื่องหมาย \"ไม่ใช่คนเดียวกัน\" แล้ว");
      onResolved(row.a.customerId, row.b.customerId);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={MERGE_CONFIDENCE_TONE[row.confidence]}>
          ความมั่นใจ{MERGE_CONFIDENCE_LABEL_TH[row.confidence]}
        </Badge>
        <button
          type="button"
          onClick={() => setSurvivorIsA((v) => !v)}
          disabled={pending}
          className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
          สลับฝั่งเก็บไว้
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SideCard side={row.a} isSurvivor={survivorIsA} onPick={() => setSurvivorIsA(true)} />
        <SideCard side={row.b} isSurvivor={!survivorIsA} onPick={() => setSurvivorIsA(false)} />
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {confirmingMerge ? (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-amber-800">
            ยืนยันรวม “{victim.name ?? "(ไม่มีชื่อ)"}” เข้ากับ “{survivor.name ?? "(ไม่มีชื่อ)"}”? ยกเลิกภายหลังไม่ได้
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setConfirmingMerge(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button variant="primary" size="sm" loading={pending} onClick={handleMerge}>
              ยืนยันรวม
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5 sm:flex-row">
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirmingMerge(true)}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            รวมเป็นคนเดียว
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" loading={pending} onClick={handleDismiss}>
            <X className="h-4 w-4" aria-hidden="true" />
            ไม่ใช่คนเดียวกัน
          </Button>
        </div>
      )}
    </div>
  );
}

export function MergeCandidateList({ initialRows }: { initialRows: CrmMergeCandidateRow[] }) {
  const [rows, setRows] = useState(initialRows);

  function handleResolved(aId: string, bId: string) {
    setRows((prev) => prev.filter((r) => !(r.a.customerId === aId && r.b.customerId === bId)));
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-slate-700">ตรวจครบทุกคู่แล้ว</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <MergeCandidateCard
          key={`${row.a.customerId}-${row.b.customerId}`}
          row={row}
          onResolved={handleResolved}
        />
      ))}
    </div>
  );
}
