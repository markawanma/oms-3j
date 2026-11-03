// lib/marketing/ring-size-filters.ts — ตัวกรองช่วงวันที่ของหน้าสรุป /marketing/ring-size
//
// PURE: ไม่มี env / network / DB — ใช้ร่วม 3 ที่: page (แปลง searchParams) · action (ด่านตรวจก่อนเรียก RPC) · client shell (สร้างลิงก์)
// สเปค: docs/3j-jewelry/oms/ux-ring-size-stats.md §4 (+ ตัด `src` ออกตามมติ 25 ต.ค. 69 — RPC ไม่มีตัวกรองช่องทาง)
//
// กติกาช่วงวัน "ต้องเหมือน RPC analytics.ring_size_stats (0193) เป๊ะ": วันไทย inclusive ทั้งสองด้าน ·
// diff = to − from ต้องอยู่ 6..179 (= 7..180 วันปฏิทิน) · วันที่ต้องเป็นวันจริง (ไม่ใช่ 30 ก.พ. / infinity)
// ด่านที่นี่คือด่านแรก — ไม่พึ่ง 22023 จาก RPC (RPC ปล่อย service_role ผ่านด่านสิทธิ์ แต่ตรวจช่วงวันยังทำงาน — แต่ไม่ควรให้ข้อความดิบถึงจอ)

export const RING_STATS_MIN_DAYS = 7;
export const RING_STATS_MAX_DAYS = 180;
export const RING_STATS_DEFAULT_DAYS = 30;

export const RING_RANGE_KEYS = ["7d", "30d", "90d", "180d"] as const;
export type RingRangeKey = (typeof RING_RANGE_KEYS)[number];

const PRESET_DAYS: Readonly<Record<RingRangeKey, number>> = { "7d": 7, "30d": 30, "90d": 90, "180d": 180 };
export const RING_DEFAULT_RANGE: RingRangeKey = "30d";

export const RING_STATS_PATH = "/marketing/ring-size";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** วันนี้ตามเวลาไทย (Asia/Bangkok) "YYYY-MM-DD" — ไม่ใช้ UTC (เหลื่อมวัน 00:00–07:00 ไทย) */
export function bangkokTodayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** วันจริงในปฏิทิน (YYYY-MM-DD เท่านั้น) — "2026-02-30" / "infinity" / "2026-1-5" / มีช่องว่างท้าย = false */
export function isRealDateISO(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === v;
}

/** จำนวนวันที่นับรวมปลายทั้งสองด้าน (from=to ⇒ 1) · ใช้กับวันจริงเท่านั้น */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * ตรวจช่วงวันก่อนส่งเข้า RPC — คืนข้อความไทยที่ปลอดภัยต่อการขึ้นจอ หรือ null เมื่อผ่าน
 * diff 5 ⇒ ปฏิเสธ · 6 ⇒ ผ่าน · 179 ⇒ ผ่าน · 180 ⇒ ปฏิเสธ (ตรงกับ 0193: (to-from) < 6 หรือ > 179 ⇒ 22023)
 */
export function checkRingStatsRange(from: unknown, to: unknown): string | null {
  if (!isRealDateISO(from) || !isRealDateISO(to)) return "ช่วงวันที่ไม่ถูกต้อง";
  if (from > to) return "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด";
  const days = inclusiveDays(from, to);
  if (days < RING_STATS_MIN_DAYS) return `ช่วงวันที่ต้องไม่ต่ำกว่า ${RING_STATS_MIN_DAYS} วัน`;
  if (days > RING_STATS_MAX_DAYS) return `ช่วงวันที่ต้องไม่เกิน ${RING_STATS_MAX_DAYS} วัน`;
  return null;
}

export function presetRange(key: RingRangeKey, today: string): { from: string; to: string } {
  return { from: addDaysISO(today, -(PRESET_DAYS[key] - 1)), to: today };
}

export interface RingSizeFilters {
  from: string;
  to: string;
  /** "custom" = กำหนดเองด้วย from/to · อื่นๆ = chip สัมพัทธ์กับวันนี้ */
  range: RingRangeKey | "custom";
}

export interface ParsedRingSizeFilters extends RingSizeFilters {
  /** ข้อความบอกว่าปรับอะไรให้ (ห้ามปรับเงียบ) — ว่าง = ไม่ได้ปรับ */
  notices: string[];
}

type ParamValue = string | string[] | undefined;

export interface RingSizeSearchParams {
  range?: ParamValue;
  from?: ParamValue;
  to?: ParamValue;
  /** ไม่ใช้แล้ว (มติ 25 ต.ค. 69 ยกเลิกตัวกรองช่องทาง) — รับไว้เพื่อเพิกเฉย ไม่เก็บ ไม่ส่งต่อ */
  src?: ParamValue;
}

/** ค่า query ที่เป็นข้อความเดี่ยวไม่ว่างเท่านั้น (array ซ้ำ key / ว่าง = ไม่มี) */
function single(v: ParamValue): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * แปลง searchParams เป็นตัวกรองที่ผ่าน checkRingStatsRange เสมอ — ค่าผิดแปลงเป็นค่าเริ่มต้น 30 วัน + แจ้ง ไม่ throw
 * precedence: from+to ที่ถูกต้อง ชนะ range · ผิด = ทิ้งทั้งคู่ แล้วใช้ range · range นอกชุด = ค่าเริ่มต้น
 */
export function parseRingSizeFilters(params: RingSizeSearchParams | null | undefined, today: string): ParsedRingSizeFilters {
  const notices: string[] = [];
  const fallback = (): ParsedRingSizeFilters => ({ ...presetRange(RING_DEFAULT_RANGE, today), range: RING_DEFAULT_RANGE, notices });

  const fromRaw = single(params?.from);
  const toRaw = single(params?.to);
  const rangeRaw = single(params?.range);

  if (fromRaw !== null || toRaw !== null) {
    if (fromRaw === null || toRaw === null || !isRealDateISO(fromRaw) || !isRealDateISO(toRaw)) {
      notices.push("วันที่ในลิงก์ไม่ถูกต้อง จึงใช้ค่าที่เลือกไว้แทน");
    } else {
      let from = fromRaw;
      let to = toRaw;
      if (to > today) {
        to = today;
        notices.push("วันที่สิ้นสุดอยู่ในอนาคต ปรับเป็นวันนี้");
      }
      if (from > to) {
        notices.push("วันที่เริ่มอยู่หลังวันที่สิ้นสุด จึงใช้ 30 วันล่าสุดแทน");
        return fallback();
      }
      if (inclusiveDays(from, to) > RING_STATS_MAX_DAYS) {
        from = addDaysISO(to, -(RING_STATS_MAX_DAYS - 1));
        notices.push(`ปรับช่วงวันที่ให้ไม่เกิน ${RING_STATS_MAX_DAYS} วัน (ระบบเก็บข้อมูลย้อนหลัง ${RING_STATS_MAX_DAYS} วัน)`);
      }
      if (inclusiveDays(from, to) < RING_STATS_MIN_DAYS) {
        notices.push(`ช่วงวันที่ต้องไม่ต่ำกว่า ${RING_STATS_MIN_DAYS} วัน จึงใช้ 30 วันล่าสุดแทน`);
        return fallback();
      }
      return { from, to, range: "custom", notices };
    }
  }

  if (rangeRaw !== null) {
    if ((RING_RANGE_KEYS as readonly string[]).includes(rangeRaw)) {
      const key = rangeRaw as RingRangeKey;
      return { ...presetRange(key, today), range: key, notices };
    }
    notices.push("ช่วงเวลาในลิงก์ไม่ถูกต้อง จึงใช้ 30 วันล่าสุดแทน");
  }

  return fallback();
}

/** ลิงก์ของตัวกรอง — 30 วันล่าสุด = URL สะอาด (ไม่มี param) · ไม่มี src เด็ดขาด */
export function ringSizeHref(f: { range: RingRangeKey | "custom"; from?: string; to?: string }): string {
  if (f.range === "custom") {
    const qs = new URLSearchParams({ from: f.from ?? "", to: f.to ?? "" });
    return `${RING_STATS_PATH}?${qs.toString()}`;
  }
  if (f.range === RING_DEFAULT_RANGE) return RING_STATS_PATH;
  return `${RING_STATS_PATH}?range=${f.range}`;
}

/** ปุ่ม "ดูตั้งแต่ {data_since}" — ช่วงต้อง >= 7 วันและ <= 180 วันเสมอ (ไม่งั้น RPC ปฏิเสธ) */
export function rangeFromDataSince(dataSince: string, today: string): { from: string; to: string } {
  const latestAllowedFrom = addDaysISO(today, -(RING_STATS_MIN_DAYS - 1));
  const earliestAllowedFrom = addDaysISO(today, -(RING_STATS_MAX_DAYS - 1));
  let from = dataSince <= latestAllowedFrom ? dataSince : latestAllowedFrom;
  if (from < earliestAllowedFrom) from = earliestAllowedFrom;
  return { from, to: today };
}
