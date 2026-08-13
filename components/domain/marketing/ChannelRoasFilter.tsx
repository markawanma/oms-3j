"use client";

// ChannelRoasFilter — client wrapper around ChannelRoasTable (which stays a
// plain/server-safe presentational component, untouched) so /marketing/copilot
// can filter the month x channel ROAS table by sales channel after the
// 8-month backfill made it long (8 months x 3-4 channels). Same chip pattern
// as AudiencePageClient's RFM segment tabs (/marketing/audience) — "all" +
// one chip per distinct channel present in the data, client-side filter only
// (no refetch, rows are already fully loaded).

import { useMemo, useState } from "react";
import type { MktChannelRoasRow } from "@/lib/marketing/types";
import { ChannelRoasTable } from "@/components/domain/marketing/ChannelRoasTable";

export function ChannelRoasFilter({
  rows,
  blendedMarginPct,
}: {
  rows: MktChannelRoasRow[];
  blendedMarginPct: number;
}) {
  const [channelCode, setChannelCode] = useState<string>("all");

  // distinct channels present in the data, sorted by channelCode for a
  // stable chip order across renders (the view's row order is month-major,
  // not channel-major, so it can't be used directly).
  const channels = useMemo(() => {
    const m = new Map<string, { channelCode: string; channelName: string; count: number }>();
    for (const r of rows) {
      const existing = m.get(r.channelCode);
      if (existing) existing.count += 1;
      else m.set(r.channelCode, { channelCode: r.channelCode, channelName: r.channelName, count: 1 });
    }
    return [...m.values()].sort((a, b) => a.channelCode.localeCompare(b.channelCode));
  }, [rows]);

  const filtered = useMemo(
    () => (channelCode === "all" ? rows : rows.filter((r) => r.channelCode === channelCode)),
    [rows, channelCode]
  );

  return (
    <div className="space-y-2">
      {channels.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="กรองช่องทาง">
          <button
            type="button"
            onClick={() => setChannelCode("all")}
            className={`min-h-11 rounded-full px-3 text-sm font-semibold transition-colors ${
              channelCode === "all"
                ? "bg-primary-100 text-primary-700"
                : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
            }`}
          >
            ทั้งหมด
          </button>
          {channels.map((c) => {
            const active = channelCode === c.channelCode;
            return (
              <button
                key={c.channelCode}
                type="button"
                onClick={() => setChannelCode(c.channelCode)}
                className={`min-h-11 rounded-full px-3 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-primary-100 text-primary-700"
                    : "border border-zinc-300 text-zinc-600 hover:border-primary-600 hover:text-primary-700"
                }`}
              >
                {c.channelName} <span className={active ? "opacity-80" : "text-zinc-400"}>({c.count})</span>
              </button>
            );
          })}
        </div>
      )}

      {channelCode !== "all" && filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          ไม่พบข้อมูลของช่องทางนี้
        </p>
      ) : (
        // rows.length === 0 (no data at all) falls through to
        // ChannelRoasTable's own empty-state render — don't duplicate it here.
        <ChannelRoasTable rows={filtered} blendedMarginPct={blendedMarginPct} />
      )}
    </div>
  );
}
