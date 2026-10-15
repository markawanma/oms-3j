// lib/jobs/messages.ts — แปลง code/hint ของระบบใบงานเป็นภาษาไทยสั้นๆ (pure · ใช้ได้ทั้ง server และ client)
//  - ช่าง: RPC ฝั่งช่างคืน {ok:false, code, message} — ใช้ตารางนี้ก่อน (ถ้อยคำสั้น เหมาะจอมือถือ) ไม่มี code ในตาราง = ใช้ message ของ DB ถ้าสะอาด
//  - ออฟฟิศ: RPC raise 22023 + hint — ใช้ข้อความ DB (ไทย มีเลขงาน/จำนวนที่ช่วยตัดสินใจ) ถ้าสะอาด ไม่งั้นตารางนี้
// ข้อความที่ผ่านฟังก์ชันนี้ต้องไม่มี: snake_case · ชื่อตาราง/ฟังก์ชัน · SQL · token/PIN ใดๆ

export const WORKER_CODE_TH: Record<string, string> = {
  invalid_token: "ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ",
  rate_limited: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่",
  bad_credentials: "ชื่อหรือ PIN ไม่ถูกต้อง",
  locked: "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — รอสักครู่ หรือให้ออฟฟิศรีเซ็ต PIN",
  locked_office: "ล็อกแล้ว ให้ออฟฟิศปลดล็อก",
  token_budget_exhausted: "ใบนี้ใส่ PIN ผิดเกินกำหนด ขอพิมพ์ใบใหม่จากออฟฟิศ",
  // 0174: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ห้ามบอกขนาดส่วนต่าง/น้ำหนักขั้นก่อนในข้อความ
  handoff_mismatch: "น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ",
  session_required: "เลือกชื่อและใส่ PIN ก่อน",
  job_closed: "ใบงานนี้ปิดแล้ว",
  job_not_found: "ไม่พบใบงานนี้",
  job_on_hold: "ใบงานถูกพักอยู่ — รอออฟฟิศ",
  awaiting_deposit: "รอมัดจำ — ยังเริ่มผลิตไม่ได้",
  already_received: "มีคนรับขั้นนี้ไปแล้ว",
  all_done: "งานนี้ทำครบแล้ว รอออฟฟิศปิดงาน",
  already_sent: "ส่งขั้นนี้ไปแล้ว",
  not_holder: "ขั้นนี้ไม่ได้อยู่กับคุณ",
  not_received: "ยังไม่ได้รับงานขั้นนี้",
  out_of_order: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง",
  stage_changed: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง",
  stage_not_allowed: "ขั้นนี้ไม่ใช่ขั้นของคุณ",
  prev_not_sent: "ขั้นก่อนหน้ายังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ",
  weight_invalid: "น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)",
  weight_required: "ขั้นนี้ต้องใส่น้ำหนัก",
  weight_over: "น้ำหนักออกมากกว่าน้ำหนักเข้า — ถ้าเติมโลหะให้ใส่ช่อง “เติมโลหะ”",
  qty_invalid: "จำนวนไม่ถูกต้อง",
  reason_required: "เลือกเหตุผลของเสีย",
  reason_unexpected: "ไม่มีของเสีย ไม่ต้องเลือกเหตุผล",
  note_required: "ต้องมีหมายเหตุประกอบ",
  note_invalid: "หมายเหตุไม่ถูกต้อง",
  who_required: "ต้องระบุผู้รับงาน",
  date_invalid: "วันที่ไม่ถูกต้อง",
};

/** hint ที่ RPC ออฟฟิศ raise (22023/55000) — ใช้เป็นข้อความสำรองเมื่อข้อความ DB ไม่สะอาด */
export const OFFICE_HINT_TH: Record<string, string> = {
  actor_required: "ต้องเข้าสู่ระบบก่อนทำรายการ",
  channel_invalid: "ช่องทางบันทึกไม่ถูกต้อง",
  due_invalid: "กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า",
  item_not_found: "ไม่พบรายการนี้",
  job_closed: "ใบงานนี้ปิดแล้ว แก้ไขไม่ได้",
  job_exists: "รายการนี้มีใบงานอยู่แล้ว",
  job_not_found: "ไม่พบใบงานนี้",
  metal_unsupported: "โลหะของรายการนี้สร้างใบงานไม่ได้ (รองรับเงิน/ทอง/ทองเหลือง)",
  not_oem: "ใช้กับงาน OEM เท่านั้น",
  nothing_to_reopen: "ยังไม่มีความคืบหน้าให้ย้อน",
  pin_invalid: "PIN ต้องเป็นเลข 4 หลัก และห้ามซ้ำ/เรียงต่อเนื่อง/เดาง่าย",
  po_not_open: "ใบผลิตนี้ไม่ได้เปิดอยู่ สร้างใบงานไม่ได้",
  qty_exceeds_final: "จำนวนดีมากกว่าจำนวนที่เหลือจากขั้นสุดท้าย",
  qty_mismatch: "จำนวนดี + เสีย ต้องเท่ากับจำนวนที่วางแผน",
  quote_not_won: "สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว",
  source_invalid: "แหล่งที่มาของใบงานไม่ถูกต้อง",
  stage_not_found: "ไม่พบขั้นตอนนี้ในใบงาน",
  stage_not_pending: "ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน",
  stages_duplicate: "เลือกขั้นตอนซ้ำกัน",
  stages_empty: "เลือกขั้นตอนอย่างน้อยหนึ่งขั้น",
  stages_required: "เลือกขั้นที่ช่างทำอย่างน้อย 1 ขั้น",
  text_invalid: "ชื่อห้ามมีเครื่องหมาย < หรือ >",
  stage_required: "ขั้นนี้ข้ามไม่ได้ (ตรวจ QC และแพ็กต้องผ่านทุกใบงาน)",
  design_label_required: "ใบงาน OEM ต้องตั้งชื่อเรียกภายในก่อนสร้าง (ช่างเห็นชื่อนี้ — ห้ามมีชื่อแบรนด์ลูกค้า)",
  stages_invalid: "รายการขั้นตอนไม่ถูกต้อง",
  stages_need_qc_pack: "ต้องมีขั้น ตรวจ QC และ แพ็ก",
  stages_open: "ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่เสร็จ",
  stages_order: "ลำดับขั้นตอนไม่ถูกต้อง",
  stages_unknown: "มีขั้นตอนที่ไม่อยู่ในทะเบียน",
  start_gate_required: "ดีลนี้ยังไม่มีมัดจำ — ต้องระบุเหตุผลที่เริ่มผลิตก่อน",
  token_cap: "ใบงานนี้มี QR ใช้งานครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม",
  use_pin_set: "แก้ช่างเดิมไม่รับ PIN — ใช้ปุ่มรีเซ็ต PIN",
  weight_invalid: "น้ำหนักไม่ถูกต้อง",
  weight_required: "ต้องระบุน้ำหนัก",
  worker_name_taken: "มีช่างชื่อนี้อยู่แล้ว",
  worker_not_found: "ไม่พบช่างคนนี้",
  // 0175 — จำนวนสั่ง/เผื่อ/แผนโลหะ/ของเหลือ (ไม่มีตัวเลขน้ำหนักทอง — ข้อความนี้ออฟฟิศเห็นเท่านั้น)
  qty_planned_invalid: "จำนวนเริ่มผลิตต้องเป็นจำนวนเต็ม 1–100,000",
  target_invalid: "น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)",
  plan_target_required: "ตั้งแผนโลหะเองได้เมื่อมีน้ำหนักเป้าหมายต่อชิ้น",
  plan_override_missing: "ระบุน้ำหนักโลหะที่กำหนดเองก่อน หรือเอาเหตุผลออก",
  plan_override_invalid: "น้ำหนักโลหะที่กำหนดเองต้องมากกว่า 0 ไม่เกิน 100,000 กรัม",
  plan_reason_required: "ต้องระบุเหตุผลที่กำหนดน้ำหนักโลหะเอง",
  plan_too_large: "โลหะที่ต้องเตรียมเกิน 100,000 กรัม — ตรวจจำนวน/น้ำหนักต่อชิ้น",
  plan_drift: "แผนโลหะไม่ตรงกับจำนวน/น้ำหนักเป้าหมาย — รีเฟรชแล้วลองใหม่",
  plan_override_stale: "ใบนี้กำหนดน้ำหนักโลหะเองไว้ — ตั้งแผนโลหะใหม่ด้วยปุ่ม “แก้แผน” หลังแก้จำนวน",
  target_source_invalid: "ที่มาของน้ำหนักเป้าหมายไม่ถูกต้อง รีเฟรชแล้วลองใหม่",
  started: "ใบงานนี้เริ่มผลิตแล้ว แก้จำนวนเริ่มผลิตไม่ได้",
  cast_started: "ขั้นหล่อถูกรับแล้ว แก้แผนโลหะไม่ได้",
  no_surplus: "ใบงานนี้ไม่มีของเหลือให้ตัดสิน",
  surplus_fixed: "ของเหลือของใบผลิตเข้าสต็อกตอนปิดใบผลิต เปลี่ยนที่นี่ไม่ได้",
  surplus_invalid: "เลือกการจัดการของเหลือ: ถือไว้ก่อน / อะไหล่-ตัวอย่าง / ส่งแถมลูกค้า",
  surplus_production_stock_only: "ใบงานของใบผลิต: ของเหลือเข้าสต็อกเสมอ",
  surplus_oem_no_stock: "งาน OEM: ของเหลือเป็นของลูกค้า เข้าสต็อกอัตโนมัติไม่ได้",
  surplus_unexpected: "ไม่มีของเหลือ (จำนวนดีไม่เกินจำนวนที่สั่ง) จึงไม่ต้องระบุการจัดการของเหลือ",
  stage_codes_invalid: "รายการขั้นตอนไม่ถูกต้อง",
};

export const GENERIC_JOB_ERROR = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
const NO_PERMISSION = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนนี้ได้";

const THAI = /[฀-๿]/;
const TECHNICAL = /\b(select|insert|update\s+\w+\s+set|delete from|syntax error|violates|constraint|stack|traceback|permission denied|pg_)\b|ERROR:|analytics\.|[a-z]+_[a-z_]+|\bp_[a-z]/i;

function showable(text: unknown): text is string {
  return typeof text === "string" && text.length > 0 && text.length <= 300 && THAI.test(text) && !TECHNICAL.test(text);
}

/** ตัวเลขประกอบข้อความจาก RPC ฝั่งช่าง (0173) — ผู้เรียกกรองชนิดแล้ว (number จำกัดช่วง / string สั้น) */
export interface WorkerFailExtra {
  attemptsLeft?: number | null;
  attemptsUntilOffice?: number | null;
  tokenBudgetLeft?: number | null;
  retryAfterSeconds?: number | null;
  by?: string | null;
}

/** รอเป็นนาที ปัดขึ้น (เช่น 900 วิ = 15 นาที · 61 วิ = 2 นาที) */
export function waitMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * ข้อความของผลฝั่งช่าง {ok:false, code, message} → ไทยสั้น (ตารางก่อน · แล้ว message ของ DB ถ้าสะอาด · แล้วข้อความกลาง)
 * extra (0173): PIN ผิด -> เตือนจำนวนครั้งที่เหลือตั้งแต่ครั้งที่ 3 · locked -> รอกี่นาที · handoff_mismatch -> ข้อความตายตัว ไม่บอกส่วนต่าง/น้ำหนักขั้นก่อน (0174 N1 — ห้ามเติม gap_g กลับ) · รับขั้นแพ้ -> ชื่อผู้ชนะ
 */
export function workerFailMessage(code: unknown, dbMessage: unknown, extra?: WorkerFailExtra): string {
  const known = typeof code === "string" && Object.prototype.hasOwnProperty.call(WORKER_CODE_TH, code);
  const x = extra ?? {};
  if (code === "bad_credentials") {
    // เตือนทีละประโยค: เอาอันที่ "ใกล้ล็อกที่สุด" (เหลือครั้งน้อยสุด) · เท่ากัน = อันหนักกว่าก่อน (ล็อกทั้งใบ > ล็อกจนออฟฟิศปลด > ล็อกชั่วคราว)
    const warns: { left: number; severity: number; text: string }[] = [];
    if (typeof x.attemptsLeft === "number" && x.attemptsLeft >= 1 && x.attemptsLeft <= 2) warns.push({ left: x.attemptsLeft, severity: 1, text: `เหลืออีก ${x.attemptsLeft} ครั้งก่อนถูกล็อกชั่วคราว` });
    if (typeof x.attemptsUntilOffice === "number" && x.attemptsUntilOffice >= 1 && x.attemptsUntilOffice <= 3) warns.push({ left: x.attemptsUntilOffice, severity: 2, text: `เหลืออีก ${x.attemptsUntilOffice} ครั้งจะถูกล็อกจนกว่าออฟฟิศปลดล็อก` });
    if (typeof x.tokenBudgetLeft === "number" && x.tokenBudgetLeft >= 0 && x.tokenBudgetLeft <= 3) warns.push({ left: x.tokenBudgetLeft, severity: 3, text: `ใบนี้ใส่ PIN ผิดได้อีก ${x.tokenBudgetLeft} ครั้งวันนี้` });
    warns.sort((p, q) => p.left - q.left || q.severity - p.severity);
    return warns.length > 0 ? `${WORKER_CODE_TH.bad_credentials} · ${warns[0].text}` : WORKER_CODE_TH.bad_credentials;
  }
  if (code === "locked") {
    return typeof x.retryAfterSeconds === "number" && x.retryAfterSeconds > 0 ? `ใส่ PIN ผิดหลายครั้ง — ลองใหม่ใน ${waitMinutes(x.retryAfterSeconds)} นาที` : WORKER_CODE_TH.locked;
  }
  if (code === "already_received") {
    if (typeof x.by === "string" && x.by !== "") return `ช่าง ${x.by} รับขั้นนี้ไปแล้ว`;
    if (showable(dbMessage)) return dbMessage;
  }
  if (known) return WORKER_CODE_TH[code as string];
  return showable(dbMessage) ? dbMessage : GENERIC_JOB_ERROR;
}

/** ขั้นก่อนยังไม่ส่ง (prev_not_sent) — ใส่ชื่อขั้นที่ค้างให้ช่างรู้ว่าต้องไปตามใคร */
export function prevNotSentMessage(prevName: string | null): string {
  return prevName ? `ขั้นก่อน (${prevName}) ยังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ` : WORKER_CODE_TH.prev_not_sent;
}

/** error ของ RPC ออฟฟิศ (supabase error object) → ไทย · 42501 = ไม่มีสิทธิ์ · hint ที่รู้จัก → ข้อความ DB ถ้าสะอาด ไม่งั้นตาราง */
export function officeErrorMessage(err: unknown, fallback: string = GENERIC_JOB_ERROR): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; message?: unknown; hint?: unknown };
  if (e.code === "42501") return NO_PERMISSION;
  const hint = typeof e.hint === "string" ? e.hint : null;
  if ((e.code === "22023" || e.code === "55000") && hint && Object.prototype.hasOwnProperty.call(OFFICE_HINT_TH, hint)) {
    const raw = typeof e.message === "string" ? e.message.replace(/^[a-z][a-z0-9_]*:\s*/i, "") : "";
    return showable(raw) ? raw : OFFICE_HINT_TH[hint];
  }
  if ((e.code === "22023" || e.code === "55000") && typeof e.message === "string") {
    const raw = e.message.replace(/^[a-z][a-z0-9_]*:\s*/i, "");
    if (showable(raw)) return raw;
  }
  return fallback;
}

/** ข้อความสำหรับ log (ห้ามมีข้อความดิบที่อาจมี token/PIN/UUID ผู้ใช้) — เฉพาะ code + ข้อความที่ผ่าน redact ตามที่เรียกใช้ */
export function safeLogShape(err: unknown): { code: string | null; hint: string | null } {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; hint?: unknown };
  return { code: typeof e.code === "string" ? e.code : null, hint: typeof e.hint === "string" ? e.hint : null };
}
