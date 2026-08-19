import type { ReactNode } from "react";
import { OemSubNav } from "@/components/domain/oem/OemSubNav";

// Nested layout for the OEM pricing module (docs/3j-jewelry/marketing/oem-
// pricing-floor.md) — mirrors app/(dashboard)/marketing/layout.tsx exactly
// (accent bar + sticky sub-nav, same negative-margin breakout of the parent
// `<main class="px-4 py-4">` padding).
export default function OemLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-primary-700">งานสั่งผลิต OEM</p>
      </div>
      <OemSubNav />
      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );
}
