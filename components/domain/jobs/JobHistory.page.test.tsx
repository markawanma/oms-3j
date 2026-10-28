// @vitest-environment jsdom
// หน้า /jobs/history (server component): gate owner/admin · ล้ม = ErrorState · สำเร็จ = JobHistory · + แท็บ "ประวัติงาน" ใน JobsSubNav (active ไม่ชนบอร์ด)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const canManage = vi.fn();
const getHistory = vi.fn();
let pathname = "/jobs/history";
vi.mock("@/lib/jobs/page-gate", () => ({ canManageJobs: () => canManage() }));
vi.mock("@/lib/actions/job-office", () => ({ getJobHistory: () => getHistory() }));
vi.mock("@/components/domain/jobs/JobHistory", () => ({ JobHistory: ({ data }: { data: { rows: unknown[] } }) => <div data-testid="history">{data.rows.length}</div> }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.spyOn(console, "error").mockImplementation(() => {});

import JobsHistoryPage from "../../../app/(dashboard)/jobs/history/page";
import Loading from "../../../app/(dashboard)/jobs/history/loading";
import { JobsSubNav, jobsTabActive } from "./JobsSubNav";

const renderPage = async () => render(await JobsHistoryPage());

beforeEach(() => {
  canManage.mockResolvedValue(true);
  getHistory.mockResolvedValue({ ok: true, data: { todayTh: "2026-10-20", rows: [1, 2], truncated: false } });
  pathname = "/jobs/history";
});

describe("หน้า /jobs/history", () => {
  it("สำเร็จ = แสดง JobHistory พร้อมข้อมูล", async () => {
    await renderPage();
    expect(screen.getByTestId("history")).toHaveTextContent("2");
  });
  it("ไม่ใช่ owner/admin = 'หน้านี้จำกัดสิทธิ์' · ไม่เรียก action", async () => {
    canManage.mockResolvedValue(false);
    await renderPage();
    expect(screen.getByText("หน้านี้จำกัดสิทธิ์")).toBeInTheDocument();
    expect(getHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId("history")).not.toBeInTheDocument();
  });
  it("action ตอบ error = ErrorState พร้อมข้อความ · action throw = ข้อความกลาง (ไม่รั่วข้อความดิบ)", async () => {
    getHistory.mockResolvedValue({ ok: false, error: "โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง" });
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง");
    cleanup();
    getHistory.mockRejectedValue(new Error("secret db password"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดประวัติงานไม่สำเร็จ");
    expect(document.body.textContent).not.toContain("secret");
  });
  it("loading.tsx มี role=status บอกว่ากำลังโหลดประวัติงาน", () => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "กำลังโหลดประวัติงาน" })).toBeInTheDocument();
  });
});

describe("JobsSubNav — แท็บ 'ประวัติงาน'", () => {
  it("มีแท็บต่อจากบอร์ด (ลำดับ บอร์ด → ประวัติงาน → ทะเบียนช่าง → แบบการบันทึก) ลิงก์ /jobs/history", () => {
    render(<JobsSubNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["บอร์ดใบงาน", "ประวัติงาน", "ทะเบียนช่าง", "แบบการบันทึก"]);
    expect(screen.getByRole("link", { name: "ประวัติงาน" })).toHaveAttribute("href", "/jobs/history");
  });
  it("อยู่ที่ /jobs/history: สว่างเฉพาะ 'ประวัติงาน' (aria-current) · 'บอร์ดใบงาน' ไม่สว่างค้าง", () => {
    render(<JobsSubNav />);
    expect(screen.getByRole("link", { name: "ประวัติงาน" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "บอร์ดใบงาน" })).not.toHaveAttribute("aria-current");
  });
  it("ที่ /jobs และ /jobs/<id>: บอร์ดสว่าง · ประวัติไม่สว่าง", () => {
    for (const p of ["/jobs", "/jobs/11111111-1111-4111-8111-111111111111", "/jobs/11111111-1111-4111-8111-111111111111/print"]) {
      pathname = p;
      cleanup();
      render(<JobsSubNav />);
      expect(screen.getByRole("link", { name: "บอร์ดใบงาน" }), p).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "ประวัติงาน" }), p).not.toHaveAttribute("aria-current");
    }
  });
  it("jobsTabActive: history/workers/profiles ไม่ทำให้บอร์ดสว่าง · แท็บของตัวเองสว่าง · /jobs/historyx = ยังเป็นใบงานรายใบ (ไม่ใช่แท็บประวัติ)", () => {
    for (const p of ["/jobs/history", "/jobs/workers", "/jobs/profiles", "/jobs/history/", "/jobs/workers/x"]) expect(jobsTabActive(p, "/jobs"), p).toBe(false);
    expect(jobsTabActive("/jobs/history", "/jobs/history")).toBe(true);
    expect(jobsTabActive("/jobs/workers", "/jobs/history")).toBe(false);
    expect(jobsTabActive("/jobs", "/jobs/history")).toBe(false);
    expect(jobsTabActive("/jobs/historyx", "/jobs")).toBe(true);
    expect(jobsTabActive("/jobs/historyx", "/jobs/history")).toBe(false);
    expect(jobsTabActive(null, "/jobs")).toBe(false);
  });
});
