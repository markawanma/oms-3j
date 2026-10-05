import type { Metadata } from "next";
import { issueFormToken } from "@/lib/gem-quiz/form-token";
import { GemQuizClient } from "./GemQuizClient";

// app/(quiz)/gem-quiz/page.tsx — server component (design §4.1).
//
// force-dynamic: token ต้องสดทุกครั้งที่หน้านี้ถูก render (issueFormToken()
// ผูก issuedAt เข้ากับ HMAC ที่ route handler ตรวจอายุ — ISR/cache จะทำให้ทุก
// คนเห็น token เดียวกันค้าง และ token นั้นจะหมดอายุ/เร็วเกินไม่ตรงความจริง).
export const dynamic = "force-dynamic";

// F9 (design doc): root layout's metadata = "3J Insight — CRM · การตลาด ·
// วิเคราะห์ยอดขาย — สมองกลางของ 3J Jewelry" ซึ่งไม่เหมาะกับหน้าสาธารณะนี้เลย
// (LINE preview เวลาแชร์ลิงก์จะโชว์คำอธิบายระบบภายในร้านให้ลูกค้าเห็น) —
// override ให้ครบที่นี่. robots noindex ตาม D3 (เฟสแรก แหล่งคนเข้าคือ QR
// ไม่ใช่ search — ลด bot traffic ด้วย).
export const metadata: Metadata = {
  title: "แบบทดสอบเลือกพลอย | 3J Jewelry",
  description: "ทำแบบทดสอบสั้นๆ เพื่อดูว่าพลอยแบบไหนเข้ากับคุณ — ไม่เก็บข้อมูลส่วนตัว",
  robots: { index: false, follow: false },
  openGraph: {
    title: "แบบทดสอบเลือกพลอย | 3J Jewelry",
    description: "ทำแบบทดสอบสั้นๆ เพื่อดูว่าพลอยแบบไหนเข้ากับคุณ — ไม่เก็บข้อมูลส่วนตัว",
    // 🔴 static file เท่านั้น (public/gem-quiz/og.png) — ห้ามใช้ Next.js
    // convention `opengraph-image.tsx` ที่นี่ (code review ของ branch backend:
    // path นั้นไม่อยู่ใน exempt matcher ของ middleware.ts จะโดนเด้ง /login ตอน
    // LINE/โปรแกรมแชร์ไปดึงรูปมาแสดง — ดู design §4.1/§8). ไฟล์รูปตอนนี้เป็น
    // placeholder รอทีม content ส่งรูปจริง (C2).
    images: ["/gem-quiz/og.png"],
  },
};

export default async function GemQuizPage() {
  // issueFormToken() ปลอดภัยที่นี่เท่านั้น (server component) — ห้ามเรียกจาก
  // client component เด็ดขาด (design §1.2, ดู lib/gem-quiz/form-token.ts
  // หัวไฟล์). คืน null ถ้า GEM_QUIZ_TOKEN_SECRET ยังไม่ตั้งบน env — ส่ง null
  // ลงไปตรงๆ แทนการ throw: หน้ายังต้อง render ได้ปกติ (ผู้ใช้ไม่ควรเห็นหน้า
  // ล่มเพราะ env ฝั่ง submit ยังไม่พร้อม) route handler เองก็ fail-closed 503
  // อยู่แล้วถ้า secret ไม่ตั้ง (R-9) — ความเสียหายจำกัดอยู่ที่ "ทำแบบทดสอบได้
  // แต่บันทึกไม่ได้" ซึ่งผู้ใช้มองไม่เห็นความแตกต่างอยู่แล้ว (fire-and-forget).
  const token = issueFormToken();

  return <GemQuizClient token={token} />;
}
