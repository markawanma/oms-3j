import { describe, expect, it } from "vitest";
import { isWideJobsPath } from "./nav";
import { isWideMarketingPath } from "@/lib/marketing/nav";

// เงื่อนไขเดียวกับที่ DashboardShell ใช้เลือก max-w-6xl
const wide = (p: string | null | undefined) => isWideMarketingPath(p) || isWideJobsPath(p);

describe("isWideJobsPath — กว้างเฉพาะบอร์ด /jobs", () => {
  it("/jobs และ /jobs/ กว้าง", () => {
    expect(wide("/jobs")).toBe(true);
    expect(wide("/jobs/")).toBe(true);
  });
  it("หน้าลูก/หน้าอื่นไม่กว้าง", () => {
    for (const p of ["/jobs/abc", "/jobs/workers", "/jobs/abc/print", "/jobsx", "/production", "/", null, undefined]) {
      expect(wide(p as string), String(p)).toBe(false);
    }
  });
  it("marketing เดิมยังกว้าง และ helper jobs ไม่รับ marketing", () => {
    expect(wide("/marketing")).toBe(true);
    expect(wide("/marketing/pieces/abc")).toBe(true);
    expect(isWideJobsPath("/marketing")).toBe(false);
  });
});
