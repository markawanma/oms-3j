"use client";

// OrderImportClient — /crm/import (docs/3j-jewelry/analytics/phase-import-ui-design.md
// §3.3 state machine, extended per phase-lineitem-import-design.md §6). ONE
// dropzone now accepts TWO report types from Shipnity:
//   - order-level  "รายงานยอดขายรายเดือน" (23-25 col)  -> import-orders.ts
//   - line-item    "สินค้าในออเดอร์"       (20 col)     -> import-line-items.ts
//
// Detection strategy (§6 decision, chosen over a dropdown/toggle or a new
// "detect-only" server action): try previewOrderImport() first; if it comes
// back with shapeIssues (column count 20 is never in the order report's
// 23-25 range, so this is a clean, deterministic signal — not a guess), fall
// back to previewLineImport(). Both parsers already own their own column
// count + header-anchor validation (order-report.ts / order-line-report.ts)
// — this reuses that as the single source of truth for "is this file valid
// as type X" instead of duplicating anchor-matching logic in a third place.
// Trade-off: a line-item file costs two round-trips (order attempt fails
// fast on shape, then line succeeds) instead of one — accepted, files here
// top out around ~1,600 rows / 4MB, so the extra parse is cheap, and it
// means zero new backend code/files were needed to add detection.
//
// Two file flows share one dropzone:
//   - single file  -> detect+preview -> preview card (order or line-item
//                     variant) -> commit -> done
//   - >1 files     -> client queues detect+preview per file -> summary table
//                     (with a "ประเภทไฟล์" column) -> commit sequentially
//                     (never parallel, per D3) -> live per-file results
// Server actions are stateless (D2) — the same File object is re-sent for
// preview and commit (and, for line-item files, twice during detection), so
// parsing happens 2-3 times per file. That's an accepted trade-off (design
// §6 debt #6 / this file's detection note above), not a bug.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import {
  commitOrderImport,
  previewOrderImport,
  type ImportCommitResult,
  type ImportPreview,
} from "@/lib/actions/import-orders";
import {
  commitLineImport,
  previewLineImport,
  type LineImportCommitResult,
  type LineImportPreview,
} from "@/lib/actions/import-line-items";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { formatCount } from "@/lib/tiktok/format";
import { formatPeriodHint, formatDateRange, validateXlsxFile } from "@/lib/crm/import-client";

type FileKind = "order" | "line_item";

/** One detected+previewed file. `kind: null` means neither parser accepted
 * the shape — genuinely not a recognized report. When both parsers reject
 * the shape but one is a *closer* match, we still tag it with that kind so
 * the UI can show "closest guess" shape errors instead of a bare rejection. */
interface PreviewItem {
  file: File;
  kind: FileKind | null;
  status: "ok" | "duplicate" | "shape_error" | "preview_error";
  orderPreview?: ImportPreview;
  linePreview?: LineImportPreview;
  errorMessage?: string;
}

interface CommitItem {
  file: File;
  kind: FileKind;
  status: "pending" | "committing" | "done" | "error";
  orderResult?: ImportCommitResult;
  lineResult?: LineImportCommitResult;
  errorMessage?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "previewing_single" }
  | { kind: "previewing_multi"; total: number; done: number }
  | { kind: "preview_single"; item: PreviewItem }
  | { kind: "preview_multi"; items: PreviewItem[] }
  | { kind: "committing_single" }
  | { kind: "committing_multi"; items: CommitItem[] }
  | { kind: "done_single"; item: CommitItem }
  | { kind: "done_multi"; items: CommitItem[] }
  | { kind: "error"; message: string; retry?: () => void };

const ORDER_PROFIT_NOTE = "กำไรเป็นค่าประเมิน จนกว่าจะผูกรายการสินค้า";
const LINE_PROFIT_NOTE = "กำไรจะอัปเดตเป็นค่าจริงสำหรับออเดอร์ที่จับคู่รายการสินค้าได้";

const KIND_LABEL: Record<FileKind, string> = {
  order: "รายงานยอดขาย",
  line_item: "สินค้าในออเดอร์",
};

function toFormData(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

/** Extracts the fields shared by ImportPreview and LineImportPreview so the
 * multi-file table can render either kind through one code path. */
function commonPreviewFields(item: PreviewItem): {
  rowCount: number;
  periodHint: string | null;
  shapeIssues: string[];
  duplicateFile: { batchId: string; importedAt: string; status: string } | null;
} | null {
  if (item.orderPreview) {
    const p = item.orderPreview;
    return { rowCount: p.rowCount, periodHint: p.periodHint, shapeIssues: p.shapeIssues, duplicateFile: p.duplicateFile };
  }
  if (item.linePreview) {
    const p = item.linePreview;
    return { rowCount: p.rowCount, periodHint: p.periodHint, shapeIssues: p.shapeIssues, duplicateFile: p.duplicateFile };
  }
  return null;
}

/** Extracts the 3 fields shared by ImportCommitResult and
 * LineImportCommitResult, for the combined multi-file totals row. */
function commonCommitFields(it: CommitItem): { inserted: number; transformed: number; errored: number } | null {
  if (it.orderResult) return it.orderResult;
  if (it.lineResult) return it.lineResult;
  return null;
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "danger" }) {
  const toneClasses =
    tone === "success"
      ? "bg-green-50 text-green-700"
      : tone === "danger"
        ? "bg-red-50 text-red-600"
        : "bg-zinc-100 text-zinc-700";
  return (
    <div className={`flex-1 rounded-md px-3 py-2 text-center ${toneClasses}`}>
      <div className="text-2xl font-bold tabular-nums">{formatCount(value)}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function CommitResultSummary({ result }: { result: ImportCommitResult }) {
  return (
    <>
      <div className="flex gap-3">
        <StatBox label="นำเข้า" value={result.inserted} tone="neutral" />
        <StatBox label="สำเร็จ" value={result.transformed} tone="success" />
        <StatBox label="ไม่ผ่าน" value={result.errored} tone="danger" />
      </div>
      {result.errored > 0 && (
        <Link
          href="/crm/import-errors"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ดูรายการที่ไม่ผ่าน ({formatCount(result.errored)})
        </Link>
      )}
    </>
  );
}

function LineCommitResultSummary({ result }: { result: LineImportCommitResult }) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <StatBox label="แปลงสำเร็จ" value={result.transformed} tone="success" />
        <StatBox label="รอออเดอร์ (orphan)" value={result.orphan} tone="neutral" />
        <StatBox label="ข้าม (ไม่ใช่สินค้า)" value={result.skippedBlank} tone="neutral" />
        <StatBox label="SKU ไม่รู้จัก" value={result.unknown} tone="danger" />
      </div>
      {result.orphan > 0 && (
        <p className="text-xs text-amber-700">
          {formatCount(result.orphan)} รายการยังรอออเดอร์ — จะจับคู่และคำนวณกำไรอัตโนมัติเมื่อนำเข้ารายงานยอดขายของออเดอร์นั้นแล้ว
        </p>
      )}
      {result.errored > 0 && (
        <Link
          href="/crm/import-errors"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ดูรายการที่ไม่ผ่าน ({formatCount(result.errored)})
        </Link>
      )}
    </>
  );
}

export function OrderImportClient() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  function reset() {
    setPhase({ kind: "idle" });
  }

  // ==========================================================================
  // Detection (see file-header comment for the strategy + trade-off).
  // ==========================================================================
  async function detectAndPreview(file: File): Promise<PreviewItem> {
    const orderRes = await previewOrderImport(toFormData(file));
    if (!orderRes.ok) {
      // Action-level failure (auth gate, empty/oversized file, unreadable
      // workbook) — the line-item action shares the exact same guards, so
      // retrying there would fail identically. No point burning a 2nd parse.
      return { file, kind: null, status: "preview_error", errorMessage: orderRes.error };
    }
    if (orderRes.data.shapeIssues.length === 0) {
      return {
        file,
        kind: "order",
        status: orderRes.data.duplicateFile ? "duplicate" : "ok",
        orderPreview: orderRes.data,
      };
    }

    const lineRes = await previewLineImport(toFormData(file));
    if (!lineRes.ok) {
      return { file, kind: null, status: "preview_error", errorMessage: lineRes.error };
    }
    if (lineRes.data.shapeIssues.length === 0) {
      return {
        file,
        kind: "line_item",
        status: lineRes.data.duplicateFile ? "duplicate" : "ok",
        linePreview: lineRes.data,
      };
    }

    // Neither parser accepted the shape — tag with whichever came closer
    // (fewer shape issues) so the error message is at least useful, instead
    // of a bare "unrecognized file".
    if (lineRes.data.shapeIssues.length <= orderRes.data.shapeIssues.length) {
      return { file, kind: "line_item", status: "shape_error", linePreview: lineRes.data };
    }
    return { file, kind: "order", status: "shape_error", orderPreview: orderRes.data };
  }

  async function previewSingle(file: File) {
    setPhase({ kind: "previewing_single" });
    try {
      const item = await detectAndPreview(file);
      if (item.status === "preview_error") {
        setPhase({ kind: "error", message: item.errorMessage ?? "อ่านไฟล์ไม่สำเร็จ", retry: () => void previewSingle(file) });
        return;
      }
      setPhase({ kind: "preview_single", item });
    } catch (err) {
      const message = err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ";
      setPhase({ kind: "error", message, retry: () => void previewSingle(file) });
    }
  }

  async function previewMulti(files: File[]) {
    setPhase({ kind: "previewing_multi", total: files.length, done: 0 });
    const items: PreviewItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        items.push(await detectAndPreview(file));
      } catch (err) {
        items.push({
          file,
          kind: null,
          status: "preview_error",
          errorMessage: err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ",
        });
      }
      setPhase({ kind: "previewing_multi", total: files.length, done: i + 1 });
    }
    setPhase({ kind: "preview_multi", items });
  }

  async function commitSingle(item: PreviewItem) {
    if (!item.kind) return; // guard: confirm button is never shown for kind===null
    setPhase({ kind: "committing_single" });
    try {
      if (item.kind === "order") {
        const result = await commitOrderImport(toFormData(item.file));
        if (!result.ok) {
          setPhase({ kind: "error", message: result.error, retry: () => void commitSingle(item) });
          toast.push(result.error, "error");
          return;
        }
        setPhase({ kind: "done_single", item: { file: item.file, kind: "order", status: "done", orderResult: result.data } });
        toast.push(`นำเข้าสำเร็จ — แปลงสำเร็จ ${result.data.transformed} รายการ`);
      } else {
        const result = await commitLineImport(toFormData(item.file));
        if (!result.ok) {
          setPhase({ kind: "error", message: result.error, retry: () => void commitSingle(item) });
          toast.push(result.error, "error");
          return;
        }
        setPhase({ kind: "done_single", item: { file: item.file, kind: "line_item", status: "done", lineResult: result.data } });
        toast.push(`นำเข้าสำเร็จ — แปลงสำเร็จ ${result.data.transformed} รายการสินค้า`);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "นำเข้าไม่สำเร็จ";
      setPhase({ kind: "error", message, retry: () => void commitSingle(item) });
      toast.push(message, "error");
    }
  }

  async function commitMulti(previewItems: PreviewItem[]) {
    let items: CommitItem[] = previewItems.map((p) => ({ file: p.file, kind: p.kind as FileKind, status: "pending" }));
    setPhase({ kind: "committing_multi", items });
    // Sequential on purpose (design D3) — transform_pending_orders /
    // transform_pending_order_lines are per-row server-side loops, running
    // two commits in parallel would race.
    for (let i = 0; i < items.length; i++) {
      items = items.map((it, idx) => (idx === i ? { ...it, status: "committing" } : it));
      setPhase({ kind: "committing_multi", items });
      try {
        const fd = toFormData(items[i].file);
        if (items[i].kind === "order") {
          const result = await commitOrderImport(fd);
          items = items.map((it, idx) =>
            idx === i
              ? result.ok
                ? { ...it, status: "done", orderResult: result.data }
                : { ...it, status: "error", errorMessage: result.error }
              : it
          );
        } else {
          const result = await commitLineImport(fd);
          items = items.map((it, idx) =>
            idx === i
              ? result.ok
                ? { ...it, status: "done", lineResult: result.data }
                : { ...it, status: "error", errorMessage: result.error }
              : it
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "นำเข้าไม่สำเร็จ";
        items = items.map((it, idx) => (idx === i ? { ...it, status: "error", errorMessage: message } : it));
      }
      setPhase({ kind: "committing_multi", items });
    }
    setPhase({ kind: "done_multi", items });
    const okCount = items.filter((it) => it.status === "done").length;
    toast.push(`นำเข้าเสร็จสิ้น ${okCount}/${items.length} ไฟล์`, okCount === items.length ? "success" : "error");
    router.refresh();
  }

  async function handleFilesSelected(fileList: FileList) {
    const files = Array.from(fileList);
    const valid: File[] = [];
    const invalidMsgs: string[] = [];
    for (const f of files) {
      const err = validateXlsxFile(f);
      if (err) invalidMsgs.push(`${f.name}: ${err}`);
      else valid.push(f);
    }
    if (invalidMsgs.length > 0) toast.push(invalidMsgs.join(" · "), "error");
    if (valid.length === 0) return;
    if (valid.length === 1) await previewSingle(valid[0]);
    else await previewMulti(valid);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    e.target.value = "";
    if (!fileList || fileList.length === 0) return;
    void handleFilesSelected(fileList);
  }

  const dropzoneDisabled = phase.kind === "previewing_single" || phase.kind === "previewing_multi";
  const showDropzone = phase.kind === "idle" || dropzoneDisabled;

  return (
    <div className="flex flex-col gap-3">
      {showDropzone && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <label
            className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center ${
              dropzoneDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary-400 hover:bg-primary-50"
            }`}
          >
            {dropzoneDisabled ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
                <span className="text-sm font-medium text-zinc-700">
                  {phase.kind === "previewing_multi"
                    ? `กำลังอ่านไฟล์… (${phase.done}/${phase.total})`
                    : "กำลังอ่านไฟล์…"}
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-zinc-400" aria-hidden="true" />
                <span className="text-sm font-medium text-zinc-700">เลือกไฟล์รายงาน (.xlsx)</span>
                <span className="text-xs text-zinc-400">
                  รองรับทั้ง "รายงานยอดขายรายเดือน" และ "สินค้าในออเดอร์" — ระบบตรวจชนิดไฟล์ให้อัตโนมัติ ·
                  เลือกได้หลายไฟล์พร้อมกัน · ไม่เกิน 4MB/ไฟล์
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              multiple
              disabled={dropzoneDisabled}
              className="hidden"
              onChange={handleInputChange}
            />
          </label>
        </div>
      )}

      {phase.kind === "preview_single" &&
        (phase.item.kind === "order" && phase.item.orderPreview ? (
          <OrderSinglePreviewCard
            preview={phase.item.orderPreview}
            onConfirm={() => void commitSingle(phase.item)}
            onReset={reset}
          />
        ) : phase.item.kind === "line_item" && phase.item.linePreview ? (
          <LineSinglePreviewCard
            preview={phase.item.linePreview}
            onConfirm={() => void commitSingle(phase.item)}
            onReset={reset}
          />
        ) : (
          <UnrecognizedPreviewCard item={phase.item} onReset={reset} />
        ))}

      {phase.kind === "preview_multi" && (
        <MultiPreviewTable
          items={phase.items}
          onConfirm={() => {
            const eligible = phase.items.filter((it) => it.status === "ok");
            if (eligible.length > 0) void commitMulti(eligible);
          }}
          onReset={reset}
        />
      )}

      {phase.kind === "committing_single" && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-700">กำลังนำเข้า อย่าปิดหน้านี้</p>
        </div>
      )}

      {phase.kind === "committing_multi" && <CommitProgressList items={phase.items} />}

      {phase.kind === "done_single" && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          {phase.item.kind === "order" && phase.item.orderResult ? (
            <CommitResultSummary result={phase.item.orderResult} />
          ) : phase.item.lineResult ? (
            <LineCommitResultSummary result={phase.item.lineResult} />
          ) : null}
          <p className="text-xs text-zinc-500">{phase.item.kind === "order" ? ORDER_PROFIT_NOTE : LINE_PROFIT_NOTE}</p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              นำเข้าไฟล์ถัดไป
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "done_multi" && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <MultiDoneSummary items={phase.items} />
          <p className="text-xs text-zinc-500">
            {ORDER_PROFIT_NOTE} · {LINE_PROFIT_NOTE}
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              นำเข้าไฟล์ถัดไป
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "error" && <ErrorState message={phase.message} onRetry={phase.retry ?? reset} />}
    </div>
  );
}

function OrderSinglePreviewCard({
  preview,
  onConfirm,
  onReset,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const blocked = preview.shapeIssues.length > 0;
  const duplicate = preview.duplicateFile;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Badge tone="blue">{KIND_LABEL.order}</Badge>
      </div>
      <div>
        <p className="truncate text-sm font-bold text-zinc-900">{preview.fileName}</p>
        <p className="text-xs text-zinc-500">
          {formatCount(preview.rowCount)} แถว
          {preview.skippedCount > 0 ? ` (ข้าม ${formatCount(preview.skippedCount)})` : ""} ·{" "}
          {formatDateRange(preview.periodMin, preview.periodMax)} · {formatPeriodHint(preview.periodHint)}
        </p>
      </div>

      {preview.channelCounts.length > 0 && (
        <p className="text-xs text-zinc-600">
          {preview.channelCounts.map((c: { label: string; count: number }) => `${c.label} ${formatCount(c.count)}`).join(" · ")}
        </p>
      )}

      {blocked && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ไฟล์นี้นำเข้าไม่ได้
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-red-700">
            {preview.shapeIssues.map((issue: string, idx: number) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {!blocked && duplicate && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            ไฟล์นี้นำเข้าแล้วเมื่อ {formatDateRange(duplicate.importedAt, null)} (สถานะ {duplicate.status})
          </p>
        </div>
      )}

      {!blocked && !duplicate && (preview.crossesMonth || preview.dateWarningCount > 0 || preview.updateExistingCount > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ul className="list-inside list-disc space-y-0.5">
            {preview.crossesMonth && <li>ไฟล์นี้ข้อมูลคร่อมเดือน — ตรวจช่วงวันที่ก่อนยืนยัน</li>}
            {preview.dateWarningCount > 0 && <li>{formatCount(preview.dateWarningCount)} แถวมีวันที่อ่านไม่ได้ (จะข้ามแถวนั้น)</li>}
            {preview.updateExistingCount > 0 && <li>จะอัปเดตทับ {formatCount(preview.updateExistingCount)} ออเดอร์เดิม</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onReset}>
          เลือกไฟล์ใหม่
        </Button>
        {!blocked && !duplicate && (
          <Button type="button" variant="primary" onClick={onConfirm}>
            ยืนยันนำเข้า {formatCount(preview.rowCount)} แถว
          </Button>
        )}
      </div>
    </div>
  );
}

function LineSinglePreviewCard({
  preview,
  onConfirm,
  onReset,
}: {
  preview: LineImportPreview;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const blocked = preview.shapeIssues.length > 0;
  const duplicate = preview.duplicateFile;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Badge tone="indigo">{KIND_LABEL.line_item}</Badge>
      </div>
      <div>
        <p className="truncate text-sm font-bold text-zinc-900">{preview.fileName}</p>
        <p className="text-xs text-zinc-500">
          {formatCount(preview.rowCount)} รายการสินค้า · {formatCount(preview.distinctOrders)} ออเดอร์ ·{" "}
          {formatDateRange(preview.periodMin, preview.periodMax)} · {formatPeriodHint(preview.periodHint)}
        </p>
      </div>

      {blocked && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            ไฟล์นี้นำเข้าไม่ได้
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-red-700">
            {preview.shapeIssues.map((issue: string, idx: number) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {!blocked && duplicate && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            ไฟล์นี้นำเข้าแล้วเมื่อ {formatDateRange(duplicate.importedAt, null)} (สถานะ {duplicate.status})
          </p>
        </div>
      )}

      {!blocked && !duplicate && (
        <>
          {preview.orphanOrderCount > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {formatCount(preview.orphanOrderCount)} ออเดอร์ในไฟล์นี้ยังไม่มีในระบบ — นำเข้ารายงานยอดขายก่อน
              </p>
              <p className="mt-1">
                ไม่บล็อกการนำเข้า — รายการเหล่านี้จะจับคู่และคำนวณกำไรอัตโนมัติในภายหลัง เมื่อนำเข้ารายงานยอดขาย (order-level) ของออเดอร์นั้นแล้ว
              </p>
            </div>
          )}

          {preview.unknownSkus.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="font-semibold">SKU ที่ยังไม่มีในระบบ ({formatCount(preview.unknownSkus.length)})</p>
              <p className="mt-1 break-words">{preview.unknownSkus.join(", ")}</p>
              <p className="mt-1">นำเข้าได้ปกติ แต่ยังไม่มีต้นทุน — เพิ่ม SKU ในหน้าสินค้าแล้วนำเข้าไฟล์นี้ซ้ำเพื่ออัปเดตกำไรให้ครบ</p>
            </div>
          )}

          {preview.blankSkuCount > 0 && (
            <p className="text-xs text-zinc-500">
              {formatCount(preview.blankSkuCount)} แถวไม่มีรหัสสินค้า (ค่าส่ง/รายการปรับมือ) — จะถูกข้าม ไม่กระทบยอดขาย
            </p>
          )}

          {(preview.crossesMonth || preview.dateWarningCount > 0) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <ul className="list-inside list-disc space-y-0.5">
                {preview.crossesMonth && <li>ไฟล์นี้ข้อมูลคร่อมเดือน — ตรวจช่วงวันที่ก่อนยืนยัน</li>}
                {preview.dateWarningCount > 0 && <li>{formatCount(preview.dateWarningCount)} แถวมีวันที่อ่านไม่ได้</li>}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-zinc-500">{LINE_PROFIT_NOTE}</p>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onReset}>
          เลือกไฟล์ใหม่
        </Button>
        {!blocked && !duplicate && (
          <Button type="button" variant="primary" onClick={onConfirm}>
            ยืนยันนำเข้า {formatCount(preview.rowCount)} รายการ
          </Button>
        )}
      </div>
    </div>
  );
}

function UnrecognizedPreviewCard({ item, onReset }: { item: PreviewItem; onReset: () => void }) {
  const closest = item.kind === "line_item" ? item.linePreview?.shapeIssues : item.orderPreview?.shapeIssues;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <p className="truncate text-sm font-bold text-zinc-900">{item.file.name}</p>
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
          <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          ไม่รู้จักไฟล์นี้
        </p>
        <p className="mt-1.5 text-xs text-red-700">
          ไม่ตรงทั้งรูปแบบ &quot;รายงานยอดขายรายเดือน&quot; และ &quot;สินค้าในออเดอร์&quot;
          {item.kind && ` (ใกล้เคียง${KIND_LABEL[item.kind]}ที่สุด)`}
        </p>
        {closest && closest.length > 0 && (
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-red-700">
            {closest.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end pt-1">
        <Button type="button" variant="secondary" onClick={onReset}>
          เลือกไฟล์ใหม่
        </Button>
      </div>
    </div>
  );
}

const PREVIEW_STATUS_LABEL: Record<PreviewItem["status"], { label: string; tone: string }> = {
  ok: { label: "พร้อม", tone: "bg-green-100 text-green-800" },
  duplicate: { label: "ซ้ำ", tone: "bg-zinc-100 text-zinc-600" },
  shape_error: { label: "รูปแบบผิด", tone: "bg-red-100 text-red-800" },
  preview_error: { label: "อ่านไม่สำเร็จ", tone: "bg-red-100 text-red-800" },
};

function MultiPreviewTable({
  items,
  onConfirm,
  onReset,
}: {
  items: PreviewItem[];
  onConfirm: () => void;
  onReset: () => void;
}) {
  const eligibleCount = items.filter((it) => it.status === "ok").length;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-sm font-semibold text-zinc-800">พบ {items.length} ไฟล์ — พร้อมนำเข้า {eligibleCount} ไฟล์</p>
      <div className="overflow-x-auto rounded-md border border-zinc-200">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
              <th className="px-2 py-1.5">ไฟล์</th>
              <th className="px-2 py-1.5">ประเภท</th>
              <th className="px-2 py-1.5 text-right">แถว</th>
              <th className="px-2 py-1.5">เดือน</th>
              <th className="px-2 py-1.5">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const statusInfo = PREVIEW_STATUS_LABEL[it.status];
              const common = commonPreviewFields(it);
              const note =
                it.status === "shape_error"
                  ? common?.shapeIssues.join("; ")
                  : it.status === "duplicate"
                    ? `นำเข้าแล้วเมื่อ ${formatDateRange(common?.duplicateFile?.importedAt ?? null, null)}`
                    : it.status === "preview_error"
                      ? it.errorMessage
                      : null;
              return (
                <tr key={idx} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="px-2 py-1.5 font-medium text-zinc-700">
                    <p className="truncate max-w-[200px]">{it.file.name}</p>
                    {note && <p className="mt-0.5 text-[0.68rem] font-normal text-zinc-400">{note}</p>}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600">{it.kind ? KIND_LABEL[it.kind] : "ไม่ทราบ"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                    {common ? formatCount(common.rowCount) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600">{common ? formatPeriodHint(common.periodHint) : "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${statusInfo.tone}`}>
                      {statusInfo.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onReset}>
          เลือกไฟล์ใหม่
        </Button>
        <Button type="button" variant="primary" onClick={onConfirm} disabled={eligibleCount === 0}>
          ยืนยันนำเข้า {eligibleCount} ไฟล์
        </Button>
      </div>
    </div>
  );
}

function CommitProgressList({ items }: { items: CommitItem[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-700">
        <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        กำลังนำเข้าทีละไฟล์ อย่าปิดหน้านี้
      </p>
      <ul className="space-y-1.5">
        {items.map((it, idx) => {
          const common = commonCommitFields(it);
          return (
            <li key={idx} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-zinc-700">
                {it.file.name} <span className="text-zinc-400">({KIND_LABEL[it.kind]})</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {it.status === "pending" && <span className="text-zinc-400">รอคิว</span>}
                {it.status === "committing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden="true" />}
                {it.status === "done" && (
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatCount(common?.transformed ?? 0)} สำเร็จ
                  </span>
                )}
                {it.status === "error" && (
                  <span className="flex items-center gap-1 text-red-600">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {it.errorMessage}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MultiDoneSummary({ items }: { items: CommitItem[] }) {
  const totals = items.reduce(
    (acc, it) => {
      const common = commonCommitFields(it);
      if (common) {
        acc.inserted += common.inserted;
        acc.transformed += common.transformed;
        acc.errored += common.errored;
      }
      if (it.lineResult) {
        acc.orphan += it.lineResult.orphan;
        acc.skippedBlank += it.lineResult.skippedBlank;
        acc.unknown += it.lineResult.unknown;
      }
      return acc;
    },
    { inserted: 0, transformed: 0, errored: 0, orphan: 0, skippedBlank: 0, unknown: 0 }
  );
  const failedFiles = items.filter((it) => it.status === "error");
  const hasLineItemFile = items.some((it) => it.kind === "line_item");

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <StatBox label="นำเข้า" value={totals.inserted} tone="neutral" />
        <StatBox label="สำเร็จ" value={totals.transformed} tone="success" />
        <StatBox label="ไม่ผ่าน" value={totals.errored} tone="danger" />
        {hasLineItemFile && (
          <>
            <StatBox label="รอออเดอร์ (orphan)" value={totals.orphan} tone="neutral" />
            <StatBox label="SKU ไม่รู้จัก" value={totals.unknown} tone="danger" />
          </>
        )}
      </div>
      {failedFiles.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
          <p className="text-xs font-semibold text-red-800">ไฟล์ที่นำเข้าไม่สำเร็จ ({failedFiles.length})</p>
          <ul className="mt-1 space-y-0.5 text-xs text-red-700">
            {failedFiles.map((it, idx) => (
              <li key={idx}>
                {it.file.name}: {it.errorMessage}
              </li>
            ))}
          </ul>
        </div>
      )}
      {totals.errored > 0 && (
        <Link
          href="/crm/import-errors"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ดูรายการที่ไม่ผ่าน ({formatCount(totals.errored)})
        </Link>
      )}
    </>
  );
}
