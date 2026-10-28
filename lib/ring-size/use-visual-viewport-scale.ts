"use client";

// lib/ring-size/use-visual-viewport-scale.ts — G1: ตรวจว่าหน้าถูก "pinch-zoom" อยู่ตอนนี้
//
// visualViewport.scale ≠ 1 (เกิน ±1%) = px/มม. ที่เห็นบนจอเพี้ยน → บล็อกปุ่มยืนยันของจอวัด
// ไม่ปิด pinch-zoom ทั้งหน้า (ขัดการเข้าถึง + iOS ไม่ทำตาม) — ตรวจแล้วแจ้งแทน
// ⚠️ ขอบเขต: visualViewport.scale จับได้เฉพาะ pinch-zoom · ซูมแบบเปลี่ยนเลย์เอาต์ (browser zoom / Safari "aA" page zoom)
//    ไม่เปลี่ยน scale — ครอบด้วย G5 แทน (dpr + portraitWidth ใน calibration.ts เทียบกับค่าที่เทียบไว้)
// ไม่มี visualViewport (เบราว์เซอร์เก่า/webview) = ถือว่าไม่ซูม · state เริ่ม false เพื่อให้ตรงกับ SSR
import { useEffect, useState } from "react";

export const ZOOM_TOLERANCE = 0.01;

export function isZoomed(scale: number | undefined | null): boolean {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return false;
  return Math.abs(scale - 1) > ZOOM_TOLERANCE;
}

export function useVisualViewportZoomed(): boolean {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setZoomed(isZoomed(vv.scale));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return zoomed;
}
