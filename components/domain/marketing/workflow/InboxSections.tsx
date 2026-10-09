// InboxSections — ส่วนแสดงผลของหน้า "งานที่รอฉัน" (server-safe): หัวกอง · สรุปสัปดาห์ · แถบสัปดาห์นี้ · ทางลัดกรอกยอด · แถบเตือน
// ตัวเลขทุกตัวมาจาก view (จำนวนกอง = v_content_inbox_counts) · ที่นี่จัดรูปแสดงเท่านั้น ไม่ตัดสิน

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight, ClipboardList, Info } from "lucide-react";
import { CountPill } from "@/components/domain/marketing/workflow/badges";
import { formatThaiDay } from "@/lib/marketing/format";
import { totalShootMinutes } from "@/lib/marketing/inbox-piles";
import type { WeekSummary } from "@/lib/marketing/inbox-piles";
import type { LineQuota, PieceRow, WeeklySummaryRow } from "@/lib/marketing/piece-types";

/** หัวกอง + ตัวนับ (จาก view) — id ใช้เป็นเป้า anchor ของทางลัด */
export function PileSection({
  id,
  title,
  count,
  shown,
  children,
}: {
  id: string;
  title: string;
  /** จำนวนทั้งหมดจาก view (ไม่ใช่จำนวนที่โหลดมา) */
  count: number;
  /** จำนวนแถวที่แสดงจริง — น้อยกว่า count = บอกว่าแสดงบางส่วน */
  shown: number;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-32 space-y-2">
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-lg font-bold text-zinc-900">
        {title} <CountPill n={count} label={title} />
      </h2>
      {shown < count && (
        <p className="text-xs text-zinc-600 tabular-nums">
          แสดง {shown} จาก {count} ใบ (เรียงตามที่ใกล้กำหนดก่อน) — เคลียร์แล้วรีเฟรชเพื่อดูใบถัดไป
        </p>
      )}
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

export function Banner({ tone, icon = "warn", children }: { tone: "amber" | "blue"; icon?: "warn" | "info"; children: ReactNode }) {
  const cls = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900";
  const Icon = icon === "warn" ? AlertTriangle : Info;
  return (
    <div role="status" className={`flex items-start gap-2 rounded-md border p-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** คิวรออนุมัติเกินเกณฑ์ (review_over_limit จาก DB) — แถบเตือน + ทางลัดไปรายการ (brief 0.15) */
export function OverLimitBanner({ reviewQueue }: { reviewQueue: number }) {
  return (
    <Banner tone="amber">
      <p className="font-semibold tabular-nums">คิวรออนุมัติสะสม {reviewQueue} ใบ — เกินเกณฑ์ที่ตั้งไว้</p>
      <p className="mt-0.5">อนุมัติทีละใบจากกอง “รออนุมัติ” ด้านล่างได้เลย</p>
      <a
        href="#pile-review"
        className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2"
      >
        ไปที่รายการรออนุมัติ
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </Banner>
  );
}

/** โควตา LINE 28 วัน (v_line_quota_28d) — แสดงเมื่อมีชิ้น LINE ในกอง; ค่าโควตา/เกินหรือไม่ มาจาก view */
export function LineQuotaNotice({ q }: { q: LineQuota }) {
  return (
    <Banner tone={q.overQuotaPlanned ? "amber" : "blue"} icon={q.overQuotaPlanned ? "warn" : "info"}>
      <p className="tabular-nums">
        โควตาข้อความ LINE ใน 28 วัน: ส่งแล้ว {q.used28d} จาก {q.quota} · วางแผนไว้อีก {q.planned28d}
        {q.overQuotaPlanned && " — แผนรวมเกินโควตา"}
      </p>
    </Banner>
  );
}

/** สรุปสัปดาห์ที่แล้วจาก AI (5 บรรทัด) — ข้อความธรรมดา ไม่ render markdown (D24) · ฉบับเต็มยังไม่เปิด (P3) → ข้อความ ไม่ใช่ปุ่มหลอก */
export function WeeklySummaryPanel({ summary }: { summary: WeeklySummaryRow }) {
  const lines = summary.summaryLines.slice(0, 5);
  return (
    <section aria-label="สรุปสัปดาห์จาก AI" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">สรุปสัปดาห์ที่แล้ว</h2>
        <span className="text-xs text-zinc-600">
          {summary.briefNo !== null && <>ฉบับที่ {summary.briefNo}</>}
          {summary.briefDate && <> · {formatThaiDay(summary.briefDate, true)}</>}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-600">สรุปฉบับนี้ไม่มีรายการ</p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-800 marker:text-zinc-500">
          {lines.map((l, i) => (
            <li key={i} className="break-words whitespace-pre-wrap">
              {l}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-xs text-zinc-600">ร่างโดย AI · ฉบับเต็มดูในแอปได้เร็วๆ นี้</p>
    </section>
  );
}

const WEEK_FMT = (a: string, b: string) => `${formatThaiDay(a).replace(/^[^\s]+\s/, "")} – ${formatThaiDay(b).replace(/^[^\s]+\s/, "")}`;

/** แถบ "สัปดาห์นี้" — นับตามสถานะดิบ (ข้อมูลประกอบ) ข้อความกำกับทุกส่วน ไม่พึ่งสี */
export function WeekStrip({ from, to, summary, rows }: { from: string; to: string; summary: WeekSummary; rows: PieceRow[] }) {
  const minutes = totalShootMinutes(rows);
  const segs = [
    { n: summary.posted, label: "โพสต์แล้ว", cls: "bg-zinc-900" },
    { n: summary.hasFootage, label: "มีภาพแล้ว", cls: "bg-cyan-600" },
    { n: summary.inReview, label: "รออนุมัติ", cls: "bg-amber-500" },
    { n: summary.needsShoot, label: "ต้องถ่าย", cls: "bg-zinc-400" },
  ];
  return (
    <section aria-label="สัปดาห์นี้" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold text-zinc-900">
        สัปดาห์นี้ <span className="text-sm font-normal text-zinc-600 tabular-nums">{WEEK_FMT(from, to)} · {summary.total} ชิ้น</span>
      </h2>
      {summary.total === 0 ? (
        <p className="mt-1 text-sm text-zinc-600">ยังไม่มีชิ้นงานในสัปดาห์นี้</p>
      ) : (
        <>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
            {segs.map((s) => (
              <span key={s.label} className={s.cls} style={{ width: `${(s.n / summary.total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-800">
            {segs.map((s) => (
              <li key={s.label} className="tabular-nums">
                {s.label} {s.n}
              </li>
            ))}
          </ul>
        </>
      )}
      {minutes !== null && <p className="mt-2 text-sm text-zinc-700 tabular-nums">ที่ยังต้องถ่าย ≈ {minutes} นาที (ตามที่ประเมินไว้)</p>}
    </section>
  );
}

/** ทางลัดกรอกยอด — จำนวนจาก v_content_entry_queue · ลิงก์ไปหน้าเดิม /marketing/content/entry */
export function EntryTile({ count }: { count: number }) {
  if (count === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3.5 text-sm text-zinc-700">
        <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
        วันนี้ไม่มียอดต้องกรอก
      </p>
    );
  }
  return (
    <Link
      href="/marketing/content/entry"
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
    >
      <span className="flex items-center gap-2">
        <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
        กรอกยอดวันนี้ <CountPill n={count} label="โพสต์รอกรอกยอด" />
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
    </Link>
  );
}
