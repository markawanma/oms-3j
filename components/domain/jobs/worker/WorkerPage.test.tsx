// @vitest-environment jsdom
// หน้า /w/<token> (server component): ใบที่ปิดแล้วต้องมีข้อความ "ใบงานนี้ปิดแล้ว" ครั้งเดียว (QA N4) · ลิงก์ใช้ไม่ได้ = หัวข้อ + เหตุผลอย่างละหนึ่ง
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const loadWorkerView = vi.fn();
vi.mock("@/lib/jobs/worker-server", () => ({ loadWorkerView: (...a: unknown[]) => loadWorkerView(...a) }));
vi.mock("@/components/domain/jobs/worker/WorkerApp", () => ({ WorkerApp: () => <div data-testid="app" /> }));

import WorkerPage from "../../../../app/(worker)/w/[token]/page";

async function renderPage() {
  const ui = await WorkerPage({ params: Promise.resolve({ token: "tok" }) });
  return render(ui);
}
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("WorkerPage — ข้อความผิดพลาด", () => {
  it("job_closed: 'ใบงานนี้ปิดแล้ว' ปรากฏครั้งเดียว (ไม่ซ้ำหัวข้อ+ข้อความ)", async () => {
    loadWorkerView.mockResolvedValue({ ok: false, code: "job_closed", error: "ใบงานนี้ปิดแล้ว" });
    const { container } = await renderPage();
    expect(count(container.textContent ?? "", "ใบงานนี้ปิดแล้ว")).toBe(1);
  });
  it("invalid_token: หัวข้อ 'เปิดใบงานไม่ได้' + เหตุผล (ข้อความต่างกัน)", async () => {
    loadWorkerView.mockResolvedValue({ ok: false, code: "invalid_token", error: "ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ" });
    const { container } = await renderPage();
    expect(container.textContent).toContain("เปิดใบงานไม่ได้");
    expect(container.textContent).toContain("ขอพิมพ์ใบงานใหม่จากออฟฟิศ");
  });
  it("สำเร็จ = แสดงแอปช่าง", async () => {
    loadWorkerView.mockResolvedValue({ ok: true, data: { job: { jobNo: "x" } } });
    const { getByTestId } = await renderPage();
    expect(getByTestId("app")).toBeInTheDocument();
  });
});
