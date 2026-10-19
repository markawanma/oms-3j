// lib/jobs/types.ts — ชนิดข้อมูล + label + mapper ฝั่งออฟฟิศของระบบใบงาน (pure · ใช้ได้ทั้ง server/client)
// 🔴 ไม่มี field ราคา/ต้นทุน/margin/ชื่อลูกค้า ที่ใดในไฟล์นี้ — แหล่งข้อมูล (v_job_board ฯลฯ) ไม่มีคอลัมน์เหล่านั้นอยู่แล้ว
//    source_ref (เลขใบเสนอราคา/เลข PO) เห็นได้เฉพาะหน้าออฟฟิศ ห้ามเข้า payload หน้าช่าง / หน้าพิมพ์

export const JOB_STATUSES = ["open", "in_progress", "on_hold", "done", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABEL: Record<string, string> = {
  open: "เปิดใหม่",
  in_progress: "กำลังผลิต",
  on_hold: "พักไว้",
  done: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};

export const STAGE_STATUS_LABEL: Record<string, string> = {
  pending: "รอรับ",
  received: "กำลังทำ",
  sent: "ส่งต่อแล้ว",
  skipped: "ข้ามขั้น",
};

export const SOURCE_LABEL: Record<string, string> = { oem: "งาน OEM", production: "ผลิตเข้าสต็อก" };
export const METAL_LABEL: Record<string, string> = { silver: "เงิน", gold: "ทอง", brass: "ทองเหลือง" };

export const SCRAP_REASONS = ["porosity", "broken", "wrong_design", "missing", "other"] as const;
export const SCRAP_REASON_LABEL: Record<string, string> = {
  porosity: "รูพรุน",
  broken: "หัก",
  wrong_design: "ผิดแบบ",
  missing: "หาย",
  other: "อื่นๆ",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  create: "สร้างใบงาน",
  stage_receive: "รับงาน",
  stage_send: "ส่งต่อ",
  stage_skip: "ข้ามขั้น",
  stage_reopen: "ย้อนขั้น",
  weigh: "ชั่งน้ำหนัก",
  scrap: "ของเสีย",
  batch_join: "เข้าชุด",
  batch_leave: "ออกจากชุด",
  due_set: "ตั้งกำหนดส่ง",
  hold: "พักงาน",
  resume: "ทำต่อ",
  photo_add: "เพิ่มรูป",
  // 0182: ลบรูป (ตั้งรูปหลัก/เรียงรูปไม่เขียน event — design §5)
  photo_remove: "ลบรูป",
  // 0182 (security L4): ตั้งรูปหลัก/เรียงรูป เขียน event เมื่อเปลี่ยนจริง
  photo_primary: "ตั้งรูปหลัก",
  photo_reorder: "เรียงรูป",
  note: "หมายเหตุ",
  done: "ปิดงาน",
  cancel: "ยกเลิก",
  token_issue: "ออก QR",
  token_revoke: "เพิกถอน QR",
  profile_set: "เปลี่ยนแบบการบันทึก",
  // 0175: แก้จำนวนเริ่มผลิต/แผนโลหะ · ตัดสินของเหลือ (ครบทุก event_type ใน CHECK job_event_event_type_ck — เทสต์ events-labels ล้มถ้ามีตัวใหม่ที่ยังไม่แปล)
  plan_change: "แก้จำนวน/แผนโลหะ",
  surplus_set: "จัดการของเหลือ",
  // 0181: ส่วนย่อย (ส่งต่อ n จาก N) + ส่วนต่างรอชี้แจง
  split: "แยกส่วน",
  split_cancel: "ยกเลิกส่วน",
  discrepancy: "รับไม่ครบ (ส่วนต่าง)",
  discrepancy_resolve: "ชี้แจงส่วนต่าง",
};

export const CHANNEL_LABEL: Record<string, string> = {
  worker_qr: "ช่างสแกน QR",
  daily_sheet: "กรอกจากกระดาษ",
  job_page: "ออฟฟิศ",
  rpc: "ระบบ",
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const date = (v: unknown): string | null => str(v)?.slice(0, 10) ?? null;
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const bool = (v: unknown): boolean => v === true;

// ---------------------------------------------------------------------------
// บอร์ด (v_job_board)
// ---------------------------------------------------------------------------
export const BOARD_COLUMNS = [
  "id", "job_no", "seq", "source_kind", "source_ref", "design_label", "sku_snapshot", "metal", "qty_planned", "status", "due_date",
  "current_stage_code", "current_stage_name", "current_stage_status", "holder_name", "days_in_stage", "is_overdue", "last_event_at",
  "last_scan_at", "is_stale", "stage_count", "stage_done_count", "has_auto_closed", "deposit_missing", "start_gate_note_present",
  "quote_qty_mismatch", "quote_item_qty", "created_at", "board_column", "handoff_gap_g", "handoff_mismatch_count",
  "qty_order", "qty_surplus", "under_planned", "surplus_pending", "surplus_disposition", "target_piece_g", "metal_plan_g",
  "profile_name", "has_weigh", "gold_unguarded",
  // 0181: บอร์ด 1 การ์ดต่อใบแม่ (กรอง parent_job_id is null ที่ loader) · จำนวนส่วน · ส่วนต่างรอชี้แจง · ขั้นที่มีชิ้นมากสุด (คอลัมน์ของใบที่ของกระจายหลายขั้น)
  "parent_job_id", "parts_count", "parts_open", "qty_pending_explanation", "dominant_stage_code",
  // 0181 (re-review M-A/M-B/L-1): เทียบน้ำหนักทั้งต้นไม้ — ใบแม่ + ส่วนย่อย (office เท่านั้น · ห้ามส่งให้ช่าง N1)
  "tree_handoff_gap_g", "tree_handoff_gap_partial_g", "tree_handoff_mismatch_count", "tree_weight_gap_excess_g", "tree_lot_first_gap_sum_g",
].join(", ");

export interface BoardRow {
  id: string;
  jobNo: string;
  seq: number;
  sourceKind: string;
  sourceRef: string | null;
  designLabel: string;
  sku: string | null;
  metal: string;
  qtyPlanned: number;
  status: string;
  dueDate: string | null;
  stageCode: string | null;
  stageName: string | null;
  stageStatus: string | null;
  holderName: string | null;
  daysInStage: number | null;
  isOverdue: boolean;
  lastEventAt: string | null;
  lastScanAt: string | null;
  isStale: boolean;
  stageCount: number;
  stageDoneCount: number;
  hasAutoClosed: boolean;
  depositMissing: boolean;
  startGateNotePresent: boolean;
  quoteQtyMismatch: boolean;
  quoteItemQty: number | null;
  createdAt: string | null;
  /** 0173: คอลัมน์บอร์ดที่ DB ตัดสิน — รหัสขั้นปัจจุบัน | 'awaiting_close' (ส่งต่อ/ข้ามครบแล้วรอปิดงาน) | done | cancelled */
  boardColumn: string | null;
  /** 0173: ส่วนต่างส่งมอบสูงสุด (ค่าสัมบูรณ์ กรัม) ระหว่างน้ำหนักออกของขั้นก่อนกับน้ำหนักเข้าของขั้นถัดไป — null = ไม่มีคู่น้ำหนัก */
  handoffGapG: number | null;
  /** 0174: จำนวนครั้งที่ช่างรับน้ำหนักทองไม่ตรงกับขั้นก่อน (event weigh/handoff_mismatch) */
  handoffMismatchCount: number;
  /** 0175: จำนวนที่ลูกค้าสั่ง (qtyPlanned = จำนวนเริ่มผลิต รวมเผื่อเสีย) */
  qtyOrder: number;
  /** 0175: ใบ done = qty_good − qty_order (ลบ = ผลิตขาด) · ใบอื่น null */
  qtySurplus: number | null;
  /** 0175: เริ่มผลิตน้อยกว่าที่สั่ง (ผลิตบางส่วน) */
  underPlanned: boolean;
  /** 0175: ใบ done มีของเหลือที่ยังไม่ตัดสิน (hold) */
  surplusPending: boolean;
  surplusDisposition: string | null;
  targetPieceG: number | null;
  metalPlanG: number | null;
  /** 0176: ชื่อแบบการบันทึก (null = ใบเดิมก่อนมีแบบ) */
  profileName: string | null;
  /** 0176: ใบนี้มีขั้นที่ต้องชั่งอย่างน้อย 1 ขั้น */
  hasWeigh: boolean;
  /** 0176: ใบทองที่ยังไม่ปิดและมีขั้นที่โลหะอยู่ในมือแต่ไม่ชั่ง (ไม่มีด่านกันทองหาย) — DB ตัดสิน */
  goldUnguarded: boolean;
  // 0181 (ทั้งหมด optional — ใบเดี่ยว/แถวที่ view ยังไม่ส่งคอลัมน์ใหม่ = ไม่มี key = บอร์ดเดิมทุกประการ)
  /** ส่วนย่อยที่ยังไม่ยกเลิก (นับใบแม่) — > 1 = ใบที่แยกส่วนแล้ว */
  partsCount?: number;
  partsOpen?: number;
  /** ส่วนต่างรอชี้แจง (ชิ้น) — DB */
  qtyPendingExplanation?: number;
  /** ขั้นที่มีชิ้นมากสุดของทั้งใบ — ตำแหน่งการ์ดในมุมมองคอลัมน์เมื่อแยกส่วนแล้ว */
  dominantStageCode?: string | null;
  /** บรรทัด "เสร็จ x/N · …" ประกอบที่ loader จาก v_job_tree_summary + v_job_tree */
  lotsLine?: string | null;
  /** ผลตรวจ sum_check ของ DB (ผลรวมทุกถัง = เริ่มผลิต) */
  lotsSumOk?: boolean;
  /** M-A: ส่วนต่างส่งมอบสูงสุด (|กรัม|) ทั้งต้นไม้ — handoffGapG เดิมนับเฉพาะใบตัวเอง จึงมองไม่เห็นขั้นแรกของส่วนย่อย · ไม่มี key = ไม่มีคู่น้ำหนัก */
  treeHandoffGapG?: number;
  /** M-A: เหมือนกัน แต่คู่ขั้นที่รับไม่ครบ (มีส่วนต่างจำนวนชิ้น) */
  treeHandoffGapPartialG?: number;
  /** M-A: จำนวนครั้งที่ช่างชั่งรับทองไม่ตรง ทั้งต้นไม้ (มี key เฉพาะเมื่อ > 0) */
  treeHandoffMismatchCount?: number;
  /** M-B: น้ำหนักที่หายเกินสัดส่วนชิ้นที่ขาด (g · ลบ = หายเกิน) รวมส่วนต่างที่ยังนับอยู่ทั้งต้นไม้ */
  treeWeightGapExcessG?: number;
  /** L-1: ผลรวม gap ขั้นแรกของทุกส่วนที่แยกจากขั้นเดียวกัน (ต่ำสุดของกลุ่ม · ลบเกิน 0.05 = ควรเตือน) */
  treeLotFirstGapSumG?: number;
}

export function mapBoardRow(r: Record<string, unknown>): BoardRow | null {
  const id = str(r.id);
  const jobNo = str(r.job_no);
  if (!id || !jobNo) return null;
  return {
    id,
    jobNo,
    seq: num(r.seq) ?? 0,
    sourceKind: str(r.source_kind) ?? "production",
    sourceRef: str(r.source_ref),
    designLabel: str(r.design_label) ?? "(ไม่มีชื่อแบบ)",
    sku: str(r.sku_snapshot),
    metal: str(r.metal) ?? "silver",
    qtyPlanned: num(r.qty_planned) ?? 0,
    status: str(r.status) ?? "open",
    dueDate: date(r.due_date),
    stageCode: str(r.current_stage_code),
    stageName: str(r.current_stage_name),
    stageStatus: str(r.current_stage_status),
    holderName: str(r.holder_name),
    daysInStage: num(r.days_in_stage),
    isOverdue: bool(r.is_overdue),
    lastEventAt: str(r.last_event_at),
    lastScanAt: str(r.last_scan_at),
    isStale: bool(r.is_stale),
    stageCount: num(r.stage_count) ?? 0,
    stageDoneCount: num(r.stage_done_count) ?? 0,
    hasAutoClosed: bool(r.has_auto_closed),
    depositMissing: bool(r.deposit_missing),
    startGateNotePresent: bool(r.start_gate_note_present),
    quoteQtyMismatch: bool(r.quote_qty_mismatch),
    quoteItemQty: num(r.quote_item_qty),
    createdAt: str(r.created_at),
    boardColumn: str(r.board_column),
    handoffGapG: num(r.handoff_gap_g),
    handoffMismatchCount: num(r.handoff_mismatch_count) ?? 0,
    // ใบเดิม/แถวที่ view ยังไม่ส่งคอลัมน์ใหม่: qtyOrder ถอยไปใช้ qty_planned (backfill เท่ากัน) — ไม่ใช้ 0 ปลอม
    qtyOrder: num(r.qty_order) ?? num(r.qty_planned) ?? 0,
    qtySurplus: num(r.qty_surplus),
    underPlanned: bool(r.under_planned),
    surplusPending: bool(r.surplus_pending),
    surplusDisposition: str(r.surplus_disposition),
    targetPieceG: num(r.target_piece_g),
    metalPlanG: num(r.metal_plan_g),
    profileName: str(r.profile_name),
    hasWeigh: bool(r.has_weigh),
    goldUnguarded: bool(r.gold_unguarded),
    ...lotKeys(r),
  };
}

/** 0181: ใส่ key เฉพาะที่ view ส่งมา (คอลัมน์ใหม่) — ใบเดิม/view เก่าไม่มี key → BoardRow รูปเดิมเป๊ะ */
function lotKeys(r: Record<string, unknown>): Partial<BoardRow> {
  const out: Partial<BoardRow> = {};
  const parts = num(r.parts_count);
  if (parts !== null) out.partsCount = parts;
  const open = num(r.parts_open);
  if (open !== null) out.partsOpen = open;
  const pend = num(r.qty_pending_explanation);
  if (pend !== null && pend > 0) out.qtyPendingExplanation = pend;
  const dom = str(r.dominant_stage_code);
  if (dom !== null && (parts ?? 0) > 1) out.dominantStageCode = dom;
  const tg = num(r.tree_handoff_gap_g);
  if (tg !== null) out.treeHandoffGapG = tg;
  const tgp = num(r.tree_handoff_gap_partial_g);
  if (tgp !== null) out.treeHandoffGapPartialG = tgp;
  const tmc = num(r.tree_handoff_mismatch_count);
  if (tmc !== null && tmc > 0) out.treeHandoffMismatchCount = tmc;
  const tex = num(r.tree_weight_gap_excess_g);
  if (tex !== null) out.treeWeightGapExcessG = tex;
  const tlg = num(r.tree_lot_first_gap_sum_g);
  if (tlg !== null) out.treeLotFirstGapSumG = tlg;
  return out;
}

// ---------------------------------------------------------------------------
// ขั้นของใบงาน (job_stage + ชื่อจาก job_stage_def)
// ---------------------------------------------------------------------------
export interface StageRow {
  id: string;
  seq: number;
  code: string;
  name: string;
  status: string;
  weighRequired: boolean;
  /** 0176: ขั้นนี้ถามชิ้นเสีย / น้ำหนักเศษโลหะ (snapshot ตอนสร้างใบ/เปลี่ยนแบบ) — ใบเดิม: ถามชิ้นเสีย true · เศษ false */
  scrapQtyAsk: boolean;
  scrapWeightAsk: boolean;
  /** 0176: โลหะอยู่ในมือที่ขั้นนี้ (จากทะเบียนขั้น) — ใช้บอกว่า "ไม่ชั่ง" ในใบทองคือไม่มีด่าน */
  metalPresent: boolean;
  receivedOn: string | null;
  sentOn: string | null;
  workerId: string | null;
  holderName: string | null;
  autoClosed: boolean;
  qtyIn: number | null;
  qtyOut: number | null;
  qtyScrap: number;
  scrapReason: string | null;
  weightInG: number | null;
  weightOutG: number | null;
  metalAddedG: number;
  scrapWeightG: number | null;
  weightNote: string | null;
  skipReason: string | null;
}

export const STAGE_COLUMNS =
  "id, seq, stage_code, status, weigh_required, scrap_qty_ask, scrap_weight_ask, received_on, sent_on, worker_id, assignee_name, auto_closed, qty_in, qty_out, qty_scrap, scrap_reason, weight_in_g, weight_out_g, metal_added_g, scrap_weight_g, weight_note, skip_reason";

export function mapStageRow(r: Record<string, unknown>, names: Record<string, string>, workerNames: Record<string, string>, metalPresent: Record<string, boolean> = {}): StageRow | null {
  const id = str(r.id);
  const code = str(r.stage_code);
  if (!id || !code) return null;
  const workerId = str(r.worker_id);
  return {
    id,
    seq: num(r.seq) ?? 0,
    code,
    name: names[code] ?? code,
    status: str(r.status) ?? "pending",
    weighRequired: bool(r.weigh_required),
    // คอลัมน์ใหม่ที่ยังไม่มีในแถว = ค่าเริ่มของ DB (ถามชิ้นเสีย · ไม่ถามเศษ) ไม่ใช่ "ปิด"
    scrapQtyAsk: r.scrap_qty_ask === undefined || r.scrap_qty_ask === null ? true : r.scrap_qty_ask === true,
    scrapWeightAsk: bool(r.scrap_weight_ask),
    metalPresent: metalPresent[code] === true,
    receivedOn: date(r.received_on),
    sentOn: date(r.sent_on),
    workerId,
    holderName: (workerId ? workerNames[workerId] : null) ?? str(r.assignee_name),
    autoClosed: bool(r.auto_closed),
    qtyIn: num(r.qty_in),
    qtyOut: num(r.qty_out),
    qtyScrap: num(r.qty_scrap) ?? 0,
    scrapReason: str(r.scrap_reason),
    weightInG: num(r.weight_in_g),
    weightOutG: num(r.weight_out_g),
    metalAddedG: num(r.metal_added_g) ?? 0,
    scrapWeightG: num(r.scrap_weight_g),
    weightNote: str(r.weight_note),
    skipReason: str(r.skip_reason),
  };
}

/** น้ำหนักหายของขั้น (g) = เข้า + เติม − ออก − เศษที่เก็บได้ — ค่าตัดสินจริงอยู่ที่ v_job_stage_loss · ที่นี่แสดงผลจากตัวเลขของ DB เท่านั้น (null = ชั่งไม่ครบ) */
export interface StageLoss {
  /** 0173: น้ำหนักที่ขั้นนี้รับ - น้ำหนักที่ขั้นก่อนส่งออก (เซ็นได้ + รับมากกว่า) — null = ไม่มีคู่น้ำหนัก */
  handoffGapG: number | null;
  lossG: number | null;
  lossPct: number | null;
  warn: boolean;
  notWeighed: boolean;
  /** 0181 H1: รับไม่ครบ — ส่วนต่างน้ำหนักเทียบ (รับ − ส่ง) · เฉพาะหน้าออฟฟิศ (ห้ามส่งหน้าช่าง) · ไม่มี key = ไม่มีส่วนต่างบันทึก */
  handoffGapPartialG?: number;
}

export function mapLossRow(r: Record<string, unknown>): { stageId: string; loss: StageLoss } | null {
  const id = str(r.job_stage_id);
  if (!id) return null;
  const partial = num(r.handoff_gap_partial_g);
  return { stageId: id, loss: { handoffGapG: num(r.handoff_gap_g), lossG: num(r.loss_g), lossPct: num(r.loss_pct), warn: bool(r.warn), notWeighed: bool(r.not_weighed), ...(partial !== null ? { handoffGapPartialG: partial } : {}) } };
}

// ---------------------------------------------------------------------------
// ใบงาน (หน้า /jobs/[id])
// ---------------------------------------------------------------------------
export const JOB_COLUMNS =
  "id, job_no, source_kind, design_label, sku_snapshot, metal, qty_planned, qty_good, qty_scrap, weight_start_g, weight_final_g, weigh_required, due_date, status, current_stage_code, start_gate_note, created_at, done_at, cancelled_at, cancel_reason, note, oem_quote_item_id, production_order_item_id, qty_order, target_piece_g, metal_plan_g, metal_plan_basis, surplus_disposition, surplus_note, profile_id, profile_name, require_final_weight";

export interface JobDetail {
  id: string;
  jobNo: string;
  sourceKind: string;
  designLabel: string;
  sku: string | null;
  metal: string;
  qtyPlanned: number;
  qtyGood: number | null;
  qtyScrap: number | null;
  weightStartG: number | null;
  weightFinalG: number | null;
  dueDate: string | null;
  status: string;
  currentStageCode: string | null;
  startGateNote: string | null;
  createdAt: string | null;
  doneAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  oemQuoteItemId: string | null;
  productionOrderItemId: string | null;
  /** 0175 */
  qtyOrder: number;
  targetPieceG: number | null;
  metalPlanG: number | null;
  /** basis ที่ DB เก็บ (สูตร/rate ที่ใช้/ที่มา/missing[]) — แสดงสูตรบนหน้าใบงาน ไม่คำนวณใหม่ใน client */
  metalPlanBasis: Record<string, unknown> | null;
  surplusDisposition: string | null;
  surplusNote: string | null;
  /** 0176: แบบการบันทึกของใบ (null = ใบเดิม กติกา J1) · require_final_weight = snapshot ตอนสร้าง/เปลี่ยนแบบ · weighRequired = มีขั้นที่ต้องชั่งอย่างน้อย 1 ขั้น */
  profileId: string | null;
  profileName: string | null;
  requireFinalWeight: boolean;
  weighRequired: boolean;
}

export function mapJobDetail(r: Record<string, unknown>): JobDetail | null {
  const id = str(r.id);
  const jobNo = str(r.job_no);
  if (!id || !jobNo) return null;
  return {
    id,
    jobNo,
    sourceKind: str(r.source_kind) ?? "production",
    designLabel: str(r.design_label) ?? "(ไม่มีชื่อแบบ)",
    sku: str(r.sku_snapshot),
    metal: str(r.metal) ?? "silver",
    qtyPlanned: num(r.qty_planned) ?? 0,
    qtyGood: num(r.qty_good),
    qtyScrap: num(r.qty_scrap),
    weightStartG: num(r.weight_start_g),
    weightFinalG: num(r.weight_final_g),
    dueDate: date(r.due_date),
    status: str(r.status) ?? "open",
    currentStageCode: str(r.current_stage_code),
    startGateNote: str(r.start_gate_note),
    createdAt: str(r.created_at),
    doneAt: str(r.done_at),
    cancelledAt: str(r.cancelled_at),
    cancelReason: str(r.cancel_reason),
    note: str(r.note),
    oemQuoteItemId: str(r.oem_quote_item_id),
    productionOrderItemId: str(r.production_order_item_id),
    qtyOrder: num(r.qty_order) ?? num(r.qty_planned) ?? 0,
    targetPieceG: num(r.target_piece_g),
    metalPlanG: num(r.metal_plan_g),
    metalPlanBasis: r.metal_plan_basis !== null && typeof r.metal_plan_basis === "object" && !Array.isArray(r.metal_plan_basis) ? (r.metal_plan_basis as Record<string, unknown>) : null,
    surplusDisposition: str(r.surplus_disposition),
    surplusNote: str(r.surplus_note),
    profileId: str(r.profile_id),
    profileName: str(r.profile_name),
    requireFinalWeight: bool(r.require_final_weight),
    weighRequired: bool(r.weigh_required),
  };
}

export interface EventRow {
  id: string;
  type: string;
  occurredOn: string | null;
  recordedAt: string | null;
  channel: string;
  workerName: string | null;
  stageCode: string | null;
  summary: string | null;
}

export const EVENT_COLUMNS = "id, job_stage_id, event_type, occurred_on, recorded_at, worker_id, channel, payload";

/** สรุปบรรทัดเดียวจาก payload — เลือกเฉพาะ key ที่รู้จัก (ไม่ dump payload ดิบ) */
export function summarizeEvent(type: string, payload: unknown): string | null {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const reason = str(p.reason);
  if (type === "stage_skip" || type === "stage_reopen" || type === "cancel" || type === "token_revoke") return reason;
  if (type === "weigh" && p.kind === "handoff_mismatch") {
    // หน้า owner/admin เท่านั้น: เห็นน้ำหนักจริงที่ช่างพิมพ์ (หน้าช่างห้ามเห็น — ผู้รับต้องชั่งแบบไม่รู้คำตอบ)
    const wi = num(p.weight_in_g);
    const wp = num(p.prev_weight_out_g);
    const gap = num(p.gap_g);
    return `ชั่งรับไม่ตรงกับขั้นก่อน (ระบบปฏิเสธ): ช่างใส่ ${wi ?? "—"} g · ขั้นก่อนส่ง ${wp ?? "—"} g${gap !== null ? ` · ต่าง ${gap > 0 ? "+" : "−"}${Math.abs(gap)} g` : ""}`;
  }
  if (type === "due_set") return `${date(p.before) ?? "ไม่ตั้ง"} → ${date(p.after) ?? "ไม่ตั้ง"}`;
  if (type === "done") return `ดี ${num(p.qty_good) ?? "—"} · เสีย ${num(p.qty_scrap) ?? "—"}`;
  // 0176: before/after = สถานะแบบของใบ (job_profile_state) — เอาเฉพาะชื่อแบบ · ไม่มีแบบ (ใบเดิม) = "กติกาเดิม"
  if (type === "profile_set") {
    const nameOf = (v: unknown) => {
      const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
      return str(o.profile_name) ?? "กติกาเดิม";
    };
    return `${nameOf(p.before)} → ${nameOf(p.after)}`;
  }
  if (type === "token_issue") return num(p.print_no) !== null ? `ใบที่ ${num(p.print_no)}` : null;
  return null;
}

export function mapEventRow(r: Record<string, unknown>, stageCodeById: Record<string, string>, workerNames: Record<string, string>): EventRow | null {
  const id = str(r.id);
  const type = str(r.event_type);
  if (!id || !type) return null;
  const stageId = str(r.job_stage_id);
  const workerId = str(r.worker_id);
  return {
    id,
    type,
    occurredOn: date(r.occurred_on),
    recordedAt: str(r.recorded_at),
    channel: str(r.channel) ?? "rpc",
    workerName: workerId ? (workerNames[workerId] ?? null) : null,
    stageCode: stageId ? (stageCodeById[stageId] ?? null) : null,
    summary: summarizeEvent(type, r.payload),
  };
}

// ---------------------------------------------------------------------------
// ช่าง (ทะเบียน)
// ---------------------------------------------------------------------------
/** 0173 v_worker_lock.lock_state: none | temporary (ล็อกชั่วคราว 15 นาที/1 ชม. ปลดเองเมื่อครบ) | office (ผิดครบ 15 ครั้ง ต้องให้ออฟฟิศปลดล็อก/รีเซ็ต PIN) */
export type LockState = "none" | "temporary" | "office";
export const LOCK_STATE_LABEL: Record<LockState, string> = { none: "ปกติ", temporary: "ล็อกชั่วคราว (ใส่ PIN ผิดหลายครั้ง)", office: "ล็อกจนกว่าออฟฟิศปลดล็อก" };

export interface WorkerRow {
  id: string;
  displayName: string;
  stageCodes: string[];
  isActive: boolean;
  lockedUntil: string | null;
  createdAt: string | null;
  lockState: LockState;
  /** จำนวน PIN ผิดในหน้าต่าง 24 ชม. ปัจจุบัน (0 = ไม่มี) */
  failedAttempts: number;
  /** 0174 v_worker_lock.pin_warning: ผิด >= 3 ครั้งในหน้าต่าง 24 ชม. (ตัวนับไม่ล้างเมื่อ login สำเร็จแล้ว) */
  pinWarning: boolean;
}

export const WORKER_LOCK_COLUMNS = "worker_id, lock_state, failed_attempts, in_window, pin_warning";

export function mapLockRow(r: Record<string, unknown>): { workerId: string; lockState: LockState; failedAttempts: number; pinWarning: boolean } | null {
  const id = str(r.worker_id);
  if (!id) return null;
  const st = r.lock_state === "temporary" || r.lock_state === "office" ? r.lock_state : "none";
  return { workerId: id, lockState: st, failedAttempts: r.in_window === true ? (num(r.failed_attempts) ?? 0) : 0, pinWarning: r.pin_warning === true };
}

export const WORKER_COLUMNS = "id, display_name, stage_codes, is_active, locked_until, created_at";

export function mapWorkerRow(r: Record<string, unknown>, lock?: { lockState: LockState; failedAttempts: number; pinWarning: boolean }): WorkerRow | null {
  const id = str(r.id);
  const name = str(r.display_name);
  if (!id || !name) return null;
  return {
    id,
    displayName: name,
    stageCodes: Array.isArray(r.stage_codes) ? r.stage_codes.filter((c): c is string => typeof c === "string") : [],
    isActive: r.is_active !== false,
    lockedUntil: str(r.locked_until),
    createdAt: str(r.created_at),
    lockState: lock?.lockState ?? "none",
    failedAttempts: lock?.failedAttempts ?? 0,
    pinWarning: lock?.pinWarning ?? false,
  };
}

export interface StageDef {
  code: string;
  nameTh: string;
  seq: number;
}

export function mapStageDef(r: Record<string, unknown>): StageDef | null {
  const code = str(r.code);
  if (!code) return null;
  return { code, nameTh: str(r.name_th) ?? code, seq: num(r.seq_default) ?? 0 };
}
