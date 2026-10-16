import { describe, expect, it } from "vitest";
import { addDaysIso, todayBangkok } from "./dates";

describe("todayBangkok", () => {
  it("ใช้เวลาไทย ไม่ใช่ UTC — 17:00 UTC (00:00 ไทย) ของวันที่ 16 = วันที่ 17", () => {
    expect(todayBangkok(new Date("2026-10-16T17:00:00Z"))).toBe("2026-10-17");
  });
  it("16:59 UTC = 23:59 ไทย ยังเป็นวันเดิม", () => {
    expect(todayBangkok(new Date("2026-10-16T16:59:00Z"))).toBe("2026-10-16");
  });
  it("รูปแบบ YYYY-MM-DD", () => {
    expect(todayBangkok()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDaysIso", () => {
  it("บวก 7 วัน / ข้ามเดือน / ข้ามปี", () => {
    expect(addDaysIso("2026-10-16", 7)).toBe("2026-10-23");
    expect(addDaysIso("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDaysIso("2026-12-30", 7)).toBe("2027-01-06");
  });
  it("365 วัน (เพดานกำหนดชำระ) และ 0 / ลบ", () => {
    expect(addDaysIso("2026-10-16", 365)).toBe("2027-10-16");
    expect(addDaysIso("2026-10-16", 0)).toBe("2026-10-16");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("ปีอธิกสุรทิน", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("รูปแบบผิด / วันที่ไม่มีจริง = throw (ไม่กลืนเงียบ)", () => {
    expect(() => addDaysIso("16/10/2026", 1)).toThrow(RangeError);
    expect(() => addDaysIso("2026-02-31", 1)).toThrow(RangeError);
    expect(() => addDaysIso("", 1)).toThrow(RangeError);
  });
});
