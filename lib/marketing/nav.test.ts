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
    expect(activeTabHref("/marketing/pieces/abc", HREFS)).toBe("/marketing/pieces");
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
