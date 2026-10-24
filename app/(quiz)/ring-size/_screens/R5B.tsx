"use client";

import { useRef, useState } from "react";
import { COPY, MEASURE } from "@/lib/ring-size/config";
import { circToRec, formatMm } from "@/lib/ring-size/size";
import { rulerHeightPx, rulerMmFromY } from "@/lib/ring-size/stage-geometry";
import { useElementSize } from "@/lib/ring-size/use-element-size";
import { useViewportHeight } from "@/lib/ring-size/use-viewport-height";
import { useVisualViewportZoomed } from "@/lib/ring-size/use-visual-viewport-scale";
import { FineAdjuster } from "../_components/FineAdjuster";
import { NoticeBar } from "../_components/NoticeBar";
import { RsButton } from "../_components/RsButton";
import { HEADER_PX, RsHeader } from "../_components/RsHeader";
import { RulerStage } from "../_components/RulerStage";
import { FOCUS, SERIF, TEXT, TEXT_3 } from "../_components/styles";
import { G2 } from "./G2";

// R5B — ไม้บรรทัดบนจอ วัดความยาวแถบกระดาษ (= เส้นรอบวงด้านใน)
//
// 2 คอลัมน์เสมอ (build spec ข้อ 3.2.2): ซ้าย 156 px คงที่ = ไม้บรรทัด 80 มม. (ขนาดจริงทางกายภาพ ย่อไม่ได้) + กระดาษจริงวางข้างสัน
// ขวา = คำสั่ง · ค่าสด · ลด/เพิ่ม 0.5 มม. (≥ 56 px) · คำเตือน · "ใช้ค่านี้" ชิดล่างคอลัมน์ — กระดาษจริงยาว ≥ 150 มม. ไม่ทับปุ่ม
// ที่จับ: เห็น 40 px แต่พื้นที่สัมผัส = ทั้งคอลัมน์ซ้าย (≥ 48 px) · pointer events + touch-action:none เฉพาะคอลัมน์ซ้าย
// จอสูงไม่พอ (visualViewportHeight − header < Hruler) → G2 (เงื่อนไขแสดงผล · ค่าเดิมไม่หาย)
// เวทีนี้เป็นเวทีเดียวที่เปลี่ยนค่าจาก touch ได้ (ลากเส้น) — เวทีอื่นไม่มี handler (B18)

export function R5B({
  step,
  ppm,
  initialMm,
  onBack,
  onChange,
  onConfirm,
  onUseRing,
}: {
  step: { current: number; total: number } | null;
  ppm: number;
  initialMm: number | null;
  onBack: () => void;
  onChange: (mm: number) => void;
  onConfirm: (mm: number) => void;
  onUseRing: () => void;
}) {
  const [mm, setMm] = useState(initialMm ?? MEASURE.RULER_START);
  const [touched, setTouched] = useState(initialMm !== null);
  const zoomed = useVisualViewportZoomed();
  const vh = useViewportHeight();
  const dragging = useRef(false);

  // ความสูงบล็อกบนจริง (header + แถบ G1 ถ้ามี) วัดด้วย getBoundingClientRect · ยังไม่วัด = ความสูง header ที่ตายตัว (52)
  const { ref: topRef, size: topSize } = useElementSize<HTMLDivElement>();
  const topPx = topSize ? topSize.height : HEADER_PX;

  const hRuler = rulerHeightPx(ppm, MEASURE.RULER_MM);
  const tooShort = vh !== null && vh - topPx < hRuler;

  const snap = (v: number) => {
    const clamped = Math.min(Math.max(v, 0), MEASURE.RULER_MM);
    return Math.round(clamped / MEASURE.RULER_STEP) * MEASURE.RULER_STEP;
  };
  const change = (v: number) => {
    if (!Number.isFinite(v)) return; // ไม่รับค่าเสีย (NaN) เข้า state
    const s = snap(v);
    setMm(s);
    setTouched(true);
    onChange(s);
  };

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    change(rulerMmFromY(e.clientY - r.top, ppm));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const s = MEASURE.RULER_STEP;
    const map: Record<string, number> = { ArrowUp: -s, ArrowLeft: -s, ArrowDown: s, ArrowRight: s, PageUp: -5, PageDown: 5 };
    if (e.key in map) {
      e.preventDefault();
      change(mm + map[e.key]);
    } else if (e.key === "Home") {
      e.preventDefault();
      change(0);
    } else if (e.key === "End") {
      e.preventDefault();
      change(MEASURE.RULER_MM);
    }
  };

  const rec = circToRec(mm, "B");
  const disabled = !touched || zoomed;
  const ctaLabel = zoomed ? COPY.g1.cta : touched ? COPY.r5b.ctaOn : COPY.r5b.ctaOff;

  return (
    <div className="flex flex-1 flex-col">
      <div ref={topRef} data-rs-top="">
        <RsHeader step={step} onBack={onBack} />

        {zoomed ? (
          <div className="px-[22px] pb-2">
            <NoticeBar tone="warn" role="alert">
              {COPY.g1.bar}
            </NoticeBar>
          </div>
        ) : null}
      </div>

      {/* จอสูงไม่พอ → G2 แทนตัวจอวัด (บล็อกบนยังอยู่ — ค่า mm ใน state นี้ไม่หาย) · ความสูงขั้นต่ำ = Hruler (80 มม. ย่อไม่ได้) style เฉพาะค่าที่คำนวณจาก ppm */}
      {tooShort ? (
        <G2 withHeader={false} onUseRing={onUseRing} />
      ) : (
      <div className="flex flex-1 overflow-hidden border-t border-[var(--rs-border)] bg-[var(--rs-surface)]" style={{ minHeight: hRuler }}>
        {/* คอลัมน์ซ้าย: ไม้บรรทัด + ที่จับ (แตะ/ลากได้ทั้งคอลัมน์) */}
        <div
          role="slider"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={COPY.r5b.rulerLabel}
          aria-valuemin={0}
          aria-valuemax={MEASURE.RULER_MM}
          aria-valuenow={mm}
          aria-valuetext={COPY.r5b.valueText(formatMm(mm))}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            dragging.current = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // บางเบราว์เซอร์/ jsdom ไม่รองรับ capture — ยังลากได้ตราบนิ้วอยู่ในคอลัมน์
            }
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current) fromPointer(e);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          className={`w-[156px] shrink-0 cursor-ns-resize touch-none bg-[var(--rs-surface)] ${FOCUS}`}
        >
          <RulerStage ppm={ppm} valueMm={mm} />
        </div>

        {/* คอลัมน์ขวา: ควบคุม */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 border-l border-[var(--rs-border)] bg-[var(--rs-bg)] p-3">
          <p className={`${SERIF} m-0 text-[15px] font-semibold leading-snug ${TEXT}`}>{COPY.r5b.instruction}</p>

          <div className="leading-tight">
            <div className={`text-[14px] ${TEXT_3}`}>
              {COPY.r5b.lengthLabel} <strong className={TEXT}>{formatMm(mm)} มม.</strong>
            </div>
            {rec ? <div className={`${SERIF} text-[24px] font-semibold text-[var(--rs-brand-hover)]`}>{COPY.r5b.liveSize(rec.rec)}</div> : null}
          </div>

          <FineAdjuster
            showSlider={false}
            value={mm}
            min={0}
            max={MEASURE.RULER_MM}
            onChange={change}
            step={MEASURE.RULER_STEP}
            sliderLabel={COPY.r5b.rulerLabel}
            decLabel={COPY.r5b.dec}
            incLabel={COPY.r5b.inc}
            decAria={COPY.r5b.dec}
            incAria={COPY.r5b.inc}
            valueText={(v) => COPY.r5b.valueText(formatMm(v))}
          />

          <p className={`m-0 text-[15px] leading-snug ${TEXT_3}`}>{COPY.r5b.warning}</p>

          <div className="mt-auto">
            <RsButton disabled={disabled} onClick={() => onConfirm(mm)}>
              {ctaLabel}
            </RsButton>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
