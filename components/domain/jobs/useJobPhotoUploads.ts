"use client";

// useJobPhotoUploads — คิวอัปโหลดรูปใบงาน (ออฟฟิศ) · ลอก logic pump/enqueue/retry จาก ProductImageSection (ไม่แก้ไฟล์แคตตาล็อก)
// ทีละ 2 (มือถือรุ่นล่าง/เน็ตช่าง) · ทุกรูปผ่าน resizeImageVariants (ย่อ + re-encode canvas = ลบ EXIF/GPS) ก่อนส่งเสมอ — ไม่ส่งไฟล์ดิบ
// phase: queued → resizing → uploading → (สำเร็จ = ออกจากคิวแล้วส่งแถวจริงให้ onUploaded | error)
// ส่งล้ม: รู้ว่าลองใหม่ช่วยไหม (HEIC/ไฟล์เสีย/ไฟล์ใหญ่/ครบเพดาน = ไม่ช่วย → มีแต่ "เอาออก") · ไม่ส่งอัตโนมัติเมื่อเน็ตกลับ (ไม่ใช่ offline queue)
// beforeunload เมื่อยังมีรูปที่ไม่เสร็จ (ส่งอยู่/คิว/ล้มค้าง) — ปิดหน้า = รูปที่ถ่ายไว้หาย

import { useCallback, useEffect, useRef, useState } from "react";
import { HeicNotSupportedError, ImageDecodeError, ImageTooLargeError, SourceImageTooLargeError, resizeImageVariants } from "@/lib/images/client";
import type { ImageVariants } from "@/lib/images/client";
import type { JobPhotoRow } from "@/lib/jobs/photos";

/** ทำพร้อมกันกี่รูป (แคตตาล็อกใช้ 3 — ใบงานใช้ 2 ตาม ux §7) */
export const UPLOAD_CONCURRENCY = 2;

export type UploadPhase = "queued" | "resizing" | "uploading" | "error";

export interface UploadItem {
  id: string;
  fileName: string;
  phase: UploadPhase;
  /** เหตุผลสั้นของ error (≤ 2 บรรทัด) */
  message: string | null;
  /** error ที่ลองใหม่ช่วยได้ (เน็ต/ชั่วคราว) — false = ไฟล์/ใบมีปัญหา มีแต่ "เอาออก" */
  retryable: boolean;
  /** ภาพย่อที่ย่อแล้ว (blob URL) ระหว่างส่ง — null ถ้าเบราว์เซอร์สร้างไม่ได้ */
  previewUrl: string | null;
}

export type SendResult = { ok: true; data: JobPhotoRow } | { ok: false; error: string; code?: string };

/** code ของด่านรูปที่ลองใหม่ไม่ช่วย (เต็ม/ไม่มีใบ/ไฟล์ไม่ถูกต้อง) */
const NO_RETRY_CODES: ReadonlySet<string> = new Set(["photo_cap_ref", "photo_cap_total", "photo_budget", "lot_no_photo", "job_not_found", "photo_bytes_invalid", "photo_dims_invalid"]);

export const HEIC_MESSAGE = "ไฟล์ HEIC เปิดไม่ได้ — iPhone: ตั้งค่า > กล้อง > รูปแบบ > รองรับมากที่สุด แล้วถ่ายใหม่ หรือส่งผ่าน LINE ก่อน";

/** error ตอนย่อรูป (ข้อความเดียวกับ ProductImageSection) → เหตุผล + ลองใหม่ช่วยไหม */
export function describeResizeError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof HeicNotSupportedError) return { message: HEIC_MESSAGE, retryable: false };
  if (err instanceof ImageTooLargeError) return { message: "ไฟล์รูปใหญ่เกินไป แม้ลดคุณภาพแล้วก็ยังเกิน 1MB — ลองถ่ายรูปใหม่ที่ความละเอียดต่ำกว่านี้", retryable: false };
  if (err instanceof ImageDecodeError) return { message: "เปิดไฟล์รูปนี้ไม่ได้ (ไฟล์เสียหรือไม่ใช่รูปภาพ) — ลองไฟล์อื่น", retryable: false };
  if (err instanceof SourceImageTooLargeError) return { message: `ไฟล์ต้นฉบับใหญ่เกินไป (${(err.bytes / 1024 / 1024).toFixed(0)}MB) — ลองเลือกไฟล์ที่เล็กกว่านี้ หรือลดความละเอียดกล้องก่อนถ่าย`, retryable: false };
  return { message: "ย่อรูปไม่สำเร็จ ลองใหม่อีกครั้ง", retryable: true };
}

const newId = (): string => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** ภาพย่อระหว่างส่งเป็นแค่ความสวยงาม — สร้างไม่ได้/โยน exception ต้องไม่ทำให้การอัปโหลดล้ม */
const makePreview = (b: Blob): string | null => {
  try {
    return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(b) : null;
  } catch {
    return null;
  }
};
const dropPreview = (u: string | null): void => {
  if (u && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(u);
};

export function useJobPhotoUploads({
  send,
  onUploaded,
  resize = resizeImageVariants,
}: {
  /** ส่ง variants (md+sm ที่ย่อแล้ว) ไป server — ผู้เรียกประกอบ FormData + เรียก action */
  send: (variants: ImageVariants) => Promise<SendResult>;
  /** แถวจริงที่ server ตอบกลับ (รูปออกจากคิวแล้ว) */
  onUploaded: (row: JobPhotoRow) => void;
  /** ฉีดได้เพื่อทดสอบ (canvas ไม่ทำงานใน jsdom) */
  resize?: (file: File) => Promise<ImageVariants>;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [online, setOnline] = useState(true);
  const files = useRef(new Map<string, File>());
  const previews = useRef(new Map<string, string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const fnRef = useRef({ send, onUploaded, resize });
  useEffect(() => {
    fnRef.current = { send, onUploaded, resize };
  });

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    if (!alive.current) return;
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const finish = useCallback((id: string) => {
    files.current.delete(id);
    dropPreview(previews.current.get(id) ?? null);
    previews.current.delete(id);
    if (alive.current) setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const run = useCallback(
    async (id: string) => {
      const file = files.current.get(id);
      if (!file) return;
      patch(id, { phase: "resizing", message: null });
      let variants: ImageVariants;
      try {
        variants = await fnRef.current.resize(file);
      } catch (err) {
        const d = describeResizeError(err);
        patch(id, { phase: "error", message: d.message, retryable: d.retryable });
        return;
      }
      if (!alive.current) return;
      dropPreview(previews.current.get(id) ?? null);
      const url = makePreview(variants.sm.blob);
      if (url) previews.current.set(id, url);
      patch(id, { phase: "uploading", previewUrl: url });
      let res: SendResult;
      try {
        res = await fnRef.current.send(variants);
      } catch {
        patch(id, { phase: "error", message: typeof navigator !== "undefined" && navigator.onLine === false ? "ไม่มีเน็ต" : null, retryable: true });
        return;
      }
      if (!res.ok) {
        patch(id, { phase: "error", message: res.error, retryable: !(res.code && NO_RETRY_CODES.has(res.code)) });
        return;
      }
      finish(id);
      fnRef.current.onUploaded(res.data);
    },
    [patch, finish],
  );

  const pump = useCallback(() => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length > 0) {
      const id = queue.current.shift();
      if (!id) break;
      active.current += 1;
      void run(id).finally(() => {
        active.current -= 1;
        pump();
      });
    }
  }, [run]);

  const enqueue = useCallback(
    (list: File[]) => {
      if (list.length === 0) return;
      const fresh: UploadItem[] = list.map((f) => {
        const id = newId();
        files.current.set(id, f);
        return { id, fileName: f.name, phase: "queued", message: null, retryable: true, previewUrl: null };
      });
      setItems((prev) => [...prev, ...fresh]);
      queue.current.push(...fresh.map((x) => x.id));
      pump();
    },
    [pump],
  );

  const retry = useCallback(
    (id: string) => {
      if (!files.current.has(id)) return;
      setItems((prev) => prev.map((it) => (it.id === id && it.phase === "error" && it.retryable ? { ...it, phase: "queued", message: null } : it)));
      if (!queue.current.includes(id)) queue.current.push(id);
      pump();
    },
    [pump],
  );

  const retryAll = useCallback(
    (ids: string[]) => {
      for (const id of ids) retry(id);
    },
    [retry],
  );

  const remove = useCallback(
    (id: string) => {
      queue.current = queue.current.filter((q) => q !== id);
      finish(id);
    },
    [finish],
  );

  // เน็ตหลุด/กลับมา (ไม่ส่งซ้ำเอง — ผู้ใช้แตะรูปสีแดง)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const busy = items.length > 0;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    alive.current = true;
    const pv = previews.current;
    return () => {
      alive.current = false;
      for (const u of pv.values()) dropPreview(u);
      pv.clear();
    };
  }, []);

  return { items, online, busy, enqueue, retry, retryAll, remove };
}
