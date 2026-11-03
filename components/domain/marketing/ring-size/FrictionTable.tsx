import { formatInt, pctText } from "@/lib/marketing/ring-size-format";
import { FRICTION_ROWS } from "@/lib/marketing/ring-size-labels";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.6 — จุดที่คนติด · ฐานเดียว = กดเริ่ม (funnel[1]) · ไม่มีรหัส G1–G5 บนจอ
// "วัดซ้ำ" ไม่อยู่ที่นี่ (อยู่ในตารางแยกวิธี — คนละฐาน)

export function FrictionTable({ stats }: { stats: RingSizeStats }) {
  const { friction, funnel } = stats;
  const started = funnel ? (funnel[1] ?? 0) : 0;
  const base = funnel ? `% ของที่กดเริ่ม ${formatInt(started)} ครั้ง` : undefined;
  if (!friction) {
    return (
      <StatsCard id="rs-friction" title="จุดที่คนติด" base={base}>
        <NoData />
      </StatsCard>
    );
  }
  return (
    <StatsCard id="rs-friction" title="จุดที่คนติด" base={base}>
      <table className="w-full text-sm">
        <caption className="sr-only">จำนวนครั้งที่เจอปัญหาแต่ละแบบระหว่างวัด</caption>
        <thead>
          <tr className="text-left text-xs font-semibold text-zinc-600">
            <th scope="col" className="py-1 pr-2">
              ปัญหา
            </th>
            <th scope="col" className="py-1 text-right">
              ครั้ง
            </th>
            <th scope="col" className="py-1 pl-2 text-right">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {FRICTION_ROWS.map((r) => (
            <tr key={r.key} className="border-t border-zinc-100 align-top">
              <th scope="row" className="min-w-0 break-words py-1.5 pr-2 text-left font-medium text-zinc-700">
                {r.title}
                <span className="block text-xs font-normal text-zinc-600">{r.hint}</span>
              </th>
              <td className="py-1.5 text-right tabular-nums text-zinc-800">{formatInt(friction[r.key])}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-zinc-600">{pctText(friction[r.key], started)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </StatsCard>
  );
}
