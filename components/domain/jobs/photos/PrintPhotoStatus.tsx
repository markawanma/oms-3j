"use client";

// PrintPhotoStatus — บรรทัดสถานะรูปหลักในกล่อง "ออก QR และพิมพ์" (เฉพาะบนจอ — ผู้เรียกวางในส่วน print:hidden)
// มี → ภาพย่อ 48px + "พิมพ์ 30×30 มม." · กำลังโหลด → ข้อความ · โหลดไม่ได้ → แถบเหลือง role=alert (พิมพ์ได้โดยไม่มีรูป) · ไม่มีรูป → ลิงก์ไปเพิ่มรูป (ไม่บล็อกการพิมพ์ — มติ จ5)
// ชั้นแสดงผลล้วน: ไม่เรียก action

import type { PrintPhotoStatus as Status } from "@/components/domain/jobs/photos/usePrintPhoto";
import { JobPhotoThumb } from "@/components/domain/jobs/photos/JobPhotoThumb";

const LINK = "font-semibold underline underline-offset-2";

export function PrintPhotoStatus({ status, url, addHref }: { status: Status; url: string | null; /** ลิงก์ไปการ์ดรูปของใบ (/jobs/<id>#job-photos) */ addHref: string }) {
  if (status === "ready" && url) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-800">
        <JobPhotoThumb smUrl={url} size={48} label="ภาพย่อรูปหลักที่จะพิมพ์บนใบ" />
        <p role="status">รูปหลัก: มี — พิมพ์ 30×30 มม. บนหัวใบ</p>
      </div>
    );
  }
  if (status === "loading") {
    return (
      <p role="status" aria-busy="true" className="text-sm text-zinc-800">
        กำลังโหลดรูปหลัก…
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
        โหลดรูปหลักไม่ได้ — ใบจะพิมพ์โดยไม่มีรูป
        <button type="button" onClick={() => window.location.reload()} className={`${LINK} min-h-11`}>
          โหลดหน้าใหม่
        </button>
      </p>
    );
  }
  return (
    <p className="text-sm text-zinc-800">
      ไม่มีรูป — ใบจะไม่มีรูปหลัก ·{" "}
      <a href={addHref} className={`${LINK} text-primary-700`}>
        เพิ่มรูปก่อนพิมพ์
      </a>
    </p>
  );
}
