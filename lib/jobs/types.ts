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
  note: "หมายเหตุ",
  done: "ปิดงาน",
  cancel: "ยกเลิก",
  token_issue: "ออก QR",
  token_revoke: "เพิกถอน QR",
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
  };
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
  "id, seq, stage_code, status, weigh_required, received_on, sent_on, worker_id, assignee_name, auto_closed, qty_in, qty_out, qty_scrap, scrap_reason, weight_in_g, weight_out_g, metal_added_g, scrap_weight_g, weight_note, skip_reason";

export function mapStageRow(r: Record<string, unknown>, names: Record<string, string>, workerNames: Record<string, string>): StageRow | null {
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
}

export function mapLossRow(r: Record<string, unknown>): { stageId: string; loss: StageLoss } | null {
  const id = str(r.job_stage_id);
  if (!id) return null;
  return { stageId: id, loss: { handoffGapG: num(r.handoff_gap_g), lossG: num(r.loss_g), lossPct: num(r.loss_pct), warn: bool(r.warn), notWeighed: bool(r.not_weighed) } };
}

// ---------------------------------------------------------------------------
// ใบงาน (หน้า /jobs/[id])
// ---------------------------------------------------------------------------
export const JOB_COLUMNS =
  "id, job_no, source_kind, design_label, sku_snapshot, metal, qty_planned, qty_good, qty_scrap, weight_start_g, weight_final_g, weigh_required, due_date, status, current_stage_code, start_gate_note, created_at, done_at, cancelled_at, cancel_reason, note, oem_quote_item_id, production_order_item_id";

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
