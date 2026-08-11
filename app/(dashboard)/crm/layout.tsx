import type { ReactNode } from "react";
import { CrmSubNav } from "@/components/domain/crm/CrmSubNav";

// Nested layout for the CRM module (design §4) — mirrors
// app/(dashboard)/tiktok/layout.tsx exactly (accent bar + sub-nav, same
// negative-margin breakout of the parent `<main class="px-4 py-4">`
// padding). Accent uses `primary` indigo (not `brand` red — brand is
// TikTok-module-scoped only, see tiktok/layout.tsx's own comment) so CRM
// reads as a first-party OMS module, not a marketplace-specific one.
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700" aria-hidden="true" />
      <div className="border-b border-slate-200 bg-white px-4 pt-2.5 pb-1">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary-700">CRM</p>
      </div>
      <CrmSubNav />
      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );
}
