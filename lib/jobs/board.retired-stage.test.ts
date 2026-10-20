// QA 20 ต.ค. 69 (0184): ใบเก่าที่ขั้นปัจจุบันเป็น polish (เลิกใช้ is_active=false) ต้องไม่หายไปอยู่คอลัมน์ "ยังไม่เริ่ม" บนบอร์ด /jobs
// สาเหตุที่คาด: getJobBoard (lib/actions/job-office.ts) อ่าน job_stage_def เฉพาะ is_active=true → groupByStage/columnOf ไม่รู้จัก 'polish' → ตกไป NO_STAGE
// บน DB จริง: JB-0034 / JB-0036 (pending ที่ wax_inject) มีขั้น polish ที่ seq 5 — พอเดินถึงขั้นนั้นจะโดน
import { describe, expect, it } from "vitest";
import { NO_STAGE, columnOf, groupByStage } from "./board";
import type { BoardRow, StageDef } from "./types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0034", seq: 34, sourceKind: "oem", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress", dueDate: null,
  stageCode: "polish", stageName: "แต่ง ขัด", stageStatus: "pending", holderName: null, daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 8, stageDoneCount: 5, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
  boardColumn: "polish", handoffGapG: null, handoffMismatchCount: 0, ...o,
} as BoardRow);

// ทะเบียนที่ getJobBoard ส่งมาหลัง 0184 = เฉพาะขั้นเปิดใช้งาน (ไม่มี polish)
const ACTIVE_DEFS: StageDef[] = [
  { code: "cut_sprue", nameTh: "ตัดต้น", seq: 80 },
  { code: "finish", nameTh: "แต่ง", seq: 91 },
  { code: "buff", nameTh: "ขัด", seq: 92 },
  { code: "qc", nameTh: "ตรวจ QC", seq: 120 },
];

describe("0184 · ใบเก่าที่อยู่ขั้น polish (เลิกใช้) บนบอร์ด", () => {
  // 🐞 it.fails = บั๊กยังอยู่ (suite เขียวไว้ก่อน) — แก้บั๊กแล้วเทสต์นี้จะ "ล้ม" ให้เปลี่ยน it.fails เป็น it
  it.fails("ใบที่ board_column='polish' ต้องไม่ตกคอลัมน์ ยังไม่เริ่ม (NO_STAGE) เมื่อทะเบียนมีเฉพาะขั้นเปิดใช้งาน", () => {
    const known = new Set(ACTIVE_DEFS.map((d) => d.code));
    expect(columnOf(row(), known)).not.toBe(NO_STAGE);
    const cols = groupByStage([row({ id: "old" })], ACTIVE_DEFS);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).not.toContain("old");
  });
  it("ต้องไม่พัง: ใบที่อยู่ finish/buff ขึ้นคอลัมน์ของตัวเองตาม board_column (ไม่ผูกลำดับ seq)", () => {
    const known = new Set(ACTIVE_DEFS.map((d) => d.code));
    expect(columnOf(row({ stageCode: "finish", boardColumn: "finish" }), known)).toBe("finish");
    expect(columnOf(row({ stageCode: "buff", boardColumn: "buff" }), known)).toBe("buff");
    const cols = groupByStage([row({ id: "f", stageCode: "finish", boardColumn: "finish" }), row({ id: "b", stageCode: "buff", boardColumn: "buff" })], ACTIVE_DEFS);
    expect(cols.map((c) => c.code)).toEqual([NO_STAGE, "cut_sprue", "finish", "buff", "qc", "awaiting_close"]);
    expect(cols.find((c) => c.code === "finish")!.rows.map((r) => r.id)).toEqual(["f"]);
    expect(cols.find((c) => c.code === "buff")!.rows.map((r) => r.id)).toEqual(["b"]);
  });
});
