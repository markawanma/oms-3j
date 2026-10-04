import type { ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

/**
 * CollapsibleSection — generic accordion-section primitive (design:
 * docs/3j-jewelry/analytics/upload-page-layout-design.md §6.1/§7/§8).
 * Built for /tiktok/upload's 3-section accordion, but domain-agnostic so any
 * future "page too long" problem can reuse it.
 *
 * HARD RULE: the content area is hidden with the native `hidden` attribute,
 * NEVER with conditional rendering (`{open && children}`). Children of this
 * section (e.g. LabelReviewQueueRow's per-row form state) must stay mounted
 * across toggles — `hidden` only toggles CSS `display:none`, it never
 * unmounts. See §2 of the design doc for the bug this avoids.
 */
export interface CollapsibleSectionBadge {
  /**
   * Three states, not two — see §7 of the design doc:
   * - `undefined` = loading, count not known yet (first fetch still in flight)
   * - `null`      = error, count not known because the fetch failed
   * - `0`         = loaded successfully, nothing pending → badge hidden entirely
   * - `>0`        = loaded successfully, real count → badge shown
   *
   * `undefined`/`null` must NEVER render as "0" — that would silently claim
   * "nothing pending" when the truth is "we don't know yet / we don't know
   * because it broke". The design doc's §6.1 prop sketch only wrote
   * `count: number | null`; widened to include `undefined` here so the
   * loading dot (§7 "ไม่แสดงตัวเลข — แสดง dot/skeleton") and the error icon
   * (§7 "ไอคอนเตือน") can render differently, since the doc's own §7 table
   * draws them as visually distinct states. Flagged as a deviation in the
   * delivery notes — not a silent reinterpretation.
   */
  count: number | null | undefined;
  tone?: BadgeTone;
  /** Transient true right after the count just changed (e.g. a file just
   * finished parsing) — caller owns the timing (set true, then clear after
   * ~2-3s via setTimeout). This component only reacts to the boolean. */
  pulse?: boolean;
}

function SectionBadge({ badge }: { badge: CollapsibleSectionBadge }) {
  const { count, tone = "amber", pulse = false } = badge;

  if (count === undefined) {
    return (
      <span
        role="status"
        aria-label="กำลังโหลดจำนวนที่ค้าง"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-zinc-300"
      />
    );
  }

  if (count === null) {
    return (
      <span role="status" className="shrink-0">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="โหลดจำนวนที่ค้างไม่สำเร็จ" />
      </span>
    );
  }

  if (count === 0) return null;

  return (
    <Badge tone={tone} className={pulse ? "animate-pulse" : ""}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">ค้าง {count} รายการ</span>
    </Badge>
  );
}

export function CollapsibleSection({
  id,
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  /** Used to build this section's DOM ids (`${id}-section/-header/-content`)
   * — must be unique per page. */
  id: string;
  title: string;
  badge?: CollapsibleSectionBadge;
  /** Controlled by the parent — this component holds no open/closed state
   * of its own (§6.2: parent owns `openSections` so it can deep-link/scroll). */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const headerId = `${id}-header`;
  const contentId = `${id}-content`;

  return (
    <div id={`${id}-section`} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-zinc-800">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          )}
          <span className="truncate">{title}</span>
        </span>
        {badge && <SectionBadge badge={badge} />}
      </button>
      {/* hidden, NOT {open && ...} — see file header comment */}
      <div id={contentId} role="region" aria-labelledby={headerId} hidden={!open} className="border-t border-zinc-100 p-3.5">
        {children}
      </div>
    </div>
  );
}
