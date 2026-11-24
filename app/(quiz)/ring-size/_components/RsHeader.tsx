"use client";

import { createContext, useContext } from "react";
import { COPY } from "@/lib/ring-size/config";
import { ToolsHubExit } from "../../_components/ToolsHubExit";
import { BackIcon } from "./Icons";
import { FOCUS, SERIF, TEXT, TEXT_2 } from "./styles";

// RsHeader — ปุ่มย้อน 44×44 (ซ้าย) · ตัวนับขั้น (กลาง · aria-label "ขั้นที่ 1 จาก 3") · ปุ่ม "เครื่องมือ 3J" (ขวา · ทุกจอ)
// ตัวนับ dynamic ตาม state (คนใหม่ 01/03 · คนกลับมา 01/02) — คำนวณที่ lib/ring-size/flow.ts
//
// มติเจ้าของ 24 พ.ย. 69 (เขียนทับมติ 18 พ.ย.): ขวาบนเป็นลิงก์ hub ทุกจอ แทนมาร์ก 3J ที่กดได้เฉพาะหน้าผล (ux-tools-navigation §2/§5)
// ถ้ามีค่าที่ปรับไว้แล้วยังไม่บันทึก (R2/R2Coin/R5A/R5B) → กดแล้วขึ้น LeaveSheet ถามก่อนออก
// dirty ส่งผ่าน context (RingSizeClient คำนวณจาก state ที่มีอยู่แล้วที่เดียว) — ไม่ต้องไล่ส่ง prop ผ่านทุกจอ · ไม่มี provider = ไม่ dirty (เทสต์จอเดี่ยว)

const RsHubDirtyContext = createContext(false);
export const RsHubDirtyProvider = RsHubDirtyContext.Provider;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ความสูงจริงของ header = pt-1.5 (6) + ปุ่มย้อน h-11 (44) + pb-0.5 (2) — ใช้เป็นค่าตั้งต้นก่อนวัดจริง (R5B วัดบล็อกบนรวมแถบ G1 เอง) */
export const HEADER_PX = 52;

export function RsHeader({ step, onBack }: { step?: { current: number; total: number } | null; onBack?: () => void }) {
  const dirty = useContext(RsHubDirtyContext);
  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-[22px] pb-0.5 pt-1.5">
      {onBack ? (
        <button
          type="button"
          aria-label={COPY.common.back}
          onClick={onBack}
          className={`-ml-2 flex h-11 w-11 items-center justify-center justify-self-start rounded-full ${TEXT} hover:bg-[var(--rs-blush)] ${FOCUS}`}
        >
          <BackIcon />
        </button>
      ) : (
        <span className="h-11 w-11" aria-hidden="true" />
      )}
      {step ? (
        <span
          aria-label={COPY.common.stepAria(step.current, step.total)}
          className={`${SERIF} text-[14px] tracking-[0.18em] ${TEXT_2}`}
        >
          {pad2(step.current)} / {pad2(step.total)}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="-mr-2 justify-self-end">
        <ToolsHubExit variant="nav" dirty={dirty} leaveBody={COPY.common.leaveBody} />
      </div>
    </header>
  );
}
