// บอร์ด v2: สถานะ→สี (statusSignals/primaryStatus) · tile signal · เรียงตามความเร่งด่วน — pure functions
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, applyFilters, applySignal, attentionCount, boardColumns, compareBySeverity, describeFilters, dueInfo, groupByStage, hasFilters, matchesSignal, primaryStatus, secondaryStatuses, statusSignals, summarize } from "./board";
import type { BoardRow, StageDef } from "./types";

const TODAY = "2026-10-14";
const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0001", seq: 1, sourceKind: "production", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress", dueDate: null,
  stageCode: "cast", stageName: "หล่อ", stageStatus: "received", holderName: "ช่างเอ", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 5, stageDoneCount: 1, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null, boardColumn: null, handoffGapG: null, handoffMismatchCount: 0, qtyOrder: 5, qtySurplus: null, underPlanned: false, surplusPending: false, surplusDisposition: null, targetPieceG: null, metalPlanG: null, profileName: null, hasWeigh: false, goldUnguarded: false, ...o,
});
const DEFS: StageDef[] = [{ code: "cast", nameTh: "หล่อ", seq: 7 }, { code: "polish", nameTh: "ขัด", seq: 9 }];

describe("primaryStatus — ทุก rank เดี่ยว", () => {
  const cases: Array<[string, Partial<BoardRow>, number, string, string]> = [
    ["1 เลยกำหนด (มี due → นับวัน)", { isOverdue: true, dueDate: "2026-10-11" }, 1, "เลยกำหนด 3 วัน", "red"],
    ["1 เลยกำหนด (ไม่มี due → ไม่มีตัวเลข)", { isOverdue: true }, 1, "เลยกำหนด", "red"],
    ["2 ครบวันนี้", { dueDate: TODAY }, 2, "ครบวันนี้", "amber"],
    ["2 ครบใน 2 วัน", { dueDate: "2026-10-16" }, 2, "ครบใน 2 วัน", "amber"],
    ["3 ชั่งไม่ตรง", { handoffMismatchCount: 2 }, 3, "ชั่งไม่ตรง 2 ครั้ง", "amber"],
    ["4 ส่วนต่างส่งมอบ", { handoffGapG: 0.37 }, 4, "ส่วนต่างส่งมอบ 0.37 g", "amber"],
    ["5 นิ่ง", { isStale: true }, 5, "นิ่งเกิน 3 วัน", "amber"],
    ["6 รอมัดจำ", { depositMissing: true }, 6, "ยังไม่มีมัดจำ", "amber"],
    ["6 รอมัดจำ (เริ่มก่อนด้วยเหตุผล)", { depositMissing: true, startGateNotePresent: true }, 6, "ยังไม่มีมัดจำ (เริ่มก่อนด้วยเหตุผล)", "amber"],
    ["7 พักไว้", { status: "on_hold" }, 7, "พักไว้", "gray"],
    ["8 เดินปกติ", {}, 8, "เดินปกติ", "green"],
  ];
  for (const [name, o, rank, label, tone] of cases) {
    it(name, () => {
      const p = primaryStatus(row(o), TODAY);
      expect(p).toMatchObject({ rank, label, tone });
    });
  }
  it("มีแต่ hasAutoClosed → เดินปกติ (ข้อมูลประกอบไม่ใช่สัญญาณ) แต่ยังเป็นป้ายรอง", () => {
    const r = row({ hasAutoClosed: true });
    expect(primaryStatus(r, TODAY).key).toBe("normal");
    expect(secondaryStatuses(r, TODAY).map((s) => s.key)).toEqual(["auto"]);
  });
  it("มีแต่ quoteQtyMismatch → เดินปกติ + ป้ายรองสีฟ้า", () => {
    const r = row({ quoteQtyMismatch: true, quoteItemQty: 8 });
    expect(primaryStatus(r, TODAY).key).toBe("normal");
    expect(secondaryStatuses(r, TODAY)[0]).toMatchObject({ key: "qty", tone: "blue", label: "จำนวนไม่ตรงใบเสนอราคา (8)" });
  });
  it("ใบที่เสร็จแล้ว (done) + ไม่มีมัดจำ ไม่ขึ้นป้ายรอมัดจำ", () => {
    expect(statusSignals(row({ depositMissing: true, status: "done" }), TODAY)).toEqual([]);
  });
  it("ไม่มีสัญญาณเลย → statusSignals ว่าง", () => {
    expect(statusSignals(row(), TODAY)).toEqual([]);
  });
});

describe("primaryStatus — ชนกัน", () => {
  it("overdue + stale + on_hold → หลัก overdue · รอง stale + hold ตามลำดับ rank", () => {
    const r = row({ isOverdue: true, dueDate: "2026-10-12", isStale: true, status: "on_hold" });
    expect(primaryStatus(r, TODAY)).toMatchObject({ key: "overdue", label: "เลยกำหนด 2 วัน" });
    expect(secondaryStatuses(r, TODAY).map((s) => s.key)).toEqual(["stale", "hold"]);
  });
  it("stale + on_hold (ไม่เลยกำหนด) → ต้องเห็นป้ายนิ่ง (tile อ้าง) — หลัก stale รอง hold", () => {
    const r = row({ isStale: true, status: "on_hold" });
    const keys = statusSignals(r, TODAY).map((s) => s.key);
    expect(keys).toContain("stale");
    expect(primaryStatus(r, TODAY).key).toBe("stale");
    expect(secondaryStatuses(r, TODAY).map((s) => s.key)).toEqual(["hold"]);
  });
  it("ทุกสัญญาณพร้อมกัน → เรียง rank 1..7 แล้วข้อมูลประกอบ", () => {
    const r = row({ isOverdue: true, dueDate: "2026-10-13", handoffMismatchCount: 1, handoffGapG: 1, isStale: true, depositMissing: true, status: "on_hold", hasAutoClosed: true, quoteQtyMismatch: true });
    expect(statusSignals(r, TODAY).map((s) => s.key)).toEqual(["overdue", "mismatch", "handoff", "stale", "deposit", "hold", "auto", "qty"]);
  });
  it("ใบที่ tile 'ครบใน 3 วัน' อ้าง ต้องมีป้าย dueSoon ในแถวเสมอ (แม้ป้ายหลักเป็นอย่างอื่น)", () => {
    const r = row({ dueDate: "2026-10-15", isStale: true, handoffMismatchCount: 1 });
    expect(matchesSignal(r, "dueSoon", TODAY)).toBe(true);
    expect(statusSignals(r, TODAY).map((s) => s.key)).toContain("dueSoon");
  });
});

describe("dueSoon ขอบเขต (ตรรกะเดียวกับ summarize)", () => {
  it("วันนี้ / +3 เข้า · +4 ไม่เข้า · เมื่อวานไม่เข้า · เลยกำหนดไม่นับ · ไม่มี due ไม่เข้า", () => {
    expect(matchesSignal(row({ dueDate: TODAY }), "dueSoon", TODAY)).toBe(true);
    expect(matchesSignal(row({ dueDate: "2026-10-17" }), "dueSoon", TODAY)).toBe(true);
    expect(matchesSignal(row({ dueDate: "2026-10-18" }), "dueSoon", TODAY)).toBe(false);
    expect(matchesSignal(row({ dueDate: "2026-10-13" }), "dueSoon", TODAY)).toBe(false);
    expect(matchesSignal(row({ dueDate: "2026-10-15", isOverdue: true }), "dueSoon", TODAY)).toBe(false);
    expect(matchesSignal(row({ dueDate: null }), "dueSoon", TODAY)).toBe(false);
  });
  it("ข้ามเดือน: 30 ต.ค. + 3 = 2 พ.ย.", () => {
    expect(matchesSignal(row({ dueDate: "2026-11-02" }), "dueSoon", "2026-10-30")).toBe(true);
    expect(matchesSignal(row({ dueDate: "2026-11-03" }), "dueSoon", "2026-10-30")).toBe(false);
  });
  it("summarize ยังให้ผลเท่าเดิม และตรงกับ applySignal ทุก signal", () => {
    const rows = [
      row({ id: "a", isOverdue: true, dueDate: "2026-10-10" }), row({ id: "b", dueDate: "2026-10-14" }), row({ id: "c", dueDate: "2026-10-17" }), row({ id: "d", dueDate: "2026-10-18" }),
      row({ id: "e", isStale: true }), row({ id: "f" }),
    ];
    const s = summarize(rows, TODAY);
    expect(s).toMatchObject({ active: 6, overdue: 1, dueSoon: 2, stale: 1 });
    expect(applySignal(rows, "overdue", TODAY)).toHaveLength(s.overdue);
    expect(applySignal(rows, "dueSoon", TODAY)).toHaveLength(s.dueSoon);
    expect(applySignal(rows, "stale", TODAY)).toHaveLength(s.stale);
    expect(applySignal(rows, null, TODAY)).toHaveLength(6);
  });
});

describe("compareBySeverity", () => {
  it("rank ก่อน → due น้อยก่อน (null ท้าย) → ค้างนานก่อน → seq", () => {
    const rows = [
      row({ id: "ok", seq: 1 }),
      row({ id: "hold", seq: 2, status: "on_hold" }),
      row({ id: "stale-nodue", seq: 3, isStale: true }),
      row({ id: "stale-due", seq: 4, isStale: true, dueDate: "2026-10-30" }),
      row({ id: "over-late", seq: 5, isOverdue: true, dueDate: "2026-10-12" }),
      row({ id: "over-early", seq: 6, isOverdue: true, dueDate: "2026-10-01" }),
    ];
    expect([...rows].sort((a, b) => compareBySeverity(a, b, TODAY)).map((r) => r.id)).toEqual(["over-early", "over-late", "stale-due", "stale-nodue", "hold", "ok"]);
  });
  it("due ว่างทั้งคู่ → ค้างขั้นนานกว่าก่อน · null ท้ายสุด · เท่ากัน → seq", () => {
    const rows = [row({ id: "n", seq: 1, daysInStage: null }), row({ id: "d2", seq: 2, daysInStage: 2 }), row({ id: "d9", seq: 3, daysInStage: 9 }), row({ id: "d2b", seq: 0, daysInStage: 2 })];
    expect([...rows].sort((a, b) => compareBySeverity(a, b, TODAY)).map((r) => r.id)).toEqual(["d9", "d2b", "d2", "n"]);
  });
});

describe("attentionCount / dueInfo / hasFilters / describeFilters / boardColumns", () => {
  it("ต้องดู = ป้ายหลัก rank ≤ 7 (เดินปกติ/ข้อมูลประกอบไม่นับ)", () => {
    expect(attentionCount([row({ isStale: true }), row({ status: "on_hold" }), row(), row({ hasAutoClosed: true })], TODAY)).toBe(2);
    expect(attentionCount([], TODAY)).toBe(0);
  });
  it("dueInfo: เลย n วัน / อีก n วัน / วันนี้ / ไม่ตั้งกำหนดส่ง", () => {
    expect(dueInfo(row({ isOverdue: true, dueDate: "2026-10-11" }), TODAY)).toEqual({ kind: "overdue", text: "เลย 3 วัน" });
    expect(dueInfo(row({ dueDate: "2026-10-16" }), TODAY)).toEqual({ kind: "soon", text: "อีก 2 วัน" });
    expect(dueInfo(row({ dueDate: "2026-10-30" }), TODAY)).toEqual({ kind: "normal", text: "อีก 16 วัน" });
    expect(dueInfo(row({ dueDate: TODAY }), TODAY)).toEqual({ kind: "soon", text: "วันนี้" });
    expect(dueInfo(row(), TODAY)).toEqual({ kind: "none", text: "ไม่ตั้งกำหนดส่ง" });
  });
  it("hasFilters / describeFilters", () => {
    expect(hasFilters(EMPTY_FILTERS, null)).toBe(false);
    expect(hasFilters(EMPTY_FILTERS, "stale")).toBe(true);
    expect(hasFilters({ ...EMPTY_FILTERS, holder: "ก" }, null)).toBe(true);
    const labels = { metal: { gold: "ทอง" }, source: { oem: "งาน OEM" } };
    expect(describeFilters({ ...EMPTY_FILTERS, metal: "gold", source: "oem", holder: "ช่างเอ" }, "overdue", labels)).toBe("เลยกำหนด · โลหะ ทอง · แหล่ง งาน OEM · ผู้ถือ ช่างเอ");
    expect(describeFilters(EMPTY_FILTERS, null, labels)).toBe("");
  });
  it("boardColumns ซ่อนเฉพาะ 'ยังไม่เริ่ม' ที่ว่าง (กติกาเดิม)", () => {
    const cols = groupByStage([row({ id: "a" })], DEFS);
    expect(boardColumns(cols).map((c) => c.code)).toEqual(["cast", "polish", "awaiting_close"]);
  });
  it("applyFilters เดิม + applySignal ซ้อนกัน = ตัวเลข tile (นับหลัง dropdown ก่อน signal)", () => {
    const rows = [row({ id: "1", metal: "gold", isOverdue: true, dueDate: "2026-10-10" }), row({ id: "2", metal: "silver", isOverdue: true, dueDate: "2026-10-10" }), row({ id: "3", metal: "gold" })];
    const afterDropdown = applyFilters(rows, { ...EMPTY_FILTERS, metal: "gold" });
    expect(summarize(afterDropdown, TODAY).overdue).toBe(1);
    expect(applySignal(afterDropdown, "overdue", TODAY).map((r) => r.id)).toEqual(["1"]);
  });
});
