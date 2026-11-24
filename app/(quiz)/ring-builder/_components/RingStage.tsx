"use client";

// RingStage — เวทีแสดงแหวน: ตรวจ WebGL → lazy-load RingViewer → ไม่ได้/ล้ม = รูปจริงของ "แบบนั้น" แทน (ไม่มีรูป = ภาพประกอบตำแหน่งเม็ด) (ตัวเลือกด้านล่างยังใช้ได้ทุก state)
// 4 state ตาม UX §4/§5/§6: checking/loading (รูปเบลอ หรือ pictogram จาง + "กำลังโหลด…") · ready (canvas) · unsupported · lost (กู้คืนได้เอง) + designFailed (โมเดลของแบบนี้สร้างไม่ได้ → ปุ่ม "ลองอีกครั้ง")
// 🔴 D1.2 (Z6): รูปถ่ายแสดงเฉพาะแบบที่มีรูปจริงของแบบนั้น — photo เป็น optional · ไม่มีรูป = pictogram + ป้าย "ไม่ใช่ภาพจริง" ห้ามเอารูปแบบอื่นแทนในทุก state
// สลับแบบ = viewer.setRing() บน context เดิม (sync · ไม่มีช่วงรอให้เห็น) จึงไม่มี state "กำลังโหลดแบบ …" — เฟรมเก่าไม่ค้าง (design §2 Bundle)
import { useCallback, useEffect, useState, type ComponentType } from "react";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import type { SlotCode } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseDesign, ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { isWebGLAvailable, type CaptureFrontFn } from "@/lib/ring-builder/viewer/gl-renderer";
import type { RingViewerProps } from "./RingViewer";
import type { ShowcasePhoto } from "../_assets";
import { DesignPictogram } from "./DesignPictogram";

type StageMode = "checking" | "loading" | "ready" | "unsupported" | "lost";

/** สถานะที่ผู้ใช้ภายนอกต้องรู้ (ปุ่ม "บันทึกรูป"): ready = จับภาพได้ · waiting = ชั่วคราว (checking/loading/lost/designFailed) · unsupported = ถาวร (ไม่มี WebGL/โหลด chunk ไม่ได้) */
export type StageCaptureStatus = "waiting" | "ready" | "unsupported";

export function RingStage({
  design,
  top,
  bottom,
  slots,
  ariaLabel,
  photo,
  photoAlt,
  onCaptureReady,
  onStageStatus,
}: {
  design: ShowcaseDesign;
  top: GemQuizStoneCode | null;
  bottom: GemQuizStoneCode | null;
  /** D1.2a: สีรายเม็ด (แบบแถว · โหมดเลือกเองที่เลือกครบแล้ว) */
  slots?: readonly SlotCode[] | null;
  ariaLabel: string;
  /** รูปจริงของแบบนี้ (undefined = ยังไม่มีรูปถ่ายจริง) */
  photo?: ShowcasePhoto;
  photoAlt: string;
  /** ฟังก์ชันจับภาพมุมหน้า — มีค่าเฉพาะเมื่อเวที ready (ไม่ใช่ designFailed) · null ทุกกรณีอื่น · callback ควรคงที่ (useCallback) */
  onCaptureReady?: (capture: CaptureFrontFn | null) => void;
  onStageStatus?: (status: StageCaptureStatus) => void;
}) {
  const [mode, setMode] = useState<StageMode>("checking");
  const [Viewer, setViewer] = useState<ComponentType<RingViewerProps> | null>(null);
  const [failedDesign, setFailedDesign] = useState<ShowcaseDesignId | null>(null);
  // remount viewer เมื่อกด "ลองอีกครั้ง" (สร้าง context + โมเดลใหม่)
  const [attempt, setAttempt] = useState(0);
  // drag hint: แสดงครั้งเดียวต่อการโหลดหน้า (state นี้อยู่ที่ stage ซึ่งไม่ remount ตอนเปลี่ยนแบบ · ไม่ใช้ storage) · true = เล่นจบ/ผู้ใช้แตะแล้ว
  const [hintDone, setHintDone] = useState(false);
  // ฟังก์ชันจับภาพจาก viewer (เก็บเป็น object เพราะ setState ของ function = updater)
  const [captureHandle, setCaptureHandle] = useState<{ fn: CaptureFrontFn } | null>(null);
  const handleViewerCapture = useCallback((fn: CaptureFrontFn | null) => setCaptureHandle(fn ? { fn } : null), []);

  useEffect(() => {
    let cancelled = false;
    if (!isWebGLAvailable()) {
      setMode("unsupported");
      return;
    }
    setMode("loading");
    import("./RingViewer")
      .then((m) => {
        if (!cancelled) setViewer(() => m.default);
      })
      .catch(() => {
        if (!cancelled) setMode("unsupported"); // โหลด chunk ไม่ได้ (เน็ตหลุด/ถูกบล็อก)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // โมเดลของแบบก่อนหน้าล้มแล้วผู้ใช้สลับไปแบบอื่น → remount viewer (renderer เดิมอาจไม่มี/ถือโมเดลผิด) แทนค้างสถานะโหลด
  useEffect(() => {
    if (failedDesign !== null && failedDesign !== design.id) {
      setFailedDesign(null);
      setAttempt((n) => n + 1);
      setMode((m) => (m === "ready" ? "loading" : m));
    }
  }, [design.id, failedDesign]);

  const designFailed = failedDesign === design.id;
  const captureStatus: StageCaptureStatus = mode === "unsupported" ? "unsupported" : mode === "ready" && !designFailed ? "ready" : "waiting";
  const captureFn = captureStatus === "ready" ? (captureHandle?.fn ?? null) : null;
  useEffect(() => {
    onStageStatus?.(captureStatus);
  }, [captureStatus, onStageStatus]);
  useEffect(() => {
    onCaptureReady?.(captureFn);
  }, [captureFn, onCaptureReady]);
  // reduced-motion: ไม่แสดงจุดเลย (จุดนิ่งๆ ไม่สื่อว่า "ลากได้" และดูเหมือนฝุ่นบนภาพ · ป้าย "ลากเพื่อหมุน" ยังอยู่) — อ่านตอน render หลัง ready เท่านั้น (client-only ไม่กระทบ hydration)
  const hintVisible =
    mode === "ready" && !designFailed && !hintDone && !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  // เล่น ~3 รอบ (5.8s) แล้วถอดจาก DOM · CSS ทำ fade-out เอง ตัวนี้แค่เก็บกวาด
  useEffect(() => {
    if (!hintVisible) return;
    const t = window.setTimeout(() => setHintDone(true), 6000);
    return () => window.clearTimeout(t);
  }, [hintVisible]);
  const showViewer = Viewer !== null && mode !== "unsupported" && mode !== "checking";
  const showFallback = mode !== "ready" || designFailed;
  const loading = (mode === "checking" || mode === "loading") && !designFailed;
  const hasPhoto = photo !== undefined;

  let statusText: string | null = null;
  if (designFailed) statusText = SHOWCASE_COPY.stageDesignLoadFailed;
  else if (loading) statusText = SHOWCASE_COPY.loading3d;
  else if (mode === "unsupported") statusText = hasPhoto ? SHOWCASE_COPY.unsupported3d : SHOWCASE_COPY.stageNo3dNoPhoto;
  else if (mode === "lost") statusText = hasPhoto ? SHOWCASE_COPY.contextLost3d : SHOWCASE_COPY.contextLost3dNoPhoto;

  return (
    <section
      aria-label={SHOWCASE_COPY.stageLabel}
      aria-busy={loading || undefined}
      onPointerDown={hintDone ? undefined : () => setHintDone(true)}
      onTouchStart={hintDone ? undefined : () => setHintDone(true)}
      className="relative h-[40dvh] min-h-[240px] w-full overflow-hidden rounded-2xl border border-[var(--gq-border)] bg-gradient-to-b from-white to-[var(--gq-border-soft)] lg:h-[min(72dvh,640px)]"
    >
      {/* เงาใต้แหวน (§9.4 ข้อ 5) = CSS radial-gradient ใต้ canvas — ไม่ใช่ texture/FBO · ตำแหน่งเทียบกับกรอบกล้องมุมหน้า ให้ TL ดูด้วยตา */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[66%] h-[9%] w-[58%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(60,48,48,0.22),rgba(60,48,48,0)_70%)]"
      />

      {showViewer && Viewer && (
        <Viewer
          key={attempt}
          designId={design.id}
          top={top}
          bottom={bottom}
          slots={slots}
          ariaLabel={ariaLabel}
          showReset={mode === "ready" && !designFailed}
          onReady={() => setMode("ready")}
          onUnsupported={(reason) => setMode(reason === "context_lost" ? "lost" : "unsupported")}
          onDesignFailed={(id) => setFailedDesign(id)}
          onCaptureReady={handleViewerCapture}
        />
      )}

      {showFallback &&
        (hasPhoto ? (
          // รูปจริงใน stage: ไม่ผ่าน next/image (ไม่พา request ไป /_next/image ที่ไม่อยู่ใน exempt) — ใช้ไฟล์ static ตรงๆ
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.src}
            width={photo.width}
            height={photo.height}
            alt={loading ? "" : photoAlt}
            aria-hidden={loading ? true : undefined}
            className={`absolute inset-0 z-[5] h-full w-full object-cover object-[50%_55%] ${loading ? "scale-105 blur-md" : ""}`}
          />
        ) : (
          // ไม่มีรูปถ่ายจริง: ภาพประกอบตำแหน่งเม็ด (schematic · ไม่มีสีพลอย) บนพื้นเดียวกับเวที — ปิดทับ canvas เดิม (กันภาพของแบบก่อนหน้าค้าง)
          <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-white to-[var(--gq-border-soft)]">
            <DesignPictogram design={design} className={`h-auto w-3/5 max-w-[260px] text-[var(--gq-burgundy)] ${loading ? "opacity-20" : "opacity-60"}`} />
            {!loading && <span className="rounded-full border border-[var(--gq-border)] bg-white/90 px-3 py-1 text-xs text-[var(--gq-text-muted)]">{SHOWCASE_COPY.pictogramBadge}</span>}
          </div>
        ))}

      <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full border border-[var(--gq-border)] bg-white/90 px-3 py-1 text-xs text-[var(--gq-text-muted)]">
        {SHOWCASE_COPY.badge}
      </span>
      {mode === "ready" && !designFailed && (
        <span className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-full bg-white/90 px-3 py-1 text-xs text-[var(--gq-text-muted)]">
          {SHOWCASE_COPY.dragHint}
        </span>
      )}

      {hintVisible && (
        // จุดขาวแนะนำให้ลากหมุน (เจ้าของสั่ง 24 พ.ย.) — CSS ล้วน · ไม่รับ pointer · ซ่อนจาก screen reader (ป้าย "ลากเพื่อหมุน" เป็นตัวบอกจริง)
        <div data-testid="drag-hint" aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[78%] z-10 -ml-[7.5px] animate-gq-hint-life">
          <span className="block h-[15px] w-[15px] animate-gq-hint-swipe rounded-full border border-white/90 bg-white shadow-[0_1px_4px_rgba(60,48,48,0.45),0_0_0_1px_rgba(60,48,48,0.1)]" />
        </div>
      )}

      {statusText && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col items-center gap-2">
          <p role="status" className="w-full rounded-xl bg-white/90 px-3 py-2 text-center text-sm leading-[1.5] text-[var(--gq-text)]">
            {statusText}
          </p>
          {designFailed && (
            <button
              type="button"
              onClick={() => {
                setFailedDesign(null);
                setAttempt((n) => n + 1);
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--gq-burgundy-border)] bg-white px-5 text-sm font-medium text-[var(--gq-burgundy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
            >
              {SHOWCASE_COPY.stageRetry}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
