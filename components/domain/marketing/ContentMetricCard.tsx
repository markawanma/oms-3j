"use client";

// ContentMetricCard — one post in the entry queue (§1.3): edit -> review ->
// confirm. Per-card confirm-before-write, not batched (design §6 trade-off
// 2): a review step that shows exactly what will be sent is cheap insurance
// against a typo becoming permanent. On RPC failure the card stays in
// review mode with the same values (design §1.3: "กลับไปโหมดทวน (ไม่ใช่
// โหมดกรอก) ค่าที่พิมพ์ไม่หาย กดยืนยันซ้ำได้ทันที").
//
// 🔴 Corrected 26 ก.ย. 69 (security ตรวจย้อนหลัง, H1): the line this replaced
// claimed "content_post_metric_upsert's data can't be un-typed or edited
// afterward" — that was WRONG. 0148 §H3 makes content_post_metric_upsert an
// upsert on (post_id, captured_on): calling it again for the SAME post on
// the SAME calendar day overwrites the row it just wrote, by design (0148's
// own comment: built to let a same-day typo be corrected). The RPC never
// closed that door — this file did, by giving the confirmed card no way
// back into edit mode. See the "แก้เลขที่เพิ่งกรอก" button below for the fix.
// It only reaches back into the SAME session, before the next refresh —
// captured_on is always today's date server-side, so once the day turns
// over (or the post drops out of v_content_entry_queue after its own
// refresh) there is no screen left that can reach this row again.
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

/** ทำไมช่องนี้ถึงถูกตีตก — มี 2 เหตุผลที่คนละเรื่องกัน และต้องพูดคนละอย่าง
 * บนจอ ไม่งั้นข้อความใต้ช่องจะโกหก (เคส cleared ช่องว่างเปล่าอยู่แล้ว
 * การบอกว่า "ตัวเลขยาวเกินไป" คือคนละเรื่องกับสิ่งที่เกิดขึ้นจริง) */
type InvalidReason = "overflow" | "cleared";

const INVALID_HINT: Record<InvalidReason, string> = {
  overflow: "ตัวเลขยาวเกินไป",
  cleared: "บันทึกไปแล้ว ลบให้ว่างไม่ได้",
};

export function ContentMetricCard({
  row,
  shopId,
  todayTh,
  contentTypes,
  confirmed,
  onConfirmed,
  onEditRequested,
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
  /** H1 fix (26 ก.ย. 69): the only way back out of the confirmed/collapsed
   * state — parent (ContentEntryQueue) drops this postId out of
   * confirmedByPost, which makes `confirmed` undefined again on the next
   * render and falls back to this component's own `mode`/`reviewValues`
   * state (still alive, never reset by a confirm) so the review screen
   * reappears pre-filled with what was just saved instead of a blank form. */
  onEditRequested: (postId: string) => void;
}) {
  const toast = useToast();
  const { draft, setField, clearDraft } = useContentEntryDraft(shopId, row.postId, todayTh);
  const [mode, setMode] = useState<"editing" | "reviewing">("editing");
  const [reviewValues, setReviewValues] = useState<ConfirmedMetrics>({});
  const [submitting, setSubmitting] = useState(false);
  // QA-found bug fix (26 ก.ย. 69): parseMetricFieldValue returns null for an
  // overflow/invalid field, but goToReview used to only check `typeof
  // parsed === "number"` and silently drop anything else — same code path
  // as an untouched field, so a fat-fingered 20-digit view count vanished
  // with no error. Tracked here so the offending input(s) get a visible
  // marker, cleared as soon as the owner edits that field again.
  /** 🔴 เก็บ "เหตุผล" ไม่ใช่แค่ "ผิด" — มี 2 เหตุผลที่คนละเรื่องกันสิ้นเชิง
   * (ตัวเลขยาวเกิน vs ลบช่องที่บันทึกไปแล้ว) ถ้าเก็บเป็น Set เฉยๆ ข้อความ
   * ใต้ช่องจะ hard-code ได้ข้อความเดียว แล้วเคส N1 เจ้าของจะเห็น
   * "ช่องว่างเปล่า + กรอบแดง + เขียนว่าตัวเลขยาวเกินไป" ซึ่งเป็นข้อความที่
   * ผิด — และ aria-describedby ก็จะบอกเหตุผลผิดให้ screen reader ด้วย
   * (toast พูดถูกแต่หายไปใน 3 วินาที ส่วน marker ที่ค้างบนจอพูดผิด) */
  const [invalidFields, setInvalidFields] = useState<Map<MetricField, InvalidReason>>(new Map());
  /** 🔴 N1 (26 ก.ย. 69): fields this post ALREADY has stored in the DB,
   * captured when "แก้เลขที่เพิ่งกรอก" reopens a confirmed card.
   *
   * content_post_metric_upsert (0148 §H1) merges null-preserving —
   * `coalesce(p_like, existing.like_count)` — and upsertContentMetric sends
   * `input.like ?? null` for an untouched field. That combination means a
   * field the owner CLEARS on a re-edit is sent as null and the old number
   * stays in the DB, while the review screen and the collapsed summary both
   * show it as blank. The screen would say "ไม่ได้กรอก" and the measurement
   * layer would still hold the typo — with a success toast on top. That is
   * the same class of silent-wrong-number bug the edit button exists to
   * fix, so the button must not be able to cause it.
   *
   * We can't send 0 instead (0 ≠ blank is a rule of this whole system), and
   * clearing for real needs an RPC that distinguishes "not sent" from
   * "clear this" — out of scope here. So: overwrite is allowed, clearing is
   * refused, and the UI says so in words. */
  const [savedFields, setSavedFields] = useState<Set<MetricField>>(new Set());

  const contentType = row.contentTypeCode ? contentTypes.find((ct) => ct.code === row.contentTypeCode) : undefined;

  function handleFieldChange(field: MetricField, raw: string) {
    setField(field, raw.replace(/[^\d]/g, ""));
    if (invalidFields.has(field)) {
      setInvalidFields((prev) => {
        const next = new Map(prev);
        next.delete(field);
        return next;
      });
    }
  }

  const hasAnyValue = METRIC_FIELD_ORDER.some((f) => (draft[f]?.trim() ?? "") !== "");

  function goToReview() {
    const values: ConfirmedMetrics = {};
    const invalid = new Map<MetricField, InvalidReason>();
    for (const f of METRIC_FIELD_ORDER) {
      const parsed = parseMetricFieldValue(draft[f]);
      if (parsed === null) {
        // Overflow (>Number.MAX_SAFE_INTEGER) — content-types.ts's own
        // comment says "caller should treat null as invalid, block submit".
        // Block here instead of silently treating it like an empty field.
        invalid.set(f, "overflow");
      } else if (typeof parsed === "number") {
        values[f] = parsed;
      }
    }
    if (invalid.size > 0) {
      setInvalidFields(invalid);
      toast.push(
        `ตัวเลขช่อง ${Array.from(invalid.keys())
          .map((f) => METRIC_FIELD_LABEL[f])
          .join(", ")} ยาวเกินไป ตรวจดูอีกครั้งก่อนบันทึก`,
        "error"
      );
      return;
    }
    // 🔴 N1: a field already stored in the DB cannot be cleared from here —
    // the RPC merges null-preserving, so sending blank leaves the old
    // number in place while the screen shows it gone. Refuse loudly
    // instead of confirming a lie. (Overwriting with a different number is
    // fine and is the whole point of this path.)
    const cleared = Array.from(savedFields).filter((f) => values[f] === undefined);
    if (cleared.length > 0) {
      setInvalidFields(new Map(cleared.map((f) => [f, "cleared" as const])));
      toast.push(
        `ช่อง ${cleared
          .map((f) => METRIC_FIELD_LABEL[f])
          .join(", ")} บันทึกไปแล้ว — ลบให้ว่างไม่ได้ (ค่าเดิมจะยังอยู่) ใส่ตัวเลขที่ถูกต้องทับแทน`,
        "error"
      );
      return;
    }

    setInvalidFields(new Map());
    setReviewValues(values);
    setMode("reviewing");
  }

  function handleRequestEdit() {
    if (!confirmed) return;
    // Pre-fill both the review screen (reviewValues) and the underlying
    // draft (so tapping "แก้ไข" afterward shows the old numbers instead of
    // blank inputs — clearDraft() already wiped localStorage on confirm).
    const saved = new Set<MetricField>();
    for (const f of METRIC_FIELD_ORDER) {
      const v = confirmed[f];
      if (typeof v === "number") {
        setField(f, String(v));
        saved.add(f); // N1: already in the DB — can be overwritten, not cleared
      }
    }
    setSavedFields(saved);
    setReviewValues(confirmed);
    setMode("reviewing");
    onEditRequested(row.postId);
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
        className="space-y-1 rounded-lg border border-green-200 bg-green-50 p-3 text-sm"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-green-800">
            <span className="font-semibold">บันทึกแล้ว</span>
            {summaryParts.length > 0 && <span className="text-green-700"> — {summaryParts.join(" · ")}</span>}
          </p>
          <button
            type="button"
            onClick={handleRequestEdit}
            className="min-h-8 shrink-0 text-xs font-semibold text-green-700 underline hover:text-green-900"
          >
            แก้เลขที่เพิ่งกรอก
          </button>
        </div>
        {/* H1 fix: the limitation has to be on-screen, not just in a code
            comment — captured_on is always "today" server-side, so this
            path only works before the next page refresh. Once that happens
            (or the day turns over) this post is gone from the queue for
            good and no screen can reach it again. */}
        <p className="pl-6 text-[0.7rem] text-green-700/70">
          แก้ได้เฉพาะตอนนี้ก่อนออกจากหน้านี้ — ทับค่าเดิมได้ แต่ลบช่องให้ว่างไม่ได้
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
            {METRIC_FIELD_ORDER.map((field) => {
              const invalidReason = invalidFields.get(field);
              const isInvalid = invalidReason !== undefined;
              return (
                <div key={field}>
                  <div className="flex items-center gap-2">
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
                      aria-invalid={isInvalid || undefined}
                      aria-describedby={isInvalid ? `metric-${row.postId}-${field}-error` : undefined}
                      className={`min-h-11 flex-1 rounded-md border px-3 text-sm focus:outline-none ${
                        isInvalid
                          ? "border-red-400 focus:border-red-500"
                          : "border-zinc-300 focus:border-primary-500"
                      }`}
                    />
                    <span className="w-8 shrink-0 text-xs text-zinc-400">คน</span>
                  </div>
                  {invalidReason && (
                    <p id={`metric-${row.postId}-${field}-error`} className="ml-[6.5rem] mt-0.5 text-[0.7rem] text-red-600">
                      {INVALID_HINT[invalidReason]}
                    </p>
                  )}
                </div>
              );
            })}
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
            {/* เคยเขียนว่า "แก้ทีหลังไม่ได้" (ไม่จริง — H1 เปิดทางแก้แล้ว)
                แล้วเปลี่ยนเป็น "ข้ามวันแล้วแก้ไม่ได้" ซึ่ง**ก็ยังไม่จริง**
                เพราะ 0149 เตะโพสต์ออกจากคิวทันทีที่มีตัวเลขในหน้าต่างอายุ
                เดียวกัน ⇒ รีเฟรชก็จบแล้ว ไม่ต้องรอข้ามวัน
                ฉบับปัจจุบันบอกขอบเขตจริง: แก้ได้แค่ก่อนรีเฟรชหน้านี้ */}
            {/* H1 (26 ก.ย. 69): เคยเขียนว่า "ข้ามวันแล้วแก้ไม่ได้" ซึ่งอ่านแล้ว
                แปลว่าวันนี้ยังแก้ได้เรื่อยๆ — ไม่จริง พอมีตัวเลขจริงในหน้าต่าง
                อายุเดียวกัน โพสต์หลุดจาก v_content_entry_queue ทันที (0149)
                ⇒ รีเฟรชก็จบแล้ว ไม่ต้องรอข้ามวัน */}
            <p className="text-xs font-semibold text-zinc-600">ทวนก่อนบันทึก — กดยืนยันแล้วแก้ได้แค่ก่อนรีเฟรชหน้านี้</p>
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
