// @vitest-environment jsdom
// /jobs/workers (server page · W1): สถานะ QR ร้านอ่านไม่ได้ ≠ ทะเบียนช่างพัง — การ์ดขึ้นข้อความของตัวเอง ทะเบียนใช้งานต่อได้ · ไม่มีสิทธิ์ = หน้าจำกัดสิทธิ์
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const getWorkers = vi.fn();
const getShopIntakeStatus = vi.fn();
vi.mock("@/lib/actions/job-workers", () => ({ getWorkers: () => getWorkers(), getShopIntakeStatus: () => getShopIntakeStatus() }));
const canManageJobs = vi.fn();
vi.mock("@/lib/jobs/page-gate", () => ({ canManageJobs: () => canManageJobs() }));
vi.mock("@/lib/jobs/log", () => ({ logJobFailure: vi.fn() }));
const seen: { data: unknown; intake: unknown }[] = [];
vi.mock("@/components/domain/jobs/WorkersClient", () => ({
  WorkersClient: (p: { data: unknown; intake: unknown }) => {
    seen.push(p);
    return <div data-testid="workers" />;
  },
}));

import JobWorkersPage from "../../../app/(dashboard)/jobs/workers/page";

const DATA = { workers: [], stages: [] };
async function renderPage() {
  seen.length = 0;
  const ui = await JobWorkersPage();
  return { ...render(ui), props: seen[0] };
}

describe("JobWorkersPage", () => {
  it("สำเร็จ: ส่งสถานะ QR ร้านเข้า WorkersClient", async () => {
    canManageJobs.mockResolvedValue(true);
    getWorkers.mockResolvedValue({ ok: true, data: DATA });
    getShopIntakeStatus.mockResolvedValue({ ok: true, data: { active: true, issuedAt: "2026-10-20T02:12:00Z" } });
    const { props } = await renderPage();
    expect(props.intake).toEqual({ status: { active: true, issuedAt: "2026-10-20T02:12:00Z" }, error: null });
  });
  it("อ่านสถานะ QR ล้ม: ทะเบียนยังแสดง + ข้อความของการ์ด (ไม่ใช้ข้อความดิบ)", async () => {
    canManageJobs.mockResolvedValue(true);
    getWorkers.mockResolvedValue({ ok: true, data: DATA });
    getShopIntakeStatus.mockResolvedValue({ ok: false, error: "relation analytics.shop_intake_token missing" });
    const { props, getByTestId } = await renderPage();
    expect(getByTestId("workers")).toBeInTheDocument();
    expect(props.intake).toEqual({ status: null, error: "อ่านสถานะ QR ร้านไม่สำเร็จ — โหลดหน้าใหม่แล้วลองอีกครั้ง" });
  });
  it("ทะเบียนช่างล้ม → ErrorState (ไม่แสดง WorkersClient)", async () => {
    canManageJobs.mockResolvedValue(true);
    getWorkers.mockResolvedValue({ ok: false, error: "โหลดทะเบียนช่างไม่สำเร็จ ลองใหม่อีกครั้ง" });
    getShopIntakeStatus.mockResolvedValue({ ok: true, data: { active: false, issuedAt: null } });
    const { queryByTestId, container } = await renderPage();
    expect(queryByTestId("workers")).toBeNull();
    expect(container.textContent).toContain("โหลดทะเบียนช่างไม่สำเร็จ");
  });
  it("ไม่มีสิทธิ์ → หน้าจำกัดสิทธิ์ · ไม่เรียก action", async () => {
    canManageJobs.mockResolvedValue(false);
    getWorkers.mockClear();
    getShopIntakeStatus.mockClear();
    const { container } = await renderPage();
    expect(container.textContent).toContain("หน้านี้จำกัดสิทธิ์");
    expect(getWorkers).not.toHaveBeenCalled();
    expect(getShopIntakeStatus).not.toHaveBeenCalled();
  });
});
