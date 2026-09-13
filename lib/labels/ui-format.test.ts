// lib/labels/ui-format.test.ts — QA coverage for the client-side pre-checks
// in ui-format.ts, written against feature/label-review-resolve-ui (HEAD
// 0d9318a) ahead of UAT.
//
// Focus: validateTaughtSnippet() is documented (file header, and the
// contract lib/actions/labels.contract.md §4) as mirroring
// supabase/migrations/0116_label_review_resolve.sql's p_taught_snippet
// CHECK "EXACTLY". It does NOT — the migration's own comment trail (search
// "Attempt 1 (digit-run block)") shows the DB gate was hardened from a
// >=3-consecutive-digit block to a full deny-list (ANY digit of ANY script,
// ANY punctuation) during the M3 security fix, but ui-format.ts's
// TAUGHT_SNIPPET_DIGIT_RUN_RE (`/\d{3,}/`) was never updated to match. The
// tests below reproduce the ACTUAL DB regex (copied verbatim from the
// migration's `label_text_rule.pattern` CHECK / label_resolve_page's
// pre-check, lines ~299-333 and ~700-716) so the mismatch is provable
// without touching a live DB.
import { describe, expect, it } from "vitest";
import {
  TAUGHT_SNIPPET_MAX_LENGTH,
  isRealProvinceCode,
  orderSourceLine,
  provinceNameByCode,
  validateTaughtSnippet,
} from "./ui-format";
import type { OrderSourceRef } from "./types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";

/** Verbatim port of the DB deny-list (0116, label_resolve_page + the
 * label_text_rule.pattern CHECK) — NOT the thing under test, this is the
 * oracle the client-side check is supposed to agree with. */
function dbWouldReject(pattern: string): boolean {
  const trimmed = pattern; // DB receives the already-trimmed value (btrim)
  if (trimmed.length === 0) return false; // empty -> treated as "no snippet", never reaches this check
  if (trimmed.length > 25) return true;
  if (/[0-9]/.test(trimmed)) return true; // ASCII digits
  if (/[๐-๙]/.test(trimmed)) return true; // Thai digits U+0E50-U+0E59
  if (/[０-９]/.test(trimmed)) return true; // full-width digits
  if (/[!-/:-@[-`{-~]/.test(trimmed)) return true; // ASCII [:punct:] approximation (sufficient for these cases)
  return false;
}

const PROVINCES: CrmProvinceOption[] = [
  { code: "TH-10", nameTh: "กรุงเทพมหานคร" },
  { code: "TH-40", nameTh: "ขอนแก่น" },
  { code: "TH-XX", nameTh: "ไม่ทราบจังหวัด" },
];

describe("validateTaughtSnippet", () => {
  it("accepts empty/whitespace-only input (optional field)", () => {
    expect(validateTaughtSnippet("")).toBeNull();
    expect(validateTaughtSnippet("   ")).toBeNull();
  });

  it("accepts plain Thai text with no digits/punctuation (the intended happy path)", () => {
    expect(validateTaughtSnippet("เชียงใหม่ ตัวเมือง")).toBeNull();
  });

  it("rejects when longer than TAUGHT_SNIPPET_MAX_LENGTH (25)", () => {
    const tooLong = "ก".repeat(TAUGHT_SNIPPET_MAX_LENGTH + 1);
    expect(validateTaughtSnippet(tooLong)).not.toBeNull();
  });

  it("accepts exactly 25 characters", () => {
    const exact = "ก".repeat(TAUGHT_SNIPPET_MAX_LENGTH);
    expect(validateTaughtSnippet(exact)).toBeNull();
  });

  it("rejects a run of 3+ ASCII digits (the one case both sides agree on)", () => {
    expect(validateTaughtSnippet("จอดที่ 123")).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // 🔴 Desync proof — inputs the CLIENT accepts (validateTaughtSnippet
  // returns null, i.e. "safe to submit") that the REAL DB gate rejects
  // outright. Per contract §4, a rejected taughtSnippet fails the WHOLE
  // resolveLabelPage call — province included, not just the snippet — so
  // each case below is a click that visibly succeeds past client
  // validation, then fails end-to-end with a generic error, for a value
  // that looks perfectly reasonable to type into "จังหวัดอยู่ตรงข้อความนี้".
  // ---------------------------------------------------------------------
  describe("desync with the actual DB deny-list (0116)", () => {
    const shouldHaveBeenCaughtButIsnt = [
      // 1-2 ASCII digits — very common in Thai address fragments (soi/moo
      // numbers), explicitly called out in the migration's own "Attempt 1"
      // postmortem as insufficient, yet this is exactly what the client
      // still implements.
      "ซอย 12",
      "หมู่ 5",
      // A single Thai-script digit — JS's `\d` is ASCII-only, so
      // TAUGHT_SNIPPET_DIGIT_RUN_RE never even sees this as a digit run of
      // any length, let alone >=3. The DB rejects it unconditionally.
      "หมู่ที่ ๕",
      // ASCII punctuation with zero digits — common in Thai address
      // abbreviations (ต./อ./จ.) and never checked client-side at all.
      "จ.เชียงใหม่",
      "ต.บางนา/เขตบางนา",
    ];

    it.each(shouldHaveBeenCaughtButIsnt)(
      "client says %j is fine, but the DB gate would reject it (round-trip fails after a false 'valid')",
      (input) => {
        const clientVerdict = validateTaughtSnippet(input);
        expect(clientVerdict).toBeNull(); // client: "safe to submit"
        expect(dbWouldReject(input)).toBe(true); // DB: rejects the whole resolve call
      }
    );
  });
});

describe("isRealProvinceCode", () => {
  it("treats TH-XX as not-real (the unknown fallback)", () => {
    expect(isRealProvinceCode("TH-XX")).toBe(false);
  });
  it("treats null/undefined/empty as not-real", () => {
    expect(isRealProvinceCode(null)).toBe(false);
    expect(isRealProvinceCode(undefined)).toBe(false);
    expect(isRealProvinceCode("")).toBe(false);
  });
  it("treats any other code as real", () => {
    expect(isRealProvinceCode("TH-10")).toBe(true);
  });
});

describe("provinceNameByCode", () => {
  it("renders TH-XX as the Thai 'unknown' label, not the raw code or a lookup miss", () => {
    expect(provinceNameByCode(PROVINCES, "TH-XX")).toBe("ไม่ทราบจังหวัด");
  });
  it("falls back to the raw code when not found in the list (never throws/blank)", () => {
    expect(provinceNameByCode(PROVINCES, "TH-99")).toBe("TH-99");
  });
  it("renders — for null/undefined", () => {
    expect(provinceNameByCode(PROVINCES, null)).toBe("—");
    expect(provinceNameByCode(PROVINCES, undefined)).toBe("—");
  });
});

describe("orderSourceLine", () => {
  const base: OrderSourceRef = {
    factOrderId: "f1",
    sourceOrderNo: "SO-1",
    trackingNo: "TRACK1",
    provinceCode: "TH-40",
    provinceSource: "import",
    importFileName: "shipnity-sep.xlsx",
    sourceRowNo: 12,
  };

  it("includes file name + row number when import metadata is present", () => {
    const line = orderSourceLine(base, PROVINCES);
    expect(line).toContain("shipnity-sep.xlsx");
    expect(line).toContain("แถว 12");
    expect(line).toContain("ขอนแก่น");
  });

  it("says 'no import file' when importFileName is null (never renders 'null' or blank)", () => {
    const line = orderSourceLine({ ...base, importFileName: null, sourceRowNo: null }, PROVINCES);
    expect(line).toContain("ไม่มีข้อมูลไฟล์นำเข้า");
    expect(line).not.toContain("null");
  });

  it("omits the row number when sourceRowNo is null but importFileName is present (edge: partial metadata)", () => {
    const line = orderSourceLine({ ...base, sourceRowNo: null }, PROVINCES);
    expect(line).toContain("shipnity-sep.xlsx");
    expect(line).not.toContain("แถว null");
  });
});
