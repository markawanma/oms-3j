// ใบงาน A5 ติดถุงงาน = เอกสารที่คนนอกห้องออฟฟิศเห็น → ห้ามมีราคา/ต้นทุน/ลูกค้า/เลขอ้างอิง/เหตุผลก่อนมัดจำ
import { describe, expect, it } from "vitest";
import { toPrintableJob } from "./print";
import { findForbiddenKeys } from "./worker-view";
import type { JobDetail, StageRow } from "./types";

const job = (o: Partial<JobDetail> = {}): JobDetail => ({
  id: "j1", jobNo: "JB-0007", sourceKind: "oem", designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, qtyGood: null, qtyScrap: null, weightStartG: 120.5, weightFinalG: null,
  dueDate: "2026-10-30", status: "open", currentStageCode: null, startGateNote: "ลูกค้าประจำ ไม่ต้องรอมัดจำ", createdAt: "2026-10-12T00:00:00Z", doneAt: null, cancelledAt: null,
  cancelReason: null, note: "หมายเหตุภายใน: ลูกค้า บริษัท ลับ จำกัด สั่ง", oemQuoteItemId: "i-secret", productionOrderItemId: null, qtyOrder: 12, targetPieceG: null, metalPlanG: null, metalPlanBasis: null, surplusDisposition: null, surplusNote: null, profileId: null, profileName: null, requireFinalWeight: false, weighRequired: false, ...o,
});
const stage = (seq: number, name: string, status: StageRow["status"] = "pending", weigh = false): StageRow => ({
  id: `s${seq}`, seq, code: `c${seq}`, name, status, weighRequired: weigh, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: false, receivedOn: null, sentOn: null, workerId: null, holderName: "ช่างลับ", autoClosed: false, qtyIn: null, qtyOut: null,
  qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: "โน้ตลับ", skipReason: null,
});

describe("toPrintableJob", () => {
  it("ประกอบทีละ field — OEM = 'งานลูกค้า' ไม่มีชื่อลูกค้า/เลขใบเสนอราคา/เหตุผลก่อนมัดจำ/หมายเหตุภายใน/id ต้นทาง", () => {
    const p = toPrintableJob(job(), [stage(1, "หล่อ", "pending", true), stage(2, "ขัด")]);
    expect(Object.keys(p).sort()).toEqual(["designLabel", "dueDate", "gems", "gemsState", "jobId", "jobNo", "metalLabel", "metalPlanG", "primaryPhotoUrl", "profileName", "qtyOrder", "qtyPlanned", "sku", "sourceLabel", "stages", "targetPieceG", "weightStartG"]);
    expect(p.sourceLabel).toBe("งานลูกค้า");
    const json = JSON.stringify(p);
    for (const secret of ["บริษัท ลับ", "ลูกค้าประจำ", "i-secret", "ช่างลับ", "โน้ตลับ", "หมายเหตุภายใน"]) expect(json).not.toContain(secret);
    expect(findForbiddenKeys(p)).toEqual([]);
  });
  it("🔴 ใบทอง: ไม่มี target/แผนโลหะ/น้ำหนักตั้งต้น (null ที่ type boundary แม้ JobDetail มีค่า) · ใบเงินและทองเหลืองยังมีครบ", () => {
    const plan = { targetPieceG: 4, metalPlanG: 48.5, weightStartG: 120.5 };
    const g = toPrintableJob(job({ metal: "gold", ...plan }), [stage(1, "หล่อ", "pending", true)]);
    expect([g.targetPieceG, g.metalPlanG, g.weightStartG]).toEqual([null, null, null]);
    expect(JSON.stringify(g)).not.toMatch(/48.5|120.5/);
    for (const m of ["silver", "brass"]) {
      const p = toPrintableJob(job({ metal: m, ...plan }), []);
      expect([p.targetPieceG, p.metalPlanG, p.weightStartG]).toEqual([4, 48.5, 120.5]);
    }
  });
  it("แต่ละขั้นมีเฉพาะ ลำดับ/ชื่อ/บังคับชั่ง — ไม่มีวัน/ช่าง/น้ำหนักของใบเก่า", () => {
    const p = toPrintableJob(job(), [stage(1, "หล่อ", "sent", true)]);
    expect(Object.keys(p.stages[0]).sort()).toEqual(["name", "scrapQtyAsk", "scrapWeightAsk", "seq", "weighRequired"]);
  });
  it("ขั้นที่ข้ามแล้วไม่ถูกพิมพ์ · ผลิตเข้าสต็อก = ป้ายของมัน", () => {
    const p = toPrintableJob(job({ sourceKind: "production" }), [stage(1, "หล่อ"), stage(2, "ชุบ", "skipped"), stage(3, "แพ็ก")]);
    expect(p.stages.map((s) => s.name)).toEqual(["หล่อ", "แพ็ก"]);
    expect(p.sourceLabel).toBe("ผลิตเข้าสต็อก");
  });
  it("โลหะ: label ไทย · ไม่รู้จักคงค่าเดิม", () => {
    expect(toPrintableJob(job({ metal: "gold" }), []).metalLabel).toBe("ทอง");
    expect(toPrintableJob(job({ metal: "platinum" }), []).metalLabel).toBe("platinum");
  });
});
