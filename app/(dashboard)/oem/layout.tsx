import type { ReactNode } from "react";
import { OemSubNav } from "@/components/domain/oem/OemSubNav";

// Nested layout for the OEM pricing module (docs/3j-jewelry/marketing/oem-
// pricing-floor.md) — mirrors app/(dashboard)/marketing/layout.tsx exactly
// (accent bar + sticky sub-nav, same negative-margin breakout of the parent
// `<main class="px-4 py-4">` padding).
//
// print:mx-0 print:mt-0 on the outer wrapper matters for the /oem/quotes/
// [id]/print route only: DashboardShell's <main> drops its px-4/py-4
// padding at print time (print:p-0), so this wrapper's -mx-4 -mt-4 breakout
// (sized to counter that padding) would otherwise push the printable
// document off the physical page. The chrome inside (accent bar/sub-nav) is
// print:hidden so none of this is visible on the printed page anyway — this
// is purely about not leaving stray negative offset on the print layout.
export default function OemLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col print:mx-0 print:mt-0">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700 print:hidden" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1 print:hidden">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary-700">งานสั่งผลิต OEM</p>
      </div>
      <div className="print:hidden">
        <OemSubNav />
      </div>
      <div className="flex-1 px-4 py-4 print:p-0">{children}</div>
    </div>
  );
}
