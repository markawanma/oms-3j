// SilverPriceHistorySection — /catalog/silver-price (supabase/migrations/
// 0102_silver_price_history.sql). Plain server component: read-only data,
// no forms/mutations, so no "use client" / router.refresh() plumbing needed
// (page itself re-fetches on every request via `dynamic = "force-dynamic"`).
//
// Internal-app page (behind the same dashboard as every /catalog/* route) —
// deliberately shows internal pricing-desk columns (เนื้อเงิน/บาท, ค่าบล๊อค
// 1 บาท, Shopee 1 บาท) that must NEVER appear on the future public Wix page
// (analytics.v_silver_price_public_14d excludes them by construction — see
// that view's comment in the migration).

import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatBangkokTime } from "@/lib/format";
import type { PriceChangeDirection, PriceChangeSummary, SilverPriceHistoryRow } from "@/lib/catalog/silver-price-history";

function fmtBaht(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function computeChange(latest: number | null, previous: number | null): PriceChangeSummary {
  if (latest == null || previous == null) {
    return { latest, previous, deltaAbs: null, deltaPct: null, direction: "unknown" };
  }
  const deltaAbs = latest - previous;
  const deltaPct = previous === 0 ? null : (deltaAbs / previous) * 100;
  let direction: PriceChangeDirection = "flat";
  if (deltaAbs > 0) direction = "up";
  else if (deltaAbs < 0) direction = "down";
  return { latest, previous, deltaAbs, deltaPct, direction };
}

// Deliberate exception to this app's usual "no red for down" KPI rule
// (components/domain/tiktok/KpiCard.tsx — that rule is about order-count not
// being an error state). This is a price ticker; the owner asked for
// green/red up/down explicitly (brief: "แถบสรุปบน... สี เขียว/แดง"), which
// is also the universal convention for price movement.
const DIRECTION_ICON: Record<PriceChangeDirection, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
  unknown: Minus,
};
const DIRECTION_CLASS: Record<PriceChangeDirection, string> = {
  up: "text-green-600",
  down: "text-red-600",
  flat: "text-zinc-400",
  unknown: "text-zinc-400",
};

function PriceStatCard({ label, unit, change }: { label: string; unit: string; change: PriceChangeSummary }) {
  const Icon = DIRECTION_ICON[change.direction];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold tracking-tight tabular-nums text-zinc-900">
        {fmtBaht(change.latest)} <span className="text-xs font-normal text-zinc-400">{unit}</span>
      </div>
      <div className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${DIRECTION_CLASS[change.direction]}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {change.direction === "unknown" ? (
          <span className="font-normal text-zinc-400">ยังไม่มีรายการก่อนหน้า</span>
        ) : (
          <>
            <span className="tabular-nums">
              {change.deltaAbs != null && change.deltaAbs > 0 ? "+" : ""}
              {change.deltaAbs != null ? fmtBaht(change.deltaAbs) : "—"}
            </span>
            <span className="font-normal text-zinc-400">
              ({change.deltaPct != null ? `${change.deltaPct > 0 ? "+" : ""}${change.deltaPct.toFixed(2)}%` : "—"}) vs ครั้งก่อน
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function SilverPriceHistorySection({ rows }: { rows: SilverPriceHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="ยังไม่มีประวัติราคาเงิน"
        description="ตารางนี้เติมอัตโนมัติทุกครั้งที่ scripts/capture-silver-price-sheet.mjs หรือ scripts/scrape-silver-price.mjs รันสำเร็จ (ดู scripts/run-silver-price.bat)"
      />
    );
  }

  // rows มาเรียงล่าสุดก่อนแล้ว (getSilverPriceHistory order by captured_at desc)
  const latest = rows[0];
  const previous = rows[1];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PriceStatCard
          label="เนื้อเงิน/บาท"
          unit="บาท"
          change={computeChange(latest.silverValuePerBaht, previous?.silverValuePerBaht ?? null)}
        />
        <PriceStatCard label="ขาย 1 บาท" unit="บาท" change={computeChange(latest.sell1, previous?.sell1 ?? null)} />
        <PriceStatCard label="ซื้อคืน 1 บาท" unit="บาท" change={computeChange(latest.buy1, previous?.buy1 ?? null)} />
        <PriceStatCard label="กิโลขาย" unit="บาท" change={computeChange(latest.kiloSell, previous?.kiloSell ?? null)} />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-800">ประวัติราคา (90 วันล่าสุด)</h2>
          <span className="text-xs text-zinc-400">{rows.length} รายการ</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                <th scope="col" className="py-2 pr-3">วันที่-เวลา</th>
                <th scope="col" className="py-2 pr-3 text-right">เนื้อเงิน/บาท</th>
                <th scope="col" className="py-2 pr-3 text-right">ขาย 1 บาท</th>
                <th scope="col" className="py-2 pr-3 text-right">ซื้อ 1 บาท</th>
                <th scope="col" className="py-2 pr-3 text-right">กิโลขาย</th>
                <th scope="col" className="py-2 pr-3 text-right">กิโลซื้อ</th>
                <th scope="col" className="py-2 pr-3 text-right">ค่าบล๊อค 1 บาท</th>
                <th scope="col" className="py-2 text-right">Shopee 1 บาท</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 pr-3 text-xs text-zinc-600">{formatBangkokTime(r.capturedAt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.silverValuePerBaht)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.sell1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.buy1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.kiloSell)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.kiloBuy)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(r.blockFee1)}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-700">{fmtBaht(r.shopee1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
