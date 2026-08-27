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

// Postgres errcodes the SKU-prefix/catalog RPCs raise with a controlled,
// already-Thai `sqlerrm` that is SAFE to show verbatim on screen (no
// internals leak) — every action in lib/actions/catalog-sku.ts that calls
// one of these RPCs must check this set, not just '22023', before falling
// back to a generic "ลองใหม่อีกครั้ง". Single source of truth so the 3
// actions (upsertSkuPrefix / createCatalogSku / deleteSkuPrefix) can't drift
// out of sync with which codes each RPC actually raises (QA round 1 caught
// 40001 and 23505 both being silently swallowed into the generic message).
//   22023 (invalid_parameter_value) — validation messages, all 3 RPCs
//     (sku_prefix_upsert, sku_prefix_delete, catalog_sku_create), 0089-0096.
//   23505 (unique_violation) — "prefix/kind_label+work_type ถูกใช้แล้ว",
//     raised by sku_prefix_upsert since 0091, never surfaced until now.
//   40001 (serialization_failure) — "ตัวนับ SKU ถูกลบ/แก้พร้อมกันระหว่างออก
//     เลข — ลองใหม่อีกครั้ง", raised by catalog_sku_create, new in 0096.
export const SKU_CONTROLLED_ERROR_CODES = new Set(["22023", "23505", "40001"]);

export type SkuWorkType = "plain" | "gem";

export const SKU_WORK_TYPE_LABEL_TH: Record<SkuWorkType, string> = {
  plain: "งานเกลี้ยง",
  gem: "งานพลอย",
};

/** One row of the prefix config table — analytics.sku_prefix left-joined
 * for the "เลขสูงสุดใน catalog" column — NOT read from analytics.sku_counter
 * directly (that table has no grant to any role except inside its own RPCs,
 * same posture as oem_doc_counter; see lib/actions/catalog-sku.ts's
 * listSkuPrefixes comment). Instead it's the highest number found on an
 * existing product SKU for that prefix (sku_prefix_preview_seed), which can
 * read HIGHER or LOWER than the real counter (it's a SKU-table scan, not the
 * counter itself) — display-only, never used to seed anything.
 * null means either an RPC error for that one row, OR that the caller passed
 * `withLastNo: false` and this column was never fetched (see
 * listSkuPrefixes) — both render as "—" in the UI so the distinction doesn't
 * matter to callers. */
export interface SkuPrefixRow {
  id: string;
  kindLabel: string;
  workType: SkuWorkType;
  prefix: string;
  lastNo: number | null;
  /** จำนวนหลักที่เติมศูนย์ตอนสร้าง SKU ใหม่ (0 = ไม่เติม) — analytics.sku_prefix.pad_width, migration 0091. */
  padWidth: number;
  createdAt: string;
}

export interface UpsertSkuPrefixInput {
  /** Sent to sku_prefix_upsert as `p_id`: null = insert a new row (seed
   * required), a value = update that row (kind_label is always editable;
   * prefix is only editable while no SKU has been issued from it yet;
   * work_type can never be changed after creation). See
   * lib/actions/catalog-sku.ts's comment on upsertSkuPrefix for the full RPC
   * contract. The dialog this app ships today (SkuPrefixDialog) only ever
   * creates new rows (id left undefined → p_id null → insert path) — the
   * edit path is wired end-to-end but has no "แก้ไข" button yet. */
  id?: string | null;
  kindLabel: string;
  workType: SkuWorkType;
  prefix: string;
  /** null = ไม่แตะตัวนับ (RPC's "don't touch the counter" signal) — only
   * meaningful when `id` is set (edit mode). Create mode (id null/undefined)
   * always sends a concrete confirmed int; the dialog enforces this before
   * calling upsertSkuPrefix. */
  seedLastNo: number | null;
  /** Sent to sku_prefix_upsert as `p_pad_width` (0091): null/undefined = ไม่
   * แก้ (insert path จะได้ 0 จาก DB default, update path คงค่าเดิม). The
   * dialog always sends an explicit int on create. */
  padWidth?: number | null;
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
/** Zero-pads `n` to `padWidth` digits WITHOUT ever truncating — a number
 * already at or past padWidth digits long is returned unchanged (`padStart`
 * already has this property, but this wrapper makes the "no truncation"
 * invariant explicit and testable: seed 99 + pad 2 → "100", not "10"). */
export function formatPaddedNumber(n: number, padWidth: number): string {
  const s = String(n);
  return padWidth > s.length ? s.padStart(padWidth, "0") : s;
}

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

// ข้อความ raise จาก RPC ขึ้นต้นด้วยชื่อฟังก์ชันเสมอ (เช่น
// "sku_prefix_delete: prefix RP มี SKU ใช้งานแล้ว 1 รายการ — ลบไม่ได้")
// ชื่อฟังก์ชันมีไว้ให้ dev ไล่ต้นตอใน log ไม่ใช่ให้หน้างานอ่าน — UAT 27 ส.ค.
// เจ้าของเห็นแล้วสะดุด ตัดออกก่อนแสดงบนจอ แต่คง message เดิมไว้ครบทุกตัวอักษร
// ตัดเฉพาะชื่อที่รู้จัก 4 ตัวนี้ ไม่ใช่ regex กว้างๆ ที่อาจกินเนื้อความจริง
const SKU_RPC_NAMES = [
  "sku_prefix_preview_seed",
  "sku_prefix_upsert",
  "sku_prefix_delete",
  "catalog_sku_create",
] as const;

export function humanizeSkuRpcError(message: string): string {
  for (const name of SKU_RPC_NAMES) {
    const prefix = name + ": ";
    if (message.startsWith(prefix)) return message.slice(prefix.length);
  }
  return message;
}
