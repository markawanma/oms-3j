// @vitest-environment jsdom
// JobsSubNav + เมนูข้าง: แท็บ "พลอยที่ต้องสั่ง" (G1b) — ที่ /jobs/gems-to-buy ต้องสว่างแท็บเดียว (ไม่ซ้อนกับ "บอร์ด") · แท็บเดิมไม่เปลี่ยนพฤติกรรม
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

let pathname = "/jobs";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { JobsSubNav, jobsTabActive } from "@/components/domain/jobs/JobsSubNav";

const HREFS = ["/jobs", "/jobs/gems-to-buy", "/jobs/history", "/jobs/workers", "/jobs/profiles"];
const U1 = "11111111-1111-4111-8111-111111111111";

describe("jobsTabActive", () => {
  it("/jobs/gems-to-buy: สว่างเฉพาะแท็บของตัวเอง — 'บอร์ด' ไม่สว่างพร้อมกัน", () => {
    const lit = HREFS.filter((h) => jobsTabActive("/jobs/gems-to-buy", h));
    expect(lit).toEqual(["/jobs/gems-to-buy"]);
    expect(jobsTabActive("/jobs/gems-to-buy/", "/jobs")).toBe(false);
  });
  it("ทุกพาธของระบบใบงาน: สว่างได้ไม่เกิน 1 แท็บ", () => {
    for (const p of ["/jobs", `/jobs/${U1}`, `/jobs/${U1}/print`, "/jobs/gems-to-buy", "/jobs/history", "/jobs/workers", "/jobs/profiles"]) {
      expect(HREFS.filter((h) => jobsTabActive(p, h)).length, p).toBeLessThanOrEqual(1);
    }
  });
  it("พฤติกรรมเดิมไม่เปลี่ยน: บอร์ดสว่างที่ /jobs และ /jobs/<id> · ไม่สว่างที่ workers/profiles/history", () => {
    expect(jobsTabActive("/jobs", "/jobs")).toBe(true);
    expect(jobsTabActive(`/jobs/${U1}`, "/jobs")).toBe(true);
    expect(jobsTabActive(`/jobs/${U1}/print`, "/jobs")).toBe(true);
    for (const p of ["/jobs/workers", "/jobs/profiles", "/jobs/history"]) expect(jobsTabActive(p, "/jobs")).toBe(false);
    expect(jobsTabActive("/oem", "/jobs")).toBe(false);
    expect(jobsTabActive("/jobs/workers", "/jobs/workers")).toBe(true);
  });
  it("/jobs/gems-to-buyX ไม่ถือเป็นหน้าพลอย (ไม่จับ prefix หลวม)", () => {
    expect(jobsTabActive("/jobs/gems-to-buyer", "/jobs/gems-to-buy")).toBe(false);
  });
});

describe("JobsSubNav render", () => {
  it("แท็บที่ 2 = 'พลอยที่ต้องสั่ง' ลิงก์ /jobs/gems-to-buy · aria-current เฉพาะหน้าปัจจุบัน", () => {
    pathname = "/jobs/gems-to-buy";
    render(<JobsSubNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["บอร์ดใบงาน", "พลอยที่ต้องสั่ง", "ประวัติงาน", "ทะเบียนช่าง", "แบบการบันทึก"]);
    expect(links[1]).toHaveAttribute("href", "/jobs/gems-to-buy");
    expect(links.filter((l) => l.getAttribute("aria-current") === "page")).toEqual([links[1]]);
    expect(links[1].className).toMatch(/min-h-11/);
  });
});
