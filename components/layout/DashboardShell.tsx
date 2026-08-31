"use client";

// DashboardShell — side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md
// §4): desktop = persistent sidebar, mobile = hamburger + drawer. Replaces the
// old header icon-nav (5 buttons, already full — CRM's 3 more routes would not
// fit). The top header bar itself stays at every breakpoint (same height as
// before) specifically so child-module sub-navs that assume `sticky top-16`
// (TikTokSubNav, CrmSubNav) keep working unmodified — only its *contents*
// change (hamburger + logo instead of inline nav links).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Calculator,
  CalendarDays,
  ClipboardList,
  Coins,
  Factory,
  FileUp,
  Gauge,
  Gem,
  Hash,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Menu,
  PackageX,
  PlusCircle,
  Radio,
  Receipt,
  Settings2,
  Tags,
  Target,
  Ticket,
  Users,
  Users2,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { signOut } from "@/lib/actions/auth";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "หน้าร้าน",
    items: [
      { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
      { href: "/", label: "ออเดอร์", icon: ClipboardList },
      { href: "/stock", label: "สต็อก", icon: Boxes },
      { href: "/stock/hero", label: "จอสต็อก Hero", icon: Gauge },
      { href: "/orders/oversold", label: "คิวของไม่พอ", icon: PackageX },
      { href: "/products/new", label: "เพิ่มสินค้า", icon: PlusCircle },
      { href: "/live", label: "ไลฟ์", icon: Radio },
    ],
  },
  {
    label: "TikTok Ops",
    items: [
      { href: "/tiktok/dashboard", label: "แดชบอร์ด TikTok", icon: BarChart3 },
      { href: "/tiktok/sales", label: "ยอดขาย", icon: Coins },
      { href: "/tiktok/upload", label: "อัปโหลด", icon: Tags },
      { href: "/tiktok/copilot", label: "Ad Copilot TikTok", icon: Target },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/crm/overview", label: "ภาพรวม", icon: LineChart },
      { href: "/crm/orders", label: "ประวัติออเดอร์", icon: Receipt },
      { href: "/crm/customers", label: "ลูกค้า", icon: Users },
      { href: "/crm/import", label: "นำเข้ายอดขาย", icon: FileUp },
      { href: "/crm/import-errors", label: "ตรวจ import", icon: AlertTriangle },
      { href: "/crm/merge", label: "รวมลูกค้าซ้ำ", icon: Users2 },
    ],
  },
  {
    label: "การตลาด",
    items: [
      { href: "/marketing/ad-spend", label: "ค่าแอด", icon: Wallet },
      { href: "/marketing/copilot", label: "Ad Copilot", icon: Megaphone },
      { href: "/marketing/audience", label: "กลุ่มลูกค้า", icon: Users2 },
      { href: "/marketing/attribution", label: "วัดผลโค้ด", icon: Ticket },
      { href: "/marketing/calendar", label: "ปฏิทินแคมเปญ", icon: CalendarDays },
    ],
  },
  {
    label: "ต้นทุน & ตั้งค่า",
    items: [
      { href: "/catalog", label: "สินค้า / ต้นทุน", icon: Gem },
      { href: "/catalog/sku-prefix", label: "ตั้งค่า Prefix SKU", icon: Hash },
      { href: "/catalog/silver-price", label: "ประวัติราคาเงิน", icon: LineChart },
      { href: "/settings", label: "ราคา & มาร์จิ้น", icon: Settings2 },
      { href: "/oem/rates", label: "ต้นทุน OEM", icon: Factory },
      { href: "/oem/quote", label: "คิดราคา OEM", icon: Calculator },
      { href: "/oem/quotes", label: "ใบเสนอราคา OEM", icon: ClipboardList },
    ],
  },
];

/** True when `href` matches the current path at all (exact, or a parent segment).
 * "/" matches only the exact root so it doesn't light up on every page. */
function pathMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The single most-specific nav href to highlight. Without the longest-match
 * step, /stock/hero would light up both "สต็อก" (/stock) and "จอสต็อก Hero"
 * (/stock/hero) since both are prefixes — only the longest should win. */
function activeNavHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathMatches(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const activeHref = activeNavHref(
    pathname,
    NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
  );
  return (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-4 p-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2 pb-1 text-[0.68rem] font-bold uppercase tracking-wider text-zinc-400">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = href === activeHref;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary-100 text-primary-700"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function DashboardShell({
  children,
  userEmail = null,
}: {
  children: ReactNode;
  /** Phase A1 (auth infra, additive) — set only when a real Supabase Auth
   * session exists (checked server-side in app/(dashboard)/layout.tsx). null
   * under the current DEV_ROLE flow (no session cookie), which hides the
   * sign-out button so it doesn't show up with nothing to sign out of. */
  userEmail?: string | null;
}) {
  const pathname = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on route change (link click already does this via
  // onNavigate, but this also covers back/forward navigation).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll + allow Escape to close while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white print:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="เปิดเมนู"
              aria-expanded={drawerOpen}
              className="-ml-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <Logo />
            {/* system name — the logo carries "3J JEWELRY", so this reads as
                "3J · Insight" (the CRM/marketing/analytics platform). */}
            <span className="hidden items-center gap-1.5 text-sm sm:flex">
              <span aria-hidden="true" className="text-zinc-300">/</span>
              <span className="font-bold tracking-tight text-primary-700">Insight</span>
            </span>
          </div>

          {/* Phase A1 (auth infra, additive) — only rendered when a real
              Supabase Auth session exists; DEV_ROLE flow (userEmail=null)
              shows nothing here, unchanged from before this phase. */}
          {userEmail && (
            <form action={signOut} className="flex items-center gap-2">
              <span className="hidden truncate text-xs text-zinc-500 sm:inline">{userEmail}</span>
              <button
                type="submit"
                className="min-h-11 rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                ออกจากระบบ
              </button>
            </form>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white md:block print:hidden">
          <NavList pathname={pathname} />
        </aside>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 print:max-w-none print:p-0">{children}</main>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-zinc-900/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="เมนูหลัก"
            className="absolute left-0 top-0 h-full w-72 max-w-[80vw] overflow-y-auto bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <Logo />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="ปิดเมนู"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
