"use client";

// ImportBatchHistory — /crm/import (design §3.3): history table of
// stg_import_batch rows, BOTH source types (order-report + line-item report
// — see getImportBatches() header comment for the 27 ส.ค. bug this fixes).
// Delete is only offered for 'failed'/'loaded' batches — 'transformed'
// batches are wired into fact_order/fact_order_item already and
// deleteStuckBatch() itself refuses those server-side too (belt + suspenders,
// see §3.2).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronUp, Eye, Search, Trash2 } from "lucide-react";
import { deleteStuckBatch, type ImportBatchRow } from "@/lib/actions/import-orders";
import {
  getLineImportWarnings,
  type LineImportWarningsResult,
} from "@/lib/actions/import-line-items";
import { getMissingOrders } from "@/lib/actions/import-missing-orders";
import type { MissingOrdersResult } from "@/lib/import/missing-orders-types";
import { LINE_ITEM_SOURCE_TYPE } from "@/lib/import/source-types";
import { KIND_LABEL, KIND_BADGE_TONE, type FileKind } from "@/components/domain/crm/OrderImportClient";
import { LineImportWarningsList } from "@/components/domain/crm/LineImportWarningsList";
import { MissingOrdersPanel } from "@/components/domain/crm/MissingOrdersPanel";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatBangkokTime } from "@/lib/format";
import { formatCount } from "@/lib/tiktok/format";
import { formatPeriodHint } from "@/lib/crm/import-client";

const STATUS_LABEL_TH: Record<ImportBatchRow["status"], string> = {
  loaded: "โหลดแล้ว",
  merged: "ผสานแล้ว",
  transformed: "สำเร็จ",
  failed: "ล้มเหลว",
};

const STATUS_TONE: Record<ImportBatchRow["status"], BadgeTone> = {
  loaded: "slate",
  merged: "indigo",
  transformed: "green",
  failed: "red",
};

// Trap: this treats every non-line-item source type as "order" — a future
// third source type would silently get the missing-orders button too. The
// real backstop lives in the DB now (import_missing_orders' own
// shop_or_source_mismatch check), so that degrades gracefully rather than
// breaking; but if that day comes, fix the mapping here, not the button's
// render condition below.
function sourceTypeToKind(sourceType: ImportBatchRow["sourceType"]): FileKind {
  return sourceType === LINE_ITEM_SOURCE_TYPE ? "line_item" : "order";
}

export function ImportBatchHistory({ initialRows }: { initialRows: ImportBatchRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // QA-2 (QA report 13 ก.ย. 69): `rows` was initialized from `initialRows`
  // once and then only ever patched locally (handleDelete's optimistic
  // filter below) — a router.refresh() triggered from ANYWHERE ELSE
  // (MissingOrdersPanel's delete, RestoreOrderButton's restore, a new import
  // landing in another tab) re-renders this server component's parent with
  // a fresh `initialRows` array, but useState ignores prop changes after
  // mount, so this table would keep showing the stale list until a full page
  // navigation. Sync explicitly whenever the parent actually hands us a new
  // array (reference changes only on a real refetch, not on every unrelated
  // client re-render) — this can only overwrite `rows` with server-fresh
  // data, so it never fights the optimistic filter in handleDelete (that
  // filter's own row is already gone from the next `initialRows` too, once
  // the in-flight revalidatePath/router.refresh() lands).
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // Warnings modal: lazy-loaded per batch on click, cached by batchId so
  // reopening the same row's modal doesn't refetch. QA round 1: a failed
  // fetch used to be cached as `null` too ("fetch attempted and failed"),
  // which meant `warningsCache[batchId] !== undefined` counted as a cache
  // hit forever — no amount of closing/reopening the modal ever refetched,
  // the "ลองปิดแล้วเปิดใหม่" message was a lie. Fix: only SUCCESSFUL fetches
  // go in the cache now (type narrowed to drop `| null`) — a failure leaves
  // the key absent so the next attempt genuinely refetches. `failedBatchId`
  // tracks "the fetch for this currently-open batch just failed" so the
  // modal can render the error state without needing a fake cache entry.
  const [openBatch, setOpenBatch] = useState<{ batchId: string; fileName: string | null } | null>(null);
  const [warningsCache, setWarningsCache] = useState<Record<string, LineImportWarningsResult>>({});
  const [warningsLoadingId, setWarningsLoadingId] = useState<string | null>(null);
  const [failedBatchId, setFailedBatchId] = useState<string | null>(null);

  async function handleDelete(batchId: string) {
    setDeletingId(batchId);
    const result = await deleteStuckBatch(batchId);
    setDeletingId(null);
    if (!result.ok) {
      toast.push(result.error, "error");
      return;
    }
    setRows((prev) => prev.filter((r) => r.batchId !== batchId));
    toast.push("ลบ batch แล้ว");
    router.refresh();
  }

  async function openWarnings(batchId: string, fileName: string | null) {
    setOpenBatch({ batchId, fileName });
    setFailedBatchId((cur) => (cur === batchId ? null : cur)); // clear a stale failure before retrying
    if (warningsCache[batchId] !== undefined) return; // cache hit — only ever a PAST SUCCESS now
    setWarningsLoadingId(batchId);
    const res = await getLineImportWarnings(batchId);
    setWarningsLoadingId((cur) => (cur === batchId ? null : cur));
    if (res.ok) {
      setWarningsCache((prev) => ({ ...prev, [batchId]: res.data }));
    } else {
      // Do NOT cache the failure — leaving the key absent is what makes the
      // retry button below (and simply reopening the modal) actually refetch.
      setFailedBatchId(batchId);
      toast.push(res.error, "error");
    }
  }

  const openWarningsData = openBatch ? warningsCache[openBatch.batchId] : undefined;
  const openWarningsLoading = openBatch != null && warningsLoadingId === openBatch.batchId;
  const openWarningsFailed = openBatch != null && failedBatchId === openBatch.batchId;

  // Cancel-detection Phase 1 (design §6) — "ตรวจออเดอร์ที่หายไป" toggle,
  // available on ANY transformed order batch (fixed 14 ก.ย. 69: used to be
  // hardcoded to the latest transformed order batch only — see
  // memory/cancel-detection-system for the production incident this caused,
  // G601/G605/G620). `missingOpenBatchId` is the batch id whose panel is
  // currently open (null = none) — only one panel open at a time.
  // `missingResult` follows MissingOrdersPanel's own contract (undefined =
  // loading, null = fetch failed, object = loaded) and is refetched by the
  // effect below whenever `missingOpenBatchId` changes (open, switch to a
  // different row, or close+reopen) — see that effect's own comment for the
  // race-safety details.
  //
  // Deliberately NOT cached by batchId the way `warningsCache` above is:
  // the candidate set for a batch changes every time anyone deletes or
  // restores an order (from ANY batch's panel, or RestoreOrderButton
  // elsewhere), so a cached result could keep showing an order as "missing"
  // after it was already deleted, or hide one that was just restored.
  // Refetching on every open/switch is the correct default here, not an
  // oversight.
  const [missingOpenBatchId, setMissingOpenBatchId] = useState<string | null>(null);
  const [missingResult, setMissingResult] = useState<MissingOrdersResult | null | undefined>(undefined);
  // Monotonic "epoch" counter, not a retry count — deliberately never reset
  // (not even on close) so two retries can never land on the same dep pair
  // as a prior one and fail to re-trigger the effect below.
  const [missingRetryToken, setMissingRetryToken] = useState(0);

  // Fetch (or refetch) whenever the target batch changes — covers "open for
  // the first time" and "switch to a different batch while already open"
  // with one code path, per brief. `cancelled` guards the race where the
  // user opens batch A then batch B before A's fetch lands: A's response
  // must never overwrite state that now belongs to B. `missingRetryToken`
  // is bumped by onRetry below to force a refetch of the SAME batchId
  // (batchId alone wouldn't change, so the effect wouldn't otherwise rerun).
  //
  // The `setMissingResult(undefined)` here is NOT redundant with the one in
  // toggleMissingPanel below (QA-❌1, security review round 2, 14 ก.ย. 69) —
  // that one is batched together with setMissingOpenBatchId inside the same
  // event handler, so React never paints a frame that pairs a NEW batchId
  // with the OLD batch's result (security: `fact_order_id` can be a
  // candidate of 2 overlapping batches at once, so this isn't just
  // cosmetic). This one here covers the RETRY path — missingRetryToken
  // changes but batchId doesn't, so toggleMissingPanel never runs — without
  // it, retrying after a failed fetch would skip straight from the old
  // failure back to nothing instead of showing a loading state.
  useEffect(() => {
    if (missingOpenBatchId == null) return;
    let cancelled = false;
    setMissingResult(undefined);
    void getMissingOrders(missingOpenBatchId).then((res) => {
      if (cancelled) return;
      setMissingResult(res.ok ? res.data : null);
      if (!res.ok) console.error("ImportBatchHistory: getMissingOrders failed", res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [missingOpenBatchId, missingRetryToken]);

  // Scroll the panel into view when it opens/switches batch — the history
  // table can run to dozens of rows (no `.limit()` in getImportBatches), so
  // the panel (rendered once, below the table) can land far below whatever
  // row the user just clicked (QA-❌2, measured 2,960px on a 23-row table).
  // Not a regression from this fix specifically — a single fixed-position
  // button had the same distance problem before, this change just made the
  // button reachable from many more rows, so the gap gets hit far more often.
  const missingPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (missingOpenBatchId == null) return;
    missingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [missingOpenBatchId]);

  function toggleMissingPanel(batchId: string) {
    const next = missingOpenBatchId === batchId ? null : batchId;
    setMissingOpenBatchId(next);
    // Batched with the state update above (same event handler) so no frame
    // ever paints `next` batchId against the previous batch's `result` — see
    // the effect above for why that matters here specifically. Also clears
    // stale result across a close->reopen cycle (security Low note).
    setMissingResult(undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[700px] text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
            <th className="px-3 py-2">ไฟล์</th>
            <th className="px-3 py-2">ประเภทไฟล์</th>
            <th className="px-3 py-2">เดือน</th>
            <th className="px-3 py-2 text-right">อ่านได้ → โหลด</th>
            <th className="px-3 py-2 text-right">error</th>
            <th className="px-3 py-2 text-right">คำเตือน</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2">นำเข้าเมื่อ</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const canDelete = r.status === "failed" || r.status === "loaded";
            const kind = sourceTypeToKind(r.sourceType);
            const isMissingOpenRow = missingOpenBatchId === r.batchId;
            // /crm/import-errors (v_import_error_summary) only ever reads
            // analytics.stg_order_import — it doesn't join
            // stg_order_line_import (no error_code column there either), so
            // a line-item batch's errors would never actually show up on
            // that page. Rather than link somewhere that silently shows
            // nothing for this row, keep the count visible but not a link.
            const errorLinkSupported = kind === "order";
            return (
              <tr key={r.batchId} className="border-b border-zinc-100 last:border-0 align-top">
                <td className="px-3 py-2 font-medium text-zinc-700">
                  <p className="max-w-[200px] truncate">{r.fileName ?? "(ไม่ทราบชื่อไฟล์)"}</p>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={KIND_BADGE_TONE[kind]}>{KIND_LABEL[kind]}</Badge>
                </td>
                <td className="px-3 py-2 text-zinc-600">{formatPeriodHint(r.periodHint)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600">
                  {r.rowCountParsed != null ? formatCount(r.rowCountParsed) : "—"} → {r.rowCountLoaded != null ? formatCount(r.rowCountLoaded) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.errorCount > 0 ? (
                    errorLinkSupported ? (
                      <Link
                        href="/crm/import-errors"
                        className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline"
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {formatCount(r.errorCount)}
                      </Link>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 font-semibold text-red-600"
                        title="ดูรายละเอียด error ของไฟล์สินค้าในออเดอร์ยังไม่รองรับในหน้า import-errors"
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {formatCount(r.errorCount)}
                      </span>
                    )
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {kind !== "line_item" ? (
                    <span className="text-zinc-300">—</span>
                  ) : r.warningCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void openWarnings(r.batchId, r.fileName)}
                      className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline"
                    >
                      <Eye className="h-3 w-3" aria-hidden="true" />
                      {formatCount(r.warningCount)}
                    </button>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL_TH[r.status]}</Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{formatBangkokTime(r.importedAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {kind === "order" && r.status === "transformed" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleMissingPanel(r.batchId)}
                        aria-expanded={isMissingOpenRow}
                        aria-controls={isMissingOpenRow ? "missing-orders-panel" : undefined}
                        aria-label={`ตรวจออเดอร์ที่หายไป ${r.fileName ?? r.batchId}`}
                      >
                        {isMissingOpenRow ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <Search className="h-3.5 w-3.5" aria-hidden="true" />}
                        ตรวจออเดอร์ที่หายไป
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={deletingId === r.batchId}
                        onClick={() => void handleDelete(r.batchId)}
                        aria-label={`ลบ batch ${r.fileName ?? r.batchId}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={openBatch != null}
        onClose={() => setOpenBatch(null)}
        title={`คำเตือนการนำเข้า — ${openBatch?.fileName ?? "(ไม่ทราบชื่อไฟล์)"}`}
      >
        {openWarningsLoading && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">กำลังโหลด…</p>
        )}
        {!openWarningsLoading && openWarningsFailed && (
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="text-sm text-red-700">โหลดรายการคำเตือนไม่สำเร็จ</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void openWarnings(openBatch.batchId, openBatch.fileName)}
            >
              ลองอีกครั้ง
            </Button>
          </div>
        )}
        {!openWarningsLoading && openWarningsData && openWarningsData.rows.length === 0 && (
          <p className="py-4 text-sm text-zinc-500">ไม่มีคำเตือนสำหรับไฟล์นี้แล้ว</p>
        )}
        {!openWarningsLoading && openWarningsData && openWarningsData.rows.length > 0 && (
          <LineImportWarningsList rows={openWarningsData.rows} totalCount={openWarningsData.totalCount} />
        )}
        </Modal>
      </div>

      {missingOpenBatchId && (
        <div ref={missingPanelRef} id="missing-orders-panel">
          <MissingOrdersPanel
            batchId={missingOpenBatchId}
            result={missingResult}
            onRetry={() => setMissingRetryToken((t) => t + 1)}
          />
        </div>
      )}
    </div>
  );
}
