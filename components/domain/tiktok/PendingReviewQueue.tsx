"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getPendingLabelReviews } from "@/lib/actions/labels";
import type { PendingLabelReviewRow } from "@/lib/labels/types";
import { REVIEW_STATUS_TONE, reviewRowStatusLabel } from "./ReviewQueueList";

/**
 * PendingReviewQueue — bug 2 fix (UAT 29 ส.ค. 69): "ขึ้นว่ารอคนตรวจ แต่พอกดไป
 * หน้าอื่นแล้วกลับมา ส่วนที่รอคนตรวจหายไป". The per-upload
 * `LabelParseSummary.reviewRows` shown right after parsing lives only in
 * UploadPageClient's React state for that round — this component instead
 * loads the durable queue from analytics.stg_label_page directly
 * (getPendingLabelReviews(), shop-wide, every file) on mount, so it survives
 * navigating away and back. Independent loading/error/empty state from the
 * upload queue above it, same pattern as LabelFileHistory — a failed load
 * here must never block uploading new files.
 */
export function PendingReviewQueue({ refreshSignal }: { refreshSignal?: number } = {}) {
  const [rows, setRows] = useState<PendingLabelReviewRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPendingLabelReviews();
      if (result.ok) {
        setRows(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคิวรอตรวจไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshSignal: bumped by UploadPageClient after each file finishes
  // parsing in the SAME session, so a page that just landed in the queue
  // shows up here immediately instead of only after leaving and returning
  // (revalidatePath() alone doesn't push into this client-fetched state).
  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  return (
    <section aria-label="คิวรอตรวจสอบ (ทุกไฟล์)">
      <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">
        คิวรอตรวจสอบ (ทุกไฟล์){rows && rows.length > 0 ? ` — ${rows.length}` : ""}
      </p>

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="กำลังโหลดคิวรอตรวจสอบ">
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

      {!loading && !error && rows && rows.length === 0 && (
        <EmptyState icon={ListChecks} title="ไม่มีหน้าค้างรอตรวจ" description="ทุกหน้าจับคู่จังหวัดได้ครบแล้ว" />
      )}

      {!loading && !error && rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[680px] text-left text-sm">
            <caption className="sr-only">
              คิวรอตรวจสอบทุกไฟล์ — อ่านจากฐานข้อมูลตรง อยู่ครบแม้ออกจากหน้านี้แล้วกลับมา
            </caption>
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-bold tracking-wide text-zinc-500 uppercase">
              <tr>
                <th scope="col" className="px-3 py-2">
                  ไฟล์
                </th>
                <th scope="col" className="px-3 py-2 tabular-nums">
                  หน้า
                </th>
                <th scope="col" className="px-3 py-2">
                  เลขพัสดุ
                </th>
                <th scope="col" className="px-3 py-2">
                  รหัสไปรษณีย์
                </th>
                <th scope="col" className="px-3 py-2">
                  สถานะ
                </th>
                <th scope="col" className="px-3 py-2">
                  จังหวัดที่เป็นไปได้
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.pageId}>
                  <td className="max-w-[220px] truncate px-3 py-2 text-zinc-700" title={row.fileName}>
                    {row.fileName}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">{row.pageNo}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">{row.trackingNo ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">{row.zipcode ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={REVIEW_STATUS_TONE[row.status]}>{reviewRowStatusLabel(row)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {row.candidates.length > 0 ? row.candidates.map((c) => c.nameTh).join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-400">
            อ่านอย่างเดียวในเฟสนี้ — เลือกจังหวัดเองรายแถวได้ในเฟสถัดไป
          </p>
        </div>
      )}
    </section>
  );
}
