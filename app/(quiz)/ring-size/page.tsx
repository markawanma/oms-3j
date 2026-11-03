import type { Metadata } from "next";
import { NOINDEX } from "@/lib/ring-size/config";
import { RingSizeClient } from "./RingSizeClient";

// app/(quiz)/ring-size/page.tsx — server component (ไม่มี token/API/DB · ไม่ import "use server")
//
// metadata override ให้ครบ (บทเรียน F9 ของ gem quiz: metadata ของ root layout คือคำอธิบายระบบภายในร้าน
// LINE preview จะโชว์ให้ลูกค้าเห็น) · robots noindex ตาม NOINDEX (จนเจ้าของสั่งเปิด)
// 🔴 ไม่ใส่ openGraph.images: ไฟล์ public/ring-size/og.png ยังไม่มี (รายการค้างของเจ้าของ) — ห้ามอ้างไฟล์ที่ไม่มี
//    ต้องมีไฟล์ static ก่อนแจกลิงก์ใน LINE/TikTok · ห้ามใช้ opengraph-image.tsx (path นี้ไม่อยู่ใน matcher ที่ exempt)
const TITLE = "วัดไซส์แหวนด้วยมือถือ | 3J Jewelry";
const DESCRIPTION = "วัดไซส์แหวนด้วยมือถือ ไม่ต้องไปร้าน ไม่ใช้กล้อง ไม่ต้องกรอกชื่อหรือเบอร์โทร";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: !NOINDEX, follow: !NOINDEX },
  // <meta name="referrer"> — Referer ของ request ที่ออกจากหน้านี้ (beacon สถิติ · ลิงก์ LINE/ร้าน/เกมพลอย) เหลือแค่ origin ไม่ติด query
  // (เช่น fbclid จาก in-app browser) · strict-origin ไม่ใช่ no-referrer: Origin header ของ beacon ที่ route ต้องใช้ยังอยู่ (ห้ามเปลี่ยนเป็น no-referrer)
  referrer: "strict-origin",
  openGraph: { title: TITLE, description: DESCRIPTION },
};

export default function RingSizePage() {
  return <RingSizeClient />;
}
