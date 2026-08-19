// CalendarPageTabs — /marketing/calendar 2-tab switcher (design
// phase-content-calendar-design.md §6/§8.3: "ต่อยอด route เดิม แต่ยกเครื่อง
// page เป็น 2 แท็บ"). Thin wrapper only, no logic — URL-driven (`?tab=`) so
// the tab is bookmarkable/shareable, same pattern as every other filter in
// this project (CrmChannelFilter etc). Plain Link, no client state needed.

import Link from "next/link";

const TABS: { key: "plan" | "seasonal"; label: string }[] = [
  { key: "plan", label: "แผนงาน" },
  { key: "seasonal", label: "เทศกาลทั้งปี" },
];

export function CalendarPageTabs({
  activeTab,
  selectedDate,
}: {
  activeTab: "plan" | "seasonal";
  /** Carried along on the "แผนงาน" tab link so switching back from
   * "เทศกาลทั้งปี" returns to the day the owner was looking at, not always
   * today. */
  selectedDate: string;
}) {
  return (
    <div role="tablist" aria-label="มุมมองปฏิทิน" className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
      {TABS.map((t) => {
        const active = t.key === activeTab;
        const href = t.key === "plan" ? `/marketing/calendar?tab=plan&d=${selectedDate}` : `/marketing/calendar?tab=seasonal`;
        return (
          <Link
            key={t.key}
            href={href}
            role="tab"
            aria-selected={active}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors ${
              active ? "bg-white text-primary-700 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
