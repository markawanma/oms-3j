// lib/ring-size/track-schema.ts — สัญญาข้อมูลสถิติของ /ring-size (design-ring-size-analytics §4.2)
//
// PURE: ไม่มี env / network / DB / import นอกโฟลเดอร์นี้ — ใช้ร่วมกัน 2 ฝั่ง:
//   - client (lib/ring-size/track.ts · P2) ใช้ชนิด + ค่าคงที่ + inAppBucket ประกอบ snapshot
//   - route handler (app/api/ring-size/event/route.ts) ใช้ parseRingTrackBody ตรวจ body ก่อนเรียก RPC
// allowlist ที่นี่ต้องตรงกับ v_allowed ใน analytics.ring_size_session_upsert (migration 0193) —
// track-schema.test.ts อ่านไฟล์ migration มาเทียบ ถ้าแก้ฝั่งเดียวเทสต์ล้ม
//
// กติกา: หยิบทีละ field (ไม่ spread body) · ทุก field ที่ไม่รู้จัก = ปฏิเสธ · ค่า null/NaN/Infinity ไม่ผ่าน ·
// ไม่ echo ค่าที่ client ส่งมากลับใน reason (reason เป็นรหัสคงที่เพื่อใช้ debug/test เท่านั้น)

/** ขั้นของ session — index = เลข stage ที่ส่ง/เก็บ (0..7) · ชุดเดียวของทั้งระบบ */
export const RING_STAGES = ["view", "start", "calib_pick", "calib_adjust", "calib_done", "method_pick", "measure", "result"] as const;
export const RING_STAGE_MAX = RING_STAGES.length - 1;

export const RING_IN_APP = ["line", "tiktok", "fb", "ig", "browser", "unknown"] as const;
export const RING_CTA = ["line", "share", "shop", "gem_quiz"] as const;
export const RING_REF = ["card", "coin"] as const;
export const RING_METHOD = ["A", "B"] as const;

export type RingInApp = (typeof RING_IN_APP)[number];
export type RingCta = (typeof RING_CTA)[number];
export type RingRef = (typeof RING_REF)[number];
export type RingMethod = (typeof RING_METHOD)[number];

/** session id = crypto.randomUUID() (v4) เท่านั้น */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RING_CIRC_MM_RANGE = [20, 120] as const;
export const RING_SIZE_RANGE = [30, 90] as const;

/** key ทั้งหมดที่ snapshot มีได้ (ไม่รวม sid) — ต้องเท่ากับ v_allowed ใน RPC */
export const RING_SNAPSHOT_KEYS = [
  "in_app", "is_return", "stage", "ref", "method", "circ_mm", "size", "between",
  "in_range", "g1", "g3", "g4", "g5", "cta", "used_a", "used_b", "saw_between",
] as const;

/** stage ของ "ได้ผล" (R6 หรือ G4) — ผลวัด (circ_mm/size/between) ส่งได้เฉพาะ stage นี้ */
export const RING_STAGE_RESULT = 7;

/**
 * snapshot ของ state ณ ขณะนั้น — ทุก field optional ยกเว้น stage · DB รวมแบบ monotonic
 *
 * 🔴 สัญญา event (client ต้องทำตาม — ฝั่ง DB นับ "ทุกครั้งที่ field เหล่านี้โผล่" ไม่ dedupe ให้):
 *  - `circ_mm` / `size` / `between` ส่งเฉพาะ event ที่ "ได้ผลวัด" (finishMeasure สำเร็จ · stage 7) เท่านั้น ·
 *    ที่ stage อื่น = ถูกปฏิเสธ (400 ที่ parseRingTrackBody · 22023 ที่ RPC) · stage 7 ที่มี `size` = นับ +1 รอบวัด
 *    (measure_count) ⇒ ห้ามพกผลซ้ำใน event อื่น (ปุ่ม CTA · ดูผลเดิม · เปลี่ยนวิธี) ไม่งั้นรอบวัดนับเกิน
 *  - `g4` ส่งเฉพาะ event G4 (ค่าวัดผิดปกติ — stage 7 ไม่พกเบอร์) · ทุก event ที่มี g4 = นับ invalid +1
 *  - CTA event (`cta`) ไม่พก `size`/`circ_mm`/`between` — ส่งแค่ stage + cta
 *  - `method` ส่งทุกครั้งที่รู้ (โดยเฉพาะ event ผลวัด/G4): DB ใช้วิธีตอนนั้นตั้ง result_method · invalid_a/b · measure_count_a/b
 */
export interface RingTrackSnapshot {
  stage: number;
  in_app?: RingInApp;
  is_return?: boolean;
  ref?: RingRef;
  method?: RingMethod;
  /** เส้นรอบวงนิ้ว (มม.) ปัด 0.1 — เฉพาะ event ได้ผล (stage 7) */
  circ_mm?: number;
  /** เบอร์หลังปัดตามวิธี — เฉพาะ event ได้ผล (stage 7) · ทุกครั้งที่ส่ง = นับรอบวัด +1 */
  size?: number;
  /** ผลก้ำกึ่งระหว่างเบอร์ (วิธี B) — เฉพาะ event ได้ผล (stage 7) */
  between?: boolean;
  /** client คำนวณมาให้แต่ DB ไม่เชื่อ — คำนวณใหม่จาก size เสมอ */
  in_range?: boolean;
  /** G1 ซูมอยู่ · G3 ค่าเทียบจอผิดปกติ · G4 ค่าวัดผิดปกติ (ส่งเฉพาะ event G4) · G5 ค่าเทียบเก่า */
  g1?: boolean;
  g3?: boolean;
  g4?: boolean;
  g5?: boolean;
  cta?: RingCta;
  used_a?: boolean;
  used_b?: boolean;
  saw_between?: boolean;
}

export interface RingTrackData {
  sessionId: string;
  snapshot: RingTrackSnapshot;
}

export type RingTrackParse = { ok: true; data: RingTrackData } | { ok: false; reason: string };

const BOOL_KEYS = ["is_return", "between", "in_range", "g1", "g3", "g4", "g5", "used_a", "used_b", "saw_between"] as const;

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function inRange(v: unknown, [lo, hi]: readonly [number, number]): v is number {
  // not(between) แบบเดียวกับฝั่ง DB — NaN/Infinity ตก
  return typeof v === "number" && v >= lo && v <= hi;
}

/**
 * ตรวจ body ของ POST /api/ring-size/event (รูปแบบ: { sid, ...snapshot }) → ข้อมูลที่ตรวจแล้วหรือเหตุผลที่ปฏิเสธ
 * route ต้องตอบ 400 ข้อความทั่วไปทุกเหตุผล (ไม่บอก schema ให้คน probe)
 */
export function parseRingTrackBody(raw: unknown): RingTrackParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "not_object" };
  const body = raw as Record<string, unknown>;

  const keys = Object.keys(body);
  if (keys.length > 20) return { ok: false, reason: "too_many_keys" };
  for (const k of keys) {
    if (k !== "sid" && !(RING_SNAPSHOT_KEYS as readonly string[]).includes(k)) return { ok: false, reason: "unknown_key" };
  }

  const sid = body.sid;
  if (typeof sid !== "string" || !UUID_V4_RE.test(sid)) return { ok: false, reason: "bad_sid" };

  const stage = body.stage;
  if (typeof stage !== "number" || !Number.isInteger(stage) || stage < 0 || stage > RING_STAGE_MAX) {
    return { ok: false, reason: "bad_stage" };
  }
  const snapshot: RingTrackSnapshot = { stage };

  if ("in_app" in body) {
    if (!isOneOf(RING_IN_APP, body.in_app)) return { ok: false, reason: "bad_in_app" };
    snapshot.in_app = body.in_app;
  }
  if ("ref" in body) {
    if (!isOneOf(RING_REF, body.ref)) return { ok: false, reason: "bad_ref" };
    snapshot.ref = body.ref;
  }
  if ("method" in body) {
    if (!isOneOf(RING_METHOD, body.method)) return { ok: false, reason: "bad_method" };
    snapshot.method = body.method;
  }
  if ("cta" in body) {
    if (!isOneOf(RING_CTA, body.cta)) return { ok: false, reason: "bad_cta" };
    snapshot.cta = body.cta;
  }
  if ("circ_mm" in body) {
    if (!inRange(body.circ_mm, RING_CIRC_MM_RANGE)) return { ok: false, reason: "bad_circ_mm" };
    snapshot.circ_mm = body.circ_mm;
  }
  if ("size" in body) {
    if (!inRange(body.size, RING_SIZE_RANGE) || !Number.isInteger(body.size)) return { ok: false, reason: "bad_size" };
    snapshot.size = body.size;
  }
  for (const k of BOOL_KEYS) {
    if (k in body) {
      const v = body[k];
      if (typeof v !== "boolean") return { ok: false, reason: "bad_bool" };
      snapshot[k] = v;
    }
  }

  // สัญญา event (security r2 S3): ผลวัดมากับ stage 7 เท่านั้น — ที่ stage อื่นถือว่า client ไม่ตรงสัญญา (ตรงกับ 22023 ใน RPC)
  if (("circ_mm" in body || "size" in body || "between" in body) && stage !== RING_STAGE_RESULT) {
    return { ok: false, reason: "result_stage" };
  }

  return { ok: true, data: { sessionId: sid.toLowerCase(), snapshot } };
}

/**
 * จัดกลุ่มแอปที่เปิดหน้าจาก user-agent (ไม่ส่ง/ไม่เก็บ UA ดิบ — ส่งเฉพาะ bucket)
 * ประมาณการ: webview ใหม่ที่ไม่รู้จักจะตกเป็น browser · ว่าง = unknown
 */
export function inAppBucket(ua: string | null | undefined): RingInApp {
  if (typeof ua !== "string") return "unknown";
  const s = ua.trim();
  if (s === "") return "unknown";
  if (/\bLine\//i.test(s)) return "line";
  if (/BytedanceWebview|musical_ly|TikTok/i.test(s)) return "tiktok";
  if (/FBAN|FBAV|FB_IAB/.test(s)) return "fb";
  if (/Instagram/i.test(s)) return "ig";
  return "browser";
}
