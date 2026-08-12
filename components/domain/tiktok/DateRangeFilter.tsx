"use client";

// Month-granularity date range picker for the sales page (design §3/§4,
// mirrors the mockup's `<input type=month>` + preset buttons). Values are
// always "YYYY-MM" strings — SalesPageClient converts them to full
// from/to dates when calling getSalesSummary.

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function yearStartMonthStr(): string {
  return `${new Date().getFullYear()}-01`;
}

const PRESETS: { key: string; label: string; from: () => string; to: () => string }[] = [
  { key: "all", label: "ทั้งหมด", from: yearStartMonthStr, to: currentMonthStr },
  { key: "q1", label: "Q1", from: () => `${new Date().getFullYear()}-01`, to: () => `${new Date().getFullYear()}-03` },
  { key: "q2", label: "Q2", from: () => `${new Date().getFullYear()}-04`, to: () => `${new Date().getFullYear()}-06` },
];

export function DateRangeFilter({
  fromMonth,
  toMonth,
  onChange,
}: {
  fromMonth: string;
  toMonth: string;
  onChange: (fromMonth: string, toMonth: string) => void;
}) {
  const maxMonth = currentMonthStr();

  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="ช่วงวันที่">
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ตั้งแต่
        <input
          type="month"
          value={fromMonth}
          max={maxMonth}
          onChange={(e) => e.target.value && onChange(e.target.value, toMonth)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ถึง
        <input
          type="month"
          value={toMonth}
          max={maxMonth}
          onChange={(e) => e.target.value && onChange(fromMonth, e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>
      <div className="ml-auto flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.from(), p.to())}
            className="min-h-11 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
