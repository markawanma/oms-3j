import type { Metadata } from "next";
import { TOOLS_HUB_COPY } from "@/lib/tools-hub/config";
import { ToolsHub } from "./ToolsHub";

// app/(quiz)/tools/page.tsx — หน้ารวมเครื่องมือลูกค้า (hub) · server component static (ไม่มี DB/env/token · ไม่ import "use server")
// อยู่ใต้ (quiz) เพื่อได้ฟอนต์/token --gq-* และถูก lib/gem-quiz/no-server-action-graph.test.ts เดินครอบอัตโนมัติ
// metadata override ให้ครบ: ของ root layout คือคำอธิบายระบบภายใน (บทเรียน F9 — LINE preview จะโชว์ให้ลูกค้า) · noindex จนเจ้าของสั่ง (design §9 ข้อ 1)
// path /tools exempt จาก auth gate แบบ exact · บน host tools. เข้าที่ "/" (middleware rewrite) · ลิงก์ในหน้า = <a href> ธรรมดา ห้าม next/link
export const metadata: Metadata = {
  title: TOOLS_HUB_COPY.pageTitle,
  description: TOOLS_HUB_COPY.pageDescription,
  robots: { index: false, follow: false },
  referrer: "strict-origin",
  openGraph: {
    type: "website",
    title: TOOLS_HUB_COPY.pageTitle,
    description: TOOLS_HUB_COPY.pageDescription,
    siteName: "3J Jewelry",
    locale: "th_TH",
  },
};

export default function ToolsHubPage() {
  return <ToolsHub />;
}
