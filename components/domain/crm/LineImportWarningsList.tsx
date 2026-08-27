"use client";

// LineImportWarningsList — shared by OrderImportClient.tsx (right after a
// line-item commit) and ImportBatchHistory.tsx (retroactively, from the
// history table). Renders the error_detail breadcrumbs that
// analytics.transform_pending_order_lines (0093/0094) writes on
// import_status='transformed' rows — these rows already counted toward
// fact_order_item/cogs/profit, so this is NOT an error list (compare
// ImportErrorGroupList.tsx, which is for import_status='error' rows that
// never made it in at all). This is "here's what the profit number is
// silently resting on."
//
// Grouping is by prefix match against WARNING_KIND_PREFIX (exported from
// lib/actions/import-line-items.ts, next to the proc comment that documents
// the exact strings) rather than a DB-typed error_code column — the
// line-item staging table has no error_code (only free-text error_detail,
// see getImportBatches()'s header comment on why the two staging tables are
// queried separately). A row whose text doesn't match any known prefix still
// renders, grouped under "อื่นๆ", instead of being silently dropped.

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { WARNING_KIND_PREFIX, type LineImportWarningRow } from "@/lib/actions/import-line-items";
import { formatCount } from "@/lib/tiktok/format";

type WarningKind = keyof typeof WARNING_KIND_PREFIX | "other";

const GROUP_ORDER: WarningKind[] = ["unknown_sku", "stripped_prefix_match", "inactive_match", "other"];

const GROUP_LABEL: Record<WarningKind, string> = {
  unknown_sku: "ไม่พบสินค้าในระบบ",
  stripped_prefix_match: "จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า (ไฟล์ต้นทางอาจพิมพ์รหัสผิด)",
  inactive_match: "จับคู่กับสินค้าที่ปิดการขาย (ใช้ต้นทุนเดิม)",
  other: "อื่นๆ",
};

const GROUP_TONE: Record<WarningKind, "red" | "amber" | "zinc"> = {
  unknown_sku: "red",
  stripped_prefix_match: "amber",
  inactive_match: "amber",
  other: "zinc",
};

const TONE_CLASSES: Record<"red" | "amber" | "zinc", { border: string; bg: string; heading: string; text: string; chip: string }> = {
  red: {
    border: "border-red-200",
    bg: "bg-red-50",
    heading: "text-red-900",
    text: "text-red-800",
    chip: "bg-red-100 text-red-800",
  },
  amber: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    heading: "text-amber-900",
    text: "text-amber-800",
    chip: "bg-amber-100 text-amber-800",
  },
  zinc: {
    border: "border-zinc-200",
    bg: "bg-zinc-50",
    heading: "text-zinc-800",
    text: "text-zinc-600",
    chip: "bg-zinc-200 text-zinc-700",
  },
};

function classify(errorDetail: string): WarningKind {
  for (const [kind, prefix] of Object.entries(WARNING_KIND_PREFIX) as [keyof typeof WARNING_KIND_PREFIX, string][]) {
    if (errorDetail.startsWith(prefix)) return kind;
  }
  return "other";
}

function groupRows(rows: LineImportWarningRow[]): Record<WarningKind, LineImportWarningRow[]> {
  const groups: Record<WarningKind, LineImportWarningRow[]> = {
    unknown_sku: [],
    stripped_prefix_match: [],
    inactive_match: [],
    other: [],
  };
  for (const row of rows) {
    groups[classify(row.errorDetail)].push(row);
  }
  return groups;
}

const COLLAPSE_THRESHOLD = 8;

function WarningGroup({ kind, rows }: { kind: WarningKind; rows: LineImportWarningRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const tone = TONE_CLASSES[GROUP_TONE[kind]];
  const visible = expanded ? rows : rows.slice(0, COLLAPSE_THRESHOLD);
  const hiddenCount = rows.length - visible.length;

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} p-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className={`flex items-center gap-1.5 text-sm font-bold ${tone.heading}`}>
          {kind === "unknown_sku" && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {GROUP_LABEL[kind]}
        </h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${tone.chip}`}>
          {formatCount(rows.length)} รายการ
        </span>
      </div>

      {kind === "unknown_sku" && (
        <p className={`mt-1 text-xs font-semibold ${tone.text}`}>
          ออเดอร์เหล่านี้ต้นทุนถูกนับเป็น 0 — กำไรที่แสดงจะสูงกว่าความจริง
        </p>
      )}
      {(kind === "stripped_prefix_match" || kind === "inactive_match") && (
        <p className={`mt-1 text-xs ${tone.text}`}>ไม่บล็อกการนำเข้า แต่ควรตรวจ/แก้รหัสสินค้าในไฟล์ต้นทาง (Shipnity) เพื่อความแม่นยำของกำไร</p>
      )}

      <ul className={`mt-2 space-y-1 text-xs ${tone.text}`}>
        {visible.map((row, idx) => (
          <li key={`${row.sourceOrderNo}-${row.skuRaw}-${idx}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="font-medium">
              ออเดอร์ {row.sourceOrderNo} · SKU {row.skuRaw}
              {row.productNameRaw ? ` (${row.productNameRaw})` : ""}
            </span>
            <span className="shrink-0 tabular-nums">{row.qty != null ? `${formatCount(row.qty)} ชิ้น` : null}</span>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`mt-2 flex min-h-9 items-center gap-1 text-xs font-semibold underline underline-offset-2 ${tone.heading}`}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ดูเพิ่มอีก {formatCount(hiddenCount)} รายการ
        </button>
      )}
      {expanded && rows.length > COLLAPSE_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={`mt-2 flex min-h-9 items-center gap-1 text-xs font-semibold underline underline-offset-2 ${tone.heading}`}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ย่อกลับ
        </button>
      )}
    </div>
  );
}

export function LineImportWarningsList({
  rows,
  totalCount,
}: {
  rows: LineImportWarningRow[];
  /** True total from the DB — may be larger than rows.length if the batch
   * has more than the fetch cap's worth of warnings. See
   * lib/actions/import-line-items.ts's WARNING_ROW_LIMIT comment. */
  totalCount: number;
}) {
  if (rows.length === 0) return null;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2">
      {totalCount > rows.length && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
          แสดง {formatCount(rows.length)} จากทั้งหมด {formatCount(totalCount)} รายการ — คำเตือนมีมากเกินกว่าจะแสดงทั้งหมดในหน้านี้
        </p>
      )}
      {GROUP_ORDER.map((kind) => (
        <WarningGroup key={kind} kind={kind} rows={groups[kind]} />
      ))}
    </div>
  );
}
