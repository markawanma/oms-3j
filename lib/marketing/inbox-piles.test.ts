import { describe, expect, it } from "vitest";
import {
  RECO_PREVIEW_LIMIT,
  buildInboxPiles,
  buildPostPile,
  buildReviewPile,
  isInboxEmpty,
  sortRecoPending,
  summarizeWeek,
  thaiWeekRange,
  totalShootMinutes,
} from "./inbox-piles";
import { mapPieceRow, mapRecoRow } from "./piece-types";
import type { PieceRow, RecoInboxRow } from "./piece-types";

function piece(over: Record<string, unknown> = {}): PieceRow {
  return mapPieceRow({
    step_id: "s" + Math.random().toString(36).slice(2, 8),
    campaign_id: "c1",
    title: "ชิ้นงาน",
    piece_status: "in_review",
    piece_kind: "short_clip",
    resolved_start: "2026-10-09",
    ...over,
  });
}

function reco(over: Record<string, unknown> = {}): RecoInboxRow {
  return mapRecoRow({
    item_kind: "reco",
    item_id: "r" + Math.random().toString(36).slice(2, 8),
    title: "ข้อเสนอ",
    effective_action: "pending",
    ...over,
  });
}

const TODAY = "2026-10-09";

describe("กอง 1 วันนี้ต้องโพสต์", () => {
  it("เอาเฉพาะ approved/produced ที่ถึงวันแล้ว (<= วันนี้) — ตรงกับสูตร post_today ของ view", () => {
    const rows = [
      piece({ title: "A", piece_status: "approved", resolved_start: "2026-10-09" }),
      piece({ title: "B", piece_status: "produced", resolved_start: "2026-10-08" }),
      piece({ title: "C", piece_status: "approved", resolved_start: "2026-10-10" }),
      piece({ title: "D", piece_status: "in_review", resolved_start: "2026-10-08" }),
      piece({ title: "E", piece_status: "posted", resolved_start: "2026-10-08" }),
      piece({ title: "F", piece_status: "approved", resolved_start: null }),
    ];
    const pile = buildPostPile(rows, TODAY, new Set());
    expect(pile.map((p) => p.title)).toEqual(["B", "A"]);
  });
  it("ชิ้นที่ถูก hold ยังนับ (สถานะดิบ) เพื่อให้เลขตรงกับ view", () => {
    const pile = buildPostPile([piece({ piece_status: "approved", hold_reason: "รอของ", effective_piece_status: "on_hold" })], TODAY, new Set());
    expect(pile).toHaveLength(1);
  });
  it("ที่เลยกำหนดแล้วยังไม่วางลิงก์ขึ้นก่อน แล้วเรียงวัน-เวลา", () => {
    const late = piece({ title: "late", piece_status: "produced", resolved_start: "2026-10-09", start_time: "20:00" });
    const early = piece({ title: "early", piece_status: "approved", resolved_start: "2026-10-07", start_time: "10:00" });
    const mid = piece({ title: "mid", piece_status: "approved", resolved_start: "2026-10-09", start_time: "09:00" });
    const pile = buildPostPile([mid, early, late], TODAY, new Set([late.stepId]));
    expect(pile.map((p) => p.title)).toEqual(["late", "early", "mid"]);
  });
});

describe("กอง 2 รออนุมัติ", () => {
  it("เอาเฉพาะ in_review เรียงวันใกล้สุดก่อน (ไม่มีวันไปท้าย)", () => {
    const rows = [
      piece({ title: "no-date", resolved_start: null }),
      piece({ title: "later", resolved_start: "2026-10-12" }),
      piece({ title: "sooner", resolved_start: "2026-10-10" }),
      piece({ title: "approved-one", piece_status: "approved" }),
    ];
    expect(buildReviewPile(rows).map((p) => p.title)).toEqual(["sooner", "later", "no-date"]);
  });
  it("ไม่อ่านค่า can_approve เพื่อกรอง — ชิ้นที่ยังอนุมัติไม่ได้ก็ยังอยู่ในกอง (DB ตัดสินที่ปุ่ม)", () => {
    const rows = [piece({ can_approve: false }), piece({ can_approve: true })];
    expect(buildReviewPile(rows)).toHaveLength(2);
  });
});

describe("กอง 4 ข้อเสนอ AI", () => {
  it("รอตอบเท่านั้น · respond_by ใกล้สุดก่อน · ไม่มี respond_by ท้าย · เท่ากันใหม่สุดก่อน", () => {
    const rows = [
      reco({ item_id: "none-old", respond_by: null, created_at: "2026-10-01T00:00:00Z" }),
      reco({ item_id: "late", respond_by: "2026-10-20", created_at: "2026-10-02T00:00:00Z" }),
      reco({ item_id: "soon", respond_by: "2026-10-10", created_at: "2026-10-03T00:00:00Z" }),
      reco({ item_id: "none-new", respond_by: null, created_at: "2026-10-05T00:00:00Z" }),
      reco({ item_id: "done", effective_action: "done" }),
      reco({ item_id: "expired", effective_action: "expired" }),
    ];
    expect(sortRecoPending(rows).map((r) => r.itemId)).toEqual(["soon", "late", "none-new", "none-old"]);
  });
  it("หน้าแรกแสดงสูงสุด RECO_PREVIEW_LIMIT ใบ แต่นับทั้งหมดไว้ให้ 'ดูทั้งหมด'", () => {
    const rows = Array.from({ length: RECO_PREVIEW_LIMIT + 2 }, (_, i) => reco({ item_id: `r${i}`, respond_by: `2026-10-${10 + i}` }));
    const piles = buildInboxPiles({ postRows: [], reviewRows: [], recoRows: rows, todayTh: TODAY, overdueNoLinkIds: new Set() });
    expect(piles.reco).toHaveLength(RECO_PREVIEW_LIMIT);
    expect(piles.recoTotal).toBe(RECO_PREVIEW_LIMIT + 2);
  });
});

describe("หน้าแรกว่าง", () => {
  it("ไม่มีของเลยสักกอง = empty", () => {
    const piles = buildInboxPiles({ postRows: [], reviewRows: [], recoRows: [], todayTh: TODAY, overdueNoLinkIds: new Set() });
    expect(isInboxEmpty(piles)).toBe(true);
  });
  it("มีแค่ข้อเสนอ AI ก็ไม่ว่าง", () => {
    const piles = buildInboxPiles({ postRows: [], reviewRows: [], recoRows: [reco()], todayTh: TODAY, overdueNoLinkIds: new Set() });
    expect(isInboxEmpty(piles)).toBe(false);
  });
});

describe("สัปดาห์ไทย จ–อา", () => {
  it("วันพฤหัส 8 ต.ค. 2569 → จ. 5 – อา. 11", () => {
    expect(thaiWeekRange("2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });
  it("วันอาทิตย์ยังอยู่ในสัปดาห์ที่เริ่มจันทร์ก่อนหน้า", () => {
    expect(thaiWeekRange("2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });
  it("วันจันทร์เป็นต้นสัปดาห์", () => {
    expect(thaiWeekRange("2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("ข้ามเดือน/ปี", () => {
    expect(thaiWeekRange("2026-12-31")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
  it("รูปแบบวันที่ผิด = null", () => {
    expect(thaiWeekRange("09/10/2026")).toBeNull();
  });
});

describe("สรุปสัปดาห์ (ข้อมูลประกอบ ไม่ใช่การตัดสิน)", () => {
  const rows = [
    piece({ piece_status: "posted", footage_status: "shot" }),
    piece({ piece_status: "approved", footage_status: "has_footage" }),
    piece({ piece_status: "in_review", footage_status: null }),
    piece({ piece_status: "approved", footage_status: "needs_shoot", shoot_minutes_est: 15 }),
    piece({ piece_status: "approved", footage_status: "needs_shoot", shoot_minutes_est: 25 }),
    piece({ piece_status: "cancelled", footage_status: "needs_shoot" }),
  ];
  it("นับตามสถานะดิบ · ไม่นับ cancelled", () => {
    expect(summarizeWeek(rows)).toEqual({ total: 5, posted: 1, hasFootage: 1, inReview: 1, needsShoot: 2 });
  });
  it("รวมเวลาถ่ายเฉพาะชิ้นที่ยังต้องถ่าย · ไม่มีเวลาเลย = null (ไม่เดาเป็น 0)", () => {
    expect(totalShootMinutes(rows)).toBe(40);
    expect(totalShootMinutes([piece({ piece_status: "approved", footage_status: "needs_shoot" })])).toBeNull();
    expect(totalShootMinutes([])).toBeNull();
  });
});
