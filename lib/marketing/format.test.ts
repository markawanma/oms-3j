import { describe, expect, it } from "vitest";
import { bangkokDateOf, daysBetween, formatThaiDateTime, formatThaiDay } from "./format";

describe("format (เวลาไทย)", () => {
  it("timestamp UTC ข้ามเที่ยงคืนไทย → วันไทยถัดไป", () => {
    expect(bangkokDateOf("2026-10-08T18:30:00Z")).toBe("2026-10-09");
    expect(bangkokDateOf("2026-10-08T16:59:00Z")).toBe("2026-10-08");
    expect(bangkokDateOf("nope")).toBeNull();
  });
  it("วันที่ล้วนไม่เลื่อนตาม timezone เครื่อง", () => {
    expect(formatThaiDay("2026-10-08")).toContain("8");
    expect(formatThaiDay("2026-10-08", true)).toContain("2569");
    expect(formatThaiDay(null)).toBe("-");
    expect(formatThaiDay("garbage")).toBe("-");
  });
  it("วัน-เวลา ใช้ปี พ.ศ. และเวลาไทย", () => {
    const s = formatThaiDateTime("2026-10-09T07:30:00Z");
    expect(s).toContain("2569");
    expect(s).toContain("14");
    expect(formatThaiDateTime(null)).toBe("-");
    expect(formatThaiDateTime("bad")).toBe("-");
  });
  it("daysBetween", () => {
    expect(daysBetween("2026-10-09", "2026-10-12")).toBe(3);
    expect(daysBetween("2026-10-12", "2026-10-09")).toBe(-3);
    expect(daysBetween("x", "2026-10-09")).toBeNull();
  });
});
