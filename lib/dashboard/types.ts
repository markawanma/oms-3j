// lib/dashboard/types.ts — Home/Dashboard (docs/3j-jewelry/design/ui-refresh-
// plan.md §1), backed by analytics.dashboard_summary. All numbers come
// pre-aggregated from that one RPC. `kpi`/`reco`/`rfm`/`topChannel` are null/
// empty for staff (money hidden) — only `action`/`scope` are always present.
//
// 0054: the period toggle (วันนี้/7วัน/เดือนนี้) was replaced by a real
// date-range + channel filter (matching /crm/overview) — DashboardPeriod is
// gone from this file; the filter's current from/to/channel now lives in
// DashboardScope below.

export interface DashboardKpi {
  revenue: number;
  orders: number;
  profit: number;
  aov: number;
  customers: number;
  /** 0..1 — share of customers-in-period who are lifetime repeat buyers (>=2 orders ever). */
  repeatRate: number;
}

export interface DashboardAction {
  oversold: number;
  oversoldBreached: number;
  lowStock: number;
}

export interface DashboardReco {
  title: string;
  severity: string;
  ruleCode: string;
}

export interface DashboardTopChannel {
  channelName: string;
  revenue: number;
  roas: number | null;
}

/** Filter-UI scope for /dashboard (0054) — mirrors CrmOverviewScope's shape
 * (lib/actions/crm.ts) so the date-range + channel filter behaves the same
 * across /dashboard and /crm/overview: min/max are ALL-TIME (unscoped), so
 * date-input bounds and channel chips never move/disappear just because the
 * currently-selected window has no orders. */
export interface DashboardScope {
  minOrderDate: string | null;
  maxOrderDate: string | null;
  channels: { code: string; name: string }[];
  /** Validated/effective values actually applied by the RPC — null means
   * "no bound" / "every channel" (either not passed, or dropped by
   * getDashboard's own validation before ever reaching the RPC). */
  requestedFrom: string | null;
  requestedTo: string | null;
  requestedChannel: string | null;
}

export interface DashboardData {
  /** null when the viewer is staff (money hidden). */
  kpi: DashboardKpi | null;
  action: DashboardAction;
  reco: DashboardReco[];
  /** RFM segment → customer count (e.g. { champion: 6, loyal: 55, new: 177 }). */
  rfm: Record<string, number>;
  topChannel: DashboardTopChannel | null;
  scope: DashboardScope;
}

// ============================================================================
// Dashboard charts — analytics.dashboard_charts (0044), see
// docs/3j-jewelry/analytics/phase-dashboard-charts-design.md §1b/§5.
// Money-bearing sections (topSku/productMix/aovByChannel, and
// salesTrend/weekday's revenue|aov fields) come back null/[] for staff — same
// SQL-level money gate as DashboardData.kpi, never a UI-only hide.
// ============================================================================

/** One day of the sales trend, zero-filled across the selected [from,to] range (0054 — was a fixed 30-day window pre-0054). revenue/aov are null for staff. */
export interface TrendPoint {
  date: string;
  revenue: number | null;
  orders: number;
  aov: number | null;
}

/** Generic horizontal-bar row — used by both Top SKU and AOV-by-channel. */
export interface HBarRow {
  label: string;
  value: number;
  displayValue: string;
  sub?: string;
}

/** Product-mix donut slice. `bucket` is the raw key (for color lookup), `label` is Thai display text. */
export interface MixSlice {
  bucket: string;
  label: string;
  revenue: number;
  pct: number;
}

/** New-vs-returning customer counts for the period. Always present, even for staff (no money). */
export interface NewReturning {
  new: number;
  returning: number;
  unknown: number;
}

/** One weekday (dow 0=Sun..6=Sat) of the weekday pattern, scoped to the selected [from,to]+channel filter (0052 introduced date-scoping under the old period toggle; 0054 carried it forward to range+channel). revenue is null for staff. */
export interface WeekdayPoint {
  dow: number;
  label: string;
  orders: number;
  revenue: number | null;
}

/** Line-item coverage note — how much of the period's orders have line items (Top SKU/Product Mix accuracy). */
export interface ChartCoverage {
  ordersTotal: number;
  ordersWithItems: number;
  itemsPct: number;
  /** Global line-item data-availability window ("YYYY-MM-DD"), null until any line item is imported. Formatted for display on the client. */
  rangeFrom: string | null;
  rangeTo: string | null;
}

/** Donut-chart slice — sales by channel (0054). Scoped to [from,to] ONLY,
 * NOT the channel filter (always shows every channel so it stays useful as
 * a comparison even while one channel is selected). [] for staff. */
export interface SalesByChannel {
  channelCode: string;
  channelName: string;
  revenue: number;
  orders: number;
  sharePct: number;
}

export interface DashboardCharts {
  coverage: ChartCoverage;
  /** [] for staff */
  topSku: HBarRow[];
  /** [] for staff */
  productMix: MixSlice[];
  /** [] for staff */
  aovByChannel: HBarRow[];
  newReturning: NewReturning;
  salesTrend: TrendPoint[];
  weekday: WeekdayPoint[];
  /** [] for staff */
  salesByChannel: SalesByChannel[];
}
