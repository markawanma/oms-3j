// lib/jobs/gem-order-text.ts — ข้อความ "รายการสั่งซื้อพลอย" สำหรับคัดลอกไปวางใน LINE ส่งร้านพลอย (ux-gems-to-buy.md §6 · มติเจ้าของ 24 ต.ค. 69: คัดลอกอย่างเดียว ไม่มีใบพิมพ์)
// 🔴 ไม่มีราคา/ต้นทุนเสมอ — กันที่ type boundary ไม่ใช่วินัย:
//  - GemOrderLine มีแค่ 5 field (ชนิด · รูปทรง · ขนาด · หน่วย · จำนวน) — ไม่มี field ราคา/ผู้ขาย/เลขใบ/กำหนดส่ง
//  - toGemOrderLines ประกอบทีละ field (ห้าม spread) → แม้ผู้เรียกส่ง object ที่มี field ราคาติดมา ก็ไม่ถูกอ่าน
//  - buildGemOrderText อ่านเฉพาะ 5 field นั้น
//  - ไฟล์นี้ import เฉพาะ lib/jobs/dates (pure) — เทสต์ gems-boundary.test.ts ล็อกว่ากราฟ runtime ไม่มีโมดูลราคา
// ข้อความมีวันที่ทำรายการ (today_bkk จาก DB) อย่างเดียว — ไม่แต่งหัว/ท้ายแทนร้าน · ไม่ใช้คำว่า "ต้องสั่ง" (ยอดคือ "ที่ใบงานต้องใช้" ไม่ใช่ยอดที่ควรสั่ง) · ไม่มีอิโมจิ

import { thaiDate } from "@/lib/jobs/dates";

export interface GemOrderLine {
  typeName: string;
  shapeName: string;
  sizeLabel: string;
  unitLabel: string;
  qty: number;
}

/** รูปร่างขั้นต่ำที่ toGemOrderLines อ่าน (แถวของจอเข้ากันได้โดยโครงสร้าง) */
export interface GemOrderSource {
  group: { typeName: string; shapeName: string; sizeLabel: string };
  qty: number;
}

export function toGemOrderLines(rows: ReadonlyArray<GemOrderSource>, unitLabel = "เม็ด"): GemOrderLine[] {
  return rows.map((r) => ({ typeName: r.group.typeName, shapeName: r.group.shapeName, sizeLabel: r.group.sizeLabel, unitLabel, qty: r.qty }));
}

/** "24 ต.ค. 69" (ปี พ.ศ. 2 หลัก) จาก YYYY-MM-DD — ไม่ใช่วันที่ = "" */
export function gemOrderDateLabel(todayBkk: string): string {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(todayBkk);
  if (!m) return "";
  const d = thaiDate(todayBkk, false);
  return d === "—" ? "" : `${d} ${String((Number(m[1]) + 543) % 100).padStart(2, "0")}`;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const fmtQty = (n: number): string => n.toLocaleString("en-US");
const th = (a: string, b: string): number => a.localeCompare(b, "th");

/** "4×6" → [4, 6] · "1.5" → [1.5, -1] — ใช้เรียงเลขจริง (ไม่เรียงตัวอักษร: 10 ต้องมาหลัง 2) */
function sizeKey(label: string): [number, number] {
  const parts = label.split("×").map(Number);
  const a = Number.isFinite(parts[0]) ? parts[0] : Number.MAX_SAFE_INTEGER;
  const b = parts.length > 1 && Number.isFinite(parts[1]) ? parts[1] : -1;
  return [a, b];
}

/**
 * จัดกลุ่มตามชนิด (ร้านพลอยคิดตามชนิด) · ภายในกลุ่ม รูปทรง → ขนาด · ลำดับคงที่ ไม่ตามการเรียงบนจอ
 * ไม่มีรายการ = "" (ผู้เรียกต้องไม่คัดลอกข้อความว่าง)
 */
export function buildGemOrderText(lines: ReadonlyArray<GemOrderLine>, opts: { dateLabel: string }): string {
  if (lines.length === 0) return "";
  const items = lines.map((l) => ({ type: clean(l.typeName), shape: clean(l.shapeName), size: clean(l.sizeLabel), unit: clean(l.unitLabel), qty: l.qty }));
  items.sort((a, b) => {
    if (a.type !== b.type) return th(a.type, b.type);
    if (a.shape !== b.shape) return th(a.shape, b.shape);
    const [a1, a2] = sizeKey(a.size);
    const [b1, b2] = sizeKey(b.size);
    return a1 - b1 || a2 - b2;
  });
  const out: string[] = [opts.dateLabel === "" ? "รายการสั่งซื้อพลอย" : `รายการสั่งซื้อพลอย · ${opts.dateLabel}`, ""];
  let current: string | null = null;
  for (const it of items) {
    if (it.type !== current) {
      out.push(it.type);
      current = it.type;
    }
    out.push(`- ${it.shape} ${it.size} มม. ${fmtQty(it.qty)} ${it.unit}`);
  }
  out.push("", `รวม ${items.length} รายการ`);
  return out.join("\n");
}
