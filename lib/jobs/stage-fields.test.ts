// stageFieldPlan (0176): หน้าช่างต้องแสดงช่อง/ปุ่ม/บรรทัดบอกอะไรในขั้นนี้ — pure
import { describe, expect, it } from "vitest";
import { stageFieldPlan } from "@/lib/jobs/stage-fields";

describe("ใบเดิม (hasProfile ไม่ใช่ true) = UI เดิมทุกประการ", () => {
  it.each([[undefined], [false]])("hasProfile=%s: ช่องน้ำหนัก + ชิ้นเสีย + เติมโลหะ ทุกขั้น · ไม่ถามเศษ · ไม่มีบรรทัดบอก (แม้ flag ดูปิด)", (hasProfile) => {
    for (const weightRequired of [true, false]) {
      const p = stageFieldPlan({ hasProfile, weightRequired, scrapQtyAsk: false, scrapWeightAsk: true });
      expect(p).toEqual({ legacy: true, showWeight: true, showScrapStepper: true, showScrapButton: false, showScrapWeight: false, showAddMetal: true, receiveNote: null, sendNote: null });
    }
  });
});

describe("ใบที่มีแบบ", () => {
  const base = { hasProfile: true as const };
  it("ชั่ง: ช่องน้ำหนัก + เติมโลหะ · ไม่มีบรรทัดบอก", () => {
    const p = stageFieldPlan({ ...base, weightRequired: true, scrapQtyAsk: true });
    expect(p).toMatchObject({ showWeight: true, showAddMetal: true, receiveNote: null, sendNote: null, showScrapStepper: true, showScrapButton: false });
  });
  it("ไม่ชั่งแต่ถามชิ้นเสีย: ไม่มีช่องน้ำหนัก/เติมโลหะ · บอก 'ไม่ต้องชั่งน้ำหนัก' ทั้งรับ/ส่ง", () => {
    const p = stageFieldPlan({ ...base, weightRequired: false, scrapQtyAsk: true });
    expect(p).toMatchObject({ showWeight: false, showAddMetal: false, receiveNote: "ขั้นนี้ไม่ต้องชั่งน้ำหนัก", sendNote: "ขั้นนี้ไม่ต้องชั่งน้ำหนัก" });
  });
  it("ปิดทั้ง 3: บรรทัดบอกของรับ/ส่ง · ปุ่ม '+ แจ้งของเสีย' แทน stepper", () => {
    const p = stageFieldPlan({ ...base, weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: false });
    expect(p).toMatchObject({ receiveNote: "ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย", sendNote: "ขั้นนี้ไม่ต้องชั่งหรือแจ้งของเสีย — กดส่งต่อได้เลย", showScrapStepper: false, showScrapButton: true });
  });
  it("🔴 เปิด '+ แจ้งของเสียในขั้นนี้' แล้ว: stepper ขึ้น · บรรทัดส่งไม่บอกว่า 'ไม่ต้องแจ้งของเสีย' (เปลี่ยนเป็นไม่ต้องชั่ง) · ปุ่มหาย · บรรทัดรับไม่เปลี่ยน", () => {
    const p = stageFieldPlan({ ...base, weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, scrapOpen: true });
    expect(p).toMatchObject({ showScrapStepper: true, showScrapButton: false, sendNote: "ขั้นนี้ไม่ต้องชั่งน้ำหนัก", receiveNote: "ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย" });
  });
  it("ถามเศษ: ช่องเศษขึ้น · ไม่ใช่ 'ปิดทั้ง 3' แล้ว", () => {
    const p = stageFieldPlan({ ...base, weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: true });
    expect(p).toMatchObject({ showScrapWeight: true, receiveNote: "ขั้นนี้ไม่ต้องชั่งน้ำหนัก", sendNote: "ขั้นนี้ไม่ต้องชั่งน้ำหนัก" });
  });
  it("flag ไม่มี key = ค่าเริ่มของ DB: ถามชิ้นเสีย · ไม่ถามเศษ", () => {
    expect(stageFieldPlan({ ...base, weightRequired: true })).toMatchObject({ showScrapStepper: true, showScrapWeight: false });
  });
});
