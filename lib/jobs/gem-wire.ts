// lib/jobs/gem-wire.ts — ตัวแปลง "แถวพลอยจาก client (ไม่น่าเชื่อ)" → payload ของ RPC (pure · ไม่มีราคา/ต้นทุน/ตัวแปลงราคา)
// แยกออกจาก lib/jobs/gems.ts (G1a) เพื่อให้ชั้นสาธารณะของหน้างาน (W3 — lib/actions/job-worker.ts · QR ร้าน + PIN) ใช้ allowlist ตัวเดียวกันกับออฟฟิศ โดยไม่ลาก gems.ts (ตัวแปลงราคา/แคตตาล็อก) เข้ามาในกราฟ
// gems.ts re-export ของเดิมทุกตัว (import เดิมใช้ต่อได้) · เทสต์ lib/jobs/gems-boundary.test.ts ล็อกว่าไฟล์นี้ไม่มีชื่อ field ราคา

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
      // ชื่อ key ที่ไม่รู้จักไม่สะท้อนกลับไป client (ยกเว้นที่รูปร่างปลอดภัย — บอกให้รู้ว่าแถวมีข้อมูลแปลก) — ใช้บอกว่าแถวไหนมีข้อมูลแปลก
      if (!LINE_KEYS.has(k)) return wireBad("แถวพลอยมีข้อมูลที่ไม่รองรับ", "line_invalid", row, /^[a-z][a-zA-Z_]{0,30}$/.test(k) ? k : null);
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
// W3: รายการยืนยัน "ใช้ชื่อใหม่ตามที่พิมพ์แม้คล้ายของเดิม" — ต่อชื่อ ไม่ใช่ boolean ทั่วไป
// ---------------------------------------------------------------------------
/** ชื่อที่ผู้ใช้ยืนยัน (ตามที่ DB ถามใน similar[] ของคำขอก่อนหน้า) — DB เทียบ kind + ชื่อที่ normalize แล้ว · ชื่อที่ไม่ได้ถูกถามในคำขอนี้ไม่มีผล */
export interface GemForceItem {
  kind: "type" | "shape";
  name: string;
}

export const GEM_FORCE_MAX = 60;
export type WireForceResult = { ok: true; value: GemForceItem[] | null } | { ok: false; error: string; code: "gem_force_invalid" };
const FORCE_BAD: WireForceResult = { ok: false, error: "ข้อมูลยืนยันชื่อพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง", code: "gem_force_invalid" };

/** null/undefined/[] = ไม่ยืนยันอะไร (value null) · boolean/รูปแปลก/key เกิน = ปฏิเสธ (ไม่ใช่ blanket) — ไม่ส่งค่าผิดรูปไปถึง DB */
export function toWireGemForce(raw: unknown): WireForceResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw) || raw.length > GEM_FORCE_MAX) return FORCE_BAD;
  const out: GemForceItem[] = [];
  for (const e of raw) {
    if (!isObj(e) || Object.keys(e).some((k) => k !== "kind" && k !== "name")) return FORCE_BAD;
    if ((e.kind !== "type" && e.kind !== "shape") || typeof e.name !== "string" || e.name.length === 0 || e.name.length > 200) return FORCE_BAD;
    out.push({ kind: e.kind, name: e.name });
  }
  return { ok: true, value: out.length > 0 ? out : null };
}
