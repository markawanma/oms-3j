"use client";

// ShopPhotoRejections — แถวแจ้ง "ไฟล์เปิดไม่ได้" (HEIC/เสีย/ใหญ่) เหนือกริด/แถวรูป — ไม่กินช่อง ไม่บล็อกขั้น (UX §3.3 · D4)
// role="alert" พื้น red-50 ขอบ red-700 · ข้อความ ≥ 16px · [ปิด] ≥ 44px · ขึ้นสูงสุด 3 แถว (ใหม่สุดก่อน — hook ตัดให้แล้ว)
// + แถบ amber role="status" เมื่อเลือกเกินที่เหลือ (ไม่ใช่ error)

import { X } from "lucide-react";
import type { ShopPhotoRejection } from "@/components/domain/jobs/worker/shop/useShopPhotos";

export function ShopPhotoRejections({ rejections, notice, onDismiss }: { rejections: readonly ShopPhotoRejection[]; notice: string | null; onDismiss: (id: string) => void }) {
  if (rejections.length === 0 && !notice) return null;
  return (
    <div className="space-y-2">
      {rejections.map((r) => (
        <div key={r.id} role="alert" className="flex items-start gap-2 rounded-xl border-2 border-red-700 bg-red-50 p-3 text-red-900">
          <p className="min-w-0 flex-1 text-base font-semibold break-words">{r.text}</p>
          <button type="button" onClick={() => onDismiss(r.id)} aria-label="ปิดข้อความนี้" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {notice && (
        <p role="status" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-950">
          {notice}
        </p>
      )}
    </div>
  );
}
