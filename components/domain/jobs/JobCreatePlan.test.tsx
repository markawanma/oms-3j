// @vitest-environment jsdom
// 0175 ฟอร์มสร้างใบงาน: จำนวนสั่ง/เริ่มผลิต · แนะนำเผื่อเสีย · แผนโลหะ (PlanFields) · debounce · จำนวนเต็มเข้ม · comma น้ำหนัก
// ตัวเลขแนะนำ/โลหะทุกตัวมาจาก mock ของ getJobPlanSuggest (DB) — หน้าจอต้องไม่คำนวณเอง
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const suggestJob = vi.fn();
const createJob = vi.fn();
const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
  getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a),
}));
vi.mock("@/lib/actions/job-office-write", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "./JobCreateDialog";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";

const suggestion = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: { metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }, { code: "plating", nameTh: "ชุบ", defaultSelected: false }], targetPieceG: 4, targetPieceGSource: "quote", ...o },
});

const plan = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 35, underPlanned: false,
    rejectBasis: { castPct: 6, polishPct: 3, platePct: 2, hasPlating: true },
    targetPieceG: 4, targetPieceGSource: "quote", metal: "silver", metalPlanG: 153.6,
    metalPlanBasis: { target_piece_g: 4, qty_planned: 35, sprue_loss_pct: 9, computed_g: 153.6, override_g: null, missing: [] },
    missing: [], ...o,
  },
});

async function open(kind: "oem" | "production" = "oem") {
  wrap(<JobCreateDialog kind={kind} itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByLabelText(/เริ่มผลิต/);
}
const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
const qtyInput = () => screen.getByLabelText(/เริ่มผลิต/) as HTMLInputElement;
const targetInput = () => screen.getByLabelText(/น้ำหนักต่อชิ้น/) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(plan());
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
});

describe("0175 ฟอร์มสร้างใบงาน — จำนวนและแนะนำเผื่อเสีย", () => {
  it("จำนวนที่สั่งเป็นข้อความ (อ่านอย่างเดียว) · เริ่มผลิตตามที่ DB แนะนำ · กล่องแนะนำแสดงตัวเลขจาก DB", async () => {
    await open();
    expect(screen.getByTestId("qty-order")).toHaveTextContent("30 ชิ้น");
    expect(screen.getByText("จำนวนที่สั่ง")).toBeInTheDocument();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    expect(screen.getByText(/แนะนำ 35 ชิ้น \(เผื่อ 5\): หล่อเสีย 6% · ขัด 3% · ชุบ 2%/)).toBeInTheDocument();
    // ค่า = ที่แนะนำ → ไม่มีปุ่ม "ใช้ค่าแนะนำ"
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "oem", itemId: ITEM, qtyPlanned: 35 }));
    // น้ำหนักไม่ถูกแก้ = ไม่ส่ง (DB ใช้ค่าจากต้นทาง ที่มายังเป็น "ใบเสนอราคา")
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("targetPieceG");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/J9"));
  });

  it("ใบผลิต: ป้ายเป็น 'จำนวนที่ต้องการเข้าสต็อก'", async () => {
    await open("production");
    expect(screen.getByText("จำนวนที่ต้องการเข้าสต็อก")).toBeInTheDocument();
  });

  it("แก้เป็น 28 (น้อยกว่าที่สั่ง) = เตือนผลิตบางส่วน role=status ไม่บล็อก · มีปุ่มใช้ค่าแนะนำ · ส่ง qtyPlanned 28", async () => {
    await open();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedEff: 28, underPlanned: true }));
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), "28");
    expect(await screen.findByText(/ผลิตบางส่วน — เริ่ม 28 น้อยกว่าที่สั่ง 30 \(ขาด 2 ชิ้น\)/)).toHaveAttribute("role", "status");
    expect(await screen.findByRole("button", { name: "ใช้ค่าแนะนำ" })).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 28 }));
  });

  it("'ใช้ค่าแนะนำ' ตั้งช่องกลับเป็น 35", async () => {
    await open();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), "40");
    await userEvent.click(await screen.findByRole("button", { name: "ใช้ค่าแนะนำ" }));
    expect(qtyInput().value).toBe("35");
  });

  it.each([["1,5"], ["3.5"], ["abc"], ["0"], ["100001"], [""]])("จำนวนเริ่มผลิต %j = error · ปุ่มสร้างปิด · ไม่ถามแผนซ้ำด้วยค่าเพี้ยน", async (bad) => {
    await open();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await userEvent.clear(qtyInput());
    if (bad) await userEvent.type(qtyInput(), bad);
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(qtyInput()).toHaveAttribute("aria-invalid", "true");
    expect(submitBtn()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 600));
    // ไม่มีการยิงด้วยค่า "15" ที่ถูกกรองทิ้งเงียบ
    for (const c of getJobPlanSuggest.mock.calls.slice(before)) expect(c[2]?.qtyPlanned).not.toBe(15);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("'1,5' ข้อความ error บอกให้ใส่จำนวนเต็ม", async () => {
    await open();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), "1,5");
    expect(await screen.findByText("ใส่เป็นจำนวนเต็ม เช่น 35")).toBeInTheDocument();
  });

  it("debounce: พิมพ์ 3 ตัวติดกันยิงถาม DB แค่ครั้งเดียว (ไม่ใช่ทุกตัวอักษร)", async () => {
    await open();
    await waitFor(() => expect(qtyInput().value).toBe("35"));
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), "123");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.length).toBe(before + 1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(getJobPlanSuggest.mock.calls.length).toBe(before + 1);
    expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 123 }));
  });

  it("ยังไม่มีอัตราเสียของ: เริ่มผลิต = จำนวนสั่ง + คำเตือน amber มีลิงก์ /oem/rates · ไม่โชว์ 0", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 30, rejectBasis: { castPct: null, polishPct: 3, platePct: null, hasPlating: false } }));
    await open();
    expect(await screen.findByText(/ยังไม่มีอัตราเสียของ \[หล่อ\] จึงไม่แนะนำเผื่อ/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "จัดการต้นทุน" })).toHaveAttribute("href", "/oem/rates");
    expect(qtyInput().value).toBe("30");
    expect(screen.queryByText(/แนะนำ \d+ ชิ้น/)).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    // เท่ากับจำนวนสั่ง = ไม่ส่ง qtyPlanned (ค่าเริ่มของ DB)
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });
});

describe("0175 ฟอร์มสร้างใบงาน — แผนโลหะ", () => {
  it("แสดงโลหะที่ต้องเตรียม + สูตรจาก basis ของ DB · ที่มาน้ำหนัก", async () => {
    await open();
    expect(await screen.findByText(/153\.600/)).toBeInTheDocument();
    expect(screen.getByText(/35 ชิ้น × 4\.000 g × \(1 \+ ก้านต้น 9%\)/)).toBeInTheDocument();
    expect(targetInput().value).toBe("4.000");
    expect(screen.getByText(/ที่มา: ใบเสนอราคา/)).toBeInTheDocument();
  });

  it("SKU ไม่มีน้ำหนัก: สร้างได้ · ไม่มีการ์ดโลหะ · hint ข้ามได้ · ไม่ส่งน้ำหนัก/แผน", async () => {
    suggestJob.mockResolvedValue(suggestion({ targetPieceG: null, targetPieceGSource: null }));
    getJobPlanSuggest.mockResolvedValue(plan({ targetPieceG: null, targetPieceGSource: null, metalPlanG: null, metalPlanBasis: null }));
    await open();
    expect(await screen.findByText("ไม่ใส่ = ไม่วางแผนโลหะ (ข้ามได้)")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "โลหะที่ต้องเตรียม" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "กำหนดเอง" })).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    const sent = createJob.mock.calls[0][0];
    expect(sent).not.toHaveProperty("targetPieceG");
    expect(sent).not.toHaveProperty("metalPlanOverrideG");
  });

  it("น้ำหนัก '95,5' (จุลภาคทศนิยม) = ใช้ได้ ไม่ error · ส่งต่อให้ server parse เป็น 95.5", async () => {
    await open();
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), "95,5");
    expect(screen.queryByText(/กำกวม/)).not.toBeInTheDocument();
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ targetPieceG: "95,5" })), { timeout: 3000 });
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ targetPieceG: "95,5" }));
  });

  it("น้ำหนัก '1,234.5' = ปฏิเสธ (กำกวม) · ปุ่มสร้างปิด", async () => {
    await open();
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), "1,234.5");
    expect(await screen.findByText(/กำกวม/)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it("ระหว่างรอ DB คำนวณ: การ์ด skeleton aria-busy + ปุ่มสร้างปิด · เสร็จแล้วเปิด", async () => {
    let release: (v: unknown) => void = () => undefined;
    getJobPlanSuggest.mockReturnValue(new Promise((r) => { release = r; }));
    await open();
    const card = await screen.findByRole("region", { name: "โลหะที่ต้องเตรียม" });
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(submitBtn()).toBeDisabled();
    release(plan());
    await waitFor(() => expect(screen.getByRole("region", { name: "โลหะที่ต้องเตรียม" })).toHaveAttribute("aria-busy", "false"));
    expect(submitBtn()).toBeEnabled();
  });

  it("ถาม DB ล้ม: error + ลองใหม่ + 'ระบบจะคำนวณโลหะตอนบันทึก' · ปุ่มสร้างยังกดได้", async () => {
    getJobPlanSuggest.mockResolvedValueOnce({ ok: false, error: "คำนวณแผนไม่สำเร็จ" }).mockResolvedValue(plan());
    await open();
    expect(await screen.findByText("คำนวณแผนไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("ระบบจะคำนวณโลหะตอนบันทึก")).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText(/153\.600/)).toBeInTheDocument();
  });

  it("ไม่มีอัตราก้านต้น: การ์ด '—' + ข้อความ + 'กำหนดเอง' ต้องมีเหตุผลก่อนสร้าง · ส่ง override + เหตุผล", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ metalPlanG: null, metalPlanBasis: { target_piece_g: 4, qty_planned: 35, sprue_loss_pct: null, computed_g: null, override_g: null, missing: ["sprue_loss_pct[silver]"] }, missing: ["sprue_loss_pct[silver]"] }));
    await open();
    expect(await screen.findByText(/ยังไม่มีอัตราก้านต้น \(เงิน\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("ยังคำนวณไม่ได้")).toHaveTextContent("—");
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    await userEvent.type(screen.getByLabelText(/โลหะที่ต้องเตรียม \(กำหนดเอง\)/), "150");
    expect(submitBtn()).toBeDisabled(); // มี g ไม่มีเหตุผล
    await userEvent.type(screen.getByLabelText(/เหตุผลที่กำหนดเอง/), "ช่างประเมินจากรอบก่อน");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ metalPlanOverrideG: "150", metalPlanReason: "ช่างประเมินจากรอบก่อน" }));
  });

  it("'ใช้ค่าระบบ' ล้างช่องกำหนดเองและไม่ส่ง override", async () => {
    await open();
    await screen.findByText(/153\.600/);
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    await userEvent.type(screen.getByLabelText(/โลหะที่ต้องเตรียม \(กำหนดเอง\)/), "150");
    expect(screen.getByText(/ระบบคำนวณได้ 153\.600 g/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ใช้ค่าระบบ" }));
    expect(screen.queryByLabelText(/เหตุผลที่กำหนดเอง/)).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("metalPlanOverrideG");
  });

  it("สร้างสำเร็จแต่ยังไม่มีแผนโลหะ (plan_missing) = toast ต่อท้าย 'ยังไม่มีแผนโลหะ'", async () => {
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: ["sprue_loss_pct[silver]"] } });
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(await screen.findByText("สร้างใบงาน JB-0009 แล้ว · ยังไม่มีแผนโลหะ")).toBeInTheDocument();
  });

  it("DB ปฏิเสธ (plan_drift ฯลฯ) = ข้อความไทยค้างใต้ปุ่ม ค่าที่กรอกยังอยู่", async () => {
    createJob.mockResolvedValue({ ok: false, error: "แผนโลหะไม่ตรงกับจำนวน/น้ำหนักเป้าหมาย — รีเฟรชแล้วลองใหม่" });
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("แผนโลหะไม่ตรงกับจำนวน");
    expect(qtyInput().value).toBe("35");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("0175 ฟอร์มสร้างใบงาน — review S1/S2/BUG-4", () => {
  it("S1 ไม่มีน้ำหนักเป้าหมาย + preview ล้ม: ขึ้น role=alert 'คำนวณจำนวนแนะนำไม่ได้' + ลองใหม่ (ไม่เงียบ) · ลองใหม่สำเร็จ = กล่องแนะนำกลับมา", async () => {
    suggestJob.mockResolvedValue(suggestion({ targetPieceG: null, targetPieceGSource: null }));
    getJobPlanSuggest.mockResolvedValueOnce({ ok: false, error: "คำนวณแผนไม่สำเร็จ" }).mockResolvedValue(plan({ targetPieceG: null, targetPieceGSource: null, metalPlanG: null, metalPlanBasis: null }));
    await open();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("คำนวณจำนวนแนะนำไม่ได้ — คำนวณแผนไม่สำเร็จ");
    // ไม่มีการ์ดโลหะ (ไม่มีน้ำหนัก) → ปุ่มลองใหม่ต้องอยู่ที่ช่องจำนวน
    expect(screen.queryByRole("region", { name: "โลหะที่ต้องเตรียม" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText(/แนะนำ 35 ชิ้น \(เผื่อ 5\)/)).toBeInTheDocument();
    expect(screen.queryByText(/คำนวณจำนวนแนะนำไม่ได้/)).not.toBeInTheDocument();
  });

  it("S1 มีน้ำหนัก + preview ล้ม: ปุ่มลองใหม่มีตัวเดียว (อยู่ที่การ์ดโลหะ) ไม่ซ้ำสองปุ่ม", async () => {
    getJobPlanSuggest.mockResolvedValueOnce({ ok: false, error: "คำนวณแผนไม่สำเร็จ" }).mockResolvedValue(plan());
    await open();
    expect(await screen.findByText(/คำนวณจำนวนแนะนำไม่ได้ — คำนวณแผนไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ลองใหม่" })).toHaveLength(1);
  });

  it("S2 พิมพ์ '4' เท่าค่าต้นทาง 4.000 = ไม่นับว่าแก้: ไม่ส่ง targetPieceG · ไม่ถาม preview ด้วยน้ำหนัก · ที่มายังเป็นใบเสนอราคา", async () => {
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), "4");
    expect(await screen.findByText(/ที่มา: ใบเสนอราคา/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    for (const c of getJobPlanSuggest.mock.calls.slice(before)) expect(c[2]?.targetPieceG).toBeNull();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("targetPieceG");
  });

  it("S2 พิมพ์ '4,0' / '4.0' ก็เท่ากัน · '4.5' = แก้จริง → ส่ง targetPieceG และที่มา 'กรอกเอง'", async () => {
    await open();
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), "4,0");
    expect(await screen.findByText(/ที่มา: ใบเสนอราคา/)).toBeInTheDocument();
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), "4.5");
    expect(await screen.findByText(/ที่มา: กรอกเอง/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ targetPieceG: "4.5" }));
  });

  it.each([["10000", true], ["10000.001", false], ["10001", false], ["100000", false]])("BUG-4 น้ำหนักเป้าหมาย %s กรัม: ผ่านหน้าจอ=%s (เพดานตาม DB 10,000)", async (v, okExpected) => {
    await open();
    await userEvent.clear(targetInput());
    await userEvent.type(targetInput(), v);
    if (okExpected) {
      await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
      expect(screen.queryByText(/ไม่เกิน 10,000 กรัม/)).not.toBeInTheDocument();
    } else {
      expect(await screen.findByText("น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 และไม่เกิน 10,000 กรัม")).toHaveAttribute("role", "alert");
      expect(submitBtn()).toBeDisabled();
      expect(targetInput()).toHaveAttribute("aria-invalid", "true");
      expect(createJob).not.toHaveBeenCalled();
    }
  });

  it("BUG-4 ช่อง 'กำหนดเอง' (โลหะที่ต้องเตรียม) ยังรับถึง 100,000 g (DB: metal_plan_g ≤ 100000)", async () => {
    await open();
    await screen.findByText(/153\.600/);
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    await userEvent.type(screen.getByLabelText(/โลหะที่ต้องเตรียม \(กำหนดเอง\)/), "50000");
    await userEvent.type(screen.getByLabelText(/เหตุผลที่กำหนดเอง/), "ล็อตใหญ่");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });
});

describe("0175 ฟอร์มสร้างใบงาน — S4 คำตอบเก่าที่มาช้า", () => {
  it("แก้จำนวนระหว่างรอคำตอบแรก: คำตอบแรกกลับมาก่อนคำตอบสอง = ถูกทิ้ง · ปุ่มสร้างยังปิด · จอใช้ค่าคำตอบสอง", async () => {
    const waits: Array<(v: unknown) => void> = [];
    getJobPlanSuggest.mockImplementation(() => new Promise((r) => { waits.push(r); }));
    await open();
    await waitFor(() => expect(waits).toHaveLength(1));
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), "28");
    await waitFor(() => expect(waits).toHaveLength(2), { timeout: 3000 });

    waits[0](plan({ metalPlanG: 153.6 })); // คำตอบเก่า (ก่อนแก้จำนวน)
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("region", { name: "โลหะที่ต้องเตรียม" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/153\.600/)).not.toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();

    waits[1](plan({ qtyPlannedEff: 28, metalPlanG: 120 }));
    expect(await screen.findByText(/120\.000/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(qtyInput().value).toBe("28");
  });
});
