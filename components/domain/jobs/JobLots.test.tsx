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
const w = { revokeJobQr: vi.fn(), doneJob: vi.fn() };
vi.mock("@/lib/actions/job-office-write", () => ({
  revokeJobQr: (...a: unknown[]) => w.revokeJobQr(...a),
  doneJob: (...a: unknown[]) => w.doneJob(...a),
  setJobSurplus: vi.fn(), setJobQtyPlanned: vi.fn(), setJobPlan: vi.fn(), cancelJob: vi.fn(), reopenJobStage: vi.fn(), setJobDesignLabel: vi.fn(), setJobDue: vi.fn(), setJobStartGateNote: vi.fn(),
  skipJobStage: vi.fn(), officeReceiveStage: vi.fn(), officeSendStage: vi.fn(), issueJobQr: vi.fn(),
}));
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: vi.fn() }));
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: vi.fn(), changeJobProfile: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobDetailClient } from "./JobDetailClient";
import { mapBoardRow, mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import { mapDiscrepancy, mapLotPart, mapLotsSummary } from "@/lib/jobs/lots";
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

function detail(lotsData: JobLotsData | null | undefined, o: { stagesAllSent?: boolean; status?: string } = {}): JobDetailData {
  const base = { id: JOB, job_no: "JB-0020", source_kind: "production", design_label: "แหวนโกเมนไข่", sku_snapshot: null, metal: "silver", qty_planned: 100, qty_order: 100, status: o.status ?? "in_progress", production_order_item_id: "33333333-3333-4333-8333-333333333333" };
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
  for (const f of [lots.splitJobLot, lots.cancelJobLot, lots.resolveDiscrepancyOffice, lots.voidDiscrepancy, w.revokeJobQr]) f.mockResolvedValue({ ok: true, data: { lotJobId: L2, lotSeq: 4, label: "x", qty: 1, parentRemaining: 1, qtyHold: 0, disposition: "return_to_parent", liveQty: 0, qty2: 0, revoked: 1 } });
});

const panel = async () => screen.findByRole("region", { name: /ส่วนของใบนี้/ });

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
