// lib/shop/category.ts
//
// SKU prefix -> display category for the public /shop grid (phase 1: derived
// client/server-side in TS, not a DB table — see design §3 trade-off table,
// docs/3j-jewelry/web/shop-route-design.md). Source of truth for prefixes:
// docs/3j-jewelry/analytics/ref-sku-prefix.md ("หมวดที่ยืนยันได้ ✅" table).
//
// Only the prefixes explicitly in scope for the /shop launch are mapped
// (มงคล/สร้อยคอ/แหวน/ต่างหู/สร้อยข้อมือ/เงินแท่ง per the task). Anything else
// (fashion prefixes not yet public, non_product, live_weight, ambiguous) —
// or any SKU that doesn't match at all — falls through to "อื่นๆ" rather
// than guessing (matches the ref doc's "ไม่เดา ไม่เงียบหาย" rule).
export interface Category {
  key: string;
  label: string;
}

const OTHER: Category = { key: "other", label: "อื่นๆ" };

// Ordered rules, most-specific first (longest-prefix-first per ref doc §"S-
// เป็น bucket ผสม" note). Each rule is checked top-to-bottom; the first
// match wins. `test` is a predicate rather than a bare prefix string so the
// bullion "S-<n>bath / S-1kg / S-1A" family (not a fixed literal prefix) can
// be expressed alongside the plain prefix rules without a second code path.
const RULES: { test: (sku: string) => boolean; category: Category }[] = [
  // มงคล (auspicious) — check the more specific S-* variants before any
  // generic S- rule would ever be added.
  { test: (sku) => sku.startsWith("S-pixiuelectro"), category: { key: "auspicious", label: "มงคล" } },
  { test: (sku) => sku.startsWith("SE-piu"), category: { key: "auspicious", label: "มงคล" } },
  { test: (sku) => sku.startsWith("SP-"), category: { key: "auspicious", label: "มงคล" } },
  { test: (sku) => sku.startsWith("AT-"), category: { key: "auspicious", label: "มงคล" } },
  { test: (sku) => sku.startsWith("GLC"), category: { key: "auspicious", label: "มงคล" } },

  // เงินแท่ง (bullion) — WA- prefix, or the S-<weight>bath / S-1kg / S-1A
  // "รุ่นวัดอรุณฯ" family (weight-in-name, not a fixed literal prefix).
  { test: (sku) => sku.startsWith("WA-"), category: { key: "bullion", label: "เงินแท่ง" } },
  { test: (sku) => /^S-\d*bath$/i.test(sku), category: { key: "bullion", label: "เงินแท่ง" } },
  { test: (sku) => sku === "S-1kg" || sku === "S-1A", category: { key: "bullion", label: "เงินแท่ง" } },

  // สร้อยคอ (necklace)
  { test: (sku) => sku.startsWith("NC"), category: { key: "necklace", label: "สร้อยคอ" } },

  // แหวน (ring)
  { test: (sku) => sku.startsWith("R-"), category: { key: "ring", label: "แหวน" } },

  // ต่างหู (earring)
  { test: (sku) => sku.startsWith("E-"), category: { key: "earring", label: "ต่างหู" } },

  // สร้อยข้อมือ (bracelet)
  { test: (sku) => sku.startsWith("BL-"), category: { key: "bracelet", label: "สร้อยข้อมือ" } },
  { test: (sku) => sku.startsWith("BO"), category: { key: "bracelet", label: "สร้อยข้อมือ" } },
  { test: (sku) => sku.startsWith("B-"), category: { key: "bracelet", label: "สร้อยข้อมือ" } },
];

/** Longest-prefix-first SKU -> category lookup. Never guesses: unmatched SKUs get "อื่นๆ". */
export function categoryOf(sku: string): Category {
  const normalized = (sku ?? "").trim();
  if (!normalized) return OTHER;

  for (const rule of RULES) {
    if (rule.test(normalized)) return rule.category;
  }
  return OTHER;
}

// LINE OA deep link (design §4). `oaMessage` prefills the buyer's chat
// message with the sku so the sales team can identify the item immediately
// — no server-side state/reservation, oversell is handled in-chat like the
// existing flow.
//
// ⚠️ VERIFY BEFORE LAUNCH: '3jsilver' is the LINE OA ID used in the design
// doc's example; it has NOT been confirmed against the real 3J Jewelry LINE
// OA (see design §8 open question 3). Confirm the real ID before shipping.
const LINE_OA_ID = "3jsilver";

export function lineOrderUrl(name: string, sku: string): string {
  const message = `สนใจสั่งซื้อ: ${name} (${sku})`;
  return `https://line.me/R/oaMessage/%40${LINE_OA_ID}/?${encodeURIComponent(message)}`;
}
