"use client";

// RingViewer — กล่องดำของภาพแหวน 3D (สัญญาแบบ §15.3 ของ design-ring-builder.md ฉบับ D1: ไม่ fetch · ไม่รู้ราคา/ชื่อพลอย · ไม่เก็บ state การเลือก · ไม่โหลดอะไรจากโดเมนอื่น)
// lazy-load โดย RingStage หลังตรวจ WebGL แล้ว (import แบบ dynamic) — ไฟล์นี้จึงไม่ถูกดึงเข้า bundle แรกของหน้า
// รับแค่รหัสพลอยบน/ล่าง (null = CZ ขาว) · ผิดพลาด/ context lost → เรียก onUnsupported ให้ UI สลับเป็นรูปจริง
import { useEffect, useRef } from "react";
import { buildBypassRing, type BypassRing } from "@/lib/ring-builder/viewer/bypass-ring";
import { ringTints } from "@/lib/ring-builder/viewer/gem-colors";
import { createRingRenderer, type RingRenderer, type UnsupportedReason } from "@/lib/ring-builder/viewer/gl-renderer";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";

export interface RingViewerProps {
  top: GemQuizStoneCode | null;
  bottom: GemQuizStoneCode | null;
  /** สรุปพลอยปัจจุบันสำหรับ screen reader */
  ariaLabel: string;
  onReady?: () => void;
  onUnsupported?: (reason: UnsupportedReason) => void;
}

export default function RingViewer({ top, bottom, ariaLabel, onReady, onUnsupported }: RingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RingRenderer | null>(null);
  // ค่าล่าสุดของ props ที่ effect ตอน mount ต้องใช้ โดยไม่ให้ตัววาดถูกสร้างใหม่ทุกครั้งที่สีเปลี่ยน
  const latest = useRef({ top, bottom, onReady, onUnsupported });
  latest.current = { top, bottom, onReady, onUnsupported };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: RingRenderer | null = null;
    try {
      const ring: BypassRing = buildBypassRing();
      renderer = createRingRenderer(canvas, ring, {
        autoRotate: true,
        reducedMotion,
        onReady: () => latest.current.onReady?.(),
        onUnsupported: (reason) => latest.current.onUnsupported?.(reason),
      });
      renderer.setTints(ringTints(latest.current.top, latest.current.bottom));
      rendererRef.current = renderer;
    } catch {
      latest.current.onUnsupported?.("no_webgl");
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setTints(ringTints(top, bottom));
  }, [top, bottom]);

  return (
    <>
      {/* touch-pan-y: ลากแนวนอนหมุนแหวน · ลากแนวตั้งยังเลื่อนหน้าได้ (ห้าม touch-action:none ทั้งเวที) */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="absolute inset-0 h-full w-full cursor-grab touch-pan-y focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--gq-burgundy)] active:cursor-grabbing"
      />
      <button
        type="button"
        onClick={() => rendererRef.current?.resetView()}
        className="absolute bottom-2.5 left-2.5 z-10 inline-flex min-h-11 items-center rounded-full border border-[var(--gq-border)] bg-white/90 px-4 text-sm font-medium text-[var(--gq-text)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        {SHOWCASE_COPY.resetView}
      </button>
    </>
  );
}
