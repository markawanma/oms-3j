// lib/tiktok/mock-actions.ts — MOCK — รอ analytics DB
//
// Same call shape as a real server action (`Promise<ActionResult<T>>`) so
// the Dashboard/Copilot pages can `await` these exactly like
// lib/actions/tiktok-sales.ts's getSalesSummary() — swapping to real data
// later means replacing this file's body only, no UI change (design §5).
//
// Not marked "use server" on purpose: these are plain async functions (no DB
// call, no server-only secret), safe to import from either a server or
// client component. Real server actions get "use server" once they land.

import type { ActionResult } from "@/lib/types";
import type { CopilotRecommendation, DailyDashboardData } from "@/lib/tiktok/types";
import { MOCK_COPILOT_RECOMMENDATIONS, MOCK_DASHBOARD_DATA } from "@/lib/tiktok/fixtures";

export async function getDailyDashboard(): Promise<ActionResult<DailyDashboardData>> {
  // MOCK — รอ analytics DB. Real version will accept a date/filter param
  // (per design's dashboard filter chips) and query orders + a future
  // cost/address enrichment table.
  return { ok: true, data: MOCK_DASHBOARD_DATA };
}

export async function getCopilotRecommendations(): Promise<ActionResult<CopilotRecommendation[]>> {
  // MOCK — รอ analytics DB + LLM engine. Approve/dismiss state lives in
  // localStorage client-side (design §5) — this always returns the fixture's
  // baseline "pending" set; the UI layer merges in localStorage overrides.
  return { ok: true, data: MOCK_COPILOT_RECOMMENDATIONS };
}
