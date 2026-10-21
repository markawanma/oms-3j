"use client";

// useShopPhotos — state ของ "รูปจากหน้างาน" ทั้งวงจรบนมือถือผู้จัดการ (W2): เลือก/ถ่าย → ย่อ (ทีละรูป) → เก็บในเครื่อง → ส่งทีละรูปหลังเปิดใบสำเร็จ → ลบ/ตั้งรูปหลัก/ลองใหม่
// รวม draft + uploads ไว้ตัวเดียว (ต่างจากข้อเสนอใน UX §10 ที่แยกสองตัว): รูป 1 รูปมี phase เดียวไล่ resizing → ready → queued → uploading → done|error|locked
// ทำให้ "เพิ่มรูปหลังเปิด" (ย่อ → เข้าคิวเอง) และ "จอแก้รูป W-10" ใช้ตัวเดียวกับ W-5/W-8 โดยไม่ซ้ำโค้ด
//
// 🔴 ไฟล์นี้เป็นไฟล์เดียวในกราฟ /w/s/ ที่ import lib/images/client (ย่อรูปด้วย canvas) — อยู่ใน IMAGES_CLIENT_ALLOWED_IMPORTERS ของ worker-boundary.shop.test
// 🔴 ไม่เรียก server action เอง: io (upload/remove/list/setPrimary) ถูกฉีดเข้ามา (container ที่ import lib/actions/job-worker เป็นคนส่ง) → ทดสอบได้โดยไม่ mock module + ไม่ผูกกับ "use server"
// กติกาที่ต้องไม่พัง:
//  • ส่งทีละรูป (concurrency 1) เรียงรูปหลักก่อน — server ตั้งรูปแรกที่ส่งสำเร็จเป็นรูปหลัก ส่งขนานแล้วรูปหลักสลับเงียบๆ (A5 พิมพ์ผิดรูป)
//  • กันรูปซ้ำ: ทุกรูปมี clientPhotoKey (uuid สร้างครั้งเดียวตอนเลือก ใช้ซ้ำตอนลองใหม่) — ส่งแล้วไม่ทราบผล (คำขอหลุดกลางทาง) ลองใหม่ = server คืนรูปเดิม (already:true) ไม่สร้างซ้ำ
//  • ช่างรับงานแล้ว/ใบปิด (code จาก server) = ล็อกทั้งใบ: รูปที่ยังไม่ส่งกลายเป็น locked ไม่ส่งต่อ
//  • blob URL ถูก revoke ทุกครั้งที่เอาออก/ล้าง/ออกจากจอ · ไม่เขียน storage/URL/log · wake lock เฉพาะช่วงที่มีรูปรอส่ง

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resizeImageVariants } from "@/lib/images/client";
import type { ImageVariants } from "@/lib/images/client";
import { SHOP_PHOTO_MAX, SHOP_PHOTO_TH, describeShopResizeError, normalizePrimary, photoActionErrorMessage, photoErrorView, photosSummary, uploadOrder } from "@/lib/jobs/shop-photos";
import type { PhotoFail, ShopPhotoItem, ShopPhotoLock, ShopPhotosSummary } from "@/lib/jobs/shop-photos";
import { useWakeLock } from "@/components/domain/jobs/worker/shop/useWakeLock";

/** อ้างใบ: เพิ่งเปิดใบในจอนี้ = idem key เดียวกับที่เปิดใบ · มาจากรายการ "ใบที่ฉันเปิด" = job id */
export type PhotoRef = { idemKey: string } | { jobId: string };

export interface ServerPhoto {
  id: string;
  smUrl: string | null;
  mdUrl: string | null;
  isPrimary: boolean;
  /** รูปที่ผู้จัดการคนนี้แนบเอง (รูปออฟฟิศ/แคตตาล็อก = false) */
  mine: boolean;
}

type Fail = { ok: false; error: string; code?: string; retryAfterSeconds?: number };

export interface ShopPhotoIo {
  upload: (fd: FormData) => Promise<{ ok: true; photo: ServerPhoto; count: number; max: number } | Fail>;
  remove: (photoId: string) => Promise<{ ok: true; promotedPhotoId: string | null; already: boolean } | Fail>;
  list: (ref: PhotoRef) => Promise<{ ok: true; photos: ServerPhoto[]; count: number; max: number; locked: boolean; lockCode: string | null } | Fail>;
  /** ตั้งรูปที่ "ส่งแล้ว" เป็นรูปหลัก (intakeSetPrimaryPhoto) · ไม่มี = ปุ่ม ★ ของรูปที่ส่งแล้วซ่อน */
  setPrimary?: (ref: PhotoRef, photoId: string) => Promise<{ ok: true; changed?: boolean } | Fail>;
}

export interface ShopPhotoRejection {
  id: string;
  text: string;
}

export type PhotoActionResult = { ok: true } | { ok: false; message: string };

/** uuid v4 (ต้องเป็น uuid จริง — ใช้เป็น clientPhotoKey ที่ server ตรวจรูปแบบ) · ไม่มี crypto.randomUUID = ประกอบจาก getRandomValues → ไม่มี crypto เลย = Math.random (ไม่ใช่ความลับ ใช้กันซ้ำเท่านั้น) */
const newKey = (): string => {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** ภาพย่อ/ภาพกลางในเครื่องเป็นแค่ความสวยงาม — สร้างไม่ได้/โยน exception ต้องไม่ทำให้การส่งล้ม */
const makeUrl = (b: Blob): string | null => {
  try {
    return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(b) : null;
  } catch {
    return null;
  }
};
const dropUrl = (u: string): void => {
  try {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(u);
  } catch {
    // ไม่ทำอะไร — revoke ล้มไม่ใช่ปัญหาของผู้ใช้
  }
};

const blank = (key: string): ShopPhotoItem => ({ key, phase: "resizing", isPrimary: false, serverPrimary: false, saved: false, serverId: null, smUrl: null, mdUrl: null, message: null, retryable: true, needsPin: false, maybeSent: false });

const LOCK_MESSAGE: Record<ShopPhotoLock, string> = { locked: SHOP_PHOTO_TH.lockedUnsent, closed: SHOP_PHOTO_TH.failClosed, not_open: SHOP_PHOTO_TH.failNotOpen, not_owner: SHOP_PHOTO_TH.failNotOwner };

/** lock_code ของ list → ชนิดล็อก */
function lockKindOf(code: string | null): ShopPhotoLock {
  if (code === "job_cancelled" || code === "job_closed") return "closed";
  if (code === "job_not_open") return "not_open"; // ไม่ใช่ปิด/ยกเลิก — คำกลาง "แก้ไม่ได้ตอนนี้"
  return "locked";
}

export function useShopPhotos({
  io,
  resize = resizeImageVariants,
  enforcePrimary = true,
}: {
  io: ShopPhotoIo;
  /** ฉีดได้เพื่อทดสอบ (canvas ไม่ทำงานใน jsdom) */
  resize?: (file: File) => Promise<ImageVariants>;
  /** true = มีรูป ≥ 1 ⇒ มีรูปหลักพอดี 1 (ฟอร์มเปิดใบ/ใบที่เพิ่งเปิด) · false = ตามที่ server บอก (W-10: รูปหลักอาจเป็นของออฟฟิศ) */
  enforcePrimary?: boolean;
}) {
  const [items, setItems] = useState<ShopPhotoItem[]>([]);
  const [rejections, setRejections] = useState<ShopPhotoRejection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [lock, setLockState] = useState<ShopPhotoLock | null>(null);
  const [started, setStarted] = useState(false);
  const [online, setOnline] = useState(true);

  const itemsRef = useRef<ShopPhotoItem[]>([]);
  const lockRef = useRef<ShopPhotoLock | null>(null);
  const refRef = useRef<PhotoRef | null>(null);
  const files = useRef(new Map<string, File>());
  const labels = useRef(new Map<string, number | null>());
  const blobs = useRef(new Map<string, { md: Blob; sm: Blob }>());
  const urls = useRef(new Map<string, string[]>());
  const resizeQueue = useRef<string[]>([]);
  const resizing = useRef(false);
  const pumping = useRef(false);
  const alive = useRef(true);
  const gen = useRef(0);
  const fns = useRef({ io, resize, enforcePrimary });
  useEffect(() => {
    fns.current = { io, resize, enforcePrimary };
  });

  const commit = useCallback((next: ShopPhotoItem[]) => {
    const n = fns.current.enforcePrimary ? normalizePrimary(next) : next;
    itemsRef.current = n;
    if (alive.current) setItems(n);
  }, []);
  const mutate = useCallback((fn: (cur: ShopPhotoItem[]) => ShopPhotoItem[]) => commit(fn(itemsRef.current)), [commit]);
  const patch = useCallback((key: string, p: Partial<ShopPhotoItem>) => mutate((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), [mutate]);

  const releaseUrls = useCallback((key: string) => {
    for (const u of urls.current.get(key) ?? []) dropUrl(u);
    urls.current.delete(key);
    blobs.current.delete(key);
    files.current.delete(key);
    labels.current.delete(key);
  }, []);

  const setLock = useCallback((k: ShopPhotoLock | null) => {
    lockRef.current = k;
    if (alive.current) setLockState(k);
  }, []);

  /** ทั้งใบล็อก (ช่างรับงานแล้ว/ใบปิด/ไม่ใช่ผู้เปิด): รูปที่ยังไม่ถึง server กลายเป็น locked — ไม่ส่งต่อ ไม่ให้ลองใหม่ */
  const lockAll = useCallback(
    (kind: ShopPhotoLock) => {
      setLock(kind);
      mutate((cur) => {
        // ★ ที่ติดอยู่กับรูปที่ไม่มีวันถึง server (locked) ต้องย้อนไปรูปหลักจริงบน server (ถ้ามี) — ไม่งั้นจอบอกว่าช่างจะเห็นรูปที่ไม่เคยถึงเขา
        const realPrimary = cur.find((i) => i.serverId !== null && i.serverPrimary);
        const next = cur.map((i) => {
          if (i.serverId !== null || i.phase === "resizing") return i;
          return { ...i, phase: "locked" as const, message: LOCK_MESSAGE[kind], retryable: false, needsPin: false, isPrimary: realPrimary ? false : i.isPrimary };
        });
        return realPrimary && !next.some((i) => i.isPrimary) ? next.map((i) => (i.key === realPrimary.key ? { ...i, isPrimary: true } : i)) : next;
      });
    },
    [mutate, setLock],
  );

  const reject = useCallback(
    (key: string, text: string) => {
      const n = labels.current.get(key) ?? null;
      const full = n !== null ? `รูปที่ ${n} ที่เลือก — ${text}` : text;
      releaseUrls(key);
      mutate((cur) => cur.filter((i) => i.key !== key));
      if (alive.current) setRejections((r) => [{ id: newKey(), text: full }, ...r].slice(0, 3));
    },
    [mutate, releaseUrls],
  );

  /** รับผลสำเร็จของรูป (จากการส่ง หรือจากการเทียบรายการกับ server) */
  const markDone = useCallback(
    (key: string, photo: ServerPhoto) => {
      mutate((cur) => {
        const otherIntent = cur.some((o) => o.key !== key && o.isPrimary && o.phase !== "done");
        const takesStar = photo.isPrimary && !otherIntent;
        return cur.map((i) => {
          if (i.key === key) return { ...i, phase: "done", serverId: photo.id, serverPrimary: photo.isPrimary, isPrimary: photo.isPrimary ? takesStar : false, message: null, retryable: false, needsPin: false };
          if (photo.isPrimary) return { ...i, serverPrimary: false, isPrimary: takesStar ? false : i.isPrimary };
          return i;
        });
      });
    },
    [mutate],
  );

  const uploadOne = useCallback(
    async (key: string) => {
      const ref = refRef.current;
      const b = blobs.current.get(key);
      const g = gen.current;
      const it = itemsRef.current.find((i) => i.key === key);
      if (!it || !ref) return;
      if (!b) {
        patch(key, { phase: "error", message: SHOP_PHOTO_TH.failGeneric, retryable: false });
        return;
      }
      patch(key, { phase: "uploading", message: null, needsPin: false });
      const fd = new FormData();
      if ("idemKey" in ref) fd.set("idemKey", ref.idemKey);
      else fd.set("jobId", ref.jobId);
      fd.set("md", b.md, "md.jpg");
      fd.set("sm", b.sm, "sm.jpg");
      // idempotency ต่อรูป: key สร้างครั้งเดียวตอนเลือกรูป (item.key = uuid) ใช้ซ้ำทุกครั้งที่ลองใหม่ — ส่งแล้วไม่ทราบผล (เน็ตหลุด) กดลองใหม่ = server คืนรูปเดิม (already) ไม่สร้างซ้ำ
      fd.set("clientPhotoKey", key);
      if (itemsRef.current.find((i) => i.key === key)?.isPrimary) fd.set("isPrimary", "true");
      let res: Awaited<ReturnType<ShopPhotoIo["upload"]>>;
      try {
        res = await fns.current.io.upload(fd);
      } catch {
        if (g !== gen.current) return;
        patch(key, { phase: "error", message: typeof navigator !== "undefined" && navigator.onLine === false ? SHOP_PHOTO_TH.failNet : SHOP_PHOTO_TH.failGeneric, retryable: true, maybeSent: true });
        return;
      }
      if (g !== gen.current || !alive.current) return;
      patch(key, { maybeSent: false }); // server ตอบแล้ว = รู้ผลชัดเจน (สำเร็จหรือปฏิเสธ)
      if (res.ok) {
        // res.already = key เดิมเคยแนบสำเร็จแล้ว (คำขอก่อนหน้าถึง server แต่ตอบไม่ถึง) → ถือว่าสำเร็จ รูปเดิมไม่ซ้ำ
        markDone(key, res.photo);
        return;
      }
      const v = photoErrorView(res as PhotoFail);
      if (v.lock) {
        lockAll(v.lock);
        return;
      }
      if (v.quota) {
        // โควตาร้าน/ช่างเต็ม (M1): รูปที่เหลือในคิวจะล้มเหมือนกัน — พักไว้ทั้งชุด ไม่ยิงซ้ำให้ล้มทีละรูป · ลองใหม่ไม่ช่วย (มีแต่ "เอาออก")
        mutate((cur) => cur.map((i) => (i.key === key || i.phase === "queued" ? { ...i, phase: "error", message: v.message, retryable: false } : i)));
        return;
      }
      if (v.needsPin) {
        // session หมดกลางคิว: รูปที่เหลือไม่ต้องยิงซ้ำให้ล้มทีละรูป — พักไว้ทั้งชุดจนใส่ PIN แล้วกด "ลองใหม่"
        mutate((cur) => cur.map((i) => (i.key === key || i.phase === "queued" ? { ...i, phase: "error", message: v.message, retryable: true, needsPin: true } : i)));
        return;
      }
      patch(key, { phase: "error", message: v.message, retryable: v.retryable });
    },
    [lockAll, markDone, mutate, patch],
  );

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        if (!alive.current || lockRef.current || !refRef.current) break;
        const next = uploadOrder(itemsRef.current)[0];
        if (!next) break;
        await uploadOne(next.key);
      }
    } finally {
      pumping.current = false;
    }
  }, [uploadOne]);

  const pumpResize = useCallback(async () => {
    if (resizing.current) return;
    resizing.current = true;
    try {
      while (alive.current) {
        const key = resizeQueue.current.shift();
        if (key === undefined) break;
        const file = files.current.get(key);
        if (!file || !itemsRef.current.some((i) => i.key === key)) {
          files.current.delete(key);
          continue;
        }
        const g = gen.current;
        let v: ImageVariants | null = null;
        let err: unknown = null;
        try {
          v = await fns.current.resize(file);
        } catch (e) {
          err = e;
        }
        files.current.delete(key);
        if (!alive.current) return;
        // reset ระหว่างย่อ (ล้างฟอร์ม/เปลี่ยนคน/เปิดอีกใบ): ผลของรูปเก่าทิ้ง แต่ต้อง "ทำต่อ" ไม่ใช่ return — ไม่งั้น flag resizing ถูกปล่อยโดยไม่มีใครเดินคิว
        // ของรูปที่เพิ่งเลือกใหม่หลัง reset (คิวใหม่ค้างที่ "กำลังย่อรูป…" ตลอดไป — pick() เรียก pumpResize แล้วเจอ flag ยังเป็น true จึงไม่เริ่มเอง)
        if (g !== gen.current) continue;
        if (!itemsRef.current.some((i) => i.key === key)) continue; // เอาออกระหว่างย่อ
        if (!v) {
          reject(key, describeShopResizeError(err));
          continue;
        }
        blobs.current.set(key, { md: v.md.blob, sm: v.sm.blob });
        const sm = makeUrl(v.sm.blob);
        const md = makeUrl(v.md.blob);
        urls.current.set(key, [sm, md].filter((u): u is string => u !== null));
        const phase = lockRef.current ? "locked" : refRef.current ? "queued" : "ready";
        const hasRealPrimary = itemsRef.current.some((i) => i.serverId !== null && i.serverPrimary);
        patch(key, { phase, smUrl: sm, mdUrl: md, message: phase === "locked" ? LOCK_MESSAGE[lockRef.current as ShopPhotoLock] : null, retryable: phase !== "locked", ...(phase === "locked" && hasRealPrimary ? { isPrimary: false } : {}) });
        if (phase === "queued") void pump();
      }
    } finally {
      resizing.current = false;
    }
  }, [patch, pump, reject]);

  /** เลือก/ถ่ายรูป (จาก PhotoAddButtons) — ตัดท้ายตามที่เหลือ · ย่อทีละรูป · เกินที่เหลือ = แจ้ง (ไม่ใช่ error) */
  const pick = useCallback(
    (list: File[]) => {
      if (list.length === 0 || lockRef.current) return;
      const remaining = Math.max(0, SHOP_PHOTO_MAX - itemsRef.current.length);
      if (remaining === 0) {
        setNotice(SHOP_PHOTO_TH.cutFull);
        return;
      }
      const accepted = list.slice(0, remaining);
      setNotice(list.length > remaining ? SHOP_PHOTO_TH.cutNotice(list.length, remaining) : null);
      const fresh = accepted.map((f, idx) => {
        const key = newKey();
        files.current.set(key, f);
        labels.current.set(key, list.length > 1 ? idx + 1 : null);
        return blank(key);
      });
      commit([...itemsRef.current, ...fresh]);
      resizeQueue.current.push(...fresh.map((x) => x.key));
      void pumpResize();
    },
    [commit, pumpResize],
  );

  /** เปิดใบสำเร็จ: ผูกกับใบ แล้วส่งรูปที่เก็บไว้ทีละรูป (หลักก่อน) · รูปที่เพิ่มหลังจากนี้เข้าคิวเองเมื่อย่อเสร็จ */
  const start = useCallback(
    (ref: PhotoRef) => {
      refRef.current = ref;
      setStarted(true);
      mutate((cur) => cur.map((i) => (i.phase === "ready" ? { ...i, phase: "queued" } : i)));
      void pump();
    },
    [mutate, pump],
  );

  const retry = useCallback(
    (key: string) => {
      const it = itemsRef.current.find((i) => i.key === key);
      if (!it || it.phase !== "error" || !it.retryable || lockRef.current) return;
      patch(key, { phase: "queued", message: null, needsPin: false });
      void pump();
    },
    [patch, pump],
  );

  const retryAll = useCallback(() => {
    if (lockRef.current) return;
    mutate((cur) => cur.map((i) => (i.phase === "error" && i.retryable ? { ...i, phase: "queued", message: null, needsPin: false } : i)));
    void pump();
  }, [mutate, pump]);

  const dropLocal = useCallback(
    (key: string) => {
      releaseUrls(key);
      resizeQueue.current = resizeQueue.current.filter((k) => k !== key);
      mutate((cur) => cur.filter((i) => i.key !== key));
    },
    [mutate, releaseUrls],
  );

  /** เอารูปออก: ยังไม่ถึง server = ทิ้งในเครื่องทันที · ถึง server แล้ว = ลบจริง (ผู้เรียกถามยืนยันก่อน) */
  const remove = useCallback(
    async (key: string): Promise<PhotoActionResult> => {
      const it = itemsRef.current.find((i) => i.key === key);
      if (!it) return { ok: true };
      if (it.phase === "uploading") return { ok: false, message: SHOP_PHOTO_TH.uploading };
      if (it.serverId === null) {
        dropLocal(key);
        return { ok: true };
      }
      const g = gen.current;
      let r: Awaited<ReturnType<ShopPhotoIo["remove"]>>;
      try {
        r = await fns.current.io.remove(it.serverId);
      } catch {
        return { ok: false, message: SHOP_PHOTO_TH.removeFail };
      }
      if (g !== gen.current || !alive.current) return { ok: true };
      if (!r.ok) {
        const v = photoErrorView(r as PhotoFail);
        if (v.lock) lockAll(v.lock);
        return { ok: false, message: photoActionErrorMessage(r as PhotoFail, SHOP_PHOTO_TH.removeFail) };
      }
      releaseUrls(key);
      mutate((cur) => {
        const rest = cur.filter((i) => i.key !== key);
        const promoted = r.promotedPhotoId;
        if (!promoted || !rest.some((i) => i.serverId === promoted)) return rest;
        return rest.map((i) => (i.serverId === promoted ? { ...i, isPrimary: true, serverPrimary: true } : { ...i, isPrimary: false, serverPrimary: false }));
      });
      return { ok: true };
    },
    [dropLocal, lockAll, mutate, releaseUrls],
  );

  /** ตั้งรูปหลัก: รูปในเครื่อง = สลับดาวทันที (ส่งตอนอัปโหลด) · รูปที่ส่งแล้ว = ต้องมี io.setPrimary (ไม่มี = ปุ่มซ่อน) */
  const setPrimary = useCallback(
    async (key: string): Promise<PhotoActionResult> => {
      const it = itemsRef.current.find((i) => i.key === key);
      if (!it || it.isPrimary) return { ok: true };
      const flip = (cur: ShopPhotoItem[]) => cur.map((i) => ({ ...i, isPrimary: i.key === key }));
      if (it.serverId === null) {
        mutate(flip);
        return { ok: true };
      }
      const fn = fns.current.io.setPrimary;
      const ref = refRef.current;
      if (!fn || !ref) return { ok: false, message: SHOP_PHOTO_TH.primaryFail };
      // ย้อนเฉพาะ "ฟิลด์ดาว" ของรูปที่มีอยู่ตอนกด — ห้าม commit snapshot ทั้งก้อน (รูปอื่นที่ส่งเสร็จ/ล้ม/ถูกลบระหว่างรอ server จะย้อนกลับเป็นสถานะเก่าไปด้วย)
      const flags = new Map(itemsRef.current.map((i) => [i.key, { isPrimary: i.isPrimary, serverPrimary: i.serverPrimary }]));
      const rollback = () => mutate((cur) => cur.map((i) => (flags.has(i.key) ? { ...i, ...flags.get(i.key) } : i)));
      mutate((cur) => cur.map((i) => ({ ...i, isPrimary: i.key === key, serverPrimary: i.key === key })));
      let r: Awaited<ReturnType<NonNullable<ShopPhotoIo["setPrimary"]>>>;
      try {
        r = await fn(ref, it.serverId);
      } catch {
        rollback();
        return { ok: false, message: SHOP_PHOTO_TH.primaryFail };
      }
      if (!r.ok) {
        rollback();
        const v = photoErrorView(r as PhotoFail);
        if (v.lock) lockAll(v.lock);
        return { ok: false, message: photoActionErrorMessage(r as PhotoFail, SHOP_PHOTO_TH.primaryFail) };
      }
      return { ok: true };
    },
    [lockAll, mutate],
  );

  /**
   * จอแก้รูป W-10: รวมรายการจาก server (เฉพาะของตัวเอง) เข้ากับของในเครื่อง — "merge" ไม่ใช่ replace
   * • รูปที่ server รู้จัก (saved) = ใช้ของ server (ลิงก์ใหม่ · ถูกลบที่อื่นแล้วหาย)
   * • รูปที่เพิ่งส่งสำเร็จในจอนี้แต่ยังไม่อยู่ใน list (list อ่านที่ server ก่อนรูปลงทะเบียน แล้วผลมาถึงช้ากว่า) = ต้องไม่หาย — ไม่งั้นตัวนับ n/3 ผิดแล้วผู้จัดการเพิ่มรูปที่ 4 ที่ DB ไม่รับ
   * • รูปในเครื่องที่ยังไม่ส่ง คงไว้
   */
  const loadServer = useCallback(
    (res: { photos: ServerPhoto[]; locked: boolean; lockCode: string | null }) => {
      const mine = res.photos.filter((p) => p.mine);
      const listIds = new Set(mine.map((p) => p.id));
      const cur = itemsRef.current;
      const sessionDone = cur.filter((i) => i.serverId !== null && !i.saved);
      const staleMissing = sessionDone.filter((i) => !listIds.has(i.serverId as string));
      const localById = new Map(sessionDone.filter((i) => listIds.has(i.serverId as string)).map((i) => [i.serverId as string, i]));
      // รูปที่ server รู้จัก: ถ้าเพิ่งส่งในจอนี้ ใช้ภาพในเครื่องต่อ (ไม่กระพริบ ไม่เปลี่ยน blob) แต่ดาวตาม server · ไม่งั้นใช้ของ server
      const merged: ShopPhotoItem[] = mine.map((p) => {
        const local = localById.get(p.id);
        if (local) return { ...local, isPrimary: p.isPrimary, serverPrimary: p.isPrimary };
        return { ...blank(`srv-${p.id}`), phase: "done", saved: true, serverId: p.id, smUrl: p.smUrl, mdUrl: p.mdUrl, isPrimary: p.isPrimary, serverPrimary: p.isPrimary, retryable: false };
      });
      for (const i of cur) if (i.serverId !== null && i.saved) releaseUrls(i.key);
      // list เก่า: รูปที่เพิ่งส่งถือดาวอยู่ → ดาวของ list ที่ไม่ตรงถูกถอน (ไม่ให้มีสองดวง)
      const keepStar = staleMissing.some((i) => i.isPrimary);
      const listPart = keepStar ? merged.map((i) => (i.isPrimary ? { ...i, isPrimary: false } : i)) : merged;
      mutate((now) => [...listPart, ...staleMissing.map((s) => now.find((i) => i.key === s.key) ?? s), ...now.filter((i) => i.serverId === null)]);
      if (res.locked) lockAll(lockKindOf(res.lockCode));
      else setLock(null);
    },
    [lockAll, mutate, releaseUrls, setLock],
  );

  /** ล้างทั้งหมด (เปิดอีกใบ/เปลี่ยนคน/ออกจากจอ) — revoke blob URL ทุกอัน · งานที่ค้างอยู่ในอากาศถูกทิ้งผล */
  const reset = useCallback(() => {
    gen.current += 1;
    for (const key of [...urls.current.keys()]) releaseUrls(key);
    files.current.clear();
    labels.current.clear();
    blobs.current.clear();
    resizeQueue.current = [];
    refRef.current = null;
    itemsRef.current = [];
    lockRef.current = null;
    if (alive.current) {
      setItems([]);
      setRejections([]);
      setNotice(null);
      setLockState(null);
      setStarted(false);
    }
  }, [releaseUrls]);

  const dismissRejection = useCallback((id: string) => setRejections((r) => r.filter((x) => x.id !== id)), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // เน็ตหลุด/กลับมา (ไม่ส่งซ้ำเอง — ผู้ใช้แตะ "ลองใหม่")
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

  const sendingNow = started && items.some((i) => i.phase === "queued" || i.phase === "uploading");
  // beforeunload: รูปที่ยังไม่ถึง server หลังเปิดใบแล้ว (ล็อกแล้ว = ส่งต่อไม่ได้ จึงไม่เตือน) · iOS ไม่เรียกเสมอ — ข้อความบนจอคือด่านหลัก
  const pendingAfterOpen = started && lock === null && items.some((i) => i.serverId === null && (i.phase === "queued" || i.phase === "uploading" || i.phase === "error"));
  useEffect(() => {
    if (!pendingAfterOpen) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingAfterOpen]);
  useWakeLock(sendingNow);

  useEffect(() => {
    alive.current = true;
    const u = urls.current;
    return () => {
      alive.current = false;
      for (const list of u.values()) for (const x of list) dropUrl(x);
      u.clear();
    };
  }, []);

  const summary: ShopPhotosSummary = useMemo(() => photosSummary(items), [items]);
  const resizingCount = items.filter((i) => i.phase === "resizing").length;
  const remaining = Math.max(0, SHOP_PHOTO_MAX - items.length);

  return {
    items,
    rejections,
    notice,
    lock,
    started,
    online,
    summary,
    resizingCount,
    remaining,
    canSetPrimarySent: typeof io.setPrimary === "function",
    pick,
    start,
    retry,
    retryAll,
    remove,
    setPrimary,
    loadServer,
    reset,
    dismissRejection,
    clearNotice,
    setNotice,
  };
}

export type ShopPhotosApi = ReturnType<typeof useShopPhotos>;
