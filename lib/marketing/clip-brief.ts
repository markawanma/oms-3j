// lib/marketing/clip-brief.ts — clip_brief jsonb schema v1, single source of
// truth for both server actions (lib/actions/calendar.ts) and UI (M3/M4).
// Mirrors docs/3j-jewelry/marketing/phase-content-calendar-design.md §5 and
// the shape-level CHECK + analytics.assert_clip_brief_valid() deep validation
// in supabase/migrations/0057_content_calendar.sql — keep all three in sync.
//
// Contract from the design doc that this file must honour:
//   - every id (hooks[].id, executions[].id, shots[].id) is a permanent
//     string, never an array index (R6 looks a shot up by id)
//   - fields may be missing — renderers must tolerate partial AI drafts, so
//     isValidClipBrief() only rejects genuinely malformed shapes, not
//     "incomplete" ones
//   - segments are always exactly 3 rows, ordered hook -> body -> close

export type ClipSegmentRole = "hook" | "body" | "close";

export interface ClipHook {
  id: string;
  line: string;
  hook_type?: string;
}

export interface ClipSegment {
  role: ClipSegmentRole;
  line?: string;
  duration_sec?: number;
  shot?: string;
}

export interface ClipExecution {
  id: string;
  label: string;
}

export interface ClipShot {
  id: string;
  desc: string;
  done: boolean;
  ref_role?: ClipSegmentRole;
}

export type ClipCtaType =
  | "comment_keyword"
  | "add_line"
  | "cart_link"
  | "live_reminder"
  | "follow"
  | "dm"
  | "none";

export interface ClipCta {
  type: ClipCtaType;
  code?: string | null;
  label?: string;
}

/** CMO §5 vocabulary — kept as free-form strings (not a closed union) here
 * because the design doc lists them as guidance, not a DB CHECK; a stray
 * value from an AI draft should render, not throw. */
export interface ClipBriefMeta {
  hook_type?: string | null;
  pillar?: string | null;
  moat_asset?: string | null;
  funnel_stage?: string | null;
  primary_metric?: string | null;
  linked_sku_ids?: string[];
  idea_code?: string | null;
  ai_generated?: boolean;
  ai_model?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  capcut?: {
    aspect?: string;
    target_duration_sec?: number;
  };
}

export interface ClipBrief {
  v: 1;
  idea?: string;
  hooks: ClipHook[];
  chosen_hook_id: string | null;
  segments: ClipSegment[];
  executions: ClipExecution[];
  chosen_execution_id: string | null;
  shots: ClipShot[];
  cta: ClipCta;
  meta: ClipBriefMeta;
}

const SEGMENT_ROLES: ClipSegmentRole[] = ["hook", "body", "close"];
const CTA_TYPES: ClipCtaType[] = [
  "comment_keyword",
  "add_line",
  "cart_link",
  "live_reminder",
  "follow",
  "dm",
  "none",
];

/** Empty brief, ready to render/edit: v1, the 3 fixed segment rows blank,
 * no shots yet, cta defaulted to 'none' (never a guessed default like
 * chosen_hook_id — design explicitly forbids defaulting that). */
export function emptyClipBrief(): ClipBrief {
  return {
    v: 1,
    idea: "",
    hooks: [],
    chosen_hook_id: null,
    segments: [
      { role: "hook", line: "", duration_sec: undefined, shot: "" },
      { role: "body", line: "", duration_sec: undefined, shot: "" },
      { role: "close", line: "", duration_sec: undefined, shot: "" },
    ],
    executions: [],
    chosen_execution_id: null,
    shots: [],
    cta: { type: "none", code: null, label: "" },
    meta: {
      hook_type: null,
      pillar: null,
      moat_asset: null,
      funnel_stage: null,
      primary_metric: null,
      linked_sku_ids: [],
      idea_code: null,
      ai_generated: false,
      ai_model: null,
      reviewed_by: null,
      reviewed_at: null,
      capcut: { aspect: "9:16", target_duration_sec: 30 },
    },
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Client/server validator. Deliberately tolerant of missing keys (design
 * §5: "renderer ต้องทน missing key ทุกจุด") — only rejects shapes that would
 * break the RPCs (segments[].role, shots[].id/desc) or are outright not an
 * object/array where one is required. Mirrors, but does not replace,
 * analytics.assert_clip_brief_valid() — that DB function is still the last
 * line of defense since this runs client-side too. */
export function isValidClipBrief(x: unknown): x is ClipBrief {
  if (!isRecord(x)) return false;
  if (x.v !== 1) return false;

  if (x.hooks !== undefined) {
    if (!Array.isArray(x.hooks)) return false;
    for (const h of x.hooks) {
      if (!isRecord(h) || typeof h.id !== "string" || h.id === "") return false;
    }
  }

  if (x.segments !== undefined) {
    if (!Array.isArray(x.segments)) return false;
    for (const s of x.segments) {
      if (!isRecord(s)) return false;
      if (typeof s.role !== "string" || !SEGMENT_ROLES.includes(s.role as ClipSegmentRole)) {
        return false;
      }
    }
  }

  if (x.executions !== undefined) {
    if (!Array.isArray(x.executions)) return false;
    for (const e of x.executions) {
      if (!isRecord(e) || typeof e.id !== "string" || e.id === "") return false;
    }
  }

  if (x.shots !== undefined) {
    if (!Array.isArray(x.shots)) return false;
    for (const sh of x.shots) {
      if (!isRecord(sh)) return false;
      if (typeof sh.id !== "string" || sh.id === "") return false;
      if (typeof sh.desc !== "string" || sh.desc === "") return false;
    }
  }

  if (x.cta !== undefined) {
    if (!isRecord(x.cta)) return false;
    if (typeof x.cta.type !== "string" || !CTA_TYPES.includes(x.cta.type as ClipCtaType)) {
      return false;
    }
  }

  if (x.meta !== undefined && !isRecord(x.meta)) return false;

  return true;
}

/** Next free shot id (s1, s2, ...) — never reuses/collides with existing
 * ids, even if shots were deleted out of order. */
export function nextShotId(brief: ClipBrief): string {
  const used = new Set(
    (brief.shots ?? [])
      .map((s) => s.id)
      .filter((id): id is string => typeof id === "string" && /^s\d+$/.test(id))
  );
  let n = 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

// ---- M4 (task detail page) additions --------------------------------------

/** `step_artifact.artifact_type` values that get a ClipBriefPanel instead of
 * (in addition to, per ux-content-calendar.md §3) the plain checklist —
 * mirrors the DB CHECK on `clip_brief` in 0057 ("clip_brief is null or
 * artifact_type in (...)"). Single source so page.tsx and any future caller
 * agree on the same 2 values. */
export const CLIP_ARTIFACT_TYPES = ["short_form_clip", "live_highlight_clip"] as const;

export function isClipArtifactType(artifactType: string): boolean {
  return (CLIP_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}

/** Thai labels for the closed `cta.type` union (design §5) — CTA + meta
 * accordion in ClipBriefPanel. */
export const CTA_TYPE_LABEL: Record<ClipCtaType, string> = {
  comment_keyword: "คอมเมนต์คำคีย์เวิร์ด",
  add_line: "เพิ่มเพื่อน LINE",
  cart_link: "ลิงก์ตะกร้า",
  live_reminder: "เตือนไลฟ์",
  follow: "กดติดตาม",
  dm: "ทักแชท",
  none: "ไม่มี CTA",
};

/** `meta.pillar` vocabulary from CMO §5 (design §5 comment) — display-only
 * (not a DB CHECK), so an unrecognised value falls back to the raw string
 * rather than throwing. `hook_type` is deliberately NOT given a label map
 * here (ClipBriefMeta's own comment: free-form, not a closed union). */
export const PILLAR_LABEL: Record<string, string> = {
  knowledge: "ให้ความรู้",
  entertain: "บันเทิง",
  product: "โชว์สินค้า",
  story: "เล่าเรื่อง",
  proof: "พิสูจน์/รีวิว",
  promo: "โปรโมชัน",
};
