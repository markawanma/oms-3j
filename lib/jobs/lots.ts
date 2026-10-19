// lib/jobs/lots.ts — ส่วนย่อยของใบงาน (L1 · 0181): ชนิดข้อมูล + mapper + ตัวช่วยแสดงผล (pure · ไม่แตะ DB)
// ตัวเลขทุกตัวมาจาก v_job_tree / v_job_tree_summary / job_discrepancy ที่ DB คำนวณ — ที่นี่จัดกลุ่ม/ตั้งป้ายเท่านั้น (ไม่หาผลรวมเอง)
//  · "รวม N ครบ" ยึด sum_check ของ DB — ไม่ใช่ผลบวกที่หน้าจอคิดเอง
//  · ไม่มีราคา/ต้นทุน/ชื่อลูกค้าในชนิดข้อมูลนี้ (view ออกแบบไว้ไม่มี) · ไม่มีชื่อผู้เปิดใบ

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const int0 = (v: unknown): number => num(v) ?? 0;
const bool = (v: unknown): boolean => v === true;

// ---------------------------------------------------------------------------
// คอลัมน์ที่อ่าน (ชื่อตรงกับ 0181 §7)
// ---------------------------------------------------------------------------
export const TREE_COLUMNS =
  "job_id, root_job_id, parent_job_id, lot_seq, label, status, qty_planned, qty_live, qty_stage_scrap, qty_split_out, qty_discrepancy_open, qty_discrepancy_resolved, cancel_scrap_qty, qty_good, qty_scrap_final, stage_code, stage_name, stage_status, holder_name, days_in_stage, qty_qc_passed";
export const TREE_SUMMARY_COLUMNS =
  "root_job_id, job_no, qty_planned, qty_order, parts_count, parts_open, lots_open, qty_live_total, qty_done_good, qty_scrap_total, qty_pending_explanation, qty_discrepancy_resolved, qty_qc_passed_total, dominant_stage_code, sum_check";
export const DISCREPANCY_COLUMNS = "id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, resolved_kind, resolved_reason, created_at, void_of_id, weight_gap_g";
export const LOT_STAGE_COLUMNS = "id, job_id, seq, stage_code, status, weigh_required, qty_in, qty_scrap, qty_split_out";

// ---------------------------------------------------------------------------
// ส่วน (1 แถวต่อใบในต้นไม้ — ใบแม่ = lotSeq 0)
// ---------------------------------------------------------------------------
export interface LotPart {
  jobId: string;
  lotSeq: number;
  /** "JB-0020" (ส่วนหลัก) · "JB-0020 · ส่วนที่ 2" — ที่เดียวของทุกจอ (job_no ของส่วนย่อยไม่ใช้บนจอ) */
  label: string;
  status: string;
  qtyPlanned: number;
  /** ชิ้นที่อยู่ในมือ/รอรับ ตอนนี้ (DB: job_live_qty) */
  qtyLive: number | null;
  qtyStageScrap: number;
  qtySplitOut: number;
  qtyDiscrepancyOpen: number;
  qtyDiscrepancyResolved: number;
  cancelScrapQty: number | null;
  qtyGood: number | null;
  stageCode: string | null;
  stageName: string | null;
  stageStatus: string | null;
  holderName: string | null;
  daysInStage: number | null;
  /** ผ่าน QC แล้วกี่ชิ้น (qc.qty_out เมื่อ qc ส่งแล้ว) — null = ยังไม่ผ่าน */
  qtyQcPassed: number | null;
  /** ขั้นที่ถืออยู่ (received) — ใช้แยกส่วนจากออฟฟิศ · null = ไม่มีขั้นที่ถือ */
  holdSeq: number | null;
  /** ขั้นที่ถืออยู่ตั้งชั่งไหน (ทองที่ขั้นชั่ง: แยกส่วนต้องชั่งส่วนที่แยก — มติ 19 ต.ค.) */
  holdWeighRequired: boolean;
  /** ชื่อขั้นที่ผ่านมาแล้ว (sent/skipped) เรียงตามลำดับ — ใบย่อยพิมพ์บรรทัดเดียว (ฌ3) */
  passedStages: string[];
}

export function mapLotPart(r: Record<string, unknown>): LotPart | null {
  const jobId = str(r.job_id);
  const label = str(r.label);
  if (!jobId || !label) return null;
  return {
    jobId,
    lotSeq: int0(r.lot_seq),
    label,
    status: str(r.status) ?? "open",
    qtyPlanned: int0(r.qty_planned),
    qtyLive: num(r.qty_live),
    qtyStageScrap: int0(r.qty_stage_scrap),
    qtySplitOut: int0(r.qty_split_out),
    qtyDiscrepancyOpen: int0(r.qty_discrepancy_open),
    qtyDiscrepancyResolved: int0(r.qty_discrepancy_resolved),
    cancelScrapQty: num(r.cancel_scrap_qty),
    qtyGood: num(r.qty_good),
    stageCode: str(r.stage_code),
    stageName: str(r.stage_name),
    stageStatus: str(r.stage_status),
    holderName: str(r.holder_name),
    daysInStage: num(r.days_in_stage),
    qtyQcPassed: num(r.qty_qc_passed),
    holdSeq: null,
    holdWeighRequired: false,
    passedStages: [],
  };
}

export interface LotsSummary {
  rootJobId: string;
  qtyPlanned: number;
  qtyOrder: number;
  partsCount: number;
  partsOpen: number;
  /** ส่วนย่อยที่ยังไม่ปิด/ยกเลิก (ไม่นับใบแม่) — ปิด full ไม่ได้เมื่อ > 0 */
  lotsOpen: number;
  qtyLiveTotal: number;
  qtyDoneGood: number;
  qtyScrapTotal: number;
  /** ส่วนต่างรอชี้แจง (ชิ้น) — ปิด full ไม่ได้เมื่อ > 0 */
  qtyPendingExplanation: number;
  /** ส่วนต่างที่ชี้แจงแล้ว (ชิ้น) */
  qtyDiscrepancyResolved: number;
  qtyQcPassedTotal: number;
  dominantStageCode: string | null;
  /** DB ตรวจแล้วว่าผลรวมทุกถัง = เริ่มผลิต */
  sumCheck: boolean;
}

export function mapLotsSummary(r: Record<string, unknown>): LotsSummary | null {
  const rootJobId = str(r.root_job_id);
  if (!rootJobId) return null;
  return {
    rootJobId,
    qtyPlanned: int0(r.qty_planned),
    qtyOrder: int0(r.qty_order),
    partsCount: int0(r.parts_count),
    partsOpen: int0(r.parts_open),
    lotsOpen: int0(r.lots_open),
    qtyLiveTotal: int0(r.qty_live_total),
    qtyDoneGood: int0(r.qty_done_good),
    qtyScrapTotal: int0(r.qty_scrap_total),
    qtyPendingExplanation: int0(r.qty_pending_explanation),
    qtyDiscrepancyResolved: int0(r.qty_discrepancy_resolved),
    qtyQcPassedTotal: int0(r.qty_qc_passed_total),
    dominantStageCode: str(r.dominant_stage_code),
    sumCheck: bool(r.sum_check),
  };
}

// ---------------------------------------------------------------------------
// ส่วนต่างรอชี้แจง (มติ Q5)
// ---------------------------------------------------------------------------
export interface LotDiscrepancy {
  id: string;
  jobId: string;
  /** ป้ายส่วน "JB-0020 · ส่วนที่ 2" (ประกอบจาก parts ฝั่ง loader) */
  lotLabel: string;
  fromStageName: string;
  toStageName: string;
  qty: number;
  status: "open" | "resolved" | "void";
  resolvedKind: "scrap" | "lost" | null;
  resolvedReason: string | null;
  createdAt: string | null;
  voidOfId: string | null;
  /** ส่วนต่างน้ำหนักเทียบ (กรัม · รับ − ส่ง) — เฉพาะหน้าออฟฟิศ · null = ไม่มี */
  weightGapG: number | null;
}

export function mapDiscrepancy(r: Record<string, unknown>, ctx: { stageById: Record<string, { name: string }>; labelByJob: Record<string, string> }): LotDiscrepancy | null {
  const id = str(r.id);
  const jobId = str(r.job_id);
  const qty = num(r.qty);
  const status = r.status === "open" || r.status === "resolved" || r.status === "void" ? r.status : null;
  if (!id || !jobId || qty === null || !status) return null;
  const kind = r.resolved_kind === "scrap" || r.resolved_kind === "lost" ? r.resolved_kind : null;
  return {
    id,
    jobId,
    lotLabel: ctx.labelByJob[jobId] ?? "",
    fromStageName: ctx.stageById[str(r.from_stage_id) ?? ""]?.name ?? "ขั้นก่อน",
    toStageName: ctx.stageById[str(r.to_stage_id) ?? ""]?.name ?? "ขั้นที่รับ",
    qty,
    status,
    resolvedKind: kind,
    resolvedReason: str(r.resolved_reason),
    createdAt: str(r.created_at),
    voidOfId: str(r.void_of_id),
    weightGapG: num(r.weight_gap_g),
  };
}

/** ส่วนต่างที่ยังรอชี้แจงจริง: status open และไม่มีแถว void ชี้มา (void = แถวใหม่ ไม่แก้แถวเดิม — 0181 ข้อ 5) */
export function openDiscrepancies(list: readonly LotDiscrepancy[]): LotDiscrepancy[] {
  const voided = new Set(list.map((d) => d.voidOfId).filter((x): x is string => x !== null));
  return list.filter((d) => d.status === "open" && !voided.has(d.id));
}

export const DISCREPANCY_KIND_LABEL: Record<string, string> = { scrap: "เสียหาย", lost: "หาย" };

// ---------------------------------------------------------------------------
// ข้อมูลของหน้าใบงาน (ใบแม่)
// ---------------------------------------------------------------------------
export interface JobLotsData {
  parts: LotPart[];
  summary: LotsSummary | null;
  discrepancies: LotDiscrepancy[];
}

/** แสดงแผงส่วนย่อยเมื่อมีมากกว่า 1 ส่วน หรือมีส่วนต่างบันทึกอยู่ — ใบเดี่ยวที่ไม่เคยแยก = หน้าเดิมทุกประการ */
export function hasLots(l: JobLotsData | null | undefined): l is JobLotsData {
  return !!l && (l.parts.length > 1 || l.discrepancies.length > 0);
}

/** ส่วนที่ยังใช้งาน (ไม่ยกเลิก) */
export const activeParts = (l: JobLotsData): LotPart[] => l.parts.filter((p) => p.status !== "cancelled");

/** ส่วนที่ผู้ถือถืออยู่และแยกได้ (ถืออยู่ ≥ 2 ชิ้น — DB ต้องเหลือผู้ถือเดิมอย่างน้อย 1) */
export function splittableParts(l: JobLotsData): LotPart[] {
  return l.parts.filter((p) => p.status !== "done" && p.status !== "cancelled" && p.holdSeq !== null && (p.qtyLive ?? 0) >= 2);
}

/**
 * เหตุผลที่ "ปิด full" ไม่ได้ (null = ไม่มีส่วนค้าง/ส่วนต่าง) — ข้อความขึ้นบนปุ่ม ไม่ใช่ tooltip
 * ด่านจริงอยู่ที่ DB (parts_open) — ที่นี่แค่ไม่ให้กดสิ่งที่รู้ว่าจะถูกปฏิเสธ
 */
export function closeBlocker(l: JobLotsData | null | undefined): string | null {
  if (!l) return null;
  const lotsOpen = l.summary?.lotsOpen ?? Math.max(0, l.parts.filter((p) => p.lotSeq > 0 && p.status !== "done" && p.status !== "cancelled").length);
  const pending = l.summary?.qtyPendingExplanation ?? openDiscrepancies(l.discrepancies).reduce((n, d) => n + d.qty, 0);
  const why: string[] = [];
  if (lotsOpen > 0) why.push(`ยังมีส่วนย่อยค้าง ${lotsOpen} ส่วน`);
  if (pending > 0) why.push(`มีส่วนต่างรอชี้แจง ${pending} ชิ้น`);
  return why.length > 0 ? why.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// แถบสีสะสมทั้งใบ + บรรทัดบนบอร์ด (ชุดเดียวกัน — token map ส่วน 5)
// ---------------------------------------------------------------------------
export type SegmentTone = "done" | "qc" | "shop" | "scrap" | "pending" | "resolved";
export interface LotSegment {
  key: string;
  label: string;
  qty: number;
  tone: SegmentTone;
}

/** รหัสขั้น QC (สีเหลืองอำพันตาม token map) — ขั้นอื่นในร้าน = เทา */
const QC_CODE = "qc";

/**
 * ถังจำนวนของทั้งใบ: เสร็จ (ผ่าน QC) · แต่ละขั้นที่ยังมีชิ้น · เสีย · รอชี้แจง · ส่วนต่างที่ชี้แจงแล้ว
 * ตัวเลขแต่ละถังมาจาก DB (summary + แถวของ v_job_tree) — ส่วนที่ผ่าน QC แล้วนับที่ "เสร็จ" ไม่นับซ้ำในถังขั้น
 */
export function lotSegments(l: Pick<JobLotsData, "parts" | "summary">): LotSegment[] {
  const out: LotSegment[] = [];
  const done = l.summary?.qtyQcPassedTotal ?? l.parts.reduce((n, p) => n + (p.qtyQcPassed ?? 0), 0);
  if (done > 0) out.push({ key: "done", label: "เสร็จ", qty: done, tone: "done" });
  const byStage = new Map<string, LotSegment>();
  for (const p of l.parts) {
    if (p.status === "done" || p.status === "cancelled" || p.qtyQcPassed !== null) continue;
    const q = p.qtyLive ?? 0;
    if (q <= 0) continue;
    const code = p.stageCode ?? "none";
    const cur = byStage.get(code);
    if (cur) cur.qty += q;
    else byStage.set(code, { key: `stage:${code}`, label: p.stageName ?? "ยังไม่เริ่ม", qty: q, tone: code === QC_CODE ? "qc" : "shop" });
  }
  out.push(...byStage.values());
  const scrap = l.summary?.qtyScrapTotal ?? 0;
  if (scrap > 0) out.push({ key: "scrap", label: "เสีย", qty: scrap, tone: "scrap" });
  const pend = l.summary?.qtyPendingExplanation ?? 0;
  if (pend > 0) out.push({ key: "pending", label: "รอชี้แจง", qty: pend, tone: "pending" });
  const res = l.summary?.qtyDiscrepancyResolved ?? 0;
  if (res > 0) out.push({ key: "resolved", label: "ส่วนต่างชี้แจงแล้ว", qty: res, tone: "resolved" });
  return out;
}

/** บรรทัดเดียวบนการ์ดบอร์ด: "เสร็จ 34/100 · QC 15 · บ้านชุบ 50 · เสีย 1" — ไม่มีชิ้นเสร็จ = "เสร็จ 0/100" */
export function lotsLine(l: Pick<JobLotsData, "parts" | "summary">): string | null {
  const total = l.summary?.qtyPlanned;
  if (total === undefined) return null;
  const segs = lotSegments(l);
  const done = segs.find((s) => s.key === "done")?.qty ?? 0;
  const rest = segs.filter((s) => s.key !== "done").map((s) => `${s.label} ${s.qty}`);
  return [`เสร็จ ${done}/${total}`, ...rest].join(" · ");
}

/** ผลรวมของถังที่แสดง (ไว้เทียบกับ N เพื่อบอกว่าครบ) — ใช้แสดงผลเท่านั้น ตัดสิน "ครบ" ด้วย sum_check ของ DB */
export const segmentsTotal = (segs: readonly LotSegment[]): number => segs.reduce((n, s) => n + s.qty, 0);

// ---------------------------------------------------------------------------
// ข้อมูลที่การ์ดบนบอร์ดต้องการ
// ---------------------------------------------------------------------------
export interface BoardLots {
  /** ส่วนที่ยังไม่ยกเลิก (นับใบแม่ด้วย) */
  partsCount: number;
  qtyPendingExplanation: number;
  line: string | null;
  sumOk: boolean;
}

export function toBoardLots(l: Pick<JobLotsData, "parts" | "summary">): BoardLots | null {
  if (!l.summary) return null;
  return { partsCount: l.summary.partsCount, qtyPendingExplanation: l.summary.qtyPendingExplanation, line: lotsLine(l), sumOk: l.summary.sumCheck };
}
