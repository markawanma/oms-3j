import { describe, expect, it } from "vitest";
import { isJobMetal } from "./source";

describe("isJobMetal — รายการที่สร้างใบงานได้", () => {
  it("เงิน 925 / ทอง / ทองเหลือง ได้", () => {
    for (const m of ["silver", "gold", "brass"]) expect(isJobMetal(m)).toBe(true);
  });
  it("เงินแท่ง (silver999) และสินค้า (product) ไม่ได้ · ค่าแปลก/ไม่ใช่ string ไม่ได้", () => {
    for (const m of ["silver999", "product", "", "Silver", "platinum", null, undefined, 5, {}]) expect(isJobMetal(m), String(m)).toBe(false);
  });
});
