// lib/jobs/input.ts — ตรวจ input ของ server action ระบบใบงาน (pure) — ตรวจชนิด/ช่วงก่อนถึง DB · DB ยังเป็นด่านจริงซ้ำ
// ทุกฟังก์ชัน: คืน { ok:true, value } | { ok:false, error(ไทย) } — ไม่ throw · ไม่รับ NaN/Infinity/ติดลบ/ทศนิยมเกิน

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T = never,>(error: string): Parsed<T> => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
/** idem key (16–64 ตัว [A-Za-z0-9_-]) — ที่เดียวของ action ช่าง/ชั้น server รูป/ฟอร์ม (shop-open.newIdemKey สร้างค่าที่ตรงรูปแบบนี้) */
export const IDEM_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * จุลภาคในช่องน้ำหนัก (BUG-J1-01: "95,5" เคยถูกตัดทิ้งเป็น 955 = ผิด 10 เท่าโดยไม่เตือน)
 * - จุลภาคตัวเดียวและไม่มีจุด = ทศนิยม ("95,5" -> "95.5") — แป้นพิมพ์มือถือไทย/ยุโรปพิมพ์ทศนิยมแบบนี้
 * - จุลภาคร่วมกับจุด ("1,234.5") หรือหลายจุลภาค ("1,234,5") = กำกวม ปฏิเสธ ไม่เดา
 */
export function normalizeWeightText(s: string): Parsed<string> {
  const commas = s.split(",").length - 1;
  if (commas === 0) return ok(s);
  if (commas === 1 && !s.includes(".")) return ok(s.replace(",", "."));
  return bad("รูปแบบน้ำหนักกำกวม — พิมพ์เป็นตัวเลขธรรมดา เช่น 95.5 (ไม่ต้องใส่จุลภาคคั่นหลักพัน)");
}

/** เพดานน้ำหนักเป้าหมายต่อชิ้น (g) ตาม CHECK job_target_piece_ck ของ DB (0175) — เล็กกว่าเพดานน้ำหนักทั่วไป (100,000) */
export const TARGET_PIECE_MAX_G = 10000;

/**
 * น้ำหนักกรัม: ตัวเลข > 0 ≤ opts.max (ค่าเริ่ม 100,000) ทศนิยมไม่เกิน 3 ตำแหน่ง · ว่าง = null (ไม่ได้กรอก) · "0" ไม่ผ่าน (DB: weight > 0)
 * opts.max = เพดานเฉพาะช่อง (เช่น TARGET_PIECE_MAX_G) — ไม่ส่ง = พฤติกรรมเดิมทุกช่องอื่น
 */
export function parseWeight(raw: unknown, label = "น้ำหนัก", opts: { max?: number } = {}): Parsed<number | null> {
  const max = opts.max ?? 100000;
  if (raw === null || raw === undefined) return ok(null);
  const rawText = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (rawText === null) return bad(`${label}ไม่ถูกต้อง`);
  if (rawText === "") return ok(null);
  const norm = normalizeWeightText(rawText);
  if (!norm.ok) return bad(norm.error);
  const t = norm.value;
  if (!/^\d+(?:\.\d{1,3})?$/.test(t)) return bad(`${label}ต้องเป็นตัวเลข ทศนิยมไม่เกิน 3 ตำแหน่ง`);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > max) return bad(`${label}ต้องมากกว่า 0 และไม่เกิน ${max.toLocaleString("en-US")} กรัม`);
  return ok(n);
}

/** น้ำหนักที่ 0 ได้ (เติมโลหะ): ว่าง/ไม่ส่ง = 0 */
export function parseWeightOrZero(raw: unknown, label: string): Parsed<number> {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return ok(0);
  const rawText = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const norm = normalizeWeightText(rawText);
  if (!norm.ok) return bad(norm.error);
  const t = norm.value;
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

/**
 * จำนวนชิ้นจากช่องกรอก (ฟอร์มออฟฟิศ): จำนวนเต็ม 1–100,000 เท่านั้น
 * 🔴 ห้ามกรองอักขระทิ้งเงียบ ("1,5" เคยจะกลายเป็น 15) — มี "," หรือ "." หรืออักขระอื่น = error
 */
export function parseQtyText(raw: unknown, max = 100000): Parsed<number> {
  const msg = "ใส่เป็นจำนวนเต็ม เช่น 35";
  const t = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(t)) return bad(msg);
  const n = Number(t);
  if (!Number.isSafeInteger(n)) return bad(msg);
  if (n < 1 || n > max) return bad(`จำนวนต้องอยู่ระหว่าง 1–${max.toLocaleString("en-US")}`);
  return ok(n);
}

/**
 * จำนวนชิ้นจาก action (ส่วนย่อย 0181): number หรือ string ตัวเลขล้วน → จำนวนเต็ม 1–100,000 · ข้อความ error "<label>ต้องเป็นจำนวนเต็ม 1–100,000"
 * ที่เดียวของ server action ทั้งหมด (job-lots · job-worker · job-office-write) — ห้ามกรองอักขระทิ้งเงียบ ("1,5" "3.5" "-2" = error)
 */
export function parsePieces(raw: unknown, label: string): Parsed<number> {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return bad(`${label}ต้องเป็นจำนวนเต็ม 1–100,000`);
  return ok(n);
}

/**
 * จำนวนเผื่อของเสีย "เพิ่มกี่ชิ้น" (สวิตช์เผื่อของเสียเปิดอยู่): จำนวนเต็ม >= 0 เท่านั้น — 0 ผ่าน (เปิดแล้วยังไม่เผื่อ)
 * 🔴 ห้ามกรองอักขระทิ้งเงียบ ("1,5" "3.5" "-2" "" "abc" = error) · รวมกับจำนวนสั่งต้องไม่เกินเพดานเริ่มผลิต (ค่าเดียวกับ parseQtyText · DB เป็นด่านจริง)
 */
export function parseBufferText(raw: unknown, qtyOrder: number, max = 100000): Parsed<number> {
  const msg = "ใส่เป็นจำนวนเต็ม 0 ขึ้นไป เช่น 5";
  const t = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(t)) return bad(msg);
  const n = Number(t);
  if (!Number.isSafeInteger(n)) return bad(msg);
  if (qtyOrder + n > max) return bad(`เริ่มผลิตรวมต้องไม่เกิน ${max.toLocaleString("en-US")} ชิ้น (เผื่อได้อีกไม่เกิน ${Math.max(0, max - qtyOrder).toLocaleString("en-US")})`);
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

/** ชื่อที่ไหลไปแสดงบนหน้าจอช่าง/ใบพิมพ์ (ชื่อช่าง ชื่อเรียกใบงาน): ห้ามมี < หรือ > (0174 — DB ปฏิเสธซ้ำด้วย hint text_invalid) */
export const LABEL_ANGLE_RE = /[<>]/;
export const LABEL_ANGLE_MSG = "ชื่อห้ามมีเครื่องหมาย < หรือ >";

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

/** PIN 4 หลัก — ตรวจรูปแบบเท่านั้น · 0185: เลขซ้ำ/เรียง/0000 ใช้ได้ (เจ้าของ 20 ต.ค. 69) · DB ตรวจรูปแบบซ้ำ (job_pin_ok) ข้อความไทยมาจาก hint pin_invalid */
export const PIN_RE = /^[0-9]{4}$/;
export function parsePin(raw: unknown): Parsed<string> {
  if (typeof raw !== "string" || !PIN_RE.test(raw)) return bad("PIN ต้องเป็นตัวเลข 4 หลัก");
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

/**
 * อักขระที่มองไม่เห็น/ควบคุมทิศทาง — ชื่อที่ดูเหมือนกันแต่ไม่เหมือนกัน (ชื่อแบบซ้ำปลอม · ชื่อช่างสลับทิศ) · security 0176 L1 (Mace)
 * U+00AD U+034F U+061C U+115F/1160 U+17B4/17B5 U+180B-180F U+200B-200F (zero-width, LRM, RLM) U+202A-202E (bidi) U+2060-206F U+2800 U+3164 U+FE00-FE0F (variation selectors)
 * U+FEFF U+FFA0 และ tag characters U+E0000-E01EF (surrogate DB40 DC00-DDEF) — ไทย/อีโมจิทั่วไป (เช่น 👍) ไม่โดน
 * หมายเหตุ: อีโมจิที่ต่อด้วย VS16/ZWJ (❤️ · 👨‍👩‍👧) จะถูกปฏิเสธด้วย — ชื่อใบงาน/ช่าง/แบบไม่ควรมี
 */
export const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\uDB40[\uDC00-\uDDEF]/;
export const INVISIBLE_MSG = (label: string): string => `${label}มีอักขระที่มองไม่เห็นหรืออักขระควบคุมทิศทาง`;

/** parseText + ห้าม < > + ห้ามอักขระล่องหน/bidi — ใช้กับชื่อช่าง/ชื่อเรียกใบงาน/ชื่อแบบการบันทึก */
export function parseLabel(raw: unknown, label: string, max: number, required: boolean): Parsed<string | null> {
  // ตรวจก่อน parseText: ถ้าชื่อมีแต่อักขระล่องหน parseText จะนับว่า "ไม่ว่าง" (trim ไม่ตัด) — ต้องปฏิเสธด้วยข้อความที่ถูกเหตุผล
  if (typeof raw === "string" && INVISIBLE_RE.test(raw)) return bad(INVISIBLE_MSG(label));
  const t = parseText(raw, label, max, required);
  if (!t.ok) return t;
  if (t.value !== null && LABEL_ANGLE_RE.test(t.value)) return bad(LABEL_ANGLE_MSG);
  return t;
}
