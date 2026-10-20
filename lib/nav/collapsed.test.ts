import { describe, expect, it } from "vitest";
import { NAV_COLLAPSED_KEY, parseCollapsed } from "./collapsed";

// loadCollapsed/saveCollapsed แตะ window.localStorage — ครอบใน components/layout/DashboardShell.collapse.test.tsx (jsdom)
// ที่นี่ทดสอบเฉพาะตัว parse (pure) ว่าไม่เชื่อค่าที่อ่านจาก storage

describe("parseCollapsed", () => {
  it("key ต้องตรง spec (เปลี่ยน = ทุกคนที่เคยพับไว้เสียค่า)", () => {
    expect(NAV_COLLAPSED_KEY).toBe("nav.collapsed.v1");
  });

  it("array ของ string ปกติ → คืนตามเดิม", () => {
    expect(parseCollapsed('["CRM","ผลิตเอง"]')).toEqual(["CRM", "ผลิตเอง"]);
  });

  it("null / undefined / ว่าง → []", () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed(undefined)).toEqual([]);
    expect(parseCollapsed("")).toEqual([]);
  });

  it("JSON พัง / ไม่ใช่ array → []", () => {
    expect(parseCollapsed("{oops")).toEqual([]);
    expect(parseCollapsed('{"CRM":true}')).toEqual([]);
    expect(parseCollapsed('"CRM"')).toEqual([]);
    expect(parseCollapsed("null")).toEqual([]);
  });

  it("กรองสมาชิกที่ไม่ใช่ string / ว่าง / ยาวผิดปกติ / ซ้ำ", () => {
    const long = "x".repeat(101);
    expect(parseCollapsed(JSON.stringify(["CRM", 1, null, {}, "", long, "CRM", "ทีม"]))).toEqual(["CRM", "ทีม"]);
  });

  it("จำกัดจำนวนรายการ (กัน payload ขยะ)", () => {
    const many = Array.from({ length: 500 }, (_, i) => `g${i}`);
    expect(parseCollapsed(JSON.stringify(many))).toHaveLength(50);
  });
});
