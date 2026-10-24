import type { ReactNode } from "react";
import { MEASURE, RULER_LAYOUT } from "@/lib/ring-size/config";
import { rulerHeightPx, rulerYPx } from "@/lib/ring-size/stage-geometry";
import { STAGE_BRAND, STAGE_INK } from "./StageSvg";

// R5B: ไม้บรรทัด 0–80 มม. (คอลัมน์ซ้ายกว้าง 156 px คงที่) + เส้นอ่านค่าแดง 2 px + ที่จับ
// ไม่วาดแถบกระดาษจำลอง (กระดาษจริงวางในคอลัมน์ซ้ายข้างสันไม้บรรทัด) · เส้นอ่านค่ายาวเฉพาะ x = 0…150
// ขนาดของไม้บรรทัด = ขนาดจริงทางกายภาพ 80 มม. × ppm — ย่อไม่ได้ (จึงต้องมี G2 เมื่อจอสูงไม่พอ)

/** ตัวหนังสือเลขไม้บรรทัด ≥ 13 px */
const RULER_NUM_PX = 13;
const READ_LINE_END_X = 150;

export function RulerStage({ ppm, valueMm, label }: { ppm: number; valueMm: number; label?: string }) {
  const { LEFT_COL_PX, SPINE_X, TOP_PAD, HANDLE_VISIBLE_PX } = RULER_LAYOUT;
  const height = rulerHeightPx(ppm, MEASURE.RULER_MM);
  const y = rulerYPx(valueMm, ppm);
  const hx = 8 + HANDLE_VISIBLE_PX / 2;
  const ticks: ReactNode[] = [];
  for (let i = 0; i <= MEASURE.RULER_MM; i++) {
    const ten = i % 10 === 0;
    const five = i % 5 === 0;
    const len = ten ? 22 : five ? 15 : 9;
    const ty = rulerYPx(i, ppm);
    ticks.push(<line key={`t${i}`} x1={SPINE_X - len} x2={SPINE_X} y1={ty} y2={ty} stroke={STAGE_INK} strokeWidth={1} />);
    if (ten) {
      ticks.push(
        <text key={`n${i}`} x={30} y={ty + RULER_NUM_PX / 2 - 1} textAnchor="end" fontSize={RULER_NUM_PX} fill={STAGE_INK}>
          {i}
        </text>
      );
    }
  }
  return (
    <svg
      width={LEFT_COL_PX}
      height={height}
      viewBox={`0 0 ${LEFT_COL_PX} ${height}`}
      shapeRendering="geometricPrecision"
      role="img"
      aria-label={label}
      className="block"
    >
      <line x1={SPINE_X} x2={SPINE_X} y1={TOP_PAD} y2={rulerYPx(MEASURE.RULER_MM, ppm)} stroke={STAGE_INK} strokeWidth={1.5} />
      {ticks}
      <line data-testid="ruler-read-line" x1={0} x2={READ_LINE_END_X} y1={y} y2={y} stroke={STAGE_BRAND} strokeWidth={2} />
      <circle cx={hx} cy={y} r={HANDLE_VISIBLE_PX / 2} fill={STAGE_BRAND} />
      <path
        d={`M${hx - 4} ${y - 3}l4 -4 4 4M${hx - 4} ${y + 3}l4 4 4 -4`}
        fill="none"
        stroke="#fff"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
