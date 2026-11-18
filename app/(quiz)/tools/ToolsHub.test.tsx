// @vitest-environment jsdom
// Hub หน้ารวมเครื่องมือลูกค้า: การ์ดครบ 3 · ลิงก์ถูก · <a> ธรรมดา (ไม่ next/link) · copy ไม่มีคำต้องห้าม/ราคาอื่น · chip ซ่อนเมื่อ storage throw · LINE = LINE_OA_URL
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { LINE_OA_URL } from "@/lib/shop/line";
import { formatPriceThb, leadTimeLabel } from "@/lib/ring-builder/showcase/config";
import { DESIGNS } from "@/lib/ring-builder/showcase/designs";
import { HUB_TOOLS, TOOLS_HUB_COPY } from "@/lib/tools-hub/config";
import ToolsHubPage, { metadata } from "./page";

const lastSizeMock = vi.hoisted(() => ({ read: vi.fn<() => LastMeasuredSize | null>(() => null) }));
vi.mock("@/lib/ring-builder/last-size", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-builder/last-size")>();
  return { ...orig, getLastMeasuredSize: () => lastSizeMock.read() };
});

beforeEach(() => {
  lastSizeMock.read.mockReset();
  lastSizeMock.read.mockReturnValue(null);
});
afterEach(cleanup);

const measured = (size: number, inShopRange = true): LastMeasuredSize => ({ size, method: "A", savedAt: 1, inShopRange });

describe("ToolsHub — success (ไม่เคยวัดไซซ์)", () => {
  it("h1 + การ์ด 3 ใบตามลำดับ config · ลิงก์ <a> relative ถูกหน้า", () => {
    render(<ToolsHubPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TOOLS_HUB_COPY.heading);
    const list = screen.getByRole("list", { name: TOOLS_HUB_COPY.toolsLabel });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/ring-size", "/gem-quiz", "/ring-builder"]);
    expect(HUB_TOOLS.map((t) => t.id)).toEqual(["ring-size", "gem-quiz", "ring-builder"]);
    for (const t of HUB_TOOLS) expect(within(list).getByRole("heading", { level: 2, name: new RegExp(t.title) })).toBeInTheDocument();
  });

  it("การ์ดทั้ง 3 ใบสไตล์เดียวกัน (ไม่มีการ์ดพื้นเข้ม) · copy ดูแหวนใช้จำนวนแบบจริง", () => {
    render(<ToolsHubPage />);
    const list = screen.getByRole("list", { name: TOOLS_HUB_COPY.toolsLabel });
    for (const a of within(list).getAllByRole("link")) {
      expect(a.className).toContain("bg-white");
      expect(a.className).not.toContain("bg-[var(--gq-burgundy)]");
    }
    expect(HUB_TOOLS.every((t) => !("variant" in t))).toBe(true);
    expect(HUB_TOOLS.find((t) => t.id === "ring-builder")?.description).toContain(`${DESIGNS.length} แบบ`);
  });

  it("ราคา/ระยะเวลามาจากฟังก์ชันเดิม (ไม่พิมพ์เลขเอง)", () => {
    render(<ToolsHubPage />);
    expect(screen.getByText(`${formatPriceThb()} · ${leadTimeLabel()}`)).toBeInTheDocument();
  });

  it("ปุ่ม LINE ระดับรอง ใช้ LINE_OA_URL เดิม · ไม่มีลิงก์ภายนอกอื่น (TikTok/Shopee/โทร/อีเมล)", () => {
    const { container } = render(<ToolsHubPage />);
    expect(screen.getByRole("link", { name: TOOLS_HUB_COPY.contactCta })).toHaveAttribute("href", LINE_OA_URL);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h && !h.startsWith("/"))).toEqual([LINE_OA_URL]);
  });

  it("copy ไม่มีคำต้องห้าม · ไม่มีราคาอื่นนอกจากราคาที่ formatPriceThb ให้", () => {
    const { container } = render(<ToolsHubPage />);
    const text = container.textContent ?? "";
    for (const bad of ["ใช้ฟรี", "ไม่ต้องสมัคร", "เพชร", "TikTok", "Shopee", "ติ๊กต๊อก", "ช้อปปี้", "TODO_OWNER"]) expect(text).not.toContain(bad);
    const prices = text.match(/[0-9][0-9,]*\s*บาท/g) ?? [];
    // "10 บาท" มาจากเหรียญ 10 บาทในคำอธิบายวัดไซซ์ (ประโยคเดิมของ /ring-size) ไม่ใช่ราคา
    expect(prices.map((p) => p.replace(/\s/g, "")).sort()).toEqual(["10บาท", formatPriceThb().replace(/\s/g, "")].sort());
  });

  it("ไม่มี chip เมื่อไม่เคยวัด (ไม่มีข้อความ 'ยังไม่มีผล')", async () => {
    const { container } = render(<ToolsHubPage />);
    await waitFor(() => expect(lastSizeMock.read).toHaveBeenCalled());
    expect(container.textContent).not.toContain("ผลวัดล่าสุด");
    expect(container.textContent).not.toContain("ยังไม่มี");
  });
});

describe("LastSizeChip — empty/error/success", () => {
  it("success: มีผลในช่วงร้าน → 'ผลวัดล่าสุด: เบอร์ N' อยู่ในการ์ดวัดไซซ์", async () => {
    lastSizeMock.read.mockReturnValue(measured(56));
    render(<ToolsHubPage />);
    const chip = await screen.findByText(TOOLS_HUB_COPY.lastMeasured(56));
    expect(chip.closest("a")).toHaveAttribute("href", "/ring-size");
  });
  it("error: storage throw → เงียบ ไม่ crash ไม่มี chip การ์ดยังกดได้", async () => {
    lastSizeMock.read.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = render(<ToolsHubPage />);
    await waitFor(() => expect(lastSizeMock.read).toHaveBeenCalled());
    expect(container.textContent).not.toContain("ผลวัดล่าสุด");
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
  it("นอกช่วงร้าน → ไม่แสดง chip", async () => {
    lastSizeMock.read.mockReturnValue(measured(40, false));
    const { container } = render(<ToolsHubPage />);
    await waitFor(() => expect(lastSizeMock.read).toHaveBeenCalled());
    expect(container.textContent).not.toContain("ผลวัดล่าสุด");
  });
});

describe("metadata + โครงสร้าง", () => {
  it("override ครบ ไม่หลุด '3J Insight' · noindex · ไม่ผูก metadataBase (P2)", () => {
    expect(JSON.stringify(metadata)).not.toContain("3J Insight");
    expect(metadata.title).toBe(TOOLS_HUB_COPY.pageTitle);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.description).toBeTruthy();
  });
  it("ไฟล์ใต้ tools/ ไม่ใช้ next/link · ไม่มี use server · ไม่มี process.env · ไม่มี style inline", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["']next\/link["']/);
      expect(src, f).not.toMatch(/^\s*["']use server["']/m);
      expect(src, f).not.toMatch(/process\.env/);
      expect(src, f).not.toMatch(/style=\{\{/);
      expect(src, f).not.toMatch(/target="_blank"/);
    }
  });
});
