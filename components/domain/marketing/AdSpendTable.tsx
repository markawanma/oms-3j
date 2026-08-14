import type { MktAdSpendWeeklyRow } from "@/lib/marketing/types";
import { formatCount, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

/** Entry-history table for /marketing/ad-spend (v_ad_spend_weekly) — plain
 * HTML table, no chart lib, mirrors components/domain/crm/ChannelPerfTable.tsx.
 * spend/impressions/clicks render "—" when null (should not actually happen
 * for `spend`, the view always sums a non-null column, but impressions/clicks
 * are optional at entry time). */
function fmtWeekRange(weekStart: string, weekEnd: string): string {
  const [, sm, sd] = weekStart.split("-");
  const [, em, ed] = weekEnd.split("-");
  const startLabel = `${Number(sd)} ${formatMonthShort(weekStart.slice(0, 7))}`;
  const endLabel = sm === em ? `${Number(ed)}` : `${Number(ed)} ${formatMonthShort(weekEnd.slice(0, 7))}`;
  return `${startLabel}–${endLabel}`;
}

export function AdSpendTable({ rows }: { rows: MktAdSpendWeeklyRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
        ยังไม่มีประวัติค่าแอด — กรอกฟอร์มด้านบนเป็นรายการแรก
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">ประวัติค่าแอดรายสัปดาห์</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
              <th scope="col" className="py-2 pr-3">
                สัปดาห์
              </th>
              <th scope="col" className="py-2 pr-3">
                ช่องทาง
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                ยอดแอด
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Impressions
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                คลิก
              </th>
              <th scope="col" className="py-2 text-right">
                วันที่กรอก
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.weekStart}-${r.channelCode}`} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{fmtWeekRange(r.weekStart, r.weekEnd)}</td>
                <td className="py-2 pr-3 font-medium text-zinc-800">{r.channelName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{formatTHBCompact(r.spend)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">
                  {r.impressions === null ? "—" : formatCount(r.impressions)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">
                  {r.clicks === null ? "—" : formatCount(r.clicks)}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-500">{r.daysEntered} วัน</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
