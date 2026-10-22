// lib/jobs/gem-save.ts — แปลงผลล้มของ action พลอย (JobResult ที่พา gem {code,row,field,similar[]}) → สิ่งที่จอต้องทำ (pure)
//  - similar[] (ตัวดักชื่อคล้ายฝั่ง DB ยังไม่เขียนอะไร) → ถามผู้ใช้: ใช้ตัวที่มี (แก้แถวให้) / เพิ่มใหม่จริงๆ (ส่ง force)
//  - error ของแถว (row ≥ 1) → ผูกกับ key ของแถวนั้น (ฟอร์มคงอยู่ แถวนั้นขึ้นกล่องแดง)
//  - อื่นๆ = ข้อความระดับฟอร์ม
// ข้อความไทยมาจาก server (ผ่านกรองแล้ว) — ไม่ประกอบเอง ไม่มีรหัส/ชื่อตาราง/ตัวเลขเงิน

import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemErrorInfo, GemOptions, GemSimilarHit } from "@/lib/jobs/gems";

export interface GemFailLike {
  error: string;
  code?: string;
  gem?: GemErrorInfo;
}

export type GemRowErrorMap = Record<string, { field: string | null; message: string }>;

export interface GemFailView {
  rowErrors: GemRowErrorMap;
  generalError: string | null;
  /** hit แรกที่ต้องถามผู้ใช้ (ตัวดักชื่อคล้าย) — null = ไม่มี */
  similar: GemSimilarHit | null;
  /** จอควรเปิดแถว/ช่องที่ผิด (key ของแถวแรกที่มี error) */
  focusRowKey: string | null;
}

export function interpretGemFail(r: GemFailLike, rows: readonly GemDraftRow[]): GemFailView {
  const gem = r.gem;
  if (gem?.similar && gem.similar.length > 0) {
    return { rowErrors: {}, generalError: null, similar: gem.similar[0], focusRowKey: null };
  }
  if (gem && typeof gem.row === "number" && gem.row >= 1 && gem.row <= rows.length) {
    const key = rows[gem.row - 1].key;
    return { rowErrors: { [key]: { field: gem.field ?? null, message: r.error } }, generalError: null, similar: null, focusRowKey: key };
  }
  return { rowErrors: {}, generalError: r.error, similar: null, focusRowKey: null };
}

/**
 * ผู้ใช้เลือก "ใช้ตัวที่มี" จากตัวดักของ DB: แก้ทุกแถวที่พิมพ์ชื่อนั้นให้ชี้ไปที่ตัวที่มี (match.id = null → ชื่อใหม่อีกตัวในคำขอเดียวกัน)
 * รูปทรง: ใช้ hasLength จาก options (ไม่พบ = คงของแถวเดิม — DB ตรวจ has_length_mismatch ซ้ำ)
 */
export function applySimilarChoice(rows: readonly GemDraftRow[], hit: GemSimilarHit, match: { id: string | null; name: string }, options: GemOptions | null): GemDraftRow[] {
  const targets = new Set(hit.rows);
  return rows.map((r, i) => {
    if (!targets.has(i + 1)) return r;
    if (hit.kind === "type") {
      return { ...r, itemId: null, type: match.id ? { kind: "existing", id: match.id, name: match.name } : { kind: "new", name: match.name }, edited: r.origin === "manual" ? r.edited : true };
    }
    const found = match.id && options ? options.shapes.find((s) => s.id === match.id) : undefined;
    const hasLength = found ? found.hasLength : (r.shape?.hasLength ?? false);
    return { ...r, itemId: null, shape: match.id ? { kind: "existing", id: match.id, name: match.name, hasLength } : { kind: "new", name: match.name, hasLength }, sizeB: hasLength ? r.sizeB : "", edited: r.origin === "manual" ? r.edited : true };
  });
}

/** ข้อความแจ้ง "ใช้ตัวเดิมให้" จากสรุปของ DB (ชื่อที่พิมพ์ไปซ้ำกับของที่มี — race / normalize) */
export function reusedNotices(reused: readonly { row: number; kind: "type" | "shape"; typed: string; name: string }[]): string[] {
  return reused.map((x) => `${x.kind === "type" ? "ชนิด" : "รูปทรง"} “${x.typed}” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “${x.name}” ให้`);
}

/**
 * ระบบรวมแถวซ้ำให้ (ชนิด+รูปทรง+ขนาดเดียวกัน → บวกจำนวน) — แจ้งผู้ใช้ว่าเกิดอะไรขึ้น ไม่เงียบ
 * mergedRows = [[1,2],[4,5,6]] (เลขแถวตอนส่ง · 1-based) — เฉพาะกลุ่มที่มี ≥ 2 แถวถึงนับ
 */
export function mergedNotices(mergedRows: readonly (readonly number[])[]): string[] {
  const groups = mergedRows.filter((g) => g.length >= 2);
  if (groups.length === 0) return [];
  const n = groups.reduce((s, g) => s + g.length - 1, 0);
  return [`รวมแถวซ้ำ ${n} แถว (${groups.map((g) => `แถว ${g.join(", ")}`).join(" · ")}) — จำนวนต่อชิ้นถูกบวกกันให้แล้ว`];
}

/** ข้อความแจ้งผลสรุปจากระบบหลังบันทึก: ชื่อที่ใช้ตัวเดิมให้ + แถวซ้ำที่ถูกรวม */
export function saveNotices(s: { reused: readonly { row: number; kind: "type" | "shape"; typed: string; name: string }[]; mergedRows: readonly (readonly number[])[] }): string[] {
  return [...reusedNotices(s.reused), ...mergedNotices(s.mergedRows)];
}
