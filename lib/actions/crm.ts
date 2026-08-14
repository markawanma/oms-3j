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

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { RfmSegment } from "@/lib/crm/segments";
import type { CrmChannelOption, CrmProvinceOption, OrderOverrideInput } from "@/lib/crm/order-override";
import type { CrmMergeCandidateRow, MergeCandidateSide, MergeConfidence } from "@/lib/crm/merge";

const SCHEMA = "analytics";

// PostgREST puts .in() list values straight into the request URL's query
// string — an unbounded id list (e.g. "every customer with an order this
// shop has ever had", 2,653+ and growing with every backfill) blows past the
// ~16K HTTP header limit (HeadersOverflow) well before it's a "big" list in
// application terms. 200 UUIDs (~36 chars incl. commas) is ~8K, comfortably
// under the limit with headroom for the rest of the URL — same chunk size
// already used for dedup-key lookups in lib/actions/import-orders.ts.
const ID_CHUNK_SIZE = 200;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ============================================================================
// B2a write layer (docs/3j-jewelry/analytics/phase-b-crm-design.md §2.1/§2.2/
// §2.3, migration 0021_crm_b2a_write.sql). Every RPC below is SECURITY
// DEFINER and internally calls analytics.crm_require_owner_admin(shop_id) —
// but that check SHORT-CIRCUITS (returns immediately, no-op) when
// auth.role() = 'service_role', which is exactly what getServiceClient()
// authenticates as (see module header above + lib/dev/context.ts). That means
// for this app, until real Supabase Auth ships, the RPC's own owner/admin
// check never actually fires — getDevRole() below is the ONLY thing gating
// writes. Every write action must call it before touching an RPC.
//
// Second, separate gap the RPCs don't cover for us: crm_edit_customer /
// crm_edit_pii / crm_add_note look up shop_id FROM the customer_id argument
// itself (not from the caller's session), and crm_edit_note / crm_delete_note
// look it up from the note_id — so nothing in the RPC stops "staff of shop A"
// from editing/deleting shop B's customer or note just by knowing its uuid
// (IDOR), the same class of gap the read layer above documents for PII. Every
// write action below re-verifies the target row's shop_id === getDevShopId()
// itself, before calling the RPC, for the same reason.

// ============================================================================
// /crm/overview
// ============================================================================

export interface CrmChannelPerfRow {
  /** "YYYY-MM-DD" (first day of month). */
  month: string;
  channelCode: string;
  channelName: string;
  orders: number;
  revenue: number;
  aov: number;
  newCustomers: number;
}

export interface CrmOverviewScope {
  /** Validated, effective lower bound actually applied — null means "no
   * lower bound" (either the caller didn't pass one, or passed a malformed
   * value that got dropped, see getCrmOverview's date validation). */
  requestedFrom: string | null;
  requestedTo: string | null;
  /** Earliest/latest order_date this shop has at all (unfiltered) — used by
   * the UI as the default range and as the date-input min/max bounds. Both
   * null only when the shop has zero fact_order rows. */
  minOrderDate: string | null;
  maxOrderDate: string | null;
}

export interface CrmOverviewData {
  totals: {
    orders: number;
    revenue: number;
    aov: number;
    /** Distinct customers with >=1 order INSIDE the requested range (not
     * all-time) — see getCrmOverview's date-filter note. */
    customers: number;
    /** ESTIMATE ONLY (20% of revenue placeholder, no real COGS yet — design
     * Decision Q3). Every UI surfacing this MUST render the "ประมาณการ 20%"
     * label alongside it; never present it as a fact. */
    profitSumEstimated: number;
  };
  /** Segment breakdown of customers active (>=1 order) in the requested
   * range — but the segment VALUE itself is each customer's current
   * (as-of-today) RFM state from v_rfm_segment, not recomputed for the
   * range (recency is always "days since last order" from now). The UI
   * must render a note clarifying this so it doesn't read as "RFM as of
   * that date range". */
  segmentCounts: Record<RfmSegment, number>;
  channelPerf: CrmChannelPerfRow[];
  scope: CrmOverviewScope;
}

export interface GetCrmOverviewParams {
  /** "YYYY-MM-DD", inclusive. Malformed/invalid values are silently dropped
   * (falls back to "no bound", i.e. all-time on that side) rather than
   * erroring — these come straight from URL searchParams on /crm/overview,
   * so a hand-edited or stale query string must never 500 the page. */
  from?: string | null;
  to?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export async function getCrmOverview(params?: GetCrmOverviewParams): Promise<ActionResult<CrmOverviewData>> {
  let from = params?.from && isValidDateStr(params.from) ? params.from : null;
  let to = params?.to && isValidDateStr(params.to) ? params.to : null;
  // Swap if reversed rather than erroring — same call as tiktok-sales.ts
  // getSalesSummary (a manually-typed <input type=date> pair can arrive
  // backwards; the URL could also be hand-edited).
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [minRes, maxRes, channelsRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_fact_order")
        .select("order_date")
        .eq("shop_id", shopId)
        .order("order_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("v_fact_order")
        .select("order_date")
        .eq("shop_id", shopId)
        .order("order_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // dim_channel is global reference data shared by every shop (no
      // shop_id column) — same as getCrmEditOptions below.
      supabase.schema(SCHEMA).from("dim_channel").select("id, code, name"),
    ]);
    if (minRes.error) throw minRes.error;
    if (maxRes.error) throw maxRes.error;
    if (channelsRes.error) throw channelsRes.error;

    const minOrderDate = (minRes.data as { order_date: string } | null)?.order_date ?? null;
    const maxOrderDate = (maxRes.data as { order_date: string } | null)?.order_date ?? null;

    const channelMap = new Map<string, { code: string; name: string }>();
    for (const c of (channelsRes.data ?? []) as { id: string; code: string; name: string }[]) {
      channelMap.set(c.id, { code: c.code, name: c.name });
    }

    // Business totals + channel breakdown both come from v_fact_order
    // directly (not v_customer_master / v_channel_perf_monthly), same
    // reasoning as before the date filter was added: v_customer_master only
    // aggregates orders WITH a customer_id, so orders that couldn't be
    // attributed to a customer would silently drop from a customer-rooted
    // count. Date-filtering happens here, in the one query, so every widget
    // below stays consistent with each other by construction.
    let factQuery = supabase
      .schema(SCHEMA)
      .from("v_fact_order")
      .select("revenue, profit, customer_id, order_date, channel_id, is_new_customer")
      .eq("shop_id", shopId);
    if (from) factQuery = factQuery.gte("order_date", from);
    if (to) factQuery = factQuery.lte("order_date", to);
    const { data: factData, error: factErr } = await factQuery;
    if (factErr) throw factErr;

    const factRows = (factData ?? []) as {
      revenue: number;
      profit: number | null;
      customer_id: string | null;
      order_date: string;
      channel_id: string;
      is_new_customer: boolean | null;
    }[];

    let totalOrders = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    const customerIds = new Set<string>();
    // "YYYY-MM" -> channel_id -> agg (mirrors what v_channel_perf_monthly
    // used to compute in SQL — is_new_customer is a flag stamped once at
    // import time per order, so filtering the *rows* by date range and then
    // counting the flag is equivalent to the view's per-month aggregate).
    const channelBuckets = new Map<string, Map<string, { orders: number; revenue: number; newCustomers: number }>>();

    for (const r of factRows) {
      totalOrders += 1;
      totalRevenue += Number(r.revenue) || 0;
      totalProfit += Number(r.profit) || 0;
      if (r.customer_id) customerIds.add(r.customer_id);

      const month = r.order_date.slice(0, 7);
      if (!channelBuckets.has(month)) channelBuckets.set(month, new Map());
      const chMap = channelBuckets.get(month)!;
      const cur = chMap.get(r.channel_id) ?? { orders: 0, revenue: 0, newCustomers: 0 };
      cur.orders += 1;
      cur.revenue += Number(r.revenue) || 0;
      if (r.is_new_customer) cur.newCustomers += 1;
      chMap.set(r.channel_id, cur);
    }

    // Segment breakdown: only customers with >=1 order inside the requested
    // range — see CrmOverviewData.segmentCounts doc comment above for the
    // "segment value is still current/as-of-today" caveat the UI must show.
    const segmentCounts: Record<RfmSegment, number> = {
      champion: 0,
      loyal: 0,
      new: 0,
      standard: 0,
      at_risk: 0,
      no_orders: 0,
    };
    const customerIdList = Array.from(customerIds);
    // Chunked (ID_CHUNK_SIZE) — customerIdList scales with the shop's whole
    // customer base (2,653+ after the backfill), which overflows PostgREST's
    // .in() URL as a single request (HeadersOverflow, see ID_CHUNK_SIZE doc).
    for (const chunk of chunkArray(customerIdList, ID_CHUNK_SIZE)) {
      const { data: segmentData, error: segmentErr } = await supabase
        .schema(SCHEMA)
        .from("v_rfm_segment")
        .select("segment")
        .eq("shop_id", shopId)
        .in("customer_id", chunk);
      if (segmentErr) throw segmentErr;
      for (const row of (segmentData ?? []) as { segment: string }[]) {
        const seg = row.segment as RfmSegment;
        if (seg in segmentCounts) segmentCounts[seg] += 1;
      }
    }

    const channelPerf: CrmChannelPerfRow[] = [];
    for (const [month, chMap] of channelBuckets.entries()) {
      for (const [channelId, agg] of chMap.entries()) {
        const ch = channelMap.get(channelId);
        channelPerf.push({
          month: `${month}-01`,
          channelCode: ch?.code ?? "-",
          channelName: ch?.name ?? "ไม่ทราบช่องทาง",
          orders: agg.orders,
          revenue: agg.revenue,
          aov: agg.orders > 0 ? Math.round(agg.revenue / agg.orders) : 0,
          newCustomers: agg.newCustomers,
        });
      }
    }
    // Same order as the old view query: month desc, then channel_code asc.
    channelPerf.sort((a, b) =>
      a.month === b.month ? a.channelCode.localeCompare(b.channelCode) : b.month.localeCompare(a.month)
    );

    return {
      ok: true,
      data: {
        totals: {
          orders: totalOrders,
          revenue: totalRevenue,
          aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
          customers: customerIds.size,
          profitSumEstimated: totalProfit,
        },
        segmentCounts,
        channelPerf,
        scope: {
          requestedFrom: from,
          requestedTo: to,
          minOrderDate,
          maxOrderDate,
        },
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
// /crm/orders — flat, all-orders browse table (design handoff "หน้า
// /crm/orders"). Same v_fact_order source + shop-scoping + date-range
// validation as getCrmOverview above, but every row is returned (no
// aggregation) and customer/channel/province are resolved via batched lookups
// (dim_customer/dim_channel/dim_geo fetched once, mapped in JS) — same
// "no N+1" pattern getCrmCustomerDetail uses for a single customer's orders,
// just applied across the whole shop. 334 rows (design DoD) is well within
// what a single unpaginated fetch + client-side filter can handle, same
// reasoning as CustomersPageClient's header comment.
// ============================================================================

export interface CrmOrderRow {
  id: string;
  sourceOrderNo: string;
  orderDate: string;
  customerId: string | null;
  /** null when the order couldn't be attributed to a customer (unmatched
   * import row) — render as "(ไม่ระบุลูกค้า)", no link. */
  customerName: string | null;
  channelId: string;
  channelCode: string;
  channelName: string;
  revenue: number;
  /** ESTIMATE ONLY (see CrmOverviewData.totals.profitSumEstimated doc above)
   * — profitStatus tells you so, UI must render the "ประมาณการ 20%" label. */
  profit: number | null;
  profitStatus: string;
  provinceCode: string;
  provinceNameTh: string | null;
  itemCount: number | null;
  trackingNo: string | null;
  /** true when analytics.crm_order_override has a row for this order
   * (v_fact_order.is_edited) — "แก้ไขแล้ว" badge, same as
   * CrmCustomerOrderRow.isEdited. */
  isEdited: boolean;
}

export interface GetCrmOrdersParams {
  /** "YYYY-MM-DD", inclusive. Malformed/invalid values are silently dropped
   * (same non-throwing contract as getCrmOverview's date validation — these
   * come straight from URL searchParams on /crm/orders). */
  from?: string | null;
  to?: string | null;
}

export async function getCrmOrders(params?: GetCrmOrdersParams): Promise<ActionResult<CrmOrderRow[]>> {
  let from = params?.from && isValidDateStr(params.from) ? params.from : null;
  let to = params?.to && isValidDateStr(params.to) ? params.to : null;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let factQuery = supabase
      .schema(SCHEMA)
      .from("v_fact_order")
      .select(
        "id, source_order_no, order_date, customer_id, channel_id, revenue, profit, profit_status, province_code, tracking_no, item_count, is_edited"
      )
      .eq("shop_id", shopId)
      .order("order_date", { ascending: false });
    if (from) factQuery = factQuery.gte("order_date", from);
    if (to) factQuery = factQuery.lte("order_date", to);
    const { data: factData, error: factErr } = await factQuery;
    if (factErr) throw factErr;

    const factRows = (factData ?? []) as {
      id: string;
      source_order_no: string;
      order_date: string;
      customer_id: string | null;
      channel_id: string;
      revenue: number;
      profit: number | null;
      profit_status: string;
      province_code: string;
      tracking_no: string | null;
      item_count: number | null;
      is_edited: boolean;
    }[];

    const customerIds = Array.from(
      new Set(factRows.map((r) => r.customer_id).filter((id): id is string => Boolean(id)))
    );

    // Batched lookups, one round-trip each, mapped in JS below — NOT one
    // query per row (that would be 334 extra round-trips for a page that's
    // read on every load). dim_channel/dim_geo are global reference data
    // (no shop_id column, same note as getCrmEditOptions above); dim_customer
    // IS shop-scoped, so it's additionally filtered by shopId as a second
    // tenant-isolation layer beyond "only IDs already in this shop's orders".
    // customerIds scales with every order's customer across the whole shop
    // (334+ rows -> as many distinct customers), same overflow risk as
    // getCrmOverview's segment lookup above — chunked (ID_CHUNK_SIZE) for the
    // same reason, then merged into one customerMap below.
    const [customerChunkResults, channelsRes, geoRes] = await Promise.all([
      Promise.all(
        chunkArray(customerIds, ID_CHUNK_SIZE).map((chunk) =>
          supabase.schema(SCHEMA).from("dim_customer").select("id, display_name").eq("shop_id", shopId).in("id", chunk)
        )
      ),
      supabase.schema(SCHEMA).from("dim_channel").select("id, code, name"),
      supabase.schema(SCHEMA).from("dim_geo").select("province_code, province_name_th"),
    ]);
    for (const res of customerChunkResults) {
      if (res.error) throw res.error;
    }
    if (channelsRes.error) throw channelsRes.error;
    if (geoRes.error) throw geoRes.error;

    const customerMap = new Map<string, string | null>();
    for (const res of customerChunkResults) {
      for (const c of (res.data ?? []) as { id: string; display_name: string | null }[]) {
        customerMap.set(c.id, c.display_name);
      }
    }
    const channelMap = new Map<string, { code: string; name: string }>();
    for (const c of (channelsRes.data ?? []) as { id: string; code: string; name: string }[]) {
      channelMap.set(c.id, { code: c.code, name: c.name });
    }
    const geoMap = new Map<string, string>();
    for (const g of (geoRes.data ?? []) as { province_code: string; province_name_th: string }[]) {
      geoMap.set(g.province_code, g.province_name_th);
    }

    const rows: CrmOrderRow[] = factRows.map((r) => {
      const ch = channelMap.get(r.channel_id);
      return {
        id: r.id,
        sourceOrderNo: r.source_order_no,
        orderDate: r.order_date,
        customerId: r.customer_id,
        customerName: r.customer_id ? customerMap.get(r.customer_id) ?? null : null,
        channelId: r.channel_id,
        channelCode: ch?.code ?? "-",
        channelName: ch?.name ?? "ไม่ทราบช่องทาง",
        revenue: Number(r.revenue) || 0,
        profit: r.profit === null || r.profit === undefined ? null : Number(r.profit),
        profitStatus: r.profit_status,
        provinceCode: r.province_code,
        provinceNameTh: geoMap.get(r.province_code) ?? null,
        itemCount: r.item_count,
        trackingNo: r.tracking_no,
        isEdited: Boolean(r.is_edited),
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmOrders failed", err);
    return { ok: false, error: "โหลดรายการออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id]
// ============================================================================

export interface CrmCustomerOrderRow {
  id: string;
  sourceOrderNo: string;
  orderDate: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  revenue: number;
  discount: number;
  /** ESTIMATE ONLY (see profitSumEstimated above) — profitStatus tells you so. */
  profit: number | null;
  profitStatus: string;
  provinceCode: string;
  bank: string | null;
  itemCount: number | null;
  tags: string[] | null;
  /** true when a row exists in analytics.crm_order_override for this order
   * (v_fact_order.is_edited, migration 0021 §5) — every field above already
   * reflects the override (coalesced in the view), so this is purely a "show
   * the edited badge / offer revert" signal, not a separate raw-vs-edited
   * diff. */
  isEdited: boolean;
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
        .select(
          "id, source_order_no, order_date, channel_id, revenue, discount, profit, profit_status, province_code, bank, item_count, tags, is_edited"
        )
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
        discount: number | null;
        profit: number | null;
        profit_status: string;
        province_code: string;
        bank: string | null;
        item_count: number | null;
        tags: string[] | null;
        is_edited: boolean;
      }[]
    ).map((o) => {
      const ch = channelMap.get(o.channel_id);
      return {
        id: o.id,
        sourceOrderNo: o.source_order_no,
        orderDate: o.order_date,
        channelId: o.channel_id,
        channelCode: ch?.code ?? "-",
        channelName: ch?.name ?? "ไม่ทราบช่องทาง",
        revenue: Number(o.revenue) || 0,
        discount: Number(o.discount) || 0,
        profit: o.profit === null || o.profit === undefined ? null : Number(o.profit),
        profitStatus: o.profit_status,
        provinceCode: o.province_code,
        bank: o.bank,
        itemCount: o.item_count,
        tags: o.tags,
        isEdited: Boolean(o.is_edited),
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
// /crm/customers/[id] — B2a write: edit name
// ============================================================================

/** Confirms `customerId` belongs to the caller's own shop before any RPC
 * touches it — see the IDOR note in the module header above. Returns the
 * ActionResult error to short-circuit with, or `null` if the row checks out. */
async function assertCustomerInShop(
  supabase: ReturnType<typeof getServiceClient>,
  customerId: string,
  shopId: string
): Promise<ActionResult<never> | null> {
  const { data, error } = await supabase
    .schema(SCHEMA)
    .from("dim_customer")
    .select("id")
    .eq("id", customerId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "ไม่พบลูกค้ารายนี้" };
  return null;
}

export async function crmEditCustomerName(customerId: string, displayName: string): Promise<ActionResult> {
  if (!customerId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  const name = displayName.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อลูกค้า" };
  if (name.length > 200) return { ok: false, error: "ชื่อยาวเกินไป (สูงสุด 200 ตัวอักษร)" };

  // note/name edits are open to owner+admin (matches crm_require_owner_admin
  // in migration 0021 — only "staff" is blocked).
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไขได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertCustomerInShop(supabase, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_edit_customer", {
      p_customer_id: customerId,
      p_display_name: name,
    });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmEditCustomerName failed", err);
    return { ok: false, error: "แก้ไขชื่อลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id] — B2a write: edit PII (owner/admin only)
// ============================================================================

export interface CrmEditPiiInput {
  phoneE164: string | null;
  fullName: string | null;
  /** Free-form jsonb — pii_customer.address has no fixed shape anywhere else
   * in the codebase (dim_address, which does, is a separate per-order parsed
   * table). Kept as a single opaque blob rather than inventing a schema. */
  address: unknown | null;
}

export async function crmEditPii(customerId: string, input: CrmEditPiiInput): Promise<ActionResult> {
  if (!customerId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };

  // PII is owner/admin only per design §2.7 — same gate crm_require_owner_admin
  // enforces server-side; getDevRole() has no separate "admin can't touch PII"
  // tier, so this is identical to the name/note gate above.
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไขข้อมูลส่วนบุคคลได้" };
  }

  const phone = input.phoneE164?.trim() || null;
  const fullName = input.fullName?.trim() || null;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertCustomerInShop(supabase, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_edit_pii", {
      p_customer_id: customerId,
      p_phone_e164: phone,
      p_full_name: fullName,
      p_address: input.address ?? null,
    });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmEditPii failed", err);
    return { ok: false, error: "แก้ไขข้อมูลส่วนบุคคลไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id] — B2a write: notes
// ============================================================================

export interface CrmNoteRow {
  id: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** crm_customer_note SELECT policy is "tenant member" (migration 0021 §4),
 * NOT owner/admin-only — unlike PII/audit, any dev role can read notes; only
 * add/edit/delete are gated. */
export async function getCrmCustomerNotes(customerId: string): Promise<ActionResult<CrmNoteRow[]>> {
  if (!customerId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("crm_customer_note")
      .select("id, body, created_by, created_at, updated_at")
      .eq("customer_id", customerId)
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows: CrmNoteRow[] = (
      (data ?? []) as { id: string; body: string; created_by: string | null; created_at: string; updated_at: string }[]
    ).map((n) => ({
      id: n.id,
      body: n.body,
      createdBy: n.created_by,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmCustomerNotes failed", err);
    return { ok: false, error: "โหลดโน้ตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function crmAddNote(customerId: string, body: string): Promise<ActionResult<{ id: string }>> {
  if (!customerId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  const text = body.trim();
  if (!text) return { ok: false, error: "กรุณากรอกข้อความโน้ต" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่เพิ่มโน้ตได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertCustomerInShop(supabase, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { data, error } = await supabase
      .schema(SCHEMA)
      .rpc("crm_add_note", { p_customer_id: customerId, p_body: text });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: { id: data as string } };
  } catch (err) {
    console.error("crmAddNote failed", err);
    return { ok: false, error: "เพิ่มโน้ตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** Confirms `noteId` belongs to the caller's own shop (and, defense in
 * depth, the given customer) before edit/delete — same IDOR concern as
 * assertCustomerInShop above, note_id has no shop_id argument on the RPC. */
async function assertNoteInShop(
  supabase: ReturnType<typeof getServiceClient>,
  noteId: string,
  customerId: string,
  shopId: string
): Promise<ActionResult<never> | null> {
  const { data, error } = await supabase
    .schema(SCHEMA)
    .from("crm_customer_note")
    .select("id")
    .eq("id", noteId)
    .eq("customer_id", customerId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "ไม่พบโน้ตรายการนี้" };
  return null;
}

export async function crmEditNote(noteId: string, customerId: string, body: string): Promise<ActionResult> {
  if (!noteId || !customerId) return { ok: false, error: "ไม่พบรหัสโน้ตหรือลูกค้า" };
  const text = body.trim();
  if (!text) return { ok: false, error: "กรุณากรอกข้อความโน้ต" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้โน้ตได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertNoteInShop(supabase, noteId, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_edit_note", { p_note_id: noteId, p_body: text });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmEditNote failed", err);
    return { ok: false, error: "แก้ไขโน้ตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function crmDeleteNote(noteId: string, customerId: string): Promise<ActionResult> {
  if (!noteId || !customerId) return { ok: false, error: "ไม่พบรหัสโน้ตหรือลูกค้า" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ลบโน้ตได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertNoteInShop(supabase, noteId, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_delete_note", { p_note_id: noteId });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmDeleteNote failed", err);
    return { ok: false, error: "ลบโน้ตไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id] — B2a: audit timeline (owner/admin only)
// ============================================================================

export interface CrmAuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown | null;
  after: unknown | null;
  createdAt: string;
  actor: string | null;
}

/** crm_audit_log SELECT policy is owner/admin-only (migration 0021 §2, may
 * carry PII in before/after e.g. pii_edit) — gated the same way PII reads are
 * gated in getCrmCustomerDetail() above. Scoped to this customer + their notes
 * (order-override rows use a different entity_id, fact_order_id, so they
 * never match here — B2a customer 360 doesn't show order-edit history, that's
 * the next chunk). */
export async function getCrmCustomerAudit(customerId: string): Promise<ActionResult<CrmAuditRow[]>> {
  if (!customerId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูประวัติการแก้ไขได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertCustomerInShop(supabase, customerId, shopId);
    if (tenantErr) return tenantErr;

    const { data: noteRows, error: noteErr } = await supabase
      .schema(SCHEMA)
      .from("crm_customer_note")
      .select("id")
      .eq("customer_id", customerId)
      .eq("shop_id", shopId);
    if (noteErr) throw noteErr;

    const entityIds = [customerId, ...((noteRows ?? []) as { id: string }[]).map((n) => n.id)];

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("crm_audit_log")
      .select("id, action, entity_type, entity_id, before, after, created_at, actor")
      .eq("shop_id", shopId)
      .in("entity_id", entityIds)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows: CrmAuditRow[] = (
      (data ?? []) as {
        id: string;
        action: string;
        entity_type: string;
        entity_id: string | null;
        before: unknown | null;
        after: unknown | null;
        created_at: string;
        actor: string | null;
      }[]
    ).map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      before: a.before,
      after: a.after,
      createdAt: a.created_at,
      actor: a.actor,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmCustomerAudit failed", err);
    return { ok: false, error: "โหลดประวัติการแก้ไขไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /crm/customers/[id] — B2a write: order override (channel/province/revenue/
// discount/order_date/bank/tags). See docs/3j-jewelry/analytics/
// phase-b-crm-design.md §2.1 + migration 0021_crm_b2a_write.sql
// crm_set_order_override / crm_clear_order_override.
// ============================================================================

/** Dropdown options for the order-override form — global reference data
 * (dim_channel / dim_geo have no shop_id column, every shop shares the same
 * channel/province catalog), so unlike every other query in this file this
 * one is intentionally NOT filtered by getDevShopId(). */
export async function getCrmEditOptions(): Promise<
  ActionResult<{ channels: CrmChannelOption[]; provinces: CrmProvinceOption[] }>
> {
  try {
    const supabase = getServiceClient();

    const [channelsRes, provincesRes] = await Promise.all([
      supabase.schema(SCHEMA).from("dim_channel").select("id, code, name").order("name", { ascending: true }),
      supabase
        .schema(SCHEMA)
        .from("dim_geo")
        .select("province_code, province_name_th")
        .order("province_name_th", { ascending: true }),
    ]);
    if (channelsRes.error) throw channelsRes.error;
    if (provincesRes.error) throw provincesRes.error;

    return {
      ok: true,
      data: {
        channels: ((channelsRes.data ?? []) as { id: string; code: string; name: string }[]).map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
        })),
        provinces: (
          (provincesRes.data ?? []) as { province_code: string; province_name_th: string }[]
        ).map((p) => ({ code: p.province_code, nameTh: p.province_name_th })),
      },
    };
  } catch (err) {
    console.error("getCrmEditOptions failed", err);
    return { ok: false, error: "โหลดตัวเลือกแก้ไขออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** Confirms `factOrderId` belongs to the caller's own shop before any RPC
 * touches it — queries analytics.fact_order (the raw table, not the
 * override-aware v_fact_order view) since only its shop_id is trustworthy for
 * a tenant check. Same IDOR concern / pattern as assertCustomerInShop above:
 * crm_set_order_override / crm_clear_order_override look up shop_id from
 * fact_order_id themselves (migration 0021 §7), not from the caller's
 * session, so nothing in the RPC stops "staff of shop A" from editing shop
 * B's order just by knowing its uuid. */
async function assertOrderInShop(
  supabase: ReturnType<typeof getServiceClient>,
  factOrderId: string,
  shopId: string
): Promise<ActionResult<never> | null> {
  const { data, error } = await supabase
    .schema(SCHEMA)
    .from("fact_order")
    .select("id")
    .eq("id", factOrderId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "ไม่พบออเดอร์รายการนี้" };
  return null;
}

export async function crmSetOrderOverride(
  factOrderId: string,
  customerId: string,
  overrides: OrderOverrideInput,
  reason: string
): Promise<ActionResult> {
  if (!factOrderId || !customerId) return { ok: false, error: "ไม่พบรหัสออเดอร์หรือลูกค้า" };

  // Order edits are owner/admin only (matches crm_require_owner_admin in
  // migration 0021 — only "staff" is blocked), same gate as every other
  // write action in this file.
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แก้ไขออเดอร์ได้" };
  }

  // Only forward keys the caller actually set (overrides[key] !== undefined)
  // — crm_set_order_override raises on any key outside its whitelist, and
  // the RPC's upsert REPLACES the whole overrides jsonb blob each call (not
  // a merge), so sending an untouched field here would silently wipe out an
  // override some other edit set on a previous save. The caller (
  // OrderOverrideForm) is responsible for re-sending every field it wants to
  // KEEP overridden, not just the one the user changed this time.
  const payload: Record<string, unknown> = {};
  if (overrides.channel_id !== undefined) payload.channel_id = overrides.channel_id;
  if (overrides.province_code !== undefined) payload.province_code = overrides.province_code;
  if (overrides.revenue !== undefined) payload.revenue = overrides.revenue;
  if (overrides.discount !== undefined) payload.discount = overrides.discount;
  if (overrides.order_date !== undefined) payload.order_date = overrides.order_date;
  if (overrides.bank !== undefined) payload.bank = overrides.bank;
  if (overrides.tags !== undefined) payload.tags = overrides.tags;

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: "ไม่มีข้อมูลที่แก้ไข" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertOrderInShop(supabase, factOrderId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_set_order_override", {
      p_fact_order_id: factOrderId,
      p_overrides: payload,
      p_reason: reason.trim() ? reason.trim() : null,
    });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmSetOrderOverride failed", err);
    return { ok: false, error: "แก้ไขออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function crmClearOrderOverride(factOrderId: string, customerId: string): Promise<ActionResult> {
  if (!factOrderId || !customerId) return { ok: false, error: "ไม่พบรหัสออเดอร์หรือลูกค้า" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่คืนค่าออเดอร์ได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const tenantErr = await assertOrderInShop(supabase, factOrderId, shopId);
    if (tenantErr) return tenantErr;

    const { error } = await supabase.schema(SCHEMA).rpc("crm_clear_order_override", {
      p_fact_order_id: factOrderId,
    });
    if (error) throw error;

    revalidatePath(`/crm/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmClearOrderOverride failed", err);
    return { ok: false, error: "คืนค่าออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
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

// ============================================================================
// /crm/merge — B2b merge-candidate queue (design §3, migration
// analytics.v_merge_candidate + crm_merge_customer / crm_dismiss_merge_candidate
// RPCs). Merge is a destructive, hard-to-undo operation (repoint + soft-delete),
// so — like PII and audit above — it's gated owner/admin only, not just at the
// write RPCs but also at read: staff shouldn't even see the queue.
// ============================================================================

function rowToSide(row: Record<string, unknown>, prefix: "customer_a" | "customer_b"): MergeCandidateSide {
  return {
    customerId: row[`${prefix}_id`] as string,
    name: (row[`${prefix}_name`] as string | null) ?? null,
    identities: (row[`${prefix}_identities`] as string[] | null) ?? [],
    province: (row[`${prefix}_province`] as string | null) ?? null,
    orderCount: Number(row[`${prefix}_order_count`]) || 0,
    revenueSum: Number(row[`${prefix}_revenue_sum`]) || 0,
  };
}

/** Staff never see the merge queue (destructive owner/admin-only action) —
 * returns an empty list rather than an error, same "quietly hide, don't
 * scare with a permission error" pattern used elsewhere for role-gated UI. */
export async function getCrmMergeCandidates(): Promise<ActionResult<CrmMergeCandidateRow[]>> {
  if (getDevRole() === "staff") {
    return { ok: true, data: [] };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_merge_candidate")
      .select(
        "customer_a_id, customer_a_name, customer_a_identities, customer_a_province, customer_a_order_count, customer_a_revenue_sum, customer_b_id, customer_b_name, customer_b_identities, customer_b_province, customer_b_order_count, customer_b_revenue_sum, confidence"
      )
      .eq("shop_id", shopId);
    if (error) throw error;

    const rows: CrmMergeCandidateRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      a: rowToSide(r, "customer_a"),
      b: rowToSide(r, "customer_b"),
      confidence: r.confidence as MergeConfidence,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCrmMergeCandidates failed", err);
    return { ok: false, error: "โหลดรายการลูกค้าซ้ำไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function crmMergeCustomer(survivorId: string, victimId: string): Promise<ActionResult> {
  if (!survivorId || !victimId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  if (survivorId === victimId) return { ok: false, error: "เลือกลูกค้าคนละคนกัน" };

  // Merge is destructive (repoint orders + soft-delete the victim) — owner/
  // admin only, same gate as PII/audit/order-override above. The RPC itself
  // also verifies both customers belong to p_shop_id (tenant guard lives
  // server-side in crm_merge_customer per the handoff note), so p_shop_id
  // MUST come from getDevShopId() here, never from a client-supplied value.
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่รวมลูกค้าได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("crm_merge_customer", {
      p_shop_id: shopId,
      p_survivor_id: survivorId,
      p_victim_id: victimId,
    });
    if (error) throw error;

    revalidatePath("/crm/merge");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmMergeCustomer failed", err);
    return { ok: false, error: "รวมลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function crmDismissMergeCandidate(customerAId: string, customerBId: string): Promise<ActionResult> {
  if (!customerAId || !customerBId) return { ok: false, error: "ไม่พบรหัสลูกค้า" };
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ทำเครื่องหมายได้" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("crm_dismiss_merge_candidate", {
      p_shop_id: shopId,
      p_customer_a: customerAId,
      p_customer_b: customerBId,
    });
    if (error) throw error;

    revalidatePath("/crm/merge");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("crmDismissMergeCandidate failed", err);
    return { ok: false, error: "ทำเครื่องหมายไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
