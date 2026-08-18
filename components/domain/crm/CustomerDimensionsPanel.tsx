"use client";

import { useMemo, useState } from "react";
import type { CrmCustomerDimensions } from "@/lib/actions/crm";
import { HBarChart } from "@/components/domain/dashboard/HBarChart";
import { DonutChart } from "@/components/domain/dashboard/DonutChart";
import { CHANNEL_COLOR } from "@/lib/dashboard/channel-colors";
import { formatCount } from "@/lib/tiktok/format";

// "Customers by area & channel" — an all-customers (NOT date-scoped) view that
// lets the owner see WHERE their customers are and WHICH channel first found
// them, sliced by one or more RFM groups. `data` is pre-aggregated per group
// server-side (analytics.crm_customer_dimensions, 0056) so selecting groups is
// just merging a few small histograms in the browser — no per-customer rows,
// no PostgREST row cap.
//
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

export function CustomerDimensionsPanel({ data }: { data: CrmCustomerDimensions }) {
  // Default: every group selected (= all customers shown).
  const [selected, setSelected] = useState<Set<FilterKey>>(() => new Set(ALL_KEYS));

  const toggle = (key: FilterKey) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAll = () => setSelected(new Set(ALL_KEYS));

  const { provinceRows, channelSlices, total } = useMemo(() => {
    const provinces = new Map<string, number>();
    const channels = new Map<string, number>();
    let total = 0;
    for (const key of ALL_KEYS) {
      if (!selected.has(key)) continue;
      const bucket = data[key];
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
  }, [data, selected]);

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div>
        <h2 className="text-sm font-bold text-zinc-800">ลูกค้าตามพื้นที่ &amp; ช่องทาง</h2>
        <p className="text-[0.68rem] text-zinc-400">มุมมองลูกค้าทั้งหมด (ไม่ผูกช่วงวันที่ด้านบน) — เลือกได้หลายกลุ่ม</p>
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
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              aria-pressed={on}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${
                on
                  ? "bg-primary-100 text-primary-700"
                  : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500">
        เลือกอยู่ <span className="font-semibold text-zinc-700">{PEOPLE(total)}</span>
      </p>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">เลือกกลุ่มอย่างน้อย 1 กลุ่มเพื่อดูกราฟ</p>
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
            subtitle="ช่องทางแรกที่เจอลูกค้า (first-touch)"
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
