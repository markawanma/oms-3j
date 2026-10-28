"use client";

// ShopExitGuard — แผ่นยืนยันก่อนออกจากจอ (เสร็จแล้ว / เปิดอีกใบ / กลับ) ตอนยังมีรูปที่ส่งไม่ถึง server (UX §5.5)
// Modal เดิม (bottom sheet บนมือถือ) · focus เริ่มที่ปุ่มหลัก "กลับไปส่งรูปต่อ" · รูปที่ค้างหาย แต่ "ใบ" ไม่หาย (อยู่ใน "ใบที่ฉันเปิด")
// QR ใบงานหายถาวรจากจอ (ดูซ้ำไม่ได้ — ออก QR ใหม่ได้ที่ "ใบที่ฉันเปิด") จึงคงบรรทัด "QR ก็จะหาย" เมื่อ QR ยังอยู่บนจอ
// ล็อก (ช่างรับงานแล้ว) = ไม่มีทางส่งต่อ → ปุ่มหลักเปลี่ยนเป็น "ออกจากหน้านี้"

import { useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";

const PRIMARY = "inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary-600 px-5 text-xl font-bold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";
const SECONDARY = "inline-flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-zinc-400 bg-white px-5 text-xl font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";

export function ShopExitGuard({
  numbers,
  locked,
  hasQr,
  showKept,
  onStay,
  onLeave,
}: {
  /** ลำดับรูปที่ยังไม่ถึง server เช่น "3" หรือ "2, 3" */
  numbers: string;
  /** ช่างรับงานแล้ว — รูปที่เหลือส่งต่อไม่ได้ */
  locked: boolean;
  /** QR ใบงานยังอยู่บนจอ (ออกแล้วหายถาวร) */
  hasQr: boolean;
  /** บอกว่าใบยังอยู่ใน "ใบที่ฉันเปิด" (จอที่ไม่ใช่ W-10) */
  showKept: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  // Modal ย้าย focus ไปที่แผงหลัง child effect — เลื่อนไปจังหวะถัดไปให้ปุ่มหลักได้ focus จริง
  useEffect(() => {
    const t = setTimeout(() => (locked ? leaveRef.current : stayRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [locked]);

  return (
    <Modal open onClose={onStay} title={SHOP_PHOTO_TH.guardTitle}>
      <div className="space-y-3">
        {locked ? (
          <p className="text-lg text-zinc-900">{SHOP_PHOTO_TH.guardLocked}</p>
        ) : (
          <p className="text-lg text-zinc-900">
            {numbers ? `รูปที่ ${numbers} ยังไม่ได้ส่ง ถ้าออกตอนนี้รูปนั้นจะหาย` : "ยังมีรูปที่ยังไม่ได้ส่ง ถ้าออกตอนนี้รูปนั้นจะหาย"}
          </p>
        )}
        {hasQr && <p className="text-lg font-semibold text-amber-950">{SHOP_PHOTO_TH.guardQr}</p>}
        {showKept && !locked && <p className="text-base text-zinc-700">{SHOP_PHOTO_TH.guardKept}</p>}
        {locked ? (
          <button ref={leaveRef} type="button" onClick={onLeave} className={PRIMARY}>
            {SHOP_PHOTO_TH.guardLeaveLocked}
          </button>
        ) : (
          <>
            <button ref={stayRef} type="button" onClick={onStay} className={PRIMARY}>
              {SHOP_PHOTO_TH.guardStay}
            </button>
            <button ref={leaveRef} type="button" onClick={onLeave} className={SECONDARY}>
              {SHOP_PHOTO_TH.guardLeave}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
