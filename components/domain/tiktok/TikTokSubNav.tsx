"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 10 ก.ย. 69: ตัด 2 แท็บออกพร้อมกับที่ซ่อน/ลบในเมนูหลัก (DashboardShell.tsx)
//   "Ad Copilot" -> /tiktok/copilot ถูก **ลบทิ้งจริง** เพราะเป็นของจำลอง
//      (อ่านจาก lib/tiktok/mock-actions.ts + เก็บผลใน localStorage ไม่ใช่ DB)
//      ตัวจริงคือ /marketing/copilot ซึ่งดึงข้อมูลจริง 7 แหล่ง
//   "ยอดขาย"    -> /tiktok/sales ยังอยู่แต่ซ่อนจากเมนู เพราะอ่าน public.orders
//      ซึ่งมี 0 แถว (ยอดขายจริงอยู่ analytics.fact_order) — /dashboard ตอบ
//      คำถามเดียวกันครบกว่า
// ⚠️ ลิงก์พวกนี้เป็น string ล้วน tsc จับไม่ได้ถ้าปลายทางหาย — ถ้าจะเพิ่ม
//    แท็บกลับมา ต้องเช็คว่าไฟล์ page.tsx ปลายทางมีอยู่จริงด้วยตาเอง
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/tiktok/dashboard", label: "แดชบอร์ด", icon: BarChart3 },
  { href: "/tiktok/upload", label: "อัปโหลด", icon: Tags },
];

/** Sticky sub-nav tab bar for the TikTok Ops module (design §2/§4). Emoji
 * icons from the mockup's bottom nav (📊🎯🏷️💰) are mapped to lucide icons
 * per design §7. Horizontal scroll (`overflow-x-auto`) covers narrow mobile
 * viewports instead of shrinking labels illegibly. */
export function TikTokSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนู TikTok Ops"
      className="sticky top-16 z-10 flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-1 py-1.5 scrollbar-none"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
              active
                ? "bg-primary-100 text-primary-700"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
