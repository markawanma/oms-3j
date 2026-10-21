"use client";

// ShopPhotoStep — W-5 "ใส่รูปให้ช่างดู" (UX §3 · ขั้นใหม่ก่อนทวน · ไม่บังคับ · ≤ 3 รูป · เก็บในเครื่อง ยังไม่ส่ง)
// รูปถูกย่อตอนเลือก (ทีละรูป) แล้วเก็บเป็น blob ในเครื่อง — ส่งหลังกด "เปิดงาน" สำเร็จ (ShopOpenFlow เรียก photos.start) · ไม่ใช้เน็ตที่ขั้นนี้
// ปุ่มหลักเดียวของจอ = sticky ล่าง: มีรูป → "ถัดไป" (primary) · ไม่มีรูป → "ข้าม ไม่ใส่รูป" (secondary — ไม่ใช่ด่าน) · ระหว่างย่อ → aria-disabled "รอย่อรูป…"
// ไม่วางปุ่ม ×/★ ทับภาพ (ช่อง ≈104px) — แตะภาพ = viewer ที่มีแถบจัดการ · ปุ่มเพิ่มอยู่เหนือภาพย่อ ตำแหน่งนิ่ง · ครบ 3 → ปุ่มหายแทนด้วยกล่องข้อความ (focus ไม่หล่น)
// 4 state: loading (ช่องที่กำลังย่อ) · empty (กล่องเส้นประ + ข้อความตามมี/ไม่มี SKU) · error (แถวไฟล์เปิดไม่ได้ต่อไฟล์) · success (ภาพย่อ + ถัดไป)

import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, Star } from "lucide-react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopPhotoRejections } from "@/components/domain/jobs/worker/shop/ShopPhotoRejections";
import { ShopPhotoViewerHost, orderedItems } from "@/components/domain/jobs/worker/shop/ShopPhotoViewerHost";
import { useStatusLine } from "@/components/domain/jobs/worker/shop/useStatusLine";
import type { ShopPhotosApi } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { PhotoAddButtons } from "@/components/domain/jobs/photos/PhotoAddButtons";
import { SHOP_PHOTO_MAX, SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";
import type { ShopPhotoItem } from "@/lib/jobs/shop-photos";

function Tile({ item, index, total, onOpen }: { item: ShopPhotoItem; index: number; total: number; onOpen: () => void }) {
  if (item.phase === "resizing") {
    return (
      <div role="status" aria-busy="true" aria-label={`กำลังย่อรูปที่ ${index}`} className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl bg-zinc-200 px-1 text-center text-zinc-800">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
        <span aria-hidden="true" className="text-sm font-semibold leading-tight">
          {SHOP_PHOTO_TH.resizing}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`รูปที่ ${index} จาก ${total}${item.isPrimary ? " · รูปหลัก" : ""} · แตะเพื่อดู`}
      className={`relative block aspect-square w-full overflow-hidden rounded-xl bg-zinc-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 ${item.isPrimary ? "ring-[3px] ring-zinc-900" : ""}`}
    >
      {item.smUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL ในเครื่อง (ย่อแล้ว) ไม่ผ่าน next/image
        <img src={item.smUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-700">
          <ImageOff className="h-7 w-7" aria-hidden="true" />
        </span>
      )}
      {item.isPrimary && (
        <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-white px-1.5 py-0.5 text-sm font-bold text-zinc-900 shadow">
          <Star className="h-3.5 w-3.5" aria-hidden="true" />
          รูปหลัก
        </span>
      )}
    </button>
  );
}

export function ShopPhotoStep({ photos, unbound, onNext }: { photos: ShopPhotosApi; /** สินค้าใหม่ไม่มีรหัส */ unbound: boolean; onNext: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [status, setStatus] = useStatusLine();
  const fullRef = useRef<HTMLParagraphElement>(null);
  const prevRemaining = useRef(photos.remaining);
  const list = orderedItems(photos.items);
  const n = list.length;
  const full = photos.remaining === 0;
  const resizing = photos.resizingCount > 0;

  // ปุ่มเพิ่มหายตอนครบ 3 — ถ้า focus เดิมอยู่บนปุ่มนั้น ย้ายมากล่อง "ครบ 3 รูปแล้ว" (กัน focus หล่น)
  useEffect(() => {
    if (prevRemaining.current > 0 && photos.remaining === 0) fullRef.current?.focus();
    prevRemaining.current = photos.remaining;
  }, [photos.remaining]);

  const nextLabel = resizing ? SHOP_PHOTO_TH.waitResize : n > 0 ? SHOP_PHOTO_TH.next : SHOP_PHOTO_TH.skip;
  const tone = n > 0 || resizing ? "primary" : "secondary";

  return (
    <>
      <div className="mt-4 space-y-4">
        <p className="text-lg text-zinc-800">{SHOP_PHOTO_TH.subtitle}</p>

        {full ? (
          <p ref={fullRef} tabIndex={-1} role="status" className="rounded-xl bg-zinc-100 p-3 text-lg font-semibold text-zinc-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            {SHOP_PHOTO_TH.full}
          </p>
        ) : (
          <PhotoAddButtons variant="worker" libraryLabel="เลือกจากคลัง" onFiles={photos.pick} />
        )}

        <ShopPhotoRejections rejections={photos.rejections} notice={photos.notice} onDismiss={photos.dismissRejection} />

        <div className="space-y-2">
          <p className="text-lg font-bold tabular-nums text-zinc-900">
            รูป {n}/{SHOP_PHOTO_MAX}
          </p>
          {n === 0 ? (
            <div className="flex min-h-[104px] items-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 p-3 text-zinc-700">
              <ImageOff className="h-8 w-8 shrink-0" aria-hidden="true" />
              <p className={`text-lg ${unbound ? "font-bold text-zinc-900" : ""}`}>{unbound ? SHOP_PHOTO_TH.emptyNoSku : SHOP_PHOTO_TH.emptyWithSku}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {list.map((it, i) => (
                <li key={it.key}>
                  <Tile item={it} index={i + 1} total={n} onOpen={() => setOpenKey(it.key)} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <p role="status" aria-live="polite" className="min-h-6 text-base font-semibold text-green-800">
          {status ?? ""}
        </p>

        <div className="space-y-1.5 text-base text-zinc-700">
          <p className="flex items-start gap-2">
            <span aria-hidden="true">ⓘ</span>
            <span className="min-w-0 break-words">{SHOP_PHOTO_TH.keptLocal}</span>
          </p>
          <p className="break-words">{SHOP_PHOTO_TH.careful}</p>
        </div>
      </div>

      <StickyAction>
        <BigButton type="button" tone={tone} aria-disabled={resizing ? true : undefined} onClick={() => { if (!resizing) onNext(); }}>
          {nextLabel}
        </BigButton>
      </StickyAction>

      <ShopPhotoViewerHost photos={photos} title="ใบใหม่" openKey={openKey} onOpenKey={setOpenKey} readOnly={false} onStatus={setStatus} />
    </>
  );
}
