"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "@/lib/ring-size/config";
import {
  buildShareText,
  dataUrlToFile,
  renderShareCardDataUrl,
  SYSTEM_FONTS,
  type ShareCardData,
  type ShareCardFonts,
} from "@/lib/ring-size/share-card";
import { CopyStatusNote, useCopy } from "./useCopy";
import { RsButton } from "./RsButton";
import { Sheet } from "./Sheet";
import { ShareIcon } from "./Icons";
import { TEXT_3 } from "./styles";

// ShareCardSheet (R7) — สร้างรูปการ์ดในเครื่อง (ไม่ส่งขึ้นเซิร์ฟเวอร์) → รูปเป็น <img src="data:image/png;base64,...">
// ให้กดค้างบันทึก (ไม่ใช้ blob: — บาง webview บันทึกไม่ได้) · ปุ่มแชร์ของระบบแสดงเมื่อเครื่องแชร์ไฟล์ได้
// สถานะ: กำลังทำรูป (ปิดปุ่มซ้ำ) · ผิดพลาด (ลองใหม่/คัดลอกข้อความ) · พร้อม · fallback คัดลอกข้อความเสมอ

type Phase = "loading" | "ready" | "error";

export function ShareCardSheet({ data, onClose }: { data: ShareCardData; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const serifProbe = useRef<HTMLSpanElement>(null);
  const sansProbe = useRef<HTMLSpanElement>(null);
  const runId = useRef(0);

  const text = buildShareText(data.rec, data.circ);
  const { status, copy } = useCopy(text);

  const generate = useCallback(async () => {
    const id = ++runId.current;
    setPhase("loading");
    try {
      // ฟอนต์จริงของ next/font อ่านจาก computed style (ชื่อ family ถูก hash) — อ่านไม่ได้ = ฟอนต์ระบบ
      const fonts: ShareCardFonts = { ...SYSTEM_FONTS };
      try {
        const s = serifProbe.current ? getComputedStyle(serifProbe.current).fontFamily : "";
        const n = sansProbe.current ? getComputedStyle(sansProbe.current).fontFamily : "";
        if (s) fonts.serif = s;
        if (n) fonts.sans = n;
      } catch {
        // ใช้ฟอนต์ระบบ
      }
      const url = await renderShareCardDataUrl(data, fonts);
      if (id !== runId.current) return;
      setDataUrl(url);
      const file = dataUrlToFile(url, "ring-size.png");
      setCanNativeShare(
        !!file && typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })
      );
      setPhase("ready");
    } catch {
      if (id !== runId.current) return;
      setDataUrl(null);
      setPhase("error");
    }
  }, [data]);

  useEffect(() => {
    void generate();
    return () => {
      runId.current++;
    };
  }, [generate]);

  const nativeShare = async () => {
    if (!dataUrl) return;
    const file = dataUrlToFile(dataUrl, "ring-size.png");
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: COPY.share.title });
    } catch {
      // ผู้ใช้ยกเลิก/ระบบไม่รับ — รูปยังอยู่ให้กดค้างบันทึกได้
    }
  };

  return (
    <Sheet title={COPY.share.dialogTitle} onClose={onClose}>
      <span ref={serifProbe} aria-hidden="true" className="font-quiz-serif hidden" />
      <span ref={sansProbe} aria-hidden="true" className="font-quiz-sans hidden" />
      <div className="flex flex-col gap-3">
        {phase === "loading" ? (
          <p role="status" className={`m-0 py-10 text-center text-[16px] ${TEXT_3}`}>
            {COPY.share.loading}
          </p>
        ) : null}

        {phase === "error" ? (
          <p role="alert" className="m-0 rounded-[14px] bg-[var(--rs-warn)] p-3.5 text-[15px] leading-snug text-[var(--rs-warn-text)]">
            {COPY.share.error}
          </p>
        ) : null}

        {phase === "ready" && dataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt={COPY.share.imageAlt} width={1080} height={1350} className="mx-auto h-auto w-full max-w-[320px] rounded-[16px] border border-[var(--rs-border)]" />
            <p className={`m-0 text-center text-[15px] leading-snug ${TEXT_3}`}>{COPY.share.holdToSave}</p>
          </>
        ) : null}

        <div className="flex flex-col gap-2">
          {phase === "ready" && canNativeShare ? (
            <RsButton onClick={nativeShare} icon={<ShareIcon />}>
              {COPY.share.nativeShare}
            </RsButton>
          ) : null}
          {phase === "error" ? <RsButton onClick={() => void generate()}>{COPY.share.retry}</RsButton> : null}
          <RsButton variant="secondary" onClick={() => void copy()}>
            {COPY.share.copyText}
          </RsButton>
          <CopyStatusNote status={status} text={text} />
        </div>
      </div>
    </Sheet>
  );
}
