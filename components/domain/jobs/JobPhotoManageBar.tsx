"use client";

// JobPhotoManageBar — แถบจัดการใต้รูปใน viewer (ออฟฟิศเท่านั้น): ตั้งรูปหลัก · เลื่อนก่อน/หลัง · ลบ (ยืนยันที่ JobPhotoDeleteDialog)
// รูปหลัก = รูปแรกเสมอ (DB: is_primary เป็น flag · loader เรียงรูปหลักก่อน) → เลื่อนได้เฉพาะรูปอื่นที่อยู่หลังรูปหลัก · อยากให้ไปหน้าสุด = ตั้งเป็นรูปหลัก
// ไม่เรียก action เอง (ผู้เรียกส่ง callback) · ปุ่ม 56px บนมือถือ / 44px บน PC

import { ChevronLeft, ChevronRight, Star, Trash2 } from "lucide-react";

const BTN = "inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border px-4 text-base font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-11";
const NEUTRAL = `${BTN} border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-50`;

export function JobPhotoManageBar({
  isPrimary,
  canMoveBefore,
  canMoveAfter,
  busy,
  onSetPrimary,
  onMove,
  onDelete,
}: {
  isPrimary: boolean;
  canMoveBefore: boolean;
  canMoveAfter: boolean;
  busy: boolean;
  onSetPrimary: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2" role="group" aria-label="จัดการรูปนี้">
      <button type="button" onClick={onSetPrimary} disabled={isPrimary || busy} className={`${NEUTRAL} w-full`}>
        <Star className="h-5 w-5" aria-hidden="true" />
        {isPrimary ? "เป็นรูปหลักอยู่แล้ว" : "ตั้งเป็นรูปหลัก"}
      </button>
      {isPrimary ? (
        <p className="text-sm text-zinc-700">รูปหลักอยู่ลำดับแรกเสมอ — ไม่ต้องเลื่อน</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onMove(-1)} disabled={!canMoveBefore || busy} className={NEUTRAL}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            เลื่อนก่อน
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!canMoveAfter || busy} className={NEUTRAL}>
            เลื่อนหลัง
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      )}
      <button type="button" onClick={onDelete} disabled={busy} className={`${BTN} w-full border-red-700 bg-white text-red-800 hover:bg-red-50`}>
        <Trash2 className="h-5 w-5" aria-hidden="true" />
        ลบรูปนี้
      </button>
    </div>
  );
}
