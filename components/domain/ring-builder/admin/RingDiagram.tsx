// แผนภาพ 2D แบบง่ายของแถวพลอย (พรีวิวในฟอร์มแบบ) — วงกลม/วงรีเรียงซ้ายไปขวาตามจำนวนเม็ด · ไม่ใช่ 3D · เรขาคณิตล้วน (ไม่มีตัวเลขเงิน)
// สัดส่วนวงรี = major/minor (จำนวนเต็ม mm100) · ทิศเม็ดไข่: along_row = แกนยาวไปตามแถว · across_row = ขวางแถว

const SPACING = 44;
const BASE_R = 13;
const MAX_RATIO = 1.5;

export function RingDiagram({
  count, kind, axis, major, minor,
}: { count: number; kind: "round" | "oval"; axis: "along_row" | "across_row" | null; major: number | null; minor: number | null }) {
  const n = Number.isInteger(count) && count >= 1 && count <= 7 ? count : 0;
  const ratio = kind === "oval" && major && minor && minor > 0 ? Math.min(Math.max(major / minor, 1), MAX_RATIO) : 1;
  const along = axis !== "across_row";
  const rx = kind === "oval" && along ? BASE_R * ratio : BASE_R;
  const ry = kind === "oval" && !along ? BASE_R * ratio : BASE_R;
  const x0 = 200 - ((n - 1) * SPACING) / 2;
  return (
    <svg role="img" aria-label={n === 0 ? "ยังไม่ระบุจำนวนเม็ด" : `แผนภาพแถว ${n} เม็ด ${kind === "oval" ? "ทรงไข่" : "ทรงกลม"}`} width="100%" height="92" viewBox="0 0 400 92" preserveAspectRatio="xMidYMid meet">
      <path d="M20 62c80-28 280-28 360 0v14c-80-26-280-26-360 0z" fill="#C9CAD2" />
      {Array.from({ length: n }).map((_, i) => {
        const cx = x0 + i * SPACING;
        return (
          <g key={i}>
            <ellipse data-testid="ring-stone" cx={cx} cy={44} rx={rx} ry={ry} fill="#fff" stroke="#9A9AA6" strokeWidth="1.5" />
            <text x={cx} y={48} textAnchor="middle" fontSize="12" fontWeight="700" fill="#2A2425">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
