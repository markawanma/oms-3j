"use client";

// RingViewer — กล่องดำของภาพแหวน 3D (สัญญาแบบ §15.3 ของ design-ring-builder.md ฉบับ D1: ไม่ fetch · ไม่รู้ราคา/ชื่อพลอย · ไม่เก็บ state การเลือก · ไม่โหลดอะไรจากโดเมนอื่น)
// lazy-load โดย RingStage หลังตรวจ WebGL แล้ว (import แบบ dynamic) — ไฟล์นี้จึงไม่ถูกดึงเข้า bundle แรกของหน้า
// 🔴 D1.2 (Z9): ไฟล์เดียวที่ import showcase-rings (→ row-ring/row-presets) — builder แบบแถวทั้งหมดอยู่ใน chunk lazy นี้ ไม่เข้า first-load
// รับ designId + รหัสพลอยหลัก/เสริม (null = CZ ขาว) · สลับแบบ = renderer.setRing() บน WebGL context เดิม (ไม่ remount → ไม่สร้าง context ใหม่ ไม่กระพริบ)
// ผิดพลาด/ context lost → เรียก onUnsupported ให้ UI สลับเป็นรูปจริง/ภาพประกอบ · สร้างโมเดลของแบบนั้นไม่ได้ → onDesignFailed(id) (stage แสดง fallback + ปุ่มลองอีกครั้ง)
import { useEffect, useRef } from "react";
import { designTints, slotTints } from "@/lib/ring-builder/viewer/gem-colors";
import { createRingRenderer, type RingRenderer, type UnsupportedReason } from "@/lib/ring-builder/viewer/gl-renderer";
import { getShowcaseRing } from "@/lib/ring-builder/viewer/showcase-rings";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import type { SlotCode } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import type { ViewerRing } from "@/lib/ring-builder/viewer/ring-types";

export interface RingViewerProps {
  designId: ShowcaseDesignId;
  /** พลอยหลัก (null = CZ ขาว) */
  top: GemQuizStoneCode | null;
  /** พลอยเสริม (null = CZ ขาว) */
  bottom: GemQuizStoneCode | null;
  /** D1.2a: สีรายเม็ดของแบบแถว (ซ้าย→ขวา) — มีค่า = ใช้แทน top/bottom · จำนวนไม่ตรงแบบ = CZ ขาว (ไม่ crash) */
  slots?: readonly SlotCode[] | null;
  /** สรุปพลอยปัจจุบันสำหรับ screen reader */
  ariaLabel: string;
  onReady?: () => void;
  onUnsupported?: (reason: UnsupportedReason) => void;
  /** สร้าง/อัปโหลดโมเดลของแบบนี้ไม่ได้ (stage แสดง fallback ของแบบนั้น) */
  onDesignFailed?: (id: ShowcaseDesignId) => void;
  /** ปุ่ม "กลับมุมหน้า" — แสดงเฉพาะเมื่อ stage อยู่ในโหมด ready (ซ่อนตอนโหลด/context lost · หนี้ D2-6) · ค่าเริ่มต้น false */
  showReset?: boolean;
}

function tintsFor(designId: ShowcaseDesignId, top: GemQuizStoneCode | null, bottom: GemQuizStoneCode | null, slots: readonly SlotCode[] | null | undefined) {
  return slots ? slotTints(designId, slots) : designTints(designId, top, bottom);
}

export default function RingViewer({ designId, top, bottom, slots, ariaLabel, onReady, onUnsupported, onDesignFailed, showReset = false }: RingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<RingRenderer | null>(null);
  // แบบที่ renderer ถือโมเดลอยู่ตอนนี้ — ใช้ข้ามการ setRing ซ้ำตอน mount (effect ตามหลังการสร้าง)
  const shownDesign = useRef<ShowcaseDesignId | null>(null);
  // ค่าล่าสุดของ props ที่ effect ตอน mount ต้องใช้ โดยไม่ให้ตัววาดถูกสร้างใหม่ทุกครั้งที่สีเปลี่ยน
  const latest = useRef({ designId, top, bottom, slots, onReady, onUnsupported, onDesignFailed });
  latest.current = { designId, top, bottom, slots, onReady, onUnsupported, onDesignFailed };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: RingRenderer | null = null;
    const startId = latest.current.designId;
    let ring: ViewerRing;
    try {
      ring = getShowcaseRing(startId);
    } catch {
      // โมเดลของแบบนี้สร้างไม่ได้ — ไม่ใช่ปัญหา WebGL: stage แสดง fallback ของแบบนั้น + ปุ่ม "ลองอีกครั้ง" (remount)
      latest.current.onDesignFailed?.(startId);
      return;
    }
    try {
      renderer = createRingRenderer(canvas, ring, {
        autoRotate: false, // TL 12 พ.ย.: ไม่หมุนเอง — หมุนแล้วพลอยหันหนีตอนลูกค้ากำลังเลือกชุดพลอย (ลากหมุนเองได้)
        reducedMotion,
        onReady: () => latest.current.onReady?.(),
        onUnsupported: (reason) => latest.current.onUnsupported?.(reason),
      });
      renderer.setTints(tintsFor(startId, latest.current.top, latest.current.bottom, latest.current.slots));
      rendererRef.current = renderer;
      shownDesign.current = startId;
    } catch {
      // WebGL/shader ล้ม (สร้าง context ไม่ได้ · shader V1 ก็ไม่ผ่าน)
      renderer?.dispose();
      renderer = null;
      latest.current.onUnsupported?.("no_webgl");
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
      shownDesign.current = null;
    };
  }, []);

  // สลับแบบ: สร้างโมเดล (cache) → setRing → ตั้งสีใหม่ · พัง = แจ้ง stage (ภาพเดิมถูกบังด้วย fallback ของแบบใหม่)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || shownDesign.current === designId) return;
    try {
      r.setRing(getShowcaseRing(designId));
      shownDesign.current = designId;
      r.setTints(tintsFor(designId, latest.current.top, latest.current.bottom, latest.current.slots));
    } catch {
      latest.current.onDesignFailed?.(designId);
    }
  }, [designId]);

  const slotsKey = slots ? slots.join(".") : "";
  useEffect(() => {
    // แบบที่ยังไม่ถูกแสดง (สลับล้มเหลว) ไม่ตั้งสี — กันความยาว tints ไม่ตรงกับโมเดลที่ถืออยู่
    if (shownDesign.current !== designId) return;
    try {
      rendererRef.current?.setTints(tintsFor(designId, top, bottom, latest.current.slots));
    } catch {
      latest.current.onDesignFailed?.(designId);
    }
  }, [designId, top, bottom, slotsKey]);

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
      {showReset && (
        <button
          type="button"
          onClick={() => rendererRef.current?.resetView()}
          className="absolute bottom-2.5 left-2.5 z-10 inline-flex min-h-11 items-center rounded-full border border-[var(--gq-border)] bg-white/90 px-4 text-sm font-medium text-[var(--gq-text)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {SHOWCASE_COPY.resetView}
        </button>
      )}
    </>
  );
}
