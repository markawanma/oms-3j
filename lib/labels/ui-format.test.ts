// lib/labels/ui-format.test.ts — QA coverage for the client-side pre-checks
// in ui-format.ts, written against feature/label-review-resolve-ui (HEAD
// 0d9318a) ahead of UAT.
//
// Focus: validateTaughtSnippet() is documented (file header, and the
// contract lib/actions/labels.contract.md §4) as mirroring
// supabase/migrations/0116_label_review_resolve.sql's p_taught_snippet
// CHECK. Originally it did NOT — the migration's own comment trail (search
// "Attempt 1 (digit-run block)") shows the DB gate was hardened from a
// >=3-consecutive-digit block to a full deny-list (ANY digit of ANY script,
// ANY punctuation) during the M3 security fix, but ui-format.ts's old
// TAUGHT_SNIPPET_DIGIT_RUN_RE (`/\d{3,}/`) was never updated to match — this
// file originally proved that desync with a failing-oracle test below.
//
// QA-2 fix (13 ก.ย. 69): ui-format.ts now uses TAUGHT_SNIPPET_DENY_RE, a
// Unicode-property-based SUPERSET of the DB's deny-list (see that const's
// comment for why it's a superset, not a byte-exact port — JS has no
// [:punct:]/[:digit:] POSIX classes to copy 1:1). The "desync" describe block
// below is flipped to "parity": it now asserts the client REJECTS everything
// the DB rejects, instead of documenting that it didn't.
import { describe, expect, it } from "vitest";
import {
  TAUGHT_SNIPPET_MAX_LENGTH,
  isRealProvinceCode,
  orderDateChannelLine,
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

  // code-review nit (C-3PO, 13 ก.ย. 69): TAUGHT_SNIPPET_DENY_RE is a
  // Unicode-property superset of the DB deny-list (\p{Nd}/\p{P}/\p{S}) —
  // these three characters are genuinely common in Thai addresses/place
  // names and must NOT get caught by that superset, or the regex would be
  // too tight (rejecting things the DB allows), not just "safely stricter."
  it("accepts Thai punctuation-look-alike characters that are NOT Unicode Punctuation/Symbol", () => {
    // ฯ (PAIYANNOI, U+0E2F) — looks like an abbreviation dot but its Unicode
    // category is Lo (Letter, Other), not P.
    expect(validateTaughtSnippet("กรุงเทพฯ")).toBeNull();
    // ๆ (MAIYAMOK, U+0E46, category Lm "Letter, Modifier" — repetition
    // mark) + ่ (MAI EK tone mark, U+0E48, category Mn "Mark, Nonspacing")
    // — neither is P/S/Nd.
    expect(validateTaughtSnippet("ต่างๆ")).toBeNull();
    expect(validateTaughtSnippet("ใกล้วัดใหญ่")).toBeNull();
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
  // ✅ Parity proof (QA-2 fix, 13 ก.ย. 69) — these inputs used to slip past
  // validateTaughtSnippet() as "safe to submit" while the REAL DB gate
  // rejected them outright (see git history for the original failing-oracle
  // version of this block). Per contract §4, a rejected taughtSnippet fails
  // the WHOLE resolveLabelPage call — province included, not just the
  // snippet — so this parity is what stops a click that looks like it
  // succeeded from silently failing end-to-end.
  // ---------------------------------------------------------------------
  describe("parity with the actual DB deny-list (0116)", () => {
    const previouslyDesynced = [
      // 1-2 ASCII digits — very common in Thai address fragments (soi/moo
      // numbers), explicitly called out in the migration's own "Attempt 1"
      // postmortem as insufficient.
      "ซอย 12",
      "หมู่ 5",
      // A single Thai-script digit — JS's old `\d`-based check was
      // ASCII-only, so this never registered as a digit run of any length.
      "หมู่ที่ ๕",
      // ASCII punctuation with zero digits — common in Thai address
      // abbreviations (ต./อ./จ.), previously never checked client-side.
      "จ.เชียงใหม่",
      "ต.บางนา/เขตบางนา",
    ];

    it.each(previouslyDesynced)(
      "client and DB now agree %j must be rejected",
      (input) => {
        const clientVerdict = validateTaughtSnippet(input);
        expect(clientVerdict).not.toBeNull(); // client now rejects too
        expect(dbWouldReject(input)).toBe(true); // DB still rejects (unchanged)
      }
    );
  });

  // General parity sweep — client must reject (superset is fine) at least
  // every input the DB oracle rejects, across inputs beyond the 5 specific
  // historical cases above. Guards against a future edit to
  // TAUGHT_SNIPPET_DENY_RE narrowing it back below the DB's deny-list.
  describe("general parity — client never accepts what the DB would reject", () => {
    const mixedInputs = [
      "เชียงใหม่",
      "ซอย 12",
      "หมู่ที่ ๕",
      "จ.เชียงใหม่",
      "ต.บางนา/เขตบางนา",
      "ใกล้วัดใหญ่",
      "บ้านเลขที่",
      "０９",
      "๐๑๒",
      "ตัวเมือง ขอนแก่น",
      "$100",
      "test@example",
    ];

    it.each(mixedInputs)("%j: client-rejects >= db-rejects", (input) => {
      const clientRejects = validateTaughtSnippet(input) !== null;
      const dbRejects = dbWouldReject(input);
      if (dbRejects) expect(clientRejects).toBe(true);
    });
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

describe("orderDateChannelLine (Mace L7)", () => {
  it("joins date + channel with a middle dot when both are present", () => {
    expect(orderDateChannelLine({ orderDate: "2026-09-10", channelName: "TikTok Live" })).toBe("10 ก.ย. 2569 · TikTok Live");
  });
  it("shows just the date when channelName is null", () => {
    expect(orderDateChannelLine({ orderDate: "2026-09-10", channelName: null })).toBe("10 ก.ย. 2569");
  });
  it("shows just the channel when orderDate is undefined", () => {
    expect(orderDateChannelLine({ orderDate: undefined, channelName: "LINE OA" })).toBe("LINE OA");
  });
  it("renders — when neither field is available (e.g. getPendingLabelReviews' orderSources)", () => {
    expect(orderDateChannelLine({})).toBe("—");
    expect(orderDateChannelLine({ orderDate: undefined, channelName: null })).toBe("—");
  });
});
