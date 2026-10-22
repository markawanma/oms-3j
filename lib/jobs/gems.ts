// lib/jobs/gems.ts — ชนิดข้อมูล + ตัวแปลงของระบบพลอย G1a (pure · ไม่ import server-only — ใช้ได้ทั้ง action ออฟฟิศ หน้าช่าง และเทสต์)
//  - toWireGemLines: แถวพลอยจาก client (camelCase · ไม่น่าเชื่อ) → แถวส่ง RPC (snake_case) ผ่าน allowlist เข้ม — key แปลก (price · cost ฯลฯ) = ปฏิเสธ ไม่ถูกทิ้งเงียบ (DB ปฏิเสธซ้ำ line_invalid)
//  - parseGemRpcError: error ของ RPC พลอย (22023 + hint + detail json) → {code, row, field, similar[]} ให้หน้าจอพากลับแถว/ช่องที่ผิด · รูปร่างตรวจเข้ม (detail มาจาก DB แต่ผ่านด่านซ้ำ)
//  - mapper ของผลลัพธ์: ไม่มีราคาในทุก type ยกเว้น GemCatalogItem (หน้า /oem/gems — ออฟฟิศ owner/admin เท่านั้น)
// 🔴 ราคาพลอย = ต้นทุน: type อื่นนอกจาก GemCatalogItem/GemPriceRow ห้ามมีฟิลด์ราคา (เทสต์ gems.test.ts ล็อก key)

export const GEM_KINDS = ["type", "shape", "item"] as const;
export type GemKind = (typeof GEM_KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

// ---------------------------------------------------------------------------
// แถวพลอยที่ส่งเข้า RPC
// ---------------------------------------------------------------------------
/** แถวจากฟอร์ม: ชนิด/รูปทรงเลือก (id) หรือพิมพ์ใหม่ · หรือระบุรายการตรง (gemItemId) · ไม่มีราคา/ต้นทุน/เผื่อแตก */
export interface GemLineInput {
  typeId?: string | null;
  newTypeName?: string | null;
  shapeId?: string | null;
  newShape?: { name: string; hasLength: boolean } | null;
  gemItemId?: string | null;
  sizeA?: number | string | null;
  sizeB?: number | string | null;
  qtyPerPiece?: number | string | null;
  position?: string | null;
}

const LINE_KEYS: ReadonlySet<string> = new Set(["typeId", "newTypeName", "shapeId", "newShape", "gemItemId", "sizeA", "sizeB", "qtyPerPiece", "position"]);

export type WireResult = { ok: true; value: Record<string, unknown>[] } | { ok: false; error: string; code: string; row: number | null; field: string | null };
const wireBad = (error: string, code: string, row: number | null = null, field: string | null = null): WireResult => ({ ok: false, error, code, row, field });

/** แถวพลอย (ไม่น่าเชื่อ) → payload ของ RPC · ตรวจรูปร่างเท่านั้น (ช่วงค่า/ชื่อ/ขนาดให้ DB ตัดสิน — ด่านจริง) */
export function toWireGemLines(raw: unknown): WireResult {
  if (!Array.isArray(raw)) return wireBad("รายการพลอยต้องเป็นรายการ — ส่งรายการว่างถ้าไม่มีพลอย", "lines_invalid");
  if (raw.length > 30) return wireBad("พลอยต่อใบมีได้ไม่เกิน 30 รายการ", "too_many_lines", 31);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = i + 1;
    const l = raw[i];
    if (!isObj(l)) return wireBad("แถวพลอยไม่ถูกต้อง", "line_invalid", row);
    for (const k of Object.keys(l)) {
      if (!LINE_KEYS.has(k)) return wireBad("แถวพลอยมีข้อมูลที่ไม่รองรับ", "line_invalid", row, k);
    }
    const w: Record<string, unknown> = {};
    const present = (k: keyof GemLineInput) => l[k] !== undefined && l[k] !== null;
    for (const [k, wk] of [["typeId", "type_id"], ["shapeId", "shape_id"], ["gemItemId", "gem_item_id"]] as const) {
      if (!present(k)) continue;
      if (typeof l[k] !== "string") return wireBad("รหัสในแถวพลอยไม่ถูกต้อง", "line_invalid", row, k);
      w[wk] = l[k]; // รูปแบบ uuid ให้ DB ตัดสิน (รหัสไม่ถูกต้อง = gem_type_invalid ฯลฯ ที่ช่องนั้น)
    }
    if (present("newTypeName")) {
      if (typeof l.newTypeName !== "string" || l.newTypeName.length > 200) return wireBad("ชื่อชนิดพลอยไม่ถูกต้อง", "name_invalid", row, "type");
      w.new_type_name = l.newTypeName;
    }
    if (present("newShape")) {
      const s = l.newShape;
      if (!isObj(s) || Object.keys(s).some((k) => k !== "name" && k !== "hasLength") || typeof s.name !== "string" || s.name.length > 200 || typeof s.hasLength !== "boolean") {
        return wireBad("รูปทรงใหม่ต้องระบุชื่อและจำนวนค่าขนาด (1 หรือ 2 ค่า)", "shape_new_invalid", row, "shape");
      }
      w.new_shape = { name: s.name, has_length: s.hasLength };
    }
    for (const [k, wk] of [["sizeA", "size_a"], ["sizeB", "size_b"]] as const) {
      if (!present(k)) continue;
      const v = l[k];
      if (typeof v === "number") {
        if (!Number.isFinite(v)) return wireBad("ขนาดไม่ถูกต้อง", "size_invalid", row, wk);
        w[wk] = v;
      } else if (typeof v === "string" && v.length <= 20) {
        w[wk] = v.trim().replace(",", ".");
      } else {
        return wireBad("ขนาดไม่ถูกต้อง", "size_invalid", row, wk);
      }
    }
    if (present("qtyPerPiece")) {
      const q = l.qtyPerPiece;
      if (typeof q === "number" && Number.isFinite(q)) w.qty_per_piece = q;
      else if (typeof q === "string" && /^\d{1,6}$/.test(q.trim())) w.qty_per_piece = Number(q.trim());
      else return wireBad("จำนวนต่อชิ้นต้องเป็นเลขเต็ม 1–1,000", "qty_invalid", row, "qty_per_piece");
    }
    if (present("position")) {
      if (typeof l.position !== "string" || l.position.length > 100) return wireBad("ตำแหน่งไม่ถูกต้อง", "position_invalid", row, "position");
      w.position = l.position;
    }
    out.push(w);
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// error ของ RPC พลอย
// ---------------------------------------------------------------------------
export interface GemSimilarHit {
  kind: "type" | "shape";
  name: string;
  /** แถวที่พิมพ์ชื่อนี้ (ว่าง = สร้าง/เปลี่ยนชื่อตรงๆ ไม่มีแถว) */
  rows: number[];
  /** ชื่อที่มีอยู่ (id = null = ชื่อใหม่อีกตัวในคำขอเดียวกัน) */
  matches: { id: string | null; name: string }[];
}

export interface GemErrorInfo {
  code: string;
  /** แถวที่ผิด (1-based) — มีเฉพาะ error ของแถวพลอย */
  row?: number;
  /** ช่องที่ผิด: type · shape · size_a · size_b · qty_per_piece · position · gem_item_id · line · lines ฯลฯ */
  field?: string;
  similar?: GemSimilarHit[];
  /** name_exists: ชื่อที่ชนอยู่ */
  existing?: { id: string; name: string };
  /** gem_in_use: จำนวนที่ใช้อยู่ */
  usage?: Record<string, number>;
}

/** hint ของ RPC พลอย (migration 0190) — ใช้กรองว่า error นี้เป็นของพลอย */
export const GEM_HINTS: ReadonlySet<string> = new Set([
  "line_invalid", "lines_invalid", "too_many_lines", "qty_invalid", "size_invalid", "size_required", "size_b_required", "size_b_unexpected", "size_b_mismatch",
  "type_required", "shape_required", "gem_type_invalid", "gem_shape_invalid", "gem_item_invalid", "gem_inactive", "name_invalid", "gem_name_invalid", "shape_new_invalid", "position_invalid",
  "gem_similar", "name_exists", "reason_required", "reason_invalid", "gem_in_use", "gem_merged_locked", "gem_merge_self", "gem_merge_from_merged", "gem_merge_into_merged",
  "gem_merge_into_inactive", "gem_merge_invalid", "has_length_mismatch", "has_length_locked", "merge_qty_overflow", "price_invalid", "date_invalid", "text_invalid",
  "gem_actor_forbidden", "gem_not_found", "no_product", "lot_no_gems", "gem_product_invalid", "gem_ref_inactive", "kind_invalid",
]);

/** ข้อความสำรอง (ไทย) เมื่อข้อความ DB ไม่สะอาด — ไม่มีตัวเลขเงิน/ชื่อตาราง */
export const GEM_ERROR_TH: Record<string, string> = {
  line_invalid: "แถวพลอยไม่ถูกต้อง",
  lines_invalid: "รายการพลอยไม่ถูกต้อง",
  too_many_lines: "พลอยต่อใบมีได้ไม่เกิน 30 รายการ",
  qty_invalid: "จำนวนต่อชิ้นต้องเป็นเลข 1–1,000",
  size_invalid: "ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)",
  size_required: "ใส่ขนาด (มม.)",
  size_b_required: "ใส่ทั้งกว้างและยาว (มม.)",
  size_b_unexpected: "รูปทรงนี้ใส่ขนาดค่าเดียว — ไม่ต้องใส่ด้านที่สอง",
  size_b_mismatch: "จำนวนค่าขนาดไม่ตรงกับรูปทรง",
  type_required: "เลือกหรือพิมพ์ชนิดพลอย",
  shape_required: "เลือกหรือพิมพ์รูปทรง",
  gem_type_invalid: "ไม่พบชนิดพลอยที่เลือก",
  gem_shape_invalid: "ไม่พบรูปทรงที่เลือก",
  gem_item_invalid: "ไม่พบรายการพลอยที่เลือก",
  gem_inactive: "รายการนี้ถูกปิดใช้งานแล้ว — เลือกอย่างอื่น หรือแจ้งออฟฟิศ",
  name_invalid: "ชื่อต้องมี 2-40 ตัวอักษร ไม่ใช่ตัวเลขล้วน และห้ามมีเครื่องหมาย < >",
  gem_name_invalid: "ชื่อต้องมี 2-40 ตัวอักษร ไม่ใช่ตัวเลขล้วน และห้ามมีเครื่องหมาย < >",
  shape_new_invalid: "รูปทรงใหม่ต้องระบุชื่อและจำนวนค่าขนาด (1 หรือ 2 ค่า)",
  position_invalid: "ตำแหน่งต้องไม่เกิน 40 ตัวอักษรและห้ามมีเครื่องหมาย < >",
  gem_similar: "พบชื่อที่คล้ายกับที่มีอยู่แล้ว — ใช้ตัวที่มี หรือยืนยันเพิ่มเป็นชื่อใหม่",
  name_exists: "มีชื่อนี้อยู่แล้ว — ใช้ตัวที่มี",
  reason_required: "ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง",
  reason_invalid: "เหตุผลยาวเกิน 300 ตัวอักษร",
  gem_in_use: "ลบไม่ได้ — ถูกใช้อยู่ (ปิดใช้งานแทนได้)",
  gem_merged_locked: "รายการนี้ถูกรวมแล้ว แก้ไม่ได้ (ย้อนกลับไม่ได้)",
  gem_merge_self: "รวมชื่อเข้ากับตัวเองไม่ได้",
  gem_merge_from_merged: "ชื่อที่จะเลิกใช้ถูกรวมไปแล้ว",
  gem_merge_into_merged: "ชื่อปลายทางถูกรวมไปที่อื่นแล้ว — เลือกตัวจริง",
  gem_merge_into_inactive: "ชื่อปลายทางปิดใช้งานอยู่ — เปิดใช้ก่อนรวม",
  gem_merge_invalid: "รวมชื่อไม่ได้ — ตรวจชื่อที่เลือก",
  has_length_mismatch: "รวมรูปทรงที่ใส่ขนาดจำนวนค่าต่างกันไม่ได้ (1 ค่า กับ 2 ค่า)",
  has_length_locked: "แก้จำนวนค่าขนาดของรูปทรงนี้ไม่ได้ — มีรายการพลอยใช้อยู่แล้ว",
  merge_qty_overflow: "รวมแล้วแม่แบบ SKU บางตัวมีจำนวนต่อชิ้นเกิน 1,000 — แก้แม่แบบเหล่านั้นก่อนรวม",
  price_invalid: "ราคาต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท (ทศนิยมไม่เกิน 4 ตำแหน่ง)",
  date_invalid: "วันที่มีผลต้องอยู่ระหว่างปี 2020 ถึงไม่เกิน 1 ปีข้างหน้า",
  text_invalid: "ผู้ขาย/หมายเหตุต้องมีตัวอักษรหรือตัวเลขจริง และห้ามมีเครื่องหมาย < >",
  gem_actor_forbidden: "แคตตาล็อกพลอยและราคาใช้ได้เฉพาะเจ้าของร้าน/แอดมิน",
  gem_not_found: "ไม่พบรายการนี้",
  no_product: "ใบนี้ไม่มี SKU — ตั้งเป็นแม่แบบไม่ได้",
  lot_no_gems: "ส่วนย่อยไม่มีพลอยของตัวเอง — พลอยอยู่ที่ใบแม่",
  gem_product_invalid: "ไม่พบ SKU ในร้านนี้",
  gem_ref_inactive: "รายการพลอยปิดใช้งาน/ถูกรวม/ไม่พบ — เลือกรายการอื่น",
  kind_invalid: "ชนิดข้อมูลไม่ถูกต้อง",
};

const FIELD_RE = /^[a-z][a-z_]{0,30}$/;

function mapSimilar(raw: unknown): GemSimilarHit[] {
  if (!Array.isArray(raw)) return [];
  const out: GemSimilarHit[] = [];
  for (const h of raw.slice(0, 20)) {
    if (!isObj(h) || (h.kind !== "type" && h.kind !== "shape")) continue;
    const name = str(h.name, 80);
    if (!name) continue;
    const rows = (Array.isArray(h.rows) ? h.rows : []).map(int).filter((n): n is number => n !== null && n >= 1 && n <= 31).slice(0, 31);
    const matches = (Array.isArray(h.matches) ? h.matches : []).flatMap((m): { id: string | null; name: string }[] => {
      if (!isObj(m)) return [];
      const n = str(m.name, 80);
      return n ? [{ id: uuid(m.id), name: n }] : [];
    });
    out.push({ kind: h.kind, name, rows, matches: matches.slice(0, 5) });
  }
  return out;
}

/** error ของ RPC (PostgrestError) → ข้อมูลโครงสร้าง · ไม่ใช่ error ของพลอย (hint ไม่อยู่ใน GEM_HINTS) = null · detail ที่รูปร่างผิด = ไม่ใส่ (คง code) */
export function parseGemRpcError(err: unknown): GemErrorInfo | null {
  if (!isObj(err)) return null;
  const hint = typeof err.hint === "string" ? err.hint : null;
  if (!hint || !GEM_HINTS.has(hint) || (err.code !== "22023" && err.code !== "42501")) return null;
  const info: GemErrorInfo = { code: hint };
  let d: unknown = null;
  if (typeof err.details === "string" && err.details.length <= 4000) {
    try {
      d = JSON.parse(err.details);
    } catch {
      d = null;
    }
  }
  if (!isObj(d)) return info;
  const row = int(d.row);
  if (row !== null && row >= 0 && row <= 31) info.row = row;
  if (typeof d.field === "string" && FIELD_RE.test(d.field)) info.field = d.field;
  if (Array.isArray(d.similar)) {
    const similar = mapSimilar(d.similar);
    if (similar.length > 0) info.similar = similar;
  }
  const id = uuid(d.id);
  const nm = str(d.name, 80);
  if (id && nm) info.existing = { id, name: nm };
  const usage: Record<string, number> = {};
  for (const k of ["items", "templates", "jobs", "merged_refs"]) {
    const n = int(d[k]);
    if (n !== null && n >= 0 && n <= 1e9) usage[k] = n;
  }
  if (Object.keys(usage).length > 0) info.usage = usage;
  return info;
}

// ---------------------------------------------------------------------------
// ผลลัพธ์ของ RPC (ไม่มีราคา ยกเว้น catalog/price)
// ---------------------------------------------------------------------------
export interface GemOptionType { id: string; name: string }
export interface GemOptionShape { id: string; name: string; hasLength: boolean }
export interface GemOptionItem { gemItemId: string; typeId: string; shapeId: string; sizeA: number; sizeB: number | null; sizeLabel: string }
export interface GemOptions { types: GemOptionType[]; shapes: GemOptionShape[]; items: GemOptionItem[] }

export function mapGemOptions(raw: unknown): GemOptions | null {
  if (!isObj(raw)) return null;
  const types = (Array.isArray(raw.types) ? raw.types : []).flatMap((t): GemOptionType[] => (isObj(t) && uuid(t.id) && str(t.name, 80) ? [{ id: uuid(t.id) as string, name: str(t.name, 80) as string }] : [])).slice(0, 2000);
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : []).flatMap((s): GemOptionShape[] => (isObj(s) && uuid(s.id) && str(s.name, 80) ? [{ id: uuid(s.id) as string, name: str(s.name, 80) as string, hasLength: s.has_length === true }] : [])).slice(0, 2000);
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((i): GemOptionItem[] => {
    if (!isObj(i)) return [];
    const id = uuid(i.gem_item_id), t = uuid(i.type_id), s = uuid(i.shape_id), a = num(i.size_a), label = str(i.size_label, 20);
    return id && t && s && a !== null && label ? [{ gemItemId: id, typeId: t, shapeId: s, sizeA: a, sizeB: num(i.size_b), sizeLabel: label }] : [];
  }).slice(0, 3000);
  return { types, shapes, items };
}

/** แถวพลอยของใบ/แม่แบบ (ไม่มีราคา) */
export interface GemBomLine {
  /** id แถว job_gem_bom (แม่แบบไม่มี) */
  id: string | null;
  gemItemId: string;
  /** รายการจริงหลังตามการรวมชื่อ (ใช้จับกลุ่ม/ส่งกลับ) · แม่แบบ = เท่ากับ gemItemId */
  canonicalItemId: string;
  /** ฉลาก snapshot ณ ตอนสั่ง (ใบ) หรือฉลากปัจจุบัน (แม่แบบ) */
  label: string;
  qtyPerPiece: number;
  qtyTotal: number | null;
  position: string | null;
  source: "product" | "manual" | "shopfloor" | null;
  /** ชื่อปัจจุบันในแคตตาล็อกต่างจากฉลาก snapshot (ถูกเปลี่ยนชื่อ/รวมทีหลัง) */
  renamed: boolean;
  via: "office" | "shopfloor" | null;
}

export function mapGemBomLine(raw: unknown): GemBomLine | null {
  if (!isObj(raw)) return null;
  const gemItemId = uuid(raw.gem_item_id);
  const label = str(raw.label, 200);
  const qty = int(raw.qty_per_piece);
  if (!gemItemId || !label || qty === null) return null;
  const src = raw.source;
  const via = raw.via;
  return {
    id: uuid(raw.id),
    gemItemId,
    canonicalItemId: uuid(raw.canonical_item_id) ?? gemItemId,
    label,
    qtyPerPiece: qty,
    qtyTotal: num(raw.qty_total),
    position: str(raw.position, 40),
    source: src === "product" || src === "manual" || src === "shopfloor" ? src : null,
    renamed: raw.renamed === true,
    via: via === "office" || via === "shopfloor" ? via : null,
  };
}

export type GemsState = "not_needed" | "specified" | "unspecified";
export type GemEditWindow = "free_before_start" | "office_free" | "reason_required" | "closed";

export interface GemHistoryRow {
  at: string | null;
  phase: string | null;
  source: string | null;
  reason: string | null;
  before: { label: string; qtyPerPiece: number; position: string | null }[];
  after: { label: string; qtyPerPiece: number; position: string | null }[];
}

export interface JobGems {
  jobId: string;
  jobNo: string;
  qtyPlanned: number;
  window: GemEditWindow;
  state: GemsState;
  /** pending | started | skipped | none (ไม่มีขั้นฝังในใบ) */
  gemStage: "none" | "pending" | "started" | "skipped";
  lines: GemBomLine[];
  /** แม่แบบของ SKU (null = ใบไม่มี SKU) */
  template: GemBomLine[] | null;
  /** null = ไม่มีแม่แบบให้เทียบ */
  differsFromTemplate: boolean | null;
  history: GemHistoryRow[];
}

const WINDOWS: readonly GemEditWindow[] = ["free_before_start", "office_free", "reason_required", "closed"];
const mapHistLines = (v: unknown): GemHistoryRow["before"] =>
  (Array.isArray(v) ? v : []).flatMap((x) => {
    if (!isObj(x)) return [];
    const label = str(x.label, 200);
    const q = int(x.qty_per_piece);
    return label && q !== null ? [{ label, qtyPerPiece: q, position: str(x.position, 40) }] : [];
  }).slice(0, 30);

/** ผลของ job_gem_bom_get → JobGems (ไม่มีราคา) · รูปไม่ถูกต้อง = null */
export function mapJobGems(raw: unknown): JobGems | null {
  if (!isObj(raw) || !isObj(raw.job)) return null;
  const jobId = uuid(raw.job.id);
  const jobNo = str(raw.job.job_no, 20);
  const qtyPlanned = int(raw.job.qty_planned);
  const win = raw.window;
  if (!jobId || !jobNo || qtyPlanned === null || typeof win !== "string" || !(WINDOWS as readonly string[]).includes(win)) return null;
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(mapGemBomLine).filter((l): l is GemBomLine => l !== null).slice(0, 30);
  const template = Array.isArray(raw.template) ? raw.template.map(mapGemBomLine).filter((l): l is GemBomLine => l !== null).slice(0, 30) : null;
  const gs = raw.gem_stage;
  const st = raw.state;
  return {
    jobId,
    jobNo,
    qtyPlanned,
    window: win as GemEditWindow,
    state: st === "specified" || st === "unspecified" ? st : "not_needed",
    gemStage: gs === "pending" || gs === "started" || gs === "skipped" ? gs : "none",
    lines,
    template,
    differsFromTemplate: typeof raw.differs_from_template === "boolean" ? raw.differs_from_template : null,
    history: (Array.isArray(raw.history) ? raw.history : []).flatMap((h): GemHistoryRow[] =>
      isObj(h) ? [{ at: str(h.at, 40), phase: str(h.phase, 30), source: str(h.source, 20), reason: str(h.reason, 300), before: mapHistLines(h.before), after: mapHistLines(h.after) }] : []).slice(0, 20),
  };
}

/** สรุปพลอยสำหรับใบพิมพ์ A5 / การ์ดใน getJobDetail — ประกอบทีละ field (ไม่มีราคา/เผื่อแตก/ผู้สร้าง/ที่มา) */
export interface PrintGem {
  label: string;
  qtyPerPiece: number;
  qtyTotal: number;
  position: string | null;
}
export interface JobGemsSummary {
  state: GemsState;
  gems: PrintGem[];
}

// ---------------------------------------------------------------------------
// แคตตาล็อก (หน้า /oem/gems — owner/admin เท่านั้น) — ราคาอยู่เฉพาะ GemCatalogItem
// ---------------------------------------------------------------------------
export interface GemCatalogName {
  id: string;
  name: string;
  isActive: boolean;
  mergedInto: string | null;
  mergedIntoName: string | null;
  via: "office" | "shopfloor" | "seed";
  createdAt: string | null;
  itemCount: number;
  usedJobsOpen: number;
  usedTemplates: number;
  /** เฉพาะรูปทรง */
  hasLength?: boolean;
}

export interface GemCatalogItem {
  gemItemId: string;
  typeId: string;
  typeName: string;
  shapeId: string;
  shapeName: string;
  sizeA: number;
  sizeB: number | null;
  sizeLabel: string;
  label: string;
  isActive: boolean;
  mergedInto: string | null;
  via: "office" | "shopfloor";
  createdAt: string | null;
  /** 🔴 ราคาต่อเม็ด (THB) ณ วันนี้ — null = ยังไม่เคยตั้งราคา (ไม่ใช่ 0) */
  price: number | null;
  priceEffectiveFrom: string | null;
  priceSupplier: string | null;
  hasPrice: boolean;
  priceRows: number;
  usedJobsOpen: number;
  usedJobsTotal: number;
  usedTemplates: number;
}

export interface GemCatalog {
  types: GemCatalogName[];
  shapes: GemCatalogName[];
  items: GemCatalogItem[];
}

function mapName(raw: unknown, isShape: boolean): GemCatalogName | null {
  if (!isObj(raw)) return null;
  const id = uuid(raw.id);
  const name = str(raw.name, 80);
  if (!id || !name) return null;
  const via = raw.via === "shopfloor" || raw.via === "seed" ? raw.via : "office";
  const out: GemCatalogName = {
    id,
    name,
    isActive: raw.is_active === true,
    mergedInto: uuid(raw.merged_into),
    mergedIntoName: str(raw.merged_into_name, 80),
    via,
    createdAt: str(raw.created_at, 40),
    itemCount: int(raw.item_count) ?? 0,
    usedJobsOpen: int(raw.used_jobs_open) ?? 0,
    usedTemplates: int(raw.used_templates) ?? 0,
  };
  if (isShape) out.hasLength = raw.has_length === true;
  return out;
}

export function mapGemCatalog(raw: unknown): GemCatalog | null {
  if (!isObj(raw)) return null;
  const types = (Array.isArray(raw.types) ? raw.types : []).map((t) => mapName(t, false)).filter((t): t is GemCatalogName => t !== null).slice(0, 3000);
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : []).map((s) => mapName(s, true)).filter((s): s is GemCatalogName => s !== null).slice(0, 3000);
  const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((i): GemCatalogItem[] => {
    if (!isObj(i)) return [];
    const gemItemId = uuid(i.gem_item_id), typeId = uuid(i.type_id), shapeId = uuid(i.shape_id);
    const typeName = str(i.type_name, 80), shapeName = str(i.shape_name, 80), sizeLabel = str(i.size_label, 20), label = str(i.label, 200), a = num(i.size_a);
    if (!gemItemId || !typeId || !shapeId || !typeName || !shapeName || !sizeLabel || !label || a === null) return [];
    return [{
      gemItemId, typeId, typeName, shapeId, shapeName, sizeA: a, sizeB: num(i.size_b), sizeLabel, label,
      isActive: i.is_active === true, mergedInto: uuid(i.merged_into), via: i.via === "shopfloor" ? "shopfloor" : "office", createdAt: str(i.created_at, 40),
      price: num(i.price), priceEffectiveFrom: str(i.price_effective_from, 10), priceSupplier: str(i.price_supplier, 120), hasPrice: i.has_price === true,
      priceRows: int(i.price_rows) ?? 0, usedJobsOpen: int(i.used_jobs_open) ?? 0, usedJobsTotal: int(i.used_jobs_total) ?? 0, usedTemplates: int(i.used_templates) ?? 0,
    }];
  }).slice(0, 3000);
  return { types, shapes, items };
}

export interface GemPriceRow {
  effectiveFrom: string;
  price: number;
  supplier: string | null;
  note: string | null;
  updatedAt: string | null;
}

export function mapGemPriceHistory(raw: unknown): GemPriceRow[] | null {
  if (!isObj(raw) || !Array.isArray(raw.rows)) return null;
  return raw.rows.flatMap((r): GemPriceRow[] => {
    if (!isObj(r)) return [];
    const d = str(r.effective_from, 10);
    const p = num(r.price);
    return d && p !== null ? [{ effectiveFrom: d, price: p, supplier: str(r.supplier, 120), note: str(r.note, 300), updatedAt: str(r.updated_at, 40) }] : [];
  }).slice(0, 500);
}

export interface GemMergePlan {
  from: { id: string; name: string };
  into: { id: string; name: string };
  itemsMoved: number;
  itemsCollapsed: number;
  /** ราคาของรายการ A ที่ขนาดชนกับ B — "จะไม่ถูกย้าย" */
  pricesNotMoved: number;
  collapsedMissingPriceOnTarget: number;
  templateLinesRepointed: number;
  templateLinesSummed: number;
  jobsOpenUsing: number;
  jobsUsingTotal: number;
}

export function mapGemMergePlan(raw: unknown): GemMergePlan | null {
  if (!isObj(raw) || !isObj(raw.from) || !isObj(raw.into)) return null;
  const f = { id: uuid(raw.from.id), name: str(raw.from.name, 80) };
  const t = { id: uuid(raw.into.id), name: str(raw.into.name, 80) };
  if (!f.id || !f.name || !t.id || !t.name) return null;
  return {
    from: { id: f.id, name: f.name },
    into: { id: t.id, name: t.name },
    itemsMoved: int(raw.items_moved) ?? 0,
    itemsCollapsed: int(raw.items_collapsed) ?? 0,
    pricesNotMoved: int(raw.prices_not_moved) ?? 0,
    collapsedMissingPriceOnTarget: int(raw.collapsed_missing_price_on_target) ?? 0,
    templateLinesRepointed: int(raw.template_lines_repointed) ?? 0,
    templateLinesSummed: int(raw.template_lines_summed) ?? 0,
    jobsOpenUsing: int(raw.jobs_open_using) ?? 0,
    jobsUsingTotal: int(raw.jobs_using_total) ?? 0,
  };
}

/** ผลการบันทึกพลอย (job_gem_bom_set / product_gem_bom_set / ตอนสร้างใบ): ชื่อที่ DB สร้าง/ใช้ตัวเดิมให้ — จอแจ้ง "ใช้ตัวเดิมให้" */
export interface GemSaveSummary {
  changed: boolean;
  count: number;
  createdTypes: string[];
  createdShapes: string[];
  createdItems: number;
  reused: { row: number; kind: "type" | "shape"; typed: string; name: string }[];
  mergedRows: number[][];
}

export function mapGemSaveSummary(raw: unknown): GemSaveSummary | null {
  if (!isObj(raw)) return null;
  const s = isObj(raw.summary) ? raw.summary : {};
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (isObj(x) && str(x.name, 80) ? [str(x.name, 80) as string] : [])).slice(0, 30) : []);
  const reused = (Array.isArray(s.reused) ? s.reused : []).flatMap((x): GemSaveSummary["reused"] => {
    if (!isObj(x) || (x.kind !== "type" && x.kind !== "shape")) return [];
    const row = int(x.row), typed = str(x.typed, 80), name = str(x.name, 80);
    return row !== null && typed && name ? [{ row, kind: x.kind, typed, name }] : [];
  }).slice(0, 60);
  const mergedRows = (Array.isArray(s.merged_rows) ? s.merged_rows : []).flatMap((x): number[][] => (isObj(x) && Array.isArray(x.rows) ? [x.rows.map(int).filter((n): n is number => n !== null).slice(0, 31)] : [])).slice(0, 30);
  return {
    changed: raw.changed === true,
    count: int(raw.count) ?? 0,
    createdTypes: names(s.created_types),
    createdShapes: names(s.created_shapes),
    createdItems: Array.isArray(s.created_items) ? Math.min(s.created_items.length, 1000) : 0,
    reused,
    mergedRows,
  };
}
