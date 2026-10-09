// lib/marketing/format.ts — จัดรูปวัน-เวลาไทยสำหรับสายงาน content (พ.ศ. · เวลาไทย) · pure

const DATE_TIME_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const DATE_FMT_YEAR = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** ISO timestamp → "9 ต.ค. 2569 14:30" (เวลาไทย) · ค่าไม่ถูกต้อง → "-" */
export function formatThaiDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return DATE_TIME_FMT.format(d);
}

/** "YYYY-MM-DD" → "พฤ. 8 ต.ค." (ไม่ผูก timezone เครื่อง) · ใส่ withYear เพื่อให้มี พ.ศ. */
export function formatThaiDay(dateStr: string | null | undefined, withYear = false): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return "-";
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return "-";
  return (withYear ? DATE_FMT_YEAR : DATE_FMT).format(d);
}

/** วันที่ (ไทย) ของ timestamp → YYYY-MM-DD */
export function bangkokDateOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** จำนวนวันระหว่างสองวันที่ YYYY-MM-DD (b - a) — ใช้บอก "ผ่านมากี่วัน" (ข้อมูลประกอบ ไม่ใช่การตัดสิน) */
export function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86_400_000);
}
