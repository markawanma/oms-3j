"use client";

// DashboardShell — side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md
// §4): desktop = persistent sidebar, mobile = hamburger + drawer. Replaces the
// old header icon-nav (5 buttons, already full — CRM's 3 more routes would not
// fit). The top header bar itself stays at every breakpoint (same height as
// before) specifically so child-module sub-navs that assume `sticky top-16`
// (TikTokSubNav, CrmSubNav) keep working unmodified — only its *contents*
// change (hamburger + logo instead of inline nav links).
import { useCallback, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Calculator,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Diamond,
  Factory,
  FileUp,
  Gauge,
  Gem,
  Hammer,
  HardHat,
  Hash,
  LayoutDashboard,
  LineChart,
  Menu,
  PackageX,
  PlusCircle,
  Radio,
  Receipt,
  Settings2,
  Tags,
  Target,
  UserCog,
  Users,
  Users2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { MARKETING_NAV, isWideMarketingPath } from "@/lib/marketing/nav";
import { isWideJobsPath } from "@/lib/jobs/nav";
import { signOut } from "@/lib/actions/auth";
import { loadCollapsed, saveCollapsed } from "@/lib/nav/collapsed";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// 🔴 เมนูซ่อน (เจ้าของสั่ง 10 ก.ย. 69 หลังรีวิวว่าหน้าไหน "เกินจำเป็น")
// หน้าเหล่านี้ยังอยู่ครบและเข้าถึงได้ด้วยการพิมพ์ URL ตรง — ซ่อนเพราะตารางที่
// มันอ่านยังว่างอยู่จริง เปิดไปเจอหน้าเปล่าทุกครั้ง ทำให้เมนูหลอกตาว่ามีของ:
//   /orders + /orders/oversold  -> public.orders = 0 แถว (ยอดขายจริงอยู่
//                                  analytics.fact_order เข้ามาทางไฟล์ Shipnity)
//   /stock                      -> public.central_stock = 2 แถว
//   /stock/hero                 -> analytics.hero_watch = 0 แถว
//   /live                       -> public.live_session = 1 แถว
//   /tiktok/sales               -> อ่าน public.orders เช่นกัน = 0 แถว
//                                  (/dashboard ตอบคำถามเดียวกันครบกว่าอยู่แล้ว)
// เอากลับมาเมื่อระบบเริ่มเขียนออเดอร์เข้า public.orders ตรงๆ แทนการ import:
// แค่ย้ายบรรทัดกลับเข้า items ไม่ต้องแก้อย่างอื่น
const NAV_GROUPS: NavGroup[] = [
  {
    label: "หน้าร้าน",
    items: [
      { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
      { href: "/products/new", label: "เพิ่มสินค้า", icon: PlusCircle },
    ],
  },
  {
    label: "TikTok Ops",
    items: [
      { href: "/tiktok/dashboard", label: "แดชบอร์ด TikTok", icon: BarChart3 },
      { href: "/tiktok/live-log", label: "จดไลฟ์", icon: Radio },
      { href: "/tiktok/upload", label: "อัปโหลด", icon: Tags },
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
      // มาจาก lib/marketing/nav.ts (MARKETING_NAV) ที่เดียว
      ...MARKETING_NAV.filter((m) => m.sidebar).map((m) => ({ href: m.href, label: m.sidebarLabel ?? m.label, icon: m.icon })),
    ],
  },
  {
    label: "ผลิตเอง",
    items: [{ href: "/production", label: "ใบผลิตเข้าสต็อก", icon: Hammer }],
  },
  {
    // ระบบใบงานผลิต J1 (design-job-tracking.md §6.3) — เฉพาะ owner/admin (กรองด้านล่าง · ด่านจริงอยู่ที่หน้า/action)
    label: "ใบงาน",
    items: [
      { href: "/jobs", label: "ใบงานผลิต", icon: ClipboardCheck },
      { href: "/jobs/gems-to-buy", label: "พลอยที่ต้องสั่ง", icon: Diamond },
      { href: "/jobs/workers", label: "ทะเบียนช่าง", icon: HardHat },
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
      { href: "/oem/gems", label: "แคตตาล็อกพลอย", icon: Diamond },
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

/** หมวดที่มีหน้า active อยู่ (longest-match เดียวกับไฮไลต์) — null ถ้าไม่อยู่หน้าไหนในเมนูเลย */
function activeGroupLabel(pathname: string, groups: NavGroup[]): string | null {
  const href = activeNavHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href))
  );
  if (href === null) return null;
  return groups.find((g) => g.items.some((i) => i.href === href))?.label ?? null;
}

function NavList({
  groups,
  pathname,
  collapsed,
  onToggleGroup,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  /** label ของหมวดที่พับอยู่ — state เดียวกันทั้ง sidebar และ drawer (อยู่ที่ DashboardShell) */
  collapsed: ReadonlySet<string>;
  onToggleGroup: (label: string) => void;
  onNavigate?: () => void;
}) {
  // sidebar กับ drawer render NavList พร้อมกันได้ (drawer เปิดบนมือถือ) — id ต้องไม่ซ้ำเพื่อให้ aria-controls ชี้ถูกตัว
  const uid = useId();
  const activeHref = activeNavHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href))
  );
  return (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-2 p-3">
      {groups.map((group, idx) => {
        const open = !collapsed.has(group.label);
        const hasActive = group.items.some((i) => i.href === activeHref);
        const panelId = `${uid}-nav-group-${idx}`;
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.label)}
              aria-expanded={open}
              aria-controls={panelId}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[0.68rem] font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {group.label}
                {/* พับอยู่แต่หน้าปัจจุบันอยู่ในหมวดนี้ — จุด brand บอกว่า "อยู่ในนี้" */}
                {!open && hasActive && (
                  <>
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600" />
                    <span className="sr-only">(หน้าที่เปิดอยู่อยู่ในหมวดนี้)</span>
                  </>
                )}
              </span>
              {/* motion-reduce: ยังพลิกทิศบอกสถานะ แต่ไม่มี transition (เปลี่ยนทันที) */}
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
                aria-hidden="true"
              />
            </button>
            {/* ซ่อนด้วย hidden (ไม่ unmount) — aria-controls ต้องมี element จริงให้ชี้ · wrapper นี้ห้ามมี class display เอง ไม่งั้นทับ [hidden] */}
            <div id={panelId} hidden={!open}>
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = href === activeHref;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${
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
          </div>
        );
      })}
    </nav>
  );
}

export function DashboardShell({
  children,
  userEmail = null,
  role = null,
}: {
  children: ReactNode;
  /** Phase A1 (auth infra, additive) — set only when a real Supabase Auth
   * session exists (checked server-side in app/(dashboard)/layout.tsx). null
   * under the current DEV_ROLE flow (no session cookie), which hides the
   * sign-out button so it doesn't show up with nothing to sign out of. */
  userEmail?: string | null;
  /** A2-lite (register/approve, 16 ก.ย. 69) — from getMembership(), same
   * null-under-DEV_ROLE-flow behavior as userEmail above. UI-only gate: only
   * controls whether the "สมาชิก" nav item renders, the real gate is on the
   * server actions in lib/actions/members.ts. */
  role?: "owner" | "admin" | "staff" | null;
}) {
  const pathname = usePathname() ?? "";
  const [drawerOpen, setDrawerOpen] = useState(false);

  // กลุ่ม "ใบงาน" ซ่อนจาก staff (role null = ยังไม่มี session จริง/DEV flow → แสดงเหมือนเมนูอื่น) — UI เท่านั้น ด่านจริงอยู่ที่ canManageJobs + requireOwnerAdmin
  const visibleGroups = role === "staff" ? NAV_GROUPS.filter((g) => g.label !== "ใบงาน") : NAV_GROUPS;
  const navGroups: NavGroup[] =
    role === "owner"
      ? [
          ...visibleGroups,
          { label: "ทีม", items: [{ href: "/settings/members", label: "สมาชิก", icon: UserCog }] },
        ]
      : visibleGroups;

  // พับ/กางหมวดเมนู (เจ้าของสั่ง 20 ต.ค. 69) — state เดียวใช้ทั้ง sidebar และ drawer
  // SSR + render แรก = กางทุกหมวด (Set ว่าง) แล้วค่อยอ่าน localStorage หลัง mount เท่านั้น กัน hydration mismatch
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [navPrefsLoaded, setNavPrefsLoaded] = useState(false);
  const currentGroup = activeGroupLabel(pathname, navGroups);

  useEffect(() => {
    const stored = new Set(loadCollapsed());
    // หมวดที่หน้าปัจจุบันอยู่ในนั้นกางเสมอตอนเข้าหน้า (ผู้ใช้พับเองทีหลังได้)
    if (currentGroup) stored.delete(currentGroup);
    setCollapsed(stored);
    setNavPrefsLoaded(true);
    // deps ว่างโดยตั้งใจ: อ่านครั้งเดียวตอน mount · การเปลี่ยนหมวดตอนใช้งานจัดการใน effect ถัดไป
  }, []);

  // เข้าสู่หมวดอื่น (active group เปลี่ยน) → กางหมวดนั้นอัตโนมัติ · เปลี่ยนหน้าภายในหมวดเดิมไม่แตะ
  // ไม่งั้นผู้ใช้ที่พับหมวดทิ้งไว้จะโดนกางซ้ำทุกครั้งที่กด sub-nav ในหน้า
  useEffect(() => {
    if (!navPrefsLoaded || !currentGroup) return;
    setCollapsed((prev) => {
      if (!prev.has(currentGroup)) return prev;
      const next = new Set(prev);
      next.delete(currentGroup);
      return next;
    });
  }, [currentGroup, navPrefsLoaded]);

  // จำค่า — ไม่เขียนก่อนอ่านเสร็จ (ไม่งั้น Set ว่างตอนแรกจะทับค่าที่เคยจำไว้)
  useEffect(() => {
    if (navPrefsLoaded) saveCollapsed(collapsed);
  }, [collapsed, navPrefsLoaded]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

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
          <NavList groups={navGroups} pathname={pathname} collapsed={collapsed} onToggleGroup={toggleGroup} />
        </aside>

        {/* ความกว้างเนื้อหา: เดิม max-w-3xl ทุกหน้า — ขยายเฉพาะหน้า workflow content ใหม่ที่ต้อง 2 คอลัมน์บน PC
            (isWideMarketingPath: /marketing และ /marketing/pieces/*) + บอร์ดใบงาน /jobs (isWideJobsPath · exact) · หน้าอื่นไม่เปลี่ยน */}
        <main
          className={`mx-auto w-full ${isWideMarketingPath(pathname) || isWideJobsPath(pathname) ? "max-w-6xl" : "max-w-3xl"} min-w-0 flex-1 px-4 py-4 print:max-w-none print:p-0`}
        >
          {children}
        </main>
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
            <NavList
              groups={navGroups}
              pathname={pathname}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
