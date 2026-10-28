"use client";

// ShopPhotoUploadPanel — การ์ดรูปจากหน้างานหลังเปิดใบ: ใช้ทั้ง W-8 (mode "open" · ส่งรูปที่เลือกไว้) และ W-10 (mode "edit" · แก้รูปของใบที่เปิดไว้) — ตัวเดียวกันต่างกันที่ที่มาของรูป (UX §5 / §5A.2)
// "แถว" ไม่ใช่ช่องภาพ (จอนี้เน้นสถานะ/ข้อความ/ปุ่มลองใหม่ ช่อง 104px ใส่ไม่พอ) · thumb 56px = ปุ่มเปิด viewer · ลองใหม่/เอาออก ≥ 48px
// open: ส่งครบ (ไม่ล็อก) → พับเป็นแถบ "✓ ส่งรูปแล้ว n รูป [จัดการ ▾]" กันดัน QR ลงล่าง · edit: กางเสมอ รูปที่บันทึกแล้วไม่โชว์ "ส่งแล้ว" (เงียบ)
// ล็อก (ช่างรับงานแล้ว/ใบปิด): ซ่อนเพิ่ม/ลองใหม่/★/ลบ — ดูรูปได้ · รูปที่ยังไม่ส่งขึ้น "ไม่ได้ส่ง — ช่างรับงานแล้ว" + "เอาออก"
// 4 state: loading (แถวรอคิว/กำลังส่ง/แถบวิ่ง) · empty (edit: ข้อความ + ปุ่มเพิ่ม) · error (แถวล้มต่อรูป + แถบเน็ต/PIN + ล็อก) · success (แถบพับ ✓)
// ไม่มีรูปไหนทำให้ทั้งใบ "ล้ม" — ใบเปิดสำเร็จแล้วเสมอ · aria-live สรุปรวมบรรทัดซ่อน (ไม่อ่านทุกเฟรม) · แถบวิ่งเป็น motion-safe เท่านั้น

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ImageOff, Loader2, WifiOff } from "lucide-react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopPhotoRejections } from "@/components/domain/jobs/worker/shop/ShopPhotoRejections";
import { ShopPhotoViewerHost, orderedItems } from "@/components/domain/jobs/worker/shop/ShopPhotoViewerHost";
import { useStatusLine } from "@/components/domain/jobs/worker/shop/useStatusLine";
import type { ShopPhotosApi } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { JobPhotoThumb } from "@/components/domain/jobs/photos/JobPhotoThumb";
import { PhotoAddButtons } from "@/components/domain/jobs/photos/PhotoAddButtons";
import type { RetryReason } from "@/components/domain/jobs/photos/types";
import { SHOP_PHOTO_MAX, SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";
import type { ShopPhotoItem } from "@/lib/jobs/shop-photos";

const BTN = "inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-lg font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-50";

function Row({
  item,
  index,
  total,
  onOpen,
  onRetry,
  onRemove,
  onRetryLoad,
}: {
  item: ShopPhotoItem;
  index: number;
  total: number;
  onOpen: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onRetryLoad?: (r: RetryReason) => void;
}) {
  const label = `รูปที่ ${index} จาก ${total}${item.isPrimary ? " · รูปหลัก" : ""} · แตะเพื่อดู`;
  const failed = item.phase === "error" || item.phase === "locked";
  return (
    <li data-phase={item.phase} className={`flex flex-wrap items-start gap-3 rounded-xl border-2 p-2 ${failed ? "border-red-700 bg-red-50" : "border-zinc-300 bg-white"}`}>
      {item.phase === "resizing" ? (
        <span role="status" aria-busy="true" aria-label={`กำลังย่อรูปที่ ${index}`} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-800">
          <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
        </span>
      ) : (
        <JobPhotoThumb smUrl={item.smUrl} size={56} label={label} isPrimary={false} onClick={onOpen} onRetryLoad={item.saved ? onRetryLoad : undefined} />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-lg font-bold break-words text-zinc-900">
          รูปที่ {index}
          {item.isPrimary && (
            <span className="ml-2 inline-flex items-center rounded bg-zinc-900 px-1.5 py-0.5 text-base font-bold text-white">★ รูปหลัก</span>
          )}
        </p>
        {item.phase === "resizing" && <p className="text-base font-semibold text-zinc-800">{SHOP_PHOTO_TH.resizing}</p>}
        {(item.phase === "queued" || item.phase === "ready") && <p className="text-base font-semibold text-zinc-800">{SHOP_PHOTO_TH.queued}</p>}
        {item.phase === "uploading" && (
          <div>
            <p className="text-base font-semibold text-zinc-900">{SHOP_PHOTO_TH.uploading}</p>
            <div aria-hidden="true" className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full w-1/3 rounded-full bg-primary-600 motion-safe:animate-pulse" />
            </div>
          </div>
        )}
        {item.phase === "done" && !item.saved && <p className="text-base font-bold text-green-800">{SHOP_PHOTO_TH.sent}</p>}
        {failed && <p className="text-base font-semibold break-words text-red-800">⚠ {item.message ?? SHOP_PHOTO_TH.failGeneric}</p>}
      </div>
      {failed && (
        <div className="flex w-full flex-wrap gap-2">
          {item.phase === "error" && item.retryable && (
            <button type="button" onClick={onRetry} className={`${BTN} bg-primary-600 text-white hover:bg-primary-700`}>
              {SHOP_PHOTO_TH.retry}
            </button>
          )}
          <button type="button" onClick={onRemove} className={`${BTN} border-2 border-zinc-400 bg-white text-zinc-900`}>
            เอาออก
          </button>
        </div>
      )}
    </li>
  );
}

export function ShopPhotoUploadPanel({
  photos,
  jobNo,
  mode,
  onSessionLost,
  onRetryLoad,
}: {
  photos: ShopPhotosApi;
  jobNo: string;
  mode: "open" | "edit";
  /** session หมดเวลา → ให้ผู้เรียกโหลด hub ใหม่ (แผ่น PIN) — ShopOpenFlow/ShopJobPhotosScreen ต้องไม่ถูก unmount */
  onSessionLost: () => void;
  /** ลิงก์รูปที่ server เซ็นหมดอายุ (15 นาที) → ผู้เรียกโหลดรายการใหม่ (เฉพาะ W-10) */
  onRetryLoad?: (r: RetryReason) => void;
}) {
  const { items, lock } = photos;
  const [expanded, setExpanded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [status, setStatus] = useStatusLine();
  const [wasOffline, setWasOffline] = useState(false);
  const fullRef = useRef<HTMLParagraphElement>(null);
  const prevRemaining = useRef(photos.remaining);

  const list = orderedItems(items);
  const total = list.length;
  const sent = items.filter((i) => i.phase === "done").length;
  const sendingN = items.filter((i) => i.phase === "queued" || i.phase === "uploading").length;
  const failedRetryable = items.filter((i) => i.phase === "error" && i.retryable);
  const needsPin = items.some((i) => i.needsPin);
  const pending = lock === null && items.some((i) => i.serverId === null && (i.phase === "queued" || i.phase === "uploading" || i.phase === "error"));
  const online = photos.online;

  // เคยหลุดเน็ต → จำไว้จนกว่าเน็ตกลับมาและไม่มีรูปล้มค้าง (ขณะออฟไลน์ไม่ล้าง — ไม่งั้นแถบ "เน็ตกลับมาแล้ว" ไม่เคยขึ้น)
  useEffect(() => {
    if (!online) setWasOffline(true);
    else if (failedRetryable.length === 0) setWasOffline(false);
  }, [online, failedRetryable.length]);

  useEffect(() => {
    if (prevRemaining.current > 0 && photos.remaining === 0 && mode === "edit") fullRef.current?.focus();
    prevRemaining.current = photos.remaining;
  }, [photos.remaining, mode]);

  const collapsed = mode === "open" && photos.summary === "done" && lock === null && !expanded;
  const liveText =
    photos.summary === "sending" && sendingN > 0
      ? `กำลังส่งรูป ${Math.min(sent + 1, total)} จาก ${total}`
      : photos.summary === "done" && mode === "open"
        ? `ส่งรูปครบ ${total} รูปแล้ว`
        : failedRetryable.length > 0 || items.some((i) => i.phase === "error")
          ? `ส่งไม่สำเร็จ ${items.filter((i) => i.phase === "error").length} รูป`
          : "";
  const counter = mode === "open" ? `${sent}/${total}` : `${total}/${SHOP_PHOTO_MAX}`;

  const viewer = <ShopPhotoViewerHost photos={photos} title={jobNo} openKey={openKey} onOpenKey={setOpenKey} readOnly={lock !== null} onStatus={setStatus} onRetryLoad={onRetryLoad} />;

  if (collapsed) {
    return (
      <section aria-labelledby="shop-photo-card-h" className="rounded-2xl border-2 border-green-700 bg-green-50 p-3 text-left">
        <h2 id="shop-photo-card-h" className="sr-only">
          {SHOP_PHOTO_TH.cardTitle}
        </h2>
        <p role="status" aria-live="polite" className="sr-only">
          {liveText}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ul className="flex gap-1.5">
            {list.map((it, i) => (
              <li key={it.key}>
                <button type="button" onClick={() => setOpenKey(it.key)} aria-label={`รูปที่ ${i + 1} จาก ${total}${it.isPrimary ? " · รูปหลัก" : ""} · แตะเพื่อดู`} className="relative block h-10 w-10 overflow-hidden rounded-md border border-zinc-300 bg-zinc-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
                  {it.smUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob URL ในเครื่อง
                    <img src={it.smUrl} alt="" referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="m-auto h-5 w-5 text-zinc-700" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-green-900">{`✓ ส่งรูปแล้ว ${total} รูป`}</p>
            <p className="text-base text-zinc-800">{SHOP_PHOTO_TH.editable}</p>
          </div>
          <button type="button" onClick={() => setExpanded(true)} aria-expanded={false} className={`${BTN} border-2 border-zinc-400 bg-white text-zinc-900`}>
            จัดการ <ChevronDown className="ml-1 h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {viewer}
      </section>
    );
  }

  return (
    <section aria-labelledby="shop-photo-card-h" className="space-y-3 rounded-2xl border-2 border-zinc-300 bg-white p-3 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="shop-photo-card-h" className="text-xl font-bold text-zinc-900">
          {SHOP_PHOTO_TH.cardTitle}
        </h2>
        <span className="text-lg font-bold tabular-nums text-zinc-900" aria-label={mode === "open" ? `ส่งแล้ว ${sent} จาก ${total} รูป` : `${total} จาก ${SHOP_PHOTO_MAX} รูป`}>
          รูป {counter}
        </span>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {liveText}
      </p>

      {lock !== null && (
        <p role="note" className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-lg font-semibold text-sky-950">
          {lock === "locked" ? `🔒 ${SHOP_PHOTO_TH.locked}` : lock === "closed" ? SHOP_PHOTO_TH.failClosed : lock === "not_open" ? SHOP_PHOTO_TH.failNotOpen : SHOP_PHOTO_TH.failNotOwner}
        </p>
      )}

      {!online && pending && (
        <p role="status" className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-950">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {SHOP_PHOTO_TH.noNet}
        </p>
      )}
      {online && wasOffline && failedRetryable.length > 0 && (
        <p role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-3 text-base font-semibold text-green-900">
          {SHOP_PHOTO_TH.netBack}
        </p>
      )}
      {needsPin && (
        <div role="alert" className="space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
          <p className="text-lg font-semibold text-amber-950">{SHOP_PHOTO_TH.failPin}</p>
          <BigButton type="button" tone="secondary" onClick={onSessionLost}>
            {SHOP_PHOTO_TH.pinAgain}
          </BigButton>
        </div>
      )}

      {total === 0 && mode === "edit" && (
        <p className="rounded-xl border-2 border-dashed border-zinc-300 p-3 text-lg text-zinc-800">{lock === "locked" ? "ใบนี้ไม่มีรูป — ช่างรับงานแล้ว เพิ่มไม่ได้" : lock !== null ? "ใบนี้ไม่มีรูป — เพิ่มไม่ได้" : "ยังไม่มีรูป — ถ่ายให้ช่างดูได้จนช่างเริ่มรับงาน"}</p>
      )}

      {total > 0 && (
        <ul className="space-y-2">
          {list.map((it, i) => (
            <Row key={it.key} item={it} index={i + 1} total={total} onOpen={() => setOpenKey(it.key)} onRetry={() => photos.retry(it.key)} onRemove={() => void photos.remove(it.key)} onRetryLoad={onRetryLoad} />
          ))}
        </ul>
      )}

      {failedRetryable.length >= 2 && online && lock === null && (
        <button type="button" onClick={photos.retryAll} className={`${BTN} w-full border-2 border-zinc-400 bg-white text-zinc-900`}>
          {SHOP_PHOTO_TH.retryAll(failedRetryable.length)}
        </button>
      )}

      <ShopPhotoRejections rejections={photos.rejections} notice={photos.notice} onDismiss={photos.dismissRejection} />

      {lock === null &&
        (photos.remaining > 0 ? (
          <PhotoAddButtons variant="worker" libraryLabel="เลือกจากคลัง" onFiles={photos.pick} />
        ) : (
          <p ref={fullRef} tabIndex={-1} role="status" className="rounded-xl bg-zinc-100 p-3 text-lg font-semibold text-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            {SHOP_PHOTO_TH.full}
          </p>
        ))}

      {pending && <p className="rounded-xl bg-amber-50 p-3 text-base font-semibold text-amber-950">{SHOP_PHOTO_TH.dontClose}</p>}
      {mode === "open" && lock === null && expanded && <p className="text-base text-zinc-700">{SHOP_PHOTO_TH.leaveHint}</p>}
      <p role="status" aria-live="polite" className="min-h-6 text-base font-semibold text-green-800">
        {status ?? ""}
      </p>
      {mode === "open" && expanded && photos.summary === "done" && (
        <button type="button" onClick={() => setExpanded(false)} aria-expanded={true} className={`${BTN} w-full border-2 border-zinc-400 bg-white text-zinc-900`}>
          ซ่อนการจัดการ
        </button>
      )}
      {viewer}
    </section>
  );
}
