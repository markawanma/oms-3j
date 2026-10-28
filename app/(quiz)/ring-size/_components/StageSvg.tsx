import type { ReactNode } from "react";

// StageSvg — ผืน SVG ของเวทีวัดทุกจอ
//
// 🔴 ห้ามวัตถุจำลอง (บัตร/เหรียญ/แหวน/กระดาษ) บนเวที — เวที = ส่วนที่ปรับได้อย่างเดียว
//    (ผู้ใช้ที่ยังไม่หยิบของจริงจะปรับให้ตรงของปลอม ค่า px/มม. ผิดแต่ดูสำเร็จ — ไม่มีด่านจับ)
// 🔴 ห้าม border/box-sizing บนองค์ประกอบวัด: Tailwind preflight ตั้ง border-box ทั้งแอป → เส้นผ่านศูนย์กลางด้านใน
//    เหลือ d − 2·border ≈ ผิด 2 มม. ที่เส้นรอบวงแหวน · เส้น/วงวาดเป็น stroke ของ SVG แทน
// 🔴 1 หน่วย SVG = 1 CSS px: viewBox = width × height ที่วัดจริง (ผู้เรียกวัดด้วย useElementSize)
//    ห้าม viewBox คงที่ + width:100% (สเกลเพี้ยน = ค่าเทียบเพี้ยน) · ไม่ปัดเลข · geometricPrecision

export function StageSvg({ width, height, label, children }: { width: number; height: number; label?: string; children: ReactNode }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="geometricPrecision"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="block"
    >
      {children}
    </svg>
  );
}

export const STAGE_BRAND = "var(--rs-brand)";
export const STAGE_INK = "var(--rs-text)";
