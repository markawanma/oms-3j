"use client";

// CampaignCalendar — timeline of the Thai retail calendar (mega-sale/festival/
// gift-occasion), sorted soonest-first (server already orders by days_until).
// Read-only: no actions here, just orientation for planning ahead. Events
// inside their lead window are the same ones surfacing as "seasonal_calendar"
// cards on /marketing/copilot — flagged + linked here so owner/admin knows
// where the reminder actually shows up.

import Link from "next/link";
import { Bell, CalendarDays, ChevronRight } from "lucide-react";
import type { CampaignEvent } from "@/lib/marketing/types";
import { campaignEventTypeLabel, campaignEventTypeTone } from "@/lib/marketing/types";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const eventDateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** event_date/specific_date are plain "YYYY-MM-DD" (no time component) — parse
 * as UTC midnight so the Asia/Bangkok (+7) render never rolls to the next
 * calendar day. */
function formatEventDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return eventDateFormatter.format(d);
}

function daysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "วันนี้";
  if (daysUntil === 1) return "พรุ่งนี้";
  if (daysUntil < 0) return `ผ่านมาแล้ว ${Math.abs(daysUntil)} วัน`;
  return `อีก ${daysUntil} วัน`;
}

function CampaignEventCard({ event }: { event: CampaignEvent }) {
  const urgent = event.daysUntil <= 1;
  return (
    <li
      className={`rounded-lg border bg-white p-3.5 shadow-sm ${
        event.inLeadWindow ? "border-amber-300 bg-amber-50/40" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-bold text-zinc-900">{event.nameTh}</h3>
            <Badge tone={campaignEventTypeTone(event.eventType)}>{campaignEventTypeLabel(event.eventType)}</Badge>
            {event.inLeadWindow && (
              <Badge tone="amber">
                <Bell className="h-3 w-3" aria-hidden="true" />
                กำลังเตือน
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            {formatEventDate(event.eventDate)}
            {event.durationDays > 1 && <span className="text-zinc-400"> · {event.durationDays} วัน</span>}
          </p>

          {event.prepNoteTh && (
            <details className="mt-2 text-sm text-zinc-600">
              <summary className="cursor-pointer select-none font-medium text-zinc-700 hover:text-zinc-900">
                เตรียมงานล่วงหน้า
              </summary>
              <p className="mt-1.5 leading-relaxed whitespace-pre-line">{event.prepNoteTh}</p>
            </details>
          )}
        </div>

        <div className={`shrink-0 text-right ${urgent ? "text-red-600" : "text-primary-700"}`}>
          <p className="text-lg font-bold whitespace-nowrap">{daysUntilLabel(event.daysUntil)}</p>
        </div>
      </div>
    </li>
  );
}

export function CampaignCalendar({ events }: { events: CampaignEvent[] }) {
  const remindingCount = events.filter((e) => e.inLeadWindow).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ปฏิทินแคมเปญ</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          เทศกาล/มหกรรมลดราคา/โอกาสให้ของขวัญตลอดปี เรียงตามวันที่ใกล้ที่สุด — ใช้วางแผนเตรียมสต็อกและงบแอดล่วงหน้า
        </p>
        {remindingCount > 0 && (
          <Link
            href="/marketing/copilot"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-800 hover:underline"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            {remindingCount} รายการกำลังเตือนอยู่ที่ Ad Copilot
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="ยังไม่มีรายการในปฏิทิน"
          description="จะแสดงเทศกาล/มหกรรมลดราคา/โอกาสให้ของขวัญที่นี่เมื่อมีข้อมูล"
        />
      ) : (
        <ul className="space-y-2.5">
          {events.map((event) => (
            <CampaignEventCard key={event.code} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}
