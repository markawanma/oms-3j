// lib/ring-builder/showcase/line-message.ts — ข้อความ + ลิงก์ LINE ของหน้าแบบแหวน (pure)
// โครงข้อความ = UX spec D1.2 §7 (ต่อจาก HANDOFF §5) · ไม่มีรหัสยืนยัน/QR/ชื่อลูกค้า/ข้อมูลส่วนบุคคล · ราคามาจาก config ค่าเดียว
// 🔴 ข้อความ LINE แก้ได้ก่อนส่ง = ไม่ใช่หลักฐานราคา — แอดมินยืนยันราคาเอง (D2 จะมีรหัส HMAC)
// 🔴 ห้ามพิมพ์ LINE ID/URL ที่นี่ — ใช้ lineOaMessageUrl จาก lib/shop/line.ts ที่เดียว
// D1.1: รับ "รหัสพลอย" (ไม่ใช่ label) แล้วตรวจ whitelist เองที่นี่ — ค่านอก 5 ชนิด/CZ ในแบบที่ต้องมีพลอย/บรรทัดแบบไม่ตรงโหมด = null (Y2/Y7) · ไม่ใส่เรื่องที่เลือก (intention)
// D1.2: รับ designId แล้วตรวจ whitelist เอง — นอก whitelist = null (ไม่ fallback ต่างจาก parser URL โดยตั้งใจ: ข้อความผิดแบบแย่กว่าไม่มีข้อความ · Z5)
//       ชื่อแบบ/ตำแหน่ง/จำนวน CZ/ช่วงไซซ์ มาจาก designs.ts เท่านั้น · ชุดพลอยเรียก "ชุด n" (แยกจาก "แบบ" = แบบแหวน)
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { CZ_WHITE, LINE_COPY } from "../config";
import { SHOWCASE_COPY, formatPriceThb, leadTimeLabel } from "./config";
import { findShowcaseDesign, ownSlotCount, roleMainLabel, roleSubLabel, type ShowcaseDesign, type ShowcaseDesignId } from "./designs";
import { formatOwnSlots, isOwnSlots, ownSlotLines, slotLabel, type OwnSlotRow } from "./own-slots";
import { isSlotCode, isStoneCode, type SlotCode } from "./quiz-link";

/** สิ่งที่ลูกค้าเลือก — ใช้ทั้งการ์ดสรุปบนจอและข้อความ LINE (จุดเดียว ไม่มีทางไม่ตรงกัน) · top = พลอยหลัก · bottom = พลอยเสริม */
export type ShowcaseChoice =
  /** เข้าตรง / ยังไม่ได้เลือกพลอย: CZ ขาวทุกเม็ด · unpicked = อยู่ในโหมดเลือกเองแต่ยังไม่เลือก (ข้อความ "ยังไม่ได้เลือกพลอยสี" ตรงกันทั้งจอและ LINE) */
  | { kind: "direct"; unpicked?: boolean }
  /** ชุดแนะนำ 1..3 */
  | { kind: "rec"; index: number; top: GemQuizStoneCode; bottom: GemQuizStoneCode }
  /** เลือกพลอยเอง */
  | { kind: "own"; top: SlotCode; bottom: SlotCode }
  /** เลือกพลอยเองรายเม็ด (D1.2a · แบบแถวเท่านั้น) — ซ้าย→ขวา ยาวเท่าจำนวนเม็ดของแบบ · ทุกเม็ดเท่ากัน ไม่มีหลัก/เสริม */
  | { kind: "ownSlots"; codes: readonly SlotCode[] };

export interface ShowcaseLineInput {
  /** แบบแหวน — ต้องอยู่ใน whitelist (ไม่งั้น null) */
  designId: ShowcaseDesignId;
  choice: ShowcaseChoice;
  /** null = ยังไม่เลือก ("รอแอดมินช่วยเช็ก") · ที่ไม่ใช่ integer ในช่วงของ "แบบนั้น" = ไม่สร้างข้อความ (X3 · Z2 ชั้น 2) */
  size: number | null;
}

/** ไซซ์ใช้ได้กับแบบนี้ไหม — integer อยู่ใน sizes ของแบบ · designId ผิด = false */
export function isShowcaseSize(size: unknown, designId: unknown): size is number {
  const design = findShowcaseDesign(designId);
  return design !== undefined && typeof size === "number" && Number.isInteger(size) && design.sizes.includes(size);
}

export interface ResolvedChoice {
  /** ค่าบรรทัด "พลอย: …" */
  gemsLine: string;
  mainLabel: string;
  subLabel: string;
  /** โหมดรายเม็ด: แถวสรุป "เม็ด 1–2 / โกเมน" (helper เดียวกับ LINE/aria) — มีค่า = ไม่ใช้ mainLabel/subLabel */
  slotRows?: OwnSlotRow[];
}

/** ตรวจ choice (ค่าจากภายนอก type system) แล้วคืนบรรทัดพลอย + ชื่อพลอยหลัก/เสริม · ผิดอะไรก็ตาม = null */
export function resolveChoice(choice: unknown, design?: ShowcaseDesign): ResolvedChoice | null {
  if (typeof choice !== "object" || choice === null) return null;
  const c = choice as { kind?: unknown; index?: unknown; top?: unknown; bottom?: unknown; unpicked?: unknown; codes?: unknown };
  if (c.kind === "ownSlots") {
    // ต้องรู้แบบ: แถวเท่านั้น + จำนวนรหัสเท่าจำนวนเม็ด + ทุกรหัสใน whitelist · ไม่ครบ = null (ไม่ fallback · เหมือน Z5)
    if (!design || design.layout.kind !== "row" || !isOwnSlots(c.codes, ownSlotCount(design))) return null;
    const slotRows = formatOwnSlots(c.codes);
    return slotRows ? { gemsLine: SHOWCASE_COPY.summaryOwnSlots, mainLabel: "", subLabel: "", slotRows } : null;
  }
  if (c.kind === "direct") {
    const label = c.unpicked === true ? SHOWCASE_COPY.gemNone : CZ_WHITE.name;
    return { gemsLine: label, mainLabel: label, subLabel: label };
  }
  if (c.kind === "own") {
    // ไขว้เลือกเอง: พลอย 5 ชนิด หรือ CZ ขาว (ชื่อ "CZ ขาว" จาก config) — ชุดแนะนำ (rec) ไม่มี CZ
    if (!isSlotCode(c.top) || !isSlotCode(c.bottom)) return null;
    return { gemsLine: SHOWCASE_COPY.summaryOwn, mainLabel: slotLabel(c.top), subLabel: slotLabel(c.bottom) };
  }
  if (c.kind !== "rec") return null;
  if (!isStoneCode(c.top) || !isStoneCode(c.bottom)) return null;
  const mainLabel = GEM_QUIZ_STONE_BY_CODE[c.top].labelTh;
  const subLabel = GEM_QUIZ_STONE_BY_CODE[c.bottom].labelTh;
  if (typeof c.index !== "number" || !Number.isInteger(c.index) || c.index < 1 || c.index > 3) return null;
  return { gemsLine: SHOWCASE_COPY.setLabel(c.index), mainLabel, subLabel };
}

function stonesLine(design: ShowcaseDesign, r: ResolvedChoice): string {
  const base = `${roleMainLabel(design)}: ${r.mainLabel} · ${roleSubLabel(design)}: ${r.subLabel}`;
  return design.extraCz > 0 ? `${base} · CZ เล็ก ${design.extraCz} เม็ด` : base;
}

/** ข้อความ LINE · คืน null เมื่อแบบ/ไซซ์ผิด (ไซซ์ไม่ใช่ null และไม่อยู่ใน sizes ของแบบ) หรือ choice ผิดรูป — UI ต้องไม่ให้เกิดเคสนี้ แต่ด่านอยู่ที่นี่ */
export function buildShowcaseLineMessage(input: ShowcaseLineInput): string | null {
  const design = findShowcaseDesign((input as { designId?: unknown } | null)?.designId);
  if (!design) return null;
  if (input.size !== null && !isShowcaseSize(input.size, design.id)) return null;
  const resolved = resolveChoice(input.choice, design);
  if (!resolved) return null;
  // แบบแถวที่ยังไม่ได้เลือกพลอยในโหมดเลือกเอง: ไม่พิมพ์บรรทัดหลัก/เสริม (ทุกเม็ดเท่ากัน — "ยังไม่ได้เลือกพลอยสี" พอแล้ว)
  const unpickedRow = design.layout.kind === "row" && (input.choice as { kind?: unknown; unpicked?: unknown }).unpicked === true;
  const stoneLines = resolved.slotRows ? ownSlotLines(resolved.slotRows) : unpickedRow ? [] : [stonesLine(design, resolved)];
  const sizeLine = input.size === null ? `ไซซ์: ${LINE_COPY.sizeAdminCheck}` : `ไซซ์: เบอร์ ${input.size}`;
  return [
    LINE_COPY.greeting,
    `แบบแหวน: ${design.name}`,
    `พลอย: ${resolved.gemsLine}`,
    ...stoneLines,
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
