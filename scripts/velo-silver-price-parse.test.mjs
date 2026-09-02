// scripts/velo-silver-price-parse.test.mjs
//
// Unit tests for the Wix Velo backend module
// docs/3j-jewelry/web/velo-fixed/silverPrice.backend.js
//
// Context (2 Sep 2026 incident): the published Google Sheet tab switched from
// "5%" (cost tab — 60+ rows, never publish) to "Web Price" (11 rows x 7 cols).
// The old parser read fixed row/column indices tied to the "5%" layout, so
// every price silently became "0" on the live site. The fix reads by cell
// *label* instead of position. These tests exercise that label-matching
// logic directly via the extra `parseCSV`/`extractPrices`/`isValid` exports —
// no network/wix-data mocking needed, since those exports are pure functions.
//
// The production file also imports 'wix-fetch' and 'wix-data' (Wix-only
// globals) at module scope; virtually mocking them here lets Vitest load the
// real file unmodified instead of duplicating parsing logic into a copy.
import { describe, expect, it, vi } from "vitest";

vi.mock("wix-fetch", () => ({ fetch: vi.fn() }));
vi.mock("wix-data", () => ({ default: { get: vi.fn(), save: vi.fn() } }));

const {
  cleanNumber,
  extractPrices,
  getSheetPrice,
  isValid,
  parseCSV,
} = await import("../docs/3j-jewelry/web/velo-fixed/silverPrice.backend.js");

// The real "Web Price" tab CSV as pasted by the owner on 2 Sep 2026 — column 0
// carries whatever the sheet literally exports there (leading digits in this
// sample); the parser must never depend on it since label lookups only ever
// scan *after* the matched label's index in a row.
const REAL_CSV_NO_BUY_COLUMN = [
  `1  ,,,,,,`,
  `2  ,ขายออก,"67,900",ซื้อเข้า,"65,900",ขายออก รวม VAT,"72,653"`,
  `3  ,2-Sep-2026,ราคาเงินวันนี้,,,,`,
  `4  ,14:30,,,,,`,
  `5  ,,,ซื้อเข้า,"1,004",,`,
  `6  ,,ราคา,,,,`,
  `7  ,,0.5 บาท,691,,,`,
  `8  ,,1 บาท,"1,347",,,`,
  `9  ,,3 บาท,"3,922",,,`,
  `10 ,,5 บาท,"6,497",,,`,
  `11 ,,10 บาท,"12,637",,,`,
].join("\n");

// Same sheet after the owner adds the "ราคาซื้อเข้า" column right after each
// size's sell price (per the brief: 0.5->502, 3->3012, 5->5020, 10->10040;
// 1-baht buy assumed to line up with buyPerBaht's 1,004 from row 5).
const REAL_CSV_WITH_BUY_COLUMN = [
  `1  ,,,,,,`,
  `2  ,ขายออก,"67,900",ซื้อเข้า,"65,900",ขายออก รวม VAT,"72,653"`,
  `3  ,2-Sep-2026,ราคาเงินวันนี้,,,,`,
  `4  ,14:30,,,,,`,
  `5  ,,,ซื้อเข้า,"1,004",,`,
  `6  ,,ราคา,,,,`,
  `7  ,,0.5 บาท,691,502,,`,
  `8  ,,1 บาท,"1,347","1,004",,`,
  `9  ,,3 บาท,"3,922","3,012",,`,
  `10 ,,5 บาท,"6,497","5,020",,`,
  `11 ,,10 บาท,"12,637","10,040",,`,
].join("\n");

describe("extractPrices — real Web Price CSV, no buy-back column yet", () => {
  it("extracts every sell field, kilo block, and buyPerBaht; per-size buy stays 0", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = extractPrices(parseCSV(REAL_CSV_NO_BUY_COLUMN));

    expect(data.sell1kg).toBe("67900");
    expect(data.sellVat1kg).toBe("72653");
    expect(data.buy1kg).toBe("65900");
    expect(data.buyPerBaht).toBe("1004");
    expect(data.buyPerBaht1).toBe("1004");

    expect(data.sellHalfBaht).toBe("691");
    expect(data.sellOneBaht).toBe("1347");
    expect(data.sellThreeBaht).toBe("3922");
    expect(data.sellFiveBaht).toBe("6497");
    expect(data.sellTenBaht).toBe("12637");

    // size-level buy columns don't exist yet in this CSV -> must fall back to "0", not throw/undefined
    expect(data.buyHalfBaht).toBe("0");
    expect(data.buyOneBaht).toBe("0");
    expect(data.buyThreeBaht).toBe("0");
    expect(data.buyFiveBaht).toBe("0");
    expect(data.buyTenBaht).toBe("0");

    // duplicate "*1" field set (frontend has 2 sets of elements) must mirror the primary set exactly
    expect(data.sellHalfBaht1).toBe(data.sellHalfBaht);
    expect(data.buyTenBaht1).toBe(data.buyTenBaht);

    expect(isValid(data)).toBe(true);
    // every label was found (sell prices exist); the sheet simply doesn't have a
    // buy-back column yet, which is an expected/normal state — not a broken
    // label, so it must NOT spam console.error on every normal price refresh.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("extractPrices — real Web Price CSV, with buy-back column added", () => {
  it("fills in per-size buy prices once the sheet gains the column, without disturbing sell/kilo fields", () => {
    const data = extractPrices(parseCSV(REAL_CSV_WITH_BUY_COLUMN));

    expect(data.buyHalfBaht).toBe("502");
    expect(data.buyOneBaht).toBe("1004");
    expect(data.buyThreeBaht).toBe("3012");
    expect(data.buyFiveBaht).toBe("5020");
    expect(data.buyTenBaht).toBe("10040");

    // sell/kilo/buyPerBaht must be unaffected by the new column
    expect(data.sellHalfBaht).toBe("691");
    expect(data.sell1kg).toBe("67900");
    expect(data.buyPerBaht).toBe("1004");
  });
});

describe("extractPrices — size-row label matching must be exact, never substring", () => {
  it('"1 บาท" never reads the value from the "0.5 บาท" or "10 บาท" rows', () => {
    const data = extractPrices(parseCSV(REAL_CSV_NO_BUY_COLUMN));
    expect(data.sellOneBaht).not.toBe(data.sellHalfBaht);
    expect(data.sellOneBaht).not.toBe(data.sellTenBaht);
    expect(data.sellOneBaht).toBe("1347");
  });

  it('still isolates "1 บาท" correctly when the "10 บาท" row is placed immediately before it', () => {
    const rows = parseCSV(REAL_CSV_NO_BUY_COLUMN);
    const oneBahtRow = rows.find((r) => r.includes("1 บาท"));
    const tenBahtRow = rows.find((r) => r.includes("10 บาท"));
    const others = rows.filter((r) => r !== oneBahtRow && r !== tenBahtRow);
    const reordered = [...others, tenBahtRow, oneBahtRow]; // 10-baht row directly precedes 1-baht row

    const data = extractPrices(reordered);
    expect(data.sellOneBaht).toBe("1347");
    expect(data.sellTenBaht).toBe("12637");
  });
});

describe("extractPrices — resilient to row reordering and blank lines", () => {
  it("reads every field correctly when rows are shuffled and blank lines are interspersed", () => {
    const rows = parseCSV(REAL_CSV_NO_BUY_COLUMN);
    const shuffled = [
      rows[6], // 0.5 บาท
      [],
      rows[10], // 10 บาท
      rows[1], // kilo row
      [""],
      rows[4], // buyPerBaht row
      rows[8], // 3 บาท
      rows[7], // 1 บาท
      rows[9], // 5 บาท
      rows[2],
      rows[3],
      rows[0],
    ];

    const data = extractPrices(shuffled);
    expect(data.sell1kg).toBe("67900");
    expect(data.sellVat1kg).toBe("72653");
    expect(data.buy1kg).toBe("65900");
    expect(data.buyPerBaht).toBe("1004");
    expect(data.sellHalfBaht).toBe("691");
    expect(data.sellOneBaht).toBe("1347");
    expect(data.sellThreeBaht).toBe("3922");
    expect(data.sellFiveBaht).toBe("6497");
    expect(data.sellTenBaht).toBe("12637");
    expect(isValid(data)).toBe(true);
  });
});

describe("extractPrices — degrades to 0 + console.error, never throws", () => {
  it("returns all-zero fields for a completely empty CSV", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      const data = extractPrices(parseCSV(""));
      expect(data.sell1kg).toBe("0");
      expect(data.sellOneBaht).toBe("0");
      expect(data.buyPerBaht).toBe("0");
      expect(data.sellHalfBaht).toBe("0");
      expect(isValid(data)).toBe(false);
    }).not.toThrow();
    expect(spy).toHaveBeenCalled();
    // each distinct missing label should be identifiable in the log, not one opaque message
    const messages = spy.mock.calls.map((c) => c.join(" "));
    expect(messages.some((m) => m.includes("0.5 บาท"))).toBe(true);
    expect(messages.some((m) => m.includes("ขายออก (ราคากิโล)"))).toBe(true);
    spy.mockRestore();
  });

  it("returns 0 for the kilo block when the kilo row is missing, but still reads unrelated sizes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = parseCSV(REAL_CSV_NO_BUY_COLUMN).filter(
      (r) => !(r.includes("ขายออก") && r.includes("ซื้อเข้า"))
    );

    const data = extractPrices(rows);
    expect(data.sell1kg).toBe("0");
    expect(data.sellVat1kg).toBe("0");
    expect(data.buy1kg).toBe("0");
    expect(data.sellHalfBaht).toBe("691"); // unrelated row still parses fine
    expect(data.buyPerBaht).toBe("1004"); // separate row from the kilo row, unaffected
    expect(isValid(data)).toBe(false); // sell1kg is 0 -> whole sheet must be treated as not-ready
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("cleanNumber", () => {
  it("strips thousands separators", () => {
    expect(cleanNumber("67,900")).toBe("67900");
  });
  it("returns '0' for falsy input (undefined/null/empty string)", () => {
    expect(cleanNumber(undefined)).toBe("0");
    expect(cleanNumber(null)).toBe("0");
    expect(cleanNumber("")).toBe("0");
  });
});

describe("getSheetPrice — end-to-end wiring against a mocked fetch", () => {
  it("returns live, non-stale data and matches the real CSV fixture when the fetch succeeds", async () => {
    const { fetch } = await import("wix-fetch");
    const wixData = (await import("wix-data")).default;
    fetch.mockResolvedValueOnce({ text: async () => REAL_CSV_NO_BUY_COLUMN });
    wixData.save.mockResolvedValueOnce(undefined);

    const price = await getSheetPrice();
    expect(price.stale).toBe(false);
    expect(price.empty).toBe(false);
    expect(price.sell1kg).toBe("67900");
    expect(price.sellOneBaht).toBe("1347");
    expect(wixData.save).toHaveBeenCalled();
  });

  it("falls back to the snapshot (without throwing) when fetch rejects entirely", async () => {
    const { fetch } = await import("wix-fetch");
    const wixData = (await import("wix-data")).default;
    fetch.mockRejectedValueOnce(new Error("network down"));
    wixData.get.mockResolvedValueOnce({
      payload: JSON.stringify({ sell1kg: "67900", sellOneBaht: "1347" }),
      fetchedAt: new Date("2026-09-02T06:00:00Z"),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const price = await getSheetPrice();
    expect(price.stale).toBe(true);
    expect(price.sell1kg).toBe("67900");
    spy.mockRestore();
  });
});
