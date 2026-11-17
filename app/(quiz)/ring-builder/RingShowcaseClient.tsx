"use client";

// RingShowcaseClient — หน้า "แบบของ 3J Jewelry" (/ring-builder): แหวนไขว้พลอยไข่ 2 เม็ด แบบเดียว · ราคา/ไซซ์/รูปมาจาก lib/ring-builder/showcase/config.ts
// D1.1 (17 พ.ย. 69): 2 โหมด "แบบแนะนำ" (แบบ 1/2/3 ตามเรื่องที่เลือก) | "เลือกพลอยเอง" (5 ชนิด × 2 เม็ด) · เปลี่ยนเรื่องบนหน้าแหวนได้โดยไม่ทำ quiz ใหม่
// state (design §9.3): intention · recIndex 1–3 · own {top,bottom}|null · active rec|own · size + ผลวัดล่าสุดที่อ่านจาก localStorage หลัง mount — ไม่มี fetch/Server Action/DB (X5)
//   สลับ active ไม่ล้างอีกฝั่ง · เปลี่ยนเรื่อง → recIndex=1, active=rec, own คงเดิม · own มีครบ 2 เม็ดหรือไม่มีเลย (ห้ามครึ่งเดียว)
//   เขียน state กลับ URL ด้วย history.replaceState ผ่าน buildShowcaseUrl ตัวเดียว → แชร์/กลับจาก /ring-size ได้หน้าเดิม (ยกเว้นไซซ์)
// เปลือกจอ: fixed inset-0 + scroll ภายใน (แนวเดียวกับ /ring-size — layout แม่ของ (quiz) เป็นการ์ด 560px/พื้นขาว ซึ่งแก้ไม่ได้เพราะ gem quiz ใช้งานจริง)
//   ทำให้ stage ติดบนมือถือ (sticky) และขยาย 2 คอลัมน์บนเดสก์ท็อปได้ · ไม่ใช้ 100vh (ใช้ dvh)
// 🔴 hydration: ไม่อ่าน window/localStorage ตอน render — ผลวัดล่าสุดอ่านใน useEffect เท่านั้น
import { useEffect, useMemo, useState } from "react";
import { GEM_QUIZ_DISCLAIMER, type GemQuizIntention, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { getLastMeasuredSize, type LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { SHOWCASE_COPY, SHOWCASE_DESIGN_NAME, formatPriceThb, leadTimeLabel } from "@/lib/ring-builder/showcase/config";
import { DIRECT_STONE_LABEL, type ShowcaseChoice } from "@/lib/ring-builder/showcase/line-message";
import { buildShowcaseUrl, type GemTop3, type IntentionTable, type OwnGems, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { buildShowcaseSets, intentionOnlyTop3, stoneLabel } from "@/lib/ring-builder/showcase/sets";
import { SHOWCASE_PHOTOS } from "./_assets";
import { GemSetPicker } from "./_components/GemSetPicker";
import { IntentionPicker, intentionLabel } from "./_components/IntentionPicker";
import { ModeSwitch, type ShowcaseMode } from "./_components/ModeSwitch";
import { OrderSummary } from "./_components/OrderSummary";
import { OwnGemPicker } from "./_components/OwnGemPicker";
import { PhotoGallery, photoAlt } from "./_components/PhotoGallery";
import { RingStage } from "./_components/RingStage";
import { SizePicker } from "./_components/SizePicker";

type RecIndex = 1 | 2 | 3;

export function RingShowcaseClient({ params }: { params: ShowcaseParams }) {
  // ค่าตอนโหลดหน้า (ไม่เปลี่ยนตลอด session) — ตารางจาก quiz + "เรื่องที่ตอบ" ใช้ตัดสินป้าย (Y6)
  const table: IntentionTable | null = params.intention ? params.table : null;
  // q = เรื่องที่ตอบ · ไม่มี q (ลิงก์ t+i ที่ไม่มี q) → ถือว่า q = i ตอนโหลดแรก
  const answeredIntention: GemQuizIntention | null = table ? (params.answered ?? params.intention) : null;
  const legacyTop3: GemTop3 | null = params.top3;

  const [intention, setIntention] = useState<GemQuizIntention | null>(params.intention);
  const [own, setOwn] = useState<OwnGems | null>(params.own);
  const [active, setActive] = useState<ShowcaseMode>(params.design === "own" && params.own ? "own" : "rec");

  // top3 ของแบบแนะนำ: เรื่องที่เลือก → t[i] (ถ้ามีตาราง) หรืออันดับตามเรื่องล้วน · ยังไม่เลือกเรื่อง → ลิงก์ g เดิม · ไม่มีเลย → เข้าตรง
  const recTop3: GemTop3 | null = useMemo(() => {
    if (intention) return table ? table[intention] : intentionOnlyTop3(intention);
    return legacyTop3;
  }, [intention, table, legacyTop3]);
  const sets = useMemo(() => (recTop3 ? buildShowcaseSets(recTop3) : null), [recTop3]);

  const [recIndex, setRecIndex] = useState<RecIndex>(() => (recTop3 && typeof params.design === "number" ? params.design : 1));
  const [size, setSize] = useState<number | null>(null);
  const [lastMeasured, setLastMeasured] = useState<LastMeasuredSize | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    try {
      setLastMeasured(getLastMeasuredSize());
    } catch {
      // localStorage ถูกบล็อก (in-app browser) — ไม่มีผลวัดให้เสนอ ใช้งานต่อได้ปกติ
      setLastMeasured(null);
    }
  }, []);

  // ป้าย (Y6): "จากแบบทดสอบ" เฉพาะเมื่อที่มาคือ quiz จริง — เรื่องที่ตอบ (t+i) หรือลิงก์ g เดิมที่ยังไม่กดเปลี่ยนเรื่อง
  const fromQuiz = intention === null ? legacyTop3 !== null : table !== null && intention === answeredIntention;
  const badgeKind = fromQuiz ? "quiz" : "intention";
  const basisNote = intention === null ? null : fromQuiz ? SHOWCASE_COPY.basisQuiz : SHOWCASE_COPY.basisIntention;

  const currentSet = sets ? (sets.find((s) => s.index === recIndex) ?? sets[0]) : null;

  // พลอยที่แสดงบนแหวน + ค่าที่ส่งเข้า LINE/สรุป (ค่าเดียวกัน)
  let choice: ShowcaseChoice = { kind: "direct" };
  if (active === "own" && own) choice = { kind: "own", top: own.top, bottom: own.bottom };
  else if (active === "rec" && currentSet) choice = { kind: "rec", index: currentSet.index, top: currentSet.top, bottom: currentSet.bottom };
  const topCode: GemQuizStoneCode | null = choice.kind === "direct" ? null : choice.top;
  const bottomCode: GemQuizStoneCode | null = choice.kind === "direct" ? null : choice.bottom;
  const topLabel = topCode ? stoneLabel(topCode) : DIRECT_STONE_LABEL;
  const bottomLabel = bottomCode ? stoneLabel(bottomCode) : DIRECT_STONE_LABEL;
  const stageAria = `ภาพจำลองแหวน 3 มิติ พลอยบน ${topLabel} พลอยล่าง ${bottomLabel} CZ เล็ก 2 เม็ด`;

  // เขียน state กลับ URL (ไม่เพิ่ม history) — เก็บ t + q เสมอเมื่อมีตาราง: reload/แชร์ได้อันดับชุดเดิม และป้าย "จากแบบทดสอบ" ตัดสินจาก i === q (Y6)
  const url = buildShowcaseUrl({
    table,
    intention,
    answered: answeredIntention,
    legacyTop3: intention === null ? legacyTop3 : null,
    own,
    active,
    recIndex: sets ? recIndex : 1,
  });
  useEffect(() => {
    try {
      if (url === `${window.location.pathname}${window.location.search}`) return;
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // history ใช้ไม่ได้ (sandbox) — แค่ไม่ sync URL หน้ายังใช้งานได้
    }
  }, [url]);

  function changeMode(next: ShowcaseMode) {
    if (next === active) return;
    if (next === "own" && own === null && currentSet) {
      // เปิดเลือกเองครั้งแรก: seed จากแบบที่ดูอยู่ (ผู้ใช้เห็นของเดิมแล้วแก้ต่อได้)
      setOwn({ top: currentSet.top, bottom: currentSet.bottom });
    }
    setActive(next);
  }

  function changeIntention(next: GemQuizIntention) {
    if (next === intention) return;
    setIntention(next);
    setRecIndex(1);
    setActive("rec");
    setAnnounce(SHOWCASE_COPY.intentionAnnounce(intentionLabel(next)));
  }

  // own ต้องครบ 2 เม็ดหรือไม่มีเลย — แตะเม็ดแรกตอนว่าง = ตั้งทั้งสองเป็นพลอยนั้น
  function pickTop(code: GemQuizStoneCode) {
    setOwn((prev) => (prev ? { top: code, bottom: prev.bottom } : { top: code, bottom: code }));
  }
  function pickBottom(code: GemQuizStoneCode) {
    setOwn((prev) => (prev ? { top: prev.top, bottom: code } : { top: code, bottom: code }));
  }

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

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <ModeSwitch mode={active} onChange={changeMode} />
          {active === "rec" ? (
            <>
              <IntentionPicker value={intention} onSelect={changeIntention} />
              <p role="status" className="sr-only">
                {announce}
              </p>
              <GemSetPicker sets={sets} selectedIndex={recIndex} onSelect={setRecIndex} badgeKind={badgeKind} basisNote={basisNote} />
            </>
          ) : (
            <OwnGemPicker own={own} onPickTop={pickTop} onPickBottom={pickBottom} />
          )}
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-3">
          <SizePicker value={size} onChange={setSize} lastMeasured={lastMeasured} />
        </div>

        <div className="min-w-0 lg:col-span-2 lg:row-start-5">
          <PhotoGallery photos={SHOWCASE_PHOTOS} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-4">
          <OrderSummary choice={choice} gemsEmpty={active === "own" && own === null} size={size} />
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
