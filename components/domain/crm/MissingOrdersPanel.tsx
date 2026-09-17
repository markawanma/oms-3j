"use client";

// MissingOrdersPanel — cancel-detection UI (design: Yoda, 11 ก.ย. 69 §6),
// backed by lib/actions/import-missing-orders.ts (getMissingOrders /
// deleteMissingOrders). Rendered in TWO places:
//   - OrderImportClient.tsx: auto, right after a successful order-report
//     commit (fetch happens in the PARENT, pattern fetchWarningsFor — see
//     that file's fetchAndAttachMissingOrders).
//   - ImportBatchHistory.tsx: on-demand, "ตรวจออเดอร์ที่หายไป" button on ANY
//     transformed order batch row (fixed 14 ก.ย. 69 — used to be hardcoded to
//     the latest transformed order batch only; fetch also happens in the
//     parent, refetched whenever the target batchId changes).
// This component is deliberately presentational for the FETCH (it never
// calls getMissingOrders itself — `result` is a controlled prop: undefined =
// loading, null = fetch failed, object = loaded) but owns the DELETE
// interaction end-to-end (selection, confirm modal, calling
// deleteMissingOrders, and locally removing deleted rows from the visible
// list without a full refetch).
//
// Money rule (task brief, verbatim): "ห้ามคำนวณยอดรวมฝั่ง client ถ้า DB คืน
// มาแล้ว (ใช้ candidate_revenue_thb) — ยอด 'ที่เลือก' ให้บวกจาก revenue_thb
// ของแถวที่ติ๊ก (บวกอย่างเดียว)". So: candidateRevenueThb (unselected total)
// always comes straight from the DB response, only ever adjusted by
// SUBTRACTING the DB-reported deletedRevenueThb after a delete succeeds —
// the "selected" total is the one and only client-side sum, and it is
// nothing but addition of already-DB-computed per-row revenueThb, never a
// derived/recomputed formula.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Loader2, Trash2, XCircle } from "lucide-react";
import { deleteMissingOrders, getMissingOrdersWriteStatus } from "@/lib/actions/import-missing-orders";
import {
  isMissingOrdersWriteDisabledError,
  type MissingOrderCandidate,
  type MissingOrdersBlockedReason,
  type MissingOrdersEvidence,
  type MissingOrdersGroup,
  type MissingOrdersResult,
} from "@/lib/import/missing-orders-types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { formatTHB } from "@/lib/format";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";
import { formatDateRange } from "@/lib/crm/import-client";

// Display-only copy of the same cap enforced by import_delete_orders /
// import_missing_orders (0113/0115) — kept in sync manually, same trade-off
// noted in lib/actions/import-missing-orders.ts's own DELETE_IDS_MAX comment
// ("This constant is display-only here ... the DB is the one enforcing it").
const DELETE_IDS_MAX = 200;

// file_rows_skipped needs the live skippedRows count interpolated (N แถว) —
// everything else is a static message, so this is a function, not a plain
// Record lookup, to keep the one dynamic case from forcing an awkward
// string-template split at every call site.
function blockedReasonMessage(reason: MissingOrdersBlockedReason, evidence: MissingOrdersEvidence): string {
  switch (reason) {
    case "shop_or_source_mismatch":
      return "ไฟล์นี้ไม่ใช่รายงานยอดขายที่ตรวจออเดอร์ที่หายไปได้";
    case "batch_not_transformed":
      return "ไฟล์นี้ยังนำเข้าไม่เสร็จ — ตรวจได้หลังนำเข้าสำเร็จเท่านั้น";
    case "batch_has_unresolved_rows":
      return "ไฟล์นี้มีแถวที่ยังไม่ผ่านการนำเข้า (ค้าง/error) — แก้ไขให้ครบก่อนแล้วตรวจใหม่";
    case "unparseable_order_no":
      return "มีเลขที่ออเดอร์ในไฟล์ที่ระบบอ่านรูปแบบไม่ได้ — ตรวจสอบไฟล์ก่อน";
    case "channels_unresolved":
      return "ไฟล์นี้มีช่องทางที่ระบบยังไม่รู้จัก — แก้ alias ช่องทางก่อน";
    case "file_rows_skipped":
      return `ไฟล์นี้มี ${formatCount(evidence.skippedRows)} แถวที่เลขออเดอร์ว่าง ระบบข้ามไปตอนนำเข้า จึงตัดสินไม่ได้ว่าอะไรหายจริง — ตรวจไฟล์ต้นฉบับก่อน`;
    case "empty_batch":
      return "ไฟล์นี้ไม่มีแถวที่นำเข้าสำเร็จเลย (0 แถว) — ไม่มีอะไรให้ตรวจ เปิดไฟล์ต้นฉบับดูว่ามีข้อมูลจริงไหมก่อนอัปโหลดใหม่";
    case "too_many":
      return "ไฟล์นี้ต่างจากระบบมากผิดปกติ ตรวจโหมด export ก่อน";
    default:
      return "ตรวจออเดอร์ที่หายไปไม่ได้";
  }
}

function formatGroupRange(g: MissingOrdersGroup): string {
  return `${g.prefix}${g.lo}–${g.prefix}${g.hi}`;
}

/** Earliest dateLo / latest dateHi across every prefix group — for the "1–9
 * ก.ย." span in the evidence line. Returns nulls when there are no groups
 * (blocked before grouping, or a genuinely empty file) rather than guessing. */
function evidenceDateSpan(groups: MissingOrdersGroup[]): { min: string | null; max: string | null } {
  if (groups.length === 0) return { min: null, max: null };
  let min = groups[0].dateLo;
  let max = groups[0].dateHi;
  for (const g of groups) {
    if (g.dateLo < min) min = g.dateLo;
    if (g.dateHi > max) max = g.dateHi;
  }
  return { min, max };
}

function EvidenceBar({ evidence, monotonicWarnings }: { evidence: MissingOrdersEvidence; monotonicWarnings: number }) {
  const { min, max } = evidenceDateSpan(evidence.groups);
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
      <p>
        อ้างอิง <span className="font-medium text-zinc-800">{evidence.fileName ?? "(ไม่ทราบชื่อไฟล์)"}</span>
        {evidence.groups.length > 0 && <> · ครอบคลุม {evidence.groups.map(formatGroupRange).join(", ")}</>}
        {(min || max) && <> · {formatDateRange(min, max)}</>}
        {evidence.channels.length > 0 && <> · ช่องทาง {evidence.channels.map((c) => c.name).join(", ")}</>}
        {" · "}
        {formatCount(evidence.fileOrderCount)} ใบในไฟล์
        {" · "}
        ข้ามแถวเลขออเดอร์ว่าง {formatCount(evidence.skippedRows)} แถว
      </p>
      {monotonicWarnings > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          พบลำดับเลขออเดอร์ผิดปกติในไฟล์ {formatCount(monotonicWarnings)} จุด — ไม่บล็อก แต่ตรวจสอบก่อนลบ
        </p>
      )}
    </div>
  );
}

export function MissingOrdersPanel({
  batchId,
  result,
  onRetry,
}: {
  batchId: string;
  /** undefined = loading, null = fetch failed (fail-soft: never throw, never
   * take down the import page), object = loaded. Fetched by the PARENT
   * (OrderImportClient / ImportBatchHistory) — see file header. */
  result: MissingOrdersResult | null | undefined;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [revenueRemoved, setRevenueRemoved] = useState(0);
  const [lastDeleted, setLastDeleted] = useState<{ count: number; revenue: number } | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // C-2 write switch (lib/actions/import-missing-orders.ts). Two paths set
  // this, in order of preference:
  //   1. PROACTIVE — getMissingOrdersWriteStatus() fetched once on mount
  //      below (12 ก.ย. 69, Han added this on request; DB round-trip since
  //      0117, analytics.crm_feature_flag — was a plain env-var read
  //      before).
  //   2. REACTIVE fallback — isMissingOrdersWriteDisabledError() on an
  //      actual deleteMissingOrders failure (handleConfirmDelete below),
  //      for the narrow race where the status fetch said "enabled" but the
  //      gate flipped/was already off by the time the real write landed.
  // Fires once on mount only ([] deps below) — this is a per-shop DB row
  // (analytics.crm_feature_flag), not something this panel polls for
  // mid-session; a second attempt on a different batch in the same session
  // doesn't re-fetch, it just reuses what mount already learned.
  const [writeDisabled, setWriteDisabled] = useState(false);

  // Proactive check — fires once per mount, independent of `result` (this is
  // a per-shop flag, not tied to any one batch). M-2 (security review 14
  // ก.ย. 69, post-0117): fail-CLOSED — a thrown/!ok response now disables
  // the button too, same as an explicit enabled:false. A broken status
  // check must never render identically to a genuinely open gate; the
  // reactive fallback above is the safety net for the OPPOSITE race (status
  // said enabled but the real call lands after the gate closed), not for
  // covering a failed status read with an optimistic "enabled".
  useEffect(() => {
    let cancelled = false;
    void getMissingOrdersWriteStatus().then((res) => {
      if (!cancelled) setWriteDisabled(!res.ok || !res.data.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fresh successful fetch -> reset all local delete bookkeeping and
  // default-select every candidate ("ตาราง checkbox ติ๊กทั้งหมด default").
  useEffect(() => {
    if (result) {
      setSelected(new Set(result.candidates.map((c) => c.factOrderId)));
      setRemovedIds(new Set());
      setRevenueRemoved(0);
      setLastDeleted(null);
      setDeleteError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on a genuinely new fetch result
  }, [result]);

  if (result === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        กำลังตรวจออเดอร์ที่หายไปจากไฟล์นี้…
      </div>
    );
  }

  if (result === null) {
    // Fail-soft: the import itself already succeeded, this is just "couldn't
    // check for cancellations" — never render this as a page-blocking error.
    return <ErrorBanner message="ตรวจออเดอร์ที่หายไปไม่สำเร็จ" onRetry={onRetry} />;
  }

  if (result.blockedReason) {
    return (
      <div className="flex flex-col gap-3">
        <EvidenceBar evidence={result.evidence} monotonicWarnings={result.monotonicWarnings} />
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ตรวจออเดอร์ที่หายไปไม่ได้
          </p>
          <p className="mt-1 text-xs text-red-700">{blockedReasonMessage(result.blockedReason, result.evidence)}</p>
        </div>
      </div>
    );
  }

  const visibleCandidates = result.candidates.filter((c) => !removedIds.has(c.factOrderId));

  if (visibleCandidates.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {result.evidence.fileName && <EvidenceBar evidence={result.evidence} monotonicWarnings={result.monotonicWarnings} />}
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
          {lastDeleted ? (
            <span className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ลบแล้ว {formatCount(lastDeleted.count)} ใบ · {formatTHB(lastDeleted.revenue)} — กู้คืนได้ที่{" "}
              <a href="#deleted-orders-history" className="font-medium underline underline-offset-2">
                ประวัติการลบ
              </a>
            </span>
          ) : (
            "ไม่พบออเดอร์ที่หายไปจากไฟล์นี้"
          )}
        </div>
      </div>
    );
  }

  const selectedCandidates = visibleCandidates.filter((c) => selected.has(c.factOrderId));
  const selectedRevenue = selectedCandidates.reduce((sum, c) => sum + c.revenueThb, 0); // addition-only, see file header
  const remainingRevenue = result.candidateRevenueThb - revenueRemoved; // DB total minus DB-reported deleted totals
  const overCap = selected.size > DELETE_IDS_MAX;
  const allSelected = selected.size === visibleCandidates.length && visibleCandidates.length > 0;

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(visibleCandidates.map((c) => c.factOrderId)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleConfirmDelete() {
    const cleanReason = reason.trim();
    if (!cleanReason || selected.size === 0 || overCap) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteMissingOrders(batchId, Array.from(selected), cleanReason);
    setDeleting(false);
    if (!res.ok) {
      if (isMissingOrdersWriteDisabledError(res.error)) {
        // Graceful, not an error: the import/detection still worked fine,
        // this server just has deletes turned off on purpose (pending Auth
        // A2). No red banner/toast — the persistent info box below the
        // evidence bar (writeDisabled) carries this message instead, and it
        // closes the modal since retrying won't succeed this session.
        setWriteDisabled(true);
        setConfirmOpen(false);
        return;
      }
      setDeleteError(res.error);
      toast.push(res.error, "error");
      return;
    }
    setRemovedIds((prev) => {
      const next = new Set(prev);
      res.data.deletedIds.forEach((id) => next.add(id));
      return next;
    });
    setRevenueRemoved((prev) => prev + res.data.deletedRevenueThb);
    setLastDeleted({ count: res.data.deletedCount, revenue: res.data.deletedRevenueThb });
    setSelected(new Set());
    setConfirmOpen(false);
    setReason("");
    toast.push(`ลบออเดอร์แล้ว ${formatCount(res.data.deletedCount)} ใบ`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <EvidenceBar evidence={result.evidence} monotonicWarnings={result.monotonicWarnings} />

      {writeDisabled && (
        <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-800">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          ยังไม่เปิดใช้การลบ/กู้คืนบนระบบนี้ — รายการตรวจพบยังดูได้ตามปกติ
        </div>
      )}

      {lastDeleted && (
        <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 p-2.5 text-xs text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ลบแล้ว {formatCount(lastDeleted.count)} ใบ · {formatTHB(lastDeleted.revenue)} — กู้คืนได้ที่{" "}
          <a href="#deleted-orders-history" className="font-medium underline underline-offset-2">
            ประวัติการลบ
          </a>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-zinc-200">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
              <th className="px-2 py-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="เลือกทั้งหมด"
                />
              </th>
              <th className="px-2 py-1.5">เลขออเดอร์</th>
              <th className="px-2 py-1.5">วันที่</th>
              <th className="px-2 py-1.5">ช่องทาง</th>
              <th className="px-2 py-1.5 text-right">ยอด ฿</th>
              <th className="px-2 py-1.5">เลขพัสดุ</th>
              <th className="px-2 py-1.5">ลูกค้า</th>
              <th className="px-2 py-1.5">เห็นล่าสุดในไฟล์</th>
            </tr>
          </thead>
          <tbody>
            {visibleCandidates.map((c: MissingOrderCandidate) => (
              <tr key={c.factOrderId} className="border-b border-zinc-100 last:border-0 align-top">
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.has(c.factOrderId)}
                    onChange={(e) => toggleOne(c.factOrderId, e.target.checked)}
                    aria-label={`เลือกออเดอร์ ${c.sourceOrderNo}`}
                  />
                </td>
                <td className="px-2 py-1.5 font-medium text-zinc-700">{c.sourceOrderNo}</td>
                <td className="px-2 py-1.5 text-zinc-600">{formatThaiDateOnly(c.orderDate)}</td>
                <td className="px-2 py-1.5 text-zinc-600">{c.channelName ?? "-"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">{formatTHB(c.revenueThb)}</td>
                <td className="px-2 py-1.5 text-zinc-600">{c.trackingNo ?? "-"}</td>
                <td className="px-2 py-1.5 text-zinc-600">{c.customerDisplayName ?? "-"}</td>
                <td className="px-2 py-1.5 text-zinc-500">
                  <p className="max-w-[160px] truncate">{c.lastSeenFile ?? "-"}</p>
                  {c.lastSeenAt && <p className="text-[0.68rem] text-zinc-400">{formatThaiDateOnly(c.lastSeenAt.slice(0, 10))}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[0.68rem] text-zinc-400">
        ยอดคงเหลือทั้งหมดในไฟล์นี้ (ยังไม่ลบ): {formatTHB(remainingRevenue)}
      </p>

      {overCap && (
        <p className="text-xs font-medium text-red-700">
          เลือกได้สูงสุด {DELETE_IDS_MAX} รายการต่อครั้ง (เลือกอยู่ {formatCount(selected.size)} รายการ) — แบ่งลบเป็นหลายรอบ
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-700">
          เลือก {formatCount(selected.size)}/{formatCount(visibleCandidates.length)} ใบ · รวม {formatTHB(selectedRevenue)}
        </span>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={selected.size === 0 || overCap || writeDisabled}
          title={writeDisabled ? "ยังไม่เปิดใช้การลบ/กู้คืนบนระบบนี้" : undefined}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          ลบออเดอร์ที่เลือก ({formatCount(selected.size)} ใบ · {formatTHB(selectedRevenue)})
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        confirmBeforeClose={() => !deleting}
        title="ยืนยันการลบออเดอร์"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            ยืนยันลบออเดอร์ <span className="font-semibold">{formatCount(selectedCandidates.length)} ใบ</span> รวม{" "}
            <span className="font-semibold">{formatTHB(selectedRevenue)}</span> ถาวรออกจากระบบ — กู้คืนได้ภายหลังที่ประวัติการลบ
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-zinc-200 p-2 text-xs">
            {selectedCandidates.map((c) => (
              <li key={c.factOrderId} className="flex items-baseline justify-between gap-2">
                <span className="text-zinc-700">{c.sourceOrderNo}</span>
                <span className="tabular-nums text-zinc-500">{formatTHB(c.revenueThb)}</span>
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">
              เหตุผล <span className="text-red-600">*</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
              className="rounded-md border border-zinc-300 p-2 text-sm focus:border-primary-500 focus:outline-none"
              placeholder="เช่น ลูกค้ายกเลิกก่อนชำระ, พบซ้ำจากไฟล์อื่น"
            />
          </label>
          {deleteError && <ErrorBanner message={deleteError} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void handleConfirmDelete()}
              loading={deleting}
              disabled={!reason.trim() || selected.size === 0 || overCap || writeDisabled}
            >
              ยืนยันลบ {formatCount(selectedCandidates.length)} ใบ
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
