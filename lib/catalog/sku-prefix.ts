// lib/catalog/sku-prefix.ts — types/consts for the SKU-prefix config screen
// (docs/3j-jewelry/oem/design-email-sku-phase1.md, Phase 1a) + the "สินค้าใหม่"
// dialog inside QuoteCalculatorClient. Kept OUT of lib/actions/catalog-sku.ts
// (a "use server" file, which may only export async functions).
//
// Backed by analytics.sku_prefix + analytics.sku_counter (migration 0089,
// landing in parallel — see design doc's RPC contract). No cost/margin data
// lives on either table, so unlike lib/catalog/types.ts / lib/oem/types.ts
// this domain is deliberately NOT gated to owner/admin — see
// lib/actions/catalog-sku.ts's header comment for the full reasoning.

export type SkuWorkType = "plain" | "gem";

export const SKU_WORK_TYPE_LABEL_TH: Record<SkuWorkType, string> = {
  plain: "งานเกลี้ยง",
  gem: "งานพลอย",
};

/** One row of the prefix config table — analytics.sku_prefix left-joined
 * for the "เลขล่าสุด" column — NOT read from analytics.sku_counter directly
 * (that table has no grant to any role except inside its own RPCs, same
 * posture as oem_doc_counter; see lib/actions/catalog-sku.ts's
 * listSkuPrefixes comment). Instead it's the highest number found on an
 * existing product SKU for that prefix (sku_prefix_preview_seed), which can
 * read slightly lower than the real counter but is always safe to show.
 * null only on an RPC error for that one row (read failure, not "unseeded"
 * — catalog_sku_create always seeds the real counter on first use). */
export interface SkuPrefixRow {
  id: string;
  kindLabel: string;
  workType: SkuWorkType;
  prefix: string;
  lastNo: number | null;
  createdAt: string;
}

export interface UpsertSkuPrefixInput {
  /** NOT sent to sku_prefix_upsert (0089's RPC has no id/row-identifier
   * param — it resolves the target row from natural keys instead, see
   * lib/actions/catalog-sku.ts's comment on upsertSkuPrefix). Kept here only
   * so a future edit UI has somewhere to carry "which row is this" without
   * widening the RPC contract; unused by the create-only flow this app
   * ships today. */
  id?: string | null;
  kindLabel: string;
  workType: SkuWorkType;
  prefix: string;
  seedLastNo: number;
}

export interface CreateCatalogSkuInput {
  prefixId: string;
  name: string;
}

/** Filters free-typed prefix input down to what the DB will accept
 * (`^[A-Z]{1,5}-?$` per 0090 — ขีดท้ายหนึ่งตัวเป็น optional เพื่อรองรับ
 * convention จริงใน catalog อย่าง B-01/B-20 ควบคู่กับแบบไม่มีขีดอย่าง RP9963)
 * as the user types — never lets an invalid character sit in the field even
 * for one keystroke. A dash is kept only as the final character; anything
 * typed after it (or a leading dash) is dropped. */
export function sanitizeSkuPrefixInput(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z-]/g, "");
  const m = upper.match(/^([A-Z]{1,5})(-?)/);
  return m ? m[1] + m[2] : "";
}

/** Client-side mirror of the DB check constraint (0090), for disabling the
 * save button before a round trip — the DB constraint is still the real gate. */
export function isValidSkuPrefix(prefix: string): boolean {
  return /^[A-Z]{1,5}-?$/.test(prefix);
}

/** True when `a` and `b` are the same string, or one is a strict prefix of
 * the other (e.g. "R"/"RP", "N"/"NP") — the "เลขอาจไล่ชนกัน" warning case.
 * Equality is NOT a collision here (that's a separate unique-constraint
 * error from the DB) — only the strict-prefix relationship matters. */
function isStrictPrefixOf(a: string, b: string): boolean {
  return a.length < b.length && b.startsWith(a);
}

/** Returns the first existing prefix (other than `excludeId`, for edit mode)
 * that overlaps with `candidate` in the "SKU numbers might collide" sense —
 * or null if none. Non-blocking warning only: the DB's unique(shop_id, sku)
 * on the actual SKU string is the real backstop (design doc §จุดเสี่ยง 2). */
export function findOverlappingPrefix(
  candidate: string,
  existing: SkuPrefixRow[],
  excludeId?: string | null
): SkuPrefixRow | null {
  if (!candidate) return null;
  for (const row of existing) {
    if (excludeId && row.id === excludeId) continue;
    if (isStrictPrefixOf(candidate, row.prefix) || isStrictPrefixOf(row.prefix, candidate)) {
      return row;
    }
  }
  return null;
}
