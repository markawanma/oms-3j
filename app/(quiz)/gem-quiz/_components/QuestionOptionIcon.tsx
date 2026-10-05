// QuestionOptionIcon — ไอคอนตกแต่งของตัวเลือกคำถาม Q1/Q2/Q3/Q5 พอร์ตพิกัด
// <path>/<circle>/<ellipse> จาก design/Quiz.dc.html คำต่อคำ (บรรทัด ~67-107
// สำหรับ birth_day, ~121-148 intention, ~163-190 feeling, ~229-251
// jewelry_type) ต่อ questionCode:optionCode หนึ่งคู่ — บางไอคอน "ใช้ร่วม"
// ข้ามคำถามเพราะ mockup เองก็วาดซ้ำเส้นเดิม (เช่น sun ของ birth_day.sun กับ
// confidence ของ intention ใช้ sparkle/sun เดียวกัน) ไม่ใช่ความผิดพลาดของ
// การพอร์ต.
//
// stroke-width ปรับให้เท่ากันทุกไอคอน (1.4) เพื่อความเรียบง่ายของโค้ด —
// mockup ต้นฉบับสลับ 1.2-1.4 ต่างกันเล็กน้อยระหว่างจอ ซึ่งมองด้วยตาแยกไม่ออก
// ที่ขนาดไอคอน ~22-28px นี้.
import type { SVGProps } from "react";

type IconKey = `${string}:${string}`;

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  return <svg {...common}>{children}</svg>;
}

const RENDERERS: Record<IconKey, (size: number) => React.ReactNode> = {
  // ---- birth_day ----
  "birth_day:sun": (size) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </Svg>
  ),
  "birth_day:mon": (size) => (
    <Svg size={size}>
      <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />
    </Svg>
  ),
  "birth_day:tue": (size) => (
    <Svg size={size}>
      <path d="M12 3c.8 3.6 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2.4 1.4-4 2.5-5 .3 1.9 1.2 3 2.3 3.3C11 8.6 11.5 5.6 12 3z" />
    </Svg>
  ),
  "birth_day:wed": (size) => (
    <Svg size={size}>
      <path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" />
      <path d="M5 19l8-8" />
    </Svg>
  ),
  "birth_day:thu": (size) => (
    <Svg size={size}>
      <path d="M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8z" />
    </Svg>
  ),
  "birth_day:fri": (size) => (
    <Svg size={size}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </Svg>
  ),
  "birth_day:sat": (size) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="5" />
      <ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-22 12 12)" />
    </Svg>
  ),
  // ---- intention ----
  "intention:love": (size) => (
    <Svg size={size}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </Svg>
  ),
  "intention:wealth": (size) => (
    <Svg size={size}>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
    </Svg>
  ),
  "intention:career": (size) => (
    <Svg size={size}>
      <path d="M4 20h16" />
      <rect x="5.5" y="12" width="3" height="5" />
      <rect x="10.5" y="8" width="3" height="9" />
      <rect x="15.5" y="4.5" width="3" height="12.5" />
    </Svg>
  ),
  "intention:confidence": (size) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </Svg>
  ),
  "intention:calm": (size) => (
    <Svg size={size}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M12 9v5M9.5 11.5h5" />
    </Svg>
  ),
  "intention:renewal": (size) => (
    <Svg size={size}>
      <path d="M12 21v-9M12 12c0-4-3-6.5-7.5-6.5 0 4.3 3 6.5 7.5 6.5zM12 12c0-3.2 2.6-5.5 6.5-5.5 0 3.6-2.6 5.5-6.5 5.5z" />
    </Svg>
  ),
  // ---- feeling ----
  "feeling:energy": (size) => (
    <Svg size={size}>
      <path d="M12 3c.8 3.6 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2.4 1.4-4 2.5-5 .3 1.9 1.2 3 2.3 3.3C11 8.6 11.5 5.6 12 3z" />
    </Svg>
  ),
  "feeling:calm": (size) => (
    <Svg size={size}>
      <path d="M3 9.5c3-2 6 2 9 0s6-2 9 0M3 14.5c3-2 6 2 9 0s6-2 9 0" />
    </Svg>
  ),
  "feeling:clarity": (size) => (
    <Svg size={size}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  ),
  "feeling:renew": (size) => (
    <Svg size={size}>
      <path d="M12 21v-9M12 12c0-4-3-6.5-7.5-6.5 0 4.3 3 6.5 7.5 6.5zM12 12c0-3.2 2.6-5.5 6.5-5.5 0 3.6-2.6 5.5-6.5 5.5z" />
    </Svg>
  ),
  "feeling:open": (size) => (
    <Svg size={size}>
      <path d="M9 18.5s-5.5-3.4-5.5-7.8a3.2 3.2 0 0 1 5.5-2.1 3.2 3.2 0 0 1 5.5 2.1" />
      <path d="M15 20.5s-5-3.1-5-7a2.9 2.9 0 0 1 5-1.9 2.9 2.9 0 0 1 5 1.9c0 3.9-5 7-5 7z" />
    </Svg>
  ),
  "feeling:advance": (size) => (
    <Svg size={size}>
      <path d="M3.5 17.5l6-6 4 4 7-7.5" />
      <path d="M14.5 8h6v6" />
    </Svg>
  ),
  // ---- jewelry_type ----
  "jewelry_type:ring": (size) => (
    <Svg size={size}>
      <circle cx="12" cy="14.5" r="6" />
      <path d="M9.5 6.5L12 3.5l2.5 3L12 9z" />
    </Svg>
  ),
  "jewelry_type:necklace": (size) => (
    <Svg size={size}>
      <path d="M5 3c0 6.5 3 9.5 7 9.5s7-3 7-9.5" />
      <path d="M12 12.5l-2.4 3.3L12 20.5l2.4-4.7z" />
    </Svg>
  ),
  "jewelry_type:earring": (size) => (
    <Svg size={size}>
      <circle cx="7.5" cy="4" r="1.4" />
      <path d="M7.5 5.4v3.6M7.5 9l-2.6 4L7.5 18l2.6-5z" />
      <circle cx="16.5" cy="4" r="1.4" />
      <path d="M16.5 5.4v3.6M16.5 9l-2.6 4 2.6 5 2.6-5z" />
    </Svg>
  ),
  "jewelry_type:bracelet": (size) => (
    <Svg size={size}>
      <ellipse cx="12" cy="12" rx="9" ry="5" />
      <ellipse cx="12" cy="12" rx="6" ry="2.6" />
      <path d="M12 7l1 1-1 1-1-1z" />
    </Svg>
  ),
  "jewelry_type:unknown": (size) => (
    <Svg size={size}>
      <path d="M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8z" />
    </Svg>
  ),
};

export function QuestionOptionIcon({
  questionCode,
  optionCode,
  size = 24,
}: {
  questionCode: string;
  optionCode: string;
  size?: number;
}) {
  const render = RENDERERS[`${questionCode}:${optionCode}`];
  return render ? <>{render(size)}</> : null;
}
