"use client";

// Channel filter chips for /crm/overview — sibling of CrmDateRangeFilter.tsx
// (same URL-driven navigation pattern: this component holds no state of its
// own, it just pushes `?channel=<code>` and lets the server component
// (page.tsx) re-fetch via getCrmOverview({ channelCode }) — see that page's
// header comment for why URL-driven beats client state here). Unlike
// ChannelRoasFilter (client-side filter over already-loaded rows), the
// channel option list AND the totals both come from the server per request,
// so "all channels" vs "one channel" has to be a real query param, not local
// state.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { CrmChannelOption } from "@/lib/crm/order-override";

export function CrmChannelFilter({
  channels,
  requestedChannelCode,
  from,
  to,
  basePath = "/crm/overview",
}: {
  /** scope.channels from getCrmOverview — every channel this shop's
   * dim_channel carries, regardless of whether it has orders in the current
   * date range (so switching channel never makes chips disappear). */
  channels: CrmChannelOption[];
  /** scope.requestedChannelCode — null means "every channel" (active chip). */
  requestedChannelCode: string | null;
  /** Current from/to ("YYYY-MM-DD" | null) so switching channel preserves
   * whatever date range is already applied, instead of resetting it. */
  from: string | null;
  to: string | null;
  basePath?: string;
}) {
  const router = useRouter();

  const navigate = useCallback(
    (channelCode: string | null) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (channelCode) params.set("channel", channelCode);
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    },
    [router, basePath, from, to]
  );

  if (channels.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="กรองช่องทาง">
      <button
        type="button"
        onClick={() => navigate(null)}
        aria-pressed={requestedChannelCode === null}
        className={`min-h-11 rounded-full px-3 text-sm font-semibold transition-colors ${
          requestedChannelCode === null
            ? "bg-primary-100 text-primary-700"
            : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
        }`}
      >
        ทุกช่องทาง
      </button>
      {channels.map((c) => {
        const active = requestedChannelCode === c.code;
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => navigate(c.code)}
            aria-pressed={active}
            className={`min-h-11 rounded-full px-3 text-sm font-semibold transition-colors ${
              active
                ? "bg-primary-100 text-primary-700"
                : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
