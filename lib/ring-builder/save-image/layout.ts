// lib/ring-builder/save-image/layout.ts — คำนวณโครงภาพ "บันทึกรูป" (pure · ไม่แตะ DOM/canvas) — ux-ring-save-image §1.2
// รับ rows (จาก buildShowcaseDetailRows) + ฟังก์ชันวัดข้อความ → ตำแหน่ง/ความสูง/บรรทัดที่ตัดแล้ว
// ความสูงภาพยืดตามจำนวนแถว (ไม่ย่อฟอนต์ · ไม่ตัดข้อมูล) · ข้อความตัดบรรทัดได้ ไม่มีวัน truncate (S14)
// ภาษาไทยไม่มีเว้นวรรค: ตัดคำด้วย Intl.Segmenter('th') ถ้ามี ไม่มี = ตัดตามตัวอักษร (ไม่แยกสระ/วรรณยุกต์ออกจากตัวฐาน)

export const IMAGE_W = 1080;
export const MARGIN_X = 72;
export const HEADER_H = 112;
export const STAGE_W = 1080;
export const STAGE_H = 810;
export const GAP = 24;
export const CARD_RADIUS = 36;
export const CARD_PAD_X = 32;
export const CARD_PAD_Y = 16;
export const ROW_MIN_H = 64;
export const ROW_PAD_Y = 10;
export const VALUE_LINE_H = 44;
export const LABEL_PX = 34;
export const VALUE_PX = 40;
export const FOOT_PX = 32; // ขนาดต่ำสุดของข้อความในภาพ (≈ 11.5pt เมื่อดูเต็มจอ iPhone)
export const FOOT_LINE_H = 44;
export const LABEL_VALUE_GAP = 24;
export const BOTTOM_PAD = 40;

export type MeasureFn = (text: string, px: number, weight: number) => number;

/** แยกเป็นก้อนที่ตัดบรรทัดได้ (คำ+เว้นวรรคตามหลัง) — Intl.Segmenter ถ้ามี · ไม่มี = ตามตัวอักษร */
export function segmentWords(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    try {
      return Array.from(new Seg("th", { granularity: "word" }).segment(text), (s) => s.segment);
    } catch {
      // ไม่รองรับ locale — ตกไปแบบตัวอักษร
    }
  }
  return splitGraphemes(text);
}

/** ตัวอักษรที่ผู้ใช้เห็น (กลุ่มตัวฐาน + เครื่องหมายผสม) — ไม่ตัดสระบน/ล่าง/วรรณยุกต์ไทยออกจากตัวฐาน */
export function splitGraphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string | undefined, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    try {
      return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    } catch {
      // ตกไป regex
    }
  }
  return text.match(/\P{M}\p{M}*/gu) ?? [];
}

/**
 * ตัดบรรทัดตามความกว้าง (greedy) · ต่อบรรทัดกลับ = ข้อความเดิม (ยกเว้นช่องว่างปลายบรรทัดที่ถูกตัดทิ้ง) · ก้อนเดียวที่ยาวเกินกว่าจะพอดี = ตัดตามตัวอักษร
 * คืนอย่างน้อย 1 บรรทัดเสมอ · maxW <= 0 = บรรทัดละ 1 ตัวอักษร (ไม่วนไม่รู้จบ)
 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number, segment: (s: string) => string[] = segmentWords): string[] {
  const atoms: string[] = [];
  for (const piece of segment(text)) {
    if (piece === "") continue;
    if (measure(piece.trimEnd()) > maxW) atoms.push(...splitGraphemes(piece));
    else atoms.push(piece);
  }
  const lines: string[] = [];
  let cur = "";
  for (const a of atoms) {
    const next = cur + a;
    if (cur === "" || measure(next.trimEnd()) <= maxW) {
      cur = next;
      continue;
    }
    lines.push(cur.trimEnd());
    cur = a.trimStart();
  }
  if (cur.trim() !== "") lines.push(cur.trimEnd());
  return lines.length > 0 ? lines : [""];
}

export interface LaidOutRow {
  y: number;
  h: number;
  labelLines: string[];
  valueLines: string[];
}

export interface SaveLayout {
  width: number;
  height: number;
  headerY: number;
  stage: { x: number; y: number; w: number; h: number };
  card: { x: number; y: number; w: number; h: number };
  rows: LaidOutRow[];
  footer: { y: number; noteLines: string[]; orderLines: string[]; dateLine: string; dateY: number };
}

export interface LayoutInput {
  rows: readonly { label: string; value: string }[];
  note: string;
  notAnOrder: string;
  dateLine: string;
}

/** ความสูงแถว: อย่างน้อย 64 · บรรทัดเพิ่ม = +44 (label กับ value สูงเท่ากันที่บรรทัดมากกว่า) */
function rowHeight(lines: number): number {
  return Math.max(ROW_MIN_H, 2 * ROW_PAD_Y + lines * VALUE_LINE_H);
}

export function computeSaveLayout(input: LayoutInput, measure: MeasureFn): SaveLayout {
  const cardX = MARGIN_X;
  const cardW = IMAGE_W - 2 * MARGIN_X;
  const innerW = cardW - 2 * CARD_PAD_X;
  const stageY = HEADER_H;
  const cardY = stageY + STAGE_H + GAP;

  let y = cardY + CARD_PAD_Y;
  const rows: LaidOutRow[] = input.rows.map((r) => {
    const labelW = Math.ceil(measure(r.label, LABEL_PX, 400));
    // label ไม่เกิน 45% ของความกว้างในการ์ด (ที่เหลือให้ค่า) · label ยาวกว่านั้นตัดบรรทัด
    const labelMax = Math.floor(innerW * 0.45);
    const labelLines = labelW <= labelMax ? [r.label] : wrapText(r.label, labelMax, (s) => measure(s, LABEL_PX, 400));
    const labelUsed = Math.max(...labelLines.map((l) => Math.ceil(measure(l, LABEL_PX, 400))));
    const valueMax = Math.max(1, innerW - labelUsed - LABEL_VALUE_GAP);
    const valueLines = wrapText(r.value, valueMax, (s) => measure(s, VALUE_PX, 500));
    const h = rowHeight(Math.max(labelLines.length, valueLines.length));
    const row = { y, h, labelLines, valueLines };
    y += h;
    return row;
  });
  const cardH = y + CARD_PAD_Y - cardY;

  const footW = IMAGE_W - 2 * MARGIN_X;
  const noteLines = wrapText(input.note, footW, (s) => measure(s, FOOT_PX, 400));
  const orderLines = wrapText(input.notAnOrder, footW, (s) => measure(s, FOOT_PX, 400));
  const footY = cardY + cardH + GAP;
  const textBlock = (noteLines.length + orderLines.length) * FOOT_LINE_H;
  const dateY = footY + textBlock + 12;
  const height = dateY + FOOT_LINE_H + BOTTOM_PAD;

  return {
    width: IMAGE_W,
    height,
    headerY: 0,
    stage: { x: 0, y: stageY, w: STAGE_W, h: STAGE_H },
    card: { x: cardX, y: cardY, w: cardW, h: cardH },
    rows,
    footer: { y: footY, noteLines, orderLines, dateLine: input.dateLine, dateY },
  };
}

/** "25/11/2569" จากเวลาเครื่อง (วัน/เดือน/พ.ศ.) — ไม่ใช้ locale ของเครื่อง (ได้ผลเหมือนกันทุกเครื่อง) */
export function formatThaiDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear() + 543}`;
}
