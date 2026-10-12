// lib/jobs/input.ts — ตรวจ input ของ server action ระบบใบงาน (pure) — ตรวจชนิด/ช่วงก่อนถึง DB · DB ยังเป็นด่านจริงซ้ำ
// ทุกฟังก์ชัน: คืน { ok:true, value } | { ok:false, error(ไทย) } — ไม่ throw · ไม่รับ NaN/Infinity/ติดลบ/ทศนิยมเกิน

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T = never,>(error: string): Parsed<T> => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** น้ำหนักกรัม: ตัวเลข > 0 ≤ 100,000 ทศนิยมไม่เกิน 3 ตำแหน่ง · ว่าง = null (ไม่ได้กรอก) · "0" ไม่ผ่าน (DB: weight > 0) */
export function parseWeight(raw: unknown, label = "น้ำหนัก"): Parsed<number | null> {
  if (raw === null || raw === undefined) return ok(null);
  const t = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/,/g, "") : null;
  if (t === null) return bad(`${label}ไม่ถูกต้อง`);
  if (t === "") return ok(null);
  if (!/^\d+(?:\.\d{1,3})?$/.test(t)) return bad(`${label}ต้องเป็นตัวเลข ทศนิยมไม่เกิน 3 ตำแหน่ง`);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return bad(`${label}ต้องมากกว่า 0 และไม่เกิน 100,000 กรัม`);
  return ok(n);
}

/** น้ำหนักที่ 0 ได้ (เติมโลหะ): ว่าง/ไม่ส่ง = 0 */
export function parseWeightOrZero(raw: unknown, label: string): Parsed<number> {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return ok(0);
  const t = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  if (t === "0" || /^0(?:\.0{1,3})?$/.test(t)) return ok(0);
  const p = parseWeight(raw, label);
  if (!p.ok) return bad(p.error);
  return ok(p.value ?? 0);
}

/** จำนวนเต็ม 0..max (ของเสีย/จำนวนดี) */
export function parseCount(raw: unknown, label: string, max = 100000): Parsed<number> {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) return bad(`${label}ต้องเป็นจำนวนเต็ม 0–${max.toLocaleString("th-TH")}`);
  return ok(n);
}

export function parseSeq(raw: unknown): Parsed<number> {
  const n = typeof raw === "number" ? raw : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 100) return bad("ข้อมูลขั้นตอนไม่ถูกต้อง รีเฟรชแล้วลองใหม่");
  return ok(n);
}

/** วันที่ YYYY-MM-DD จริง (ปี 2025–2035) */
export function parseDate(raw: unknown, label = "วันที่"): Parsed<string> {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return bad(`${label}ไม่ถูกต้อง`);
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return bad(`${label}ไม่ถูกต้อง`);
  const y = Number(raw.slice(0, 4));
  if (y < 2025 || y > 2035) return bad(`${label}ไม่ถูกต้อง`);
  return ok(raw);
}

/** ข้อความอิสระ: ตัดช่องว่างหัวท้าย · ห้าม control char · ยาวไม่เกิน max · required = ต้องมีตัวอักษร */
export function parseText(raw: unknown, label: string, max: number, required: boolean): Parsed<string | null> {
  if (raw === null || raw === undefined) return required ? bad(`ต้องระบุ${label}`) : ok(null);
  if (typeof raw !== "string") return bad(`${label}ไม่ถูกต้อง`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return bad(`${label}มีอักขระที่ไม่รองรับ`);
  const t = raw.replace(/\s+/g, " ").trim();
  if (t === "") return required ? bad(`ต้องระบุ${label}`) : ok(null);
  if (t.length > max) return bad(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return ok(t);
}

/** PIN 4 หลัก — ตรวจรูปแบบเท่านั้น (เลขซ้ำ/เรียง/เดาง่ายให้ DB ปฏิเสธ — ข้อความไทยมาจาก hint pin_invalid) */
export function parsePin(raw: unknown): Parsed<string> {
  if (typeof raw !== "string" || !/^[0-9]{4}$/.test(raw)) return bad("PIN ต้องเป็นตัวเลข 4 หลัก");
  return ok(raw);
}

const STAGE_CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;
/** รายการรหัสขั้น: ไม่ว่าง (ถ้า allowEmpty=false) · ไม่ซ้ำ · รูปแบบ · ไม่เกิน 30 */
export function parseStageCodes(raw: unknown, allowEmpty: boolean): Parsed<string[]> {
  if (!Array.isArray(raw)) return bad("เลือกขั้นตอนไม่ถูกต้อง");
  if (raw.length > 30) return bad("เลือกขั้นตอนมากเกินไป");
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string" || !STAGE_CODE_RE.test(c)) return bad("รหัสขั้นตอนไม่ถูกต้อง");
    if (out.includes(c)) return bad("เลือกขั้นตอนซ้ำกัน");
    out.push(c);
  }
  if (!allowEmpty && out.length === 0) return bad("เลือกขั้นตอนอย่างน้อยหนึ่งขั้น");
  return ok(out);
}

export const SCRAP_REASON_CODES = ["porosity", "broken", "wrong_design", "missing", "other"] as const;
export function parseScrapReason(raw: unknown, qtyScrap: number): Parsed<string | null> {
  if (qtyScrap <= 0) return ok(null);
  if (typeof raw !== "string" || !(SCRAP_REASON_CODES as readonly string[]).includes(raw)) return bad("เลือกเหตุผลของเสีย");
  return ok(raw);
}
