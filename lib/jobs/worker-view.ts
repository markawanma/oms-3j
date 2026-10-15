// lib/jobs/worker-view.ts — WorkerJobView: ข้อมูลที่หน้าช่าง /w/<token> ได้รับ (pure)
// 🔴 ขอบเขตข้อมูลของช่องทางสาธารณะ: ประกอบทีละ key จาก allowlist ด้านล่างเท่านั้น — key อื่นที่ DB ส่งมา (วันนี้หรืออนาคต) ถูกทิ้งเงียบๆ
//    ห้ามมี: ราคา · ต้นทุน · margin · ชื่อลูกค้า · เลขใบเสนอราคา · เลข PO · ที่อยู่/เบอร์ ฯลฯ
//    (RPC job_worker_resolve ก็ประกอบทีละ key อยู่แล้ว — ชั้นนี้คือด่านซ้ำฝั่งแอป เผื่อ RPC เปลี่ยนในอนาคต)
// payload นี้ผ่าน RSC ไปถึง client component ทั้งก้อน → ต้องตรวจจากรูปที่ "ส่งออกจริง" (ดู worker-view.test.ts)

export const NEXT_ACTIONS = ["identify", "receive", "send", "awaiting_deposit", "not_your_stage", "held_by_other", "prev_not_sent", "on_hold", "all_done"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export interface WorkerViewStage {
  seq: number;
  code: string;
  name: string;
  status: "pending" | "received" | "sent" | "skipped";
  receivedOn?: string | null;
  sentOn?: string | null;
  workerName?: string | null;
  autoClosed?: boolean;
}

export interface WorkerView {
  job: {
    jobNo: string;
    status: string;
    stages: WorkerViewStage[];
    /** เฉพาะเมื่อระบุตัวแล้ว */
    designLabel?: string;
    sku?: string | null;
    metal?: string;
    qtyPlanned?: number;
    dueDate?: string | null;
    /**
     * 0176: ใบนี้มีแบบการบันทึกไหม — DB ส่งมาทุกครั้ง (boolean) · key หายไป/ไม่ใช่ true = ใบเดิม (UI เดิมทุกประการ — fail-safe แสดงช่องครบ)
     * 🔴 ไม่มีชื่อแบบ/ป้ายทอง/คำเตือนทองในช่องทางนี้ — ช่างเห็นแค่ "ช่องไหนต้องกรอก" (profile_name ที่ DB ส่งให้ช่างที่ระบุตัวแล้ว ถูกทิ้งที่ชั้นนี้)
     */
    hasProfile?: boolean;
  };
  viewer: { workerId: string; displayName: string } | null;
  sessionExpired: boolean;
  nextAction: NextAction;
  actionStage: {
    seq: number;
    code: string;
    name: string;
    weightRequired: boolean;
    /** 0176: ขั้นนี้ถามชิ้นเสีย/น้ำหนักเศษไหม — key หายไป = ค่าเริ่มของ DB (ถามชิ้นเสีย · ไม่ถามเศษ) */
    scrapQtyAsk?: boolean;
    scrapWeightAsk?: boolean;
  } | null;
  prevWeightOutG: number | null;
  heldBy: string | null;
  workers: { id: string; displayName: string }[];
  scrapReasons: string[];
}

const SCRAP_REASONS = new Set(["porosity", "broken", "wrong_design", "missing", "other"]);
const STAGE_STATUSES = new Set(["pending", "received", "sent", "skipped"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const dateText = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 0176: ใส่ key เฉพาะที่ DB ส่งมา (ชนิด boolean จริงเท่านั้น) — ไม่มี = ผู้ใช้ถือค่าเริ่ม */
function scrapAsk(as: Record<string, unknown>): { scrapQtyAsk?: boolean; scrapWeightAsk?: boolean } {
  const out: { scrapQtyAsk?: boolean; scrapWeightAsk?: boolean } = {};
  if (typeof as.scrap_qty_ask === "boolean") out.scrapQtyAsk = as.scrap_qty_ask;
  if (typeof as.scrap_weight_ask === "boolean") out.scrapWeightAsk = as.scrap_weight_ask;
  return out;
}

function mapStage(raw: unknown): WorkerViewStage | null {
  if (!isObj(raw)) return null;
  const code = text(raw.code, 40);
  const status = typeof raw.status === "string" && STAGE_STATUSES.has(raw.status) ? (raw.status as WorkerViewStage["status"]) : null;
  const seq = numOrNull(raw.seq);
  if (!code || !status || seq === null) return null;
  const out: WorkerViewStage = { seq, code, name: text(raw.name, 80) ?? code, status };
  if ("received_on" in raw) out.receivedOn = dateText(raw.received_on);
  if ("sent_on" in raw) out.sentOn = dateText(raw.sent_on);
  if ("worker_name" in raw) out.workerName = text(raw.worker_name, 60);
  if ("auto_closed" in raw) out.autoClosed = raw.auto_closed === true;
  return out;
}

/** คืน null เมื่อรูปที่ได้ไม่ใช่ view ที่ใช้ได้ — ผู้เรียกแสดง "ลิงก์ใช้ไม่ได้" แทนการเดา */
export function sanitizeWorkerView(raw: unknown): WorkerView | null {
  if (!isObj(raw) || raw.ok !== true || !isObj(raw.job)) return null;
  const j = raw.job;
  const jobNo = text(j.job_no, 20);
  if (!jobNo) return null;
  const stages = (Array.isArray(j.stages) ? j.stages : []).map(mapStage).filter((s): s is WorkerViewStage => s !== null);

  const job: WorkerView["job"] = { jobNo, status: text(j.status, 20) ?? "open", stages };
  if ("design_label" in j) {
    job.designLabel = text(j.design_label, 200) ?? "";
    job.sku = text(j.sku, 100);
    job.metal = text(j.metal, 20) ?? undefined;
    job.qtyPlanned = numOrNull(j.qty_planned) ?? undefined;
    job.dueDate = dateText(j.due_date);
  }
  if ("has_profile" in j) job.hasProfile = j.has_profile === true;

  const v = raw.viewer;
  const viewerId = isObj(v) && typeof v.worker_id === "string" && UUID_RE.test(v.worker_id) ? v.worker_id : null;
  const viewer = isObj(v) && viewerId ? { workerId: viewerId, displayName: text(v.display_name, 60) ?? "" } : null;

  // 0173: ไม่มี 'none' แล้ว — ค่านอก enum (เช่น เวอร์ชัน DB ใหม่กว่าแอป) = ปฏิเสธทั้ง view ดีกว่าเดาว่าเป็นปุ่มอะไร
  const na = raw.next_action;
  if (typeof na !== "string" || !(NEXT_ACTIONS as readonly string[]).includes(na)) return null;
  const nextAction = na as NextAction;

  const as = raw.action_stage;
  const actionSeq = isObj(as) ? numOrNull(as.seq) : null;
  const actionStage =
    isObj(as) && actionSeq !== null && text(as.code, 40)
      ? { seq: actionSeq, code: text(as.code, 40) as string, name: text(as.name, 80) ?? "", weightRequired: as.weight_required === true, ...scrapAsk(as) }
      : null;

  const workers = (Array.isArray(raw.workers) ? raw.workers : [])
    .filter(isObj)
    .map((w) => ({ id: typeof w.id === "string" && UUID_RE.test(w.id) ? w.id : "", displayName: text(w.display_name, 60) ?? "" }))
    .filter((w) => w.id !== "" && w.displayName !== "")
    .slice(0, 50);

  return {
    job,
    viewer,
    sessionExpired: raw.session_expired === true,
    // all_done ไม่ต้องระบุตัวใคร (ไม่มีอะไรให้ทำ) — ค่าอื่นของคนที่ยังไม่ระบุตัว = ให้ระบุตัวก่อนเสมอ
    nextAction: viewer || nextAction === "all_done" ? nextAction : "identify",
    actionStage,
    prevWeightOutG: numOrNull(raw.prev_weight_out_g),
    heldBy: text(raw.held_by, 60),
    workers,
    scrapReasons: (Array.isArray(raw.scrap_reasons) ? raw.scrap_reasons : []).filter((r): r is string => typeof r === "string" && SCRAP_REASONS.has(r)),
  };
}

/** ชื่อขั้นก่อนหน้า (ไม่นับที่ข้าม) ของขั้นที่กำลังจะทำ — ใช้ข้อความ "ขั้นก่อน (X) ยังไม่ส่ง" */
export function prevStageName(view: Pick<WorkerView, "job" | "actionStage">): string | null {
  const at = view.actionStage?.seq;
  if (at === undefined) return null;
  const prev = [...view.job.stages].filter((s) => s.seq < at && s.status !== "skipped").sort((a, b) => b.seq - a.seq)[0];
  return prev?.name ?? null;
}

/** key ที่ห้ามปรากฏที่ใดใน payload ของหน้าช่าง/หน้าพิมพ์ (ทดสอบ + ด่านซ้ำใน action) — ตรวจทุกระดับ ไม่สนตัวพิมพ์ */
export const FORBIDDEN_KEY_PATTERN =
  /price|cost|margin|profit|customer|buyer|client|quote_?no|quoteno|po_?no|invoice|receipt|deposit_?(?:thb|amount)|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|unit_?cost|per_?piece_?price|total_?thb|baht/i;

export function findForbiddenKeys(value: unknown, path = "$", depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenKeys(v, `${path}[${i}]`, depth + 1)));
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(k)) hits.push(`${path}.${k}`);
    hits.push(...findForbiddenKeys(v, `${path}.${k}`, depth + 1));
  }
  return hits;
}
