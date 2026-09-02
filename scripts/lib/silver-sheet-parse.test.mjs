// scripts/lib/silver-sheet-parse.test.mjs
//
// Unit tests for parseSheet() and its cellToNumber/parseSheetDate helpers.
// buildBaseRows() below is a synthetic `values: string[][]` fixture shaped
// like a real Google Sheets API response (and, before that, like the old CSV
// parser's output — same shape, see header comment in silver-sheet-parse.mjs)
// — self-consistent across all 6 mandatory cross-checks. Each negative test
// mutates exactly one cell (or a matched pair) to isolate exactly one
// cross-check failure, so a broken cross-check can be told apart from its
// neighbors.
import { describe, expect, it } from "vitest";
import { cellToNumber, parseSheet, parseSheetDate } from "./silver-sheet-parse.mjs";

// Row layout (see parseSheet's anchor logic in silver-sheet-parse.mjs):
//  0: top summary header   1: top summary values
//  2: size-block header (col0=as-of date, col1="ราคาเนื้อเงิน", ...)
//  3-7: size rows 0.5/1/3/5/10 บาท
//  8-10: kilo ขายออก / ขายออก Vat / ซื้อเข้า
//  11: a cell holding a bare HH:MM (sheet_time, best-effort only)
function buildBaseRows() {
  return [
    ["Priece USD/kg", "USD/THB", "THB/kg", "ต่อบาท", "ค่าบล๊อค kg"],
    ["25.5", "35.8", "913.4", "1500", "50"],
    ["31-Aug-2026", "ราคาเนื้อเงิน", "ราคาค่าบล๊อค", "11%", "Total", "Shopee", "ราคาซื้อคืน"],
    ["0.5", "750", "50", "11", "800", "800", "735"],
    ["1", "1500", "50", "11", "1560", "1560", "1470"],
    ["3", "4500", "50", "11", "4600", "4600", "4410"],
    ["5", "7500", "50", "11", "7600", "7600", "7350"],
    ["10", "15000", "50", "11", "15200", "15200", "14700"],
    ["ขายออก 1 กิโล", "1560000"],
    ["ขายออก Vat 1 กิโล", "1669200"],
    ["ซื้อเข้า 1 กิโล", "1470000"],
    ["14:30"],
  ];
}

/** Deep-clones the base fixture and applies [rowIdx, colIdx, value] cell
 * overrides — keeps each negative test to a one-line diff from the happy
 * path instead of a full re-typed matrix. */
function withCells(overrides) {
  const rows = buildBaseRows().map((r) => [...r]);
  for (const [rowIdx, colIdx, value] of overrides) rows[rowIdx][colIdx] = value;
  return rows;
}

describe("parseSheet — happy path", () => {
  it("parses a well-formed sheet, passes all 6 cross-checks, and extracts every field", () => {
    const { data, problems, warnings, asOfDate, sheetTime } = parseSheet(buildBaseRows());
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
    expect(asOfDate).toBe("2026-08-31");
    expect(sheetTime).toBe("14:30");
    expect(data.sell_1).toBe(1560);
    expect(data.buy_10).toBe(14700);
    expect(data.kilo_sell).toBe(1560000);
    expect(data.kilo_sell_vat).toBe(1669200);
    expect(data.kilo_buy).toBe(1470000);
    expect(data.silver_value_per_baht).toBe(1500);
  });
});

describe("parseSheet — cross-check #1: 0.5-baht silver content must double into the 1-baht row", () => {
  it("rejects when 0.5-baht silver content does not double into 1-baht (buy-back for 0.5 kept consistent so only check #1 fires)", () => {
    const rows = withCells([
      [3, 1, "700"], // silver content 0.5 บาท: 750 -> 700 (breaks 700*2=1400 vs c1=1500)
      [3, 6, "685"], // keep buy-back check (#2) passing for the 0.5 row: 700 - 30*0.5 = 685
    ]);
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("0.5 บาท×2"))).toBe(true);
    expect(problems.some((p) => p.includes("ราคาซื้อคืน"))).toBe(false);
    expect(problems.some((p) => p.includes("silver_value_per_baht"))).toBe(false);
  });
});

describe("parseSheet — cross-check #2: buy-back must be silver content minus 30/baht", () => {
  it("rejects when the 1-baht buy-back price drifts too far from silver content - 30", () => {
    const rows = withCells([[4, 6, "1000"]]); // buy_1: 1470 -> 1000 (expected 1470, tolerance ~29.4)
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("ขนาด 1 บาท ราคาซื้อคืน"))).toBe(true);
    expect(problems.some((p) => p.includes("0.5 บาท×2"))).toBe(false);
  });
});

describe("parseSheet — cross-check #3: silver_value_per_baht must match the 1-baht silver content", () => {
  it("rejects when the top-summary ต่อบาท figure disagrees with the size-table 1-baht row", () => {
    const rows = withCells([[1, 3, "1700"]]); // silver_value_per_baht: 1500 -> 1700 vs c1=1500
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("silver_value_per_baht"))).toBe(true);
  });
});

describe("parseSheet — cross-check #4: sell must not be cheaper than buy", () => {
  it("rejects when a size's sell price is below its own buy-back price (likely swapped columns)", () => {
    const rows = withCells([[5, 4, "4000"]]); // sell_3: 4600 -> 4000, below buy_3=4410
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("ขนาด 3 บาท ขายออก (4000) ถูกกว่าซื้อเข้า (4410)"))).toBe(true);
  });

  it("rejects when kilo sell is below kilo buy", () => {
    const rows = withCells([[8, 1, "1000000"]]); // kilo_sell: 1,560,000 -> 1,000,000, below kilo_buy=1,470,000
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("กิโลขายออก"))).toBe(true);
  });
});

describe("parseSheet — cross-check #5: kilo sell-with-VAT must be ~kilo sell × 1.07", () => {
  it("rejects when the VAT-inclusive kilo price does not match kilo × 1.07", () => {
    const rows = withCells([[9, 1, "1800000"]]); // kilo_sell_vat: 1,669,200 -> 1,800,000
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("กิโลขาย VAT"))).toBe(true);
  });
});

describe("parseSheet — cross-check #6: sell price must increase with size", () => {
  it("rejects when a larger size's sell price does not exceed a smaller size's", () => {
    // Raise sell_3 above sell_5 while keeping sell_3 >= buy_3 (so check #4 stays green)
    // and silver content untouched (so check #2 stays green) — isolates check #6.
    const rows = withCells([[5, 4, "8000"]]); // sell_3: 4600 -> 8000, now > sell_5=7600
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("ราคาขายไม่เรียงเพิ่มตามขนาด"))).toBe(true);
    expect(problems.some((p) => p.includes("ถูกกว่าซื้อเข้า"))).toBe(false);
  });
});

describe("parseSheet — structural failures (anchor/column not found) abort before cross-checks run", () => {
  it("reports a problem and extracts nothing usable when the top summary header is missing entirely", () => {
    const rows = buildBaseRows().slice(2); // drop the top-summary block
    const { problems, data } = parseSheet(rows);
    expect(problems.some((p) => p.includes("แถวสรุปบนสุด"))).toBe(true);
    expect(data.usd_per_kg).toBeUndefined();
  });

  it("reports a problem when a required column label in the size-block header is renamed/missing", () => {
    // Keep the substring "ซื้อคืน" so the anchor row itself still matches
    // (findAnchorRow does a substring test) — only break the EXACT-match
    // findColumnExact("ราคาซื้อคืน") lookup, to isolate the "missing column"
    // path from the "can't find the header row at all" path.
    const rows = withCells([[2, 6, "ราคาซื้อคืนเก่า"]]);
    const { problems } = parseSheet(rows);
    expect(problems.some((p) => p.includes("หาคอลัมน์ในตารางราคาต่อขนาดไม่ครบ"))).toBe(true);
    expect(problems.some((p) => p.includes('หา header แถวตารางราคาต่อขนาด'))).toBe(false);
  });
});

describe("cellToNumber", () => {
  it("strips thousands separators", () => {
    expect(cellToNumber("71,556.91")).toBe(71556.91);
  });
  it("returns null for #N/A", () => {
    expect(cellToNumber("#N/A")).toBeNull();
  });
  it("returns null for an empty/blank cell", () => {
    expect(cellToNumber("")).toBeNull();
    expect(cellToNumber("   ")).toBeNull();
  });
  it("returns null for undefined/null cells", () => {
    expect(cellToNumber(undefined)).toBeNull();
    expect(cellToNumber(null)).toBeNull();
  });
  it("returns null for non-numeric text (never regex-extracts a number out of a label)", () => {
    expect(cellToNumber("Total 1,234 บาท")).toBeNull();
  });
  // documented project trap (skill 3j-migration-traps #4): NaN/Infinity text
  // must never slip through a numeric parse as if it were a real value.
  it("returns null for the literal strings 'NaN' and 'Infinity' (must never parse as numeric)", () => {
    expect(cellToNumber("NaN")).toBeNull();
    expect(cellToNumber("Infinity")).toBeNull();
    expect(cellToNumber("-Infinity")).toBeNull();
  });
  it("returns null for zero and negative numbers (only positive prices are valid)", () => {
    expect(cellToNumber("0")).toBeNull();
    expect(cellToNumber("-5")).toBeNull();
  });
});

describe("parseSheetDate", () => {
  it("converts 'D-Mon-YYYY' (AD year, no Buddhist-year offset) to ISO", () => {
    expect(parseSheetDate("31-Aug-2026")).toBe("2026-08-31");
    expect(parseSheetDate("1-Jan-2027")).toBe("2027-01-01");
  });
  it("returns null for an unrecognized format", () => {
    expect(parseSheetDate("2026-08-31")).toBeNull();
    expect(parseSheetDate("31 August 2026")).toBeNull();
  });
  it("returns null for an unknown month abbreviation", () => {
    expect(parseSheetDate("31-Xyz-2026")).toBeNull();
  });
  it("returns null for missing/empty input", () => {
    expect(parseSheetDate(undefined)).toBeNull();
    expect(parseSheetDate("")).toBeNull();
  });
});
