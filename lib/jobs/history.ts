// lib/jobs/history.ts — ประวัติงาน (/jobs/history): ใบงานแม่ที่ปิดแล้ว/ยกเลิก (pure · ไม่แตะ DB)
// 🔴 ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/source_ref — HISTORY_COLUMNS เป็น whitelist ที่เดียว (ห้ามเพิ่มคอลัมน์เงิน/ลูกค้า)
// ใบแม่ที่แบ่งส่วน/ได้รับเพิ่ม: ยอดดี/เสียต้องเป็นของ "ทั้งต้นไม้" (v_job_tree_summary) — applyTreeTotals ทับยอดของใบแม่ล้วน

import { bkkDateOf, thaiMonthYear } from "@/lib/jobs/dates";
import { JOB_METALS } from "@/lib/jobs/source";

export const HISTORY_COLUMNS =
  "id, job_no, seq, source_kind, design_label, sku_snapshot, metal, qty_order, qty_planned, qty_good, qty_scrap, status, done_at, cancelled_at, cancel_reason, surplus_disposition, updated_at";

/** สรุปทั้งต้นไม้ของใบแม่ (v_job_tree_summary) — เฉพาะ 2 คอลัมน์ที่ใช้ */
export const HISTORY_TREE_COLUMNS = "root_job_id, qty_done_good, qty_scrap_total";

export const HISTORY_LIMIT = 500;
export const HISTORY_PAGE = 25;

export type HistoryStatus = "done" | "cancelled";

export interface HistoryRow {
  id: string;
  jobNo: string;
  seq: number | null;
  sourceKind: string;
  designLabel: string;
  sku: string | null;
  metal: string;
  qtyOrder: number;
  qtyPlanned: number;
  qtyGood: number | null;
  qtyScrap: number | null;
  status: HistoryStatus;
  /** done_at ?? cancelled_at (ISO) — null = ไม่มีเวลาปิด (ไม่เดา) */
  closedAt: string | null;
  cancelReason: string | null;
  surplusDisposition: string | null;
  updatedAt: string | null;
}

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** แถวจาก `job` → HistoryRow · ไม่ใช่ done/cancelled หรือไม่มี id/เลขใบ = ทิ้ง (null) */
export function mapHistoryRow(r: Record<string, unknown>): HistoryRow | null {
  const id = str(r.id, 64);
  const jobNo = str(r.job_no, 40);
  const status = r.status === "done" || r.status === "cancelled" ? r.status : null;
  if (!id || !jobNo || !status) return null;
  const planned = num(r.qty_planned) ?? 0;
  return {
    id,
    jobNo,
    seq: num(r.seq),
    sourceKind: str(r.source_kind, 40) ?? "",
    designLabel: str(r.design_label, 200) ?? "",
    sku: str(r.sku_snapshot, 80),
    metal: str(r.metal, 20) ?? "",
    qtyOrder: num(r.qty_order) ?? planned,
    qtyPlanned: planned,
    qtyGood: num(r.qty_good),
    qtyScrap: num(r.qty_scrap),
    status,
    closedAt: str(r.done_at, 40) ?? str(r.cancelled_at, 40),
    cancelReason: str(r.cancel_reason, 300),
    surplusDisposition: str(r.surplus_disposition, 20),
    updatedAt: str(r.updated_at, 40),
  };
}

/** ใบแม่ที่ปิดแล้ว: ดี/เสีย = ของทั้งต้นไม้ (จาก v_job_tree_summary) · ใบที่ยกเลิก/ไม่มีสรุป = คงยอดของใบเอง */
export function applyTreeTotals(row: HistoryRow, tree: Record<string, unknown> | undefined): HistoryRow {
  if (!tree || row.status !== "done") return row;
  const good = num(tree.qty_done_good);
  const scrap = num(tree.qty_scrap_total);
  return { ...row, qtyGood: good ?? row.qtyGood, qtyScrap: scrap ?? row.qtyScrap };
}

/** ชั้นกลาง: ใบที่ปิดแล้วและดี > สั่ง แต่ยังไม่ตัดสินของเหลือ (disposition 'hold') — ตรงกับ surplus_pending ของบอร์ด แต่ใช้ยอดทั้งต้นไม้ */
export function isSurplusPending(r: Pick<HistoryRow, "status" | "qtyGood" | "qtyOrder" | "surplusDisposition">): boolean {
  return r.status === "done" && r.qtyGood !== null && r.qtyGood > r.qtyOrder && r.surplusDisposition === "hold";
}

/** ชิ้นที่เหลือเกินสั่ง (ไว้แสดง "เหลือ n ชิ้น ยังไม่ตัดสิน") · ไม่เกิน = 0 */
export const surplusQty = (r: Pick<HistoryRow, "qtyGood" | "qtyOrder">): number => (r.qtyGood !== null && r.qtyGood > r.qtyOrder ? r.qtyGood - r.qtyOrder : 0);

/** วันที่ปิดตามเวลาไทย (YYYY-MM-DD) — null = ไม่มีเวลาปิด/อ่านไม่ได้ */
export const closedDateOf = (r: Pick<HistoryRow, "closedAt">): string | null => (r.closedAt ? bkkDateOf(r.closedAt) : null);
/** เดือนที่ปิดตามเวลาไทย "YYYY-MM" */
export const closedMonthOf = (r: Pick<HistoryRow, "closedAt">): string | null => closedDateOf(r)?.slice(0, 7) ?? null;

// ---------------------------------------------------------------------------
// ค้นหา: เลขใบ / ชื่อแบบ / SKU · ไม่สนตัวพิมพ์ ขีด ช่องว่าง · ตัวเลข 1-4 หลัก (มี/ไม่มี JB นำ) = ตรงเลขที่ใบ (seq) เท่านั้น
// ---------------------------------------------------------------------------
const norm = (s: string): string => s.toLowerCase().replace(/[\s\-_·.]+/g, "");
const SEQ_RE = /^(jb-?)?\d{1,4}$/i;

export function matchesSearch(r: Pick<HistoryRow, "jobNo" | "seq" | "designLabel" | "sku">, q: string): boolean {
  const t = q.trim();
  if (norm(t) === "") return true;
  const compact = t.replace(/\s+/g, "");
  if (SEQ_RE.test(compact)) {
    const digits = Number(compact.replace(/^jb-?/i, ""));
    return r.seq !== null && r.seq === digits;
  }
  return norm(`${r.jobNo} ${r.designLabel} ${r.sku ?? ""}`).includes(norm(t));
}

// ---------------------------------------------------------------------------
// ตัวกรอง (อยู่ใน URL)
// ---------------------------------------------------------------------------
export type StatusFilter = "all" | "done" | "cancelled";
export interface HistoryFilters {
  q: string;
  status: StatusFilter;
  /** "YYYY-MM" (เดือนที่ปิด) หรือ "" = ทุกเดือน */
  month: string;
  /** รหัสโลหะ หรือ "" */
  metal: string;
  /** oem | production หรือ "" */
  source: string;
}

export const EMPTY_FILTERS: HistoryFilters = { q: "", status: "all", month: "", metal: "", source: "" };
export const SOURCE_FILTERS = ["oem", "production"] as const;

export const isFiltered = (f: HistoryFilters): boolean => f.q.trim() !== "" || f.status !== "all" || f.month !== "" || f.metal !== "" || f.source !== "";

/** อ่านตัวกรองจาก URL — ค่านอก whitelist = ค่าว่าง (ไม่เชื่อ query string) */
export function parseHistoryFilters(get: (k: string) => string | null | undefined): HistoryFilters {
  const q = (get("q") ?? "").slice(0, 80);
  const s = get("s");
  const m = get("m") ?? "";
  const metal = get("metal") ?? "";
  const src = get("src") ?? "";
  return {
    q,
    status: s === "done" || s === "cancelled" ? s : "all",
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : "",
    metal: (JOB_METALS as readonly string[]).includes(metal) ? metal : "",
    source: (SOURCE_FILTERS as readonly string[]).includes(src) ? src : "",
  };
}

/** ตัวกรอง → query string (ไม่ใส่ค่าเริ่มต้น) */
export function historyQuery(f: HistoryFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim() !== "") p.set("q", f.q.trim());
  if (f.status !== "all") p.set("s", f.status);
  if (f.month !== "") p.set("m", f.month);
  if (f.metal !== "") p.set("metal", f.metal);
  if (f.source !== "") p.set("src", f.source);
  return p.toString();
}

export function applyHistoryFilters(rows: readonly HistoryRow[], f: HistoryFilters): HistoryRow[] {
  return rows.filter((r) => {
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.month !== "" && closedMonthOf(r) !== f.month) return false;
    if (f.metal !== "" && r.metal !== f.metal) return false;
    if (f.source !== "" && r.sourceKind !== f.source) return false;
    return matchesSearch(r, f.q);
  });
}

/** เดือนที่มีใบปิด (ใหม่ → เก่า) — ไม่มีเวลาปิดไม่นับ */
export function monthOptions(rows: readonly HistoryRow[]): { value: string; label: string }[] {
  const set = new Set<string>();
  for (const r of rows) {
    const m = closedMonthOf(r);
    if (m) set.add(m);
  }
  return [...set].sort().reverse().map((value) => ({ value, label: thaiMonthYear(value) }));
}
