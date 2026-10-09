import { describe, expect, it } from "vitest";
import { hasConfirmMarker, splitConfirmMarkers } from "./confirm-marker";

describe("splitConfirmMarkers", () => {
  it("ข้อความไม่มี marker = ช่วงเดียว", () => {
    expect(splitConfirmMarkers("สวัสดีค่ะ")).toEqual([{ kind: "text", text: "สวัสดีค่ะ" }]);
  });
  it("ว่าง/null = []", () => {
    expect(splitConfirmMarkers("")).toEqual([]);
    expect(splitConfirmMarkers(null)).toEqual([]);
  });
  it("แยก [ต้องยืนยัน: …] ออกเป็น confirm และคงข้อความรอบข้าง", () => {
    const segs = splitConfirmMarkers("ใช้น้ำยา [ต้องยืนยัน: ยี่ห้ออะไร] ขัดค่ะ");
    expect(segs).toEqual([
      { kind: "text", text: "ใช้น้ำยา " },
      { kind: "confirm", text: "[ต้องยืนยัน: ยี่ห้ออะไร]" },
      { kind: "text", text: " ขัดค่ะ" },
    ]);
  });
  it("ทนช่องว่างระหว่างคำและวงเล็บเต็มความกว้าง", () => {
    expect(hasConfirmMarker("[ ต้อง ยืนยัน : x ]")).toBe(true);
    expect(hasConfirmMarker("［ต้องยืนยัน: x］")).toBe(true);
  });
  it("marker ที่ไม่ปิดวงเล็บ ก็ยังไฮไลต์ (DB บล็อกเหมือนกัน)", () => {
    const segs = splitConfirmMarkers("ทดสอบ [ต้องยืนยัน: ไม่ปิด");
    expect(segs.some((s) => s.kind === "confirm")).toBe(true);
  });
  it("[ช่างยืนยัน: …] เป็นชนิด verify (ไม่ใช่ confirm — DB ไม่บล็อก)", () => {
    const segs = splitConfirmMarkers("ขั้นสุดท้าย [ช่างยืนยัน: จริงไหม]");
    expect(segs.map((s) => s.kind)).toEqual(["text", "verify"]);
    expect(hasConfirmMarker("ขั้นสุดท้าย [ช่างยืนยัน: จริงไหม]")).toBe(false);
  });
  it("หลาย marker", () => {
    const segs = splitConfirmMarkers("[ต้องยืนยัน: a] กับ [ต้องยืนยัน: b]");
    expect(segs.filter((s) => s.kind === "confirm")).toHaveLength(2);
  });
  it("วงเล็บเหลี่ยมธรรมดาที่ไม่ใช่ marker ไม่ถูกไฮไลต์", () => {
    expect(splitConfirmMarkers("[ชิ้นที่ 1: ] ราคา").every((s) => s.kind === "text")).toBe(true);
  });
});
