"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, LineChart, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/crm/overview", label: "ภาพรวม", icon: LineChart },
  { href: "/crm/customers", label: "ลูกค้า", icon: Users },
  { href: "/crm/import-errors", label: "ตรวจ import", icon: AlertTriangle },
];

/** Sticky sub-nav tab bar for the CRM module — mirrors TikTokSubNav
 * (components/domain/tiktok/TikTokSubNav.tsx) exactly, same `top-16` sticky
 * offset assumption (see DashboardShell header height note). */
export function CrmSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนู CRM"
      className="sticky top-16 z-10 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-1 py-1.5 scrollbar-none"
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
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
