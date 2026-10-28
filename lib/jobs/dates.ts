// lib/jobs/dates.ts — วันที่แบบ YYYY-MM-DD ล้วน (pure · ไม่ผูก timezone เครื่อง) + แสดงผลไทย (พ.ศ.)

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "12 ต.ค. 2569" — ไม่ใช่วันที่ = "—" */
export function thaiDate(date: string | null | undefined, withYear = true): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (m < 1 || m > 12) return "—";
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y + 543}` : ""}`;
}

/** "ต.ค. 2569" จาก "YYYY-MM" — ไม่ใช่เดือนที่ถูกต้อง = "—" */
export function thaiMonthYear(ym: string | null | undefined): string {
  const m = typeof ym === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : "—";
}

/** วันที่ตามเวลาไทย (Asia/Bangkok) ของ timestamp ISO → "YYYY-MM-DD" · อ่านไม่ได้ = null (ไม่ผูก timezone เครื่อง) */
export function bkkDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** เวลาไทยของ timestamp ISO → "12 ต.ค. 14:05" */
export function thaiDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${thaiDate(`${g("year")}-${g("month")}-${g("day")}`, false)} ${g("hour")}:${g("minute")}`;
}
