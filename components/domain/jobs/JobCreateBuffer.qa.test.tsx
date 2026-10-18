// @vitest-environment jsdom
// QA guard: M1 สวิตช์เผื่อของเสีย — ห้ามใช้ค่าแนะนำเงียบ (มติ 18 ต.ค. 69)
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
const setJobQtyPlanned = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
  getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a),
}));
vi.mock("@/lib/actions/job-office-write", () => ({ setJobQtyPlanned: (...a: unknown[]) => setJobQtyPlanned(...a), setJobPlan: vi.fn(), setJobSurplus: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "@/components/domain/jobs/JobCreateDialog";
import { QtyPlannedDialog } from "@/components/domain/jobs/PlanDialogs";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";
const PA = "aaaaaaaa-0000-4000-8000-000000000001";
const PB = "aaaaaaaa-0000-4000-8000-000000000002";
const prof = (id: string, name: string, stages: { stageCode: string; weigh?: boolean; scrapQty?: boolean }[], o: Record<string, unknown> = {}) => ({
  id, name, note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: false, isDefaultGold: false, jobsOpen: 0,
  stages: stages.map((s) => ({ stageCode: s.stageCode, weigh: !!s.weigh, scrapQty: !!s.scrapQty, scrapWeight: false })), ...o,
});
const P_ONE = prof(PA, "แบบ 1", [{ stageCode: "cast", weigh: true, scrapQty: true }], { isDefault: true });
const P_TWO = prof(PB, "แบบ 2", [{ stageCode: "cast", weigh: true }, { stageCode: "polish", weigh: true }]);
const STAGES = [
  { code: "cast", nameTh: "หล่อ", defaultSelected: true, metalPresent: true },
  { code: "polish", nameTh: "ขัด", defaultSelected: true, metalPresent: true },
];
const suggestion = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: { profiles: [P_ONE, P_TWO], defaultProfileId: PA, metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: STAGES, targetPieceG: 4, targetPieceGSource: "quote", ...o },
});
const plan = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 35, underPlanned: false,
    rejectBasis: { castPct: 6, polishPct: 3, platePct: null, hasPlating: false },
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
const sw = () => screen.getByRole("switch", { name: /เผื่อของเสีย/ });
const bufIn = () => screen.getByLabelText("เผื่อเพิ่ม (ชิ้น)") as HTMLInputElement;
const typeBuf = async (t: string) => {
  await userEvent.clear(bufIn());
  if (t) await userEvent.type(bufIn(), t);
};
const settle = () => new Promise((r) => setTimeout(r, 650));
const ACK = /รับทราบ — ยังต้องการใช้แบบนี้กับใบทอง/;

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(plan());
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
  setJobQtyPlanned.mockResolvedValue({ ok: true, data: null });
});

describe("1. no silent buffer - invariant sweep", () => {
  it("every preview call has numeric qtyPlanned (never null/undefined); create has no qtyPlanned after toggling around", async () => {
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(sw());
    await typeBuf("5");
    await settle();
    await userEvent.click(sw()); // off
    await settle();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(sw()); // on again
    await typeBuf("abc"); // invalid
    await settle();
    await userEvent.click(sw()); // off
    await settle();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    expect(getJobPlanSuggest.mock.calls.length).toBeGreaterThan(2);
    for (const c of getJobPlanSuggest.mock.calls) {
      expect(typeof c[2]?.qtyPlanned).toBe("number");
      expect(Number.isInteger(c[2].qtyPlanned)).toBe(true);
      expect(c[2].qtyPlanned).toBeGreaterThanOrEqual(30);
    }
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("switch off + DB suggests 35 + preview ready + user does nothing: no qtyPlanned, summary says 30, no buffer input", async () => {
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await settle();
    expect(screen.getByTestId("qty-start-summary")).toHaveTextContent("30 ชิ้น");
    expect(screen.queryByLabelText("เผื่อเพิ่ม (ชิ้น)")).not.toBeInTheDocument();
    expect(screen.getByTestId("qty-start-summary")).not.toHaveTextContent("35");
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("open switch then create at b=0 while suggestion visible: not sending 35", async () => {
    await open();
    await userEvent.click(sw());
    await screen.findByRole("button", { name: "ใช้ค่าแนะนำ" });
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });
});

describe("5. screen does not compute the suggestion", () => {
  it("DB says 37/+7 while formula(6%,3%) would give 34: UI shows 37/+7, apply gives 7, create 37", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: 37, bufferQty: 7, qtyPlannedEff: 37 }));
    await open();
    await userEvent.click(sw());
    expect(await screen.findByText(/ระบบแนะนำเผื่อ \+7 \(เริ่มผลิต 37 ชิ้น\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ใช้ค่าแนะนำ" }));
    expect(bufIn().value).toBe("7");
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 37 }));
  });

  it("bufferQty null but suggest 41: ไม่คิดเลขใน client — ไม่โชว์กล่อง/ปุ่มแนะนำ (ต้องเป็นตัวเลขที่ DB ตอบ)", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: 41, bufferQty: null, qtyPlannedEff: 41 }));
    await open();
    await userEvent.click(sw());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/ระบบแนะนำ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+11/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
  });

  it("DB suggests below order (25, buffer -5): clamp to 0, never negative, no apply button when b=0", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: 25, bufferQty: -5, qtyPlannedEff: 25 }));
    await open();
    await userEvent.click(sw());
    expect(await screen.findByText(/ระบบแนะนำ: ไม่ต้องเผื่อ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
  });

  it("DB over-limit suggestion (null + missing): no blue box, no yellow box, b stays 0", async () => {
    getJobPlanSuggest.mockResolvedValue(plan({ qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 30, missing: ["qty_planned_suggest_over_limit"] }));
    await open();
    await userEvent.click(sw());
    await settle();
    expect(screen.queryByText(/ระบบแนะนำ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่มีอัตราเสียของ/)).not.toBeInTheDocument();
    expect(bufIn().value).toBe("0");
  });

  it("documents behaviour: suggestion box hidden while buffer text is invalid (preview idle)", async () => {
    await open();
    await userEvent.click(sw());
    await screen.findByRole("button", { name: "ใช้ค่าแนะนำ" });
    await typeBuf("abc");
    await settle();
    expect(screen.queryByRole("button", { name: "ใช้ค่าแนะนำ" })).not.toBeInTheDocument();
  });
});

describe("2. must-pass combos", () => {
  const goldSetup = () => {
    suggestJob.mockResolvedValue(suggestion({ metal: "gold", targetPieceG: null, targetPieceGSource: null }));
    getJobPlanSuggest.mockResolvedValue(plan({ metal: "gold", targetPieceG: null, metalPlanG: null, metalPlanBasis: null }));
  };

  it("gold: switch on b=3 needs ack, then create sends qtyPlanned 33 + profileId", async () => {
    goldSetup();
    await open();
    await userEvent.click(sw());
    await typeBuf("3");
    const ack = await screen.findByLabelText(ACK);
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({ qtyPlanned: 33 })), { timeout: 3000 });
    await waitFor(() => expect(getJobPlanSuggest).toHaveBeenCalled());
    expect(submitBtn()).toBeDisabled();
    await userEvent.click(ack);
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ qtyPlanned: 33, profileId: PA }));
  });

  it("gold + switch OFF: still needs ack, no qtyPlanned", async () => {
    goldSetup();
    await open();
    const ack = await screen.findByLabelText(ACK);
    expect(submitBtn()).toBeDisabled();
    await userEvent.click(ack);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
    expect(createJob.mock.calls[0][0].profileId).toBe(PA);
  });

  it("profile switch while buffer on keeps buffer; create carries new profile + qtyPlanned", async () => {
    await open();
    await userEvent.click(sw());
    await typeBuf("2");
    await userEvent.selectOptions(screen.getByLabelText(/แบบการบันทึก/), PB);
    expect(bufIn().value).toBe("2");
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ profileId: PB, qtyPlanned: 32 }));
  });

  it("production kind: buffer 4 sends kind=production qtyPlanned 34", async () => {
    await open("production");
    await userEvent.click(sw());
    await typeBuf("4");
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "production", itemId: ITEM, qtyPlanned: 34 }));
  });

  it("toggle off during a slow preview for 35: late stale answer cannot leak qtyPlanned", async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    getJobPlanSuggest.mockImplementation((_k: string, _i: string, a: { qtyPlanned: number }) =>
      a.qtyPlanned === 35 ? new Promise((r) => (resolveSlow = r)) : Promise.resolve(plan({ qtyPlannedEff: a.qtyPlanned })),
    );
    await open();
    await userEvent.click(sw());
    await typeBuf("5");
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.some((c) => c[2].qtyPlanned === 35)).toBe(true), { timeout: 3000 });
    expect(submitBtn()).toBeDisabled();
    await userEvent.click(sw());
    await waitFor(() => expect(getJobPlanSuggest.mock.calls.at(-1)![2].qtyPlanned).toBe(30), { timeout: 3000 });
    resolveSlow(plan({ qtyPlannedEff: 35 }));
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("qtyPlanned");
  });

  it("existingJob: switch + submit disabled, nothing created", async () => {
    suggestJob.mockResolvedValue(suggestion({ existingJob: { id: "J1", jobNo: "JB-0001" } }));
    await open();
    expect(sw()).toBeDisabled();
    expect(submitBtn()).toBeDisabled();
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe("3. must reject", () => {
  it.each([["๕"], ["５"], ["+5"], ["1e2"], ["99999999999999999999"], ["0x5"], ["5​"]])("rejects %j via UI (no preview, no create, even with Enter)", async (bad) => {
    await open();
    await userEvent.click(sw());
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    const before = getJobPlanSuggest.mock.calls.length;
    await typeBuf(bad);
    expect(submitBtn()).toBeDisabled();
    await userEvent.type(bufIn(), "{Enter}");
    await settle();
    expect(createJob).not.toHaveBeenCalled();
    expect(getJobPlanSuggest.mock.calls.length).toBe(before);
  });

  it("over cap via + button: 99970 then + = 99971 shows error and blocks", async () => {
    await open();
    await userEvent.click(sw());
    await typeBuf("99970");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มจำนวนเผื่อ" }));
    expect(bufIn().value).toBe("99971");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it("double-click create sends once", async () => {
    let done: (v: unknown) => void = () => {};
    createJob.mockImplementation(() => new Promise((r) => (done = r)));
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.dblClick(submitBtn());
    expect(createJob).toHaveBeenCalledTimes(1);
    done({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
  });
});

describe("latent: itemId prop changes while next suggestJob in flight (JobCreatePanel cannot do this - it remounts)", () => {
  it("old item's qty/buffer must not be submittable for the new itemId during reload", async () => {
    const ITEM2 = "22222222-2222-4222-8222-222222222222";
    let resolve2: (v: unknown) => void = () => {};
    suggestJob.mockImplementation((_k: string, id: string) => (id === ITEM ? Promise.resolve(suggestion()) : new Promise((r) => (resolve2 = r))));
    const ui = (id: string) => (
      <ToastProvider>
        <JobCreateDialog kind="oem" itemId={id} itemLabel="x" onClose={vi.fn()} onCreated={vi.fn()} />
      </ToastProvider>
    );
    const { rerender } = render(ui(ITEM));
    await screen.findByTestId("qty-order");
    await userEvent.click(sw());
    await typeBuf("5");
    rerender(ui(ITEM2));
    await settle();
    expect(submitBtn()).toBeDisabled();
    resolve2(suggestion({ qty: 50 }));
  });
});

describe("4. QtyPlannedDialog still allows producing fewer than ordered", () => {
  it("current 35 / order 30: set 25 shows partial warning and saves via setJobQtyPlanned(job,25,null)", async () => {
    wrap(<QtyPlannedDialog jobId="J1" qtyOrder={30} current={35} hasOverride={false} hasTarget onClose={vi.fn()} />);
    const input = screen.getByLabelText("เริ่มผลิต (ชิ้น)");
    await userEvent.clear(input);
    await userEvent.type(input, "25");
    expect(screen.getByText(/ผลิตบางส่วน — เริ่ม 25 น้อยกว่าที่สั่ง 30 \(ขาด 5 ชิ้น\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "บันทึกจำนวน" }));
    await waitFor(() => expect(setJobQtyPlanned).toHaveBeenCalledWith("J1", 25, null));
  });

  it("same value disabled; 0 / 2.5 / empty rejected", async () => {
    wrap(<QtyPlannedDialog jobId="J1" qtyOrder={30} current={30} hasOverride={false} hasTarget={false} onClose={vi.fn()} />);
    const input = screen.getByLabelText("เริ่มผลิต (ชิ้น)");
    expect(screen.getByRole("button", { name: "บันทึกจำนวน" })).toBeDisabled();
    for (const bad of ["0", "2.5", ""]) {
      await userEvent.clear(input);
      if (bad) await userEvent.type(input, bad);
      expect(screen.getByRole("button", { name: "บันทึกจำนวน" })).toBeDisabled();
    }
    expect(setJobQtyPlanned).not.toHaveBeenCalled();
  });
});
