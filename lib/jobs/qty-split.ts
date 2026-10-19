// lib/jobs/qty-split.ts — สูตรจำนวนชิ้นบนจอ "ส่ง" / "รับ" หน้าช่าง (pure · v2 · ux-worker-send-receive-v2.md §4.4 §5.3 §9)
// แสดงผลเท่านั้น — ด่านจริงอยู่ที่ DB (job_core_send/job_core_receive) · จำนวนชิ้น ไม่ใช่เงิน/น้ำหนัก (ไม่มีกรัมในไฟล์นี้)
// ย้ายสูตร allCount/partial/keep ที่เคยฝังใน SendPanel ออกมา "ไม่เปลี่ยนสูตร": ส่งทั้งหมด = ถือ − เสีย (DB หักเสียเอง ไม่ส่ง qtySend) · น้อยกว่า = แยกส่วน (qtySend) · มากกว่า = ผิด
// ศัพท์ชุดเดียว: ส่ง / ส่งไป / เหลือกับฉัน (ไม่ใช้ ส่งต่อ/ส่งออก/ค้าง/ถืออยู่/ส่วนใหม่ บนจอส่ง-รับ)

export type SplitState = "all" | "partial" | "empty" | "over";

export interface SplitView {
  /** ส่งหมดได้กี่ชิ้น = ถือ − เสีย (≥ 0) */
  allCount: number;
  /** ส่งไป (0 เมื่อ empty/over) */
  send: number;
  /** เหลือกับฉัน (0 เมื่อส่งหมด/empty/over) */
  keep: number;
  scrap: number;
  state: SplitState;
}

/** n = จำนวนที่ส่ง · null = ว่าง/พิมพ์ไม่ผ่าน (empty) — โหมด "ส่งหมด" ให้ผู้เรียกส่ง n = ถือ − เสีย */
export function splitView(i: { hold: number; scrap: number; n: number | null }): SplitView {
  const scrap = Math.max(0, i.scrap);
  const allCount = Math.max(0, i.hold - scrap);
  if (i.n === null) return { allCount, send: 0, keep: 0, scrap, state: "empty" };
  if (allCount === 0) return { allCount, send: 0, keep: 0, scrap, state: "all" }; // เสียหมดทั้งก้อน — ไม่มีอะไรจะส่ง
  if (i.n > allCount) return { allCount, send: 0, keep: 0, scrap, state: "over" };
  if (i.n === allCount) return { allCount, send: allCount, keep: 0, scrap, state: "all" };
  return { allCount, send: i.n, keep: allCount - i.n, scrap, state: "partial" };
}

/** เพิ่มของเสียจน allCount < n (n แตะเอง) → n = allCount · ถึง 0 = กลับโหมดส่งหมด (null) · n ว่าง/ไม่แตะ = คงเดิม */
export function clampSendText(text: string | null, hold: number, scrap: number): string | null {
  if (text === null) return null;
  const all = Math.max(0, hold - scrap);
  if (all <= 0) return null;
  if (!/^\d+$/.test(text.trim())) return text;
  return Number(text.trim()) > all ? String(all) : text;
}

/** ปุ่มหลักจอส่ง — พูดผลลัพธ์ (ตาราง §4.4) */
export function sendButtonLabel(v: SplitView & { hold: number }): string {
  if (v.state === "empty") return "ใส่จำนวนที่ส่ง";
  if (v.state === "over") return `ส่งได้ไม่เกิน ${v.allCount} ชิ้น`;
  if (v.allCount === 0) return `แจ้งเสียหมด ${v.hold} ชิ้น`;
  if (v.hold === 1) return "ส่ง 1 ชิ้น";
  if (v.state === "all") return v.scrap > 0 ? `ส่ง ${v.send} ชิ้น · เสีย ${v.scrap}` : `ส่งหมด ${v.send} ชิ้น`;
  return v.scrap > 0 ? `ส่ง ${v.send} ชิ้น · เสีย ${v.scrap} · เหลือกับฉัน ${v.keep}` : `ส่ง ${v.send} ชิ้น · เหลือกับฉัน ${v.keep}`;
}

/** ปุ่มจอส่งปิดเมื่อเลขยังใช้ไม่ได้ (ว่าง/เกิน) — ด่านอื่น (เหตุผลของเสีย/น้ำหนัก) แสดงข้อความใต้ช่องตอนกด ไม่ปิดปุ่ม */
export const sendDisabled = (s: SplitState): boolean => s === "empty" || s === "over";

// ---------------------------------------------------------------------------
export type ReceiveState = "all" | "short" | "empty" | "over";

export interface ReceiveView {
  /** ที่ส่งมา (E) */
  expected: number;
  /** ได้รับ (r) — 0 เมื่อ empty/over */
  got: number;
  /** ขาด = E − r */
  missing: number;
  state: ReceiveState;
}

/** r = จำนวนที่ได้รับ · null = ว่าง/พิมพ์ไม่ผ่าน */
export function receiveView(i: { expected: number; r: number | null }): ReceiveView {
  if (i.r === null) return { expected: i.expected, got: 0, missing: 0, state: "empty" };
  if (i.r > i.expected) return { expected: i.expected, got: 0, missing: 0, state: "over" };
  if (i.r === i.expected) return { expected: i.expected, got: i.r, missing: 0, state: "all" };
  return { expected: i.expected, got: i.r, missing: i.expected - i.r, state: "short" };
}

/** ปุ่มหลักจอรับ (ตาราง §5.3) · expected = null (ไม่รู้จำนวน) = "รับงาน" เดิม */
export function receiveButtonLabel(expected: number | null, v: ReceiveView | null): string {
  if (expected === null || v === null) return "รับงาน";
  if (v.state === "empty") return "ใส่จำนวนที่ได้รับ";
  if (v.state === "over") return `รับได้ไม่เกิน ${expected} ชิ้น`;
  if (v.state === "short") return `รับ ${v.got} ชิ้น · ขาด ${v.missing}`;
  return `รับ ${v.got} ชิ้น`;
}

export const receiveDisabled = (s: ReceiveState): boolean => s === "empty" || s === "over";
