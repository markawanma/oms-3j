"use client";

// ContentEntryQueue — client container for /marketing/content/entry (design
// §1.2): the "+ เพิ่มโพสต์ใหม่วันนี้" widget (always rendered, independent
// of the read-queue's own state per §1.5 error row: "ต้องมี fallback ให้
// วางลิงก์โพสต์ใหม่ได้แม้คิวอ่านค่าพัง") sits above the T+1/T+3/T+7 queue,
// which renders loading/empty/error/success as passed down from the server
// page (this component receives already-fetched data, matching CampaignBoard/
// AgendaTaskCard's page-fetches-client-renders split elsewhere in this app).
//
// Confirmed-card state is lifted here (not re-fetched) because a post that
// just got real numbers drops out of v_content_entry_queue on the next
// query — the collapsed "✓ บันทึกแล้ว" summary has to come from what was
// just typed, not from asking the server again mid-session.

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ContentMetricCard, type ConfirmedMetrics } from "./ContentMetricCard";
import { ContentPostLinkForm } from "./ContentPostLinkForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { cleanupStaleContentDrafts } from "@/lib/marketing/content-entry-draft";
import type { ContentEntryQueueRow, ContentTypeRow } from "@/lib/marketing/content-types";

export function ContentEntryQueue({
  shopId,
  todayTh,
  rows,
  queueError,
  contentTypes,
}: {
  shopId: string;
  todayTh: string;
  /** null = the queue fetch itself failed (page.tsx caught it) — the "add
   * new post" widget below still renders regardless. */
  rows: ContentEntryQueueRow[] | null;
  queueError?: string;
  contentTypes: ContentTypeRow[];
}) {
  const [confirmedByPost, setConfirmedByPost] = useState<Record<string, ConfirmedMetrics>>({});

  useEffect(() => {
    cleanupStaleContentDrafts(shopId, todayTh);
    // Intentionally run once per mount only — shopId/todayTh don't change
    // within a single page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = Object.keys(confirmedByPost).length;
  const totalCount = rows?.length ?? 0;

  function handleConfirmed(postId: string, values: ConfirmedMetrics) {
    setConfirmedByPost((prev) => ({ ...prev, [postId]: values }));

    if (!rows) return;
    const idx = rows.findIndex((r) => r.postId === postId);
    const next = rows.slice(idx + 1).find((r) => r.postId !== postId && !(r.postId in confirmedByPost));
    if (next) {
      window.setTimeout(() => {
        document.getElementById(`content-metric-card-${next.postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }

  /** H1 fix (26 ก.ย. 69): "แก้เลขที่เพิ่งกรอก" on a confirmed card — drops
   * this postId back out of confirmedByPost so ContentMetricCard falls
   * through to its own (still-alive) mode/reviewValues state instead of the
   * collapsed summary. Only usable this session, before the next refresh —
   * see that component's file header for why. */
  function handleEditRequested(postId: string) {
    setConfirmedByPost((prev) => {
      if (!(postId in prev)) return prev;
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-semibold text-zinc-500">โพสต์ใหม่วันนี้</p>
        <ContentPostLinkForm existingPost={null} contentTypes={contentTypes} />
      </div>

      {rows !== null && totalCount > 0 && (
        <p className="text-xs font-medium text-zinc-500">
          ต้องอ่านวันนี้ · {doneCount}/{totalCount}
        </p>
      )}

      {rows === null ? (
        <ErrorState message={queueError ?? "โหลดคิวอ่านค่าไม่สำเร็จ ลองใหม่อีกครั้ง"} />
      ) : totalCount === 0 ? (
        <EmptyState icon={CheckCircle2} title="วันนี้ไม่มีโพสต์ต้องอ่านค่า" description="ครบแล้ว กลับมาใหม่พรุ่งนี้" />
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <ContentMetricCard
              key={row.postId}
              row={row}
              shopId={shopId}
              todayTh={todayTh}
              contentTypes={contentTypes}
              confirmed={confirmedByPost[row.postId]}
              onConfirmed={handleConfirmed}
              onEditRequested={handleEditRequested}
            />
          ))}
        </div>
      )}
    </div>
  );
}
