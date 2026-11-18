// PlacementNote — บรรทัดอธิบายตำแหน่ง "เม็ดกลาง = พลอยหลัก · เม็ดข้าง = พลอยเสริม" ของแบบที่เลือก (หัวแผงพลอย ทั้งสองโหมด)
// ข้อความสร้างจาก designs.ts (placementNote) เท่านั้น — ห้ามพิมพ์ "บน/ล่าง" "ทั้ง 2 เม็ด" "CZ เล็ก 2 เม็ด" ตายตัว (Z10)
import { placementNote, type ShowcaseDesign } from "@/lib/ring-builder/showcase/designs";

export function PlacementNote({ design }: { design: ShowcaseDesign }) {
  return <p className="-mt-1.5 text-sm text-[var(--gq-text-muted)]">{placementNote(design)}</p>;
}
