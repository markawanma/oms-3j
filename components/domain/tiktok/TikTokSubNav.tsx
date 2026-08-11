"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Coins, Tags, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/tiktok/dashboard", label: "แดชบอร์ด", icon: BarChart3 },
  { href: "/tiktok/copilot", label: "Ad Copilot", icon: Target },
  { href: "/tiktok/upload", label: "อัปโหลด", icon: Tags },
  { href: "/tiktok/sales", label: "ยอดขาย", icon: Coins },
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
