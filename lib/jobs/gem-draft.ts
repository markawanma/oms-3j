// lib/jobs/gem-draft.ts — โมเดล "แถวพลอยที่กำลังกรอก" ของฟอร์ม (pure · ใช้ซ้ำได้ทั้งฟอร์มออฟฟิศและหน้างาน W3) — G1a UI
// แถวคือข้อความที่ผู้ใช้พิมพ์ (ยังไม่เชื่อถือ) → แปลงเป็น GemLineInput ให้ toWireGemLines (allowlist) → DB ตัดสินจริง
// 🔴 ไม่มีราคา/ต้นทุน/เผื่อแตกในไฟล์นี้ · จำนวนเต็ม × จำนวนเต็ม เท่านั้น (ไม่มีปัดเศษ — UX P10; DB คำนวณซ้ำและค่า DB ชนะ)
// ด่านตรวจที่นี่คือ "ตัวอย่าง/ดักก่อนส่ง" (ข้อความเดียวกับ GEM_ERROR_TH) — ช่วง/ชื่อ/ขนาดที่ DB ตรวจซ้ำเสมอ

import type { GemBomLine, GemLineInput, GemOptions } from "@/lib/jobs/gems";
import { GEM_LIMITS, cleanGemName, gemLabelPreview, gemSizeLabel, gemSizeNeedsConfirm, normalizeGemName, normalizeGemSizes, parseGemSize } from "@/lib/jobs/shop-gems";

export type DraftType = { kind: "existing"; id: string; name: string } | { kind: "new"; name: string };
export type DraftShape = { kind: "existing"; id: string; name: string; hasLength: boolean } | { kind: "new"; name: string; hasLength: boolean };

export type GemRowOrigin = "template" | "saved" | "manual";

export interface GemDraftRow {
  /** คีย์ฝั่ง client เท่านั้น (React key · โฟกัส) — ไม่ถูกส่งไป server */
  key: string;
  /** แถวที่ยังเป็น "รายการเดิมทั้งก้อน" (ยังไม่แก้ชนิด/รูปทรง/ขนาด) → ส่ง gemItemId (ฉลาก snapshot คงเดิม) · null = ประกอบจากชนิด/รูปทรง/ขนาด */
  itemId: string | null;
  /** รายการจริงหลังตามการรวมชื่อ (ใช้หาชนิด/รูปทรง/ขนาดจาก options ตอนปลดล็อก) */
  canonicalId: string | null;
  /** ฉลากของ itemId (แสดงแทนช่องชนิด/รูปทรง/ขนาดจนกว่าผู้ใช้กด "เปลี่ยนรายการ") */
  label: string | null;
  type: DraftType | null;
  shape: DraftShape | null;
  sizeA: string;
  sizeB: string;
  qty: string;
  position: string;
  origin: GemRowOrigin;
  /** แถวจากแม่แบบ/ที่บันทึกแล้วที่ถูกแก้ค่า (ป้าย "แก้แล้ว") */
  edited: boolean;
  /** ติ๊ก "ขนาดนี้ถูกต้อง" เมื่อ > 30 มม. */
  bigConfirmed: boolean;
}

let seq = 0;
export const newRowKey = (): string => `gr${++seq}`;

export function emptyGemRow(origin: GemRowOrigin = "manual"): GemDraftRow {
  return { key: newRowKey(), itemId: null, canonicalId: null, label: null, type: null, shape: null, sizeA: "", sizeB: "", qty: "", position: "", origin, edited: false, bigConfirmed: false };
}

/** แถวจากพลอยที่บันทึกแล้ว/แม่แบบ — คงเป็น "รายการเดิม" (itemId + ฉลาก snapshot) จนกว่าผู้ใช้กด "เปลี่ยนรายการ" (unlockRow แยกชนิด/รูปทรง/ขนาดจาก options) */
export function rowFromBomLine(line: GemBomLine, origin: GemRowOrigin): GemDraftRow {
  return { ...emptyGemRow(origin), itemId: line.gemItemId, canonicalId: line.canonicalItemId, label: line.label, qty: String(line.qtyPerPiece), position: line.position ?? "" };
}

/** ปลดล็อกแถวที่เป็นรายการเดิม → ช่องชนิด/รูปทรง/ขนาดเติมจาก options (ไม่พบ = ว่างให้เลือกใหม่) */
export function unlockRow(row: GemDraftRow, options: GemOptions | null): GemDraftRow {
  const ids = [row.canonicalId, row.itemId].filter((x): x is string => typeof x === "string");
  const it = options ? options.items.find((i) => ids.includes(i.gemItemId)) : undefined;
  const type = it && options ? options.types.find((t) => t.id === it.typeId) : undefined;
  const shape = it && options ? options.shapes.find((s) => s.id === it.shapeId) : undefined;
  return {
    ...row,
    itemId: null,
    canonicalId: null,
    edited: true,
    type: type ? { kind: "existing", id: type.id, name: type.name } : null,
    shape: shape ? { kind: "existing", id: shape.id, name: shape.name, hasLength: shape.hasLength } : null,
    sizeA: it ? String(it.sizeA) : "",
    sizeB: it && it.sizeB !== null ? String(it.sizeB) : "",
    bigConfirmed: false,
  };
}

export type RowField = "type" | "shape" | "size_a" | "size_b" | "qty_per_piece" | "position";
export interface RowIssue {
  field: RowField;
  message: string;
}

const QTY_MSG = "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000";
const POS_MSG = "ตำแหน่งต้องไม่เกิน 40 ตัวอักษรและห้ามมีเครื่องหมาย < >";

/** จำนวนต่อชิ้นเป็นจำนวนเต็ม 1–1,000 (ข้อความล้วนตัวเลข) — ไม่ใช่ = null */
export function parseGemQty(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= GEM_LIMITS.qtyMax ? n : null;
}

function hasLengthOf(r: GemDraftRow): boolean | null {
  return r.shape ? r.shape.hasLength : null;
}

/** ปัญหาของแถว (ต่อช่อง) — ว่าง = ครบถ้วนถูกต้อง · แถว itemId ตรวจเฉพาะจำนวน/ตำแหน่ง (รายการเดิมถูกต้องอยู่แล้ว) */
export function gemRowIssues(r: GemDraftRow): RowIssue[] {
  const out: RowIssue[] = [];
  if (r.itemId === null) {
    if (!r.type) out.push({ field: "type", message: "เลือกหรือพิมพ์ชนิดพลอย" });
    if (!r.shape) out.push({ field: "shape", message: "เลือกรูปทรง" });
    const two = hasLengthOf(r);
    if (r.shape) {
      const a = parseGemSize(r.sizeA);
      if (r.sizeA.trim() === "") out.push({ field: "size_a", message: two ? "ใส่ทั้งกว้างและยาว (มม.)" : "ใส่ขนาด (มม.)" });
      else if (!a.ok) out.push({ field: "size_a", message: a.message });
      if (two) {
        const b = parseGemSize(r.sizeB);
        if (r.sizeB.trim() === "") out.push({ field: "size_b", message: "ใส่ทั้งกว้างและยาว (มม.)" });
        else if (!b.ok) out.push({ field: "size_b", message: b.message });
      }
      const sz = rowSizes(r);
      if (sz && gemSizeNeedsConfirm(sz.a, sz.b) && !r.bigConfirmed) {
        out.push({ field: "size_a", message: `ขนาดใหญ่ผิดปกติสำหรับพลอยเครื่องประดับ — ตรวจว่าเป็นมิลลิเมตร แล้วติ๊กยืนยัน` });
      }
    }
  }
  if (parseGemQty(r.qty) === null) out.push({ field: "qty_per_piece", message: QTY_MSG });
  const pos = r.position.trim();
  if (pos !== "" && (Array.from(pos).length > GEM_LIMITS.positionMax || /[<>]/.test(pos))) out.push({ field: "position", message: POS_MSG });
  return out;
}

/** ขนาดที่ parse ได้ + เรียงกว้าง ≤ ยาวแล้ว (null = ยังไม่ครบ/ผิด) · swapped = ผู้ใช้กรอกกลับด้าน (จอบอก "เรียงเป็น 4×6 ให้") */
export function rowSizes(r: GemDraftRow): { a: number; b: number | null; swapped: boolean } | null {
  if (r.itemId !== null || !r.shape) return null;
  const a = parseGemSize(r.sizeA);
  if (!a.ok) return null;
  if (!r.shape.hasLength) return { a: a.value, b: null, swapped: false };
  const b = parseGemSize(r.sizeB);
  if (!b.ok) return null;
  return normalizeGemSizes(a.value, b.value, true);
}

/** ข้อความ "ยังไม่ครบ — …" (aria-disabled เหตุผล) หรือ null */
export function rowIncompleteReason(r: GemDraftRow): string | null {
  const i = gemRowIssues(r)[0];
  return i ? i.message : null;
}

/** ตัวอย่างชื่อ (ระบบตั้งชื่อจริงตอนบันทึก) — แถว itemId = ฉลากเดิม */
export function rowLabelPreview(r: GemDraftRow): string | null {
  if (r.itemId !== null) return r.label;
  const sz = rowSizes(r);
  if (!r.type || !r.shape || !sz) return null;
  return gemLabelPreview(r.type.name, r.shape.name, sz.a, sz.b);
}

/** คีย์ตรวจแถวซ้ำ (ชนิด+รูปทรง+ขนาด) — แถว itemId ใช้ id · ยังไม่ครบ = null (ไม่ตรวจ) */
export function rowDupKey(r: GemDraftRow): string | null {
  if (r.itemId !== null) return `item:${r.itemId}`;
  const sz = rowSizes(r);
  if (!r.type || !r.shape || !sz) return null;
  const t = r.type.kind === "existing" ? `t:${r.type.id}` : `tn:${normalizeGemName(r.type.name)}`;
  const s = r.shape.kind === "existing" ? `s:${r.shape.id}` : `sn:${normalizeGemName(r.shape.name)}`;
  return `${t}|${s}|${gemSizeLabel(sz.a, sz.b)}`;
}

/** แถวที่ซ้ำกับแถวก่อนหน้า: index → index ของแถวแรกที่ซ้ำด้วย (0-based) */
export function findDuplicateRows(rows: readonly GemDraftRow[]): Map<number, number> {
  const first = new Map<string, number>();
  const out = new Map<number, number>();
  rows.forEach((r, i) => {
    const k = rowDupKey(r);
    if (k === null) return;
    const f = first.get(k);
    if (f === undefined) first.set(k, i);
    else out.set(i, f);
  });
  return out;
}

/** รวมแถว from เข้า into: บวกจำนวน/ชิ้น · ตำแหน่งต่อกันด้วย ", " ตัดคำซ้ำทีละคำ (ผู้ใช้กดเอง — ไม่รวมเงียบๆ) */
export function mergeDraftRows(rows: readonly GemDraftRow[], from: number, into: number): GemDraftRow[] {
  if (from === into || from < 0 || into < 0 || from >= rows.length || into >= rows.length) return [...rows];
  const a = rows[into];
  const b = rows[from];
  const qa = parseGemQty(a.qty) ?? 0;
  const qb = parseGemQty(b.qty) ?? 0;
  const words = (s: string) => s.split(",").map((w) => w.trim()).filter((w) => w !== "");
  const pos = [...new Set([...words(a.position), ...words(b.position)])].join(", ");
  const merged: GemDraftRow = { ...a, qty: String(qa + qb), position: pos, edited: a.origin === "manual" ? a.edited : true };
  return rows.map((r, i) => (i === into ? merged : r)).filter((_, i) => i !== from);
}

/** รวมทั้งใบ = จำนวน/ชิ้น × จำนวนที่จะเริ่มผลิต — แถวที่จำนวนยังไม่ถูกต้องนับเป็น 0 */
export function draftTotals(rows: readonly GemDraftRow[], qtyPlanned: number | null): { lineTotals: (number | null)[]; total: number | null; pieces: number } {
  const pieces = rows.reduce((s, r) => s + (parseGemQty(r.qty) ?? 0), 0);
  if (qtyPlanned === null) return { lineTotals: rows.map(() => null), total: null, pieces };
  const lineTotals = rows.map((r) => {
    const q = parseGemQty(r.qty);
    return q === null ? null : q * qtyPlanned;
  });
  return { lineTotals, total: lineTotals.reduce<number>((s, n) => s + (n ?? 0), 0), pieces };
}

/** แถวฟอร์ม → แถว GemLineInput (camelCase) ให้ toWireGemLines — ต้องผ่าน gemRowIssues ก่อน (ไม่ผ่าน = ส่งแล้ว DB ปฏิเสธ) */
export function draftRowToInput(r: GemDraftRow): GemLineInput {
  const qtyPerPiece = parseGemQty(r.qty) ?? Number(r.qty.trim());
  const position = r.position.trim() === "" ? null : r.position.trim().replace(/\s+/g, " ");
  if (r.itemId !== null) return { gemItemId: r.itemId, qtyPerPiece, position };
  const sz = rowSizes(r);
  const out: GemLineInput = { qtyPerPiece, position, sizeA: sz ? sz.a : r.sizeA.trim(), sizeB: sz ? sz.b : null };
  if (r.type) {
    if (r.type.kind === "existing") out.typeId = r.type.id;
    else out.newTypeName = r.type.name;
  }
  if (r.shape) {
    if (r.shape.kind === "existing") out.shapeId = r.shape.id;
    else out.newShape = { name: r.shape.name, hasLength: r.shape.hasLength };
  }
  return out;
}

export function draftRowsToInputs(rows: readonly GemDraftRow[]): GemLineInput[] {
  return rows.map(draftRowToInput);
}

/** ชื่อใหม่ (ชนิด/รูปทรง) ที่พิมพ์ในฟอร์มนี้และยังไม่เข้าแคตตาล็อก (ไม่ซ้ำ) — ขึ้นรายการของแถวถัดไปพร้อมป้าย "ใหม่" */
export function pendingNewNames(rows: readonly GemDraftRow[], kind: "type" | "shape"): { name: string; hasLength?: boolean }[] {
  const seen = new Set<string>();
  const out: { name: string; hasLength?: boolean }[] = [];
  for (const r of rows) {
    const v = kind === "type" ? r.type : r.shape;
    if (!v || v.kind !== "new") continue;
    const n = normalizeGemName(v.name);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(kind === "shape" && r.shape ? { name: v.name, hasLength: r.shape.hasLength } : { name: v.name });
  }
  return out;
}

/** ชื่อชนิด/รูปทรงที่ตรวจแล้ว (cleanGemName) → ข้อความ error ไทย หรือ null */
export function newNameIssue(raw: string): string | null {
  const c = cleanGemName(raw);
  return c.ok ? null : c.message;
}

/** รหัสขั้นฝังพลอยบน DB (design §9.1 — `gem_set` ไม่ใช่ `setting`) */
export const GEM_STAGE_CODE = "gem_set";

/**
 * ฟอร์มสร้างใบงาน: ตัดสินว่าจะส่งพลอยไหม + เตือนอะไร (pure — ทดสอบได้)
 *  - ยังไม่แตะส่วนพลอย (touched=false) → ไม่ส่ง gemLines (DB คัดลอกแม่แบบ SKU เองเมื่อใบมีขั้นฝัง · ไม่มีขั้นฝัง = ไม่คัดลอก)
 *  - แตะแล้ว → ส่งทั้งชุด ([] = ระบุว่าไม่มีพลอย) · แถวไม่ครบ/แถวซ้ำ = บล็อก (blocking ข้อความ)
 *  - ผูกกับขั้น: ระบบไม่เพิ่มขั้นให้เอง — มีพลอยแต่ไม่ติ๊กขั้นฝัง / ติ๊กขั้นฝังแต่ไม่มีพลอย = เตือน (ไม่บล็อก — มติเจ้าของ 22 ต.ค.)
 */
export function gemCreateDecision(a: { touched: boolean; rows: readonly GemDraftRow[]; gemTicked: boolean; hasGemStage: boolean; templateCount: number }): { send: boolean; blocking: string | null; warnings: string[] } {
  const warnings: string[] = [];
  const { touched, rows, gemTicked, hasGemStage, templateCount } = a;
  if (!touched) {
    if (templateCount > 0 && !gemTicked) warnings.push(`แม่แบบพลอย ${templateCount} รายการของ SKU นี้จะไม่ถูกคัดลอก เพราะไม่ได้ติ๊กขั้น “ฝังพลอย”`);
    if (templateCount === 0 && gemTicked) warnings.push("ยังไม่ระบุพลอย — หน้าช่างจะเตือนให้ถามออฟฟิศก่อนฝัง (ไม่บล็อกการสร้างใบ)");
    return { send: false, blocking: null, warnings };
  }
  let blocking: string | null = null;
  const bad = rows.findIndex((r) => gemRowIssues(r).length > 0);
  if (bad >= 0) blocking = `พลอยแถว ${bad + 1} ยังไม่ครบ — ${rowIncompleteReason(rows[bad])}`;
  else {
    const dup = [...findDuplicateRows(rows)][0];
    if (dup) blocking = `พลอยแถว ${dup[0] + 1} ซ้ำกับแถว ${dup[1] + 1} — กด “รวมเข้าแถว ${dup[1] + 1}” หรือแก้ให้ต่างกัน`;
  }
  if (rows.length > 0 && !gemTicked) warnings.push(hasGemStage ? "มีพลอยแต่ไม่ได้ติ๊กขั้น “ฝังพลอย” — พลอยจะไม่อยู่ในขั้นไหน" : "ใบนี้ไม่มีขั้น “ฝังพลอย” ให้เลือก — พลอยจะถูกบันทึกแต่ไม่อยู่ในขั้นไหน (ออฟฟิศต้องเพิ่มขั้นเอง)");
  if (rows.length === 0 && gemTicked) warnings.push("ติ๊กขั้น “ฝังพลอย” แต่ไม่มีพลอย — หน้าช่างจะเตือนว่ายังไม่ระบุพลอย (ไม่บล็อกการสร้างใบ)");
  return { send: true, blocking, warnings };
}

// ---------------------------------------------------------------------------
// สรุปการเปลี่ยนแปลง (+เพิ่ม −ลบ ~แก้) ก่อนบันทึก / เทียบกับแม่แบบ — เทียบด้วยฉลาก (snapshot) ไม่ใช่ id
// ---------------------------------------------------------------------------
export interface DiffLine {
  label: string;
  qtyPerPiece: number;
  position: string | null;
}
export type DiffEntry = { op: "add"; to: DiffLine } | { op: "remove"; from: DiffLine } | { op: "change"; from: DiffLine; to: DiffLine };

export function diffGemLines(before: readonly DiffLine[], after: readonly DiffLine[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  const left = new Map<string, DiffLine>(before.map((l) => [l.label, l]));
  for (const a of after) {
    const b = left.get(a.label);
    if (!b) {
      out.push({ op: "add", to: a });
      continue;
    }
    left.delete(a.label);
    if (b.qtyPerPiece !== a.qtyPerPiece || (b.position ?? "") !== (a.position ?? "")) out.push({ op: "change", from: b, to: a });
  }
  for (const b of left.values()) out.push({ op: "remove", from: b });
  return out;
}
