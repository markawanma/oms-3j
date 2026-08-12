"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * CopilotSection — "รอพิจารณา" / "อนุมัติแล้ว" / "ปัดทิ้งแล้ว" (design §5).
 * Kept as 3 separate sections instead of one list with strikethrough/color
 * because a decided card mixed in with pending ones forces re-scanning every
 * card to tell which is which (design's stated reasoning) — pending stays
 * the default-visible list, the other two are collapsible audit trails.
 */
export function CopilotSection({
  title,
  count,
  defaultOpen = true,
  collapsible = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 text-left"
        >
          <h2 className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{title}</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-600">{count}</span>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{title}</h2>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-600">{count}</span>
        </div>
      )}
      {open && <div className="mt-2.5 flex flex-col gap-3">{children}</div>}
    </section>
  );
}
