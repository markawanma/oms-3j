// lib/ring-builder/showcase/detail-rows.ts — แถวรายละเอียด "สรุปที่เลือก" (label/value) แหล่งเดียว (pure)
// ใช้ร่วมกัน: การ์ดสรุปบนจอ (OrderSummary) · ภาพ "บันทึกรูป" (save-image) · (ต่อไป) หน้า preview แนบรูป LINE — ไม่มีทางไม่ตรงกัน (ux-ring-save-image S6)
// ยกมาจากโค้ดที่เคยประกอบ rows อยู่ใน OrderSummary ตรงๆ — ลำดับ/ข้อความ/ราคาเท่าเดิมทุกตัว (N8) · ราคามาจาก formatPriceThb เท่านั้น
// editTarget = แถวแรกของกลุ่มที่ปุ่ม "แก้" (P1d) พาไป — ไม่ใส่ในแถวย่อย (หลัก/เสริม · ช่วงสีรายเม็ด · CZ เล็ก) และแถวราคา
import { SHOWCASE_COPY, formatPriceThb } from "./config";
import { findShowcaseDesign, isSingleStone, roleMainLabel, roleSubLabel } from "./designs";
import { resolveChoice, type ShowcaseLineInput } from "./line-message";

export type ShowcaseEditTarget = "design" | "gems" | "size";

export interface ShowcaseDetailRow {
  label: string;
  value: string;
  /** มี = แถวนี้ได้ปุ่ม "แก้" ที่พาไปหัวข้อนั้น (แถวเดียวต่อกลุ่ม) */
  editTarget: ShowcaseEditTarget | null;
}

/**
 * แถวสรุปตามลำดับที่แสดง: แบบแหวน · พลอย · (แถวย่อยของพลอย) · (CZ เล็ก) · ไซซ์ · ราคา
 * designId นอก whitelist = null (เหมือน buildShowcaseLineMessage — ไม่ fallback) · choice ผิดรูป → ค่าพลอยเป็น "—" (พฤติกรรมเดิมของจอสรุป)
 */
export function buildShowcaseDetailRows(input: ShowcaseLineInput): ShowcaseDetailRow[] | null {
  const design = findShowcaseDesign((input as { designId?: unknown } | null)?.designId);
  if (!design) return null;
  const { choice, size } = input;
  const resolved = resolveChoice(choice, design);

  // D1.2a: รายเม็ด = แถวช่วงสี (ข้อความเดียวกับ LINE) · แบบแถวที่ยังไม่เลือกพลอยในโหมดเลือกเอง = แถวพลอยแถวเดียว (ไม่มีหลัก/เสริม)
  const slotRows = resolved?.slotRows;
  const unpickedRow = design.layout.kind === "row" && (choice as { kind?: unknown; unpicked?: unknown }).kind === "direct" && (choice as { unpicked?: unknown }).unpicked === true;
  const gemPairs: [string, string][] = slotRows
    ? slotRows.map((r) => [r.label, r.value])
    : unpickedRow
      ? []
      : isSingleStone(design)
        ? [[SHOWCASE_COPY.singleStoneLabel, resolved?.mainLabel ?? "—"]] // เม็ดเดียว: ไม่มีหลัก/เสริม (Z13)
        : [
            [roleMainLabel(design), resolved?.mainLabel ?? "—"],
            [roleSubLabel(design), resolved?.subLabel ?? "—"],
          ];

  const row = (label: string, value: string, editTarget: ShowcaseEditTarget | null = null): ShowcaseDetailRow => ({ label, value, editTarget });
  return [
    row(SHOWCASE_COPY.summaryDesign, design.name, "design"),
    row(SHOWCASE_COPY.summaryGems, resolved?.gemsLine ?? "—", "gems"),
    ...gemPairs.map(([k, v]) => row(k, v)),
    ...(design.extraCz > 0 ? [row(SHOWCASE_COPY.summaryExtraCz, SHOWCASE_COPY.extraCzCount(design.extraCz))] : []),
    row(SHOWCASE_COPY.summarySize, size === null ? SHOWCASE_COPY.sizePending : SHOWCASE_COPY.sizeUnit(size), "size"),
    row(SHOWCASE_COPY.summaryPrice, formatPriceThb(design.id)),
  ];
}
