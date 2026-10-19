// @vitest-environment jsdom
// หน้าช่าง: "ได้รับเพิ่มแล้ว" (0183 · ส่วนต่างทางที่ 3) — ผู้รับของขั้นที่รับขาดบอกว่าชิ้นที่ขาดมาถึงแล้วกี่ชิ้น
// payload ไป server = { discrepancyId, qty, expectedOpen = ที่ค้างบนจอ, weightG เฉพาะทอง+ขั้นชั่ง } · ไม่โชว์น้ำหนักขั้นก่อน (N1) · ไม่มีเงิน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
const arrive = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  workerLogin: vi.fn(),
  workerLogout: vi.fn(),
  workerReceiveStage: vi.fn(),
  workerSendStage: vi.fn(),
  workerResolveDiscrepancyAction: vi.fn(),
  workerCancelLotAction: vi.fn(),
  arriveDiscrepancyWorker: (...a: unknown[]) => arrive(...a),
}));

import { WorkerApp } from "./WorkerApp";
import { WORKER_ARRIVE_CODE_TH, WORKER_CODE_TH } from "@/lib/jobs/messages";
import type { WorkerAction, WorkerPart, WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const LOT0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0";
const LOT1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const DISC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const stages = [
  { seq: 1, code: "cast", name: "หล่อ", status: "sent" },
  { seq: 2, code: "polish", name: "ขัด", status: "sent" },
  { seq: 3, code: "qc", name: "ตรวจ QC", status: "received" },
] as WorkerView["job"]["stages"];

const part = (o: Partial<WorkerPart> = {}): WorkerPart => ({ lotJobId: LOT0, label: "JB-0018", lotSeq: 0, status: "in_progress", qtyPlanned: 50, qtyLive: 48, stageCode: "qc", stageName: "ตรวจ QC", holderName: "ช่าง ค", days: 1, isMine: true, canCancelSplit: false, ...o });
const act = (o: Partial<WorkerAction> = {}): WorkerAction => ({ lotJobId: LOT0, label: "JB-0018", action: "arrive", stageSeq: 3, stageCode: "qc", stageName: "ตรวจ QC", weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, qtyHold: null, qtyExpected: null, discrepancyId: DISC, officeOnly: false, qty: 2, ...o });

const view = (o: Partial<WorkerView> = {}, job: Partial<WorkerView["job"]> = {}): WorkerView => ({
  job: { jobNo: "JB-0018", status: "in_progress", stages, designLabel: "แหวนโกเมนไข่", sku: "RG-001", metal: "silver", qtyPlanned: 50, dueDate: null, ...job },
  viewer: { workerId: WA, displayName: "ช่าง ค" },
  sessionExpired: false,
  nextAction: "multi",
  actionStage: null,
  prevWeightOutG: null,
  heldBy: "ช่าง ค",
  workers: [],
  scrapReasons: ["porosity", "broken", "wrong_design", "missing", "other"],
  parts: [part()],
  myActions: [act()],
  ...o,
});

const okArrived = (qty: number, rem: number) => ({
  ok: true,
  arrived: { qty, qtyRemaining: rem, remainingDiscrepancyId: rem > 0 ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : null, lot: { lotJobId: LOT1, lotSeq: 1, label: "JB-0018 · ส่วนที่ 1", stageCode: "qc" } },
});

beforeEach(() => {
  vi.clearAllMocks();
  arrive.mockResolvedValue(okArrived(2, 0));
});

const setQty = async (label: string, v: string) => {
  const el = screen.getByLabelText(label);
  await userEvent.clear(el);
  if (v) await userEvent.type(el, v);
};
const legend = (label: string) => screen.getByText(label).nextSibling;

describe("หน้าช่าง — ได้รับเพิ่มแล้ว", () => {
  it("การ์ด 'ชิ้นที่ยังไม่มาถึง' (ค้าง 2 ตัวใหญ่) · มีงานเดียว = เปิดฟอร์มให้เลย · ค่าเริ่ม = ค้างทั้งหมด · ชิป 'ครบ 2' กดอยู่ · ปุ่ม 'รับเพิ่ม 2 ชิ้น'", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    expect(await screen.findByRole("heading", { name: "ชิ้นที่ยังไม่มาถึง" })).toBeInTheDocument();
    expect(screen.getByText("ได้รับเพิ่มกี่ชิ้น")).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนที่ได้รับเพิ่ม")).toHaveValue("2");
    expect(screen.getByRole("button", { name: "ครบ 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "รับเพิ่ม 2 ชิ้น" })).toBeEnabled();
    expect(screen.queryByLabelText(/น้ำหนัก/)).not.toBeInTheDocument(); // เงิน/ขั้นไม่ชั่ง = ไม่มีช่อง
  });

  it("ได้รับเพิ่ม 2 จาก 2 → payload { discrepancyId, qty:2, expectedOpen:2 } (ไม่มี weightG) · จอสำเร็จ 'รับเพิ่ม 2 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้'", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.click(await screen.findByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
    await waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
    expect(arrive).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, qty: 2, expectedOpen: 2 });
    expect(await screen.findByText("รับเพิ่ม 2 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้")).toBeInTheDocument();
    expect(screen.queryByText(/ยังค้าง/)).not.toBeInTheDocument();
  });

  it("ค้าง 5 ได้รับเพิ่ม 1 (partial): legend ได้รับเพิ่ม 1 / ยังค้าง 4 · ปุ่ม 'รับเพิ่ม 1 ชิ้น' · payload qty 1 expectedOpen 5 · จอสำเร็จบอก 'ยังค้าง 4 ชิ้น'", async () => {
    arrive.mockResolvedValue(okArrived(1, 4));
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 5 })] })} />);
    await screen.findByText("ได้รับเพิ่มกี่ชิ้น");
    await setQty("จำนวนที่ได้รับเพิ่ม", "1");
    expect(legend("ได้รับเพิ่ม")).toHaveTextContent("1");
    expect(legend("ยังค้าง")).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "ครบ 5" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ยังขาด 5 ชิ้น ได้รับเพิ่ม 1 ยังค้าง 4");
    await userEvent.click(screen.getByRole("button", { name: "รับเพิ่ม 1 ชิ้น" }));
    await waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
    expect(arrive).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, qty: 1, expectedOpen: 5 });
    expect(await screen.findByText("รับเพิ่ม 1 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้ · ยังค้าง 4 ชิ้น")).toBeInTheDocument();
  });

  it("ชิป 'ครบ N' คืนค่าเริ่มหลังพิมพ์เอง", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 5 })] })} />);
    await screen.findByText("ได้รับเพิ่มกี่ชิ้น");
    await setQty("จำนวนที่ได้รับเพิ่ม", "2");
    await userEvent.click(screen.getByRole("button", { name: "ครบ 5" }));
    expect(screen.getByLabelText("จำนวนที่ได้รับเพิ่ม")).toHaveValue("5");
    expect(legend("ยังค้าง")).toHaveTextContent("0");
  });

  it("ค้างชิ้นเดียว: อ่านอย่างเดียว (ไม่มีช่อง/แถบ) · ปุ่ม 'รับเพิ่ม 1 ชิ้น' · expectedOpen 1", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 1 })] })} />);
    const b = await screen.findByRole("button", { name: "รับเพิ่ม 1 ชิ้น" });
    expect(screen.queryByLabelText("จำนวนที่ได้รับเพิ่ม")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qty-bar")).not.toBeInTheDocument();
    await userEvent.click(b);
    await waitFor(() => expect(arrive).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, qty: 1, expectedOpen: 1 }));
  });

  it("เกินที่ค้าง / ว่าง: ปุ่มปิดและบอกเหตุ · ไม่เรียก server", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 5 })] })} />);
    await screen.findByText("ได้รับเพิ่มกี่ชิ้น");
    await setQty("จำนวนที่ได้รับเพิ่ม", "6");
    const over = screen.getByRole("button", { name: "ได้รับเพิ่มได้ไม่เกิน 5 ชิ้น" });
    expect(over).toBeDisabled();
    await setQty("จำนวนที่ได้รับเพิ่ม", "");
    expect(screen.getByRole("button", { name: "ใส่จำนวนที่ได้รับเพิ่ม" })).toBeDisabled();
    expect(arrive).not.toHaveBeenCalled();
  });

  it("กดรัวๆ ส่งครั้งเดียว · ระหว่างส่ง stepper ถูกปิด", async () => {
    let release: (v: unknown) => void = () => {};
    arrive.mockImplementation(() => new Promise((r) => (release = r)));
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 5 })] })} />);
    const b = await screen.findByRole("button", { name: "รับเพิ่ม 5 ชิ้น" });
    await userEvent.dblClick(b);
    expect(screen.getByLabelText("จำนวนที่ได้รับเพิ่ม")).toBeDisabled();
    release(okArrived(5, 0));
    await waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
  });

  describe("ทอง ขั้นตั้งชั่ง", () => {
    const goldView = () => view({ prevWeightOutG: 12.5, myActions: [act({ weightRequired: true })] }, { metal: "gold" });

    it("ช่องน้ำหนักบังคับ 'น้ำหนักชิ้นที่ได้รับเพิ่ม' · ว่าง = ข้อความใต้ช่อง ไม่เรียก server · ไม่โชว์น้ำหนักขั้นก่อน (N1)", async () => {
      render(<WorkerApp token={TOKEN} view={goldView()} />);
      expect(await screen.findByLabelText(/น้ำหนักชิ้นที่ได้รับเพิ่ม \(กรัม\) — ต้องใส่/)).toBeInTheDocument();
      expect(screen.getByText("ชั่งเฉพาะชิ้นที่ได้รับเพิ่ม")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
      expect(await screen.findByText("ต้องชั่งน้ำหนักชิ้นที่ได้รับเพิ่มก่อน")).toBeInTheDocument();
      expect(arrive).not.toHaveBeenCalled();
      expect(document.body.textContent ?? "").not.toMatch(/ครั้งก่อนส่งออก|12\.5/);
    });

    it("น้ำหนักผิดรูป (ทศนิยม 4 ตำแหน่ง) = ปฏิเสธฝั่งหน้า · '1,5' ผ่าน → weightG '1,5' พร้อม expectedOpen", async () => {
      render(<WorkerApp token={TOKEN} view={goldView()} />);
      const f = await screen.findByLabelText(/น้ำหนักชิ้นที่ได้รับเพิ่ม/);
      await userEvent.type(f, "1.2345");
      await userEvent.click(screen.getByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
      expect(await screen.findByText(/ทศนิยมไม่เกิน 3 ตำแหน่ง/)).toBeInTheDocument();
      expect(arrive).not.toHaveBeenCalled();
      await userEvent.clear(f);
      await userEvent.type(f, "1,5");
      await userEvent.click(screen.getByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
      await waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
      expect(arrive).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, qty: 2, expectedOpen: 2, weightG: "1,5" });
    });

    it("ทองแต่ขั้นไม่ชั่ง (weightRequired false) = ไม่มีช่อง ไม่ส่ง weightG", async () => {
      render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: false })] }, { metal: "gold" })} />);
      await userEvent.click(await screen.findByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
      await waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
      expect(arrive.mock.calls[0][1]).not.toHaveProperty("weightG");
    });
  });

  describe("error code จาก DB", () => {
    const fail = (code: string, error: string) => arrive.mockResolvedValue({ ok: false, error, code });
    const submit = async (v = view()) => {
      render(<WorkerApp token={TOKEN} view={v} />);
      await userEvent.click(await screen.findByRole("button", { name: "รับเพิ่ม 2 ชิ้น" }));
    };

    it("arrive_weight_required / arrive_heavy / office_required / not_receiver / qty_invalid: ข้อความไทยตามที่ server ส่ง · ไม่มีปุ่มโหลดใหม่ · ฟอร์มค้างค่าเดิม", async () => {
      for (const [code, msg] of [
        ["arrive_weight_required", "ทอง: ต้องชั่งน้ำหนักชิ้นที่มาถึงก่อน"],
        ["arrive_heavy", "น้ำหนักชิ้นที่มาถึงไม่ตรงกับส่วนที่ขาด — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ"],
        ["office_required", WORKER_ARRIVE_CODE_TH.office_required],
        ["not_receiver", "บันทึกว่าได้รับเพิ่มได้เฉพาะช่างที่รับของขั้นนี้ (หรือให้ออฟฟิศกรอกแทน)"],
        ["qty_invalid", WORKER_ARRIVE_CODE_TH.qty_invalid],
      ] as const) {
        cleanup();
        arrive.mockReset();
        fail(code, msg);
        await submit();
        expect(await screen.findByRole("alert")).toHaveTextContent(msg);
        expect(screen.queryByRole("button", { name: "โหลดใหม่" })).not.toBeInTheDocument();
        expect(screen.getByLabelText("จำนวนที่ได้รับเพิ่ม")).toHaveValue("2");
      }
    });

    it("stage_changed / already_resolved / weight_unexpected: มีปุ่ม 'โหลดใหม่' (ข้อมูลบนจอเก่า) · กดแล้ว refresh", async () => {
      for (const [code, msg] of [
        ["stage_changed", WORKER_ARRIVE_CODE_TH.stage_changed],
        ["already_resolved", WORKER_ARRIVE_CODE_TH.already_resolved],
        ["weight_unexpected", WORKER_ARRIVE_CODE_TH.weight_unexpected],
      ] as const) {
        cleanup();
        refresh.mockClear();
        arrive.mockReset();
        fail(code, msg);
        await submit();
        expect(await screen.findByRole("alert")).toHaveTextContent(msg);
        await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
        expect(refresh).toHaveBeenCalled();
      }
    });

    it("job_closed / job_on_hold / invalid_part: ข้อความจากตารางกลาง ไม่รั่ว SQL/รหัส", async () => {
      for (const code of ["job_closed", "job_on_hold", "invalid_part"] as const) {
        cleanup();
        arrive.mockReset();
        fail(code, WORKER_CODE_TH[code] ?? "ทำรายการไม่สำเร็จ");
        await submit();
        const a = await screen.findByRole("alert");
        expect(a.textContent ?? "").not.toMatch(/22023|55000|P0001|duplicate key|violates/i);
      }
    });

    it("throw จาก server action = ข้อความกลาง ไม่ค้างหมุน", async () => {
      arrive.mockRejectedValue(new Error("boom: connection string postgres://secret"));
      await submit();
      const a = await screen.findByRole("alert");
      expect(a.textContent ?? "").not.toMatch(/boom|postgres/);
      expect(screen.getByRole("button", { name: "รับเพิ่ม 2 ชิ้น" })).toBeEnabled();
    });
  });

  it("หลายการ์ดพร้อมกัน (ได้รับเพิ่ม + ส่งต่อ): การ์ดปิดอยู่ กดปุ่ม 'ได้รับเพิ่ม' เปิดฟอร์มของการ์ดนั้น", async () => {
    const v = view({
      myActions: [act({ qty: 3 }), { ...act({ action: "send", discrepancyId: null, qty: null, lotJobId: LOT1, label: "JB-0018 · ส่วนที่ 1", qtyHold: 10, stageSeq: 3 }) }],
      parts: [part(), part({ lotJobId: LOT1, label: "JB-0018 · ส่วนที่ 1", lotSeq: 1, qtyLive: 10 })],
    });
    render(<WorkerApp token={TOKEN} view={v} />);
    const h = await screen.findByRole("heading", { name: "ชิ้นที่ยังไม่มาถึง" });
    expect(screen.queryByLabelText("จำนวนที่ได้รับเพิ่ม")).not.toBeInTheDocument();
    const card = h.closest("section") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "ได้รับเพิ่ม" }));
    expect(screen.getByLabelText("จำนวนที่ได้รับเพิ่ม")).toHaveValue("3");
  });

  it("ใบที่ไม่มีส่วนต่าง (ไม่มี action arrive) = ไม่มีหัวข้อ/ปุ่มใหม่", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ action: "send", discrepancyId: null, qty: null, qtyHold: 48 })] })} />);
    await screen.findByText("ส่งกี่ชิ้น");
    expect(screen.queryByRole("heading", { name: "ชิ้นที่ยังไม่มาถึง" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ได้รับเพิ่ม/)).not.toBeInTheDocument();
  });

  it("ไม่มีเงิน/ต้นทุน/ชื่อลูกค้าบนจอ", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ qty: 5, weightRequired: true })] }, { metal: "gold" })} />);
    await screen.findByText("ได้รับเพิ่มกี่ชิ้น");
    expect(document.body.textContent ?? "").not.toMatch(/บาท|฿|ราคา|ต้นทุน|THB/);
  });
});
