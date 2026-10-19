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
    expect(await screen.findByText("ส่งกี่ชิ้น")).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("50");
    await userEvent.click(sendBtn("ส่งหมด 50 ชิ้น"));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const [tok, input] = workerSendStage.mock.calls[0];
    expect(tok).toBe(TOKEN);
    expect(input).toMatchObject({ expectedSeq: 3, lotJobId: LOT0, qtyHold: 50, qtyScrap: 0 });
    expect(input).not.toHaveProperty("qtySend");
  });

  it("ส่ง 40 จาก 50 → qtySend=40 และ qtyHold=50 (จำนวนที่เห็นบนจอ) · ไม่ชั่ง/ไม่เติมโลหะตอนแยก (ค1)", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    // ใบเดิม (ไม่มีแบบการบันทึก) ปกติมีช่องน้ำหนักออก — ตอนแยกต้องหาย
    expect(screen.getByLabelText(/น้ำหนักออก/)).toBeInTheDocument();
    await setQty("จำนวนที่ส่ง", "40");
    expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ เติมโลหะ" })).not.toBeInTheDocument();
    expect(screen.getByText("เหลือกับฉัน").nextSibling).toHaveTextContent("10");
    expect(screen.getByText("ส่งไป").nextSibling).toHaveTextContent("40");
    await userEvent.click(sendBtn("ส่ง 40 ชิ้น · เหลือกับฉัน 10"));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    expect(workerSendStage.mock.calls[0][1]).toMatchObject({ expectedSeq: 3, lotJobId: LOT0, qtySend: 40, qtyHold: 50, weightOut: null });
  });

  it("กดซ้ำรัวๆ ส่งครั้งเดียว", async () => {
    let release: (v: unknown) => void = () => {};
    workerSendStage.mockImplementation(() => new Promise((r) => (release = r)));
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "40");
    const b = sendBtn("ส่ง 40 ชิ้น · เหลือกับฉัน 10");
    await userEvent.dblClick(b);
    await userEvent.click(b);
    release({ ok: true });
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
  });

  it("จำนวนผิด: ว่าง/0/เกิน → ปุ่มปิดและบอกเหตุผลบนปุ่ม · ไม่เรียก action · เพิ่มของเสียจน n เกิน = ลด n ให้เอง", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "");
    expect(sendBtn("ใส่จำนวนที่ส่ง")).toBeDisabled();
    await setQty("จำนวนที่ส่ง", "0");
    expect(sendBtn("ใส่จำนวนที่ส่ง")).toBeDisabled();
    expect(screen.getByText(/จำนวนต้องอยู่ระหว่าง/)).toBeInTheDocument();
    await setQty("จำนวนที่ส่ง", "51");
    expect(sendBtn("ส่งได้ไม่เกิน 50 ชิ้น")).toBeDisabled();
    expect(screen.getByText("ส่งได้ไม่เกิน 50 ชิ้น", { selector: "p" })).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
    // แถวของเสียพับอยู่ → เปิด → เสีย 1 → ส่งได้ไม่เกิน 49 (ถือ − เสีย)
    await userEvent.click(screen.getByRole("button", { name: /ของเสียขั้นนี้/ }));
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(screen.getByRole("radio", { name: "หัก" }));
    await setQty("จำนวนที่ส่ง", "50");
    expect(sendBtn("ส่งได้ไม่เกิน 49 ชิ้น")).toBeDisabled();
    // n แตะเอง = 49 (พอดีส่งหมด) แล้วเพิ่มเสียอีก → n ถูกลดเป็น 48 ให้เอง (ช่างไม่ได้ผิด)
    await setQty("จำนวนที่ส่ง", "49");
    expect(sendBtn("ส่ง 49 ชิ้น · เสีย 1")).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("48");
    expect(workerSendStage).not.toHaveBeenCalled();
  });

  it("ช่อง '1,5' / '3.5' พิมพ์ไม่ได้ (ตัวเลขล้วน) และไม่กลายเป็นเลขอื่นเงียบๆ", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "3.5");
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("35"); // ตัวเลขล้วน: จุดถูกตัดตอนพิมพ์ — เห็นค่าจริงบนจอ + ปุ่มบอกจำนวนชัด
    expect(sendBtn("ส่ง 35 ชิ้น · เหลือกับฉัน 15")).toBeInTheDocument();
  });

  it("แยกสำเร็จ → จอ 'แบ่งส่วนแล้ว' (ส่วนที่ 2 = 40 · ค้างกับคุณ 10) + QR ใบเดิมบนจอ + ไม่ปิดเอง", async () => {
    workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "JB-0020 · ส่วนที่ 2", qty: 40, parentRemaining: 10 } });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่ง 40 ชิ้น · เหลือกับฉัน 10"));
    expect(await screen.findByText("ส่งแล้ว 40 ชิ้น")).toBeInTheDocument();
    expect(screen.getByText("ส่วนที่ 2")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("เหลือกับคุณ").closest("li")).toHaveTextContent("10");
    const qr = screen.getByRole("img", { name: "QR ใบงาน JB-0020" });
    expect(qr.innerHTML).toContain("<svg");
    expect(qr.innerHTML).not.toContain(TOKEN); // token อยู่ในรูปโมดูลเท่านั้น
    expect(screen.getByText("ให้คนรับสแกนจากจอนี้")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 2300)); // ไม่ปิดเองเหมือนจอสำเร็จทั่วไป (2 วิ)
    expect(screen.getByText("ส่งแล้ว 40 ชิ้น")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "เสร็จแล้ว" }));
    expect(refresh).toHaveBeenCalled();
  }, 15000);

  it("ยกเลิกการแยก: ถามยืนยันก่อน → workerCancelLotAction(token, ส่วนใหม่, null) → จอสำเร็จ 'ชิ้นกลับมาอยู่กับคุณ'", async () => {
    workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "x", qty: 40, parentRemaining: 10 } });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่ง 40 ชิ้น · เหลือกับฉัน 10"));
    await userEvent.click(await screen.findByRole("button", { name: "ส่งผิด? ยกเลิกการส่ง 40 ชิ้น" }));
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
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.click(sendBtn("ส่ง 40 ชิ้น · เหลือกับฉัน 10"));
    await userEvent.click(await screen.findByRole("button", { name: "ส่งผิด? ยกเลิกการส่ง 40 ชิ้น" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน ยกเลิกการแยก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ส่วนนี้มีคนรับไปแล้ว ยกเลิกเองไม่ได้ — แจ้งออฟฟิศ");
    expect(screen.getByText("ส่งแล้ว 40 ชิ้น")).toBeInTheDocument();
  });

  it("stage_changed (2 มือถือ/กดซ้ำ) → ข้อความไทย + ปุ่มโหลดใหม่", async () => {
    workerSendStage.mockResolvedValue({ ok: false, error: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง", code: "stage_changed" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await userEvent.click(sendBtn("ส่งหมด 50 ชิ้น"));
    expect(await screen.findByRole("alert")).toHaveTextContent("งานเปลี่ยนไปแล้ว");
    await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    expect(refresh).toHaveBeenCalled();
  });

  describe("ทอง + ขั้นชั่ง: แยกส่วนต้องชั่งส่วนที่แยกออก (H2 · มติ 19 ต.ค.)", () => {
    const gold = (o: Partial<WorkerAction> = {}, v: Partial<WorkerView> = {}) =>
      view({ myActions: [act({ weightRequired: true, ...o })], parts: [part()], ...v }, { metal: "gold" });
    const openSplit = async (n = "40") => {
      render(<WorkerApp token={TOKEN} view={gold()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", n);
    };

    it("ส่งน้อยกว่าที่ถือ: มีช่อง 'น้ำหนักส่วนที่ส่ง' บังคับ · ไม่มีช่องน้ำหนักออก/ไม่มีน้ำหนักขั้นก่อน/น้ำหนักที่ถือ", async () => {
      await openSplit();
      expect(screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/)).toBeInTheDocument();
      expect(screen.getByText(/— ต้องใส่/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toMatch(/ครั้งก่อนส่งออก|ถืออยู่ \d+(\.\d+)? กรัม/);
    });

    it("ไม่ชั่ง = ไม่ส่ง (ข้อความใต้ช่อง) · 0 / ค่าเพี้ยน / ทศนิยมเกิน 3 ตำแหน่ง = ปฏิเสธฝั่งหน้าจอ", async () => {
      await openSplit();
      const btn = () => screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 10" });
      await userEvent.click(btn());
      expect(await screen.findByText(/ต้องชั่งน้ำหนักส่วนที่ส่งก่อน/)).toBeInTheDocument();
      for (const v of ["0", "1.2345", "1.2.3"]) {
        const f = screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/);
        await userEvent.clear(f);
        await userEvent.type(f, v);
        await userEvent.click(btn());
        await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
      }
      expect(workerSendStage).not.toHaveBeenCalled();
    });

    it("ชั่ง '12,5' → weightMoveG ส่งไปพร้อม qtySend=40 qtyHold=50 (ตัวแปลง 12,5 = 12.5 อยู่ที่ action) · ไม่ส่ง weightOut", async () => {
      await openSplit();
      await userEvent.type(screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/), "12,5");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 10" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).toMatchObject({ qtySend: 40, qtyHold: 50, weightMoveG: "12,5", weightOut: null, lotJobId: LOT0 });
    });

    it("ส่งทั้งหมด (ค่าเริ่ม): ไม่มีช่องน้ำหนักส่วนที่ส่ง · ชั่งน้ำหนักออกตามปกติ · ห้ามส่ง weightMoveG", async () => {
      render(<WorkerApp token={TOKEN} view={gold()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      expect(screen.queryByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/)).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "20.5");
      await userEvent.click(screen.getByRole("button", { name: "ส่งหมด 50 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      const input = workerSendStage.mock.calls[0][1];
      expect(input).not.toHaveProperty("weightMoveG");
      expect(input).not.toHaveProperty("qtySend");
      expect(input).toMatchObject({ weightOut: "20.5" });
    });

    it("เงิน (ขั้นชั่ง) และทองที่ขั้นไม่ชั่ง: ไม่มีช่องน้ำหนักส่วนที่ส่ง ไม่ส่ง weightMoveG", async () => {
      const a = render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: true })] })} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "40");
      expect(screen.queryByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 10" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).not.toHaveProperty("weightMoveG");
      a.unmount();
      workerSendStage.mockClear();
      render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: false })] }, { metal: "gold" })} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "40");
      expect(screen.queryByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/)).not.toBeInTheDocument();
    });

    it("DB ตอบ weight_move_required / weight_over → ข้อความไทยบนจอ", async () => {
      workerSendStage.mockResolvedValue({ ok: false, error: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน", code: "weight_move_required" });
      await openSplit();
      await userEvent.type(screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/), "5");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 10" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน");
    });

    it("ใบเดี่ยวที่เป็นทอง (ไม่ใช่ multi): แยกส่วนได้เหมือนกัน · ต้องชั่งส่วนที่แยก", async () => {
      render(
        <WorkerApp
          token={TOKEN}
          view={view({ nextAction: "send", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: true }, myActions: [act({ weightRequired: true })] }, { metal: "gold" })}
        />
      );
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "20");
      expect(screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/)).toBeInTheDocument();
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
    await setQty("จำนวนที่ได้รับ", "35");
    await userEvent.click(screen.getByRole("button", { name: "รับ 35 ชิ้น · ขาด 5" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("รับ 35 จาก 40 ชิ้น — ขาด 5 ชิ้น ขั้นก่อนจะถูกถามว่าเสียหายหรือหาย ถูกไหม");
    expect(workerReceiveStage).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "ถูก รับ 35 ชิ้น" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
    expect(workerReceiveStage.mock.calls[0][3]).toEqual({ lotJobId: LOT0, qtyReceived: 35 });
    expect(await screen.findByText("รับ 35 ชิ้นแล้ว — ขาด 5 ชิ้น แจ้งขั้นก่อนแล้ว")).toBeInTheDocument();
  });

  it("'กลับไปแก้' ไม่ส่ง · เกิน/ว่าง/0 = ปุ่มปิดและบอกเหตุผลบนปุ่ม", async () => {
    render(<WorkerApp token={TOKEN} view={recvView()} />);
    await screen.findByRole("button", { name: "รับ 40 ชิ้น" });
    await setQty("จำนวนที่ได้รับ", "41");
    expect(screen.getByRole("button", { name: "รับได้ไม่เกิน 40 ชิ้น" })).toBeDisabled();
    await setQty("จำนวนที่ได้รับ", "0");
    expect(screen.getByRole("button", { name: "ใส่จำนวนที่ได้รับ" })).toBeDisabled();
    await setQty("จำนวนที่ได้รับ", "30");
    await userEvent.click(screen.getByRole("button", { name: "รับ 30 ชิ้น · ขาด 10" }));
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

  it("ไม่มี my_actions (view เก่าที่ไม่ส่งจำนวน): ไม่มีบล็อกจำนวน · ส่งแบบเดิมเป๊ะ (ไม่มี lotJobId/qtyHold/qtySend)", async () => {
    render(<WorkerApp token={TOKEN} view={solo({ myActions: undefined, parts: undefined })} />);
    expect(screen.queryByLabelText("จำนวนที่ส่ง")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qty-headline")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /^ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    for (const k of ["lotJobId", "qtyHold", "qtySend"]) expect(input).not.toHaveProperty(k);
  });

  it("มี my_actions: บล็อกจำนวนเห็นเสมอ (ไม่ซ่อนหลังลิงก์) · ส่งทั้งหมด = ไม่ส่ง qtySend/lotJobId · ส่ง qtyHold", async () => {
    render(<WorkerApp token={TOKEN} view={solo()} />);
    expect(await screen.findByText("ส่งกี่ชิ้น")).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("50");
    await userEvent.click(screen.getByRole("button", { name: "ส่งหมด 50 ชิ้น" }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    for (const k of ["lotJobId", "qtySend"]) expect(input).not.toHaveProperty(k);
    expect(input).toMatchObject({ qtyHold: 50 });
  });

  it("ใบเดี่ยวส่ง 20 จาก 50 → qtySend=20 qtyHold=50 (ไม่ต้องระบุส่วน = ใบของ token)", async () => {
    render(<WorkerApp token={TOKEN} view={solo()} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "20");
    await userEvent.click(screen.getByRole("button", { name: "ส่ง 20 ชิ้น · เหลือกับฉัน 30" }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    const input = workerSendStage.mock.calls[0][1];
    expect(input).toMatchObject({ qtySend: 20, qtyHold: 50 });
    expect(input).not.toHaveProperty("lotJobId");
  });

  it("ใบเดี่ยวรับ: บล็อก 'รับเข้า 12 จาก 12' เห็นเสมอ · ปุ่ม 'รับ 12 ชิ้น' · รับตามปกติเรียก 3 อาร์กิวเมนต์เหมือนเดิม", async () => {
    render(
      <WorkerApp
        token={TOKEN}
        view={view({ nextAction: "receive", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: false }, myActions: [act({ action: "receive", qtyHold: null, qtyExpected: 12 })] })}
      />
    );
    expect(await screen.findByLabelText("จำนวนที่ได้รับ")).toHaveValue("12");
    await userEvent.click(screen.getByRole("button", { name: "รับ 12 ชิ้น" }));
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
    await screen.findByLabelText("จำนวนที่ได้รับ");
    await setQty("จำนวนที่ได้รับ", "35");
    await userEvent.click(screen.getByRole("button", { name: "รับ 35 ชิ้น · ขาด 5" }));
    await userEvent.click(await screen.findByRole("button", { name: "ถูก รับ 35 ชิ้น" }));
    const a = await screen.findByRole("alert");
    expect(a).toHaveTextContent("แจ้งออฟฟิศให้เป็นผู้รับงาน");
    expect(a.textContent ?? "").not.toMatch(/\d+(\.\d+)? ?(g|กรัม)\b/);
    expect(screen.queryByRole("button", { name: "โหลดใหม่" })).not.toBeInTheDocument();
  });

  it("แยกส่วนทอง น้ำหนักส่วนที่แยกเกิน → weight_move_over ข้อความไทยบนจอแยกส่วน", async () => {
    workerSendStage.mockResolvedValue({ ok: false, code: "weight_move_over", error: WORKER_CODE_TH.weight_move_over });
    render(<WorkerApp token={TOKEN} view={view({ myActions: [act({ weightRequired: true })] }, { metal: "gold" })} />);
    await screen.findByText("ส่งกี่ชิ้น");
    await setQty("จำนวนที่ส่ง", "40");
    await userEvent.type(screen.getByLabelText(/น้ำหนัก \d+ ชิ้นที่ส่ง/), "999");
    await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 10" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("น้ำหนักส่วนที่แยกมากเกินน้ำหนักที่ถืออยู่");
  });
});

describe("nit 9: เงินใบเดี่ยวรับไม่ครบ ข้ามเตือนน้ำหนัก", () => {
  const soloRecv = () =>
    view({ nextAction: "receive", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: true }, prevWeightOutG: 10, myActions: [act({ action: "receive", qtyHold: null, qtyExpected: 12, weightRequired: true })] });
  it("รับครบ + น้ำหนักต่างจากขั้นก่อน >20% → ยังเตือน (ของเดิม)", async () => {
    render(<WorkerApp token={TOKEN} view={soloRecv()} />);
    await userEvent.type(await screen.findByLabelText(/น้ำหนักเข้า/), "5");
    await userEvent.click(screen.getByRole("button", { name: "รับ 12 ชิ้น" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("ต่างจากที่ขั้นก่อนส่งมา");
    expect(workerReceiveStage).not.toHaveBeenCalled();
  });
  it("รับไม่ครบ (ได้ 8 จาก 12) + น้ำหนักต่างมาก → ไม่เตือนน้ำหนัก (ชิ้นต่างกัน เทียบทั้งก้อนไม่ได้) · เหลือแค่ยืนยันส่วนต่าง", async () => {
    render(<WorkerApp token={TOKEN} view={soloRecv()} />);
    await userEvent.type(await screen.findByLabelText(/น้ำหนักเข้า/), "5");
    await setQty("จำนวนที่ได้รับ", "8");
    await userEvent.click(screen.getByRole("button", { name: "รับ 8 ชิ้น · ขาด 4" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("รับ 8 จาก 12 ชิ้น");
    expect(dlg.textContent ?? "").not.toMatch(/ต่างจากที่ขั้นก่อนส่งมา/);
  });
});

describe("จอส่ง/รับ v2 (ux-worker-send-receive-v2) — ใบเดี่ยว 53 ชิ้น: เลขตัดสินตัวเดียว + แถบ + ปุ่มพูดผล", () => {
  const NEXT = { seq: 4, code: "qc", name: "ตรวจ QC", status: "pending" } as WorkerView["job"]["stages"][number];
  const soloSend = (qty = 53, withNext = false) =>
    view(
      { nextAction: "send", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: false }, myActions: [act({ qtyHold: qty })], parts: [part({ qtyLive: qty })] },
      withNext ? { stages: [...stages, NEXT] } : {}
    );
  const soloRecv = (qty = 53) => view({ nextAction: "receive", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: false }, myActions: [act({ action: "receive", qtyHold: null, qtyExpected: qty })], parts: [part({ qtyLive: qty })] });
  const legend = (label: string) => screen.getByText(label).nextSibling;
  const openScrap = async () => userEvent.click(screen.getByRole("button", { name: /ของเสียขั้นนี้/ }));
  const addScrap = async (n: number) => {
    for (let i = 0; i < n; i++) await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(screen.getByRole("radio", { name: "หัก" }));
  };

  describe("จอส่ง", () => {
    it("การ์ดตัดสินใจ: 'ส่งกี่ชิ้น' + เลขกลางตัวเดียว 53 (text-5xl) + 'ในมือฉัน 53 ชิ้น' + แถบ + ชิป 'ส่งหมด 53' กดอยู่ + ปุ่ม 'ส่งหมด 53 ชิ้น' · ไม่มีหัวจอเลขซ้ำ", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      expect(await screen.findByText("ส่งกี่ชิ้น")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("ส่งงาน: ฝังพลอย");
      const stepper = screen.getByLabelText("จำนวนที่ส่ง");
      expect(stepper).toHaveValue("53");
      expect(stepper).toHaveClass("text-5xl");
      expect(screen.getByText("ในมือฉัน 53 ชิ้น")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ส่งหมด 53" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "ส่งหมด 53 ชิ้น" })).toBeEnabled();
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ในมือ 53 ชิ้น ส่งไป 53 เหลือกับฉัน 0");
      expect(legend("ส่งไป")).toHaveTextContent("53");
      expect(legend("เหลือกับฉัน")).toHaveTextContent("0");
      expect(screen.queryByTestId("qty-headline")).not.toBeInTheDocument();
      expect(screen.queryByText(/คุณถืออยู่/)).not.toBeInTheDocument();
      // ไม่มีศัพท์เก่า (ส่งต่อ/ค้าง/ส่วนใหม่) บนจอส่ง
      expect(document.body.textContent ?? "").not.toMatch(/ค้างกับ|ส่วนใหม่|ส่งต่อกี่|ส่งออก/);
    });
    it("ถัดไป: ชื่อขั้นถัดไปใต้หัว · ส่งหมดสำเร็จ 'ส่งแล้ว 53 ชิ้น — ถัดไป ตรวจ QC'", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend(53, true)} />);
      expect(await screen.findByText("ถัดไป: ตรวจ QC")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "ส่งหมด 53 ชิ้น" }));
      expect(await screen.findByText("ส่งแล้ว 53 ชิ้น — ถัดไป ตรวจ QC")).toBeInTheDocument();
    });
    it("ส่งหมด = payload เดิม: ไม่มี qtySend · ไม่มี lotJobId · ส่ง qtyHold 53", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await userEvent.click(screen.getByRole("button", { name: "ส่งหมด 53 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      const input = workerSendStage.mock.calls[0][1];
      expect(input).toMatchObject({ expectedSeq: 3, qtyScrap: 0, qtyHold: 53 });
      for (const k of ["qtySend", "lotJobId", "weightMoveG"]) expect(input).not.toHaveProperty(k);
    });
    it("ส่ง 40: legend ส่งไป 40 / เหลือกับฉัน 13 · 'ที่เหลือส่งทีหลังได้' · ปุ่ม 'ส่ง 40 ชิ้น · เหลือกับฉัน 13' · ชิปไม่กด · payload qtySend 40 + qtyHold 53 · เงินไม่มีช่องชั่ง + คำอธิบาย", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "40");
      expect(legend("ส่งไป")).toHaveTextContent("40");
      expect(legend("เหลือกับฉัน")).toHaveTextContent("13");
      expect(screen.getByText("ที่เหลือส่งทีหลังได้")).toBeInTheDocument();
      expect(screen.getByText("ส่งบางส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่ง")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ส่งหมด 53" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ในมือ 53 ชิ้น ส่งไป 40 เหลือกับฉัน 13");
      expect(screen.queryByText(/ส่วนใหม่/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 13" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).toMatchObject({ qtySend: 40, qtyHold: 53 });
      expect(workerSendStage.mock.calls[0][1]).not.toHaveProperty("lotJobId");
    });
    it("ของเสียพับเป็นแถว 'ของเสียขั้นนี้ · ไม่มี' (เลข 48px ของเสียไม่ตั้งตระหง่าน) · กดแล้วเปิด · เปิดค้างเมื่อ > 0 · เก็บได้เมื่อ 0", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      expect(screen.queryByRole("button", { name: "เพิ่มของเสีย" })).not.toBeInTheDocument();
      const row = screen.getByRole("button", { name: /ของเสียขั้นนี้/ });
      expect(row).toHaveTextContent("ของเสียขั้นนี้ · ไม่มี");
      await userEvent.click(row);
      expect(screen.getByRole("button", { name: "เพิ่มของเสีย" })).toBeInTheDocument();
      expect(document.querySelector("output")).toHaveClass("text-3xl"); // compact 30px
      await userEvent.click(screen.getByRole("button", { name: "เก็บแถวของเสีย" }));
      expect(screen.queryByRole("button", { name: "เพิ่มของเสีย" })).not.toBeInTheDocument();
      await openScrap();
      await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
      expect(screen.queryByRole("button", { name: "เก็บแถวของเสีย" })).not.toBeInTheDocument(); // > 0 = เก็บไม่ได้ (เหตุผลบังคับต้องเห็น)
    });
    it("เสีย 3: ค่าเริ่มส่งหมดหักเสียตามสด (50) · legend 3 ช่อง (เสีย 3) · ปุ่ม 'ส่ง 50 ชิ้น · เสีย 3' · ชิปเป็น 'ส่งหมด 50' · payload ไม่มี qtySend + qtyScrap 3", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await openScrap();
      await addScrap(3);
      expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("50");
      expect(screen.getByRole("button", { name: "ส่งหมด 50" })).toHaveAttribute("aria-pressed", "true");
      expect(legend("เสีย")).toHaveTextContent("3");
      expect(legend("ส่งไป")).toHaveTextContent("50");
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ในมือ 53 ชิ้น ส่งไป 50 เหลือกับฉัน 0 เสีย 3");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 50 ชิ้น · เสีย 3" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      const input = workerSendStage.mock.calls[0][1];
      expect(input).toMatchObject({ qtyScrap: 3, scrapReason: "broken", qtyHold: 53 });
      expect(input).not.toHaveProperty("qtySend");
    });
    it("เสีย 2 + ส่ง 40 → เหลือกับฉัน 11 (40+11+2 = 53 เลขคี่) · ปุ่ม 'ส่ง 40 ชิ้น · เสีย 2 · เหลือกับฉัน 11' · qtySend 40 qtyScrap 2", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await openScrap();
      await addScrap(2);
      await setQty("จำนวนที่ส่ง", "40");
      expect(legend("เหลือกับฉัน")).toHaveTextContent("11");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เสีย 2 · เหลือกับฉัน 11" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).toMatchObject({ qtySend: 40, qtyScrap: 2, qtyHold: 53 });
    });
    it("ชิป 'ส่งหมด N' คืนโหมดตามสดหลังพิมพ์เอง", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "7");
      expect(screen.getByRole("button", { name: "ส่งหมด 53" })).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(screen.getByRole("button", { name: "ส่งหมด 53" }));
      expect(screen.getByLabelText("จำนวนที่ส่ง")).toHaveValue("53");
      expect(legend("เหลือกับฉัน")).toHaveTextContent("0");
    });
    it("Q2 เสียหมดทั้งก้อน (DB ยอม: job_core_send ให้เสียได้ถึงจำนวนที่ถือ): ปุ่ม 'แจ้งเสียหมด 3 ชิ้น' ไม่ใช่ 'ส่ง 0 ชิ้น' · ต้องเลือกเหตุผล · payload qtyScrap 3 ไม่มี qtySend", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend(3)} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await openScrap();
      for (let i = 0; i < 3; i++) await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
      const btn = screen.getByRole("button", { name: "แจ้งเสียหมด 3 ชิ้น" });
      expect(btn).toBeEnabled();
      expect(screen.queryByRole("button", { name: /^ส่ง 0/ })).not.toBeInTheDocument();
      await userEvent.click(btn);
      expect(await screen.findByText("เลือกเหตุผลของเสีย")).toBeInTheDocument();
      expect(workerSendStage).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("radio", { name: "หัก" }));
      await userEvent.click(screen.getByRole("button", { name: "แจ้งเสียหมด 3 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      const input = workerSendStage.mock.calls[0][1];
      expect(input).toMatchObject({ qtyScrap: 3, qtyHold: 3 });
      expect(input).not.toHaveProperty("qtySend");
    });
    it("ถือชิ้นเดียว: อ่านอย่างเดียว 'ส่ง 1 ชิ้น' (ไม่มีช่อง/แถบ) · ปุ่ม 'ส่ง 1 ชิ้น' · qtyHold 1 ไม่มี qtySend", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend(1)} />);
      expect(await screen.findByRole("button", { name: "ส่ง 1 ชิ้น" })).toBeEnabled();
      expect(screen.queryByLabelText("จำนวนที่ส่ง")).not.toBeInTheDocument();
      expect(screen.queryByTestId("qty-bar")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 1 ชิ้น" }));
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
      expect(workerSendStage.mock.calls[0][1]).toMatchObject({ qtyHold: 1 });
      expect(workerSendStage.mock.calls[0][1]).not.toHaveProperty("qtySend");
    });
    it("กดปุ่มหลักรัวๆ ส่งครั้งเดียว · ระหว่างส่ง stepper/ชิป ถูกปิด", async () => {
      let release: (v: unknown) => void = () => {};
      workerSendStage.mockImplementation(() => new Promise((r) => (release = r)));
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      const b = screen.getByRole("button", { name: "ส่งหมด 53 ชิ้น" });
      await userEvent.dblClick(b);
      expect(screen.getByLabelText("จำนวนที่ส่ง")).toBeDisabled();
      expect(screen.getByRole("button", { name: "ส่งหมด 53" })).toBeDisabled();
      release({ ok: true });
      await waitFor(() => expect(workerSendStage).toHaveBeenCalledTimes(1));
    });
    it("ขนาดสัมผัส: ปุ่ม ± 56px · ชิป 48px · ตัวเลข legend 24px (text-2xl)", async () => {
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      expect(screen.getByRole("button", { name: "ลดจำนวนที่ส่ง" })).toHaveClass("h-14", "w-14");
      expect(screen.getByRole("button", { name: "ส่งหมด 53" })).toHaveClass("min-h-12");
      expect(legend("ส่งไป")).toHaveClass("text-2xl");
    });
    it("ทอง ขั้นชั่ง ส่งไม่หมด: การ์ดน้ำหนัก 'น้ำหนัก 40 ชิ้นที่ส่ง' บังคับ (ไม่ปิดปุ่มหลัก) · ว่าง = ข้อความใต้ช่อง · ไม่มีกรัมของขั้นก่อน/ที่ถือบนจอ", async () => {
      render(<WorkerApp token={TOKEN} view={view({ nextAction: "send", actionStage: { seq: 3, code: "setting", name: "ฝังพลอย", weightRequired: true }, myActions: [act({ qtyHold: 53, weightRequired: true })], parts: [part({ qtyLive: 53 })] }, { metal: "gold" })} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "40");
      expect(screen.getByLabelText("น้ำหนัก 40 ชิ้นที่ส่ง (กรัม) — ต้องใส่")).toBeInTheDocument();
      expect(screen.getByText("ชั่งเฉพาะ 40 ชิ้นที่ส่ง ไม่ต้องชั่งที่เหลือ")).toBeInTheDocument();
      const btn = screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 13" });
      expect(btn).toBeEnabled();
      await userEvent.click(btn);
      expect(await screen.findByText(/ต้องชั่งน้ำหนักส่วนที่ส่งก่อน/)).toBeInTheDocument();
      expect(workerSendStage).not.toHaveBeenCalled();
      expect(document.body.textContent ?? "").not.toMatch(/ครั้งก่อนส่งออก|ถืออยู่ \d+(\.\d+)? ?กรัม/);
      expect(screen.queryByText("ส่งบางส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่ง")).not.toBeInTheDocument();
    });
    it("ไม่รู้จำนวนที่ถือ (view เก่า): ไม่มีการ์ด/แถบ · หัว 'ส่งต่อ:' และปุ่มเดิม", async () => {
      render(<WorkerApp token={TOKEN} view={{ ...soloSend(), myActions: undefined }} />);
      expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("ส่งต่อ: ฝังพลอย");
      expect(screen.queryByTestId("qty-bar")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ส่งต่อ" })).toBeInTheDocument();
    });
  });

  describe("จอรับ", () => {
    it("'รับงาน: ฝังพลอย' · 'ได้รับกี่ชิ้น' · เลขกลาง 53 (text-5xl) · 'ขั้นก่อนส่งมา 53 ชิ้น' · ชิป 'ครบ 53' กดอยู่ · แถบ · legend '✓ ครบ 53 ชิ้น' · ปุ่ม 'รับ 53 ชิ้น' · ไม่มีหัวจอเลขซ้ำ", async () => {
      render(<WorkerApp token={TOKEN} view={soloRecv()} />);
      expect(await screen.findByText("ได้รับกี่ชิ้น")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("รับงาน: ฝังพลอย");
      const stepper = screen.getByLabelText("จำนวนที่ได้รับ");
      expect(stepper).toHaveValue("53");
      expect(stepper).toHaveClass("text-5xl");
      expect(screen.getByText("ขั้นก่อนส่งมา 53 ชิ้น")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ครบ 53" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("status")).toHaveTextContent("✓ ครบ 53 ชิ้น");
      expect(screen.getByRole("button", { name: "รับ 53 ชิ้น" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "เพิ่มจำนวนที่ได้รับ" })).toBeDisabled(); // เกินที่ส่งมาไม่ได้
      expect(screen.queryByTestId("qty-headline")).not.toBeInTheDocument();
    });
    it("รับครบ = payload เดิมเป๊ะ [token, seq, null] ไม่มี qtyReceived · สำเร็จ 'รับงานแล้ว — 53 ชิ้น'", async () => {
      render(<WorkerApp token={TOKEN} view={soloRecv()} />);
      await userEvent.click(await screen.findByRole("button", { name: "รับ 53 ชิ้น" }));
      await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
      expect(workerReceiveStage.mock.calls[0]).toEqual([TOKEN, 3, null]);
      expect(await screen.findByText("รับงานแล้ว — 53 ชิ้น")).toBeInTheDocument();
    });
    it("ได้ 50: แถบ ได้รับ 50 / ขาด 3 · 'ขาด 3 ชิ้น — ระบบจะถามขั้นก่อน…' · ปุ่ม 'รับ 50 ชิ้น · ขาด 3' → ConfirmBox → payload qtyReceived 50 → 'รับ 50 ชิ้นแล้ว — ขาด 3 ชิ้น แจ้งขั้นก่อนแล้ว'", async () => {
      workerReceiveStage.mockResolvedValue({ ok: true, discrepancyQty: 3 });
      render(<WorkerApp token={TOKEN} view={soloRecv()} />);
      await setQty("จำนวนที่ได้รับ", "50");
      expect(screen.getByRole("button", { name: "ครบ 53" })).toHaveAttribute("aria-pressed", "false");
      expect(legend("ได้รับ")).toHaveTextContent("50");
      expect(legend("ขาด")).toHaveTextContent("3");
      expect(screen.getByText("ขาด 3 ชิ้น — ระบบจะถามขั้นก่อนว่าเสียหายหรือหาย")).toBeInTheDocument();
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ขั้นก่อนส่งมา 53 ชิ้น ได้รับ 50 ขาด 3");
      await userEvent.click(screen.getByRole("button", { name: "รับ 50 ชิ้น · ขาด 3" }));
      const dlg = await screen.findByRole("alertdialog");
      expect(dlg).toHaveTextContent("รับ 50 จาก 53 ชิ้น — ขาด 3 ชิ้น ขั้นก่อนจะถูกถามว่าเสียหายหรือหาย ถูกไหม");
      expect(workerReceiveStage).not.toHaveBeenCalled();
      await userEvent.click(within(dlg).getByRole("button", { name: "ถูก รับ 50 ชิ้น" }));
      await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
      expect(workerReceiveStage.mock.calls[0]).toEqual([TOKEN, 3, null, { qtyReceived: 50 }]);
      expect(await screen.findByText("รับ 50 ชิ้นแล้ว — ขาด 3 ชิ้น แจ้งขั้นก่อนแล้ว")).toBeInTheDocument();
    });
    it("ชิป 'ครบ 53' คืนค่า · ปุ่ม − ลดทีละ 1 (53 → 52) · ขั้นต่ำ 1 (ไม่มีทางรับ 0)", async () => {
      render(<WorkerApp token={TOKEN} view={soloRecv()} />);
      await userEvent.click(await screen.findByRole("button", { name: "ลดจำนวนที่ได้รับ" }));
      expect(screen.getByLabelText("จำนวนที่ได้รับ")).toHaveValue("52");
      await userEvent.click(screen.getByRole("button", { name: "ครบ 53" }));
      expect(screen.getByLabelText("จำนวนที่ได้รับ")).toHaveValue("53");
      await setQty("จำนวนที่ได้รับ", "1");
      expect(screen.getByRole("button", { name: "ลดจำนวนที่ได้รับ" })).toBeDisabled();
    });
    it("ชิ้นเดียว: 'ได้รับ 1 ชิ้น' อ่านอย่างเดียว · ปุ่ม 'รับ 1 ชิ้น' · เรียกเดิม", async () => {
      render(<WorkerApp token={TOKEN} view={soloRecv(1)} />);
      await userEvent.click(await screen.findByRole("button", { name: "รับ 1 ชิ้น" }));
      expect(screen.queryByLabelText("จำนวนที่ได้รับ")).not.toBeInTheDocument();
      await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledTimes(1));
      expect(workerReceiveStage.mock.calls[0]).toEqual([TOKEN, 3, null]);
    });
    it("ไม่รู้จำนวนที่ส่งมา (view เก่า): ปุ่ม 'รับงาน' เดิม · ไม่มีการ์ด · หัว 'ขั้นถัดไป:'", async () => {
      render(<WorkerApp token={TOKEN} view={{ ...soloRecv(), myActions: undefined }} />);
      expect(await screen.findByRole("button", { name: "รับงาน" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("ขั้นถัดไป: ฝังพลอย");
      expect(screen.queryByTestId("qty-bar")).not.toBeInTheDocument();
    });
    it("ปุ่ม ± 56px · ตัวเลข legend 24px", async () => {
      render(<WorkerApp token={TOKEN} view={soloRecv()} />);
      await setQty("จำนวนที่ได้รับ", "50");
      expect(screen.getByRole("button", { name: "ลดจำนวนที่ได้รับ" })).toHaveClass("h-14", "w-14");
      expect(legend("ได้รับ")).toHaveClass("text-2xl");
    });
  });

  describe("จอหลังส่งไม่หมด (SplitDone v2)", () => {
    it("ส่ง 40 จาก 53 เสีย 2: 'ส่งแล้ว 40 ชิ้น' · แถบ ส่งไป 40/เหลือ 11/เสีย 2 · การ์ด 'ส่งไปแล้ว 40 · ถัดไป: ตรวจ QC · ส่วนที่ 2' · 'เหลือกับคุณ 11 ที่ขั้น ฝังพลอย · ส่งทีหลังได้' · เสีย 2 ชิ้น · QR · ปุ่ม 'ส่งผิด? ยกเลิกการส่ง 40 ชิ้น'", async () => {
      workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "JB-0020 · ส่วนที่ 2", qty: 40, parentRemaining: 11 } });
      render(<WorkerApp token={TOKEN} view={soloSend(53, true)} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await openScrap();
      await addScrap(2);
      await setQty("จำนวนที่ส่ง", "40");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เสีย 2 · เหลือกับฉัน 11" }));
      expect(await screen.findByText("ส่งแล้ว 40 ชิ้น")).toBeInTheDocument();
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ส่งไป 40 เหลือกับฉัน 11 เสีย 2");
      expect(screen.getByText("ส่งไปแล้ว").closest("li")).toHaveTextContent("ถัดไป: ตรวจ QC · ส่วนที่ 2");
      expect(screen.getByText("ส่งไปแล้ว").closest("li")).toHaveTextContent("40");
      expect(screen.getByText("เหลือกับคุณ").closest("li")).toHaveTextContent("ที่ขั้น ฝังพลอย · ส่งทีหลังได้");
      expect(screen.getByText("เหลือกับคุณ").closest("li")).toHaveTextContent("11");
      expect(screen.getByText("เสีย 2 ชิ้น")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "QR ใบงาน JB-0020" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "ส่งผิด? ยกเลิกการส่ง 40 ชิ้น" })).toBeInTheDocument();
      expect(screen.getByTestId("done-ok")).toHaveClass("h-14", "w-14");
      expect(document.body.textContent ?? "").not.toMatch(/แบ่งส่วนแล้ว|ค้างกับคุณ/);
    });
    it("ไม่มีเสีย: ไม่มีแถบแดง/บรรทัดเสีย", async () => {
      workerSendStage.mockResolvedValue({ ok: true, lot: { lotJobId: LOT2, lotSeq: 2, label: "x", qty: 40, parentRemaining: 13 } });
      render(<WorkerApp token={TOKEN} view={soloSend()} />);
      await screen.findByText("ส่งกี่ชิ้น");
      await setQty("จำนวนที่ส่ง", "40");
      await userEvent.click(screen.getByRole("button", { name: "ส่ง 40 ชิ้น · เหลือกับฉัน 13" }));
      expect(await screen.findByText("ส่งแล้ว 40 ชิ้น")).toBeInTheDocument();
      expect(screen.queryByText(/^เสีย \d+ ชิ้น$/)).not.toBeInTheDocument();
      expect(screen.getByTestId("qty-bar")).toHaveAttribute("aria-label", "ส่งไป 40 เหลือกับฉัน 13");
    });
  });
});
