import type { ReactNode } from "react";
import { MarketingSubNav } from "@/components/domain/marketing/MarketingSubNav";

// Nested layout for the Marketing Activation module (docs/3j-jewelry/
// analytics/phase-b3-design.md) — mirrors app/(dashboard)/crm/layout.tsx
// exactly (accent bar + sub-nav, same negative-margin breakout of the parent
// `<main class="px-4 py-4">` padding). Uses `primary` indigo, not `brand`
// red (brand is TikTok-module-scoped only) — same reasoning as CRM's layout.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary-700">การตลาด</p>
      </div>
      <MarketingSubNav />
      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );
}
