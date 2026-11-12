"use client";

// RingShowcaseClient — หน้า "แบบของ 3J Jewelry" (/ring-builder): แหวนไขว้พลอยไข่ 2 เม็ด แบบเดียว · ราคา/ไซซ์/รูปมาจาก lib/ring-builder/showcase/config.ts
// state ในหน้านี้มีแค่ 2 ตัว (แบบพลอย 1/2/3 · ไซซ์) + ผลวัดล่าสุดที่อ่านจาก localStorage หลัง mount — ไม่มี fetch/Server Action/DB (X5)
// เปลือกจอ: fixed inset-0 + scroll ภายใน (แนวเดียวกับ /ring-size — layout แม่ของ (quiz) เป็นการ์ด 560px/พื้นขาว ซึ่งแก้ไม่ได้เพราะ gem quiz ใช้งานจริง)
//   ทำให้ stage ติดบนมือถือ (sticky) และขยาย 2 คอลัมน์บนเดสก์ท็อปได้ · ไม่ใช้ 100vh (ใช้ dvh)
// 🔴 hydration: ไม่อ่าน window/localStorage ตอน render — ผลวัดล่าสุดอ่านใน useEffect เท่านั้น
import { useEffect, useMemo, useState } from "react";
import { GEM_QUIZ_DISCLAIMER } from "@/lib/gem-quiz/config";
import { getLastMeasuredSize, type LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { SHOWCASE_COPY, SHOWCASE_DESIGN_NAME, formatPriceThb, leadTimeLabel } from "@/lib/ring-builder/showcase/config";
import { DIRECT_STONE_LABEL } from "@/lib/ring-builder/showcase/line-message";
import type { GemTop3 } from "@/lib/ring-builder/showcase/quiz-link";
import { buildShowcaseSets, stoneLabel } from "@/lib/ring-builder/showcase/sets";
import { SHOWCASE_PHOTOS } from "./_assets";
import { GemSetPicker } from "./_components/GemSetPicker";
import { OrderSummary } from "./_components/OrderSummary";
import { PhotoGallery, photoAlt } from "./_components/PhotoGallery";
import { RingStage } from "./_components/RingStage";
import { SizePicker } from "./_components/SizePicker";

export function RingShowcaseClient({ top3 }: { top3: GemTop3 | null }) {
  const sets = useMemo(() => (top3 ? buildShowcaseSets(top3) : null), [top3]);
  const [setIndex, setSetIndex] = useState<1 | 2 | 3>(1);
  const [size, setSize] = useState<number | null>(null);
  const [lastMeasured, setLastMeasured] = useState<LastMeasuredSize | null>(null);

  useEffect(() => {
    try {
      setLastMeasured(getLastMeasuredSize());
    } catch {
      // localStorage ถูกบล็อก (in-app browser) — ไม่มีผลวัดให้เสนอ ใช้งานต่อได้ปกติ
      setLastMeasured(null);
    }
  }, []);

  const current = sets ? (sets.find((s) => s.index === setIndex) ?? sets[0]) : null;
  const topCode = current?.top ?? null;
  const bottomCode = current?.bottom ?? null;
  const topLabel = topCode ? stoneLabel(topCode) : DIRECT_STONE_LABEL;
  const bottomLabel = bottomCode ? stoneLabel(bottomCode) : DIRECT_STONE_LABEL;
  const stageAria = `ภาพจำลองแหวน 3 มิติ พลอยบน ${topLabel} พลอยล่าง ${bottomLabel} CZ เล็ก 2 เม็ด`;

  return (
    <div className="fixed inset-0 z-10 scroll-pt-[46dvh] overflow-y-auto overflow-x-hidden overscroll-contain bg-[var(--gq-ivory)] lg:scroll-pt-6">
      <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-x-8 gap-y-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] lg:grid-cols-2">
        {/* stage — มือถือ: ติดบน ~40dvh · เดสก์ท็อป: คอลัมน์ซ้าย sticky */}
        <div className="sticky top-0 z-20 -mx-4 bg-[var(--gq-ivory)] px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:static lg:top-auto lg:z-0 lg:row-span-4 lg:row-start-1 lg:mx-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-6">
          <div className="lg:sticky lg:top-6">
            <RingStage
              top={topCode}
              bottom={bottomCode}
              ariaLabel={stageAria}
              photo={SHOWCASE_PHOTOS[0]}
              photoAlt={photoAlt(0, SHOWCASE_PHOTOS.length)}
            />
          </div>
        </div>

        <header className="min-w-0 lg:col-start-2 lg:row-start-1 lg:pt-6">
          <p className="pl-[0.4em] font-quiz-display text-[13px] font-semibold tracking-[0.4em] text-[var(--gq-burgundy-dark)]">3J · JEWELRY</p>
          <h1 className="mt-2 font-quiz-serif text-2xl font-semibold leading-snug text-[var(--gq-burgundy-dark)]">{SHOWCASE_DESIGN_NAME}</h1>
          <p className="mt-1 text-base">
            <span className="font-medium">{formatPriceThb()}</span>
            <span className="text-[var(--gq-text-muted)]"> · {leadTimeLabel()}</span>
          </p>
        </header>

        <div className="min-w-0 lg:col-start-2 lg:row-start-2">
          <GemSetPicker sets={sets} selectedIndex={setIndex} onSelect={setSetIndex} />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-3">
          <SizePicker value={size} onChange={setSize} lastMeasured={lastMeasured} />
        </div>

        <div className="min-w-0 lg:col-span-2 lg:row-start-5">
          <PhotoGallery photos={SHOWCASE_PHOTOS} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-4">
          <OrderSummary setIndex={current ? current.index : null} topLabel={topLabel} bottomLabel={bottomLabel} size={size} />
          <div className="border-t border-[var(--gq-divider)] pt-4">
            <p className="text-xs leading-[1.65] text-[var(--gq-text-faint)]">
              <strong className="font-semibold">ข้อควรทราบ:</strong> {GEM_QUIZ_DISCLAIMER}
            </p>
            <p className="mt-1.5 text-xs leading-[1.65] text-[var(--gq-text-faint)]">{SHOWCASE_COPY.czNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
