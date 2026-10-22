// @vitest-environment jsdom
// 0175 ฟอร์มสร้างใบงาน: จำนวนสั่ง · สวิตช์เผื่อของเสีย (ค่าเริ่มปิด · มติ 18 ต.ค. 69) · คำแนะนำไม่เติมเอง · แผนโลหะ (PlanFields) · debounce · จำนวนเต็มเข้ม · comma น้ำหนัก
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
vi.mock("@/lib/actions/gems", () => ({ getGemOptions: () => Promise.resolve({ ok: true, data: { types: [], shapes: [], items: [] } }) })); // G1a: ฟอร์มสร้างใบงานโหลดรายการพลอย (ไม่มีราคา)

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "./JobCreateDialog";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";

const PF = [{ id: "99999999-0000-4000-8000-000000000001", name: "แบบ 1", note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, stages: [], jobsOpen: 0 }];
const suggestion = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }, { code: "plating", nameTh: "ชุบ", defaultSelected: false }], targetPieceG: 4, targetPieceGSource: "quote", ...o },
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
  await screen.findByTestId("qty-order");
}
const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
const bufferSwitch = () => screen.getByRole("switch", { name: /เผื่อของเสีย/ });
const bufferInput = () => screen.getByLabelText("เผื่อเพิ่ม (ชิ้น)") as HTMLInputElement;
const targetInput = () => screen.getByLabelText(/น้ำหนักต่อชิ้น/) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(plan());
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
});

describe("เผื่อของเสียไม่บังคับ ค่าเริ่มปิด (มติเจ้าของ 18 ต.ค. 69) — ฟอร์มสร้างใบงาน", () => {
  it("เปิดกล่อง = สวิตช์ปิด · ไม่มีช่องเริ่มผลิต · สรุป 'เริ่มผลิตเท่าที่ต้องการ (30 ชิ้น)' · จำนวนสั่งอ่านอย่างเดียว", async () => {
    await open();
    expect(screen.getByTestId("qty-order")).toHaveTextContent("30 ชิ้น");
    expect(screen.getByText("จำนวนที่สั่ง")).toBeInTheDocument();
    expect(bufferSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText(/เริ่มผลิต/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("เผื่อเพิ่ม (ชิ้น)")).not.toBeInTheDocument();
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("ปิดอยู่ = เริ่มผลิตเท่าที่ต้องการ (30 ชิ้น)");
    expect(screen.getByTestId("qty-start-summary")).toHaveAttribute("aria-live", "polite");
  });

  it("ใบผลิต: ป้ายเป็น 'จำนวนที่ต้องการเข้าสต็อก' · สวิตช์เดียวกัน", async () => {
    await open("production");
    expect(screen.getByText("จำนวนที่ต้องการเข้าสต็อก")).toBeInTheDocument();
    expect(bufferSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("สวิตช์ปิด + DB แนะนำ 35: ไม่มีกล่องแนะนำ · ไม่เติมเอง · preview ถามด้วย qtyPlanned = 30 (ไม่ใช่ null) · สร้างใบ = ไม่ส่ง qtyPlanned (DB ใช้ค่าเริ่ม = จำนวนสั่ง)", async () => {
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByText(/แนะนำ/)).not.toBeInTheDocument();
    for (const c of getJobPlanSuggest.mock.calls) expect(c[2]?.qtyPlanned).toBe(30);
    expect(getJobPlanSuggest).toHaveBeenCalled();
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "oem", itemId: ITEM }));
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
    // น้ำหนักไม่ถูกแก้ = ไม่ส่ง (DB ใช้ค่าจากต้นทาง ที่มายังเป็น "ใบเสนอราคา")
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("targetPieceG");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/J9#job-photos"));
  });

  it("สวิตช์ปิด: rate ครบหรือไม่ครบ → ได้ผลเท่ากัน = ไม่ส่ง qtyPlanned (เท่าจำนวนสั่ง) · ไม่มีกล่องเหลือง/ฟ้าของจำนวน", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 30, rejectBasis: { castPct: null, polishPct: 3, platePct: null, hasPlating: false } }));
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByText(/ยังไม่มีอัตราเสียของ/)).not.toBeInTheDocument();
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("เปิดสวิตช์: เผื่อเริ่ม 0 · เริ่มผลิต 30 · กล่องฟ้าแสดงคำแนะนำจาก DB แต่ 'ไม่เติมให้เอง' (ไม่กดใช้ = ส่งเท่าสั่ง)", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    expect(bufferSwitch()).toHaveAttribute("aria-checked", "true");
    expect(bufferInput().value).toBe("0");
    expect(await screen.findByText(/ระบบแนะนำเผื่อ \+5 \(เริ่มผลิต 35 ชิ้น\): หล่อเสีย 6% · ขัด 3% · ชุบ 2%/)).toBeInTheDocument();
    // รอให้ preview ตอบจบแล้วค่ายังเป็น 0 (ไม่ถูกทับ)
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await new Promise((r) => setTimeout(r, 600));
    expect(bufferInput().value).toBe("0");
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("เริ่มผลิต 30 ชิ้น");
    expect(screen.queryByText("เผื่อ +5", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ใช้ค่าแนะนำ" })).toBeInTheDocument();
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("'ใช้ค่าแนะนำ' ตั้งเผื่อ = แนะนำ − สั่ง (5) · ปุ่มหาย · ป้าย 'เผื่อ +5' · เริ่มผลิต 35 · ส่ง qtyPlanned 35", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await userEvent.click(await screen.findByRole("button", { name: "ใช้ค่าแนะนำ" }));
    expect(bufferInput().value).toBe("5");
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("เริ่มผลิต 35 ชิ้น");
    expect(screen.getByText("เผื่อ +5")).toBeInTheDocument();
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 35 })), { timeout: 3000 });
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 35 }));
  });

  it("เปิด + เผื่อ 5 (พิมพ์เอง): เริ่มผลิต 35 = สั่ง + 5 · preview ถามด้วย 35 (โลหะคิดจาก DB) · ส่ง qtyPlanned 35", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "5");
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("เริ่มผลิต 35 ชิ้น");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 35 })), { timeout: 3000 });
    expect(await screen.findByText(/35 ชิ้น × 4\.000 g/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 35 }));
  });

  it("เปิด + เผื่อ 0: ผ่าน = เริ่มผลิตเท่าสั่ง ไม่ส่ง qtyPlanned", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("ตัวเพิ่ม/ลด: + → 1, 2 · − → 1 · ที่ 0 ปุ่ม − ปิด (ไม่ติดลบ) · ช่องผิดรูปแบบ − เริ่มจาก 0", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    const minus = () => screen.getByRole("button", { name: "ลดจำนวนเผื่อ" });
    const plus = () => screen.getByRole("button", { name: "เพิ่มจำนวนเผื่อ" });
    expect(minus()).toBeDisabled();
    await userEvent.click(plus());
    await userEvent.click(plus());
    expect(bufferInput().value).toBe("2");
    await userEvent.click(minus());
    expect(bufferInput().value).toBe("1");
    await userEvent.click(minus());
    expect(bufferInput().value).toBe("0");
    expect(minus()).toBeDisabled();
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "1,5");
    await userEvent.click(plus());
    expect(bufferInput().value).toBe("1"); // ค่าผิดรูปแบบนับเป็น 0 แล้วบวก 1 — ไม่ตัดเป็น 15
  });

  it("ปิดสวิตช์หลังใส่เผื่อ → กลับเป็นเท่าสั่งทันที · เปิดใหม่ = 0 · preview ถามด้วย 30 · ไม่ส่ง qtyPlanned", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "5");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 35 })), { timeout: 3000 });
    await userEvent.click(bufferSwitch());
    expect(bufferSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("ปิดอยู่ = เริ่มผลิตเท่าที่ต้องการ (30 ชิ้น)");
    expect(screen.queryByLabelText("เผื่อเพิ่ม (ชิ้น)")).not.toBeInTheDocument();
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 30 })), { timeout: 3000 });
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
    // เปิดอีกรอบ = เริ่มที่ 0 (ไม่จำ 5)
    await userEvent.click(bufferSwitch());
    expect(bufferInput().value).toBe("0");
  });

  it("จำนวนสั่งเปลี่ยน (เปิดรายการอื่น qty 50) ขณะสวิตช์ปิด → เริ่มผลิตตาม 50 · preview ถาม 50 · และเผื่อที่เปิดค้างของรายการก่อนถูกรีเซ็ตเป็นปิด", async () => {
    suggestJob.mockImplementation(async (_k: string, id: string) => (id === ITEM ? suggestion() : suggestion({ qty: 50 })));
    const ITEM2 = "22222222-2222-4222-8222-222222222222";
    const ui = (id: string) => (
      <ToastProvider>
        <JobCreateDialog kind="oem" itemId={id} itemLabel="แหวน" onClose={vi.fn()} onCreated={vi.fn()} />
      </ToastProvider>
    );
    const { rerender } = render(ui(ITEM));
    await screen.findByTestId("qty-order");
    await userEvent.click(bufferSwitch());
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "5");
    rerender(ui(ITEM2));
    await waitFor(() => expect(screen.getByTestId("qty-order")).toHaveTextContent("50 ชิ้น"));
    expect(bufferSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("(50 ชิ้น)");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 50 })), { timeout: 3000 });
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ itemId: ITEM2 }));
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it.each([["-1"], ["-0"], ["1,5"], ["3.5"], ["abc"], [""], ["  "], ["5 ชิ้น"], ["99971"]])("ขณะเปิด เผื่อ %j = ปฏิเสธ · alert + aria-invalid · ปุ่มสร้างปิด · ไม่ถามแผนซ้ำด้วยค่าเพี้ยน", async (bad) => {
    await open();
    await userEvent.click(bufferSwitch());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await userEvent.clear(bufferInput());
    if (bad) await userEvent.type(bufferInput(), bad);
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(bufferInput()).toHaveAttribute("aria-invalid", "true");
    expect(submitBtn()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 600));
    // ไม่มีการยิงด้วยค่าที่ถูกกรองทิ้งเงียบ ("1,5" → 15 · "-1" → 1 · "3.5" → 35 ฯลฯ) — ค่าผิดรูปแบบ = ไม่ถามเลย
    expect(getJobPlanSuggest.mock.calls.length).toBe(before);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("'1,5' ข้อความ error บอกให้ใส่จำนวนเต็ม 0 ขึ้นไป · ไม่มีคำเตือน 'ผลิตบางส่วน' (ตอนสร้างผลิตน้อยกว่าสั่งไม่ได้แล้ว)", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "1,5");
    expect(await screen.findByText("ใส่เป็นจำนวนเต็ม 0 ขึ้นไป เช่น 5")).toBeInTheDocument();
    expect(screen.queryByText(/ผลิตบางส่วน/)).not.toBeInTheDocument();
  });

  it("เพดานรวม: สั่ง 30 + เผื่อ 99970 = 100,000 ผ่าน", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "99970");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(bufferInput()).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("debounce: พิมพ์ 3 ตัวติดกันยิงถาม DB แค่ครั้งเดียว (ไม่ใช่ทุกตัวอักษร) · ใช้จำนวนรวม 153", async () => {
    await open();
    await userEvent.click(bufferSwitch());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "123");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.length).toBe(before + 1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(getJobPlanSuggest.mock.calls.length).toBe(before + 1);
    expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 153 }));
  });

  it("เปิด + ยังไม่มีอัตราเสียของ: กล่องเหลือง + ลิงก์ /oem/rates · ไม่มีกล่องฟ้า · พิมพ์เผื่อเองได้ · ปิดสวิตช์ = กล่องเหลืองหาย", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 30, rejectBasis: { castPct: null, polishPct: 3, platePct: null, hasPlating: false } }));
    await open();
    await userEvent.click(bufferSwitch());
    expect(await screen.findByText(/ยังไม่มีอัตราเสียของ \[หล่อ\] จึงไม่แนะนำเผื่อ/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "จัดการต้นทุน" })).toHaveAttribute("href", "/oem/rates");
    expect(screen.queryByText(/ระบบแนะนำ/)).not.toBeInTheDocument();
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "3");
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 33 }));
  });

  it("DB แนะนำ 'ไม่ต้องเผื่อ' (แนะนำ = สั่ง): ข้อความ 'ไม่ต้องเผื่อ' · เผื่อ 0 อยู่แล้ว = ไม่มีปุ่มใช้ค่าแนะนำ", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: 30, bufferQty: 0, qtyPlannedEff: 30, rejectBasis: { castPct: 0, polishPct: 0, platePct: 0, hasPlating: true } }));
    await open();
    await userEvent.click(bufferSwitch());
    expect(await screen.findByText(/ระบบแนะนำ: ไม่ต้องเผื่อ \(เริ่มผลิต 30 ชิ้น\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
  });

  it("preview ล้ม + สวิตช์ปิด: ไม่ขึ้น 'คำนวณจำนวนแนะนำไม่ได้' · สร้างใบได้ (ระบบคำนวณตอนสร้าง) · เปิดสวิตช์ = ขึ้นกล่องเหลือง", async () => {
    getJobPlanSuggest.mockResolvedValue({ ok: false, error: "คำนวณแผนไม่สำเร็จ" });
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByText(/คำนวณจำนวนแนะนำไม่ได้/)).not.toBeInTheDocument();
    await userEvent.click(bufferSwitch());
    expect(await screen.findByText(/คำนวณจำนวนแนะนำไม่ได้ — คำนวณแผนไม่สำเร็จ/)).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
    await userEvent.click(bufferSwitch());
    expect(screen.queryByText(/คำนวณจำนวนแนะนำไม่ได้/)).not.toBeInTheDocument();
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("สวิตช์: เป็น <button role=switch> พร้อมชื่อ 'เผื่อของเสีย' · สูง ≥ 44px (h-11) · กด Space/Enter สลับได้", async () => {
    await open();
    const sw = bufferSwitch();
    expect(sw.tagName).toBe("BUTTON");
    expect(sw.className).toMatch(/\bh-11\b/);
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Enter}");
    expect(sw).toHaveAttribute("aria-checked", "false");
    // คลิกที่ข้อความ label ก็สลับได้ (label htmlFor)
    await userEvent.click(screen.getByText("(ไม่บังคับ)"));
    expect(sw).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByText("(ไม่บังคับ)"));
    expect(sw).toHaveAttribute("aria-checked", "false");
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
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("30 ชิ้น");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("0175 ฟอร์มสร้างใบงาน — review S1/S2/BUG-4", () => {
  it("S1 ไม่มีน้ำหนักเป้าหมาย + preview ล้ม: สวิตช์ปิด = ไม่ขวางสร้าง · เปิดสวิตช์ = role=alert 'คำนวณจำนวนแนะนำไม่ได้' + ลองใหม่ (ไม่เงียบ) · ลองใหม่สำเร็จ = กล่องแนะนำกลับมา", async () => {
    suggestJob.mockResolvedValue(suggestion({ targetPieceG: null, targetPieceGSource: null }));
    getJobPlanSuggest.mockResolvedValueOnce({ ok: false, error: "คำนวณแผนไม่สำเร็จ" }).mockResolvedValue(plan({ targetPieceG: null, targetPieceGSource: null, metalPlanG: null, metalPlanBasis: null }));
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(bufferSwitch());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("คำนวณจำนวนแนะนำไม่ได้ — คำนวณแผนไม่สำเร็จ");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(bufferInput()).not.toHaveAttribute("aria-invalid");
    expect(alert.closest("div")!.className).not.toMatch(/red-/);
    // ไม่มีการ์ดโลหะ (ไม่มีน้ำหนัก) → ปุ่มลองใหม่ต้องอยู่ที่กล่องเผื่อ
    expect(screen.queryByRole("region", { name: "โลหะที่ต้องเตรียม" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText(/ระบบแนะนำเผื่อ \+5 \(เริ่มผลิต 35 ชิ้น\)/)).toBeInTheDocument();
    expect(screen.queryByText(/คำนวณจำนวนแนะนำไม่ได้/)).not.toBeInTheDocument();
  });

  it("S1 มีน้ำหนัก + preview ล้ม: ปุ่มลองใหม่มีตัวเดียว (อยู่ที่การ์ดโลหะ) ไม่ซ้ำสองปุ่ม · ทั้งตอนปิดและเปิดสวิตช์", async () => {
    getJobPlanSuggest.mockResolvedValueOnce({ ok: false, error: "คำนวณแผนไม่สำเร็จ" }).mockResolvedValue(plan());
    await open();
    // สวิตช์ปิด: มีเฉพาะ alert ของการ์ดโลหะ · ไม่มีข้อความเรื่องจำนวนแนะนำ
    expect(await screen.findByText("คำนวณแผนไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.queryByText(/คำนวณจำนวนแนะนำไม่ได้/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ลองใหม่" })).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // สวิตช์เปิด: กล่องเหลืองของจำนวนมาด้วย แต่ยังมีปุ่ม/alert ตัวเดียว (ของการ์ดโลหะ) · ช่องเผื่อไม่แดง/ไม่ aria-invalid เพราะ preview ล้ม
    await userEvent.click(bufferSwitch());
    expect(await screen.findByText(/คำนวณจำนวนแนะนำไม่ได้ — คำนวณแผนไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ลองใหม่" })).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(bufferInput()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(/คำนวณจำนวนแนะนำไม่ได้/).closest("div")!.className).not.toMatch(/red-/);
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
  it("แก้จำนวนเผื่อระหว่างรอคำตอบแรก: คำตอบแรกกลับมาก่อนคำตอบสอง = ถูกทิ้ง · ปุ่มสร้างยังปิด · จอใช้ค่าคำตอบสอง", async () => {
    const waits: Array<(v: unknown) => void> = [];
    getJobPlanSuggest.mockImplementation(() => new Promise((r) => { waits.push(r); }));
    await open();
    await waitFor(() => expect(waits).toHaveLength(1));
    await userEvent.click(bufferSwitch()); // เปิดสวิตช์ เผื่อ 0 = จำนวนเดิม ไม่ถามใหม่
    await userEvent.clear(bufferInput());
    await userEvent.type(bufferInput(), "5");
    await waitFor(() => expect(waits).toHaveLength(2), { timeout: 3000 });
    expect(getJobPlanSuggest.mock.calls[1][2]).toEqual(expect.objectContaining({ qtyPlanned: 35 }));

    waits[0](plan({ metalPlanG: 153.6 })); // คำตอบเก่า (ก่อนแก้จำนวน)
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("region", { name: "โลหะที่ต้องเตรียม" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/153\.600/)).not.toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();

    waits[1](plan({ qtyPlannedEff: 35, metalPlanG: 120 }));
    expect(await screen.findByText(/120\.000/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("เริ่มผลิต 35 ชิ้น");
    expect(bufferInput().value).toBe("5");
  });
});
