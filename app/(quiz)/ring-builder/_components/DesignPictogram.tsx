// DesignPictogram — ภาพประกอบ "ตำแหน่งเม็ด" แบบ schematic ของแต่ละแบบ (SVG · aria-hidden · ไม่ใช่ภาพถ่าย/ภาพ 3D · ไม่มีสีพลอย)
// ทึบ = พลอยหลัก · กลวง = พลอยเสริม (ไม่พึ่งสีอย่างเดียว) · สร้างจาก design.layout + mainIndexes — ไม่มี points เขียนมือ ไม่ import row-presets (Z7)
// ⚠ ยังต้องให้เจ้าของ/Sabé ดูว่าตรงกับของจริงก่อนขึ้นสาธารณะ (UX §13)
import { gemSlotCount, mainIndexes, type ShowcaseDesign } from "@/lib/ring-builder/showcase/designs";

interface Dot {
  x: number;
  y: number;
  r: number;
  role: "main" | "sub" | "cz";
}

/** พิกัดจุดใน viewBox 48×32 */
export function pictogramDots(design: ShowcaseDesign): Dot[] {
  if (design.layout.kind === "bypass") {
    const dots: Dot[] = [
      { x: 19, y: 11, r: 5.2, role: "main" },
      { x: 29, y: 21, r: 5.2, role: "sub" },
    ];
    // CZ เล็ก (จุดเล็ก) ตามจำนวน extraCz — เรียงเยื้องข้างพลอยไข่
    const czSpots: [number, number][] = [
      [37, 9],
      [11, 24],
    ];
    for (let i = 0; i < Math.min(design.extraCz, czSpots.length); i++) dots.push({ x: czSpots[i][0], y: czSpots[i][1], r: 1.9, role: "cz" });
    return dots;
  }
  const n = gemSlotCount(design);
  const mains = new Set(mainIndexes(n));
  const r = n <= 3 ? 4.6 : n === 4 ? 3.9 : n === 6 ? 3.3 : 2.7;
  const dots: Dot[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : (2 * i) / (n - 1) - 1; // -1..1
    dots.push({ x: 6 + ((u + 1) / 2) * 36, y: 24 - 11 * (1 - u * u), r, role: mains.has(i) ? "main" : "sub" });
  }
  return dots;
}

export function DesignPictogram({ design, className }: { design: ShowcaseDesign; className?: string }) {
  const dots = pictogramDots(design);
  return (
    <svg viewBox="0 0 48 32" className={className} aria-hidden="true" focusable="false">
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={d.role === "main" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={d.role === "main" ? 0 : d.role === "cz" ? 1 : 1.5}
        />
      ))}
    </svg>
  );
}
