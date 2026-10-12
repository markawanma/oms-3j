// @vitest-environment jsdom
// หน้าช่าง: ระบุตัว (ชื่อ+PIN) → รับงาน → ส่งต่อ · ปุ่มเดียวตาม next_action · ไม่มีลิงก์/เมนูออกนอกหน้า · ไม่มีข้อมูลราคา/ลูกค้า
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
const workerLogin = vi.fn();
const workerLogout = vi.fn();
const workerReceiveStage = vi.fn();
const workerSendStage = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  workerLogin: (...a: unknown[]) => workerLogin(...a),
  workerLogout: (...a: unknown[]) => workerLogout(...a),
  workerReceiveStage: (...a: unknown[]) => workerReceiveStage(...a),
  workerSendStage: (...a: unknown[]) => workerSendStage(...a),
}));

import { WorkerApp } from "./WorkerApp";
import type { WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const WB = "22222222-2222-4222-8222-222222222222";
const stages = (cur: Partial<Record<number, "pending" | "received" | "sent">> = {}) =>
  [
    { seq: 1, code: "wax_inject", name: "ฉีดเทียน", status: cur[1] ?? "sent" },
    { seq: 2, code: "cast", name: "หล่อ", status: cur[2] ?? "pending" },
    { seq: 3, code: "polish", name: "แต่ง ขัด", status: cur[3] ?? "pending" },
  ] as WorkerView["job"]["stages"];

const view = (o: Partial<WorkerView> = {}, job: Partial<WorkerView["job"]> = {}): WorkerView => ({
  job: { jobNo: "JB-0007", status: "in_progress", stages: stages(), designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, dueDate: "2026-10-30", ...job },
  viewer: { workerId: WA, displayName: "ช่างเอ" },
  sessionExpired: false,
  nextAction: "receive",
  actionStage: { seq: 2, code: "cast", name: "หล่อ", weightRequired: true },
  prevWeightOutG: 11.2,
  heldBy: null,
  workers: [],
  scrapReasons: [],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  workerLogin.mockResolvedValue({ ok: true });
  workerLogout.mockResolvedValue({ ok: true });
  workerReceiveStage.mockResolvedValue({ ok: true });
  workerSendStage.mockResolvedValue({ ok: true });
});

describe("ระบุตัว", () => {
  const identify = () => view({ viewer: null, nextAction: "identify", actionStage: null, workers: [{ id: WA, displayName: "ช่างเอ" }, { id: WB, displayName: "ช่างบี" }] }, { designLabel: undefined, sku: undefined, metal: undefined, qtyPlanned: undefined, dueDate: undefined });

  it("ยังไม่ระบุตัว: เห็นเลขงาน + แถบขั้น + รายชื่อ — ไม่เห็นชื่อแบบ/จำนวน", () => {
    render(<WorkerApp token={TOKEN} view={identify()} />);
    expect(screen.getByRole("heading", { level: 1, name: "JB-0007" })).toBeInTheDocument();
    expect(screen.queryByText(/แหวนลาย A/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ช่างเอ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ช่างบี" })).toBeInTheDocument();
  });

  it("เลือกชื่อ → แป้น PIN → ครบ 4 หลักส่ง workerLogin(token, id, pin) อัตโนมัติ → refresh", async () => {
    render(<WorkerApp token={TOKEN} view={identify()} />);
    await userEvent.click(screen.getByRole("button", { name: "ช่างบี" }));
    for (const d of ["4", "8", "3", "1"]) await userEvent.click(screen.getByRole("button", { name: d }));
    await waitFor(() => expect(workerLogin).toHaveBeenCalledWith(TOKEN, WB, "4831"));
    expect(refresh).toHaveBeenCalled();
  });

  it("PIN ผิด → ข้อความไทย · ล้าง PIN ให้กดใหม่ · ไม่ refresh", async () => {
    workerLogin.mockResolvedValue({ ok: false, error: "ชื่อหรือ PIN ไม่ถูกต้อง", code: "bad_credentials" });
    render(<WorkerApp token={TOKEN} view={identify()} />);
    await userEvent.click(screen.getByRole("button", { name: "ช่างเอ" }));
    for (const d of ["0", "0", "0", "1"]) await userEvent.click(screen.getByRole("button", { name: d }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อหรือ PIN ไม่ถูกต้อง");
    expect(screen.getByRole("img", { name: /ใส่ PIN แล้ว 0 จาก 4/ })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ถูกล็อก → บอกเวลารอ · กด 'ไม่ใช่ฉัน' กลับไปเลือกชื่อ", async () => {
    workerLogin.mockResolvedValue({ ok: false, error: "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว", code: "locked", retryAfterSeconds: 900 });
    render(<WorkerApp token={TOKEN} view={identify()} />);
    await userEvent.click(screen.getByRole("button", { name: "ช่างเอ" }));
    for (const d of ["1", "9", "9", "9"]) await userEvent.click(screen.getByRole("button", { name: d }));
    expect(await screen.findByRole("alert")).toHaveTextContent("รอประมาณ 15 นาที");
    await userEvent.click(screen.getByRole("button", { name: /ไม่ใช่ฉัน/ }));
    expect(screen.getByRole("button", { name: "ช่างบี" })).toBeInTheDocument();
  });

  it("หมดอายุ session → แจ้ง 'ใส่ PIN ใหม่'", () => {
    render(<WorkerApp token={TOKEN} view={{ ...identify(), sessionExpired: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ใส่ PIN ใหม่");
  });
});

describe("รับงาน", () => {
  it("แสดงรายละเอียด + ครั้งก่อนส่งออก + ปุ่มรับงานปุ่มเดียว (ไม่มีปุ่มส่งต่อ)", () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    expect(screen.getByText("แหวนลาย A")).toBeInTheDocument();
    expect(screen.getByText(/12 ชิ้น · เงิน · RG-001/)).toBeInTheDocument();
    expect(screen.getByText(/ครั้งก่อนส่งออก 11.2 กรัม/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ส่งต่อ/ })).not.toBeInTheDocument();
  });

  it("ขั้นบังคับชั่ง: ไม่ใส่น้ำหนัก → เตือนที่ช่อง ไม่เรียก server", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.getByText("ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน")).toBeInTheDocument();
    expect(workerReceiveStage).not.toHaveBeenCalled();
  });

  it("ใส่น้ำหนัก → workerReceiveStage(token, seq, น้ำหนัก) → เครื่องหมายถูกเต็มจอ แล้ว refresh หลัง ~2 วิ", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<WorkerApp token={TOKEN} view={view()} />);
      await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "12.5");
      await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
      await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, "12.5"));
      expect(await screen.findByRole("status")).toHaveTextContent("รับงานแล้ว — หล่อ");
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ขั้นไม่บังคับชั่ง: รับได้โดยไม่ใส่น้ำหนัก → ส่ง null", async () => {
    render(<WorkerApp token={TOKEN} view={view({ actionStage: { seq: 2, code: "cast", name: "หล่อ", weightRequired: false } })} />);
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, null));
  });

  it("ช่องน้ำหนักรับเฉพาะตัวเลข/จุด (ตัวอักษรถูกกรอง) และเป็น inputmode=decimal", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    const input = screen.getByLabelText(/น้ำหนักเข้า/) as HTMLInputElement;
    expect(input).toHaveAttribute("inputmode", "decimal");
    await userEvent.type(input, "1a2-.5x");
    expect(input.value).toBe("12.5");
  });

  it("server ปฏิเสธ → ข้อความไทยใต้ปุ่ม ไม่หายหน้า", async () => {
    workerReceiveStage.mockResolvedValue({ ok: false, error: "ข้อมูลงานเปลี่ยนไป — รีเฟรชแล้วทำใหม่", code: "stage_changed" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูลงานเปลี่ยนไป");
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeEnabled();
  });

  it("server ล้มแบบไม่คาดคิด (throw) → ข้อความกลาง ไม่ค้างปุ่ม", async () => {
    workerReceiveStage.mockRejectedValue(new Error("boom"));
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ทำรายการไม่สำเร็จ");
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeEnabled();
  });
});

describe("ส่งต่อ", () => {
  const send = (o: Partial<WorkerView> = {}) =>
    view({ nextAction: "send", actionStage: { seq: 2, code: "cast", name: "หล่อ", weightRequired: true }, scrapReasons: ["porosity", "broken", "wrong_design", "missing", "other"], ...o }, { stages: stages({ 2: "received" }) });

  it("ปุ่มบอกขั้นถัดไป · ต้องใส่น้ำหนักออก", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    expect(screen.getByRole("button", { name: /ส่งต่อ → แต่ง ขัด/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    expect(screen.getByText("ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ")).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
  });

  it("ของเสีย > 0 ต้องเลือกเหตุผลเป็นปุ่ม · เหตุผลโผล่เมื่อมีของเสียเท่านั้น · ส่งค่าครบ", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    expect(screen.queryByRole("radiogroup", { name: "เหตุผลของเสีย" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "10.2");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    expect(screen.getByText("เลือกเหตุผลของเสีย", { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
    const group = screen.getByRole("radiogroup", { name: "เหตุผลของเสีย" });
    await userEvent.click(within(group).getByRole("radio", { name: "รูพรุน" }));
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, { expectedSeq: 2, weightOut: "10.2", qtyScrap: 2, scrapReason: "porosity", metalAdded: null }));
  });

  it("ลดของเสียกลับเป็น 0 → ล้างเหตุผล ส่ง null · ลดต่ำกว่า 0 ไม่ได้", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    expect(screen.getByRole("button", { name: "ลดของเสีย" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "เหตุผลของเสีย" })).getByRole("radio", { name: "หัก" }));
    await userEvent.click(screen.getByRole("button", { name: "ลดของเสีย" }));
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "9");
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ qtyScrap: 0, scrapReason: null })));
  });

  it("เติมโลหะ: เปิดช่องแล้วใส่ค่า → ส่ง metalAdded · ไม่เปิด = null", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "9");
    await userEvent.click(screen.getByRole("button", { name: /\+ เติมโลหะ/ }));
    await userEvent.type(screen.getByLabelText(/เติมโลหะ/), "0.4");
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ metalAdded: "0.4" })));
  });

  it("น้ำหนักออกมากกว่าเข้า (DB ปฏิเสธ) → ข้อความชี้ให้ใช้ช่องเติมโลหะ", async () => {
    workerSendStage.mockResolvedValue({ ok: false, error: "น้ำหนักออกมากกว่าน้ำหนักเข้า — ถ้าเติมโลหะให้ใส่ช่อง “เติมโลหะ”", code: "weight_over" });
    render(<WorkerApp token={TOKEN} view={send()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "99");
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    expect(await screen.findByText(/ถ้าเติมโลหะ/)).toBeInTheDocument();
  });
});

describe("สถานะที่ไม่มีปุ่มทำงาน + ความปลอดภัยของหน้า", () => {
  it.each([
    ["awaiting_deposit", /รอมัดจำ/],
    ["not_your_stage", /ไม่ใช่ขั้นของคุณ/],
    ["prev_not_sent", /ยังไม่ส่งต่อ/],
    ["on_hold", /พักไว้/],
    ["none", /ไม่มีขั้นที่ต้องทำ/],
  ] as const)("%s → ข้อความ ไม่มีปุ่มรับ/ส่ง", (na, text) => {
    render(<WorkerApp token={TOKEN} view={view({ nextAction: na })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /รับงาน|ส่งต่อ/ })).not.toBeInTheDocument();
  });

  it("held_by_other → บอกว่าอยู่กับใคร ไม่มีปุ่มทำงาน", () => {
    render(<WorkerApp token={TOKEN} view={view({ nextAction: "held_by_other", heldBy: "ช่างบี" })} />);
    expect(screen.getAllByText(/ช่างบี/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /รับงาน|ส่งต่อ/ })).not.toBeInTheDocument();
  });

  it("ไม่มีลิงก์/เมนู/นำทางออกนอกหน้าเลย (ทุกสถานะ)", () => {
    for (const na of ["receive", "send", "identify", "awaiting_deposit", "none"] as const) {
      const { container, unmount } = render(<WorkerApp token={TOKEN} view={view({ nextAction: na, workers: [{ id: WA, displayName: "ช่างเอ" }], scrapReasons: ["other"] })} />);
      expect(container.querySelectorAll("a, nav, [role=navigation], [role=menu]")).toHaveLength(0);
      unmount();
    }
  });

  it("ปุ่มหลัก ≥ 56px (min-h-14) และตัวอักษร ≥ 18px (text-lg+) — ปุ่มรับงาน/ส่งต่อ/เลือกชื่อ/แป้น PIN", async () => {
    const { unmount } = render(<WorkerApp token={TOKEN} view={view()} />);
    expect(screen.getByRole("button", { name: "รับงาน" }).className).toMatch(/min-h-14/);
    expect(screen.getByRole("button", { name: "รับงาน" }).className).toMatch(/text-xl/);
    unmount();
    render(<WorkerApp token={TOKEN} view={view({ viewer: null, nextAction: "identify", workers: [{ id: WA, displayName: "ช่างเอ" }] })} />);
    expect(screen.getByRole("button", { name: "ช่างเอ" }).className).toMatch(/min-h-16/);
    await userEvent.click(screen.getByRole("button", { name: "ช่างเอ" }));
    expect(screen.getByRole("button", { name: "5" }).className).toMatch(/min-h-16/);
  });

  it("ไม่มีข้อความราคา/ต้นทุน/ลูกค้า/ใบเสนอราคาบนหน้า (แม้ view จะมีทุก field ที่อนุญาต)", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view({ heldBy: "ช่างบี" })} />);
    expect(container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|ลูกค้า|ใบเสนอ|PO-|Q-\d|margin|มัดจำ.*บาท/i);
  });

  it("ออกจากระบบ ('ไม่ใช่คุณ?') → workerLogout แล้ว refresh", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.click(screen.getByRole("button", { name: /ไม่ใช่คุณ/ }));
    await waitFor(() => expect(workerLogout).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });
});
