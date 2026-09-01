// lib/import/sku-hygiene.test.ts
//
// Unit tests for analyzeSku/cleanSku (lib/import/sku-hygiene.ts). Pure
// in-memory string tests, no disk I/O — same style as the synthetic-workbook
// group in order-line-report.test.ts.

import { describe, expect, it } from "vitest";
import { analyzeSku, cleanSku, findingSeverity, type SkuCharIssueKind } from "./sku-hygiene";

function kinds(text: string): SkuCharIssueKind[] {
  return analyzeSku(text).map((i) => i.kind);
}

describe("analyzeSku — must catch", () => {
  it("① orphan Thai mark at position 1 (real bad SKU: ์NC20-A1), cleaned strips it", () => {
    const text = "์NC20-A1";
    const issues = analyzeSku(text);
    expect(issues).toEqual([
      { kind: "orphan_thai_mark", position: 1, codepoint: "U+0E4C", charName: expect.any(String) },
    ]);
    expect(cleanSku(text)).toBe("NC20-A1");
  });

  it("② orphan Thai mark at position 1 (real bad SKU: ืNC22-B)", () => {
    const text = "ืNC22-B";
    const issues = analyzeSku(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "orphan_thai_mark", position: 1, codepoint: "U+0E37" });
    expect(cleanSku(text)).toBe("NC22-B");
  });

  it("③ zero-width space mid-string is caught at the right position", () => {
    const text = "NC20​-A";
    const issues = analyzeSku(text);
    expect(issues).toEqual([{ kind: "zero_width", position: 5, codepoint: "U+200B", charName: expect.any(String) }]);
    expect(cleanSku(text)).toBe("NC20-A");
  });

  it("④ BOM prefix is zinc severity (nbsp_or_odd_space)", () => {
    const text = "﻿NC20";
    const issues = analyzeSku(text);
    expect(issues).toEqual([{ kind: "nbsp_or_odd_space", position: 1, codepoint: "U+FEFF", charName: expect.any(String) }]);
    expect(findingSeverity(issues)).toBe("zinc");
    expect(cleanSku(text)).toBe("NC20");
  });

  it("⑤ leading and trailing plain space are edge_space, zinc severity", () => {
    const leading = analyzeSku(" NC20");
    expect(leading).toEqual([{ kind: "edge_space", position: 1, codepoint: "U+0020", charName: expect.any(String) }]);
    expect(findingSeverity(leading)).toBe("zinc");
    expect(cleanSku(" NC20")).toBe("NC20");

    const trailing = analyzeSku("NC20 ");
    expect(trailing).toEqual([{ kind: "edge_space", position: 5, codepoint: "U+0020", charName: expect.any(String) }]);
    expect(cleanSku("NC20 ")).toBe("NC20");
  });

  it("⑥ NBSP in the middle is nbsp_or_odd_space, zinc severity", () => {
    const text = "NC20 -A";
    const issues = analyzeSku(text);
    expect(issues).toEqual([
      { kind: "nbsp_or_odd_space", position: 5, codepoint: "U+00A0", charName: expect.any(String) },
    ]);
    expect(findingSeverity(issues)).toBe("zinc");
    expect(cleanSku(text)).toBe("NC20-A");
  });

  it("⑦ control character is caught, amber severity", () => {
    const text = "NC20A";
    const issues = analyzeSku(text);
    expect(issues).toEqual([{ kind: "control", position: 5, codepoint: "U+0001", charName: expect.any(String) }]);
    expect(findingSeverity(issues)).toBe("amber");
    expect(cleanSku(text)).toBe("NC20A");
  });

  it("⑧ PUA character is caught, amber severity", () => {
    const text = "NC20";
    const issues = analyzeSku(text);
    expect(issues).toEqual([{ kind: "pua", position: 5, codepoint: "U+E000", charName: expect.any(String) }]);
    expect(findingSeverity(issues)).toBe("amber");
    expect(cleanSku(text)).toBe("NC20");
  });

  it("⑨ orphan Thai mark mid-string, right after a digit (not a Thai consonant)", () => {
    const text = "NC20์A";
    const issues = analyzeSku(text);
    expect(issues).toEqual([
      { kind: "orphan_thai_mark", position: 5, codepoint: "U+0E4C", charName: expect.any(String) },
    ]);
    expect(cleanSku(text)).toBe("NC20A");
  });

  it("⑩b RLO (U+202E) bidi override is caught as zero_width, amber severity, and stripped", () => {
    // Security audit fix (0901): U+202E flips display direction of
    // everything after it — the SKU can visually read "NC20-A1" while its
    // real character sequence differs, so copy-pasting it elsewhere (e.g.
    // Shipnity search) silently fails to match.
    const text = "NC20‮-A1";
    const issues = analyzeSku(text);
    expect(issues).toEqual([{ kind: "zero_width", position: 5, codepoint: "U+202E", charName: expect.any(String) }]);
    expect(findingSeverity(issues)).toBe("amber");
    expect(cleanSku(text)).toBe("NC20-A1");
  });

  it("⑩c other bidi/invisible-format characters are all caught as zero_width", () => {
    const cases: [string, string][] = [
      ["‭", "U+202D"], // LRO
      ["‪", "U+202A"], // LRE
      ["‫", "U+202B"], // RLE
      ["‬", "U+202C"], // PDF
      ["⁦", "U+2066"], // LRI
      ["⁧", "U+2067"], // RLI
      ["⁨", "U+2068"], // FSI
      ["⁩", "U+2069"], // PDI
      ["؜", "U+061C"], // ALM
      ["‎", "U+200E"], // LRM
      ["‏", "U+200F"], // RLM
      ["­", "U+00AD"], // soft hyphen
      ["͏", "U+034F"], // CGJ
      ["᠎", "U+180E"], // Mongolian vowel separator
      ["⁠", "U+2060"], // word joiner
      ["￹", "U+FFF9"], // interlinear annotation anchor
      ["￺", "U+FFFA"], // interlinear annotation separator
      ["￻", "U+FFFB"], // interlinear annotation terminator
    ];
    for (const [ch, codepoint] of cases) {
      const text = `NC20${ch}A`;
      const issues = analyzeSku(text);
      expect(issues, codepoint).toEqual([{ kind: "zero_width", position: 5, codepoint, charName: expect.any(String) }]);
      expect(cleanSku(text), codepoint).toBe("NC20A");
    }
  });

  it("⑩ multiple issues in one SKU: every position correct, cleanSku strips all of them", () => {
    // 1:BOM(odd-space) 2:orphan-mark(prev=BOM, not consonant) 3:N 4:C
    // 5:zero-width 6:2 7:0 8:NBSP 9:- 10:A 11:trailing space (edge_space)
    const text = "﻿์NC​20 -A ";
    const issues = analyzeSku(text);
    expect(issues.map((i) => ({ kind: i.kind, position: i.position }))).toEqual([
      { kind: "nbsp_or_odd_space", position: 1 },
      { kind: "orphan_thai_mark", position: 2 },
      { kind: "zero_width", position: 5 },
      { kind: "nbsp_or_odd_space", position: 8 },
      { kind: "edge_space", position: 11 },
    ]);
    expect(findingSeverity(issues)).toBe("amber"); // zero_width/orphan present
    expect(cleanSku(text)).toBe("NC20-A");
  });
});

describe("analyzeSku — must NOT flag (would break real SKUs)", () => {
  it("⑪ กรอบสมเด็จ — deliberately Thai-only, zero issues", () => {
    expect(analyzeSku("กรอบสมเด็จ")).toEqual([]);
  });

  it("⑫ ทองจีน-ลายจีน53 — Thai + ASCII dash/digits, zero issues", () => {
    expect(analyzeSku("ทองจีน-ลายจีน53")).toEqual([]);
  });

  it("⑬ Cทองจีน1..Cทองจีน6 — Latin+Thai mixed by design, zero issues", () => {
    for (let n = 1; n <= 6; n++) {
      expect(analyzeSku(`Cทองจีน${n}`), `Cทองจีน${n}`).toEqual([]);
    }
  });

  it("⑭ น้ำ and กิ่ง — mark-follows-valid-mark chain, zero issues", () => {
    expect(analyzeSku("น้ำ")).toEqual([]);
    expect(analyzeSku("กิ่ง")).toEqual([]);
  });

  it("⑮ box3j repeated 50 times — analyzer never looks at duplication, 0 findings each", () => {
    for (let i = 0; i < 50; i++) {
      expect(analyzeSku("box3j"), `iteration ${i}`).toEqual([]);
    }
  });

  it("⑯ plain ASCII with -_. is clean", () => {
    expect(analyzeSku("NC20-A.1_v2")).toEqual([]);
    expect(cleanSku("NC20-A.1_v2")).toBe("NC20-A.1_v2");
  });

  it("⑰ empty string / null-ish input never crashes", () => {
    expect(analyzeSku("")).toEqual([]);
    expect(cleanSku("")).toBe("");
    // Defensive: callers should never pass null past the type system, but a
    // parser bug or a runtime value from an untyped source could — this must
    // not throw either way.
    expect(() => analyzeSku(null as unknown as string)).not.toThrow();
    expect(analyzeSku(null as unknown as string)).toEqual([]);
    expect(() => cleanSku(undefined as unknown as string)).not.toThrow();
    expect(cleanSku(undefined as unknown as string)).toBe("");
  });
});

describe("analyzeSku — misc classification sanity", () => {
  it("kinds() helper matches expected order for a mixed string", () => {
    expect(kinds("NC20")).toEqual([]);
    expect(kinds("NC20‌")).toEqual(["zero_width"]); // ZWNJ at the end
    expect(kinds("NC20‍")).toEqual(["zero_width"]); // ZWJ at the end
  });

  it("a Thai consonant followed by a valid mark, followed by an orphan mark, only flags the orphan", () => {
    // ก(consonant) ่(valid mark, follows consonant) ่(second tone mark stacked
    // directly on a mark that is NOT itself a base-valid chain target beyond
    // one level per this design's rule — the SECOND mark chains off the
    // first mark since the first was valid) — both should be valid per the
    // chain rule (mirrors น้ำ/กิ่ง). Included to pin down the "chains through
    // multiple marks" behavior explicitly.
    expect(analyzeSku("ก่้")).toEqual([]);
  });
});
