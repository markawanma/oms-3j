// GemIcon — ไอคอนพลอยเหลี่ยม (faceted gem). พอร์ตพิกัดพอลิกอนจาก
// docs/3j-jewelry/analytics/gem-quiz-v2-handoff/design/Gem.dc.html คำต่อคำ
// (ไฟล์ต้นฉบับไม่มี id/class บน polygon แต่ละชิ้น — แกะลำดับตามไฟล์ตรงๆ ทีละ
// <polygon>, ห้ามเขียนเป็นเลขอื่นที่ "ดูคล้ายกัน").
//
// ตกแต่งล้วน (decorative) — ทุกจุดที่ใช้ GemIcon มีข้อความชื่อพลอยอยู่ข้างๆ
// เสมอ (OptionCard/GemPicker/ResultScreen ฯลฯ) จึงไม่ต้องมี accessible name
// ของตัวเอง: aria-hidden="true" เสมอ.
import type { GemQuizStoneColors } from "@/lib/gem-quiz/config";

export function GemIcon({
  colors,
  size = 64,
  className = "",
}: {
  colors: GemQuizStoneColors;
  size?: number;
  className?: string;
}) {
  const { base: color, light, dark } = colors;
  return (
    <div
      aria-hidden="true"
      className={`inline-block shrink-0 drop-shadow-[0_6px_10px_rgba(40,10,12,0.22)] ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: "block" }}>
        <polygon points="50,4 82,18 96,50 82,82 50,96 18,82 4,50 18,18" fill={dark} />
        <polygon points="82,18 67,33 50,26" fill={color} />
        <polygon points="96,50 74,50 67,33" fill={color} />
        <polygon points="82,82 67,67 74,50" fill={color} />
        <polygon points="50,96 50,74 67,67" fill={dark} opacity={0.7} />
        <polygon points="18,82 33,67 50,74" fill={dark} opacity={0.7} />
        <polygon points="4,50 26,50 33,67" fill={color} />
        <polygon points="18,18 33,33 26,50" fill={color} />
        <polygon points="50,4 50,26 33,33" fill={color} />
        <polygon points="50,4 82,18 50,26" fill={light} opacity={0.9} />
        <polygon points="82,18 96,50 67,33" fill={light} opacity={0.55} />
        <polygon points="96,50 82,82 74,50" fill={light} opacity={0.35} />
        <polygon points="82,82 50,96 67,67" fill={light} opacity={0.2} />
        <polygon points="50,96 18,82 50,74" fill={light} opacity={0.25} />
        <polygon points="18,82 4,50 33,67" fill={light} opacity={0.45} />
        <polygon points="4,50 18,18 26,50" fill={light} opacity={0.8} />
        <polygon points="18,18 50,4 33,33" fill={light} />
        <polygon points="50,26 67,33 74,50 67,67 50,74 33,67 26,50 33,33" fill={color} />
        <polygon points="50,26 74,50 50,74 26,50" fill={light} opacity={0.28} />
        <polygon points="50,26 67,33 74,50 50,50" fill={dark} opacity={0.18} />
        <polygon points="33,33 50,26 43,41" fill="#FFFFFF" opacity={0.6} />
        <polygon points="22,22 34,14 28,26" fill="#FFFFFF" opacity={0.45} />
        <polygon points="50,4 82,18 96,50 82,82 50,96 18,82 4,50 18,18" fill="none" stroke={dark} strokeWidth={1} />
      </svg>
    </div>
  );
}
