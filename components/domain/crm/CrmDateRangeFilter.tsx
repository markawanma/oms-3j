"use client";

// Day-granularity date range picker for /crm/overview — sibling of
// components/domain/tiktok/DateRangeFilter.tsx (same visual pattern: two
// inputs + preset buttons) but day-level, not month-level, because CRM's
// data currently spans only 1-10 Aug (design handoff §5) where a month
// picker would be useless. Unlike the TikTok filter this one is a plain
// controlled navigation component: it doesn't hold its own state, it just
// pushes `?from=&to=` and lets the server component (page.tsx) re-fetch —
// see /crm/overview page.tsx header comment for why (URL-driven, not
// client-state-driven, so the range is bookmarkable/shareable).

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstDayOfThisMonthISO(): string {
  return `${bangkokTodayISO().slice(0, 7)}-01`;
}

export function CrmDateRangeFilter({
  from,
  to,
  minDate,
  maxDate,
  channelCode = null,
  basePath = "/crm/overview",
  allRange = null,
}: {
  /** "YYYY-MM-DD" — currently effective range (defaults to minDate/maxDate
   * when the URL has no ?from=/?to=, so the inputs always show a concrete
   * selected range, never blank). */
  from: string;
  to: string;
  minDate: string | null;
  maxDate: string | null;
  /** Current ?channel= code (null = all channels). Preserved in every
   * navigation so changing the date range does NOT silently reset the channel
   * filter — mirrors CrmChannelFilter, which already carries from/to through.
   * Omitted by callers with no URL channel filter (e.g. /crm/orders, which
   * filters channel client-side), where it stays null and no param is added. */
  channelCode?: string | null;
  /** Which page's URL to navigate — defaults to /crm/overview (original
   * caller); /crm/orders passes its own path so this stays a single shared
   * component instead of forking a near-identical copy. */
  basePath?: string;
  /** When set, the "ทั้งหมด" button navigates to this explicit range
   * (min–max) instead of clearing from/to entirely. CRM's own default is
   * already all-time when the URL has no from/to, so clearing works there;
   * /dashboard defaults to a bounded window (rolling 30 days), not all-time,
   * so clearing from/to there would land back on that window instead of "all"
   * — hence the explicit min–max push. Phrased against "bounded vs all-time"
   * rather than the specific default, so changing that default doesn't
   * silently make this comment wrong again. Omitted (null) preserves the
   * original CRM behavior exactly. */
  allRange?: { from: string; to: string } | null;
}) {
  const router = useRouter();
  const today = bangkokTodayISO();

  const navigate = useCallback(
    (nextFrom: string, nextTo: string) => {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo });
      if (channelCode) params.set("channel", channelCode);
      router.push(`${basePath}?${params.toString()}`);
    },
    [router, basePath, channelCode]
  );

  const navigateAll = useCallback(() => {
    // "ทั้งหมด" clears the date range but keeps the active channel filter
    // (resetting both would be a surprising side effect of a date-only button)
    // — unless the caller passed an explicit allRange (e.g. /dashboard, whose
    // default is a bounded window, not all-time; clearing there would just
    // land back on that window, not "all"), in which case push that range.
    const params = new URLSearchParams();
    if (allRange) {
      params.set("from", allRange.from);
      params.set("to", allRange.to);
    }
    if (channelCode) params.set("channel", channelCode);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }, [router, basePath, channelCode, allRange]);

  // เจ้าของแจ้ง 10 ก.ย. 69 ว่า "ปุ่ม 7/30 วันกดไม่ได้" — ตรวจแล้วปุ่มทำงานถูก
  // ทุกอย่าง (URL เปลี่ยน ตัวเลขเปลี่ยนจริง) ปัญหาคือ**กดปุ่มที่ดูอยู่แล้ว**
  // ซึ่ง router.push ไป URL เดิม = no-op หน้าไม่ขยับ ดูเหมือนปุ่มเสีย
  // และก่อนหน้านี้ไม่มีการแสดงสถานะ "เลือกอยู่" เลยสักนิด (กรอบแดงที่เห็นใน
  // ภาพคือ focus ring หลังคลิก ไม่ใช่ active state) จึงไม่มีทางรู้ได้ว่า
  // ปุ่มไหนคือช่วงที่กำลังดู
  //
  // เทียบด้วยสตริง "YYYY-MM-DD" ตรงๆ ได้ เพราะทั้ง from/to ที่รับเข้ามาและค่า
  // ที่ปุ่มจะ push ผลิตจาก helper ชุดเดียวกัน (bangkokTodayISO/addDaysISO)
  // รูปแบบเดียวกันเสมอ — ไม่ต้องแปลงเป็น Date ให้เสี่ยงเรื่อง timezone
  const sevenFrom = addDaysISO(today, -6);
  const thirtyFrom = addDaysISO(today, -29);
  const monthFrom = firstDayOfThisMonthISO();
  // "ทั้งหมด" active เมื่อดูช่วงเต็มของข้อมูลอยู่ — ฝั่งที่ส่ง allRange มา
  // (เช่น /dashboard) เทียบกับ allRange, ฝั่งที่ไม่ส่งมาเทียบกับ minDate/maxDate
  // ซึ่งเป็นค่า default ที่ page ใส่ให้เมื่อ URL ไม่มี from/to
  const allFrom = allRange?.from ?? minDate;
  const allTo = allRange?.to ?? maxDate;
  const presets = [
    { label: "ทั้งหมด", onClick: navigateAll, active: allFrom !== null && from === allFrom && to === allTo },
    { label: "7 วันล่าสุด", onClick: () => navigate(sevenFrom, today), active: from === sevenFrom && to === today },
    // ตรงกับ default ของ /dashboard — กลับมาหน้าเริ่มต้นด้วยคลิกเดียว
    { label: "30 วันล่าสุด", onClick: () => navigate(thirtyFrom, today), active: from === thirtyFrom && to === today },
    { label: "เดือนนี้", onClick: () => navigate(monthFrom, today), active: from === monthFrom && to === today },
  ];

  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="ช่วงวันที่">
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ตั้งแต่
        <input
          type="date"
          value={from}
          min={minDate ?? undefined}
          max={today}
          onChange={(e) => e.target.value && navigate(e.target.value, to)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ถึง
        <input
          type="date"
          value={to}
          min={minDate ?? undefined}
          max={today}
          onChange={(e) => e.target.value && navigate(from, e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      {/* flex-wrap: 4 presets overflow a 360px viewport otherwise — the parent
          wraps but that doesn't let these wrap among themselves. */}
      <div className="ml-auto flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={p.onClick}
            disabled={p.active}
            aria-current={p.active ? "true" : undefined}
            title={p.active ? "ดูช่วงนี้อยู่แล้ว" : undefined}
            className={
              p.active
                ? "min-h-11 cursor-default rounded-full border border-primary-600 bg-primary-50 px-3 text-sm font-bold text-primary-700"
                : "min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
            }
          >
            {p.active ? `✓ ${p.label}` : p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
