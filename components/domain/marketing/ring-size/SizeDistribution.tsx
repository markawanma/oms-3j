import { Badge } from "@/components/ui/Badge";
import { PercentBar } from "@/components/ui/PercentBar";
import { countWithBase, formatInt, pctText, sizeTableRows, topSizes } from "@/lib/marketing/ring-size-format";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.2 — ส่วนใหญ่ไซส์อะไร
// 🔴 ช่วงเบอร์ร้านมาจาก stats.shopRange (RPC) เท่านั้น — ห้าม hardcode 45/68 ที่นี่ (ไม่ได้รับ = ไม่วาดแถวช่วง/ตาราง ไม่เดา)
// ฐาน % = measured · แท่งตกแต่ง aria-hidden · อันดับ/นอกช่วง = ข้อความ ไม่พึ่งสีอย่างเดียว

function CountPctCell({ count, base }: { count: number; base: number }) {
  return (
    <>
      <td className="py-1 text-right tabular-nums text-zinc-800">{formatInt(count)}</td>
      <td className="py-1 pl-2 text-right tabular-nums text-zinc-600">{pctText(count, base)}</td>
    </>
  );
}

export function SizeDistribution({ stats }: { stats: RingSizeStats }) {
  const base = `จากที่วัดได้ ${formatInt(stats.measured)} ครั้ง`;

  if (stats.measured === 0) {
    return (
      <StatsCard id="rs-size" title="ส่วนใหญ่ไซส์อะไร">
        <NoData>ยังไม่มีใครวัดได้เบอร์ในช่วงนี้</NoData>
      </StatsCard>
    );
  }
  if (!stats.resultSizes || !stats.sizeSummary) {
    return (
      <StatsCard id="rs-size" title="ส่วนใหญ่ไซส์อะไร" base={base}>
        <NoData />
      </StatsCard>
    );
  }

  const range = stats.shopRange;
  const top = topSizes(stats.resultSizes, 3);
  const rows = range ? sizeTableRows(stats.resultSizes, range.min, range.max) : [];
  const tableMax = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const rankBySize = new Map(top.map((t, i) => [t.size, i + 1]));
  const summary = stats.sizeSummary;
  const summaryMax = Math.max(summary.belowRange, summary.inRange, summary.aboveRange);

  const rangeRows = range
    ? [
        { key: "below", label: `ต่ำกว่าเบอร์ ${range.min} (นอกช่วงที่ร้านทำ)`, value: summary.belowRange, tone: "amber" as const },
        { key: "in", label: `เบอร์ ${range.min}–${range.max} (ช่วงที่ร้านทำ)`, value: summary.inRange, tone: "primary" as const },
        { key: "above", label: `สูงกว่าเบอร์ ${range.max} (นอกช่วงที่ร้านทำ)`, value: summary.aboveRange, tone: "amber" as const },
      ]
    : [];

  return (
    <StatsCard id="rs-size" title="ส่วนใหญ่ไซส์อะไร" base={base}>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-zinc-600">พบมากสุด</h3>
        {top.length === 0 ? (
          <NoData />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {top.map((t) => {
              const outside = range ? t.size < range.min || t.size > range.max : false;
              return (
                <li key={t.size} className="min-w-0 rounded-md border border-zinc-200 px-3 py-2">
                  <p className="text-xl font-bold tabular-nums text-zinc-900">เบอร์ {t.size}</p>
                  <p className="text-xs tabular-nums text-zinc-600">
                    {countWithBase(t.count, stats.measured)}
                  </p>
                  {outside && (
                    <Badge tone="slate" className="mt-1">
                      นอกช่วงที่ร้านทำ
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {range ? (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">จำนวนครั้งที่วัดได้ แยกตามช่วงเบอร์ที่ร้านทำ</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">ช่วง</th>
                <th scope="col">ครั้ง</th>
                <th scope="col">สัดส่วน</th>
              </tr>
            </thead>
            <tbody>
              {rangeRows.map((r) => (
                <tr key={r.key} className="border-t border-zinc-100 align-top">
                  <th scope="row" className="min-w-0 break-words py-1.5 pr-2 text-left font-medium text-zinc-700">
                    <span className="block">{r.label}</span>
                    <PercentBar value={r.value} max={summaryMax} tone={r.tone} className="mt-1" />
                  </th>
                  <CountPctCell count={r.value} base={stats.measured} />
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <caption className="sr-only">
              จำนวนครั้งที่วัดได้ ทุกเบอร์ {range.min} ถึง {range.max}
            </caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-zinc-600">
                <th scope="col" className="w-24 py-1 pr-2">เบอร์</th>
                <th scope="col" className="py-1">
                  <span className="sr-only">แท่ง</span>
                </th>
                <th scope="col" className="py-1 text-right">ครั้ง</th>
                <th scope="col" className="py-1 pl-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rank = rankBySize.get(r.size);
                return (
                  <tr key={r.size} className={`border-t border-zinc-100 ${rank ? "font-bold" : ""}`}>
                    <th scope="row" className="py-1 pr-2 text-left tabular-nums text-zinc-800">
                      {r.size}
                      {rank && (
                        <Badge tone="slate" className="ml-1.5 align-middle">
                          อันดับ {rank}
                        </Badge>
                      )}
                    </th>
                    <td className="w-full py-1">
                      <PercentBar value={r.count} max={tableMax} />
                    </td>
                    <CountPctCell count={r.count} base={stats.measured} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <NoData>ยังไม่มีข้อมูลช่วงเบอร์ที่ร้านทำ</NoData>
      )}

      <p className="text-xs text-zinc-600">ผลก้ำกึ่งของวิธีกระดาษนับอยู่ในเบอร์ที่ระบบแนะนำ (เบอร์ใหญ่กว่า) แล้ว ไม่ได้นับซ้ำ</p>
    </StatsCard>
  );
}
