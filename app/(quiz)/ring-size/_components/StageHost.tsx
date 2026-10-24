"use client";

import type { ReactNode } from "react";
import { useElementSize, type ElementSize } from "@/lib/ring-size/use-element-size";
import { stageHeightCss } from "@/lib/ring-size/stage-geometry";

// StageHost — กรอบเวทีวัด: ความสูง = clamp(MIN, 100dvh − RESERVE, MAX) (ค่าใน CALIBRATION.STAGE · ห้าม 100vh)
//
// โครง 2 ชั้นโดยตั้งใจ: ชั้นนอกมีเส้นขอบ · ชั้นในที่ "วัดขนาด" ไม่มี border/padding เลย
// (getBoundingClientRect ของชั้นในจึง = พื้นที่วาด SVG เป๊ะ → 1 หน่วย SVG = 1 CSS px)
// touch-action: none เฉพาะเวที (ไม่ปิด pinch-zoom ทั้งหน้า — ซูมตรวจด้วย G1) · ไม่มี handler จาก touch (B18)
// ความสูงใช้ style เพราะค่ามาจาก config ที่เดียว (class ของ Tailwind ต้องเป็นสตริงตายตัว จะซ้ำค่าสองที่)

export function StageHost({
  kind,
  children,
  overlay,
}: {
  kind: "card" | "coin" | "disc";
  children: (size: ElementSize) => ReactNode;
  overlay?: ReactNode;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  return (
    <div className="shrink-0 border-y border-[var(--rs-border)] bg-[var(--rs-surface)]">
      <div ref={ref} className="relative w-full touch-none overflow-hidden" style={{ height: stageHeightCss(kind) }}>
        {size ? children(size) : null}
        {overlay}
      </div>
    </div>
  );
}
