// @vitest-environment jsdom
// QA (R2-D2) — chip ผลวัดล่าสุดกับ localStorage "จริง" (ไม่ mock getLastMeasuredSize): ว่าง · JSON เสีย · ค่าเพี้ยน · getItem throw · ค่าดี
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LAST_RESULT_STORAGE_KEY } from "@/lib/ring-size/calibration";
import { TOOLS_HUB_COPY } from "@/lib/tools-hub/config";
import { ToolsHub } from "./ToolsHub";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const good = { circ: 56.0, method: "A", ref: "card", savedAt: 1700000000000, version: 1 };
const chipText = () => document.body.textContent ?? "";

describe("LastSizeChip + localStorage จริง", () => {
  it("ว่าง → ไม่มี chip", async () => {
    render(<ToolsHub />);
    await new Promise((r) => setTimeout(r, 20));
    expect(chipText()).not.toContain("ผลวัดล่าสุด");
  });

  it.each([
    ["JSON เสีย", "{not json"],
    ["null", "null"],
    ["array", "[]"],
    ["version ผิด", JSON.stringify({ ...good, version: 2 })],
    ["circ เป็น string", JSON.stringify({ ...good, circ: "56" })],
    ["circ ต่ำเกิน", JSON.stringify({ ...good, circ: 5 })],
    ["circ สูงเกิน 1e9", JSON.stringify({ ...good, circ: 1e9 })],
    ["method ผิด", JSON.stringify({ ...good, method: "Z" })],
    ["savedAt ติดลบ", JSON.stringify({ ...good, savedAt: -1 })],
    ["ว่างเป็น string", ""],
  ])("ค่าเพี้ยน (%s) → ไม่มี chip ไม่ crash", async (_n, raw) => {
    localStorage.setItem(LAST_RESULT_STORAGE_KEY, raw);
    render(<ToolsHub />);
    await new Promise((r) => setTimeout(r, 20));
    expect(chipText()).not.toContain("ผลวัดล่าสุด");
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("getItem throw (storage ถูกบล็อก) → ไม่มี chip ไม่ crash", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<ToolsHub />);
    await new Promise((r) => setTimeout(r, 20));
    expect(chipText()).not.toContain("ผลวัดล่าสุด");
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("ค่าดี → chip แสดงเป็นเลขเต็ม และเป็นเบอร์ในช่วงร้าน (45-68) เท่านั้น", async () => {
    localStorage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify(good));
    render(<ToolsHub />);
    await waitFor(() => expect(chipText()).toMatch(/ผลวัดล่าสุด: เบอร์ \d+/));
    const n = Number(/เบอร์ (\d+)/.exec(chipText())![1]);
    expect(n).toBeGreaterThanOrEqual(45);
    expect(n).toBeLessThanOrEqual(68);
    expect(TOOLS_HUB_COPY.lastMeasured(n)).toBe(`ผลวัดล่าสุด: เบอร์ ${n}`);
  });

  it("ค่านอกช่วงร้านแต่ parse ผ่าน (circ 100) → ไม่มี chip", async () => {
    localStorage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify({ ...good, circ: 100 }));
    render(<ToolsHub />);
    await new Promise((r) => setTimeout(r, 20));
    expect(chipText()).not.toContain("ผลวัดล่าสุด");
  });
});
