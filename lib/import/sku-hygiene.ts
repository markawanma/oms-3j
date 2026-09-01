// lib/import/sku-hygiene.ts — pure SKU-cell-hygiene analyzer.
//
// Design: import preview needs to surface Thai vowel/tone marks and invisible
// Unicode characters that land stray in front of an otherwise-normal SKU
// (observed in real Shipnity exports: `์NC20-*` U+0E4C x14, `ืNC22-*` U+0E37
// x4 — invisible to the eye, so the owner has been hand-fixing these blind).
//
// Deliberately NOT "server-only" — this module only does string analysis, no
// I/O, so it can be unit-tested directly and imported from a server action
// without pulling in any Node-only APIs.
//
// Everything here is advisory: no function in this file decides whether an
// import is allowed to proceed. The caller (lib/actions/import-line-items.ts)
// owns that decision entirely; this module just classifies characters.

// ============================================================================
// Public types (contract)
// ============================================================================

export type SkuCharIssueKind =
  | "orphan_thai_mark"
  | "zero_width"
  | "control"
  | "pua"
  | "nbsp_or_odd_space"
  | "edge_space";

export interface SkuCharIssue {
  kind: SkuCharIssueKind;
  /** 1-based code point index into the string (NOT a UTF-16 index — every
   * character this module classifies is in the Basic Multilingual Plane, so
   * Array.from()'s code-point iteration and UTF-16 index happen to coincide
   * here, but position is always computed via code-point iteration to stay
   * correct if that ever stops being true). */
  position: number;
  /** e.g. "U+0E4C" */
  codepoint: string;
  /** Thai/plain-language name for the character, from the static table
   * below. Falls back to a generic label for anything not in the table
   * (control chars and PUA code points are effectively unbounded — a static
   * name table can't cover them, and we deliberately do not bundle a full
   * Unicode character-name database just for this). */
  charName: string;
}

export interface SkuHygieneFinding {
  rawSku: string;
  cleanedSku: string;
  issues: SkuCharIssue[];
  /** "amber" if any issue in `issues` is amber-severity, else "zinc". */
  severity: "amber" | "zinc";
  /** Count of raw rows in the file whose SKU cell text exactly matched
   * `rawSku` (assigned by the caller when grouping — this module only
   * analyzes one string at a time and never looks at duplication itself,
   * see chain-rule note below). */
  rowCount: number;
  /** Whether `cleanedSku` matches an existing SKU in the shop's catalog —
   * filled in by the caller (this module has no DB access). */
  cleanedExistsInCatalog: boolean;
}

// ============================================================================
// Severity table (design: 3j-migration-traps brief, "เกณฑ์ + severity")
// ============================================================================

const SEVERITY_BY_KIND: Record<SkuCharIssueKind, "amber" | "zinc"> = {
  orphan_thai_mark: "amber",
  zero_width: "amber",
  control: "amber",
  pua: "amber",
  nbsp_or_odd_space: "zinc",
  edge_space: "zinc",
};

/** Overall severity for a SkuHygieneFinding — amber wins if any issue is
 * amber. Exported (not just used internally) so the caller that groups raw
 * cell text into findings doesn't need its own copy of SEVERITY_BY_KIND. */
export function findingSeverity(issues: SkuCharIssue[]): "amber" | "zinc" {
  return issues.some((i) => SEVERITY_BY_KIND[i.kind] === "amber") ? "amber" : "zinc";
}

// ============================================================================
// Static character-name table (~30 entries: Thai marks + known invisible
// chars). Anything not in here falls back to a generic "U+XXXX (...)" label
// — deliberately no bundled Unicode name database (see SkuCharIssue.charName
// doc above).
// ============================================================================

const CHAR_NAMES: Readonly<Record<number, string>> = {
  // Thai combining marks (design table: U+0E31, U+0E33-0E3A, U+0E47-0E4E)
  0x0e31: "ไม้หันอากาศ",
  0x0e33: "สระอำ",
  0x0e34: "สระอิ",
  0x0e35: "สระอี",
  0x0e36: "สระอึ",
  0x0e37: "สระอื",
  0x0e38: "สระอุ",
  0x0e39: "สระอู",
  0x0e3a: "พินทุ",
  0x0e47: "ไม้ไต่คู้",
  0x0e48: "ไม้เอก",
  0x0e49: "ไม้โท",
  0x0e4a: "ไม้ตรี",
  0x0e4b: "ไม้จัตวา",
  0x0e4c: "ทัณฑฆาต (การันต์)",
  0x0e4d: "นิคหิต",
  0x0e4e: "ยามักการ",
  // Zero-width
  0x200b: "ช่องว่างศูนย์ความกว้าง (zero-width space)",
  0x200c: "ตัวเชื่อมศูนย์ความกว้างแบบไม่เชื่อม (ZWNJ)",
  0x200d: "ตัวเชื่อมศูนย์ความกว้างแบบเชื่อม (ZWJ)",
  // NBSP / BOM / other known "odd" spaces
  0x00a0: "ช่องว่างไม่ตัดคำ (NBSP)",
  0xfeff: "เครื่องหมายลำดับไบต์ (BOM)",
  0x1680: "ช่องว่างโอกัม",
  0x2000: "ช่องว่างขนาด en quad",
  0x2001: "ช่องว่างขนาด em quad",
  0x2002: "ช่องว่างขนาด en",
  0x2003: "ช่องว่างขนาด em",
  0x2004: "ช่องว่างขนาด 1/3 em",
  0x2005: "ช่องว่างขนาด 1/4 em",
  0x2006: "ช่องว่างขนาด 1/6 em",
  0x2007: "ช่องว่างเท่าตัวเลข",
  0x2008: "ช่องว่างเท่าเครื่องหมายวรรคตอน",
  0x2009: "ช่องว่างบาง (thin space)",
  0x200a: "ช่องว่างแคบมาก (hair space)",
  0x202f: "ช่องว่างแคบไม่ตัดคำ",
  0x205f: "ช่องว่างคณิตศาสตร์ขนาดกลาง",
  0x3000: "ช่องว่างเต็มความกว้าง (ideographic space)",
  // Plain whitespace — only ever reported as edge_space, but it still needs a
  // name here or charNameOf() falls through to the "อักขระควบคุม/PUA จากฟอนต์"
  // wording, which told the owner a leading ordinary space was a font control
  // character. Wrong label on the one issue type they're most likely to hit.
  0x0020: "ช่องว่างธรรมดา",
  0x0009: "แท็บ (tab)",
  0x000a: "ขึ้นบรรทัดใหม่",
  0x000d: "ขึ้นบรรทัดใหม่ (CR)",
};

function formatCodepoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function charNameOf(cp: number): string {
  return CHAR_NAMES[cp] ?? `${formatCodepoint(cp)} (อักขระควบคุม/PUA จากฟอนต์)`;
}

// ============================================================================
// Character classification
// ============================================================================

const THAI_CONSONANT_MIN = 0x0e01;
const THAI_CONSONANT_MAX = 0x0e2e;

function isThaiConsonant(cp: number): boolean {
  return cp >= THAI_CONSONANT_MIN && cp <= THAI_CONSONANT_MAX;
}

/** Thai combining marks per the design table — U+0E31, U+0E33-0E3A,
 * U+0E47-0E4E. Deliberately excludes U+0E32 (SARA AA) and U+0E40-0E44
 * (leading vowels) — those are non-combining Thai characters, not marks, and
 * chain-validating them isn't the problem this function solves. */
function isThaiMark(cp: number): boolean {
  return cp === 0x0e31 || (cp >= 0x0e33 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e);
}

function isZeroWidth(cp: number): boolean {
  return cp === 0x200b || cp === 0x200c || cp === 0x200d;
}

function isPua(cp: number): boolean {
  return cp >= 0xe000 && cp <= 0xf8ff;
}

const ODD_SPACE_CODEPOINTS = new Set<number>([
  0x00a0, // NBSP
  0xfeff, // BOM / ZWNBSP
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
]);

function isOddSpaceOrBom(cp: number): boolean {
  return ODD_SPACE_CODEPOINTS.has(cp);
}

/** JS regex \s — used only to recognize "plain" whitespace (space/tab/
 * newline/CR/FF/VT) so control-char detection can exclude it (design:
 * "C0/C1 ที่ไม่ใช่ \s") and edge-space detection can find it at the string's
 * boundary. NBSP/BOM/other odd spaces also match \s in JS, but those are
 * checked (and consumed) by isOddSpaceOrBom() first — see the priority order
 * in analyzeSku() below — so by the time a character reaches the
 * "is it plain whitespace" branches it can only be one of the plain ones. */
function isJsWhitespace(cp: number): boolean {
  return /\s/u.test(String.fromCodePoint(cp));
}

function isControlChar(cp: number): boolean {
  const isC0 = cp <= 0x1f;
  const isC1 = cp >= 0x80 && cp <= 0x9f;
  return (isC0 || isC1) && !isJsWhitespace(cp);
}

// ============================================================================
// analyzeSku
// ============================================================================

/**
 * Classifies every character in `text` (a single raw SKU cell's text) and
 * returns the list of hygiene issues found, in left-to-right order. Never
 * throws — empty/null-ish input just returns [].
 *
 * Priority per character (first match wins, categories never overlap in
 * their code-point ranges except by this explicit ordering):
 *   1. Thai mark chain rule (orphan_thai_mark, only if invalid)
 *   2. zero_width
 *   3. control
 *   4. pua
 *   5. nbsp_or_odd_space (NBSP / BOM / other Unicode space separators,
 *      anywhere in the string — not just at the edges)
 *   6. edge_space (plain space/tab/newline, ONLY at position 1 or the last
 *      position — interior plain whitespace is out of scope by design)
 */
export function analyzeSku(text: string): SkuCharIssue[] {
  if (!text) return [];

  const chars = Array.from(text);
  const codepoints = chars.map((c) => c.codePointAt(0) ?? 0);
  const issues: SkuCharIssue[] = [];
  // Tracks, per index, whether a Thai mark at that index was chain-valid —
  // needed so a mark can validate off a PRECEDING mark that was itself valid
  // (design: "น้ำ" = น + ้ (valid, follows consonant) + ำ (valid, follows a
  // valid mark) — not just "follows a consonant directly").
  const markValid = new Array<boolean>(chars.length).fill(false);

  chars.forEach((_, idx) => {
    const cp = codepoints[idx];
    const position = idx + 1;
    const isEdge = idx === 0 || idx === chars.length - 1;

    if (isThaiMark(cp)) {
      const prevCp = idx > 0 ? codepoints[idx - 1] : null;
      const validByConsonant = prevCp !== null && isThaiConsonant(prevCp);
      const validByChain = idx > 0 && markValid[idx - 1];
      if (validByConsonant || validByChain) {
        markValid[idx] = true;
      } else {
        issues.push({ kind: "orphan_thai_mark", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
      }
      return;
    }

    if (isZeroWidth(cp)) {
      issues.push({ kind: "zero_width", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
      return;
    }

    if (isControlChar(cp)) {
      issues.push({ kind: "control", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
      return;
    }

    if (isPua(cp)) {
      issues.push({ kind: "pua", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
      return;
    }

    if (isOddSpaceOrBom(cp)) {
      issues.push({ kind: "nbsp_or_odd_space", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
      return;
    }

    if (isEdge && isJsWhitespace(cp)) {
      issues.push({ kind: "edge_space", position, codepoint: formatCodepoint(cp), charName: charNameOf(cp) });
    }
  });

  return issues;
}

// ============================================================================
// cleanSku
// ============================================================================

/**
 * Returns `text` with every character analyzeSku() flagged removed. This is
 * a *suggestion* for what the SKU probably should be (shown in the preview
 * UI) — it is never written back to the catalog or sent to the DB by this
 * module or its caller.
 */
export function cleanSku(text: string): string {
  if (!text) return "";
  const chars = Array.from(text);
  const badPositions = new Set(analyzeSku(text).map((i) => i.position));
  return chars.filter((_, idx) => !badPositions.has(idx + 1)).join("");
}
