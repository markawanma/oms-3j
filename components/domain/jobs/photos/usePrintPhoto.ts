"use client";

// usePrintPhoto — สถานะรูปหลักบนหน้าพิมพ์ (ชั้นแสดงผลล้วน): none → ไม่มีรูป · loading → รอรูปโหลด · ready → พิมพ์ได้ · failed → ตัดรูปออกแล้วพิมพ์ (ไม่พิมพ์กรอบว่าง/ไอคอนรูปแตก)
// รอสูงสุด PRINT_PHOTO_TIMEOUT_MS แล้วถือว่าล้ม (ลิงก์หมดอายุ/ไม่มีเน็ต) · ต่อ URL — URL เปลี่ยน = นับใหม่
// B1: รูปที่โหลดเสร็จ (หรือพัง) ก่อน hydrate → onLoad/onError ไม่ยิง (ยังไม่มี handler) → ตรวจ complete/naturalWidth ของ <img> ตอน mount (imgRef → PrintPhoto)
//     ไม่งั้นรอจนครบ 8 วินาทีแล้วตัดรูปที่โหลดสำเร็จไปแล้วทิ้ง · pattern เดียวกับ JobPhotoThumb

import { useCallback, useEffect, useRef, useState } from "react";

export const PRINT_PHOTO_TIMEOUT_MS = 8000;
export type PrintPhotoStatus = "none" | "loading" | "ready" | "failed";

export function usePrintPhoto(url: string | null): { status: PrintPhotoStatus; onLoad: () => void; onError: () => void; imgRef: React.RefObject<HTMLImageElement> } {
  const [res, setRes] = useState<{ url: string | null; s: "ready" | "failed" } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const settled = res !== null && res.url === url ? res.s : null;

  useEffect(() => {
    if (!url || settled) return;
    const t = setTimeout(() => setRes({ url, s: "failed" }), PRINT_PHOTO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [url, settled]);

  // เบราว์เซอร์ตัดสินไปแล้ว (complete) แต่ React ยังไม่เคยได้ event → อ่านผลจากตัวรูปเอง: naturalWidth > 0 = โหลดสำเร็จ · 0 = พัง
  useEffect(() => {
    const el = imgRef.current;
    if (!url || settled || !el || !el.complete) return;
    setRes({ url, s: el.naturalWidth > 0 ? "ready" : "failed" });
  }, [url, settled]);

  const onLoad = useCallback(() => setRes((r) => (r && r.url === url && r.s === "failed" ? r : { url, s: "ready" })), [url]);
  const onError = useCallback(() => setRes({ url, s: "failed" }), [url]);

  const status: PrintPhotoStatus = !url ? "none" : (settled ?? "loading");
  return { status, onLoad, onError, imgRef };
}
