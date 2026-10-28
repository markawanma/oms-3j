// lib/jobs/qr-client.ts — QR ของ "ใบเดิม" บนจอช่าง (หลังแยกส่วน: ให้คนรับสแกนจากจอนี้ — มติ ข1 QR เดียวต่อใบ)
// ชนิดข้อมูล = URL ของหน้านี้เอง (/w/<token>) ที่ช่างเปิดอยู่แล้ว — ไม่ออก token ใหม่ ไม่เรียก DB · ใช้ไลบรารี vendored ตัวเดียวกับ lib/jobs/qr.ts (ฝั่ง server ใช้ตอนพิมพ์)
// ไม่ใช่ server-only โดยตั้งใจ (render ในเบราว์เซอร์) · ผลเป็น SVG ล้วน สีดำบนขาว ไม่มีสคริปต์ (ดู qr.test.ts) · ecc H เท่ากับใบพิมพ์

import { renderSVG } from "@/lib/vendor/uqr/index.mjs";

export function workerPageUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/w/${token}`;
}

export function renderQrSvgClient(text: string): string {
  return renderSVG(text, { ecc: "H", border: 2, whiteColor: "#ffffff", blackColor: "#000000", pixelSize: 8 });
}
