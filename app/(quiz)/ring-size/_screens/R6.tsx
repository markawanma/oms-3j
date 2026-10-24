"use client";

import { useMemo, useState } from "react";
import {
  ACCURACY_NOTE,
  BETWEEN_REASON,
  COPY,
  RING_TOOL_DESTINATIONS,
  SHOP_RING_SIZES,
  SHOW_FINGER_TIPS,
  TRACK_ENABLED,
  type Method,
  type RefKind,
} from "@/lib/ring-size/config";
import { formatMm, inShopRange, type SizeRec } from "@/lib/ring-size/size";
import { GemIcon, ShareIcon } from "../_components/Icons";
import { LineCta } from "../_components/LineCta";
import { RsButton } from "../_components/RsButton";
import { RsHeader } from "../_components/RsHeader";
import { ShareCardSheet } from "../_components/ShareCardSheet";
import { CARD, FOCUS, LINK, SERIF, TEXT, TEXT_2, TEXT_3 } from "../_components/styles";

// R6 / R6Between / R6Out — ผลลัพธ์ (ตัวเดียว 3 variant ตามเบอร์หลังปัด)
//   normal  — เบอร์ + เส้นรอบวง 1 ทศนิยม + บรรทัด "เบอร์ตามตารางของร้าน 3J" + chip ช่วงเบอร์ (สีกลาง · เฉพาะเมื่อกำหนดช่วงแล้วและอยู่ในช่วง)
//   between — เหมือน normal + เล็กกว่า/ใหญ่กว่า (แนะนำ) · ไม่แต่งเหตุผล (BETWEEN_REASON = null)
//   out     — เบอร์อยู่นอกช่วงที่ร้านทำ · เป็น "คำถาม" ไม่ใช่คำสัญญา (ไม่ยืนยันนโยบายปรับไซส์) · ไม่มีปุ่มดูแหวนในร้าน
// ช่วงเบอร์ตัดสินด้วยเบอร์หลังปัด (ceil(c−0.25)) · SHOP_RING_SIZES = null → ไม่มีทั้ง chip และกล่อง
// เลข 104 px ใช้ serif 600 (Noto Serif Thai โหลดแค่ 500/600 — ห้ามขอ 700) · ไม่ sticky (ปุ่ม LINE อยู่ในกระแส)

export interface R6Props {
  step: { current: number; total: number } | null;
  size: SizeRec;
  method: Method;
  refKind: RefKind;
  measuredAt: number;
  onBack: () => void;
  onRemeasure: () => void;
  onOtherMethod: () => void;
}

export function R6({ step, size, method, refKind, measuredAt, onBack, onRemeasure, onOtherMethod }: R6Props) {
  const [sharing, setSharing] = useState(false);
  const inRange = inShopRange(size.rec);
  const variant: "normal" | "between" | "out" = inRange === false ? "out" : size.between ? "between" : "normal";
  const shareData = useMemo(() => ({ rec: size.rec, circ: size.circ, measuredAt }), [size.rec, size.circ, measuredAt]);
  const shop = RING_TOOL_DESTINATIONS.shop;

  return (
    <div className="flex flex-1 flex-col">
      <RsHeader step={step} onBack={onBack} />
      <div className="flex flex-col gap-3.5 px-[22px] pb-7 pt-1">
        <section aria-label={COPY.r6.label} className={`${CARD} relative overflow-hidden rounded-[28px] px-5 pb-[22px] pt-[26px] text-center`}>
          <svg aria-hidden="true" width="260" height="260" viewBox="0 0 260 260" fill="none" className="pointer-events-none absolute left-1/2 top-2 -ml-[130px] opacity-55">
            <circle cx="130" cy="120" r="96" stroke="#F1E4D8" strokeWidth="18" />
            <circle cx="130" cy="120" r="110" stroke="#E6D3BE" strokeWidth="1" />
          </svg>
          <div className="relative">
            <div className={`text-[15px] ${TEXT_2}`}>{variant === "between" ? COPY.r6.labelBetween : COPY.r6.label}</div>
            <div className={`${SERIF} mt-1 flex items-baseline justify-center gap-2 text-[var(--rs-brand-hover)]`}>
              <span className="text-[22px] font-semibold">{COPY.r6.sizePrefix}</span>
              <span data-testid="result-size" className="text-[104px] font-semibold leading-none">
                {size.rec}
              </span>
            </div>
            <div className={`mt-1.5 text-[15px] ${TEXT}`}>{COPY.r6.circ(formatMm(size.circ))}</div>
            <div className={`mt-0.5 text-[13px] ${TEXT_3}`}>{COPY.r6.tableNote}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <span className="inline-flex h-7 items-center rounded-full bg-[var(--rs-chip-bg)] px-3 text-[13px] font-medium text-[var(--rs-text-3)]">{COPY.r6.methodChip(method)}</span>
              {inRange === true && SHOP_RING_SIZES ? (
                <span className="inline-flex h-7 items-center rounded-full bg-[var(--rs-chip-bg)] px-3 text-[13px] font-medium text-[var(--rs-text-3)]">
                  {COPY.r6.chipRange(SHOP_RING_SIZES.min, SHOP_RING_SIZES.max)}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {variant === "between" && size.between ? (
          <section className={`${CARD} rounded-[20px] p-4`}>
            <p className={`${SERIF} m-0 text-center text-[16px] font-semibold ${TEXT}`}>{COPY.r6.betweenBanner(size.between.lo, size.between.hi, size.rec)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="rounded-[14px] border border-[var(--rs-border)] p-3 text-center">
                <div className={`text-[13px] ${TEXT_3}`}>{COPY.r6.smallerTag}</div>
                <div className={`${SERIF} text-[32px] font-semibold ${TEXT}`}>{size.between.lo}</div>
              </div>
              <div className="rounded-[14px] border-2 border-[var(--rs-brand)] bg-[var(--rs-blush)] p-3 text-center">
                <div className="text-[13px] font-semibold text-[var(--rs-blush-text)]">{COPY.r6.largerTag}</div>
                <div className={`${SERIF} text-[32px] font-semibold text-[var(--rs-brand-hover)]`}>{size.between.hi}</div>
              </div>
            </div>
            <p className={`m-0 mt-3 text-[15px] leading-snug ${TEXT_3}`}>
              {COPY.r6.betweenExplain}
              {BETWEEN_REASON ? ` ${BETWEEN_REASON}` : ""}
            </p>
          </section>
        ) : null}

        {variant === "out" && SHOP_RING_SIZES ? (
          <section role="note" className="rounded-[20px] border border-[var(--rs-warn-border)] bg-[var(--rs-warn)] p-4 text-[var(--rs-warn-text)]">
            <h2 className={`${SERIF} m-0 text-[17px] font-semibold`}>{COPY.r6.outTitle(size.rec)}</h2>
            <p className="m-0 mt-1 text-[15px] leading-snug">{COPY.r6.outBody(SHOP_RING_SIZES.min, SHOP_RING_SIZES.max)}</p>
          </section>
        ) : null}

        <div className="rounded-[16px] bg-[var(--rs-blush)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--rs-blush-text)]">{ACCURACY_NOTE}</div>

        {SHOW_FINGER_TIPS && COPY.r6.tipsTitle && COPY.r6.tips.length > 0 ? (
          <section aria-label={COPY.r6.tipsTitle} className={`${CARD} rounded-[20px] px-4 py-1.5`}>
            <h2 className={`${SERIF} m-0 pb-1 pt-2 text-[16px] font-semibold ${TEXT}`}>{COPY.r6.tipsTitle}</h2>
            {COPY.r6.tips.map((t, i) => (
              <details key={t.q} open={i === 0} className="border-t border-[var(--rs-border)]">
                <summary className={`flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2.5 text-[15px] font-semibold ${TEXT} ${FOCUS}`}>{t.q}</summary>
                <p className={`m-0 pb-3 text-[15px] leading-relaxed ${TEXT_3}`}>{t.a}</p>
              </details>
            ))}
          </section>
        ) : null}

        <LineCta input={{ size, method, ref: refKind }} label={variant === "out" ? COPY.r6.ctaLineOut(size.rec) : COPY.r6.ctaLine} stickyPrimary={variant === "between"} />

        <div className="flex flex-col gap-2.5">
          <RsButton variant="secondary" onClick={() => setSharing(true)} icon={<ShareIcon />}>
            {COPY.r6.share}
          </RsButton>
          {shop && variant !== "out" ? (
            <RsButton variant="secondary" href={shop.href}>
              {shop.label}
            </RsButton>
          ) : null}
          {/* /gem-quiz ตรงๆ เท่านั้น — ห้ามแนบเบอร์/พารามิเตอร์ใดไปกับ URL */}
          <RsButton variant="secondary" href="/gem-quiz" icon={<GemIcon />}>
            {COPY.r6.gemQuiz}
          </RsButton>
        </div>

        <div className="flex justify-center gap-[18px] text-[15px]">
          <button type="button" onClick={onRemeasure} className={LINK}>
            {COPY.r6.remeasure}
          </button>
          <button type="button" onClick={onOtherMethod} className={LINK}>
            {COPY.r6.otherMethod}
          </button>
        </div>

        <p className={`m-0 text-center text-[13px] leading-relaxed ${TEXT_2}`}>
          {COPY.r6.privacy}
          {TRACK_ENABLED ? COPY.r6.privacyTracked : ""}
        </p>
      </div>

      {sharing ? <ShareCardSheet data={shareData} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
