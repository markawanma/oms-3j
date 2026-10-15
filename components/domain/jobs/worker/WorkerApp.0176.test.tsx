// @vitest-environment jsdom
// 0176 หน้าช่าง: ช่อง/ปุ่มตาม flag ของขั้น (แบบการบันทึก) · ใบเดิม (has_profile ไม่ใช่ true) = UI เดิมทุกประการ · ไม่โชว์ชื่อแบบ/ป้ายทอง
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
const workerReceiveStage = vi.fn();
const workerSendStage = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  workerLogin: vi.fn(),
  workerLogout: vi.fn(),
  workerReceiveStage: (...a: unknown[]) => workerReceiveStage(...a),
  workerSendStage: (...a: unknown[]) => workerSendStage(...a),
}));

import { WorkerApp } from "./WorkerApp";
import { sanitizeWorkerView } from "@/lib/jobs/worker-view";
import type { WorkerView } from "@/lib/jobs/worker-view";
import { workerFailMessage } from "@/lib/jobs/messages";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const stages = (cur: Partial<Record<number, "pending" | "received" | "sent">> = {}) =>
  [
    { seq: 1, code: "wax", name: "ฉีดเทียน", status: cur[1] ?? "sent" },
    { seq: 2, code: "cast", name: "หล่อ", status: cur[2] ?? "pending" },
    { seq: 3, code: "polish", name: "ขัด", status: cur[3] ?? "pending" },
  ] as WorkerView["job"]["stages"];

type AS = NonNullable<WorkerView["actionStage"]>;
const view = (action: "receive" | "send", as: Partial<AS>, job: Partial<WorkerView["job"]> = {}): WorkerView => ({
  job: { jobNo: "JB-0007", status: "in_progress", stages: stages(action === "send" ? { 2: "received" } : {}), designLabel: "แหวนลาย A", sku: null, metal: "gold", qtyPlanned: 12, dueDate: null, hasProfile: true, ...job },
  viewer: { workerId: WA, displayName: "ช่างเอ" },
  sessionExpired: false,
  nextAction: action,
  actionStage: { seq: 2, code: "cast", name: "หล่อ", weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, ...as },
  prevWeightOutG: null,
  heldBy: null,
  workers: [],
  scrapReasons: ["porosity", "broken", "wrong_design", "missing", "other"],
});

beforeEach(() => {
  vi.clearAllMocks();
  workerReceiveStage.mockResolvedValue({ ok: true });
  workerSendStage.mockResolvedValue({ ok: true });
});

const sendBtn = () => screen.getByRole("button", { name: /^ส่งต่อ/ });

describe("0176 ส่งต่อ — แบบไม่ชั่ง (ปิดทั้ง 3)", () => {
  it("ไม่มีช่องน้ำหนัก/ScrapStepper/เติมโลหะ · บรรทัดบอก · ส่ง weightOut null qtyScrap 0 (ไม่มี scrapWeight)", async () => {
    render(<WorkerApp token={TOKEN} view={view("send", {})} />);
    expect(screen.getByText("ขั้นนี้ไม่ต้องชั่งหรือแจ้งของเสีย — กดส่งต่อได้เลย")).toBeInTheDocument();
    expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มของเสีย" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ เติมโลหะ" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/เศษโลหะ/)).not.toBeInTheDocument();
    await userEvent.click(sendBtn());
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, { expectedSeq: 2, weightOut: null, qtyScrap: 0, scrapReason: null, metalAdded: null }));
  });

  it("ปุ่ม '+ แจ้งของเสียในขั้นนี้' (dashed) เปิด ScrapStepper เดิม → ส่ง qtyScrap > 0 + เหตุผล", async () => {
    render(<WorkerApp token={TOKEN} view={view("send", {})} />);
    const open = screen.getByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" });
    expect(open.className).toContain("border-dashed");
    expect(open.className).toContain("min-h-14");
    await userEvent.click(open);
    expect(screen.queryByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "เหตุผลของเสีย" })).getByRole("radio", { name: "รูพรุน" }));
    await userEvent.click(sendBtn());
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, { expectedSeq: 2, weightOut: null, qtyScrap: 1, scrapReason: "porosity", metalAdded: null }));
  });
});

describe("0176 ส่งต่อ — flag ต่อขั้น", () => {
  it("ชั่ง (weightRequired): มีช่องน้ำหนักออก (จำเป็น) + เติมโลหะ · ไม่มีบรรทัด 'ไม่ต้องชั่ง' · ไม่ถามชิ้นเสีย = ปุ่ม '+ แจ้งของเสีย'", async () => {
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: true })} />);
    expect(screen.getByLabelText(/น้ำหนักออก/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ เติมโลหะ" })).toBeInTheDocument();
    expect(screen.queryByText(/ขั้นนี้ไม่ต้องชั่ง/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" })).toBeInTheDocument();
    await userEvent.click(sendBtn());
    expect(screen.getByText("ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ")).toBeInTheDocument();
    expect(workerSendStage).not.toHaveBeenCalled();
  });

  it("ไม่ชั่งแต่ถามชิ้นเสีย: ScrapStepper ขึ้นเลย · บรรทัด 'ขั้นนี้ไม่ต้องชั่งน้ำหนัก' · ไม่มีเติมโลหะ", () => {
    render(<WorkerApp token={TOKEN} view={view("send", { scrapQtyAsk: true })} />);
    expect(screen.getByText("ขั้นนี้ไม่ต้องชั่งน้ำหนัก")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มของเสีย" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/น้ำหนักออก/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ เติมโลหะ" })).not.toBeInTheDocument();
  });

  it("ถามเศษโลหะ: ช่อง 'เศษโลหะ (กรัม) — ถ้าชั่งได้' + hint · ใส่แล้วส่ง scrapWeight · ว่าง = ไม่ส่ง key · ผิดรูปแบบ = error ไม่ส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: true, scrapWeightAsk: true })} />);
    const f = screen.getByLabelText(/เศษโลหะ \(กรัม\)/);
    expect(screen.getByText("เศษ/ก้านต้นที่เก็บได้ ไม่ใช่น้ำหนักงาน")).toBeInTheDocument();
    // ลำดับ: น้ำหนักออก → ชิ้นเสีย → เศษ → เติมโลหะ
    const order = [screen.getByLabelText(/น้ำหนักออก/), screen.getByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" }), f, screen.getByRole("button", { name: "+ เติมโลหะ" })];
    for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "10.2");
    await userEvent.type(f, "1,234.5");
    await userEvent.click(sendBtn());
    expect(workerSendStage).not.toHaveBeenCalled();
    await userEvent.clear(f);
    await userEvent.type(f, "0,35");
    await userEvent.click(sendBtn());
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, { expectedSeq: 2, weightOut: "10.2", qtyScrap: 0, scrapReason: null, metalAdded: null, scrapWeight: "0,35" }));
    cleanup();
    workerSendStage.mockClear();
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: true, scrapWeightAsk: true })} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "10.2");
    await userEvent.click(sendBtn());
    await waitFor(() => expect(workerSendStage).toHaveBeenCalled());
    expect(workerSendStage.mock.calls[0][1]).not.toHaveProperty("scrapWeight");
  });

  it("ไม่ถามเศษ = ไม่มีช่องเศษ แม้ weightRequired", () => {
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: true, scrapWeightAsk: false })} />);
    expect(screen.queryByLabelText(/เศษโลหะ/)).not.toBeInTheDocument();
  });
});

describe("0176 รับงาน", () => {
  it("ขั้นไม่ชั่ง + ปิดทั้ง 3: ไม่มีช่องน้ำหนักเข้า · 'ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย' · รับส่ง weightIn null", async () => {
    render(<WorkerApp token={TOKEN} view={view("receive", {})} />);
    expect(screen.getByText("ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย")).toBeInTheDocument();
    expect(screen.queryByLabelText(/น้ำหนักเข้า/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, null));
  });

  it("ไม่ชั่งแต่ถามชิ้นเสียตอนส่ง: 'ขั้นนี้ไม่ต้องชั่งน้ำหนัก' · ต้องชั่ง: มีช่อง + ไม่มีบรรทัดบอก", () => {
    render(<WorkerApp token={TOKEN} view={view("receive", { scrapQtyAsk: true })} />);
    expect(screen.getByText("ขั้นนี้ไม่ต้องชั่งน้ำหนัก")).toBeInTheDocument();
    cleanup();
    render(<WorkerApp token={TOKEN} view={view("receive", { weightRequired: true })} />);
    expect(screen.getByLabelText(/น้ำหนักเข้า/)).toBeInTheDocument();
    expect(screen.queryByText(/ขั้นนี้ไม่ต้อง/)).not.toBeInTheDocument();
  });
});

describe("0176 ใบเดิม (has_profile ไม่ใช่ true) = UI เดิมทุกประการ", () => {
  it.each([["hasProfile = false", { hasProfile: false }], ["ไม่มี key hasProfile (payload เก่า/fail-safe)", { hasProfile: undefined }]])("%s: รับ = ช่องน้ำหนักเข้า optional · ส่ง = น้ำหนัก + ชิ้นเสีย + เติมโลหะ ครบ · ไม่มีบรรทัดบอก/ปุ่มใหม่", async (_n, job) => {
    render(<WorkerApp token={TOKEN} view={view("receive", { weightRequired: false, scrapQtyAsk: undefined, scrapWeightAsk: undefined }, job)} />);
    expect(screen.getByLabelText(/น้ำหนักเข้า/)).toBeInTheDocument();
    expect(screen.queryByText(/ขั้นนี้ไม่ต้อง/)).not.toBeInTheDocument();
    cleanup();
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: false, scrapQtyAsk: undefined, scrapWeightAsk: undefined }, job)} />);
    expect(screen.getByLabelText(/น้ำหนักออก/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มของเสีย" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ เติมโลหะ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ แจ้งของเสียในขั้นนี้" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/เศษโลหะ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ขั้นนี้ไม่ต้อง/)).not.toBeInTheDocument();
  });

  it("ใบเดิมที่ stage flag ดูเหมือนปิด (scrapWeightAsk true จากข้อมูลแปลก) ก็ไม่ขึ้นช่องเศษ — ใบเดิมไม่ถามเศษ", () => {
    render(<WorkerApp token={TOKEN} view={view("send", { weightRequired: true, scrapWeightAsk: true }, { hasProfile: false })} />);
    expect(screen.queryByLabelText(/เศษโลหะ/)).not.toBeInTheDocument();
  });
});

describe("0176 ช่างไม่เห็นชื่อแบบ/ป้ายทอง/คำเตือนทอง", () => {
  it("หน้าจอไม่มีคำว่าแบบการบันทึก/ทอง · ไม่มีด่าน/ไม่มีป้ายแดง แม้ใบทองที่ขั้นโลหะไม่ชั่ง", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view("send", {})} />);
    const t = container.textContent ?? "";
    expect(t).not.toMatch(/แบบการบันทึก|ไม่มีด่าน|กันทองหาย|รับทราบ|ShieldAlert/);
    expect(container.querySelector("[class*=border-red-400]")).toBeNull();
  });

  it("sanitizeWorkerView ทิ้ง profile_name/ชื่อแบบ/ป้ายทอง ที่ DB ส่งมา · เก็บเฉพาะ hasProfile + flag ต่อขั้น · key แปลกไม่ไหล", () => {
    const raw = {
      ok: true,
      job: { job_no: "JB-1", status: "open", design_label: "ก", sku: null, metal: "gold", qty_planned: 1, due_date: null, stages: [], has_profile: true, profile_name: "ทอง — ชั่งทุกขั้นที่มีโลหะ", gold_unguarded: true, profile_id: WA },
      viewer: { worker_id: WA, display_name: "ช่างเอ" },
      next_action: "send",
      action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: false, scrap_qty_ask: false, scrap_weight_ask: true, gold_unguarded: true },
      workers: [],
      scrap_reasons: [],
    };
    const v = sanitizeWorkerView(raw)!;
    expect(v.job.hasProfile).toBe(true);
    expect(v.actionStage).toEqual({ seq: 1, code: "cast", name: "หล่อ", weightRequired: false, scrapQtyAsk: false, scrapWeightAsk: true });
    const dump = JSON.stringify(v);
    expect(dump).not.toMatch(/profile_name|ชั่งทุกขั้นที่มีโลหะ|gold_unguarded|goldUnguarded|profileName|profile_id/);
    expect(Object.keys(v.job).sort()).toEqual(["designLabel", "dueDate", "hasProfile", "jobNo", "metal", "qtyPlanned", "sku", "stages", "status"]);
  });

  it("sanitize: ไม่มี has_profile/flag = ไม่มี key (ใบเดิม) · ค่าไม่ใช่ boolean จริง ('true'/1) ไม่ถูกนับ", () => {
    const base = { ok: true, job: { job_no: "JB-1", status: "open", design_label: "ก", stages: [] }, viewer: { worker_id: WA, display_name: "ช่างเอ" }, next_action: "send", workers: [], scrap_reasons: [] };
    const old = sanitizeWorkerView({ ...base, action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: true } })!;
    expect(old.job).not.toHaveProperty("hasProfile");
    expect(old.actionStage).toEqual({ seq: 1, code: "cast", name: "หล่อ", weightRequired: true });
    const odd = sanitizeWorkerView({ ...base, job: { ...base.job, has_profile: "true" }, action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: true, scrap_qty_ask: "false", scrap_weight_ask: 1 } })!;
    expect(odd.job.hasProfile).toBe(false);
    expect(odd.actionStage).toEqual({ seq: 1, code: "cast", name: "หล่อ", weightRequired: true });
  });
});

describe("0176 error weight_required (ออฟฟิศเปลี่ยนแบบขณะจอเก่าเปิดค้าง)", () => {
  it("ข้อความ 'ออฟฟิศเพิ่งเปลี่ยนวิธีบันทึกของขั้นนี้ — โหลดหน้าใหม่' + ปุ่มโหลดใหม่ (refresh)", async () => {
    workerSendStage.mockResolvedValue({ ok: false, error: workerFailMessage("weight_required", "ข้อความ DB"), code: "weight_required" });
    render(<WorkerApp token={TOKEN} view={view("send", {})} />);
    await userEvent.click(sendBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("ออฟฟิศเพิ่งเปลี่ยนวิธีบันทึกของขั้นนี้ — โหลดหน้าใหม่");
    await userEvent.click(screen.getByRole("button", { name: "โหลดใหม่" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("ข้อความของ code นี้สั้น ไม่มีศัพท์เทคนิค", () => {
    expect(workerFailMessage("weight_required", null)).toBe("ออฟฟิศเพิ่งเปลี่ยนวิธีบันทึกของขั้นนี้ — โหลดหน้าใหม่");
  });
});
