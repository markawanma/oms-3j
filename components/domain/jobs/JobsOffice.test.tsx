// @vitest-environment jsdom
// ฝั่งออฟฟิศ: ใบงานพิมพ์ (QR ตามปุ่ม · checkbox สำเนาเพิ่ม · ไม่มีราคา/ลูกค้า) · ทะเบียนช่าง (PIN แสดงครั้งเดียว) · ปุ่มสร้างใบงาน (4 state) · แท็บย่อย
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const issueJobQr = vi.fn();
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: (...a: unknown[]) => issueJobQr(...a) }));
const getJobsForSourceItems = vi.fn();
const suggestJob = vi.fn();
const createJob = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  getJobsForSourceItems: (...a: unknown[]) => getJobsForSourceItems(...a),
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
}));
const saveWorker = vi.fn();
const resetWorkerPin = vi.fn();
const setWorkerActive = vi.fn();
vi.mock("@/lib/actions/job-workers", () => ({
  saveWorker: (...a: unknown[]) => saveWorker(...a),
  resetWorkerPin: (...a: unknown[]) => resetWorkerPin(...a),
  setWorkerActive: (...a: unknown[]) => setWorkerActive(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobPrintClient } from "./JobPrintClient";
import { WorkersClient } from "./WorkersClient";
import { JobCreatePanel } from "./JobCreatePanel";
import { jobsTabActive } from "./JobsSubNav";
import type { PrintableJob } from "@/lib/jobs/print";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const printable: PrintableJob = {
  jobId: U1, jobNo: "JB-0007", designLabel: "แหวนลาย A", sku: "RG-001", metalLabel: "เงิน", qtyPlanned: 12, dueDate: "2026-10-30", sourceLabel: "งานลูกค้า", weightStartG: null,
  stages: [{ seq: 1, name: "หล่อ", weighRequired: true }, { seq: 2, name: "ขัด", weighRequired: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
});

describe("JobsSubNav active", () => {
  it("ใบงานรายใบ = แท็บบอร์ด · ทะเบียนช่างไม่ทำให้บอร์ดสว่างค้าง", () => {
    expect(jobsTabActive("/jobs", "/jobs")).toBe(true);
    expect(jobsTabActive(`/jobs/${U1}`, "/jobs")).toBe(true);
    expect(jobsTabActive(`/jobs/${U1}/print`, "/jobs")).toBe(true);
    expect(jobsTabActive("/jobs/workers", "/jobs")).toBe(false);
    expect(jobsTabActive("/jobs/workers", "/jobs/workers")).toBe(true);
    expect(jobsTabActive("/oem", "/jobs")).toBe(false);
  });
});

describe("JobPrintClient", () => {
  it("ก่อนกดปุ่มไม่มี QR และไม่พิมพ์ · ใบมีเฉพาะข้อมูลที่อนุญาต (ไม่มีราคา/ต้นทุน/ลูกค้า)", () => {
    wrap(<JobPrintClient job={printable} />);
    expect(screen.getByRole("article", { name: /JB-0007/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR/ })).not.toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/ราคา|ต้นทุน|ลูกค้า:|บาท|฿|THB|มัดจำ/);
    expect(screen.getByText("ผู้รับเซ็น")).toBeInTheDocument();
  });

  it("ไม่ติ๊กสำเนา = keep false · ออก QR แล้วแสดง SVG และสั่งพิมพ์", async () => {
    issueJobQr.mockResolvedValue({ ok: true, data: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', printNo: 2, jobNo: "JB-0007", revokedPrevious: 1 } });
    wrap(<JobPrintClient job={printable} />);
    await userEvent.click(screen.getByRole("button", { name: /ออก QR และพิมพ์/ }));
    expect(issueJobQr).toHaveBeenCalledWith(U1, false);
    expect(await screen.findByRole("img", { name: /QR/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("เพิกถอนใบเก่า 1 ใบ");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("ติ๊ก 'พิมพ์สำเนาเพิ่ม' = keep true", async () => {
    issueJobQr.mockResolvedValue({ ok: true, data: { svg: "<svg/>", printNo: 3, jobNo: "JB-0007", revokedPrevious: 0 } });
    wrap(<JobPrintClient job={printable} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /ออก QR และพิมพ์/ }));
    expect(issueJobQr).toHaveBeenCalledWith(U1, true);
  });

  it("DB ปฏิเสธ (เช่น ยังไม่มีเหตุผลก่อนมัดจำ) = ข้อความไทย ไม่มี QR ไม่พิมพ์", async () => {
    issueJobQr.mockResolvedValue({ ok: false, error: "ดีลนี้ยังไม่มีมัดจำ — บันทึกเหตุผลก่อน" });
    wrap(<JobPrintClient job={printable} />);
    await userEvent.click(screen.getByRole("button", { name: /ออก QR และพิมพ์/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ยังไม่มีมัดจำ");
    expect(screen.queryByRole("img", { name: /QR/ })).not.toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("action throw = ข้อความกลาง ไม่รั่วข้อความดิบ", async () => {
    issueJobQr.mockRejectedValue(new Error("secret-internal-detail"));
    wrap(<JobPrintClient job={printable} />);
    await userEvent.click(screen.getByRole("button", { name: /ออก QR และพิมพ์/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("secret-internal-detail");
  });
});

describe("WorkersClient", () => {
  const data = {
    workers: [
      { id: U1, displayName: "ช่างเอ", stageCodes: ["cast"], isActive: true, lockedUntil: null, createdAt: null },
      { id: U2, displayName: "ช่างบี", stageCodes: [], isActive: false, lockedUntil: null, createdAt: null },
    ],
    stages: [{ code: "cast", nameTh: "หล่อ" }, { code: "polish", nameTh: "ขัด" }],
  };

  it("ว่าง = EmptyState · มีช่าง = แสดงชื่อ ขั้น และสถานะปิดใช้งาน", () => {
    const { unmount } = wrap(<WorkersClient data={{ ...data, workers: [] }} />);
    expect(screen.getByText("ยังไม่มีช่างในทะเบียน")).toBeInTheDocument();
    unmount();
    wrap(<WorkersClient data={data} />);
    expect(screen.getByText("ช่างเอ")).toBeInTheDocument();
    expect(screen.getByText("หล่อ")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่กำหนดขั้น")).toBeInTheDocument();
  });

  it("เพิ่มช่างโดยไม่ใส่ PIN → PIN ที่ระบบสุ่มแสดงครั้งเดียว ปิดกล่องแล้วหาย", async () => {
    saveWorker.mockResolvedValue({ ok: true, data: { id: U1, pin: "4821" } });
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    await userEvent.type(screen.getByLabelText(/ชื่อที่ช่างเห็น/), "ช่างซี");
    await userEvent.click(screen.getByLabelText("หล่อ"));
    await userEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(saveWorker).toHaveBeenCalledWith({ id: null, displayName: "ช่างซี", stageCodes: ["cast"], pin: null });
    expect(await screen.findByText("4821")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /จดแล้ว/ }));
    expect(screen.queryByText("4821")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("4821");
  });

  it("PIN ที่พิมพ์เองไม่ครบ 4 หลัก = บันทึกไม่ได้ · แก้ช่างเดิมไม่มีช่อง PIN", async () => {
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    await userEvent.type(screen.getByLabelText(/ชื่อที่ช่างเห็น/), "ช่างซี");
    await userEvent.click(screen.getByLabelText("หล่อ"));
    await userEvent.type(screen.getByLabelText(/PIN 4 หลัก/), "12");
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    await userEvent.click(screen.getByRole("button", { name: "แก้ไข ช่างเอ" }));
    expect(screen.queryByLabelText(/PIN 4 หลัก/)).not.toBeInTheDocument();
  });

  it("DB ปฏิเสธ = ข้อความไทยค้างในกล่อง ไม่ปิด", async () => {
    saveWorker.mockResolvedValue({ ok: false, error: "มีช่างชื่อนี้อยู่แล้ว" });
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    await userEvent.type(screen.getByLabelText(/ชื่อที่ช่างเห็น/), "ช่างเอ");
    await userEvent.click(screen.getByLabelText("ขัด"));
    await userEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีช่างชื่อนี้อยู่แล้ว");
  });

  it("รีเซ็ต PIN → แสดง PIN ใหม่ครั้งเดียว", async () => {
    resetWorkerPin.mockResolvedValue({ ok: true, data: { pin: "0735" } });
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "รีเซ็ต PIN ของ ช่างเอ" }));
    await userEvent.click(screen.getByRole("button", { name: "สุ่ม PIN ใหม่" }));
    expect(resetWorkerPin).toHaveBeenCalledWith(U1, null);
    expect(await screen.findByText("0735")).toBeInTheDocument();
  });
});

describe("JobCreatePanel", () => {
  const items = [{ id: U1, label: "แหวนลาย A" }, { id: U2, label: "จี้ลาย B" }];

  it("loading → success: รายการที่มีใบงานแล้วเป็นลิงก์ ที่ยังไม่มีเป็นปุ่มสร้าง", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [{ itemId: U1, jobId: "J1", jobNo: "JB-0001", status: "open" }] });
    wrap(<JobCreatePanel kind="oem" items={items} />);
    expect(screen.getByRole("status")).toHaveTextContent("กำลังโหลด");
    expect(await screen.findByRole("link", { name: /JB-0001/ })).toHaveAttribute("href", "/jobs/J1");
    expect(screen.getAllByRole("button", { name: "สร้างใบงาน" })).toHaveLength(1);
    expect(getJobsForSourceItems).toHaveBeenCalledWith("oem", [U1, U2]);
  });

  it("error → ลองใหม่ได้", async () => {
    getJobsForSourceItems.mockResolvedValueOnce({ ok: false, error: "โหลดไม่สำเร็จ" }).mockResolvedValueOnce({ ok: true, data: [] });
    wrap(<JobCreatePanel kind="production" items={items} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดไม่สำเร็จ");
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findAllByRole("button", { name: "สร้างใบงาน" })).toHaveLength(2);
  });

  it("empty: ไม่มีรายการ", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    wrap(<JobCreatePanel kind="oem" items={[]} />);
    expect(await screen.findByText(/ยังไม่มีรายการให้สร้างใบงาน/)).toBeInTheDocument();
  });

  it("สร้าง: ขั้นเริ่มต้นตามที่ DB เสนอ · ยังไม่มีมัดจำ = ต้องกรอกเหตุผลก่อนปุ่มเปิด · ส่งขั้นตามลำดับที่ DB เสนอ", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue({
      ok: true,
      data: { metal: "silver", qty: 12, designLabel: "แหวนลาย A", depositMissing: true, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }, { code: "polish", nameTh: "ขัด", defaultSelected: false }] },
    });
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009" } });
    wrap(<JobCreatePanel kind="oem" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    expect(suggestJob).toHaveBeenCalledWith("oem", U1);
    const polish = await screen.findByLabelText("ขัด");
    await userEvent.click(polish);
    const submit = screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เหตุผลที่เริ่มผลิตก่อน/), "ลูกค้าประจำ");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(createJob).toHaveBeenCalledWith({ kind: "oem", itemId: U1, stageCodes: ["cast", "polish"], dueDate: null, startGateNote: "ลูกค้าประจำ" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/J9"));
  });

  it("รายการมีใบงานอยู่แล้ว (race) = เตือนและสร้างไม่ได้", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue({ ok: true, data: { metal: "silver", qty: 1, designLabel: "x", depositMissing: false, existingJob: { id: "J1", jobNo: "JB-0001" }, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }] } });
    wrap(<JobCreatePanel kind="production" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("JB-0001");
    expect(screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)).toBeDisabled();
  });
});
