// QA 20 ต.ค. 69 (0184): ใบเก่าที่ขั้นปัจจุบันเป็น polish (เลิกใช้ is_active=false) ต้องไม่หายไปอยู่คอลัมน์ "ยังไม่เริ่ม" บนบอร์ด /jobs
// สาเหตุที่คาด: getJobBoard (lib/actions/job-office.ts) อ่าน job_stage_def เฉพาะ is_active=true → groupByStage/columnOf ไม่รู้จัก 'polish' → ตกไป NO_STAGE
// บน DB จริง: JB-0034 / JB-0036 (pending ที่ wax_inject) มีขั้น polish ที่ seq 5 — พอเดินถึงขั้นนั้นจะโดน
import { describe, expect, it } from "vitest";
import { NO_STAGE, columnOf, groupByStage, visibleBoardStages } from "./board";
import { mapStageDef } from "./types";
import type { BoardRow, StageDef } from "./types";

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "i", jobNo: "JB-0034", seq: 34, sourceKind: "oem", sourceRef: null, designLabel: "แหวน", sku: null, metal: "silver", qtyPlanned: 5, status: "in_progress", dueDate: null,
  stageCode: "polish", stageName: "แต่ง ขัด", stageStatus: "pending", holderName: null, daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 8, stageDoneCount: 5, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
  boardColumn: "polish", handoffGapG: null, handoffMismatchCount: 0, ...o,
} as BoardRow);

// ทะเบียนเฉพาะขั้นเปิดใช้งาน (ไม่มี polish) — ใช้ยืนยัน columnOf/groupByStage ของ finish/buff · การแสดงขั้นเลิกใช้ทดสอบกับ ALL_DEFS + visibleBoardStages ด้านล่าง
const ACTIVE_DEFS: StageDef[] = [
  { code: "cut_sprue", nameTh: "ตัดต้น", seq: 80 },
  { code: "finish", nameTh: "แต่ง", seq: 91 },
  { code: "buff", nameTh: "ขัด", seq: 92 },
  { code: "qc", nameTh: "ตรวจ QC", seq: 120 },
];

// ทะเบียนทุกแถวที่ getJobBoard อ่าน (รวมเลิกใช้) เรียงตาม seq_default
const ALL_DEFS: StageDef[] = [
  { code: "cut_sprue", nameTh: "ตัดต้น", seq: 80 },
  { code: "polish", nameTh: "แต่ง ขัด", seq: 90, retired: true },
  { code: "finish", nameTh: "แต่ง", seq: 91 },
  { code: "buff", nameTh: "ขัด", seq: 92 },
  { code: "qc", nameTh: "ตรวจ QC", seq: 120 },
];

describe("0184 · ใบเก่าที่อยู่ขั้น polish (เลิกใช้) บนบอร์ด", () => {
  // แก้แล้ว (QA 20 ต.ค. เจอบั๊ก → เดิม it.fails): getJobBoard โหลดทะเบียนรวมขั้นเลิกใช้ แล้ว visibleBoardStages เก็บขั้นเลิกใช้เฉพาะที่ยังมีใบอยู่
  it("ใบที่ board_column='polish' ไม่ตกคอลัมน์ ยังไม่เริ่ม (NO_STAGE) — ขึ้นคอลัมน์ 'แต่ง ขัด (เลิกใช้)' ก่อน finish ตาม seq_default", () => {
    const stages = visibleBoardStages(ALL_DEFS, [row({ id: "old" })]);
    expect(stages.map((s) => [s.code, s.nameTh])).toEqual([["cut_sprue", "ตัดต้น"], ["polish", "แต่ง ขัด (เลิกใช้)"], ["finish", "แต่ง"], ["buff", "ขัด"], ["qc", "ตรวจ QC"]]);
    const known = new Set(stages.map((d) => d.code));
    expect(columnOf(row(), known)).toBe("polish");
    const cols = groupByStage([row({ id: "old" })], stages);
    expect(cols.map((c) => c.code)).toEqual([NO_STAGE, "cut_sprue", "polish", "finish", "buff", "qc", "awaiting_close"]);
    expect(cols.find((c) => c.code === NO_STAGE)!.rows.map((r) => r.id)).not.toContain("old");
    expect(cols.find((c) => c.code === "polish")!.rows.map((r) => r.id)).toEqual(["old"]);
  });
  it("ขั้นเลิกใช้ที่ไม่มีใบอยู่ = ไม่ขึ้นคอลัมน์ · ใบที่แยกส่วน (dominant_stage_code=polish) ก็ทำให้ขึ้น · ขั้นเปิดใช้งานขึ้นเสมอแม้ไม่มีใบ", () => {
    expect(visibleBoardStages(ALL_DEFS, []).map((s) => s.code)).toEqual(["cut_sprue", "finish", "buff", "qc"]);
    expect(visibleBoardStages(ALL_DEFS, [row({ stageCode: "finish", boardColumn: "finish" })]).map((s) => s.code)).toEqual(["cut_sprue", "finish", "buff", "qc"]);
    const split = row({ partsCount: 3, dominantStageCode: "polish", boardColumn: "finish", stageCode: "finish" });
    expect(visibleBoardStages(ALL_DEFS, [split]).map((s) => s.code)).toContain("polish");
  });
  it("mapStageDef: is_active=false → retired · ไม่ส่ง/true → ไม่มีคีย์ retired", () => {
    expect(mapStageDef({ code: "polish", name_th: "แต่ง ขัด", seq_default: 90, is_active: false })).toEqual({ code: "polish", nameTh: "แต่ง ขัด", seq: 90, retired: true });
    expect(mapStageDef({ code: "finish", name_th: "แต่ง", seq_default: 91, is_active: true })).toEqual({ code: "finish", nameTh: "แต่ง", seq: 91 });
    expect(mapStageDef({ code: "buff", name_th: "ขัด", seq_default: 92 })).toEqual({ code: "buff", nameTh: "ขัด", seq: 92 });
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
