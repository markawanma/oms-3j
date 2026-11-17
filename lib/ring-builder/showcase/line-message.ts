// lib/ring-builder/showcase/line-message.ts — ข้อความ + ลิงก์ LINE ของหน้าแบบแหวน (pure)
// โครงข้อความ = UX spec ข้อ 3 (โครง HANDOFF §5) · ไม่มีรหัสยืนยัน/QR/ชื่อลูกค้า/ข้อมูลส่วนบุคคล · ราคามาจาก config ค่าเดียว
// 🔴 ข้อความ LINE แก้ได้ก่อนส่ง = ไม่ใช่หลักฐานราคา — แอดมินยืนยันราคาเอง (D2 จะมีรหัส HMAC)
// 🔴 ห้ามพิมพ์ LINE ID/URL ที่นี่ — ใช้ lineOaMessageUrl จาก lib/shop/line.ts ที่เดียว
// D1.1: รับ "รหัสพลอย" (ไม่ใช่ label) แล้วตรวจ whitelist เองที่นี่ — ค่านอก 5 ชนิด/CZ ในแบบที่ต้องมีพลอย/บรรทัดแบบไม่ตรงโหมด = null (Y2/Y7) · ไม่ใส่เรื่องที่เลือก (intention)
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { CZ_WHITE, LINE_COPY } from "../config";
import { SHOWCASE_COPY, SHOWCASE_DESIGN_NAME, SHOWCASE_SIZE_RANGE, formatPriceThb, leadTimeLabel } from "./config";
import { isStoneCode } from "./quiz-link";

/** สิ่งที่ลูกค้าเลือก — ใช้ทั้งการ์ดสรุปบนจอและข้อความ LINE (จุดเดียว ไม่มีทางไม่ตรงกัน) */
export type ShowcaseChoice =
  /** เข้าตรง / ยังไม่ได้เลือกพลอย: CZ ขาวทั้งสองเม็ด · unpicked = อยู่ในโหมดเลือกเองแต่ยังไม่เลือก (ข้อความ "ยังไม่ได้เลือกพลอยสี" ตรงกันทั้งจอและ LINE) */
  | { kind: "direct"; unpicked?: boolean }
  /** แบบแนะนำ 1..3 */
  | { kind: "rec"; index: number; top: GemQuizStoneCode; bottom: GemQuizStoneCode }
  /** เลือกพลอยเอง */
  | { kind: "own"; top: GemQuizStoneCode; bottom: GemQuizStoneCode };

export interface ShowcaseLineInput {
  choice: ShowcaseChoice;
  /** null = ยังไม่เลือก ("รอแอดมินช่วยเช็ก") · ที่ไม่ใช่ integer ในช่วงของแบบ = ไม่สร้างข้อความ (X3) */
  size: number | null;
}

export function isShowcaseSize(size: unknown): size is number {
  return typeof size === "number" && Number.isInteger(size) && size >= SHOWCASE_SIZE_RANGE.min && size <= SHOWCASE_SIZE_RANGE.max;
}

/** ตรวจ choice (ค่าจากภายนอก type system) แล้วคืนป้ายพลอยบน/ล่าง + บรรทัดแบบ · ผิดอะไรก็ตาม = null */
export function resolveChoice(choice: unknown): { topLabel: string; bottomLabel: string; designLine: string } | null {
  if (typeof choice !== "object" || choice === null) return null;
  const c = choice as { kind?: unknown; index?: unknown; top?: unknown; bottom?: unknown; unpicked?: unknown };
  if (c.kind === "direct") {
    const label = c.unpicked === true ? SHOWCASE_COPY.gemNone : CZ_WHITE.name;
    return { topLabel: label, bottomLabel: label, designLine: `แบบ: ${SHOWCASE_DESIGN_NAME}` };
  }
  if (c.kind !== "rec" && c.kind !== "own") return null;
  if (!isStoneCode(c.top) || !isStoneCode(c.bottom)) return null;
  const topLabel = GEM_QUIZ_STONE_BY_CODE[c.top].labelTh;
  const bottomLabel = GEM_QUIZ_STONE_BY_CODE[c.bottom].labelTh;
  if (c.kind === "own") {
    return { topLabel, bottomLabel, designLine: `แบบ: ${SHOWCASE_DESIGN_NAME} · ${SHOWCASE_COPY.summaryOwn}` };
  }
  if (typeof c.index !== "number" || !Number.isInteger(c.index) || c.index < 1 || c.index > 3) return null;
  return { topLabel, bottomLabel, designLine: `แบบ: ${SHOWCASE_DESIGN_NAME} · แบบ ${c.index}` };
}

/** ข้อความ LINE · คืน null เมื่อไซซ์ผิด (ไม่ใช่ null และไม่อยู่ใน 55–58) หรือ choice ผิดรูป — UI ต้องไม่ให้เกิดเคสนี้ แต่ด่านอยู่ที่นี่ */
export function buildShowcaseLineMessage(input: ShowcaseLineInput): string | null {
  if (input.size !== null && !isShowcaseSize(input.size)) return null;
  const resolved = resolveChoice(input.choice);
  if (!resolved) return null;
  const sizeLine = input.size === null ? `ไซซ์: ${LINE_COPY.sizeAdminCheck}` : `ไซซ์: เบอร์ ${input.size}`;
  return [
    LINE_COPY.greeting,
    resolved.designLine,
    `พลอยบน: ${resolved.topLabel} · พลอยล่าง: ${resolved.bottomLabel} · CZ เล็ก 2 เม็ด`,
    sizeLine,
    `ราคา ${formatPriceThb()} (${leadTimeLabel()})`,
    LINE_COPY.closing,
  ].join("\n");
}

/** ลิงก์เปิดแชทพร้อมข้อความ — null เมื่อข้อความสร้างไม่ได้ */
export function buildShowcaseLineHref(input: ShowcaseLineInput): string | null {
  const msg = buildShowcaseLineMessage(input);
  return msg === null ? null : lineOaMessageUrl(msg);
}

/** ป้ายพลอยตอนเข้าตรง (ไม่มีพลอยจาก quiz) */
export const DIRECT_STONE_LABEL = CZ_WHITE.name;
