// lib/marketing/content-kpi.test.ts
//
// Unit tests for the ONE piece of this feature that decides anything —
// content-kpi-screen-design.md §9.1 calls this out explicitly as "ชิ้นใหม่ที่
// ต้อง unit test ครบ เป็น business logic เดียวที่ 'ตัดสิน' อะไรในฟีเจอร์นี้".
// Pure in-memory tests, no DB, no mocks needed — same style as
// content-types.test.ts.
//
// Coverage required by the Tech Lead brief (27 ก.ย. 69):
//   - every one of §4's 6 states
//   - the "real data today" scenario (4 clips total ⇒ always
//     insufficient_global) gets its own dedicated test
//   - HIGH_SIGNAL_MARGIN's exact-boundary behavior (1.2x exactly = high,
//     anything under = low)
//   - a manual mutation test (HIGH_SIGNAL_MARGIN temporarily edited to 1.0,
//     tests re-run, reverted) — done by hand, NOT encoded as an automated
//     test here (there is no automated way to edit a module-level `const`
//     from inside a test); results reported separately alongside this file.

import { daysBetween } from "./format";
import { describe, expect, it } from "vitest";
import {
  HIGH_SIGNAL_MARGIN,
  MIN_FORMAT_CLIPS,
  MIN_GLOBAL_CLIPS,
  T7_REASON_MISSED,
  T7_REASON_PENDING_ENTRY,
  T7_REASON_WAITING,
  addDaysToDateStr,
  classifyMetricLevel,
  computeConfidenceBadge,
  computeMean,
  computeMedian,
  determineContentKpiState,
  pickFormatSuggestion,
  pickSingleClipSuggestion,
  type ClipT7Metrics,
  type DetermineKpiStateInput,
} from "./content-kpi";

// ============================================================================
// computeMedian / computeMean
// ============================================================================

describe("computeMedian", () => {
  it("odd-length array — middle value after sort", () => {
    expect(computeMedian([3, 1, 2])).toBe(2);
  });

  it("even-length array — average of the two middle values", () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it("single value", () => {
    expect(computeMedian([42])).toBe(42);
  });

  it("empty array -> null, not 0 or NaN", () => {
    expect(computeMedian([])).toBeNull();
  });

  it("does not mutate the input array (sorts a copy)", () => {
    const input = [5, 1, 3];
    computeMedian(input);
    expect(input).toEqual([5, 1, 3]);
  });
});

describe("computeMean", () => {
  it("basic average", () => {
    expect(computeMean([1, 2, 3])).toBe(2);
  });

  it("empty array -> null", () => {
    expect(computeMean([])).toBeNull();
  });

  it("single value -> itself", () => {
    expect(computeMean([7])).toBe(7);
  });
});

// ============================================================================
// daysBetween / addDaysToDateStr
// ============================================================================

describe("daysBetween (ใช้ format.ts ตัวเดียว)", () => {
  it("positive when `to` is later", () => {
    expect(daysBetween("2026-09-25", "2026-09-28")).toBe(3);
  });

  it("negative when `to` is earlier", () => {
    expect(daysBetween("2026-09-28", "2026-09-25")).toBe(-3);
  });

  it("zero for the same date", () => {
    expect(daysBetween("2026-09-28", "2026-09-28")).toBe(0);
  });
});

describe("addDaysToDateStr", () => {
  it("adds positive days, crossing a month boundary", () => {
    expect(addDaysToDateStr("2026-09-25", 7)).toBe("2026-10-02");
  });

  it("subtracts with a negative offset, crossing a month boundary", () => {
    expect(addDaysToDateStr("2026-09-28", -28)).toBe("2026-08-31");
  });

  it("zero offset returns the same date", () => {
    expect(addDaysToDateStr("2026-09-28", 0)).toBe("2026-09-28");
  });
});

// ============================================================================
// classifyMetricLevel — HIGH_SIGNAL_MARGIN boundary (owner-confirmed 1.2×)
// ============================================================================

describe("classifyMetricLevel — 1.2x margin, inclusive at the boundary", () => {
  it("HIGH_SIGNAL_MARGIN is exactly 1.2 (the owner-confirmed value, 28 ก.ย. 69)", () => {
    expect(HIGH_SIGNAL_MARGIN).toBe(1.2);
  });

  it("value exactly 1.2x the median -> high", () => {
    expect(classifyMetricLevel(120, 100)).toBe("high");
  });

  it("value just under 1.2x the median -> low, even by a hair", () => {
    expect(classifyMetricLevel(119.99, 100)).toBe("low");
  });

  it("value well above the margin -> high", () => {
    expect(classifyMetricLevel(500, 100)).toBe("high");
  });

  it("value well below the margin -> low", () => {
    expect(classifyMetricLevel(50, 100)).toBe("low");
  });

  it("value exactly at the median (not the margin) -> low, margin is strictly required", () => {
    expect(classifyMetricLevel(100, 100)).toBe("low");
  });

  it("documented edge case: median=0 -> threshold is 0 -> any non-negative value is high", () => {
    expect(classifyMetricLevel(0, 0)).toBe("high");
    expect(classifyMetricLevel(5, 0)).toBe("high");
  });
});

// ============================================================================
// pickSingleClipSuggestion — rows 1/2 of content-kpi-definition.md §5
// ============================================================================

describe("pickSingleClipSuggestion — only the two CONTRADICTORY quadrants get a suggestion", () => {
  it("view=high + save=low -> 'stop' (row 1: เลิก format นี้)", () => {
    const result = pickSingleClipSuggestion({ viewLevel: "high", saveLevel: "low" });
    expect(result).toEqual({ kind: "stop", text: expect.stringContaining("เลิก format นี้") });
  });

  it("view=low + save=high -> 'repeat' (row 2: ทำซ้ำ)", () => {
    const result = pickSingleClipSuggestion({ viewLevel: "low", saveLevel: "high" });
    expect(result).toEqual({ kind: "repeat", text: expect.stringContaining("ทำซ้ำสัปดาห์ละ") });
  });

  it("§4.8: view=high + save=high (same direction) -> no suggestion, must not invent one", () => {
    expect(pickSingleClipSuggestion({ viewLevel: "high", saveLevel: "high" })).toBeNull();
  });

  it("§4.8: view=low + save=low (same direction) -> no suggestion", () => {
    expect(pickSingleClipSuggestion({ viewLevel: "low", saveLevel: "low" })).toBeNull();
  });

  it("viewLevel unknown (null) -> no suggestion, regardless of saveLevel", () => {
    expect(pickSingleClipSuggestion({ viewLevel: null, saveLevel: "high" })).toBeNull();
    expect(pickSingleClipSuggestion({ viewLevel: null, saveLevel: "low" })).toBeNull();
  });

  it("saveLevel unknown (null) -> no suggestion, regardless of viewLevel", () => {
    expect(pickSingleClipSuggestion({ viewLevel: "high", saveLevel: null })).toBeNull();
    expect(pickSingleClipSuggestion({ viewLevel: "low", saveLevel: null })).toBeNull();
  });

  it("both unknown -> no suggestion", () => {
    expect(pickSingleClipSuggestion({ viewLevel: null, saveLevel: null })).toBeNull();
  });
});

// ============================================================================
// pickFormatSuggestion — row 7 of content-kpi-definition.md §5
// ============================================================================

describe("pickFormatSuggestion — MIN_FORMAT_CLIPS gate + median-เดือน comparison", () => {
  it("formatCount below MIN_FORMAT_CLIPS -> null even with clearly negative numbers", () => {
    const result = pickFormatSuggestion({
      formatCount: MIN_FORMAT_CLIPS - 1,
      formatMeanSaveRate: 0.001,
      baselineMedianSaveRate: 0.05,
    });
    expect(result).toBeNull();
  });

  it("formatCount exactly at MIN_FORMAT_CLIPS -> gate passes", () => {
    const result = pickFormatSuggestion({
      formatCount: MIN_FORMAT_CLIPS,
      formatMeanSaveRate: 0.01,
      baselineMedianSaveRate: 0.05,
    });
    expect(result).not.toBeNull();
  });

  it("formatMeanSaveRate null -> no suggestion (can't classify what isn't there)", () => {
    expect(
      pickFormatSuggestion({ formatCount: MIN_FORMAT_CLIPS, formatMeanSaveRate: null, baselineMedianSaveRate: 0.05 })
    ).toBeNull();
  });

  it("baselineMedianSaveRate null (no channel data in the rolling window) -> no suggestion", () => {
    expect(
      pickFormatSuggestion({ formatCount: MIN_FORMAT_CLIPS, formatMeanSaveRate: 0.05, baselineMedianSaveRate: null })
    ).toBeNull();
  });

  it("format mean below 1.2x baseline -> negative (ตัดออกจากปฏิทิน)", () => {
    const result = pickFormatSuggestion({
      formatCount: MIN_FORMAT_CLIPS,
      formatMeanSaveRate: 0.05,
      baselineMedianSaveRate: 0.05, // 0.05 < 0.05 * 1.2
    });
    expect(result).toEqual({ kind: "negative", text: expect.stringContaining("ตัดออกจากปฏิทิน") });
  });

  it("format mean exactly 1.2x baseline -> positive (boundary inclusive, matches classifyMetricLevel)", () => {
    const result = pickFormatSuggestion({
      formatCount: MIN_FORMAT_CLIPS,
      formatMeanSaveRate: 0.06,
      baselineMedianSaveRate: 0.05, // 0.06 === 0.05 * 1.2 exactly
    });
    expect(result?.kind).toBe("positive");
  });
});

// ============================================================================
// computeConfidenceBadge — §6's precedence formula
// ============================================================================

describe("computeConfidenceBadge — format-level (row 7) outranks single-clip (row 1/2)", () => {
  it("nothing fired -> insufficient", () => {
    expect(computeConfidenceBadge(false, null)).toBe("insufficient");
  });

  it("only single-clip fired -> signal", () => {
    expect(computeConfidenceBadge(true, null)).toBe("signal");
  });

  it("only format-positive fired -> confirmed_positive", () => {
    expect(computeConfidenceBadge(false, "positive")).toBe("confirmed_positive");
  });

  it("only format-negative fired -> confirmed_negative", () => {
    expect(computeConfidenceBadge(false, "negative")).toBe("confirmed_negative");
  });

  it("both single-clip AND format-positive fired -> format wins (confirmed_positive, not signal)", () => {
    expect(computeConfidenceBadge(true, "positive")).toBe("confirmed_positive");
  });

  it("both single-clip AND format-negative fired -> format wins (confirmed_negative, not signal)", () => {
    expect(computeConfidenceBadge(true, "negative")).toBe("confirmed_negative");
  });
});

// ============================================================================
// determineContentKpiState — §4's full 6-row state table, in priority order
// ============================================================================

const BASE_CLIP: ClipT7Metrics = {
  viewCount: 134,
  likeCount: 8,
  commentCount: 2,
  saveCount: 1,
  shareCount: null,
  saveRate: 0.0075,
  shareRate: null,
  capturedOn: "2026-09-27",
};

function baseInput(overrides: Partial<DetermineKpiStateInput> = {}): DetermineKpiStateInput {
  return {
    t7UnavailableReason: null,
    postedDateTh: "2026-09-20",
    todayDateTh: "2026-09-28",
    clip: BASE_CLIP,
    globalCount: 10,
    comparisonViewMedian: 100,
    comparisonSaveMedian: 0.01,
    formatCount: 4,
    formatMeanSaveRate: 0.02,
    baselineMedianSaveRate: 0.01,
    ...overrides,
  };
}

describe("determineContentKpiState — state 1: waiting_t7 (§4.2)", () => {
  it("t7_unavailable_reason = 'ยังไม่ถึง 7 วัน' -> waiting_t7 with real age + expected-ready date", () => {
    const state = determineContentKpiState(
      baseInput({ t7UnavailableReason: T7_REASON_WAITING, postedDateTh: "2026-09-25", todayDateTh: "2026-09-28", clip: null })
    );
    expect(state).toEqual({ kind: "waiting_t7", ageDaysToday: 3, expectedReadyDateTh: "2026-10-02" });
  });
});

describe("determineContentKpiState — state 2: pending_entry (§4.3)", () => {
  it("t7_unavailable_reason = pending-entry text -> pending_entry with real age", () => {
    const state = determineContentKpiState(
      baseInput({ t7UnavailableReason: T7_REASON_PENDING_ENTRY, postedDateTh: "2026-09-21", todayDateTh: "2026-09-28", clip: null })
    );
    expect(state).toEqual({ kind: "pending_entry", ageDaysToday: 7 });
  });
});

describe("determineContentKpiState — state 3: missed_window (§4.4)", () => {
  it("t7_unavailable_reason = 'ไม่มีข้อมูลช่วง T+7' -> missed_window", () => {
    const state = determineContentKpiState(baseInput({ t7UnavailableReason: T7_REASON_MISSED, clip: null }));
    expect(state).toEqual({ kind: "missed_window" });
  });

  it("🔴 defense-in-depth: an UNRECOGNIZED reason string also falls to missed_window, never to the 'has snapshot' branch", () => {
    const state = determineContentKpiState(baseInput({ t7UnavailableReason: "ข้อความใหม่ที่ยังไม่รู้จัก", clip: null }));
    expect(state).toEqual({ kind: "missed_window" });
  });

  it("defensive fallback: t7_unavailable_reason is null (claims a real snapshot) but clip is null anyway -> missed_window, not a crash", () => {
    const state = determineContentKpiState(baseInput({ t7UnavailableReason: null, clip: null }));
    expect(state).toEqual({ kind: "missed_window" });
  });
});

describe("determineContentKpiState — state 4: insufficient_global (§4.5) — 🔴 today's REAL scenario", () => {
  it("channel has exactly 4 clips with valid T+7 (today's real count, per brief) -> insufficient_global, no verdict, no suggestion field anywhere", () => {
    const state = determineContentKpiState(baseInput({ globalCount: 4 }));
    expect(state).toEqual({ kind: "insufficient_global", clip: BASE_CLIP, globalCount: 4 });
    // Explicitly assert there is nowhere for a suggestion to hide in this
    // state's shape — TypeScript's discriminated union already guarantees
    // this at compile time, but spelling it out documents the exact
    // guarantee this test protects.
    expect(state).not.toHaveProperty("singleClipSuggestion");
    expect(state).not.toHaveProperty("formatSuggestion");
  });

  it("boundary: globalCount = MIN_GLOBAL_CLIPS - 1 -> still insufficient_global", () => {
    const state = determineContentKpiState(baseInput({ globalCount: MIN_GLOBAL_CLIPS - 1 }));
    expect(state.kind).toBe("insufficient_global");
  });

  it("boundary: globalCount = MIN_GLOBAL_CLIPS exactly -> gate passes, moves on to comparison logic", () => {
    const state = determineContentKpiState(baseInput({ globalCount: MIN_GLOBAL_CLIPS }));
    expect(state.kind).not.toBe("insufficient_global");
  });

  it("globalCount = 0 (brand new channel) -> insufficient_global, not a crash", () => {
    const state = determineContentKpiState(baseInput({ globalCount: 0 }));
    expect(state).toEqual({ kind: "insufficient_global", clip: BASE_CLIP, globalCount: 0 });
  });
});

describe("determineContentKpiState — state 5: format_unconfirmed (§4.6)", () => {
  it("global >= 10 but formatCount < 4 -> format_unconfirmed, carries viewLevel/saveLevel + optional single-clip suggestion", () => {
    const state = determineContentKpiState(
      baseInput({
        globalCount: 10,
        formatCount: 2,
        clip: { ...BASE_CLIP, viewCount: 50, saveRate: 0.02 }, // low view, high save (0.02 >= 0.01*1.2)
        comparisonViewMedian: 100,
        comparisonSaveMedian: 0.01,
      })
    );
    expect(state.kind).toBe("format_unconfirmed");
    if (state.kind !== "format_unconfirmed") throw new Error("unreachable");
    expect(state.viewLevel).toBe("low");
    expect(state.saveLevel).toBe("high");
    expect(state.singleClipSuggestion).toEqual({ kind: "repeat", text: expect.any(String) });
    expect(state.formatCount).toBe(2);
  });

  it("boundary: formatCount = MIN_FORMAT_CLIPS - 1 -> format_unconfirmed", () => {
    const state = determineContentKpiState(baseInput({ globalCount: 10, formatCount: MIN_FORMAT_CLIPS - 1 }));
    expect(state.kind).toBe("format_unconfirmed");
  });

  it("§4.8 same-direction quadrant -> format_unconfirmed but singleClipSuggestion is null", () => {
    const state = determineContentKpiState(
      baseInput({
        globalCount: 10,
        formatCount: 1,
        clip: { ...BASE_CLIP, viewCount: 500, saveRate: 0.05 }, // both high
        comparisonViewMedian: 100,
        comparisonSaveMedian: 0.01,
      })
    );
    expect(state.kind).toBe("format_unconfirmed");
    if (state.kind !== "format_unconfirmed") throw new Error("unreachable");
    expect(state.singleClipSuggestion).toBeNull();
    expect(state.viewLevel).toBe("high");
    expect(state.saveLevel).toBe("high");
  });
});

describe("determineContentKpiState — state 6: full (§4.7) — boundary formatCount = MIN_FORMAT_CLIPS exactly", () => {
  it("global >= 10, formatCount = 4 exactly -> full, with formatSuggestion + confidenceBadge computed", () => {
    const state = determineContentKpiState(
      baseInput({
        globalCount: 10,
        formatCount: MIN_FORMAT_CLIPS,
        formatMeanSaveRate: 0.02,
        baselineMedianSaveRate: 0.01, // 0.02 >= 0.01*1.2 -> positive
      })
    );
    expect(state.kind).toBe("full");
    if (state.kind !== "full") throw new Error("unreachable");
    expect(state.formatSuggestion).toEqual({ kind: "positive", text: expect.any(String) });
    expect(state.confidenceBadge).toBe("confirmed_positive"); // format-level always wins per §6
  });

  it("full state with a negative format signal -> confirmed_negative", () => {
    const state = determineContentKpiState(
      baseInput({
        globalCount: 10,
        formatCount: MIN_FORMAT_CLIPS,
        formatMeanSaveRate: 0.005,
        baselineMedianSaveRate: 0.01, // 0.005 < 0.01*1.2 -> negative
      })
    );
    expect(state.kind).toBe("full");
    if (state.kind !== "full") throw new Error("unreachable");
    expect(state.formatSuggestion?.kind).toBe("negative");
    expect(state.confidenceBadge).toBe("confirmed_negative");
  });

  it("full state, format suggestion absent (baseline unavailable) but single-clip signal present -> badge falls back to 'signal'", () => {
    const state = determineContentKpiState(
      baseInput({
        globalCount: 10,
        formatCount: MIN_FORMAT_CLIPS,
        clip: { ...BASE_CLIP, viewCount: 50, saveRate: 0.02 }, // low+high -> repeat suggestion
        comparisonViewMedian: 100,
        comparisonSaveMedian: 0.01,
        formatMeanSaveRate: null, // format-level can't classify
        baselineMedianSaveRate: null,
      })
    );
    expect(state.kind).toBe("full");
    if (state.kind !== "full") throw new Error("unreachable");
    expect(state.formatSuggestion).toBeNull();
    expect(state.singleClipSuggestion).not.toBeNull();
    expect(state.confidenceBadge).toBe("signal");
  });
});

describe("determineContentKpiState — full state table order, sanity check across the whole priority chain", () => {
  // Threads every gate through a single scenario per §4's own numbering, to
  // catch a reordering bug that per-state tests above (each starting from a
  // fresh baseInput()) wouldn't necessarily notice.
  const scenarios: Array<{ label: string; input: Partial<DetermineKpiStateInput>; expectedKind: string }> = [
    { label: "1: waiting", input: { t7UnavailableReason: T7_REASON_WAITING, clip: null }, expectedKind: "waiting_t7" },
    { label: "2: pending", input: { t7UnavailableReason: T7_REASON_PENDING_ENTRY, clip: null }, expectedKind: "pending_entry" },
    { label: "3: missed", input: { t7UnavailableReason: T7_REASON_MISSED, clip: null }, expectedKind: "missed_window" },
    { label: "4: insufficient global", input: { globalCount: 4 }, expectedKind: "insufficient_global" },
    { label: "5: format unconfirmed", input: { globalCount: 10, formatCount: 1 }, expectedKind: "format_unconfirmed" },
    { label: "6: full", input: { globalCount: 10, formatCount: 4 }, expectedKind: "full" },
  ];

  for (const scenario of scenarios) {
    it(`§4 row ${scenario.label}`, () => {
      expect(determineContentKpiState(baseInput(scenario.input)).kind).toBe(scenario.expectedKind);
    });
  }
});
