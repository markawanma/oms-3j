"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, ClipboardList, Coins, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Sticky sub-nav for the OEM pricing module — mirrors CrmSubNav/MarketingSubNav
// exactly (same top-16 sticky offset assumption, see DashboardShell header).
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/oem/rates", label: "ต้นทุน", icon: Coins },
  { href: "/oem/quote", label: "คิดราคา", icon: Calculator },
  { href: "/oem/quotes", label: "ใบเสนอราคา", icon: ClipboardList },
  { href: "/oem/receipts", label: "ใบเสร็จ", icon: Receipt },
];

export function OemSubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนู OEM"
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
