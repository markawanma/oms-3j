"use client";

// ProductImageSection — SKU product-image gallery, rendered inside
// ProductForm (Tech Lead design brief, feat/sku-product-images). Backed by
// lib/actions/catalog-images.ts (uploadProductImage/deleteProductImage/
// reorderProductImages/getProductImages — read-only from this file's POV,
// do not edit that module or lib/catalog/image-*.ts) and the client-side
// resize pipeline in lib/catalog/image-client.ts.
//
// Reordering uses ‹ › buttons, not drag-and-drop — this repo has no dnd
// library, the modal is often viewed at 360px where drag targets are easy
// to miss, and the hard ceiling is only 4 images (MAX_IMAGES_PER_SKU), so a
// few button taps reach any position. Deleting an uploaded image has no
// confirm step (Tech Lead decision: unlike deleting a whole SKU, a freshly
// uploaded image carries no historical profit data to protect).
//
// Locked state (product === undefined): the SKU hasn't been saved yet, so
// there is no product_id to attach images to. The section stays VISIBLE but
// non-interactive with an explanatory message — hiding it entirely would
// leave first-time users unaware the feature exists at all.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  Lock,
  Plus,
  Star,
  X,
} from "lucide-react";
import {
  deleteProductImage,
  getProductImages,
  reorderProductImages,
  uploadProductImage,
} from "@/lib/actions/catalog-images";
import {
  HeicNotSupportedError,
  ImageDecodeError,
  ImageTooLargeError,
  SourceImageTooLargeError,
  resizeProductImage,
} from "@/lib/catalog/image-client";
import { MAX_IMAGES_PER_SKU } from "@/lib/catalog/image-constants";
import type { ProductImageRow, ProductRow } from "@/lib/catalog/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

/** Tech Lead decision (design brief): "ทำทีละ 2-3 ไฟล์พร้อมกันพอ — มือถือรุ่นล่าง
 * ย่อพร้อมกันเยอะแล้วค้าง". */
const UPLOAD_CONCURRENCY = 3;

type PendingStatus = "queued" | "resizing" | "uploading" | "error" | "heic";

interface PendingUpload {
  id: string;
  file: File;
  status: PendingStatus;
  errorMessage?: string;
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProductImageSection({
  product,
  onBusyChange,
}: {
  /** undefined = SKU not saved yet -> section renders locked/disabled. */
  product: ProductRow | undefined;
  /** Called whenever "there is in-flight work that would be lost if the
   * modal closed right now" changes — the parent wires this into <Modal
   * confirmBeforeClose>. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const productId = product?.productId;

  const [images, setImages] = useState<ProductImageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [overflowWarning, setOverflowWarning] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [reorderPending, setReorderPending] = useState(false);

  const queueRef = useRef<PendingUpload[]>([]);
  const activeCountRef = useRef(0);

  function loadImages(pid: string) {
    setLoading(true);
    setFetchError(null);
    getProductImages(pid).then((result) => {
      if (!result.ok) {
        setFetchError(result.error);
        setLoading(false);
        return;
      }
      setImages(result.data);
      setLoading(false);
    });
  }

  // Fetch (or reset) the gallery whenever the underlying product changes —
  // this fires the moment ProductForm switches a fresh create into edit
  // mode (product goes from undefined -> the just-created row), which is
  // exactly the point the section unlocks.
  useEffect(() => {
    queueRef.current = [];
    activeCountRef.current = 0;
    setPending([]);
    setBatch(null);
    setOverflowWarning(null);
    setDeletingIds(new Set());
    if (!productId) {
      setImages([]);
      setFetchError(null);
      setLoading(false);
      return;
    }
    loadImages(productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadImages only closes over its `pid` param, not outer state
  }, [productId]);

  // ----- busy flag (feeds the modal's confirmBeforeClose guard) -----
  const activePendingCount = pending.filter(
    (p) => p.status === "queued" || p.status === "resizing" || p.status === "uploading"
  ).length;
  const anyMutationPending = reorderPending || deletingIds.size > 0;
  const busy = activePendingCount > 0 || anyMutationPending;

  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  });
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);

  // ----- upload queue -----
  function bumpBatchDone() {
    setBatch((prev) => {
      if (!prev) return prev;
      const done = prev.done + 1;
      return done >= prev.total ? null : { done, total: prev.total };
    });
  }

  function updatePendingStatus(id: string, status: PendingStatus) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
  }

  function finishPendingWithProblem(id: string, status: "error" | "heic", errorMessage?: string) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status, errorMessage } : p)));
    bumpBatchDone();
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  async function runItem(item: PendingUpload) {
    if (!productId) return;
    updatePendingStatus(item.id, "resizing");

    let variants: Awaited<ReturnType<typeof resizeProductImage>>;
    try {
      variants = await resizeProductImage(item.file);
    } catch (err) {
      if (err instanceof HeicNotSupportedError) {
        finishPendingWithProblem(item.id, "heic");
      } else if (err instanceof ImageTooLargeError) {
        finishPendingWithProblem(
          item.id,
          "error",
          "ไฟล์รูปใหญ่เกินไป แม้ลดคุณภาพแล้วก็ยังเกิน 1MB — ลองถ่ายรูปใหม่ที่ความละเอียดต่ำกว่านี้"
        );
      } else if (err instanceof ImageDecodeError) {
        finishPendingWithProblem(item.id, "error", "เปิดไฟล์รูปนี้ไม่ได้ (ไฟล์เสียหรือไม่ใช่รูปภาพ) — ลองไฟล์อื่น");
      } else if (err instanceof SourceImageTooLargeError) {
        finishPendingWithProblem(
          item.id,
          "error",
          `ไฟล์ต้นฉบับใหญ่เกินไป (${(err.bytes / 1024 / 1024).toFixed(0)}MB) — ลองเลือกไฟล์ที่เล็กกว่านี้ หรือลดความละเอียดกล้องก่อนถ่าย`
        );
      } else {
        console.error("ProductImageSection: resizeProductImage failed", err);
        finishPendingWithProblem(item.id, "error", "ย่อรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
      return;
    }

    updatePendingStatus(item.id, "uploading");
    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("md", variants.md.blob, `${item.id}_md.jpg`);
    fd.set("sm", variants.sm.blob, `${item.id}_sm.jpg`);
    const result = await uploadProductImage(fd);
    if (!result.ok) {
      finishPendingWithProblem(item.id, "error", result.error);
      return;
    }

    setImages((prev) => [
      ...prev,
      {
        id: result.data.imageId,
        productId,
        mdUrl: result.data.mdUrl,
        smUrl: result.data.smUrl,
        sortOrder: prev.length,
        width: variants.md.width,
        height: variants.md.height,
        bytes: variants.md.bytes,
        createdAt: new Date().toISOString(),
      },
    ]);
    removePending(item.id);
    bumpBatchDone();
    router.refresh(); // keeps the 303-row table's thumbnail column + primaryImageUrl in sync
  }

  function pump() {
    while (activeCountRef.current < UPLOAD_CONCURRENCY && queueRef.current.length > 0) {
      const item = queueRef.current.shift();
      if (!item) break;
      activeCountRef.current += 1;
      void runItem(item).finally(() => {
        activeCountRef.current -= 1;
        pump();
      });
    }
  }

  function enqueueFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !productId) return;
    const files = Array.from(fileList);

    const activeSlots =
      images.length + pending.filter((p) => p.status !== "error" && p.status !== "heic").length;
    const remaining = Math.max(0, MAX_IMAGES_PER_SKU - activeSlots);
    const toAdd = files.slice(0, remaining);
    const overflow = files.length - toAdd.length;

    setOverflowWarning(overflow > 0 ? `เก็บได้อีก ${remaining} รูป — ตัด ${overflow} รูปสุดท้ายออก` : null);
    if (toAdd.length === 0) return;

    const newItems: PendingUpload[] = toAdd.map((file) => ({ id: newClientId(), file, status: "queued" }));
    setPending((prev) => [...prev, ...newItems]);
    setBatch((prev) => (prev ? { done: prev.done, total: prev.total + newItems.length } : { done: 0, total: newItems.length }));
    queueRef.current.push(...newItems);
    pump();
  }

  function retryPending(item: PendingUpload) {
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "queued", errorMessage: undefined } : p)));
    setBatch((prev) => (prev ? { done: prev.done, total: prev.total + 1 } : { done: 0, total: 1 }));
    queueRef.current.push(item);
    pump();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    enqueueFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same filename later
  }

  // ----- reorder / delete -----
  async function moveImage(index: number, direction: -1 | 1) {
    if (!productId) return;
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= images.length) return;
    const prevImages = images;
    const next = [...images];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setImages(next);
    setReorderPending(true);
    const result = await reorderProductImages(
      productId,
      next.map((i) => i.id)
    );
    setReorderPending(false);
    if (!result.ok) {
      setImages(prevImages);
      toast.push(result.error, "error");
      return;
    }
    router.refresh();
  }

  async function handleDelete(img: ProductImageRow) {
    setDeletingIds((s) => new Set(s).add(img.id));
    const result = await deleteProductImage(img.id);
    setDeletingIds((s) => {
      const n = new Set(s);
      n.delete(img.id);
      return n;
    });
    if (!result.ok) {
      toast.push(result.error, "error");
      return;
    }
    setImages((prev) => prev.filter((i) => i.id !== img.id));
    toast.push("ลบรูปแล้ว");
    router.refresh();
  }

  const headerRow = (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold text-zinc-600">
        รูปสินค้า (สูงสุด {MAX_IMAGES_PER_SKU} รูป) — รูปแรก = รูปหลัก ใช้ในตาราง/ใบเสนอราคา
      </p>
      {batch && (
        <span className="shrink-0 text-xs font-medium text-zinc-500">
          กำลังประมวลผล {batch.done}/{batch.total} รูป
        </span>
      )}
    </div>
  );

  // ----- locked (SKU not saved yet) -----
  if (!product) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 opacity-60" aria-disabled="true">
        {headerRow}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-zinc-200" aria-hidden="true" />
          ))}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          บันทึก SKU ก่อน ถึงจะเพิ่มรูปได้
        </p>
      </div>
    );
  }

  const activeSlots = images.length + pending.filter((p) => p.status !== "error" && p.status !== "heic").length;
  const atCap = activeSlots >= MAX_IMAGES_PER_SKU;
  const isEmpty = images.length === 0 && pending.length === 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
      {headerRow}

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="status" aria-label="กำลังโหลดรูปสินค้า">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : fetchError ? (
        <ErrorBanner message={fetchError} onRetry={() => productId && loadImages(productId)} />
      ) : isEmpty ? (
        <EmptyState
          icon={ImageOff}
          title="ยังไม่มีรูปสินค้านี้"
          description="เพิ่มรูปแรกได้เลย"
          action={
            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-4 text-center hover:border-primary-400 hover:bg-primary-50">
              <Plus className="h-5 w-5 text-zinc-400" aria-hidden="true" />
              <span className="text-xs font-medium text-zinc-600">เลือกรูป (เลือกได้หลายไฟล์)</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleFileInputChange} />
            </label>
          }
        />
      ) : (
        <>
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {images.map((img, idx) => (
                <ImageCell
                  key={img.id}
                  img={img}
                  index={idx}
                  isFirst={idx === 0}
                  isLast={idx === images.length - 1}
                  disabled={anyMutationPending}
                  deleting={deletingIds.has(img.id)}
                  onMoveLeft={() => void moveImage(idx, -1)}
                  onMoveRight={() => void moveImage(idx, 1)}
                  onDelete={() => void handleDelete(img)}
                />
              ))}
            </div>
          )}

          <label
            className={`flex w-fit items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 ${
              atCap ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-zinc-50"
            }`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มรูป
            <span className="text-zinc-400">(เลือกได้หลายไฟล์)</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={atCap}
              onChange={handleFileInputChange}
            />
          </label>
        </>
      )}

      {overflowWarning && <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">{overflowWarning}</p>}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          {pending.map((item) => (
            <PendingRow key={item.id} item={item} onRemove={() => removePending(item.id)} onRetry={() => retryPending(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageCell({
  img,
  index,
  isFirst,
  isLast,
  disabled,
  deleting,
  onMoveLeft,
  onMoveRight,
  onDelete,
}: {
  img: ProductImageRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  deleting: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
}) {
  const url = img.smUrl; // already-signed URL (getProductImages/uploadProductImage) — nothing to construct here
  return (
    <div className="relative aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage image, not a next/image candidate here (see catalog table's own no-next/image note)
        <img
          src={url}
          alt={`รูปสินค้าลำดับที่ ${index + 1}`}
          className={`h-full w-full object-cover ${deleting ? "opacity-40" : ""}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-300">
          <ImageOff className="h-6 w-6" aria-hidden="true" />
        </div>
      )}

      {isFirst && (
        <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-800">
          <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden="true" />
          หลัก
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`ลบรูปลำดับที่ ${index + 1}`}
        className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-zinc-600 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
      </button>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/40 to-transparent px-0.5 pb-0.5 pt-3">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={disabled || isFirst}
          aria-label={`เลื่อนรูปลำดับที่ ${index + 1} ไปทางซ้าย`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={disabled || isLast}
          aria-label={`เลื่อนรูปลำดับที่ ${index + 1} ไปทางขวา`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function PendingRow({ item, onRemove, onRetry }: { item: PendingUpload; onRemove: () => void; onRetry: () => void }) {
  if (item.status === "heic") {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">ไฟล์นี้เป็น HEIC เบราว์เซอร์เปิดไม่ได้ ({item.file.name})</p>
            <p className="mt-1 font-medium">วิธีแก้:</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>
                iPhone: ตั้งค่า &gt; กล้อง &gt; รูปแบบ &gt; &quot;ประสิทธิภาพสูงสุด&quot; เปลี่ยนเป็น &quot;รองรับมากที่สุด&quot;
                แล้วถ่ายใหม่
              </li>
              <li>หรือส่งรูปผ่าน LINE ก่อน (LINE แปลงเป็น JPG ให้อัตโนมัติ)</li>
            </ul>
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="min-h-9 rounded-md border border-amber-300 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            เอาออกจากรายการ
          </button>
        </div>
      </div>
    );
  }

  if (item.status === "error") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {item.file.name}: {item.errorMessage ?? "อัปโหลดไม่สำเร็จ"}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onRetry} className="min-h-9 rounded-md border border-red-300 px-2.5 font-medium hover:bg-red-100">
            ลองใหม่
          </button>
          <button type="button" onClick={onRemove} className="min-h-9 rounded-md px-2.5 font-medium underline underline-offset-2">
            เอาออก
          </button>
        </div>
      </div>
    );
  }

  const label = item.status === "resizing" ? "กำลังย่อรูป…" : item.status === "uploading" ? "กำลังอัปโหลด…" : "รอคิว…";
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="truncate">{item.file.name}</span>
      <span className="ml-auto shrink-0 text-zinc-400">{label}</span>
    </div>
  );
}
