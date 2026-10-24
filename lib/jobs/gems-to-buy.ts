// lib/jobs/gems-to-buy.ts — ตรรกะฝั่งจอของ "พลอยที่ต้องสั่งซื้อ" (G1b UI · ux-gems-to-buy.md) · pure ไม่มี I/O
//  - แปลง GemPurchaseSummary → view ของจอ (orderedBy เหลือแค่ "me"/"other" — ไม่ส่ง uuid ผู้ใช้ไป client)
//  - แถวต่อแท็บ (ยังไม่สั่ง/สั่งแล้ว) · กรอง/เรียง/เร่งด่วน · scope ของ คัดลอก/ติ๊ก (เลือก ∩ ที่เห็น) · กติกา undo
//  - 🔴 ไฟล์นี้ไม่มีราคา/ต้นทุนเลย (ต้นทุนอยู่ใน useGemCost.ts ที่เดียว) · ไม่คิดเลขเงิน · import เฉพาะ type จาก gem-purchase.ts (โมดูลราคา — ห้ามลาก runtime เข้า bundle จอนี้)
//  - จำนวนที่แสดง = ค่าจาก DB ตรงๆ (qty_remaining / qty_ordered) ไม่หักลบ qty_excess กับ qty_remaining กัน

import { daysBetween } from "@/lib/jobs/dates";
import { normalizeGemName } from "@/lib/jobs/shop-gems";
import type { GemPurchaseGroup, GemPurchaseJob, GemPurchaseSummary } from "@/lib/jobs/gem-purchase";

/** ตรงกับ GEM_PURCHASE_MAX_LINES (RPC gem_purchase_mark) — ค่าซ้ำโดยตั้งใจเพื่อไม่ลาก gem-purchase.ts เข้า bundle · เทสต์ gems-to-buy.test.ts ล็อกว่าเท่ากัน */
export const GTB_MAX_LINES_PER_MARK = 200;
/** ครบกำหนดใน 3 วัน (ตรงกับ tile ของบอร์ด: วันนี้ ≤ due ≤ วันนี้+3) */
export const GTB_DUE_SOON_DAYS = 3;
export const GTB_UNIT_LABEL = "เม็ด";

export type GtbTab = "pending" | "ordered";
export type GtbSort = "urgent" | "type";
export type OrderedBy = "me" | "other" | null;

export type GtbJob = Omit<GemPurchaseJob, "orderedBy"> & { orderedBy: OrderedBy };
export type GtbGroup = Omit<GemPurchaseGroup, "jobs" | "lineIds"> & { jobs: GtbJob[] };
export type GemsToBuyView = Omit<GemPurchaseSummary, "groups"> & { groups: GtbGroup[] };

/** summary จาก action → view (ฝั่ง server) · เทียบ id ผู้ติ๊กกับ session ที่นี่ ไม่ส่ง uuid ไป client */
export function toGemsToBuyView(summary: GemPurchaseSummary, viewerId: string | null): GemsToBuyView {
  const who = (by: string | null): OrderedBy => (by === null ? null : viewerId !== null && by.toLowerCase() === viewerId.toLowerCase() ? "me" : "other");
  return {
    serverNow: summary.serverNow,
    todayBkk: summary.todayBkk,
    unspecifiedJobs: summary.unspecifiedJobs,
    removedAfterOrder: summary.removedAfterOrder,
    totals: summary.totals,
    groups: summary.groups.map((g) => ({
      canonicalItemId: g.canonicalItemId,
      typeId: g.typeId,
      typeName: g.typeName,
      shapeId: g.shapeId,
      shapeName: g.shapeName,
      sizeA: g.sizeA,
      sizeB: g.sizeB,
      sizeLabel: g.sizeLabel,
      label: g.label,
      qtyNeededNow: g.qtyNeededNow,
      qtyOrdered: g.qtyOrdered,
      qtyRemaining: g.qtyRemaining,
      qtyExcess: g.qtyExcess,
      jobCount: g.jobCount,
      earliestDue: g.earliestDue,
      earliestDueRemaining: g.earliestDueRemaining,
      jobs: g.jobs.map((j) => ({ ...j, orderedBy: who(j.orderedBy) })),
    })),
  };
}

/** "14:32" จาก server_now (ISO เวลาไทยที่ DB ส่งมา — ไม่ใช้นาฬิกา client) · รูปไม่ถูกต้อง = "" */
export function serverClock(serverNow: string): string {
  const m = /T(\d{2}:\d{2})/.exec(serverNow);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// แถวต่อแท็บ
// ---------------------------------------------------------------------------
export interface GtbRow {
  /** = canonicalItemId */
  key: string;
  group: GtbGroup;
  /** ใบที่เกี่ยวกับแท็บนี้: ยังไม่สั่ง = qtyRemaining > 0 · สั่งแล้ว = qtyOrdered > 0 */
  jobs: GtbJob[];
  /** ยังไม่สั่ง = qtyRemaining ของ DB (ส่วนที่จะสั่ง) · สั่งแล้ว = qtyOrdered ของ DB */
  qty: number;
  earliestDue: string | null;
  /** line ids ของ jobs ข้างบน (ส่งเข้า markGemPurchase) */
  lineIds: string[];
}

const minDue = (jobs: GtbJob[]): string | null => jobs.reduce<string | null>((m, j) => (j.dueDate !== null && (m === null || j.dueDate < m) ? j.dueDate : m), null);
const uniq = (xs: string[]): string[] => [...new Set(xs)];

export function rowsForTab(groups: GtbGroup[], tab: GtbTab): GtbRow[] {
  const out: GtbRow[] = [];
  for (const g of groups) {
    const jobs = g.jobs.filter((j) => (tab === "pending" ? j.qtyRemaining > 0 : j.qtyOrdered > 0));
    if (jobs.length === 0) continue;
    out.push({ key: g.canonicalItemId, group: g, jobs, qty: tab === "pending" ? g.qtyRemaining : g.qtyOrdered, earliestDue: minDue(jobs), lineIds: uniq(jobs.flatMap((j) => j.lineIds)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// เร่งด่วน (นับจาก today_bkk ที่ DB ส่งมา — ห้ามใช้นาฬิกา client)
// ---------------------------------------------------------------------------
export type Urgency = { kind: "overdue"; days: number } | { kind: "soon"; days: number } | { kind: "later" } | { kind: "nodate" };

export function urgencyOf(due: string | null, todayBkk: string): Urgency {
  if (due === null) return { kind: "nodate" };
  const n = daysBetween(todayBkk, due);
  if (n < 0) return { kind: "overdue", days: -n };
  if (n <= GTB_DUE_SOON_DAYS) return { kind: "soon", days: n };
  return { kind: "later" };
}
export const isUrgent = (u: Urgency): boolean => u.kind === "overdue" || u.kind === "soon";

// ---------------------------------------------------------------------------
// กรอง / เรียง
// ---------------------------------------------------------------------------
export interface GtbFilters {
  q: string;
  typeId: string;
  shapeId: string;
  urgent: boolean;
  sort: GtbSort;
}
export const GTB_EMPTY_FILTERS: GtbFilters = { q: "", typeId: "", shapeId: "", urgent: false, sort: "urgent" };

export const hasActiveFilter = (f: GtbFilters): boolean => f.q.trim() !== "" || f.typeId !== "" || f.shapeId !== "" || f.urgent;

function matchesBase(r: GtbRow, f: GtbFilters, nq: string): boolean {
  return (f.typeId === "" || r.group.typeId === f.typeId) && (f.shapeId === "" || r.group.shapeId === f.shapeId) && (nq === "" || normalizeGemName(r.group.label).includes(nq));
}

export function applyFilters(rows: GtbRow[], f: GtbFilters, todayBkk: string): GtbRow[] {
  const nq = normalizeGemName(f.q);
  return rows.filter((r) => matchesBase(r, f, nq) && (!f.urgent || isUrgent(urgencyOf(r.earliestDue, todayBkk))));
}

/** จำนวนแถวเร่งด่วนหลังกรองอื่น (ไม่รวมตัวกรอง "เร่งด่วน" เอง) */
export function countUrgent(rows: GtbRow[], f: GtbFilters, todayBkk: string): number {
  return applyFilters(rows, { ...f, urgent: false }, todayBkk).filter((r) => isUrgent(urgencyOf(r.earliestDue, todayBkk))).length;
}

const th = (a: string, b: string): number => a.localeCompare(b, "th");
const byName = (a: GtbRow, b: GtbRow): number => th(a.group.typeName, b.group.typeName) || th(a.group.shapeName, b.group.shapeName) || a.group.sizeA - b.group.sizeA || (a.group.sizeB ?? -1) - (b.group.sizeB ?? -1);

/** urgent: กำหนดเร็วสุดก่อน (เลยกำหนด → ใกล้ → ไกล) · ไม่ระบุกำหนดไปท้าย · เสมอกัน → ชนิด → รูปทรง → ขนาด */
export function sortRows(rows: GtbRow[], sort: GtbSort): GtbRow[] {
  const copy = [...rows];
  if (sort === "type") return copy.sort(byName);
  return copy.sort((a, b) => {
    if (a.earliestDue === b.earliestDue) return byName(a, b);
    if (a.earliestDue === null) return 1;
    if (b.earliestDue === null) return -1;
    return a.earliestDue < b.earliestDue ? -1 : 1;
  });
}

/** จำนวนใบไม่ซ้ำของแถวที่เห็น */
export const distinctJobCount = (rows: GtbRow[]): number => new Set(rows.flatMap((r) => r.jobs.map((j) => j.jobId))).size;

// ---------------------------------------------------------------------------
// URL state (?tab=ordered&q=&type=&shape=&sort=type&urgent=1) — ไม่เชื่อ query string: ตรวจรูปร่างทุกค่า
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseGtbParams(sp: Record<string, string | string[] | undefined>): { tab: GtbTab; filters: GtbFilters } {
  const type = first(sp.type) ?? "";
  const shape = first(sp.shape) ?? "";
  return {
    tab: first(sp.tab) === "ordered" ? "ordered" : "pending",
    filters: {
      q: (first(sp.q) ?? "").slice(0, 80),
      typeId: UUID_RE.test(type) ? type : "",
      shapeId: UUID_RE.test(shape) ? shape : "",
      urgent: first(sp.urgent) === "1",
      sort: first(sp.sort) === "type" ? "type" : "urgent",
    },
  };
}

/** ค่าเริ่ม (pending · ไม่มีตัวกรอง · เร่งด่วน) ไม่ต้องใส่ใน URL */
export function buildGtbQuery(tab: GtbTab, f: GtbFilters): string {
  const p = new URLSearchParams();
  if (tab === "ordered") p.set("tab", "ordered");
  if (f.q.trim() !== "") p.set("q", f.q.slice(0, 80));
  if (f.typeId !== "") p.set("type", f.typeId);
  if (f.shapeId !== "") p.set("shape", f.shapeId);
  if (f.sort === "type") p.set("sort", "type");
  if (f.urgent) p.set("urgent", "1");
  return p.toString();
}

// ---------------------------------------------------------------------------
// เลือก + scope ของ คัดลอก/ติ๊ก — คำสั่งทำกับ "ที่เลือก ∩ ที่เห็น" ถ้ามี ไม่งั้น "ทั้งหมดที่เห็นตามตัวกรอง"
// ---------------------------------------------------------------------------
export function visibleSelected(selected: ReadonlySet<string>, visible: GtbRow[]): GtbRow[] {
  return visible.filter((r) => selected.has(r.key));
}

export interface GtbScope {
  rows: GtbRow[];
  kind: "selected" | "filtered" | "all";
  /** จำนวนแถวทั้งหมดของแท็บ (ก่อนกรอง) */
  total: number;
}

export function resolveScope(visible: GtbRow[], selected: ReadonlySet<string>, total: number, filtered: boolean): GtbScope {
  const sel = visibleSelected(selected, visible);
  if (sel.length > 0) return { rows: sel, kind: "selected", total };
  return { rows: visible, kind: filtered ? "filtered" : "all", total };
}

/** ตัวเลขใน "ปุ่ม" บอกขอบเขตเสมอ — กันส่งรายการขาดโดยไม่รู้ตัว */
export function copyButtonLabel(s: GtbScope): string {
  if (s.kind === "selected") return `คัดลอกที่เลือก (${s.rows.length})`;
  if (s.kind === "filtered") return `คัดลอกตามตัวกรอง (${s.rows.length} จาก ${s.total})`;
  return `คัดลอกไปส่งร้านพลอย (${s.rows.length})`;
}

export function lineIdsOfRows(rows: GtbRow[]): string[] {
  return uniq(rows.flatMap((r) => r.lineIds));
}

// ---------------------------------------------------------------------------
// ติ๊ก / undo
// ---------------------------------------------------------------------------
export interface LineMeta {
  isOrdered: boolean;
  changedAfterOrder: boolean;
  qtyExcess: number;
}

export function lineMeta(groups: GtbGroup[]): Map<string, LineMeta> {
  const m = new Map<string, LineMeta>();
  for (const g of groups) for (const j of g.jobs) for (const id of j.lineIds) m.set(id, { isOrdered: j.isOrdered, changedAfterOrder: j.changedAfterOrder, qtyExcess: j.qtyExcess });
  return m;
}

/**
 * ย้อนกลับด้วยคำสั่งตรงข้ามได้เฉพาะแถวที่ "สะอาด":
 *  - ติ๊กสั่งแล้ว: ทุกแถวต้องยังไม่เคยติ๊ก (ติ๊กซ้ำ = ปรับยอดสั่งขึ้นเป็นยอดปัจจุบัน → ยกเลิกแล้วจะได้ 0 ไม่ใช่ยอดเดิม → สั่งซ้ำได้)
 *  - ยกเลิกติ๊ก: ทุกแถวต้องไม่ใช่ "ยอดเปลี่ยนหลังสั่ง"/"สั่งเกิน" (ติ๊กใหม่จะได้ยอดปัจจุบัน ไม่ใช่ยอดตอนสั่งเดิม)
 * ไม่สะอาด = ไม่เสนอปุ่มย้อนกลับ (ทางสำรองคือแท็บฝั่งตรงข้าม)
 */
export function canUndoMark(lineIds: string[], ordered: boolean, meta: ReadonlyMap<string, LineMeta>): boolean {
  if (lineIds.length === 0) return false;
  return lineIds.every((id) => {
    const m = meta.get(id);
    if (!m) return false;
    return ordered ? !m.isOrdered : !m.changedAfterOrder && m.qtyExcess === 0;
  });
}

/** ติ๊กชนกับคนอื่น/ใบปิด/ขั้นฝังรับแล้ว (all-or-nothing ล้ม) → แจ้ง + โหลดใหม่ */
const CHANGED_CODES: ReadonlySet<string> = new Set(["job_closed", "gem_stage_started", "purchase_line_not_found"]);
export const MARK_CHANGED_MESSAGE = "มีรายการที่เปลี่ยนไป — โหลดข้อมูลใหม่แล้ว ไม่ได้ทำเครื่องหมายรายการใดเลย ลองอีกครั้ง";
export const MARK_FAILED_MESSAGE = "บันทึกไม่สำเร็จ ลองอีกครั้ง";
export const MARK_TOO_MANY_GROUP_MESSAGE = `รายการนี้มีเกิน ${GTB_MAX_LINES_PER_MARK} แถว — ติ๊กทีละใบ (กด ▾ ดูใบ แล้วกด สั่งแล้ว ที่แต่ละใบ)`;
export const MARK_TOO_MANY_BULK_MESSAGE = `เลือกรวมกันเกิน ${GTB_MAX_LINES_PER_MARK} แถว — ลดจำนวนที่เลือก หรือติ๊กทีละรายการ`;

export function markFailureMessage(code: string | undefined): string {
  return code !== undefined && CHANGED_CODES.has(code) ? MARK_CHANGED_MESSAGE : MARK_FAILED_MESSAGE;
}
