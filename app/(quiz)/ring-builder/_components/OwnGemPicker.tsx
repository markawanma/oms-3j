"use client";

// OwnGemPicker — แผงโหมด "เลือกพลอยเอง": 2 แถว radiogroup (พลอยหลัก/พลอยเสริม · ตำแหน่งตามแบบแหวน) × 5 ชนิดเดิม · หลัก=เสริมได้ (25 ชุด) · ราคาไม่เปลี่ยน (890 บาทที่เดียว)
// 🔴 คำอธิบายมาจาก config เท่านั้น: คู่ตรงใน GEM_QUIZ_PAIRS (findExactPair) → ข้อความคู่เดิม · ไม่มีคู่ → labelTh + keywords รายเม็ด + หมายเหตุ · ไม่มีคำเชื่อมความหมายเอง (Y4)
// ปุ่ม 5 ต่อแถวที่ 360px ≈ 59×64px · เลือกแล้ว = ขอบหนา + เครื่องหมายถูก (ไม่พึ่งสี) · ←→ roving ต่อแถว
import { useId, useRef } from "react";
import { GEM_QUIZ_STONES, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { roleMainLabel, roleSubLabel, type ShowcaseDesign } from "@/lib/ring-builder/showcase/designs";
import { isAllCz, slotLabel } from "@/lib/ring-builder/showcase/own-slots";
import { CZ_SLOT, type OwnGems, type SlotCode } from "@/lib/ring-builder/showcase/quiz-link";
import { describeOwn, describeOwnSlots } from "@/lib/ring-builder/showcase/sets";
import { czIconColors } from "@/lib/ring-builder/viewer/gem-colors";
import { GemIcon } from "../../gem-quiz/_components/GemIcon";
import { OwnSlotBar } from "./OwnSlotBar";
import { PlacementNote } from "./PlacementNote";
import { handleRadioKeyDown } from "./radio-keys";

export function GemRow({
  label,
  value,
  onPick,
  groupLabel,
  withCz = false,
}: {
  label: string;
  value: SlotCode | null;
  onPick: (code: SlotCode) => void;
  /** ชื่อ radiogroup เมื่อหัวข้อ (label) ไม่ใช่ชื่อที่เหมาะอ่านออกเสียง (โหมดรายเม็ด) */
  groupLabel?: string;
  /** โหมดรายเม็ด: เพิ่ม "CZ ขาว" เป็นตัวเลือกที่ 6 วางท้ายแถว (5 ตำแหน่งเดิมไม่ขยับ) */
  withCz?: boolean;
}) {
  const options: { code: SlotCode; name: string; colors: { base: string; light: string; dark: string } }[] = [
    ...GEM_QUIZ_STONES.map((st) => ({ code: st.code as SlotCode, name: st.labelTh, colors: st.colors })),
    ...(withCz ? [{ code: CZ_SLOT as SlotCode, name: slotLabel(CZ_SLOT), colors: czIconColors() }] : []),
  ];
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = value === null ? -1 : options.findIndex((o) => o.code === value);
  const tabStop = selectedIdx < 0 ? 0 : selectedIdx;
  return (
    <div className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[15px] font-medium text-[var(--gq-text)]">
        {label}
      </h3>
      <div role="radiogroup" aria-labelledby={groupLabel ? undefined : headingId} aria-label={groupLabel} className={`grid ${withCz ? "grid-cols-6 gap-1.5" : "grid-cols-5 gap-2"}`}>
        {options.map((stone, i) => {
          const checked = stone.code === value;
          return (
            <button
              key={stone.code}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={stone.name}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onPick(stone.code)}
              onKeyDown={(e) =>
                handleRadioKeyDown(e, i, options.length, (next) => {
                  onPick(options[next].code);
                  refs.current[next]?.focus();
                })
              }
              className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-0.5 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)] ${
                checked ? "border-2 border-[var(--gq-burgundy)] bg-[var(--gq-burgundy-soft)]" : "border-[var(--gq-border)] bg-white hover:border-[var(--gq-burgundy-border)]"
              }`}
            >
              <GemIcon colors={stone.colors} size={withCz ? 26 : 28} />
              <span aria-hidden="true" className={`max-w-full whitespace-nowrap leading-none text-[var(--gq-text)] ${withCz ? "text-[11px]" : "text-xs"}`}>
                {stone.name}
              </span>
              {checked && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gq-burgundy)] text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** โหมดรายเม็ด (D1.2a) — แบบแถว 3–7 เม็ด · state อยู่ที่ RingShowcaseClient */
export interface PerGemProps {
  /** null = ยังไม่เคยเลือก · ไม่เคยมีเม็ด "ว่างครึ่งๆ" (ครบทุกเม็ดหรือไม่มีเลย) */
  codes: readonly SlotCode[] | null;
  count: number;
  selected: number;
  onSelect: (index: number) => void;
  onPick: (code: SlotCode) => void;
  onFillAll: (code: SlotCode) => void;
  /** กลับเป็น CZ ขาวทุกเม็ด (ล้างค่า) — เลิกทำได้เหมือน onFillAll */
  onResetCz: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

function PerGemPicker({ design, codes, count, selected, onSelect, onPick, onFillAll, onResetCz, onUndo, canUndo }: PerGemProps & { design: ShowcaseDesign }) {
  const current = codes ? codes[selected] : null;
  const currentName = current ? slotLabel(current) : null;
  const desc = codes ? describeOwnSlots(codes) : null;
  const showFill = current !== null && codes !== null && codes.some((c) => c !== current);
  const showReset = codes !== null && !isAllCz(codes);
  return (
    <div className="flex flex-col gap-4">
      <PlacementNote design={design} perGem />
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-[var(--gq-text-muted)]">
          {SHOWCASE_COPY.ownPerGemOrderHint}
        </p>
        <OwnSlotBar codes={codes ?? Array.from({ length: count }, () => null)} selected={selected} onSelect={onSelect} />
      </div>
      <GemRow label={SHOWCASE_COPY.ownSlotHeading(selected + 1, currentName)} groupLabel={SHOWCASE_COPY.ownSlotRowAria(selected + 1)} value={current} onPick={onPick} withCz />
      {(showFill || showReset || canUndo) && (
        <div className="flex flex-col gap-2">
          {showFill && current && (
            <button
              type="button"
              onClick={() => onFillAll(current)}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--gq-burgundy-border)] bg-white px-4 text-[15px] font-medium text-[var(--gq-burgundy)] transition-colors hover:bg-[var(--gq-burgundy-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
            >
              {SHOWCASE_COPY.ownFillAll(slotLabel(current))}
            </button>
          )}
          {showReset && (
            <button
              type="button"
              onClick={onResetCz}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--gq-border)] bg-white px-4 text-[15px] font-medium text-[var(--gq-text)] transition-colors hover:border-[var(--gq-burgundy-border)] hover:bg-[var(--gq-burgundy-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
            >
              {SHOWCASE_COPY.ownResetCz}
            </button>
          )}
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 text-sm font-medium text-[var(--gq-text-muted)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
            >
              {SHOWCASE_COPY.ownUndo}
            </button>
          )}
        </div>
      )}

      {/* ไม่ครอบด้วย aria-live (อ่านยาวทุกแตะ) — ประกาศสั้นๆ ทำที่ role=status ของหน้า */}
      {/* CZ ขาวล้วน = ไม่มีคำอธิบายพลอย (CZ ไม่มีความหมาย/ความเชื่อ) -> ไม่แสดงการ์ด */}
      {(codes === null || desc !== null) && (
      <div className="flex flex-col gap-1.5 rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4 py-3.5">
        {desc === null && <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownEmptyHintPerGem}</p>}
        {desc?.kind === "pair" && (
          <>
            <p className="font-quiz-display text-xl font-semibold text-[var(--gq-burgundy-dark)]">{desc.pair.title}</p>
            <p className="text-[13px] text-[var(--gq-text-muted)]">{desc.pair.th}</p>
            <p className="text-sm">เหมาะกับ: {desc.pair.fit}</p>
          </>
        )}
        {desc?.kind === "same" && (
          <>
            <p className="text-base font-medium text-[var(--gq-burgundy-dark)]">{desc.withCz ? desc.label : SHOWCASE_COPY.ownBothSame(desc.label)}</p>
            <p className="text-sm text-[var(--gq-text-muted)]">{desc.keywords}</p>
          </>
        )}
        {desc?.kind === "list" && (
          <>
            {desc.items.map((it) => (
              <p key={it.label} className="text-sm">
                <span className="font-medium text-[var(--gq-burgundy-dark)]">{it.label}</span> · {it.keywords}
              </p>
            ))}
            <p className="mt-1 text-xs leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownNoPairNote}</p>
          </>
        )}
      </div>
      )}
    </div>
  );
}

export function OwnGemPicker({
  design,
  own,
  onPickTop,
  onPickBottom,
  perGem,
}: {
  design: ShowcaseDesign;
  /** null = ยังไม่ได้เลือกเลย (เข้าตรง) */
  own: OwnGems | null;
  onPickTop: (code: GemQuizStoneCode) => void;
  onPickBottom: (code: GemQuizStoneCode) => void;
  /** แบบแถว: โหมดรายเม็ด (ไขว้ไม่ส่ง = 2 แถวบน/ล่างเดิม) */
  perGem?: PerGemProps;
}) {
  if (design.layout.kind === "row" && perGem) return <PerGemPicker design={design} {...perGem} />;
  const desc = own ? describeOwn(own.top, own.bottom) : null;
  return (
    <div className="flex flex-col gap-4">
      <PlacementNote design={design} />
      <GemRow label={roleMainLabel(design)} value={own ? own.top : null} onPick={(c) => c !== CZ_SLOT && onPickTop(c)} />
      <GemRow label={roleSubLabel(design)} value={own ? own.bottom : null} onPick={(c) => c !== CZ_SLOT && onPickBottom(c)} />

      <div aria-live="polite" className="flex flex-col gap-1.5 rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4 py-3.5">
        {desc === null && <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownEmptyHint}</p>}
        {desc?.kind === "pair" && (
          <>
            <p className="font-quiz-display text-xl font-semibold text-[var(--gq-burgundy-dark)]">{desc.pair.title}</p>
            <p className="text-[13px] text-[var(--gq-text-muted)]">{desc.pair.th}</p>
            <p className="text-sm">เหมาะกับ: {desc.pair.fit}</p>
          </>
        )}
        {desc?.kind === "same" && (
          <>
            <p className="text-base font-medium text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.ownBothSame(desc.label)}</p>
            <p className="text-sm text-[var(--gq-text-muted)]">{desc.keywords}</p>
          </>
        )}
        {desc?.kind === "singles" && (
          <>
            <p className="text-sm">
              <span className="font-medium text-[var(--gq-burgundy-dark)]">{desc.top.label}</span> · {desc.top.keywords}
            </p>
            <p className="text-sm">
              <span className="font-medium text-[var(--gq-burgundy-dark)]">{desc.bottom.label}</span> · {desc.bottom.keywords}
            </p>
            <p className="mt-1 text-xs leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.ownNoPairNote}</p>
          </>
        )}
      </div>
    </div>
  );
}
