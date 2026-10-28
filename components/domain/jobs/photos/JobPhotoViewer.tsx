"use client";

// JobPhotoViewer — ดูรูปเต็มจอ (ชั้นแสดงผลล้วน · ออฟฟิศ + หน้าช่าง ใช้ตัวเดียวกัน)
// ปัดซ้าย-ขวา = scroll-snap ของเบราว์เซอร์ · ขยายด้วยการถ่างนิ้ว (touch-action pan-x pinch-zoom — ไม่เขียน zoom เอง) · ไม่มีแอนิเมชันเปลี่ยนรูป
// รูปในช่อง: sm ขึ้นก่อน (อยู่ในหน้าแล้ว ไม่กระพริบ) → md ซ้อนทับเมื่อโหลดเสร็จ (เฉพาะรูปที่ใช้อยู่ ±1) · md พลาด = คงรูป sm + บอกในแถบ · ทั้งคู่พลาด = ไอคอน + ลองใหม่
// a11y: role=dialog aria-modal · focus เริ่มที่ปุ่มปิด + trap Tab + คืน focus ตอนปิด · ←/→ เปลี่ยนรูป · Esc ปิด · alt ไม่มีชื่อลูกค้า/ชื่อไฟล์ · ไม่มีปุ่มดาวน์โหลด/ลิงก์ URL
// ปุ่มจัดการ (ตั้งรูปหลัก/เลื่อน/ลบ) = slot renderActions — เฉพาะออฟฟิศ · โหมดช่าง (ไม่ส่ง) = ดูอย่างเดียว

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Star, X } from "lucide-react";
import type { PhotoView, RetryReason } from "@/components/domain/jobs/photos/types";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NAV_BTN = "absolute top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white";

function Slide({ photo, near, active, label, onRetryLoad }: { photo: PhotoView; near: boolean; active: boolean; label: string; onRetryLoad?: (r: RetryReason) => void }) {
  // ผูกกับ URL — ลิงก์ใหม่ที่ขอมา = ไม่ติดสถานะพังของลิงก์เก่า
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [mdLoaded, setMdLoaded] = useState<Record<string, true>>({});
  const notified = useRef<Set<string>>(new Set());
  const retryRef = useRef(onRetryLoad);
  useEffect(() => {
    retryRef.current = onRetryLoad;
  });

  const smOk = photo.smUrl !== null && !failed[photo.smUrl];
  const mdOk = near && photo.mdUrl !== null && !failed[photo.mdUrl];
  const mdDone = photo.mdUrl !== null && mdLoaded[photo.mdUrl] === true;
  const mdFailedVisible = active && photo.mdUrl !== null && failed[photo.mdUrl] === true && smOk;
  const broken = !smOk && !mdOk;

  const fail = (url: string | null) => {
    if (!url) return;
    setFailed((f) => ({ ...f, [url]: true }));
    if (!notified.current.has(url)) {
      notified.current.add(url);
      retryRef.current?.("error");
    }
  };

  return (
    <div className="relative flex h-full w-full shrink-0 snap-center items-center justify-center">
      {broken ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center text-white">
          <ImageOff className="h-12 w-12" aria-hidden="true" />
          <p className="text-lg font-semibold">โหลดรูปไม่ได้</p>
          {onRetryLoad && (
            <button type="button" onClick={() => onRetryLoad("tap")} className="min-h-14 rounded-xl bg-white px-6 text-lg font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
              ลองใหม่
            </button>
          )}
        </div>
      ) : (
        <>
          {smOk && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL อายุสั้น
            <img src={photo.smUrl ?? undefined} alt={label} referrerPolicy="no-referrer" draggable={false} onError={() => fail(photo.smUrl)} className="absolute inset-0 h-full w-full object-contain" />
          )}
          {mdOk && (
            // eslint-disable-next-line @next/next/no-img-element -- ภาพซ้อนทับเพื่อความละเอียด (ซ้ำกับรูป sm จึงซ่อนจาก screen reader)
            <img
              src={photo.mdUrl ?? undefined}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              draggable={false}
              onLoad={() => photo.mdUrl && setMdLoaded((m) => ({ ...m, [photo.mdUrl as string]: true }))}
              onError={() => fail(photo.mdUrl)}
              className={`absolute inset-0 h-full w-full object-contain ${mdDone ? "opacity-100" : "opacity-0"}`}
            />
          )}
          {mdFailedVisible && (
            <p role="status" className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm font-semibold text-white">
              โหลดภาพละเอียดไม่ได้ — แสดงภาพย่อแทน
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function JobPhotoViewer({
  photos,
  index,
  onIndexChange,
  onClose,
  title,
  closeSize = "office",
  renderActions,
  onRetryLoad,
}: {
  photos: readonly PhotoView[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** เลขใบงาน (JB-0034) — ใช้ในหัว/aria/alt */
  title: string;
  /** worker = ปุ่มปิด 56px · office = 44px */
  closeSize?: "worker" | "office";
  /** แถบจัดการใต้รูป (เฉพาะออฟฟิศ) — ไม่ส่ง = ดูอย่างเดียว */
  renderActions?: (ctx: { photo: PhotoView; index: number; count: number }) => ReactNode;
  onRetryLoad?: (r: RetryReason) => void;
}) {
  const n = photos.length;
  const i = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const idxRef = useRef(i);
  const cbRef = useRef({ onIndexChange, onClose });
  useEffect(() => {
    idxRef.current = i;
    cbRef.current = { onIndexChange, onClose };
  });

  // เปิด: focus ที่ปุ่มปิด · ล็อกการเลื่อนหน้าหลัง · ปิด: คืน focus + ปลดล็อก
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      if (prev && prev.isConnected) prev.focus();
    };
  }, []);

  // ให้ scroller ตรงกับ index (กดปุ่ม ‹ › / ลบรูป / เปิดที่รูปที่แตะ) — ปัดด้วยนิ้วแล้ว index ตรงอยู่แล้ว จึงไม่กระตุก
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const want = i * el.clientWidth;
    if (Math.abs(el.scrollLeft - want) > 1) el.scrollLeft = want;
  }, [i, n]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= 0) return;
    const at = Math.round(el.scrollLeft / el.clientWidth);
    if (at >= 0 && at < n && at !== idxRef.current) cbRef.current.onIndexChange(at);
  }

  function go(delta: number) {
    const to = idxRef.current + delta;
    if (to >= 0 && to < n) cbRef.current.onIndexChange(to);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      cbRef.current.onClose();
    } else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "Tab" && rootRef.current) {
      const items = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === rootRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (n === 0) return null;
  const cur = photos[i];
  const closeCls = closeSize === "worker" ? "h-14 w-14" : "h-11 w-11";
  const actions = renderActions?.({ photo: cur, index: i, count: n });

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={`รูปงาน ${title}`} tabIndex={-1} onKeyDown={onKeyDown} className="fixed inset-0 z-40 flex flex-col bg-black text-white focus:outline-none">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <p aria-live="polite" className="text-lg font-bold tabular-nums">
          {title} · {i + 1}/{n}
        </p>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดรูป" className={`flex ${closeCls} items-center justify-center rounded-full bg-white/15 hover:bg-white/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white`}>
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} data-testid="viewer-scroll" className="flex h-full w-full snap-x snap-mandatory overflow-x-auto touch-pan-x touch-pinch-zoom [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {photos.map((p, k) => (
            <Slide key={p.id} photo={p} near={Math.abs(k - i) <= 1} active={k === i} label={`รูปงาน ${title} รูปที่ ${k + 1} จาก ${n}`} onRetryLoad={onRetryLoad} />
          ))}
        </div>
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="รูปก่อนหน้า" className={`${NAV_BTN} left-2 disabled:opacity-30`}>
              <ChevronLeft className="h-8 w-8" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => go(1)} disabled={i === n - 1} aria-label="รูปถัดไป" className={`${NAV_BTN} right-2 disabled:opacity-30`}>
              <ChevronRight className="h-8 w-8" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {cur.isPrimary && (
        <p className="shrink-0 px-4 py-2 text-lg font-bold">
          <span className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-base text-zinc-900">
            <Star className="h-4 w-4" aria-hidden="true" />
            รูปหลัก
          </span>
        </p>
      )}
      {actions && <div className="shrink-0 border-t border-zinc-700 bg-white p-3 text-zinc-900">{actions}</div>}
    </div>
  );
}
