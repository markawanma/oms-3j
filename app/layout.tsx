import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

// Body text line-height >=1.5 handled in globals.css. ฟอนต์ self-host เป็นไฟล์ woff2
// ใน app/fonts/ (next/font/local — build ไม่ดึง fonts.googleapis.com; README อยู่ใน app/fonts/).
// next/font/local ใส่ unicode-range รายไฟล์ไม่ได้ จึงโหลด 2 call (latin + thai) แล้วรวมเป็น
// font stack ใน tailwind.config.ts (`font-sans` = latin ก่อน thai — แต่ละไฟล์ไม่มีกลิฟของอีกสคริปต์
// เบราว์เซอร์เลย fallback รายตัวอักษรเอง). Noto Sans Thai = variable font ไฟล์เดียวต่อ subset (400-700).
const notoSansThaiLatin = localFont({
  src: [{ path: "./fonts/noto-sans-thai/NotoSansThai-latin-variable.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-noto-sans-thai-latin",
});
const notoSansThaiThai = localFont({
  src: [{ path: "./fonts/noto-sans-thai/NotoSansThai-thai-variable.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
  adjustFontFallback: false, // fallback metrics คิดจากไฟล์ latin แล้ว — ไฟล์ thai ไม่มีกลิฟละตินให้วัด
  variable: "--font-noto-sans-thai-thai",
});

export const metadata: Metadata = {
  title: "3J Insight",
  description: "CRM · การตลาด · วิเคราะห์ยอดขาย — สมองกลางของ 3J Jewelry",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={`${notoSansThaiLatin.variable} ${notoSansThaiThai.variable}`}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
