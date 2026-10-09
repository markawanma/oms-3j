"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { MARKETING_NAV, activeTabHref } from "@/lib/marketing/nav";

// รายการแท็บมาจาก lib/marketing/nav.ts (MARKETING_NAV) ที่เดียว — มือถือ (< md) ซ่อนแถวนี้ (กติกา 7.3 ห้ามเลื่อนแนวนอน) ใช้ MarketingBottomNav แทน
// แท็บที่ใช้ไม่บ่อย (tab: "more") ย่อเข้าเมนู "อื่นๆ" — ที่ 768–1280px แถวแท็บไม่ล้น
const TABS = MARKETING_NAV.filter((t) => t.tab !== null);

const TAB_CLS = "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold transition-colors lg:px-3";

/** Sticky sub-nav tab bar for the Marketing module — mirrors CrmSubNav
 * (components/domain/crm/CrmSubNav.tsx), same `top-16` sticky offset
 * assumption (see DashboardShell header height note). md+ เท่านั้น (มือถือใช้ MarketingBottomNav) */
export function MarketingSubNav() {
  const pathname = usePathname();
  // Longest-match so a parent tab (e.g. "/marketing") never co-highlights with
  // a more specific child tab — see lib/marketing/nav.ts.
  const activeHref = activeTabHref(
    pathname,
    TABS.map((t) => t.href)
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const primary = TABS.filter((t) => t.tab === "main");
  const others = TABS.filter((t) => t.tab === "more");
  const moreActive = activeHref !== null && others.some((t) => t.href === activeHref);

  return (
    <nav
      aria-label="เมนูการตลาด"
      className="sticky top-16 z-10 hidden flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-1 py-1.5 md:flex"
    >
      {primary.map(({ href, label, icon: Icon }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${TAB_CLS} ${active ? "bg-primary-100 text-primary-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
          >
            <Icon className="hidden h-4 w-4 lg:block" aria-hidden="true" />
            {label}
          </Link>
        );
      })}

      <div
        className="relative"
        onKeyDown={(e) => {
          // Escape ขณะอยู่ในรายการ → ปิดเมนูแล้วคืนโฟกัสให้ปุ่ม "อื่นๆ"
          if (e.key === "Escape" && moreOpen) {
            setMoreOpen(false);
            moreBtnRef.current?.focus();
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMoreOpen(false);
        }}
      >
        <button
          ref={moreBtnRef}
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
          className={`${TAB_CLS} ${moreActive ? "bg-primary-100 text-primary-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
        >
          อื่นๆ
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        {moreOpen && (
          <ul aria-label="เมนูการตลาดอื่นๆ" className="absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
            {others.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={href === activeHref ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-11 items-center gap-2 px-3 text-sm font-medium hover:bg-zinc-50 ${href === activeHref ? "text-primary-700" : "text-zinc-800"}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
