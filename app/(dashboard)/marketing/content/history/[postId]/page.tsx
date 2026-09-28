import Link from "next/link";
import { ArrowLeft, ExternalLink, FileQuestion, Lock } from "lucide-react";
import { getContentPostKpiDetail, getContentTypes } from "@/lib/actions/content";
import { getEffectiveRole } from "@/lib/auth/role";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { ContentKpiPanel } from "@/components/domain/marketing/ContentKpiPanel";
import { ContentKpiChecklist } from "@/components/domain/marketing/ContentKpiChecklist";
import { PLATFORM_LABEL } from "@/lib/marketing/content-types";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

/** "—" for a null field — same convention as
 * ContentPostHistoryTable.tsx's fmtMetric (null ≠ 0, see that file's own
 * comment on content_post_metric's columns). */
function fmtMetric(n: number | null): string {
  return n === null ? "—" : formatCount(n);
}

/** content-kpi-definition.md §1: "บันทึก = บันทึก ÷ วิว" — displayed as a
 * percentage alongside the raw count (screen design §3.1's wireframe: "🔖
 * บันทึก 1 (0.7%)"). */
function fmtRatePercent(rate: number | null): string {
  return rate === null ? "" : ` (${(rate * 100).toFixed(1)}%)`;
}

// /marketing/content/history/[postId] — "ดู KPI ของคลิป + suggestion"
// (docs/3j-jewelry/analytics/content-kpi-screen-design.md, Padmé 28 ก.ย. 69).
// Full page, not a modal/accordion — same reasoning as
// /marketing/calendar/[stepId] (design §1: modal can't be deep-linked, and
// this screen's several sub-states need more room than a table row can give
// on mobile without scroll-within-scroll).
export default async function ContentPostKpiDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดู KPI ของ content ได้"
      />
    );
  }

  const { postId } = await params;

  let result;
  let contentTypesResult;
  try {
    // Independent fetches (same "คนละ query กัน" principle as
    // calendar/[stepId]/page.tsx) — content_type is small global reference
    // data; a failure there must not take down the KPI detail itself, it
    // just means the header renders without a colored chip.
    [result, contentTypesResult] = await Promise.all([
      getContentPostKpiDetail(postId),
      getContentTypes().catch((err) => {
        console.error("getContentTypes failed (non-blocking)", err);
        return { ok: false as const, error: "โหลดประเภทเนื้อหาไม่สำเร็จ" };
      }),
    ]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }
  const contentTypes = contentTypesResult.ok ? contentTypesResult.data : [];

  const backLink = (
    <Link
      href="/marketing/content/history"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      กลับไปประวัติ
    </Link>
  );

  // Design §7 "Error state": postId ไม่มีอยู่จริง (invalid UUID, deleted,
  // wrong shop) → not a retry-able error, "postId ผิดจะ retry ไม่ช่วย" — same
  // "not found -> data:null" contract as getCalendarTask/[stepId]/page.tsx.
  if (!result.data) {
    return (
      <div className="space-y-4">
        {backLink}
        <EmptyState
          icon={FileQuestion}
          title="ไม่พบโพสต์นี้"
          description="อาจถูกลบไปแล้ว"
          action={
            <Link
              href="/marketing/content/history"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              กลับไปประวัติ
            </Link>
          }
        />
      </div>
    );
  }

  const { header, state } = result.data;
  // Every state EXCEPT waiting_t7/pending_entry/missed_window carries a
  // `clip` (screen design §7's Success row: those three sub-states have no
  // snapshot yet at all, so there's nothing to print here).
  const clip = "clip" in state ? state.clip : null;
  const matchedType = header.contentTypeCode ? contentTypes.find((ct) => ct.code === header.contentTypeCode) : undefined;

  return (
    <div className="space-y-4">
      {backLink}

      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        {matchedType && <ContentTypeChip contentType={matchedType} />}
        <p className="text-sm font-semibold text-zinc-900">
          {header.captionSnapshot ?? <span className="text-zinc-400">ไม่มีแคปชั่นบันทึกไว้</span>}
        </p>
        <p className="text-xs text-zinc-500">
          โพสต์ {formatThaiDateOnly(header.postedDateTh)} · {PLATFORM_LABEL[header.platform]}
        </p>
        <a
          href={header.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          เปิดดูโพสต์จริง
        </a>
      </div>

      {clip && (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <p className="text-xs font-semibold text-zinc-500">
            ตัวเลขที่กรอกไว้ (T+7{clip.capturedOn ? ` · กรอกเมื่อ ${formatThaiDateOnly(clip.capturedOn)}` : ""})
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700">
            <span>👁 วิว {fmtMetric(clip.viewCount)}</span>
            <span>❤️ ถูกใจ {fmtMetric(clip.likeCount)}</span>
            <span>💬 คอมเมนต์ {fmtMetric(clip.commentCount)}</span>
            <span>
              🔖 บันทึก {fmtMetric(clip.saveCount)}
              {fmtRatePercent(clip.saveRate)}
            </span>
            <span>
              ↗️ แชร์ {fmtMetric(clip.shareCount)}
              {fmtRatePercent(clip.shareRate)}
            </span>
          </div>
        </div>
      )}

      <ContentKpiPanel state={state} />

      <ContentKpiChecklist />
    </div>
  );
}
