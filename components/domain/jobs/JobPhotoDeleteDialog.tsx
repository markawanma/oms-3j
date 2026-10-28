"use client";

// JobPhotoDeleteDialog — ยืนยันลบรูปใบงาน (ux §3.4) · Modal เดิม (bottom sheet บนมือถือ) · ปุ่มเรียงเหมือน dialog อื่นของหน้าใบงาน (DialogButtons)
// focus เริ่มที่ "ยกเลิก" (กันกด Enter ลบโดยพลั้ง) · เนื้อความเลือกบรรทัดเดียวที่เกี่ยวที่สุด + ต่อท้าย "กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ" (มติ จ5)
// ล้มเหลว = ข้อความในกล่อง คงกล่องไว้ให้กดซ้ำ (ไม่ปิดเอง) · ผลสำเร็จ = ผู้เรียกปิดกล่อง
// 0189 W2: requireReason = ลบรูป "จากหน้างาน" (ผู้จัดการส่งมา) บังคับเหตุผล (มติเจ้าของ 21 ต.ค.) — ชิปเหตุผล + ช่องพิมพ์ ≤ 300 + ปุ่มลบ aria-disabled จนมีเหตุผลจริง (whitelist ตัวอักษร/ตัวเลข)
// ไม่ส่ง requireReason = เหมือนเดิมเป๊ะ (รูปออฟฟิศ/แคตตาล็อกไม่บังคับเหตุผล — ไม่เปลี่ยนพฤติกรรมที่ใช้อยู่)

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DialogButtons, ErrorLine } from "@/components/domain/jobs/JobDialogs";
import { JOB_PHOTO_REASON_MAX } from "@/lib/images/constants";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { MSG_REASON_REQUIRED, SHOP_PHOTO_DELETE_REASON_CHIPS, photoReasonIssue } from "@/lib/jobs/photo-reason";

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

/** เหตุผลบรรทัดเดียว (ขึ้นบรรทัดใหม่ → ช่องว่าง) — ส่งเข้า action ที่ตัดช่องว่างหัวท้ายให้ */
const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ");

export function JobPhotoDeleteDialog({
  jobNo,
  count,
  isPrimary,
  fromCatalog,
  requireReason = false,
  onConfirm,
  onCancel,
}: {
  jobNo: string;
  count: number;
  isPrimary: boolean;
  fromCatalog: boolean;
  /** รูปจากหน้างาน (ผู้จัดการส่ง) — ต้องใส่เหตุผลก่อนลบ */
  requireReason?: boolean;
  /** คืน null = สำเร็จ (ผู้เรียกปิดกล่องเอง) · ข้อความ = ล้มเหลว (แสดงในกล่อง) · reason = เหตุผลที่ตรวจแล้ว (null เมื่อไม่ requireReason) */
  onConfirm: (reason: string | null) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);

  // Modal ย้าย focus ไปที่แผงหลัง child effect — เลื่อนไปจังหวะถัดไปให้ "ยกเลิก" ได้ focus จริง
  useEffect(() => {
    const t = setTimeout(() => (cancelRef.current ?? formRef.current?.querySelector<HTMLButtonElement>('button[type="button"]'))?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const reasonIssue = requireReason ? photoReasonIssue(reason) : null;
  const ready = !requireReason || reasonIssue === null;

  async function submit() {
    if (inFlight.current) return;
    if (!ready) {
      setTried(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm(requireReason ? oneLine(reason).trim() : null);
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
        {requireReason ? (
          <p className="text-sm text-zinc-700">รูปนี้ผู้จัดการส่งจากหน้างาน · ลบแล้วกู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบและเพราะอะไร</p>
        ) : (
          <p className="text-sm text-zinc-700">กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ</p>
        )}
        {requireReason && (
          <div className="space-y-2">
            <label htmlFor="photo-delete-reason" className="block text-sm font-semibold text-zinc-900">
              เหตุผล (บังคับ)
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="เหตุผลที่ใช้บ่อย">
              {SHOP_PHOTO_DELETE_REASON_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={oneLine(reason).trim() === c}
                  disabled={busy}
                  onClick={() => setReason(c)}
                  className={`min-h-9 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 ${oneLine(reason).trim() === c ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            <textarea
              id="photo-delete-reason"
              rows={3}
              maxLength={JOB_PHOTO_REASON_MAX}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(oneLine(e.target.value))}
              aria-describedby="photo-delete-reason-hint photo-delete-reason-count"
              aria-invalid={tried && !ready ? true : undefined}
              className="w-full rounded-md border border-zinc-300 p-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50"
            />
            <div className="flex items-start justify-between gap-2">
              <p id="photo-delete-reason-hint" className={`text-sm ${tried && !ready ? "font-semibold text-red-700" : "text-zinc-600"}`}>
                {!ready ? (reasonIssue ?? MSG_REASON_REQUIRED) : " "}
              </p>
              <p id="photo-delete-reason-count" className="shrink-0 text-sm tabular-nums text-zinc-600">
                {[...reason].length}/{JOB_PHOTO_REASON_MAX}
              </p>
            </div>
          </div>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} softDisabled={requireReason} confirm="ลบรูป" onClose={onCancel} danger cancelRef={cancelRef} />
      </form>
    </Modal>
  );
}
