import type { ReactNode } from "react";
import { MarketingSubNav } from "@/components/domain/marketing/MarketingSubNav";
import { MarketingBottomNav } from "@/components/domain/marketing/workflow/MarketingBottomNav";

// Nested layout for the Marketing Activation module (docs/3j-jewelry/
// analytics/phase-b3-design.md) — mirrors app/(dashboard)/crm/layout.tsx
// exactly (accent bar + sub-nav, same negative-margin breakout of the parent
// `<main class="px-4 py-4">` padding). `primary` here is the 3J brand red
// (#a2191d — tailwind.config.ts), not indigo.
//
// P1a (content-ui-build-plan.md §1.1): บนมือถือ (< md) แถวแท็บเลื่อนแนวนอนถูกซ่อน (MarketingSubNav `hidden md:flex`)
// และใช้ MarketingBottomNav แทน → เนื้อหาต้องเผื่อพื้นที่ล่างให้แถบนั้น (pb ด้านล่าง) ไม่ให้ปุ่มท้ายหน้าถูกบัง
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-700">การตลาด</p>
      </div>
      <MarketingSubNav />
      <div className="flex-1 px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4">{children}</div>
      <MarketingBottomNav />
    </div>
  );
}
