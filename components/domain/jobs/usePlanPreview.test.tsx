// @vitest-environment jsdom
// usePlanPreview (0175 review S4): คำตอบเก่าที่กลับมาช้าต้องถูกทิ้ง — จอเหลือค่าของคำถามล่าสุดเท่านั้น
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

afterEach(cleanup);

const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a) }));

import { PLAN_DEBOUNCE_MS, usePlanPreview } from "./usePlanPreview";
import type { PlanPreviewArgs } from "./usePlanPreview";

const ITEM = "11111111-1111-4111-8111-111111111111";
const args = (o: Partial<PlanPreviewArgs> = {}): PlanPreviewArgs => ({ kind: "oem", itemId: ITEM, enabled: true, qtyPlanned: null, targetPieceG: null, stageCodes: ["cast"], ...o });
const answer = (metalPlanG: number) => ({ ok: true, data: { qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 35, underPlanned: false, rejectBasis: { castPct: 6, polishPct: 3, platePct: null, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "quote", metal: "silver", metalPlanG, metalPlanBasis: null, missing: [] } });

function deferred() {
  let resolve: (v: unknown) => void = () => undefined;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlanPreview — คำตอบเก่าถูกทิ้ง (S4)", () => {
  it("คำตอบแรกกลับมาหลังถามครั้งที่สองแล้ว: ยังเป็น loading (ปุ่มสร้างต้องไม่เปิด) · พอคำตอบสองมา = ค่าของคำตอบสอง", async () => {
    const d1 = deferred();
    const d2 = deferred();
    getJobPlanSuggest.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const { result, rerender } = renderHook((p: PlanPreviewArgs) => usePlanPreview(p), { initialProps: args() });
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(1));
    rerender(args({ qtyPlanned: 28 }));
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(2), { timeout: PLAN_DEBOUNCE_MS + 2000 });
    expect(getJobPlanSuggest.mock.calls[1][2]).toEqual(expect.objectContaining({ qtyPlanned: 28 }));

    // คำตอบแรก (เก่า) กลับมาก่อน → ต้องไม่ถูกใช้ · สถานะยัง loading
    await act(async () => { d1.resolve(answer(153.6)); await Promise.resolve(); });
    expect(result.current.state.s).toBe("loading");

    await act(async () => { d2.resolve(answer(120)); await Promise.resolve(); });
    await waitFor(() => expect(result.current.state.s).toBe("ready"));
    expect(result.current.state).toMatchObject({ s: "ready", data: { metalPlanG: 120 } });
  });

  it("คำตอบสองมาก่อน แล้วคำตอบแรกตามมาทีหลัง: จอยังเป็นค่าของคำตอบสอง ไม่ถูกทับ", async () => {
    const d1 = deferred();
    const d2 = deferred();
    getJobPlanSuggest.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const { result, rerender } = renderHook((p: PlanPreviewArgs) => usePlanPreview(p), { initialProps: args() });
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(1));
    rerender(args({ qtyPlanned: 28 }));
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(2), { timeout: PLAN_DEBOUNCE_MS + 2000 });

    await act(async () => { d2.resolve(answer(120)); await Promise.resolve(); });
    await waitFor(() => expect(result.current.state).toMatchObject({ s: "ready", data: { metalPlanG: 120 } }));
    await act(async () => { d1.resolve(answer(153.6)); await Promise.resolve(); });
    expect(result.current.state).toMatchObject({ s: "ready", data: { metalPlanG: 120 } });
  });

  it("คำตอบเก่าที่ล้ม (error) กลับมาช้า ก็ไม่ทับคำตอบใหม่ที่สำเร็จ", async () => {
    const d1 = deferred();
    const d2 = deferred();
    getJobPlanSuggest.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const { result, rerender } = renderHook((p: PlanPreviewArgs) => usePlanPreview(p), { initialProps: args() });
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(1));
    rerender(args({ qtyPlanned: 28 }));
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledTimes(2), { timeout: PLAN_DEBOUNCE_MS + 2000 });
    await act(async () => { d2.resolve(answer(120)); await Promise.resolve(); });
    await waitFor(() => expect(result.current.state.s).toBe("ready"));
    await act(async () => { d1.resolve({ ok: false, error: "ล้ม" }); await Promise.resolve(); });
    expect(result.current.state).toMatchObject({ s: "ready", data: { metalPlanG: 120 } });
  });
});
