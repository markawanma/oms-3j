// format.ts — helper แสดงผลที่หน้าจอใบงาน (0175) ใช้ร่วมกัน · ไม่คำนวณเลขเงิน/น้ำหนักใหม่ (แค่จัดรูปค่าที่ DB ตอบมา)

/** ค่าตัวเลขที่ใช้ได้จริง (number จำกัด) · อย่างอื่น = null (ไม่เดา) */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** เปอร์เซ็นต์ที่ DB ตอบเป็น % จริงแล้ว (3 = 3%) — ปัด 2 ตำแหน่ง ตัด 0 ท้าย · ห้ามคูณ/หาร 100 ที่นี่ */
export function fmtPct(n: number): string {
  return `${Number(n.toFixed(2))}%`;
}
