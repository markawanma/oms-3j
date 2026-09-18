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

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import type {
  DoneItemInput,
  ProductionCostType,
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
} from "@/lib/production/types";
import { humanizeProductionError, PRODUCTION_SPOT_OVERRIDE_MAX, PRODUCTION_SPOT_OVERRIDE_MIN } from "@/lib/production/types";
import { fetchAllRows } from "@/lib/supabase/query-limits";

const SCHEMA = "analytics";

/** กัน 22P02 จาก Postgres ก่อนถึง DB — ข้อความ error ของ 22P02 เผย uuid ดิบ
 * และไม่ได้ติด errcode 22023 จึงจะตกเป็นข้อความกลางที่ผู้ใช้เดาสาเหตุไม่ออก */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานใบผลิตเข้าสต็อกได้" };
  }
  return null;
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
          "id, po_no, status, note, spot_override_thb_per_gram, done_at, cancelled_at, cancel_reason, created_at, updated_at, item_count, qty_planned_total, qty_done_total",
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
          "id, po_no, status, note, spot_override_thb_per_gram, done_at, cancelled_at, cancel_reason, created_at, updated_at, item_count, qty_planned_total, qty_done_total"
        )
        .eq("id", id)
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("v_production_order_item")
        .select(
          "id, production_order_id, po_no, order_status, product_id, sku, product_name, current_cost_type, current_unit_cost, qty_planned, qty_done, stamped_unit_cost, prev_cost_type, prev_unit_cost, created_at, updated_at"
        )
        .eq("production_order_id", id)
        .eq("shop_id", shopId)
        .order("created_at", { ascending: true }),
    ]);
    if (orderRes.error) throw orderRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (!orderRes.data) return { ok: false, error: "ไม่พบใบผลิตนี้ในร้านนี้" };

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
    };

    const items: ProductionOrderItemRow[] = (
      (itemsRes.data ?? []) as {
        id: string;
        production_order_id: string;
        po_no: string;
        order_status: ProductionOrderStatus;
        product_id: string;
        sku: string;
        product_name: string;
        current_cost_type: ProductionCostType;
        current_unit_cost: number | null;
        qty_planned: number;
        qty_done: number | null;
        stamped_unit_cost: number | null;
        prev_cost_type: ProductionCostType | null;
        prev_unit_cost: number | null;
        created_at: string;
        updated_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      productionOrderId: r.production_order_id,
      poNo: r.po_no,
      orderStatus: r.order_status,
      productId: r.product_id,
      sku: r.sku,
      productName: r.product_name,
      currentCostType: r.current_cost_type,
      currentUnitCost: r.current_unit_cost == null ? null : Number(r.current_unit_cost),
      qtyPlanned: Number(r.qty_planned) || 0,
      qtyDone: r.qty_done == null ? null : Number(r.qty_done),
      stampedUnitCost: r.stamped_unit_cost == null ? null : Number(r.stamped_unit_cost),
      prevCostType: r.prev_cost_type,
      prevUnitCost: r.prev_unit_cost == null ? null : Number(r.prev_unit_cost),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

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

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_save", {
      p_shop_id: shopId,
      p_id: input.id ?? null,
      p_note: input.note ?? null,
      p_spot_override_thb_per_gram: input.spotOverrideThbPerGram ?? null,
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

export async function setProductionOrderItem(input: {
  productionOrderId: string;
  productId: string;
  qtyPlanned: number;
}): Promise<ActionResult<ProductionOrderItemSetResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.productionOrderId || !input.productId) return { ok: false, error: "กรุณาเลือก SKU" };
  if (!Number.isFinite(input.qtyPlanned) || !Number.isInteger(input.qtyPlanned) || input.qtyPlanned <= 0 || input.qtyPlanned > 100000) {
    return { ok: false, error: "จำนวนที่วางแผนผลิตต้องเป็นจำนวนเต็ม 1-100000" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_item_set", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_product_id: input.productId,
      p_qty_planned: input.qtyPlanned,
    });
    if (error) throw error;

    const row = data as { id: string; product_id: string; sku: string; name: string; qty_planned: number };

    revalidateProduction(input.productionOrderId);

    return {
      ok: true,
      data: { id: row.id, productId: row.product_id, sku: row.sku, name: row.name, qtyPlanned: Number(row.qty_planned) || 0 },
    };
  } catch (err) {
    console.error("setProductionOrderItem failed", err);
    return { ok: false, error: humanizeProductionError(err, "เพิ่ม/แก้รายการไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

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
 * live on ProductionOrderItemRow (stampedUnitCost/prevUnitCost) instead. */
export async function previewProductionOrder(productionOrderId: string): Promise<ActionResult<ProductionOrderPreview>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_preview", {
      p_shop_id: shopId,
      p_production_order_id: productionOrderId,
    });
    if (error) throw error;

    const row = data as {
      production_order_id: string;
      po_no: string;
      spot_price_thb_per_gram: number | null;
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
        unit_cost: number;
        qty_planned: number;
      }[];
    };

    return {
      ok: true,
      data: {
        productionOrderId: row.production_order_id,
        poNo: row.po_no,
        spotPriceThbPerGram: row.spot_price_thb_per_gram == null ? null : Number(row.spot_price_thb_per_gram),
        items: (row.items ?? []).map((it) => ({
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
          unitCost: Number(it.unit_cost),
          qtyPlanned: Number(it.qty_planned) || 0,
        })),
      },
    };
  } catch (err) {
    console.error("previewProductionOrder failed", err);
    return { ok: false, error: humanizeProductionError(err, "คำนวณตัวอย่างต้นทุนไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

export async function doneProductionOrder(input: {
  productionOrderId: string;
  items: DoneItemInput[];
}): Promise<ActionResult<ProductionOrderDoneResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!input.productionOrderId) return { ok: false, error: "ไม่พบใบผลิตที่ต้องการ" };

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
  const seenProductIds = new Set<string>();
  for (const it of input.items) {
    if (!it.productId || !UUID_RE.test(it.productId)) {
      return { ok: false, error: "ไม่พบ SKU ในรายการที่จะบันทึก" };
    }
    if (seenProductIds.has(it.productId)) {
      return { ok: false, error: "มี SKU ซ้ำในรายการ — ปิดหน้าต่างแล้วเปิดใหม่อีกครั้ง" };
    }
    seenProductIds.add(it.productId);
    if (!Number.isFinite(it.qtyDone) || !Number.isInteger(it.qtyDone) || it.qtyDone < 0 || it.qtyDone > 100000) {
      return { ok: false, error: "จำนวนที่ผลิตได้จริงต้องเป็นจำนวนเต็ม 0-100000" };
    }
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("production_order_done", {
      p_shop_id: shopId,
      p_production_order_id: input.productionOrderId,
      p_items: input.items.map((it) => ({ product_id: it.productId, qty_done: it.qtyDone })),
    });
    if (error) throw error;

    const row = data as {
      production_order_id: string;
      po_no: string;
      status: ProductionOrderStatus;
      already_done: boolean;
      items: { product_id: string; sku: string; qty_done: number | null; unit_cost: number | null; prev_cost_type: ProductionCostType | null; prev_unit_cost: number | null }[];
    };

    revalidateProduction(input.productionOrderId);
    // 0131 stamps cost + track_stock straight onto public.product — the SKU
    // catalog screen must reflect the new locked-in cost immediately too.
    revalidatePath("/catalog");
    revalidatePath("/stock");

    return {
      ok: true,
      data: {
        productionOrderId: row.production_order_id,
        poNo: row.po_no,
        status: row.status,
        alreadyDone: Boolean(row.already_done),
        items: (row.items ?? []).map((it) => ({
          productId: it.product_id,
          sku: it.sku,
          qtyDone: it.qty_done == null ? null : Number(it.qty_done),
          unitCost: it.unit_cost == null ? null : Number(it.unit_cost),
          prevCostType: it.prev_cost_type,
          prevUnitCost: it.prev_unit_cost == null ? null : Number(it.prev_unit_cost),
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
