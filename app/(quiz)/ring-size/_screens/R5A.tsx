"use client";

import { useState } from "react";
import { COPY, MEASURE } from "@/lib/ring-size/config";
import { helpLineHref } from "@/lib/ring-size/line-message";
import { circToRec, diameterToCirc, formatMm, roundTenth } from "@/lib/ring-size/size";
import { useVisualViewportZoomed } from "@/lib/ring-size/use-visual-viewport-scale";
import { FineAdjuster } from "../_components/FineAdjuster";
import { MinusIcon, PlusIcon } from "../_components/Icons";
import { NoticeBar } from "../_components/NoticeBar";
import { RingDiscStage } from "../_components/RingDiscStage";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { StageHost } from "../_components/StageHost";
import { StickyActionBar } from "../_components/StickyActionBar";
import { FOCUS, LINK, SERIF, TEXT, TEXT_3 } from "../_components/styles";

// R5A — ขยายวงกลมแดงให้เต็มรูแหวน (วิธีแหวนวงเดิม)
// ผู้ใช้เลื่อนแหวนเข้าหาวง ไม่ใช่ลากวงหนีแหวน (แหวน+มือบัง) · ปรับที่แถบเลื่อน/−/+ · เริ่มจากวงเล็กแล้วขยายทิศเดียว
// ค่าเก็บเป็น มม. (เส้นผ่านศูนย์กลาง) แปลงเป็น px ตอนวาด · แสดง 1 ทศนิยม · ปุ่ม "ใช้ค่านี้" ปิดจนกว่าจะขยับ
// สถานะ: G1 ซูม (alert + บล็อก) · สุดช่วงแถบเลื่อน (แจ้ง + ลิงก์ LINE) · ปิดปุ่มบอกเหตุผลบนปุ่ม

const EPS = 1e-6;

export function R5A({
  step,
  ppm,
  initialMm,
  onBack,
  onChange,
  onConfirm,
  onHowTo,
}: {
  step: { current: number; total: number } | null;
  ppm: number;
  /** ค่าที่วัดค้างไว้ก่อนย้อน (null = ยังไม่เคยปรับ → ค่าเริ่ม D_START และปุ่มปิด) */
  initialMm: number | null;
  onBack: () => void;
  onChange: (mm: number) => void;
  onConfirm: (mm: number) => void;
  onHowTo: () => void;
}) {
  const [d, setD] = useState(initialMm ?? MEASURE.D_START);
  const [touched, setTouched] = useState(initialMm !== null);
  const zoomed = useVisualViewportZoomed();

  const rec = circToRec(diameterToCirc(d), "A");
  const atLimit = touched && (d <= MEASURE.D_MIN + EPS || d >= MEASURE.D_MAX - EPS);

  const change = (v: number) => {
    if (!Number.isFinite(v)) return; // ไม่รับค่าเสีย (NaN) เข้า state
    const snapped = roundTenth(v);
    setD(snapped);
    setTouched(true);
    onChange(snapped);
  };

  const disabled = !touched || zoomed;
  const ctaLabel = zoomed ? COPY.g1.cta : touched ? COPY.r5a.ctaOn : COPY.r5a.ctaOff;

  return (
    <div className="flex h-[100dvh] flex-col">
      <RsHeader step={step} onBack={onBack} />

      {zoomed ? (
        <div className="px-[22px] pb-2">
          <NoticeBar tone="warn" role="alert">
            {COPY.g1.bar}
          </NoticeBar>
        </div>
      ) : null}

      <StageHost
        kind="disc"
        overlay={<p className={`pointer-events-none absolute inset-x-0 bottom-1.5 m-0 text-center text-[13px] ${TEXT_3}`}>{COPY.r5a.stageLabel}</p>}
      >
        {(size) => <RingDiscStage width={size.width} height={size.height} ppm={ppm} diameterMm={d} />}
      </StageHost>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[22px] pb-4 pt-3.5">
        <p className={`${SERIF} m-0 text-[18px] font-semibold leading-snug ${TEXT}`}>{COPY.r5a.instruction}</p>

        <FineAdjuster
          value={d}
          min={MEASURE.D_MIN}
          max={MEASURE.D_MAX}
          onChange={change}
          step={MEASURE.D_STEP}
          sliderLabel={COPY.r5a.sliderLabel}
          decLabel={<MinusIcon />}
          incLabel={<PlusIcon />}
          decAria={COPY.r5a.dec}
          incAria={COPY.r5a.inc}
          valueText={(v) => COPY.r5a.valueText(formatMm(v))}
        />

        {rec ? (
          <p aria-hidden="true" className={`${SERIF} m-0 text-center text-[17px] font-semibold text-[var(--rs-brand-hover)]`}>
            {COPY.r5a.live(formatMm(d), formatMm(rec.circ), rec.rec)}
          </p>
        ) : null}

        {atLimit ? (
          <NoticeBar tone="warn" role="status">
            {COPY.r5a.limit}{" "}
            <a href={helpLineHref()} className="font-semibold underline underline-offset-4">
              {COPY.common.askLineShort}
            </a>
          </NoticeBar>
        ) : null}

        <p className={`m-0 text-[15px] leading-snug ${TEXT_3}`}>{COPY.r5a.hint1}</p>
        <p className={`m-0 text-[15px] font-medium leading-snug ${TEXT_3}`}>{COPY.r5a.hint2}</p>

        <button type="button" onClick={onHowTo} className={`${LINK} -ml-1 self-start ${FOCUS}`}>
          {COPY.r5a.howTo}
        </button>
      </div>

      <StickyActionBar>
        <RsButton disabled={disabled} onClick={() => onConfirm(d)}>
          {ctaLabel}
        </RsButton>
        <p className={`m-0 mt-1.5 text-center text-[15px] leading-snug ${TEXT_3}`}>{COPY.r5a.warning}</p>
      </StickyActionBar>
    </div>
  );
}
