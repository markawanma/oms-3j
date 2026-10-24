"use client";

import { useCallback, useState } from "react";
import { COPY } from "@/lib/ring-size/config";
import { copyText } from "@/lib/ring-size/line-message";
import { TEXT_3 } from "./styles";

// useCopy — คัดลอกข้อความ + สถานะ (ok/fail) · fail = แสดงกล่องข้อความให้เลือกคัดลอกเอง
// (webview บางตัวไม่มี clipboard เลย — ต้องมีทางสำรองเสมอ ห้ามจบที่ปุ่มเงียบ)

export type CopyStatus = "idle" | "ok" | "fail";

export function useCopy(text: string) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const copy = useCallback(async () => {
    const ok = await copyText(text);
    setStatus(ok ? "ok" : "fail");
    return ok;
  }, [text]);
  return { status, copy };
}

export function CopyStatusNote({ status, text }: { status: CopyStatus; text: string }) {
  if (status === "idle") return null;
  if (status === "ok") {
    return (
      <p role="status" className={`m-0 text-center text-[14px] font-medium ${TEXT_3}`}>
        {COPY.r6.copied}
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className={`m-0 text-[15px] leading-snug ${TEXT_3}`}>{COPY.r6.copyFailed}</p>
      <textarea
        readOnly
        value={text}
        rows={4}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-[14px] border border-[var(--rs-border-btn-2)] bg-[var(--rs-surface)] p-3 text-[15px] leading-snug text-[var(--rs-text)]"
        aria-label={COPY.r6.copy}
      />
    </div>
  );
}
