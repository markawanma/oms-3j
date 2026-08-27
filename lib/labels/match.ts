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
//
// UAT 29 ส.ค. 69 (126/954 หน้าตกคิว needs_review ทั้งที่ตาเห็นจังหวัด+
// zipcode ครบ): "drop" ไม่ใช่พฤติกรรมเดียวที่เกิด — บางฟอนต์ที่ใช้พิมพ์ใบปะหน้า
// เหล่านี้ "แทน" ตัวรวบ/วรรณยุกต์ด้วยโค้ดพอยต์ใน Private Use Area
// (U+E000-U+F8FF) แทนที่จะตัดทิ้งเฉยๆ หรือใช้โค้ดพอยต์ไทยจริง ผลคือ folded
// haystack มีอักขระ "แทรก" เกินมา 1 ตัวเทียบกับ folded reference (ที่ตัดจริง)
// การเทียบ substring แบบเป๊ะ (rule 2) จึงพังแม้ folding ฝั่ง reference ถูกแล้ว
//
// ยืนยันด้วยสคริปต์ชั่วคราวที่ไล่ทั้ง 954 หน้าจริงจาก Storage (โหลด+extract+
// scan โค้ดพอยต์ในโปรแกรมเดียวจบ — ไม่ผ่านสายตา/terminal copy ซึ่งเป็นกับดัก
// ที่ทำให้รอบแรกดูเหมือนตัวอักษรปกติ): เจอ **เฉพาะ 5 โค้ดพอยต์** ในย่านนี้
// ทั้งไฟล์ทั้งหมด คือ U+F70A U+F70B U+F70C U+F70D U+F70E (รวมกัน 7,589 ครั้ง
// ใน 954 หน้า) ทุกครั้งอยู่แทรกกลางพยัญชนะไทยในตำแหน่งที่ควรเป็นสระ/วรรณยุกต์
// พอดี (เช่น "ขอนแก" + U+F70A + "น" แทน "ขอนแก่น") ไม่เคยเจอเป็นตัวอักษรฐาน
// เดี่ยวๆ ที่มีความหมายเอง — ปลอดภัยที่จะ strip เหมือนกลุ่มโค้ดพอยต์ไทยจริงด้านบน
const FOLD_STRIP_CODEPOINT_RANGES: [number, number][] = [
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0xf70a, 0xf70e],
];
const FOLD_STRIP_RANGE = new RegExp(
  "[" +
    FOLD_STRIP_CODEPOINT_RANGES.map(
      ([lo, hi]) => String.fromCharCode(lo) + "-" + String.fromCharCode(hi)
    ).join("") +
    "]",
  "g"
);

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

// Some PDF fonts emit the LEGACY decomposed order for SARA AM (U+0E33,
// the vowel in words like "kamphaeng"/"lampang") as NIKHAHIT (U+0E4D)
// followed by SARA AA (U+0E32), instead of the single precomposed codepoint
// the reference province names use (verified: thai-provinces.json uses
// U+0E33 throughout, never the decomposed pair). Left un-normalized, folding
// strips the NIKHAHIT (it's inside the tone-mark/vowel range stripped
// above) and leaves a bare SARA AA behind -- a correctly-spelled province
// name one character short of the reference's folded form, so it silently
// fails to match. Confirmed via the same live-corpus diagnostic as the PUA
// fix above: after that fix, 18 of the remaining 20 needs_review pages hit
// exactly this pattern (KAMPHAENG PHET / LAMPANG). Normalize BEFORE
// stripping, so the strip step never sees the decomposed form.
const NIKHAHIT_SARA_AA = new RegExp(
  String.fromCharCode(0x0e4d) + String.fromCharCode(0x0e32),
  "g"
);
const SARA_AM = String.fromCharCode(0x0e33);

function foldThai(text: string): string {
  return text
    .replace(PROVINCE_MARKER_WORD, " ")
    .replace(NIKHAHIT_SARA_AA, SARA_AM)
    .replace(FOLD_STRIP_RANGE, "");
}

interface ProvinceEntry {
  code: string;
  nameTh: string;
  namesFolded: { folded: string; re: RegExp }[];
}

// UAT 28 ส.ค. 69 (ใบจริง 954 หน้า): ตัว extract ข้อความจาก PDF แทรกช่องว่าง
// กลางคำแบบสุ่ม ("กรุงเทพมหานค ร", "สราษฎร ธาน") — การเทียบ token เป๊ะๆ จึง
// หาไม่เจอเลย 142/144 หน้าที่ตกคิว ทางแก้: ยอมให้มี whitespace แทรกได้ไม่เกิน
// 2 ตัวระหว่างตัวอักษรของชื่อ (\s{0,2}) โดยยังคง boundary check สองข้างบน
// ข้อความจริง — เคส ลาดกระบัง->กระบี่ ยังถูกกันด้วย boundary เหมือนเดิม และ
// ต่อให้หลุดก็แค่กลายเป็น 2 candidates -> needs_review ไม่มีทางเขียนผิด
function buildNameRegex(folded: string): RegExp {
  const escaped = [...folded].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("\\s{0,2}"), "g");
}

function buildProvinceIndex(): ProvinceEntry[] {
  const raw = provincesData as RawProvinceEntry[];
  return raw.map((p) => {
    const names = [p.th, p.en_official, ...(p.aliases ?? [])].filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0
    );
    // fold + dedupe (some aliases may fold to the same string as another, or
    // to the same string as th/en_official — no point scanning twice).
    const namesFolded = [...new Set(names.map((n) => foldThai(n)).filter((n) => n.length > 0))].map(
      (folded) => ({ folded, re: buildNameRegex(folded) })
    );
    return { code: p.iso, nameTh: p.th, namesFolded };
  });
}

const PROVINCE_INDEX = buildProvinceIndex();
const PROVINCE_BY_CODE = new Map(PROVINCE_INDEX.map((p) => [p.code, p]));

function isBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || /[\s,0-9]/.test(ch);
}

/** ทุกตำแหน่งที่ชื่อ (regex ทนช่องว่างกลางคำ) โผล่แบบมี boundary สองข้าง
 * บน haystack ที่ fold แล้ว — คืนทั้ง index และความยาวจริงของ match
 * (ความยาวไม่คงที่อีกต่อไป เพราะอาจมี whitespace แทรก) */
function findBoundedOccurrences(haystack: string, re: RegExp): { index: number; length: number }[] {
  const out: { index: number; length: number }[] = [];
  re.lastIndex = 0;
  for (const m of haystack.matchAll(re)) {
    const idx = m.index ?? 0;
    const before = idx > 0 ? haystack[idx - 1] : undefined;
    const afterIdx = idx + m[0].length;
    const after = afterIdx < haystack.length ? haystack[afterIdx] : undefined;
    if (isBoundaryChar(before) && isBoundaryChar(after)) {
      out.push({ index: idx, length: m[0].length });
    }
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

  // rule 4: ตัดที่อยู่ผู้ส่ง — สองกลไก:
  // (ก) occurrence ของจังหวัดร้านที่ co-locate กับ zipcode ร้าน (10150) — ของเดิม
  // (ข) UAT 28 ส.ค.: ใบจริงจำนวนมากไม่พิมพ์ zipcode ผู้ส่งเลย -> ใช้จุดสังเกต
  //     ที่อยู่ร้าน (จอมทอง/บางขุนเทียน/เอกชัย) แทน: occurrence ของจังหวัดร้าน
  //     ที่อยู่ห่างจาก marker ≤60 ตัวอักษร = ที่อยู่ผู้ส่ง ตัดทิ้ง (ตัดได้หลาย
  //     occurrence — ลูกค้าที่อยู่จอมทองจริงจะโดนตัดแล้วตกคิว review ซึ่ง
  //     ปลอดภัยกว่าปล่อยเดา)
  const senderProvince = PROVINCE_BY_CODE.get(SENDER_FINGERPRINT.provinceCode);
  const excludedSpans: { index: number; length: number }[] = [];
  if (senderProvince) {
    const markerSpans: { index: number; length: number }[] = [];
    for (const marker of SENDER_FINGERPRINT.addressMarkers) {
      // marker เป็น "จุดสังเกตระยะ" ไม่ใช่การอ้างตัวตนจังหวัด จึงไม่บังคับ
      // boundary — บนใบจริงคำพวกนี้ติดกับคำหน้าเสมอ ("เขตจอมทอง",
      // "แขวงบางขุนเทียน") ถ้าบังคับ boundary จะหาไม่เจอเลยสักตัว
      const re = buildNameRegex(foldThai(marker));
      re.lastIndex = 0;
      for (const m of folded.matchAll(re)) {
        markerSpans.push({ index: m.index ?? 0, length: m[0].length });
      }
    }
    // ตัด "หนึ่งเดียว" ที่เหมือนผู้ส่งที่สุด (design: exactly ONE) — ให้คะแนน
    // ด้วยระยะทาง: ใกล้ zip ผู้ส่ง (10150) หรือใกล้ marker ที่อยู่ร้าน โดย
    // marker ต้องใกล้กว่า zip ลูกค้า (กันเคสชื่อจังหวัดลูกค้าบังเอิญอยู่ใกล้
    // marker มากกว่า zip ตัวเอง) — ตัดเกิน 1 = ลูกค้ากรุงเทพจริงโดนกลืน
    // (บั๊กที่เจอตอนเขียนเทสต์)
    const minDist = (occ: { index: number; length: number }, spans: { index: number; length: number }[]) =>
      spans.reduce(
        (best, sp) =>
          Math.min(best, spanDistance(occ.index, occ.index + occ.length, sp.index, sp.index + sp.length)),
        Number.POSITIVE_INFINITY
      );
    const senderZipSpans = zips
      .filter((z) => z.text === SENDER_FINGERPRINT.zipcode)
      .map((z) => ({ index: z.index, length: z.text.length }));
    const customerZipSpans = zips
      .filter((z) => z.text !== SENDER_FINGERPRINT.zipcode)
      .map((z) => ({ index: z.index, length: z.text.length }));

    let best: { occ: { index: number; length: number }; score: number } | null = null;
    for (const nf of senderProvince.namesFolded) {
      for (const occ of findBoundedOccurrences(folded, nf.re)) {
        const dSenderZip = minDist(occ, senderZipSpans);
        const dMarker = minDist(occ, markerSpans);
        const dCustomerZip = minDist(occ, customerZipSpans);
        const eligible =
          dSenderZip <= CO_LOCATE_MAX_DISTANCE || (dMarker <= 60 && dMarker < dCustomerZip);
        if (!eligible) continue;
        const score = Math.min(dSenderZip, dMarker);
        if (!best || score < best.score) best = { occ, score };
      }
    }
    if (best) excludedSpans.push(best.occ);
  }
  const isExcluded = (occ: { index: number; length: number }) =>
    excludedSpans.some((e) => e.index === occ.index && e.length === occ.length);

  const candidateCodes = new Set<string>();
  const candidateZipByCode = new Map<string, string>();

  for (const province of PROVINCE_INDEX) {
    for (const nf of province.namesFolded) {
      for (const occ of findBoundedOccurrences(folded, nf.re)) {
        if (isExcluded(occ)) {
          continue; // ที่อยู่ผู้ส่ง — ไม่ใช่ candidate
        }
        const { coLocated, zip } = isCoLocatedWithZip(occ.index, occ.length, zips);
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
