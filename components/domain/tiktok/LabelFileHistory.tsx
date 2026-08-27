"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getLabelFiles } from "@/lib/actions/labels";
import type { LabelFileListItem } from "@/lib/labels/types";

const STATUS_TONE: Record<LabelFileListItem["status"], BadgeTone> = {
  uploaded: "blue",
  parsed: "green",
  parse_failed: "red",
  purged: "slate",
};

const STATUS_LABEL: Record<LabelFileListItem["status"], string> = {
  uploaded: "อัปแล้ว รอบันทึกผลอ่าน",
  parsed: "อ่านแล้ว",
  parse_failed: "อ่านไม่สำเร็จ",
  purged: "ลบไฟล์แล้ว (เกิน retention)",
};

function formatDateTimeTH(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * LabelFileHistory — "ประวัติไฟล์" ด้านล่างของ /tiktok/upload (design §8).
 * Loads independently of the upload queue above (own loading/error/empty
 * states) so a failed history fetch never blocks uploading new files.
 * getLabelFiles() is currently a STUB (lib/actions/labels.ts) that throws —
 * until Han's backend lands, this legitimately shows the error state below
 * with a retry button, which is the honest state to show, not a fake empty list.
 */
export function LabelFileHistory() {
  const [files, setFiles] = useState<LabelFileListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLabelFiles();
      if (result.ok) {
        setFiles(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดประวัติไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="ประวัติไฟล์ใบปะหน้า">
      <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">ประวัติไฟล์</p>

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="กำลังโหลดประวัติไฟล์">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-3">
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!loading && !error && files && files.length === 0 && (
        <EmptyState icon={History} title="ยังไม่มีไฟล์ในประวัติ" description="ไฟล์ที่อัปโหลดแล้วจะโผล่ที่นี่" />
      )}

      {!loading && !error && files && files.length > 0 && (
        <div className="flex flex-col gap-2" role="list">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-800">{f.fileName}</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {f.pageCount ?? "–"} หน้า · {formatDateTimeTH(f.uploadedAt)}
                </p>
              </div>
              <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
