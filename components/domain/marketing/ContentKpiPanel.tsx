// ContentKpiPanel — /marketing/content/history/[postId]'s "Section
// สถานะ+suggestion" (screen design §4). Pure display: every field it reads
// was already decided by lib/marketing/content-kpi.ts's
// determineContentKpiState() server-side (this file is NOT "use client" and
// does no computation of its own — §"ต้องรันฝั่ง server เสมอ ห้ามคำนวณที่
// client" from the brief).
//
// The page's header block (app/(dashboard)/marketing/content/history/
// [postId]/page.tsx) already prints the raw T+7 numbers once, above this
// panel — the "insufficient_global" block below deliberately does NOT
// repeat them a second time (screen design §4.5's own wireframe shows them
// inline too, but duplicating a metrics grid the reader just saw one
// paragraph above adds nothing and costs mobile screen space; the panel
// focuses on the ONE new thing at this state — why no verdict yet, and how
// close the channel is to being able to give one).

import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, FileEdit, TriangleAlert } from "lucide-react";
import type { ConfidenceBadge, ContentKpiState, MetricLevel } from "@/lib/marketing/content-kpi";
import { MIN_FORMAT_CLIPS, MIN_GLOBAL_CLIPS } from "@/lib/marketing/content-kpi";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const CONFIDENCE_BADGE_LABEL: Record<ConfidenceBadge, string> = {
  insufficient: "⏳ ข้อมูลไม่พอ",
  signal: "🟡 เริ่มเห็นสัญญาณ",
  confirmed_positive: "🟢 มั่นใจแล้ว",
  confirmed_negative: "🔴 เลิกทำ",
};

const CONFIDENCE_BADGE_TONE: Record<ConfidenceBadge, BadgeTone> = {
  insufficient: "slate",
  signal: "amber",
  confirmed_positive: "green",
  confirmed_negative: "red",
};

function levelLabel(level: MetricLevel | null): string {
  if (level === "high") return "สูงกว่าค่ากลาง";
  if (level === "low") return "ต่ำกว่าค่ากลาง";
  return "เทียบไม่ได้ — ยังไม่มีค่ากลาง";
}

/** Small inline progress bar — §4.5's "▓▓▓▓░░░░░░ 4/10 คลิป", reused as-is
 * for §4.6's "n/4 ชิ้น". Not extracted to components/ui — used only here,
 * twice. */
function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs font-medium text-zinc-500">
        {value} / {max} {label}
      </p>
    </div>
  );
}

function Panel({
  tone,
  icon: Icon,
  children,
}: {
  tone: "neutral" | "warning" | "info";
  icon: typeof Clock;
  children: ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "info"
        ? "border-blue-200 bg-blue-50"
        : "border-zinc-200 bg-zinc-50";
  return (
    <div className={`space-y-2.5 rounded-lg border p-3.5 text-sm ${toneClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}

export function ContentKpiPanel({ state }: { state: ContentKpiState }) {
  switch (state.kind) {
    case "waiting_t7":
      return (
        <Panel tone="neutral" icon={Clock}>
          <p className="font-semibold text-zinc-800">ยังบอกไม่ได้ว่าคลิปนี้ดีหรือไม่</p>
          <p className="text-zinc-600">
            ต้องรออ่านค่าตอนคลิปอายุครบ 7 วันก่อน (ตอนนี้อายุ {state.ageDaysToday} วัน) กลับมาดูอีกทีราว{" "}
            {formatThaiDateOnly(state.expectedReadyDateTh)}
          </p>
        </Panel>
      );

    case "pending_entry":
      return (
        <Panel tone="warning" icon={FileEdit}>
          <p className="font-semibold text-amber-900">ถึงรอบอ่านค่าแล้ว ยังไม่ได้กรอกตัวเลข</p>
          <Link
            href="/marketing/content/entry"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
          >
            ไปกรอกตัวเลขที่หน้าอ่านยอด →
          </Link>
        </Panel>
      );

    case "missed_window":
      return (
        <Panel tone="neutral" icon={TriangleAlert}>
          <p className="font-semibold text-zinc-800">พลาดช่วงอ่านค่าคลิปนี้ไปแล้ว</p>
          <p className="text-zinc-600">
            ไม่มีตัวเลขบันทึกไว้ตอนอายุ 5-9 วัน คลิปนี้จะไม่ถูกเอาไปเทียบกับคลิปอื่น — ไม่เป็นไร กรอกคลิปถัดไปให้ทันแทน
          </p>
        </Panel>
      );

    case "insufficient_global":
      return (
        <Panel tone="info" icon={Clock}>
          <p className="font-semibold text-blue-900">ยังบอกไม่ได้ว่าคลิปนี้ดีหรือไม่</p>
          <p className="text-blue-800">
            ทำไมบอกไม่ได้: ต้องมีคลิปที่ครบรอบอ่านค่าอย่างน้อย {MIN_GLOBAL_CLIPS} ชิ้นก่อน ถึงจะเริ่มเทียบกันได้แม่นยำ
            (คลิปเดียวเทียบอะไรไม่ได้ ผันผวนสูงเกินไป)
          </p>
          <ProgressBar value={state.globalCount} max={MIN_GLOBAL_CLIPS} label="คลิป" />
          <p className="text-blue-800">
            กรอกต่ออีก {Math.max(0, MIN_GLOBAL_CLIPS - state.globalCount)} คลิป แล้วหน้านี้จะเริ่มบอกได้ว่าคลิปแบบไหนควรทำต่อ 💪
          </p>
        </Panel>
      );

    case "format_unconfirmed":
      return (
        <div className="space-y-2.5">
          <Panel tone="neutral" icon={CheckCircle2}>
            <p className="font-semibold text-zinc-800">เทียบกับคลิปอื่นแล้ว ({MIN_GLOBAL_CLIPS} คลิปล่าสุด)</p>
            <ul className="space-y-0.5 text-zinc-700">
              <li>วิว: {levelLabel(state.viewLevel)}</li>
              <li>
                อัตราบันทึก: {levelLabel(state.saveLevel)}
                {state.saveLevel === "high" && " ✓"}
              </li>
            </ul>
            {state.singleClipSuggestion && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-amber-900">💡 {state.singleClipSuggestion.text}</p>
                <Badge tone="amber" className="mt-1.5">
                  {CONFIDENCE_BADGE_LABEL.signal}
                </Badge>
              </div>
            )}
          </Panel>
          <Panel tone="warning" icon={TriangleAlert}>
            <p className="text-amber-900">
              ภาพรวมประเภทนี้ยังสรุปไม่ได้ ({state.formatCount}/{MIN_FORMAT_CLIPS} ชิ้น) — ลงอีก{" "}
              {Math.max(0, MIN_FORMAT_CLIPS - state.formatCount)} ชิ้นแล้วจะเห็นว่า format นี้ใช้ได้จริงหรือแค่บังเอิญ
            </p>
          </Panel>
        </div>
      );

    case "full": {
      return (
        <div className="space-y-2.5">
          <Panel tone="neutral" icon={CheckCircle2}>
            <p className="font-semibold text-zinc-800">เทียบกับคลิปอื่นแล้ว ({MIN_GLOBAL_CLIPS} คลิปล่าสุด)</p>
            <ul className="space-y-0.5 text-zinc-700">
              <li>วิว: {levelLabel(state.viewLevel)}</li>
              <li>
                อัตราบันทึก: {levelLabel(state.saveLevel)}
                {state.saveLevel === "high" && " ✓"}
              </li>
            </ul>
            {state.singleClipSuggestion && <p className="text-zinc-700">💡 {state.singleClipSuggestion.text}</p>}
          </Panel>
          {state.formatSuggestion && (
            <Panel tone="neutral" icon={state.formatSuggestion.kind === "positive" ? CheckCircle2 : TriangleAlert}>
              <p className="font-semibold text-zinc-800">📁 ภาพรวมประเภทนี้ ({state.formatCount} ชิ้น)</p>
              <p className="text-zinc-700">
                {state.formatSuggestion.text}
                {state.formatSuggestion.kind === "positive" && " ✓"}
              </p>
            </Panel>
          )}
          <Badge tone={CONFIDENCE_BADGE_TONE[state.confidenceBadge]}>{CONFIDENCE_BADGE_LABEL[state.confidenceBadge]}</Badge>
        </div>
      );
    }
  }
}
