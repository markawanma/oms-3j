// lib/tiktok/copilot-storage.ts — Ad Copilot approve/dismiss state lives in
// the browser only (design §5: "localStorage, ไม่แตะ DB, schema ควรเกิดพร้อม
// analytics DB"). This is deliberately NOT wired into fixtures.ts/mock-actions.ts
// — getCopilotRecommendations() always returns the fixture's baseline
// "pending" set; the UI layer (CopilotPageClient) merges these overrides on
// top at render time. Swapping to a real backend later means: (a) approve/
// dismiss becomes a server action instead of this module, (b) the merge step
// in CopilotPageClient goes away — no other component changes.

export interface CopilotDecision {
  status: "approved" | "dismissed";
  /** ISO timestamp (local device clock — this is client-only state, no server round-trip). */
  decidedAt: string;
  /** Optional dismiss reason (design §5: "เก็บไว้ปรับ AI ภายหลัง ไม่ใช่บังคับกรอก"). */
  dismissReason?: string | null;
}

export type CopilotDecisionsMap = Record<string, CopilotDecision>;

const STORAGE_KEY = "tiktok-ops:copilot-decisions:v1";

export function loadCopilotDecisions(): CopilotDecisionsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CopilotDecisionsMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt JSON / storage disabled — behave as if nothing was decided yet
    // rather than throwing and blanking the whole Copilot page.
    return {};
  }
}

export function saveCopilotDecision(id: string, decision: CopilotDecision): void {
  if (typeof window === "undefined") return;
  const current = loadCopilotDecisions();
  const next: CopilotDecisionsMap = { ...current, [id]: decision };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / private-mode block — decision still reflects in
    // React state for this session via the caller's setState, it just won't
    // survive a reload. Acceptable for a 1-2 person mock-data tool.
  }
}
