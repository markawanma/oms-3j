"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getPendingLabelReviews } from "@/lib/actions/labels";
import type { PendingLabelReviewRow } from "@/lib/labels/types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import { LabelReviewQueueRow } from "./LabelReviewQueueRow";

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
 *
 * Phase A (design-label-teach-loop-yoda-11sep.md §5 A, owner decisions
 * 11 ก.ย. 69): each row is now interactive (LabelReviewQueueRow) — resolve/
 * ignore a page right here instead of "อ่านอย่างเดียว". A resolved/ignored
 * row is removed from local state immediately (onResolved below) rather
 * than waiting on a full reload, so the queue visibly shrinks per action.
 */
export function PendingReviewQueue({
  refreshSignal,
  provinces,
  canEdit,
}: {
  refreshSignal?: number;
  provinces: CrmProvinceOption[];
  canEdit: boolean;
}) {
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

  const handleResolved = useCallback((pageId: string) => {
    setRows((prev) => (prev ? prev.filter((r) => r.pageId !== pageId) : prev));
  }, []);

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
        <div className="flex flex-col gap-2" role="list">
          {rows.map((row) => (
            <LabelReviewQueueRow
              key={row.pageId}
              row={row}
              fileName={row.fileName}
              orderSources={row.orderSources}
              provinces={provinces}
              canEdit={canEdit}
              onResolved={handleResolved}
            />
          ))}
        </div>
      )}
    </section>
  );
}
