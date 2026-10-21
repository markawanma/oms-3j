// W1 (0187) — บอร์ดใบงาน: ป้าย "จากหน้างาน/รอรับทราบ/ค้าง 3 วัน/ยังไม่ผูก SKU/โลหะต่างจาก SKU" + tile "รอรับทราบ" + ตัวกรอง
// ต้องถูก: นับวันปฏิทินไทย · rank 1.5 ระหว่างเลยกำหนดกับครบใน 3 วัน · tile นับ = ตัวกรองให้ผลเท่ากัน
// ต้องไม่พัง: ใบเดิม (ไม่มี intake) ได้ป้าย/ลำดับ/ตัวนับเดิมเป๊ะ
import { describe, expect, it } from "vitest";
import { ATTENTION_MAX_RANK, applySignal, attentionCount, compareBySeverity, describeFilters, isUnackedStale, matchesSignal, primaryStatus, secondaryStatuses, statusSignals, summarize, unackedDays } from "./board";
import { calendarDaysOpen, isAckStale, STALE_CALENDAR_DAYS } from "./intake-ack";
import type { BoardIntake, BoardRow } from "./types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0001", seq: 1, sourceKind: "production", sourceRef: "PO-0040", designLabel: "แหวน", sku: "RG-1", metal: "silver", qtyPlanned: 5, status: "in_progress", dueDate: null,
  stageCode: "cast", stageName: "หล่อ", stageStatus: "received", holderName: "ช่างเอ", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 5, stageDoneCount: 1, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null, boardColumn: null,
  handoffGapG: null, handoffMismatchCount: 0, qtyOrder: 5, qtySurplus: null, underPlanned: false, surplusPending: false, surplusDisposition: null, targetPieceG: null, metalPlanG: null,
  profileName: null, hasWeigh: false, goldUnguarded: false, ...o,
});
const intake = (o: Partial<BoardIntake> = {}): BoardIntake => ({ ackPending: true, openedAt: "2026-10-19T02:12:00Z", metalMismatch: false, ...o });
const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";

describe("intake-ack (ที่เดียวของกติกาค้าง)", () => {
  it("วันปฏิทินไทย นับวันเปิดเป็นวัน 1 · ครบ 3 = ค้าง", () => {
    expect(STALE_CALENDAR_DAYS).toBe(3);
    expect(calendarDaysOpen("2026-10-19T02:12:00Z", MON)).toBe(1);
    expect(calendarDaysOpen("2026-10-19T02:12:00Z", WED)).toBe(3);
    expect(isAckStale("2026-10-19T02:12:00Z", TUE)).toBe(false);
    expect(isAckStale("2026-10-19T02:12:00Z", WED)).toBe(true);
    // 19 ต.ค. 18:00 UTC = 20 ต.ค. 01:00 ไทย → ถึง 21 ต.ค. ไทย = 2 วัน (ไม่ใช่ 3 แบบ UTC)
    expect(calendarDaysOpen("2026-10-19T18:00:00Z", WED)).toBe(2);
    expect(isAckStale("2026-10-19T18:00:00Z", WED)).toBe(false);
    expect(calendarDaysOpen(null, WED)).toBeNull();
  });
});

describe("isUnackedStale (ที่เดียวกับ /production)", () => {
  it("ใช้ isAckStale เดียวกัน: ครบ 3 วันปฏิทินไทย = ค้าง · รับทราบแล้ว/ไม่มี intake = ไม่", () => {
    expect(isUnackedStale(row({ intake: intake() }), TUE)).toBe(false);
    expect(isUnackedStale(row({ intake: intake() }), WED)).toBe(true);
    expect(isUnackedStale(row({ intake: intake({ ackPending: false }) }), "2026-12-01")).toBe(false);
    expect(isUnackedStale(row(), "2026-12-01")).toBe(false);
  });
});

describe("statusSignals — ใบจากหน้างาน", () => {
  it("รอรับทราบ: amber ก่อนครบกำหนดเตือน · แดง 'รอรับทราบ ค้าง 3 วัน' เมื่อครบ · เป็นป้ายหลัก (ต้องดู)", () => {
    const r = row({ intake: intake() });
    expect(primaryStatus(r, TUE)).toMatchObject({ key: "unacked", label: "รอรับทราบ", tone: "amber" });
    expect(primaryStatus(r, WED)).toMatchObject({ key: "unacked", label: "รอรับทราบ ค้าง 3 วัน", tone: "red" });
    expect(primaryStatus(r, WED).rank).toBeLessThanOrEqual(ATTENTION_MAX_RANK);
    expect(unackedDays(r, WED)).toBe(3);
  });
  it("rank อยู่ระหว่างเลยกำหนด (1) กับครบใน 3 วัน (2)", () => {
    const both = row({ intake: intake(), isOverdue: true, dueDate: "2026-10-18" });
    expect(statusSignals(both, TUE).map((s) => s.key).slice(0, 2)).toEqual(["overdue", "unacked"]);
    const soon = row({ intake: intake(), dueDate: "2026-10-22" });
    expect(statusSignals(soon, TUE).map((s) => s.key).slice(0, 2)).toEqual(["unacked", "dueSoon"]);
  });
  it("รับทราบแล้ว: ไม่มีป้ายรอรับทราบ เหลือ 'จากหน้างาน' (ข้อมูลประกอบ ไม่ใช่ป้ายหลัก)", () => {
    const r = row({ intake: intake({ ackPending: false }) });
    expect(statusSignals(r, WED).map((s) => s.key)).toEqual(["fromShop"]);
    expect(primaryStatus(r, WED).key).toBe("normal");
    expect(secondaryStatuses(r, WED).map((s) => s.key)).toEqual(["fromShop"]);
  });
  it("ข้อมูลประกอบ: ยังไม่ผูก SKU (sku ว่าง) · โลหะต่างจาก SKU · จากหน้างาน — ไม่นับ 'ต้องดู'", () => {
    const r = row({ sku: null, intake: intake({ ackPending: false, metalMismatch: true }) });
    const s = statusSignals(r, TUE);
    expect(s.map((x) => x.key)).toEqual(["unboundSku", "metalDiff", "fromShop"]);
    expect(s.every((x) => x.rank > ATTENTION_MAX_RANK)).toBe(true);
    expect(s[0].label).toContain("ยังไม่ผูก SKU");
    expect(attentionCount([r], TUE)).toBe(0);
  });
  it("มี SKU แล้ว = ไม่มีป้ายยังไม่ผูก · ไม่มี mismatch = ไม่มีป้ายโลหะต่าง", () => {
    expect(statusSignals(row({ intake: intake({ ackPending: false }) }), TUE).map((x) => x.key)).toEqual(["fromShop"]);
  });
  it("ใบเดิม (ไม่มี intake) ได้ป้าย/ลำดับเดิมเป๊ะ — แม้ sku ว่างหรือ source เป็น production", () => {
    expect(statusSignals(row({ sku: null }), TUE)).toEqual([]);
    expect(statusSignals(row({ isOverdue: true, dueDate: "2026-10-18", isStale: true }), TUE).map((s) => s.key)).toEqual(["overdue", "stale"]);
    expect(primaryStatus(row(), TUE).key).toBe("normal");
  });
  it("เรียงความเร่งด่วน: ใบรอรับทราบมาก่อนใบปกติ · หลังใบเลยกำหนด", () => {
    const a = row({ id: "a", seq: 3 });
    const b = row({ id: "b", seq: 2, intake: intake() });
    const c = row({ id: "c", seq: 1, isOverdue: true, dueDate: "2026-10-18" });
    expect([a, b, c].sort((x, y) => compareBySeverity(x, y, TUE)).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("summarize + signal unacked", () => {
  const rows = [row({ id: "1", intake: intake() }), row({ id: "2", intake: intake({ openedAt: "2026-10-21T01:00:00Z" }) }), row({ id: "3", intake: intake({ ackPending: false }) }), row({ id: "4" })];
  it("นับรอรับทราบ + ค้างครบกำหนด · tile กับตัวกรองให้ผลเท่ากัน", () => {
    const s = summarize(rows, WED);
    expect(s).toMatchObject({ active: 4, unacked: 2, unackedStale: 1 });
    expect(applySignal(rows, "unacked", WED).map((r) => r.id)).toEqual(["1", "2"]);
    expect(applySignal(rows, "unacked", WED)).toHaveLength(s.unacked);
    expect(matchesSignal(rows[2], "unacked", WED)).toBe(false);
    expect(matchesSignal(rows[3], "unacked", WED)).toBe(false);
  });
  it("ไม่มีใบจากหน้างาน = ศูนย์ (ใบเดิมไม่เปลี่ยน)", () => {
    expect(summarize([row(), row()], WED)).toMatchObject({ unacked: 0, unackedStale: 0 });
  });
  it("describeFilters บอก 'รอรับทราบ'", () => {
    expect(describeFilters({ metal: "", source: "", holder: "", overdueOnly: false }, "unacked", { metal: {}, source: {} })).toBe("รอรับทราบ");
  });
});
