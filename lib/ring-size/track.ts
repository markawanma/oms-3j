// lib/ring-size/track.ts — client ส่งสถิติไม่ระบุตัวตนของ /ring-size (design-ring-size-analytics §4.1)
//
// ไฟล์เดียวที่มี network ใต้ ring-size (copy-guard.test.ts allowlist path นี้เป๊ะ) · ปลายทาง = POST /api/ring-size/event
// (route + RPC ตรวจซ้ำทุกชั้น — client นี้ไม่ใช่ด่านความปลอดภัย แต่ต้องส่งให้ตรงสัญญาเพื่อไม่ให้ข้อมูลหาย/นับเกิน)
//
// สัญญา:
//   - track(snapshot): void — sync · ไม่ throw · ไม่ await · ล้มเงียบทุกกรณี (flow วัดต้องไม่รู้ว่ามีสถิติ)
//   - stage 7 (ได้ผล) ส่งได้แค่ 3 แบบ: G4 (g4) · CTA (cta) · ผลวัด (trackMeasured) — event stage 7 แบบอื่นถูกทิ้งทั้ง event
//     (funnel[7] ห้ามพองจาก call site ผิด เหตุผลเดียวกับผลวัด)
//   - ผลวัด (circ_mm/size/between) ส่งได้ทางเดียว = trackMeasured(...) — track() ตัดสามช่องนี้ทิ้ง "เสมอ" ทั้ง type และ runtime
//     (กันด้วยโครงสร้าง ไม่พึ่ง call site: DB นับรอบวัด +1 ทุกครั้งที่ size โผล่ ⇒ call site ใหม่ที่พกผลมาจะนับเกินเงียบๆ)
//   - ไม่ส่งเมื่อ: TRACK_ENABLED ปิด · SSR · DNT หรือ GPC เปิด (เคารพ — มติเจ้าของ O5) · ไม่มี crypto.randomUUID (ไม่ยอมสร้าง id เอง)
//   - sid = crypto.randomUUID() เก็บ sessionStorage[SID_KEY] (ตายเมื่อปิดแท็บ) · เขียนไม่ได้ → ถือในหน่วยความจำ
//   - ไม่ส่งตัวตน: โค้ดนี้ไม่อ่าน/ใส่ IP · UA ดิบ · cookie · ชื่อ · เบอร์โทร · LINE · query string · ไม่มี key `src`/`source`
//     (หยิบ field ตามรายการ RING_SNAPSHOT_KEYS ทีละตัว แล้วผ่าน parseRingTrackBody ซ้ำก่อนส่ง — key แปลกจึงหลุดออกไปไม่ได้)
//   - cookie (พูดตรงๆ): navigator.sendBeacon แนบ cookie ของเว็บเดียวกันเสมอตามสเปกเบราว์เซอร์ (ตั้ง credentials ไม่ได้) —
//     แต่ route ไม่อ่าน cookie และ middleware ไม่รัน path นี้ (exempt exact) · ทางสำรอง fetch ตั้ง credentials: "omit"
//     เลือกคง beacon เป็นทางหลักเพราะส่งรอดตอน navigate (LINE/แชร์/เกมพลอย) ดีกว่า fetch keepalive
//   - Referer: หน้า /ring-size ตั้ง <meta name="referrer" content="strict-origin"> (page.tsx) ⇒ beacon ส่งแค่ origin ไม่ติด query
//     (เช่น fbclid จาก in-app browser) · fetch สำรองตั้ง referrerPolicy "strict-origin" เอง (ไม่ใช้ no-referrer — บาง engine ทำ Origin เป็น "null" แล้ว route 403)
//   - ห้าม import supabase / env / gem-quiz / next (module นี้ลากเข้าหน้า static)
//
// สัญญา event (ฝั่ง DB นับ "ทุกครั้งที่ field เหล่านี้โผล่" — client ต้อง sanitize ให้ครบ ดู sanitize()):
//   - circ_mm/size/between มากับ stage 7 ของ "ได้ผลวัด" เท่านั้น (trackMeasured) · track() ตัดทิ้งเสมอ
//   - event CTA = { stage, cta } เท่านั้น · g4 = event G4 เท่านั้น (stage 7 · ไม่พกเบอร์/มม.)
import { TRACK_ENABLED, TRACK_ENDPOINT } from "./config";
import {
  RING_CIRC_MM_RANGE,
  RING_SIZE_RANGE,
  RING_SNAPSHOT_KEYS,
  RING_STAGE_RESULT,
  isRingSessionId,
  parseRingTrackBody,
  type RingCta,
  type RingMethod,
  type RingTrackSnapshot,
} from "./track-schema";

/** snapshot ที่ track() รับ — ไม่มีช่องผลวัด (ผลส่งผ่าน trackMeasured เท่านั้น) */
export type TrackSnapshot = Omit<RingTrackSnapshot, "circ_mm" | "size" | "between">;

/** ผลวัดที่ได้จริง (finishMeasure สำเร็จ) — ก้อนเดียว ครบทุกช่อง */
export interface MeasuredResult {
  method: RingMethod;
  circ_mm: number;
  size: number;
  between: boolean;
}

/** เก็บ session id ของแท็บนี้ (เวอร์ชันใน key เผื่อเปลี่ยนรูปแบบ) */
export const SID_KEY = "ringSize:sid:v1";
/** event "ได้ผลวัด"/"G4" ซ้ำภายในช่วงนี้ = กดซ้ำ/เรียกซ้ำ → ทิ้ง (รอบวัดจริงห่างกันกว่านี้เสมอ) */
export const MEASURE_THROTTLE_MS = 1000;

const RESULT_KEYS = ["circ_mm", "size", "between"] as const;

// ───── state ของหน้านี้ (หน่วยความจำ — เริ่มใหม่ทุกครั้งที่โหลดหน้า) ─────
let memorySid: string | null = null;
/** ลายเซ็น (method|ref) ล่าสุดที่ส่งต่อ key เหตุการณ์ — ส่งซ้ำลายเซ็นเดิมติดกัน = ทิ้ง · เปลี่ยน method/ref = ส่งใหม่ (DB เก็บ "ล่าสุดทับ") */
const lastSignature = new Map<string, string>();
const lastMeasureAt = new Map<string, number>();

// ───── ด่านก่อนส่ง ─────

/** DNT (navigator · window · ของ Safari/IE เก่า) หรือ GPC เปิด = ผู้ใช้ปฏิเสธการติดตาม */
function isOptedOut(): boolean {
  const nav = navigator as Navigator & { doNotTrack?: string | null; msDoNotTrack?: string | null; globalPrivacyControl?: boolean };
  const win = window as Window & { doNotTrack?: string | null };
  const dnt = [nav.doNotTrack, win.doNotTrack, nav.msDoNotTrack];
  if (dnt.some((v) => v === "1" || v === "yes")) return true;
  return nav.globalPrivacyControl === true;
}

function readStoredSid(): string | null {
  try {
    const v = window.sessionStorage.getItem(SID_KEY);
    return isRingSessionId(v) ? v : null; // ค่าเสีย/ถูกแก้ = ไม่ใช้
  } catch {
    return null; // storage ถูกบล็อก
  }
}

/** sid ของแท็บนี้ · ไม่มี crypto.randomUUID (และไม่มี sid เดิม) = null → ผู้เรียกไม่ส่งเลย */
function getSid(): string | null {
  const stored = readStoredSid();
  if (stored) {
    memorySid = stored;
    return stored;
  }
  if (memorySid) {
    // เคยสร้างแล้วแต่ storage อ่านไม่ได้/ยังไม่มี — ลองเขียนซ้ำเงียบๆ แล้วใช้ตัวเดิม
    try {
      window.sessionStorage.setItem(SID_KEY, memorySid);
    } catch {
      // ถือในหน่วยความจำต่อ
    }
    return memorySid;
  }
  const c = globalThis.crypto as Crypto | undefined;
  if (!c || typeof c.randomUUID !== "function") return null;
  const id = c.randomUUID();
  if (!isRingSessionId(id)) return null;
  memorySid = id;
  try {
    window.sessionStorage.setItem(SID_KEY, id);
  } catch {
    // เขียนไม่ได้ = ถือในหน่วยความจำ (แท็บเดียวกันยังเป็น session เดียว ตราบที่ไม่รีโหลด)
  }
  return id;
}

// ───── สัญญา event ─────

function inRangeNumber(v: unknown, [lo, hi]: readonly [number, number]): v is number {
  return typeof v === "number" && v >= lo && v <= hi;
}

/**
 * หยิบ field ที่รู้จักทีละตัว (ไม่ spread — key แปลกเช่น `src` ไม่มีทางหลุด) แล้วบังคับสัญญา event:
 *  - ลำดับสำคัญ: CTA → G4 → ผลวัด → in_range
 * คืน null = event นี้ไม่ควรส่ง
 */
function sanitize(input: RingTrackSnapshot, allowResult: boolean): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null) return null;
  const src = input as unknown as Record<string, unknown>;

  // CTA: ส่งแค่ stage + cta (ไม่พกผลวัด/method/ธงอื่น — ผลต้องนับครั้งเดียวที่ event ได้ผล)
  if (src.cta !== undefined) {
    return { stage: src.stage, cta: src.cta };
  }

  const out: Record<string, unknown> = {};
  for (const k of RING_SNAPSHOT_KEYS) {
    const v = src[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  delete out.in_range; // DB ไม่เชื่อ (คำนวณใหม่จาก size) — ไม่ส่งให้เสียไบต์
  // track() ธรรมดา: ผลวัดถูกตัดทิ้งเสมอ (ต่อให้ call site ใช้ cast ยัดมา) · มีแต่ trackMeasured ที่ผ่านด่านนี้ไปได้
  if (!allowResult) for (const k of RESULT_KEYS) delete out[k];

  const isResultStage = out.stage === RING_STAGE_RESULT;

  // G4: event ค่าวัดผิดปกติ = stage 7 · ไม่พกเบอร์/มม. · (g4 ที่ stage อื่น = ไม่ใช่ event G4 → ตัด flag ทิ้ง)
  if (out.g4 !== undefined) {
    if (isResultStage && out.g4 === true) {
      for (const k of RESULT_KEYS) delete out[k];
    } else {
      delete out.g4;
    }
  }

  // ผลวัด: ต้องเป็นก้อนเดียวที่ถูกต้อง (circ_mm + size) และมากับ stage 7 เท่านั้น — ไม่งั้นตัดทั้งก้อน (ไม่ทิ้ง event)
  const hasResult = RESULT_KEYS.some((k) => out[k] !== undefined);
  if (hasResult) {
    const valid =
      isResultStage &&
      inRangeNumber(out.circ_mm, RING_CIRC_MM_RANGE) &&
      inRangeNumber(out.size, RING_SIZE_RANGE) &&
      Number.isInteger(out.size) &&
      (out.between === undefined || typeof out.between === "boolean");
    if (!valid) for (const k of RESULT_KEYS) delete out[k];
  }

  return out;
}

/** event "ได้ผลวัด" และ "G4" = นับ +1 ทุกครั้งที่ DB เห็น → ใช้ throttle แทน dedupe */
function measureKind(clean: Record<string, unknown>): "result" | "g4" | null {
  if (clean.stage !== RING_STAGE_RESULT) return null;
  if (clean.g4 === true) return "g4";
  if (clean.size !== undefined) return "result";
  return null;
}

/** true = ส่งได้ (และจดว่าส่งแล้ว) · false = ซ้ำ/ถี่เกินไป → ทิ้ง */
function admit(clean: Record<string, unknown>): boolean {
  const kind = measureKind(clean);
  if (kind) {
    const now = Date.now();
    const last = lastMeasureAt.get(kind);
    if (last !== undefined && now - last >= 0 && now - last < MEASURE_THROTTLE_MS) return false;
    lastMeasureAt.set(kind, now);
    return true;
  }
  // dedupe ต่อ stage/cta: key = ทุก field ยกเว้น method/ref · ลายเซ็น = method|ref
  const keyParts: string[] = [];
  for (const k of RING_SNAPSHOT_KEYS) {
    if (k === "method" || k === "ref") continue;
    if (clean[k] !== undefined) keyParts.push(`${k}=${String(clean[k])}`);
  }
  const key = keyParts.join("&");
  const sig = `${String(clean.method ?? "")}|${String(clean.ref ?? "")}`;
  if (lastSignature.get(key) === sig) return false;
  lastSignature.set(key, sig);
  return true;
}

// ───── ส่ง ─────

function send(json: string): void {
  try {
    if (typeof navigator.sendBeacon === "function" && typeof Blob === "function") {
      if (navigator.sendBeacon(TRACK_ENDPOINT, new Blob([json], { type: "application/json" }))) return;
    }
  } catch {
    // ตกไป fetch
  }
  try {
    if (typeof fetch !== "function") return;
    // credentials omit = ไม่แนบ cookie (ต่างจาก sendBeacon) · referrerPolicy strict-origin = Referer เหลือแค่ origin (ไม่ติด query) แต่ Origin ยังอยู่
    // — ห้ามใช้ no-referrer: บาง engine ทำ header Origin เป็น "null" แล้ว route ปฏิเสธ 403
    void fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "strict-origin",
    }).catch(() => {});
  } catch {
    // ส่งไม่ได้ = ข้าม
  }
}

/** เฉพาะเทสต์: ล้าง state ของหน้า (sid ในหน่วยความจำ · dedupe · throttle) — โค้ดจริงไม่เรียก */
export function resetTrackStateForTests(): void {
  memorySid = null;
  lastSignature.clear();
  lastMeasureAt.clear();
}

function dispatch(snapshot: RingTrackSnapshot, allowResult: boolean): void {
  try {
    if (!TRACK_ENABLED) return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (isOptedOut()) return;

    const clean = sanitize(snapshot, allowResult);
    if (!clean) return;
    // stage 7 = "ได้ผล": ต้องเป็น G4 / CTA / ผลวัดที่ผ่านด่านครบเท่านั้น — อย่างอื่น (รวมผลวัดที่ถูกตัดเพราะค่าผิด) ทิ้งทั้ง event
    if (clean.stage === RING_STAGE_RESULT && clean.cta === undefined && clean.g4 !== true && clean.size === undefined) return;

    // ตรวจรูปร่างด้วยตัวตรวจเดียวกับ route (ผิด = route จะปฏิเสธอยู่แล้ว → ไม่ส่งให้เสียเปล่า) — sid ใส่หลังสุด
    const sid = getSid();
    if (!sid) return;
    const parsed = parseRingTrackBody({ sid, ...clean });
    if (!parsed.ok) return;

    if (!admit(clean)) return;
    send(JSON.stringify({ sid: parsed.data.sessionId, ...parsed.data.snapshot }));
  } catch {
    // สถิติห้ามกระทบ flow วัด
  }
}

/** ส่ง snapshot ของ state ณ ขณะนั้น — ดูสัญญาที่หัวไฟล์ · ไม่ throw ไม่ await · ไม่ส่งผลวัด (ใช้ trackMeasured) */
export function track(snapshot: TrackSnapshot): void {
  dispatch(snapshot as RingTrackSnapshot, false);
}

/**
 * ปุ่มหน้าผล (R6/LineCta) — event CTA พกแค่ stage 7 + cta · ยิงตอนกดก่อน navigate (sync ไม่รอ network)
 * ที่เดียวที่ screen ใช้ส่ง cta (screen ไม่ต้องรู้เลข stage)
 */
export function trackCta(cta: RingCta): void {
  track({ stage: RING_STAGE_RESULT, cta });
}

/**
 * ส่งผลวัด (stage 7 + method + circ_mm + size + between) — ทางเดียวที่ส่งผลได้ · DB นับรอบวัด +1 ทุกครั้ง
 * เรียกจาก finishMeasure ที่ "ได้ผลสำเร็จ" ที่เดียวเท่านั้น (copy-guard.test.ts นับ call site ใต้ app/(quiz)/ring-size ต้อง = 1)
 * หยิบทีละ field ไม่ spread
 */
export function trackMeasured(result: MeasuredResult): void {
  dispatch(
    { stage: RING_STAGE_RESULT, method: result.method, circ_mm: result.circ_mm, size: result.size, between: result.between },
    true
  );
}
