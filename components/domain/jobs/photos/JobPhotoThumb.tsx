"use client";

// JobPhotoThumb — รูปย่อ 1 รูป (ชั้นแสดงผลล้วน · ใช้ทั้งการ์ดออฟฟิศ / หน้าช่าง / แถวสถานะหน้าพิมพ์)
// สถานะ: โหลด (พื้น pulse) → รูป → พัง (ไอคอน + "แตะลองใหม่") · กล่องขนาดคงที่ (layout ไม่ขยับ) · ไม่พึ่งสีอย่างเดียว (ดาว + คำ)
// URL หมดอายุ 15 นาที: รูปล้มครั้งแรกต่อ URL → onRetryLoad("error") หนึ่งครั้ง · แตะตอนพัง → onRetryLoad("tap")

import { useEffect, useRef, useState } from "react";
import { ImageOff, Star } from "lucide-react";
import type { RetryReason } from "@/components/domain/jobs/photos/types";
import { PHOTO_SOURCE_TAG_TH } from "@/lib/jobs/photos";

/** 56 = แถวส่งรูปของมือถือผู้จัดการ (W2) · hero = ภาพใหญ่เกือบเต็มความกว้างบนหัวจอช่าง (ผู้เรียกส่ง URL ภาพกลาง md ให้ชัด) — ความสูงจำกัดตามจอ (ไม่ดันปุ่มหลัก sticky ตกจอ) · object-contain ไม่ตัดชิ้นงาน */
export type ThumbSize = "tile" | 80 | 56 | 48 | "hero";

const BOX: Record<string, string> = {
  tile: "aspect-square w-full rounded-lg",
  "80": "h-20 w-20 shrink-0 rounded-xl border-2 border-zinc-300",
  "56": "h-14 w-14 shrink-0 rounded-lg border border-zinc-300",
  "48": "h-12 w-12 shrink-0 rounded-md border border-zinc-300",
  hero: "h-[min(30vh,13rem)] w-full rounded-2xl border-2 border-zinc-300",
};
const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";
const TAG = "rounded bg-white px-1.5 py-0.5 text-xs font-bold text-zinc-900 shadow";

export function JobPhotoThumb({
  smUrl,
  size,
  label,
  isPrimary = false,
  fromCatalog = false,
  sourceTag = null,
  countChip = null,
  onClick,
  onRetryLoad,
  keepPrevious = false,
  stableKey,
}: {
  smUrl: string | null;
  size: ThumbSize;
  /** aria-label ของปุ่ม (หรือ alt เมื่อไม่มี onClick) — ห้ามมีชื่อลูกค้า/ชื่อไฟล์ */
  label: string;
  isPrimary?: boolean;
  fromCatalog?: boolean;
  /** ป้ายที่มา (0189 W2) — ออฟฟิศเท่านั้น: "หน้างาน" | "ออฟฟิศ" | "แคตตาล็อก" (ใช้เมื่อใบมีรูปหลายที่มา) · ไม่ส่ง = ไม่มีป้าย */
  sourceTag?: "shopfloor" | "office" | "catalog" | null;
  /** ชิป "n รูป" มุมขวาล่าง (หน้าช่าง เมื่อมี > 1 รูป) */
  countChip?: number | null;
  onClick?: () => void;
  onRetryLoad?: (reason: RetryReason) => void;
  /**
   * 0189 W2 (hero หน้าช่าง): ลิงก์ใหม่ของรูปเดิม (ขอ view ใหม่หลังลิงก์หมดอายุ/router.refresh) → คงภาพเก่าไว้ใต้ภาพใหม่จนภาพใหม่โหลดเสร็จ ไม่กลับไปเป็นกรอบ pulse (กระพริบ)
   * ใช้คู่ stableKey = id ของรูป (คนละรูป = ไม่คงภาพเก่า) · ไม่ส่ง = พฤติกรรมเดิม
   */
  keepPrevious?: boolean;
  stableKey?: string;
}) {
  // สถานะผูกกับ URL: URL ใหม่ (ลิงก์ที่ขอใหม่) = เริ่มนับ "กำลังโหลด" ใหม่เองโดยไม่ต้อง reset ใน effect
  const [st, setSt] = useState<{ url: string | null; s: "loaded" | "failed" }>({ url: null, s: "loaded" });
  const status: "loading" | "loaded" | "failed" = smUrl === null ? "failed" : st.url === smUrl ? st.s : "loading";
  // ภาพล่าสุดที่โหลดสำเร็จ (ผูกกับ stableKey) — ใช้แสดงค้างระหว่างรอลิงก์ใหม่ของรูปเดิมเมื่อ keepPrevious
  const [lastOk, setLastOk] = useState<{ key: string | undefined; url: string } | null>(null);
  const prevUrl = keepPrevious && status === "loading" && lastOk !== null && lastOk.key === stableKey && lastOk.url !== smUrl ? lastOk.url : null;
  const imgRef = useRef<HTMLImageElement>(null);
  const notified = useRef<string | null | undefined>(undefined);
  const retryRef = useRef(onRetryLoad);
  useEffect(() => {
    retryRef.current = onRetryLoad;
  });

  // รูปที่อยู่ใน cache โหลดเสร็จก่อน hydrate → onLoad ไม่ยิง · ตรวจซ้ำตอน mount/เปลี่ยน URL
  useEffect(() => {
    const el = imgRef.current;
    if (el && smUrl && el.complete && el.naturalWidth > 0) {
      setSt({ url: smUrl, s: "loaded" });
      setLastOk({ key: stableKey, url: smUrl });
    }
  }, [smUrl, stableKey]);

  // รูปพัง (หรือเซ็น URL ไม่ได้) ครั้งแรกต่อ URL → บอกผู้เรียกให้ขอลิงก์ใหม่ 1 ครั้ง
  useEffect(() => {
    if (status !== "failed" || notified.current === smUrl) return;
    notified.current = smUrl;
    retryRef.current?.("error");
  }, [status, smUrl]);

  const box = `relative block overflow-hidden bg-zinc-100 ${BOX[String(size)]}`;
  const ring = size === "tile" && isPrimary && status !== "failed" ? " ring-[3px] ring-zinc-900" : "";

  if (status === "failed") {
    const content = (
      <>
        <ImageOff className={size === 48 || size === 56 ? "h-5 w-5" : "h-7 w-7"} aria-hidden="true" />
        {size !== 48 && size !== 56 && <span className="mt-1 px-1 text-center text-xs font-bold leading-tight">โหลดรูปไม่ได้{onRetryLoad ? " · แตะลองใหม่" : ""}</span>}
      </>
    );
    const cls = `${box} flex flex-col items-center justify-center bg-zinc-100 text-zinc-800`;
    if (!onRetryLoad && !onClick) {
      return (
        <div role="img" aria-label="โหลดรูปไม่ได้" className={cls}>
          {content}
        </div>
      );
    }
    return (
      <button type="button" aria-label="โหลดรูปไม่ได้ แตะเพื่อลองใหม่" onClick={() => onRetryLoad?.("tap")} className={`${cls} ${FOCUS}`}>
        {content}
      </button>
    );
  }

  const inner = (
    <>
      {prevUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- ภาพเก่าของรูปเดิม (ลิงก์ก่อนหน้า) ค้างไว้ใต้ภาพใหม่จนโหลดเสร็จ — ซ่อนจาก screen reader (ซ้ำกับภาพใหม่)
        <img src={prevUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer" draggable={false} className={`absolute inset-0 h-full w-full ${size === "hero" ? "object-contain" : "object-cover"}`} />
      )}
      {status === "loading" && !prevUrl && <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-zinc-200" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL ของ Supabase storage (อายุสั้น) ไม่ผ่าน next/image */}
      <img
        ref={imgRef}
        src={smUrl ?? undefined}
        alt={onClick ? "" : label}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => {
          setSt({ url: smUrl, s: "loaded" });
          if (smUrl) setLastOk({ key: stableKey, url: smUrl });
        }}
        onError={() => setSt({ url: smUrl, s: "failed" })}
        className={`absolute inset-0 h-full w-full ${size === "hero" ? "object-contain" : "object-cover"}`}
      />
      {isPrimary && size === "tile" && (
        <span className={`absolute left-1 top-1 inline-flex items-center gap-0.5 ${TAG}`}>
          <Star className="h-3 w-3" aria-hidden="true" />
          รูปหลัก
        </span>
      )}
      {fromCatalog && size === "tile" && !sourceTag && <span className={`absolute bottom-1 left-1 ${TAG}`}>จากแคตตาล็อก</span>}
      {sourceTag && size === "tile" && <span className={`absolute bottom-1 left-1 ${TAG}`}>{PHOTO_SOURCE_TAG_TH[sourceTag]}</span>}
      {countChip !== null && countChip > 1 && <span className="absolute bottom-1 right-1 rounded bg-zinc-900 px-1.5 py-0.5 text-base font-bold leading-none text-white">{countChip} รูป</span>}
    </>
  );

  if (!onClick) return <div className={`${box}${ring}`}>{inner}</div>;
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`${box}${ring} ${FOCUS}`}>
      {inner}
    </button>
  );
}
