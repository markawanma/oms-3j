// lib/dashboard/types.ts — Home/Dashboard (docs/3j-jewelry/design/ui-refresh-
// plan.md §1), backed by analytics.dashboard_summary (0039). All numbers come
// pre-aggregated from that one RPC. `kpi`/`reco`/`rfm`/`topChannel` are null/
// empty for staff (money hidden) — only `action` is always present.

export type DashboardPeriod = "today" | "7d" | "month";

export const DASHBOARD_PERIODS: DashboardPeriod[] = ["today", "7d", "month"];

export const DASHBOARD_PERIOD_LABEL_TH: Record<DashboardPeriod, string> = {
  today: "วันนี้",
  "7d": "7 วัน",
  month: "เดือนนี้",
};

export function toDashboardPeriod(v: string | undefined): DashboardPeriod {
  return v === "today" || v === "7d" || v === "month" ? v : "month";
}

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

export interface DashboardData {
  period: DashboardPeriod;
  /** null when the viewer is staff (money hidden). */
  kpi: DashboardKpi | null;
  action: DashboardAction;
  reco: DashboardReco[];
  /** RFM segment → customer count (e.g. { champion: 6, loyal: 55, new: 177 }). */
  rfm: Record<string, number>;
  topChannel: DashboardTopChannel | null;
}

// ============================================================================
// Dashboard charts — analytics.dashboard_charts (0044), see
// docs/3j-jewelry/analytics/phase-dashboard-charts-design.md §1b/§5.
// Money-bearing sections (topSku/productMix/aovByChannel, and
// salesTrend/weekday's revenue|aov fields) come back null/[] for staff — same
// SQL-level money gate as DashboardData.kpi, never a UI-only hide.
// ============================================================================

/** One day of the fixed 30-day sales trend. revenue/aov are null for staff. */
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

/** One weekday (dow 0=Sun..6=Sat) of the all-time weekday pattern. revenue is null for staff. */
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

export interface DashboardCharts {
  period: DashboardPeriod;
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
}
