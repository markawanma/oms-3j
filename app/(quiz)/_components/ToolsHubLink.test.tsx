// @vitest-environment jsdom
// P3 (18 พ.ย. 69) — ทางกลับหน้ารวมเครื่องมือ: component + ตำแหน่งวาง
// 24 พ.ย. 69: มติเจ้าของเขียนทับ ux-tools-hub §4 ("ห้ามวางกลางทาง") — วางได้ทุกจอ · ซ้ายบนที่ขั้นแรก (landing/R0) · ขวาบน "เครื่องมือ 3J" ที่จออื่น
//  จอที่มีงานค้างถามก่อนออก (ToolsHubExit.test.tsx · ring-size/_tests/nav-hub.test.tsx · gem-quiz/GemQuizClient.nav.test.tsx)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HUB_URL } from "@/lib/site/hosts";
import { EMPTY_SHOWCASE_PARAMS } from "@/lib/ring-builder/showcase/quiz-link";
import { GemQuizClient } from "../gem-quiz/GemQuizClient";
import { RingShowcaseClient } from "../ring-builder/RingShowcaseClient";
import { RingSizeClient } from "../ring-size/RingSizeClient";
import { mockRects, resetBrowserState } from "../ring-size/_tests/setup.test-util";
import { ToolsHubLink } from "./ToolsHubLink";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetBrowserState();
});
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
});

const hubLinks = (c: HTMLElement | Document = document) => Array.from(c.querySelectorAll("a")).filter((a) => a.getAttribute("href") === HUB_URL);

describe("ToolsHubLink", () => {
  it("HUB_URL = '/' (หน้าลูกค้าอยู่บน tools. เสมอหลัง P2 → hub ตรงๆ ไม่ผ่าน /tools 307) · relative ไม่ใช่ origin เต็ม", () => {
    expect(HUB_URL).toBe("/");
  });
  it("text: <a href='/'> ธรรมดา (ไม่ target/rel เปิดแท็บใหม่) · ข้อความ 'เครื่องมือ 3J' · mouse target ≥ 44px", () => {
    render(<ToolsHubLink variant="text" />);
    const a = screen.getByRole("link", { name: /เครื่องมือ 3J/ });
    expect(a).toHaveAttribute("href", "/");
    expect(a).not.toHaveAttribute("target");
    expect(a.className).toMatch(/min-h-11/);
    expect(a.querySelector("span[aria-hidden='true']")?.textContent).toBe("←"); // ลูกศรไม่ถูกอ่านซ้ำ
  });
  it("nav: <a href='/'> · aria-label 'กลับหน้าเครื่องมือ 3J' · ข้อความ 'เครื่องมือ 3J' · ไอคอนบ้านซ่อนจาก screen reader · ≥ 44×44 · ไม่ target (N2/N3)", () => {
    render(<ToolsHubLink variant="nav" />);
    const a = screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" });
    expect(a).toHaveAttribute("href", "/");
    expect(a).not.toHaveAttribute("target");
    expect(a.textContent).toBe("เครื่องมือ 3J");
    expect(a.className).toMatch(/min-h-11/);
    expect(a.className).toMatch(/min-w-11/);
    expect(a.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("back: ข้อความ '← กลับหน้าเครื่องมือ' ท้ายหน้าจบ · ≥ 44px", () => {
    render(<ToolsHubLink variant="back" />);
    const a = screen.getByRole("link", { name: /กลับหน้าเครื่องมือ/ });
    expect(a).toHaveAttribute("href", "/");
    expect(a.className).toMatch(/min-h-11/);
  });
  it("mark: ห่อ children · aria-label ชัด · target ≥ 44×44", () => {
    render(
      <ToolsHubLink variant="mark">
        <img src="/x.png" alt="3J" />
      </ToolsHubLink>,
    );
    const a = screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" });
    expect(a).toHaveAttribute("href", "/");
    expect(a.className).toMatch(/min-h-11/);
    expect(a.className).toMatch(/min-w-11/);
    expect(a.querySelector("img")).not.toBeNull();
  });
  it("ซอร์สไม่ใช้ next/link · ไม่ import 'use server' · ไม่มี process.env", () => {
    const raw = readFileSync(join(process.cwd(), "app", "(quiz)", "_components", "ToolsHubLink.tsx"), "utf8");
    const src = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join(" "); // ตัดบรรทัดคอมเมนต์ (อธิบายกฎด้วยคำเดียวกัน)
    expect(src).not.toMatch(/next\/link|use server|process\.env|target=/);
  });
});

describe("ตำแหน่งวาง", () => {
  it("/ring-builder: มีลิงก์กลับ hub ตัวเดียว (โหมดเข้าตรง)", () => {
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(hubLinks(container)).toHaveLength(1);
    expect(screen.getByRole("link", { name: /เครื่องมือ 3J/ })).toBeInTheDocument();
  });

  it("/gem-quiz: landing = ลิงก์ข้อความซ้ายบน ('← เครื่องมือ 3J') · ขึ้นคำถามแรกแล้ว = ลิงก์ nav ขวาบน (ตัวเดียวทุกจอ)", async () => {
    const u = userEvent.setup();
    const { container } = render(<GemQuizClient token="t" />);
    const first = hubLinks(container);
    expect(first).toHaveLength(1);
    expect(first[0].textContent).toBe("←เครื่องมือ 3J");
    await u.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    const q1 = hubLinks(container);
    expect(q1).toHaveLength(1);
    expect(q1[0]).toHaveAttribute("aria-label", "กลับหน้าเครื่องมือ 3J");
    expect(q1[0].textContent).toBe("เครื่องมือ 3J");
  });

  it("/ring-size: หน้าแรก = ลิงก์ข้อความซ้ายบน (โลโก้เป็นรูปเฉยๆ ไม่ใช่ลิงก์) · เริ่มวัดแล้ว = ลิงก์ nav ขวาบน", async () => {
    const u = userEvent.setup();
    const { container } = render(<RingSizeClient />);
    const links = hubLinks(container);
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("←เครื่องมือ 3J");
    expect(links[0].querySelector("img")).toBeNull();
    expect(container.querySelector("img[src='/3j-logo.png']")?.closest("a")).toBeNull();
    await u.click(screen.getByRole("button", { name: "เริ่มวัดไซส์" }));
    const r1pick = hubLinks(container);
    expect(r1pick).toHaveLength(1);
    expect(r1pick[0]).toHaveAttribute("aria-label", "กลับหน้าเครื่องมือ 3J");
  });
});
