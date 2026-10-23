// ชื่อไฟล์ PDF หน้าพิมพ์ — helper pure (มติเจ้าของ 23 ต.ค. 69: YYMMDD_<เลขเอกสาร>_<ชื่อ> · ปี ค.ศ. 2 หลัก · วันที่ไทย)
// อักขระล่องหน/ตัวคั่นบรรทัดในเทสต์เขียนเป็น \u{XXXX} เสมอ (ไม่ฝังตัวจริงลงซอร์ส)
import { describe, expect, it } from "vitest";
import { FILE_TITLE_PART_MAX, FILE_TITLE_TOTAL_MAX, bkkYYMMDD, printFileTitle, sanitizeFileTitlePart } from "./filename";

const len = (s: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length;
const FORBIDDEN_ALL = /[\\/:*?"<>|]/;

describe("bkkYYMMDD — วันที่ไทย ปี ค.ศ. 2 หลัก", () => {
  it("date-only = วันนั้นเลย ไม่เลื่อนโซน", () => {
    expect(bkkYYMMDD("2026-10-21")).toBe("261021");
    expect(bkkYYMMDD("2026-01-05")).toBe("260105");
    expect(bkkYYMMDD("2099-12-31")).toBe("991231");
    expect(bkkYYMMDD("2100-01-01")).toBe("000101");
  });
  it("17:30Z = วันถัดไปของไทย · 16:59Z = วันเดิม (ขอบ 00:00 ไทย)", () => {
    expect(bkkYYMMDD("2026-10-21T17:30:00Z")).toBe("261022");
    expect(bkkYYMMDD("2026-10-21T16:59:59Z")).toBe("261021");
    expect(bkkYYMMDD("2026-10-21T17:00:00.000Z")).toBe("261022");
  });
  it("ข้ามปี/เดือน: 2026-12-31T20:00Z → 270101", () => {
    expect(bkkYYMMDD("2026-12-31T20:00:00Z")).toBe("270101");
    expect(bkkYYMMDD("2026-02-28T18:00:00+00:00")).toBe("260301");
  });
  it("PostgREST แบบมี offset: +07:00 อ่านตามเวลาจริง", () => {
    expect(bkkYYMMDD("2026-10-22T00:30:00+07:00")).toBe("261022");
    expect(bkkYYMMDD("2026-10-21T23:30:00+07:00")).toBe("261021");
    expect(bkkYYMMDD("2026-10-21 17:30:00+00")).toBe("261022"); // offset แบบสั้นของ Postgres
    expect(bkkYYMMDD("2026-10-21T17:30:00.123456+00")).toBe("261022");
    expect(bkkYYMMDD("2026-10-22T00:30:00+0700")).toBe("261022");
    expect(bkkYYMMDD("2026-10-22T00:30:00+07")).toBe("261022");
    expect(bkkYYMMDD("2026-10-21T10:00:00-05:00")).toBe("261021"); // 15:00Z → 22:00 ไทย
    expect(bkkYYMMDD("2026-10-21T13:00:00-05:00")).toBe("261022"); // 18:00Z → 01:00 ไทยวันถัดไป
  });
  it("timestamp ไม่มี offset ถือเป็น UTC (ไม่ผูกโซนเครื่อง)", () => {
    expect(bkkYYMMDD("2026-10-21T17:30:00")).toBe("261022");
  });
  it("Date object", () => {
    expect(bkkYYMMDD(new Date("2026-10-21T17:30:00Z"))).toBe("261022");
    expect(bkkYYMMDD(new Date(Date.UTC(2026, 9, 23, 3, 0, 0)))).toBe("261023");
  });
  it("อ่านไม่ได้/ว่าง/วันที่ไม่มีจริง = '' (ไม่ throw)", () => {
    for (const bad of [null, undefined, "", "   ", "abc", "2026-02-31", "2026-13-01", "2026-10-21Tzzz", "21/10/2026", new Date("nope")]) {
      expect(bkkYYMMDD(bad as never)).toBe("");
    }
    expect(bkkYYMMDD(12345 as never)).toBe("");
  });
});

describe("sanitizeFileTitlePart", () => {
  it("ไทยล้วนผ่านทั้งหมด", () => {
    expect(sanitizeFileTitlePart("ต่างหู")).toBe("ต่างหู");
    expect(sanitizeFileTitlePart("สร้อยข้อมือ ลายใบไม้")).toBe("สร้อยข้อมือ-ลายใบไม้");
  });
  it("ไทยผสมอังกฤษ/ตัวเลข", () => {
    expect(sanitizeFileTitlePart("แหวน Pinky 925 ขนาด 7")).toBe("แหวน-Pinky-925-ขนาด-7");
    expect(sanitizeFileTitlePart("บริษัท ABC จำกัด (มหาชน)")).toBe("บริษัท-ABC-จำกัด-(มหาชน)");
  });
  it("ตัด \\ / : * ? \" < > | ทุกตัว (ตัดทิ้ง ไม่แทนด้วยช่องว่าง)", () => {
    expect(sanitizeFileTitlePart('a\\b/c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    expect(sanitizeFileTitlePart("ต่างหู/แหวน")).toBe("ต่างหูแหวน");
    expect(sanitizeFileTitlePart('"ร้านทอง": สาขา 1?')).toBe("ร้านทอง-สาขา-1");
    expect(sanitizeFileTitlePart('\\/:*?"<>|')).toBe("");
  });
  it("ตัวควบคุม/ขึ้นบรรทัด/แท็บ → ช่องว่าง หรือตัดทิ้ง", () => {
    expect(sanitizeFileTitlePart("a\nb\r\nc\td")).toBe("a-b-c-d");
    expect(sanitizeFileTitlePart("a\u0000b\u0007c\u001Fd\u007Fe")).toBe("abcde");
    expect(sanitizeFileTitlePart("a\u{2028}b\u{2029}c\u{0085}d")).toBe("a-b-c-d"); // line/para sep, NEL
  });
  it("ล่องหน: zero-width · BOM · bidi · soft hyphen · tag · braille blank · hangul filler · variation selector", () => {
    expect(sanitizeFileTitlePart("a\u{200B}b\u{200C}c\u{200D}d\u{FEFF}e")).toBe("abcde");
    expect(sanitizeFileTitlePart("a\u{202E}b\u{2066}c\u{2069}d")).toBe("abcd");
    expect(sanitizeFileTitlePart("a\u{00AD}b")).toBe("ab");
    expect(sanitizeFileTitlePart("x\u{E0041}\u{E0042}y")).toBe("xy");
    expect(sanitizeFileTitlePart("ก\u{2800}\u{3164}ข\u{FE0F}")).toBe("กข");
    expect(sanitizeFileTitlePart("\u{200B}\u{2800} \u{3164}")).toBe("");
  });
  it("ยุบช่องว่างซ้อน (รวม NBSP / ideographic / tab) เป็น - เดียว", () => {
    expect(sanitizeFileTitlePart("a   b")).toBe("a-b");
    expect(sanitizeFileTitlePart("a\u{00A0}\u{00A0}b\u{3000}c  \t d")).toBe("a-b-c-d");
    expect(sanitizeFileTitlePart("   a   ")).toBe("a");
  });
  it("ตัด . และช่องว่างท้าย (และ - หัวท้าย)", () => {
    expect(sanitizeFileTitlePart("Co., Ltd.")).toBe("Co.,-Ltd");
    expect(sanitizeFileTitlePart("abc...")).toBe("abc");
    expect(sanitizeFileTitlePart("abc . . ")).toBe("abc");
    expect(sanitizeFileTitlePart("...")).toBe("");
    expect(sanitizeFileTitlePart(" - a - ")).toBe("a");
  });
  it("ว่าง/ไม่ใช่ string = ''", () => {
    for (const v of ["", "   ", null, undefined, 0, {}, []]) expect(sanitizeFileTitlePart(v)).toBe("");
  });
  it("ยาวเกิน 40 ตัวอักษร ตัดที่ 40 (อังกฤษ)", () => {
    expect(sanitizeFileTitlePart("x".repeat(80))).toBe("x".repeat(FILE_TITLE_PART_MAX));
  });
  it("ไทยยาวเกิน: ตัดทุกตำแหน่ง 1..60 — ไม่เกิน n · ไม่ตัดกลางกลุ่มสระ/วรรณยุกต์ · ไม่จบด้วยสระหน้าลอย ๆ", () => {
    const base = "สร้อยข้อมือเงินแท้ลายดอกไม้ที่นี่มีเสน่ห์พิเศษเกินห้ามพลาดเลยนะคะ";
    for (let n = 1; n <= 60; n++) {
      const out = sanitizeFileTitlePart(base, n);
      expect(len(out)).toBeLessThanOrEqual(n);
      expect(base.startsWith(out)).toBe(true); // เป็น prefix จริง ไม่ได้บิดตัวอักษร
      expect(out).not.toMatch(/[\u{0E40}-\u{0E44}]$/u); // สระหน้าลอย
      expect(out).not.toMatch(/\u{FFFD}/u);
      const next = base.slice(out.length)[0]; // ตัวถัดไปที่ถูกตัด ต้องไม่ใช่สระ/วรรณยุกต์ที่ควรเกาะตัวก่อนหน้า
      if (out !== "" && next !== undefined) expect(next).not.toMatch(/\p{M}/u);
    }
  });
  it("กลุ่ม ก+สระ+วรรณยุกต์ ตัดทั้งกลุ่ม · สระหน้าลอยถูกทิ้ง", () => {
    expect(sanitizeFileTitlePart("กิ้กิ้กิ้", 2)).toBe("กิ้กิ้"); // กิ้ = 1 ตัวอักษรที่ตาเห็น
    expect(sanitizeFileTitlePart("เกเกเก", 1)).toBe(""); // เ ลอย ๆ = ตัดทิ้ง ไม่ปล่อยค้าง
    expect(sanitizeFileTitlePart("กเกเก", 2)).toBe("ก");
    expect(sanitizeFileTitlePart("ไก่ไก่", 2)).toBe("ไก่");
  });
  it("อีโมจิ ไม่ถูกตัดครึ่ง (surrogate pair) · ZWJ ถูกตัดเป็นล่องหน", () => {
    for (let n = 1; n <= 6; n++) {
      const out = sanitizeFileTitlePart("a\u{1F600}b\u{1F600}c\u{1F600}d", n);
      expect(out).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(out).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(sanitizeFileTitlePart("ab\u{1F468}\u{200D}\u{1F469}cd", 3)).toBe("ab\u{1F468}");
  });
  it("ผลลัพธ์ไม่มีอักขระต้องห้ามเลย (ฟัซซ์ 500 รอบ)", () => {
    const chars = ["\\", "/", ":", "*", "?", '"', "<", ">", "|", " ", "\n", "ก", "ิ", "้", "เ", "a", "1", ".", "-", "\u{200B}", "\u{0000}", "\u{1F600}"];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 500; i++) {
      const s = Array.from({ length: Math.floor(rnd() * 80) }, () => chars[Math.floor(rnd() * chars.length)]).join("");
      const out = sanitizeFileTitlePart(s);
      expect(out).not.toMatch(FORBIDDEN_ALL);
      expect(out).not.toMatch(/[\p{Cc}\p{Cf}\s]/u);
      expect(out).not.toMatch(/[.\-]$/);
      expect(len(out)).toBeLessThanOrEqual(FILE_TITLE_PART_MAX);
    }
  });
});

describe("printFileTitle", () => {
  it("ใบงาน: 261021_JB-0034_ต่างหู", () => {
    expect(printFileTitle({ date: bkkYYMMDD("2026-10-21T03:00:00Z"), docNo: "JB-0034", name: "ต่างหู" })).toBe("261021_JB-0034_ต่างหู");
  });
  it("ใบย่อย: 261021_JB-0034-ส่วน2_ต่างหู", () => {
    expect(printFileTitle({ date: "261021", docNo: "JB-0034-ส่วน2", name: "ต่างหู" })).toBe("261021_JB-0034-ส่วน2_ต่างหู");
  });
  it("QR ร้าน (ไม่มีชื่อ = ไม่มี _ ห้อย)", () => {
    expect(printFileTitle({ date: "261023", docNo: "QR-ร้าน" })).toBe("261023_QR-ร้าน");
    expect(printFileTitle({ date: "261023", docNo: "QR-ร้าน", name: null })).toBe("261023_QR-ร้าน");
  });
  it("ส่วนที่ว่าง/ล่องหน/ต้องห้ามล้วน = ตัดทิ้งทั้งส่วน ไม่มี _ ห้อย/ซ้อน", () => {
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "" })).toBe("261021_JB-1");
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "   " })).toBe("261021_JB-1");
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "\u{200B}/\\" })).toBe("261021_JB-1");
    expect(printFileTitle({ date: "", docNo: "JB-1", name: "ต่างหู" })).toBe("JB-1_ต่างหู");
    expect(printFileTitle({ date: "261021", docNo: "", name: "ต่างหู" })).toBe("261021_ต่างหู");
    expect(printFileTitle({ date: "261021", docNo: null, name: undefined })).toBe("261021");
  });
  it("ทุกอย่างว่าง = '' (ผู้เรียกไม่ตั้ง title)", () => {
    expect(printFileTitle({})).toBe("");
    expect(printFileTitle({ date: "", docNo: "", name: "" })).toBe("");
    expect(printFileTitle({ date: "abc", docNo: " ", name: "?" })).toBe("");
  });
  it("date ผิดรูปแบบ (ไม่ใช่ 6 หลัก) ไม่ถูกใส่ — กัน 2026-10-21 หลุดเข้าชื่อ", () => {
    expect(printFileTitle({ date: "2026-10-21", docNo: "JB-1" })).toBe("JB-1");
    expect(printFileTitle({ date: "26102", docNo: "JB-1" })).toBe("JB-1");
  });
  it("suffix ต่อท้ายด้วย _ และตัดว่างทิ้งเหมือนกัน", () => {
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "แหวน", suffix: "แผ่น2" })).toBe("261021_JB-1_แหวน_แผ่น2");
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "", suffix: "แผ่น2" })).toBe("261021_JB-1_แผ่น2");
    expect(printFileTitle({ date: "261021", docNo: "JB-1", name: "แหวน", suffix: " " })).toBe("261021_JB-1_แหวน");
  });
  it("ชื่อยาว: ส่วนชื่อ ≤ 40 ตัวอักษร · เลขเอกสารไม่โดนตัด", () => {
    const t = printFileTitle({ date: "261021", docNo: "RT-2608-016", name: "ก".repeat(200) });
    expect(t).toBe(`261021_RT-2608-016_${"ก".repeat(40)}`);
  });
  it("รวมทั้งชื่อไม่เกิน 100 ตัวอักษร แม้ทุกส่วนยาวสุด · date+docNo อยู่ครบ", () => {
    const t = printFileTitle({ date: "261021", docNo: "D".repeat(60), name: "ก".repeat(60), suffix: "ข".repeat(60) });
    expect(len(t)).toBeLessThanOrEqual(FILE_TITLE_TOTAL_MAX);
    expect(t.startsWith(`261021_${"D".repeat(FILE_TITLE_PART_MAX)}_`)).toBe(true);
    expect(t).not.toMatch(/[_.\-]$/);
  });
  it("ผลสุดท้ายไม่เคยมีอักขระต้องห้าม แม้ทุกส่วนเป็นขยะ", () => {
    const t = printFileTitle({ date: "261021", docNo: "JB/0:1*", name: 'ชื่อ "ลูกค้า" <ห้าม> | \\ ?' });
    expect(t).not.toMatch(FORBIDDEN_ALL);
    expect(t).toBe("261021_JB01_ชื่อ-ลูกค้า-ห้าม");
  });
});
