"use client";

// JobPhotoUploadTile — ช่องรูปที่ "ยังไม่เป็นรูปของใบ" (ระหว่างย่อ/ส่ง/ส่งล้ม) · ux §3.2
// ไม่พึ่งสีอย่างเดียว: กำลังส่ง = แถบ + คำ · ล้ม = ⚠ + ข้อความ · ล้มที่ลองใหม่ได้ = แตะช่อง ส่งใหม่ · ล้มที่ลองใหม่ไม่ช่วย = ข้อความ + ปุ่ม "เอาออก"
// เอาออก = ยังไม่ถึง server (ไม่ต้องยืนยัน) · แถบความคืบหน้าเป็น indeterminate (server action ไม่วัด %)

import { AlertTriangle, Loader2, X } from "lucide-react";
import type { UploadItem } from "@/components/domain/jobs/useJobPhotoUploads";

const BASE = "relative aspect-square overflow-hidden rounded-lg";

export function JobPhotoUploadTile({ item, onRetry, onRemove }: { item: UploadItem; onRetry: () => void; onRemove: () => void }) {
  if (item.phase === "queued" || item.phase === "resizing") {
    return (
      <div aria-busy="true" aria-label={item.phase === "queued" ? "รอคิวส่งรูป" : "กำลังย่อรูป"} role="group" className={`${BASE} flex flex-col items-center justify-center gap-1 bg-zinc-200 text-zinc-800`}>
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="text-xs font-bold">{item.phase === "queued" ? "รอคิว…" : "กำลังย่อรูป…"}</span>
      </div>
    );
  }

  if (item.phase === "uploading") {
    return (
      <div aria-busy="true" aria-label="กำลังส่งรูป" role="group" className={`${BASE} bg-zinc-200`}>
        {item.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL ของรูปที่ย่อแล้วในเครื่อง
          <img src={item.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-white/90 p-2">
          <p className="text-xs font-bold text-zinc-900">กำลังส่ง</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-300" aria-hidden="true">
            <div className="h-full w-1/2 animate-pulse rounded bg-zinc-900" />
          </div>
        </div>
      </div>
    );
  }

  const box = `${BASE} border-2 border-red-700 bg-red-50 text-red-900`;
  const body = (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center ${item.retryable ? "pt-6" : "pb-12 pt-2"}`}>
      <AlertTriangle className="h-6 w-6 shrink-0" aria-hidden="true" />
      <span className="text-xs font-bold leading-tight">{item.retryable ? "ส่งไม่สำเร็จ · แตะลองใหม่" : "ส่งไม่สำเร็จ"}</span>
      {item.message && <span className="line-clamp-3 break-words text-xs leading-tight">{item.message}</span>}
    </div>
  );

  if (item.retryable) {
    return (
      <div className={box}>
        <button type="button" onClick={onRetry} aria-label="ส่งรูปไม่สำเร็จ แตะเพื่อลองใหม่" className="absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
          {body}
        </button>
        <button type="button" onClick={onRemove} aria-label="เอารูปนี้ออก" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-bl-lg bg-white text-red-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={box}>
      {body}
      <button type="button" onClick={onRemove} className="absolute inset-x-1 bottom-1 min-h-11 rounded bg-white text-sm font-bold text-red-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
        เอาออก
      </button>
    </div>
  );
}
