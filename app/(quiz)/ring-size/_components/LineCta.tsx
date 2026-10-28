"use client";

import { useState } from "react";
import { COPY, LINE_OA_FALLBACK_URL, LINE_PRIMARY_MODE, type LineMode } from "@/lib/ring-size/config";
import { buildLineMessage, primaryLineHref, type LineMessageInput } from "@/lib/ring-size/line-message";
import { LineChatIcon } from "./Icons";
import { RsButton } from "./RsButton";
import { CopyStatusNote, useCopy } from "./useCopy";
import { LINK, TEXT_2 } from "./styles";

// LineCta — ปุ่ม LINE หลักปุ่มเดียวของหน้าผล + แถว "ส่งไม่ได้? คัดลอกข้อความ · เปิดแชท LINE"
//
// โหมด (config.LINE_PRIMARY_MODE):
//   copyThenOpen — คัดลอกข้อความ แล้วเปิดแชท (ปลายทางเป็นลิงก์ที่เจ้าของให้ · ใช้ได้ทุกที่) · คัดลอกไม่ได้ = ไม่เปิดต่อ แสดงกล่องข้อความให้คัดลอกเอง
//   oaMessage    — ลิงก์เดียวเปิดแชทพร้อมข้อความ (ยังไม่ผ่านทดสอบเครื่องจริง — สลับที่ config เมื่อผ่านแล้ว)
// ลิงก์ปกติหน้าเดิม (ไม่ใช้ window.open ที่ webview บล็อก) · ข้อความมีเฉพาะ เบอร์ · มม. · วิธี · เทียบจอด้วย

export function LineCta({
  input,
  label,
  mode = LINE_PRIMARY_MODE,
  stickyPrimary = false,
  navigate = (url) => {
    window.location.href = url;
  },
}: {
  input: LineMessageInput;
  label: string;
  mode?: LineMode;
  /** ปุ่มหลัก + คำอธิบายติดขอบล่างจอ (R6Between — เนื้อหายาวกว่าจอ) · ส่วน "ส่งไม่ได้?" ยังอยู่ในกระแส */
  stickyPrimary?: boolean;
  /** เปิดแชทหลังคัดลอก (ฉีดได้ในเทสต์) */
  navigate?: (url: string) => void;
}) {
  const message = buildLineMessage(input);
  const { status, copy } = useCopy(message);
  const [busy, setBusy] = useState(false);

  const primaryCopyThenOpen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await copy();
      if (ok) navigate(LINE_OA_FALLBACK_URL);
    } finally {
      setBusy(false);
    }
  };

  const primary = (
    <>
      {mode === "oaMessage" ? (
        <RsButton href={primaryLineHref(input, "oaMessage")} icon={<LineChatIcon />}>
          {label}
        </RsButton>
      ) : (
        <RsButton onClick={() => void primaryCopyThenOpen()} icon={<LineChatIcon />} aria-busy={busy}>
          {label}
        </RsButton>
      )}
      <p className={`m-0 text-center text-[13px] ${TEXT_2}`}>{mode === "oaMessage" ? COPY.r6.ctaLineHint : COPY.r6.ctaLineHintCopy}</p>
    </>
  );

  const fallback = (
    <>
      <div className={`flex items-center justify-center gap-1.5 text-[14px] ${TEXT_2}`}>
        <span>{COPY.r6.cantSend}</span>
        <button type="button" onClick={() => void copy()} className={LINK}>
          {COPY.r6.copy}
        </button>
        <span aria-hidden="true">·</span>
        <a href={LINE_OA_FALLBACK_URL} className={LINK}>
          {COPY.r6.openChat}
        </a>
      </div>
      <CopyStatusNote status={status} text={message} />
    </>
  );

  if (stickyPrimary) {
    return (
      <>
        <div className="sticky bottom-0 z-10 -mx-[22px] flex flex-col gap-2 border-t border-[var(--rs-border)] bg-[var(--rs-bg)] px-[22px] pb-[max(16px,env(safe-area-inset-bottom))] pt-3">{primary}</div>
        <div className="flex flex-col gap-2">{fallback}</div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {primary}
      {fallback}
    </div>
  );
}
