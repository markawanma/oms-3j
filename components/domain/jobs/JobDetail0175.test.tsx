// @vitest-environment jsdom
// 0175 หน้ารายละเอียดใบงาน (ออฟฟิศ): การ์ดจำนวนและแผน · dialog แก้จำนวน/แผน · ตัดสินของเหลือ · DoneDialog ของเหลือ · ใบพิมพ์ A5
// ต้องไม่พัง: ใบเดิม (สั่ง = เริ่มผลิต · ไม่มีแผน) ไม่ขึ้นสองเลข/ไม่มี underPlanned · ใบที่ขั้นหล่อรับแล้วหน้าเปิดได้ (JB-0018)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const w = {
  doneJob: vi.fn(), setJobSurplus: vi.fn(), setJobQtyPlanned: vi.fn(), setJobPlan: vi.fn(),
  cancelJob: vi.fn(), reopenJobStage: vi.fn(), setJobDesignLabel: vi.fn(), setJobDue: vi.fn(), setJobStartGateNote: vi.fn(), skipJobStage: vi.fn(),
  officeReceiveStage: vi.fn(), officeSendStage: vi.fn(), issueJobQr: vi.fn(),
};
vi.mock("@/lib/actions/job-office-write", () => ({
  doneJob: (...a: unknown[]) => w.doneJob(...a),
  setJobSurplus: (...a: unknown[]) => w.setJobSurplus(...a),
  setJobQtyPlanned: (...a: unknown[]) => w.setJobQtyPlanned(...a),
  setJobPlan: (...a: unknown[]) => w.setJobPlan(...a),
  cancelJob: (...a: unknown[]) => w.cancelJob(...a),
  reopenJobStage: (...a: unknown[]) => w.reopenJobStage(...a),
  setJobDesignLabel: (...a: unknown[]) => w.setJobDesignLabel(...a),
  setJobDue: (...a: unknown[]) => w.setJobDue(...a),
  setJobStartGateNote: (...a: unknown[]) => w.setJobStartGateNote(...a),
  skipJobStage: (...a: unknown[]) => w.skipJobStage(...a),
  officeReceiveStage: (...a: unknown[]) => w.officeReceiveStage(...a),
  officeSendStage: (...a: unknown[]) => w.officeSendStage(...a),
  issueJobQr: (...a: unknown[]) => w.issueJobQr(...a),
}));
const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a) }));
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: vi.fn(), changeJobProfile: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobDetailClient } from "./JobDetailClient";
import { DoneDialog } from "./JobDialogs";
import { JobSheet, purityWord } from "./JobPrintClient";
import { STATUS_ICON } from "./StatusChip";
import type { StatusKey } from "@/lib/jobs/board";
import { toPrintableJob } from "@/lib/jobs/print";
import { mapBoardRow, mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import type { JobDetailData } from "@/lib/actions/job-office";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

const stage = (code: string, seq: number, status: string): StageRow => ({
  id: `s-${code}`, seq, code, name: code === "cast" ? "หล่อ" : code === "qc" ? "ตรวจ QC" : "แพ็ก", status, weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: false, receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null,
});

const BASIS = { target_piece_g: 4, target_source: "quote", qty_planned: 35, sprue_loss_pct: 9, formula: "x", computed_g: 153.6, override_g: null, override_reason: null, missing: [] };

function detail(job: Record<string, unknown> = {}, boardOver: Record<string, unknown> = {}, stages: StageRow[] = [stage("cast", 1, "pending"), stage("qc", 2, "pending"), stage("pack", 3, "pending")]): JobDetailData {
  const base = {
    id: JOB, job_no: "JB-0100", source_kind: "oem", design_label: "แหวนลาย A", sku_snapshot: null, metal: "silver", qty_planned: 35, qty_order: 30, status: "open",
    qty_good: null, qty_scrap: null, weight_final_g: null, due_date: null, oem_quote_item_id: ITEM, target_piece_g: 4, metal_plan_g: 153.6, metal_plan_basis: BASIS, surplus_disposition: null, surplus_note: null, ...job,
  };
  const board = { id: JOB, job_no: "JB-0100", seq: 100, source_kind: "oem", metal: "silver", qty_planned: base.qty_planned, qty_order: base.qty_order, status: base.status, under_planned: false, surplus_pending: false, qty_surplus: null, ...boardOver };
  return {
    job: mapJobDetail(base)!, board: mapBoardRow(board), stages, loss: {}, events: [], eventsTruncated: false, activeTokens: 0, workers: [], source: null, todayTh: "2026-10-15",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of Object.values(w)) f.mockResolvedValue({ ok: true, data: null });
  getJobPlanSuggest.mockResolvedValue({
    ok: true,
    data: { qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 35, underPlanned: false, rejectBasis: { castPct: 6, polishPct: 3, platePct: null, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "input", metal: "silver", metalPlanG: 153.6, metalPlanBasis: BASIS, missing: [] },
  });
});

const card = () => screen.getByRole("region", { name: "จำนวนและแผน" });

describe("0175 การ์ดจำนวนและแผน + header", () => {
  it("ใบใหม่ (สั่ง 30 เริ่ม 35): header สองเลข · การ์ดมีสูตรจาก basis ของ DB · ปุ่มแก้จำนวน/แก้แผนใช้ได้", () => {
    wrap(<JobDetailClient data={detail()} />);
    expect(screen.getByText(/สั่ง 30 · เริ่มผลิต 35 ชิ้น/, { selector: "p" })).toBeInTheDocument();
    const c = within(card());
    expect(c.getByText("153.600 g")).toBeInTheDocument();
    expect(c.getByText(/คำนวณ: 35 ชิ้น × 4\.000 g × \(1 \+ ก้านต้น 9%\)/)).toBeInTheDocument();
    expect(c.getByText(/ที่มา: ใบเสนอราคา/)).toBeInTheDocument();
    expect(c.getByRole("button", { name: "แก้จำนวน" })).toBeEnabled();
    expect(c.getByRole("button", { name: "แก้แผน" })).toBeEnabled();
  });

  it("ใบเดิม (สั่ง = เริ่มผลิต · ไม่มีน้ำหนัก/แผน): header 'n ชิ้น' ไม่ขึ้นสองเลข · ไม่มี underPlanned · 'ไม่ได้วางแผนโลหะ' + ตั้งแผน", () => {
    wrap(<JobDetailClient data={detail({ qty_planned: 12, qty_order: 12, target_piece_g: null, metal_plan_g: null, metal_plan_basis: null })} />);
    expect(screen.getByText(/^12 ชิ้น · เงิน/, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText(/สั่ง 12/, { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByText(/เริ่มผลิต \d+ จากสั่ง/)).not.toBeInTheDocument();
    const c = within(card());
    expect(c.getByText("ไม่ได้วางแผนโลหะ")).toBeInTheDocument();
    expect(c.getByRole("button", { name: "ตั้งแผนโลหะ" })).toBeEnabled();
  });

  it("เผื่อ: สั่ง 30 เริ่ม 35 = ป้าย 'เผื่อ +5' ขึ้นครั้งเดียวที่หัวใบ (StatusChip) · ไม่ซ้ำในการ์ดแผน · ใบเท่ากัน/ผลิตน้อยกว่าสั่งไม่มีป้าย", () => {
    const { unmount } = wrap(<JobDetailClient data={detail()} />);
    expect(screen.getAllByText("เผื่อ +5")).toHaveLength(1);
    expect(within(card()).queryByText(/เผื่อ \+/)).not.toBeInTheDocument();
    unmount();
    const eq = wrap(<JobDetailClient data={detail({ qty_planned: 30, qty_order: 30 })} />);
    expect(screen.queryByText(/เผื่อ \+/)).not.toBeInTheDocument();
    eq.unmount();
    wrap(<JobDetailClient data={detail({ qty_planned: 28 }, { under_planned: true })} />);
    expect(screen.queryByText(/เผื่อ \+/)).not.toBeInTheDocument();
  });

  it("เริ่มผลิต 28 จากสั่ง 30: ป้ายฟ้า 'เริ่มผลิต 28 จากสั่ง 30' ข้อมูลประกอบ", () => {
    wrap(<JobDetailClient data={detail({ qty_planned: 28 }, { under_planned: true })} />);
    expect(screen.getByText("เริ่มผลิต 28 จากสั่ง 30")).toBeInTheDocument();
  });

  it("ขั้นแรกถูกรับแล้ว: ปุ่มแก้จำนวนไม่มี + ข้อความอ่านได้ 'ขั้นแรกถูกรับแล้ว แก้ไม่ได้' (ไม่ใช่ tooltip)", () => {
    wrap(<JobDetailClient data={detail({}, {}, [stage("cast", 1, "received"), stage("qc", 2, "pending")])} />);
    const c = within(card());
    expect(c.queryByRole("button", { name: "แก้จำนวน" })).not.toBeInTheDocument();
    expect(c.getByText("ขั้นแรกถูกรับแล้ว แก้ไม่ได้")).toBeVisible();
    expect(c.getByText("ขั้นหล่อถูกรับแล้ว แก้แผนไม่ได้")).toBeVisible();
    expect(c.queryByRole("button", { name: "แก้แผน" })).not.toBeInTheDocument();
  });

  it("ขั้นแรกรับแล้วแต่ไม่ใช่ขั้นหล่อ: แก้จำนวนไม่ได้ แต่แก้แผนได้ (ตรงเงื่อนไข DB)", () => {
    wrap(<JobDetailClient data={detail({}, {}, [stage("cast", 1, "pending"), stage("qc", 2, "received")])} />);
    const c = within(card());
    expect(c.getByText("ขั้นแรกถูกรับแล้ว แก้ไม่ได้")).toBeInTheDocument();
    expect(c.getByRole("button", { name: "แก้แผน" })).toBeEnabled();
  });

  it("แผนกำหนดเอง: โชว์ 'กำหนดเอง: <เหตุผล>' แทนสูตร", () => {
    wrap(<JobDetailClient data={detail({ metal_plan_g: 150, metal_plan_basis: { ...BASIS, override_g: 150, override_reason: "ช่างประเมินจากรอบก่อน" } })} />);
    const c = within(card());
    expect(c.getByText(/กำหนดเอง: ช่างประเมินจากรอบก่อน/)).toBeInTheDocument();
    expect(c.queryByText(/คำนวณ:/)).not.toBeInTheDocument();
  });

  it("ใบที่ปิดแล้ว/ยกเลิก: ไม่มีปุ่มแก้ ไม่มีข้อความขั้นถูกรับ", () => {
    wrap(<JobDetailClient data={detail({ status: "cancelled" }, { status: "cancelled" })} />);
    const c = within(card());
    expect(c.queryByRole("button")).not.toBeInTheDocument();
  });

  it("OEM done + ของเหลือยังถือไว้: การ์ด + ป้าย + header 'เหลือ 3' · ตัดสิน → setJobSurplus(spare)", async () => {
    wrap(<JobDetailClient data={detail({ status: "done", qty_good: 33, qty_scrap: 2, surplus_disposition: "hold" }, { status: "done", surplus_pending: true, qty_surplus: 3 })} />);
    expect(screen.getByText(/ดี 33 เสีย 2 · เหลือ 3/)).toBeInTheDocument();
    expect(screen.getAllByText("เหลือ 3 ชิ้น ยังไม่ตัดสิน").length).toBeGreaterThan(0);
    expect(within(card()).getByText(/ของเหลือ 3 ชิ้น — ถือไว้ยังไม่ตัดสิน/)).toBeInTheDocument();
    await userEvent.click(within(card()).getByRole("button", { name: "ตัดสินของเหลือ" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getAllByRole("radio")).toHaveLength(3);
    await userEvent.click(within(dlg).getByLabelText("เก็บเป็นอะไหล่/ตัวอย่างของดีลนี้"));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(w.setJobSurplus).toHaveBeenCalledWith(JOB, "spare", null));
  });

  it("ใบผลิต done มีของเหลือ: ไม่มีปุ่มตัดสิน (เข้าสต็อกตอนปิดใบผลิต)", () => {
    wrap(<JobDetailClient data={detail({ source_kind: "production", oem_quote_item_id: null, status: "done", qty_good: 33, qty_scrap: 2, surplus_disposition: "stock" }, { source_kind: "production", status: "done", qty_surplus: 3 })} />);
    expect(within(card()).getByText(/ของเหลือ 3 ชิ้น — เข้าสต็อกแล้ว/)).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "ตัดสินของเหลือ" })).not.toBeInTheDocument();
  });
});

describe("0175 dialog แก้จำนวน/แผน", () => {
  it("แก้จำนวน: '1,5' ถูกปฏิเสธ · 40 ถูกส่ง (setJobQtyPlanned)", async () => {
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้จำนวน" }));
    const dlg = await screen.findByRole("dialog");
    const input = within(dlg).getByLabelText("เริ่มผลิต (ชิ้น)") as HTMLInputElement;
    expect(input.value).toBe("35");
    expect(within(dlg).getByRole("button", { name: "บันทึกจำนวน" })).toBeDisabled(); // ยังไม่เปลี่ยน
    await userEvent.clear(input);
    await userEvent.type(input, "1,5");
    expect(within(dlg).getByText("ใส่เป็นจำนวนเต็ม เช่น 35")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "บันทึกจำนวน" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "40");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกจำนวน" }));
    await waitFor(() => expect(w.setJobQtyPlanned).toHaveBeenCalledWith(JOB, 40, null));
  });

  it("ใบที่กำหนดโลหะเอง: แก้จำนวนไม่ได้ + บอกทางไป 'แก้แผน → ใช้ค่าระบบ'", async () => {
    wrap(<JobDetailClient data={detail({ metal_plan_g: 150, metal_plan_basis: { ...BASIS, override_g: 150, override_reason: "x" } })} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้จำนวน" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("alert")).toHaveTextContent("ใช้ค่าระบบ");
    expect(within(dlg).getByRole("button", { name: "บันทึกจำนวน" })).toBeDisabled();
  });

  it("DB ปฏิเสธ (started) = ข้อความไทยค้างในกล่อง ไม่ปิด", async () => {
    w.setJobQtyPlanned.mockResolvedValue({ ok: false, error: "ใบงานนี้เริ่มผลิตแล้ว แก้จำนวนเริ่มผลิตไม่ได้" });
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้จำนวน" }));
    const dlg = await screen.findByRole("dialog");
    const input = within(dlg).getByLabelText("เริ่มผลิต (ชิ้น)");
    await userEvent.clear(input);
    await userEvent.type(input, "40");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกจำนวน" }));
    expect(await within(dlg).findByText(/เริ่มผลิตแล้ว แก้จำนวน/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("แก้แผน: ใช้ PlanFields เดียวกับฟอร์มสร้าง · ถามตัวอย่างจาก DB · บันทึก → setJobPlan", async () => {
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้แผน" }));
    const dlg = await screen.findByRole("dialog");
    const target = within(dlg).getByLabelText(/น้ำหนักต่อชิ้น/) as HTMLInputElement;
    expect(target.value).toBe("4.000");
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalledWith("oem", ITEM, expect.objectContaining({ qtyPlanned: 35 })));
    await userEvent.clear(target);
    await userEvent.type(target, "4,5");
    await waitFor(() => expect(within(dlg).getByRole("button", { name: "บันทึกแผน" })).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกแผน" }));
    await waitFor(() => expect(w.setJobPlan).toHaveBeenCalledWith({ jobId: JOB, targetPieceG: "4,5", overrideG: null, overrideReason: null }));
  });

  it("ล้างน้ำหนัก = ล้างแผน (มีคำเตือน + ปุ่ม 'ล้างแผนโลหะ')", async () => {
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้แผน" }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.clear(within(dlg).getByLabelText(/น้ำหนักต่อชิ้น/));
    expect(await within(dlg).findByText("ช่องน้ำหนักว่าง = ล้างแผนโลหะของใบนี้")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ล้างแผนโลหะ" }));
    await waitFor(() => expect(w.setJobPlan).toHaveBeenCalledWith({ jobId: JOB, targetPieceG: null, overrideG: null, overrideReason: null }));
  });
});

describe("0175 DoneDialog — ของเหลือ", () => {
  const dlg = (p: Partial<{ planned: number; qtyOrder: number; sourceKind: string; metal: string }> = {}) =>
    wrap(<DoneDialog jobId={JOB} planned={p.planned ?? 35} qtyOrder={p.qtyOrder ?? 30} sourceKind={p.sourceKind ?? "oem"} metal={p.metal ?? "silver"} onClose={vi.fn()} />);
  const setQty = async (good: string, scrap: string) => {
    const g = screen.getByLabelText("จำนวนดี (ชิ้น)");
    const s = screen.getByLabelText("จำนวนเสีย (ชิ้น)");
    await userEvent.clear(g);
    await userEvent.type(g, good);
    await userEvent.clear(s);
    await userEvent.type(s, scrap);
  };

  it("ดี ≤ สั่ง: ไม่มีกล่องของเหลือ · ไม่ส่ง surplus_* (surplus_unexpected)", async () => {
    dlg();
    await setQty("30", "5");
    expect(screen.queryByText(/ของเหลือ/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    await waitFor(() => expect(w.doneJob).toHaveBeenCalled());
    const sent = w.doneJob.mock.calls[0][0];
    expect(sent).toEqual({ jobId: JOB, qtyGood: 30, qtyScrap: 5, weightFinal: null, note: null });
    expect(sent).not.toHaveProperty("surplusDisposition");
    expect(sent).not.toHaveProperty("surplusNote");
  });

  it("OEM ดี 33 > สั่ง 30: กล่อง role=status · ตัวเลือก 3 ข้อ (ถือไว้ค่าเริ่ม) · ไม่มีเข้าสต็อก · ส่ง hold", async () => {
    dlg();
    await setQty("33", "2");
    const box = screen.getByText(/ของเหลือ 3 ชิ้น \(ดี 33 − สั่ง 30\)/).closest("[role=status]") as HTMLElement;
    expect(box).toBeInTheDocument();
    const radios = within(box).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(box).getByLabelText(/ถือไว้ก่อน ตัดสินทีหลัง/)).toBeChecked();
    expect(box.textContent).not.toMatch(/สต็อก/);
    expect(within(box).getByText(/ยังไม่ตัดสินก็ปิดงานได้ — บอร์ดจะเตือน/)).toBeInTheDocument();
    await userEvent.type(within(box).getByLabelText(/หมายเหตุของเหลือ/), "ลูกค้าอาจสั่งเพิ่ม");
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    await waitFor(() => expect(w.doneJob).toHaveBeenCalledWith({ jobId: JOB, qtyGood: 33, qtyScrap: 2, weightFinal: null, note: null, surplusDisposition: "hold", surplusNote: "ลูกค้าอาจสั่งเพิ่ม" }));
  });

  it("OEM เลือก 'ส่งแถมลูกค้า' → ส่ง deliver", async () => {
    dlg();
    await setQty("33", "2");
    await userEvent.click(screen.getByLabelText("ส่งแถมลูกค้า"));
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    await waitFor(() => expect(w.doneJob.mock.calls[0][0]).toEqual(expect.objectContaining({ surplusDisposition: "deliver" })));
  });

  it("ใบผลิต ดี > สั่ง: ข้อความเข้าสต็อกทั้งหมด · ไม่มีตัวเลือก · ไม่ส่ง surplus_*", async () => {
    dlg({ sourceKind: "production" });
    await setQty("33", "2");
    expect(screen.getByText(/เข้าสต็อกทั้งหมดตอนปิดใบผลิต \(ผลิตได้ 33 มากกว่าที่สั่ง 30\)/)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    await waitFor(() => expect(w.doneJob).toHaveBeenCalled());
    expect(w.doneJob.mock.calls[0][0]).not.toHaveProperty("surplusDisposition");
  });

  it("ดี 28 < สั่ง 30: ข้อความฟ้า 'ขาด 2 ชิ้น' ไม่บล็อก · ห้ามเขียน 'ส่ง 30'", async () => {
    dlg();
    await setQty("28", "7");
    expect(screen.getByText("ดี 28 น้อยกว่าที่สั่ง 30 — ขาด 2 ชิ้น")).toHaveAttribute("role", "status");
    expect(document.body.textContent).not.toMatch(/ส่ง 30/);
    expect(screen.getByRole("button", { name: "ปิดงาน" })).toBeEnabled();
  });

  it("ดี + เสีย ไม่เท่าจำนวนเริ่มผลิต = ปิดไม่ได้ + ข้อความ", async () => {
    dlg();
    await setQty("30", "1");
    expect(screen.getByText(/ดี \+ เสีย ต้องเท่ากับจำนวนเริ่มผลิต \(35 ชิ้น\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดงาน" })).toBeDisabled();
  });

  it("แสดงหัว 'สั่ง 30 · เริ่มผลิต 35 ชิ้น' · เท่ากัน 'สั่ง 12 ชิ้น'", () => {
    dlg();
    expect(screen.getByText("สั่ง 30 · เริ่มผลิต 35 ชิ้น")).toBeInTheDocument();
    cleanup();
    dlg({ planned: 12, qtyOrder: 12 });
    expect(screen.getByText("สั่ง 12 ชิ้น")).toBeInTheDocument();
  });

  it("DB ปฏิเสธ = error ไทยค้างในกล่อง", async () => {
    w.doneJob.mockResolvedValue({ ok: false, error: "งาน OEM: ของเหลือเป็นของลูกค้า เข้าสต็อกอัตโนมัติไม่ได้" });
    dlg();
    await setQty("33", "2");
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ของเหลือเป็นของลูกค้า");
  });
});

describe("StatusChip", () => {
  it("ทุก StatusKey มีไอคอน (รวม surplusPending/underPlanned/buffer/goldUnguarded)", () => {
    const all: Record<StatusKey, true> = { overdue: true, dueSoon: true, mismatch: true, handoff: true, stale: true, deposit: true, hold: true, normal: true, auto: true, qty: true, surplusPending: true, underPlanned: true, buffer: true, goldUnguarded: true, pendingExplain: true, partial: true, goldWeight: true };
    for (const k of Object.keys(all) as StatusKey[]) expect(STATUS_ICON[k], k).toBeTruthy();
  });
});

describe("0175 ใบพิมพ์ A5", () => {
  const printable = (job: Record<string, unknown> = {}) => {
    const d = detail(job);
    return toPrintableJob(d.job, d.stages);
  };

  it("ใบเงิน: สั่ง/เริ่มผลิต · น้ำหนักเป้าหมาย · โลหะที่ต้องเตรียม · ช่องเขียนมือเบิกจริง · ไม่มีราคา/ledger", () => {
    render(<JobSheet job={printable()} qrSvg={null} />);
    const t = document.body.textContent ?? "";
    expect(t).toContain("สั่ง 30 · เริ่มผลิต 35 ชิ้น");
    expect(t).toContain("น้ำหนักเป้าหมาย/ชิ้น 4.000 g");
    expect(t).toContain("โลหะที่ต้องเตรียม 153.6 g");
    expect(t).toMatch(/เบิกจริง \.+ g/);
    expect(t).toMatch(/เนื้อเงิน \.+ %/); // 18 ต.ค. 69: ช่องเขียนมือเป็น % (เดิม "ความบริสุทธิ์ ....")
    expect(t).not.toMatch(/ความบริสุทธิ์/);
    expect(t).not.toMatch(/ราคา|ต้นทุน|บาท|฿|in_g|ledger|ดุล|ก้านต้น/);
  });

  it("คำหน้าช่อง % ตามโลหะของใบ (มติเจ้าของ 18 ต.ค. 69): เงิน=เนื้อเงิน · ทอง=เนื้อทอง · อื่น/ไม่รู้=เนื้อโลหะ", () => {
    const cases: [string, RegExp, string[]][] = [
      ["silver", /เนื้อเงิน \.+ %/, ["เนื้อทอง", "เนื้อโลหะ"]],
      ["gold", /เนื้อทอง \.+ %/, ["เนื้อเงิน", "เนื้อโลหะ"]],
      ["brass", /เนื้อโลหะ \.+ %/, ["เนื้อเงิน", "เนื้อทอง"]],
      ["platinum", /เนื้อโลหะ \.+ %/, ["เนื้อเงิน", "เนื้อทอง"]],
    ];
    for (const [metal, want, notWant] of cases) {
      cleanup();
      render(<JobSheet job={printable({ metal })} qrSvg={null} />);
      const t = document.body.textContent ?? "";
      expect(t, metal).toMatch(want);
      for (const w of notWant) expect(t, `${metal} ไม่ควรมี ${w}`).not.toContain(w);
      expect(t, metal).not.toMatch(/ความบริสุทธิ์/);
    }
  });

  it("purityWord: ไม่รู้จัก/ว่าง → เนื้อโลหะ · 'ทองเหลือง' ไม่ถูกจับเป็นทอง", () => {
    expect(purityWord("เงิน")).toBe("เนื้อเงิน");
    expect(purityWord("ทอง")).toBe("เนื้อทอง");
    expect(purityWord("ทองเหลือง")).toBe("เนื้อโลหะ");
    expect(purityWord("platinum")).toBe("เนื้อโลหะ");
    expect(purityWord("")).toBe("เนื้อโลหะ");
  });

  it("ใบทอง: ไม่มีแผนโลหะ/น้ำหนักเป้าหมาย/น้ำหนักตั้งต้น (ตัดที่ toPrintableJob) · ไม่มี in_g", () => {
    render(<JobSheet job={printable({ metal: "gold", weight_start_g: 12.5 })} qrSvg={null} />);
    const t = document.body.textContent ?? "";
    expect(t).not.toContain("โลหะที่ต้องเตรียม");
    expect(t).not.toContain("น้ำหนักเป้าหมาย");
    expect(t).not.toContain("153.6");
    expect(t).not.toContain("12.5");
    expect(t).not.toMatch(/in_g|metal_plan/);
  });

  it("เงินมีน้ำหนักแต่ยังไม่มีแผน: 'โลหะที่ต้องเตรียม —' · ใบเดิมไม่มีน้ำหนัก: ไม่มีบรรทัดแผนเลย · เท่ากัน = 'n ชิ้น'", () => {
    render(<JobSheet job={printable({ metal_plan_g: null, metal_plan_basis: null })} qrSvg={null} />);
    expect(document.body.textContent).toContain("โลหะที่ต้องเตรียม —");
    cleanup();
    render(<JobSheet job={printable({ qty_planned: 12, qty_order: 12, target_piece_g: null, metal_plan_g: null, metal_plan_basis: null })} qrSvg={null} />);
    const t = document.body.textContent ?? "";
    expect(t).not.toContain("โลหะที่ต้องเตรียม");
    expect(t).toContain("12 ชิ้น");
    expect(t).not.toContain("สั่ง 12");
  });

  it("ใบพิมพ์ไม่มีอัตราก้านต้น/reject % (ฟอร์มออฟฟิศเท่านั้น)", () => {
    render(<JobSheet job={printable()} qrSvg={null} />);
    expect(document.body.textContent).not.toMatch(/9%|เสีย \d|reject|หล่อเสีย/);
  });
});

describe("0175 review — กล่องแก้แผน/แก้จำนวน (BUG-2/3/4 · N6) + ป้ายใบปิด (S3)", () => {
  const openPlan = async (job: Record<string, unknown> = {}) => {
    wrap(<JobDetailClient data={detail(job)} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้แผน" }));
    return await screen.findByRole("dialog");
  };
  const targetOf = (dlg: HTMLElement) => within(dlg).getByLabelText(/น้ำหนักต่อชิ้น/) as HTMLInputElement;

  it("BUG-2 ที่มาในกล่องแก้แผน = ที่มาเดียวกับการ์ด (ใบเสนอราคา/แคตตาล็อก SKU) · ไม่ใช่ 'กรอกเอง' ตอนยังไม่ได้แก้", async () => {
    for (const [src, label] of [["quote", "ใบเสนอราคา"], ["product", "แคตตาล็อก SKU"]] as const) {
      const dlg = await openPlan({ metal_plan_basis: { ...BASIS, target_source: src } });
      expect(within(card()).getByText(new RegExp(`ที่มา: ${label}`))).toBeInTheDocument();
      // preview ตอบ "input" เสมอ (ถามด้วยน้ำหนักที่ส่งไป) — กล่องต้องไม่เอาไปขึ้น
      await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalled());
      expect(within(dlg).getByText(new RegExp(`ที่มา: ${label}`))).toBeInTheDocument();
      expect(within(dlg).queryByText(/ที่มา: กรอกเอง/)).not.toBeInTheDocument();
      cleanup();
      vi.clearAllMocks();
      getJobPlanSuggest.mockResolvedValue({ ok: true, data: { qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 35, underPlanned: false, rejectBasis: { castPct: 6, polishPct: 3, platePct: null, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "input", metal: "silver", metalPlanG: 153.6, metalPlanBasis: BASIS, missing: [] } });
    }
  });

  it("BUG-2 แก้น้ำหนักเป็นค่าอื่น = ขึ้น 'กรอกเอง' · พิมพ์เท่าเดิมเชิงตัวเลข ('4') = ยังเป็นที่มาเดิม + ปุ่มบันทึกยังปิด (ไม่มีอะไรเปลี่ยน)", async () => {
    const dlg = await openPlan();
    await userEvent.clear(targetOf(dlg));
    await userEvent.type(targetOf(dlg), "4");
    expect(within(dlg).getByText(/ที่มา: ใบเสนอราคา/)).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "บันทึกแผน" })).toBeDisabled();
    await userEvent.clear(targetOf(dlg));
    await userEvent.type(targetOf(dlg), "4.5");
    expect(within(dlg).getByText(/ที่มา: กรอกเอง/)).toBeInTheDocument();
  });

  it("BUG-3 พิมพ์ผิดรูปแบบ ('abc' / '1,234.5') = error ของช่อง · ไม่ขึ้นข้อความ/ปุ่ม 'ล้างแผนโลหะ' · ปุ่มบันทึกปิด", async () => {
    const dlg = await openPlan();
    for (const bad of ["abc", "1,234.5", "-1"]) {
      await userEvent.clear(targetOf(dlg));
      await userEvent.type(targetOf(dlg), bad);
      expect(await within(dlg).findByText(/ต้องเป็นตัวเลข|กำกวม|ต้องมากกว่า 0/)).toHaveAttribute("role", "alert");
      expect(within(dlg).queryByText("ช่องน้ำหนักว่าง = ล้างแผนโลหะของใบนี้")).not.toBeInTheDocument();
      expect(within(dlg).queryByRole("button", { name: "ล้างแผนโลหะ" })).not.toBeInTheDocument();
      expect(within(dlg).getByRole("button", { name: "บันทึกแผน" })).toBeDisabled();
    }
    expect(w.setJobPlan).not.toHaveBeenCalled();
  });

  it("BUG-3 ช่องว่างจริง (เว้นวรรคล้วนก็นับ) = 'ล้างแผนโลหะ' ตามเดิม", async () => {
    const dlg = await openPlan();
    await userEvent.clear(targetOf(dlg));
    await userEvent.type(targetOf(dlg), "  ");
    expect(await within(dlg).findByText("ช่องน้ำหนักว่าง = ล้างแผนโลหะของใบนี้")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "ล้างแผนโลหะ" })).toBeEnabled();
  });

  it.each(["10001", "100000"])("BUG-4 กล่องแก้แผน: น้ำหนักเป้าหมาย %s = error เพดาน 10,000 · บันทึกไม่ได้", async (v) => {
    const dlg = await openPlan();
    await userEvent.clear(targetOf(dlg));
    await userEvent.type(targetOf(dlg), v);
    expect(await within(dlg).findByText("น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 และไม่เกิน 10,000 กรัม")).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "บันทึกแผน" })).toBeDisabled();
  });

  it("N6 กล่องแก้จำนวน: hint 'ระบบคำนวณโลหะใหม่ให้' ขึ้นเฉพาะใบที่มีน้ำหนักเป้าหมาย", async () => {
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้จำนวน" }));
    expect(within(await screen.findByRole("dialog")).getByText(/ระบบคำนวณโลหะที่ต้องเตรียมใหม่ให้/)).toBeInTheDocument();
    cleanup();
    wrap(<JobDetailClient data={detail({ target_piece_g: null, metal_plan_g: null, metal_plan_basis: null })} />);
    await userEvent.click(within(card()).getByRole("button", { name: "แก้จำนวน" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByText(/ระบบคำนวณโลหะที่ต้องเตรียมใหม่ให้/)).not.toBeInTheDocument();
    // และหัวกล่องใช้ข้อความรวม (N1)
    expect(within(dlg).getByText("สั่ง 30 · เริ่มผลิต 35 ชิ้น")).toBeInTheDocument();
  });

  it.each(["done", "cancelled"])("S3 ใบ %s ที่มีกำหนดส่งใกล้ๆ + ดีลไม่มีมัดจำ: ไม่ขึ้น 'ครบใน n วัน' / 'ยังไม่มีมัดจำ' บนหัวหน้า", (status) => {
    wrap(<JobDetailClient data={detail({ status, due_date: "2026-10-17" }, { status, due_date: "2026-10-17", deposit_missing: true })} />);
    expect(screen.queryByText(/ครบใน \d+ วัน|ครบวันนี้/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีมัดจำ/, { selector: "li *, li" })).not.toBeInTheDocument();
  });

  it("S3 ใบที่ยังเดินอยู่ (open) กำหนดส่งใกล้ๆ: ยังขึ้น 'ครบใน 2 วัน' (ต้องไม่พัง)", () => {
    wrap(<JobDetailClient data={detail({ status: "open", due_date: "2026-10-17" }, { status: "open", due_date: "2026-10-17" })} />);
    expect(screen.getByText("ครบใน 2 วัน")).toBeInTheDocument();
  });
});
