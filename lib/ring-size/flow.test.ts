import { describe, expect, it } from "vitest";
import {
  MEASURE_SCREENS,
  SCREEN_IDS,
  backDestination,
  calibrationScreenFor,
  isScreenId,
  otherRef,
  remeasureDestination,
  resolveScreen,
  startDestination,
  stepCounter,
  teachScreenFor,
} from "./flow";

describe("stepCounter (B13)", () => {
  it("คนใหม่: 01/03 → 02/03 → 03/03", () => {
    for (const s of ["R1Pick", "R1", "R2", "R2Coin"] as const) expect(stepCounter(s, false)).toEqual({ current: 1, total: 3 });
    for (const s of ["R3", "R4A", "R4B", "R5A", "R5B"] as const) expect(stepCounter(s, false)).toEqual({ current: 2, total: 3 });
    expect(stepCounter("R6", false)).toEqual({ current: 3, total: 3 });
  });
  it("คนกลับมา (ข้ามขั้น 1): 01/02 ที่ R3–R5 → 02/02 ที่ R6", () => {
    for (const s of ["R3", "R4A", "R4B", "R5A", "R5B"] as const) expect(stepCounter(s, true)).toEqual({ current: 1, total: 2 });
    expect(stepCounter("R6", true)).toEqual({ current: 2, total: 2 });
  });
  it("R0 ไม่มีตัวนับ · จอเทียบเป็น 01/03 เสมอแม้เคยข้าม (เพราะกำลังทำขั้น 1)", () => {
    expect(stepCounter("R0", false)).toBeNull();
    expect(stepCounter("R2Coin", true)).toEqual({ current: 1, total: 3 });
  });
});

describe("startDestination — กด 'เริ่มวัดไซส์'", () => {
  it("ไม่มีค่าเทียบ → R1Pick (ไม่ข้ามขั้น)", () => {
    expect(startDestination({ calibration: null, stale: false })).toEqual({ screen: "R1Pick", g5: false, skipped: false });
  });
  it("มีค่าเทียบที่ใช้ได้ → R3 ข้ามขั้น 1", () => {
    expect(startDestination({ calibration: { ref: "coin" }, stale: false })).toEqual({ screen: "R3", g5: false, skipped: true });
  });
  it("ค่าเก่าไม่ตรงเครื่อง (G5) → จอเทียบของ ref เดิม ข้าม R1Pick พร้อมแถบ G5 (A5)", () => {
    expect(startDestination({ calibration: { ref: "coin" }, stale: true })).toEqual({ screen: "R2Coin", g5: true, skipped: false });
    expect(startDestination({ calibration: { ref: "card" }, stale: true })).toEqual({ screen: "R2", g5: true, skipped: false });
  });
});

describe("resolveScreen — ด่านกันเข้าจอโดยไม่มีของที่ต้องใช้", () => {
  const none = { hasCalibration: false, hasResult: false, hasInvalid: false };
  it("จอวัดโดยไม่มีค่าเทียบ → R1Pick พร้อมข้อความ", () => {
    for (const s of MEASURE_SCREENS) expect(resolveScreen(s, none)).toEqual({ screen: "R1Pick", missingCalibration: true });
  });
  it("จอวัดเมื่อมีค่าเทียบ → ผ่าน", () => {
    for (const s of MEASURE_SCREENS) expect(resolveScreen(s, { ...none, hasCalibration: true })).toEqual({ screen: s, missingCalibration: false });
  });
  it("R6 ไม่มีผลวัด → R0 · G4 ไม่มีค่าผิดปกติ → R0 · มีของครบ → ผ่าน", () => {
    expect(resolveScreen("R6", none).screen).toBe("R0");
    expect(resolveScreen("G4", none).screen).toBe("R0");
    expect(resolveScreen("R6", { ...none, hasResult: true }).screen).toBe("R6");
    expect(resolveScreen("G4", { ...none, hasInvalid: true }).screen).toBe("G4");
  });
  it("จอที่ไม่ต้องใช้อะไร ผ่านเสมอ", () => {
    for (const s of ["R0", "R1Pick", "R1", "R2", "R2Coin"] as const) expect(resolveScreen(s, none).screen).toBe(s);
  });
});

describe("backDestination — คำนวณจาก state ไม่ผูกตายตัว (build spec ข้อ 1)", () => {
  const ctx = { ref: "coin" as const, method: "A" as const, calibratedThisFlow: true };
  it("R1Pick → R0 · R1 → R1Pick · R2Coin → R1Pick · R2 → R1", () => {
    expect(backDestination("R1Pick", ctx)).toBe("R0");
    expect(backDestination("R1", ctx)).toBe("R1Pick");
    expect(backDestination("R2Coin", ctx)).toBe("R1Pick");
    expect(backDestination("R2", ctx)).toBe("R1");
  });
  it("R3: เพิ่งเทียบ → จอเทียบของ ref ปัจจุบัน · ข้ามขั้น 1 → R0", () => {
    expect(backDestination("R3", { ...ctx, ref: "coin" })).toBe("R2Coin");
    expect(backDestination("R3", { ...ctx, ref: "card" })).toBe("R2");
    expect(backDestination("R3", { ...ctx, calibratedThisFlow: false })).toBe("R0");
  });
  it("R4A→R3 · R4B→R3 · R5A→R4A · R5B→R4B", () => {
    expect(backDestination("R4A", ctx)).toBe("R3");
    expect(backDestination("R4B", ctx)).toBe("R3");
    expect(backDestination("R5A", ctx)).toBe("R4A");
    expect(backDestination("R5B", ctx)).toBe("R4B");
  });
  it("R6/G4 → จอวัดตาม method · R6 ที่เปิดจากการ์ดผลล่าสุด → R0", () => {
    expect(backDestination("R6", { ...ctx, method: "A" })).toBe("R5A");
    expect(backDestination("R6", { ...ctx, method: "B" })).toBe("R5B");
    expect(backDestination("G4", { ...ctx, method: "B" })).toBe("R5B");
    expect(backDestination("R6", { ...ctx, resultFromHome: true })).toBe("R0");
  });
  it("G4 'วัดใหม่' → R5A ถ้า A · R5B ถ้า B", () => {
    expect(remeasureDestination("A")).toBe("R5A");
    expect(remeasureDestination("B")).toBe("R5B");
  });
});

describe("helper", () => {
  it("calibrationScreenFor / teachScreenFor / otherRef (เหรียญไม่มีจอสอน)", () => {
    expect(calibrationScreenFor("coin")).toBe("R2Coin");
    expect(calibrationScreenFor("card")).toBe("R2");
    expect(teachScreenFor("coin")).toBe("R2Coin");
    expect(teachScreenFor("card")).toBe("R1");
    expect(otherRef("coin")).toBe("card");
    expect(otherRef("card")).toBe("coin");
  });
  it("ไม่มีจอ R1Coin อีกต่อไป (ยุบเข้า R2Coin — มติ Q2)", () => {
    expect(SCREEN_IDS as readonly string[]).not.toContain("R1Coin");
    expect(isScreenId("R1Coin")).toBe(false);
    expect(isScreenId("R2Coin")).toBe(true);
    expect(isScreenId(5)).toBe(false);
  });
});
