"use client";

// CalendarFilters — ตัวกรอง แคมเปญ / ช่องทาง / สถานะ / ประเภท (ค้างใน URL — แชร์/บุ๊กมาร์กได้)
// <select> จริง 44px · เปลี่ยนค่า = router.replace ไป URL ใหม่ (server กรองจากข้อมูลที่ดึงมา)

import { useRouter } from "next/navigation";
import Link from "next/link";
import { calendarHref, FILTER_KEYS } from "@/lib/marketing/calendar-view";
import type { CalendarUrlState, FilterOptions } from "@/lib/marketing/calendar-view";

const SELECT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm font-medium text-zinc-800 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function CalendarFilters({
  state,
  options,
  typeLabels,
  idPrefix = "cal-f",
}: {
  state: CalendarUrlState;
  options: FilterOptions;
  /** code → ป้ายไทยของประเภทเนื้อหา */
  typeLabels: Record<string, string>;
  /** มือถือ/PC เรนเดอร์คนละชุด (กล่องพับ vs แถวเต็ม) — id ต้องไม่ซ้ำ */
  idPrefix?: string;
}) {
  const router = useRouter();
  const set = (key: (typeof FILTER_KEYS)[number], value: string) =>
    router.replace(calendarHref(state, { [key]: value || undefined } as Partial<CalendarUrlState>), { scroll: false });
  const active = FILTER_KEYS.some((k) => state[k]);

  const field = (id: string, label: string, key: (typeof FILTER_KEYS)[number], opts: { value: string; label: string }[]) => (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} value={state[key] ?? ""} onChange={(e) => set(key, e.target.value)} className={SELECT}>
        <option value="">{label}: ทั้งหมด</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div role="group" aria-label="ตัวกรองปฏิทิน" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {field(`${idPrefix}-campaign`, "แคมเปญ", "campaign", options.campaigns)}
        {field(`${idPrefix}-channel`, "ช่องทาง", "channel", options.channels)}
        {field(`${idPrefix}-status`, "สถานะ", "status", options.statuses)}
        {field(
          `${idPrefix}-type`,
          "ประเภท",
          "type",
          options.types.map((t) => ({ value: t, label: typeLabels[t] ?? "ประเภทอื่น" }))
        )}
      </div>
      {active && (
        <Link
          href={calendarHref(state, { campaign: undefined, channel: undefined, status: undefined, type: undefined })}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline underline-offset-2"
        >
          ล้างตัวกรอง
        </Link>
      )}
    </div>
  );
}
