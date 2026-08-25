// lib/oem/display.ts — presentation-only helpers for the OEM pricing UI
// (labels, unit suffixes, canonical ordering of scope values). No pricing
// arithmetic lives here — see lib/oem/types.ts header and 0062's own header
// comment for why that rule matters.

import { OEM_METAL_LABEL_TH } from "./types";
import type { OemCustomerAddress, OemInputUnit, OemMetal, OemScopeKind } from "./types";

// ============================================================================
// group_code ordering (rate intake page) — matches the production sequence
// documented in 0061's seed comment (§1.1's process flow), not alphabetical.
// ============================================================================

export const OEM_GROUP_ORDER = ["nre", "batch", "labor", "metal", "reject", "material_cost", "policy"] as const;

export const OEM_GROUP_LABEL_TH: Record<string, string> = {
  nre: "NRE — ต้นทุนแรกต่อแบบ (CAD / ปริ้น 3D / ก้อนยาง)",
  batch: "Batch — ต้นทุนต่อรอบ (แฟลสก์หล่อ / รอบชุบ)",
  labor: "ค่าแรง (แยกแผนก + ผลิตภาพต่อคน)",
  metal: "โลหะ — น้ำหนักสูญเสีย/หลอมคืน",
  reject: "ของเสีย (reject rate ต่อขั้น)",
  material_cost: "ต้นทุนวัสดุอื่น (เทียน / พลอย / แพ็ก)",
  policy: "นโยบาย (เครดิต / lead time / FX / กำลังผลิต)",
};

// ============================================================================
// input_unit -> Thai suffix shown next to the input. 'count' is intentionally
// absent — its unit is context-dependent (วัน/ชั่วโมง/กรัม/ครั้ง depending on
// the row) and the question_th text already states it, per design brief
// ("factory language, not accounting language").
// ============================================================================

export const OEM_UNIT_SUFFIX_TH: Partial<Record<OemInputUnit, string>> = {
  pieces_per_day: "ชิ้น/วัน",
  pieces_per_hour: "ชิ้น/ชั่วโมง",
  minutes_per_piece: "นาที/ชิ้น",
  thb_per_day: "บาท/วัน",
  thb_per_batch: "บาท/รอบ",
  thb_per_piece: "บาท/ชิ้น",
  // thb_per_unit has NO single correct suffix — it is reused across
  // cad_fee_thb (บาท/แบบ) / print3d_cost_thb (บาท/ต้นแบบ) /
  // rubber_mold_cost_thb (บาท/พิมพ์) / gem_price_thb_per_seed (บาท/เม็ด).
  // Falling back to "บาท/ชิ้น" here would be actively wrong — NRE is
  // per-design, never per-piece. OEM_RATE_KEY_UNIT_OVERRIDE below resolves
  // all four before this generic map is ever consulted.
  pieces_per_batch: "ชิ้น/รอบ",
  uses_per_mold: "ครั้ง/พิมพ์",
  pct: "%",
  hours_per_day: "ชั่วโมง/วัน",
  seeds_per_hour: "เม็ด/ชั่วโมง",
  thb_per_gram: "บาท/กรัม",
};

// rate_key-specific overrides — input_unit alone is ambiguous for these
// (thb_per_unit means 3 different real-world units depending on rate_key;
// flask_capacity_pieces needs "แฟลสก์" not the generic "รอบ" that
// plating_pieces_per_batch correctly uses). Presentation only — the DB enum
// (oem_rate_def.input_unit) is untouched; the backend reads that, not this.
export const OEM_RATE_KEY_UNIT_OVERRIDE: Partial<Record<string, string>> = {
  cad_fee_thb: "บาท/แบบ",
  print3d_cost_thb: "บาท/ต้นแบบ",
  rubber_mold_cost_thb: "บาท/พิมพ์",
  gem_price_thb_per_seed: "บาท/เม็ด",
  flask_capacity_pieces: "ชิ้น/แฟลสก์",
};

/** Resolve the unit suffix shown next to a rate cell: rate_key-specific
 * override first (disambiguates thb_per_unit and flask vs. plating "รอบ"),
 * falling back to the generic input_unit suffix. */
export function oemUnitLabel(rateKey: string, inputUnit: OemInputUnit): string | undefined {
  return OEM_RATE_KEY_UNIT_OVERRIDE[rateKey] ?? OEM_UNIT_SUFFIX_TH[inputUnit];
}

// ============================================================================
// Canonical display order for scoped rows (0061 §5/§6 seed order) — the DB
// doesn't guarantee row order for scope siblings, so this is resolved client
// side purely for a stable, sensible reading order.
// ============================================================================

const MATERIAL_ORDER: OemMetal[] = ["silver", "gold", "brass"];
const DEPT_ORDER = ["ฉีดเทียน", "หล่อ", "ขัด", "ฝังพลอย", "ชุบ", "QC", "แพ็ก"];
const ITEM_KIND_ORDER = ["แหวน", "สร้อยคอ", "สร้อยข้อมือ", "กำไล", "จี้", "ต่างหู", "อื่นๆ"];
const POLISH_TIER_ORDER = ["เรียบ", "ปานกลาง", "ละเอียด"];
const GEM_TIER_ORDER = ["เล็ก", "กลาง", "ใหญ่"];
const PLATING_ORDER = ["ทอง", "โรเดียม", "พิงค์โกลด์"];

/** Thai label for a scope value. Only 'material' scope stores an English
 * code (silver/gold/brass) — every other scope_kind already stores Thai text
 * as its own value (dept/item_kind/tier/plating), so it's returned verbatim. */
export function oemScopeLabel(scopeKind: OemScopeKind, scope: string): string {
  if (scopeKind === "material") return OEM_METAL_LABEL_TH[scope as OemMetal] ?? scope;
  return scope;
}

function scopeOrderIndex(scopeKind: OemScopeKind, scope: string): number {
  if (scopeKind === "material") return MATERIAL_ORDER.indexOf(scope as OemMetal);
  if (scopeKind === "dept") return DEPT_ORDER.indexOf(scope);
  if (scopeKind === "item_kind") return ITEM_KIND_ORDER.indexOf(scope);
  if (scopeKind === "plating") return PLATING_ORDER.indexOf(scope);
  if (scopeKind === "tier") {
    const polishIdx = POLISH_TIER_ORDER.indexOf(scope);
    if (polishIdx !== -1) return polishIdx;
    return GEM_TIER_ORDER.indexOf(scope);
  }
  return -1;
}

/** Sort comparator for rows sharing one rate_key, by canonical scope order
 * (falls back to alphabetical for anything not in the known vocab). */
export function oemScopeSort(scopeKind: OemScopeKind, a: string, b: string): number {
  const ia = scopeOrderIndex(scopeKind, a);
  const ib = scopeOrderIndex(scopeKind, b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "th");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export const OEM_ITEM_KIND_OPTIONS = ITEM_KIND_ORDER;
export const OEM_POLISH_TIER_OPTIONS = POLISH_TIER_ORDER;
export const OEM_GEM_TIER_OPTIONS = GEM_TIER_ORDER;
export const OEM_PLATING_OPTIONS = PLATING_ORDER;

export function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function fmtPct(n: number | null, dp = 1): string {
  if (n == null) return "—";
  return `${roundTo(n * 100, dp)}%`;
}

// ============================================================================
// Billing (0077: analytics.oem_customer, read via v_oem_quote's bill_*
// columns). oem_quote_set_billing (0075) stores p_customer->'address' as
// jsonb with ZERO shape validation server-side — whatever the caller sent is
// stored verbatim (see 0075 §7). Today the only caller is this app's own
// BillingDialog (which always sends OemCustomerAddress-shaped keys), but any
// future caller, a manual DB edit, or a pre-existing malformed row must not
// be able to crash a page that reads it back. parseBillAddress is the one
// place that defensively narrows `unknown` jsonb into OemCustomerAddress|
// null — never throws, silently drops anything that doesn't look right.
// ============================================================================

/** Narrow an unknown jsonb value into OemCustomerAddress, or null if it
 * isn't a plain object / has no usable string fields. Unknown extra keys are
 * ignored; non-string values for a known key are treated as absent (not
 * coerced, not thrown). */
export function parseBillAddress(raw: unknown): OemCustomerAddress | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const v = r[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const addr: OemCustomerAddress = {
    line1: pick("line1"),
    line2: pick("line2"),
    subdistrict: pick("subdistrict"),
    district: pick("district"),
    province: pick("province"),
    postalCode: pick("postalCode"),
  };
  const hasAnyField = Object.values(addr).some((v) => v != null);
  return hasAnyField ? addr : null;
}

/** OemCustomerAddress -> printable lines, Thai postal-address convention
 * (line1/line2 free text, then "ต./อ./จ. + รหัสไปรษณีย์" on one line). Skips
 * empty lines entirely rather than printing blank rows. */
export function formatOemAddressLines(addr: OemCustomerAddress | null): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  if (addr.line1) lines.push(addr.line1);
  if (addr.line2) lines.push(addr.line2);
  const locality = [
    addr.subdistrict ? `ต.${addr.subdistrict}` : null,
    addr.district ? `อ.${addr.district}` : null,
    addr.province ? `จ.${addr.province}` : null,
    addr.postalCode ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  if (locality) lines.push(locality);
  return lines;
}

/** Thai tax id: exactly 13 digits, or empty (a person, not a registered
 * business, has none — that's valid, not an error). Used by both
 * BillingDialog (client) and setQuoteBilling (server) so the rule can never
 * drift between the two. */
export function isValidThaiTaxId(taxId: string): boolean {
  const t = taxId.trim();
  return t === "" || /^\d{13}$/.test(t);
}
