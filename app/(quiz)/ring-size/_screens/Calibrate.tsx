"use client";

import { useState } from "react";
import { CALIBRATION, COPY, type RefKind } from "@/lib/ring-size/config";
import { clampPpm, maxPpmFor, refPxFor, stepPpm } from "@/lib/ring-size/calibration";
import { helpLineHref } from "@/lib/ring-size/line-message";
import { useElementSize } from "@/lib/ring-size/use-element-size";
import { useVisualViewportZoomed } from "@/lib/ring-size/use-visual-viewport-scale";
import { CalibrationStage } from "../_components/CalibrationStage";
import { CoinCalibrationStage } from "../_components/CoinCalibrationStage";
import { FineAdjuster } from "../_components/FineAdjuster";
import { FitExamplesSheet } from "../_components/FitExamplesSheet";
import { MinusIcon, PlusIcon } from "../_components/Icons";
import { NoticeBar } from "../_components/NoticeBar";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { StageHost } from "../_components/StageHost";
import { StickyActionBar } from "../_components/StickyActionBar";
import { FOCUS, LINK, SERIF, TEXT, TEXT_3 } from "../_components/styles";

// Calibrate — จอเทียบจอ "จอเดียว รับ kind" (R2 บัตร · R2Coin เหรียญ): ข้อความ/เวที/ก้าว/G3 อ่านจาก config ตาม kind
// (data-driven — ไม่แตกเป็นสองไฟล์ เพื่อไม่ให้สองจอทำงานต่างกันโดยไม่ตั้งใจ)
//
// โครง (build spec ข้อ 3.2.1): header ไม่เลื่อน · [R2Coin: แถบ "ก่อนเริ่ม"] · เวที clamp(MIN, 100dvh − RESERVE, MAX) ·
// เนื้อหา (คำสั่ง · slider/−/+ · คำใบ้ · ลิงก์) เลื่อนได้ · แถบล่าง sticky ปุ่มหลัก 56 px
// สถานะที่ผู้ใช้เห็น: ปุ่มปิด (เหตุผลบนปุ่ม) · G1 ซูม (alert + บล็อก) · G5 ค่าเก่า (status) · แถบเลื่อนสุดแต่จอเล็ก (บัตร)
// ค่าที่ปรับเก็บเป็น ppm (px ต่อ มม.) → แปลงเป็น px ตอนวาดเท่านั้น

export interface CalibrateProps {
  kind: RefKind;
  step: { current: number; total: number } | null;
  /** ppm เริ่มต้น (6.0 · หรือปรับจาก DPR ตอน G5 · หรือค่าที่ปรับค้างไว้ก่อนย้อน) */
  initialPpm: number;
  /** เคยปรับแล้ว (กลับมาจากจอถัดไป) → ปุ่มยืนยันเปิดได้เลย */
  initiallyTouched: boolean;
  /** G5: ค่าเก่าอาจไม่ตรงเครื่องนี้ */
  g5: boolean;
  onBack: () => void;
  onDraft: (ppm: number) => void;
  onConfirm: (ppm: number) => void;
  onSwitchKind: () => void;
}

export function Calibrate({ kind, step, initialPpm, initiallyTouched, g5, onBack, onDraft, onConfirm, onSwitchKind }: CalibrateProps) {
  const C = kind === "coin" ? COPY.coin : COPY.card;
  const [ppmRaw, setPpm] = useState(initialPpm);
  const [touched, setTouched] = useState(initiallyTouched);
  const [showExamples, setShowExamples] = useState(false);
  const zoomed = useVisualViewportZoomed();
  const { ref: widthRef, size: widthSize } = useElementSize<HTMLDivElement>();

  const maxPpm = maxPpmFor(kind, widthSize ? widthSize.width : null);
  const ppm = clampPpm(ppmRaw, maxPpm);
  const screenLimited = kind === "card" && maxPpm < CALIBRATION.PPM_MAX_ABS;
  const atScreenLimit = screenLimited && ppm >= maxPpm - 1e-6;
  const cannotReachCard = kind === "card" && widthSize !== null && maxPpm < CALIBRATION.PPM_MIN;

  const change = (v: number) => {
    setPpm(v);
    setTouched(true);
    onDraft(v);
  };

  const disabled = !touched || zoomed;
  const ctaLabel = zoomed ? COPY.g1.cta : touched ? C.ctaOn : C.ctaOff;

  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />

      {kind === "coin" ? (
        <p className={`m-0 px-[22px] pb-2.5 pt-1 text-[15px] leading-snug ${TEXT_3}`}>{COPY.coin.beforeStart}</p>
      ) : null}

      {zoomed ? (
        <div className="px-[22px] pb-2">
          <NoticeBar tone="warn" role="alert">
            {COPY.g1.bar}
          </NoticeBar>
        </div>
      ) : null}
      {g5 ? (
        <div className="px-[22px] pb-2">
          <NoticeBar tone="warn" role="status" action={{ label: COPY.g5.switchTo(kind), onClick: onSwitchKind }}>
            {COPY.g5.bar}
          </NoticeBar>
        </div>
      ) : null}

      <div ref={widthRef}>
        <StageHost
          kind={kind}
          overlay={
            kind === "coin" ? (
              <p className={`pointer-events-none absolute inset-x-0 bottom-1.5 m-0 text-center text-[13px] ${TEXT_3}`}>{COPY.coin.stageLabel}</p>
            ) : null
          }
        >
          {(size) =>
            kind === "coin" ? (
              <CoinCalibrationStage width={size.width} height={size.height} ppm={ppm} />
            ) : (
              <CalibrationStage width={size.width} height={size.height} ppm={ppm} />
            )
          }
        </StageHost>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-[22px] pb-4 pt-3.5">
        <p className={`${SERIF} m-0 text-[18px] font-semibold leading-snug ${TEXT}`}>{C.instruction}</p>

        <FineAdjuster
          value={ppm}
          min={CALIBRATION.PPM_MIN}
          max={maxPpm}
          onChange={change}
          step={(cur) => stepPpm(kind, cur)}
          sliderLabel={C.sliderLabel}
          decLabel={<MinusIcon />}
          incLabel={<PlusIcon />}
          decAria={C.dec}
          incAria={C.inc}
          valueText={(v) => C.valueText(refPxFor(kind, v))}
        />

        {kind === "card" && (atScreenLimit || cannotReachCard) ? (
          <NoticeBar tone="warn" role="status">
            {COPY.card.tooSmall}
          </NoticeBar>
        ) : null}

        <p className={`m-0 text-[15px] leading-snug ${TEXT_3}`}>{C.hint}</p>
        <p className={`m-0 text-[13px] leading-snug ${TEXT_3}`}>{C.small}</p>

        <div className="flex flex-col items-start">
          <button type="button" onClick={() => setShowExamples(true)} className={`${LINK} -ml-1`}>
            {C.examples}
          </button>
          <a href={helpLineHref()} className={`${LINK} -ml-1`}>
            {COPY.common.askLine}
          </a>
          {kind === "coin" ? (
            <button type="button" onClick={onSwitchKind} className={`${LINK} -ml-1 ${FOCUS}`}>
              {COPY.coin.useCard}
            </button>
          ) : null}
        </div>
      </div>

      <StickyActionBar>
        <RsButton disabled={disabled} onClick={() => onConfirm(ppm)}>
          {ctaLabel}
        </RsButton>
      </StickyActionBar>

      {showExamples ? <FitExamplesSheet kind={kind} onClose={() => setShowExamples(false)} /> : null}
    </div>
  );
}
