import type { ReactNode } from "react";
import { ProductionSubNav } from "@/components/domain/production/ProductionSubNav";

// Nested layout for the production-order module (docs/3j-jewelry/oms/
// design-production-order.md) — mirrors app/(dashboard)/oem/layout.tsx
// exactly (accent bar + sticky sub-nav, same negative-margin breakout of the
// parent `<main class="px-4 py-4">` padding). This module has no print
// route (unlike OEM's quote/receipt PDFs), so the print:mx-0/print:hidden
// classes here are just defensive consistency with the pattern, not load-
// bearing for any real page today.
export default function ProductionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col print:mx-0 print:mt-0">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700 print:hidden" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1 print:hidden">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary-700">ใบผลิตเข้าสต็อก (ผลิตเอง)</p>
      </div>
      <div className="print:hidden">
        <ProductionSubNav />
      </div>
      <div className="flex-1 px-4 py-4 print:p-0">{children}</div>
    </div>
  );
}
