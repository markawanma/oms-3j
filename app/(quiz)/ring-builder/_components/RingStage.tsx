"use client";

// RingStage — เวทีแสดงแหวน: ตรวจ WebGL → lazy-load RingViewer → ไม่ได้/ล้ม = รูปจริงรูปแรกแทน (ตัวเลือกด้านล่างยังใช้ได้ทุก state)
// 4 state ตาม UX §4: checking/loading (รูปเบลอ + "กำลังโหลด…") · ready (canvas) · unsupported (รูปจริง + ข้อความ) · lost (รูปจริง · กู้คืนได้เอง)
import { useEffect, useState, type ComponentType } from "react";
import type { GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { isWebGLAvailable } from "@/lib/ring-builder/viewer/gl-renderer";
import type { RingViewerProps } from "./RingViewer";
import type { ShowcasePhoto } from "../_assets";

type StageMode = "checking" | "loading" | "ready" | "unsupported" | "lost";

export function RingStage({
  top,
  bottom,
  ariaLabel,
  photo,
  photoAlt,
}: {
  top: GemQuizStoneCode | null;
  bottom: GemQuizStoneCode | null;
  ariaLabel: string;
  photo: ShowcasePhoto;
  photoAlt: string;
}) {
  const [mode, setMode] = useState<StageMode>("checking");
  const [Viewer, setViewer] = useState<ComponentType<RingViewerProps> | null>(null);

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

  const showViewer = Viewer !== null && mode !== "unsupported" && mode !== "checking";
  const showPhoto = mode !== "ready";
  const blurred = mode === "checking" || mode === "loading";
  const statusText =
    mode === "checking" || mode === "loading"
      ? SHOWCASE_COPY.loading3d
      : mode === "unsupported"
        ? SHOWCASE_COPY.unsupported3d
        : mode === "lost"
          ? SHOWCASE_COPY.contextLost3d
          : null;

  return (
    <section
      aria-label={SHOWCASE_COPY.stageLabel}
      className="relative h-[40dvh] min-h-[240px] w-full overflow-hidden rounded-2xl border border-[var(--gq-border)] bg-gradient-to-b from-white to-[var(--gq-border-soft)] lg:h-[min(72dvh,640px)]"
    >
      {showViewer && Viewer && (
        <Viewer
          top={top}
          bottom={bottom}
          ariaLabel={ariaLabel}
          onReady={() => setMode("ready")}
          onUnsupported={(reason) => setMode(reason === "context_lost" ? "lost" : "unsupported")}
        />
      )}

      {showPhoto && (
        // รูปจริงใน stage: ไม่ผ่าน next/image (ไม่พา request ไป /_next/image ที่ไม่อยู่ใน exempt) — ใช้ไฟล์ static ตรงๆ
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt={blurred ? "" : photoAlt}
          aria-hidden={blurred ? true : undefined}
          className={`absolute inset-0 z-[5] h-full w-full object-cover object-[50%_55%] ${blurred ? "scale-105 blur-md" : ""}`}
        />
      )}

      <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full border border-[var(--gq-border)] bg-white/90 px-3 py-1 text-xs text-[var(--gq-text-muted)]">
        {SHOWCASE_COPY.badge}
      </span>
      {mode === "ready" && (
        <span className="pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-full bg-white/90 px-3 py-1 text-xs text-[var(--gq-text-muted)]">
          {SHOWCASE_COPY.dragHint}
        </span>
      )}

      {statusText && (
        <p
          role="status"
          className="absolute inset-x-3 bottom-3 z-10 rounded-xl bg-white/90 px-3 py-2 text-center text-sm leading-[1.5] text-[var(--gq-text)]"
        >
          {statusText}
        </p>
      )}
    </section>
  );
}
