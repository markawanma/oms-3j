import type { ReactNode } from "react";
import { TikTokSubNav } from "@/components/domain/tiktok/TikTokSubNav";

// Nested layout for the TikTok Ops module (design §1/§7). Breaks out of the
// parent `<main class="px-4 py-4">` padding with negative margins so the
// brand accent bar + sub-nav can go full-bleed edge-to-edge like the OMS
// header does, then re-applies horizontal padding for the module content.
export default function TikTokLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col">
      {/* 3J brand red accent — module-scoped only, per design §7 (`brand`
          token is never used for buttons/tabs, those stay indigo `primary`). */}
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-brand to-brand-ink" aria-hidden="true" />
      <div className="border-b border-slate-200 bg-white px-4 pt-2.5 pb-1">
        <p className="text-[0.68rem] font-bold uppercase tracking-wider text-brand">TikTok Ops</p>
      </div>
      <TikTokSubNav />
      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );
}
