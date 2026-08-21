import { DashboardPageClient } from "@/components/domain/tiktok/DashboardPageClient";

export default async function TikTokDashboardPage({
  searchParams,
}: {
  // Next 15 gives `string | string[] | undefined` for a repeated query key
  // (e.g. ?date=2026-08-21&date=2026-08-22) — `{ date?: string }` was a lie
  // TS couldn't check, and the array shape flowed all the way down to
  // <input value={string[]}> (React warning) unnoticed.
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawDate = sp.date;
  // Duplicate ?date= keys: take the first value rather than erroring the
  // whole page — same "be defensive about untrusted input, fail toward a
  // usable default" spirit as isValidDateStr below this component.
  const initialDate = (Array.isArray(rawDate) ? rawDate[0] : rawDate) ?? null;
  // null (not undefined) = "no ?date= in the URL" -> DashboardPageClient asks
  // getDailyDashboard() for the RPC's own "latest day with data" instead of
  // guessing a calendar date here (same "latest" contract as the ปุ่ม "วันล่าสุด").

  return <DashboardPageClient date={initialDate} />;
}
