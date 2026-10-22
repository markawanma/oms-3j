"use client";

// JobCreateGems — ส่วน "พลอยต่อชิ้น" ในฟอร์มสร้างใบงาน (UX §5.1) · แม่แบบ SKU มาให้ (ป้าย "จากแม่แบบ") แก้ได้เฉพาะใบนี้ ไม่เขียนกลับ SKU (มติ sku-autofill-decisions)
// 🔴 ไม่มีราคา/ต้นทุน/ป้าย "ยังไม่มีราคา" — ฟอร์มนี้ staff ใช้ได้ · ตัวเลข "รวม" = จำนวนต่อชิ้น × จำนวนที่จะเริ่มผลิต (จำนวนเต็ม · DB คำนวณซ้ำและชนะ)
// ผูกกับขั้น: ระบบไม่เพิ่ม/ลบขั้นให้เอง — เพิ่มแถวแรกแล้วขั้น "ฝังพลอย" ยังไม่ติ๊ก → ติ๊กให้ + บอก (ผู้ใช้เอาออกได้ → เตือน amber ไม่บล็อก)
// state: loading (แม่แบบจาก preview — แถวกรอกได้) · empty ("ยังไม่มีพลอยในใบนี้") · error (ต่อช่อง + ระดับฟอร์ม) · success

import { GemRowsEditor } from "@/components/domain/gems/GemRowsEditor";
import type { GemRowServerErrors } from "@/components/domain/gems/GemRowsEditor";
import { GemErrorLine } from "@/components/domain/gems/ui";
import { Skeleton } from "@/components/ui/Skeleton";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemOptions } from "@/lib/jobs/gems";

export function JobCreateGems({
  rows,
  onRows,
  templateCount,
  sku,
  templateLoading,
  gemTickNote,
  warnings,
  blocking,
  showIssues,
  rowErrors,
  generalError,
  options,
  optionsState,
  optionsError,
  onRetryOptions,
  qtyPlanned,
  qtyNote,
  disabled,
}: {
  rows: GemDraftRow[];
  onRows: (rows: GemDraftRow[]) => void;
  templateCount: number;
  sku: string | null;
  templateLoading: boolean;
  /** ติ๊กขั้น "ฝังพลอย" ให้อัตโนมัติแล้ว (บอกผู้ใช้) */
  gemTickNote: boolean;
  warnings: string[];
  blocking: string | null;
  showIssues: boolean;
  rowErrors: GemRowServerErrors;
  generalError: string | null;
  options: GemOptions | null;
  optionsState: "loading" | "error" | "ready";
  optionsError?: string | null;
  onRetryOptions?: () => void;
  qtyPlanned: number | null;
  qtyNote: string | null;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border border-zinc-200 p-3" disabled={disabled} data-testid="job-create-gems">
      <legend className="px-1 text-sm font-semibold text-zinc-800">
        พลอยต่อชิ้น
        {templateCount > 0 && sku && <span className="ml-2 rounded-sm bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950">จากแม่แบบ SKU {sku}</span>}
      </legend>
      {templateLoading && (
        <div role="status" aria-label="กำลังโหลดแม่แบบพลอย" className="space-y-1.5">
          <Skeleton className="h-4 w-56" />
        </div>
      )}
      <GemRowsEditor
        idPrefix="jc-gem"
        rows={rows}
        onChange={onRows}
        options={options}
        optionsState={optionsState}
        optionsError={optionsError}
        onRetryOptions={onRetryOptions}
        qtyPlanned={qtyPlanned}
        qtyNote={qtyNote}
        showIssues={showIssues}
        serverErrors={rowErrors}
        disabled={disabled}
        layout="card"
      />
      {gemTickNote && (
        <p role="status" className="text-xs font-medium text-zinc-800">
          ติ๊กขั้น “ฝังพลอย” ให้แล้ว เพราะมีพลอย
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-950 break-words">
          ⚠ {w}
        </p>
      ))}
      {showIssues && blocking && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800 break-words" data-testid="job-create-gems-blocking">
          {blocking}
        </p>
      )}
      <GemErrorLine message={generalError} />
    </fieldset>
  );
}
