import { describe, expect, it } from "vitest";
import { derivePieceBanners, lastApprovalReviewSeconds, lastCancelFromStatus, restoreForcesReview } from "./piece-events";
import { mapPieceEvent } from "./piece-types";
import type { PieceEvent } from "./piece-types";

let seq = 0;
function ev(over: Record<string, unknown>): PieceEvent {
  seq += 1;
  return mapPieceEvent({
    id: `e${seq}`,
    seq,
    event_kind: "advance",
    created_at: `2026-10-0${Math.min(seq, 9)}T00:00:00Z`,
    payload: {},
    ...over,
  });
}

describe("lastCancelFromStatus / restoreForcesReview", () => {
  it("อ่านสถานะก่อนยกเลิกล่าสุดจาก event (ไม่เดา)", () => {
    const events = [ev({ event_kind: "cancel", from_status: "in_review" }), ev({ event_kind: "restore" }), ev({ event_kind: "cancel", from_status: "approved" })];
    expect(lastCancelFromStatus(events)).toBe("approved");
    expect(restoreForcesReview(events)).toBe(true);
  });
  it("ไม่เคยยกเลิก = null", () => {
    expect(lastCancelFromStatus([ev({ event_kind: "create" })])).toBeNull();
    expect(restoreForcesReview([])).toBe(false);
  });
  it("เรียงด้วย seq ไม่ใช่ลำดับใน array (trap #22)", () => {
    const a = ev({ event_kind: "cancel", from_status: "approved" });
    const b = ev({ event_kind: "cancel", from_status: "in_review" });
    expect(lastCancelFromStatus([b, a])).toBe("in_review");
  });
  it("cancel จาก in_review/drafting ไม่บังคับอนุมัติใหม่", () => {
    expect(restoreForcesReview([ev({ event_kind: "cancel", from_status: "in_review" })])).toBe(false);
  });
});

describe("derivePieceBanners", () => {
  it("ยกเลิกแล้ว → แถบแดงพร้อมเหตุผลจาก event", () => {
    const b = derivePieceBanners({ pieceStatus: "cancelled", holdReason: null }, [ev({ event_kind: "cancel", from_status: "approved", reason: "ไม่ทัน" })]);
    expect(b[0]).toMatchObject({ key: "cancelled", tone: "red", detail: "ไม่ทัน" });
  });
  it("รอเงื่อนไข → ใช้ hold_reason ของชิ้น", () => {
    const b = derivePieceBanners({ pieceStatus: "approved", holdReason: "รอของมา" }, []);
    expect(b[0]).toMatchObject({ key: "on_hold", detail: "รอของมา" });
  });
  it("กู้คืนจาก approved แล้วยังไม่อนุมัติ → 'ต้องอนุมัติใหม่' (brief 0.6)", () => {
    const events = [
      ev({ event_kind: "cancel", from_status: "approved" }),
      ev({ event_kind: "restore", payload: { cancel_from: "approved", forced_review: true } }),
    ];
    const b = derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, events);
    expect(b.map((x) => x.key)).toContain("needs_reapproval");
  });
  it("อนุมัติใหม่แล้ว → แถบหาย", () => {
    const events = [
      ev({ event_kind: "restore", payload: { forced_review: true } }),
      ev({ event_kind: "advance", from_status: "in_review", to_status: "approved" }),
    ];
    expect(derivePieceBanners({ pieceStatus: "approved", holdReason: null }, events).map((x) => x.key)).not.toContain("needs_reapproval");
    // ถึงจะถอนกลับมา in_review อีก — restore เก่าไม่ใช่เหตุผลอีกต่อไป
    expect(derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, events).map((x) => x.key)).not.toContain("needs_reapproval");
  });
  it("กู้คืนจาก in_review (ไม่ forced) → ไม่มีแถบต้องอนุมัติใหม่", () => {
    const events = [ev({ event_kind: "restore", payload: {} })];
    expect(derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, events)).toEqual([]);
  });
  it("ผลตรวจถูกล้าง (reset) หลังส่งตรวจ → แถบบอกชื่อด่านไทย (brief 0.7)", () => {
    const events = [
      ev({ event_kind: "advance", from_status: "drafting", to_status: "in_review" }),
      ev({ event_kind: "gate", payload: { reset: true, gate_kinds: ["fact_check", "risk_owner"] } }),
    ];
    const b = derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, events);
    const reset = b.find((x) => x.key === "gates_reset");
    expect(reset?.title).toContain("ข้อเท็จจริง");
    expect(reset?.title).toContain("ความเสี่ยง");
    expect(reset?.title).not.toMatch(/fact_check|risk_owner/);
  });
  it("reset เก่าก่อนส่งตรวจครั้งล่าสุด → ไม่แสดง", () => {
    const events = [
      ev({ event_kind: "gate", payload: { reset: true, gate_kinds: ["fact_check"] } }),
      ev({ event_kind: "advance", from_status: "drafting", to_status: "in_review" }),
    ];
    expect(derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, events)).toEqual([]);
  });
  it("event gate ปกติ (ไม่ reset) ไม่ทำให้เกิดแถบ", () => {
    expect(derivePieceBanners({ pieceStatus: "in_review", holdReason: null }, [ev({ event_kind: "gate", payload: { status: "passed" } })])).toEqual([]);
  });
  it("หลังอนุมัติแล้ว ไม่แสดงแถบ reset (ล็อกเนื้อหาแล้ว)", () => {
    const events = [ev({ event_kind: "gate", payload: { reset: true, gate_kinds: ["fact_check"] } })];
    expect(derivePieceBanners({ pieceStatus: "approved", holdReason: null }, events)).toEqual([]);
  });
  it("สูงสุด 3 แถบ", () => {
    const events = [
      ev({ event_kind: "restore", payload: { forced_review: true } }),
      ev({ event_kind: "gate", payload: { reset: true, gate_kinds: ["brand_rule"] } }),
    ];
    expect(derivePieceBanners({ pieceStatus: "in_review", holdReason: "x" }, events).length).toBeLessThanOrEqual(3);
  });
});

describe("lastApprovalReviewSeconds", () => {
  it("เอาของการอนุมัติครั้งล่าสุดที่มีค่า", () => {
    const events = [
      ev({ event_kind: "advance", to_status: "approved", review_seconds: 30 }),
      ev({ event_kind: "revert", to_status: "in_review" }),
      ev({ event_kind: "advance", to_status: "approved", review_seconds: 95 }),
    ];
    expect(lastApprovalReviewSeconds(events)).toBe(95);
    expect(lastApprovalReviewSeconds([])).toBeNull();
  });
});
