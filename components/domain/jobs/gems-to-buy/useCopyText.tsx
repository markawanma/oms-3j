"use client";

// useCopyText + ManualCopyDialog — คัดลอกข้อความลงคลิปบอร์ด · คัดลอกไม่ได้ (ไม่ใช่ secure context / ถูกบล็อก) → Modal "คัดลอกเอง" ให้กด Ctrl+C
// (ไม่ใช่แค่ toast error แบบ CopyButton เดิม — ผู้ใช้ไม่มีทางออก) · ข้อความที่รับมา = ข้อความจาก buildGemOrderText (ไม่มีราคา) · ไม่มีตรรกะอื่น

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function useCopyText(): { copy: (text: string) => Promise<boolean>; manualText: string | null; closeManual: () => void } {
  const [manualText, setManualText] = useState<string | null>(null);
  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      setManualText(text);
      return false;
    }
  }, []);
  return { copy, manualText, closeManual: useCallback(() => setManualText(null), []) };
}

export function ManualCopyDialog({ text, onClose }: { text: string | null; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (text === null) return;
    // Modal โฟกัสตัวกล่องหลัง mount — ย้ายโฟกัสมาที่ textarea แล้วเลือกข้อความทั้งหมด
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <Modal open={text !== null} onClose={onClose} title="คัดลอกข้อความเอง">
      <div className="space-y-3">
        <p className="text-sm text-zinc-800">เบราว์เซอร์คัดลอกให้อัตโนมัติไม่ได้ — ข้อความถูกเลือกไว้แล้ว กด <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">Ctrl+C</kbd> แล้วนำไปวางใน LINE</p>
        <textarea ref={ref} readOnly rows={10} value={text ?? ""} aria-label="ข้อความรายการสั่งซื้อพลอย" className="w-full rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-sm text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600" />
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        </div>
      </div>
    </Modal>
  );
}
