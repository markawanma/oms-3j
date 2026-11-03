import { RelativeBar } from "@/components/ui/RelativeBar";
import { formatInt, pctText } from "@/lib/marketing/ring-size-format";
import { inAppLabel } from "@/lib/marketing/ring-size-labels";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { RING_IN_APP } from "@/lib/ring-size/track-schema";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.5 (ปรับตามมติ 25 ต.ค. 69: ไม่มีตัวกรอง/ตารางลิงก์ที่ร้านแปะ — เหลือ "เปิดในแอปอะไร" จาก by_in_app)
// 🔴 ห้ามมี CTA/ข้อความแนะนำให้แปะลิงก์ใน TikTok (นโยบายแพลตฟอร์ม — memory tiktok-offplatform-policy)
// ชุด bucket มาจาก RING_IN_APP (track-schema) — ไม่ประกาศซ้ำ · ป้ายไทยอยู่ ring-size-labels

export function ChannelTable({ stats }: { stats: RingSizeStats }) {
  const base = `จากเปิดใช้ ${formatInt(stats.sessions)} ครั้ง`;
  const counts = stats.byInApp;
  if (!counts) {
    return (
      <StatsCard id="rs-channel" title="เปิดในแอปอะไร" base={base}>
        <NoData />
      </StatsCard>
    );
  }
  // เรียงมาก→น้อย (เสมอกันตามลำดับชุด bucket) · ซ่อนช่องที่ 0 ครั้ง
  const rows = RING_IN_APP.map((code, order) => ({ code, order, count: counts[code] }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);

  return (
    <StatsCard id="rs-channel" title="เปิดในแอปอะไร" base={base}>
      {rows.length === 0 ? (
        <NoData />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">จำนวนครั้งที่เปิดใช้ แยกตามแอปที่เปิดหน้านี้</caption>
          <thead>
            <tr className="text-left text-xs font-semibold text-zinc-600">
              <th scope="col" className="py-1 pr-2">
                แอป
              </th>
              <th scope="col" className="py-1">
                <span className="sr-only">แท่ง</span>
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
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-zinc-100">
                <th scope="row" className="min-w-0 break-words py-1.5 pr-2 text-left font-medium text-zinc-700">
                  {inAppLabel(r.code)}
                </th>
                <td className="w-1/3 py-1.5">
                  <RelativeBar value={r.count} max={max} />
                </td>
                <td className="py-1.5 text-right tabular-nums text-zinc-800">{formatInt(r.count)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-zinc-600">{pctText(r.count, stats.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-zinc-600">
        ประมาณการจากชนิดแอป อาจจัดผิดกลุ่มได้ · ดูจากแอปที่เปิดหน้านี้ ไม่ใช่ลิงก์ที่ร้านวาง ไม่บอกว่ามาจากโพสต์ไหน
      </p>
    </StatsCard>
  );
}
