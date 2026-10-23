// lib/jobs/shop-gem-flow.ts — ตรรกะ pure ของ "พลอยบนมือถือผู้จัดการ" (W3 UI: W-4 · แถวพลอยในหน้าทวน · W-9 · W-10) — /w/s/<shopToken>
//
// 🔴 อยู่ในกราฟหน้าช่าง (สาธารณะ): ห้าม import lib/oem · lib/production · lib/catalog · lib/jobs/gems.ts (ตัวแปลงราคา/แคตตาล็อกออฟฟิศ) แบบ runtime — type-only ได้ (worker-boundary.shop.test + gems-boundary.test)
// 🔴 ไม่มีตัวเลขเงิน/ราคา/ต้นทุน/เผื่อแตกในไฟล์นี้เลย — จำนวนเต็ม × จำนวนเต็มเท่านั้น (ไม่มีปัดเศษ · DB คำนวณซ้ำและค่า DB ชนะ)
// ตัวตัดสินจริงคือ DB (RPC job_worker_open / job_worker_gem_set) — ไฟล์นี้แค่: ถือคำตอบ "ฝังพลอยไหม" + แถวที่กำลังกรอก · ตรวจก่อนส่ง · ประกอบ payload · แปลผลล้มกลับเป็น "แถว/ช่องไหน"

import type { IntakeGemsInput } from "@/lib/actions/job-worker";
import type { GemOptions } from "@/lib/jobs/gems";
import type { GemForceItem } from "@/lib/jobs/gem-wire";
import type { GemSimilar, GemState, IntakeGemLine, IntakeGemSummary } from "@/lib/jobs/worker-server";
import { draftRowsToInputs, draftTotals, emptyGemRow, findDuplicateRows, gemRowIssues, parseGemQty, rowIncompleteReason, rowLabelPreview } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { GEM_LIMITS, gemSizeLabel, normalizeGemName } from "@/lib/jobs/shop-gems";

// ============================================================================
// ข้อความ (ไทย — ไม่มีรหัสดิบ/ชื่อตาราง/ตัวเลขเงิน)
// ============================================================================

export const SHOP_GEM_TH = {
  title: "พลอย",
  question: "ชิ้นนี้ฝังพลอยไหม?",
  has: "มีพลอย",
  none: "ไม่มีพลอย",
  hintHas: "ถ้า “มีพลอย” ใบงานจะมีขั้นฝังพลอย",
  hintNone: "ถ้า “ไม่มี” ไม่มีขั้นฝังพลอย",
  needAnswer: "เลือกก่อนว่าฝังพลอยไหม",
  needRows: "เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก “ไม่มีพลอย”",
  tooMany: `พลอยต่อใบมีได้ไม่เกิน ${GEM_LIMITS.linesMax} รายการ`,
  summaryNone: "ไม่มีพลอย — ใบนี้ไม่มีขั้นฝังพลอย",
  change: "เปลี่ยน",
  catalogError: "โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้",
  retry: "ลองอีกครั้ง",
  loadingCatalog: "กำลังโหลดรายการพลอย",
  /** ใบถูกเปิดโดย session หมดเวลา — ผู้ใช้ใส่ PIN แล้วกลับมาที่จอเดิม */
  sessionLost: "หมดเวลาแล้ว — ใส่ PIN ใหม่ แล้วกดอีกครั้ง",
  reviewNewNames: "ชื่อใหม่จะเข้ารายการพลอยของร้านเมื่อเปิดงาน",
  reviewNone: "ไม่มี",
  addRow: "เพิ่มพลอย",
  rowDone: "เสร็จแถวนี้",
  removeRow: "ลบ",
  edit: "แก้",
  fromTemplate: "จากแม่แบบ",
  edited: "แก้แล้ว",
  isNew: "ใหม่",
  onlyThisJob: "เฉพาะใบนี้",
  // W-10
  editTitle: (jobNo: string) => `แก้ ${jobNo}`,
  w10EditableBar: "แก้ได้จนช่างเริ่มรับงาน",
  w10EmptyEditable: "ใบนี้ไม่มีพลอย — เพิ่มได้จนช่างเริ่มรับงาน",
  w10EmptyLocked: "ใบนี้ไม่มีพลอย",
  w10Unspecified: "ยังไม่ระบุพลอย",
  w10LoadError: "โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง",
  w10Edit: "แก้พลอย",
  w10Add: "เพิ่มพลอย",
  w10Save: "บันทึกพลอย",
  w10Saving: "กำลังบันทึกพลอย…",
  w10Saved: "บันทึกพลอยแล้ว",
  w10Cancel: "ยกเลิก",
  w10DiscardTitle: "ทิ้งการแก้พลอย?",
  w10DiscardBody: "ที่แก้ไว้ยังไม่ถูกบันทึก",
  w10Discard: "ทิ้งที่แก้",
  w10KeepEditing: "กลับไปแก้ต่อ",
  /** เหลือ 0 แถวตอนบันทึก — ขั้นฝังพลอยยังอยู่ (ลบขั้นต้องออฟฟิศ) */
  zeroWarnTitle: "บันทึกโดยไม่มีพลอย?",
  zeroWarnBody: "ขั้นฝังพลอยยังอยู่ ใบจะขึ้นเตือนยังไม่ระบุพลอยจนออฟฟิศถอดขั้น",
  zeroWarnSave: "บันทึกอยู่ดี",
  zeroWarnBack: "กลับไปแก้",
  conflict: "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดใหม่แล้วแก้อีกครั้ง",
  conflictReload: "โหลดพลอยใหม่",
  lockedClosed: "ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้",
  lockedStarted: "ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ",
  lockedNotOpen: "ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ",
  /** ใบไม่มีขั้นฝังพลอย: ผู้จัดการเพิ่มขั้นเองไม่ได้ */
  noGemStage: "ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศเพิ่มขั้นฝังพลอย",
  notOwner: "แก้พลอยได้เฉพาะคนที่เปิดใบนี้",
  rowOpenAria: (n: number) => `แถว ${n}`,
  clearConfirmTitle: "ล้างพลอยออกจากใบนี้?",
  clearConfirm: (n: number) => `ล้างพลอย ${n} รายการออกจากใบนี้? (เฉพาะใบนี้ แม่แบบ SKU ไม่เปลี่ยน)`,
  clearYes: "ล้างออก",
  clearNo: "ไม่ล้าง",
} as const;

/** แถว n ยังไม่ครบ — เหตุผล (aria-disabled) */
export const rowIncompleteMessage = (n: number, reason: string): string => `แถว ${n} ยังไม่ครบ — ${reason}`;
export const dupMessage = (n: number, other: number): string => `แถว ${n}: มีพลอยแบบเดียวกันอยู่แล้วที่แถว ${other} — กด “รวมเข้าแถว ${other}” หรือแก้ให้ต่างกัน`;

// ============================================================================
// สถานะพลอยของฟอร์มเปิดใบ
// ============================================================================

export type GemAnswer = "unset" | "has" | "none";

export interface ShopGemState {
  /** unset = ยังไม่ตอบ (ไม่มีค่าเริ่มเมื่อ SKU ไม่มีแม่แบบ — P8) · has = มีพลอย · none = ไม่มีพลอย */
  answer: GemAnswer;
  rows: GemDraftRow[];
  /** แถวชุดนี้เริ่มจากแม่แบบของ SKU นี้ (count = จำนวนแถวของแม่แบบ) — ใช้ตัดสินว่าส่ง "template" ได้ไหม (ไม่แก้อะไรเลย) */
  seed: { productId: string; count: number } | null;
  /** ชื่อที่ผู้ใช้ยืนยัน "เพิ่มใหม่จริงๆ" หลัง DB ถามว่าคล้าย (เฉพาะชื่อที่ DB ถามในคำขอที่ล้ม · ล้างเมื่อแก้แถว) */
  force: GemForceItem[];
}

export const emptyShopGems = (): ShopGemState => ({ answer: "unset", rows: [], seed: null, force: [] });

/** แถวจากพลอยของแม่แบบ SKU / พลอยที่บันทึกในใบ — คงเป็น "รายการเดิม" (gemItemId + ฉลากจาก DB) จนกว่าผู้ใช้กด "เปลี่ยนรายการ" */
export function rowFromIntakeLine(l: IntakeGemLine, origin: "template" | "saved"): GemDraftRow {
  return { ...emptyGemRow(origin), itemId: l.gemItemId, canonicalId: l.gemItemId, label: l.label, qty: String(l.qtyPerPiece), position: l.position ?? "" };
}

/** ตอบ "มีพลอย" พร้อมแถวจากแม่แบบของ SKU (ป้าย "จากแม่แบบ") */
export function seedFromTemplate(productId: string, template: readonly IntakeGemLine[]): ShopGemState {
  return { answer: "has", rows: template.map((l) => rowFromIntakeLine(l, "template")), seed: { productId, count: template.length }, force: [] };
}

/** ชุดตัวเลือกให้ GemPicker/ตัวตรวจแถวซ้ำ — types/shapes จากแคตตาล็อก · items จากแถวที่รู้ id (แม่แบบ/พลอยของใบ) */
export function gemOptionsOf(
  types: readonly { id: string; name: string }[],
  shapes: readonly { id: string; name: string; hasLength: boolean }[],
  lines: readonly IntakeGemLine[],
): GemOptions {
  return {
    types: types.map((t) => ({ id: t.id, name: t.name })),
    shapes: shapes.map((s) => ({ id: s.id, name: s.name, hasLength: s.hasLength })),
    items: lines.flatMap((l) =>
      l.typeId && l.shapeId && l.sizeA !== null ? [{ gemItemId: l.gemItemId, typeId: l.typeId, shapeId: l.shapeId, sizeA: l.sizeA, sizeB: l.sizeB, sizeLabel: gemSizeLabel(l.sizeA, l.sizeB) }] : [],
    ),
  };
}

/**
 * force ที่ยังใช้ได้: เฉพาะชื่อที่ผู้ใช้ยืนยันและ "ยังเป็นชื่อใหม่ในแถวอยู่" (เทียบหลัง normalize) — ชื่อที่ถูกแก้/ลบแถวทิ้งแล้วไม่พกค้างไปคำขอถัดไป
 * (DB จับคู่ force กับชื่อที่ถูกถามจริงในคำขอนั้นอยู่แล้ว — นี่คือกันพกค่าเก่าอีกชั้น)
 */
export function pruneForce(force: readonly GemForceItem[], rows: readonly GemDraftRow[]): GemForceItem[] {
  return force.filter((f) =>
    rows.some((r) => {
      const v = f.kind === "type" ? r.type : r.shape;
      return v !== null && v.kind === "new" && normalizeGemName(v.name) === normalizeGemName(f.name);
    }),
  );
}

/** เพิ่ม force ของชื่อที่ผู้ใช้ยืนยัน (ไม่ซ้ำ — เทียบ kind + ชื่อหลัง normalize) */
export function addForce(force: readonly GemForceItem[], item: GemForceItem): GemForceItem[] {
  const n = normalizeGemName(item.name);
  return force.some((f) => f.kind === item.kind && normalizeGemName(f.name) === n) ? [...force] : [...force, { kind: item.kind, name: item.name }];
}

/** ยังเป็นแม่แบบของ SKU นี้เป๊ะ (ไม่ลบ/ไม่แก้/ไม่เพิ่มแถว) → ส่ง "template" ให้ DB คัดลอกเอง */
export function isTemplateUntouched(s: ShopGemState, productId: string | null): boolean {
  return (
    s.answer === "has" &&
    s.seed !== null &&
    productId !== null &&
    s.seed.productId === productId &&
    s.seed.count > 0 &&
    s.rows.length === s.seed.count &&
    s.rows.every((r) => r.origin === "template" && !r.edited && r.itemId !== null)
  );
}

/**
 * พลอยของฟอร์ม → payload ของ intakeOpen (บังคับ — S3)
 * 🔴 ยังไม่ตอบ (unset) ห้ามเดา "ไม่มีพลอย": ส่งรูปที่ action ปฏิเสธเสมอ (has + ไม่มีแถว) — ด่านจริงคือ shopOpenIssues ที่กันก่อนถึงตรงนี้
 */
export function gemsInputOf(s: ShopGemState, productId: string | null): IntakeGemsInput {
  if (s.answer === "none") return { answer: "none" };
  if (s.answer === "has") {
    if (isTemplateUntouched(s, productId)) return { answer: "template" };
    return { answer: "has", lines: draftRowsToInputs(s.rows), ...(s.force.length > 0 ? { force: s.force } : {}) };
  }
  return { answer: "has", lines: [] };
}

// ============================================================================
// ตรวจก่อนไปขั้นถัดไป / ก่อนเปิดงาน
// ============================================================================

export interface GemIssue {
  message: string;
  /** แถวที่ต้องพาไป (null = ปัญหาระดับทั้งขั้น) */
  rowKey: string | null;
}

/** ปัญหาที่ทำให้ไปต่อไม่ได้ (null = ไปต่อได้) · options (ถ้ามี) ช่วยจับแถวซ้ำระหว่าง "รายการเดิม" กับแถวที่เลือกชนิด/รูปทรง/ขนาดเดียวกัน */
export function gemStepIssue(s: Pick<ShopGemState, "answer" | "rows">, options?: GemOptions | null): GemIssue | null {
  if (s.answer === "unset") return { message: SHOP_GEM_TH.needAnswer, rowKey: null };
  if (s.answer === "none") return null;
  if (s.rows.length === 0) return { message: SHOP_GEM_TH.needRows, rowKey: null };
  if (s.rows.length > GEM_LIMITS.linesMax) return { message: SHOP_GEM_TH.tooMany, rowKey: null };
  const bad = s.rows.findIndex((r) => gemRowIssues(r).length > 0);
  if (bad >= 0) return { message: rowIncompleteMessage(bad + 1, rowIncompleteReason(s.rows[bad]) ?? ""), rowKey: s.rows[bad].key };
  const dup = [...findDuplicateRows(s.rows, options)][0];
  if (dup) return { message: dupMessage(dup[0] + 1, dup[1] + 1), rowKey: s.rows[dup[0]].key };
  return null;
}

// ============================================================================
// สรุปสำหรับหน้าทวน (W-6/7) — จำนวนเต็ม × จำนวนเต็ม (ไม่มีปัดเศษ · DB คำนวณซ้ำ)
// ============================================================================

export interface GemReviewLine {
  key: string;
  label: string;
  perPiece: number;
  total: number | null;
}
export interface GemReviewView {
  state: GemAnswer;
  count: number;
  /** รวมเม็ดทั้งใบ (null = ยังไม่รู้จำนวนที่จะผลิต) */
  total: number | null;
  lines: GemReviewLine[];
  /** มีชนิด/รูปทรงที่พิมพ์ใหม่ — ยังไม่เข้าแคตตาล็อกจนกดเปิดงาน */
  hasNewNames: boolean;
}

export function gemReviewOf(s: Pick<ShopGemState, "answer" | "rows">, qtyPlanned: number | null): GemReviewView {
  if (s.answer !== "has") return { state: s.answer, count: 0, total: null, lines: [], hasNewNames: false };
  const t = draftTotals(s.rows, qtyPlanned);
  return {
    state: "has",
    count: s.rows.length,
    total: t.total,
    lines: s.rows.map((r, i) => ({ key: r.key, label: rowLabelPreview(r) ?? "พลอย (ยังไม่ครบ)", perPiece: parseGemQty(r.qty) ?? 0, total: t.lineTotals[i] })),
    hasNewNames: s.rows.some((r) => r.type?.kind === "new" || r.shape?.kind === "new"),
  };
}

/** "ชื่อ · 2/ชิ้น → 70" */
export const gemLineText = (l: { perPiece: number; total: number | null }): string => `${l.perPiece.toLocaleString("en-US")}/ชิ้น${l.total !== null ? ` → ${l.total.toLocaleString("en-US")}` : ""}`;

// ============================================================================
// ผลล้มของ action → แถว/ช่องที่ผิด
// ============================================================================

/** รูปเดียวกับ IntakeActionFail (เฉพาะส่วนที่ใช้) — ไม่ import type ของ action ซ้ำเพื่อให้ทดสอบ pure ได้ง่าย */
export interface IntakeGemFailLike {
  error: string;
  code?: string;
  field?: string;
  gem?: { code: string; row?: number; field?: string };
  similar?: GemSimilar[];
}

export type GemRowErrors = Record<string, { field: string | null; message: string }>;

export interface GemFailView {
  rowErrors: GemRowErrors;
  generalError: string | null;
  /** ชื่อที่ DB ถามว่าคล้ายของเดิม (ยังไม่เขียนอะไร) */
  similar: GemSimilar | null;
  focusRowKey: string | null;
  focusField: string | null;
}

/** "พลอยแถว 2: …" → "…" (หัวแถวจอแสดงเอง — กันขึ้นซ้ำสองชั้น) */
export const stripRowPrefix = (message: string): string => message.replace(/^พลอยแถว\s*\d+\s*[:：]\s*/, "");

export function interpretIntakeGemFail(r: IntakeGemFailLike, rows: readonly GemDraftRow[]): GemFailView {
  const none: GemFailView = { rowErrors: {}, generalError: null, similar: null, focusRowKey: null, focusField: null };
  if (r.similar && r.similar.length > 0) return { ...none, similar: r.similar[0] };
  const row = r.gem?.row;
  if (typeof row === "number" && Number.isInteger(row) && row >= 1 && row <= rows.length) {
    const key = rows[row - 1].key;
    const field = r.gem?.field ?? null;
    return { ...none, rowErrors: { [key]: { field, message: stripRowPrefix(r.error) } }, focusRowKey: key, focusField: field };
  }
  return { ...none, generalError: r.error };
}

/** id ของช่องในแถว (focus จากผล error) — field ของ DB: type · shape · size_a · size_b · qty_per_piece · position · อื่นๆ = ช่องแรกของแถว */
export function gemFieldDomId(idPrefix: string, rowKey: string, field: string | null): string {
  const base = `${idPrefix}-${rowKey}`;
  switch (field) {
    case "type":
      return `${base}-type-btn`;
    case "shape":
      return `${base}-shape-btn`;
    case "size_a":
    case "size":
      return `${base}-size-a`;
    case "size_b":
      return `${base}-size-b`;
    case "qty_per_piece":
      return `${base}-qty`;
    case "position":
      return `${base}-pos`;
    default:
      return `${base}-qty`;
  }
}

// ============================================================================
// สรุปผลจาก DB หลังเปิดใบ (W-8) / หลังบันทึกพลอย (W-10)
// ============================================================================

/**
 * ข้อความแจ้งผลที่ระบบทำให้ (ไม่เงียบ): ชื่อที่ "ใช้ตัวเดิมให้" · แถวซ้ำที่ถูกรวม · ชื่อใหม่ที่เข้าแคตตาล็อก — จากสรุปของ DB เท่านั้น
 */
export function gemSummaryNotices(g: Pick<IntakeGemSummary, "createdTypes" | "createdShapes" | "reused" | "mergedRows">): string[] {
  const out: string[] = [];
  for (const x of g.reused) out.push(`${x.kind === "type" ? "ชนิด" : "รูปทรง"} “${x.typed}” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “${x.name}” ให้`);
  const groups = g.mergedRows.filter((m) => m.length >= 2);
  if (groups.length > 0) {
    const n = groups.reduce((s, m) => s + m.length - 1, 0);
    out.push(`รวมแถวซ้ำ ${n} แถว (${groups.map((m) => `แถว ${m.join(", ")}`).join(" · ")}) — จำนวนต่อชิ้นถูกบวกกันให้แล้ว`);
  }
  const created = [...g.createdTypes, ...g.createdShapes];
  if (created.length > 0) out.push(`เพิ่มเข้ารายการพลอยของร้านแล้ว: ${created.join(" · ")}`);
  return out;
}

// ============================================================================
// W-9 / W-10
// ============================================================================

/** บรรทัดพลอยในการ์ด "ใบที่ฉันเปิด" (ค่าจาก DB ไม่คำนวณใน UI) — null = ไม่แสดง (DB รุ่นก่อน 0191) */
export function myJobGemLine(j: { gemState: GemState | null; gemCount: number; gemPieces: number }): { text: string; warn: boolean } | null {
  if (j.gemState === "specified") return { text: `พลอย ${j.gemCount.toLocaleString("en-US")} รายการ · รวม ${j.gemPieces.toLocaleString("en-US")} เม็ด`, warn: false };
  if (j.gemState === "not_needed") return { text: SHOP_GEM_TH.none, warn: false };
  if (j.gemState === "unspecified") return { text: SHOP_GEM_TH.w10Unspecified, warn: true };
  return null;
}

/** ข้อความล็อกของ W-10 จาก lockCode ที่ DB ส่งมา (หรือไม่มีขั้นฝัง) — null = แก้ได้ */
export function gemLockMessage(lockCode: string | null, hasGemStage: boolean): string | null {
  switch (lockCode) {
    case "job_locked":
      return SHOP_GEM_TH.lockedStarted;
    case "job_cancelled":
    case "job_closed":
      return SHOP_GEM_TH.lockedClosed;
    case "job_not_open":
      return SHOP_GEM_TH.lockedNotOpen;
    case "no_gem_stage":
      return SHOP_GEM_TH.noGemStage;
    default:
      return hasGemStage ? null : SHOP_GEM_TH.noGemStage;
  }
}

/** code ล้มของ intakeSetJobGems ที่แปลว่า "ถูกล็อกแล้ว" (ปิดแผ่นแก้ + แสดงข้อความล็อก) */
export const GEM_LOCK_CODES: ReadonlySet<string> = new Set(["job_locked", "job_cancelled", "job_closed", "job_not_open", "no_gem_stage"]);

/** ต้องโหลดพลอยของใบใหม่ (ถูกแก้จากอีกเครื่อง/rev ไม่ตรง) */
export const isGemConflict = (code: string | undefined): boolean => code === "gem_conflict" || code === "gem_rev_invalid";
