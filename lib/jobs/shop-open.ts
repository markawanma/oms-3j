// lib/jobs/shop-open.ts — ตรรกะ pure ของหน้าผู้จัดการเปิดใบจากมือถือ /w/s/<token> (W1 · UX ส่วน B)
//
// 🔴 อยู่ในกราฟหน้าช่าง (สาธารณะ): ห้าม import lib/production · lib/oem · lib/catalog (worker-boundary.test) — ป้ายสีโลหะ/ค่าเริ่มเนื้อ/ข้อความ reset
//    import ตรงจาก leaf module lib/units/metal-tag.ts (ไม่มี import) ที่จอใบผลิต re-export — ที่เดียว ไม่มีสำเนา
// 🔴 ไม่มีตัวเลขเงิน/ต้นทุน/ราคาในไฟล์นี้เลย (ตั้งแต่ type) · ไม่มีการคิดเงิน · น้ำหนักทองไม่ถูกส่งกลับมาแสดงหลังเปิด (N1)
// ค่าที่ตัดสินจริง (เนื้อเริ่ม/โปรไฟล์/ด่านต่างๆ) อยู่ที่ DB — ไฟล์นี้แค่ประกอบ payload + ตรวจรูปร่างช่อง + เลือกข้อความ error

import type { IntakeOpenActionInput } from "@/lib/actions/job-worker";
import type { IntakeProduct } from "@/lib/jobs/worker-server";
import { addDays, thaiDate } from "@/lib/jobs/dates";
import { INVISIBLE_MSG, INVISIBLE_RE, LABEL_ANGLE_MSG, LABEL_ANGLE_RE, TARGET_PIECE_MAX_G, parseBufferText, parseDate, parseQtyText, parseWeight } from "@/lib/jobs/input";
import { DEFAULT_PURITY_PCT, MSG_METAL_RESET_PURITY, MSG_WEIGHT_CLEARED_FROM_SKU } from "@/lib/units/metal-tag";
import type { MetalKey } from "@/lib/units/metal-tag";
import { purityFractionToPct, purityPctIssue, purityPctToFraction } from "@/lib/units/purity";

// ============================================================================
// โลหะ — ป้ายสี + ค่าเริ่ม
// ============================================================================

export type ShopMetal = MetalKey;
export const SHOP_METALS: readonly ShopMetal[] = ["silver", "gold", "brass"];

/** ค่าเริ่มช่อง "เนื้อโลหะ (%)": เงิน 92.50 (มติเจ้าของ · แก้ได้) · ทอง ว่าง (บังคับกรอก) · ทองเหลือง 100.00 (ล็อก) — จาก leaf module */
export function defaultPurityText(metal: ShopMetal): string {
  return DEFAULT_PURITY_PCT[metal];
}

/** ข้อความใต้ตัวเลือกโลหะ (W-2b) */
export const SHOP_METAL_HINT: Record<ShopMetal, string> = {
  silver: "เนื้อเริ่ม 92.50%",
  gold: "ต้องกรอกเนื้อเอง",
  brass: "เนื้อ 100%",
};

// ============================================================================
// ข้อความ
// ============================================================================

export const MSG_GOLD_PURITY = "ทองต้องกรอกเนื้อทอง (%) — พิมพ์เนื้อจริงของงานนี้ ขั้นต่ำ 37.50%";
export const MSG_WEIGHT = "น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)";
export const MSG_QTY_REQUIRED = "ใส่จำนวนชิ้นที่ต้องการ";
export const MSG_LABEL_REQUIRED = "ใส่ชื่อแบบก่อน";
export const MSG_LABEL_LINE = "ชื่อแบบห้ามขึ้นบรรทัดใหม่หรือแท็บ";
export const MSG_LABEL_LONG = "ชื่อแบบยาวเกิน 60 ตัวอักษร";
export const MSG_NO_GOLD_PROFILE = "เปิดงานทองไม่ได้ตอนนี้ — ยังไม่มีแบบการบันทึกสำหรับงานทอง แจ้งออฟฟิศให้ตั้งก่อน · อย่าเปลี่ยนเป็นโลหะอื่นเพื่อเปิดผ่าน";
export const MSG_NO_DEFAULT_PROFILE = "เปิดงานไม่ได้ตอนนี้ — ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน แล้วกลับมากด \"เปิดงาน\" อีกครั้ง";
export const SHOP_LABEL_MAX = 60;

// ============================================================================
// ฟอร์ม
// ============================================================================

export type ShopDue = { kind: "none" } | { kind: "days"; days: 3 | 7 } | { kind: "date"; date: string };
/** 0189 W2: "photos" = W-5 ใส่รูปให้ช่างดู (ไม่บังคับ · ก่อนทวน) */
export type ShopStep = "search" | "metal" | "qty" | "photos" | "review";

export interface ShopForm {
  /** คีย์กันกดซ้ำ — สร้างครั้งเดียวต่อฟอร์ม · ใช้ซ้ำทุกครั้งที่ "ลองใหม่" (เปลี่ยนเฉพาะเมื่อ DB บอกว่าคีย์ชน/ผิดรูป) */
  idemKey: string;
  mode: "sku" | "new";
  product: IntakeProduct | null;
  label: string;
  metal: ShopMetal;
  /** เนื้อ % ตามที่พิมพ์ */
  purityText: string;
  weightText: string;
  qtyText: string;
  bufferOn: boolean;
  bufferText: string;
  due: ShopDue;
  isNewDesign: boolean;
  note: string;
}

/** คีย์กันกดซ้ำ 36 ตัว [0-9a-f-] — ตรง IDEM_RE (16–64 ตัว [A-Za-z0-9_-]) ของ action · เรียกฝั่ง client ตอนเปิดฟอร์มเท่านั้น */
export function newIdemKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // ไม่มี crypto = คีย์กันกดซ้ำไม่ปลอดภัย (ค่าคงที่/Math.random ทำให้ใบของคนละคนชนกัน) → ล้มดังๆ ดีกว่าเปิดใบด้วยคีย์ที่เดาได้
  throw new Error("crypto_unavailable");
}

export function newForm(idemKey: string = newIdemKey()): ShopForm {
  return {
    idemKey, mode: "sku", product: null, label: "",
    metal: "silver", purityText: defaultPurityText("silver"), weightText: "",
    qtyText: "", bufferOn: false, bufferText: "", due: { kind: "none" }, isNewDesign: false, note: "",
  };
}

export interface MetalSpec { metal: ShopMetal; purityText: string; weightText: string }

/** ค่าที่ "มากับสินค้า" (ไม่ใช่ที่ผู้จัดการแก้) — เงิน: เนื้อว่างในระบบ = ค่าเริ่ม 92.50 · ทอง: ว่าง = ต้องกรอก · น้ำหนักมีเฉพาะเงิน (server ตัดของทอง/ทองเหลืองแล้ว) */
export function specOfProduct(p: IntakeProduct): MetalSpec {
  const metal = p.prefill.metal;
  const purityText = metal === "brass" ? defaultPurityText("brass") : p.prefill.purity != null ? purityFractionToPct(p.prefill.purity) : defaultPurityText(metal);
  const weightText = metal === "silver" && p.prefill.weightG != null ? String(p.prefill.weightG) : "";
  return { metal, purityText, weightText };
}

export function selectProduct(form: ShopForm, product: IntakeProduct): ShopForm {
  const s = specOfProduct(product);
  return { ...form, mode: "sku", product, metal: s.metal, purityText: s.purityText, weightText: s.weightText };
}

export function startNewProduct(form: ShopForm): ShopForm {
  return { ...form, mode: "new", product: null, metal: "silver", purityText: defaultPurityText("silver"), weightText: "" };
}

export function backToSearch(form: ShopForm): ShopForm {
  return { ...form, mode: "sku", product: null, metal: "silver", purityText: defaultPurityText("silver"), weightText: "" };
}

/** เปลี่ยนโลหะ: เนื้อรีเซ็ตตามโลหะใหม่ · น้ำหนักที่มาจากสินค้า (เงินเท่านั้น) ล้างเมื่อย้ายไปโลหะอื่น · กลับมาที่โลหะเดิมของสินค้า = คืนค่าของสินค้า — คืนข้อความบอกว่าอะไรถูกเปลี่ยน (ไม่เงียบ) */
export function changeMetal(form: ShopForm, next: ShopMetal): { form: ShopForm; notes: string[] } {
  if (next === form.metal) return { form, notes: [] };
  const notes: string[] = [];
  const base = form.mode === "sku" && form.product ? specOfProduct(form.product) : null;
  if (base && next === base.metal) return { form: { ...form, metal: next, purityText: base.purityText, weightText: base.weightText }, notes: [MSG_METAL_RESET_PURITY] };
  let weightText = form.weightText;
  if (base && base.weightText !== "" && form.weightText.trim() === base.weightText) {
    weightText = "";
    notes.push(MSG_WEIGHT_CLEARED_FROM_SKU);
  }
  notes.unshift(MSG_METAL_RESET_PURITY);
  return { form: { ...form, metal: next, purityText: defaultPurityText(next), weightText }, notes };
}

/** ลำดับขั้นจริงของฟอร์ม — ตัวนับ n/N คำนวณจากรายการนี้ (ขั้นพลอย/รูปที่เพิ่มทีหลังไม่ต้องแก้ตัวนับ) */
export function stepsFor(form: Pick<ShopForm, "mode">): ShopStep[] {
  return form.mode === "new" ? ["search", "metal", "qty", "photos", "review"] : ["search", "qty", "photos", "review"];
}

export function stepProgress(form: Pick<ShopForm, "mode">, step: ShopStep): { n: number; total: number } {
  const steps = stepsFor(form);
  const i = steps.indexOf(step);
  return { n: i < 0 ? 1 : i + 1, total: steps.length };
}

/** โลหะที่เลือกยังไม่มีแบบการบันทึก (UX R1 pre-check จาก hub) — ทอง = gold_profile_ready · เงิน/ทองเหลือง = profile_ready · null = ไปต่อได้ */
export function profileBlockMessage(metal: ShopMetal, ready: { profileReady: boolean; goldProfileReady: boolean }): string | null {
  if (metal === "gold") return ready.goldProfileReady ? null : MSG_NO_GOLD_PROFILE;
  return ready.profileReady ? null : MSG_NO_DEFAULT_PROFILE;
}

// ============================================================================
// คำเตือน "ต่างจากสินค้าในระบบ" (UX P1) — เตือนเฉพาะ SKU ที่ระบุโลหะไว้ชัด
// ============================================================================

export type SkuMetalNote = "warn" | "neutral" | "none";

/**
 * known && ต่าง → warn (กล่องเหลือง · ไม่บล็อก) · ไม่ระบุโลหะ (known=false) → neutral (กล่องกลาง ไม่ใช่เหลือง) · known && เท่ากัน → none · ไม่มี SKU → none
 * 🔴 ห้ามเตือนเมื่อ SKU ไม่ได้ระบุโลหะ: แคตตาล็อกไม่มีที่เก็บ "SKU นี้เป็นทอง" — เตือนทุกครั้งที่เปิดงานทอง = คนเลิกอ่านคำเตือน
 */
export function skuMetalNote(args: { selected: ShopMetal; sku: { metal: ShopMetal; known: boolean } | null }): SkuMetalNote {
  const { selected, sku } = args;
  if (sku === null) return "none";
  if (!sku.known) return "neutral";
  return sku.metal !== selected ? "warn" : "none";
}

export function skuNoteOf(form: ShopForm): SkuMetalNote {
  return skuMetalNote({ selected: form.metal, sku: form.mode === "sku" && form.product ? { metal: form.product.prefill.metal, known: form.product.prefill.metalKnown } : null });
}

// ============================================================================
// ตรวจรูปร่างช่อง (ด่านจริงซ้ำที่ action + DB)
// ============================================================================

export interface ShopMetalIssues { purity?: string; weight?: string }

export function purityIssue(metal: ShopMetal, text: string): string | null {
  if (metal === "brass") return null;
  if (text.trim() === "") return metal === "gold" ? MSG_GOLD_PURITY : null; // เงินเว้นว่างได้ (ค่าเริ่ม 92.50) · ทองว่าง = บังคับ
  return purityPctIssue(text);
}

export function weightIssue(text: string): string | null {
  if (text.trim() === "") return null; // ไม่บังคับ
  const w = parseWeight(text, "น้ำหนักต่อชิ้น", { max: TARGET_PIECE_MAX_G });
  return w.ok ? null : MSG_WEIGHT;
}

export function metalIssues(form: Pick<ShopForm, "metal" | "purityText" | "weightText">): ShopMetalIssues {
  const out: ShopMetalIssues = {};
  const p = purityIssue(form.metal, form.purityText);
  if (p) out.purity = p;
  const w = weightIssue(form.weightText);
  if (w) out.weight = w;
  return out;
}

export function labelIssue(raw: string): string | null {
  if (/[\r\n\t]/.test(raw)) return MSG_LABEL_LINE;
  if (INVISIBLE_RE.test(raw)) return INVISIBLE_MSG("ชื่อแบบ");
  const t = raw.replace(/\s+/g, " ").trim();
  if (t === "") return MSG_LABEL_REQUIRED;
  if (t.length > SHOP_LABEL_MAX) return MSG_LABEL_LONG;
  if (LABEL_ANGLE_RE.test(t)) return LABEL_ANGLE_MSG;
  return null;
}

export function qtyIssue(text: string): string | null {
  if (text.trim() === "") return MSG_QTY_REQUIRED;
  const q = parseQtyText(text);
  return q.ok ? null : q.error;
}

export function bufferIssue(form: Pick<ShopForm, "qtyText" | "bufferOn" | "bufferText">): string | null {
  if (!form.bufferOn) return null;
  const q = parseQtyText(form.qtyText);
  const qty = q.ok ? q.value : 1;
  const b = parseBufferText(form.bufferText.trim() === "" ? "0" : form.bufferText, qty);
  return b.ok ? null : b.error;
}

export function dueIssue(due: ShopDue, today: string): string | null {
  if (due.kind !== "date") return null;
  if (due.date === "") return "เลือกวันที่กำหนดเสร็จ";
  const d = parseDate(due.date, "กำหนดเสร็จ");
  if (!d.ok) return d.error;
  return due.date < today ? "กำหนดเสร็จต้องไม่ย้อนหลัง" : null;
}

export function noteIssue(note: string): string | null {
  if (INVISIBLE_RE.test(note)) return "หมายเหตุมีอักขระที่มองไม่เห็นหรืออักขระควบคุมทิศทาง";
  if (/[\r\n\t]/.test(note)) return "หมายเหตุห้ามขึ้นบรรทัดใหม่หรือแท็บ";
  if (note.trim().length > 500) return "หมายเหตุยาวเกิน 500 ตัวอักษร";
  return null;
}

export type ShopFieldKey = "label" | "product" | "metal" | "purity" | "weight" | "qty" | "buffer" | "due" | "note";

/** ปัญหาทั้งฟอร์ม (ลำดับ = ลำดับช่องบนจอ) — ว่าง = ส่งได้ */
export function shopOpenIssues(form: ShopForm, today: string): { field: ShopFieldKey; message: string }[] {
  const out: { field: ShopFieldKey; message: string }[] = [];
  if (form.mode === "new") {
    const l = labelIssue(form.label);
    if (l) out.push({ field: "label", message: l });
  } else if (!form.product) out.push({ field: "product", message: "เลือกสินค้าก่อน" });
  const m = metalIssues(form);
  if (m.purity) out.push({ field: "purity", message: m.purity });
  if (m.weight) out.push({ field: "weight", message: m.weight });
  const q = qtyIssue(form.qtyText);
  if (q) out.push({ field: "qty", message: q });
  else {
    const b = bufferIssue(form);
    if (b) out.push({ field: "buffer", message: b });
  }
  const d = dueIssue(form.due, today);
  if (d) out.push({ field: "due", message: d });
  const n = noteIssue(form.note);
  if (n) out.push({ field: "note", message: n });
  return out;
}

// ============================================================================
// ค่าที่มีผล + ข้อความทวน
// ============================================================================

/** เนื้อที่ "จะมีผลจริง" เป็นข้อความ (เงินเว้นว่าง = 92.50 · ทองเหลือง 100.00) — แสดงอย่างเดียว ไม่ส่งไป server */
export function effectivePurityText(metal: ShopMetal, text: string): string {
  if (metal === "brass") return defaultPurityText("brass");
  if (text.trim() === "") return metal === "silver" ? defaultPurityText("silver") : "";
  const f = purityPctToFraction(text);
  return f === null ? text.trim() : purityFractionToPct(f);
}

/** "เนื้อ 96.50%" · ทองเหลือง "เนื้อ 100%" · ทองยังไม่กรอก "ต้องใส่เนื้อ" */
export function purityLabel(metal: ShopMetal, text: string): string {
  if (metal === "brass") return "เนื้อ 100%";
  const e = effectivePurityText(metal, text);
  return e === "" ? "ต้องใส่เนื้อ" : `เนื้อ ${e}%`;
}

export function weightLabel(text: string): string {
  const w = parseWeight(text, "น้ำหนักต่อชิ้น", { max: TARGET_PIECE_MAX_G });
  return w.ok && w.value !== null ? `น้ำหนัก ${w.value} กรัม/ชิ้น` : "น้ำหนัก ยังไม่ระบุ";
}

/** "ผลิต 30 ชิ้น · ไม่เผื่อ" / "สั่ง 30 + เผื่อ 5 = เริ่มผลิต 35 ชิ้น" — จำนวนชิ้นล้วน */
export function qtySummary(form: Pick<ShopForm, "qtyText" | "bufferOn" | "bufferText">): string {
  const q = parseQtyText(form.qtyText);
  if (!q.ok) return "—";
  if (!form.bufferOn) return `${q.value.toLocaleString("en-US")} ชิ้น · ไม่เผื่อ`;
  const b = parseBufferText(form.bufferText.trim() === "" ? "0" : form.bufferText, q.value);
  if (!b.ok || b.value === 0) return `${q.value.toLocaleString("en-US")} ชิ้น · ไม่เผื่อ`;
  return `สั่ง ${q.value.toLocaleString("en-US")} + เผื่อ ${b.value.toLocaleString("en-US")} = เริ่มผลิต ${(q.value + b.value).toLocaleString("en-US")} ชิ้น`;
}

export function resolveDue(due: ShopDue, today: string): string | null {
  if (due.kind === "days") return addDays(today, due.days);
  if (due.kind === "date") return due.date === "" ? null : due.date;
  return null;
}

export function dueLabel(due: ShopDue, today: string): string {
  const d = resolveDue(due, today);
  return d === null ? "ยังไม่กำหนด" : thaiDate(d, false);
}

// ============================================================================
// ประกอบ payload ส่ง action
// ============================================================================

const samePurity = (a: string, b: string): boolean => {
  const fa = purityPctToFraction(a);
  const fb = purityPctToFraction(b);
  return fa === null || fb === null ? a.trim() === b.trim() : fa === fb;
};
const sameWeight = (a: string, b: string): boolean => {
  const wa = parseWeight(a, "w", { max: TARGET_PIECE_MAX_G });
  const wb = parseWeight(b, "w", { max: TARGET_PIECE_MAX_G });
  return wa.ok && wb.ok ? wa.value === wb.value : a.trim() === b.trim();
};

/** ผู้จัดการแก้ค่าที่มากับสินค้าหรือไม่ (ป้าย "แก้แล้ว" · และเป็นตัวตัดสินว่าจะส่ง metal/purity/weight ไป) */
export function specEdited(form: ShopForm): boolean {
  if (form.mode !== "sku" || !form.product) return false;
  const b = specOfProduct(form.product);
  return form.metal !== b.metal || !samePurity(form.purityText, b.purityText) || !sameWeight(form.weightText, b.weightText);
}

/**
 * ฟอร์ม → input ของ intakeOpen (ยังเป็นข้อความดิบ — action แปลงหน่วย/ตรวจซ้ำ)
 * - สินค้าใหม่: ส่ง label + metal + เนื้อ (ทองเหลืองไม่ส่ง · เงินว่าง = ไม่ส่ง DB ใช้ค่าเริ่ม) + น้ำหนัก
 * - มี SKU ไม่แก้อะไร: ส่งแค่ productId (DB ประทับค่าของสินค้าเอง)
 * - มี SKU แล้วแก้: ส่ง metal + เนื้อ/น้ำหนักที่เห็นบนจอ (ค่าที่ผู้จัดการยืนยัน)
 */
export function buildIntakeInput(form: ShopForm, today: string): IntakeOpenActionInput {
  const out: IntakeOpenActionInput = {
    idemKey: form.idemKey,
    qty: form.qtyText.trim(),
    isNewDesign: form.isNewDesign,
    dueDate: resolveDue(form.due, today),
    note: form.note.trim() === "" ? null : form.note.trim(),
  };
  if (form.bufferOn) out.buffer = form.bufferText.trim() === "" ? "0" : form.bufferText.trim();
  const sendSpec = () => {
    out.metal = form.metal;
    const p = form.purityText.trim();
    if (form.metal !== "brass" && p !== "") out.purityPct = p;
    const w = form.weightText.trim();
    if (w !== "") out.weight = w;
  };
  if (form.mode === "new") {
    out.label = form.label.replace(/\s+/g, " ").trim();
    sendSpec();
  } else {
    out.productId = form.product?.id ?? null;
    if (specEdited(form)) sendSpec();
  }
  return out;
}

// ============================================================================
// ข้อผิดพลาดตอนกด "เปิดงาน" (UX B.8) — ข้อความ/การกระทำ · ไม่มีรหัสดิบ/ตัวเลขเงิน
// ============================================================================

/** ผลล้มของ action (รูปเดียวกับ IntakeActionFail) */
export interface ShopFail { error: string; code?: string; retryAfterSeconds?: number; field?: string }

export type ShopErrorAction =
  | "retry"        // กด "เปิดงาน" ซ้ำได้ (คีย์เดิม)
  | "wait"         // นับถอยหลังแล้วกลับมากดเอง
  | "back"         // กลับไปแก้ที่ช่อง/ขั้นที่ผิด
  | "pick"         // กลับไปเลือกสินค้า
  | "pin"          // ใส่ PIN ใหม่ (แผ่น PIN ซ้อน)
  | "final";       // จบ — ส่งอีกไม่ได้ (QR ถูกยกเลิก/ไม่มีสิทธิ์/งบหมด)

export interface ShopErrorView {
  message: string;
  action: ShopErrorAction;
  /** วินาทีที่ต้องรอ (action = wait) */
  waitSeconds?: number;
  /** ช่องที่ต้องพาไปแก้ (action = back) */
  field?: ShopFieldKey;
  /** ต้องสร้าง idem key ใหม่ (คีย์ชนกับของคนอื่น/ผิดรูป — ไม่ใช่ "ลองใหม่" ของใบเดิม) */
  newKey?: boolean;
  /** แสดงปุ่มรอง "ลองอีกครั้ง" (ยังไม่ตั้งแบบการบันทึก / QR เพิ่งถูกยกเลิกและออฟฟิศอาจออกใหม่แล้ว) */
  retryButton?: boolean;
}

export const MSG_NETWORK = "ส่งไม่สำเร็จ — เช็คสัญญาณแล้วกด \"เปิดงาน\" อีกครั้ง (กดซ้ำได้ ระบบไม่เปิดซ้ำซ้อน)";
export const MSG_SESSION = "หมดเวลาแล้ว — ใส่ PIN ใหม่";

const FIELD_OF_CODE: Record<string, ShopFieldKey> = {
  name_invalid: "label", sku_or_label: "label", sku_invalid: "product",
  metal_required: "metal", metal_invalid: "metal", gold_purity_required: "purity", purity_invalid: "purity",
  weight_invalid: "weight", qty_invalid: "qty", due_invalid: "due", note_invalid: "note",
};

/** ข้อความ DB ที่ "สะอาดพอ" ถึงจะส่งต่อ — ไม่มี snake_case/ชื่อตาราง/SQL/คำเกี่ยวกับเงิน */
export function isCleanMessage(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t === "" || t.length > 300) return false;
  if (/[A-Za-z]+_[A-Za-z_]+/.test(t)) return false;
  if (/บาท|฿|THB|ราคา|ต้นทุน|price|cost|margin/i.test(t)) return false;
  if (/\b(select|insert|update|delete|from|where|public|analytics|rpc|function|constraint|violates)\b/i.test(t)) return false;
  return true;
}

const FIELD_KEYS: readonly string[] = ["label", "product", "metal", "purity", "weight", "qty", "buffer", "due", "note"];

export function shopErrorView(f: ShopFail): ShopErrorView {
  const code = f.code ?? "";
  switch (code) {
    case "rate_limited": {
      const n = typeof f.retryAfterSeconds === "number" && f.retryAfterSeconds > 0 ? Math.min(Math.ceil(f.retryAfterSeconds), 600) : null;
      return n !== null
        ? { message: `ส่งถี่เกินไป — รอสักครู่แล้วกด "เปิดงาน" อีกครั้ง · ลองใหม่ได้ใน ${n} วินาที`, action: "wait", waitSeconds: n }
        : { message: "ส่งถี่เกินไป — รอสักครู่แล้วกด \"เปิดงาน\" อีกครั้ง", action: "retry" };
    }
    case "no_default_profile":
    case "not_ready":
      return { message: code === "not_ready" ? "เปิดงานไม่ได้ตอนนี้ — ร้านยังตั้งขั้นตอนการผลิตไม่ครบ แจ้งออฟฟิศ" : MSG_NO_DEFAULT_PROFILE, action: "retry", retryButton: true };
    case "no_gold_profile":
      return { message: MSG_NO_GOLD_PROFILE, action: "back", field: "metal" };
    case "job_exists":
      return { message: isCleanMessage(f.error) ? f.error : "SKU นี้มีใบงานเปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น", action: "pick", field: "product" };
    case "session_required":
      return { message: MSG_SESSION, action: "pin" };
    case "invalid_token":
      return { message: "QR ร้านนี้ถูกยกเลิกแล้ว — เปิดงานไม่ได้ ให้ออฟฟิศออก QR ใหม่ (ข้อมูลที่กรอกยังอยู่ในเครื่อง ตราบที่ไม่ปิดหน้านี้)", action: "final", retryButton: true };
    case "token_budget_exhausted":
      return { message: "วันนี้ใส่ PIN ผิดครบกำหนดแล้ว — ขอ QR ร้านใหม่จากออฟฟิศ", action: "final" };
    case "not_allowed":
      return { message: "บัญชีนี้ไม่มีสิทธิ์เปิดงานแล้ว — แจ้งออฟฟิศ", action: "final" };
    case "idem_conflict":
    case "idem_invalid":
      return { message: "ข้อมูลไม่ครบ — ระบบสร้างรหัสคำขอใหม่ให้แล้ว กด \"เปิดงาน\" อีกครั้ง", action: "retry", newKey: true };
    default:
      break;
  }
  const NEW_KEY_MSG = "ข้อมูลไม่ครบ — ระบบสร้างรหัสคำขอใหม่ให้แล้ว กด \"เปิดงาน\" อีกครั้ง";
  if (f.field === "key") return { message: NEW_KEY_MSG, action: "retry", newKey: true };
  const byCode = FIELD_OF_CODE[code];
  const field = byCode ?? (typeof f.field === "string" && FIELD_KEYS.includes(f.field) ? (f.field as ShopFieldKey) : undefined);
  if (field) return { message: isCleanMessage(f.error) ? f.error : "ข้อมูลที่กรอกไม่ถูกต้อง — ตรวจช่องที่กรอกแล้วลองอีกครั้ง", action: "back", field };
  if (isCleanMessage(f.error)) return { message: f.error, action: "retry" };
  return { message: MSG_NETWORK, action: "retry" };
}

// ============================================================================
// ค้นสินค้า — ข้อความ error ของการค้น
// ============================================================================

export function searchErrorMessage(f: ShopFail): string {
  if (f.code === "rate_limited") return "ค้นถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง";
  if (f.code === "session_required") return MSG_SESSION;
  if (f.code === "invalid_token") return "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอ QR ใหม่จากออฟฟิศ";
  return "ค้นไม่สำเร็จ — ลองอีกครั้ง";
}
