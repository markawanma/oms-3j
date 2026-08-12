import type { MktChannelRoasRow } from "@/lib/marketing/types";
import { formatCount, formatMonthShort, formatTHBCompact } from "@/lib/tiktok/format";

/** month x channel ROAS/CAC table (analytics.v_channel_perf_roas). spend/roas/
 * cac are null whenever no fact_ad_spend row exists for that month+channel —
 * MUST render "ยังไม่มีข้อมูลค่าแอด", never 0 or ∞ (design §3 explicit rule,
 * mirrored 1:1 from the view's own null-safe division).
 *
 * The ROAS cell is colour-coded against the shop's targets (0028 §6):
 *   roas ≥ target      → green  (ถึงเป้า)
 *   roas ≥ break-even  → amber  (คุ้มทุนแต่ยังไม่ถึงเป้า)
 *   roas < break-even  → red    (ขาดทุน) */
function RoasCell({
  roas,
  spend,
  target,
  breakEven,
}: {
  roas: number | null;
  spend: number | null;
  target: number | null;
  breakEven: number | null;
}) {
  if (spend === null || roas === null) {
    return <span className="text-zinc-400">ยังไม่มีข้อมูลค่าแอด</span>;
  }
  let color = "text-zinc-800";
  if (target !== null && roas >= target) color = "text-green-700";
  else if (breakEven !== null && roas >= breakEven) color = "text-amber-700";
  else if (breakEven !== null) color = "text-red-600";
  return <span className={`font-semibold ${color}`}>×{roas.toFixed(2)}</span>;
}

export function ChannelRoasTable({
  rows,
  blendedMarginPct,
}: {
  rows: MktChannelRoasRow[];
  /** shop blended margin (fraction) for the profit-ROAS label. */
  blendedMarginPct: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
        ยังไม่มีข้อมูลยอดขาย — จะแสดง ROAS ต่อช่องทางที่นี่เมื่อมีออเดอร์และค่าแอด
      </p>
    );
  }

  const marginLabel = `${(blendedMarginPct * 100).toFixed(0)}%`;
  // targets are per-shop (identical across rows) — surface once in the header note.
  const target = rows.find((r) => r.targetRoas !== null)?.targetRoas ?? null;
  const breakEven = rows.find((r) => r.breakEvenRoas !== null)?.breakEvenRoas ?? null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold text-zinc-800">ROAS / CAC ต่อช่องทาง</h3>
        {target !== null && (
          <p className="text-xs text-zinc-500">
            เป้า ROAS <span className="font-semibold text-primary-700">×{target.toFixed(1)}</span>
            {breakEven !== null && (
              <>
                {" "}· คุ้มทุน <span className="font-semibold text-amber-700">×{breakEven.toFixed(1)}</span>
              </>
            )}
            <span className="text-zinc-400"> (margin {marginLabel})</span>
          </p>
        )}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
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
                เป้า ROAS
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                กำไร ROAS (margin {marginLabel})
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
                  <RoasCell roas={r.roas} spend={r.spend} target={r.targetRoas} breakEven={r.breakEvenRoas} />
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">
                  {r.targetRoas === null ? "—" : `×${r.targetRoas.toFixed(1)}`}
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
        <span className="font-bold">
          สี ROAS: <span className="text-green-700">เขียว=ถึงเป้า</span> · <span className="text-amber-700">เหลือง=คุ้มทุน</span> ·{" "}
          <span className="text-red-600">แดง=ขาดทุน</span>
        </span>{" "}
        · กำไร ROAS เป็นตัวเลขประมาณการจากมาร์จิ้นเฉลี่ย {marginLabel} (ตั้งได้ที่หน้า “ราคา &amp; มาร์จิ้น”) ยังไม่ใช่ต้นทุนจริงต่อ SKU
        · CAC ฝั่ง TikTok อาจต่ำกว่าจริง (ลูกค้าไม่มี identity นับซ้ำเป็นลูกค้าใหม่เกินจริง)
      </p>
    </div>
  );
}
