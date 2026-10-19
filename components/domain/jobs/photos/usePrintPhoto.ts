"use client";

// usePrintPhoto — สถานะรูปหลักบนหน้าพิมพ์ (ชั้นแสดงผลล้วน): none → ไม่มีรูป · loading → รอรูปโหลด · ready → พิมพ์ได้ · failed → ตัดรูปออกแล้วพิมพ์ (ไม่พิมพ์กรอบว่าง/ไอคอนรูปแตก)
// รอสูงสุด PRINT_PHOTO_TIMEOUT_MS แล้วถือว่าล้ม (ลิงก์หมดอายุ/ไม่มีเน็ต) · ต่อ URL — URL เปลี่ยน = นับใหม่

import { useCallback, useEffect, useState } from "react";

export const PRINT_PHOTO_TIMEOUT_MS = 8000;
export type PrintPhotoStatus = "none" | "loading" | "ready" | "failed";

export function usePrintPhoto(url: string | null): { status: PrintPhotoStatus; onLoad: () => void; onError: () => void } {
  const [res, setRes] = useState<{ url: string | null; s: "ready" | "failed" } | null>(null);
  const settled = res !== null && res.url === url ? res.s : null;

  useEffect(() => {
    if (!url || settled) return;
    const t = setTimeout(() => setRes({ url, s: "failed" }), PRINT_PHOTO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [url, settled]);

  const onLoad = useCallback(() => setRes((r) => (r && r.url === url && r.s === "failed" ? r : { url, s: "ready" })), [url]);
  const onError = useCallback(() => setRes({ url, s: "failed" }), [url]);

  const status: PrintPhotoStatus = !url ? "none" : (settled ?? "loading");
  return { status, onLoad, onError };
}
