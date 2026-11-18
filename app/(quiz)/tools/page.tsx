import type { Metadata } from "next";

// app/(quiz)/tools/page.tsx — หน้ารวมเครื่องมือลูกค้า (hub) · server component static (ไม่มี DB/env/token · ไม่ import "use server")
// 🔴 P1a = โครงเปล่า (routing) — copy/UI จริงมาใน P1b (docs/3j-jewelry/oms/ux-tools-hub.md)
// metadata ต้อง override ให้ครบ: ของ root layout คือคำอธิบายระบบภายในร้าน (บทเรียน F9 — LINE preview จะโชว์ให้ลูกค้า)
// path /tools exempt จาก auth gate แบบ exact (middleware matcher + lib/auth/exempt-path.ts) · บน host tools. เข้าที่ "/" (middleware rewrite)
export const metadata: Metadata = {
  title: "เครื่องมือเลือกแหวน | 3J Jewelry",
  description: "เครื่องมือเลือกแหวนของ 3J Jewelry",
  robots: { index: false, follow: false },
  referrer: "strict-origin",
  openGraph: { type: "website", title: "เครื่องมือเลือกแหวน | 3J Jewelry", description: "เครื่องมือเลือกแหวนของ 3J Jewelry", siteName: "3J Jewelry", locale: "th_TH" },
};

export default function ToolsHubPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">เครื่องมือเลือกแหวน</h1>
    </div>
  );
}
