"use client";

// ShopPhotoQrPair — W-8a "รูปหลักคู่ QR" (มติ Q2 "รูปมาพร้อม QR": ช่างเห็นว่าสแกนแล้วจะได้ชิ้นไหน โดยไม่ต้องอ่านชื่อ/เลข JB — ภาษาเดียวกับ A5 ที่รูปหลักวางข้าง QR)
// รูปหลัก 128px (ภาพ sm จากไฟล์ในเครื่อง — ไม่รอ signed URL) + QR 184px (เดิม 200 · ลด 16px ให้วางคู่ใน 328px) · ใบไม่มีรูป = ผู้เรียกไม่ใช้ component นี้ (QR 200 เดิม)
// QR gate: ระหว่างส่งรูปชุดเปิดใบ ช่อง QR เป็นกล่อง sky ขนาดเท่ากัน (ไม่ render QR) — กันช่างสแกนแล้วรับงานก่อนรูปมาครบ (รูปที่เหลือถูกปฏิเสธเมื่อช่างรับแล้ว)
// ป้ายบนรูปหลัก: ยังไม่ขึ้น server = "⚠ ยังไม่ได้ส่ง" / กำลังส่ง = "กำลังส่ง…" (กันผู้จัดการเข้าใจว่าช่างจะเห็นแล้ว)
// ⚠ QR 184px ต้องทดสอบสแกนจากมือถือช่างที่ระยะยื่นจอ (UX §13 ข้อ 10) — ไม่ผ่าน ให้เปลี่ยนเป็นวางแนวตั้ง (รูป 96px แถบบน · QR 200 ล่าง)

import { ImageOff, QrCode } from "lucide-react";
import { SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";

export type PrimaryPhotoStatus = "sent" | "sending" | "unsent";

export function ShopPhotoQrPair({
  jobNo,
  svg,
  gated,
  primaryUrl,
  primaryStatus,
}: {
  jobNo: string;
  /** SVG ของ QR (สร้างในเบราว์เซอร์) — null = ไม่ render ทั้งคู่ (ไม่โชว์รูปโดดๆ ที่ไม่มีคู่) */
  svg: string | null;
  /** true = ซ่อน QR (กำลังส่งรูป) */
  gated: boolean;
  primaryUrl: string | null;
  primaryStatus: PrimaryPhotoStatus;
}) {
  if (svg === null) return null;
  return (
    <figure className="m-0 space-y-1">
      {/* 128 + 8 + 184 = 320px: จอ ≥ 360 (เนื้อหา 328) วางคู่ · จอแคบกว่า (เช่น 320 → เนื้อหา 288) ซ้อนแนวตั้ง ไม่ล้นออกขวา */}
      <div className="flex flex-col items-center justify-center gap-2 min-[360px]:flex-row min-[360px]:items-start">
        <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-xl border-2 border-zinc-300 bg-zinc-100" data-testid="qr-pair-photo">
          {primaryUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL ในเครื่อง (ย่อแล้ว)
            <img src={primaryUrl} alt="รูปหลักของใบงาน" referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-zinc-700">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
            </span>
          )}
          {primaryStatus !== "sent" && (
            <span className="absolute inset-x-0 bottom-0 bg-white/95 px-1 py-0.5 text-center text-sm font-bold text-zinc-900">{primaryStatus === "sending" ? SHOP_PHOTO_TH.primarySending : SHOP_PHOTO_TH.primaryUnsent}</span>
          )}
        </div>
        {gated ? (
          <div data-testid="qr-gate-box" aria-hidden="true" className="flex h-[184px] w-[184px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 text-sky-950">
            <QrCode className="h-12 w-12" />
            <span className="px-2 text-center text-base font-semibold">QR รอรูปส่งครบ</span>
          </div>
        ) : (
          // SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จาก URL ของใบงานที่เพิ่งออก — ไม่ใช่ข้อมูลจากผู้ใช้
          <div className="h-[184px] w-[184px] shrink-0 rounded-xl border border-zinc-300 bg-white p-1" role="img" aria-label={`QR ใบงาน ${jobNo}`} dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
      <figcaption className="text-center text-base font-semibold text-zinc-900">{SHOP_PHOTO_TH.primaryCaption}</figcaption>
    </figure>
  );
}
