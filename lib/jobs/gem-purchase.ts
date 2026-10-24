// lib/jobs/gem-purchase.ts — ชนิดข้อมูล + ตัวแปลงของ "พลอยที่ต้องสั่งซื้อ" (G1b · migration 0192) · pure · office (owner/admin) เท่านั้น
//  - GemPurchaseSummary (action หลัก): ไม่มีฟิลด์ราคา/ต้นทุน แม้เป็น null — ประกอบทีละ field ห้าม spread (กันฟิลด์ใหม่จาก DB หลุดตามมาเอง)
//  - GemPurchaseCost (action แยก เรียกเมื่อเปิดสวิตช์ต้นทุนเท่านั้น): cost_*_thb ปัด 2 ตำแหน่งที่ DB แล้ว · null + missing_price = ยังไม่มีราคา (ไม่ใช่ 0)
//  - 🔴 ไฟล์นี้อยู่ใน PRICE_MODULES ของ gems-boundary.test.ts: หน้าช่าง/ใบพิมพ์/ฟอร์ม staff ห้ามลากเข้า bundle
//  - ยอด = "ที่ใบงานต้องใช้" (gross · ไม่หักพลอยที่มีในร้าน · ไม่เผื่อแตก) — ไม่ใช่ "ยอดที่ควรสั่ง"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** จำนวนเม็ด: จำนวนเต็มไม่ติดลบ — ไม่ผ่าน = null (ผู้เรียกทิ้งแถวนั้น ไม่เดาเป็น 0) */
const qty = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};
const isoDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** สูงสุดของ line_ids ต่อคำสั่งติ๊ก (ตรงกับ RPC gem_purchase_mark) */
export const GEM_PURCHASE_MAX_LINES = 200;

export interface GemPurchaseJob {
  jobId: string;
  jobNo: string;
  designLabel: string | null;
  dueDate: string | null;
  /** ยอดที่ใบนี้ต้องใช้ตอนนี้ (qty_per_piece × จำนวนเริ่มผลิต · ไม่เผื่อแตก) */
  qtyNeededNow: number;
  /** ยอดที่ติ๊กสั่งไว้ ณ ตอนติ๊ก (0 = ยังไม่ติ๊ก) */
  qtyOrdered: number;
  /** ที่เหลือ = max(ต้องใช้ − สั่งไว้, 0) */
  qtyRemaining: number;
  /** สั่งไว้เกินที่ต้องใช้ตอนนี้ (ใบลดจำนวนหลังสั่ง) */
  qtyExcess: number;
  isOrdered: boolean;
  /** ติ๊กไว้แล้วแต่ยอดใบเปลี่ยนหลังสั่ง */
  changedAfterOrder: boolean;
  orderedAt: string | null;
  /** id ผู้ติ๊ก (ไม่ใช่ชื่อ — ระบบไม่มีชื่อแสดงของผู้ใช้) */
  orderedBy: string | null;
  /** line ids ของใบนี้ในรายการนี้ (ส่งเข้า markGemPurchase) */
  lineIds: string[];
}

export interface GemPurchaseGroup {
  /** รายการจริงหลังตามการรวมชื่อ — คีย์ที่ใช้จับคู่กับ GemPurchaseCost */
  canonicalItemId: string;
  typeId: string;
  typeName: string;
  shapeId: string;
  shapeName: string;
  sizeA: number;
  sizeB: number | null;
  sizeLabel: string;
  label: string;
  qtyNeededNow: number;
  qtyOrdered: number;
  qtyRemaining: number;
  qtyExcess: number;
  jobCount: number;
  earliestDue: string | null;
  /** เฉพาะใบที่ยังมียอดเหลือ */
  earliestDueRemaining: string | null;
  lineIds: string[];
  jobs: GemPurchaseJob[];
}

export interface GemPurchaseUnspecifiedJob {
  jobId: string;
  jobNo: string;
  designLabel: string | null;
  dueDate: string | null;
}

/**
 * แถวที่เคยติ๊ก "สั่งแล้ว" แล้วถูกลบตอนแก้พลอยของใบ (ใบยังเปิดอยู่) — ถ้าเพิ่มรายการกลับ แถวใหม่ไม่มีติ๊ก เสี่ยงสั่งซ้ำ → จอเตือน
 * (หายเองเมื่อใบนั้นมีแถวรายการเดียวกันที่ติ๊กแล้ว) · ไม่มีราคา
 */
export interface GemPurchaseRemovedAfterOrder {
  jobId: string;
  jobNo: string;
  canonicalItemId: string;
  /** ฉลากปัจจุบันของรายการ (null = รายการถูกลบจากแคตตาล็อกแล้ว) */
  label: string | null;
  /** ยอดที่ติ๊กสั่งไว้ของแถวที่ถูกลบ */
  qty: number;
  removedAt: string | null;
}

export interface GemPurchaseTotals {
  groups: number;
  jobs: number;
  qtyNeededNow: number;
  qtyOrdered: number;
  qtyRemaining: number;
  qtyExcess: number;
  unspecifiedJobs: number;
}

export interface GemPurchaseSummary {
  /** เวลาไทยจาก DB (ISO +07:00) — ป้าย "ข้อมูล ณ" ห้ามใช้นาฬิกา client */
  serverNow: string;
  todayBkk: string;
  groups: GemPurchaseGroup[];
  /** ใบเปิด + ขั้นฝังยังไม่รับ + ไม่มีแถวพลอย — แสดงเตือนเสมอ แม้ groups ว่าง */
  unspecifiedJobs: GemPurchaseUnspecifiedJob[];
  /** ติ๊กแล้วแถวถูกลบ (เตือนสั่งซ้ำ) — แสดงเสมอ แม้ groups ว่าง */
  removedAfterOrder: GemPurchaseRemovedAfterOrder[];
  totals: GemPurchaseTotals;
}

const uuidList = (v: unknown, max = 500): string[] => (Array.isArray(v) ? v.flatMap((x) => { const u = uuid(x); return u ? [u] : []; }).slice(0, max) : []);

function mapJob(raw: unknown): GemPurchaseJob | null {
  if (!isObj(raw)) return null;
  const jobId = uuid(raw.job_id);
  const jobNo = str(raw.job_no, 20);
  const needed = qty(raw.qty_needed_now);
  const ordered = qty(raw.qty_ordered);
  const remaining = qty(raw.qty_remaining);
  const excess = qty(raw.qty_excess);
  if (!jobId || !jobNo || needed === null || ordered === null || remaining === null || excess === null) return null;
  return {
    jobId,
    jobNo,
    designLabel: str(raw.design_label, 200),
    dueDate: isoDate(raw.due_date),
    qtyNeededNow: needed,
    qtyOrdered: ordered,
    qtyRemaining: remaining,
    qtyExcess: excess,
    isOrdered: raw.is_ordered === true,
    changedAfterOrder: raw.changed_after_order === true,
    orderedAt: str(raw.ordered_at, 40),
    orderedBy: uuid(raw.ordered_by),
    lineIds: uuidList(raw.line_ids, 30),
  };
}

function mapGroup(raw: unknown): GemPurchaseGroup | null {
  if (!isObj(raw)) return null;
  const canonicalItemId = uuid(raw.canonical_item_id);
  const typeId = uuid(raw.type_id);
  const shapeId = uuid(raw.shape_id);
  const typeName = str(raw.type_name, 80);
  const shapeName = str(raw.shape_name, 80);
  const sizeLabel = str(raw.size_label, 20);
  const label = str(raw.label, 200);
  const sizeA = num(raw.size_a);
  const needed = qty(raw.qty_needed_now);
  const ordered = qty(raw.qty_ordered);
  const remaining = qty(raw.qty_remaining);
  const excess = qty(raw.qty_excess);
  const jobCount = qty(raw.job_count);
  if (!canonicalItemId || !typeId || !shapeId || !typeName || !shapeName || !sizeLabel || !label || sizeA === null
    || needed === null || ordered === null || remaining === null || excess === null || jobCount === null) return null;
  const jobs = (Array.isArray(raw.jobs) ? raw.jobs : []).map(mapJob).filter((j): j is GemPurchaseJob => j !== null);
  // ใบในกลุ่มแปลงไม่ได้สักใบ/ไม่ครบ = ทิ้งกลุ่มนี้ (ไม่แสดงยอดที่ตรวจที่มาไม่ได้)
  if (jobs.length !== (Array.isArray(raw.jobs) ? raw.jobs.length : 0) || jobs.length === 0) return null;
  return {
    canonicalItemId,
    typeId,
    typeName,
    shapeId,
    shapeName,
    sizeA,
    sizeB: num(raw.size_b),
    sizeLabel,
    label,
    qtyNeededNow: needed,
    qtyOrdered: ordered,
    qtyRemaining: remaining,
    qtyExcess: excess,
    jobCount,
    earliestDue: isoDate(raw.earliest_due),
    earliestDueRemaining: isoDate(raw.earliest_due_remaining),
    lineIds: uuidList(raw.line_ids),
    jobs,
  };
}

/**
 * ผลของ gem_purchase_summary → GemPurchaseSummary · รูปไม่ถูกต้อง = null
 * กลุ่ม/ใบที่แปลงไม่ได้ = null ทั้งก้อน (ไม่ทิ้งเงียบแล้วแสดงยอดที่ขาด — "ยอดไม่ครบ" อันตรายกว่า "โหลดไม่ได้")
 */
export function mapGemPurchaseSummary(raw: unknown): GemPurchaseSummary | null {
  if (!isObj(raw) || !Array.isArray(raw.groups) || !Array.isArray(raw.unspecified_jobs) || !Array.isArray(raw.removed_after_order) || !isObj(raw.totals)) return null;
  const serverNow = str(raw.server_now, 40);
  const todayBkk = isoDate(raw.today_bkk);
  if (!serverNow || !todayBkk) return null;
  const groups = raw.groups.map(mapGroup);
  if (groups.some((g) => g === null)) return null;
  const unspecified: GemPurchaseUnspecifiedJob[] = [];
  for (const u of raw.unspecified_jobs) {
    if (!isObj(u)) return null;
    const jobId = uuid(u.job_id);
    const jobNo = str(u.job_no, 20);
    if (!jobId || !jobNo) return null;
    unspecified.push({ jobId, jobNo, designLabel: str(u.design_label, 200), dueDate: isoDate(u.due_date) });
  }
  const removed: GemPurchaseRemovedAfterOrder[] = [];
  for (const e of raw.removed_after_order) {
    if (!isObj(e)) return null;
    const jobId = uuid(e.job_id), jobNo = str(e.job_no, 20), canonicalItemId = uuid(e.canonical_item_id), q = qty(e.qty);
    if (!jobId || !jobNo || !canonicalItemId || q === null || q < 1) return null;
    removed.push({ jobId, jobNo, canonicalItemId, label: str(e.label, 200), qty: q, removedAt: str(e.removed_at, 40) });
  }
  const t = raw.totals;
  const tg = qty(t.groups), tj = qty(t.jobs), tn = qty(t.qty_needed_now), to = qty(t.qty_ordered), tr = qty(t.qty_remaining), te = qty(t.qty_excess), tu = qty(t.unspecified_jobs);
  if (tg === null || tj === null || tn === null || to === null || tr === null || te === null || tu === null) return null;
  return {
    serverNow,
    todayBkk,
    groups: groups as GemPurchaseGroup[],
    unspecifiedJobs: unspecified,
    removedAfterOrder: removed,
    totals: { groups: tg, jobs: tj, qtyNeededNow: tn, qtyOrdered: to, qtyRemaining: tr, qtyExcess: te, unspecifiedJobs: tu },
  };
}

// ---------------------------------------------------------------------------
// ติ๊ก "สั่งแล้ว"
// ---------------------------------------------------------------------------
export interface GemPurchaseMarkedLine {
  lineId: string;
  jobId: string;
  jobNo: string;
  canonicalItemId: string;
  isOrdered: boolean;
  qtyNeededNow: number;
  qtyOrdered: number;
  qtyRemaining: number;
  qtyExcess: number;
  changedAfterOrder: boolean;
}

export interface GemPurchaseMarkResult {
  requested: number;
  /** แถวที่ค่าเปลี่ยนจริง (ส่งซ้ำ = 0) */
  changed: number;
  unchanged: number;
  ordered: boolean;
  /** สถานะสดของทุกแถวที่ส่งมา */
  lines: GemPurchaseMarkedLine[];
}

export function mapGemPurchaseMark(raw: unknown): GemPurchaseMarkResult | null {
  if (!isObj(raw) || typeof raw.ordered !== "boolean" || !Array.isArray(raw.lines)) return null;
  const requested = qty(raw.requested), changed = qty(raw.changed), unchanged = qty(raw.unchanged);
  if (requested === null || changed === null || unchanged === null) return null;
  const lines: GemPurchaseMarkedLine[] = [];
  for (const l of raw.lines) {
    if (!isObj(l)) return null;
    const lineId = uuid(l.line_id), jobId = uuid(l.job_id), jobNo = str(l.job_no, 20), canonicalItemId = uuid(l.canonical_item_id);
    const needed = qty(l.qty_needed_now), ordered = qty(l.qty_ordered), remaining = qty(l.qty_remaining), excess = qty(l.qty_excess);
    if (!lineId || !jobId || !jobNo || !canonicalItemId || needed === null || ordered === null || remaining === null || excess === null) return null;
    lines.push({ lineId, jobId, jobNo, canonicalItemId, isOrdered: l.is_ordered === true, qtyNeededNow: needed, qtyOrdered: ordered, qtyRemaining: remaining, qtyExcess: excess, changedAfterOrder: l.changed_after_order === true });
  }
  return { requested, changed, unchanged, ordered: raw.ordered, lines };
}

// ---------------------------------------------------------------------------
// ต้นทุนประมาณ — 🔴 owner/admin เท่านั้น · action แยก
// ---------------------------------------------------------------------------
export interface GemPurchaseCostGroup {
  canonicalItemId: string;
  qtyRemaining: number;
  qtyOrdered: number;
  /** บาท ปัด 2 ตำแหน่งที่ DB · null = ส่วนนี้มีแถวไม่มีราคา (ไม่ใช่ 0) */
  costRemainingThb: number | null;
  costOrderedThb: number | null;
  missingPriceRemaining: boolean;
  missingPriceOrdered: boolean;
  missingPrice: boolean;
}

export interface GemPurchaseCost {
  todayBkk: string;
  groups: GemPurchaseCostGroup[];
  totals: {
    groups: number;
    groupsMissingPrice: number;
    /** ผลรวมของค่าที่ปัดแล้วของกลุ่มที่ราคาครบ (ไม่นับกลุ่มที่ null) */
    costRemainingThb: number;
    costOrderedThb: number;
    /** false = มีกลุ่มที่ยังไม่มีราคา → ยอดรวมนี้ไม่ใช่ต้นทุนเต็ม */
    complete: boolean;
  };
}

export function mapGemPurchaseCost(raw: unknown): GemPurchaseCost | null {
  if (!isObj(raw) || !Array.isArray(raw.groups) || !isObj(raw.totals)) return null;
  const todayBkk = isoDate(raw.today_bkk);
  if (!todayBkk) return null;
  const groups: GemPurchaseCostGroup[] = [];
  for (const g of raw.groups) {
    if (!isObj(g)) return null;
    const canonicalItemId = uuid(g.canonical_item_id);
    const qr = qty(g.qty_remaining), qo = qty(g.qty_ordered);
    if (!canonicalItemId || qr === null || qo === null) return null;
    const missRem = g.missing_price_remaining === true, missOrd = g.missing_price_ordered === true;
    const costRem = num(g.cost_remaining_thb), costOrd = num(g.cost_ordered_thb);
    // ค่ากับธง "ไม่มีราคา" ต้องสอดคล้องกัน — ขัดกัน = ผลผิดรูป (ไม่เดาว่าอันไหนจริง)
    if ((missRem && costRem !== null) || (!missRem && costRem === null) || (missOrd && costOrd !== null) || (!missOrd && costOrd === null)) return null;
    if ((costRem !== null && costRem < 0) || (costOrd !== null && costOrd < 0)) return null;
    groups.push({ canonicalItemId, qtyRemaining: qr, qtyOrdered: qo, costRemainingThb: costRem, costOrderedThb: costOrd, missingPriceRemaining: missRem, missingPriceOrdered: missOrd, missingPrice: g.missing_price === true });
  }
  const t = raw.totals;
  const tg = qty(t.groups), tm = qty(t.groups_missing_price), cr = num(t.cost_remaining_thb), co = num(t.cost_ordered_thb);
  if (tg === null || tm === null || cr === null || co === null || typeof t.complete !== "boolean" || cr < 0 || co < 0) return null;
  return { todayBkk, groups, totals: { groups: tg, groupsMissingPrice: tm, costRemainingThb: cr, costOrderedThb: co, complete: t.complete } };
}
