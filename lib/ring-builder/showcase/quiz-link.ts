// lib/ring-builder/showcase/quiz-link.ts — สัญญา URL ของหน้าแหวน (§9.1 D1.1) + ตัว parse/สร้างลิงก์ (pure)
// 🔴 หน้าอ่านแค่ 6 key: g (D1 เดิม) · t · i · q · c · d — ?price= ?size= ?design= ไม่มีผล (X2)
// 🔴 ทุก key ตรวจแยกกัน ผิดรูป = ถือว่าไม่มี key นั้น ไม่ throw (X1/Y1) · ไม่มีค่าดิบจาก URL ไปถึง DOM/LINE — ค่าที่ผ่านคือรหัสใน whitelist เท่านั้น
// 🔴 t = ตารางอันดับ 6 เรื่อง — ไม่มีคำตอบดิบ แต่ย้อนอนุมานได้: วันเกิด 38% · feeling 44% · liked[0] 62% · ครบทั้งชุด 12.6% (security D1.1 17 พ.ย. 69: รับได้เพราะไม่ผูกตัวตน · เจ้าของต้องรับทราบก่อน production · ทางลดใน D2 = เก็บตารางใน sessionStorage)
// q = เรื่องที่ตอบใน quiz (BUG-1) — t เก็บใน URL เสมอเมื่อมีตาราง · ป้าย "จากแบบทดสอบ" = มี t และ i === q
import { GEM_QUIZ_STONE_CODES, type GemQuizIntention, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import {
  SHOWCASE_PARAM_ANSWERED,
  SHOWCASE_PARAM_DESIGN,
  SHOWCASE_PARAM_INTENTION,
  SHOWCASE_PARAM_KEY,
  SHOWCASE_PARAM_MAX_LEN,
  SHOWCASE_PARAM_OWN,
  SHOWCASE_PARAM_TABLE,
  SHOWCASE_PATH,
  SHOWCASE_SET_COUNT,
} from "./config";

export type GemTop3 = readonly [GemQuizStoneCode, GemQuizStoneCode, GemQuizStoneCode];
export type IntentionTable = Readonly<Record<GemQuizIntention, GemTop3>>;
export interface OwnGems {
  readonly top: GemQuizStoneCode;
  readonly bottom: GemQuizStoneCode;
}
export type DesignParam = 1 | 2 | 3 | "own";

/** ลำดับ 6 เรื่อง = ลำดับตัวเลือกใน GEM_QUIZ_QUESTIONS (test ล็อก) — ลำดับนี้คือรูปแบบของ `t` */
export const INTENTION_CODES: readonly GemQuizIntention[] = ["love", "wealth", "career", "confidence", "calm", "renewal"];

/** รหัสย่อ 1 ตัวอักษรของพลอยใน `t` — g=garnet a=amethyst c=citrine p=peridot b=blue_topaz */
export const STONE_LETTER: Readonly<Record<GemQuizStoneCode, string>> = {
  garnet: "g",
  amethyst: "a",
  citrine: "c",
  peridot: "p",
  blue_topaz: "b",
};
const LETTER_STONE: ReadonlyMap<string, GemQuizStoneCode> = new Map(
  (Object.entries(STONE_LETTER) as [GemQuizStoneCode, string][]).map(([code, letter]) => [letter, code])
);

const TABLE_RE = /^[gacpb]{3}(\.[gacpb]{3}){5}$/;

export function isStoneCode(code: unknown): code is GemQuizStoneCode {
  // includes() เทียบค่าตรงๆ ไม่เดินโซ่ prototype ("constructor"/"__proto__" ไม่ผ่าน)
  return typeof code === "string" && (GEM_QUIZ_STONE_CODES as readonly string[]).includes(code);
}

export function isIntentionCode(code: unknown): code is GemQuizIntention {
  return typeof code === "string" && (INTENTION_CODES as readonly string[]).includes(code);
}

/** รับค่าดิบจาก searchParams (string | string[] | undefined | อะไรก็ได้) → top3 หรือ null · ไม่ throw (param `g` ของ D1) */
export function parseGemParam(raw: unknown): GemTop3 | null {
  if (typeof raw !== "string") return null; // array / undefined / อื่นๆ
  if (raw.length === 0 || raw.length > SHOWCASE_PARAM_MAX_LEN) return null;
  const parts = raw.split(".");
  if (parts.length !== SHOWCASE_SET_COUNT) return null;
  const codes: GemQuizStoneCode[] = [];
  for (const part of parts) {
    if (!isStoneCode(part)) return null;
    if (codes.includes(part)) return null; // ซ้ำ
    codes.push(part);
  }
  return [codes[0], codes[1], codes[2]];
}

/** `t` — 6 กลุ่ม × 3 ตัวอักษร (gacpb) ไม่ซ้ำในกลุ่ม เรียงตาม INTENTION_CODES · ผิดรูป = null */
export function parseTableParam(raw: unknown): IntentionTable | null {
  if (typeof raw !== "string" || raw.length > SHOWCASE_PARAM_MAX_LEN || !TABLE_RE.test(raw)) return null;
  const groups = raw.split(".");
  const entries: [GemQuizIntention, GemTop3][] = [];
  for (let i = 0; i < INTENTION_CODES.length; i++) {
    const letters = groups[i].split("");
    if (new Set(letters).size !== 3) return null; // ซ้ำในกลุ่ม
    const codes = letters.map((l) => LETTER_STONE.get(l));
    if (!codes[0] || !codes[1] || !codes[2]) return null;
    entries.push([INTENTION_CODES[i], [codes[0], codes[1], codes[2]]]);
  }
  return Object.fromEntries(entries) as IntentionTable;
}

/** `i` — 1 ใน 6 รหัส intention */
export function parseIntentionParam(raw: unknown): GemQuizIntention | null {
  return typeof raw === "string" && raw.length <= SHOWCASE_PARAM_MAX_LEN && isIntentionCode(raw) ? raw : null;
}

/** `c` — `<บน>.<ล่าง>` รหัสเต็ม 2 ตัวจาก 5 ชนิด ซ้ำกันได้ · CZ / ชนิดนอก 5 / เม็ดเดียว / 3 เม็ด = null */
export function parseOwnParam(raw: unknown): OwnGems | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > SHOWCASE_PARAM_MAX_LEN) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [top, bottom] = parts;
  return isStoneCode(top) && isStoneCode(bottom) ? { top, bottom } : null;
}

/** `d` — 1/2/3/own */
export function parseDesignParam(raw: unknown): DesignParam | null {
  switch (raw) {
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    case "own":
      return "own";
    default:
      return null;
  }
}

export interface ShowcaseParams {
  /** `g` (ลิงก์ D1 เดิม) */
  top3: GemTop3 | null;
  /** `t` — ใช้ได้เฉพาะเมื่อ `i` ผ่านด้วย (ไม่งั้นเป็น null) */
  table: IntentionTable | null;
  intention: GemQuizIntention | null;
  /** `q` — เรื่องที่ตอบใน quiz · ใช้ได้เมื่อมี t · ไม่มี/ผิดรูป = null (ผู้ใช้ถือ q = i ตอนโหลดแรก) */
  answered: GemQuizIntention | null;
  own: OwnGems | null;
  design: DesignParam | null;
}

export const EMPTY_SHOWCASE_PARAMS: ShowcaseParams = { top3: null, table: null, intention: null, answered: null, own: null, design: null };

/** อ่านเฉพาะ 5 key ของ searchParams (ไม่แตะ key อื่นเลย) */
export function readShowcaseParams(searchParams: Readonly<Record<string, unknown>>): ShowcaseParams {
  const intention = parseIntentionParam(searchParams[SHOWCASE_PARAM_INTENTION]);
  const table = parseTableParam(searchParams[SHOWCASE_PARAM_TABLE]);
  return {
    top3: parseGemParam(searchParams[SHOWCASE_PARAM_KEY]),
    table: intention ? table : null,
    intention,
    answered: intention && table ? parseIntentionParam(searchParams[SHOWCASE_PARAM_ANSWERED]) : null,
    own: parseOwnParam(searchParams[SHOWCASE_PARAM_OWN]),
    design: parseDesignParam(searchParams[SHOWCASE_PARAM_DESIGN]),
  };
}

function isTop3(v: unknown): v is GemTop3 {
  return Array.isArray(v) && v.length === 3 && v.every(isStoneCode) && new Set(v).size === 3;
}

/** ตารางถูกต้องทั้ง 6 เรื่อง (อ่านแบบไม่เดินโซ่ prototype) */
function isCompleteTable(table: unknown): table is IntentionTable {
  if (typeof table !== "object" || table === null) return false;
  return INTENTION_CODES.every((code) => Object.prototype.hasOwnProperty.call(table, code) && isTop3((table as Record<string, unknown>)[code]));
}

function encodeTable(table: IntentionTable): string {
  return INTENTION_CODES.map((code) => table[code].map((s) => STONE_LETTER[s]).join("")).join(".");
}

export interface ShowcaseUrlState {
  /** ตารางจาก quiz — เก็บใน URL เสมอเมื่อมี (reload/แชร์ได้อันดับชุดเดิม) */
  table: IntentionTable | null;
  intention: GemQuizIntention | null;
  /** เรื่องที่ตอบใน quiz → `q` (เขียนเมื่อมี t) */
  answered?: GemQuizIntention | null;
  /** `g` เดิม — ใส่ได้เฉพาะตอนยังไม่เลือกเรื่อง */
  legacyTop3: GemTop3 | null;
  own: OwnGems | null;
  active: "rec" | "own";
  recIndex: 1 | 2 | 3;
}

/**
 * ประกอบ path + query ของหน้า — ที่เดียวที่เขียน URL (history.replaceState / CTA ใช้ฟังก์ชันนี้)
 * ประกอบจากรหัสที่ตรวจแล้วเท่านั้น: ค่าที่ผิดรูปถูกข้าม ไม่ถูกเขียนลง URL (ไม่ต้อง encode เพราะ [a-z_.] ล้วน)
 */
export function buildShowcaseUrl(state: ShowcaseUrlState): string {
  const parts: string[] = [];
  const intention = isIntentionCode(state.intention) ? state.intention : null;
  const hasTable = intention !== null && isCompleteTable(state.table);
  if (hasTable) parts.push(`${SHOWCASE_PARAM_TABLE}=${encodeTable(state.table as IntentionTable)}`);
  if (intention) parts.push(`${SHOWCASE_PARAM_INTENTION}=${intention}`);
  if (hasTable && isIntentionCode(state.answered)) parts.push(`${SHOWCASE_PARAM_ANSWERED}=${state.answered}`);
  if (!intention && isTop3(state.legacyTop3)) parts.push(`${SHOWCASE_PARAM_KEY}=${state.legacyTop3.join(".")}`);
  if (state.own && isStoneCode(state.own.top) && isStoneCode(state.own.bottom)) {
    parts.push(`${SHOWCASE_PARAM_OWN}=${state.own.top}.${state.own.bottom}`);
  }
  if (state.active === "own") parts.push(`${SHOWCASE_PARAM_DESIGN}=own`);
  else if (state.recIndex === 2 || state.recIndex === 3) parts.push(`${SHOWCASE_PARAM_DESIGN}=${state.recIndex}`);
  return parts.length === 0 ? SHOWCASE_PATH : `${SHOWCASE_PATH}?${parts.join("&")}`;
}

/** href ของ CTA บนหน้าผล quiz — `?t=<ตาราง 6 เรื่อง>&i=<เรื่องที่ตอบ>&q=<เรื่องที่ตอบ>` (เลิกส่ง g) · ตารางผิดรูป = ถอด t เหลือ i (ตกเป็นอันดับตามเรื่องล้วน ไม่อ้าง quiz) */
export function buildShowcaseHref(input: { intention: GemQuizIntention; table: IntentionTable }): string {
  return buildShowcaseUrl({
    table: input.table,
    intention: input.intention,
    answered: input.intention,
    legacyTop3: null,
    own: null,
    active: "rec",
    recIndex: 1,
  });
}
