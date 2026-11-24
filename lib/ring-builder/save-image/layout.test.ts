// layout (pure) — S14: ข้อความไม่ถูกตัด/ซ้อน · ความสูงยืดตามแถว · ขนาดตัวอักษรต่ำสุด 32 · ตัดคำไทยไม่แยกสระ/วรรณยุกต์
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import {
  CARD_PAD_X,
  FOOT_PX,
  GAP,
  HEADER_H,
  IMAGE_W,
  LABEL_PX,
  MARGIN_X,
  ROW_MIN_H,
  STAGE_H,
  VALUE_PX,
  computeSaveLayout,
  formatThaiDate,
  segmentWords,
  splitGraphemes,
  wrapText,
  type MeasureFn,
} from "./layout";

/** วัดแบบง่าย: ทุกตัวอักษร (ไม่นับเครื่องหมายผสมไทย) กว้าง px×0.5 */
const measure: MeasureFn = (text, px) => Array.from(text).filter((c) => !/\p{M}/u.test(c)).length * px * 0.5;
const m = (px: number) => (s: string) => measure(s, px, 400);

afterEach(() => vi.unstubAllGlobals());

describe("wrapText", () => {
  it("ข้อความสั้น = 1 บรรทัดเท่าเดิม · ข้อความว่าง = [''] (ไม่ใช่ array ว่าง)", () => {
    expect(wrapText("ไขว้ 2 เม็ด", 10_000, m(40))).toEqual(["ไขว้ 2 เม็ด"]);
    expect(wrapText("", 100, m(40))).toEqual([""]);
  });

  it("ยาวเกิน → ตัดหลายบรรทัด ไม่มีบรรทัดไหนกว้างเกิน · ต่อกลับ = ข้อความเดิม (ไม่ทิ้งตัวอักษร)", () => {
    const text = "เลือกพลอยเอง (รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน)";
    const lines = wrapText(text, 400, m(40));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(m(40)(l)).toBeLessThanOrEqual(400);
    expect(lines.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });

  it("ก้อนเดียวที่ยาวเกินความกว้าง (ไม่มีเว้นวรรค) ถูกตัดตามตัวอักษร ไม่ล้น ไม่หาย", () => {
    const text = "ก".repeat(60);
    const lines = wrapText(text, 200, m(40));
    for (const l of lines) expect(m(40)(l)).toBeLessThanOrEqual(200);
    expect(lines.join("")).toBe(text);
  });

  it("ไม่แยกสระ/วรรณยุกต์ไทยออกจากตัวฐานตอนตัดตามตัวอักษร (แม้ไม่มี Intl.Segmenter)", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const text = "ที่ปรึกษาน้ำใจดีเยี่ยม".repeat(4);
    const lines = wrapText(text, 120, m(40));
    for (const l of lines) {
      expect(l.length).toBeGreaterThan(0);
      expect(l).not.toMatch(/^\p{M}/u); // ไม่มีบรรทัดที่ขึ้นต้นด้วยเครื่องหมายผสมลอยๆ
    }
    expect(lines.join("")).toBe(text);
  });

  it("maxW <= 0 ไม่วนไม่รู้จบ — 1 ตัวอักษร/บรรทัด", () => {
    expect(wrapText("abc", 0, m(40))).toEqual(["a", "b", "c"]);
  });

  it("splitGraphemes: ตัวฐาน+เครื่องหมายผสมเป็นก้อนเดียว · segmentWords สำรองตามตัวอักษร", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    expect(splitGraphemes("ที่")).toEqual(["ที่"]);
    expect(segmentWords("ab")).toEqual(["a", "b"]);
  });
});

function rows(n: number, value = "ทับทิม") {
  return Array.from({ length: n }, (_, i) => ({ label: `แถว ${i + 1}`, value }));
}
const base = (r: { label: string; value: string }[]) => ({
  rows: r,
  note: SHOWCASE_COPY.saveImageNote,
  notAnOrder: SHOWCASE_COPY.notAnOrder,
  dateLine: SHOWCASE_COPY.savePriceAsOf("25/11/2569"),
});

describe("computeSaveLayout", () => {
  it("กว้างคงที่ 1080 · header 112 · stage 1080×810 ต่อจาก header · การ์ดอยู่ใต้ stage + gap 24 · ขอบซ้ายขวา 72", () => {
    const L = computeSaveLayout(base(rows(6)), measure);
    expect(L.width).toBe(IMAGE_W);
    expect(L.stage).toEqual({ x: 0, y: HEADER_H, w: 1080, h: STAGE_H });
    expect(L.card.y).toBe(HEADER_H + STAGE_H + GAP);
    expect(L.card.x).toBe(MARGIN_X);
    expect(L.card.w).toBe(IMAGE_W - 2 * MARGIN_X);
  });

  it("6 แถวค่าสั้น: แถวละ 64 · แถวต่อกันไม่ซ้อน · การ์ดครอบแถวสุดท้าย", () => {
    const L = computeSaveLayout(base(rows(6)), measure);
    for (const r of L.rows) expect(r.h).toBe(ROW_MIN_H);
    for (let i = 1; i < L.rows.length; i++) expect(L.rows[i].y).toBe(L.rows[i - 1].y + L.rows[i - 1].h);
    const last = L.rows[L.rows.length - 1];
    expect(L.card.y + L.card.h).toBeGreaterThanOrEqual(last.y + last.h);
  });

  it("ความสูงภาพยืดตามจำนวนแถว (ไม่ย่อฟอนต์): 10 แถวสูงกว่า 6 แถว ≥ 4×64", () => {
    const a = computeSaveLayout(base(rows(6)), measure).height;
    const b = computeSaveLayout(base(rows(10)), measure).height;
    expect(b - a).toBeGreaterThanOrEqual(4 * ROW_MIN_H);
  });

  it("S14: ค่ายาวมากตัดบรรทัด → แถวสูงขึ้น · ไม่มีข้อความหาย · ไม่ล้นความกว้างการ์ด · ไม่ซ้อนแถวถัดไป", () => {
    const long = "เลือกพลอยเอง (รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน) ".repeat(2).trim();
    const L = computeSaveLayout(base([{ label: "พลอย", value: long }, ...rows(3)]), measure);
    const r0 = L.rows[0];
    expect(r0.valueLines.length).toBeGreaterThan(1);
    expect(r0.h).toBeGreaterThan(ROW_MIN_H);
    expect(r0.valueLines.join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
    const innerW = L.card.w - 2 * CARD_PAD_X;
    for (const l of r0.valueLines) expect(measure(l, VALUE_PX, 500)).toBeLessThanOrEqual(innerW);
    expect(L.rows[1].y).toBe(r0.y + r0.h);
  });

  it("label ยาวเกิน 45% ถูกตัดบรรทัด (ไม่ทับค่า)", () => {
    const L = computeSaveLayout(base([{ label: "ป้ายที่ยาวมากมากมากมากมากมากมากมากมาก", value: "x" }]), measure);
    expect(L.rows[0].labelLines.length).toBeGreaterThan(1);
  });

  it("ขนาดตัวอักษรทุกชนิดในภาพ ≥ 32px", () => {
    expect(Math.min(LABEL_PX, VALUE_PX, FOOT_PX)).toBeGreaterThanOrEqual(32);
  });

  it("footer: หมายเหตุ + 'ยังไม่ใช่การสั่งซื้อ' + วันที่ อยู่ใต้การ์ด ภายในความสูงภาพ", () => {
    const L = computeSaveLayout(base(rows(6)), measure);
    expect(L.footer.y).toBe(L.card.y + L.card.h + GAP);
    expect(L.footer.noteLines.join("").replace(/\s/g, "")).toBe(SHOWCASE_COPY.saveImageNote.replace(/\s/g, ""));
    expect(L.footer.orderLines.join("").replace(/\s/g, "")).toBe(SHOWCASE_COPY.notAnOrder.replace(/\s/g, ""));
    expect(L.footer.dateLine).toBe("ราคา ณ 25/11/2569");
    expect(L.footer.dateY).toBeGreaterThan(L.footer.y);
    expect(L.height).toBeGreaterThan(L.footer.dateY);
  });
});

describe("formatThaiDate", () => {
  it("วัน/เดือน/พ.ศ. เติมศูนย์ · ไม่ขึ้นกับ locale", () => {
    expect(formatThaiDate(new Date(2026, 10, 25))).toBe("25/11/2569");
    expect(formatThaiDate(new Date(2026, 0, 5))).toBe("05/01/2569");
  });
});
