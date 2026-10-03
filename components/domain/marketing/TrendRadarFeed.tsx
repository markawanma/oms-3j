// TrendRadarFeed — /marketing/trend-radar's main body. Plain server-renderable
// component (no "use client", no hooks of its own — same shape as
// ContentPostHistoryTable.tsx) that lays out each day's parsed
// docs/3j-jewelry/marketing/trend-radar/YYYY-MM-DD.md and embeds one
// <AddPlanForm> per angle for the "เพิ่มเข้าปฏิทิน" button. AddPlanForm itself
// is a client component with its own open/close state (see its header) —
// rendering several instances here, one per angle, is exactly the pattern
// its own doc comment describes ("can be dropped in more than once... no
// shared state to wire up").

import { AlertTriangle, ExternalLink } from "lucide-react";
import type { TrendAngle, TrendRadarDay } from "@/lib/marketing/trend-radar-parse";
import type { ContentTypeRow } from "@/lib/marketing/content-types";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { AddPlanForm } from "@/components/domain/marketing/AddPlanForm";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

/**
 * analytics.content_type codes (drive_live/knowledge/craft/customer/announce,
 * migration 0145) and campaign_step.artifact_type codes (short_form_clip/
 * broadcast_script_line/fb_post/live_rundown, the subset AddPlanForm's own
 * dropdown offers — see its ARTIFACT_TYPE_OPTIONS) are two UNRELATED
 * vocabularies: one tags a content TOPIC, the other a content FORMAT. None
 * of the 5 content_type codes is also a valid artifact_type value, so there
 * is no honest mapping to write here — every case below falls through to
 * `undefined` on purpose. Brief 4 ต.ค. 69 explicit rule: "ถ้าแมปตรงไม่ได้
 * ปล่อยว่างให้เจ้าของเลือกเอง อย่าเดา". Kept as an explicit function (not
 * just "always undefined" inline) so a real mapping can be dropped in later
 * without touching any call site, if the two taxonomies are ever reconciled.
 */
function mapContentTypeCodeToArtifactType(_contentTypeCode: string | null): string | undefined {
  return undefined;
}

function AngleCard({ angle, contentTypes, defaultDate }: { angle: TrendAngle; contentTypes: ContentTypeRow[]; defaultDate: string }) {
  const matchedType = angle.contentTypeCode ? contentTypes.find((ct) => ct.code === angle.contentTypeCode) : undefined;

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900">{angle.title}</p>
        {matchedType && <ContentTypeChip contentType={matchedType} />}
      </div>

      {angle.whyNow && (
        <p className="text-sm text-zinc-700">
          <span className="font-medium text-zinc-500">ทำไมตอนนี้: </span>
          {angle.whyNow}
        </p>
      )}

      {angle.needs && (
        <p className="text-sm text-zinc-700">
          <span className="font-medium text-zinc-500">ต้องมีอะไรถึงถ่ายได้: </span>
          {angle.needs}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {angle.sourceUrl && (
          <a
            href={angle.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            เปิดแหล่งอ้างอิง
          </a>
        )}
        {angle.confidence && <span className="text-xs text-zinc-400">ความมั่นใจ: {angle.confidence}</span>}
      </div>

      <div className="pt-1">
        <AddPlanForm
          variant="button"
          defaultDate={defaultDate}
          prefillTitle={angle.title}
          prefillArtifactType={mapContentTypeCodeToArtifactType(angle.contentTypeCode)}
          triggerLabel="เพิ่มเข้าปฏิทิน"
        />
      </div>
    </div>
  );
}

function PendingQuestionsBox({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        ต้องให้เจ้าของยืนยันก่อนใช้ (อ่านอย่างเดียว — ต้องใช้วิจารณญาณคน ไม่มีปุ่มให้กด)
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
        {questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

function DayBlock({ day, contentTypes, defaultDate }: { day: TrendRadarDay; contentTypes: ContentTypeRow[]; defaultDate: string }) {
  const dateLabel = formatThaiDateOnly(day.date);

  if (!day.parseOk) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-zinc-700">{dateLabel}</p>
          <span className="text-xs text-zinc-400">รูปแบบไฟล์ไม่ตรงที่คาด — แสดงเนื้อหาดิบ</span>
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-700">
          {day.rawMarkdown}
        </pre>
      </div>
    );
  }

  if (day.hasNothing) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <p className="text-sm text-zinc-400">
          {dateLabel} — วันนี้ไม่มีอะไรใหม่
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-zinc-700">{dateLabel}</p>
      {day.angles.map((angle, i) => (
        <AngleCard key={i} angle={angle} contentTypes={contentTypes} defaultDate={defaultDate} />
      ))}
      <PendingQuestionsBox questions={day.pendingQuestions} />
    </div>
  );
}

export function TrendRadarFeed({
  days,
  contentTypes,
  defaultDate,
}: {
  days: TrendRadarDay[];
  contentTypes: ContentTypeRow[];
  /** "YYYY-MM-DD" (today, Bangkok) — passed through to every AddPlanForm's
   * `defaultDate` as a neutral starting value. Never derived from an
   * angle's own content (see mapContentTypeCodeToArtifactType's header for
   * the same "don't guess a date" rule applied to the date field instead). */
  defaultDate: string;
}) {
  return (
    <div className="space-y-5">
      {days.map((day) => (
        <DayBlock key={day.date} day={day} contentTypes={contentTypes} defaultDate={defaultDate} />
      ))}
    </div>
  );
}
