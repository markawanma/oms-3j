// PlacementNote — บรรทัดอธิบายตำแหน่ง "เม็ดกลาง = พลอยหลัก · เม็ดข้าง = พลอยเสริม" ของแบบที่เลือก (หัวแผงพลอย ทั้งสองโหมด)
// ข้อความสร้างจาก designs.ts (placementNote) เท่านั้น — ห้ามพิมพ์ "บน/ล่าง" "ทั้ง 2 เม็ด" "CZ เล็ก 2 เม็ด" ตายตัว (Z10)
// perGem (D1.2a · เลือกเองรายเม็ด): ทุกเม็ดเท่ากัน → ใช้ข้อความรายเม็ดแทน (ไม่มีคำว่า พลอยหลัก/พลอยเสริม)
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { isSingleStone, placementNote, type ShowcaseDesign } from "@/lib/ring-builder/showcase/designs";

export function PlacementNote({ design, perGem = false }: { design: ShowcaseDesign; perGem?: boolean }) {
  // เม็ดเดี่ยว: ไม่มีหลัก/เสริมให้อธิบาย → ไม่ render (placementNote = null · perGem ก็ไม่แสดง "ราคาเท่ากันไม่ว่าจะเลือกกี่สี" ที่พูดถึงหลายเม็ด)
  const text = isSingleStone(design) ? null : perGem ? SHOWCASE_COPY.ownPerGemNote : placementNote(design);
  if (text === null) return null;
  return <p className="-mt-1.5 text-sm text-[var(--gq-text-muted)]">{text}</p>;
}
