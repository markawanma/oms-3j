import { formatInt, pctText } from "@/lib/marketing/ring-size-format";
import { METHOD_LABELS, REF_LABELS } from "@/lib/marketing/ring-size-labels";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.3 — ส่วนที่ตอบโจทย์ "กระดาษคลาดเคลื่อนไหม" (ข้อมูลจาก method_stats ตามวิธีที่เกิดเหตุจริง)
//
// 🔴 ไม่ไฮไลต์สี/ไม่ตั้งเกณฑ์ "สูง/ต่ำ" (Q3 = แสดงตัวเลขอย่างเดียว) · ตัวเลขทั้งหมดคือสัญญาณ "ยาก/ไม่มั่นใจ" ไม่ใช่ความแม่น
// 🔴 "ก้ำกึ่ง" เทียบ A กับ B ไม่ได้ (แหวนวงเดิมปัดใกล้สุด ไม่มีก้ำกึ่ง) ⇒ แยกท้ายตาราง + ป้ายเตือน
// "ใช้วิธีนี้" = ลองวิธีนั้นอย่างน้อยครั้ง (คนที่ลองทั้งสองวิธีนับทั้งสองฝั่ง) ⇒ แถวนี้โชว์จำนวนล้วน ไม่ทำ % (ฐานรวมสองฝั่งจะซ้ำคน)
// 🔴 ฐานของ % ทุกแถว = picked (ครั้งที่ใช้วิธีนั้น) เพราะตัวตั้งทุกตัวเป็นข้อมูลระดับ session ที่เกิดระหว่างใช้วิธีนั้น (⊆ used_x):
//    remeasured = measure_count_x>=2 · between = used_b and saw_between · invalid = invalid_x · abandoned = used_x and method=x ·
//    ห้ามใช้ `measured` (= result_method ผลล่าสุด) เป็นฐานของสองแถวแรก — คนที่วัดกระดาษ 2 รอบแล้วไปจบที่แหวนเดิม (b_to_a)
//    อยู่ในตัวตั้งของ B แต่ไม่อยู่ใน measured ของ B ⇒ % กระดาษพองเกินจริง (และ clamp 100% จะซ่อนอาการ)

/** base: ตัวเลข = ฐานหาร (ใช้กฎ MIN_N) · null = โชว์จำนวนล้วน */
type Cell = { count: number; base: number | null };

interface Row {
  label: string;
  hint: string | null;
  a: Cell | null;
  b: Cell | null;
}

function ValueCell({ cell }: { cell: Cell | null }) {
  if (!cell) return <td className="py-1.5 pl-2 text-right text-zinc-500">—</td>;
  const sub = cell.base === null ? null : pctText(cell.count, cell.base);
  return (
    <td className="py-1.5 pl-2 text-right align-top tabular-nums">
      <span className="block font-semibold text-zinc-800">{formatInt(cell.count)}</span>
      {sub !== null && <span className="block text-xs text-zinc-600">{sub}</span>}
    </td>
  );
}

export function MethodComparison({ stats }: { stats: RingSizeStats }) {
  const ms = stats.methodStats;
  if (!ms) {
    return (
      <StatsCard id="rs-method" title="วัดด้วยอะไร">
        <NoData />
      </StatsCard>
    );
  }
  const { A, B } = ms;
  const rows: Row[] = [
    {
      label: "ใช้วิธีนี้ (ครั้ง)",
      hint: "คนที่ลองทั้งสองวิธีนับทั้งสองฝั่ง",
      a: { count: A.picked, base: null },
      b: { count: B.picked, base: null },
    },
    {
      label: "วัดได้เบอร์",
      hint: "ฐาน = ครั้งที่ใช้วิธีนั้น",
      a: { count: A.measured, base: A.picked },
      b: { count: B.measured, base: B.picked },
    },
    {
      label: "เลิกที่หน้าวัด",
      hint: "ฐาน = ครั้งที่ใช้วิธีนั้น",
      a: { count: A.abandonedAtMeasure, base: A.picked },
      b: { count: B.abandonedAtMeasure, base: B.picked },
    },
    {
      label: "ค่าวัดผิดปกติ",
      hint: "ฐาน = ครั้งที่ใช้วิธีนั้น",
      a: { count: A.invalidSessions, base: A.picked },
      b: { count: B.invalidSessions, base: B.picked },
    },
    {
      label: "วัดซ้ำ 2 ครั้งขึ้นไป",
      hint: "นับเมื่อได้ผลตั้งแต่ 2 ครั้ง · ฐาน = ครั้งที่ใช้วิธีนั้น",
      a: { count: A.remeasured, base: A.picked },
      b: { count: B.remeasured, base: B.picked },
    },
    {
      label: "ผลก้ำกึ่งระหว่างเบอร์",
      hint: "เฉพาะกระดาษ · ฐาน = ครั้งที่ใช้กระดาษ · เทียบกับแหวนวงเดิมไม่ได้",
      a: null,
      b: B.between === null ? null : { count: B.between, base: B.picked },
    },
  ];
  const x = stats.methodXRef;

  return (
    <StatsCard id="rs-method" title="วัดด้วยอะไร">
      <table className="w-full text-sm">
        <caption className="sr-only">เปรียบเทียบวิธีวัดแหวนวงเดิมกับพันกระดาษรอบนิ้ว</caption>
        <thead>
          <tr className="text-xs font-semibold text-zinc-600">
            <th scope="col" className="py-1 pr-2 text-left">
              <span className="sr-only">รายการ</span>
            </th>
            <th scope="col" className="w-24 py-1 pl-2 text-right">
              {METHOD_LABELS.A}
            </th>
            <th scope="col" className="w-24 py-1 pl-2 text-right">
              {METHOD_LABELS.B}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-zinc-100">
              <th scope="row" className="min-w-0 break-words py-1.5 pr-2 text-left align-top font-medium text-zinc-700">
                {r.label}
                {r.hint && <span className="block text-xs font-normal text-zinc-600">{r.hint}</span>}
              </th>
              <ValueCell cell={r.a} />
              <ValueCell cell={r.b} />
            </tr>
          ))}
        </tbody>
      </table>

      {stats.switched && (
        <ul className="space-y-0.5 border-t border-zinc-100 pt-2 text-sm text-zinc-700">
          <li>
            ลองกระดาษแล้วเปลี่ยนมาใช้แหวนวงเดิม <span className="font-semibold tabular-nums">{formatInt(stats.switched.bToA)}</span> ครั้ง
          </li>
          <li>
            ลองแหวนวงเดิมแล้วเปลี่ยนมาใช้กระดาษ <span className="font-semibold tabular-nums">{formatInt(stats.switched.aToB)}</span> ครั้ง
          </li>
          <li>
            ลองทั้งสองวิธี <span className="font-semibold tabular-nums">{formatInt(stats.switched.both)}</span> ครั้ง
          </li>
        </ul>
      )}
      {stats.sawBetween !== null && (
        <p className="text-sm text-zinc-700">
          รวมทุกวิธี เคยเจอผลก้ำกึ่งระหว่างเบอร์ <span className="font-semibold tabular-nums">{formatInt(stats.sawBetween)}</span> ครั้ง
        </p>
      )}

      <div className="space-y-1 rounded-md bg-zinc-50 p-2.5 text-xs text-zinc-700">
        <p className="font-semibold">ข้อสังเกตก่อนตีความ</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>ตัวเลขเหล่านี้บอก "ความยาก/ความไม่มั่นใจ" ไม่ใช่ความแม่นจริง — ระบบไม่รู้ว่าเบอร์ที่ได้ตรงนิ้วจริงไหม</li>
          <li>
            "ก้ำกึ่ง" เกิดเฉพาะวิธีกระดาษตามกติกาปัดเบอร์ ส่วนแหวนวงเดิมปัดใกล้สุดจึงไม่มีก้ำกึ่ง — เทียบสองวิธีไม่ได้ ใช้ดูว่ากี่ครั้งที่ลูกค้าต้องได้ยินว่า "อยู่ระหว่างเบอร์"
          </li>
          <li>เทียบสองวิธีได้จาก: เลิกที่หน้าวัด · ค่าวัดผิดปกติ · วัดซ้ำ · การเปลี่ยนวิธี</li>
          <li>"วัดซ้ำ" อาจมาจากการลองเล่น ไม่ได้แปลว่าวัดไม่ได้</li>
        </ul>
      </div>

      {x && (
        <table className="w-full text-sm">
          <caption className="mb-1 text-left text-xs font-semibold text-zinc-600">เทียบหน้าจอด้วยอะไร × วิธีวัด (วิธีที่เลือกล่าสุด)</caption>
          <thead>
            <tr className="text-xs font-semibold text-zinc-600">
              <th scope="col" className="py-1 text-left">
                <span className="sr-only">วิธีวัด</span>
              </th>
              <th scope="col" className="py-1 text-right">
                {REF_LABELS.coin}
              </th>
              <th scope="col" className="py-1 text-right">
                {REF_LABELS.card}
              </th>
              <th scope="col" className="py-1 text-right">
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                { key: "A", coin: x.aCoin, card: x.aCard },
                { key: "B", coin: x.bCoin, card: x.bCard },
              ] as const
            ).map((r) => (
              <tr key={r.key} className="border-t border-zinc-100">
                <th scope="row" className="py-1.5 text-left font-medium text-zinc-700">
                  {METHOD_LABELS[r.key]}
                </th>
                <td className="py-1.5 text-right tabular-nums text-zinc-800">{formatInt(r.coin)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-800">{formatInt(r.card)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-800">{formatInt(r.coin + r.card)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StatsCard>
  );
}
