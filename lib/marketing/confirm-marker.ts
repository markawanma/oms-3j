// lib/marketing/confirm-marker.ts — แยกข้อความที่มี marker [ต้องยืนยัน: …] ออกเป็นช่วงๆ เพื่อไฮไลต์บนจอ
// (content-ui-build-plan.md §2.4 ข้อ 6, §5.1 ไฮไลต์ [ต้องยืนยัน])
//
// เป็นการ "แสดงผล" เท่านั้น — ตัวตัดสินว่ามี marker ค้างไหม (บล็อกอนุมัติ) คือ DB
// (content_marker_present: `\[\s*ต้อง\s*ยืนยัน` หลังตัดอักขระล่องหน) → can_approve / confirm_marker_in_text
// regex ฝั่งจอทนวงเล็บเต็มความกว้างและช่องว่างระหว่างคำเหมือนกัน แต่ไม่พยายามเป็นด่าน

export type MarkerSegmentKind = "text" | "confirm" | "verify";

export interface MarkerSegment {
  kind: MarkerSegmentKind;
  text: string;
}

// `[ต้องยืนยัน: …]` — เจ้าของต้องตอบก่อนอนุมัติ (DB บล็อก)
// `[ช่างยืนยัน: …]` / `[…ยืนยัน: …]` อื่นๆ ที่ AI ใส่เป็นหมายเหตุ — ไฮไลต์แบบรองให้เห็น แต่ DB ไม่บล็อก
const MARKER_RE = /[\[［【〔〖]\s*(ต้อง|ช่าง)\s*ยืนยัน[^\]］】〕〗]*[\]］】〕〗]?/g;

export function splitConfirmMarkers(input: string | null | undefined): MarkerSegment[] {
  const text = input ?? "";
  if (!text) return [];
  const out: MarkerSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: m[1] === "ต้อง" ? "confirm" : "verify", text: m[0] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** มี marker ประเภท "ต้องยืนยัน" ในข้อความไหม (ใช้แสดงผลเท่านั้น — ตัวบล็อกจริงคือ DB) */
export function hasConfirmMarker(input: string | null | undefined): boolean {
  return splitConfirmMarkers(input).some((s) => s.kind === "confirm");
}
