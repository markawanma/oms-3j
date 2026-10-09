"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Gem, History, Inbox, Megaphone, MessageCircleQuestion, Ticket, TrendingUp, Users2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { activeTabHref } from "@/lib/marketing/nav";

// Keep in sync with the "การตลาด" group in
// components/layout/DashboardShell.tsx (NAV_GROUPS) — same 6 routes, same
// labels/icons. Was previously only 2 tabs, which orphaned the audience/
// attribution/calendar pages (sub-nav showed neither their tab nor any
// highlight, so they looked broken from inside the module).
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/marketing/ad-spend", label: "ค่าแอด", icon: Wallet },
  { href: "/marketing/copilot", label: "Ad Copilot", icon: Megaphone },
  { href: "/marketing/audience", label: "กลุ่มลูกค้า", icon: Users2 },
  { href: "/marketing/attribution", label: "วัดผลโค้ด", icon: Ticket },
  { href: "/marketing/calendar", label: "ปฏิทินแคมเปญ", icon: CalendarDays },
  // design doc ux-content-measurement.md §1.1: separate route (not a
  // calendar tab), short label "อ่านยอด" — but explicitly NOT meant to be
  // the primary way in late at night (§1.1: "sub-nav ไม่ใช่ทางเข้าหลักที่
  // ควรพึ่ง") — this tab exists so the page is reachable/discoverable at
  // all; §7 Q2 (bookmark vs. dashboard card as the real primary entry) is
  // still open with the owner.
  { href: "/marketing/content/entry", label: "อ่านยอด", icon: ClipboardList },
  // Tech Lead brief 27 ก.ย. 69: "ดูย้อนหลัง" — คลิปที่เคยกรอกยอดไปแล้ว
  // (ฟอร์มที่ /content/entry ปิดตัวเองทันทีที่กรอกเสร็จ ไม่มีที่ไหนย้อนดูได้
  // มาก่อนหน้านี้เลย). ตารางอ่านอย่างเดียว ไม่มี filter/search รอบนี้.
  { href: "/marketing/content/history", label: "ประวัติ", icon: History },
  // Tech Lead brief 4 ต.ค. 69: "เรดาร์เทรนด์" — อ่านไฟล์ trend-radar รายวัน
  // จาก GitHub (lib/actions/trend-radar.ts) แล้วกด "เพิ่มเข้าปฏิทิน" ได้ตรง
  // จากมุมที่สนใจ แทนต้องเปิดไฟล์แยกแล้วพิมพ์ใหม่.
  { href: "/marketing/trend-radar", label: "เทรนด์", icon: TrendingUp },
  // design doc docs/3j-jewelry/analytics/design-gem-quiz.md §7: สถิติภายใน
  // ของแบบทดสอบเลือกพลอยที่แจกผ่าน QR บนการ์ดขอบคุณ (หน้าสาธารณะอยู่คนละ
  // route group ที่ /gem-quiz ไม่ผ่านแท็บนี้).
  { href: "/marketing/gem-quiz", label: "แบบทดสอบพลอย", icon: Gem },
];

// มือถือ (< md): ซ่อนแถวแท็บเลื่อนแนวนอนนี้ (กติกา 7.3 ห้ามเลื่อนแนวนอน) — ใช้แถบล่าง MarketingBottomNav แทน
/** Sticky sub-nav tab bar for the Marketing module — mirrors CrmSubNav
 * (components/domain/crm/CrmSubNav.tsx) exactly, same `top-16` sticky offset
 * assumption (see DashboardShell header height note). */
export function MarketingSubNav() {
  const pathname = usePathname();
  // Longest-match so a parent tab (e.g. "/marketing") never co-highlights with
  // a more specific child tab — see lib/marketing/nav.ts.
  const activeHref = activeTabHref(
    pathname,
    TABS.map((t) => t.href)
  );

  return (
    <nav
      aria-label="เมนูการตลาด"
      className="sticky top-16 z-10 hidden gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-1 py-1.5 scrollbar-none md:flex"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === activeHref;
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
