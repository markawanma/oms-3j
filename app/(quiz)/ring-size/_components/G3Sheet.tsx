"use client";

import { COPY, type RefKind } from "@/lib/ring-size/config";
import { RsButton } from "./RsButton";
import { Sheet } from "./Sheet";
import { WarnIcon } from "./Icons";
import { TEXT_3 } from "./styles";

// G3 — ค่าเทียบจอนอก 4.5–7.5 px/มม. (build spec ข้อ 4.3)
// alertdialog โทน warn · โฟกัสไปหัวข้อ · "ปรับอีกครั้ง" เป็นปุ่มหลัก (Esc = ปรับอีกครั้ง) · "ถูกต้องแล้ว ใช้ค่านี้" เป็นปุ่มรอง
// ผู้เรียกต้อง "ไม่บันทึกค่า" จนกว่าผู้ใช้กดใช้ค่านี้
export function G3Sheet({ kind, onRetry, onAccept }: { kind: RefKind; onRetry: () => void; onAccept: () => void }) {
  const items = kind === "coin" ? COPY.g3.checkCoin : COPY.g3.checkCard;
  return (
    <Sheet title={COPY.g3.title} role="alertdialog" onClose={onRetry} showClose={false} dismissOnBackdrop={false}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-[16px] border border-[var(--rs-warn-border)] bg-[var(--rs-warn)] p-3.5 text-[var(--rs-warn-text)]">
          <WarnIcon size={24} className="mt-0.5 shrink-0 text-[var(--rs-warn-icon)]" />
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-[15px] leading-snug">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <RsButton onClick={onRetry}>{COPY.g3.retry}</RsButton>
          <RsButton variant="secondary" onClick={onAccept}>
            <span className={TEXT_3}>{COPY.g3.accept}</span>
          </RsButton>
        </div>
      </div>
    </Sheet>
  );
}
