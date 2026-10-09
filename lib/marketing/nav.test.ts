import { describe, expect, it } from "vitest";
import { activeTabHref } from "./nav";

const HREFS = [
  "/marketing",
  "/marketing/content/entry",
  "/marketing/content",
  "/marketing/calendar",
  "/marketing/pieces",
];

describe("activeTabHref", () => {
  it("highlights the root tab only on the exact root", () => {
    expect(activeTabHref("/marketing", HREFS)).toBe("/marketing");
  });
  it("does not light up the root tab on child pages", () => {
    expect(activeTabHref("/marketing/calendar", HREFS)).toBe("/marketing/calendar");
    expect(activeTabHref("/marketing/pieces", HREFS)).toBe("/marketing/pieces");
    expect(activeTabHref("/marketing/pieces/abc", HREFS)).toBeNull(); // หน้าชิ้นงานไม่ทำให้แท็บ list สว่าง
  });
  it("prefers the longest matching href", () => {
    expect(activeTabHref("/marketing/content/entry", HREFS)).toBe("/marketing/content/entry");
    expect(activeTabHref("/marketing/content/history", HREFS)).toBe("/marketing/content");
  });
  it("returns null for unknown or empty paths", () => {
    expect(activeTabHref("/crm", HREFS)).toBeNull();
    expect(activeTabHref(null, HREFS)).toBeNull();
    expect(activeTabHref("/marketing/calendarx", HREFS)).toBeNull();
  });
});

import { isWideMarketingPath } from "./nav";

describe("isWideMarketingPath — ขยายเฉพาะ route workflow ใหม่", () => {
  it("หน้าแรกและหน้าชิ้นงานกว้าง", () => {
    expect(isWideMarketingPath("/marketing")).toBe(true);
    expect(isWideMarketingPath("/marketing/calendar")).toBe(true);
    expect(isWideMarketingPath("/marketing/pieces/abc")).toBe(true);
  });
  it("หน้าอื่นทั้งแอปคงเดิม", () => {
    for (const p of ["/marketing/questions", "/marketing/calendar/x", "/marketing/content/entry", "/marketing/copilot", "/crm", "/", "/marketing/pieces", "/marketingx", null, undefined]) {
      expect(isWideMarketingPath(p as string), String(p)).toBe(false);
    }
  });
});

describe("MARKETING_NAV (รายการเมนูที่เดียว)", () => {
  it("href ไม่ซ้ำ และขึ้นต้น /marketing", async () => {
    const { MARKETING_NAV } = await import("./nav");
    const hrefs = MARKETING_NAV.map((m) => m.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((h) => h === "/marketing" || h.startsWith("/marketing/"))).toBe(true);
  });
  it("ช่องหลักมือถือไม่เกิน 4 (+ เพิ่มเติม = 5 ช่อง ที่ 390px ช่องละ ≥ 44px)", async () => {
    const { MARKETING_NAV } = await import("./nav");
    expect(MARKETING_NAV.filter((m) => m.mobile === "main").length).toBeLessThanOrEqual(4);
  });
  it("ทุกหน้าที่มีใน sidebar อยู่ในแถวแท็บ PC ด้วย (ไม่มีหน้าที่หาไม่เจอจากในโมดูล)", async () => {
    const { MARKETING_NAV } = await import("./nav");
    for (const m of MARKETING_NAV.filter((x) => x.sidebar)) expect(m.tab).not.toBeNull();
  });
  it("ทุกหน้าเข้าถึงได้จากมือถือ (main หรือ more)", async () => {
    const { MARKETING_NAV } = await import("./nav");
    for (const m of MARKETING_NAV) expect(m.mobile).not.toBeNull();
  });
});
