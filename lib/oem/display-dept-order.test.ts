import { describe, expect, it } from "vitest";
import { oemScopeSort } from "./display";

// 0194: ลำดับหน้างาน แต่ง → ฝังพลอย → ขัด → ชุบ — เรตแผนกต้องเรียงตามนี้บนหน้าตั้งค่าเรต
describe("oemScopeSort · dept order (0194)", () => {
  it("เรียง ฉีดเทียน → หล่อ → ฝังพลอย → ขัด → ชุบ → QC → แพ็ก", () => {
    const shuffled = ["แพ็ก", "ขัด", "QC", "ชุบ", "ฝังพลอย", "หล่อ", "ฉีดเทียน"];
    const sorted = [...shuffled].sort((a, b) => oemScopeSort("dept", a, b));
    expect(sorted).toEqual(["ฉีดเทียน", "หล่อ", "ฝังพลอย", "ขัด", "ชุบ", "QC", "แพ็ก"]);
  });

  it("ฝังพลอยมาก่อนขัด (ทิศเดียวกับทะเบียนขั้น seq 100 < 105)", () => {
    expect(oemScopeSort("dept", "ฝังพลอย", "ขัด")).toBeLessThan(0);
    expect(oemScopeSort("dept", "ขัด", "ฝังพลอย")).toBeGreaterThan(0);
  });
});
