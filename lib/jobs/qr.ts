// lib/jobs/qr.ts — สร้าง QR เป็น SVG ฝั่ง server (ไลบรารี vendored: lib/vendor/uqr · uqr@0.1.3 MIT — ดู README ในโฟลเดอร์นั้น)
// QR เข้ารหัส URL หน้าช่าง: <origin>/w/<token> · token ดิบมีอยู่แค่ในสตริงนี้ชั่วครู่ ไม่ถูกเก็บ/ส่งกลับ — คืนเฉพาะ SVG
// ecc 'H' (ทนกระดาษยับ/พิมพ์เลอะ/เปื้อนน้ำมัน-ผงขัดในโรงงาน ~30% — design §6 · 12 ต.ค.) · border 2 โมดูล (quiet zone) · ไม่ฝังสี/สคริปต์ (สีดำบนขาวตายตัว)

import "server-only";
import { renderSVG } from "@/lib/vendor/uqr/index.mjs";

export function workerUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/w/${token}`;
}

/** QR ร้าน (hub ที่ผู้จัดการสแกนเปิดใบ): <origin>/w/s/<token ร้าน> — ประกอบฝั่ง server เท่านั้น (origin มาจาก APP_ORIGIN ผ่าน currentAppOrigin) */
export function shopUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/w/s/${token}`;
}

export function renderQrSvg(text: string): string {
  return renderSVG(text, { ecc: "H", border: 2, whiteColor: "#ffffff", blackColor: "#000000", pixelSize: 8 });
}
