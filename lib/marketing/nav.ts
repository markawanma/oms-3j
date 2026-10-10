import { CalendarDays, ClipboardList, Gem, History, Inbox, Clapperboard, Layers, Lightbulb, Send, Megaphone, MessageCircleQuestion, Ticket, TrendingUp, Users2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Pure active-tab resolution for the Marketing sub-nav.
 *
 * Longest-match wins (same rule as DashboardShell.activeNavHref): once
 * "/marketing" is itself a tab, a plain `startsWith` would light it up on every
 * /marketing/* page. The bare root only matches exactly; every other href
 * matches itself or a child segment, and the most specific href is the one
 * highlighted.
 */
export function pathMatchesHref(pathname: string, href: string): boolean {
  // /marketing/pieces/<id> (หน้าชิ้นงาน) เปิดจากหลายที่ — ไม่ให้แท็บ "ชิ้นงานทั้งหมด" สว่างตามไปด้วย
  if (href === "/marketing" || href === "/marketing/pieces") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeTabHref(pathname: string | null | undefined, hrefs: readonly string[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathMatchesHref(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * หน้าในสายการตลาดที่ขยายความกว้างเนื้อหา (PC 2 คอลัมน์ — แผน §5.3): หน้าแรก "งานที่รอฉัน" · ปฏิทิน (สัปดาห์ 7 คอลัมน์) · หน้าชิ้นงาน
 * หน้าอื่นทั้งแอปคงความกว้างเดิม (max-w-3xl) — DashboardShell เรียกฟังก์ชันนี้เพื่อเลือก max-width ของ <main>
 */
export function isWideMarketingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === "/marketing" ||
    pathname === "/marketing/calendar" ||
    pathname === "/marketing/triage" ||
    pathname.startsWith("/marketing/pieces/")
  );
}

// ---------------------------------------------------------------------------
// รายการเมนูสายการตลาด — ที่เดียว (หนี้ §11 ข้อ 2): แถวแท็บ PC · แถบล่างมือถือ · sidebar DashboardShell อ่านจากที่นี่
// เพิ่มหน้าใหม่ = เพิ่มแถวเดียว (ห้ามใส่เมนูก่อนหน้าพร้อมใช้)
// ---------------------------------------------------------------------------

export interface MarketingNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** แถวแท็บ md+ : "main" = แท็บหลัก · "more" = ย่อเข้าเมนู "อื่นๆ" · null = ไม่แสดง */
  tab: "main" | "more" | null;
  /** แถบล่างมือถือ: "main" = ช่องหลัก (≤ 4) · "more" = ใน sheet "เพิ่มเติม" · null = ไม่แสดง */
  mobile: "main" | "more" | null;
  /** ใช้ชื่อสั้นบนแถบล่างมือถือ (ถ้าไม่ระบุใช้ label) */
  mobileLabel?: string;
  /** แสดงใน sidebar ของ DashboardShell (ชื่อที่ต่างออกไปถ้ามี) */
  sidebar: boolean;
  sidebarLabel?: string;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: "/marketing", label: "งานที่รอฉัน", icon: Inbox, tab: "main", mobile: "main", mobileLabel: "รอฉัน", sidebar: true },
  { href: "/marketing/questions", label: "คำถามจาก AI", icon: MessageCircleQuestion, tab: "main", mobile: "more", sidebar: false },
  { href: "/marketing/ad-spend", label: "ค่าแอด", icon: Wallet, tab: "more", mobile: "more", sidebar: true },
  { href: "/marketing/copilot", label: "Ad Copilot", icon: Megaphone, tab: "more", mobile: "more", sidebar: true },
  { href: "/marketing/audience", label: "กลุ่มลูกค้า", icon: Users2, tab: "more", mobile: "more", sidebar: true },
  { href: "/marketing/attribution", label: "วัดผลโค้ด", icon: Ticket, tab: "more", mobile: "more", sidebar: true },
  { href: "/marketing/triage", label: "คัดไอเดีย", icon: Lightbulb, tab: "main", mobile: "more", sidebar: true },
  { href: "/marketing/calendar", label: "ปฏิทิน", icon: CalendarDays, tab: "main", mobile: "main", sidebar: true },
  { href: "/marketing/shoot", label: "รอบถ่าย", icon: Clapperboard, tab: "main", mobile: "more", sidebar: true },
  { href: "/marketing/posts", label: "โพสต์วันนี้", icon: Send, tab: "main", mobile: "main", sidebar: true },
  { href: "/marketing/pieces", label: "ชิ้นงานทั้งหมด", icon: Layers, tab: "more", mobile: "more", mobileLabel: "ชิ้นงานทั้งหมด", sidebar: true },
  // อ่านยอด = หน้าแยก (ไม่ใช่แท็บปฏิทิน) ชื่อสั้นบนแถบ · ยังไม่ใช่ทางเข้าหลักตอนดึก (ux-content-measurement §1.1)
  { href: "/marketing/content/entry", label: "อ่านยอด", icon: ClipboardList, tab: "main", mobile: "main", mobileLabel: "กรอกยอด", sidebar: true, sidebarLabel: "อ่านยอด content" },
  { href: "/marketing/content/history", label: "ประวัติ", icon: History, tab: "more", mobile: "more", mobileLabel: "ประวัติยอดโพสต์", sidebar: false },
  { href: "/marketing/trend-radar", label: "เทรนด์", icon: TrendingUp, tab: "more", mobile: "more", mobileLabel: "เทรนด์รายวัน", sidebar: false },
  { href: "/marketing/gem-quiz", label: "แบบทดสอบพลอย", icon: Gem, tab: "more", mobile: "more", sidebar: false },
];
