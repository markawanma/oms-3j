// lib/print/filename.ts — ชื่อไฟล์ตอน "บันทึกหน้าพิมพ์เป็น PDF" (pure · ไม่แตะ DOM)
// Chrome/Edge ใช้ document.title เป็นชื่อไฟล์ → หน้าพิมพ์ตั้ง title เป็น `YYMMDD_<เลขเอกสาร>_<ชื่อ>` (มติเจ้าของ 23 ต.ค. 69)
//  · ปี ค.ศ. 2 หลัก · วันที่ตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC
//  · 🔴 ห้ามส่งราคา/ต้นทุน/ข้อมูลภายในเข้ามาที่นี่ — ผู้เรียกส่งเฉพาะ เลขเอกสาร + ชื่อ + วันที่ (ทุกตัวพิมพ์อยู่บนเอกสารเองอยู่แล้ว ยกเว้นวันเปิดใบงาน ซึ่งไม่ใช่ข้อมูลลับ)
//  · ส่วนที่ว่าง/ไม่มี = ตัดทิ้งทั้งส่วน (ไม่มี `_` ห้อย)
//  · regex ใช้รูป \u{XXXX} ทั้งหมด (ไม่เขียนอักขระล่องหน/ตัวคั่นบรรทัดลงซอร์สตรงๆ)

/** ชื่อ/ส่วนท้าย ยาวสุด (ตัวอักษรที่ผู้ใช้เห็น = grapheme) */
export const FILE_TITLE_PART_MAX = 40;
/** ทั้งชื่อไฟล์ ยาวสุด */
export const FILE_TITLE_TOTAL_MAX = 100;

/** อักขระต้องห้ามในชื่อไฟล์ Windows/macOS/Linux — ตัดทิ้ง (ไม่แทนด้วยช่องว่าง) */
const FORBIDDEN = /[\\/:*?"<>|]/g;
/** ตัวคั่นบรรทัด/แท็บ → นับเป็นช่องว่าง (ไม่ใช่ตัดทิ้ง ไม่งั้น "a\nb" ติดกัน) */
const LINE_BREAKS = /[\t\n\r\v\f\u{0085}\u{2028}\u{2029}]/gu;
/**
 * ตัวควบคุม (Cc) · ตัวจัดรูปแบบ/ล่องหน (Cf: zero-width, bidi, soft hyphen, tag) · private use · surrogate เดี่ยว · unassigned (Cn)
 * + ตัวที่ "ดูว่าง" แต่ไม่ใช่ Cc/Cf: variation selector (FE00-FE0F, E0100-E01EF) · combining grapheme joiner (034F) · braille blank (2800)
 *   · hangul filler (3164/115F/1160/FFA0) · mongolian free variation selector (180B-180F)
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{034F}\u{2800}\u{3164}\u{115F}\u{1160}\u{FFA0}\u{180B}-\u{180F}]/gu;
const WHITESPACE = /[\s\p{Z}]+/gu;
/** สระหน้า (เ แ โ ใ ไ = 0E40-0E44) — ต้องตามด้วยพยัญชนะเสมอ ห้ามเป็นตัวท้ายตอนตัดชื่อ */
const THAI_LEADING_VOWEL_END = /[\u{0E40}-\u{0E44}]+$/u;
const COMBINING_MARK = /^\p{M}$/u;

function graphemes(s: string): string[] {
  // Intl.Segmenter: Chrome 87+ · Safari 14.1+ · Node 16+ — ไม่มี → fallback ตาม code point แล้วเกาะ combining mark เข้าตัวก่อนหน้า
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment(x: string): Iterable<{ segment: string }> } }).Segmenter;
  if (typeof Seg === "function") {
    return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(s), (x) => x.segment);
  }
  const out: string[] = [];
  for (const ch of Array.from(s)) {
    if (out.length > 0 && COMBINING_MARK.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** ตัดหัวท้ายที่ชื่อไฟล์ไม่ควรมี: ช่องว่าง `.` `-` `_` */
function trimEdges(s: string): string {
  return s.replace(/^[\s.\-_]+/, "").replace(/[\s.\-_]+$/, "");
}

function truncate(s: string, max: number): string {
  const g = graphemes(s);
  if (g.length <= max) return s;
  let cut = g.slice(0, max).join("");
  // ตัดแล้วห้ามจบด้วยสระหน้าไทยลอย ๆ (เ แ โ ใ ไ ที่ไม่มีพยัญชนะตาม) · grapheme กัน combining mark ลอยให้แล้ว (fallback ก็เกาะเข้าตัวก่อนหน้า) · ตัดขอบซ้ำจนนิ่ง
  for (;;) {
    const before = cut;
    cut = trimEdges(cut.replace(THAI_LEADING_VOWEL_END, ""));
    if (cut === before) break;
  }
  return cut;
}

/**
 * ทำความสะอาดหนึ่งส่วนของชื่อไฟล์:
 * ตัด `\ / : * ? " < > |` · ตัวควบคุม/ขึ้นบรรทัด/ล่องหน · ยุบช่องว่างซ้อนเป็น 1 แล้วแทนด้วย `-` · ตัด `.`/`-`/ช่องว่างหัวท้าย
 * ถ้าเกิน maxChars (ค่าเริ่ม 40) ตัดตามตัวอักษรที่ตาเห็น (ไม่ตัดกลางสระ/วรรณยุกต์ไทย)
 * ไม่ใช่ string / ว่างหลังทำความสะอาด = ""
 */
export function sanitizeFileTitlePart(input: unknown, maxChars: number = FILE_TITLE_PART_MAX): string {
  if (typeof input !== "string") return "";
  let s = input.normalize("NFC").replace(LINE_BREAKS, " ").replace(INVISIBLE, "").replace(FORBIDDEN, "");
  s = s.replace(WHITESPACE, " ").trim().replace(/ /g, "-");
  s = trimEdges(s);
  if (s === "") return "";
  return truncate(s, Math.max(1, Math.floor(maxChars)));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const BKK_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * วันที่ตามเวลาไทยเป็น YYMMDD (ปี ค.ศ. 2 หลัก) — 2026-10-21 → "261021"
 *  · "YYYY-MM-DD" ล้วน = วันที่นั้นเลย (ไม่เลื่อนโซนเวลา — เป็นวันของเอกสารอยู่แล้ว)
 *  · timestamp ISO (มี Z/offset) หรือ Date = แปลงเป็นเวลาไทย: 2026-10-21T17:30:00Z → "261022"
 *  · timestamp ที่ไม่มี offset ถือเป็น UTC (PostgREST ส่ง offset เสมอ — กันเครื่องผู้ใช้ตีความเป็นเวลาท้องถิ่น)
 *  · ว่าง/อ่านไม่ได้/วันที่ไม่มีจริง (2026-02-31) = ""
 */
export function bkkYYMMDD(input: string | Date | null | undefined): string {
  if (input === null || input === undefined) return "";
  let t: Date;
  if (input instanceof Date) {
    t = input;
  } else if (typeof input === "string") {
    const s = input.trim();
    const m = DATE_ONLY.exec(s);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const probe = new Date(Date.UTC(y, mo - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return "";
      return `${m[1].slice(2)}${m[2]}${m[3]}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return "";
    // Postgres อาจส่ง offset แบบสั้น (+00 / +0700) ซึ่ง JS Date อ่านไม่ได้ → ทำเป็น ±HH:MM ก่อน
    const iso = s.replace(" ", "T");
    const z = /(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(iso);
    if (z) {
      const raw = z[1];
      const off = /^[+-]/.test(raw) ? `${raw.slice(0, 3)}:${raw.replace(":", "").slice(3) || "00"}` : "Z";
      t = new Date(iso.slice(0, iso.length - raw.length) + off);
    } else {
      t = new Date(`${iso}Z`);
    }
  } else {
    return "";
  }
  if (Number.isNaN(t.getTime())) return "";
  const parts = BKK_FMT.formatToParts(t);
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const y = g("year");
  if (y.length !== 4) return "";
  return `${y.slice(2)}${g("month")}${g("day")}`;
}

export interface PrintFileTitleInput {
  /** YYMMDD จาก bkkYYMMDD (หรือ "" / undefined = ตัดส่วนนี้) — ไม่ผ่านรูปแบบ 6 หลัก = ตัดทิ้ง */
  date?: string | null;
  docNo?: string | null;
  name?: string | null;
  /** ส่วนท้ายเพิ่มเติม (ถ้ามี) — ทำความสะอาด/ตัด 40 ตัวเหมือน name */
  suffix?: string | null;
}

/**
 * ประกอบชื่อไฟล์ `YYMMDD_<เลขเอกสาร>_<ชื่อ>[_<suffix>]` — ส่วนว่างตัดทิ้ง · ทุกอย่างว่าง = "" (ผู้เรียกไม่ต้องตั้ง title)
 * ทั้งชื่อไม่เกิน 100 ตัวอักษร (ตัดจากท้าย — วันที่+เลขเอกสารอยู่หน้าจึงไม่โดน)
 */
export function printFileTitle({ date, docNo, name, suffix }: PrintFileTitleInput): string {
  const d = typeof date === "string" && /^\d{6}$/.test(date) ? date : "";
  const parts = [d, sanitizeFileTitlePart(docNo), sanitizeFileTitlePart(name), sanitizeFileTitlePart(suffix)].filter((p) => p !== "");
  const joined = parts.join("_");
  if (graphemes(joined).length <= FILE_TITLE_TOTAL_MAX) return joined;
  return truncate(joined, FILE_TITLE_TOTAL_MAX);
}
