// lib/marketing/trend-radar-parse.ts
//
// Pure parser for docs/3j-jewelry/marketing/trend-radar/YYYY-MM-DD.md — the
// daily-trend-radar scheduled task's output, written by an LLM every day
// (NOT a fixed template, see that task's own brief). lib/actions/
// trend-radar.ts fetches the raw file text from GitHub and hands it to
// parseTrendRadarDay() here; kept separate (no "use server", no fetch,
// no Supabase) so this is directly unit-testable with plain strings — same
// split this repo already uses for lib/marketing/campaign-board-mapper.ts /
// calendar-errors.ts (pure mapping) vs. lib/actions/calendar.ts (fetch/gate
// orchestration).
//
// 🔴 Checked against the REAL files on disk (docs/3j-jewelry/marketing/
// trend-radar/2026-09-23.md through -29.md), not just the task brief's own
// template — the brief's example ("### [ชื่อมุม]", "**ประเภท**: value") does
// NOT match what the task actually wrote on 23 ก.ย. 69 (the one real day
// with an angle so far): real angles are "**1. ชื่อมุม**" (a bold-only line,
// no "### ", no leading "- ") followed by "- **ป้าย:** ค่า" bullets where the
// colon sits INSIDE the bold, not outside like the brief's template. Every
// regex below tolerates both shapes at once (colon in-or-out of the bold,
// numbered-or-not title, "### " or bold-only title) because the file is
// LLM-written daily and the brief itself warns it can drift — this already
// happened once between the brief and the real file, it is not hypothetical.
//
// Anything this parser doesn't recognize -> parseOk: false, rawMarkdown is
// still returned in full either way. Never throws.

/** migration 0145's seed INSERT (supabase/migrations/0145_content_taxonomy.sql)
 * — the only 5 valid analytics.content_type codes today. New ones are added
 * there by INSERT, never by re-palette; if one is ever added this list needs
 * a matching update (comment-only enforcement, same as this repo's other TS
 * mirrors of a DB enum, e.g. campaign-types.ts's ArtifactStatus). A "ประเภท"
 * value that doesn't match exactly becomes `null`, never auto-corrected —
 * guessing a close-but-wrong code is worse than leaving it untagged. */
const CONTENT_TYPE_CODES = new Set(["drive_live", "knowledge", "craft", "customer", "announce"]);

export interface TrendAngle {
  title: string;
  /** One of CONTENT_TYPE_CODES above, or null if the "ประเภท" field is
   * missing or doesn't match one of the 5 exactly. Render via
   * ContentTypeChip when non-null (design: outline+dot, never solid). */
  contentTypeCode: string | null;
  whyNow: string | null;
  needs: string | null;
  /** First `[text](url)` link found inside the "แหล่งอ้างอิง" field, or null.
   * A day's angle can cite more than one source — only the first is kept,
   * since the type carries a single URL (documented trade-off, not a bug:
   * the "เพิ่มเข้าปฏิทิน" button only needs one link to show, not a list). */
  sourceUrl: string | null;
  /** "สูง" / "กลาง" / "ต่ำ" extracted from free text inside "แหล่งอ้างอิง"
   * (e.g. "ความมั่นใจกลาง" or "ความมั่นใจ: กลาง" — both forms seen) — the
   * FIRST such mention in the field, same single-value trade-off as
   * sourceUrl above when a day cites multiple sources with different
   * confidence each. */
  confidence: string | null;
}

export interface TrendRadarDay {
  /** "YYYY-MM-DD", from the source filename. */
  date: string;
  /** True when the "## วันนี้ไม่มีอะไรใหม่" section header is present —
   * `angles` is `[]` in that case (nothing to render as a card). */
  hasNothing: boolean;
  angles: TrendAngle[];
  /** "## ⚠️ ต้องให้เจ้าของยืนยันก่อนใช้" bullets, verbatim text minus the
   * leading "- ". Display-only, no action button — these need the owner's
   * own judgement (e.g. "is this item actually in stock"), not something a
   * button should decide on their behalf. */
  pendingQuestions: string[];
  /** The untouched file content — always populated regardless of parseOk,
   * so the UI can always fall back to showing this instead of nothing. */
  rawMarkdown: string;
  /** false = the file didn't match either expected shape ("nothing new today"
   * or a "มุมที่หยิบไปทำได้เลย" section that actually yielded >=1 angle) — the
   * UI must render rawMarkdown instead of the structured fields above,
   * which may be empty/partial in this case. */
  parseOk: boolean;
}

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** `"2026-09-29.md"` -> `"2026-09-29"`, or null if the name isn't shaped like
 * a trend-radar day file at all. */
export function extractDateFromFilename(name: string): string | null {
  const m = FILENAME_RE.exec(name);
  return m ? m[1] : null;
}

interface Section {
  heading: string;
  body: string[];
}

/** Splits the file into top-level ("## ", exactly two hashes) sections.
 * "### " (three hashes) is NOT a section boundary here — it's one of the
 * two shapes an individual angle's own title line can take inside the
 * "มุมที่หยิบไปทำได้เลย" section's body (see parseAngleTitleLine). */
function splitIntoSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const headingMatch = /^##\s+(?!#)(.*)$/.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function findSection(sections: Section[], needle: string): Section | null {
  return sections.find((s) => s.heading.includes(needle)) ?? null;
}

/** First `[text](url)` markdown link's URL inside a field value. */
function extractFirstLinkUrl(value: string): string | null {
  const m = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(value);
  return m ? m[1] : null;
}

/** Tolerates "ความมั่นใจกลาง" (real files, no separator) and the brief's own
 * "ความมั่นใจ: กลาง" (colon+space) equally. */
function extractConfidence(value: string): string | null {
  const m = /ความมั่นใจ\s*:?\s*(สูง|กลาง|ต่ำ)/.exec(value);
  return m ? m[1] : null;
}

/** One bullet field line: `"- **label:** value"` or `"- **label**: value"`
 * (colon inside or outside the bold — both appear in the wild, see file
 * header). Returns null for anything else, e.g. the freeform "⚠️ ห้ามพูดว่า…"
 * caveat lines some days add — intentionally dropped, there is no typed
 * field for them, and dropping an unrecognized bullet must never fail the
 * whole angle. */
function parseFieldBullet(line: string): { label: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("-")) return null;
  const m = /^-\s*\*\*(.+?)\*\*(.*)$/.exec(trimmed);
  if (!m) return null;
  const label = m[1].replace(/[:：]\s*$/, "").trim();
  const value = m[2].replace(/^\s*[:：]\s*/, "").trim();
  return { label, value };
}

/** A new angle's title line: the WHOLE trimmed line is bold with nothing
 * else around it, and (unlike a field bullet) it does NOT start with "-".
 * Tolerates a leading "N. " (the real files' numbered-list style) and the
 * brief's un-numbered style equally — both just get stripped. Also accepts
 * a literal "### " heading, in case a future day uses the brief's template
 * shape instead. */
function parseAngleTitleLine(line: string): string | null {
  const trimmed = line.trim();
  const h3 = /^###\s+(.+)$/.exec(trimmed);
  if (h3) return h3[1].replace(/^\d+\.\s*/, "").trim();
  if (trimmed.startsWith("-")) return null;
  const bold = /^\*\*(.+)\*\*$/.exec(trimmed);
  if (!bold) return null;
  return bold[1].replace(/^\d+\.\s*/, "").trim();
}

const FIELD_LABELS = {
  type: "ประเภท",
  whyNow: "ทำไมตอนนี้",
  needs: "ต้องมีอะไรถึงถ่ายได้",
  source: "แหล่งอ้างอิง",
} as const;

function parseAngles(body: string[]): TrendAngle[] {
  const angles: TrendAngle[] = [];
  let current: TrendAngle | null = null;

  for (const line of body) {
    const title = parseAngleTitleLine(line);
    if (title !== null) {
      if (current) angles.push(current);
      current = { title, contentTypeCode: null, whyNow: null, needs: null, sourceUrl: null, confidence: null };
      continue;
    }
    if (!current) continue; // stray line before any title line — ignore

    const field = parseFieldBullet(line);
    if (!field) continue;

    switch (field.label) {
      case FIELD_LABELS.type: {
        const code = field.value.trim();
        current.contentTypeCode = CONTENT_TYPE_CODES.has(code) ? code : null;
        break;
      }
      case FIELD_LABELS.whyNow:
        current.whyNow = field.value || null;
        break;
      case FIELD_LABELS.needs:
        current.needs = field.value || null;
        break;
      case FIELD_LABELS.source:
        current.sourceUrl = extractFirstLinkUrl(field.value);
        current.confidence = extractConfidence(field.value);
        break;
      default:
        // "ด่าน" and anything else the task adds in the future — no typed
        // field, intentionally dropped rather than guessed into one.
        break;
    }
  }
  if (current) angles.push(current);
  return angles;
}

function parsePendingQuestions(body: string[]): string[] {
  const out: string[] = [];
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-")) {
      out.push(trimmed.replace(/^-\s*/, "").trim());
    }
  }
  return out;
}

/**
 * Parses one day's raw markdown into a `TrendRadarDay`. Never throws —
 * anything that doesn't match either expected shape produces
 * `parseOk: false` with `rawMarkdown` still populated in full, so the
 * caller/UI can always fall back to showing the raw file instead of
 * nothing (or a wrong "nothing today" message).
 */
export function parseTrendRadarDay(date: string, rawMarkdown: string): TrendRadarDay {
  const lines = rawMarkdown.replace(/\r\n/g, "\n").split("\n");
  const sections = splitIntoSections(lines);

  const nothingSection = findSection(sections, "วันนี้ไม่มีอะไรใหม่");
  const anglesSection = findSection(sections, "มุมที่หยิบไปทำได้เลย");
  const pendingSection = findSection(sections, "ต้องให้เจ้าของยืนยันก่อนใช้");

  const hasNothing = nothingSection !== null;
  const angles = anglesSection ? parseAngles(anglesSection.body) : [];
  const pendingQuestions = pendingSection ? parsePendingQuestions(pendingSection.body) : [];

  // Success means the file matched one of the two shapes a day is supposed
  // to take: "nothing new" (angles legitimately empty), or a real angles
  // section that actually yielded at least one angle. A "มุมที่หยิบไปทำได้เลย"
  // heading present but zero angles parsed out of its body is treated as a
  // FAILURE, not an empty day — the heading being there means the body was
  // supposed to be parseable and wasn't, which is exactly the "format
  // drifted" case that must fall back to raw, not silently render as if
  // there were no angles today.
  const parseOk = hasNothing || angles.length > 0;

  return { date, hasNothing, angles, pendingQuestions, rawMarkdown, parseOk };
}
