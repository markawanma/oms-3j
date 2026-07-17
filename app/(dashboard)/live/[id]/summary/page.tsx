import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getLiveSessionStats, getTopSkus } from "@/lib/actions/live";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { formatTHB, formatBangkokTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LiveSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let statsResult, topSkusResult;
  try {
    [statsResult, topSkusResult] = await Promise.all([getLiveSessionStats(id), getTopSkus(id)]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!statsResult.ok) return <ErrorState message={statsResult.error} />;
  const stats = statsResult.data;
  const topSkus = topSkusResult.ok ? topSkusResult.data : [];

  return (
    <div className="space-y-4">
      <Link
        href="/live"
        className="mb-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปหน้าไลฟ์
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">สรุปไลฟ์: {stats.title || "ไม่มีชื่อ"}</h1>
        <p className="text-sm text-slate-500">
          {formatBangkokTime(stats.startedAt)} — {stats.endedAt ? formatBangkokTime(stats.endedAt) : "ยังไม่ปิด"}
          {" · "}
          {stats.durationHours.toFixed(2)} ชม.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="ออเดอร์" value={String(stats.orderCount)} />
        <SummaryCard label="ยอดขาย (GMV)" value={formatTHB(stats.gmv)} />
        <SummaryCard label="ชิ้นที่ขาย" value={String(stats.unitsSold)} />
        <SummaryCard
          label="ของไม่พอ"
          value={String(stats.oversoldCount)}
          tone={stats.oversoldCount > 0 ? "red" : undefined}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">SKU ขายดี (Top 10)</h2>
        {!topSkusResult.ok ? (
          <ErrorState message={topSkusResult.error} />
        ) : topSkus.length === 0 ? (
          <EmptyState title="ยังไม่มีข้อมูลการขาย" description="ไลฟ์นี้ยังไม่มีออเดอร์ที่นับยอด" />
        ) : (
          <ol className="space-y-2">
            {topSkus.map((s, index) => (
              <li key={s.productId} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone="slate">#{index + 1}</Badge>
                  <span className="truncate font-medium text-slate-900">{s.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">({s.sku})</span>
                </div>
                <span className="shrink-0 font-semibold text-slate-900">{s.qtySold} ชิ้น</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
