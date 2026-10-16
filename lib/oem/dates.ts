// lib/oem/dates.ts — วันที่ธุรกิจของโมดูล OEM (เวลาไทย) · pure ไม่แตะเงิน
//
// ย้ายออกมาจาก ReceiptIssueDialog (ใช้ร่วมกับ InvoiceIssueDialog) — วัน "วันนี้" ต้องเป็นเวลาไทยเสมอ
// ไม่ใช่ timezone ของเครื่องผู้ใช้ (เจ้าของอาจเปิดจากเครื่องที่ตั้ง tz อื่น) และต้องตรงกับที่ DB ตัดสิน
// ((now() at time zone 'Asia/Bangkok')::date — ดู 3j-migration-traps ข้อ 6)

const bangkokDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "วันนี้" ตามเวลาไทย, YYYY-MM-DD — en-CA จัดรูปแบบเป็น YYYY-MM-DD ตรงตามที่ <input type="date"> ต้องการพอดี */
export function todayBangkok(now: Date = new Date()): string {
  return bangkokDateFormatter.format(now);
}

/** บวก/ลบวันบนสตริง YYYY-MM-DD — anchor เที่ยงวัน UTC กัน DST/ขอบวันเหลื่อม · วันที่ไม่จริง (2026-02-31) = throw */
export function addDaysIso(iso: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new RangeError(`addDaysIso: รูปแบบวันที่ไม่ถูกต้อง (${iso})`);
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new RangeError(`addDaysIso: วันที่ไม่มีอยู่จริง (${iso})`);
  }
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
