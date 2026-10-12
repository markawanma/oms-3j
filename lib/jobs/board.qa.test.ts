// QA (R2-D2) — J1 บอร์ดใบงาน: ใบที่ทำครบทุกขั้นแล้วแต่ยังไม่ปิดงาน
// 🐞 BUG-J1-02: groupByStage (board.ts:37-38) ส่งทุกใบที่ stageCode = null ไปคอลัมน์ "ยังไม่เริ่ม"
//    รวมใบที่ทุกขั้น "ส่งต่อแล้ว" (ขั้น 8/8) รอออฟฟิศกดปิดงาน → ออฟฟิศเห็นเหมือนยังไม่มีใครแตะ
//    reproduce จริง: JB-0001 (QA) ช่างส่งต่อครบ 8 ขั้น → การ์ดอยู่คอลัมน์ "ยังไม่เริ่ม" แสดง "ขั้น 8/8"
//    it.fails จะผ่านตราบที่บั๊กยังอยู่ — แก้แล้วให้ลบ .fails
import { describe, expect, it } from "vitest";
import { NO_STAGE, groupByStage } from "@/lib/jobs/board";
import type { BoardRow, StageDef } from "@/lib/jobs/types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0001", seq: 1, sourceKind: "oem", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress",
  dueDate: null, stageCode: null, stageName: null, stageStatus: null, holderName: null, daysInStage: null, isOverdue: false, lastEventAt: null, lastScanAt: null,
  isStale: false, stageCount: 8, stageDoneCount: 0, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
  ...o,
});
const DEFS: StageDef[] = [{ code: "cast", nameTh: "หล่อ", seq: 7 }];

describe("groupByStage — ใบที่ครบทุกขั้นแต่ยังเปิดอยู่", () => {
  it("ใบที่ยังไม่มีขั้นไหนเสร็จ (0/8, stageCode null) อยู่ 'ยังไม่เริ่ม' — ต้องไม่พัง", () => {
    const cols = groupByStage([row({ id: "new", stageDoneCount: 0 })], DEFS);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).toEqual(["new"]);
  });
  it.fails("BUG-J1-02: ใบที่ทำครบ 8/8 ต้องไม่ถูกจัดเป็น 'ยังไม่เริ่ม'", () => {
    const cols = groupByStage([row({ id: "alldone", stageCount: 8, stageDoneCount: 8 })], DEFS);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).not.toContain("alldone");
  });
});
