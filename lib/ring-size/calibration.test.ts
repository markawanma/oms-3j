import { describe, expect, it } from "vitest";
import {
  CALIBRATION_STORAGE_KEY,
  LAST_RESULT_STORAGE_KEY,
  clampPpm,
  computePxPerMm,
  isStaleCalibration,
  isTypicalPxPerMm,
  maxPpmFor,
  parseCalibration,
  parseLastResult,
  readCalibration,
  readLastResult,
  refPxFor,
  startPpmFromDpr,
  stepPpm,
  writeCalibration,
  writeLastResult,
  type Calibration,
  type StorageLike,
} from "./calibration";

const GOOD: Calibration = { pxPerMm: 6, ref: "coin", dpr: 2, screenShort: 390, screenLong: 844, savedAt: 1_700_000_000_000, version: 1 };

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

describe("computePxPerMm / refPxFor (test ข้อ 6 ของ build spec)", () => {
  it("เหรียญ: เส้นผ่านศูนย์กลาง 156 px → 6 px/มม.", () => {
    expect(computePxPerMm("coin", 156)).toBe(6);
  });
  it("บัตร: ความกว้าง 323.88 px → ≈ 6 px/มม.", () => {
    expect(computePxPerMm("card", 323.88)).toBeCloseTo(6, 10);
  });
  it("refPxFor เป็นส่วนกลับของ computePxPerMm", () => {
    for (const ppm of [4.5, 6, 7.5]) {
      expect(computePxPerMm("coin", refPxFor("coin", ppm))).toBeCloseTo(ppm, 10);
      expect(computePxPerMm("card", refPxFor("card", ppm))).toBeCloseTo(ppm, 10);
    }
  });
});

describe("parseCalibration — ค่าเสีย = ทิ้งทั้งก้อน (A4)", () => {
  it("ค่าที่ถูกต้องผ่าน", () => {
    expect(parseCalibration(GOOD)).toEqual(GOOD);
  });
  it.each([
    ["null", null],
    ["ข้อความ", "hello"],
    ["array", [GOOD]],
    ["ref นอก whitelist", { ...GOOD, ref: "ruler" }],
    ["ref ไม่มี", { ...GOOD, ref: undefined }],
    ["version ผิด", { ...GOOD, version: 2 }],
    ["version ไม่มี", { ...GOOD, version: undefined }],
    ["pxPerMm เป็นข้อความ", { ...GOOD, pxPerMm: "6" }],
    ["pxPerMm NaN", { ...GOOD, pxPerMm: Number.NaN }],
    ["pxPerMm Infinity", { ...GOOD, pxPerMm: Number.POSITIVE_INFINITY }],
    ["pxPerMm ต่ำกว่า 2.0", { ...GOOD, pxPerMm: 1.99 }],
    ["pxPerMm เกิน 12.0", { ...GOOD, pxPerMm: 12.01 }],
    ["dpr 0", { ...GOOD, dpr: 0 }],
    ["dpr ติดลบ", { ...GOOD, dpr: -1 }],
    ["screenShort ไม่มี", { ...GOOD, screenShort: undefined }],
    ["screenLong NaN", { ...GOOD, screenLong: Number.NaN }],
    ["savedAt 0", { ...GOOD, savedAt: 0 }],
  ])("ทิ้ง: %s", (_label, raw) => {
    expect(parseCalibration(raw)).toBeNull();
  });
  it("ขอบช่วง 2.0 และ 12.0 ผ่าน", () => {
    expect(parseCalibration({ ...GOOD, pxPerMm: 2 })).not.toBeNull();
    expect(parseCalibration({ ...GOOD, pxPerMm: 12 })).not.toBeNull();
  });
  it("ไม่เก็บ field อื่นที่แอบมากับก้อน (เก็บเฉพาะที่กำหนด)", () => {
    const parsed = parseCalibration({ ...GOOD, name: "somebody", phone: "000" })!;
    expect(Object.keys(parsed).sort()).toEqual(["dpr", "pxPerMm", "ref", "savedAt", "screenLong", "screenShort", "version"]);
  });
});

describe("read/write calibration — storage เสีย/ถูกบล็อก ไม่ crash (B2 / A4)", () => {
  it("เขียนแล้วอ่านกลับได้ และเก็บใต้ key เดียว", () => {
    const st = memoryStorage();
    expect(writeCalibration(GOOD, st)).toBe(true);
    expect(Object.keys(st.data)).toEqual([CALIBRATION_STORAGE_KEY]);
    expect(readCalibration(st)).toEqual(GOOD);
  });
  it("JSON เสีย → null", () => {
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: "{not json" }))).toBeNull();
  });
  it("ข้อความธรรมดา/ตัวเลข → null", () => {
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: "banana" }))).toBeNull();
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: "6" }))).toBeNull();
  });
  it("ref/version/ช่วงผิดใน storage → null", () => {
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: JSON.stringify({ ...GOOD, ref: "x" }) }))).toBeNull();
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: JSON.stringify({ ...GOOD, version: 9 }) }))).toBeNull();
    expect(readCalibration(memoryStorage({ [CALIBRATION_STORAGE_KEY]: JSON.stringify({ ...GOOD, pxPerMm: 99 }) }))).toBeNull();
  });
  it("storage ถูกบล็อก (throw) → อ่านได้ null · เขียนคืน false · ไม่ throw", () => {
    expect(readCalibration(throwingStorage)).toBeNull();
    expect(writeCalibration(GOOD, throwingStorage)).toBe(false);
    expect(readLastResult(throwingStorage)).toBeNull();
    expect(writeLastResult({ circ: 54, method: "A", ref: "coin", savedAt: 1, version: 1 }, throwingStorage)).toBe(false);
  });
  it("ไม่มี storage เลย (null) → ทำงานต่อโดยไม่จำ", () => {
    expect(readCalibration(null)).toBeNull();
    expect(writeCalibration(GOOD, null)).toBe(false);
  });
});

describe("ผลล่าสุด", () => {
  it("เก็บเฉพาะ ตัวเลข + วิธี + ref + เวลา", () => {
    const st = memoryStorage();
    writeLastResult({ circ: 54.3, method: "B", ref: "card", savedAt: 5, version: 1 }, st);
    expect(Object.keys(st.data)).toEqual([LAST_RESULT_STORAGE_KEY]);
    expect(readLastResult(st)).toEqual({ circ: 54.3, method: "B", ref: "card", savedAt: 5, version: 1 });
  });
  it.each([
    ["method ผิด", { circ: 54, method: "C", ref: "coin", savedAt: 1, version: 1 }],
    ["circ นอกช่วง", { circ: 5, method: "A", ref: "coin", savedAt: 1, version: 1 }],
    ["circ NaN", { circ: Number.NaN, method: "A", ref: "coin", savedAt: 1, version: 1 }],
    ["version ผิด", { circ: 54, method: "A", ref: "coin", savedAt: 1, version: 2 }],
    ["ref ผิด", { circ: 54, method: "A", ref: "ruler", savedAt: 1, version: 1 }],
  ])("ทิ้ง: %s", (_l, raw) => {
    expect(parseLastResult(raw)).toBeNull();
  });
});

describe("isTypicalPxPerMm (G3 ช่วง 4.5–7.5)", () => {
  it("ขอบช่วงผ่าน นอกช่วงตก", () => {
    expect(isTypicalPxPerMm(4.5)).toBe(true);
    expect(isTypicalPxPerMm(7.5)).toBe(true);
    expect(isTypicalPxPerMm(4.49)).toBe(false);
    expect(isTypicalPxPerMm(7.51)).toBe(false);
  });
});

describe("startPpmFromDpr / isStaleCalibration (G5)", () => {
  it("ซูมเข้า (dpr สูงขึ้น) → ppm ต่ำลง · ซูมออก → สูงขึ้น", () => {
    expect(startPpmFromDpr({ pxPerMm: 6, dpr: 2 }, 3)).toBeCloseTo(4, 10);
    expect(startPpmFromDpr({ pxPerMm: 6, dpr: 2 }, 1)).toBeCloseTo(12, 10);
  });
  it("dpr เสีย → ค่าเริ่ม 6.0", () => {
    expect(startPpmFromDpr({ pxPerMm: 6, dpr: 2 }, 0)).toBe(6);
    expect(startPpmFromDpr({ pxPerMm: 6, dpr: 2 }, Number.NaN)).toBe(6);
  });
  it("เครื่อง/ซูมเดิม ไม่ stale · หมุนจอ (สลับกว้าง/สูง) ไม่ stale", () => {
    expect(isStaleCalibration(GOOD, { dpr: 2, screenShort: 390, screenLong: 844 })).toBe(false);
    expect(isStaleCalibration(GOOD, { dpr: 2.005, screenShort: 390, screenLong: 844 })).toBe(false);
  });
  it("dpr เปลี่ยน → stale (ห้ามใช้ค่าเก่าเงียบๆ)", () => {
    expect(isStaleCalibration(GOOD, { dpr: 3, screenShort: 390, screenLong: 844 })).toBe(true);
    expect(isStaleCalibration(GOOD, { dpr: 1.5, screenShort: 390, screenLong: 844 })).toBe(true);
  });
  it("ขนาดจอต่างจากที่เทียบไว้ → stale", () => {
    expect(isStaleCalibration(GOOD, { dpr: 2, screenShort: 360, screenLong: 844 })).toBe(true);
    expect(isStaleCalibration(GOOD, { dpr: 2, screenShort: 390, screenLong: 800 })).toBe(true);
  });
});

describe("ก้าว −/+ และช่วงแถบเลื่อน", () => {
  it("บัตร 0.1 มม. · เหรียญ 0.05 มม. ของความยาวอ้างอิง (Δppm = step × ppm ÷ ref)", () => {
    expect(stepPpm("card", 6)).toBeCloseTo((0.1 * 6) / 53.98, 12);
    expect(stepPpm("coin", 6)).toBeCloseTo((0.05 * 6) / 26, 12);
  });
  it("ก้าวเหรียญเปลี่ยน px ของวงที่เห็นได้ (ไม่ใช่ no-op) — B15", () => {
    const ppm = 6;
    const before = refPxFor("coin", ppm);
    const after = refPxFor("coin", ppm + stepPpm("coin", ppm));
    expect(after - before).toBeCloseTo(0.05 * ppm, 10); // 0.3 px
    expect(after).toBeGreaterThan(before);
  });
  it("ก้าวบัตร 1 ก้าว = ขอบเส้นขยับ 0.1 มม. ของจอ (0.6 px ที่ 6 px/มม.)", () => {
    const ppm = 6;
    expect(refPxFor("card", ppm + stepPpm("card", ppm)) - refPxFor("card", ppm)).toBeCloseTo(0.1 * ppm, 10);
  });
  it("max เหรียญ = 9.0 · max บัตร = min(9.0, (กว้างเวที − 30 − 4) ÷ 53.98)", () => {
    expect(maxPpmFor("coin", 390)).toBe(9);
    expect(maxPpmFor("card", null)).toBe(9);
    expect(maxPpmFor("card", 390)).toBeCloseTo((390 - 34) / 53.98, 10);
    expect(maxPpmFor("card", 2000)).toBe(9);
  });
  it("clampPpm ขอบช่วง ไม่ NaN", () => {
    expect(clampPpm(1, 9)).toBe(3);
    expect(clampPpm(20, 9)).toBe(9);
    expect(clampPpm(Number.NaN, 9)).toBe(6);
    expect(Number.isNaN(clampPpm(5, 2))).toBe(false); // max ต่ำกว่า min → ไม่พัง
  });
});
