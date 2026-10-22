"use client";

// ShopPhotoViewerHost — viewer เต็มจอของรูปหน้างาน + แถบจัดการ + กล่องยืนยันลบ (ใช้ร่วม W-5 / W-8 / W-10)
// JobPhotoViewer เดิม (closeSize="worker" = ปุ่มปิด 56px) · แถบจัดการเฉพาะรูปที่แก้ได้ (ไม่ล็อก/ไม่ได้กำลังส่ง) · ล็อก/ดูอย่างเดียว = viewer เปล่า
// ลบรูปที่ส่งแล้ว = กล่องยืนยัน "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" (focus เริ่มที่ "ยกเลิก") · รูปที่ยังอยู่ในเครื่อง = เอาออกทันที (ถ่ายใหม่ได้)
// ผลลัพธ์ (ตั้งหลัก/ลบ/ล้ม) ส่งออกทาง onStatus ให้การ์ดแสดงเป็น role="status" ที่หายเอง

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ShopPhotoManageBar } from "@/components/domain/jobs/worker/shop/ShopPhotoManageBar";
import type { ShopPhotosApi } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { JobPhotoViewer } from "@/components/domain/jobs/photos/JobPhotoViewer";
import type { PhotoView, RetryReason } from "@/components/domain/jobs/photos/types";
import { SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";
import type { ShopPhotoItem } from "@/lib/jobs/shop-photos";

/** รูปหลักก่อน แล้วตามลำดับเดิม — ลำดับเดียวกับที่โชว์บนกริด/แถว */
export function orderedItems(items: readonly ShopPhotoItem[]): ShopPhotoItem[] {
  return [...items.filter((i) => i.isPrimary), ...items.filter((i) => !i.isPrimary)];
}

function ConfirmDelete({ onConfirm, onCancel }: { onConfirm: () => Promise<string | null>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inflight = useRef(false);
  // Modal ย้าย focus ไปที่แผงหลัง child effect — เลื่อนไปจังหวะถัดไปให้ "ยกเลิก" ได้ focus จริง (กัน Enter ลบโดยพลั้ง)
  useEffect(() => {
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  async function go() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm();
      if (err) setError(err);
    } catch {
      setError(SHOP_PHOTO_TH.removeFail);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={busy ? () => undefined : onCancel} title={SHOP_PHOTO_TH.deleteTitle}>
      <div className="space-y-3">
        {error && (
          <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
            {error}
          </p>
        )}
        <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-red-700 px-5 text-xl font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 disabled:opacity-50">
          {busy ? "กำลังลบ…" : "ลบรูป"}
        </button>
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-zinc-400 bg-white px-5 text-xl font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-50">
          ยกเลิก
        </button>
      </div>
    </Modal>
  );
}

export function ShopPhotoViewerHost({
  photos,
  title,
  openKey,
  onOpenKey,
  readOnly,
  onStatus,
  onRetryLoad,
}: {
  photos: ShopPhotosApi;
  /** ใช้ในหัว/aria ของ viewer — เลขใบงาน (JB-xxxx) หรือ "ใบใหม่" ก่อนเปิดใบ */
  title: string;
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
  /** ดูอย่างเดียว (ช่างรับงานแล้ว/ใบปิด) */
  readOnly: boolean;
  onStatus: (message: string) => void;
  onRetryLoad?: (r: RetryReason) => void;
}) {
  const [confirm, setConfirm] = useState<ShopPhotoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const list = orderedItems(photos.items.filter((i) => i.phase !== "resizing"));
  const idx = openKey === null ? -1 : list.findIndex((i) => i.key === openKey);

  // รูปที่เปิดอยู่หายไป (ลบ/ล้างฟอร์ม) → ปิด viewer
  useEffect(() => {
    if (openKey !== null && idx < 0 && confirm === null) onOpenKey(null);
  }, [openKey, idx, confirm, onOpenKey]);

  if (idx < 0 && confirm === null) return null;

  const views: PhotoView[] = list.map((i) => ({ id: i.key, smUrl: i.smUrl, mdUrl: i.mdUrl, isPrimary: i.isPrimary }));

  /** หลังลบ: ไปรูปข้างเคียง ไม่เหลือ = ปิด viewer */
  function afterRemove(removedKey: string) {
    const at = list.findIndex((i) => i.key === removedKey);
    const rest = list.filter((i) => i.key !== removedKey);
    onOpenKey(rest.length === 0 ? null : rest[Math.min(Math.max(at, 0), rest.length - 1)].key);
  }

  async function setPrimary(it: ShopPhotoItem) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await photos.setPrimary(it.key);
      onStatus(r.ok ? SHOP_PHOTO_TH.primaryToast : r.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft(it: ShopPhotoItem) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await photos.remove(it.key);
      if (r.ok) {
        afterRemove(it.key);
        onStatus(SHOP_PHOTO_TH.removedDraft);
      } else onStatus(r.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {idx >= 0 && (
        <JobPhotoViewer
          photos={views}
          index={idx}
          onIndexChange={(i) => onOpenKey(list[i]?.key ?? null)}
          onClose={() => onOpenKey(null)}
          title={title}
          closeSize="worker"
          onRetryLoad={onRetryLoad}
          renderActions={({ index }) => {
            const it = list[index];
            if (!it || readOnly || it.phase === "uploading" || it.phase === "locked") return null;
            const sent = it.serverId !== null;
            return (
              <ShopPhotoManageBar
                isPrimary={it.isPrimary}
                sent={sent}
                canSetPrimary={photos.canSetPrimarySent}
                busy={busy}
                onSetPrimary={() => void setPrimary(it)}
                onRemove={() => (sent ? setConfirm(it) : void removeDraft(it))}
              />
            );
          }}
        />
      )}
      {confirm && (
        <ConfirmDelete
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await photos.remove(confirm.key);
            if (!r.ok) return r.message;
            afterRemove(confirm.key);
            setConfirm(null);
            onStatus(SHOP_PHOTO_TH.deletedToast);
            return null;
          }}
        />
      )}
    </>
  );
}
