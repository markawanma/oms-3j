"use client";

// ImportBatchHistory — /crm/import (design §3.3): history table of
// stg_import_batch rows for source_type='excel_order_report'. Delete is only
// offered for 'failed'/'loaded' batches — 'transformed' batches are wired
// into fact_order already and deleteStuckBatch() itself refuses those
// server-side too (belt + suspenders, see §3.2).

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteStuckBatch, type ImportBatchRow } from "@/lib/actions/import-orders";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

export function ImportBatchHistory({ initialRows }: { initialRows: ImportBatchRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
            <th className="px-3 py-2">ไฟล์</th>
            <th className="px-3 py-2">เดือน</th>
            <th className="px-3 py-2 text-right">อ่านได้ → โหลด</th>
            <th className="px-3 py-2 text-right">error</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2">นำเข้าเมื่อ</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const canDelete = r.status === "failed" || r.status === "loaded";
            return (
              <tr key={r.batchId} className="border-b border-zinc-100 last:border-0 align-top">
                <td className="px-3 py-2 font-medium text-zinc-700">
                  <p className="max-w-[200px] truncate">{r.fileName ?? "(ไม่ทราบชื่อไฟล์)"}</p>
                </td>
                <td className="px-3 py-2 text-zinc-600">{formatPeriodHint(r.periodHint)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-600">
                  {r.rowCountParsed != null ? formatCount(r.rowCountParsed) : "—"} → {r.rowCountLoaded != null ? formatCount(r.rowCountLoaded) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.errorCount > 0 ? (
                    <Link
                      href="/crm/import-errors"
                      className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {formatCount(r.errorCount)}
                    </Link>
                  ) : (
                    <span className="text-zinc-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL_TH[r.status]}</Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{formatBangkokTime(r.importedAt)}</td>
                <td className="px-3 py-2">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
