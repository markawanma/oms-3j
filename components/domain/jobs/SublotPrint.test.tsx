// @vitest-environment jsdom
// ใบย่อย (0181): ประกอบทีละ field · ไม่มีชื่อผู้เปิด/ผู้ถือ/เงิน/น้ำหนัก · QR = ใบแม่เดิม ไม่เพิกถอนใบเก่า · เพดาน 5 ใบต้องเลือกเพิกถอนเอง · ใบหลักของใบที่แยกแล้วค่าเริ่ม = ไม่เพิกถอน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const issueJobQr = vi.fn();
const revokeJobQr = vi.fn();
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: (...a: unknown[]) => issueJobQr(...a), revokeJobQr: (...a: unknown[]) => revokeJobQr(...a) }));
const listJobQr = vi.fn();
vi.mock("@/lib/actions/job-lots", () => ({ listJobQr: (...a: unknown[]) => listJobQr(...a), splitJobLot: vi.fn(), cancelJobLot: vi.fn(), resolveDiscrepancyOffice: vi.fn(), voidDiscrepancy: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobPrintClient } from "./JobPrintClient";
import { SublotPrintClient, SublotSheet } from "./SublotPrintClient";
import { toPrintableJob, toPrintableSublot } from "@/lib/jobs/print";
import type { PrintableSublot } from "@/lib/jobs/print";
import { mapJobDetail } from "@/lib/jobs/types";
import { mapLotPart } from "@/lib/jobs/lots";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const LOT = "22222222-2222-4222-8222-222222222222";

const job = () =>
  mapJobDetail({
    id: JOB, job_no: "JB-0020", source_kind: "production", design_label: "แหวนโกเมนไข่", sku_snapshot: "RG-001", metal: "silver", qty_planned: 100, qty_order: 100, status: "in_progress", due_date: "2026-10-30",
    note: "หมายเหตุภายใน", start_gate_note: "เหตุผลก่อนมัดจำ", target_piece_g: 4, metal_plan_g: 400, production_order_item_id: "33333333-3333-4333-8333-333333333333",
  })!;
const part = (o: Record<string, unknown> = {}) => ({ ...mapLotPart({ job_id: LOT, root_job_id: JOB, lot_seq: 2, label: "JB-0020 · ส่วนที่ 2", status: "in_progress", qty_planned: 40, qty_live: 40, stage_code: "setting", stage_name: "ฝังพลอย", stage_status: "pending", holder_name: "ช่างลับ ห้ามขึ้นใบ", ...o })!, passedStages: ["หล่อ", "ขัด"] });
const sub = (): PrintableSublot => toPrintableSublot(job(), part(), "2026-10-19")!;

const qrRow = (n: number) => ({ printNo: n, purpose: "traveler", lotJobId: null, label: null, issuedAt: "2026-10-19T03:00:00Z", active: true, revokedAt: null, revokeReason: null });

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  listJobQr.mockResolvedValue({ ok: true, data: [qrRow(1)] });
  issueJobQr.mockResolvedValue({ ok: true, data: { svg: '<svg viewBox="0 0 25 25"><rect width="25" height="25"/></svg>', printNo: 2, jobNo: "JB-0020", revokedPrevious: 0 } });
  revokeJobQr.mockResolvedValue({ ok: true, data: { revoked: 1 } });
});

describe("toPrintableSublot — ด่าน type boundary", () => {
  it("ประกอบเฉพาะ field ที่ใบย่อยต้องใช้ · ไม่มีชื่อผู้ถือ/ผู้เปิด · ไม่มี note/เหตุผลก่อนมัดจำ/น้ำหนัก/แผนโลหะ/เงิน", () => {
    const s = sub();
    expect(Object.keys(s).sort()).toEqual(["designLabel", "dueDate", "jobId", "lotJobId", "lotLabel", "lotSeq", "metalLabel", "passedLine", "primaryPhotoUrl", "printedOn", "qty", "sku", "sourceLabel", "stageName"]);
    const json = JSON.stringify(s);
    expect(json).not.toContain("ช่างลับ");
    expect(json).not.toContain("หมายเหตุภายใน");
    expect(json).not.toContain("เหตุผลก่อนมัดจำ");
    expect(json).not.toMatch(/400|metalPlan|targetPiece|weight/i);
    expect(findForbiddenKeys(s)).toEqual([]);
    expect(s).toMatchObject({ lotLabel: "JB-0020 · ส่วนที่ 2", qty: 40, passedLine: "หล่อ › ขัด", metalLabel: "เงิน", sourceLabel: "ผลิตเข้าสต็อก" });
  });
  it("OEM = 'งานลูกค้า' ไม่มีชื่อลูกค้า", () => {
    const j = mapJobDetail({ id: JOB, job_no: "JB-0030", source_kind: "oem", design_label: "งานกลาง", metal: "gold", qty_planned: 10, qty_order: 10, status: "open", oem_quote_item_id: "44444444-4444-4444-8444-444444444444" })!;
    expect(toPrintableSublot(j, part(), "2026-10-19")?.sourceLabel).toBe("งานลูกค้า");
  });
  it("ต้องไม่ผ่าน: ส่วนหลัก (lotSeq 0) · ส่วนที่ปิด/ยกเลิก · ไม่พบส่วน → null", () => {
    expect(toPrintableSublot(job(), part({ lot_seq: 0 }), "2026-10-19")).toBeNull();
    expect(toPrintableSublot(job(), part({ status: "done" }), "2026-10-19")).toBeNull();
    expect(toPrintableSublot(job(), part({ status: "cancelled" }), "2026-10-19")).toBeNull();
    expect(toPrintableSublot(job(), undefined, "2026-10-19")).toBeNull();
  });
  it("จำนวน = ที่ถืออยู่ (qty_live) ไม่มีค่า = จำนวนของส่วน", () => {
    expect(toPrintableSublot(job(), part({ qty_live: null }), "2026-10-19")?.qty).toBe(40);
  });
});

describe("SublotSheet — กระดาษ", () => {
  it("เลขใบ · ส่วนที่ k · จำนวน · ขั้นที่ผ่านมาบรรทัดเดียว · วันที่พิมพ์ · ข้อความ QR ใบเดิม", () => {
    render(<SublotSheet sub={sub()} qrSvg={null} />);
    const t = document.body.textContent ?? "";
    expect(t).toContain("JB-0020 · ส่วนที่ 2");
    expect(t).toContain("แหวนโกเมนไข่");
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(t).toContain("ผ่านมาแล้ว: หล่อ › ขัด");
    expect(t).toContain("พิมพ์ 19 ต.ค. 2569");
    expect(t).toContain("สแกน QR นี้ = เปิดใบงานเดิม ระบบแสดงเฉพาะส่วนของคนที่สแกน");
  });
  it("🔴 ไม่มีชื่อผู้เปิด/ผู้ถือ และไม่มีตัวเลขเงิน/ต้นทุน/ชื่อลูกค้า/น้ำหนัก", () => {
    render(<SublotSheet sub={sub()} qrSvg={null} />);
    const t = document.body.textContent ?? "";
    expect(t).not.toMatch(/ผู้เปิด|ช่างลับ|บาท|฿|ราคา|ต้นทุน|กำไร|ลูกค้า|THB| g\b|กรัม|เหตุผลก่อนมัดจำ/);
  });
  it("ยังไม่ออก QR: กล่องประ · ออกแล้ว: SVG ของ server", () => {
    const a = render(<SublotSheet sub={sub()} qrSvg={null} />);
    expect(screen.getByText(/QR จะปรากฏหลังกด/)).toBeInTheDocument();
    a.unmount();
    render(<SublotSheet sub={sub()} qrSvg={'<svg viewBox="0 0 25 25"></svg>'} />);
    expect(screen.getByRole("img", { name: /QR ใบงานเดิม/ })).toBeInTheDocument();
  });
});

describe("SublotPrintClient — ออก QR ใหม่ของใบแม่ ไม่เพิกถอนใบเก่า", () => {
  it("กดพิมพ์ → issueJobQr(ใบแม่, keepPrevious=true, {purpose:'sublot', lotJobId}) → แสดง QR → สั่งพิมพ์", async () => {
    wrap(<SublotPrintClient sub={sub()} />);
    await screen.findByText(/QR ที่ใช้งานอยู่ \(1\/5 ใบ\)/);
    await userEvent.click(screen.getByRole("button", { name: "ออก QR และพิมพ์" }));
    await waitFor(() => expect(issueJobQr).toHaveBeenCalledTimes(1));
    expect(issueJobQr).toHaveBeenCalledWith(JOB, true, { purpose: "sublot", lotJobId: LOT });
    expect(await screen.findByRole("img", { name: /QR ใบงานเดิม/ })).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalled(), { timeout: 2000 });
    expect(revokeJobQr).not.toHaveBeenCalled();
  });

  it("กดซ้ำรัวๆ ออก QR ครั้งเดียว", async () => {
    let release: (v: unknown) => void = () => {};
    issueJobQr.mockImplementation(() => new Promise((r) => (release = r)));
    wrap(<SublotPrintClient sub={sub()} />);
    await screen.findByText(/QR ที่ใช้งานอยู่/);
    const b = screen.getByRole("button", { name: "ออก QR และพิมพ์" });
    await userEvent.dblClick(b);
    release({ ok: true, data: { svg: "<svg></svg>", printNo: 2, jobNo: "JB-0020", revokedPrevious: 0 } });
    await waitFor(() => expect(issueJobQr).toHaveBeenCalledTimes(1));
  });

  it("ครบ 5 ใบ: ปุ่มพิมพ์ปิด + ข้อความ + มีรายการให้เลือกเพิกถอนเอง · ไม่เรียก issue/revoke เอง", async () => {
    listJobQr.mockResolvedValue({ ok: true, data: [1, 2, 3, 4, 5].map(qrRow) });
    wrap(<SublotPrintClient sub={sub()} />);
    expect(await screen.findByText(/QR ใช้งานครบ 5 ใบแล้ว — เลือกเพิกถอน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /เพิกถอน QR ใบที่/ })).toHaveLength(5);
    expect(issueJobQr).not.toHaveBeenCalled();
    expect(revokeJobQr).not.toHaveBeenCalled();
  });

  it("เพิกถอนใบที่หาย (มีเหตุผล) → รายการโหลดใหม่ → ปุ่มพิมพ์กลับมาใช้ได้", async () => {
    listJobQr.mockResolvedValueOnce({ ok: true, data: [1, 2, 3, 4, 5].map(qrRow) });
    wrap(<SublotPrintClient sub={sub()} />);
    await userEvent.click(await screen.findByRole("button", { name: "เพิกถอน QR ใบที่ 3" }));
    listJobQr.mockResolvedValue({ ok: true, data: [1, 2, 4, 5].map(qrRow) });
    await userEvent.type(screen.getByLabelText(/เหตุผล/), "กระดาษหาย");
    await userEvent.click(screen.getByRole("button", { name: "เพิกถอน QR" }));
    await waitFor(() => expect(revokeJobQr).toHaveBeenCalledWith(JOB, "กระดาษหาย", 3));
    await waitFor(() => expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeEnabled());
  });

  it("ออก QR ไม่สำเร็จ (DB ปฏิเสธ) → ข้อความไทย ไม่สั่งพิมพ์", async () => {
    issueJobQr.mockResolvedValue({ ok: false, error: "ใบงานนี้มี QR ใช้งานครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม" });
    wrap(<SublotPrintClient sub={sub()} />);
    await screen.findByText(/QR ที่ใช้งานอยู่/);
    await userEvent.click(screen.getByRole("button", { name: "ออก QR และพิมพ์" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ครบ 5 ใบแล้ว");
    expect(window.print).not.toHaveBeenCalled();
  });

  it("โหลดรายการ QR ไม่ได้ → พิมพ์ไม่ได้จนกว่าจะรู้จำนวน (ไม่เดา) · ปุ่มโหลดใหม่", async () => {
    listJobQr.mockResolvedValueOnce({ ok: false, error: "โหลดไม่สำเร็จ" });
    wrap(<SublotPrintClient sub={sub()} />);
    expect(await screen.findByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeEnabled());
  });

  it("origin ตั้งค่าไม่ได้ → ข้อความ error ปุ่มปิด", async () => {
    wrap(<SublotPrintClient sub={sub()} qrTarget={{ host: null, warning: null, error: "ตั้งค่าที่อยู่เว็บไม่ได้" }} />);
    await screen.findByText(/QR ที่ใช้งานอยู่/);
    expect(screen.getByRole("alert")).toHaveTextContent("ตั้งค่าที่อยู่เว็บไม่ได้");
    expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeDisabled();
  });
});

describe("ใบงานหลักของใบที่แยกส่วนแล้ว", () => {
  const printable = () => toPrintableJob(job(), []);
  it("defaultKeep=true → ติ๊ก 'พิมพ์สำเนาเพิ่ม (ไม่เพิกถอน)' ไว้ล่วงหน้า · ค่าเริ่มเดิม (ใบเดี่ยว) = ไม่ติ๊ก", () => {
    const a = render(<JobPrintClient job={printable()} defaultKeep />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    a.unmount();
    render(<JobPrintClient job={printable()} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("กดพิมพ์ด้วยค่าเริ่ม defaultKeep → issueJobQr(jobId, true) ไม่เพิกถอน", async () => {
    render(<JobPrintClient job={printable()} defaultKeep />);
    await userEvent.click(screen.getByRole("button", { name: "ออก QR และพิมพ์" }));
    await waitFor(() => expect(issueJobQr).toHaveBeenCalledWith(JOB, true));
  });
});
