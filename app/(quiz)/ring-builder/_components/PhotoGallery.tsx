"use client";

// PhotoGallery — "ดูของจริง": รูปจริงต่อแบบ สไลด์แนวนอน scroll-snap + ปุ่ม ‹ › · รูปโหลดไม่ได้ = กรอบ ivory + "ลองอีกครั้ง"
// <img> ธรรมดา (static asset จาก /_next/static) · alt ตามมุมถ่าย — TODO_OWNER_PHOTO_CAPTION (config.ts) ยังไม่ผ่านการยืนยัน
import { useRef, useState } from "react";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcasePhoto } from "../_assets";

/** alt ของรูปจริง — มีชื่อมุมถ่าย (เฉพาะแบบไขว้ที่เจ้าของระบุ) = "ชื่อแบบ รูปที่ n จาก N — มุม" · ไม่มี = "ภาพถ่ายจริง ชื่อแบบ รูปที่ n จาก N" (ไม่แต่งมุมที่ไม่รู้) */
export function photoAlt(designName: string, index: number, total: number, views?: readonly string[]): string {
  const view = views?.[index];
  return view ? `${designName} รูปที่ ${index + 1} จาก ${total} — ${view}` : `ภาพถ่ายจริง ${designName} รูปที่ ${index + 1} จาก ${total}`;
}

function PhotoSlide({ photo, alt }: { photo: ShowcasePhoto; alt: string }) {
  const [failed, setFailed] = useState(false);
  // retry = mount <img> ใหม่ (key) เพื่อให้เบราว์เซอร์ขอไฟล์อีกครั้ง
  const [attempt, setAttempt] = useState(0);

  if (failed) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-3 rounded-xl border border-[var(--gq-border)] bg-[var(--gq-ivory)] p-4 text-center">
        <p role="status" className="text-sm text-[var(--gq-text-muted)]">
          {SHOWCASE_COPY.photoFailed}
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--gq-burgundy-border)] bg-white px-5 text-sm font-medium text-[var(--gq-burgundy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {SHOWCASE_COPY.photoRetry}
        </button>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={photo.src}
      width={photo.width}
      height={photo.height}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="aspect-[3/4] w-full rounded-xl border border-[var(--gq-border-soft)] bg-[var(--gq-ivory)] object-cover"
    />
  );
}

export function PhotoGallery({ photos, designName, views }: { photos: readonly ShowcasePhoto[]; designName: string; views?: readonly string[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  function scrollByPage(dir: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const first = el.firstElementChild as HTMLElement | null;
    const step = first ? first.getBoundingClientRect().width + 12 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  }

  const navBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--gq-border)] bg-white text-[var(--gq-text)] transition-colors hover:border-[var(--gq-burgundy-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]";

  // แบบที่ยังไม่มีรูปถ่ายจริง: คงหัวข้อไว้ (ซ่อนแล้วหน้ากระโดดตอนสลับแบบ) + การ์ดบอกตรงๆ · ห้ามเอารูปแบบอื่นมาแทน (Z6)
  if (photos.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.photosHeading}</h2>
        <div className="flex min-h-[120px] flex-col justify-center gap-1 rounded-xl border border-[var(--gq-border)] bg-[var(--gq-ivory)] px-4 py-4">
          <p className="text-base font-medium text-[var(--gq-text)]">{SHOWCASE_COPY.noPhotoTitle}</p>
          <p className="text-sm leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.noPhotoBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.photosHeading}</h2>
        <div className="flex gap-2">
          <button type="button" aria-label={SHOWCASE_COPY.photoPrev} onClick={() => scrollByPage(-1)} className={navBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button type="button" aria-label={SHOWCASE_COPY.photoNext} onClick={() => scrollByPage(1)} className={navBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label={SHOWCASE_COPY.photosHeading}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        {photos.map((photo, i) => (
          <div key={photo.src} className="w-[80%] flex-none snap-center sm:w-[46%] lg:w-[24%]">
            <PhotoSlide photo={photo} alt={photoAlt(designName, i, photos.length, views)} />
          </div>
        ))}
      </div>
      <p className="text-xs leading-[1.6] text-[var(--gq-text-muted)]">{SHOWCASE_COPY.photosNote}</p>
    </div>
  );
}
