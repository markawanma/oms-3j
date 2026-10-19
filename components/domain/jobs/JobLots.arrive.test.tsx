// @vitest-environment jsdom
// หน้าใบงานแม่ (ออฟฟิศ): "ได้รับเพิ่มแล้ว" (0183) — ปุ่มบนการ์ดส่วนต่าง · dialog จำนวน/วันรับ/ผู้ถือ/น้ำหนัก · แถว arrived · ป้ายส่วนจาก arrive · ปิดใบ = ดี + เสีย + แยกออก + arrived
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const lots = { splitJobLot: vi.fn(), cancelJobLot: vi.fn(), resolveDiscrepancyOffice: vi.fn(), voidDiscrepancy: vi.fn(), listJobQr: vi.fn(), arriveDiscrepancyOffice: vi.fn() };
vi.mock("@/lib/actions/job-lots", () => ({
  splitJobLot: (...a: unknown[]) => lots.splitJobLot(...a),
  cancelJobLot: (...a: unknown[]) => lots.cancelJobLot(...a),
  resolveDiscrepancyOffice: (...a: unknown[]) => lots.resolveDiscrepancyOffice(...a),
  voidDiscrepancy: (...a: unknown[]) => lots.voidDiscrepancy(...a),
  listJobQr: (...a: unknown[]) => lots.listJobQr(...a),
  arriveDiscrepancyOffice: (...a: unknown[]) => lots.arriveDiscrepancyOffice(...a),
}));
const w = { doneJob: vi.fn() };
vi.mock("@/lib/actions/job-office-write", () => ({
  revokeJobQr: vi.fn(), doneJob: (...a: unknown[]) => w.doneJob(...a),
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
const DISC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WK = "55555555-5555-4555-8555-555555555555";
const WK2 = "66666666-6666-4666-8666-666666666666";
const TODAY = "2026-10-20";

const stage = (code: string, seq: number, status: string): StageRow => ({
  id: `s-${code}`, seq, code, name: code === "cast" ? "หล่อ" : code === "qc" ? "ตรวจ QC" : "แพ็ก", status, weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: false, receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null,
});

const tp = (o: Record<string, unknown>): LotPart => mapLotPart({ job_id: JOB, root_job_id: JOB, lot_seq: 0, label: "JB-0018", status: "in_progress", qty_planned: 50, qty_live: 48, stage_code: "qc", stage_name: "ตรวจ QC", stage_status: "received", holder_name: "ช่าง ค", days_in_stage: 2, ...o })!;

const workers = [
  { id: WK, displayName: "ช่าง ค", stageCodes: [] },
  { id: WK2, displayName: "ช่าง ง", stageCodes: ["qc"] },
  { id: "77777777-7777-4777-8777-777777777777", displayName: "ช่างหล่อ", stageCodes: ["cast"] },
];

function detail(l: JobLotsData, o: { stagesAllSent?: boolean; metal?: string; qty?: number } = {}): JobDetailData {
  const base = { id: JOB, job_no: "JB-0018", source_kind: "production", design_label: "แหวนโกเมนไข่", sku_snapshot: null, metal: o.metal ?? "silver", qty_planned: o.qty ?? 50, qty_order: o.qty ?? 50, status: "in_progress", production_order_item_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-01T00:00:00Z" };
  const stages = o.stagesAllSent ? [stage("cast", 1, "sent"), stage("qc", 2, "sent"), stage("pack", 3, "sent")] : [stage("cast", 1, "sent"), stage("qc", 2, "received"), stage("pack", 3, "pending")];
  return {
    job: mapJobDetail(base)!,
    board: mapBoardRow({ id: JOB, job_no: "JB-0018", seq: 18, source_kind: "production", metal: o.metal ?? "silver", qty_planned: o.qty ?? 50, qty_order: o.qty ?? 50, status: "in_progress" }),
    stages, loss: {}, events: [], eventsTruncated: false, activeTokens: 0, workers, source: null, todayTh: TODAY, lots: l,
  } as unknown as JobDetailData;
}

const ctx = (weigh = false) => ({ stageById: { a: { name: "ขัด", code: "polish", weighRequired: false }, b: { name: "ตรวจ QC", code: "qc", weighRequired: weigh } }, labelByJob: { [JOB]: "JB-0018" } });
const withDisc = (qty = 2, weigh = false): JobLotsData => ({
  parts: [{ ...tp({}), holdSeq: 2 }],
  summary: mapLotsSummary({ root_job_id: JOB, qty_planned: 50, lots_open: 0, qty_pending_explanation: qty, sum_check: true }),
  discrepancies: [mapDiscrepancy({ id: DISC, job_id: JOB, from_stage_id: "a", to_stage_id: "b", qty, status: "open" }, ctx(weigh))!],
});

beforeEach(() => {
  vi.clearAllMocks();
  lots.listJobQr.mockResolvedValue({ ok: true, data: [] });
  lots.arriveDiscrepancyOffice.mockResolvedValue({ ok: true, data: { qty: 2, qtyRemaining: 0, remainingDiscrepancyId: null, lot: { lotJobId: L1, lotSeq: 1, label: "JB-0018 · ส่วนที่ 1", stageCode: "qc" } } });
  w.doneJob.mockResolvedValue({ ok: true, data: null });
});

const panel = async () => screen.findByRole("region", { name: /ส่วนของใบนี้/ }, { timeout: 10_000 });
const openArrive = async (l: JobLotsData, o: { metal?: string } = {}) => {
  wrap(<JobDetailClient data={detail(l, o)} />);
  await userEvent.click(await within(await panel()).findByRole("button", { name: "ได้รับเพิ่ม" }));
  return within(await screen.findByRole("dialog", { name: "ได้รับเพิ่มแล้ว" }));
};

describe("ออฟฟิศ — ได้รับเพิ่ม บนการ์ดส่วนต่าง", () => {
  it("ปุ่ม 'ได้รับเพิ่ม' อยู่ข้าง ชี้แจงแทน / ยกเลิกส่วนต่าง · ใบที่ปิดแล้วไม่มีปุ่ม", async () => {
    wrap(<JobDetailClient data={detail(withDisc())} />);
    const p = within(await panel());
    expect(p.getByRole("button", { name: "ชี้แจงแทน" })).toBeEnabled();
    expect(p.getByRole("button", { name: "ได้รับเพิ่ม" })).toBeEnabled();
    expect(p.getByRole("button", { name: "ยกเลิกส่วนต่าง" })).toBeEnabled();
    cleanup();
    const closed = detail(withDisc());
    closed.job = { ...closed.job, status: "done" };
    wrap(<JobDetailClient data={closed} />);
    await panel();
    expect(screen.queryByRole("button", { name: "ได้รับเพิ่ม" })).not.toBeInTheDocument();
  });

  it("dialog: ค่าเริ่ม = ค้างทั้งหมด (2) · วันนี้ · ผู้ถือ = ผู้รับเดิม · บันทึก → payload { discrepancyId, qty, expectedOpen } เท่านั้น (ไม่มี receivedOn/workerId/weightG)", async () => {
    const d = await openArrive(withDisc());
    expect(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น")).toHaveValue("2");
    expect(d.getByLabelText("วันที่ได้รับของ")).toHaveValue(TODAY);
    expect(d.getByRole("option", { name: /ผู้รับเดิมของขั้น ตรวจ QC/ })).toBeInTheDocument();
    expect(d.queryByLabelText(/น้ำหนักชิ้นที่มาถึง/)).not.toBeInTheDocument(); // เงิน/ขั้นไม่ชั่ง
    await userEvent.click(d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" }));
    await waitFor(() => expect(lots.arriveDiscrepancyOffice).toHaveBeenCalledTimes(1));
    expect(lots.arriveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, qty: 2, expectedOpen: 2 });
  });

  it("ได้ไม่ครบ (3 จาก 5): สรุป 'ได้รับเพิ่ม 3 · ยังค้าง 2' · payload qty 3 expectedOpen 5", async () => {
    const d = await openArrive(withDisc(5));
    await userEvent.clear(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น"));
    await userEvent.type(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น"), "3");
    expect(d.getByRole("status")).toHaveTextContent("ได้รับเพิ่ม 3 · ยังค้าง 2");
    await userEvent.click(d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" }));
    await waitFor(() => expect(lots.arriveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, qty: 3, expectedOpen: 5 }));
  });

  it("เกินที่ค้าง / 0 / ไม่ใช่จำนวนเต็ม / ว่าง = ปุ่มปิด + ข้อความ · ไม่เรียก server", async () => {
    const d = await openArrive(withDisc(2));
    const f = d.getByLabelText("ได้รับเพิ่มกี่ชิ้น");
    const btn = d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" });
    await userEvent.clear(f);
    await userEvent.type(f, "3");
    expect(d.getByRole("alert")).toHaveTextContent("ได้รับเพิ่มได้ไม่เกิน 2 ชิ้น");
    expect(btn).toBeDisabled();
    for (const bad of ["0", "1.5", "-1", "abc"]) {
      await userEvent.clear(f);
      await userEvent.type(f, bad);
      expect(btn).toBeDisabled();
    }
    await userEvent.clear(f);
    expect(btn).toBeDisabled();
    expect(lots.arriveDiscrepancyOffice).not.toHaveBeenCalled();
  });

  it("เลือกวันย้อนหลัง + ช่างผู้ถือ → receivedOn + workerId (วันนี้ไม่ส่ง) · รายชื่อช่างกรองตามขั้นผู้รับ (ไม่มีช่างหล่อ) · วันจำกัด 14 วันถึงวันนี้", async () => {
    const d = await openArrive(withDisc());
    const on = d.getByLabelText("วันที่ได้รับของ");
    expect(on).toHaveAttribute("min", "2026-10-06");
    expect(on).toHaveAttribute("max", TODAY);
    expect(d.queryByRole("option", { name: "ช่างหล่อ" })).not.toBeInTheDocument();
    await userEvent.selectOptions(d.getByLabelText("ผู้ถือชิ้นที่มาถึง"), WK2);
    await userEvent.clear(on);
    await userEvent.type(on, "2026-10-18");
    await userEvent.click(d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" }));
    await waitFor(() => expect(lots.arriveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, qty: 2, expectedOpen: 2, receivedOn: "2026-10-18", workerId: WK2 }));
  });

  it("ทอง + ขั้นผู้รับตั้งชั่ง: ช่องน้ำหนักบังคับ (ว่าง/0/ผิดรูป = ปุ่มปิด) · ผ่านแล้วส่ง weightG · ทองแต่ขั้นไม่ชั่ง/งานเงิน = ไม่มีช่อง", async () => {
    const d = await openArrive(withDisc(2, true), { metal: "gold" });
    const btn = d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" });
    expect(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/)).toBeInTheDocument();
    expect(btn).toBeDisabled();
    await userEvent.type(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/), "0");
    expect(btn).toBeDisabled();
    await userEvent.clear(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/));
    await userEvent.type(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/), "1.2345");
    expect(btn).toBeDisabled();
    await userEvent.clear(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/));
    await userEvent.type(d.getByLabelText(/น้ำหนักชิ้นที่มาถึง/), "1.25");
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(lots.arriveDiscrepancyOffice).toHaveBeenCalledWith({ discrepancyId: DISC, qty: 2, expectedOpen: 2, weightG: "1.25" }));
    cleanup();
    // ทอง แต่ขั้นผู้รับไม่ชั่ง
    const d2 = await openArrive(withDisc(2, false), { metal: "gold" });
    expect(d2.queryByLabelText(/น้ำหนักชิ้นที่มาถึง/)).not.toBeInTheDocument();
    cleanup();
    // เงิน แม้ขั้นตั้งชั่ง
    const d3 = await openArrive(withDisc(2, true), { metal: "silver" });
    expect(d3.queryByLabelText(/น้ำหนักชิ้นที่มาถึง/)).not.toBeInTheDocument();
  });

  it("DB ปฏิเสธ (arrive_heavy / stage_changed): แสดงข้อความ ค้างใน dialog ไม่ปิด · ค่าที่กรอกยังอยู่", async () => {
    lots.arriveDiscrepancyOffice.mockResolvedValue({ ok: false, error: "ส่วนต่างนี้เปลี่ยนไปแล้ว — โหลดหน้าใหม่", code: "stage_changed" });
    const d = await openArrive(withDisc(5));
    await userEvent.clear(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น"));
    await userEvent.type(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น"), "4");
    await userEvent.click(d.getByRole("button", { name: "บันทึกได้รับเพิ่ม" }));
    expect(await d.findByRole("alert")).toHaveTextContent("ส่วนต่างนี้เปลี่ยนไปแล้ว");
    expect(screen.getByRole("dialog", { name: "ได้รับเพิ่มแล้ว" })).toBeInTheDocument();
    expect(d.getByLabelText("ได้รับเพิ่มกี่ชิ้น")).toHaveValue("4");
  });

  it("แถวส่วนต่างที่ arrived แสดง 'ได้รับเพิ่มแล้ว 2 ชิ้น' (ไม่ใช่ 'ชี้แจงแล้ว') · ส่วนที่เกิดจาก arrive มีป้าย 'จากของที่ได้รับเพิ่ม'", async () => {
    const l = withDisc(3);
    l.discrepancies = [
      mapDiscrepancy({ id: DISC, job_id: JOB, from_stage_id: "a", to_stage_id: "b", qty: 3, status: "open" }, ctx())!,
      mapDiscrepancy({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", job_id: JOB, from_stage_id: "a", to_stage_id: "b", qty: 2, status: "resolved", resolved_kind: "arrived" }, ctx())!,
    ];
    l.parts = [...l.parts, { ...tp({ job_id: L1, lot_seq: 1, label: "JB-0018 · ส่วนที่ 1", qty_planned: 2, qty_live: 2 }), fromArrive: true, holdSeq: 2 }];
    wrap(<JobDetailClient data={detail(l)} />);
    const p = within(await panel());
    const settled = p.getByRole("list", { name: "ส่วนต่างที่ชี้แจงแล้ว" });
    expect(settled).toHaveTextContent("ได้รับเพิ่มแล้ว 2 ชิ้น · ขัด → ตรวจ QC");
    expect(settled).not.toHaveTextContent("ชี้แจงแล้ว");
    const parts = within(p.getByRole("list", { name: "รายการส่วน" }));
    expect(parts.getAllByText("จากของที่ได้รับเพิ่ม")).toHaveLength(1);
    expect(p.getByRole("heading", { name: "ส่วนต่างรอชี้แจง (3 ชิ้น)" })).toBeInTheDocument();
  });
});

describe("ปิดใบแม่ — ดี + เสีย + แยกออก + ได้รับเพิ่ม = เริ่มผลิต", () => {
  /** ใบ 20: ส่วนหลักถือ 18 (arrived 2 → ไปอยู่ส่วนที่ 1 ที่ปิดแล้ว) */
  const closedLots = (rootExtra: Record<string, unknown> = {}): JobLotsData => ({
    parts: [
      { ...tp({ qty_planned: 20, qty_live: 18, qty_discrepancy_arrived: 2, ...rootExtra }), holdSeq: null },
      { ...tp({ job_id: L1, lot_seq: 1, label: "JB-0018 · ส่วนที่ 1", qty_planned: 2, qty_live: null, status: "done", qty_good: 2 }), fromArrive: true },
    ],
    summary: mapLotsSummary({ root_job_id: JOB, qty_planned: 20, qty_order: 20, parts_count: 2, lots_open: 0, qty_pending_explanation: 0, sum_check: true }),
    discrepancies: [],
  });
  const openDone = async (l: JobLotsData) => {
    wrap(<JobDetailClient data={detail(l, { stagesAllSent: true, qty: 20 })} />);
    await userEvent.click(await screen.findByRole("button", { name: "ปิดงาน" }));
    return within(await screen.findByRole("dialog", { name: "ปิดงาน" }));
  };

  it("arrived 2: ค่าเริ่ม ดี 18 เสีย 0 · บอก 'ได้รับเพิ่มแล้ว 2 ชิ้น' · ปิดด้วย (18, 0) → doneJob ไม่ขึ้น 'ขาด'", async () => {
    const d = await openDone(closedLots());
    expect(d.getByLabelText("จำนวนดี (ชิ้น)")).toHaveValue("18");
    expect(d.getByLabelText("จำนวนเสีย (ชิ้น)")).toHaveValue("0");
    expect(d.getByText(/ได้รับเพิ่มแล้ว/)).toHaveTextContent("ได้รับเพิ่มแล้ว 2 ชิ้น");
    expect(d.queryByText(/ขาด/)).not.toBeInTheDocument();
    await userEvent.click(d.getByRole("button", { name: "ปิดงาน" }));
    await waitFor(() => expect(w.doneJob).toHaveBeenCalledTimes(1));
    expect(w.doneJob.mock.calls[0][0]).toMatchObject({ jobId: JOB, qtyGood: 18, qtyScrap: 0 });
  });

  it("(20, 0) ไม่หัก arrived = ปุ่มปิดงานปิด + ข้อความสูตรมี 'ได้รับเพิ่ม' (DB จะตอบ qty_mismatch)", async () => {
    const d = await openDone(closedLots());
    await userEvent.clear(d.getByLabelText("จำนวนดี (ชิ้น)"));
    await userEvent.type(d.getByLabelText("จำนวนดี (ชิ้น)"), "20");
    expect(d.getByRole("button", { name: "ปิดงาน" })).toBeDisabled();
    expect(d.getByText(/ดี \+ เสีย \+ ได้รับเพิ่ม ต้องเท่ากับจำนวนเริ่มผลิต \(20 ชิ้น\)/)).toBeInTheDocument();
    expect(w.doneJob).not.toHaveBeenCalled();
  });

  it("แยกส่วน 5 + arrived 2 พร้อมกัน: ฐาน = 20 − 5 − 2 = 13 · ข้อความสูตรครบทั้งสองพจน์", async () => {
    const d = await openDone(closedLots({ qty_split_out: 5 }));
    expect(d.getByLabelText("จำนวนดี (ชิ้น)")).toHaveValue("13");
    await userEvent.clear(d.getByLabelText("จำนวนดี (ชิ้น)"));
    await userEvent.type(d.getByLabelText("จำนวนดี (ชิ้น)"), "15");
    expect(d.getByText(/ดี \+ เสีย \+ แยกเป็นส่วนย่อย \+ ได้รับเพิ่ม ต้องเท่ากับ/)).toBeInTheDocument();
  });

  it("เสียที่ช่างแจ้งยังเป็นค่าเริ่ม (ดี 16 เสีย 2) เมื่อมี arrived", async () => {
    wrap(<JobDetailClient data={(() => { const x = detail(closedLots(), { stagesAllSent: true, qty: 20 }); x.stages[0] = { ...x.stages[0], qtyScrap: 2 }; return x; })()} />);
    await userEvent.click(await screen.findByRole("button", { name: "ปิดงาน" }));
    const d = within(await screen.findByRole("dialog", { name: "ปิดงาน" }));
    expect(d.getByLabelText("จำนวนดี (ชิ้น)")).toHaveValue("16");
    expect(d.getByLabelText("จำนวนเสีย (ชิ้น)")).toHaveValue("2");
  });

  it("ใบที่ไม่มี arrived (qty_discrepancy_arrived 0) = กล่องเดิมเป๊ะ: ดี 20 · ไม่มีบรรทัด 'ได้รับเพิ่ม'", async () => {
    const l: JobLotsData = { parts: [{ ...tp({ qty_planned: 20, qty_live: 20 }), holdSeq: null }], summary: null, discrepancies: [] };
    wrap(<JobDetailClient data={detail(l, { stagesAllSent: true, qty: 20 })} />);
    await userEvent.click(await screen.findByRole("button", { name: "ปิดงาน" }));
    const d = within(await screen.findByRole("dialog", { name: "ปิดงาน" }));
    expect(d.getByLabelText("จำนวนดี (ชิ้น)")).toHaveValue("20");
    expect(d.queryByText(/ได้รับเพิ่ม/)).not.toBeInTheDocument();
  });

  it("ปิดส่วนย่อยที่เคยมี arrived ของตัวเอง: ฐานหัก arrived ของส่วนนั้น", async () => {
    const l: JobLotsData = {
      parts: [
        { ...tp({ qty_planned: 20, qty_live: 10, qty_split_out: 10 }), holdSeq: 2 },
        { ...tp({ job_id: L1, lot_seq: 1, label: "JB-0018 · ส่วนที่ 1", qty_planned: 10, qty_live: 8, qty_discrepancy_arrived: 2 }), holdSeq: null, pendingSeq: null },
      ],
      summary: mapLotsSummary({ root_job_id: JOB, qty_planned: 20, qty_order: 20, parts_count: 2, lots_open: 1, sum_check: true }),
      discrepancies: [],
    };
    wrap(<JobDetailClient data={detail(l, { qty: 20 })} />);
    await userEvent.click(await within(await panel()).findByRole("button", { name: "ปิด ส่วนที่ 1" }));
    const d = within(await screen.findByRole("dialog", { name: "ปิด ส่วนที่ 1" }));
    expect(d.getByLabelText("จำนวนดี (ชิ้น)")).toHaveValue("8");
  });
});
