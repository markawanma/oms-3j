import type { Metadata } from "next";
import { NOINDEX } from "@/lib/ring-size/config";
import { RingSizeClient } from "./RingSizeClient";

// app/(quiz)/ring-size/page.tsx — server component (ไม่มี token/API/DB · ไม่ import "use server")
//
// metadata override ให้ครบ (บทเรียน F9 ของ gem quiz: metadata ของ root layout คือคำอธิบายระบบภายในร้าน
// LINE preview จะโชว์ให้ลูกค้าเห็น) · robots noindex ตาม NOINDEX (จนเจ้าของสั่งเปิด)
// 🔴 รูปตัวอย่างลิงก์ = ไฟล์ static public/ring-size/og.png (สร้างจาก scripts/gen-ring-size-og.cjs) — ห้ามใช้ opengraph-image.tsx
//    (route ใหม่ไม่อยู่ใน matcher ที่ exempt → LINE ดึงรูปแล้วเด้ง /login) · path `/ring-size/og.png` exempt อยู่แล้วด้วยกฎ
//    `ring-size/[^/]+\.(png|…)$` (exact ลึกหนึ่งชั้น) — ไม่ต้องแก้ middleware/exempt-path
// 🔴 URL เป็น absolute จากค่าคงที่ (ที่อยู่เว็บที่เจ้าของให้ใน brief 3 พ.ย. 69 · = app-domain ใน memory) ไม่อ่าน process.env
//    (หน้านี้ต้อง static และห้าม process.env ใต้ ring-size — copy-guard) · LINE/Facebook ต้องการ og:image แบบ absolute
//    ไม่ผูก metadataBase ระดับ root layout (แตะทั้งแอป) — ตั้งเฉพาะหน้านี้
const SITE_ORIGIN = "https://app.3jthailand.com";
const PAGE_PATH = "/ring-size";
const OG_IMAGE_PATH = "/ring-size/og.png";
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const TITLE = "วัดไซส์แหวนด้วยมือถือ | 3J Jewelry";
const DESCRIPTION = "วัดไซส์แหวนด้วยมือถือ ไม่ต้องไปร้าน ไม่ใช้กล้อง ไม่ต้องกรอกชื่อหรือเบอร์โทร";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: !NOINDEX, follow: !NOINDEX },
  // <meta name="referrer"> — Referer ของ request ที่ออกจากหน้านี้ (beacon สถิติ · ลิงก์ LINE/ร้าน/เกมพลอย) เหลือแค่ origin ไม่ติด query
  // (เช่น fbclid จาก in-app browser) · strict-origin ไม่ใช่ no-referrer: Origin header ของ beacon ที่ route ต้องใช้ยังอยู่ (ห้ามเปลี่ยนเป็น no-referrer)
  referrer: "strict-origin",
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    // = URL ที่เจ้าของแปะ (ไม่มี / ท้าย — Next ตัด / ท้ายด้วย 308 อยู่แล้ว ใส่ / จะให้ og:url ชี้ไปที่ต้อง redirect)
    url: PAGE_PATH,
    siteName: "3J Jewelry",
    locale: "th_TH",
    images: [{ url: OG_IMAGE_PATH, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT, alt: TITLE, type: "image/png" }],
  },
  // summary_large_image: การ์ดรูปใหญ่ (X/Twitter) — ใช้รูปเดียวกัน
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE_PATH] },
};

export default function RingSizePage() {
  return <RingSizeClient />;
}
