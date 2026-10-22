// JobSheetGems — ตารางพลอยบนใบงาน A5 (ชั้นแสดงผลล้วน ไม่มี hook → ใช้ได้ทั้ง server/client) — UX §8.2
// 🔴 รับเฉพาะ PrintableJobGem {label, qtyPerPiece, qtyTotal, position} — ไม่มีเงิน/เผื่อแตก/ผู้ขาย/รหัสรายการ (type boundary ที่ lib/jobs/print.ts)
// ใบที่ไม่มีขั้นฝังและไม่มีพลอย = return null (markup เดิมเป๊ะ) · ขั้นฝังแต่ไม่ระบุ = บรรทัดเดียว "พลอย: ยังไม่ระบุ — ถามออฟฟิศก่อนฝัง" (กันช่างเดา)
// ตัวอักษรตาราง 8.5pt (เท่าตารางขั้น) ไม่เล็กกว่า 8pt เด็ดขาด · ตัวเลขชิดขวา tabular-nums ไม่ตัดกลางตัวเลข · ชื่อ/ตำแหน่งยาว = ตัดบรรทัด (ตัววัดความสูงนับให้)
// ทุกแถวถูก render เสมอ (ห้ามตัดแถว/ใช้ "…และอีก n รายการ") — ล้นหน้า = ตัดรูป → บีบ → แผ่น 2 (lib/jobs/print-gems.ts)

import type { GemsState } from "@/lib/jobs/gems";
import type { PrintableJobGem } from "@/lib/jobs/print";
import { printGemTotal } from "@/lib/jobs/print-gems";
import type { GemPrintStep } from "@/lib/jobs/print-gems";

const CELL = "border border-zinc-700 px-1 align-top";
const NUM = `${CELL} text-right tabular-nums whitespace-nowrap`;
const fmt = (n: number) => n.toLocaleString("en-US");
const WRAP = "break-words [overflow-wrap:anywhere]";

function GemTable({ gems, compact }: { gems: readonly PrintableJobGem[]; compact: boolean }) {
  return (
    <table className="w-full border-collapse text-[8.5pt] leading-tight" data-testid="sheet-gems-table" data-compact={compact ? "1" : undefined}>
      <caption className="sr-only">พลอยที่ใช้ในใบงาน</caption>
      <thead>
        <tr className="bg-zinc-100 text-left">
          <th scope="col" className={CELL}>ชนิด · รูปทรง · ขนาด{compact ? " · ตำแหน่ง" : ""}</th>
          <th scope="col" className={`${CELL} w-[14%] text-right`}>/ชิ้น</th>
          <th scope="col" className={`${CELL} w-[16%] text-right`}>รวม</th>
          {!compact && <th scope="col" className={`${CELL} w-[26%]`}>ตำแหน่ง</th>}
        </tr>
      </thead>
      <tbody>
        {gems.map((g, i) => (
          <tr key={`${g.label}-${i}`} className={`break-inside-avoid ${compact ? "" : "h-[5.5mm]"}`} data-testid="sheet-gem-row">
            <th scope="row" className={`${CELL} text-left font-semibold ${WRAP}`}>
              {g.label}
              {compact && g.position && <span className="ml-1 text-[8pt] font-normal text-zinc-700"> · {g.position}</span>}
            </th>
            <td className={NUM}>{fmt(g.qtyPerPiece)}</td>
            <td className={`${NUM} font-semibold`}>{fmt(g.qtyTotal)}</td>
            {!compact && <td className={`${CELL} ${WRAP}`}>{g.position ?? ""}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * ส่วนพลอยบนแผ่นที่ 1 · mode: normal (ตารางเต็ม) | compact (1 แถวต่อพลอย) | page2 (บรรทัดชี้ไปแผ่นที่ 2 — ตารางอยู่ที่ JobGemsSecondSheet) · noPhoto = ตารางเต็มเหมือน normal (ขั้นนั้นตัดแค่รูป)
 */
export function JobSheetGems({ gems, state, mode = "normal" }: { gems: readonly PrintableJobGem[]; state: GemsState; mode?: GemPrintStep }) {
  if (gems.length === 0) {
    return state === "unspecified" ? (
      <p className="mt-2 text-[8.5pt] font-semibold" data-testid="sheet-gems-unspecified">
        พลอย: ยังไม่ระบุ — ถามออฟฟิศก่อนฝัง
      </p>
    ) : null;
  }
  const total = printGemTotal(gems);
  if (mode === "page2") {
    return (
      <section aria-label="พลอย (ขั้นฝังพลอย)" className="mt-2 text-[8.5pt]" data-testid="sheet-gems-pointer">
        <p className="font-semibold tabular-nums">
          พลอย {gems.length} รายการ · รวม {fmt(total)} เม็ด — ดูแผ่นที่ 2 <span className="ml-2 font-normal">แผ่น 1/2</span>
        </p>
      </section>
    );
  }
  return (
    <section aria-label="พลอย (ขั้นฝังพลอย)" className="mt-2" data-testid="sheet-gems">
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[8.5pt]">
        <span className="font-semibold">พลอย (ขั้นฝังพลอย)</span>
        <span className="tabular-nums">รวมทั้งใบ {fmt(total)} เม็ด</span>
      </div>
      <GemTable gems={gems} compact={mode === "compact"} />
    </section>
  );
}

/** แผ่นที่ 2 (เฉพาะขั้น page2): ตารางพลอยทั้งก้อน · หัวแผ่น "พลอย · JB-xxxx · ชื่อแบบ" · ไม่มี QR · ขึ้นหน้าใหม่ตอนพิมพ์ */
export function JobGemsSecondSheet({ jobNo, designLabel, gems }: { jobNo: string; designLabel: string; gems: readonly PrintableJobGem[] }) {
  const total = printGemTotal(gems);
  return (
    <article aria-label={`ใบงาน ${jobNo} แผ่นที่ 2 พลอย`} className="job-sheet job-sheet-2 mx-auto mt-4 w-[148mm] bg-white p-[7mm] text-[10pt] leading-snug text-black print:mt-0 print:p-0 print:break-before-page" data-testid="sheet-gems-page2">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-[11pt] font-bold break-words">
          พลอย · {jobNo} · {designLabel}
        </p>
        <p className="shrink-0 text-[9pt]">แผ่น 2/2</p>
      </header>
      <p className="mb-1 text-[9pt] font-semibold tabular-nums">รวมทั้งใบ {fmt(total)} เม็ด</p>
      <GemTable gems={gems} compact={false} />
    </article>
  );
}
