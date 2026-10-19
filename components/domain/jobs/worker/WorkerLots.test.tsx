// @vitest-environment jsdom
// หน้าช่างเมื่อใบมีหลายส่วน (0181 L1): ส่งต่อ n จาก N · รับจำนวนจริง · ส่วนต่างรอชี้แจง · QR ใบเดิม · ใบเดี่ยวไม่เปลี่ยน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
const workerReceiveStage = vi.fn();
const workerSendStage = vi.fn();
const workerResolve = vi.fn();
const workerCancelLot = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  workerLogin: vi.fn(),
  workerLogout: vi.fn(),
  workerReceiveStage: (...a: unknown[]) => workerReceiveStage(...a),
  workerSendStage: (...a: unknown[]) => workerSendStage(...a),
  workerResolveDiscrepancyAction: (...a: unknown[]) => workerResolve(...a),
  workerCancelLotAction: (...a: unknown[]) => workerCancelLot(...a),
}));

import { WorkerApp } from "./WorkerApp";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";
import { WORKER_CODE_TH, WORKER_RECEIVE_LOCK_TH } from "@/lib/jobs/messages";
import type { WorkerAction, WorkerPart, WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const LOT0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0";
const LOT1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LOT2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const DISC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const stages = [
  { seq: 1, code: "cast", name: "หล่อ", status: "sent" },
  { seq: 2, code: "polish", name: "ขัด", status: "sent" },
  { seq: 3, code: "setting", name: "ฝังพลอย", status: "received" },
] as WorkerView["job"]["stages"];

const part = (o: Partial<WorkerPart> = {}): WorkerPart => ({ lotJobId: LOT0, label: "JB-0020", lotSeq: 0, status: "in_progress", qtyPlanned: 100, qtyLive: 50, stageCode: "setting", stageName: "ฝังพลอย", holderName: "ช่างเอ", days: 1, isMine: true, canCancelSplit: false, ...o });
const act = (o: Partial<WorkerAction> = {}): WorkerAction => ({ lotJobId: LOT0, label: "JB-0020", action: "send", stageSeq: 3, stageCode: "setting", stageName: "ฝังพลอย", weightRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, qtyHold: 50, qtyExpected: null, discrepancyId: null, officeOnly: false, qty: null, ...o });

const view = (o: Partial<WorkerView> = {}, job: Partial<WorkerView["job"]> = {}): WorkerView => ({
  job: { jobNo: "JB-0020", status: "in_progress", stages, designLabel: "แหวนโกเมนไข่", sku: "RG-001", metal: "silver", qtyPlanned: 100, dueDate: null, ...job },
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

beforeEach(() => {
  vi.clearAllMocks();
  workerReceiveStage.mockResolvedValue({ ok: true });
  workerSendStage.mockResolvedValue({ ok: true });
  workerResolve.mockResolvedValue({ ok: true });
  workerCancelLot.mockResolvedValue({ ok: true });
});

const sendBtn = (name: string | RegExp) => screen.getByRole("button", { name });
const setQty = async (id: string, v: string) => {
  const el = screen.getByLabelText(id);
  await userEvent.clear(el);
  if (v) await userEvent.type(el, v);
};

describe("หลายส่วน — ส่งต่อ n จาก N", () => {
  it("ถือ 50: ช่องค่าเริ่ม = ทั้งหมด 50 · ส่งครบ = เรียกแบบเดิม (ไม่มี qtySend) + ระบุส่วน + จำนวนที่ถืออยู่", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    expect(await screen.findByText("ส่งต่อกี่ชิ้น จาก 50")).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("50");
    await userEvent.click(sendBtn("ส่งต่อ"));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const [tok, input] = workerSendStage.mock.calls[0];
    expect(tok).toBe(TOKEN);
    expect(input).toMatchObject({ expectedSeq: 3, lotJobId: LOT0, qtyHold: 50, qtyScrap: 0 });
    expect(input).not.toHaveProperty("qtySend");
  });

  it("ส่ง 40 จาก 50 → qtySend=40 และ qtyHold=50 (จำนวนที่เห็นบนจอ) · ไม่ชั่ง/ไม่เติมโลหะตอนแยก (ค1)", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    // ใบเดิม (ไม่มีแบบการบันทึก) ปกติมีช่องน้ำหนักออก — ตอนแยกต้องหาย
    expect(screen.getByLabelText(/น้ำหนักออก/)).toBeInTheDocument();
    await setQty("จำนวนที่ส่ง", "40");
    expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ เติมโลหะ" })).not.toBeInTheDocument();
    expect(screen.getByText("ค้างกับคุณ").nextSibling).toHaveTextContent("10");
    expect(screen.getByText("ส่งไป").nextSibling).toHaveTextContent("40");
    await userEvent.click(sendBtn("ส่งต่อ 40 จาก 50 ชิ้น"));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    expect(workerSendStage.mock.calls[0][1]).toMatchObject({ expectedSeq: 3, lotJobId: LOT0, qtySend: 40, qtyHold: 50, weightOut: null });
  });

  it("กดซ้ำรัวๆ ส่งครั้งเดียว", async () => {
    let release: (v: unknown) => void = () => {};
    workerSendStage.mockImplementation(() => new Promise((r) => (release = r)));
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "40");
    const b = sendBtn("ส่งต่อ 40 จาก 50 ชิ้น");
    await userEvent.dblClick(b);
    await userEvent.click(b);
    release({ ok: true });
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
  });

  it("จำนวนผิด: ว่าง/0/เกินที่ถือ/ส่ง+เสียไม่เหลือ 1 ชิ้น → ข้อความใต้ช่อง ไม่เรียก action", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "");
    await userEvent.click(sendBtn("ส่งต่อ"));
    expect(await screen.findByText(/ใส่เป็นจำนวนเต็ม/)).toBeInTheDocument();
    await setQty("จำนวนที่ส่ง", "0");
    await userEvent.click(sendBtn("ส่งต่อ"));
    expect(await screen.findByText(/จำนวนต้องอยู่ระหว่าง/)).toBeInTheDocument();
    // ปุ่ม + จำกัดที่ 50 · พิมพ์เกินเอง = ข้อความ
    await setQty("จำนวนที่ส่ง", "51");
    await userEvent.click(sendBtn("ส่งต่อ"));
    expect(await screen.findByText("ส่งได้ไม่เกินที่ถืออยู่ (50 ชิ้น)")).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
    // ส่ง 49 + เสีย 1 = เหลือ 0 → ปฏิเสธฝั่งหน้าจอ (DB ตรวจจริงซ้ำ)
    await setQty("จำนวนที่ส่ง", "49");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(screen.getByRole("radio", { name: "หัก" }));
    await userEvent.click(sendBtn("ส่งต่อ 49 จาก 50 ชิ้น"));
    expect(await screen.findByText("ส่งต่อ + ของเสีย ต้องเหลือกับคุณอย่างน้อย 1 ชิ้น")).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
  });

  it("ช่อง '1,5' / '3.5' พิมพ์ไม่ได้ (ตัวเลขล้วน) และไม่กลายเป็นเลขอื่นเงียบๆ", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "3.5");
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("35"); // ตัวเลขล้วน: จุดถูกตัดตอนพิมพ์ — เห็นค่าจริงบนจอ + ปุ่มบอกจำนวนชัด
    expect(sendBtn("ส่งต่อ 35 จาก 50 ชิ้น")).toBeInTheDocument();
  });

  it("แยกสำเร็จ → จอ 'แบ่งส่วนแล้ว' (ส่วนที่ 2 = 40 · ค้างกับคุณ 10) + QR ใบเดิมบนจอ + ไม่ปิดเอง", async () => {
    workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "JB-0020 · ส่วนที่ 2", qty: 40, parentRemaining: 10 } });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่งต่อ 40 จาก 50 ชิ้น"));
    expect(await screen.findByText("แบ่งส่วนแล้ว")).toBeInTheDocument();
    expect(screen.getByText("ส่วนที่ 2")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("ค้างกับคุณ").closest("li")).toHaveTextContent("10");
    const qr = screen.getByRole("img", { name: "QR ใบงาน JB-0020" });
    expect(qr.innerHTML).toContain("<svg");
    expect(qr.innerHTML).not.toContain(TOKEN); // token อยู่ในรูปโมดูลเท่านั้น
    expect(screen.getByText("ให้คนรับสแกนจากจอนี้")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 2300)); // ไม่ปิดเองเหมือนจอสำเร็จทั่วไป (2 วิ)
    expect(screen.getByText("แบ่งส่วนแล้ว")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "เสร็จแล้ว" }));
    expect(refresh).toHaveBeenCalled();
  }, 15000);

  it("ยกเลิกการแยก: ถามยืนยันก่อน → workerCancelLotAction(token, ส่วนใหม่, null) → จอสำเร็จ 'ชิ้นกลับมาอยู่กับคุณ'", async () => {
    workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "x", qty: 40, parentRemaining: 10 } });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่งต่อ 40 จาก 50 ชิ้น"));
    await userEvent.click(await screen.findByRole("button", { name: "แบ่งผิด? ยกเลิกการแยก" }));
    expect(workerCancelLot).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "ยืนยันยกเลิกการแยกส่วน" })).toHaveTextContent("40 ชิ้นจะกลับมาอยู่กับคุณ");
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน ยกเลิกการแยก" }));
    await waitFor(() => expect(workerCancelLot).toHaveBeenCalledWith(TOKEN, LOT2, null));
    expect(await screen.findByText("ยกเลิกการแยกแล้ว — 40 ชิ้นกลับมาอยู่กับคุณ")).toBeInTheDocument();
  });

  it("ยกเลิกไม่ได้เพราะมีคนรับไปแล้ว → ข้อความเหลือง 'แจ้งออฟฟิศ' (ไม่ปิดจอ)", async () => {
    workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "x", qty: 40, parentRemaining: 10 } });
    workerCancelLot.mockResolvedValue({ ok: false, error: "มีคนรับขั้นนี้ไปแล้ว", code: "already_received" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่งต่อ 40 จาก 50 ชิ้น"));
    await userEvent.click(await screen.findByRole("button", { name: "แบ่งผิด? ยกเลิกการแยก" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน ยกเลิกการแยก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ส่วนนี้มีคนรับไปแล้ว ยกเลิกเองไม่ได้ — แจ้งออฟฟิศ");
    expect(screen.getByText("แบ่งส่วนแล้ว")).toBeInTheDocument();
  });

  it("stage_changed (2 มือถือ/กดซ้ำ) → ข้อความไทย + ปุ่มโหลดใหม่", async () => {
    workerSendStage.mockResolvedValue({ ok: false, error: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง", code: "stage_changed" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await userEvent.click(sendBtn("ส่งต่อ"));
    expect(await screen.findByRole("alert")).toHaveTextContent("งานเปลี่ยนไปแล้ว");
    await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    expect(refresh).toHaveBeenCalled();
  });

  describe("ทอง + ขั้นชั่ง: แยกส่วนต้องชั่งส่วนที่แยกออก (H2 · มติ 19 ต.ค.)", () => {
    const gold = (o: Partial<WorkerAction> = {}, v: Partial<WorkerView> = {}) =>
      view({ myActions: [act({ weightRequired: true, ...o })], parts: [part()], ...v }, { metal: "gold" });
    const openSplit = async (n = "40") => {
      render(<WorkerApp token={TOKEN} view={gold()} />);
      await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
      await setQty("จำนวนที่ส่ง", n);
    };

    it("ส่งน้อยกว่าที่ถือ: มีช่อง 'น้ำหนักส่วนที่ส่ง' บังคับ · ไม่มีช่องน้ำหนักออก/ไม่มีน้ำหนักขั้นก่อน/น้ำหนักที่ถือ", async () => {
      await openSplit();
      expect(screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/)).toBeInTheDocument();
      expect(screen.getByText(/— ต้องใส่/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toMatch(/ครั้งก่อนส่งออก|ถืออยู่ \d+(\.\d+)? กรัม/);
    });

    it("ไม่ชั่ง = ไม่ส่ง (ข้อความใต้ช่อง) · 0 / ค่าเพี้ยน / ทศนิยมเกิน 3 ตำแหน่ง = ปฏิเสธฝั่งหน้าจอ", async () => {
      await openSplit();
      const btn = () => screen.getByRole("button", { name: "ส่งต่อ 40 จาก 50 ชิ้น" });
      await userEvent.click(btn());
      expect(await screen.findByText(/ต้องชั่งน้ำหนักส่วนที่ส่งก่อน/)).toBeInTheDocument();
      for (const v of ["0", "1.2345", "1.2.3"]) {
        const f = screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/);
        await userEvent.clear(f);
        await userEvent.type(f, v);
        await userEvent.click(btn());
        await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
      }
      expect(workerSendStage).not.toHaveBeenCalled();
    });

    it("ชั่ง '12,5' → weightMoveG ส่งไปพร้อม qtySend=40 qtyHold=50 (ตัวแปลง 12,5 = 12.5 อยู่ที่ action) · ไม่ส่ง weightOut", async () => {
      await openSplit();
      await userEvent.type(screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/), "12,5");
      await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ 40 จาก 50 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).toMatchObject({ qtySend: 40, qtyHold: 50, weightMoveG: "12,5", weightOut: null, lotJobId: LOT0 });
    });

    it("ส่งทั้งหมด (ค่าเริ่ม): ไม่มีช่องน้ำหนักส่วนที่ส่ง · ชั่งน้ำหนักออกตามปกติ · ห้ามส่ง weightMoveG", async () => {
      render(<WorkerApp token={TOKEN} view={gold()} />);
      await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
      expect(screen.queryByLabelText(/น้ำหนักส่วนที่ส่ง/)).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "20.5");
      await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      const input = workerSendStage.mock.calls[0][1];
      expect(input).not.toHaveProperty("weightMoveG");
      expect(input).not.toHaveProperty("qtySend");
      expect(input).toMatchObject({ weightOut: "20.5" });
    });

    it("เงิน (ขั้นชั่ง) และทองที่ขั้นไม่ชั่ง: ไม่มีช่องน้ำหนักส่วนที่ส่ง ไม่ส่ง weightMoveG", async () => {
      const a = render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: true })] })} />);
      await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
      await setQty("จำนวนที่ส่ง", "40");
      expect(screen.queryByLabelText(/น้ำหนักส่วนที่ส่ง/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ 40 จาก 50 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).not.toHaveProperty("weightMoveG");
      a.unmount();
      workerSendStage.mockClear();
      render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: false })] }, { metal: "gold" })} />);
      await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
      await setQty("จำนวนที่ส่ง", "40");
      expect(screen.queryByLabelText(/น้ำหนักส่วนที่ส่ง/)).not.toBeInTheDocument();
    });

    it("DB ตอบ weight_move_required / weight_over → ข้อความไทยบนจอ", async () => {
      workerSendStage.mockResolvedValue({ ok: false, error: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน", code: "weight_move_required" });
      await openSplit();
      await userEvent.type(screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/), "5");
      await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ 40 จาก 50 ชิ้น" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน");
    });

    it("ใบเดี่ยวที่เป็นทอง (ไม่ใช่ multi): แยกส่วนได้เหมือนกัน · ต้องชั่งส่วนที่แยก", async () => {
      render(
        <WorkerApp
          token={TOKEN}
          view={view({ nextAction: "send", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: true }, myActions: [act({ weightRequired: true })] }, { metal: "gold" })}
        />
      );
      await userEvent.click(await screen.findByText("ส่งไม่ครบ? แบ่งส่งบางส่วน"));
      await setQty("จำนวนที่ส่ง", "20");
      expect(screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/)).toBeInTheDocument();
    });
  });
});

describe("หลายส่วน — รับจำนวนจริง", () => {
  const recvView = (qty = 40) =>
    view({
      myActions: [act({ action: "receive", qtyHold: null, qtyExpected: qty, stageSeq: 3 })],
      parts: [part({ qtyLive: qty, isMine: false, holderName: null })],
    });

  it("รอรับ 40: ปุ่ม 'รับ 40 ชิ้น' · รับครบ = ส่ง lotJobId โดยไม่มี qtyReceived", async () => {
    render(<WorkerApp token={TOKEN} view={recvView()} />);
    await userEvent.click(await screen.findByRole("button", { name: "รับ 40 ชิ้น" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
    const [tok, seq, , opts] = workerReceiveStage.mock.calls[0];
    expect([tok, seq]).toEqual([TOKEN, 3]);
    expect(opts).toEqual({ lotJobId: LOT0 });
  });

  it("ได้จริง 35 จาก 40 → ถามยืนยัน 'ส่วนต่าง 5 ชิ้น จะแจ้งกลับขั้นก่อน' ก่อน → ยืนยันแล้วส่ง qtyReceived=35", async () => {
    workerReceiveStage.mockResolvedValue({ ok: true, discrepancyQty: 5 });
    render(<WorkerApp token={TOKEN} view={recvView()} />);
    await screen.findByRole("button", { name: "รับ 40 ชิ้น" });
    await userEvent.click(screen.getByRole("button", { name: "ได้ไม่ครบ? แจ้งจำนวนที่ได้จริง" }));
    await setQty("ได้รับจริงกี่ชิ้น", "35");
    await userEvent.click(screen.getByRole("button", { name: "รับ 35 ชิ้น" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("รับ 35 จาก 40 ชิ้น — ส่วนต่าง 5 ชิ้น จะแจ้งกลับไปให้ขั้นก่อนชี้แจง");
    expect(workerReceiveStage).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "ยืนยัน รับ 35 ชิ้น" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
    expect(workerReceiveStage.mock.calls[0][3]).toEqual({ lotJobId: LOT0, qtyReceived: 35 });
    expect(await screen.findByText("รับ 35 ชิ้นแล้ว — ส่วนต่าง 5 ชิ้น แจ้งกลับขั้นก่อนแล้ว")).toBeInTheDocument();
  });

  it("'กลับไปแก้' ไม่ส่ง · กรอกเกินที่ส่งมา/ว่าง/0 = ข้อความ ไม่ส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={recvView()} />);
    await screen.findByRole("button", { name: "รับ 40 ชิ้น" });
    await userEvent.click(screen.getByRole("button", { name: "ได้ไม่ครบ? แจ้งจำนวนที่ได้จริง" }));
    await setQty("ได้รับจริงกี่ชิ้น", "41");
    await userEvent.click(screen.getByRole("button", { name: /^รับ / }));
    expect(await screen.findByText("รับได้ไม่เกินที่ส่งมา (40 ชิ้น)")).toBeInTheDocument();
    await setQty("ได้รับจริงกี่ชิ้น", "0");
    await userEvent.click(screen.getByRole("button", { name: /^รับ|^รับงาน/ }));
    expect(await screen.findByText(/จำนวนต้องอยู่ระหว่าง/)).toBeInTheDocument();
    await setQty("ได้รับจริงกี่ชิ้น", "30");
    await userEvent.click(screen.getByRole("button", { name: "รับ 30 ชิ้น" }));
    await userEvent.click(await screen.findByRole("button", { name: "กลับไปแก้" }));
    expect(workerReceiveStage).not.toHaveBeenCalled();
  });

  it("แพ้การแย่งรับ → เตือนเหลืองชื่อผู้ชนะ (ของเดิม)", async () => {
    workerReceiveStage.mockResolvedValue({ ok: true, already: true, by: "ช่างบี", message: "ช่าง ช่างบี รับขั้นนี้ไปแล้ว" });
    render(<WorkerApp token={TOKEN} view={recvView()} />);
    await userEvent.click(await screen.findByRole("button", { name: "รับ 40 ชิ้น" }));
    expect(await screen.findByTestId("done-warn")).toBeInTheDocument();
  });
});

describe("หลายส่วน — การ์ดชี้แจงส่วนต่าง", () => {
  const explainView = () =>
    view({
      myActions: [act({ action: "explain", qtyHold: null, qty: 5, stageName: "ขัด", discrepancyId: DISC, lotJobId: LOT1, label: "JB-0020 · ส่วนที่ 1" })],
      parts: [part({ lotJobId: LOT1, lotSeq: 1, label: "JB-0020 · ส่วนที่ 1", qtyLive: 0 })],
      scrapReasons: [], // DB ไม่ส่งเหตุผลให้คนที่ไม่มี action ส่ง — การ์ดใช้ชุดเหตุผลคงที่เอง
    });

  it("แสดงส่วนต่าง 5 ชิ้น · ต้องเลือกเสียหาย/หาย + เหตุผล ก่อนส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={explainView()} />);
    expect(await screen.findByText("ส่วนต่าง 5 ชิ้น — รอคุณชี้แจง")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันชี้แจง" }));
    expect(await screen.findByText("เลือกว่าเสียหายหรือหาย")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "เสียหาย" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันชี้แจง" }));
    expect(await screen.findByText("เลือกเหตุผล")).toBeInTheDocument();
    expect(workerResolve).not.toHaveBeenCalled();
  });

  it("เสียหาย + หัก → workerResolveDiscrepancyAction(token, {discrepancyId, kind:'scrap', reason:'broken'}) → จอสำเร็จ", async () => {
    render(<WorkerApp token={TOKEN} view={explainView()} />);
    await userEvent.click(await screen.findByRole("radio", { name: "เสียหาย" }));
    await userEvent.click(screen.getByRole("radio", { name: "หัก" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันชี้แจง" }));
    await waitFor(() => expect(workerResolve).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, kind: "scrap", reason: "broken" }));
    expect(await screen.findByText("ชี้แจงแล้ว — เสียหาย 5 ชิ้น")).toBeInTheDocument();
  });

  it("เลือก 'หาย' → เหตุผล 'หาย' ถูกเลือกให้ (เปลี่ยนได้) · ส่ง kind='lost'", async () => {
    render(<WorkerApp token={TOKEN} view={explainView()} />);
    await userEvent.click(await screen.findByRole("radio", { name: "หาย" }));
    expect(screen.getAllByRole("radio", { name: "หาย" }).some((r) => r.getAttribute("aria-checked") === "true")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันชี้แจง" }));
    await waitFor(() => expect(workerResolve).toHaveBeenCalledWith(TOKEN, { discrepancyId: DISC, kind: "lost", reason: "missing" }));
  });

  it("officeOnly (ทองที่มีน้ำหนักเทียบ): ไม่มีปุ่มชี้แจงบนหน้าช่าง · แสดง ให้ออฟฟิศเป็นผู้ชี้แจง · ไม่มีตัวเลขน้ำหนัก", async () => {
    const v = explainView();
    v.myActions = [{ ...v.myActions![0], officeOnly: true }];
    render(<WorkerApp token={TOKEN} view={v} />);
    expect(await screen.findByText("ส่วนต่าง 5 ชิ้น — รอออฟฟิศชี้แจง")).toBeInTheDocument();
    expect(screen.getByText(/ให้ออฟฟิศเป็นผู้ชี้แจง/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืนยันชี้แจง" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/d+(.d+)? ?(g|กรัม)/);
  });

  it("งานทองมีส่วนต่างน้ำหนัก → ช่างชี้แจงเองไม่ได้ (office_required) แสดงข้อความตายตัว", async () => {
    workerResolve.mockResolvedValue({ ok: false, error: "ส่วนต่างงานทองต้องให้ออฟฟิศชี้แจง", code: "office_required" });
    render(<WorkerApp token={TOKEN} view={explainView()} />);
    await userEvent.click(await screen.findByRole("radio", { name: "หาย" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยันชี้แจง" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ส่วนต่างงานทองต้องให้ออฟฟิศชี้แจง");
  });
});

describe("หลายส่วน — ภาพรวม", () => {
  it("หลายการ์ด: รอคุณรับ + คุณถืออยู่ · ส่วนอื่นพับไว้ · ไม่เปิดฟอร์มอัตโนมัติเมื่อมีมากกว่า 1 งาน", async () => {
    render(
      <WorkerApp
        token={TOKEN}
        view={view({
          myActions: [act({ qtyHold: 10, lotJobId: LOT1, label: "JB-0020 · ส่วนที่ 1" }), act({ action: "receive", lotJobId: LOT0, qtyHold: null, qtyExpected: 50, stageSeq: 3 })],
          parts: [
            part({ lotJobId: LOT0, qtyLive: 50, isMine: false }),
            part({ lotJobId: LOT1, lotSeq: 1, label: "JB-0020 · ส่วนที่ 1", qtyLive: 10 }),
            part({ lotJobId: LOT2, lotSeq: 2, label: "JB-0020 · ส่วนที่ 2", qtyLive: 40, stageCode: "plate", stageName: "ชุบ", holderName: "บ้านชุบ", isMine: false, days: 1 }),
          ],
        })}
      />
    );
    expect(await screen.findByRole("heading", { name: "รอคุณรับ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "คุณถืออยู่ในใบนี้" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับ 50 ชิ้น" })).toBeInTheDocument();
    expect(screen.queryByLabelText("จำนวนที่ส่ง")).not.toBeInTheDocument();
    expect(screen.getByText(/ส่วนอื่นในใบนี้ \(ไม่ใช่ของคุณ\) · 1/)).toBeInTheDocument();
    expect(screen.getByText(/ส่วนที่ 2 · ที่ ชุบ · บ้านชุบ/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ" }));
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("10");
  });

  it("ส่วนที่ฉันแยกเอง + ยังไม่มีคนรับ → ปุ่มยกเลิกการแยกในรายการส่วนอื่น", async () => {
    render(
      <WorkerApp
        token={TOKEN}
        view={view({ myActions: [act({ qtyHold: 10 })], parts: [part({ qtyLive: 10 }), part({ lotJobId: LOT2, lotSeq: 2, label: "x", qtyLive: 40, isMine: false, canCancelSplit: true, stageName: "ชุบ", holderName: null })] })}
      />
    );
    await screen.findByRole("heading", { name: "คุณถืออยู่ในใบนี้" });
    await userEvent.click(screen.getByText(/ส่วนอื่นในใบนี้/));
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกการแยกส่วนนี้" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน ยกเลิกการแยก" }));
    await waitFor(() => expect(workerCancelLot).toHaveBeenCalledWith(TOKEN, LOT2, null));
  });

  it("ไม่มีส่วนของคุณ → ข้อความว่าง", async () => {
    render(<WorkerApp token={TOKEN} view={view({ myActions: [], parts: [] })} />);
    expect(await screen.findByText("ตอนนี้ไม่มีส่วนของคุณในใบนี้")).toBeInTheDocument();
  });

  it("🔴 ไม่มีตัวเลขเงิน/ต้นทุน/ชื่อลูกค้าบนจอ และ view ผ่านด่าน findForbiddenKeys", async () => {
    const v = view({ myActions: [act(), act({ action: "receive", qtyHold: null, qtyExpected: 40, lotJobId: LOT1 })] });
    expect(findForbiddenKeys(v)).toEqual([]);
    render(<WorkerApp token={TOKEN} view={v} />);
    await screen.findByRole("heading", { name: "รอคุณรับ" });
    expect(document.body.textContent ?? "").not.toMatch(/บาท|฿|ราคา|ต้นทุน|กำไร|ลูกค้า|THB/);
  });
});

describe("ใบเดี่ยว (ไม่แบ่ง) — หน้าเดิม", () => {
  const solo = (o: Partial<WorkerView> = {}) =>
    view({ nextAction: "send", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: false }, ...o });

  it("ไม่มี my_actions (view เดิม): ไม่มีปุ่ม 'ส่งไม่ครบ?' · ส่งแบบเดิมเป๊ะ (ไม่มี lotJobId/qtyHold/qtySend)", async () => {
    render(<WorkerApp token={TOKEN} view={solo({ myActions: undefined, parts: undefined })} />);
    expect(screen.queryByText("ส่งไม่ครบ? แบ่งส่งบางส่วน")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /^ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    for (const k of ["lotJobId", "qtyHold", "qtySend"]) expect(input).not.toHaveProperty(k);
  });

  it("มี my_actions (DB ใหม่) แต่ไม่เปิดช่อง: ส่งทั้งหมดแบบเดิมเป๊ะ · มีแค่ปุ่มเสริม 'ส่งไม่ครบ?'", async () => {
    render(<WorkerApp token={TOKEN} view={solo()} />);
    expect(await screen.findByText("ส่งไม่ครบ? แบ่งส่งบางส่วน")).toBeInTheDocument();
    expect(screen.queryByLabelText("จำนวนที่ส่ง")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    for (const k of ["lotJobId", "qtyHold", "qtySend"]) expect(input).not.toHaveProperty(k);
  });

  it("ใบเดี่ยวกดเปิด 'ส่งไม่ครบ?' แล้วส่ง 20 จาก 50 → qtySend=20 qtyHold=50 (ไม่ต้องระบุส่วน = ใบของ token)", async () => {
    render(<WorkerApp token={TOKEN} view={solo()} />);
    await userEvent.click(await screen.findByText("ส่งไม่ครบ? แบ่งส่งบางส่วน"));
    await setQty("จำนวนที่ส่ง", "20");
    await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ 20 จาก 50 ชิ้น" }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    expect(input).toMatchObject({ qtySend: 20, qtyHold: 50 });
    expect(input).not.toHaveProperty("lotJobId");
  });

  it("ใบเดี่ยวรับ: ปุ่มยังเป็น 'รับงาน' · มีลิงก์ 'ได้ไม่ครบ?' เมื่อ DB บอกจำนวนที่ส่งมา ≥ 2 · รับตามปกติเรียก 3 อาร์กิวเมนต์เหมือนเดิม", async () => {
    render(
      <WorkerApp
        token={TOKEN}
        view={view({ nextAction: "receive", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: false }, myActions: [act({ action: "receive", qtyHold: null, qtyExpected: 12 })] })}
      />
    );
    expect(await screen.findByRole("button", { name: "ได้ไม่ครบ? แจ้งจำนวนที่ได้จริง" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
    expect(workerReceiveStage.mock.calls[0]).toHaveLength(3);
  });
});

describe("0181 re-review: ล็อกรับไม่ครบ (L-2) · weight_move_over", () => {
  const recv = () =>
    view({
      myActions: [act({ action: "receive", qtyHold: null, qtyExpected: 40, stageSeq: 3 })],
      parts: [part({ qtyLive: 40, isMine: false, holderName: null })],
    }, { metal: "gold" });

  it("ทองรับไม่ครบ ชั่งไม่ตรงครบ 3 ครั้ง → ข้อความล็อกตายตัว (ไม่บอกว่าชั่งผิดเท่าไร) ไม่มีปุ่มโหลดใหม่หลอก", async () => {
    workerReceiveStage.mockResolvedValue({ ok: false, code: "office_required", error: WORKER_RECEIVE_LOCK_TH });
    render(<WorkerApp token={TOKEN} view={recv()} />);
    await userEvent.click(await screen.findByRole("button", { name: "ได้ไม่ครบ? แจ้งจำนวนที่ได้จริง" }));
    await setQty("ได้รับจริงกี่ชิ้น", "35");
    await userEvent.click(screen.getByRole("button", { name: "รับ 35 ชิ้น" }));
    await userEvent.click(await screen.findByRole("button", { name: "ยืนยัน รับ 35 ชิ้น" }));
    const a = await screen.findByRole("alert");
    expect(a).toHaveTextContent("แจ้งออฟฟิศให้เป็นผู้รับงาน");
    expect(a.textContent ?? "").not.toMatch(/\d+(\.\d+)? ?(g|กรัม)\b/);
    expect(screen.queryByRole("button", { name: "โหลดใหม่" })).not.toBeInTheDocument();
  });

  it("แยกส่วนทอง น้ำหนักส่วนที่แยกเกิน → weight_move_over ข้อความไทยบนจอแยกส่วน", async () => {
    workerSendStage.mockResolvedValue({ ok: false, code: "weight_move_over", error: WORKER_CODE_TH.weight_move_over });
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: true })] }, { metal: "gold" })} />);
    await screen.findByText("ส่งต่อกี่ชิ้น จาก 50");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.type(screen.getByLabelText(/น้ำหนักส่วนที่ส่ง/), "999");
    await userEvent.click(screen.getByRole("button", { name: "ส่งต่อ 40 จาก 50 ชิ้น" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("น้ำหนักส่วนที่แยกมากเกินน้ำหนักที่ถืออยู่");
  });
});
