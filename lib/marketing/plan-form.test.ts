import { describe, expect, it } from "vitest";
import { channelsForKind, diffPlanValues, editablePlanKeys, isMetricSelectable, metricNeedsHypothesis, parseDecimal, valuesFromPiece } from "./plan-form";
import { mapPieceRow } from "./piece-types";
import { sanitizePlanSet } from "./piece-input";

function base(over: Record<string, unknown> = {}) {
  return valuesFromPiece(
    mapPieceRow({
      step_id: "s",
      campaign_id: "c",
      title: "t",
      piece_status: "idea",
      piece_kind: "short_clip",
      channel: "tiktok",
      customer_group: "jewelry_925",
      metric_code: "peak_viewers",
      baseline_value: 12,
      pass_threshold: 20,
      pass_op: ">=",
      shoot_minutes_est: 10,
      ...over,
    })
  );
}
const ALL = editablePlanKeys("idea");

describe("editablePlanKeys — ตาม c_keys / c_appr_keys / c_closed_keys ของ DB", () => {
  it("idea/planned แก้ได้ทุกช่อง รวม date", () => {
    expect(editablePlanKeys("idea").has("date")).toBe(true);
    expect(editablePlanKeys("planned").has("hypothesis")).toBe(true);
  });
  it("drafting/in_review แก้ได้ทุกช่องยกเว้น date (เลื่อนวัน = ปุ่ม 'เลื่อน' ที่บังคับเหตุผล)", () => {
    for (const s of ["drafting", "in_review"]) {
      const k = editablePlanKeys(s);
      expect(k.has("date")).toBe(false);
      expect(k.has("piece_kind")).toBe(true);
    }
  });
  it("approved/produced เหลือเฉพาะถ่ายทำ/เวลา/โฮสต์ — ไม่มี hypothesis/piece_kind/date", () => {
    const k = editablePlanKeys("approved");
    for (const ok of ["time_slot", "start_time", "expected_host_id", "footage_status", "footage_url", "shoot_note", "shoot_location", "shoot_minutes_est", "shoot_date"]) {
      expect(k.has(ok), ok).toBe(true);
    }
    for (const no of ["date", "hypothesis", "piece_kind", "channel", "metric_code", "pass_threshold", "line_audience"]) {
      expect(k.has(no), no).toBe(false);
    }
    expect(editablePlanKeys("produced")).toEqual(k);
  });
  it("posted/cancelled/อื่น เหลือ footage_url + shoot_note", () => {
    expect([...editablePlanKeys("posted")].sort()).toEqual(["footage_url", "shoot_note"]);
    expect([...editablePlanKeys("cancelled")].sort()).toEqual(["footage_url", "shoot_note"]);
  });
});

describe("parseDecimal", () => {
  it("ว่าง = undefined · ตัวเลข = number · ผิดรูป = null · 0 เป็นค่าจริง", () => {
    expect(parseDecimal("")).toBeUndefined();
    expect(parseDecimal("  ")).toBeUndefined();
    expect(parseDecimal("0")).toBe(0);
    expect(parseDecimal("0.5")).toBe(0.5);
    expect(parseDecimal("-3")).toBe(-3);
    for (const bad of ["abc", "1e5", "1,000", "NaN", "Infinity", "1.", ".5", "--1"]) expect(parseDecimal(bad), bad).toBeNull();
  });
});

describe("diffPlanValues — ส่งเฉพาะ key ที่เปลี่ยน", () => {
  it("ไม่แก้อะไร = set ว่าง", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v }, ALL)).toEqual({ ok: true, set: {} });
  });
  it("แก้ช่องเดียว = ส่งช่องเดียว", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v, hypothesis: " สมมติฐานใหม่ " }, ALL)).toEqual({ ok: true, set: { hypothesis: "สมมติฐานใหม่" } });
  });
  it("ตัวเลขเปลี่ยนเป็น 0 = ส่ง 0 (ไม่ใช่ null)", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v, baselineValue: "0" }, ALL)).toEqual({ ok: true, set: { baseline_value: 0 } });
  });
  it("ล้างค่า: ข้อความ/ตัวเลขที่เคยมีแล้วลบจนว่าง = null", () => {
    const v = base({ shoot_note: "เดิม" });
    const r = diffPlanValues(v, { ...v, shootNote: "", passThreshold: "" }, ALL);
    expect(r).toEqual({ ok: true, set: { shoot_note: null, pass_threshold: null } });
  });
  it("ว่างทั้งคู่ = ไม่ส่ง", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v, footageUrl: "" }, ALL)).toEqual({ ok: true, set: {} });
  });
  it("ตัวเลขเท่าเดิมแต่พิมพ์ต่างรูป (12 vs 12.0) = ไม่ส่ง", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v, baselineValue: "12.0" }, ALL)).toEqual({ ok: true, set: {} });
  });
  it("ตัวเลขผิดรูป = error ที่ช่องนั้น", () => {
    const v = base();
    const r = diffPlanValues(v, { ...v, passThreshold: "abc" }, ALL);
    expect(r).toMatchObject({ ok: false, field: "passThreshold" });
  });
  it("ช่องที่แก้ไม่ได้ในสถานะนั้นไม่ถูกส่งแม้ค่าเปลี่ยน", () => {
    const v = base({ piece_status: "approved" });
    const r = diffPlanValues(v, { ...v, hypothesis: "แก้", shootNote: "โน้ต" }, editablePlanKeys("approved"));
    expect(r).toEqual({ ok: true, set: { shoot_note: "โน้ต" } });
  });
  it("baselineNote ส่งเมื่อพิมพ์เท่านั้น (view ไม่คืนค่าเดิม)", () => {
    const v = base();
    expect(diffPlanValues(v, { ...v, baselineNote: " หมายเหตุ " }, ALL)).toEqual({ ok: true, set: { baseline_note: "หมายเหตุ" } });
    expect(diffPlanValues(v, { ...v, baselineNote: "  " }, ALL)).toEqual({ ok: true, set: {} });
  });
  it("ผลของ diff ผ่าน sanitizePlanSet ที่ฝั่ง server ได้ (สัญญาตรงกัน)", () => {
    const v = base();
    const r = diffPlanValues(v, { ...v, baselineValue: "0", shootMinutesEst: "15", pieceKind: "live_cut", timeSlot: "before_live", expectedHostId: "" }, ALL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(sanitizePlanSet(r.set).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("ช่องทางตามชนิด", () => {
    expect(channelsForKind("short_clip")).toEqual(["tiktok", "tiktok_live"]);
    expect(channelsForKind("line_message")).toEqual(["line_oa"]);
    expect(channelsForKind("")).toEqual([]);
  });
  it("Q1a: save_rate/share_rate เลือกใหม่ไม่ได้จนกว่ารู้หน่วย — แต่ค่าที่มีอยู่แล้วยังเห็น", () => {
    expect(isMetricSelectable("save_rate", "")).toBe(false);
    expect(isMetricSelectable("share_rate", "peak_viewers")).toBe(false);
    expect(isMetricSelectable("save_rate", "save_rate")).toBe(true);
    expect(isMetricSelectable("peak_viewers", "")).toBe(true);
    expect(isMetricSelectable("none", "")).toBe(true);
  });
  it("ตัวชี้วัดที่ต้องกรอกสมมติฐาน", () => {
    expect(metricNeedsHypothesis("")).toBe(false);
    expect(metricNeedsHypothesis("none")).toBe(false);
    expect(metricNeedsHypothesis("peak_viewers")).toBe(true);
  });
});
