import { CALIBRATION } from "@/lib/ring-size/config";
import { cardLineXs } from "@/lib/ring-size/stage-geometry";
import { STAGE_BRAND, StageSvg } from "./StageSvg";

// R2: เส้นแดงแนวตั้ง 2 เส้นบนพื้นขาวเรียบ — ขอบในของเส้นชิดขอบบัตร (กว้าง 53.98 มม.)
// DOM ที่อนุญาต: <svg> + <line> ×2 เท่านั้น (ไม่มีกรอบ/ภาพ/สีพื้นของบัตร ไม่มีข้อความ "ภาพจำลอง")
export function CalibrationStage({ width, height, ppm }: { width: number; height: number; ppm: number }) {
  const sw = CALIBRATION.STROKE_PX;
  const [xl, xr] = cardLineXs(width / 2, CALIBRATION.REF.card.mm, ppm, sw);
  return (
    <StageSvg width={width} height={height}>
      <line data-testid="card-line-left" x1={xl} x2={xl} y1={0} y2={height} stroke={STAGE_BRAND} strokeWidth={sw} />
      <line data-testid="card-line-right" x1={xr} x2={xr} y1={0} y2={height} stroke={STAGE_BRAND} strokeWidth={sw} />
    </StageSvg>
  );
}
