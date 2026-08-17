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
  title: "3J Insight",
  description: "CRM · การตลาด · วิเคราะห์ยอดขาย — สมองกลางของ 3J Jewelry",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning on <html>/<body> ONLY: browser extensions
  // (Grammarly → `data-gr-ext-installed` / `cz-shortcut-listen`, Google
  // Translate, dark-mode helpers, Thai IME helpers, …) mutate these two
  // top-level tags *before* React hydrates, adding attributes the server HTML
  // never had. That triggers an app-wide "server rendered HTML didn't match
  // the client" error on every route — with no app-code cause (our shell
  // renders deterministically; every toLocale* call pins an explicit locale).
  // React/Next.js's sanctioned fix is this flag. It suppresses the warning for
  // the html/body element's OWN attributes only — it does NOT cascade to the
  // subtree — so any real content mismatch deeper in the tree is still caught.
  return (
    <html lang="th" className={notoSansThai.variable} suppressHydrationWarning>
      <body className="font-sans min-h-screen" suppressHydrationWarning>{children}</body>
    </html>
  );
}
