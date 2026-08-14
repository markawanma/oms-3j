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
