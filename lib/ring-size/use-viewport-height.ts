"use client";

// lib/ring-size/use-viewport-height.ts — ความสูงที่เห็นจริง (px) สำหรับ G2 / clamp
//
// ฟัง visualViewport.resize (แถบ Safari หด/ขยาย · หมุนจอ · คีย์บอร์ด) และ window.resize
// คืน null จนกว่าจะวัดใน effect (ไม่อ่าน window ตอน render — กัน hydration mismatch)
import { useEffect, useState } from "react";

export function readViewportHeight(): number | null {
  if (typeof window === "undefined") return null;
  const vv = window.visualViewport;
  const h = vv && Number.isFinite(vv.height) && vv.height > 0 ? vv.height : window.innerHeight;
  return Number.isFinite(h) && h > 0 ? h : null;
}

export function useViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setH(readViewportHeight());
    update();
    window.addEventListener("resize", update);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
    };
  }, []);
  return h;
}
