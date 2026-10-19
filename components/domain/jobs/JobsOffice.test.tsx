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
const PF = [{ id: "99999999-0000-4000-8000-000000000001", name: "แบบ 1", note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, stages: [], jobsOpen: 0 }];
const createJob = vi.fn();
const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a),
  getJobsForSourceItems: (...a: unknown[]) => getJobsForSourceItems(...a),
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
}));
const saveWorker = vi.fn();
const resetWorkerPin = vi.fn();
const setWorkerActive = vi.fn();
const unlockWorker = vi.fn();
vi.mock("@/lib/actions/job-workers", () => ({
  unlockWorker: (...a: unknown[]) => unlockWorker(...a),
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

const planData = (o: Record<string, unknown> = {}) => ({
  qtyOrder: 12, qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 12, underPlanned: false,
  rejectBasis: { castPct: null, polishPct: null, platePct: null, hasPlating: false },
  targetPieceG: null, targetPieceGSource: null, metal: "silver", metalPlanG: null, metalPlanBasis: null, missing: [], ...o,
});
const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const printable: PrintableJob = {
  jobId: U1, jobNo: "JB-0007", designLabel: "แหวนลาย A", sku: "RG-001", metalLabel: "เงิน", qtyOrder: 12, qtyPlanned: 12, targetPieceG: null, metalPlanG: null, dueDate: "2026-10-30", sourceLabel: "งานลูกค้า", weightStartG: null,
  profileName: null,
  primaryPhotoUrl: null,
  stages: [{ seq: 1, name: "หล่อ", weighRequired: true, scrapQtyAsk: true, scrapWeightAsk: false }, { seq: 2, name: "ขัด", weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  // ค่าเริ่มของตัวอย่างแผน (0175): ไม่มีค่าแนะนำ/ไม่มีน้ำหนัก — ใบเดิมไม่ขึ้นสองเลข
  getJobPlanSuggest.mockResolvedValue({ ok: true, data: planData() });
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
      { id: U1, displayName: "ช่างเอ", stageCodes: ["cast"], isActive: true, lockedUntil: null, createdAt: null, lockState: "none" as const, failedAttempts: 0, pinWarning: false },
      { id: U2, displayName: "ช่างบี", stageCodes: [], isActive: false, lockedUntil: null, createdAt: null, lockState: "none" as const, failedAttempts: 0, pinWarning: false },
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
    expect(screen.queryByText("ยังไม่กำหนดขั้น")).not.toBeInTheDocument(); // ช่างบี ปิดใช้งาน = อยู่แท็บ "ปิดใช้งาน" (ดู describe แท็บ)
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

  it("ช่างที่ถูกล็อก: เห็นสถานะล็อก + ปุ่มปลดล็อก (เฉพาะคนที่ล็อก) → เรียก unlockWorker(id)", async () => {
    unlockWorker.mockResolvedValue({ ok: true, data: null });
    const locked = { ...data, workers: [{ ...data.workers[0], lockState: "office" as const, failedAttempts: 15 }, { ...data.workers[1], isActive: true, lockState: "temporary" as const, failedAttempts: 5 }, { ...data.workers[0], id: "33333333-3333-4333-8333-333333333333", displayName: "ช่างซี", lockState: "none" as const, failedAttempts: 2 }] };
    wrap(<WorkersClient data={locked} />);
    expect(screen.getByText(/ล็อกจนกว่าออฟฟิศปลดล็อก · ผิด 15 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/ล็อกชั่วคราว/)).toBeInTheDocument();
    expect(screen.getByText(/ผิด 2 ครั้งในรอบ 24 ชม./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ปลดล็อก ช่างซี" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ปลดล็อก ช่างเอ" }));
    expect(unlockWorker).toHaveBeenCalledWith(U1);
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

describe("WorkersClient แท็บ ใช้งานอยู่ / ปิดใช้งาน", () => {
  const mk = (id: string, displayName: string, isActive: boolean, over: Record<string, unknown> = {}) => ({ id, displayName, stageCodes: ["cast"], isActive, lockedUntil: null, createdAt: null, lockState: "none" as const, failedAttempts: 0, pinWarning: false, ...over });
  const U3 = "33333333-3333-4333-8333-333333333333";
  const stages = [{ code: "cast", nameTh: "หล่อ" }, { code: "polish", nameTh: "ขัด" }];
  const data = { workers: [mk(U1, "ช่างเอ", true), mk(U2, "ช่างบี", false), mk(U3, "ช่างซี", true)], stages };

  it("เริ่มที่แท็บ 'ใช้งานอยู่' · ตัวเลขนับถูก · ไม่เห็นช่างที่ปิด", () => {
    wrap(<WorkersClient data={data} />);
    expect(screen.getByRole("button", { name: "ใช้งานอยู่ (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ปิดใช้งาน (1)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("ช่างเอ")).toBeInTheDocument();
    expect(screen.getByText("ช่างซี")).toBeInTheDocument();
    expect(screen.queryByText("ช่างบี")).not.toBeInTheDocument();
    expect(screen.getAllByText("ใช้งานอยู่")).toHaveLength(2); // badge เขียวต่อแถว (ไม่นับปุ่มแท็บที่มีตัวเลขต่อท้าย)
  });

  it("กดแท็บ 'ปิดใช้งาน' = เห็นเฉพาะคนที่ปิด + badge 'ปิดใช้งาน' + ปุ่มเปิดใช้งาน", async () => {
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน (1)" }));
    expect(screen.getByRole("button", { name: "ปิดใช้งาน (1)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("ช่างบี")).toBeInTheDocument();
    expect(screen.queryByText("ช่างเอ")).not.toBeInTheDocument();
    expect(screen.queryByText("ช่างซี")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดใช้งาน ช่างบี" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ใช้งานอยู่ (2)" }));
    expect(screen.getByText("ช่างเอ")).toBeInTheDocument();
    expect(screen.queryByText("ช่างบี")).not.toBeInTheDocument();
  });

  it("แท็บว่าง = empty state สั้นๆ", async () => {
    const { unmount } = wrap(<WorkersClient data={{ workers: [mk(U1, "ช่างเอ", true)], stages }} />);
    expect(screen.getByRole("button", { name: "ปิดใช้งาน (0)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน (0)" }));
    expect(screen.getByText("ยังไม่มีช่างที่ปิดใช้งาน")).toBeInTheDocument();
    unmount();
    wrap(<WorkersClient data={{ workers: [mk(U2, "ช่างบี", false)], stages }} />);
    expect(screen.getByText("ยังไม่มีช่างที่ใช้งานอยู่")).toBeInTheDocument();
    expect(screen.queryByText("ช่างบี")).not.toBeInTheDocument();
  });

  it("แถวช่างที่ปิดใช้งานแต่มีคำเตือน PIN ยังเห็นคำเตือนในแท็บปิดใช้งาน · ช่างที่ใช้งานอยู่เห็นในแท็บใช้งานอยู่", async () => {
    wrap(<WorkersClient data={{ workers: [mk(U1, "ช่างเอ", true, { failedAttempts: 4, pinWarning: true }), mk(U2, "ช่างบี", false, { failedAttempts: 6, pinWarning: true })], stages }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("มีคนใส่ PIN ผิด 4 ครั้ง");
    await userEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน (1)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("มีคนใส่ PIN ผิด 6 ครั้ง");
  });

  it("ปุ่มปิดใช้งาน/เปิดใช้งานเรียก setWorkerActive ตาม isActive เดิม", async () => {
    setWorkerActive.mockResolvedValue({ ok: true, data: null });
    wrap(<WorkersClient data={data} />);
    await userEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน ช่างเอ" }));
    expect(setWorkerActive).toHaveBeenCalledWith(U1, false);
    await userEvent.click(screen.getByRole("button", { name: "ปิดใช้งาน (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "เปิดใช้งาน ช่างบี" }));
    expect(setWorkerActive).toHaveBeenCalledWith(U2, true);
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
      data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 12, designLabel: "แหวนลาย A", depositMissing: true, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }, { code: "polish", nameTh: "ขัด", defaultSelected: false }] },
    });
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
    wrap(<JobCreatePanel kind="oem" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    expect(suggestJob).toHaveBeenCalledWith("oem", U1);
    const polish = await screen.findByLabelText("ขัด");
    await userEvent.click(polish);
    const submit = screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เหตุผลที่เริ่มผลิตก่อน/), "ลูกค้าประจำ");
    // ติ๊กขั้นใหม่ = ถามแผนจาก DB ซ้ำ (debounce ~400ms) ระหว่างรอปุ่มสร้างปิดอยู่ (spec §A)
    await waitFor(() => expect(submit).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submit);
    expect(createJob).toHaveBeenCalledWith({ kind: "oem", itemId: U1, stageCodes: ["cast", "polish"], dueDate: null, startGateNote: "ลูกค้าประจำ", designLabel: "แหวนลาย A", profileId: PF[0].id });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/J9#job-photos"));
  });

  const suggestion = (o: Record<string, unknown> = {}) => ({
    ok: true,
    data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 12, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }], ...o },
  });

  it("OEM: ชื่อเรียกภายใน (ช่างเห็น) เติมค่าเริ่มจาก suggest · มีคำเตือนห้ามชื่อแบรนด์ลูกค้า · ล้างชื่อ = สร้างไม่ได้ · แก้แล้วส่งชื่อใหม่", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue(suggestion());
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
    wrap(<JobCreatePanel kind="oem" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    const input = (await screen.findByLabelText(/ชื่อเรียกภายใน/)) as HTMLInputElement;
    expect(input.value).toBe("แหวนลาย A");
    expect(screen.getByText(/ห้ามมีชื่อแบรนด์/)).toBeInTheDocument();
    const submit = screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
    await userEvent.clear(input);
    expect(submit).toBeDisabled();
    await userEvent.type(input, "แหวนกลาง ไซส์ 7");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "oem", designLabel: "แหวนกลาง ไซส์ 7" }));
  });

  it("ใบผลิตเข้าสต็อก: ชื่อเรียกไม่บังคับ — ว่างก็สร้างได้ (ส่ง null)", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue(suggestion({ designLabel: "" }));
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J8", jobNo: "JB-0008", planMissing: [] } });
    wrap(<JobCreatePanel kind="production" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    await screen.findByLabelText(/ชื่อเรียกภายใน/);
    const submit = screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "production", designLabel: null }));
  });

  it("รายการมีใบงานอยู่แล้ว (race) = เตือนและสร้างไม่ได้", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue({ ok: true, data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 1, designLabel: "x", depositMissing: false, existingJob: { id: "J1", jobNo: "JB-0001" }, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }] } });
    wrap(<JobCreatePanel kind="production" items={items} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("JB-0001");
    expect(screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)).toBeDisabled();
  });
});

describe("JobPrintClient — ที่อยู่ QR และคำเตือน preview (security L2)", () => {
  it("แสดงที่อยู่ที่ QR จะชี้ไป · พิมพ์จาก preview = แถบเตือนอยู่ในส่วนที่ซ่อนตอนพิมพ์ (ไม่ขึ้นบนใบ)", () => {
    wrap(<JobPrintClient job={printable} qr={{ host: "oms-git-x.vercel.app", warning: "พิมพ์จาก preview — QR อาจใช้ไม่ได้ (ตัวอย่าง)", error: null }} />);
    expect(screen.getByText("oms-git-x.vercel.app")).toBeInTheDocument();
    const warn = screen.getByText(/พิมพ์จาก preview — QR อาจใช้ไม่ได้/);
    expect(warn.closest("section")!.className).toContain("print:hidden");
    expect(screen.getByRole("article", { name: /JB-0007/ }).textContent).not.toContain("preview");
  });

  it("ตั้งค่า origin ไม่ได้ (APP_ORIGIN ผิด/ไม่รู้ host) = แสดงข้อผิดพลาด · ปุ่มออก QR ใช้ไม่ได้ · ไม่เรียก server", async () => {
    wrap(<JobPrintClient job={printable} qr={{ host: null, warning: null, error: "ตั้งค่า APP_ORIGIN ไม่ถูกต้อง (ตัวอย่าง)" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ตั้งค่า APP_ORIGIN ไม่ถูกต้อง");
    const btn = screen.getByRole("button", { name: /ออก QR และพิมพ์/ });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(issueJobQr).not.toHaveBeenCalled();
  });

  it("production ปกติ (ไม่มีคำเตือน) = ไม่มี alert", () => {
    wrap(<JobPrintClient job={printable} qr={{ host: "oms.example.test", warning: null, error: null }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("0174: ทะเบียนช่าง — คำเตือน PIN ผิด · ห้าม < > ในชื่อ", () => {
  const w0 = { id: U1, displayName: "ช่างเอ", stageCodes: ["cast"], isActive: true, lockedUntil: null, createdAt: null, lockState: "none" as const, failedAttempts: 0, pinWarning: false };
  const stages = [{ code: "cast", nameTh: "หล่อ" }, { code: "polish", nameTh: "ขัด" }];

  it("pin_warning: ป้ายเตือน 'มีคนใส่ PIN ผิด n ครั้ง' + คำอธิบาย 15 ครั้ง + ปุ่ม 'ปลดล็อก / รีเซ็ตตัวนับ' (ทั้งที่ยังไม่ล็อก)", async () => {
    unlockWorker.mockResolvedValue({ ok: true, data: null });
    wrap(<WorkersClient data={{ workers: [{ ...w0, failedAttempts: 4, pinWarning: true }, { ...w0, id: U2, displayName: "ช่างบี" }], stages }} />);
    const warn = screen.getByRole("alert");
    expect(warn).toHaveTextContent("มีคนใส่ PIN ผิด 4 ครั้ง ในรอบ 24 ชม.");
    expect(warn).toHaveTextContent("ครบ 15 ครั้งใน 24 ชม. ระบบจะล็อกจนกว่าออฟฟิศปลดล็อก");
    expect(screen.queryByRole("button", { name: "ปลดล็อก ช่างบี" })).not.toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "ปลดล็อก ช่างเอ" });
    expect(btn).toHaveTextContent("รีเซ็ตตัวนับ");
    await userEvent.click(btn);
    expect(unlockWorker).toHaveBeenCalledWith(U1);
  });

  it("ผิด 1-2 ครั้ง (ยังไม่ถึงเกณฑ์เตือน) = บรรทัดเล็ก ไม่มี alert", () => {
    wrap(<WorkersClient data={{ workers: [{ ...w0, failedAttempts: 2 }], stages }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/ผิด 2 ครั้งในรอบ 24 ชม./)).toBeInTheDocument();
  });

  it("ชื่อช่างมี < หรือ > = แสดงเหตุผลและบันทึกไม่ได้", async () => {
    wrap(<WorkersClient data={{ workers: [], stages }} />);
    await userEvent.click(screen.getAllByRole("button", { name: /เพิ่มช่าง/ })[0]);
    await userEvent.type(screen.getByLabelText(/ชื่อที่ช่างเห็น/), "ช่าง<b>");
    await userEvent.click(screen.getByLabelText("หล่อ"));
    expect(screen.getByText("ชื่อห้ามมีเครื่องหมาย < หรือ >")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    expect(saveWorker).not.toHaveBeenCalled();
  });

  it("ชื่อเรียกภายในตอนสร้างใบงานมี < > = สร้างไม่ได้", async () => {
    getJobsForSourceItems.mockResolvedValue({ ok: true, data: [] });
    suggestJob.mockResolvedValue({ ok: true, data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 1, designLabel: "แหวน", depositMissing: false, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }] } });
    wrap(<JobCreatePanel kind="oem" items={[{ id: U1, label: "แหวน" }]} />);
    await userEvent.click((await screen.findAllByRole("button", { name: "สร้างใบงาน" }))[0]);
    const input = await screen.findByLabelText(/ชื่อเรียกภายใน/);
    await userEvent.type(input, "<x>");
    expect(screen.getByText("ชื่อห้ามมีเครื่องหมาย < หรือ >")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)).toBeDisabled();
  });
});
