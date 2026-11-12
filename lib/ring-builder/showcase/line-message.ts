// lib/ring-builder/showcase/line-message.ts — ข้อความ + ลิงก์ LINE ของหน้าแบบแหวน (pure)
// โครงข้อความ = UX spec ข้อ 3 (โครง HANDOFF §5) · ไม่มีรหัสยืนยัน/QR/ชื่อลูกค้า/ข้อมูลส่วนบุคคล · ราคามาจาก config ค่าเดียว
// 🔴 ข้อความ LINE แก้ได้ก่อนส่ง = ไม่ใช่หลักฐานราคา — แอดมินยืนยันราคาเอง (D2 จะมีรหัส HMAC)
// 🔴 ห้ามพิมพ์ LINE ID/URL ที่นี่ — ใช้ lineOaMessageUrl จาก lib/shop/line.ts ที่เดียว
import { lineOaMessageUrl } from "@/lib/shop/line";
import { CZ_WHITE, LINE_COPY } from "../config";
import { SHOWCASE_DESIGN_NAME, SHOWCASE_SIZE_RANGE, formatPriceThb, leadTimeLabel } from "./config";

export interface ShowcaseLineInput {
  /** 1..3 = แบบจาก quiz · null = เข้าตรง (CZ ขาว) */
  setIndex: number | null;
  topLabel: string;
  bottomLabel: string;
  /** null = ยังไม่เลือก ("รอแอดมินช่วยเช็ก") · ที่ไม่ใช่ integer ในช่วงของแบบ = ไม่สร้างข้อความ (X3) */
  size: number | null;
}

export function isShowcaseSize(size: unknown): size is number {
  return typeof size === "number" && Number.isInteger(size) && size >= SHOWCASE_SIZE_RANGE.min && size <= SHOWCASE_SIZE_RANGE.max;
}

/** ข้อความ LINE · คืน null เมื่อไซซ์ผิด (ไม่ใช่ null และไม่อยู่ใน 55–58) — UI ต้องไม่ให้เกิดเคสนี้ แต่ด่านอยู่ที่นี่ */
export function buildShowcaseLineMessage(input: ShowcaseLineInput): string | null {
  if (input.size !== null && !isShowcaseSize(input.size)) return null;
  const designLine = input.setIndex === null ? `แบบ: ${SHOWCASE_DESIGN_NAME}` : `แบบ: ${SHOWCASE_DESIGN_NAME} · แบบ ${input.setIndex}`;
  const sizeLine = input.size === null ? `ไซซ์: ${LINE_COPY.sizeAdminCheck}` : `ไซซ์: เบอร์ ${input.size}`;
  return [
    LINE_COPY.greeting,
    designLine,
    `พลอยบน: ${input.topLabel} · พลอยล่าง: ${input.bottomLabel} · CZ เล็ก 2 เม็ด`,
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
