"use server";

// lib/actions/crm.ts — Phase B1 CRM read layer (docs/3j-jewelry/analytics/
// phase-b-crm-design.md §1 B1, §2.4 views). Read-only: no write/edit/merge
// here (that's B2). Follows the exact same service-client + getDevShopId() +
// ActionResult<T> pattern as lib/actions/tiktok-sales.ts / lib/actions/orders.ts
// so it's a drop-in sibling, not a new pattern.
//
// SHOP SCOPING NOTE: every analytics.v_* view queried below carries its own
// `shop_id` column (confirmed against supabase/migrations/0020_crm_b1_views.sql,
// not guessed) — so, exactly like tiktok-sales.ts, every query here filters
// `.eq("shop_id", shopId)` manually. This is load-bearing: getServiceClient()
// uses the Supabase service role, which BYPASSES the views' underlying RLS
// entirely (see lib/supabase/server.ts's header comment) — the manual filter
// is standing in for RLS tenant isolation, not a redundant belt-and-suspenders
// check.
//
// PII NOTE: analytics.pii_customer is queried separately from everything
// else (never joined into a mart, per design §2.7 hard rule: "ห้ามใส่คอลัมน์
// PII ดิบใน view ใดๆ"). In a real deployment RLS on pii_customer restricts it
// to owner/admin; because the service-role client bypasses RLS, that
// restriction is re-implemented at the application layer via getDevRole()
// (lib/dev/context.ts) until real auth ships — see getCrmCustomerDetail()
// below. Flagged prominently for security-auditor review.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { RfmSegment } from "@/lib/crm/segments";

const SCHEMA = "analytics";

// ============================================================================
// /crm/overview
// ============================================================================

export interface CrmChannelPerfRow {
  /** "YYYY-MM-DD" (first day of month, per date_trunc('month', ...)). */
  month: string;
  channelCode: string;
  channelName: string;
  orders: number;
  revenue: number;
  aov: number;
  newCustomers: number;
}

export interface CrmOverviewData {
  totals: {
    orders: number;
    revenue: number;
    aov: number;
    customers: number;
    /** ESTIMATE ONLY (20% of revenue placeholder, no real COGS yet — design
     * Decision Q3). Every UI surfacing this MUST render the "ประมาณการ 20%"
     * label alongside it; never present it as a fact. */
    profitSumEstimated: number;
  };
  segmentCounts: Record<RfmSegment, number>;
  channelPerf: CrmChannelPerfRow[];
}

export async function getCrmOverview(): Promise<ActionResult<CrmOverviewData>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [masterRes, segmentRes, channelRes, factRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_customer_master")
        .select("customer_id")
        .eq("shop_id", shopId),
      supabase.schema(SCHEMA).from("v_rfm_segment").select("segment").eq("shop_id", shopId),
      supabase
        .schema(SCHEMA)
        .from("v_channel_perf_monthly")
        .select("month, channel_code, channel_name, orders, revenue, aov, new_customers")
        .eq("shop_id", shopId)
        .order("month", { ascending: false })
        .order("channel_code", { ascending: true }),
      // Business totals come from fact rows directly, NOT from summing
      // v_customer_master: that view only aggregates orders WITH a customer_id
      // (customer_id is not null), so orders that couldn't be attributed to a
      // customer (no name + masked/no phone) silently drop — making the KPI
      // undercount vs the channel table (which counts every order). Count all
      // orders here so the two agree.
      supabase.schema(SCHEMA).from("v_fact_order").select("revenue, profit").eq("shop_id", shopId),
    ]);
    if (masterRes.error) throw masterRes.error;
    if (segmentRes.error) throw segmentRes.error;
    if (channelRes.error) throw channelRes.error;
    if (factRes.error) throw factRes.error;

    // customers = distinct master customers; totals = all orders (see note above)
    const customerCount = (masterRes.data ?? []).length;

    const factRows = (factRes.data ?? []) as { revenue: number; profit: number | null }[];
    let totalOrders = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    for (const f of factRows) {
      totalOrders += 1;
      totalRevenue += Number(f.revenue) || 0;
      totalProfit += Number(f.profit) || 0;
    }

    const segmentCounts: Record<RfmSegment, number> = {
      champion: 0,
      loyal: 0,
      new: 0,
      standard: 0,
      at_risk: 0,
      no_orders: 0,
    };
    for (const row of (segmentRes.data ?? []) as { segment: string }[]) {
      const seg = row.segment as RfmSegment;
      if (seg in segmentCounts) segmentCounts[seg] += 1;
    }

    const channelPerf: CrmChannelPerfRow[] = (
      (channelRes.data ?? []) as {
        month: string;
        channel_code: string;
        channel_name: string;
        orders: number;
        revenue: number;
        aov: number;
        new_customers: number;
      }[]
    ).map((r) => ({
      month: r.month,
      channelCode: r.channel_code,
      channelName: r.channel_name,
      orders: Number(r.orders) || 0,
      revenue: Number(r.revenue) || 0,
      aov: Number(r.aov) || 0,
      newCustomers: Number(r.new_customers) || 0,
    }));

    return {
      ok: true,
      data: {
        totals: {
          orders: totalOrders,
          revenue: totalRevenue,
          aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
          customers: customerCount,
          profitSumEstimated: totalProfit,
        },
        segmentCounts,
        channelPerf,
      },
    };
  } catch (err) {
    console.error("getCrmOverview failed", err);
    return { ok: false, error: "โหลดข้อมูลภาพรวม CRM ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers
// ============================================================================

export interface CrmCustomerListRow {
  customerId: string;
  displayName: string | null;
  segment: RfmSegment;
  orderCount: number;
  revenueSum: number;
  lastOrderAt: string | null;
}

export async function getCrmCustomers(): Promise<ActionResult<CrmCustomerListRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [masterRes, segmentRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_customer_master")
        .select("customer_id, display_name, order_count, revenue_sum, last_order_at")
        .eq("shop_id", shopId),
      supabase.schema(SCHEMA).from("v_rfm_segment").select("customer_id, segment").eq("shop_id", shopId),
    ]);
    if (masterRes.error) throw masterRes.error;
    if (segmentRes.error) throw segmentRes.error;

    const segmentMap = new Map<string, RfmSegment>();
    for (const row of (segmentRes.data ?? []) as { customer_id: string; segment: string }[]) {
      segmentMap.set(row.customer_id, row.segment as RfmSegment);
    }

    const rows: CrmCustomerListRow[] = (
      (masterRes.data ?? []) as {
        customer_id: string;
        display_name: string | null;
        order_count: number;
        revenue_sum: number;
        last_order_at: string | null;
      }[]
    )
      .map((m) => ({
        customerId: m.customer_id,
        displayName: m.display_name,
        segment: segmentMap.get(m.customer_id) ?? "no_orders",
        orderCount: Number(m.order_count) || 0,
        revenueSum: Number(m.revenue_sum) || 0,
        lastOrderAt: m.last_order_at,
      }))
      // Most-recently-active first; customers with no orders (null last_order_at) sort last.
      .sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? ""));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmCustomers failed", err);
    return { ok: false, error: "โหลดรายชื่อลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id]
// ============================================================================

export interface CrmCustomerOrderRow {
  id: string;
  sourceOrderNo: string;
  orderDate: string;
  channelCode: string;
  channelName: string;
  revenue: number;
  /** ESTIMATE ONLY (see profitSumEstimated above) — profitStatus tells you so. */
  profit: number | null;
  profitStatus: string;
  provinceCode: string;
  itemCount: number | null;
  tags: string[] | null;
}

export interface CrmCustomerIdentityRow {
  identityType: string;
  identityValueNorm: string;
  confidence: string;
}

export interface CrmCustomerPii {
  phoneE164: string | null;
  fullName: string | null;
  address: unknown | null;
}

export interface CrmCustomerDetail {
  customerId: string;
  displayName: string | null;
  firstTouchChannel: string | null;
  segment: RfmSegment;
  recencyDays: number | null;
  orderCount: number;
  revenueSum: number;
  aov: number | null;
  /** ESTIMATE ONLY — see profitSumEstimated doc above. */
  profitSumEstimated: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  identitiesCount: number;
  orders: CrmCustomerOrderRow[];
  identities: CrmCustomerIdentityRow[];
  /** null when the caller's dev role has no PII access (getDevRole() ===
   * "staff") — render every PII field as "—", not an error. This mirrors
   * what real RLS would do for a staff `shop_member` (0 rows, not a 403). */
  pii: CrmCustomerPii | null;
}

export async function getCrmCustomerDetail(customerId: string): Promise<ActionResult<CrmCustomerDetail>> {
  if (!customerId || typeof customerId !== "string") {
    return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  }
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Tenant check FIRST, before any other query: the service-role client
    // bypasses RLS (see module header), so this manual shop_id match is the
    // only thing standing between "staff of shop A" and "shop B's customer
    // 360 by guessing/enumerating a customer_id" (IDOR). Every query below
    // additionally re-checks shop_id itself (defense in depth, cheap given
    // each table/view already carries the column).
    const { data: master, error: masterErr } = await supabase
      .schema(SCHEMA)
      .from("v_customer_master")
      .select(
        "customer_id, shop_id, display_name, first_touch_channel_id, order_count, revenue_sum, profit_sum, first_order_at, last_order_at, identities_count"
      )
      .eq("customer_id", customerId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (masterErr) throw masterErr;
    if (!master) return { ok: false, error: "ไม่พบลูกค้ารายนี้" };

    const wantsPii = getDevRole() !== "staff";

    const [segmentRes, ltvRes, ordersRes, identitiesRes, channelsRes, piiRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_rfm_segment")
        .select("segment, recency_days")
        .eq("customer_id", customerId)
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("v_customer_ltv")
        .select("aov, first_touch_channel")
        .eq("customer_id", customerId)
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("v_fact_order")
        .select("id, source_order_no, order_date, channel_id, revenue, profit, profit_status, province_code, item_count, tags")
        .eq("customer_id", customerId)
        .eq("shop_id", shopId)
        .order("order_date", { ascending: false }),
      // identity_value_norm is the RAW contact value (phone E164 / email /
      // line_id per dim_customer_identity.identity_type), i.e. the same PII
      // tier as pii_customer — NOT a hash. It must sit behind the same role
      // gate, otherwise staff read customers' real phone numbers here even
      // though the pii_customer card above is correctly hidden from them.
      // Non-owner gets []; the non-PII count still shows via
      // v_customer_master.identities_count.
      wantsPii
        ? supabase
            .schema(SCHEMA)
            .from("dim_customer_identity")
            .select("identity_type, identity_value_norm, confidence")
            .eq("customer_id", customerId)
            .eq("shop_id", shopId)
        : Promise.resolve({ data: [], error: null } as const),
      supabase.schema(SCHEMA).from("dim_channel").select("id, code, name"),
      // PII: application-level gate (see module header) — see getDevRole()
      // doc comment for why this can't just rely on RLS today.
      wantsPii
        ? supabase
            .schema(SCHEMA)
            .from("pii_customer")
            .select("phone_e164, full_name, address")
            .eq("customer_id", customerId)
            .eq("shop_id", shopId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
    ]);

    if (segmentRes.error) throw segmentRes.error;
    if (ltvRes.error) throw ltvRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (identitiesRes.error) throw identitiesRes.error;
    if (channelsRes.error) throw channelsRes.error;
    if (piiRes.error) throw piiRes.error;

    const channelMap = new Map<string, { code: string; name: string }>();
    for (const c of (channelsRes.data ?? []) as { id: string; code: string; name: string }[]) {
      channelMap.set(c.id, { code: c.code, name: c.name });
    }

    const orders: CrmCustomerOrderRow[] = (
      (ordersRes.data ?? []) as {
        id: string;
        source_order_no: string;
        order_date: string;
        channel_id: string;
        revenue: number;
        profit: number | null;
        profit_status: string;
        province_code: string;
        item_count: number | null;
        tags: string[] | null;
      }[]
    ).map((o) => {
      const ch = channelMap.get(o.channel_id);
      return {
        id: o.id,
        sourceOrderNo: o.source_order_no,
        orderDate: o.order_date,
        channelCode: ch?.code ?? "-",
        channelName: ch?.name ?? "ไม่ทราบช่องทาง",
        revenue: Number(o.revenue) || 0,
        profit: o.profit === null || o.profit === undefined ? null : Number(o.profit),
        profitStatus: o.profit_status,
        provinceCode: o.province_code,
        itemCount: o.item_count,
        tags: o.tags,
      };
    });

    const firstTouchById = master.first_touch_channel_id
      ? channelMap.get(master.first_touch_channel_id as string)?.code ?? null
      : null;

    const ltv = ltvRes.data as { aov: number | null; first_touch_channel: string | null } | null;
    const segment = segmentRes.data as { segment: string; recency_days: number | null } | null;
    const pii = piiRes.data as { phone_e164: string | null; full_name: string | null; address: unknown } | null;

    return {
      ok: true,
      data: {
        customerId: master.customer_id as string,
        displayName: master.display_name as string | null,
        firstTouchChannel: ltv?.first_touch_channel ?? firstTouchById,
        segment: (segment?.segment as RfmSegment) ?? "no_orders",
        recencyDays: segment?.recency_days ?? null,
        orderCount: Number(master.order_count) || 0,
        revenueSum: Number(master.revenue_sum) || 0,
        aov: ltv?.aov ?? null,
        profitSumEstimated: Number(master.profit_sum) || 0,
        firstOrderAt: master.first_order_at as string | null,
        lastOrderAt: master.last_order_at as string | null,
        identitiesCount: Number(master.identities_count) || 0,
        orders,
        identities: (
          (identitiesRes.data ?? []) as { identity_type: string; identity_value_norm: string; confidence: string }[]
        ).map((i) => ({
          identityType: i.identity_type,
          identityValueNorm: i.identity_value_norm,
          confidence: i.confidence,
        })),
        pii: pii ? { phoneE164: pii.phone_e164, fullName: pii.full_name, address: pii.address } : null,
      },
    };
  } catch (err) {
    console.error("getCrmCustomerDetail failed", err);
    return { ok: false, error: "โหลดข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/import-errors
// ============================================================================

export interface CrmImportErrorRow {
  batchId: string;
  fileName: string | null;
  importedAt: string;
  errorCode: string;
  errorCount: number;
}

export async function getCrmImportErrors(): Promise<ActionResult<CrmImportErrorRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_import_error_summary")
      .select("batch_id, file_name, imported_at, error_code, error_count")
      .eq("shop_id", shopId)
      .order("imported_at", { ascending: false });
    if (error) throw error;

    const rows: CrmImportErrorRow[] = (
      (data ?? []) as {
        batch_id: string;
        file_name: string | null;
        imported_at: string;
        error_code: string;
        error_count: number;
      }[]
    ).map((r) => ({
      batchId: r.batch_id,
      fileName: r.file_name,
      // imported_at is timestamptz; formatThaiDateOnly expects a date-only
      // string ("YYYY-MM-DD"), so slice here (a full timestamp makes it Invalid
      // Date → "-", and this is the key column of the import-errors page).
      importedAt: String(r.imported_at).slice(0, 10),
      errorCode: r.error_code,
      errorCount: Number(r.error_count) || 0,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmImportErrors failed", err);
    return { ok: false, error: "โหลดข้อมูล import error ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
