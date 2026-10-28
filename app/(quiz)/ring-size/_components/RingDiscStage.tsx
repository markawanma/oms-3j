import { discRadiusPx } from "@/lib/ring-size/stage-geometry";
import { STAGE_BRAND, STAGE_INK, StageSvg } from "./StageSvg";

// R5A: วงทึบแดงกลางเวที + กากบาทบางๆ ผ่านศูนย์กลาง (ช่วยจัดแหวนให้ช่องว่างรอบวงเท่ากัน)
// d เป็น มม. ใน state → r = d × ppm ÷ 2 (ไม่มีขอบเส้น ไม่มี border) · ห้ามภาพแหวนจำลอง
export function RingDiscStage({ width, height, ppm, diameterMm }: { width: number; height: number; ppm: number; diameterMm: number }) {
  const cx = width / 2;
  const cy = height / 2;
  const r = discRadiusPx(diameterMm, ppm);
  return (
    <StageSvg width={width} height={height}>
      <circle data-testid="ring-disc" cx={cx} cy={cy} r={r} fill={STAGE_BRAND} />
      <line x1={0} x2={width} y1={cy} y2={cy} stroke={STAGE_INK} strokeOpacity={0.4} strokeWidth={1} />
      <line x1={cx} x2={cx} y1={0} y2={height} stroke={STAGE_INK} strokeOpacity={0.4} strokeWidth={1} />
    </StageSvg>
  );
}
