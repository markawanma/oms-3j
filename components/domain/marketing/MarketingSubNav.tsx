"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Megaphone, Ticket, Users2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Keep in sync with the "การตลาด" group in
// components/layout/DashboardShell.tsx (NAV_GROUPS) — same 5 routes, same
// labels/icons. Was previously only 2 tabs, which orphaned the audience/
// attribution/calendar pages (sub-nav showed neither their tab nor any
// highlight, so they looked broken from inside the module).
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/marketing/ad-spend", label: "ค่าแอด", icon: Wallet },
  { href: "/marketing/copilot", label: "Ad Copilot", icon: Megaphone },
  { href: "/marketing/audience", label: "กลุ่มลูกค้า", icon: Users2 },
  { href: "/marketing/attribution", label: "วัดผลโค้ด", icon: Ticket },
  { href: "/marketing/calendar", label: "ปฏิทินแคมเปญ", icon: CalendarDays },
];

/** Sticky sub-nav tab bar for the Marketing module — mirrors CrmSubNav
 * (components/domain/crm/CrmSubNav.tsx) exactly, same `top-16` sticky offset
 * assumption (see DashboardShell header height note). */
export function MarketingSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูการตลาด"
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
