import { getSalesSummary } from "@/lib/actions/tiktok-sales";
import { SalesPageClient } from "@/components/domain/tiktok/SalesPageClient";
import { ErrorState } from "@/components/ui/ErrorState";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic"; // orders change daily — never cache a stale sales summary

// Default range: 1 Jan of the current year -> today, monthly buckets.
// Deliberately NOT hardcoded to "ม.ค.–ก.ค. 2026" (the mockup's fixed demo
// range) — that would silently go stale/wrong the moment this ships past
// July, or if this shop's real order history doesn't line up with the mock
// numbers. Year-start-to-today always shows "everything we have this year"
// regardless of when the page loads; SalesScopeNote.firstOrderDate covers
// the (rarer) case where actual order history starts later than Jan 1.
//
// M1 fix: both boundaries must use the same Asia/Bangkok calendar day that
// getSalesSummary buckets orders into (effectiveDateBangkok, shared from
// lib/tiktok/format.ts) — a UTC-derived `to` (new Date().toISOString()) goes
// stale before 07:00 Bangkok every day (still "yesterday" in UTC), silently
// dropping same-day sales from the requested range.
function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

function currentYearStartISO(): string {
  return `${bangkokTodayISO().slice(0, 4)}-01-01`;
}

export default async function TikTokSalesPage() {
  const from = currentYearStartISO();
  const to = bangkokTodayISO();

  let result;
  try {
    result = await getSalesSummary({ from, to, granularity: "month" });
  } catch (err) {
    // getDevShopId() throws when DEV_SHOP_ID isn't configured (same pattern
    // as app/(dashboard)/page.tsx) — surface it as a clear setup error.
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  return <SalesPageClient initialSummary={result.data} initialFrom={from} initialTo={to} />;
}
