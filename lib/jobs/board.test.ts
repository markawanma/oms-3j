import { describe, expect, it } from "vitest";
import { NO_STAGE, applyFilters, cardBadges, compareCards, groupByStage, holderOptions, stageAgeLabel, summarize, EMPTY_FILTERS } from "./board";
import { addDays, daysBetween, thaiDate, thaiDateTime } from "./dates";
import { mapBoardRow } from "./types";
import type { BoardRow, StageDef } from "./types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0001", seq: 1, sourceKind: "production", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress", dueDate: null,
  stageCode: "cast", stageName: "หล่อ", stageStatus: "received", holderName: "ช่างเอ", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 5, stageDoneCount: 1, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null, ...o,
});
const DEFS: StageDef[] = [
  { code: "cast", nameTh: "หล่อ", seq: 7 },
  { code: "polish", nameTh: "แต่ง ขัด", seq: 9 },
];

describe("groupByStage", () => {
  it("คอลัมน์ ยังไม่เริ่ม + ทุกขั้นที่ใช้งาน (แม้ไม่มีใบ) · ใบที่ขั้นปัจจุบันไม่รู้จัก/ว่าง → ยังไม่เริ่ม", () => {
    const cols = groupByStage([row({ id: "a" }), row({ id: "b", stageCode: null }), row({ id: "c", stageCode: "ghost" }), row({ id: "d", stageCode: "polish" })], DEFS);
    expect(cols.map((c) => c.code)).toEqual([NO_STAGE, "cast", "polish"]);
    expect(cols[0].rows.map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect(cols[1].rows.map((r) => r.id)).toEqual(["a"]);
    expect(cols[2].rows.map((r) => r.id)).toEqual(["d"]);
  });
  it("ไม่ทิ้งใบงานใดเลย (รวมทุกคอลัมน์ = ทั้งหมด)", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: String(i), stageCode: i % 3 === 0 ? null : i % 3 === 1 ? "cast" : "polish" }));
    expect(groupByStage(rows, DEFS).reduce((n, c) => n + c.rows.length, 0)).toBe(20);
  });
  it("เรียงในคอลัมน์: เลยกำหนดก่อน → กำหนดใกล้ก่อน → ไม่มีกำหนดท้าย → เลขใบ", () => {
    const c = groupByStage([row({ id: "x", seq: 5 }), row({ id: "y", seq: 4, dueDate: "2026-10-20" }), row({ id: "z", seq: 9, dueDate: "2026-10-15", isOverdue: true }), row({ id: "w", seq: 3, dueDate: "2026-10-18" })], DEFS)[1];
    expect(c.rows.map((r) => r.id)).toEqual(["z", "w", "y", "x"]);
    expect(compareCards(row({ seq: 1 }), row({ seq: 2 }))).toBeLessThan(0);
  });
});

describe("applyFilters", () => {
  const rows = [row({ id: "1", metal: "gold", holderName: "ก", isOverdue: true }), row({ id: "2", metal: "silver", sourceKind: "oem", holderName: "ข" }), row({ id: "3", metal: "silver", holderName: null })];
  it("แต่ละตัวกรองทำงาน · รวมกันได้ · ว่าง = ไม่กรอง", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(3);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, metal: "gold" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, source: "oem" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, holder: "ข" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, overdueOnly: true }).map((r) => r.id)).toEqual(["1"]);
    expect(applyFilters(rows, { metal: "silver", source: "oem", holder: "", overdueOnly: false }).map((r) => r.id)).toEqual(["2"]);
  });
  it("ตัวเลือกช่าง: ไม่ซ้ำ ไม่มี null เรียงไทย", () => {
    expect(holderOptions([row({ holderName: "ข" }), row({ holderName: "ก" }), row({ holderName: "ข" }), row({ holderName: null })])).toEqual(["ก", "ข"]);
  });
});

describe("summarize — ใช้ธงจาก DB · ครบกำหนดใน 3 วันจากวันที่ไทย", () => {
  it("นับถูก: เลยกำหนด/ค้างนาน/ยังไม่มีมัดจำมาจากธง · dueSoon ไม่นับใบที่เลยกำหนดแล้ว", () => {
    const rows = [
      row({ isOverdue: true, dueDate: "2026-10-10" }),
      row({ dueDate: "2026-10-12" }), row({ dueDate: "2026-10-15" }), row({ dueDate: "2026-10-16" }), row({ dueDate: null }),
      row({ isStale: true }), row({ depositMissing: true }),
    ];
    expect(summarize(rows, "2026-10-12")).toEqual({ active: 7, overdue: 1, dueSoon: 2, stale: 1, depositMissing: 1 });
  });
  it("ว่าง = ศูนย์ทุกตัว", () => {
    expect(summarize([], "2026-10-12")).toEqual({ active: 0, overdue: 0, dueSoon: 0, stale: 0, depositMissing: 0 });
  });
});

describe("cardBadges / stageAgeLabel", () => {
  it("ป้ายเป็นข้อความทุกอัน (ไม่พึ่งสี) ตามธงของ DB", () => {
    const b = cardBadges(row({ isOverdue: true, status: "on_hold", depositMissing: true, isStale: true, hasAutoClosed: true, quoteQtyMismatch: true, quoteItemQty: 8 }));
    expect(b.map((x) => x.key)).toEqual(["overdue", "hold", "deposit", "stale", "auto", "qty"]);
    expect(b.find((x) => x.key === "qty")!.label).toContain("(8)");
    expect(cardBadges(row())).toEqual([]);
  });
  it("ยังไม่มีมัดจำ: บอกว่าเริ่มก่อนด้วยเหตุผลถ้ามี note · ใบที่เสร็จแล้วไม่ขึ้น", () => {
    expect(cardBadges(row({ depositMissing: true, startGateNotePresent: true }))[0].label).toMatch(/เริ่มก่อน/);
    expect(cardBadges(row({ depositMissing: true, status: "done" }))).toEqual([]);
  });
  it("วันค้าง: 0 = วันนี้ · ติดลบ/null = ไม่แสดง", () => {
    expect(stageAgeLabel(row({ daysInStage: 0 }))).toBe("วันนี้");
    expect(stageAgeLabel(row({ daysInStage: 4 }))).toBe("4 วัน");
    expect(stageAgeLabel(row({ daysInStage: -1 }))).toBeNull();
    expect(stageAgeLabel(row({ daysInStage: null }))).toBeNull();
  });
});

describe("mapBoardRow — รับ view ดิบ", () => {
  it("แมปถูก · ไม่มี id/job_no = null · ค่าเสียไม่พัง", () => {
    expect(mapBoardRow({})).toBeNull();
    expect(mapBoardRow({ id: "x" })).toBeNull();
    const r = mapBoardRow({ id: "x", job_no: "JB-0002", seq: "2", qty_planned: 5, days_in_stage: "3", is_overdue: true, due_date: "2026-10-30T00:00:00", stage_count: 4, stage_done_count: "1", quote_qty_mismatch: "yes" })!;
    expect(r).toMatchObject({ jobNo: "JB-0002", seq: 2, qtyPlanned: 5, daysInStage: 3, isOverdue: true, dueDate: "2026-10-30", stageCount: 4, stageDoneCount: 1, quoteQtyMismatch: false });
  });
});

describe("dates", () => {
  it("addDays / daysBetween ข้ามเดือน/ปี", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-12", "2026-10-19")).toBe(7);
  });
  it("thaiDate: พ.ศ. · ผิดรูป = —", () => {
    expect(thaiDate("2026-10-12")).toBe("12 ต.ค. 2569");
    expect(thaiDate("2026-10-12", false)).toBe("12 ต.ค.");
    for (const v of [null, undefined, "", "x", "2026-13-01"]) expect(thaiDate(v)).toBe("—");
  });
  it("thaiDateTime: เวลาไทย (UTC+7)", () => {
    expect(thaiDateTime("2026-10-12T07:05:00Z")).toBe("12 ต.ค. 14:05");
    expect(thaiDateTime("2026-10-12T20:00:00Z")).toBe("13 ต.ค. 03:00");
    expect(thaiDateTime("bad")).toBe("—");
  });
});
