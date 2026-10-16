// lib/oem/paymentLinesForm.ts — pre-check ฟอร์ม "ช่องทางชำระเงิน" (ข้อความใน textarea -> บรรทัด) · pure
//
// เป็นแค่ pre-check เพื่อ UX — ด่านจริงอยู่ที่ setSellerPaymentLines (server action) และ oem_setting_set_payment_lines (DB)
// กฎต้องตรงกับ server: แถวว่างล้วนถูกตัดทิ้ง · ไม่เกิน 6 บรรทัด · บรรทัดละไม่เกิน 200 ตัวอักษร (นับ code point)

export const PAYMENT_LINES_MAX = 6;
export const PAYMENT_LINE_MAX_CHARS = 200;

export interface PaymentLinesFormState {
  /** บรรทัดที่ไม่ว่าง (trim แล้ว) — ค่าที่จะส่งให้ action */
  lines: string[];
  count: number;
  /** ข้อความผิดพลาดภาษาไทย · null = ผ่าน pre-check */
  error: string | null;
}

export function linesToText(lines: string[]): string {
  return lines.join("\n");
}

export function parsePaymentLinesText(text: string): PaymentLinesFormState {
  const rawLines = text.split(/\r?\n/);
  const lines: string[] = [];
  let error: string | null = null;
  rawLines.forEach((raw, i) => {
    const t = raw.trim();
    if (t.length === 0) return;
    lines.push(t);
    const len = [...t].length;
    if (error === null && len > PAYMENT_LINE_MAX_CHARS) {
      error = `บรรทัดที่ ${i + 1} ยาวเกิน ${PAYMENT_LINE_MAX_CHARS} ตัวอักษร (กรอก ${len})`;
    }
  });
  if (error === null && lines.length > PAYMENT_LINES_MAX) {
    error = `ใส่ได้ไม่เกิน ${PAYMENT_LINES_MAX} บรรทัด (กรอก ${lines.length} บรรทัด)`;
  }
  return { lines, count: lines.length, error };
}
