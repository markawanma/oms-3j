import type { MktChannelRoasRow } from "@/lib/marketing/types";
import { formatCount, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

/** month x channel ROAS/CAC table (analytics.v_channel_perf_roas, 0027 §2).
 * spend/roas/cac are null whenever no fact_ad_spend row exists for that
 * month+channel — MUST render "ยังไม่มีข้อมูลค่าแอด", never 0 or ∞ (design §3
 * explicit rule, mirrored 1:1 from the view's own null-safe division). */
function RoasCell({ roas, spend }: { roas: number | null; spend: number | null }) {
  if (spend === null || roas === null) {
    return <span className="text-zinc-400">ยังไม่มีข้อมูลค่าแอด</span>;
  }
  return <span className="font-semibold text-zinc-800">×{roas.toFixed(2)}</span>;
}

export function ChannelRoasTable({ rows }: { rows: MktChannelRoasRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
        ยังไม่มีข้อมูลยอดขาย — จะแสดง ROAS ต่อช่องทางที่นี่เมื่อมีออเดอร์และค่าแอด
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">ROAS / CAC ต่อช่องทาง</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
              <th scope="col" className="py-2 pr-3">
                เดือน
              </th>
              <th scope="col" className="py-2 pr-3">
                ช่องทาง
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                ออเดอร์
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                รายได้
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                ค่าแอด
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                ROAS
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                กำไร ROAS (ประมาณการ 20%)
              </th>
              <th scope="col" className="py-2 text-right">
                CAC
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.month}-${r.channelCode}`} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{formatMonthShort(r.month.slice(0, 7))}</td>
                <td className="py-2 pr-3 font-medium text-zinc-800">{r.channelName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{formatCount(r.orders)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{formatTHBCompact(r.revenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                  {r.spend === null ? <span className="text-zinc-400">—</span> : formatTHBCompact(r.spend)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <RoasCell roas={r.roas} spend={r.spend} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                  {r.profitRoas === null ? (
                    <span className="text-zinc-400">ยังไม่มีข้อมูลค่าแอด</span>
                  ) : (
                    `×${r.profitRoas.toFixed(2)}`
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-700">
                  {r.cac === null ? <span className="text-zinc-400">—</span> : formatTHBCompact(r.cac)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-[0.7rem] leading-relaxed text-amber-900">
        <span className="font-bold">กำไร ROAS เป็นตัวเลขประมาณการ 20%</span> ของรายได้ ยังไม่มีต้นทุนจริงต่อ SKU · CAC ฝั่ง TikTok
        อาจต่ำกว่าจริง (ลูกค้าไม่มี identity นับซ้ำเป็นลูกค้าใหม่เกินจริง)
      </p>
    </div>
  );
}
