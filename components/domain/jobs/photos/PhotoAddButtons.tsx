"use client";

// PhotoAddButtons — ปุ่มเพิ่มรูป (ชั้นแสดงผลล้วน — คืน File[] ให้ผู้เรียก ไม่ย่อ/ไม่ส่งเอง)
// อุปกรณ์สัมผัส (pointer: coarse) = 2 ปุ่ม 56px "ถ่ายรูป" (กล้องหลัง ครั้งละ 1) + "เลือกจากเครื่อง" (หลายไฟล์) · เมาส์ = ปุ่มเดียว "เพิ่มรูป"
// สลับด้วย CSS ล้วน (ไม่ตรวจใน JS — กัน hydration mismatch) · ไม่ตรวจว่ากล้องถูกปฏิเสธ (ux D5) · ทั้งสองปุ่มเท่ากันเสมอ

import { useRef } from "react";
import type { ChangeEvent } from "react";
import { Camera, ImagePlus, Plus } from "lucide-react";

const COARSE_ONLY = "hidden [@media(pointer:coarse)]:grid";
const FINE_ONLY = "[@media(pointer:coarse)]:hidden";
const BIG = "min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-zinc-900 bg-white px-3 font-bold text-zinc-900 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:cursor-not-allowed disabled:opacity-50";

// 0189 W2: variant="worker" = ตัวหนังสือขนาดหน้าช่าง (text-lg ≥ 18px) · libraryLabel = ป้ายปุ่มเลือกไฟล์ ("เลือกจากคลัง" บนมือถือผู้จัดการ) — ไม่ส่ง = ของเดิมเป๊ะ (ออฟฟิศ)
export function PhotoAddButtons({
  onFiles,
  disabled = false,
  variant = "office",
  libraryLabel = "เลือกจากเครื่อง",
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  variant?: "office" | "worker";
  libraryLabel?: string;
}) {
  const text = variant === "worker" ? "text-lg" : "text-base";
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? [...e.target.files] : [];
    // เลือกไฟล์เดิมซ้ำได้ภายหลัง
    e.target.value = "";
    if (list.length > 0) onFiles(list);
  }

  return (
    <div>
      <input ref={pickRef} data-testid="photo-input-pick" type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" disabled={disabled} onChange={onChange} />
      <input ref={camRef} data-testid="photo-input-camera" type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={disabled} onChange={onChange} />
      <div className={`${COARSE_ONLY} grid-cols-2 gap-2`}>
        <button type="button" disabled={disabled} onClick={() => camRef.current?.click()} className={`${BIG} ${text} flex`}>
          <Camera className="h-5 w-5" aria-hidden="true" />
          ถ่ายรูป
        </button>
        <button type="button" disabled={disabled} onClick={() => pickRef.current?.click()} className={`${BIG} ${text} flex`}>
          <ImagePlus className="h-5 w-5" aria-hidden="true" />
          {libraryLabel}
        </button>
      </div>
      <button type="button" disabled={disabled} onClick={() => pickRef.current?.click()} className={`${SMALL} ${text} ${FINE_ONLY}`}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        เพิ่มรูป
      </button>
    </div>
  );
}
