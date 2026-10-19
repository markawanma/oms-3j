"use client";

// JobPhotoDeleteDialog — ยืนยันลบรูปใบงาน (ux §3.4) · Modal เดิม (bottom sheet บนมือถือ) · ปุ่มเรียงเหมือน dialog อื่นของหน้าใบงาน (DialogButtons)
// focus เริ่มที่ "ยกเลิก" (กันกด Enter ลบโดยพลั้ง) · เนื้อความเลือกบรรทัดเดียวที่เกี่ยวที่สุด + ต่อท้าย "กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ" (มติ จ5)
// ล้มเหลว = ข้อความในกล่อง คงกล่องไว้ให้กดซ้ำ (ไม่ปิดเอง) · ผลสำเร็จ = ผู้เรียกปิดกล่อง

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DialogButtons, ErrorLine } from "@/components/domain/jobs/JobDialogs";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

export type DeleteCase = "last" | "primary" | "catalog" | "plain";

/** เลือกบรรทัดเตือนเดียว: รูปสุดท้าย > รูปหลัก (ยังมีรูปอื่น) > รูปจากแคตตาล็อก > ไม่มี */
export function deleteCase(o: { count: number; isPrimary: boolean; fromCatalog: boolean }): DeleteCase {
  if (o.count <= 1) return "last";
  if (o.isPrimary) return "primary";
  if (o.fromCatalog) return "catalog";
  return "plain";
}

const CASE_TEXT: Record<DeleteCase, string | null> = {
  last: "ลบแล้วใบงานนี้จะไม่มีรูป ใบ A5 ที่พิมพ์ครั้งต่อไปจะไม่มีรูปหลัก",
  primary: "นี่คือรูปหลัก ลบแล้วรูปถัดไปจะเป็นรูปหลักแทน",
  catalog: "ลบจากใบงานนี้เท่านั้น — รูปในแคตตาล็อกไม่หาย",
  plain: null,
};

export function JobPhotoDeleteDialog({
  jobNo,
  count,
  isPrimary,
  fromCatalog,
  onConfirm,
  onCancel,
}: {
  jobNo: string;
  count: number;
  isPrimary: boolean;
  fromCatalog: boolean;
  /** คืน null = สำเร็จ (ผู้เรียกปิดกล่องเอง) · ข้อความ = ล้มเหลว (แสดงในกล่อง) */
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);

  // Modal ย้าย focus ไปที่แผงหลัง child effect — เลื่อนไปจังหวะถัดไปให้ "ยกเลิก" ได้ focus จริง
  useEffect(() => {
    const t = setTimeout(() => formRef.current?.querySelector<HTMLButtonElement>('button[type="button"]')?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm();
      if (err) setError(err);
    } catch {
      setError(GENERIC_JOB_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const line = CASE_TEXT[deleteCase({ count, isPrimary, fromCatalog })];
  return (
    <Modal open onClose={busy ? () => undefined : onCancel} title={`ลบรูปนี้ออกจากใบงาน ${jobNo}?`}>
      <form
        ref={formRef}
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {line && <p className="text-base text-zinc-900">{line}</p>}
        <p className="text-sm text-zinc-700">กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ</p>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready confirm="ลบรูป" onClose={onCancel} danger />
      </form>
    </Modal>
  );
}
