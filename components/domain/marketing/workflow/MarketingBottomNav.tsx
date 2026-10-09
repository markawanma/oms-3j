"use client";

// MarketingBottomNav — แถบล่างมือถือ (< md) ของสายการตลาด (content-ui-build-plan.md §1.1 · D2)
// ช่องละ ≥ 44×56px · ตัวอักษร ≥ 12px · aria-current="page" · ไม่เลื่อนแนวนอน
// P1a: มีเฉพาะช่องที่มีหน้าจริง (รอฉัน · ปฏิทิน · กรอกยอด · เพิ่มเติม) — Research/ผลิต/โพสต์/ผลลัพธ์ จะเพิ่มพร้อมหน้าในเฟสถัดไป
//      (ห้ามเมนูโผล่ก่อนหน้าเสร็จ) · "เพิ่มเติม" เปิด sheet รวมหน้าอื่นทั้งหมดของสายการตลาด (แทนแถวแท็บเลื่อนแนวนอนที่ซ่อนบนมือถือ)
// ซ่อนบนหน้าชิ้นงาน (/marketing/pieces/*) เพราะหน้านั้นมีแถบปุ่มหลักติดล่างของตัวเอง

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { MARKETING_NAV, activeTabHref } from "@/lib/marketing/nav";

// รายการมาจาก lib/marketing/nav.ts (MARKETING_NAV) ที่เดียว — ช่องหลัก ≤ 4 + "เพิ่มเติม"
const MAIN = MARKETING_NAV.filter((m) => m.mobile === "main");
const MORE = MARKETING_NAV.filter((m) => m.mobile === "more");

const ITEM = "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-semibold";

export function MarketingBottomNav() {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  if (pathname.startsWith("/marketing/pieces/")) return null;

  const active = activeTabHref(pathname, [...MAIN.map((m) => m.href), ...MORE.map((m) => m.href)]);
  const moreActive = active !== null && MORE.some((m) => m.href === active);

  return (
    <>
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
