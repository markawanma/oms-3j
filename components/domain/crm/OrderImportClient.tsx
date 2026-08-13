"use client";

// OrderImportClient — /crm/import (docs/3j-jewelry/analytics/phase-import-ui-design.md
// §3.3 state machine). Two flows share one dropzone:
//   - single file  -> previewOrderImport -> preview card -> commitOrderImport -> done
//   - >1 files     -> client queues previewOrderImport per file -> summary table
//                     -> commitOrderImport sequentially (never parallel, per D3) ->
//                     live per-file results
// Server actions are stateless (D2) — the same File object is re-sent for
// preview and commit, so parsing happens twice. That's an accepted trade-off
// (design §6 debt #6), not a bug.

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
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { formatCount } from "@/lib/tiktok/format";
import { formatPeriodHint, formatDateRange, validateXlsxFile } from "@/lib/crm/import-client";

interface PreviewItem {
  file: File;
  status: "ok" | "duplicate" | "shape_error" | "preview_error";
  preview?: ImportPreview;
  errorMessage?: string;
}

interface CommitItem {
  file: File;
  status: "pending" | "committing" | "done" | "error";
  result?: ImportCommitResult;
  errorMessage?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "previewing_single" }
  | { kind: "previewing_multi"; total: number; done: number }
  | { kind: "preview_single"; file: File; preview: ImportPreview }
  | { kind: "preview_multi"; items: PreviewItem[] }
  | { kind: "committing_single" }
  | { kind: "committing_multi"; items: CommitItem[] }
  | { kind: "done_single"; result: ImportCommitResult }
  | { kind: "done_multi"; items: CommitItem[] }
  | { kind: "error"; message: string; retry?: () => void };

const PROFIT_NOTE = "กำไรเป็นค่าประเมิน จนกว่าจะผูกรายการสินค้า";

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

export function OrderImportClient() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  function reset() {
    setPhase({ kind: "idle" });
  }

  function toFormData(file: File): FormData {
    const fd = new FormData();
    fd.set("file", file);
    return fd;
  }

  async function previewSingle(file: File) {
    setPhase({ kind: "previewing_single" });
    try {
      const result = await previewOrderImport(toFormData(file));
      if (!result.ok) {
        setPhase({ kind: "error", message: result.error, retry: () => void previewSingle(file) });
        return;
      }
      setPhase({ kind: "preview_single", file, preview: result.data });
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
        const result = await previewOrderImport(toFormData(file));
        if (!result.ok) {
          items.push({ file, status: "preview_error", errorMessage: result.error });
        } else if (result.data.shapeIssues.length > 0) {
          items.push({ file, status: "shape_error", preview: result.data });
        } else if (result.data.duplicateFile) {
          items.push({ file, status: "duplicate", preview: result.data });
        } else {
          items.push({ file, status: "ok", preview: result.data });
        }
      } catch (err) {
        items.push({ file, status: "preview_error", errorMessage: err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ" });
      }
      setPhase({ kind: "previewing_multi", total: files.length, done: i + 1 });
    }
    setPhase({ kind: "preview_multi", items });
  }

  async function commitSingle(file: File) {
    setPhase({ kind: "committing_single" });
    try {
      const result = await commitOrderImport(toFormData(file));
      if (!result.ok) {
        setPhase({ kind: "error", message: result.error, retry: () => void commitSingle(file) });
        toast.push(result.error, "error");
        return;
      }
      setPhase({ kind: "done_single", result: result.data });
      toast.push(`นำเข้าสำเร็จ — แปลงสำเร็จ ${result.data.transformed} รายการ`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "นำเข้าไม่สำเร็จ";
      setPhase({ kind: "error", message, retry: () => void commitSingle(file) });
      toast.push(message, "error");
    }
  }

  async function commitMulti(files: File[]) {
    let items: CommitItem[] = files.map((file) => ({ file, status: "pending" }));
    setPhase({ kind: "committing_multi", items });
    // Sequential on purpose (design D3) — transform_pending_orders is a
    // per-row server-side loop, running two commits in parallel would race.
    for (let i = 0; i < items.length; i++) {
      items = items.map((it, idx) => (idx === i ? { ...it, status: "committing" } : it));
      setPhase({ kind: "committing_multi", items });
      try {
        const result = await commitOrderImport(toFormData(items[i].file));
        if (!result.ok) {
          items = items.map((it, idx) => (idx === i ? { ...it, status: "error", errorMessage: result.error } : it));
        } else {
          items = items.map((it, idx) => (idx === i ? { ...it, status: "done", result: result.data } : it));
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
                <span className="text-sm font-medium text-zinc-700">เลือกไฟล์รายงานยอดขาย (.xlsx)</span>
                <span className="text-xs text-zinc-400">
                  เลือกได้หลายไฟล์พร้อมกัน (สำหรับนำเข้าย้อนหลังหลายเดือน) · ไม่เกิน 4MB/ไฟล์
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

      {phase.kind === "preview_single" && (
        <SinglePreviewCard
          preview={phase.preview}
          onConfirm={() => void commitSingle(phase.file)}
          onReset={reset}
        />
      )}

      {phase.kind === "preview_multi" && (
        <MultiPreviewTable
          items={phase.items}
          onConfirm={() => {
            const eligible = phase.items.filter((it) => it.status === "ok").map((it) => it.file);
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
          <CommitResultSummary result={phase.result} />
          <p className="text-xs text-zinc-500">{PROFIT_NOTE}</p>
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
          <p className="text-xs text-zinc-500">{PROFIT_NOTE}</p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              นำเข้าไฟล์ถัดไป
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <ErrorState message={phase.message} onRetry={phase.retry ?? reset} />
      )}
    </div>
  );
}

function SinglePreviewCard({
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
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
              <th className="px-2 py-1.5">ไฟล์</th>
              <th className="px-2 py-1.5 text-right">แถว</th>
              <th className="px-2 py-1.5">เดือน</th>
              <th className="px-2 py-1.5">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const statusInfo = PREVIEW_STATUS_LABEL[it.status];
              const note =
                it.status === "shape_error"
                  ? it.preview?.shapeIssues.join("; ")
                  : it.status === "duplicate"
                    ? `นำเข้าแล้วเมื่อ ${formatDateRange(it.preview?.duplicateFile?.importedAt ?? null, null)}`
                    : it.status === "preview_error"
                      ? it.errorMessage
                      : null;
              return (
                <tr key={idx} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="px-2 py-1.5 font-medium text-zinc-700">
                    <p className="truncate max-w-[220px]">{it.file.name}</p>
                    {note && <p className="mt-0.5 text-[0.68rem] font-normal text-zinc-400">{note}</p>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                    {it.preview ? formatCount(it.preview.rowCount) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600">{it.preview ? formatPeriodHint(it.preview.periodHint) : "—"}</td>
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
        {items.map((it, idx) => (
          <li key={idx} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-zinc-700">{it.file.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              {it.status === "pending" && <span className="text-zinc-400">รอคิว</span>}
              {it.status === "committing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden="true" />}
              {it.status === "done" && (
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatCount(it.result?.transformed ?? 0)} สำเร็จ
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
        ))}
      </ul>
    </div>
  );
}

function MultiDoneSummary({ items }: { items: CommitItem[] }) {
  const totals = items.reduce(
    (acc, it) => {
      if (it.result) {
        acc.inserted += it.result.inserted;
        acc.transformed += it.result.transformed;
        acc.errored += it.result.errored;
      }
      return acc;
    },
    { inserted: 0, transformed: 0, errored: 0 }
  );
  const failedFiles = items.filter((it) => it.status === "error");

  return (
    <>
      <div className="flex gap-3">
        <StatBox label="นำเข้า" value={totals.inserted} tone="neutral" />
        <StatBox label="สำเร็จ" value={totals.transformed} tone="success" />
        <StatBox label="ไม่ผ่าน" value={totals.errored} tone="danger" />
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
