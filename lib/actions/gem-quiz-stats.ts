"use server";

// lib/actions/gem-quiz-stats.ts — อ่านสถิติภายในของแบบทดสอบเลือกพลอย สำหรับ
// /marketing/gem-quiz (design doc §3.4/§7, ยังไม่ทำหน้า UI รอบนี้ — ไฟล์นี้
// เป็น read action เตรียมไว้ให้ frontend-dev เรียกต่อ). Pattern เดียวกับ
// lib/actions/content.ts: getServiceClient() + requireOwnerAdmin() ชั้นแอป
// + ActionResult<T> + console.error บน catch ทุกจุด.
//
// 🔴 RPC เรียก analytics.crm_require_owner_admin ด้วย แต่ (0154 F5 / migration
// trap #18) ฟังก์ชันนั้น short-circuit ให้ auth.role()='service_role' ผ่าน
// เสมอ — เราเรียกผ่าน getServiceClient() เสมอ ด่านฝั่ง RPC นี้จึงไม่เคยปฏิเสธ
// อะไรจริงในทางปฏิบัติ ด่าน owner/admin ที่มีผลจริงคือ requireOwnerAdmin()
// ด้านล่างนี้เพียงชั้นเดียว (ต่อจาก middleware ที่เช็ค session ไว้ชั้นนอกสุด)
// ห้ามตัดออกโดยคิดว่า RPC จะกันแทนให้ได้
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import { readErrorCode, readErrorMessage, redactUrls } from "@/lib/supabase/postgrest-error";

const SCHEMA = "analytics";

// ไม่ import จาก lib/actions/content.ts (module-private เหมือนกัน) — ด่านเดียว
// กัน แต่คัดลอกตามธรรมเนียมเดิมของ repo (content.ts's header เขียนไว้ชัดว่า
// "คัดลอกไม่ใช่ share" เพื่อไม่ให้ไฟล์นี้มี cross-module dependency)
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสถิติแบบทดสอบพลอยได้" };
  }
  return null;
}

export type GemQuizSrc = "card" | "share" | "live" | "direct";

export interface GemQuizStoneCount {
  code: string;
  labelTh: string;
  priceGroup: 1 | 2;
  count: number;
}

export interface GemQuizCrosstabRow {
  questionCode: string;
  optionCode: string;
  stoneCode: string;
  count: number;
}

export interface GemQuizDailyRow {
  date: string;
  count: number;
}

export interface GemQuizBySrcLikedRow {
  src: GemQuizSrc;
  code: string;
  count: number;
}

export interface GemQuizStats {
  respondents: number;
  bySrc: Record<GemQuizSrc, number>;
  liked: GemQuizStoneCount[];
  likedNone: number;
  recommended: GemQuizStoneCount[];
  agreement: { recommendedInLiked: number; eligible: number };
  crosstab: GemQuizCrosstabRow[];
  daily: GemQuizDailyRow[];
  bySrcLiked: GemQuizBySrcLikedRow[];
}

const SRC_VALUES: readonly GemQuizSrc[] = ["card", "share", "live", "direct"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isGemQuizSrc(v: unknown): v is GemQuizSrc {
  return typeof v === "string" && (SRC_VALUES as readonly string[]).includes(v);
}

function parseStoneCount(v: unknown): GemQuizStoneCount | null {
  if (!isRecord(v)) return null;
  const code = v.code;
  const labelTh = v.label_th;
  const priceGroup = v.price_group;
  const count = v.count;
  if (typeof code !== "string") return null;
  if (typeof labelTh !== "string") return null;
  if (priceGroup !== 1 && priceGroup !== 2) return null;
  if (typeof count !== "number") return null;
  return { code, labelTh, priceGroup, count };
}

function parseStoneCountArray(v: unknown): GemQuizStoneCount[] | null {
  if (!Array.isArray(v)) return null;
  const out: GemQuizStoneCount[] = [];
  for (const item of v) {
    const parsed = parseStoneCount(item);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

/** Type guard ที่ parse jsonb จาก analytics.gem_quiz_stats ให้เป็น GemQuizStats
 * ที่ TS เชื่อได้จริง — ไม่ cast เป็น `any`/`as GemQuizStats` ตรงๆ ที่ไหนเลย คืน
 * null ถ้า shape ไม่ตรงสัญญา (RPC เปลี่ยนไปโดยไม่มีคนแก้ไฟล์นี้คู่กัน) แทนที่จะ
 * throw ครึ่งทาง */
function parseGemQuizStats(raw: unknown): GemQuizStats | null {
  if (!isRecord(raw)) return null;

  const respondents = raw.respondents;
  if (typeof respondents !== "number") return null;

  const bySrcRaw = raw.by_src;
  if (!isRecord(bySrcRaw)) return null;
  const bySrc: Record<GemQuizSrc, number> = { card: 0, share: 0, live: 0, direct: 0 };
  for (const key of SRC_VALUES) {
    const value = bySrcRaw[key];
    if (typeof value !== "number") return null;
    bySrc[key] = value;
  }

  const liked = parseStoneCountArray(raw.liked);
  if (!liked) return null;

  const likedNone = raw.liked_none;
  if (typeof likedNone !== "number") return null;

  const recommended = parseStoneCountArray(raw.recommended);
  if (!recommended) return null;

  const agreementRaw = raw.agreement;
  if (!isRecord(agreementRaw)) return null;
  const recommendedInLiked = agreementRaw.recommended_in_liked;
  const eligible = agreementRaw.eligible;
  if (typeof recommendedInLiked !== "number" || typeof eligible !== "number") return null;

  const crosstabRaw = raw.crosstab;
  if (!Array.isArray(crosstabRaw)) return null;
  const crosstab: GemQuizCrosstabRow[] = [];
  for (const item of crosstabRaw) {
    if (!isRecord(item)) return null;
    const { question_code, option_code, stone_code, count } = item;
    if (
      typeof question_code !== "string" ||
      typeof option_code !== "string" ||
      typeof stone_code !== "string" ||
      typeof count !== "number"
    ) {
      return null;
    }
    crosstab.push({ questionCode: question_code, optionCode: option_code, stoneCode: stone_code, count });
  }

  const dailyRaw = raw.daily;
  if (!Array.isArray(dailyRaw)) return null;
  const daily: GemQuizDailyRow[] = [];
  for (const item of dailyRaw) {
    if (!isRecord(item)) return null;
    const { date, count } = item;
    if (typeof date !== "string" || typeof count !== "number") return null;
    daily.push({ date, count });
  }

  const bySrcLikedRaw = raw.by_src_liked;
  if (!Array.isArray(bySrcLikedRaw)) return null;
  const bySrcLiked: GemQuizBySrcLikedRow[] = [];
  for (const item of bySrcLikedRaw) {
    if (!isRecord(item)) return null;
    const { src, code, count } = item;
    if (!isGemQuizSrc(src) || typeof code !== "string" || typeof count !== "number") return null;
    bySrcLiked.push({ src, code, count });
  }

  return {
    respondents,
    bySrc,
    liked,
    likedNone,
    recommended,
    agreement: { recommendedInLiked, eligible },
    crosstab,
    daily,
    bySrcLiked,
  };
}

export interface GetGemQuizStatsInput {
  /** วันธุรกิจไทย YYYY-MM-DD, inclusive */
  from: string;
  /** วันธุรกิจไทย YYYY-MM-DD, inclusive */
  to: string;
  includeRetake: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getGemQuizStats(input: GetGemQuizStatsInput): Promise<ActionResult<GemQuizStats>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!DATE_RE.test(input.from) || !DATE_RE.test(input.to)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)" };
  }
  if (input.from > input.to) {
    return { ok: false, error: "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("gem_quiz_stats", {
      p_shop_id: shopId,
      p_from: input.from,
      p_to: input.to,
      p_include_retake: input.includeRetake,
    });
    if (error) throw error;

    const parsed = parseGemQuizStats(data);
    if (!parsed) {
      console.error("getGemQuizStats: RPC คืน shape ที่ไม่ตรงสัญญา");
      return { ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    console.error("getGemQuizStats failed", { code: readErrorCode(err), message: redactUrls(readErrorMessage(err)) });
    return { ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
