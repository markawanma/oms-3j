"use client";

// MarketingBottomNav — แถบล่างมือถือ (< md) ของสายการตลาด (content-ui-build-plan.md §1.1 · D2)
// ช่องละ ≥ 44×56px · ตัวอักษร ≥ 12px · aria-current="page" · ไม่เลื่อนแนวนอน
// ช่องและเมนู "เพิ่มเติม" มาจาก MARKETING_NAV (lib/marketing/nav.ts) — เพิ่มหน้าใหม่ = เพิ่มแถวที่นั่น (ห้ามเมนูโผล่ก่อนหน้าเสร็จ)
// "เพิ่มเติม" เปิด sheet รวมหน้าอื่นทั้งหมดของสายการตลาด (แทนแถวแท็บเลื่อนแนวนอนที่ซ่อนบนมือถือ)
// ซ่อนบนหน้าชิ้นงาน (/marketing/pieces/*) เพราะหน้านั้นมีแถบปุ่มหลักติดล่างของตัวเอง

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, Link2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { MARKETING_NAV, activeTabHref, bottomNavVisible, fabVisible } from "@/lib/marketing/nav";

// รายการมาจาก lib/marketing/nav.ts (MARKETING_NAV) ที่เดียว — ช่องหลัก ≤ 4 + "เพิ่มเติม"
const MAIN = MARKETING_NAV.filter((m) => m.mobile === "main");
const MORE = MARKETING_NAV.filter((m) => m.mobile === "more");

const ITEM = "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-semibold";

export function MarketingBottomNav() {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  if (!bottomNavVisible(pathname)) return null;

  const active = activeTabHref(pathname, [...MAIN.map((m) => m.href), ...MORE.map((m) => m.href)]);
  const moreActive = active !== null && MORE.some((m) => m.href === active);

  // ปุ่มลอย "แปะลิงก์" (มือถือ) — ทุกหน้าสายการตลาดที่มีแถบล่าง ยกเว้นหน้าแปะลิงก์เอง
  const showFab = fabVisible(pathname);

  return (
    <>
      {showFab && (
        <Link
          href="/marketing/research/capture"
          className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 inline-flex h-12 items-center gap-1.5 rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white shadow-lg hover:bg-zinc-800 md:hidden print:hidden"
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
          แปะลิงก์
        </Link>
      )}
      <nav
        aria-label="เมนูการตลาด (มือถือ)"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        {MAIN.map(({ href, label, mobileLabel, icon: Icon }) => {
          const on = href === active;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`${ITEM} ${on ? "text-primary-700" : "text-zinc-700"}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate">{mobileLabel ?? label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={`${ITEM} ${moreActive ? "text-primary-700" : "text-zinc-700"}`}
        >
          <Ellipsis className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">เพิ่มเติม</span>
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="เมนูการตลาดทั้งหมด">
        <ul className="divide-y divide-zinc-100">
          {MORE.map(({ href, label, mobileLabel }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setMoreOpen(false)}
                aria-current={href === active ? "page" : undefined}
                className={`flex min-h-12 items-center px-1 text-base font-medium ${href === active ? "text-primary-700" : "text-zinc-900"}`}
              >
                {mobileLabel ?? label}
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
