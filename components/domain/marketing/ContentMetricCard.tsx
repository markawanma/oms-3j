"use client";

// ContentMetricCard — one post in the entry queue (§1.3): edit -> review ->
// confirm. Per-card confirm-before-write, not batched (design §6 trade-off
// 2): content_post_metric_upsert's data can't be un-typed or edited
// afterward (0148 §H3/edit-after-save note in the doc), so a review step
// that shows exactly what will be sent is cheap insurance against a typo
// becoming permanent. On RPC failure the card stays in review mode with
// the same values (design §1.3: "กลับไปโหมดทวน (ไม่ใช่โหมดกรอก) ค่าที่
// พิมพ์ไม่หาย กดยืนยันซ้ำได้ทันที").
//
// Numbers are never coalesced to 0 anywhere in this file — an untouched
// field stays undefined all the way to the RPC call (content_post_metric_
// upsert's own null-preserving default), matching "ตัวเลขที่ยังไม่ได้กรอก =
// ว่าง ไม่ใช่ 0".

import { useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { upsertContentMetric } from "@/lib/actions/content";
import {
  METRIC_FIELD_HINT,
  METRIC_FIELD_LABEL,
  METRIC_FIELD_ORDER,
  PLATFORM_LABEL,
  READ_ROUND_LABEL,
  parseMetricFieldValue,
} from "@/lib/marketing/content-types";
import type { ContentEntryQueueRow, ContentTypeRow, MetricField } from "@/lib/marketing/content-types";
import { useContentEntryDraft } from "@/lib/marketing/content-entry-draft";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";

export type ConfirmedMetrics = Partial<Record<MetricField, number>>;

export function ContentMetricCard({
  row,
  shopId,
  todayTh,
  contentTypes,
  confirmed,
  onConfirmed,
}: {
  row: ContentEntryQueueRow;
  shopId: string;
  todayTh: string;
  contentTypes: ContentTypeRow[];
  /** Present once this card has been confirmed this session — renders the
   * collapsed summary instead of the form (design §1.2's "✓ บันทึกแล้ว"
   * row). Lifted to the parent because a confirmed post drops out of
   * v_content_entry_queue on the next fetch — the summary has to come from
   * what was just typed, not from a re-query. */
  confirmed?: ConfirmedMetrics;
  onConfirmed: (postId: string, values: ConfirmedMetrics) => void;
}) {
  const toast = useToast();
  const { draft, setField, clearDraft } = useContentEntryDraft(shopId, row.postId, todayTh);
  const [mode, setMode] = useState<"editing" | "reviewing">("editing");
  const [reviewValues, setReviewValues] = useState<ConfirmedMetrics>({});
  const [submitting, setSubmitting] = useState(false);

  const contentType = row.contentTypeCode ? contentTypes.find((ct) => ct.code === row.contentTypeCode) : undefined;

  function handleFieldChange(field: MetricField, raw: string) {
    setField(field, raw.replace(/[^\d]/g, ""));
  }

  const hasAnyValue = METRIC_FIELD_ORDER.some((f) => (draft[f]?.trim() ?? "") !== "");

  function goToReview() {
    const values: ConfirmedMetrics = {};
    for (const f of METRIC_FIELD_ORDER) {
      const parsed = parseMetricFieldValue(draft[f]);
      if (typeof parsed === "number") values[f] = parsed;
    }
    setReviewValues(values);
    setMode("reviewing");
  }

  function handleConfirm() {
    setSubmitting(true);
    upsertContentMetric({
      postId: row.postId,
      view: reviewValues.view,
      like: reviewValues.like,
      comment: reviewValues.comment,
      save: reviewValues.save,
      share: reviewValues.share,
    })
      .then((result) => {
        setSubmitting(false);
        if (!result.ok) {
          toast.push(result.error, "error");
          // Stays in "reviewing" — values untouched, retry is one tap away.
          return;
        }
        toast.push("บันทึกแล้ว");
        clearDraft();
        onConfirmed(row.postId, reviewValues);
      })
      .catch(() => {
        setSubmitting(false);
        toast.push("บันทึกไม่สำเร็จ เช็คสัญญาณเน็ตแล้วลองใหม่", "error");
      });
  }

  // ---- Collapsed / done ---------------------------------------------------
  if (confirmed) {
    const summaryParts = METRIC_FIELD_ORDER.filter((f) => typeof confirmed[f] === "number").map(
      (f) => `${METRIC_FIELD_LABEL[f]} ${confirmed[f]!.toLocaleString("en-US")}`
    );
    return (
      <div
        id={`content-metric-card-${row.postId}`}
        className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
        <p className="min-w-0 truncate text-green-800">
          <span className="font-semibold">บันทึกแล้ว</span>
          {summaryParts.length > 0 && <span className="text-green-700"> — {summaryParts.join(" · ")}</span>}
        </p>
      </div>
    );
  }

  return (
    <div id={`content-metric-card-${row.postId}`} className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
          🕐 {READ_ROUND_LABEL[row.readRound]}
        </span>
        {contentType && <ContentTypeChip contentType={contentType} />}
      </div>

      {row.captionSnapshot && <p className="truncate text-xs text-zinc-500">{row.captionSnapshot}</p>}

      <a
        href={row.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        เปิดดูใน {PLATFORM_LABEL[row.platform]}
      </a>

      {mode === "editing" ? (
        <>
          <div className="space-y-2">
            {METRIC_FIELD_ORDER.map((field) => (
              <div key={field} className="flex items-center gap-2">
                <label htmlFor={`metric-${row.postId}-${field}`} className="w-24 shrink-0 text-xs font-medium text-zinc-600">
                  {METRIC_FIELD_LABEL[field]}
                </label>
                <input
                  id={`metric-${row.postId}-${field}`}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={draft[field] ?? ""}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                  placeholder="—"
                  className="min-h-11 flex-1 rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
                />
                <span className="w-8 shrink-0 text-xs text-zinc-400">คน</span>
              </div>
            ))}
          </div>
          {METRIC_FIELD_HINT.save && (
            <p className="text-[0.7rem] text-zinc-400">📌 {METRIC_FIELD_LABEL.save}: {METRIC_FIELD_HINT.save}</p>
          )}
          <p className="text-xs text-zinc-400">ช่องไหนไม่รู้ เว้นว่างได้ — ไม่ต้องใส่ 0</p>
          <Button className="w-full" disabled={!hasAnyValue} onClick={goToReview}>
            บันทึกโพสต์นี้
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-1.5 rounded-md border border-zinc-100 bg-zinc-50/60 p-2.5">
            <p className="text-xs font-semibold text-zinc-600">ทวนก่อนบันทึก — แก้ทีหลังไม่ได้</p>
            {METRIC_FIELD_ORDER.map((field) => (
              <div key={field} className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">{METRIC_FIELD_LABEL[field]}</span>
                <span className={typeof reviewValues[field] === "number" ? "font-semibold text-zinc-800" : "text-zinc-400"}>
                  {typeof reviewValues[field] === "number" ? reviewValues[field]!.toLocaleString("en-US") : "— (ไม่ได้กรอก)"}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => setMode("editing")}>
              แก้ไข
            </Button>
            <Button className="flex-1" loading={submitting} onClick={handleConfirm}>
              ยืนยันบันทึก
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
