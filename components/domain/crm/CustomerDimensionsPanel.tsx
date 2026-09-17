"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmCustomerDimensions } from "@/lib/actions/crm";
import { HBarChart } from "@/components/domain/dashboard/HBarChart";
import { DonutChart } from "@/components/domain/dashboard/DonutChart";
import { CHANNEL_COLOR } from "@/lib/dashboard/channel-colors";
import { formatCount } from "@/lib/tiktok/format";

// "Customers by area & channel" panel. Owner-reported bug (9 ก.ย. 69): this
// box used to ALWAYS show all-time data while the page's date/channel filter
// sat right above it, with only a 0.68rem gray line explaining that — easy to
// miss, so the owner read the filtered top-of-page KPIs next to this box's
// unfiltered numbers and assumed both were scoped the same way.
//
// Fix: two data sets ("all" / "range", both computed server-side — see
// getCrmCustomerDimensions in lib/actions/crm.ts) plus a segmented control so
// the owner explicitly picks which one they're looking at, with a
// same-visual-weight-as-the-rest-of-the-page label always showing the
// concrete date range (and channel, in range mode) that's being counted.
// Default is "all" — the owner must land on the numbers they already know
// (3,392 people etc.), never surprise them by defaulting to a filtered view.
//
// Architect's invariant (do not violate): the mode picks WHICH customers get
// counted — it never changes what a customer's province / first-touch
// channel / RFM group VALUE is. Both modes always show each counted
// customer's CURRENT (as-of-today) attributes — see the constant note below
// the chips, and the DonutChart subtitle in range mode.
export interface CrmCustomerDimensionsScoped {
  all: CrmCustomerDimensions;
  range: CrmCustomerDimensions;
}

type Mode = "all" | "range";

// The champion split is expressed with two filter keys (champion_core /
// champion_high) matching CustomersPageClient's dropdown so the vocabulary
// stays consistent (bare 'champion' means "all champions" elsewhere).
type FilterKey = "champion_high" | "champion_core" | "loyal" | "new" | "standard" | "at_risk";

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: "champion_high", label: "⭐ ชั้นดี·ยอดเยอะ" },
  { key: "champion_core", label: "ชั้นดี" },
  { key: "loyal", label: "ประจำ" },
  { key: "new", label: "ใหม่" },
  { key: "standard", label: "ทั่วไป" },
  { key: "at_risk", label: "เสี่ยงหาย" },
];

const ALL_KEYS = FILTER_CHIPS.map((c) => c.key);

// Channel names come back resolved (not codes); map the few known ones to the
// shared brand palette, everything else to the neutral default.
function channelColor(name: string): string {
  switch (name) {
    case "TikTok Shop":
      return CHANNEL_COLOR.tiktok;
    case "LINE OA":
      return CHANNEL_COLOR.line_oa;
    case "Facebook":
      return CHANNEL_COLOR.facebook;
    case "Shopee":
      return CHANNEL_COLOR.shopee;
    default:
      return CHANNEL_COLOR.default;
  }
}

const PEOPLE = (n: number) => `${formatCount(n)} คน`;

/** Sum a name→count map into `acc` (mutates + returns it). */
function mergeInto(acc: Map<string, number>, src: Record<string, number> | undefined): Map<string, number> {
  if (src) for (const [k, v] of Object.entries(src)) acc.set(k, (acc.get(k) ?? 0) + v);
  return acc;
}

export function CustomerDimensionsPanel({
  data,
  filterActive,
  allLabel,
  rangeLabel,
  rangeChannelName,
}: {
  data: CrmCustomerDimensionsScoped;
  /** Whether the page currently has a real from/to/channel filter applied
   * (scope.requestedFrom/To/ChannelCode, already validated server-side — see
   * app/(dashboard)/crm/overview/page.tsx). Gates the "ตามตัวกรองด้านบน"
   * button: with no filter active, range === all anyway, so switching to it
   * would just be a confusing no-op. */
  filterActive: boolean;
  /** Human-readable ("10 ส.ค. 2569 – 9 ก.ย. 2569") full min–max range this
   * shop has ever had — shown in "all" mode. */
  allLabel: string;
  /** Human-readable range for whatever from/to is currently applied (falls
   * back to the shop's full min–max when unset, matching the top-of-page
   * filter's own default) — shown in "range" mode. */
  rangeLabel: string;
  /** Resolved channel name for the currently applied channel filter, or
   * "ทุกช่องทาง" when none — shown in "range" mode. */
  rangeChannelName: string;
}) {
  const [mode, setMode] = useState<Mode>("all");
  // Default: every group selected (= all customers shown).
  const [selected, setSelected] = useState<Set<FilterKey>>(() => new Set(ALL_KEYS));

  // Safety net: if the owner switches to "range" then clears the top-of-page
  // filter (e.g. clicks "ทั้งหมด"), filterActive flips false but this
  // component's own `mode` state would otherwise stay stuck on "range" —
  // the segmented button would render disabled while still looking
  // "selected". Range data equals all-time data in that case anyway, so
  // falling back to "all" is a strict UX improvement, never a data loss.
  useEffect(() => {
    if (!filterActive && mode === "range") setMode("all");
  }, [filterActive, mode]);

  const toggle = (key: FilterKey) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAll = () => setSelected(new Set(ALL_KEYS));

  const activeData = data[mode];

  // Per-chip count in the CURRENTLY VIEWED mode — shown on every chip so a
  // group reading "0" in range mode reads as "not in this range", not as a
  // broken/dead button (see FILTER_CHIPS button below).
  const chipCounts = useMemo(() => {
    const counts = new Map<FilterKey, number>();
    for (const key of ALL_KEYS) counts.set(key, activeData[key]?.total ?? 0);
    return counts;
  }, [activeData]);

  const { provinceRows, channelSlices, total } = useMemo(() => {
    const provinces = new Map<string, number>();
    const channels = new Map<string, number>();
    let total = 0;
    for (const key of ALL_KEYS) {
      if (!selected.has(key)) continue;
      const bucket = activeData[key];
      if (!bucket) continue;
      total += bucket.total;
      mergeInto(provinces, bucket.provinces);
      mergeInto(channels, bucket.channels);
    }

    const provinceRows = [...provinces.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value, displayValue: PEOPLE(value) }));

    const channelSlices = [...channels.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: channelColor(label) }));

    return { provinceRows, channelSlices, total };
  }, [activeData, selected]);

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-zinc-800">ลูกค้าตามพื้นที่ &amp; ช่องทาง</h2>
          {mode === "all" ? (
            <p className="text-xs font-semibold text-zinc-700">📅 ลูกค้าทั้งหมดที่เคยซื้อ: {allLabel}</p>
          ) : (
            <p className="text-xs font-semibold text-zinc-700">
              📅 เฉพาะลูกค้าที่มีออเดอร์ช่วง {rangeLabel} · ซื้อทาง {rangeChannelName}
            </p>
          )}
          <p className="text-[0.7rem] text-zinc-500">
            กลุ่มลูกค้า · จังหวัด · ช่องทางแรก = ข้อมูลล่าสุดของลูกค้า ณ วันนี้ ไม่ใช่ ณ ช่วงนั้น
          </p>
        </div>

        {/* segmented control — which of the two data sets is being shown */}
        <div
          role="group"
          aria-label="เลือกมุมมองช่วงเวลา"
          className="flex shrink-0 gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 p-0.5"
        >
          <button
            type="button"
            onClick={() => setMode("all")}
            aria-pressed={mode === "all"}
            className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
              mode === "all" ? "bg-primary-600 text-white" : "text-zinc-600 hover:text-primary-700"
            }`}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setMode("range")}
            disabled={!filterActive}
            aria-pressed={mode === "range"}
            title={filterActive ? undefined : "ตั้งช่วงวันที่หรือช่องทางด้านบนก่อน"}
            className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
              mode === "range"
                ? "bg-primary-600 text-white"
                : filterActive
                  ? "text-zinc-600 hover:text-primary-700"
                  : "cursor-not-allowed text-zinc-300"
            }`}
          >
            ตามตัวกรองด้านบน
          </button>
        </div>
      </div>

      {/* multi-select group chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="เลือกกลุ่มลูกค้า">
        <button
          type="button"
          onClick={selectAll}
          aria-pressed={selected.size === ALL_KEYS.length}
          className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
            selected.size === ALL_KEYS.length
              ? "bg-primary-100 text-primary-700"
              : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
          }`}
        >
          ทั้งหมด
        </button>
        {FILTER_CHIPS.map((c) => {
          const on = selected.has(c.key);
          const count = chipCounts.get(c.key) ?? 0;
          const isZero = count === 0;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              disabled={isZero}
              aria-pressed={on}
              title={isZero ? "ไม่มีลูกค้าในกลุ่มนี้ตามมุมมองที่เลือกอยู่" : undefined}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
                isZero
                  ? "cursor-not-allowed border border-zinc-200 text-zinc-400"
                  : on
                    ? "bg-primary-100 text-primary-700"
                    : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
              }`}
            >
              {c.label} · {formatCount(count)}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500">
        เลือกอยู่ <span className="font-semibold text-zinc-700">{PEOPLE(total)}</span>
      </p>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          {selected.size === 0 ? "เลือกกลุ่มอย่างน้อย 1 กลุ่มเพื่อดูกราฟ" : "ไม่มีลูกค้าในกลุ่มที่เลือกตามมุมมองนี้"}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <HBarChart
            title="ลูกค้าตามจังหวัด"
            subtitle="8 จังหวัดที่ลูกค้าเยอะสุด"
            rows={provinceRows}
            emptyMessage="ไม่มีข้อมูลจังหวัด"
          />
          <DonutChart
            title="ช่องทางที่รู้จักลูกค้า"
            subtitle={
              mode === "all"
                ? "ช่องทางแรกที่เจอลูกค้า (first-touch)"
                : "ช่องทางแรกที่เจอลูกค้า (first-touch ตลอดกาล) — ไม่ใช่ช่องทางที่ซื้อในช่วงนี้"
            }
            slices={channelSlices}
            formatValue={PEOPLE}
            showValue
            emptyMessage="ไม่มีข้อมูลช่องทาง"
          />
        </div>
      )}
    </section>
  );
}
