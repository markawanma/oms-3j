// lib/marketing/ring-size-format.ts — กติกาแสดงตัวเลขของหน้าสรุป /marketing/ring-size (ux-ring-size-stats.md §7.0)
//
// PURE · ทำได้แค่ หาร / เรียง / รวม เพื่อ "แสดง" — ห้ามสร้างตัวเลขธุรกิจใหม่ (RPC ให้มาแล้ว)
// ฐานหาร < 30 ⇒ ไม่โชว์ % ("3 จาก 8") · ฐาน 0 ⇒ "—" · หาร 0 ไม่เป็น NaN/Infinity ทุกทาง

/** ฐานหารต่ำสุดที่โชว์ % (ค่าเดียวกับ MIN_RESPONDENTS_FOR_CONFIDENCE ของ gem quiz — ไม่ได้คิดใหม่) */
export const RING_STATS_MIN_N = 30;

export type CountPct =
  | { kind: "none" }
  | { kind: "low"; count: number; base: number }
  | { kind: "pct"; count: number; base: number; pct: number; label: string };

/** จำนวนนับที่ใช้ได้: จำนวนจำกัด >= 0 (NaN/Infinity/ลบ ⇒ 0) */
function sane(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function countPct(count: number, base: number): CountPct {
  const c = sane(count);
  const b = sane(base);
  if (b <= 0) return { kind: "none" };
  if (b < RING_STATS_MIN_N) return { kind: "low", count: c, base: b };
  const raw = Math.min(100, (c / b) * 100);
  // มีของแต่ปัดเป็น 0 ⇒ "<1%" (ห้ามโชว์ 0% ทั้งที่มี) · ไม่มีของ ⇒ "0%" · ไม่บังคับรวมกันได้ 100
  const pct = Math.round(raw);
  const label = c > 0 && raw < 0.5 ? "<1%" : `${pct}%`;
  return { kind: "pct", count: c, base: b, pct, label };
}

/** ข้อความ % สั้นๆ สำหรับเซลล์ที่ตัวเลขนับแสดงแยกอยู่แล้ว — ฐานต่ำ/ไม่มี ⇒ ข้อความแทน */
export function pctText(count: number, base: number): string {
  const r = countPct(count, base);
  if (r.kind === "none") return "—";
  if (r.kind === "low") return `จาก ${formatInt(r.base)}`;
  return r.label;
}

/** "31 ครั้ง · 17%" / "3 จาก 8" / "—" (ฐาน 0) */
export function countWithBase(count: number, base: number, unit = "ครั้ง"): string {
  const r = countPct(count, base);
  if (r.kind === "none") return "—";
  if (r.kind === "low") return `${formatInt(r.count)} จาก ${formatInt(r.base)}`;
  return `${formatInt(r.count)} ${unit} · ${r.label}`;
}

export function formatInt(n: number): string {
  return sane(n).toLocaleString("th-TH");
}

/** พบมากสุด n อันดับ: count มาก→น้อย · เท่ากันเบอร์เล็กก่อน · ตัดแถวที่ count = 0 */
export function topSizes(rows: readonly { size: number; count: number }[], n = 3): { size: number; count: number }[] {
  return rows
    .filter((r) => sane(r.count) > 0)
    .map((r) => ({ size: r.size, count: sane(r.count) }))
    .sort((a, b) => b.count - a.count || a.size - b.size)
    .slice(0, n);
}

/** แถวตารางเบอร์ min..max ครบทุกเบอร์ (รวมเบอร์ที่เป็น 0) เรียงเบอร์น้อย→มาก */
export function sizeTableRows(
  rows: readonly { size: number; count: number }[],
  min: number,
  max: number
): { size: number; count: number }[] {
  // กันช่วงผิดรูป (ไม่ควรเกิด — parser ตรวจแล้ว) ไม่ให้วนลูปยาว
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min || max - min > 100) return [];
  const bySize = new Map<number, number>();
  for (const r of rows) bySize.set(r.size, (bySize.get(r.size) ?? 0) + sane(r.count));
  const out: { size: number; count: number }[] = [];
  for (let s = min; s <= max; s++) out.push({ size: s, count: bySize.get(s) ?? 0 });
  return out;
}

/**
 * ขั้นที่ "หยุดมากสุด" ในกลุ่ม stage 1..6 (กดเริ่มแล้วเลิก) — stage 0 (เปิดแล้วไม่กดเริ่ม) ไม่เข้าการเลือก
 * ฐานเปิดใช้ < 30 หรือค่ามากสุด = 0 ⇒ ไม่ติดทุกขั้น · เสมอ ⇒ ติดทุกขั้นที่เสมอ · เลือกจากข้อมูล ไม่คำนวณใหม่
 */
export function maxAbandonStages(abandonAt: readonly number[], sessions: number): number[] {
  if (sane(sessions) < RING_STATS_MIN_N) return [];
  let best = 0;
  for (let k = 1; k < abandonAt.length; k++) best = Math.max(best, sane(abandonAt[k]));
  if (best <= 0) return [];
  const out: number[] = [];
  for (let k = 1; k < abandonAt.length; k++) if (sane(abandonAt[k]) === best) out.push(k);
  return out;
}

/** รายวันใหม่→เก่า · ตัดวันก่อน data_since (ยังไม่ได้เก็บข้อมูล — ไม่ใช่ "0 ครั้ง") */
export function dailyNewestFirst<T extends { date: string }>(rows: readonly T[], dataSince: string | null): T[] {
  const kept = dataSince ? rows.filter((r) => r.date >= dataSince) : [...rows];
  return kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
