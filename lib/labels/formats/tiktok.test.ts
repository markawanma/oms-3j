// lib/labels/formats/tiktok.test.ts
//
// looksLikePackingSlipOnly() had zero unit tests before this file — it was
// only ever validated by hand against the 954-page UAT corpus (29 ส.ค. 69).
// That's how the gap this file closes (4 ต.ค. 69: pages missing "Qty Total:")
// went unnoticed until the owner pointed at a real example.
import { describe, expect, it } from "vitest";
import { looksLikePackingSlipOnly, tiktokFormat } from "./tiktok";

describe("looksLikePackingSlipOnly", () => {
  // Real page 52 of shipping-labels/a7c850ee-.../9040e565....pdf (4 ต.ค. 69),
  // extracted with the SAME lib (unpdf) parseLabelFile uses in production —
  // not retyped/approximated. Contains zero customer PII (no name, address,
  // or phone — just Order ID, Seller Note SKU codes, a date, and the bare
  // table header), safe to commit verbatim. Order ID here is IDENTICAL to
  // the preceding real label page's Order ID in the same file — this page
  // is a trailing continuation of that order, not a second order.
  const REAL_EMPTY_CONTINUATION_PAGE =
    "Order ID: 586305850175489884\n" +
    "Seller Note: A275/A216/A243\n" +
    "Order ID: 586305850175489884\n" +
    "In transit by: 29/09/2026 23:59\n" +
    "Product Name SKU Seller SKU Qty";

  it("real continuation page with NO Qty Total and NO product rows → true (4 ต.ค. 69 fix)", () => {
    // Before the fix this returned false (missing the then-required "Qty
    // Total:" marker) and the page fell through to a bare "undetected"
    // label instead of the more honest "packing_slip_only" reason.
    expect(looksLikePackingSlipOnly(REAL_EMPTY_CONTINUATION_PAGE)).toBe(true);
  });

  it("synthetic full packing-slip page (has Qty Total + product rows, no tracking) → still true", () => {
    // Placeholder product/qty data only — not real order content — proving
    // the original 29 ส.ค. 69 case (which DOES have Qty Total) still matches
    // after dropping Qty Total from the required set.
    const page =
      "Order ID: 111111111111111111\n" +
      "Product Name SKU Seller SKU Qty\n" +
      "ตัวอย่างสินค้า 1 ชิ้น EXAMPLE1 1\n" +
      "Qty Total: 1\n" +
      "Order ID: 111111111111111111";
    expect(looksLikePackingSlipOnly(page)).toBe(true);
  });

  it("a real label page (has a tracking number) is NEVER flagged, even with other markers present", () => {
    const page =
      "JTTH205523315970\n" +
      "Order ID: 586305850175489884\n" +
      "Product Name SKU Seller SKU Qty\n" +
      "Qty Total: 3";
    expect(looksLikePackingSlipOnly(page)).toBe(false);
  });

  it("missing the 'Order ID:' marker → false", () => {
    const page = "Product Name SKU Seller SKU Qty\nQty Total: 1";
    expect(looksLikePackingSlipOnly(page)).toBe(false);
  });

  it("missing the table-header marker → false", () => {
    const page = "Order ID: 123\nQty Total: 1";
    expect(looksLikePackingSlipOnly(page)).toBe(false);
  });

  it("empty string → false", () => {
    expect(looksLikePackingSlipOnly("")).toBe(false);
  });
});

describe("tiktokFormat — regression guard for the real file this fix came from", () => {
  it("the real label page (JTTH tracking present) still detects and extracts normally", () => {
    const page =
      "JTTH205523315970\n" +
      "Order ID: 586305850175489884\n" +
      "Product Name SKU Seller SKU Qty\n" +
      "Qty Total: 3\n" +
      "Order ID: 586305850175489884";
    expect(tiktokFormat.detect(page)).toBe(true);
    expect(tiktokFormat.extract(page)).toEqual({ trackingNo: "JTTH205523315970", ambiguous: false });
  });

  it("the real empty continuation page never detects as a label (no tracking number at all)", () => {
    const page =
      "Order ID: 586305850175489884\n" +
      "Seller Note: A275/A216/A243\n" +
      "Order ID: 586305850175489884\n" +
      "In transit by: 29/09/2026 23:59\n" +
      "Product Name SKU Seller SKU Qty";
    expect(tiktokFormat.detect(page)).toBe(false);
  });
});
