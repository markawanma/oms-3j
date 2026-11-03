// lib/marketing/ring-size-stats.ts — type + ตัวแปลง jsonb จาก analytics.ring_size_stats (0193 ส่วน 5) เป็น RingSizeStats (camelCase)
//
// PURE (ไม่มี env/network) — ใช้ร่วม action (ฝั่ง server) กับ component (client) · shape ต้องตรง 0193 เป๊ะ ห้ามเดา key
//
// 🔴 กติกา (brief P3 เคส 5): ประกอบ object ทีละ field ห้าม spread · key ที่ RPC ไม่ได้สัญญา (แถวดิบ / session id / เวลา) ถูกทิ้งที่นี่
//    ⇒ ต่อให้ RPC เปลี่ยนไปคืนของเกิน มันก็ไปไม่ถึง client · ไม่ echo ค่าที่ไม่รู้จักใน error
//
// ความเข้ม: ตัวเลขหลัก (sessions/returning/measured) ผิด = ทั้งก้อนเป็น null (⇒ error state) ·
// ส่วนอื่นแยก parse ทีละ section — section ที่หาย/ผิด shape = null (หน้าโชว์ "ยังไม่มีข้อมูล" ไม่ crash ไม่แต่งเลข 0 แทน)
import { RING_IN_APP, RING_STAGE_MAX, RING_SIZE_RANGE, type RingInApp } from "@/lib/ring-size/track-schema";

export interface RingMethodStat {
  picked: number;
  measured: number;
  abandonedAtMeasure: number;
  invalidSessions: number;
  remeasured: number;
  /** null เสมอสำหรับวิธี A (แหวนวงเดิมปัดใกล้สุด ไม่มีก้ำกึ่ง) */
  between: number | null;
}

export interface RingSizeStats {
  sessions: number;
  returning: number;
  measured: number;
  /** ช่วงเบอร์ร้านจาก RPC (ห้าม hardcode 45/68 บนหน้าสรุป) — null = ไม่ได้รับ/ผิดรูป */
  shopRange: { min: number; max: number } | null;
  /** วันไทยของข้อมูลแถวแรกที่ยังอยู่ (ไม่ขึ้นกับช่วงวัน) · null = ยังไม่มีข้อมูลเลย */
  dataSince: string | null;
  byInApp: Record<RingInApp, number> | null;
  /** funnel[k] = ไปถึงขั้น k ขึ้นไป (k = 0..7) */
  funnel: number[] | null;
  /** abandonAt[k] = หยุดที่ขั้น k พอดี (k = 0..6) */
  abandonAt: number[] | null;
  resultSizes: { size: number; count: number }[] | null;
  sizeSummary: { belowRange: number; inRange: number; aboveRange: number; betweenCount: number } | null;
  circHist: { mm: number; count: number }[] | null;
  /** วิธีที่เลือก "ล่าสุด" — ไม่ใช่ เคยใช้วิธีไหน (ใช้ methodStats เมื่อวิเคราะห์ต่อวิธี) */
  method: { A: number; B: number } | null;
  methodStats: { A: RingMethodStat; B: RingMethodStat } | null;
  switched: { aToB: number; bToA: number; both: number } | null;
  sawBetween: number | null;
  ref: { card: number; coin: number } | null;
  methodXRef: { aCard: number; aCoin: number; bCard: number; bCoin: number } | null;
  /** cta.* นับเฉพาะปุ่มหน้าผล (R6) — เป็นตัวเลขขั้นต่ำเสมอ */
  cta: { line: number; share: number; shop: number; gemQuiz: number } | null;
  friction: { zoomBlocked: number; calibWarn: number; invalid: number; staleRecalib: number; remeasured: number } | null;
  /** เรียงเก่า→ใหม่ตามที่ RPC ส่ง · ทุกวันในช่วง (รวมวัน 0 ครั้ง) */
  daily: { date: string; sessions: number; measured: number }[] | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** จำนวนนับ: จำนวนเต็ม >= 0 เท่านั้น (NaN/Infinity/ลบ/ทศนิยม/สตริง = ไม่ผ่าน) */
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCounts<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isRecord(v)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = v[k];
    if (!isCount(n)) return null;
    out[k] = n;
  }
  return out;
}

function parseCountArray(v: unknown, length: number): number[] | null {
  if (!Array.isArray(v) || v.length !== length) return null;
  const out: number[] = [];
  for (const n of v) {
    if (!isCount(n)) return null;
    out.push(n);
  }
  return out;
}

function parseMethodStat(v: unknown, allowBetween: boolean): RingMethodStat | null {
  if (!isRecord(v)) return null;
  const { picked, measured, abandoned_at_measure, invalid_sessions, remeasured, between } = v;
  if (!isCount(picked) || !isCount(measured) || !isCount(abandoned_at_measure) || !isCount(invalid_sessions) || !isCount(remeasured)) {
    return null;
  }
  let betweenOut: number | null = null;
  if (allowBetween) {
    if (!isCount(between)) return null;
    betweenOut = between;
  }
  return { picked, measured, abandonedAtMeasure: abandoned_at_measure, invalidSessions: invalid_sessions, remeasured, between: betweenOut };
}

function parseShopRange(v: unknown): { min: number; max: number } | null {
  if (!isRecord(v)) return null;
  const { min, max } = v;
  if (!isCount(min) || !isCount(max) || min > max) return null;
  // ช่วงเบอร์ที่เก็บได้จริงคือ RING_SIZE_RANGE (30..90) — ช่วงนอกนั้นแปลว่า RPC ผิดสัญญา ไม่เอามาวาดตาราง
  if (min < RING_SIZE_RANGE[0] || max > RING_SIZE_RANGE[1]) return null;
  return { min, max };
}

function parseResultSizes(v: unknown): { size: number; count: number }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { size: number; count: number }[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    const { size, count } = item;
    if (!isCount(size) || !isCount(count)) return null;
    out.push({ size, count });
  }
  return out;
}

function parseCircHist(v: unknown): { mm: number; count: number }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { mm: number; count: number }[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    const { mm, count } = item;
    if (!isCount(mm) || !isCount(count)) return null;
    out.push({ mm, count });
  }
  return out;
}

function parseDaily(v: unknown): { date: string; sessions: number; measured: number }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { date: string; sessions: number; measured: number }[] = [];
  for (const item of v) {
    if (!isRecord(item)) return null;
    const { date, sessions, measured } = item;
    // วันที่ต้องเป็น YYYY-MM-DD เท่านั้น — เวลาระดับนาที/วินาทีถึง client ไม่ได้
    if (typeof date !== "string" || !DATE_RE.test(date) || !isCount(sessions) || !isCount(measured)) return null;
    out.push({ date, sessions, measured });
  }
  return out;
}

/** คืน null เมื่อตัวเลขหลักผิดสัญญา · ไม่ throw */
export function parseRingSizeStats(raw: unknown): RingSizeStats | null {
  if (!isRecord(raw)) return null;
  const { sessions, returning, measured } = raw;
  if (!isCount(sessions) || !isCount(returning) || !isCount(measured)) return null;

  const dataSinceRaw = raw.data_since;
  const dataSince = typeof dataSinceRaw === "string" && DATE_RE.test(dataSinceRaw) ? dataSinceRaw : null;

  const byInAppCounts = parseCounts(raw.by_in_app, RING_IN_APP);

  const sizeSummaryCounts = parseCounts(raw.size_summary, ["below_range", "in_range", "above_range", "between_count"] as const);
  const methodRaw = parseCounts(raw.method, ["A", "B"] as const);
  const statsRaw = isRecord(raw.method_stats) ? raw.method_stats : null;
  const statA = statsRaw ? parseMethodStat(statsRaw.A, false) : null;
  const statB = statsRaw ? parseMethodStat(statsRaw.B, true) : null;
  const switchedRaw = parseCounts(raw.switched, ["a_to_b", "b_to_a", "both"] as const);
  const refRaw = parseCounts(raw.ref, ["card", "coin"] as const);
  const mxrRaw = parseCounts(raw.method_x_ref, ["A_card", "A_coin", "B_card", "B_coin"] as const);
  const ctaRaw = parseCounts(raw.cta, ["line", "share", "shop", "gem_quiz"] as const);
  const frictionRaw = parseCounts(raw.friction, ["zoom_blocked", "calib_warn", "invalid", "stale_recalib", "remeasured"] as const);

  return {
    sessions,
    returning,
    measured,
    shopRange: parseShopRange(raw.shop_range),
    dataSince,
    byInApp: byInAppCounts,
    funnel: parseCountArray(raw.funnel, RING_STAGE_MAX + 1),
    abandonAt: parseCountArray(raw.abandon_at, RING_STAGE_MAX),
    resultSizes: parseResultSizes(raw.result_sizes),
    sizeSummary: sizeSummaryCounts
      ? {
          belowRange: sizeSummaryCounts.below_range,
          inRange: sizeSummaryCounts.in_range,
          aboveRange: sizeSummaryCounts.above_range,
          betweenCount: sizeSummaryCounts.between_count,
        }
      : null,
    circHist: parseCircHist(raw.circ_hist),
    method: methodRaw ? { A: methodRaw.A, B: methodRaw.B } : null,
    methodStats: statA && statB ? { A: statA, B: statB } : null,
    switched: switchedRaw ? { aToB: switchedRaw.a_to_b, bToA: switchedRaw.b_to_a, both: switchedRaw.both } : null,
    sawBetween: isCount(raw.saw_between) ? raw.saw_between : null,
    ref: refRaw ? { card: refRaw.card, coin: refRaw.coin } : null,
    methodXRef: mxrRaw ? { aCard: mxrRaw.A_card, aCoin: mxrRaw.A_coin, bCard: mxrRaw.B_card, bCoin: mxrRaw.B_coin } : null,
    cta: ctaRaw ? { line: ctaRaw.line, share: ctaRaw.share, shop: ctaRaw.shop, gemQuiz: ctaRaw.gem_quiz } : null,
    friction: frictionRaw
      ? {
          zoomBlocked: frictionRaw.zoom_blocked,
          calibWarn: frictionRaw.calib_warn,
          invalid: frictionRaw.invalid,
          staleRecalib: frictionRaw.stale_recalib,
          remeasured: frictionRaw.remeasured,
        }
      : null,
    daily: parseDaily(raw.daily),
  };
}
