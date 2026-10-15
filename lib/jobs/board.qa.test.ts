// QA (R2-D2) — J1 บอร์ดใบงาน: ใบที่ทำครบทุกขั้นแล้วแต่ยังไม่ปิดงาน
// 🐞 BUG-J1-02: groupByStage (board.ts:37-38) ส่งทุกใบที่ stageCode = null ไปคอลัมน์ "ยังไม่เริ่ม"
//    รวมใบที่ทุกขั้น "ส่งต่อแล้ว" (ขั้น 8/8) รอออฟฟิศกดปิดงาน → ออฟฟิศเห็นเหมือนยังไม่มีใครแตะ
//    reproduce จริง: JB-0001 (QA) ช่างส่งต่อครบ 8 ขั้น → การ์ดอยู่คอลัมน์ "ยังไม่เริ่ม" แสดง "ขั้น 8/8"
//    (แก้แล้ว 12 ต.ค. ด้วย board_column ของ 0173 — it.fails เดิมเปลี่ยนเป็น it ปกติแล้ว)
import { describe, expect, it } from "vitest";
import { AWAITING_CLOSE, NO_STAGE, cardBadges, groupByStage } from "@/lib/jobs/board";
import type { BoardRow, StageDef } from "@/lib/jobs/types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0001", seq: 1, sourceKind: "oem", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress",
  dueDate: null, stageCode: null, stageName: null, stageStatus: null, holderName: null, daysInStage: null, isOverdue: false, lastEventAt: null, lastScanAt: null,
  isStale: false, stageCount: 8, stageDoneCount: 0, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null, boardColumn: null, handoffGapG: null, handoffMismatchCount: 0, qtyOrder: 5, qtySurplus: null, underPlanned: false, surplusPending: false, surplusDisposition: null, targetPieceG: null, metalPlanG: null, profileName: null, hasWeigh: false, goldUnguarded: false,
  ...o,
});
const DEFS: StageDef[] = [{ code: "cast", nameTh: "หล่อ", seq: 7 }];

describe("groupByStage — ใบที่ครบทุกขั้นแต่ยังเปิดอยู่", () => {
  it("ใบที่ยังไม่มีขั้นไหนเสร็จ (0/8, stageCode null) อยู่ 'ยังไม่เริ่ม' — ต้องไม่พัง", () => {
    const cols = groupByStage([row({ id: "new", stageDoneCount: 0 })], DEFS);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).toEqual(["new"]);
  });
  it("BUG-J1-02 (แก้แล้ว 12 ต.ค. ด้วย board_column ของ 0173): ใบที่ทำครบ 8/8 ไปคอลัมน์ 'รอปิดงาน' ไม่ใช่ 'ยังไม่เริ่ม'", () => {
    const cols = groupByStage([row({ id: "alldone", stageCount: 8, stageDoneCount: 8, boardColumn: "awaiting_close" })], DEFS);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).not.toContain("alldone");
    expect(cols.find((c) => c.code === AWAITING_CLOSE)!.rows.map((r) => r.id)).toEqual(["alldone"]);
    expect(cols.at(-1)!.name).toBe("รอปิดงาน");
  });
  it("ข้อมูลเก่าไม่มี board_column แต่ครบทุกขั้นและไม่มีขั้นปัจจุบัน → รอปิดงานเช่นกัน (ป้องกันไว้ก่อน)", () => {
    const cols = groupByStage([row({ id: "old", stageCount: 8, stageDoneCount: 8, boardColumn: null, stageCode: null })], DEFS);
    expect(cols.find((c) => c.code === AWAITING_CLOSE)!.rows.map((r) => r.id)).toEqual(["old"]);
  });
  it("ใบที่ board_column = รหัสขั้นปัจจุบัน → คอลัมน์ของขั้นนั้น · รหัสที่ไม่รู้จัก → ยังไม่เริ่ม", () => {
    const cols = groupByStage([row({ id: "a", boardColumn: "cast", stageCode: "cast" }), row({ id: "b", boardColumn: "mystery", stageCode: "mystery" })], DEFS);
    expect(cols.find((c) => c.code === "cast")!.rows.map((r) => r.id)).toEqual(["a"]);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).toEqual(["b"]);
  });
  it("ส่วนต่างส่งมอบ (handoff_gap_g) > 0 ขึ้นป้ายบนการ์ด · 0/null ไม่ขึ้น", () => {
    expect(cardBadges(row({ handoffGapG: 0.37 })).map((b) => b.label)).toContain("ส่วนต่างส่งมอบ 0.37 g");
    expect(cardBadges(row({ handoffGapG: 0 })).map((b) => b.key)).not.toContain("handoff");
    expect(cardBadges(row({ handoffGapG: null })).map((b) => b.key)).not.toContain("handoff");
  });
});

describe("0174: ชั่งไม่ตรง (handoff_mismatch_count)", () => {
  it("count > 0 ขึ้นป้าย 'ชั่งไม่ตรง n ครั้ง' สีส้ม · 0 ไม่ขึ้น", () => {
    const b = cardBadges(row({ handoffMismatchCount: 3 })).find((x) => x.key === "mismatch");
    expect(b).toMatchObject({ label: "ชั่งไม่ตรง 3 ครั้ง", tone: "amber" });
    expect(cardBadges(row({ handoffMismatchCount: 0 })).map((x) => x.key)).not.toContain("mismatch");
  });
});
