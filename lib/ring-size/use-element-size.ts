"use client";

// lib/ring-size/use-element-size.ts — วัดขนาดจริง (CSS px) ขององค์ประกอบด้วย getBoundingClientRect
//
// ใช้กับเวทีวัด: viewBox ของ SVG ต้องเท่ากับขนาดที่วัดจริง (1 หน่วย SVG = 1 CSS px) — ห้ามใช้ viewBox
// คงที่แล้ว width:100% (สเกลเพี้ยน = ค่าเทียบเพี้ยน) · ไม่ปัดเศษ
// ResizeObserver เมื่อมี · ไม่มี (webview เก่า/jsdom) = ฟัง window resize แทน · วัดครั้งแรกใน effect เสมอ
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

export function useElementSize<T extends HTMLElement>(): { ref: RefObject<T>; size: ElementSize | null } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return;
    setSize((prev) => (prev && prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    window.addEventListener("resize", measure);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
    };
  }, [measure]);

  return { ref, size };
}
