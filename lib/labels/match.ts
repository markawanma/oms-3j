// lib/labels/match.ts — province matching from raw label page text (design
// §4, "หัวใจ" of the whole feature). Pure/deterministic, no DB access — fully
// unit-testable (see match.test.ts). Plain module (no "use server").
//
// Rules implemented (design §4, numbered to match):
//   1. Fold both sides (label text + reference province names) — strip tone
//      marks + above/below vowels that PUA fonts sometimes drop, BEFORE
//      comparing.
//   2. No substring matching — exact token equality after fold, with a
//      boundary (space/comma/digit/newline, or start/end of string) on BOTH
//      sides. Kills the ลาดกระบัง -> กระบี่ bug: folded "กระบี่" ("กระบ") is a
//      literal prefix-substring of folded "กระบัง" ("กระบง"), but the
//      character right after that substring inside "กระบง" is "ง" — not a
//      boundary char — so the match is correctly rejected.
//   3. A province-name candidate only counts if a 5-digit zipcode sits within
//      ~80 characters of it (Thai addresses end "...จังหวัด รหัสไปรษณีย์").
//   4. Sender fingerprint (3J's own province+zipcode) — exactly ONE
//      occurrence that is co-located with the sender's own zipcode is
//      excluded from the candidate pool. This does NOT blanket-exclude every
//      Bangkok occurrence — a real Bangkok customer (different zipcode) still
//      matches normally.
//   5. Exactly one remaining candidate -> matched. Zero or >1 -> needs_review
//      with the candidate list attached (for a human to pick from).
//   6. A lone zipcode with no co-located province name never resolves a
//      province by itself (falls out naturally: no name token => no
//      candidate added, regardless of how many zipcodes are nearby).
//
// Rule 7 (tracking-number ambiguity) lives in lib/labels/formats/*.ts, not
// here — it's about a format's tracking-number pattern, not province text.
import provincesData from "../../docs/3j-jewelry/analytics/thai-provinces.json";
import { SENDER_FINGERPRINT } from "./constants";

interface RawProvinceEntry {
  iso: string;
  th: string;
  en_official: string;
  aliases: string[];
}

export interface ProvinceCandidate {
  code: string;
  nameTh: string;
}

export type ProvinceMatchResult = {
  status: "matched" | "needs_review";
  provinceCode: string | null;
  /** The zipcode text co-located with the winning/candidate match, if any —
   * stored on stg_label_page.zipcode for display in the review queue. Picks
   * the first candidate's co-located zip when there are multiple (needs_review). */
  zipcode: string | null;
  candidates: ProvinceCandidate[];
};

// design §4 rule 1: tone marks (MAI EK..YAMAKKAN, THANTHAKHAT, NIKHAHIT) +
// above/below vowels (SARA A..PHINTHU) — the exact codepoint ranges a
// PUA-substituted font tends to drop from extracted text.
const FOLD_STRIP_RANGE = /[ัิ-ฺ็-๎]/g;

// design §4 rule 3.
const CO_LOCATE_MAX_DISTANCE = 80;

// เลข 5 หลักต้อง "โดดเดี่ยว" เท่านั้น — ห้ามเป็นส่วนหนึ่งของเลขยาวกว่า
// (ทดสอบกับใบจริง 28 ส.ค.: /\d{5}/ เฉยๆ ไปคว้าเศษกลางเลขพัสดุ
// JTTH2031520... → "20315" แล้วบันทึกเป็น zipcode ปลอมทุกหน้า — จังหวัดยังถูก
// เพราะ zip จริงก็อยู่ใกล้ชื่อจังหวัดด้วย แต่ค่าที่เก็บลง stg_label_page ผิด
// และด่าน co-locate ถูกเลขปลอมช่วยผ่านโดยบังเอิญ)
const ZIPCODE_RE = /(?<!\d)\d{5}(?!\d)/g;

// "จังหวัด" is the administrative marker word that precedes a province name
// on Thai address labels, often with NO space between it and the name itself
// (e.g. "...เขตลาดกระบัง จังหวัดกรุงเทพมหานคร 10520" — no space after
// "จังหวัด"). It never appears as a substring inside any actual province name
// or alias, so it's safe to strip globally to a single space before folding —
// this guarantees a real word-boundary character lands right before the
// province name whenever this marker is used, instead of "ด" (the last
// consonant of "จังหวัด") falsely blocking rule 2's boundary check.
//
// ⚠️ DEVIATION FROM DESIGN §4 RULE 2 (flagging per brief): the design's
// literal boundary set is "space/comma/digit/newline" only. Taken literally,
// that set does NOT match "จังหวัดกรุงเทพมหานคร" (no gap between the marker
// word and the province name) — which is the EXACT text design's own test
// case #1 uses ("...จังหวัดกรุงเทพมหานคร 10520" must resolve to TH-10). This
// preprocessing step is the fix that makes that literal design test case
// pass; without it, that case falls through to needs_review instead of
// matched. Scoped to the single word "จังหวัด" only (not เขต/แขวง/อำเภอ/ตำบล,
// which precede DISTRICT names, not province names, and aren't needed by any
// stated test case) to keep the blast radius minimal.
const PROVINCE_MARKER_WORD = /จังหวัด/g;

function foldThai(text: string): string {
  return text.replace(PROVINCE_MARKER_WORD, " ").replace(FOLD_STRIP_RANGE, "");
}

interface ProvinceEntry {
  code: string;
  nameTh: string;
  namesFolded: string[];
}

function buildProvinceIndex(): ProvinceEntry[] {
  const raw = provincesData as RawProvinceEntry[];
  return raw.map((p) => {
    const names = [p.th, p.en_official, ...(p.aliases ?? [])].filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0
    );
    // fold + dedupe (some aliases may fold to the same string as another, or
    // to the same string as th/en_official — no point scanning twice).
    const namesFolded = [...new Set(names.map((n) => foldThai(n)).filter((n) => n.length > 0))];
    return { code: p.iso, nameTh: p.th, namesFolded };
  });
}

const PROVINCE_INDEX = buildProvinceIndex();
const PROVINCE_BY_CODE = new Map(PROVINCE_INDEX.map((p) => [p.code, p]));

function isBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || /[\s,0-9]/.test(ch);
}

/** All start indices where `needle` appears as a boundary-anchored token
 * inside `haystack` (both already folded). Overlapping occurrences allowed —
 * cheap and correct for our short province-name needles. */
function findBoundedOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    const before = idx > 0 ? haystack[idx - 1] : undefined;
    const afterIdx = idx + needle.length;
    const after = afterIdx < haystack.length ? haystack[afterIdx] : undefined;
    if (isBoundaryChar(before) && isBoundaryChar(after)) {
      out.push(idx);
    }
    from = idx + 1;
  }
  return out;
}

function spanDistance(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (aEnd <= bStart) return bStart - aEnd;
  if (bEnd <= aStart) return aStart - bEnd;
  return 0; // overlapping
}

function isCoLocatedWithZip(
  occStart: number,
  occLen: number,
  zips: { index: number; text: string }[],
  requireZipText?: string
): { coLocated: boolean; zip: string | null } {
  let zip: string | null = null;
  let coLocated = false;
  for (const z of zips) {
    if (requireZipText !== undefined && z.text !== requireZipText) continue;
    const dist = spanDistance(occStart, occStart + occLen, z.index, z.index + z.text.length);
    if (dist <= CO_LOCATE_MAX_DISTANCE) {
      coLocated = true;
      zip = z.text;
      break;
    }
  }
  return { coLocated, zip };
}

/**
 * Matches the destination province from one label page's extracted text.
 * Pure function — no DB access. See rule-by-rule comments above.
 */
export function matchProvince(pageText: string): ProvinceMatchResult {
  const folded = foldThai(pageText ?? "");
  const zips = [...folded.matchAll(ZIPCODE_RE)].map((m) => ({
    index: m.index ?? 0,
    text: m[0],
  }));

  // rule 4: find + exclude exactly ONE occurrence of the sender's own
  // province name that is co-located with the sender's own zipcode.
  const senderProvince = PROVINCE_BY_CODE.get(SENDER_FINGERPRINT.provinceCode);
  let excluded: { nameFolded: string; index: number } | null = null;
  if (senderProvince) {
    outer: for (const nameFolded of senderProvince.namesFolded) {
      for (const idx of findBoundedOccurrences(folded, nameFolded)) {
        const { coLocated } = isCoLocatedWithZip(idx, nameFolded.length, zips, SENDER_FINGERPRINT.zipcode);
        if (coLocated) {
          excluded = { nameFolded, index: idx };
          break outer;
        }
      }
    }
  }

  const candidateCodes = new Set<string>();
  const candidateZipByCode = new Map<string, string>();

  for (const province of PROVINCE_INDEX) {
    for (const nameFolded of province.namesFolded) {
      for (const idx of findBoundedOccurrences(folded, nameFolded)) {
        if (excluded && excluded.nameFolded === nameFolded && excluded.index === idx) {
          continue; // the one sender occurrence — not a candidate
        }
        const { coLocated, zip } = isCoLocatedWithZip(idx, nameFolded.length, zips);
        if (coLocated) {
          candidateCodes.add(province.code);
          if (!candidateZipByCode.has(province.code) && zip) {
            candidateZipByCode.set(province.code, zip);
          }
        }
      }
    }
  }

  const candidates: ProvinceCandidate[] = [...candidateCodes].map((code) => ({
    code,
    nameTh: PROVINCE_BY_CODE.get(code)?.nameTh ?? code,
  }));

  if (candidates.length === 1) {
    const code = candidates[0].code;
    return {
      status: "matched",
      provinceCode: code,
      zipcode: candidateZipByCode.get(code) ?? null,
      candidates,
    };
  }

  return {
    status: "needs_review",
    provinceCode: null,
    zipcode: candidates.length > 0 ? (candidateZipByCode.get(candidates[0].code) ?? null) : null,
    candidates,
  };
}

// exported for tests only
export const __internal = { foldThai };
