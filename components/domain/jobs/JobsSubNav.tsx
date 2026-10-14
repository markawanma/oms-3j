"use client";

// JobsSubNav — แท็บย่อยของระบบใบงาน (ออฟฟิศ): บอร์ด · ทะเบียนช่าง · (เพิ่มเมื่อหน้าพร้อม — ห้ามลิงก์ไปหน้ายังไม่เสร็จ)
// ซ่อนตอนพิมพ์ · ปุ่ม ≥ 44px · aria-current ตามพาธ (ใบงานแต่ละใบ /jobs/<id> ไม่ทำให้แท็บ "บอร์ด" สว่างค้าง — ตรงเฉพาะ /jobs)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, HardHat } from "lucide-react";

const TABS = [
  { href: "/jobs", label: "บอร์ดใบงาน", icon: ClipboardList, exact: false },
  { href: "/jobs/workers", label: "ทะเบียนช่าง", icon: HardHat, exact: true },
] as const;

export function jobsTabActive(pathname: string | null, href: string): boolean {
  const p = pathname ?? "";
  if (href === "/jobs") return p === "/jobs" || (p.startsWith("/jobs/") && !p.startsWith("/jobs/workers"));
  return p === href || p.startsWith(`${href}/`);
}

export function JobsSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="เมนูใบงาน" className="flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-1 py-1.5 print:hidden">
      {TABS.map(({ href, label, icon: Icon }) => {
        const on = jobsTabActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${on ? "bg-primary-100 text-primary-700" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
