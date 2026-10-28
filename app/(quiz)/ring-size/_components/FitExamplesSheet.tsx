"use client";

import type { ReactNode } from "react";
import { COPY, type RefKind } from "@/lib/ring-size/config";
import { Sheet } from "./Sheet";
import { CheckIcon, CrossIcon } from "./Icons";
import { TEXT, TEXT_3 } from "./styles";

// FitExamplesSheet — ภาพตัวอย่าง "พอดี / เล็กไป / ใหญ่ไป" ของบัตรหรือเหรียญ (build spec ข้อ 4.2)
//
// ภาพสอนวาดวัตถุได้ (ไม่ใช่เวทีวัด) · ไม่มีไม้บรรทัด/ตัวเลข มม. (กันถูกอ่านเป็นขนาดจริง) ·
// ✓/✗ + คำ "ถูก/ผิด" ไม่พึ่งสีอย่างเดียว · role="img" + aria-label ไทยบรรยายภาพ

const RED = "#a2191d";
const W = 140;
const H = 100;

type Fit = "good" | "small" | "big";

function CoinFig({ fit, label }: { fit: Fit; label: string }) {
  const coinR = 30;
  // เส้นแดงอยู่ "ใต้" เหรียญ: พอดี = ชิดขอบ · เล็กไป = เหรียญบังเส้นเกือบหมด · ใหญ่ไป = มีช่องขาว
  const ringR = fit === "good" ? coinR + 1.5 : fit === "small" ? coinR - 1 : coinR + 10;
  return (
    <svg role="img" aria-label={label} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <circle cx={W / 2} cy={H / 2} r={ringR} stroke={RED} strokeWidth={3} />
      <circle cx={W / 2} cy={H / 2} r={coinR} fill="#D9D9DE" stroke="#8E8E96" strokeWidth={1.5} />
      <circle cx={W / 2} cy={H / 2} r={coinR - 10} fill="#D8B66A" stroke="#A88536" strokeWidth={1} />
    </svg>
  );
}

function CardFig({ fit, label }: { fit: Fit; label: string }) {
  const half = 34;
  const off = fit === "good" ? half + 1.5 : fit === "small" ? half - 1 : half + 10;
  return (
    <svg role="img" aria-label={label} width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <line x1={W / 2 - off} x2={W / 2 - off} y1={0} y2={H} stroke={RED} strokeWidth={3} />
      <line x1={W / 2 + off} x2={W / 2 + off} y1={0} y2={H} stroke={RED} strokeWidth={3} />
      <rect x={W / 2 - half} y={-6} width={half * 2} height={H + 12} rx={4} fill="#C8A777" />
      <rect x={W / 2 - half + 8} y={10} width={12} height={9} rx={2} fill="#fff" opacity={0.7} />
    </svg>
  );
}

function Row({ ok, caption, children }: { ok: boolean; caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex items-center gap-3 rounded-[16px] border border-[var(--rs-border)] bg-[var(--rs-bg)] p-3">
      <div className="shrink-0 overflow-hidden rounded-[12px] bg-[var(--rs-surface)]">{children}</div>
      <figcaption className={`flex min-w-0 flex-1 items-start gap-2 text-[15px] leading-snug ${TEXT_3}`}>
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            ok ? "bg-[var(--rs-success)] text-[var(--rs-success-text)]" : "bg-[var(--rs-blush)] text-[var(--rs-blush-text)]"
          }`}
        >
          {ok ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
          <span className="sr-only">{ok ? COPY.fit.goodMark : COPY.fit.badMark}</span>
        </span>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}

export function FitExamplesSheet({ kind, onClose }: { kind: RefKind; onClose: () => void }) {
  const Fig = kind === "coin" ? CoinFig : CardFig;
  return (
    <Sheet title={COPY.fit.title} onClose={onClose}>
      <div className={`flex flex-col gap-2.5 ${TEXT}`}>
        <Row ok caption={COPY.fit.good[kind]}>
          <Fig fit="good" label={COPY.fit.figureGood[kind]} />
        </Row>
        <Row ok={false} caption={COPY.fit.small[kind]}>
          <Fig fit="small" label={COPY.fit.figureSmall[kind]} />
        </Row>
        <Row ok={false} caption={COPY.fit.big[kind]}>
          <Fig fit="big" label={COPY.fit.figureBig[kind]} />
        </Row>
        {kind === "coin" ? <p className={`m-0 text-[15px] leading-snug ${TEXT_3}`}>{COPY.fit.coinFooter}</p> : null}
      </div>
    </Sheet>
  );
}
