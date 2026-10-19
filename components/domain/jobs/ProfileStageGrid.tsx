"use client";

// ProfileStageGrid — ตารางติ๊ก "ขั้น × (ชั่ง / ชิ้นเสีย / เศษโลหะ)" ของตัวแก้ไขแบบการบันทึก (0176)
// <table> ทุก breakpoint (มือถือหัวย่อ + sr-only ชื่อเต็ม) · checkbox 44×44 · aria-label "ชั่งน้ำหนัก — หล่อ" · th scope ครบ
// ขั้นที่ metal_present=false: ชั่ง/เศษ ติ๊กไม่ได้ (DB ปฏิเสธ flag_not_applicable) + บรรทัดเล็กถาวร · ชิ้นเสียติ๊กได้
// ขั้นที่ปิดใช้ในทะเบียน: ซ่อน ยกเว้นมี flag อยู่ (จาง + "(ขั้นนี้ปิดใช้แล้ว)")

import type { ProfileStageDef } from "@/lib/jobs/profile";

export interface GridFlag {
  weigh: boolean;
  scrapQty: boolean;
  scrapWeight: boolean;
}
export type GridFlags = Record<string, GridFlag>;
export const NO_FLAG: GridFlag = { weigh: false, scrapQty: false, scrapWeight: false };

const COLS = [
  { key: "weigh", full: "ชั่งน้ำหนัก", short: "ชั่ง", needsMetal: true },
  { key: "scrapQty", full: "ชิ้นเสีย", short: "เสีย", needsMetal: false },
  { key: "scrapWeight", full: "เศษโลหะ", short: "เศษ", needsMetal: true },
] as const;

/** ขั้นที่แสดงในตาราง: ใช้งานอยู่ หรือ (ปิดใช้แต่ยังมี flag ติ๊กอยู่) — ตามลำดับขั้น */
export function visibleStageDefs(defs: readonly ProfileStageDef[], flags: GridFlags): ProfileStageDef[] {
  return [...defs].filter((d) => d.isActive || (flags[d.code] && (flags[d.code].weigh || flags[d.code].scrapQty || flags[d.code].scrapWeight))).sort((a, b) => a.seq - b.seq);
}

export function ProfileStageGrid({ idPrefix, defs, flags, onChange, disabled }: { idPrefix: string; defs: readonly ProfileStageDef[]; flags: GridFlags; onChange: (code: string, key: keyof GridFlag, value: boolean) => void; disabled?: boolean }) {
  const rows = visibleStageDefs(defs, flags);
  const anyChecked = rows.some((d) => flags[d.code] && (flags[d.code].weigh || flags[d.code].scrapQty || flags[d.code].scrapWeight));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-zinc-200">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">ตั้งค่าว่าแต่ละขั้นช่างต้องชั่งน้ำหนัก ถามชิ้นเสีย หรือถามเศษโลหะ</caption>
          <thead className="bg-zinc-50 text-zinc-800">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                ขั้น
              </th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className="w-16 px-1 py-2 text-center font-semibold sm:w-24">
                  <span aria-hidden="true" className="sm:hidden">
                    {c.short}
                  </span>
                  <span className="sr-only sm:not-sr-only">{c.full}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((d) => {
              const f = flags[d.code] ?? NO_FLAG;
              const inactive = !d.isActive;
              const noteId = `${idPrefix}-${d.code}-nometal`;
              return (
                <tr key={d.code} className={inactive ? "opacity-60" : undefined}>
                  <th scope="row" className="px-3 py-1.5 align-middle font-medium text-zinc-900">
                    <span className="break-words">{d.nameTh}</span>
                    {inactive && <span className="block text-xs font-normal text-zinc-700">(ขั้นนี้ปิดใช้แล้ว)</span>}
                    {!d.metalPresent && (
                      <span id={noteId} className="block text-xs font-normal text-zinc-700">
                        ยังไม่มีโลหะ ชั่งไม่ได้
                      </span>
                    )}
                  </th>
                  {COLS.map((c) => {
                    const blocked = c.needsMetal && !d.metalPresent;
                    const id = `${idPrefix}-${d.code}-${c.key}`;
                    return (
                      <td key={c.key} className="px-1 py-0.5 text-center">
                        {blocked ? (
                          <span className="relative inline-flex h-11 w-11 items-center justify-center">
                            <input id={id} type="checkbox" aria-label={`${c.full} — ${d.nameTh}`} aria-describedby={noteId} checked={false} disabled className="sr-only" />
                            <span aria-hidden="true" className="text-zinc-500">
                              —
                            </span>
                          </span>
                        ) : (
                          // label ครอบ = พื้นที่แตะ 44×44 จริง (ไม่ใช่แค่ช่องติ๊ก 24px)
                          <label className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                            <input id={id} type="checkbox" aria-label={`${c.full} — ${d.nameTh}`} checked={f[c.key]} disabled={disabled} onChange={(e) => onChange(d.code, c.key, e.target.checked)} className="h-6 w-6 accent-primary-600" />
                          </label>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!anyChecked && <p className="text-sm font-medium text-zinc-800">ไม่ได้ติ๊กอะไรเลย = ไม่ชั่ง ไม่ถามของเสีย (ช่างกดรับ/ส่งต่ออย่างเดียว)</p>}
    </div>
  );
}
