"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Sticky sub-nav for the production-order module — mirrors OemSubNav exactly
// (same top-16 sticky offset assumption, see DashboardShell header). Only
// one tab today: /production/new and /production/[id] are sub-flows off the
// list (create + drill-in), not their own top-level destinations — same
// relationship /oem/quote (compose) has to /oem/quotes (registry) is NOT
// mirrored here on purpose, because unlike OEM there's no separate
// standalone "rates" screen for this module (the spot-price override lives
// on each order itself, see design-production-order.md). Add tabs here if
// P1.5/P2 grows a second top-level screen.
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/production", label: "รายการใบผลิต", icon: ClipboardList },
];

export function ProductionSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูใบผลิตเข้าสต็อก"
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
              active ? "bg-primary-100 text-primary-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
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
