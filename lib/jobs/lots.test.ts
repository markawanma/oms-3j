// lib/jobs/lots.ts + board.ts (0181 ส่วนย่อย) — แถบสะสมรวม N ครบ · ส่วนต่างรอชี้แจง (void ไม่นับ) · ปุ่มปิด full · บอร์ดใบเดี่ยวไม่เปลี่ยน
import { describe, expect, it } from "vitest";
import { closeBlocker, hasLots, lotSegments, lotsLine, mapDiscrepancy, mapLotPart, mapLotsSummary, mapTreeStageLoss, noteRequired, openDiscrepancies, rootLossFromTree, scrapNoteRequired, segmentsTotal, splittableParts, toBoardLots } from "@/lib/jobs/lots";
import type { JobLotsData, LotPart } from "@/lib/jobs/lots";
import { columnOf, primaryStatus, statusSignals } from "@/lib/jobs/board";
import { BOARD_COLUMNS, mapBoardRow } from "@/lib/jobs/types";
import type { BoardRow } from "@/lib/jobs/types";

const ROOT = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222221";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "22222222-2222-4222-8222-222222222223";

const treeRow = (o: Record<string, unknown>) => ({ job_id: ROOT, root_job_id: ROOT, lot_seq: 0, label: "JB-0020", status: "in_progress", qty_planned: 50, qty_live: 50, stage_code: "setting", stage_name: "ฝังพลอย", stage_status: "received", ...o });
const part = (o: Record<string, unknown>): LotPart => mapLotPart(treeRow(o))!;

/** ตัวอย่าง JB-0020 = 100 ชิ้น: ส่วนหลัก 50 + ส่วน 1 (10) ที่ฝังพลอย · ส่วน 2 (5) ที่ QC · ส่วน 3 (34) ผ่าน QC แล้ว · เสีย 1 */
function jb0020(): JobLotsData {
  return {
    parts: [
      part({}),
      part({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty_planned: 10, qty_live: 10 }),
      part({ job_id: L2, lot_seq: 2, label: "JB-0020 · ส่วนที่ 2", qty_planned: 5, qty_live: 5, stage_code: "qc", stage_name: "ตรวจ QC" }),
      part({ job_id: L3, lot_seq: 3, label: "JB-0020 · ส่วนที่ 3", qty_planned: 34, qty_live: 34, stage_code: "pack", stage_name: "แพ็ก", qty_qc_passed: 34 }),
    ],
    summary: mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, qty_order: 100, parts_count: 4, parts_open: 4, lots_open: 3, qty_scrap_total: 1, qty_pending_explanation: 0, qty_qc_passed_total: 34, sum_check: true }),
    discrepancies: [],
  };
}

describe("แถบสะสมทั้งใบ — ผลรวมเท่าเริ่มผลิต", () => {
  it("JB-0020: เสร็จ 34 + ฝังพลอย 60 (50+10 รวมขั้นเดียวกัน) + QC 5 + เสีย 1 = 100", () => {
    const segs = lotSegments(jb0020());
    expect(segs.map((s) => `${s.label} ${s.qty}`)).toEqual(["เสร็จ 34", "ฝังพลอย 60", "ตรวจ QC 5", "เสีย 1"]);
    expect(segmentsTotal(segs)).toBe(100);
    expect(segs.find((s) => s.label === "ตรวจ QC")?.tone).toBe("qc");
    expect(segs.find((s) => s.label === "ฝังพลอย")?.tone).toBe("shop");
  });
  it("ส่วนที่ผ่าน QC แล้วนับที่ 'เสร็จ' ไม่นับซ้ำในถังขั้น (แพ็ก 34 ไม่ขึ้นซ้ำ)", () => {
    expect(lotSegments(jb0020()).some((s) => s.label === "แพ็ก")).toBe(false);
  });
  it("บรรทัดบอร์ด: เสร็จ x/N · ขั้น n · … ครบทุกถัง", () => {
    expect(lotsLine(jb0020())).toBe("เสร็จ 34/100 · ฝังพลอย 60 · ตรวจ QC 5 · เสีย 1");
  });
  it("ส่วนต่างรอชี้แจง/ชี้แจงแล้วเป็นถังแยก (ยอดรวมยังครบ)", () => {
    const l = jb0020();
    l.parts[0] = part({ qty_live: 45 });
    l.summary = mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, parts_count: 4, lots_open: 3, qty_scrap_total: 1, qty_pending_explanation: 3, qty_discrepancy_resolved: 2, qty_qc_passed_total: 34, sum_check: true });
    const segs = lotSegments(l);
    expect(segs.find((s) => s.key === "pending")).toMatchObject({ label: "รอชี้แจง", qty: 3 });
    expect(segs.find((s) => s.key === "resolved")?.qty).toBe(2);
    expect(lotsLine(l)).toContain("รอชี้แจง 3");
  });
  it("ไม่มีชิ้นผ่าน QC: 'เสร็จ 0/100' · ไม่มีสรุป: ไม่มีบรรทัด", () => {
    const l = { parts: [part({ qty_live: 100 })], summary: mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, parts_count: 1, sum_check: true }) };
    expect(lotsLine(l)).toBe("เสร็จ 0/100 · ฝังพลอย 100");
    expect(lotsLine({ parts: [], summary: null })).toBeNull();
  });
  it("ส่วนที่ยกเลิก/ปิดแล้วไม่นับเป็นถังขั้น", () => {
    const l = jb0020();
    l.parts[1] = part({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", status: "cancelled", qty_live: 10 });
    expect(lotSegments(l).find((s) => s.label === "ฝังพลอย")?.qty).toBe(50);
  });
  it("toBoardLots: ส่ง sum_check ของ DB ต่อ (ไม่คิดเอง)", () => {
    expect(toBoardLots(jb0020())).toMatchObject({ partsCount: 4, qtyPendingExplanation: 0, sumOk: true });
    const bad = { ...jb0020(), summary: mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, parts_count: 4, sum_check: false }) };
    expect(toBoardLots(bad)?.sumOk).toBe(false);
  });
});

describe("ส่วนต่างรอชี้แจง", () => {
  const ctx = { stageById: { s1: { name: "ขัด" }, s2: { name: "ฝังพลอย" } }, labelByJob: { [L1]: "JB-0020 · ส่วนที่ 1" } };
  const disc = (o: Record<string, unknown>) => mapDiscrepancy({ id: "d1", job_id: L1, from_stage_id: "s1", to_stage_id: "s2", qty: 5, status: "open", created_at: "2026-10-19T03:00:00Z", ...o }, ctx)!;
  it("map: ชื่อขั้นต้นทาง/ปลายทาง + ป้ายส่วน", () => {
    expect(disc({})).toMatchObject({ fromStageName: "ขัด", toStageName: "ฝังพลอย", lotLabel: "JB-0020 · ส่วนที่ 1", qty: 5, status: "open" });
  });
  it("แถว void ชี้มา = ไม่ถือว่ารอชี้แจง (แถวเดิมยัง status open ตามที่ DB เก็บ)", () => {
    const d1 = disc({});
    const v = disc({ id: "d2", status: "void", void_of_id: "d1" });
    expect(openDiscrepancies([d1])).toHaveLength(1);
    expect(openDiscrepancies([d1, v])).toHaveLength(0);
  });
  it("ชี้แจงแล้ว (resolved) ไม่นับ · แถวผิดรูป (qty ว่าง/สถานะแปลก) ถูกทิ้ง", () => {
    expect(openDiscrepancies([disc({ status: "resolved", resolved_kind: "lost", resolved_reason: "missing" })])).toHaveLength(0);
    expect(mapDiscrepancy({ id: "d9", job_id: L1, status: "weird", qty: 1 }, ctx)).toBeNull();
    expect(mapDiscrepancy({ id: "d9", job_id: L1, status: "open" }, ctx)).toBeNull();
  });
});

describe("ปุ่มปิด full — เหตุผลบนปุ่ม", () => {
  it("ใบเดี่ยวไม่มีส่วนค้าง/ส่วนต่าง = ไม่บล็อก", () => {
    expect(closeBlocker({ parts: [part({})], summary: null, discrepancies: [] })).toBeNull();
    expect(closeBlocker(null)).toBeNull();
    expect(closeBlocker(undefined)).toBeNull();
  });
  it("มีส่วนย่อยค้าง → บอกจำนวนส่วน", () => {
    expect(closeBlocker(jb0020())).toBe("ยังมีส่วนย่อยค้าง 3 ส่วน");
  });
  it("มีส่วนต่างรอชี้แจง → บอกจำนวนชิ้น · ทั้งสองอย่าง = ต่อกันด้วย ·", () => {
    const l = jb0020();
    l.summary = mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, lots_open: 0, qty_pending_explanation: 4, sum_check: true });
    expect(closeBlocker(l)).toBe("มีส่วนต่างรอชี้แจง 4 ชิ้น");
    l.summary = mapLotsSummary({ root_job_id: ROOT, qty_planned: 100, lots_open: 2, qty_pending_explanation: 4, sum_check: true });
    expect(closeBlocker(l)).toBe("ยังมีส่วนย่อยค้าง 2 ส่วน · มีส่วนต่างรอชี้แจง 4 ชิ้น");
  });
  it("ไม่มี summary: ถอยไปนับจาก parts/discrepancies ที่มี (ไม่ปล่อยให้กดแล้วค่อยโดน DB ปฏิเสธเงียบๆ)", () => {
    const l: JobLotsData = { parts: jb0020().parts, summary: null, discrepancies: [] };
    expect(closeBlocker(l)).toBe("ยังมีส่วนย่อยค้าง 3 ส่วน");
  });
  it("ส่วนย่อยที่ปิด/ยกเลิกแล้วไม่ทำให้ค้าง", () => {
    const l: JobLotsData = { parts: [part({}), part({ job_id: L1, lot_seq: 1, label: "x", status: "done" }), part({ job_id: L2, lot_seq: 2, label: "y", status: "cancelled" })], summary: null, discrepancies: [] };
    expect(closeBlocker(l)).toBeNull();
  });
});

describe("hasLots / splittableParts", () => {
  it("แสดงแผงเมื่อมีมากกว่า 1 ส่วน หรือมีส่วนต่าง — ใบเดี่ยว = ไม่แสดง", () => {
    expect(hasLots({ parts: [part({})], summary: null, discrepancies: [] })).toBe(false);
    expect(hasLots(jb0020())).toBe(true);
    expect(hasLots(null)).toBe(false);
    const d = mapDiscrepancy({ id: "d1", job_id: ROOT, qty: 2, status: "open" }, { stageById: {}, labelByJob: {} })!;
    expect(hasLots({ parts: [part({})], summary: null, discrepancies: [d] })).toBe(true);
  });
  it("แยกได้เฉพาะส่วนที่มีผู้ถือ (holdSeq) และถือ ≥ 2 ชิ้น", () => {
    const l = jb0020();
    l.parts[0].holdSeq = 3;
    l.parts[1].holdSeq = 3;
    l.parts[1].qtyLive = 1;
    expect(splittableParts(l).map((p) => p.lotSeq)).toEqual([0]);
  });
});

describe("บอร์ด — ใบเดี่ยวไม่เปลี่ยน · ใบแยกส่วนมีป้าย/คอลัมน์ตามขั้นที่มีชิ้นมาก", () => {
  const base: Record<string, unknown> = { id: ROOT, job_no: "JB-0020", seq: 20, source_kind: "production", design_label: "แหวน", metal: "silver", qty_planned: 100, status: "in_progress", current_stage_code: "cast", board_column: "cast", stage_count: 8, stage_done_count: 2 };
  const known = new Set(["cast", "setting", "qc"]);
  it("view เก่า/ใบเดี่ยว (ไม่มีคอลัมน์ใหม่) → BoardRow ไม่มี key ของ 0181 เลย", () => {
    const r = mapBoardRow(base)!;
    for (const k of ["partsCount", "partsOpen", "qtyPendingExplanation", "dominantStageCode", "lotsLine", "lotsSumOk"]) expect(k in r).toBe(false);
    expect(columnOf(r, known)).toBe("cast");
    expect(statusSignals(r, "2026-10-19").map((s) => s.key)).not.toContain("partial");
  });
  it("ใบเดี่ยวที่ view ส่ง parts_count=1: ไม่ขึ้นป้าย 'n ส่วน' และอยู่คอลัมน์เดิม (ไม่ใช้ dominant)", () => {
    const r = mapBoardRow({ ...base, parts_count: 1, parts_open: 1, qty_pending_explanation: 0, dominant_stage_code: "setting" })!;
    expect(r.dominantStageCode).toBeUndefined();
    expect(columnOf(r, known)).toBe("cast");
    expect(statusSignals(r, "2026-10-19").some((s) => s.key === "partial")).toBe(false);
  });
  it("ใบแยกส่วน: ป้าย '4 ส่วน' (sky) + อยู่คอลัมน์ของขั้นที่มีชิ้นมากสุด", () => {
    const r = mapBoardRow({ ...base, parts_count: 4, parts_open: 4, qty_pending_explanation: 0, dominant_stage_code: "setting" })!;
    expect(columnOf(r, known)).toBe("setting");
    expect(statusSignals(r, "2026-10-19").find((s) => s.key === "partial")).toMatchObject({ label: "4 ส่วน", tone: "blue" });
  });
  it("รอชี้แจง n ชิ้น = ป้ายต้องดู (amber) · เป็นป้ายหลักเมื่อไม่มีอะไรด่วนกว่า", () => {
    const r = mapBoardRow({ ...base, parts_count: 2, qty_pending_explanation: 5, dominant_stage_code: "setting" })!;
    const s = statusSignals(r, "2026-10-19").find((x) => x.key === "pendingExplain");
    expect(s).toMatchObject({ label: "รอชี้แจง 5 ชิ้น", tone: "amber" });
    expect(primaryStatus(r, "2026-10-19").key).toBe("pendingExplain");
  });
  it("เลยกำหนดยังเด่นกว่ารอชี้แจง", () => {
    const r: BoardRow = { ...mapBoardRow({ ...base, parts_count: 2, qty_pending_explanation: 5, is_overdue: true, due_date: "2026-10-01" })! };
    expect(primaryStatus(r, "2026-10-19").key).toBe("overdue");
  });
  it("BOARD_COLUMNS มีคอลัมน์ใหม่ของ 0181 ที่ loader ใช้", () => {
    for (const c of ["parent_job_id", "parts_count", "parts_open", "qty_pending_explanation", "dominant_stage_code"]) expect(BOARD_COLUMNS).toContain(c);
  });
  it("M-A/M-B/L-1: BOARD_COLUMNS มี tree_* · mapBoardRow ใส่ key เฉพาะที่ view ส่งมา (ไม่มี = บอร์ดเดิมเป๊ะ · mismatch count 0 = ไม่มี key)", () => {
    for (const c of ["tree_handoff_gap_g", "tree_handoff_gap_partial_g", "tree_handoff_mismatch_count", "tree_weight_gap_excess_g", "tree_lot_first_gap_sum_g"]) expect(BOARD_COLUMNS).toContain(c);
    const plain = mapBoardRow({ ...base })!;
    for (const k of ["treeHandoffGapG", "treeHandoffGapPartialG", "treeHandoffMismatchCount", "treeWeightGapExcessG", "treeLotFirstGapSumG"]) expect(plain, k).not.toHaveProperty(k);
    const withTree = mapBoardRow({ ...base, tree_handoff_gap_g: 0.04, tree_handoff_gap_partial_g: "4", tree_handoff_mismatch_count: 1, tree_weight_gap_excess_g: -0.5, tree_lot_first_gap_sum_g: -0.08 })!;
    expect(withTree).toMatchObject({ treeHandoffGapG: 0.04, treeHandoffGapPartialG: 4, treeHandoffMismatchCount: 1, treeWeightGapExcessG: -0.5, treeLotFirstGapSumG: -0.08 });
    expect(mapBoardRow({ ...base, tree_handoff_mismatch_count: 0 })!).not.toHaveProperty("treeHandoffMismatchCount");
  });
});

describe("M-A/M-B/M-C — mapper ของข้อมูลน้ำหนักทั้งต้นไม้ (office เท่านั้น)", () => {
  it("mapTreeStageLoss: แถวไม่มี id = null · ตัวเลขจาก view ตรงๆ (ไม่คำนวณซ้ำ)", () => {
    expect(mapTreeStageLoss({ job_id: null, job_stage_id: "s1" })).toBeNull();
    expect(mapTreeStageLoss({ job_id: L1, job_stage_id: null })).toBeNull();
    expect(mapTreeStageLoss({ root_job_id: ROOT, lot_seq: 1, job_id: L1, job_stage_id: "s9", stage_code: "setting", status: "received", weighed: true, loss_g: "0.1", handoff_gap_g: null, handoff_gap_partial_g: "-4", cancel_scrap_weight_g: "3.5" }))
      .toMatchObject({ jobId: L1, jobStageId: "s9", lotSeq: 1, weighed: true, lossG: 0.1, handoffGapG: null, handoffGapPartialG: -4, notComparable: false, cancelScrapWeightG: 3.5 });
  });
  it("mapDiscrepancy: weight_sent_g / qty_sent / weight_gap_excess_g (ไม่มี = null)", () => {
    const ctx = { stageById: {}, labelByJob: {} };
    expect(mapDiscrepancy({ id: "d1", job_id: L1, qty: 1, status: "open" }, ctx)).toMatchObject({ weightGapG: null, weightSentG: null, qtySent: null, weightGapExcessG: null });
    expect(mapDiscrepancy({ id: "d1", job_id: L1, qty: 1, status: "open", weight_gap_g: -1.5, weight_sent_g: 10, qty_sent: 10, weight_gap_excess_g: -0.5 }, ctx))
      .toMatchObject({ weightGapG: -1.5, weightSentG: 10, qtySent: 10, weightGapExcessG: -0.5 });
  });
  it("mapLotPart / mapLotsSummary: น้ำหนักของเสียที่เลิกใช้ (M-C) · ไม่มี = null / 0", () => {
    expect(part({}).cancelScrapWeightG).toBeNull();
    expect(part({ cancel_scrap_weight_g: "3.5" }).cancelScrapWeightG).toBe(3.5);
    expect(part({}).weightScrapGapG).toBeNull();
    expect(part({ cancel_scrap_weight_g: "15", weight_scrap_gap_g: "5" }).weightScrapGapG).toBe(5);
    expect(mapLotsSummary({ root_job_id: ROOT })!.weightScrapCancelG).toBe(0);
    expect(mapLotsSummary({ root_job_id: ROOT, weight_scrap_cancel_g: "3.5" })!.weightScrapCancelG).toBe(3.5);
  });
});

describe("0181 re-review: บอร์ดทองทั้งต้นไม้ (M-A) · note ตอนชี้แจง (M-B) · loss ทั้งต้นไม้", () => {
  const goldSplit = (o: Record<string, unknown>) =>
    mapBoardRow({ id: ROOT, job_no: "JB-0020", seq: 20, source_kind: "production", design_label: "แหวน", metal: "gold", qty_planned: 100, status: "in_progress", current_stage_code: "cast", board_column: "cast", parts_count: 3, parts_open: 3, dominant_stage_code: "setting", ...o })!;
  const keys = (r: BoardRow) => statusSignals(r, "2026-10-19").map((s) => s.key);

  it("ทอง + หลายส่วน: excess < −0.05 หรือ lot_first_gap_sum < −0.05 → ป้าย 'ทอง: น้ำหนักหายเกินสัดส่วน'", () => {
    expect(keys(goldSplit({ tree_weight_gap_excess_g: -0.2 }))).toContain("goldWeight");
    expect(keys(goldSplit({ tree_lot_first_gap_sum_g: -0.06 }))).toContain("goldWeight");
    const s = statusSignals(goldSplit({ tree_weight_gap_excess_g: -0.2 }), "2026-10-19").find((x) => x.key === "goldWeight");
    expect(s).toMatchObject({ label: "ทอง: น้ำหนักหายเกินสัดส่วน", tone: "amber" });
  });
  it("ขอบ: −0.05 พอดี / บวก / ไม่มีค่า → ไม่ขึ้น", () => {
    expect(keys(goldSplit({ tree_weight_gap_excess_g: -0.05, tree_lot_first_gap_sum_g: -0.05 }))).not.toContain("goldWeight");
    expect(keys(goldSplit({ tree_weight_gap_excess_g: 0.4, tree_lot_first_gap_sum_g: 1 }))).not.toContain("goldWeight");
    expect(keys(goldSplit({}))).not.toContain("goldWeight");
  });
  it("เงินที่แยกส่วน/ใบทองเดี่ยว: ไม่ขึ้นป้ายน้ำหนักทองแม้ค่าลบมาก", () => {
    expect(keys(goldSplit({ metal: "silver", tree_weight_gap_excess_g: -5 }))).not.toContain("goldWeight");
    expect(keys(goldSplit({ parts_count: 1, tree_weight_gap_excess_g: -5 }))).not.toContain("goldWeight");
  });
  it("ชั่งไม่ตรง: ใบที่แยกส่วนใช้จำนวนทั้งต้นไม้ (มากกว่าของใบแม่) · ใบเดี่ยวใช้ของใบเอง ไม่สน tree_*", () => {
    const a = goldSplit({ handoff_mismatch_count: 1, tree_handoff_mismatch_count: 3 });
    expect(statusSignals(a, "2026-10-19").find((s) => s.key === "mismatch")?.label).toBe("ชั่งไม่ตรง 3 ครั้ง");
    const b = goldSplit({ parts_count: 1, handoff_mismatch_count: 1, tree_handoff_mismatch_count: 3 });
    expect(statusSignals(b, "2026-10-19").find((s) => s.key === "mismatch")?.label).toBe("ชั่งไม่ตรง 1 ครั้ง");
  });
  it("ส่วนต่างส่งมอบ: ใบที่แยกส่วนใช้ tree_handoff_gap_g (ขั้นแรกของส่วนย่อยมองเห็น) · ไม่มี tree = ของใบแม่", () => {
    expect(statusSignals(goldSplit({ handoff_gap_g: 0.1, tree_handoff_gap_g: 0.8 }), "2026-10-19").find((s) => s.key === "handoff")?.label).toBe("ส่วนต่างส่งมอบ 0.8 g");
    expect(statusSignals(goldSplit({ handoff_gap_g: 0.1 }), "2026-10-19").find((s) => s.key === "handoff")?.label).toBe("ส่วนต่างส่งมอบ 0.1 g");
  });
  it("mapBoardRow: key tree_* ใส่เมื่อมีค่า (mismatch เฉพาะ > 0) · view เก่า = ไม่มี key", () => {
    const r = goldSplit({ tree_handoff_gap_g: 0.8, tree_handoff_gap_partial_g: 0.3, tree_handoff_mismatch_count: 0, tree_weight_gap_excess_g: -0.2, tree_lot_first_gap_sum_g: -0.1 });
    expect(r).toMatchObject({ treeHandoffGapG: 0.8, treeHandoffGapPartialG: 0.3, treeWeightGapExcessG: -0.2, treeLotFirstGapSumG: -0.1 });
    expect("treeHandoffMismatchCount" in r).toBe(false);
    const old = mapBoardRow({ id: ROOT, job_no: "JB-0020", seq: 20, metal: "gold" })!;
    for (const k of ["treeHandoffGapG", "treeHandoffGapPartialG", "treeHandoffMismatchCount", "treeWeightGapExcessG", "treeLotFirstGapSumG"]) expect(k in old).toBe(false);
  });

  it("noteRequired: ทอง + excess < −0.05 เท่านั้น", () => {
    const d = (excess: number | null) => ({ weightGapExcessG: excess });
    expect(noteRequired(d(-0.06), true)).toBe(true);
    expect(noteRequired(d(-0.05), true)).toBe(false);
    expect(noteRequired(d(-3), false)).toBe(false);
    expect(noteRequired(d(null), true)).toBe(false);
    expect(noteRequired(d(0.5), true)).toBe(false);
  });
  it("mapDiscrepancy: weightSentG/qtySent/weightGapExcessG จาก v_job_discrepancy (DB คำนวณ)", () => {
    const d = mapDiscrepancy({ id: "d1", job_id: L1, qty: 5, status: "open", weight_gap_g: -2.25, weight_sent_g: 20, qty_sent: 10, weight_gap_excess_g: -0.25 }, { stageById: {}, labelByJob: {} })!;
    expect(d).toMatchObject({ weightGapG: -2.25, weightSentG: 20, qtySent: 10, weightGapExcessG: -0.25 });
  });
  it("mapTreeStageLoss + rootLossFromTree: ใบแม่ (lotSeq 0) แทน loss เดิม · ส่วนย่อยไม่ปนเข้าตารางขั้นของใบแม่", () => {
    const a = mapTreeStageLoss({ job_id: ROOT, job_stage_id: "s1", lot_seq: 0, stage_code: "cast", loss_g: 1.2, loss_pct: 3, warn: false, handoff_gap_g: null, handoff_gap_partial_g: 0.4 })!;
    const b = mapTreeStageLoss({ job_id: L1, job_stage_id: "s9", lot_seq: 1, stage_code: "polish", loss_g: 0.5, not_comparable: true })!;
    expect(mapTreeStageLoss({ job_id: ROOT })).toBeNull();
    const m = rootLossFromTree([a, b]);
    expect(Object.keys(m)).toEqual(["s1"]);
    expect(m.s1).toMatchObject({ lossG: 1.2, lossPct: 3, handoffGapPartialG: 0.4 });
    expect("handoffGapPartialG" in rootLossFromTree([{ ...a, handoffGapPartialG: null }]).s1).toBe(false);
  });
  it("mapLotPart: น้ำหนักของเสียที่เลิกใช้ + ค่าเริ่มของขั้นรอรับ/ล็อก", () => {
    const p = mapLotPart({ job_id: L1, label: "x", cancel_scrap_weight_g: 2.5 })!;
    expect(p).toMatchObject({ cancelScrapWeightG: 2.5, hasWeighStage: false, pendingSeq: null, receiveLocked: false });
  });
});

describe("0181 security delta: scrapNoteRequired (L-new-1) · weightScrapGapG · receive_locked จาก view", () => {
  it("ล่าสุด − เศษ > 0.05 → ต้องมีคำอธิบาย · = 0.05 พอดี / น้อยกว่า / เศษมากกว่าล่าสุด → ไม่ต้อง", () => {
    expect(scrapNoteRequired(10, 9.9)).toBe(true);
    expect(scrapNoteRequired(10, 9.95)).toBe(false); // gap 0.05 พอดี (ปัดทศนิยม 3 ตำแหน่งกัน float)
    expect(scrapNoteRequired(10.05, 10)).toBe(false);
    expect(scrapNoteRequired(10, 10)).toBe(false);
    expect(scrapNoteRequired(10, 12)).toBe(false);
    expect(scrapNoteRequired(0.3, 0.2)).toBe(true);
  });
  it("ยังไม่รู้น้ำหนักล่าสุด/ยังไม่กรอกเศษ → ไม่บังคับ (DB ตัดสินจริง)", () => {
    expect(scrapNoteRequired(null, 5)).toBe(false);
    expect(scrapNoteRequired(5, null)).toBe(false);
  });
  it("mapLotPart: weightScrapGapG จาก v_job_tree · receive_locked ที่ view ให้มา = ล็อก (ไม่ให้ = ไม่ล็อก)", () => {
    expect(mapLotPart({ job_id: L1, label: "x", weight_scrap_gap_g: 0.12 })!.weightScrapGapG).toBe(0.12);
    expect(mapLotPart({ job_id: L1, label: "x" })!.weightScrapGapG).toBeNull();
    expect(mapLotPart({ job_id: L1, label: "x", receive_locked: true })!.receiveLocked).toBe(true);
    expect(mapLotPart({ job_id: L1, label: "x", receive_locked: false })!.receiveLocked).toBe(false);
  });
});
