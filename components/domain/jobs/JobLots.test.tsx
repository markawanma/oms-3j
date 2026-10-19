// @vitest-environment jsdom
// หน้าใบงานแม่ (ออฟฟิศ · 0181 L1): ใบแม่ + ส่วน + แถบสะสมรวม N ครบ · แยกส่วน/ยกเลิกส่วน · ส่วนต่างรอชี้แจง · QR ที่ใช้งานอยู่ + เพดาน 5 · ปิด full disabled
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const lots = {
  splitJobLot: vi.fn(), cancelJobLot: vi.fn(), resolveDiscrepancyOffice: vi.fn(), voidDiscrepancy: vi.fn(), listJobQr: vi.fn(),
};
vi.mock("@/lib/actions/job-lots", () => ({
  splitJobLot: (...a: unknown[]) => lots.splitJobLot(...a),
  cancelJobLot: (...a: unknown[]) => lots.cancelJobLot(...a),
  resolveDiscrepancyOffice: (...a: unknown[]) => lots.resolveDiscrepancyOffice(...a),
  voidDiscrepancy: (...a: unknown[]) => lots.voidDiscrepancy(...a),
  listJobQr: (...a: unknown[]) => lots.listJobQr(...a),
}));
const w = { revokeJobQr: vi.fn(), doneJob: vi.fn(), officeReceiveStage: vi.fn() };
vi.mock("@/lib/actions/job-office-write", () => ({
  revokeJobQr: (...a: unknown[]) => w.revokeJobQr(...a),
  doneJob: (...a: unknown[]) => w.doneJob(...a),
  setJobSurplus: vi.fn(), setJobQtyPlanned: vi.fn(), setJobPlan: vi.fn(), cancelJob: vi.fn(), reopenJobStage: vi.fn(), setJobDesignLabel: vi.fn(), setJobDue: vi.fn(), setJobStartGateNote: vi.fn(),
  skipJobStage: vi.fn(), officeReceiveStage: (...a: unknown[]) => w.officeReceiveStage(...a), officeSendStage: vi.fn(), issueJobQr: vi.fn(),
}));
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: vi.fn() }));
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: vi.fn(), changeJobProfile: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobDetailClient } from "./JobDetailClient";
import { mapBoardRow, mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import { mapDiscrepancy, mapLotPart, mapLotsSummary, mapTreeStageLoss } from "@/lib/jobs/lots";
import type { JobLotsData, LotPart } from "@/lib/jobs/lots";
import type { JobDetailData } from "@/lib/actions/job-office";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222221";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "22222222-2222-4222-8222-222222222223";
const DISC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const stage = (code: string, seq: number, status: string): StageRow => ({
  id: `s-${code}`, seq, code, name: code === "cast" ? "หล่อ" : code === "qc" ? "ตรวจ QC" : "แพ็ก", status, weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: false, receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null,
});

const tp = (o: Record<string, unknown>): LotPart => {
  const p = mapLotPart({ job_id: JOB, root_job_id: JOB, lot_seq: 0, label: "JB-0020", status: "in_progress", qty_planned: 50, qty_live: 50, stage_code: "setting", stage_name: "ฝังพลอย", stage_status: "received", holder_name: "ช่าง ค", days_in_stage: 2, ...o })!;
  return p;
};

/** JB-0020 = 100: ส่วนหลัก 50 + ส่วน 1 (10) ฝังพลอย + ส่วน 2 (5) QC + ส่วน 3 (34) ผ่าน QC + เสีย 1 */
function jb0020(sumCheck = true): JobLotsData {
  const parts = [
    { ...tp({}), holdSeq: 3 },
    { ...tp({ job_id: L1, lot_seq: 1, label: "JB-0020 · ส่วนที่ 1", qty_planned: 10, qty_live: 10 }), holdSeq: 3 },
    tp({ job_id: L2, lot_seq: 2, label: "JB-0020 · ส่วนที่ 2", qty_planned: 5, qty_live: 5, stage_code: "qc", stage_name: "ตรวจ QC", holder_name: "ช่าง ง" }),
    tp({ job_id: L3, lot_seq: 3, label: "JB-0020 · ส่วนที่ 3", qty_planned: 34, qty_live: 34, stage_code: "pack", stage_name: "แพ็ก", qty_qc_passed: 34 }),
  ];
  return { parts, summary: mapLotsSummary({ root_job_id: JOB, qty_planned: 100, qty_order: 100, parts_count: 4, parts_open: 4, lots_open: 3, qty_scrap_total: 1, qty_qc_passed_total: 34, sum_check: sumCheck }), discrepancies: [] };
}

function detail(lotsData: JobLotsData | null | undefined, o: { stagesAllSent?: boolean; status?: string; metal?: string } = {}): JobDetailData {
  const base = { id: JOB, job_no: "JB-0020", source_kind: "production", design_label: "แหวนโกเมนไข่", sku_snapshot: null, metal: o.metal ?? "silver", qty_planned: 100, qty_order: 100, status: o.status ?? "in_progress", production_order_item_id: "33333333-3333-4333-8333-333333333333" };
  const stages = o.stagesAllSent ? [stage("cast", 1, "sent"), stage("qc", 2, "sent"), stage("pack", 3, "sent")] : [stage("cast", 1, "sent"), stage("qc", 2, "received"), stage("pack", 3, "pending")];
  return {
    job: mapJobDetail(base)!, board: mapBoardRow({ id: JOB, job_no: "JB-0020", seq: 20, source_kind: "production", metal: "silver", qty_planned: 100, qty_order: 100, status: base.status }), stages, loss: {}, events: [], eventsTruncated: false, activeTokens: 0, workers: [], source: null, todayTh: "2026-10-19",
    ...(lotsData !== undefined ? { lots: lotsData } : {}),
  };
}

const qrRow = (n: number, o: Record<string, unknown> = {}) => ({ printNo: n, purpose: "traveler", lotJobId: null, label: null, issuedAt: "2026-10-19T03:00:00Z", active: true, revokedAt: null, revokeReason: null, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  lots.listJobQr.mockResolvedValue({ ok: true, data: [qrRow(1)] });
  for (const f of [lots.splitJobLot, lots.cancelJobLot, lots.resolveDiscrepancyOffice, lots.voidDiscrepancy, w.revokeJobQr, w.officeReceiveStage]) f.mockResolvedValue({ ok: true, data: { lotJobId: L2, lotSeq: 4, label: "x", qty: 1, parentRemaining: 1, qtyHold: 0, disposition: "return_to_parent", liveQty: 0, qty2: 0, revoked: 1 } });
});

// lazy chunk ของแผงส่วนย่อยโหลดครั้งแรกช้าตอนรัน suite เต็ม (transform ใต้โหลดหลาย worker) — เผื่อเวลารอ ไม่ลดความเข้มของ assertion
const panel = async () => screen.findByRole("region", { name: /ส่วนของใบนี้/ }, { timeout: 10_000 });

describe("ใบแม่ + ส่วน + แถบสะสม", () => {
  it("JB-0020: 4 ส่วน · การ์ดส่วน (ส่วนหลัก/ส่วนที่ k · ขั้น · อยู่กับใคร · กี่วัน · จำนวน) · แถบ เสร็จ 34 + ฝังพลอย 60 + QC 5 + เสีย 1 = 100 ครบ", async () => {
    wrap(<JobDetailClient data={detail(jb0020())} />);
    const p = within(await panel());
    expect(p.getByRole("heading", { name: "ส่วนของใบนี้ (4 ส่วน)" })).toBeInTheDocument();
    const parts = within(p.getByRole("list", { name: "รายการส่วน" }));
    expect(parts.getByText("ส่วนหลัก")).toBeInTheDocument();
    expect(parts.getByText("ส่วนที่ 2")).toBeInTheDocument();
    expect(parts.getAllByText(/ถืออยู่ที่ ฝังพลอย · ช่าง ค · 2 วัน/)).toHaveLength(2);
    expect(parts.getByText(/ถืออยู่ที่ ตรวจ QC · ช่าง ง/)).toBeInTheDocument();
    expect(p.getByRole("img", { name: "รวม 100 ชิ้น: เสร็จ 34 · ฝังพลอย 60 · ตรวจ QC 5 · เสีย 1" })).toBeInTheDocument();
    expect(p.getByText("รวม 100 ครบ")).toBeInTheDocument();
  });

  it("sum_check ของ DB เป็นเท็จ → ไม่ขึ้น 'ครบ' แต่เตือนให้ตรวจ", async () => {
    wrap(<JobDetailClient data={detail(jb0020(false))} />);
    const p = within(await panel());
    expect(p.queryByText("รวม 100 ครบ")).not.toBeInTheDocument();
    expect(p.getByRole("alert")).toHaveTextContent("ตัวเลขรวมไม่ครบ 100 ชิ้น");
  });

  it("ส่วนที่ยกเลิกขีดฆ่าและไม่มีปุ่ม · ส่วนที่ปิดแล้วไม่มีปุ่มยกเลิก", async () => {
    const l = jb0020();
    l.parts[1] = tp({ job_id: L1, lot_seq: 1, label: "x", status: "cancelled" });
    l.parts[2] = tp({ job_id: L2, lot_seq: 2, label: "y", status: "done", qty_good: 5, qty_live: null });
    wrap(<JobDetailClient data={detail(l)} />);
    await panel();
    expect(screen.getByText("ยกเลิกแล้ว")).toBeInTheDocument();
    expect(screen.getByText("ปิดแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิก ส่วนที่ 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิก ส่วนที่ 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยกเลิก ส่วนที่ 3" })).toBeInTheDocument();
  });

  it("ใบปิดแล้ว: ไม่มีปุ่มแยก/ยกเลิก/พิมพ์/เพิกถอน (อ่านอย่างเดียว)", async () => {
    wrap(<JobDetailClient data={detail(jb0020(), { status: "done" })} />);
    await panel();
    expect(screen.queryByRole("button", { name: "แยกส่วน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ยกเลิก ส่วน/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/พิมพ์ใบย่อย/)).not.toBeInTheDocument();
    await screen.findByText(/ใบที่ 1/);
    expect(screen.queryByRole("button", { name: /เพิกถอน QR/ })).not.toBeInTheDocument();
  });
});

describe("ปิด full — disabled + เหตุผลบนปุ่ม", () => {
  it("มีส่วนย่อยค้าง → ปุ่มปิดงาน disabled บอก 'ยังมีส่วนย่อยค้าง 3 ส่วน' (ทั้งที่ทุกขั้นของใบแม่ส่งแล้ว)", async () => {
    wrap(<JobDetailClient data={detail(jb0020(), { stagesAllSent: true })} />);
    const b = await screen.findByRole("button", { name: /ปิดงานไม่ได้ — ยังมีส่วนย่อยค้าง 3 ส่วน/ });
    expect(b).toBeDisabled();
  });

  it("มีส่วนต่างรอชี้แจง (ไม่มีส่วนย่อยค้าง) → disabled บอกจำนวนชิ้น", async () => {
    const l = jb0020();
    l.summary = mapLotsSummary({ root_job_id: JOB, qty_planned: 100, lots_open: 0, qty_pending_explanation: 5, sum_check: true });
    wrap(<JobDetailClient data={detail(l, { stagesAllSent: true })} />);
    expect(await screen.findByRole("button", { name: "ปิดงานไม่ได้ — มีส่วนต่างรอชี้แจง 5 ชิ้น" })).toBeDisabled();
  });

  it("ไม่มีส่วนค้าง/ส่วนต่าง + ทุกขั้นส่งแล้ว → ปุ่ม 'ปิดงาน' ใช้ได้ (ใบเดี่ยวเหมือนเดิม)", () => {
    wrap(<JobDetailClient data={detail(undefined, { stagesAllSent: true })} />);
    expect(screen.getByRole("button", { name: "ปิดงาน" })).toBeEnabled();
  });
});

describe("ใบเดี่ยวไม่เปลี่ยน", () => {
  it("ไม่มี lots (หรือ loader อ่านไม่ได้ = null): ไม่มีแผงส่วน ไม่มีปุ่มแยก · หน้าเดิม", () => {
    for (const l of [undefined, null]) {
      const { unmount } = wrap(<JobDetailClient data={detail(l)} />);
      expect(screen.queryByRole("region", { name: /ส่วนของใบนี้/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "แยกส่วน" })).not.toBeInTheDocument();
      expect(lots.listJobQr).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("ใบเดี่ยวที่ผู้ถือถือ ≥ 2 ชิ้น: มีปุ่ม 'แยกส่วน' ที่แถวปุ่ม (ยังไม่มีแผงส่วน) · ถือ 1 ชิ้น/ไม่มีผู้ถือ = ไม่มีปุ่ม", async () => {
    const solo = (o: Record<string, unknown>): JobLotsData => ({ parts: [{ ...tp({ qty_planned: 100, qty_live: 100, ...o }), holdSeq: 2 }], summary: null, discrepancies: [] });
    const a = wrap(<JobDetailClient data={detail(solo({}))} />);
    expect(screen.queryByRole("region", { name: /ส่วนของใบนี้/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "แยกส่วน" }));
    expect(await screen.findByRole("dialog", { name: /แยกส่วน/ })).toBeInTheDocument();
    a.unmount();
    const b = wrap(<JobDetailClient data={detail(solo({ qty_live: 1, qty_planned: 1 }))} />);
    expect(screen.queryByRole("button", { name: "แยกส่วน" })).not.toBeInTheDocument();
    b.unmount();
  });
});

describe("แยกส่วน (ออฟฟิศ)", () => {
  const open = async () => {
    wrap(<JobDetailClient data={detail(jb0020())} />);
    await userEvent.click(await screen.findByRole("button", { name: "แยกส่วน" }));
    return within(await screen.findByRole("dialog", { name: /แยกส่วน/ }));
  };

  it("เลือกส่วนที่แยกได้ (ส่วนหลัก 50 / ส่วนที่ 1 = 10) · แยก 20 จาก 50 → splitJobLot({jobId, expectedSeq, qty, qtyHold}) + สรุป 20 / 30 / รวม 50 ครบ", async () => {
    const d = await open();
    expect(d.getByRole("radio", { name: "ส่วนหลัก · 50 ชิ้น" })).toBeInTheDocument();
    expect(d.getByRole("radio", { name: "ส่วนที่ 1 · 10 ชิ้น" })).toBeInTheDocument();
    expect(d.queryByRole("radio", { name: /ส่วนที่ 2/ })).not.toBeInTheDocument(); // ส่วนที่ 2 ไม่มีผู้ถือ (holdSeq null)
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "20");
    expect(d.getByRole("status")).toHaveTextContent("ส่วนใหม่ 20 · ค้างกับผู้ถือเดิม 30 · รวม 50 ครบ");
    await userEvent.click(d.getByRole("button", { name: "แยกส่วน" }));
    await waitFor(() => expect(lots.splitJobLot).toHaveBeenCalledTimes(1));
    expect(lots.splitJobLot).toHaveBeenCalledWith({ jobId: JOB, expectedSeq: 3, qty: 20, qtyHold: 50 });
  });

  it("แยกจากส่วนที่ 1 ได้ jobId ของส่วนนั้น", async () => {
    const d = await open();
    await userEvent.click(d.getByRole("radio", { name: "ส่วนที่ 1 · 10 ชิ้น" }));
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "4");
    await userEvent.click(d.getByRole("button", { name: "แยกส่วน" }));
    await waitFor(() => expect(lots.splitJobLot).toHaveBeenCalledWith({ jobId: L1, expectedSeq: 3, qty: 4, qtyHold: 10 }));
  });

  it("ต้องปฏิเสธ: ว่าง · 0 · '1,5' · '3.5' · เท่ากับที่ถือ (ผู้ถือต้องเหลือ ≥ 1) · เกินที่ถือ — ปุ่มปิด ไม่เรียก action", async () => {
    const d = await open();
    const btn = d.getByRole("button", { name: "แยกส่วน" });
    expect(btn).toBeDisabled();
    for (const v of ["0", "1,5", "3.5", "-2", "abc", "50", "51"]) {
      const f = d.getByLabelText("แยกออกกี่ชิ้น");
      await userEvent.clear(f);
      await userEvent.type(f, v);
      expect(btn, v).toBeDisabled();
    }
    expect(lots.splitJobLot).not.toHaveBeenCalled();
  });

  it("DB ปฏิเสธ (stage_changed) → ข้อความไทยค้างในกล่อง · ค่าที่กรอกไม่หาย", async () => {
    lots.splitJobLot.mockResolvedValue({ ok: false, error: "ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่" });
    const d = await open();
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "20");
    await userEvent.click(d.getByRole("button", { name: "แยกส่วน" }));
    expect(await d.findByRole("alert")).toHaveTextContent("ข้อมูลงานเปลี่ยนไป");
    expect(d.getByLabelText("แยกออกกี่ชิ้น")).toHaveValue("20");
  });

  it("กดซ้ำรัวๆ เรียกครั้งเดียว", async () => {
    let release: (v: unknown) => void = () => {};
    lots.splitJobLot.mockImplementation(() => new Promise((r) => (release = r)));
    const d = await open();
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "20");
    const b = d.getByRole("button", { name: "แยกส่วน" });
    await userEvent.click(b);
    await userEvent.click(b);
    release({ ok: true, data: { lotJobId: L2, lotSeq: 4, label: "x", qty: 20, parentRemaining: 30 } });
    await waitFor(() => expect(lots.splitJobLot).toHaveBeenCalledTimes(1));
  });
});

describe("ยกเลิกส่วน", () => {
  const open = async (name: string) => {
    wrap(<JobDetailClient data={detail(jb0020())} />);
    await userEvent.click(await screen.findByRole("button", { name }));
    return within(await screen.findByRole("dialog", { name: /ยกเลิก ส่วนที่/ }));
  };
  it("ต้องมีเหตุผล · ค่าเริ่ม 'คืนให้ผู้ถือเดิม' → cancelJobLot({lotJobId, reason, disposition:'return_to_parent'})", async () => {
    const d = await open("ยกเลิก ส่วนที่ 1");
    const b = d.getByRole("button", { name: "ยกเลิกส่วน" });
    expect(b).toBeDisabled();
    await userEvent.type(d.getByLabelText("เหตุผลที่ยกเลิกส่วน"), "แยกผิด");
    await userEvent.click(b);
    await waitFor(() => expect(lots.cancelJobLot).toHaveBeenCalledWith({ lotJobId: L1, reason: "แยกผิด", disposition: "return_to_parent", scrapReason: null }));
  });
  it("เลือก 'นับเป็นของเสีย' ต้องเลือกเหตุผลของเสียด้วย (ไม่มี 'หายเฉยๆ')", async () => {
    const d = await open("ยกเลิก ส่วนที่ 3");
    await userEvent.type(d.getByLabelText("เหตุผลที่ยกเลิกส่วน"), "ของแตก");
    await userEvent.click(d.getByRole("radio", { name: "นับเป็นของเสีย" }));
    expect(d.getByRole("button", { name: "ยกเลิกส่วน" })).toBeDisabled();
    await userEvent.click(d.getByRole("radio", { name: "หัก" }));
    await userEvent.click(d.getByRole("button", { name: "ยกเลิกส่วน" }));
    await waitFor(() => expect(lots.cancelJobLot).toHaveBeenCalledWith({ lotJobId: L3, reason: "ของแตก", disposition: "scrap", scrapReason: "broken" }));
  });
});

describe("ส่วนต่างรอชี้แจง", () => {
  const withDisc = (): JobLotsData => {
    const l = jb0020();
    const ctx = { stageById: { a: { name: "ขัด" }, b: { name: "ฝังพลอย" } }, labelByJob: { [L1]: "JB-0020 · ส่วนที่ 1" } };
    l.discrepancies = [mapDiscrepancy({ id: DISC, job_id: L1, from_stage_id: "a", to_stage_id: "b", qty: 5, status: "open" }, ctx)!];
    l.summary = mapLotsSummary({ root_job_id: JOB, qty_planned: 100, lots_open: 3, qty_pending_explanation: 5, qty_qc_passed_total: 34, sum_check: true });
    return l;
  };

  it("การ์ดชี้แจง: 5 ชิ้น · ส่วนที่ 1 · ขัด → ฝังพลอย · รอผู้ส่งชี้แจง · แถบมี 'รอชี้แจง 5'", async () => {
    wrap(<JobDetailClient data={detail(withDisc())} />);
    const p = within(await panel());
    expect(p.getByRole("heading", { name: "ส่วนต่างรอชี้แจง (5 ชิ้น)" })).toBeInTheDocument();
    expect(p.getByText("5 ชิ้น · JB-0020 · ส่วนที่ 1")).toBeInTheDocument();
    expect(p.getByText(/ขัด ส่งไป ฝังพลอย/)).toBeInTheDocument();
    expect(p.getByRole("img", { name: /รอชี้แจง 5/ })).toBeInTheDocument();
  });

  it("ชี้แจงแทน: หาย → resolveDiscrepancyOffice({discrepancyId, kind:'lost', reason:'missing'}) · ต้องเลือก kind ก่อน", async () => {
    wrap(<JobDetailClient data={detail(withDisc())} />);
    await userEvent.click(await screen.findByRole("button", { name: "ชี้แจงแทน" }));
    const d = within(await screen.findByRole("dialog", { name: "ชี้แจงส่วนต่าง" }));
    expect(d.getByRole("button", { name: "ยืนยันชี้แจง" })).toBeDisabled();
    await userEvent.click(d.getByRole("radio", { name: "หาย" }));
    await userEvent.click(d.getByRole("button", { name: "ยืนยันชี้แจง" }));
    await waitFor(() => expect(lots.resolveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, kind: "lost", reason: "missing" }));
  });

  it("เสียหาย + เหตุผล 'รูพรุน' → kind 'scrap'", async () => {
    wrap(<JobDetailClient data={detail(withDisc())} />);
    await userEvent.click(await screen.findByRole("button", { name: "ชี้แจงแทน" }));
    const d = within(await screen.findByRole("dialog", { name: "ชี้แจงส่วนต่าง" }));
    await userEvent.click(d.getByRole("radio", { name: "เสียหาย" }));
    await userEvent.click(d.getByRole("radio", { name: "รูพรุน" }));
    await userEvent.click(d.getByRole("button", { name: "ยืนยันชี้แจง" }));
    await waitFor(() => expect(lots.resolveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, kind: "scrap", reason: "porosity" }));
  });

  it("ยกเลิกส่วนต่าง (void): ต้องมีเหตุผล · DB ตอบ stage_not_pending → ข้อความค้างในกล่อง", async () => {
    lots.voidDiscrepancy.mockResolvedValue({ ok: false, error: "ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน" });
    wrap(<JobDetailClient data={detail(withDisc())} />);
    await userEvent.click(await screen.findByRole("button", { name: "ยกเลิกส่วนต่าง" }));
    const d = within(await screen.findByRole("dialog", { name: "ยกเลิกส่วนต่าง" }));
    expect(d.getByRole("button", { name: "ยกเลิกส่วนต่าง" })).toBeDisabled();
    await userEvent.type(d.getByLabelText("เหตุผลที่ยกเลิกส่วนต่าง"), "ของเจอแล้ว");
    await userEvent.click(d.getByRole("button", { name: "ยกเลิกส่วนต่าง" }));
    await waitFor(() => expect(lots.voidDiscrepancy).toHaveBeenCalledWith(DISC, "ของเจอแล้ว"));
    expect(await d.findByRole("alert")).toHaveTextContent("ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน");
  });

  it("ส่วนต่างที่ void แล้ว (มีแถว void ชี้มา) ไม่ขึ้นการ์ดรอชี้แจง · ที่ชี้แจงแล้วขึ้นเป็นบรรทัดสรุป", async () => {
    const l = withDisc();
    const ctx = { stageById: { a: { name: "ขัด" }, b: { name: "ฝังพลอย" } }, labelByJob: { [L1]: "JB-0020 · ส่วนที่ 1" } };
    l.discrepancies.push(mapDiscrepancy({ id: "d2", job_id: L1, from_stage_id: "a", to_stage_id: "b", qty: 5, status: "void", void_of_id: DISC }, ctx)!);
    l.discrepancies.push(mapDiscrepancy({ id: "d3", job_id: L1, from_stage_id: "a", to_stage_id: "b", qty: 2, status: "resolved", resolved_kind: "lost", resolved_reason: "missing" }, ctx)!);
    l.summary = mapLotsSummary({ root_job_id: JOB, qty_planned: 100, lots_open: 0, qty_pending_explanation: 0, sum_check: true });
    wrap(<JobDetailClient data={detail(l)} />);
    await panel();
    expect(screen.queryByRole("heading", { name: /ส่วนต่างรอชี้แจง/ })).not.toBeInTheDocument();
    expect(screen.getByText(/ชี้แจงแล้ว: 2 ชิ้น หาย \(หาย\)/)).toBeInTheDocument();
  });
});

describe("QR ที่ใช้งานอยู่ + พิมพ์ใบย่อย", () => {
  it("กำลังโหลด → รายการ (ใบที่ · ชนิด · ส่วน · วันที่) · ไม่มี token/hash", async () => {
    lots.listJobQr.mockResolvedValue({ ok: true, data: [qrRow(1), qrRow(2, { purpose: "sublot", lotJobId: L1, label: "JB-0020 · ส่วนที่ 1" }), qrRow(3, { active: false })] });
    wrap(<JobDetailClient data={detail(jb0020())} />);
    expect(screen.getByText("กำลังโหลดรายการ QR…")).toBeInTheDocument();
    expect(await screen.findByText(/QR ที่ใช้งานอยู่ \(2\/5 ใบ\)/)).toBeInTheDocument();
    expect(screen.getByText(/ใบที่ 2/).closest("li")).toHaveTextContent("ใบย่อย · JB-0020 · ส่วนที่ 1");
    expect(screen.queryByText(/ใบที่ 3/)).not.toBeInTheDocument(); // เพิกถอนแล้วไม่แสดงในรายการที่ใช้งานอยู่
    expect(document.body.textContent ?? "").not.toMatch(/token|hash|sha256/i);
  });

  it("ผิดพลาด → ข้อความ + ปุ่มโหลดใหม่ · ว่าง → 'ยังไม่มี QR ที่ใช้งาน'", async () => {
    lots.listJobQr.mockResolvedValueOnce({ ok: false, error: "โหลดไม่สำเร็จ" });
    wrap(<JobDetailClient data={detail(jb0020())} />);
    expect(await screen.findByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    lots.listJobQr.mockResolvedValue({ ok: true, data: [] });
    await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    expect(await screen.findByText(/ยังไม่มี QR ที่ใช้งาน/)).toBeInTheDocument();
  });

  it("ปุ่มพิมพ์ใบย่อยเป็นลิงก์ไปหน้าพิมพ์ของส่วนนั้น (เฉพาะส่วนย่อยที่ยังเปิด)", async () => {
    wrap(<JobDetailClient data={detail(jb0020())} />);
    await panel();
    await screen.findByText(/QR ที่ใช้งานอยู่ \(1\/5 ใบ\)/);
    expect(screen.getByRole("link", { name: "พิมพ์ใบย่อย ส่วนที่ 1" })).toHaveAttribute("href", `/jobs/${JOB}/print?lot=${L1}`);
    expect(screen.queryByRole("link", { name: /พิมพ์ใบย่อย ส่วนหลัก/ })).not.toBeInTheDocument();
  });

  it("ครบ 5 ใบ: เตือน + พิมพ์ใบย่อยไม่ได้ (ไม่มีลิงก์) + บอกให้เพิกถอนก่อน · ไม่เพิกถอนเงียบ", async () => {
    lots.listJobQr.mockResolvedValue({ ok: true, data: [1, 2, 3, 4, 5].map((n) => qrRow(n)) });
    wrap(<JobDetailClient data={detail(jb0020())} />);
    expect(await screen.findByText(/QR ใช้งานครบ 5 ใบแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /พิมพ์ใบย่อย/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/พิมพ์ใบย่อยไม่ได้ — QR ครบ 5 ใบ/).length).toBeGreaterThan(0);
    expect(w.revokeJobQr).not.toHaveBeenCalled();
  });

  it("เพิกถอนรายใบ: ต้องมีเหตุผล → revokeJobQr(jobId, เหตุผล, printNo) · เฉพาะใบนั้น", async () => {
    lots.listJobQr.mockResolvedValue({ ok: true, data: [qrRow(1), qrRow(2, { purpose: "sublot", lotJobId: L1, label: "JB-0020 · ส่วนที่ 1" })] });
    wrap(<JobDetailClient data={detail(jb0020())} />);
    await userEvent.click(await screen.findByRole("button", { name: "เพิกถอน QR ใบที่ 2" }));
    const d = within(await screen.findByRole("dialog", { name: /เพิกถอน QR/ }));
    expect(d.getByRole("button", { name: "เพิกถอน QR" })).toBeDisabled();
    await userEvent.type(d.getByLabelText(/เหตุผล/), "กระดาษหาย");
    await userEvent.click(d.getByRole("button", { name: "เพิกถอน QR" }));
    await waitFor(() => expect(w.revokeJobQr).toHaveBeenCalledWith(JOB, "กระดาษหาย", 2));
  });
});

describe("ทอง: แยกส่วนต้องชั่งส่วนที่แยกออก (H2) + ส่วนต่างน้ำหนักเทียบ (ออฟฟิศเท่านั้น)", () => {
  const goldLots = (weigh: boolean): JobLotsData => {
    const l = jb0020();
    l.parts[0] = { ...l.parts[0], holdWeighRequired: weigh };
    l.parts[1] = { ...l.parts[1], holdWeighRequired: weigh };
    return l;
  };
  const open = async (l: JobLotsData, metal: string) => {
    wrap(<JobDetailClient data={detail(l, { metal })} />);
    await userEvent.click(await screen.findByRole("button", { name: "แยกส่วน" }));
    return within(await screen.findByRole("dialog", { name: /แยกส่วน/ }));
  };

  it("ทอง + ขั้นชั่ง: มีช่องน้ำหนักบังคับ · ว่าง/0/ทศนิยมเกิน 3 = ปุ่มปิด · ชั่งแล้ว splitJobLot ส่ง weightMoveG + qtyHold", async () => {
    const d = await open(goldLots(true), "gold");
    const btn = d.getByRole("button", { name: "แยกส่วน" });
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "20");
    expect(btn).toBeDisabled(); // ยังไม่ชั่ง
    for (const v of ["0", "1.2345", "abc"]) {
      const f = d.getByLabelText(/น้ำหนักส่วนที่แยกออก/);
      await userEvent.clear(f);
      await userEvent.type(f, v);
      expect(btn, v).toBeDisabled();
    }
    const f = d.getByLabelText(/น้ำหนักส่วนที่แยกออก/);
    await userEvent.clear(f);
    await userEvent.type(f, "12,5");
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(lots.splitJobLot).toHaveBeenCalledWith({ jobId: JOB, expectedSeq: 3, qty: 20, qtyHold: 50, weightMoveG: "12,5" }));
  });

  it("เงิน (แม้ขั้นชั่ง) และทองที่ขั้นไม่ชั่ง: ไม่มีช่องน้ำหนัก ไม่ส่ง weightMoveG แต่ส่ง qtyHold เสมอ", async () => {
    const a = await open(goldLots(true), "silver");
    expect(a.queryByLabelText(/น้ำหนักส่วนที่แยกออก/)).not.toBeInTheDocument();
    await userEvent.type(a.getByLabelText("แยกออกกี่ชิ้น"), "20");
    await userEvent.click(a.getByRole("button", { name: "แยกส่วน" }));
    await waitFor(() => expect(lots.splitJobLot).toHaveBeenCalledWith({ jobId: JOB, expectedSeq: 3, qty: 20, qtyHold: 50 }));
    cleanup();
    const b = await open(goldLots(false), "gold");
    expect(b.queryByLabelText(/น้ำหนักส่วนที่แยกออก/)).not.toBeInTheDocument();
  });

  it("DB ตอบ weight_over → ข้อความค้างในกล่อง ค่าที่กรอกไม่หาย", async () => {
    lots.splitJobLot.mockResolvedValue({ ok: false, error: "น้ำหนักส่วนที่แยกมากเกินน้ำหนักที่ถืออยู่ — ต้องเหลือให้ผู้ถือ ชั่งใหม่" });
    const d = await open(goldLots(true), "gold");
    await userEvent.type(d.getByLabelText("แยกออกกี่ชิ้น"), "20");
    await userEvent.type(d.getByLabelText(/น้ำหนักส่วนที่แยกออก/), "99");
    await userEvent.click(d.getByRole("button", { name: "แยกส่วน" }));
    expect(await d.findByRole("alert")).toHaveTextContent("มากเกินน้ำหนักที่ถืออยู่");
    expect(d.getByLabelText(/น้ำหนักส่วนที่แยกออก/)).toHaveValue("99");
  });

  it("ส่วนต่างทอง: ออฟฟิศเห็นส่วนต่างน้ำหนักเทียบ + ยังกด ชี้แจงแทน ได้ · งานเงินไม่แสดงน้ำหนัก", async () => {
    const mk = (): JobLotsData => {
      const l = jb0020();
      l.discrepancies = [mapDiscrepancy({ id: DISC, job_id: L1, from_stage_id: "a", to_stage_id: "b", qty: 5, status: "open", weight_gap_g: -2.25 }, { stageById: { a: { name: "ขัด" }, b: { name: "ฝังพลอย" } }, labelByJob: { [L1]: "JB-0020 · ส่วนที่ 1" } })!];
      l.summary = mapLotsSummary({ root_job_id: JOB, qty_planned: 100, lots_open: 3, qty_pending_explanation: 5, sum_check: true });
      return l;
    };
    const a = wrap(<JobDetailClient data={detail(mk(), { metal: "gold" })} />);
    const p = within(await panel());
    expect(p.getByText(/ส่วนต่างน้ำหนักเทียบ/)).toHaveTextContent("−2.25 g");
    expect(p.getByRole("button", { name: "ชี้แจงแทน" })).toBeEnabled();
    a.unmount();
    wrap(<JobDetailClient data={detail(mk(), { metal: "silver" })} />);
    await panel();
    expect(screen.queryByText(/ส่วนต่างน้ำหนักเทียบ/)).not.toBeInTheDocument();
  });

  it("ส่วนต่างน้ำหนักระดับขั้นของใบแม่ (handoff_gap_partial_g) แสดงในตารางขั้น — เฉพาะเมื่อมีค่า", async () => {
    const d = detail(jb0020(), { metal: "gold" });
    d.stages[0] = { ...d.stages[0], status: "sent" };
    d.loss = { [d.stages[0].id]: { handoffGapG: null, lossG: null, lossPct: null, warn: false, notWeighed: true, handoffGapPartialG: 1.5 } };
    wrap(<JobDetailClient data={d} />);
    expect(await screen.findByText("ส่วนต่างน้ำหนัก (รับไม่ครบ)")).toBeInTheDocument();
    expect(screen.getByText("+1.5 g")).toBeInTheDocument();
  });
});

describe("ส่วนย่อย: เลื่อนมาที่ส่วนนั้นในใบแม่ (anchor)", () => {
  it("การ์ดส่วนมี id part-<jobId> ให้ redirect #part-... เลื่อนมาหา", async () => {
    wrap(<JobDetailClient data={detail(jb0020())} />);
    await panel();
    expect(document.getElementById(`part-${L2}`)).not.toBeNull();
  });
});

describe("0181 re-review: ส่วนต่างทอง (M-B) · ยกเลิกส่วน (M-C) · รับแทน/ล็อก (L-2) · loss ทั้งต้นไม้ (M-A)", () => {
  const ctx = { stageById: { a: { name: "ขัด" }, b: { name: "ฝังพลอย" } }, labelByJob: { [L1]: "JB-0020 · ส่วนที่ 1" } };
  const withGap = (o: Record<string, unknown>): JobLotsData => {
    const l = jb0020();
    l.discrepancies = [mapDiscrepancy({ id: DISC, job_id: L1, from_stage_id: "a", to_stage_id: "b", qty: 5, status: "open", weight_gap_g: -2.25, weight_sent_g: 20, qty_sent: 10, weight_gap_excess_g: -0.25, ...o }, ctx)!];
    l.summary = mapLotsSummary({ root_job_id: JOB, qty_planned: 100, lots_open: 3, qty_pending_explanation: 5, sum_check: true });
    return l;
  };
  const openResolve = async (l: JobLotsData, metal: string) => {
    wrap(<JobDetailClient data={detail(l, { metal })} />);
    await userEvent.click(await screen.findByRole("button", { name: "ชี้แจงแทน" }));
    return within(await screen.findByRole("dialog", { name: "ชี้แจงส่วนต่าง" }));
  };

  it("การ์ดส่วนต่างทอง: ขั้นก่อนส่ง n ชิ้น หนัก g · น้ำหนักหายเกินสัดส่วน (ลบเกิน 0.05 = แจ้งต้องเขียนคำอธิบาย) · งานเงินไม่แสดง", async () => {
    const a = wrap(<JobDetailClient data={detail(withGap({}), { metal: "gold" })} />);
    const p = within(await panel());
    expect(p.getByText(/ขั้นก่อนส่ง/)).toHaveTextContent("ขั้นก่อนส่ง 10 ชิ้น หนัก 20 g");
    expect(p.getByText(/น้ำหนักหายเกินสัดส่วนชิ้นที่ขาด/)).toHaveTextContent("−0.25 g · ต้องเขียนคำอธิบายตอนชี้แจง");
    a.unmount();
    wrap(<JobDetailClient data={detail(withGap({}), { metal: "silver" })} />);
    await panel();
    expect(screen.queryByText(/ขั้นก่อนส่ง/)).not.toBeInTheDocument();
    expect(screen.queryByText(/หายเกินสัดส่วน/)).not.toBeInTheDocument();
  });

  it("excess < −0.05 (ทอง): ช่องคำอธิบายบังคับ — ไม่กรอก = ปุ่มปิด · กรอกแล้ว resolveDiscrepancyOffice ส่ง note", async () => {
    const d = await openResolve(withGap({}), "gold");
    await userEvent.click(d.getByRole("radio", { name: "เสียหาย" }));
    await userEvent.click(d.getByRole("radio", { name: "รูพรุน" }));
    const btn = d.getByRole("button", { name: "ยืนยันชี้แจง" });
    expect(d.getByLabelText(/คำอธิบาย \(บังคับ/)).toBeInTheDocument();
    expect(btn).toBeDisabled();
    await userEvent.type(d.getByLabelText(/คำอธิบาย \(บังคับ/), "   ");
    expect(btn).toBeDisabled(); // ช่องว่างล้วนไม่ผ่าน
    await userEvent.type(d.getByLabelText(/คำอธิบาย \(บังคับ/), "เศษผงขัดเก็บไม่ได้");
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(lots.resolveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, kind: "scrap", reason: "porosity", note: "   เศษผงขัดเก็บไม่ได้" }));
  });

  it("ไม่ต้องมี note: excess = −0.05 พอดี / บวก / ไม่มีค่า / งานเงินที่ excess ลบมาก → ไม่มีช่อง ไม่ส่ง note", async () => {
    for (const [excess, metal] of [[-0.05, "gold"], [0.3, "gold"], [null, "gold"], [-9, "silver"]] as const) {
      const d = await openResolve(withGap({ weight_gap_excess_g: excess }), metal);
      expect(d.queryByLabelText(/คำอธิบาย/), String(excess) + metal).not.toBeInTheDocument();
      await userEvent.click(d.getByRole("radio", { name: "หาย" }));
      await userEvent.click(d.getByRole("button", { name: "ยืนยันชี้แจง" }));
      await waitFor(() => expect(lots.resolveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, kind: "lost", reason: "missing" }));
      lots.resolveDiscrepancyOffice.mockClear();
      cleanup();
    }
  });

  it("DB ตอบ note_required → ข้อความไทยค้างในกล่อง · คำอธิบายที่กรอกไม่หาย", async () => {
    lots.resolveDiscrepancyOffice.mockResolvedValue({ ok: false, error: "ทอง: น้ำหนักหายมากกว่าสัดส่วนชิ้นที่ขาด — ต้องเขียนคำอธิบายเป็นข้อความ (ไม่ใช่แค่เลือกรหัสเหตุผล)" });
    const d = await openResolve(withGap({}), "gold");
    await userEvent.click(d.getByRole("radio", { name: "หาย" }));
    await userEvent.type(d.getByLabelText(/คำอธิบาย \(บังคับ/), "ตกท่อ");
    await userEvent.click(d.getByRole("button", { name: "ยืนยันชี้แจง" }));
    expect(await d.findByRole("alert")).toHaveTextContent("ต้องเขียนคำอธิบายเป็นข้อความ");
    expect(d.getByLabelText(/คำอธิบาย \(บังคับ/)).toHaveValue("ตกท่อ");
  });

  describe("ยกเลิกส่วนเป็นของเสีย: ทอง + ส่วนมีขั้นชั่ง = ต้องชั่งเศษที่คืน", () => {
    const lotsWithWeigh = (has: boolean): JobLotsData => {
      const l = jb0020();
      l.parts[1] = { ...l.parts[1], hasWeighStage: has };
      return l;
    };
    const open = async (l: JobLotsData, metal: string) => {
      wrap(<JobDetailClient data={detail(l, { metal })} />);
      await userEvent.click(await screen.findByRole("button", { name: "ยกเลิก ส่วนที่ 1" }));
      const d = within(await screen.findByRole("dialog", { name: /ยกเลิก ส่วนที่/ }));
      await userEvent.type(d.getByLabelText("เหตุผลที่ยกเลิกส่วน"), "ของแตก");
      return d;
    };

    it("เลือก 'นับเป็นของเสีย' → ช่องน้ำหนักบังคับ (ว่าง/0/ทศนิยมเกิน 3 = ปุ่มปิด) → cancelJobLot ส่ง scrapWeightG", async () => {
      const d = await open(lotsWithWeigh(true), "gold");
      expect(d.queryByLabelText(/น้ำหนักเศษที่คืน/)).not.toBeInTheDocument(); // ยังเป็นแบบคืนผู้ถือเดิม
      await userEvent.click(d.getByRole("radio", { name: "นับเป็นของเสีย" }));
      await userEvent.click(d.getByRole("radio", { name: "หัก" }));
      const btn = d.getByRole("button", { name: "ยกเลิกส่วน" });
      expect(btn).toBeDisabled();
      for (const v of ["0", "1.2345", "abc"]) {
        const f = d.getByLabelText(/น้ำหนักเศษที่คืน/);
        await userEvent.clear(f);
        await userEvent.type(f, v);
        expect(btn, v).toBeDisabled();
      }
      const f = d.getByLabelText(/น้ำหนักเศษที่คืน/);
      await userEvent.clear(f);
      await userEvent.type(f, "2,5");
      await userEvent.click(btn);
      await waitFor(() => expect(lots.cancelJobLot).toHaveBeenCalledWith({ lotJobId: L1, reason: "ของแตก", disposition: "scrap", scrapReason: "broken", scrapWeightG: "2,5" }));
    });

    it("คืนผู้ถือเดิม / เงิน / ส่วนไม่มีขั้นชั่ง: ไม่มีช่องน้ำหนัก ไม่ส่ง scrapWeightG", async () => {
      const a = await open(lotsWithWeigh(true), "silver");
      await userEvent.click(a.getByRole("radio", { name: "นับเป็นของเสีย" }));
      expect(a.queryByLabelText(/น้ำหนักเศษที่คืน/)).not.toBeInTheDocument();
      await userEvent.click(a.getByRole("radio", { name: "หัก" }));
      await userEvent.click(a.getByRole("button", { name: "ยกเลิกส่วน" }));
      await waitFor(() => expect(lots.cancelJobLot).toHaveBeenCalledWith({ lotJobId: L1, reason: "ของแตก", disposition: "scrap", scrapReason: "broken" }));
      cleanup();
      const b = await open(lotsWithWeigh(false), "gold");
      await userEvent.click(b.getByRole("radio", { name: "นับเป็นของเสีย" }));
      expect(b.queryByLabelText(/น้ำหนักเศษที่คืน/)).not.toBeInTheDocument();
    });

    it("DB ตอบ weight_over / scrap_weight_required → ข้อความไทยค้างในกล่อง ค่าไม่หาย", async () => {
      lots.cancelJobLot.mockResolvedValue({ ok: false, error: "น้ำหนักมากกว่าที่มีอยู่ — ชั่งใหม่ (ส่งต่อ: เกินน้ำหนักเข้า + เติมโลหะ − ที่แยกไป · ยกเลิกส่วนเป็นของเสีย: เกินน้ำหนักที่ส่วนนั้นมี)" });
      const d = await open(lotsWithWeigh(true), "gold");
      await userEvent.click(d.getByRole("radio", { name: "นับเป็นของเสีย" }));
      await userEvent.click(d.getByRole("radio", { name: "หัก" }));
      await userEvent.type(d.getByLabelText(/น้ำหนักเศษที่คืน/), "999");
      await userEvent.click(d.getByRole("button", { name: "ยกเลิกส่วน" }));
      expect(await d.findByRole("alert")).toHaveTextContent("น้ำหนักมากกว่าที่มีอยู่");
      expect(d.getByLabelText(/น้ำหนักเศษที่คืน/)).toHaveValue("999");
    });
  });

  describe("ขั้นรอรับของส่วน: ออฟฟิศรับแทน + ป้ายล็อก (L-2)", () => {
    const pendingLots = (locked: boolean): JobLotsData => {
      const l = jb0020();
      l.parts[1] = { ...l.parts[1], holdSeq: null, pendingSeq: 3, pendingStageName: "ฝังพลอย", pendingWeighRequired: true, receiveLocked: locked, stageStatus: "pending" };
      return l;
    };
    it("ส่วนที่รอรับ: มีปุ่ม 'กรอกแทน: รับงาน' · ไม่ล็อก = ไม่มีป้าย", async () => {
      wrap(<JobDetailClient data={detail(pendingLots(false), { metal: "gold" })} />);
      await panel();
      expect(screen.getByRole("button", { name: "กรอกแทน: รับงาน ส่วนที่ 1" })).toBeInTheDocument();
      expect(screen.queryByText(/ล็อก: ช่างชั่งรับ/)).not.toBeInTheDocument();
    });
    it("ล็อก: ป้ายเหลืองบอกให้ออฟฟิศรับแทน · รับแทน → officeReceiveStage(ส่วนนั้น, expectedSeq ของขั้นรอรับ) + ต้องชั่ง/เลือกผู้รับ", async () => {
      wrap(<JobDetailClient data={{ ...detail(pendingLots(true), { metal: "gold" }), workers: [{ id: "55555555-5555-4555-8555-555555555555", displayName: "ช่าง ค", stageCodes: [] }] }} />);
      await panel();
      expect(screen.getByText(/ล็อก: ช่างชั่งรับ ฝังพลอย ไม่ตรงหลายครั้ง — ให้ออฟฟิศรับแทน/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "กรอกแทน: รับงาน ส่วนที่ 1" }));
      const d = within(await screen.findByRole("dialog", { name: /รับงานแทน/ }));
      expect(d.getByText(/ขั้นนี้ถูกล็อก/)).toBeInTheDocument();
      const btn = d.getByRole("button", { name: "บันทึกรับงาน" });
      expect(btn).toBeDisabled();
      await userEvent.selectOptions(d.getByLabelText("ผู้รับงาน"), "ช่าง ค");
      expect(btn).toBeDisabled(); // ขั้นต้องชั่ง
      await userEvent.type(d.getByLabelText(/น้ำหนักเข้า/), "19,5");
      await userEvent.click(btn);
      await waitFor(() => expect(w.officeReceiveStage).toHaveBeenCalledTimes(1));
      expect(w.officeReceiveStage.mock.calls[0][0]).toMatchObject({ jobId: L1, expectedSeq: 3, weightIn: "19,5", workerId: "55555555-5555-4555-8555-555555555555", assigneeName: null });
    });
    it("ส่วนที่มีผู้ถือ (ไม่ใช่ขั้นรอรับ) / ใบปิด: ไม่มีปุ่มรับแทน", async () => {
      wrap(<JobDetailClient data={detail(jb0020())} />);
      await panel();
      expect(screen.queryByRole("button", { name: /กรอกแทน: รับงาน ส่วนที่/ })).not.toBeInTheDocument();
      cleanup();
      wrap(<JobDetailClient data={detail(pendingLots(true), { status: "done" })} />);
      await panel();
      expect(screen.queryByRole("button", { name: /กรอกแทน: รับงาน ส่วนที่/ })).not.toBeInTheDocument();
    });
  });

  describe("น้ำหนักทั้งต้นไม้ (v_job_tree_stage_loss)", () => {
    const tl = (o: Record<string, unknown>) => mapTreeStageLoss({ root_job_id: JOB, lot_seq: 0, job_id: JOB, job_stage_id: "s-cast", stage_code: "cast", ...o })!;
    it("ใบแม่ที่แยกส่วน: ตารางขั้นใช้ loss จากทั้งต้นไม้ (แทนค่าของใบเอง) + รายการน้ำหนักตามส่วน", async () => {
      const l = jb0020();
      l.treeLoss = [tl({ loss_g: 1.5, loss_pct: 3 }), tl({ lot_seq: 1, job_id: L1, job_stage_id: "x1", stage_code: "polish", handoff_gap_partial_g: -0.4, not_comparable: false }), tl({ lot_seq: 2, job_id: L2, job_stage_id: "x2", stage_code: "setting", not_comparable: true })];
      const d = detail(l, { metal: "gold" });
      d.stages[0] = { ...d.stages[0], status: "sent" };
      wrap(<JobDetailClient data={d} />);
      const p = within(await panel());
      expect(p.getByRole("heading", { name: "น้ำหนักตามส่วน (ออฟฟิศเท่านั้น)" })).toBeInTheDocument();
      expect(p.getByText(/ส่วนต่างน้ำหนัก \(รับไม่ครบ\) −0.4 g/)).toBeInTheDocument();
      expect(p.getByText(/เทียบไม่ได้ \(แยกส่วนออกจากขั้นนี้\)/)).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "ขั้นตอน" })).getByText(/หาย 1\.5 g \(3%\)/)).toBeInTheDocument();
    });
    it("ไม่มี treeLoss (ใบเดี่ยว/อ่านไม่ได้): ไม่มีรายการน้ำหนักตามส่วน · ตารางขั้นใช้ loss เดิม", async () => {
      const d = detail(jb0020());
      d.stages[0] = { ...d.stages[0], status: "sent" };
      d.loss = { "s-cast": { handoffGapG: null, lossG: 0.7, lossPct: 1, warn: false, notWeighed: false } };
      wrap(<JobDetailClient data={d} />);
      await panel();
      expect(screen.queryByRole("heading", { name: /น้ำหนักตามส่วน/ })).not.toBeInTheDocument();
      expect(screen.getByText(/หาย 0\.7 g \(1%\)/)).toBeInTheDocument();
    });
  });
});
