import type { CrmChannelPerfRow } from "@/lib/actions/crm";
import { formatCount, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

/** Channel performance per month (v_channel_perf_monthly) — no ROAS column
 * (design §1 B1: "ยังไม่มี ROAS เพราะ spend ว่าง") on purpose; the caller
 * renders the "ยังไม่มีข้อมูล ad spend" note separately instead of a fake 0%
 * column here. Plain HTML table (no chart lib) per over-engineering guard. */
export function ChannelPerfTable({ rows }: { rows: CrmChannelPerfRow[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">ยอดขายรายเดือนตามช่องทาง</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
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
                AOV
              </th>
              <th scope="col" className="py-2 text-right">
                ลูกค้าใหม่
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
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{formatTHBCompact(r.aov)}</td>
                <td className="py-2 text-right tabular-nums text-zinc-700">{formatCount(r.newCustomers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 rounded-md bg-zinc-50 px-2.5 py-2 text-[0.7rem] leading-relaxed text-zinc-500">
        ยังไม่มีข้อมูล ad spend — คอลัมน์ ROAS/CAC จะแสดงเมื่อกรอกค่าแอด (Phase B3)
      </p>
    </div>
  );
}
