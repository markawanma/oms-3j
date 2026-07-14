import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// Body text line-height >=1.5 handled in globals.css. next/font self-hosts
// the font (no runtime Google Fonts request, good for offline/preview + CSP).
const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-noto-sans-thai",
});

export const metadata: Metadata = {
  title: "OMS — ระบบจัดการออเดอร์",
  description: "รวมออเดอร์ Shopee / TikTok Shop ไว้ในที่เดียว",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
