import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, ClipboardList, PlusCircle, Radio } from "lucide-react";
import { ToastProvider } from "@/components/ui/Toast";

const NAV_ITEMS = [
  { href: "/", label: "ออเดอร์", icon: ClipboardList },
  { href: "/stock", label: "สต็อก", icon: Boxes },
  { href: "/products/new", label: "เพิ่มสินค้า", icon: PlusCircle },
  { href: "/live", label: "ไลฟ์", icon: Radio },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-lg font-bold text-primary-700">OMS</span>
            <nav aria-label="เมนูหลัก" className="flex gap-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 px-4 py-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
