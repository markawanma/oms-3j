"use server";

// lib/actions/production.ts — P1b write/read layer for the production-order
// (ใบผลิตเข้าสต็อก) module. Backed by supabase/migrations/0131_production_order.sql
// (applied + merged main 18 ก.ย. 69) — every RPC name/arg/jsonb shape below
// is copied 1:1 from that file, not guessed.
//
// Same gating posture as lib/actions/marketing.ts / catalog-sku.ts:
// getServiceClient() uses the service role, which BYPASSES every RLS policy
// AND short-circuits analytics.crm_require_owner_admin() inside every RPC in
// 0131 (that DB-side check has zero effective layers under this client — see
// crm.ts's header for the same gap). That means requireOwnerAdmin() below is
// the ONLY thing gating this module today, not the DB — every single action
// here (including reads) calls it first, per the brief for this module
// (unlike catalog-sku.ts's read-open-to-staff posture: /production's own
// page gate already restricts the whole section to owner/admin, same as
// /marketing/audience, so every action underneath stays consistent with
// that rather than mixing gated/ungated reads in one module).
//
// 🔴 Money-adjacent (production_order_done stamps cost + adds stock in one
// transaction) — no client-side cost math anywhere in this file. Every
// number shown to the owner comes from production_cost_calc/preview/done's
// jsonb response, never recomputed here (oem-quote-invariants skill §2,
// which applies to this module too even though it isn't OEM: 0131 borrows
// the exact same v_dim_product cost formula).
//
// 0144 (new-design-checkbox task): analytics.production_order_item_set now
// takes an optional p_is_new_design (default null = "ไม่ได้ส่งมา ไม่แตะค่า
// เดิม") — setProductionOrderItem below forwards `input.isNewDesign ?? null`
// verbatim, never coercing undefined to false (that would silently reset an
// existing item's flag on every qty-only edit — the exact footgun the RPC's
// null-means-untouched design exists to prevent). Every write still goes
// through this one RPC; nothing in this file issues a raw UPDATE.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import { getSessionUser } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/types";
import { parseMakeSpec } from "@/lib/catalog/types";
import type {
  DoneItemInput,
  DoneProductionOrderInput,
  ProductionCostType,
  ProductionItemBindResult,
  ProductionItemPrefill,
  ProductionMetal,
  ProductionOrderAckResult,
  ProductionOrderCancelResult,
  ProductionOrderDoneResult,
  ProductionOrderItemRow,
  ProductionOrderItemSetResult,
  ProductionOrderPreview,
  ProductionOrderRow,
  ProductionOrderSaveResult,
  ProductionOrderStatus,
  ProductionSkuOption,
  SaveProductionOrderInput,
  SetProductionOrderItemInput,
} from "@/lib/production/types";
import {
  humanizeProductionError,
  parseMetalPrices,
  parseMissingPrices,
  parseProductionMetal,
  parseProductionNumber,
  parseProductionSpecCostCalc,
  parseProductionWeightSource,
  PRODUCTION_METALS,
  PRODUCTION_SPOT_OVERRIDE_MAX,
  PRODUCTION_SPOT_OVERRIDE_MIN,
  productionItemInputIssue,
} from "@/lib/production/types";
import { fetchAllRows } from "@/lib/supabase/query-limits";
import { readErrorCode, readErrorMessage, redactUrls } from "@/lib/supabase/postgrest-error";
import { ackErrorFromHint, cleanAckError, orderNotOpenError } from "@/lib/production/office-ack";

const SCHEMA = "analytics";

/** กัน 22P02 จาก Postgres ก่อนถึง DB — ข้อความ error ของ 22P02 เผย uuid ดิบ
 * และไม่ได้ติด errcode 22023 จึงจะตกเป็นข้อความกลางที่ผู้ใช้เดาสาเหตุไม่ออก */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** shared by previewProductionOrder/doneProductionOrder — both send a
 * `{product_id, qty_done}[]` override array and both need the exact same
 * defense against a malformed client payload (empty array, dup product_id,
 * bad uuid/qty — see doneProductionOrder's existing comment for why each
 * check exists; preview needs the same ones now that it can affect what
 * gets costed, task brief 2b). Returns an error string, or null when valid. */
function validateDoneItems(items: DoneItemInput[]): string | null {
  if (!Array.isArray(items) || items.length === 0) return null; // empty = caller's choice to omit (preview defaults to qty_planned)
  const seenProductIds = new Set<string>();
  for (const it of items) {
    if (!it.productId || !UUID_RE.test(it.productId)) return "ไม่พบ SKU ในรายการที่จะบันทึก";
    if (seenProductIds.has(it.productId)) return "มี SKU ซ้ำในรายการ — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง";
    seenProductIds.add(it.productId);
    if (!Number.isFinite(it.qtyDone) || !Number.isInteger(it.qtyDone) || it.qtyDone < 0 || it.qtyDone > 100000) {
      return "จำนวนที่ผลิตได้จริงต้องเป็นจำนวนเต็ม 0-100000";
    }
  }
  return null;
}

async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานใบผลิตเข้าสต็อกได้" };
  }
  return null;
}

/** 0132 M4 — actor สำหรับ audit trail (p_actor) ต้องมาจาก session ฝั่ง server
 * เท่านั้น (getSessionUser()) ห้ามรับจาก client/form (security review 18 ก.ย.
 * — ไม่งั้นกลายเป็นช่องปลอมตัว). ไม่ throw เอง: ถ้าอ่าน session ไม่ได้ (เช่น env
 * ผิดปกติชั่วคราว — เทียบ H2 ใน lib/auth/role.ts) การเขียนใบผลิตยังต้องทำงาน
 * ต่อได้ แค่ p_actor เป็น null ⇒ RPC coalesce กลับไปใช้ auth.uid() เหมือนก่อนมี
 * arg นี้ (auth.uid() เป็น null เสมออยู่แล้วผ่าน service client — ดูหัวไฟล์) */
async function getActorId(): Promise<string | null> {
  try {
    const user = await getSessionUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** log เฉพาะ code + message ที่ลบ URL แล้ว (บทเรียน supabase-error-logging-trap: ห้าม log error ทั้งก้อน — มี PII/URL) */
function logRpcFailure(label: string, err: unknown): void {
  console.error(`${label} failed`, { code: readErrorCode(err), message: redactUrls(readErrorMessage(err)) });
}

function revalidateProduction(id?: string) {
  revalidatePath("/production");
  if (id) revalidatePath(`/production/${id}`);
}

// ============================================================================
// /production — list (analytics.v_production_order, 0131 §14)
// ============================================================================

export interface GetProductionOrdersResult {
  rows: ProductionOrderRow[];
  totalCount: number;
  truncated: boolean;
}

export async function getProductionOrders(): Promise<ActionResult<GetProductionOrdersResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const result = await fetchAllRows((pageFrom, pageTo) =>
      supabase
        .schema(SCHEMA)
        .from("v_production_order")
        .select(
          // 0187: ต่อท้าย opened_via/opened_by_worker_name/acknowledged_at (ต้อง apply 0187 ก่อน deploy — DB เดียว)
          "id, po_no, status, note, spot_override_thb_per_gram, done_at, cancelled_at, cancel_reason, created_at, updated_at, item_count, qty_planned_total, qty_done_total, opened_via, opened_by_worker_name, acknowledged_at, unbound_item_count",
          { count: "exact" }
        )
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageFrom, pageTo)
    );

    const rows: ProductionOrderRow[] = (
      result.rows as {
        id: string;
        po_no: string;
        status: ProductionOrderStatus;
        note: string | null;
        spot_override_thb_per_gram: number | null;
        done_at: string | null;
        cancelled_at: string | null;
        cancel_reason: string | null;
        created_at: string;
        updated_at: string;
        item_count: number;
        qty_planned_total: number;
        qty_done_total: number;
        opened_via: string | null;
        opened_by_worker_name: string | null;
        acknowledged_at: string | null;
        unbound_item_count: number | null;
      }[]
    ).map((r) => ({
      id: r.id,
      poNo: r.po_no,
      status: r.status,
      note: r.note,
      spotOverrideThbPerGram: r.spot_override_thb_per_gram == null ? null : Number(r.spot_override_thb_per_gram),
      doneAt: r.done_at,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      itemCount: Number(r.item_count) || 0,
      qtyPlannedTotal: Number(r.qty_planned_total) || 0,
      qtyDoneTotal: Number(r.qty_done_total) || 0,
      // 0187: จำนวนรายการที่ยังไม่ผูก SKU มาจาก v_production_order ที่เดียว (นับที่ DB — ไม่นับเองฝั่ง TS อีก)
      unboundItemCount: Number(r.unbound_item_count) || 0,
      openedVia: r.opened_via === "shopfloor" ? "shopfloor" : "office",
      openedByWorkerName: r.opened_by_worker_name ?? null,
      acknowledgedAt: r.acknowledged_at ?? null,
    }));

    return { ok: true, data: { rows, totalCount: result.totalCount, truncated: result.truncated } };
  } catch (err) {
    console.error("getProductionOrders failed", err);
    return { ok: false, error: "โหลดรายการใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /production/[id] — one order's header + items (v_production_order +
// v_production_order_item, 0131 §14)
// ============================================================================

export interface ProductionOrderDetail {
  order: ProductionOrderRow;
  items: ProductionOrderItemRow[];
}

export async function getProductionOrder(id: string): Promise<ActionResult<ProductionOrderDetail>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!id) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [orderRes, itemsRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_production_order")
        .select(
          "id, po_no, status, note, spot_override_thb_per_gram, done_at, cancelled_at, cancel_reason, created_at, updated_at, item_count, qty_planned_total, qty_done_total, opened_via, opened_by_worker_name, acknowledged_at, unbound_item_count"
        )
        .eq("id", id)
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("v_production_order_item")
        .select(
          // 0186: v_production_order_item ต่อท้าย 13 คอลัมน์ (pending_product_label … sku_metal_known — left join product: รายการไม่มี SKU ไม่หายจากวิว)
          // ⚠ ต้องเป็น string literal เดียว (ห้ามต่อสตริงด้วย +) — type ของ supabase-js parse select จาก literal ถ้าต่อสตริงจะกลายเป็น GenericStringError
          "id, production_order_id, po_no, order_status, product_id, sku, product_name, current_cost_type, current_unit_cost, qty_planned, qty_done, stamped_unit_cost, prev_cost_type, prev_unit_cost, created_at, updated_at, pending_product_label, metal, purity, weight_g, weight_source, effective_metal, effective_purity, effective_weight_g, effective_weight_source, sku_metal, sku_purity, sku_weight_g, sku_metal_known, metal_mismatch"
        )
        .eq("production_order_id", id)
        .eq("shop_id", shopId)
        .order("created_at", { ascending: true }),
    ]);
    if (orderRes.error) throw orderRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (!orderRes.data) return { ok: false, error: "ไม่พบใบผลิตนี้ในร้านนี้" };

    // 0141: make_spec (public.product) + is_new_design/cost_calc
    // (analytics.production_order_item) — neither view above exposes these
    // (v_production_order_item wasn't widened in 0141/0142 on purpose, see
    // that migration's header) so read them straight off the base tables,
    // same side-channel pattern lib/actions/catalog.ts already uses for
    // barcode/supplier/note. Both grant select to service_role already
    // (0131 §15 / 0028) — no schema change needed for this read.
    // 0186: product_id null = รายการไม่มี SKU (ไม่มีอะไรให้อ่านจาก product)
    const productIds = Array.from(
      new Set((itemsRes.data ?? []).map((r) => (r as { product_id: string | null }).product_id).filter((id): id is string => id !== null))
    );
    const itemIds = (itemsRes.data ?? []).map((r) => (r as { id: string }).id);
    const [specRes, costCalcRes] = await Promise.all([
      productIds.length > 0
        ? supabase
            .from("product")
            .select("id, make_spec, silver_weight_g, silver_purity")
            .eq("shop_id", shopId)
            .in("id", productIds)
        : Promise.resolve({
            data: [] as { id: string; make_spec: unknown; silver_weight_g: number | null; silver_purity: number | null }[],
            error: null,
          }),
      itemIds.length > 0
        ? supabase
            .schema(SCHEMA)
            .from("production_order_item")
            .select("id, is_new_design, cost_calc")
            .eq("shop_id", shopId)
            .in("id", itemIds)
        : Promise.resolve({ data: [] as { id: string; is_new_design: boolean; cost_calc: unknown }[], error: null }),
    ]);
    if (specRes.error) throw specRes.error;
    if (costCalcRes.error) throw costCalcRes.error;

    const specByProductId = new Map<
      string,
      { makeSpec: unknown; silverWeightG: number | null; silverPurity: number | null }
    >();
    for (const r of (specRes.data ?? []) as {
      id: string;
      make_spec: unknown;
      silver_weight_g: number | null;
      silver_purity: number | null;
    }[]) {
      specByProductId.set(r.id, {
        makeSpec: r.make_spec,
        silverWeightG: r.silver_weight_g == null ? null : Number(r.silver_weight_g),
        silverPurity: r.silver_purity == null ? null : Number(r.silver_purity),
      });
    }
    const costCalcByItemId = new Map<string, { isNewDesign: boolean; costCalc: unknown }>();
    for (const r of (costCalcRes.data ?? []) as { id: string; is_new_design: boolean; cost_calc: unknown }[]) {
      costCalcByItemId.set(r.id, { isNewDesign: Boolean(r.is_new_design), costCalc: r.cost_calc });
    }

    const o = orderRes.data as {
      id: string;
      po_no: string;
      status: ProductionOrderStatus;
      note: string | null;
      spot_override_thb_per_gram: number | null;
      done_at: string | null;
      cancelled_at: string | null;
      cancel_reason: string | null;
      created_at: string;
      updated_at: string;
      item_count: number;
      qty_planned_total: number;
      qty_done_total: number;
      opened_via: string | null;
      opened_by_worker_name: string | null;
      acknowledged_at: string | null;
      unbound_item_count: number | null;
    };

    const order: ProductionOrderRow = {
      id: o.id,
      poNo: o.po_no,
      status: o.status,
      note: o.note,
      spotOverrideThbPerGram: o.spot_override_thb_per_gram == null ? null : Number(o.spot_override_thb_per_gram),
      doneAt: o.done_at,
      cancelledAt: o.cancelled_at,
      cancelReason: o.cancel_reason,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      itemCount: Number(o.item_count) || 0,
      qtyPlannedTotal: Number(o.qty_planned_total) || 0,
      qtyDoneTotal: Number(o.qty_done_total) || 0,
      unboundItemCount: Number(o.unbound_item_count) || 0,
      openedVia: o.opened_via === "shopfloor" ? "shopfloor" : "office",
      openedByWorkerName: o.opened_by_worker_name ?? null,
      acknowledgedAt: o.acknowledged_at ?? null,
    };

    const items: ProductionOrderItemRow[] = (
      (itemsRes.data ?? []) as {
        id: string;
        production_order_id: string;
        po_no: string;
        order_status: ProductionOrderStatus;
        product_id: string | null;
        sku: string | null;
        product_name: string | null;
        current_cost_type: ProductionCostType | null;
        current_unit_cost: number | null;
        qty_planned: number;
        qty_done: number | null;
        stamped_unit_cost: number | null;
        prev_cost_type: ProductionCostType | null;
        prev_unit_cost: number | null;
        created_at: string;
        updated_at: string;
        pending_product_label: string | null;
        metal: string | null;
        purity: number | string | null;
        weight_g: number | string | null;
        weight_source: string | null;
        effective_metal: string | null;
        effective_purity: number | string | null;
        effective_weight_g: number | string | null;
        effective_weight_source: string | null;
        sku_metal: string | null;
        sku_purity: number | string | null;
        sku_weight_g: number | string | null;
        sku_metal_known: boolean | null;
        metal_mismatch: boolean | null;
      }[]
    ).map((r) => {
      const spec = r.product_id === null ? undefined : specByProductId.get(r.product_id);
      return {
        id: r.id,
        productionOrderId: r.production_order_id,
        poNo: r.po_no,
        orderStatus: r.order_status,
        productId: r.product_id,
        sku: r.sku,
        productName: r.product_name,
        pendingProductLabel: r.pending_product_label,
        currentCostType: r.current_cost_type,
        currentUnitCost: r.current_unit_cost == null ? null : Number(r.current_unit_cost),
        metal: parseProductionMetal(r.metal),
        purity: parseProductionNumber(r.purity),
        weightG: parseProductionNumber(r.weight_g),
        weightSource: parseProductionWeightSource(r.weight_source),
        effectiveMetal: parseProductionMetal(r.effective_metal),
        effectivePurity: parseProductionNumber(r.effective_purity),
        effectiveWeightG: parseProductionNumber(r.effective_weight_g),
        effectiveWeightSource: parseProductionWeightSource(r.effective_weight_source),
        skuMetal: parseProductionMetal(r.sku_metal),
        skuPurity: parseProductionNumber(r.sku_purity),
        skuWeightG: parseProductionNumber(r.sku_weight_g),
        skuMetalKnown: r.sku_metal_known === true,
        // 0187: DB คำนวณ (โลหะรายการ ≠ โลหะ SKU ที่ระบุชัด) — ห้าม client คิดเอง
        metalMismatch: r.metal_mismatch === true,
        qtyPlanned: Number(r.qty_planned) || 0,
        qtyDone: r.qty_done == null ? null : Number(r.qty_done),
        stampedUnitCost: r.stamped_unit_cost == null ? null : Number(r.stamped_unit_cost),
        prevCostType: r.prev_cost_type,
        prevUnitCost: r.prev_unit_cost == null ? null : Number(r.prev_unit_cost),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        makeSpec: r.current_cost_type === "spec" ? parseMakeSpec(spec?.makeSpec) : null,
        currentSilverWeightG: spec?.silverWeightG ?? null,
        currentSilverPurity: spec?.silverPurity ?? null,
        isNewDesign: costCalcByItemId.get(r.id)?.isNewDesign ?? false,
        costCalc: parseProductionSpecCostCalc(costCalcByItemId.get(r.id)?.costCalc),
      } satisfies ProductionOrderItemRow;
    });

    return { ok: true, data: { order, items } };
  } catch (err) {
    console.error("getProductionOrder failed", err);
    return { ok: false, error: "โหลดใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// SKU picker (analytics.v_dim_product) — read-only. Filtered server-side to
// is_active=true and sku NOT ILIKE 'live%' so a SKU the DB would reject
// (production_order_item_derive_shop, 0131 §5c) never even appears as a
// choice — same posture as lib/actions/oem.ts's getOemProducts, independent
// implementation (this file must not import from lib/actions/oem.ts).
// ============================================================================

export async function getProductionSkuOptions(): Promise<ActionResult<ProductionSkuOption[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const result = await fetchAllRows((pageFrom, pageTo) =>
      supabase
        .schema(SCHEMA)
        .from("v_dim_product")
        .select("product_id, sku, name, cost_type", { count: "exact" })
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .not("sku", "ilike", "live%")
        .order("sku", { ascending: true })
        .order("product_id", { ascending: true })
        .range(pageFrom, pageTo)
    );

    const rows: ProductionSkuOption[] = (
      result.rows as { product_id: string; sku: string; name: string; cost_type: ProductionCostType }[]
    ).map((r) => ({ productId: r.product_id, sku: r.sku, name: r.name, costType: r.cost_type }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getProductionSkuOptions failed", err);
    return { ok: false, error: "โหลดรายการ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Writes — analytics.production_order_save / item_set / item_remove /
// preview / done / cancel (0131 §6-13)
// ============================================================================

export async function saveProductionOrder(
  input: SaveProductionOrderInput
): Promise<ActionResult<ProductionOrderSaveResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (input.spotOverrideThbPerGram != null) {
    const v = input.spotOverrideThbPerGram;
    if (!Number.isFinite(v) || v < PRODUCTION_SPOT_OVERRIDE_MIN || v > PRODUCTION_SPOT_OVERRIDE_MAX) {
      return {
        ok: false,
        error: `ราคาเงินเฉพาะใบนี้ต้องอยู่ระหว่าง ${PRODUCTION_SPOT_OVERRIDE_MIN}-${PRODUCTION_SPOT_OVERRIDE_MAX} บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท — 1 บาท = 15.244 กรัม)`,
      };
    }
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const actorId = await getActorId();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_save", {
      p_shop_id: shopId,
      p_id: input.id ?? null,
      p_note: input.note ?? null,
      p_spot_override_thb_per_gram: input.spotOverrideThbPerGram ?? null,
      // 0132 M2 — default false = พฤติกรรมเดิมทุกประการ (ส่ง null = ไม่แตะ)
      p_clear_note: input.clearNote ?? false,
      p_clear_spot_override: input.clearSpotOverride ?? false,
      // 0132 M4
      p_actor: actorId,
    });
    if (error) throw error;

    const row = data as {
      id: string;
      po_no: string;
      status: ProductionOrderStatus;
      note: string | null;
      spot_override_thb_per_gram: number | null;
      seq: number;
      created_at: string;
    };

    revalidateProduction(row.id);

    return {
      ok: true,
      data: {
        id: row.id,
        poNo: row.po_no,
        status: row.status,
        note: row.note,
        spotOverrideThbPerGram: row.spot_override_thb_per_gram == null ? null : Number(row.spot_override_thb_per_gram),
        seq: Number(row.seq),
        createdAt: row.created_at,
      },
    };
  } catch (err) {
    console.error("saveProductionOrder failed", err);
    return { ok: false, error: humanizeProductionError(err, "บันทึกใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** เพิ่ม/แก้รายการในใบผลิต (production_order_item_set 0144 → 0186) — SKU หรือชื่อแบบ (รายการไม่มี SKU) อย่างใดอย่างหนึ่ง ·
 * ทุกช่องที่ไม่ส่ง (undefined) = "ไม่แตะค่าเดิม" ⇒ ส่ง null / ไม่ส่ง arg นั้นให้ RPC (แถวใหม่: server เติมค่าเริ่มจาก SKU ด้วย helper ตัวเดียว)
 *  • isNewDesign (0144): ห้าม caller ส่ง `false` เป็นค่าเริ่มต้นเงียบๆ (จะรีเซ็ตค่าที่ติ๊กไว้แล้วทุกครั้งที่แก้ qty) — ส่งเฉพาะตอนผู้ใช้ตั้งใจติ๊ก/ถอดติ๊กจริง
 *  • metal/purity/weight (0186): purity เป็นสัดส่วน 0.375–1 ไม่ใช่ % · ทองไม่มี default เนื้อ · ทองเหลืองล็อก 1 · เปลี่ยนโลหะไม่ได้เมื่อมีใบงานเดินอยู่ (DB ตอบ metal_locked)
 *  • arg ใหม่ของ 0186 ส่งเฉพาะที่มีค่า (ใบเงินแบบเดิมส่ง 5 arg เดิมเหมือนก่อน 0186 — เรียก DB ได้ทั้งก่อน/หลัง apply) */
export async function setProductionOrderItem(input: SetProductionOrderItemInput): Promise<ActionResult<ProductionOrderItemSetResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };
  const hasSku = input.productId != null && input.productId !== "";
  if (!hasSku && (input.pendingProductLabel == null || input.pendingProductLabel === "")) return { ok: false, error: "กรุณาเลือก SKU" };
  const issue = productionItemInputIssue(input);
  if (issue) return { ok: false, error: issue };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const args: Record<string, unknown> = {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_product_id: hasSku ? input.productId : null,
      p_qty_planned: input.qtyPlanned,
      p_is_new_design: input.isNewDesign ?? null,
    };
    if (input.pendingProductLabel != null && input.pendingProductLabel !== "") args.p_pending_product_label = input.pendingProductLabel;
    if (input.metal !== undefined) args.p_metal = input.metal;
    if (input.purity !== undefined) args.p_purity = input.purity;
    if (input.weightG !== undefined) {
      args.p_weight_g = input.weightG;
      args.p_weight_source = input.weightSource;
    }
    if (input.clearWeight) args.p_clear_weight = true;

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_item_set", args);
    if (error) throw error;

    const row = data as {
      id: string;
      product_id: string | null;
      sku: string | null;
      name: string | null;
      pending_product_label?: string | null;
      qty_planned: number;
      is_new_design: boolean;
      metal?: string | null;
      purity?: number | string | null;
      weight_g?: number | string | null;
      weight_source?: string | null;
    };

    revalidateProduction(input.productionOrderId);

    return {
      ok: true,
      data: {
        id: row.id,
        productId: row.product_id ?? null,
        sku: row.sku ?? null,
        name: row.name ?? row.pending_product_label ?? "",
        pendingProductLabel: row.pending_product_label ?? null,
        qtyPlanned: Number(row.qty_planned) || 0,
        isNewDesign: Boolean(row.is_new_design),
        metal: parseProductionMetal(row.metal),
        purity: parseProductionNumber(row.purity),
        weightG: parseProductionNumber(row.weight_g),
        weightSource: parseProductionWeightSource(row.weight_source),
      },
    };
  } catch (err) {
    console.error("setProductionOrderItem failed", err);
    return { ok: false, error: humanizeProductionError(err, "เพิ่ม/แก้รายการไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** ลบรายการด้วย id (รายการไม่มี SKU ลบด้วย productId ไม่ได้) — มีใบงานผูกอยู่ DB ตอบ job_exists พร้อมเลขใบงาน */
export async function removeProductionOrderItemById(input: { productionOrderId: string; itemId: string }): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.productionOrderId || !input.itemId || !UUID_RE.test(input.itemId)) return { ok: false, error: "ไม่พบรายการที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("production_order_item_remove_by_id", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_item_id: input.itemId,
    });
    if (error) throw error;

    revalidateProduction(input.productionOrderId);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("removeProductionOrderItemById failed", err);
    return { ok: false, error: humanizeProductionError(err, "ลบรายการไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** ค่าเริ่มของ SKU ตอนเลือกในการ์ดร่าง — server ตัดสิน (production_item_prefill ใช้ helper ตัวเดียวกับ preview/done) · client แค่แสดง
 * metalKnown = true เฉพาะ SKU ที่ระบุโลหะจริง (make_spec.metal / โหมด spot) ⇒ เตือน "ต่างจาก SKU" ได้เฉพาะกรณีนี้ ที่เหลือใช้ข้อความกลาง */
export async function getProductionItemPrefill(productId: string): Promise<ActionResult<ProductionItemPrefill>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!productId || !UUID_RE.test(productId)) return { ok: false, error: "กรุณาเลือก SKU" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_item_prefill", { p_shop_id: shopId, p_product_id: productId });
    if (error) throw error;

    const row = data as {
      product_id: string;
      sku: string;
      name: string;
      cost_type: ProductionCostType;
      metal: string | null;
      purity: number | string | null;
      weight_g: number | string | null;
      weight_source: string | null;
      metal_known: boolean | null;
    };

    return {
      ok: true,
      data: {
        productId: row.product_id,
        sku: row.sku,
        name: row.name,
        costType: row.cost_type,
        // server คืน silver เป็นค่าเริ่มเสมอเมื่อ SKU ไม่ระบุโลหะ (มติ Q5) — ถ้า parse ไม่ได้จริงๆ ก็ตกที่ silver เหมือนกัน ไม่ปล่อยให้ว่าง
        metal: parseProductionMetal(row.metal) ?? "silver",
        purity: parseProductionNumber(row.purity),
        weightG: parseProductionNumber(row.weight_g),
        weightSource: parseProductionWeightSource(row.weight_source),
        metalKnown: row.metal_known === true,
      },
    };
  } catch (err) {
    console.error("getProductionItemPrefill failed", err);
    return { ok: false, error: humanizeProductionError(err, "โหลดค่าเริ่มของ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/**
 * @deprecated 0186: ใช้ removeProductionOrderItemById — ลบตาม item id (รองรับรายการไม่มี SKU, แถวซ้ำ SKU เดียวกัน) ·
 * ตัวนี้ลบตาม (order, product) จึงลบรายการที่ไม่มี SKU ไม่ได้ · คงไว้เพื่อ caller เดิมเท่านั้น ห้ามเรียกใหม่
 */
export async function removeProductionOrderItem(input: {
  productionOrderId: string;
  productId: string;
}): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.productionOrderId || !input.productId) return { ok: false, error: "ไม่พบรายการที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("production_order_item_remove", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_product_id: input.productId,
    });
    if (error) throw error;

    revalidateProduction(input.productionOrderId);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("removeProductionOrderItem failed", err);
    return { ok: false, error: humanizeProductionError(err, "ลบรายการไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** analytics.production_order_preview — ONLY call while the order is
 * 'open' (the RPC raises otherwise, 0131 §11). Callers must check
 * order.status === 'open' before calling this — a closed order's numbers
 * live on ProductionOrderItemRow (stampedUnitCost/prevUnitCost) instead.
 *
 * 0141/0142 (task brief 2b): `items` optionally overrides qty PER product_id
 * the same way doneProductionOrder's `items` does — omit/empty = every line
 * costed at qty_planned (unchanged pre-0141 behaviour). Pass the SAME array
 * you're about to send to doneProductionOrder so the number shown = the
 * number that gets stamped (cost_type='spec' cost depends on qty — batch/NRE
 * amortize over it, unlike fixed/spot which are qty-independent). */
export async function previewProductionOrder(
  productionOrderId: string,
  items?: DoneItemInput[]
): Promise<ActionResult<ProductionOrderPreview>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };
  if (items && items.length > 0) {
    const itemsErr = validateDoneItems(items);
    if (itemsErr) return { ok: false, error: itemsErr };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_preview", {
      p_shop_id: shopId,
      p_production_order_id: productionOrderId,
      p_items: items && items.length > 0 ? items.map((it) => ({ product_id: it.productId, qty_done: it.qtyDone })) : null,
    });
    if (error) throw error;

    const row = data as {
      production_order_id: string;
      po_no: string;
      spot_price_thb_per_gram: number | null;
      // 0186 — additive: DB เก่า (ก่อน apply) ไม่มี 2 key นี้ → default ว่าง
      metal_prices?: unknown;
      missing_prices?: unknown;
      items: {
        item_id: string;
        product_id: string;
        sku: string;
        cost_type: ProductionCostType;
        silver_weight_g: number | null;
        silver_purity: number;
        labor_cost: number | null;
        spot_price_thb_per_gram: number | null;
        prev_cost_type: ProductionCostType;
        prev_unit_cost: number | null;
        unit_cost: number | null;
        qty_planned: number;
        qty_used: number;
        is_new_design: boolean;
        cost_calc: unknown;
        skipped?: boolean;
        price_missing?: boolean;
        metal?: string | null;
        purity?: number | string | null;
        weight_g?: number | string | null;
        weight_source?: string | null;
      }[];
    };

    return {
      ok: true,
      data: {
        productionOrderId: row.production_order_id,
        poNo: row.po_no,
        spotPriceThbPerGram: row.spot_price_thb_per_gram == null ? null : Number(row.spot_price_thb_per_gram),
        metalPrices: parseMetalPrices(row.metal_prices),
        missingPrices: parseMissingPrices(row.missing_prices),
        items: (row.items ?? []).map((it) => ({
          priceMissing: it.price_missing === true,
          metal: parseProductionMetal(it.metal),
          purity: parseProductionNumber(it.purity),
          weightG: parseProductionNumber(it.weight_g),
          weightSource: parseProductionWeightSource(it.weight_source),
          itemId: it.item_id,
          productId: it.product_id,
          sku: it.sku,
          costType: it.cost_type,
          silverWeightG: it.silver_weight_g == null ? null : Number(it.silver_weight_g),
          silverPurity: Number(it.silver_purity),
          laborCost: it.labor_cost == null ? null : Number(it.labor_cost),
          spotPriceThbPerGram: it.spot_price_thb_per_gram == null ? null : Number(it.spot_price_thb_per_gram),
          prevCostType: it.prev_cost_type,
          prevUnitCost: it.prev_unit_cost == null ? null : Number(it.prev_unit_cost),
          unitCost: it.unit_cost == null ? null : Number(it.unit_cost),
          qtyPlanned: Number(it.qty_planned) || 0,
          qtyUsed: Number(it.qty_used ?? it.qty_planned) || 0,
          isNewDesign: Boolean(it.is_new_design),
          costCalc: parseProductionSpecCostCalc(it.cost_calc),
          skipped: Boolean(it.skipped),
        })),
      },
    };
  } catch (err) {
    console.error("previewProductionOrder failed", err);
    return { ok: false, error: humanizeProductionError(err, "คำนวณตัวอย่างต้นทุนไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** ราคาที่หน้าจอเห็นตอน preview ต่อโลหะ (0186 — M1 fail-closed ต่อโลหะ: 0132 M1 ขยายจากเงินเดี่ยว) → payload `p_expected_metal_prices`
 * · expectedMetalPrices ชนะ expectedSpotThbPerGram (ช่องทางเดิมของ UI ก่อน PM-B — แปลงเป็น {silver} ให้) · ใบ fixed ล้วนส่ง {} หรือไม่ส่งเลยก็ได้
 * · ค่าที่ DB ไม่ต้องการ (โลหะที่ใบไม่ได้ใช้) DB ปฏิเสธ (expected_prices_extra) — จึงส่งเฉพาะที่หน้าจอเห็นจริง ไม่เติมเอง
 * คืน { ok:false } เมื่อ payload ผิดรูป (กันค่าเพี้ยนก่อนถึง DB) */
function buildExpectedMetalPrices(input: DoneProductionOrderInput): { ok: true; value: Record<string, number> | null } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "ราคาโลหะอ้างอิงที่ส่งมาไม่ถูกต้อง — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง" };
  if (input.expectedMetalPrices != null) {
    if (typeof input.expectedMetalPrices !== "object" || Array.isArray(input.expectedMetalPrices)) return bad;
    const out: Record<string, number> = {};
    for (const [metal, price] of Object.entries(input.expectedMetalPrices)) {
      if (!(PRODUCTION_METALS as readonly string[]).includes(metal)) return bad;
      if (typeof price !== "number" || !Number.isFinite(price) || !(price > 0)) return bad;
      out[metal] = price;
    }
    return { ok: true, value: out };
  }
  if (input.expectedSpotThbPerGram != null) {
    if (!Number.isFinite(input.expectedSpotThbPerGram)) {
      return { ok: false, error: "ราคาเงินอ้างอิงที่ส่งมาไม่ถูกต้อง — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง" };
    }
    return { ok: true, value: { silver: input.expectedSpotThbPerGram } };
  }
  return { ok: true, value: null };
}

export async function doneProductionOrder(input: DoneProductionOrderInput): Promise<ActionResult<ProductionOrderDoneResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!input.productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };
  const expected = buildExpectedMetalPrices(input);
  if (!expected.ok) return { ok: false, error: expected.error };

  // security review 18 ก.ย. (M6) — payload นี้ไปกำหนดว่าของเข้าสต็อกกี่ชิ้นและ
  // ต้นทุนถูกล็อกเท่าไร (แก้ย้อนไม่ได้) จึงต้องกันให้ครบ 3 อย่างที่ DB กันให้ไม่ได้
  // อย่างสวยงาม:
  //   • array ว่าง ⇒ 0131 ตีความว่า "ผลิตครบตามแผนทุกบรรทัด" ⇒ ถ้า payload ฝั่ง
  //     client เพี้ยน จะได้ "ผลิตครบ" เงียบๆ แทนที่จะเป็น error
  //   • product_id ซ้ำ ⇒ subquery ใน 0131 คืนหลายแถว ⇒ 21000 ทั้ง transaction ตก
  //     (fail-closed ก็จริง แต่ข้อความอ่านไม่รู้เรื่อง)
  //   • product_id ที่ไม่ใช่ uuid ⇒ 22P02
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: "ไม่พบรายการที่จะบันทึก — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง" };
  }
  const itemsErr = validateDoneItems(input.items);
  if (itemsErr) return { ok: false, error: itemsErr };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const actorId = await getActorId();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_done", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_items: input.items.map((it) => ({ product_id: it.productId, qty_done: it.qtyDone })),
      // 0132 M1 → 0186: ต่อโลหะ (jsonb {silver, gold, brass}) — null/{} ได้เฉพาะใบ fixed ล้วน (DB fail-closed เมื่อใบใช้ราคาแล้วไม่ส่ง)
      p_expected_metal_prices: expected.value,
      // 0132 M4
      p_actor: actorId,
    });
    if (error) throw error;

    const row = data as {
      production_order_id: string;
      po_no: string;
      status: ProductionOrderStatus;
      already_done: boolean;
      metal_prices?: unknown;
      items: {
        product_id: string;
        sku: string;
        qty_done: number | null;
        unit_cost: number | null;
        prev_cost_type: ProductionCostType | null;
        prev_unit_cost: number | null;
        cost_calc: unknown;
        metal?: string | null;
        purity?: number | string | null;
        weight_g?: number | string | null;
      }[];
    };

    revalidateProduction(input.productionOrderId);
    // Post-0138: cost is no longer stamped back onto public.product (it now
    // lives on analytics.stock_lot instead) — so /catalog has nothing that
    // actually changes on done today. Keeping this revalidatePath anyway
    // because done still writes track_stock/track_stock_since onto product,
    // and 0139/0140 will make /catalog surface lot-based cost (lot_cost_avg).
    revalidatePath("/catalog");
    revalidatePath("/stock");

    return {
      ok: true,
      data: {
        productionOrderId: row.production_order_id,
        poNo: row.po_no,
        status: row.status,
        alreadyDone: Boolean(row.already_done),
        metalPrices: parseMetalPrices(row.metal_prices),
        items: (row.items ?? []).map((it) => ({
          productId: it.product_id,
          sku: it.sku,
          qtyDone: it.qty_done == null ? null : Number(it.qty_done),
          unitCost: it.unit_cost == null ? null : Number(it.unit_cost),
          prevCostType: it.prev_cost_type,
          prevUnitCost: it.prev_unit_cost == null ? null : Number(it.prev_unit_cost),
          costCalc: parseProductionSpecCostCalc(it.cost_calc),
          metal: parseProductionMetal(it.metal),
          purity: parseProductionNumber(it.purity),
          weightG: parseProductionNumber(it.weight_g),
        })),
      },
    };
  } catch (err) {
    console.error("doneProductionOrder failed", err);
    return { ok: false, error: humanizeProductionError(err, "บันทึกผลิตเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

export async function cancelProductionOrder(input: {
  productionOrderId: string;
  reason?: string | null;
}): Promise<ActionResult<ProductionOrderCancelResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!input.productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_cancel", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_reason: input.reason?.trim() || null,
    });
    if (error) throw error;

    const row = data as { production_order_id: string; po_no: string; status: ProductionOrderStatus; already_cancelled: boolean };

    revalidateProduction(input.productionOrderId);

    return {
      ok: true,
      data: {
        productionOrderId: row.production_order_id,
        poNo: row.po_no,
        status: row.status,
        alreadyCancelled: Boolean(row.already_cancelled),
      },
    };
  } catch (err) {
    console.error("cancelProductionOrder failed", err);
    return { ok: false, error: humanizeProductionError(err, "ยกเลิกใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

// ============================================================================
// 0187 W1 — ใบที่ผู้จัดการเปิดจากหน้างาน: ออฟฟิศรับทราบ · ผูก SKU ทีหลัง · แก้ชื่อแบบก่อนผูก
// ทุก action: owner/admin เท่านั้น · actor จาก session ฝั่ง server (ห้ามรับจาก client) · ไม่คิดเงินที่นี่ (ต้นทุนอยู่ที่ production_order_done ซึ่ง 0187 ไม่แตะ)
// ============================================================================

/** ออฟฟิศรับทราบใบที่เปิดจากหน้างาน — ครั้งเดียว (ซ้ำ = error) · ใบออฟฟิศ = error · "ผลิตเสร็จ" ของใบหน้างานต้องรับทราบก่อน (ด่านที่ trigger) */
/** hint ของ error จาก RPC (postgrest-js คืน error เป็น object ธรรมดา) — ไม่ใช่ string = undefined */
const errHint = (err: unknown): unknown => (typeof err === "object" && err !== null ? (err as { hint?: unknown }).hint : undefined);

export async function acknowledgeProductionOrder(input: { productionOrderId: string }): Promise<ActionResult<ProductionOrderAckResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (typeof input !== "object" || input === null || !UUID_RE.test(String(input.productionOrderId ?? ""))) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };
  const actor = await getActorId();
  if (!actor) return { ok: false, error: "ต้องเข้าสู่ระบบก่อนทำรายการ" };
  try {
    const { data, error } = await getServiceClient().schema(SCHEMA).rpc("production_order_acknowledge", {
      p_shop_id: getDevShopId(),
      p_id: input.productionOrderId,
      p_actor: actor,
    });
    if (error) throw error;
    const row = data as { production_order_id: string; po_no: string; acknowledged_at: string; jobs_logged: number };
    revalidateProduction(input.productionOrderId);
    revalidatePath("/jobs");
    return {
      ok: true,
      data: { productionOrderId: row.production_order_id, poNo: row.po_no, acknowledgedAt: row.acknowledged_at, jobsLogged: Number(row.jobs_logged) || 0 },
    };
  } catch (err) {
    logRpcFailure("acknowledgeProductionOrder", err);
    // map จาก hint ของ RPC (ไทยล้วน) ก่อน — ข้อความ DB ของ order_not_open มีคำอังกฤษของ status ("สถานะ cancelled แล้ว")
    return { ok: false, error: ackErrorFromHint(errHint(err)) ?? cleanAckError(humanizeProductionError(err, "รับทราบใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง")) };
  }
}

/**
 * ผูก SKU ให้รายการที่ยังไม่มี SKU (ใบ open · SKU active ไม่ใช่ live* · ไม่ซ้ำในใบ · ผูกแล้วแก้ไม่ได้)
 * ไม่ทับโลหะ/เนื้อ/น้ำหนักที่กรอกไว้ · metalMismatch = เตือน (SKU ระบุโลหะชัดแต่ต่างจากรายการ) ไม่บล็อก
 */
export async function bindProductionItemProduct(input: { productionOrderId: string; itemId: string; productId: string }): Promise<ActionResult<ProductionItemBindResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (typeof input !== "object" || input === null || !UUID_RE.test(String(input.itemId ?? ""))) return { ok: false, error: "ไม่พบรายการที่ต้องการ" };
  if (!UUID_RE.test(String(input.productId ?? ""))) return { ok: false, error: "เลือก SKU ไม่ถูกต้อง" };
  const actor = await getActorId();
  if (!actor) return { ok: false, error: "ต้องเข้าสู่ระบบก่อนทำรายการ" };
  try {
    const { data, error } = await getServiceClient().schema(SCHEMA).rpc("production_order_item_bind_product", {
      p_shop_id: getDevShopId(),
      p_item_id: input.itemId,
      p_product_id: input.productId,
      p_actor: actor,
    });
    if (error) throw error;
    const r = data as Record<string, unknown>;
    if (typeof r.item_id !== "string" || typeof r.product_id !== "string" || typeof r.sku !== "string") throw new Error("bind: unexpected shape");
    if (UUID_RE.test(String(input.productionOrderId ?? ""))) revalidateProduction(input.productionOrderId);
    else revalidatePath("/production");
    revalidatePath("/jobs");
    return {
      ok: true,
      data: {
        itemId: r.item_id,
        productId: r.product_id,
        sku: r.sku,
        name: typeof r.name === "string" ? r.name : null,
        pendingLabelBefore: typeof r.pending_product_label_before === "string" ? r.pending_product_label_before : null,
        jobsUpdated: Number(r.jobs_updated) || 0,
        itemMetal: parseProductionMetal(r.item_metal),
        skuMetal: parseProductionMetal(r.sku_metal),
        skuMetalKnown: r.sku_metal_known === true,
        metalMismatch: r.metal_mismatch === true,
        weightFilled: r.weight_filled === true,
      },
    };
  } catch (err) {
    logRpcFailure("bindProductionItemProduct", err);
    return { ok: false, error: orderNotOpenError(errHint(err)) ?? humanizeProductionError(err, "ผูก SKU ไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** แก้ชื่อแบบของรายการที่ยังไม่มี SKU (ก่อนผูก) — ชื่อผ่านด่านเดียวกับตอนเพิ่มรายการ · ไม่แตะชื่อบนใบงาน */
export async function setProductionItemLabel(input: { productionOrderId: string; itemId: string; label: string }): Promise<ActionResult<{ label: string }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (typeof input !== "object" || input === null || !UUID_RE.test(String(input.itemId ?? ""))) return { ok: false, error: "ไม่พบรายการที่ต้องการ" };
  if (typeof input.label !== "string" || input.label.trim() === "") return { ok: false, error: "ต้องระบุชื่อแบบ" };
  const actor = await getActorId();
  if (!actor) return { ok: false, error: "ต้องเข้าสู่ระบบก่อนทำรายการ" };
  try {
    const { data, error } = await getServiceClient().schema(SCHEMA).rpc("production_order_item_label_set", {
      p_shop_id: getDevShopId(),
      p_item_id: input.itemId,
      p_label: input.label,
      p_actor: actor,
    });
    if (error) throw error;
    const r = data as { pending_product_label?: unknown };
    if (typeof r.pending_product_label !== "string") throw new Error("label_set: unexpected shape");
    if (UUID_RE.test(String(input.productionOrderId ?? ""))) revalidateProduction(input.productionOrderId);
    else revalidatePath("/production");
    return { ok: true, data: { label: r.pending_product_label } };
  } catch (err) {
    logRpcFailure("setProductionItemLabel", err);
    return { ok: false, error: orderNotOpenError(errHint(err)) ?? humanizeProductionError(err, "แก้ชื่อแบบไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}
