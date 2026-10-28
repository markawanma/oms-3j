import { CALIBRATION } from "@/lib/ring-size/config";
import { circleRadiusFor } from "@/lib/ring-size/stage-geometry";
import { STAGE_BRAND, StageSvg } from "./StageSvg";

// R2Coin: วงแดงวงเดียวกลางเวที — ขอบในของเส้น = ขอบเหรียญ (Ø 26 มม.)
// DOM ที่อนุญาต: <svg> + <circle fill="none"> ×1 (ป้ายข้อความ "วางเหรียญตรงกลางวงนี้" อยู่นอก svg ที่จอ)
// ห้ามวงเหรียญสีเงิน/ทอง · ตัวเลข "10"
export function CoinCalibrationStage({ width, height, ppm }: { width: number; height: number; ppm: number }) {
  const sw = CALIBRATION.STROKE_PX;
  const r = circleRadiusFor(CALIBRATION.REF.coin.mm, ppm, sw);
  return (
    <StageSvg width={width} height={height}>
      <circle data-testid="coin-ring" cx={width / 2} cy={height / 2} r={r} fill="none" stroke={STAGE_BRAND} strokeWidth={sw} />
    </StageSvg>
  );
}
