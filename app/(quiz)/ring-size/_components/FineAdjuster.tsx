"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FOCUS, TEXT } from "./styles";

// FineAdjuster — แถบเลื่อนหยาบ + ปุ่ม −/+ ปรับละเอียด (กดค้าง = เลื่อนซ้ำและเร็วขึ้น)
//
// ก้าว: prop `step` (ค่าคงที่ หรือฟังก์ชันของค่าปัจจุบัน — เช่น ก้าว ppm ของบัตร/เหรียญขึ้นกับ ppm)
// กดค้าง: เริ่มซ้ำหลัง 400 ms ที่ 120 ms/ครั้ง เร่งถึง 40 ms · pointerup/cancel/leave หยุด
// a11y: slider มี aria-valuetext ไทย · ค่าสดประกาศผ่าน live region แบบ debounce (ไม่อ่านทุกการขยับ)
// ที่ขอบช่วง = คงที่ ไม่ NaN · ปุ่มสัมผัส ≥ 56×56
//
// click จากคีย์บอร์ด (detail = 0) ขยับ 1 ก้าว · click ที่ตามหลัง pointerdown (detail > 0) ข้าม เพราะขยับไปแล้วตอน pointerdown

const REPEAT_DELAY_MS = 400;
const REPEAT_START_MS = 120;
const REPEAT_MIN_MS = 40;
const ANNOUNCE_DEBOUNCE_MS = 700;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), Math.max(hi, lo));
}

export function FineAdjuster({
  value,
  min,
  max,
  onChange,
  step,
  sliderLabel,
  decLabel,
  incLabel,
  decAria,
  incAria,
  valueText,
  showSlider = true,
  className,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  step: number | ((current: number) => number);
  sliderLabel: string;
  decLabel: ReactNode;
  incLabel: ReactNode;
  decAria: string;
  incAria: string;
  valueText: (v: number) => string;
  showSlider?: boolean;
  className?: string;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const limitsRef = useRef({ min, max });
  limitsRef.current = { min, max };
  const stepRef = useRef(step);
  stepRef.current = step;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stepOnce = useCallback((dir: 1 | -1) => {
    const cur = valueRef.current;
    const s = typeof stepRef.current === "function" ? stepRef.current(cur) : stepRef.current;
    if (!Number.isFinite(s) || s <= 0) return;
    const { min: lo, max: hi } = limitsRef.current;
    const next = clamp(cur + dir * s, lo, hi);
    if (next !== cur) {
      valueRef.current = next; // ให้ tick ถัดไปเห็นค่าล่าสุดก่อน React render
      onChangeRef.current(next);
    }
  }, []);

  const stopHold = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startHold = useCallback(
    (dir: 1 | -1) => {
      stopHold();
      stepOnce(dir);
      let delay = REPEAT_START_MS;
      const tick = () => {
        stepOnce(dir);
        timerRef.current = setTimeout(tick, delay);
        delay = Math.max(REPEAT_MIN_MS, delay - 10);
      };
      timerRef.current = setTimeout(tick, REPEAT_DELAY_MS);
    },
    [stepOnce, stopHold]
  );

  useEffect(() => stopHold, [stopHold]);

  // live region แบบ debounce
  const [announce, setAnnounce] = useState("");
  const text = valueText(value);
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(text), ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const holdProps = (dir: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startHold(dir);
    },
    onPointerUp: stopHold,
    onPointerCancel: stopHold,
    onPointerLeave: stopHold,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0) stepOnce(dir);
    },
  });

  const btn = `flex min-h-[56px] ${showSlider ? "min-w-[56px] shrink-0" : "min-w-[56px] flex-1 text-center leading-tight"} select-none touch-manipulation items-center justify-center rounded-[16px] border border-[var(--rs-border-btn)] bg-[var(--rs-surface)] px-2.5 text-[14px] font-semibold ${TEXT} active:bg-[var(--rs-blush)] ${FOCUS}`;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button type="button" aria-label={decAria} className={btn} {...holdProps(-1)}>
        {decLabel}
      </button>
      {showSlider ? (
        <input
          type="range"
          aria-label={sliderLabel}
          aria-valuetext={text}
          min={min}
          max={Math.max(max, min)}
          step="any"
          value={clamp(value, min, max)}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value);
            if (Number.isFinite(v)) onChangeRef.current(clamp(v, min, max));
          }}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-[var(--rs-brand)]"
        />
      ) : null}
      <button type="button" aria-label={incAria} className={btn} {...holdProps(1)}>
        {incLabel}
      </button>
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
