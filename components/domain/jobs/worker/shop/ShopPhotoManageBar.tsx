"use client";

// ShopPhotoManageBar — แถบจัดการใต้รูปใน viewer (มือถือผู้จัดการ): ★ ตั้งเป็นรูปหลัก · เอารูปออก/ลบรูป
// ไม่เรียก action เอง (ผู้เรียกส่ง callback) · ปุ่ม 56px ตัวหนังสือ ≥ 18px · ไม่มีปุ่มเลื่อน (≤ 3 รูป ใช้ ★ ตัวเดียว)
// รูปที่ยังไม่ถึง server = "เอารูปนี้ออก" (ไม่ถามยืนยัน ถ่ายใหม่ได้ทันที) · รูปที่ส่งแล้ว = "ลบรูปนี้" (ผู้เรียกถามยืนยันก่อน — กู้ไม่ได้)
// รูปที่ส่งแล้วตั้งรูปหลักไม่ได้เมื่อไม่มี action (canSetPrimary=false) — ซ่อนปุ่ม ไม่โชว์ปุ่มที่กดแล้วไม่ทำอะไร

import { Star, Trash2 } from "lucide-react";
import { SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";

const BTN = "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 px-4 text-lg font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50";

export function ShopPhotoManageBar({
  isPrimary,
  sent,
  canSetPrimary,
  busy,
  onSetPrimary,
  onRemove,
}: {
  isPrimary: boolean;
  /** ถึง server แล้ว */
  sent: boolean;
  canSetPrimary: boolean;
  busy: boolean;
  onSetPrimary: () => void;
  onRemove: () => void;
}) {
  const showStar = !sent || canSetPrimary;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-2" role="group" aria-label="จัดการรูปนี้">
      {showStar && (
        <button type="button" onClick={onSetPrimary} disabled={isPrimary || busy} className={`${BTN} border-zinc-900 bg-white text-zinc-900`}>
          <Star className="h-5 w-5" aria-hidden="true" />
          {isPrimary ? SHOP_PHOTO_TH.isPrimaryNow : SHOP_PHOTO_TH.setPrimary}
        </button>
      )}
      <button type="button" onClick={onRemove} disabled={busy} className={`${BTN} border-red-700 bg-white text-red-800`}>
        <Trash2 className="h-5 w-5" aria-hidden="true" />
        {sent ? SHOP_PHOTO_TH.removeSent : SHOP_PHOTO_TH.removeDraft}
      </button>
    </div>
  );
}
