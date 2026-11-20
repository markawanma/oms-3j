"use client";

// RingShowcaseClient — หน้า "แบบของ 3J Jewelry" (/ring-builder): เลือกได้ 7 แบบแหวน (D1.2) · ราคา = config.ts · ชื่อ/ตำแหน่งพลอย/ไซซ์ = designs.ts · รูป = _assets
// D1.2 state เพิ่ม: designId (แบบแหวน · เริ่มจาก `r`) — เปลี่ยนแบบไม่ล้าง พลอย/โหมด/เรื่อง/ไซซ์ดิบ · effectiveSize คำนวณใน render ที่เดียว (ไซซ์ดิบนอกช่วงของแบบ → null) แล้วส่งให้ SizePicker/สรุป/LINE ทุกจุด (Z2)
// D1.2a (18 พ.ย. 69): แบบแถว 3–7 เม็ด โหมด "เลือกพลอยเอง" = เลือกสีทีละเม็ด (ซ้าย→ขวา · ทุกเม็ดเท่ากัน ราคาเท่าเดิม) · ไขว้ 2 เม็ดคงเดิม (บน/ล่าง)
//   state `ownByCount` (จำสีต่อจำนวนเม็ด: 2 ไขว้ · 3/4/6/7 แถว) แทน `own` เดี่ยว — สลับแบบ 7→4→7 สีเดิมกลับมา · ครบทุกเม็ดหรือไม่มีเลย (ไม่มีเม็ดว่างครึ่งๆ)
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
import { SHOWCASE_COPY, SHOWCASE_PHOTO_VIEWS, formatPriceThb, leadTimeLabel } from "@/lib/ring-builder/showcase/config";
import { getShowcaseDesign, ownSlotCount, roleMainLabel, roleSubLabel, seedFromPair, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { DIRECT_STONE_LABEL, isShowcaseSize, type ShowcaseChoice } from "@/lib/ring-builder/showcase/line-message";
import { fillAll, fitOwnToCount, formatOwnSlots, ownSlotsAria, slotLabel } from "@/lib/ring-builder/showcase/own-slots";
import { buildShowcaseUrl, CZ_SLOT, isSlotCode, isStoneCode, type SlotCode, type GemTop3, type IntentionTable, type OwnGems, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { buildShowcaseSets, intentionOnlyTop3, stoneLabel } from "@/lib/ring-builder/showcase/sets";
import { SHOWCASE_PHOTOS } from "./_assets";
import { DesignPicker } from "./_components/DesignPicker";
import { GemSetPicker } from "./_components/GemSetPicker";
import { IntentionPicker, intentionLabel } from "./_components/IntentionPicker";
import { ModeSwitch, type ShowcaseMode } from "./_components/ModeSwitch";
import { OrderSummary } from "./_components/OrderSummary";
import { OwnGemPicker } from "./_components/OwnGemPicker";
import { PhotoGallery, photoAlt } from "./_components/PhotoGallery";
import { RingStage } from "./_components/RingStage";
import { SizePicker } from "./_components/SizePicker";
import { ToolsHubLink } from "../_components/ToolsHubLink";

type RecIndex = 1 | 2 | 3;
/** สีที่เลือกเอง จำไว้ต่อ "จำนวนเม็ด" (2 = ไขว้ [บน, ล่าง] · 3/4/6/7 = แถว ซ้าย→ขวา) — แบบที่จำนวนเท่ากันใช้ชุดเดียวกัน */
type OwnByCount = Partial<Record<number, readonly SlotCode[]>>;

function initialOwnByCount(params: ShowcaseParams): OwnByCount {
  const d = getShowcaseDesign(params.ring);
  if (d.layout.kind === "row") return params.ownSlots ? { [ownSlotCount(d)]: params.ownSlots } : {};
  return params.own ? { 2: [params.own.top, params.own.bottom] } : {};
}

export function RingShowcaseClient({ params }: { params: ShowcaseParams }) {
  // ค่าตอนโหลดหน้า (ไม่เปลี่ยนตลอด session) — ตารางจาก quiz + "เรื่องที่ตอบ" ใช้ตัดสินป้าย (Y6)
  const table: IntentionTable | null = params.intention ? params.table : null;
  // q = เรื่องที่ตอบ · ไม่มี q (ลิงก์ t+i ที่ไม่มี q) → ถือว่า q = i ตอนโหลดแรก
  const answeredIntention: GemQuizIntention | null = table ? (params.answered ?? params.intention) : null;
  const legacyTop3: GemTop3 | null = params.top3;

  const [intention, setIntention] = useState<GemQuizIntention | null>(params.intention);
  const [ownByCount, setOwnByCount] = useState<OwnByCount>(() => initialOwnByCount(params));
  const [selectedSlot, setSelectedSlot] = useState(0);
  // "เลิกทำ" ของ "ใส่ X ทุกเม็ด" — snapshot 1 ชั้น · หายเมื่อแก้อย่างอื่น
  const [undoSnap, setUndoSnap] = useState<{ count: number; codes: readonly SlotCode[] } | null>(null);
  const [active, setActive] = useState<ShowcaseMode>(() => (params.design === "own" && Object.keys(initialOwnByCount(params)).length > 0 ? "own" : "rec"));

  // top3 ของแบบแนะนำ: เรื่องที่เลือก → t[i] (ถ้ามีตาราง) หรืออันดับตามเรื่องล้วน · ยังไม่เลือกเรื่อง → ลิงก์ g เดิม · ไม่มีเลย → เข้าตรง
  const recTop3: GemTop3 | null = useMemo(() => {
    if (intention) return table ? table[intention] : intentionOnlyTop3(intention);
    return legacyTop3;
  }, [intention, table, legacyTop3]);
  const sets = useMemo(() => (recTop3 ? buildShowcaseSets(recTop3) : null), [recTop3]);

  const [recIndex, setRecIndex] = useState<RecIndex>(() => (recTop3 && typeof params.design === "number" ? params.design : 1));
  const [designId, setDesignId] = useState<ShowcaseDesignId>(params.ring);
  // ไซซ์ดิบ (ที่ผู้ใช้กด) — ไม่ถูกลบเมื่อสลับไปแบบที่ไซซ์นี้ใช้ไม่ได้ · ใช้ผ่าน effectiveSize เท่านั้น
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

  const design = getShowcaseDesign(designId);
  // 🔴 Z2: ไซซ์ที่ส่งต่อทุกจุด (ปุ่ม/สรุป/LINE) = ไซซ์ดิบที่ใช้กับแบบปัจจุบันได้เท่านั้น · สลับกลับแบบที่ใช้ได้ → กลับมาเอง
  const effectiveSize: number | null = size !== null && isShowcaseSize(size, designId) ? size : null;
  const outOfRangeSize: number | null = size !== null && effectiveSize === null ? size : null;

  const isRow = design.layout.kind === "row";
  const ownCount = ownSlotCount(design);
  const ownCodes: readonly SlotCode[] | null = ownByCount[ownCount] ?? null;
  const slot = Math.min(selectedSlot, ownCount - 1);
  // ไขว้ (2 เม็ด): พลอย 5 ชนิด หรือ CZ ขาว ต่อเม็ด (guard กันค่านอก type system)
  const own: OwnGems | null = !isRow && ownCodes && isSlotCode(ownCodes[0]) && isSlotCode(ownCodes[1]) ? { top: ownCodes[0], bottom: ownCodes[1] } : null;
  const ownSlots = isRow ? ownCodes : null;

  const currentSet = sets ? (sets.find((s) => s.index === recIndex) ?? sets[0]) : null;

  // พลอยที่แสดงบนแหวน + ค่าที่ส่งเข้า LINE/สรุป (ค่าเดียวกัน)
  let choice: ShowcaseChoice = active === "own" ? { kind: "direct", unpicked: true } : { kind: "direct" };
  if (active === "own" && ownSlots) choice = { kind: "ownSlots", codes: ownSlots };
  else if (active === "own" && own) choice = { kind: "own", top: own.top, bottom: own.bottom };
  else if (active === "rec" && currentSet) choice = { kind: "rec", index: currentSet.index, top: currentSet.top, bottom: currentSet.bottom };
  // stage/aria: null = CZ ขาว (ชื่อเดียวกับ slotLabel("cz"))
  const topCode: GemQuizStoneCode | null = choice.kind === "direct" || choice.kind === "ownSlots" || !isStoneCode(choice.top) ? null : choice.top;
  const bottomCode: GemQuizStoneCode | null = choice.kind === "direct" || choice.kind === "ownSlots" || !isStoneCode(choice.bottom) ? null : choice.bottom;
  const topLabel = topCode ? stoneLabel(topCode) : DIRECT_STONE_LABEL;
  const bottomLabel = bottomCode ? stoneLabel(bottomCode) : DIRECT_STONE_LABEL;
  // รายเม็ด: aria ใช้ helper เดียวกับ LINE/สรุป · แถว+เลือกเองที่ยังไม่เลือก: ไม่มีคำหลัก/เสริม
  const slotRows = choice.kind === "ownSlots" ? formatOwnSlots(choice.codes) : null;
  const stageAria =
    slotRows !== null
      ? `ภาพจำลอง${design.name} 3 มิติ ${ownSlotsAria(slotRows)}`
      : active === "own" && isRow
        ? `ภาพจำลอง${design.name} 3 มิติ ${SHOWCASE_COPY.gemNone}`
        : `ภาพจำลอง${design.name} 3 มิติ ${roleMainLabel(design)} ${topLabel} ${roleSubLabel(design)} ${bottomLabel}${design.extraCz > 0 ? ` CZ เล็ก ${design.extraCz} เม็ด` : ""}`;
  const photos = SHOWCASE_PHOTOS[designId];
  // ชื่อมุมถ่ายมีเฉพาะรูปแบบไขว้ที่เจ้าของระบุ — แบบอื่นใช้ alt กลาง ไม่แต่งมุม
  const photoViews = designId === "bypass2" ? SHOWCASE_PHOTO_VIEWS : undefined;

  // เขียน state กลับ URL (ไม่เพิ่ม history) — เก็บ t + q เสมอเมื่อมีตาราง: reload/แชร์ได้อันดับชุดเดิม และป้าย "จากแบบทดสอบ" ตัดสินจาก i === q (Y6)
  const url = buildShowcaseUrl({
    table,
    intention,
    answered: answeredIntention,
    legacyTop3: intention === null ? legacyTop3 : null,
    own,
    ownSlots,
    active,
    recIndex: sets ? recIndex : 1,
    ring: designId,
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
    if (next === "own" && ownCodes === null && currentSet) {
      // เปิดเลือกเองครั้งแรก: seed จากแบบที่ดูอยู่ (ผู้ใช้เห็นของเดิมแล้วแก้ต่อได้) · แถว = เม็ดกลางหลัก ที่เหลือเสริม ตรงกับที่เห็น
      setOwnByCount((p) => ({ ...p, [ownCount]: isRow ? seedFromPair(ownCount, currentSet.top, currentSet.bottom) : [currentSet.top, currentSet.bottom] }));
    }
    setActive(next);
  }

  function changeDesign(next: ShowcaseDesignId) {
    if (next === designId) return;
    setDesignId(next);
    const nextDesign = getShowcaseDesign(next);
    const nextCount = ownSlotCount(nextDesign);
    const sizeOut = size !== null && !isShowcaseSize(size, next);
    // เลือกเองอยู่ + จำนวนเม็ดเปลี่ยน: จำสีเดิมไว้ · จำนวนใหม่ที่ยังไม่เคยแก้ = จัดกึ่งกลางจากที่ดูอยู่ (A5) · กลับมาจำนวนเดิม สีเดิมกลับมาเป๊ะ
    const countChanged = active === "own" && nextCount !== ownCount;
    const fitted = countChanged && ownCodes && ownByCount[nextCount] === undefined ? fitOwnToCount(ownCodes, nextCount) : null;
    if (fitted) setOwnByCount((p) => ({ ...p, [nextCount]: fitted }));
    setSelectedSlot((s) => Math.min(s, nextCount - 1));
    setUndoSnap(null);
    setAnnounce(
      SHOWCASE_COPY.designAnnounce(nextDesign.name) +
        (sizeOut ? SHOWCASE_COPY.designAnnounceSizeOut(size) : "") +
        (fitted ? ` · ${SHOWCASE_COPY.ownFitAnnounce(nextCount)}` : "")
    );
  }

  function changeIntention(next: GemQuizIntention) {
    if (next === intention) return;
    setIntention(next);
    setRecIndex(1);
    setActive("rec");
    setAnnounce(SHOWCASE_COPY.intentionAnnounce(intentionLabel(next)));
  }

  // own ต้องครบ 2 เม็ดหรือไม่มีเลย — แตะเม็ดแรกตอนว่าง = ตั้งทั้งสองเป็นพลอยนั้น
  function pickTop(code: SlotCode) {
    setUndoSnap(null);
    setOwnByCount((p) => ({ ...p, 2: p[2] ? [code, p[2][1]] : [code, code] }));
  }
  function pickBottom(code: SlotCode) {
    setUndoSnap(null);
    setOwnByCount((p) => ({ ...p, 2: p[2] ? [p[2][0], code] : [code, code] }));
  }

  // แถว: แตะพลอย = เปลี่ยนเม็ดที่เลือกอยู่ (ไม่เลื่อนเอง) · แตะครั้งแรกตอนยังไม่เคยเลือก = ใส่ทุกเม็ดด้วยพลอยนั้น (ครบทุกเม็ดหรือไม่มีเลย)
  function pickSlotGem(code: SlotCode) {
    setUndoSnap(null);
    const name = slotLabel(code);
    if (ownCodes === null) {
      setOwnByCount((p) => ({ ...p, [ownCount]: fillAll(ownCount, code) }));
      setAnnounce(SHOWCASE_COPY.ownFillAllDone(name));
      return;
    }
    const next = [...ownCodes];
    next[slot] = code;
    setOwnByCount((p) => ({ ...p, [ownCount]: next }));
    setAnnounce(SHOWCASE_COPY.ownSlotsAnnounce(slot + 1, name));
  }
  function fillAllSlots(code: SlotCode) {
    if (ownCodes) setUndoSnap({ count: ownCount, codes: ownCodes });
    setOwnByCount((p) => ({ ...p, [ownCount]: fillAll(ownCount, code) }));
    setAnnounce(SHOWCASE_COPY.ownFillAllDone(slotLabel(code)));
  }
  // ล้างค่า: ทุกเม็ดกลับเป็น CZ ขาว (เก็บเป็นรหัส "cz" ทุกเม็ด ไม่ใช่ null เพราะผู้ใช้เลือกแล้ว) · เลิกทำได้เหมือน "ใส่ X ทุกเม็ด"
  function resetAllCz() {
    if (ownCodes) setUndoSnap({ count: ownCount, codes: ownCodes });
    setOwnByCount((p) => ({ ...p, [ownCount]: fillAll(ownCount, CZ_SLOT) }));
    setAnnounce(SHOWCASE_COPY.ownResetCzDone);
  }
  function undoFill() {
    if (!undoSnap || undoSnap.count !== ownCount) return;
    const restored = undoSnap.codes;
    setOwnByCount((p) => ({ ...p, [undoSnap.count]: restored }));
    setUndoSnap(null);
    setAnnounce(SHOWCASE_COPY.ownUndoDone);
  }

  return (
    <div className="fixed inset-0 z-10 scroll-pt-[46dvh] overflow-y-auto overflow-x-hidden overscroll-contain bg-[var(--gq-ivory)] lg:scroll-pt-6">
      <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-x-8 gap-y-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] lg:grid-cols-2">
        {/* stage — มือถือ: ติดบน ~40dvh · เดสก์ท็อป: คอลัมน์ซ้าย sticky */}
        <div className="sticky top-0 z-20 -mx-4 bg-[var(--gq-ivory)] px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:static lg:top-auto lg:z-0 lg:row-span-4 lg:row-start-1 lg:mx-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-6">
          <div className="lg:sticky lg:top-6">
            <RingStage
              design={design}
              top={topCode}
              bottom={bottomCode}
              slots={choice.kind === "ownSlots" ? choice.codes : null}
              ariaLabel={stageAria}
              photo={photos[0]}
              photoAlt={photos.length > 0 ? photoAlt(design.name, 0, photos.length, photoViews) : design.name}
            />
          </div>
        </div>

        <header className="min-w-0 lg:col-start-2 lg:row-start-1 lg:pt-6">
          {/* P3: ทางกลับหน้ารวมเครื่องมือ — state อยู่ใน URL อยู่แล้ว เปิดได้ตลอด */}
          <ToolsHubLink variant="text" className="-mt-1 mb-1" />
          <p className="pl-[0.4em] font-quiz-display text-[13px] font-semibold tracking-[0.4em] text-[var(--gq-burgundy-dark)]">3J · JEWELRY</p>
          <h1 className="mt-2 font-quiz-serif text-2xl font-semibold leading-snug text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.h1}</h1>
          <p className="mt-1 text-base">
            <span className="font-medium">{SHOWCASE_COPY.priceAllDesigns(formatPriceThb())}</span>
            <span className="text-[var(--gq-text-muted)]"> · {leadTimeLabel()}</span>
          </p>
        </header>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <DesignPicker value={designId} onChange={changeDesign} />
          <p role="status" className="sr-only">
            {announce}
          </p>
          <ModeSwitch mode={active} onChange={changeMode} />
          {active === "rec" ? (
            <>
              <IntentionPicker value={intention} onSelect={changeIntention} />
              <GemSetPicker design={design} sets={sets} selectedIndex={recIndex} onSelect={setRecIndex} badgeKind={badgeKind} basisNote={basisNote} />
            </>
          ) : (
            <OwnGemPicker
              design={design}
              own={own}
              onPickTop={pickTop}
              onPickBottom={pickBottom}
              bypassActions={isRow ? undefined : { onResetCz: resetAllCz, onUndo: undoFill, canUndo: undoSnap !== null && undoSnap.count === ownCount }}
              perGem={
                isRow
                  ? {
                      codes: ownSlots,
                      count: ownCount,
                      selected: slot,
                      onSelect: setSelectedSlot,
                      onPick: pickSlotGem,
                      onFillAll: fillAllSlots,
                      onResetCz: resetAllCz,
                      onUndo: undoFill,
                      canUndo: undoSnap !== null && undoSnap.count === ownCount,
                    }
                  : undefined
              }
            />
          )}
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-3">
          <SizePicker design={design} value={effectiveSize} outOfRangeSize={outOfRangeSize} onChange={setSize} lastMeasured={lastMeasured} />
        </div>

        <div className="min-w-0 lg:col-span-2 lg:row-start-5">
          <PhotoGallery photos={photos} designName={design.name} views={photoViews} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-4">
          <OrderSummary designId={designId} choice={choice} size={effectiveSize} />
          <div className="border-t border-[var(--gq-divider)] pt-4">
            <p className="text-xs leading-[1.65] text-[var(--gq-text-faint)]">
              <strong className="font-semibold">ข้อควรทราบ:</strong> {GEM_QUIZ_DISCLAIMER}
            </p>
            {design.extraCz > 0 && <p className="mt-1.5 text-xs leading-[1.65] text-[var(--gq-text-faint)]">{SHOWCASE_COPY.czNote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
