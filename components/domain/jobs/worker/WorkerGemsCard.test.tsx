// @vitest-environment jsdom
// G1a หน้าช่าง: การ์ด "พลอยที่ต้องใช้" — ขั้นฝัง = กางเต็ม (รวมใหญ่) · ขั้นอื่น = พับบรรทัดเดียว · ยังไม่ระบุ = เตือน ไม่บล็อก · ใบไม่มีพลอย = จอเดิม · ไม่มีเงิน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/w/x" }));
vi.mock("@/lib/actions/job-worker", () => ({ workerLogin: vi.fn(), workerLogout: vi.fn(), workerReceiveStage: vi.fn(), workerSendStage: vi.fn() }));

import { WorkerApp } from "./WorkerApp";
import { WorkerGemsCard, gemAriaLabel } from "./WorkerGemsCard";
import type { WorkerGem, WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const G: WorkerGem[] = [
  { label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: "บ่าซ้าย-ขวา" },
  { label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, qtyTotal: 1050, position: null },
];

const view = (o: { gems?: WorkerGem[]; state?: "specified" | "unspecified"; stageCode?: string } = {}): WorkerView => ({
  job: {
    jobNo: "JB-0031", status: "in_progress", designLabel: "แหวนโกเมนไข่", sku: "RG-0418", metal: "silver", qtyPlanned: 35, dueDate: null,
    stages: [{ seq: 1, code: "cast", name: "หล่อ", status: "sent" }, { seq: 2, code: o.stageCode ?? "gem_set", name: "ฝังพลอย", status: "pending" }],
    ...(o.state ? { gemsState: o.state, gems: o.gems ?? [] } : {}),
  },
  viewer: { workerId: WA, displayName: "ช่างเอ" },
  sessionExpired: false,
  nextAction: "receive",
  actionStage: { seq: 2, code: o.stageCode ?? "gem_set", name: "ฝังพลอย", weightRequired: false },
  prevWeightOutG: null,
  heldBy: null,
  workers: [],
  scrapReasons: [],
});

beforeEach(() => vi.clearAllMocks());

describe("ขั้นฝังพลอย = กางเต็ม", () => {
  it("หัว 'พลอยที่ต้องใช้ · 2 รายการ' · ชื่อ + /ชิ้น + ตำแหน่ง · รวมต่อแถวเป็นตัวเลขใหญ่ 28px · รวมทั้งใบ 1,120", () => {
    render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: G })} />);
    const card = screen.getByTestId("worker-gems-card");
    expect(within(card).getByRole("heading", { name: "พลอยที่ต้องใช้ · 2 รายการ" })).toBeInTheDocument();
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(items[0]).toHaveTextContent("2 เม็ด/ชิ้น · บ่าซ้าย-ขวา");
    expect(items[0]).toHaveTextContent("70");
    expect(items[1]).toHaveTextContent("30 เม็ด/ชิ้น");
    expect(items[1]).not.toHaveTextContent("· "); // ไม่มีตำแหน่ง = ไม่มีบรรทัดตำแหน่งว่าง
    expect(within(items[0]).getByText("70").className).toContain("text-[28px]");
    expect(within(items[1]).getByText("1,050")).toBeInTheDocument();
    expect(screen.getByTestId("worker-gems-total")).toHaveTextContent("รวมพลอยทั้งใบ 1,120 เม็ด");
  });
  it("วางเหนือแผงรับงาน (ลำดับ DOM: หัวใบ → การ์ดพลอย → ปุ่มรับงาน) · ปุ่มรับงานไม่ถูกบล็อก", () => {
    render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: G })} />);
    const card = screen.getByTestId("worker-gems-card");
    const btn = screen.getByRole("button", { name: "รับงาน" });
    expect(card.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(btn).not.toHaveAttribute("aria-disabled", "true");
  });
  it("แถวอ่านออกเสียงครบ (aria-label ต่อแถว) · ชื่อยาวไม่มีเว้นวรรคตัดบรรทัดได้ · เลขหลักล้านไม่ตัดกลางตัวเลข", () => {
    const long: WorkerGem = { label: "ก".repeat(80), qtyPerPiece: 1000, qtyTotal: 1_000_000, position: "ล้อมรอบ" };
    render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: [G[0], long] })} />);
    const items = within(screen.getByTestId("worker-gems-card")).getAllByRole("listitem");
    expect(items[0]).toHaveAccessibleName("โกเมน, ไข่, 4 คูณ 6 มิลลิเมตร — 2 เม็ดต่อชิ้น รวม 70 เม็ด · บ่าซ้าย-ขวา");
    expect(within(items[1]).getByText("ก".repeat(80)).className).toContain("break-words");
    const big = within(items[1]).getByText("1,000,000");
    expect(big.className).toContain("whitespace-nowrap");
    expect(big.className).toContain("tabular-nums");
  });
});

describe("ขั้นอื่น = พับบรรทัดเดียว", () => {
  it("ปุ่ม 56px 'พลอย 2 รายการ · รวม 1,120 เม็ด' aria-expanded=false · รายการซ่อน · แตะแล้วกาง · แตะอีกพับ", async () => {
    const user = userEvent.setup();
    render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: G, stageCode: "cast" })} />);
    const btn = screen.getByRole("button", { name: "พลอย 2 รายการ · รวม 1,120 เม็ด" });
    expect(btn.className).toContain("min-h-14");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("worker-gems-list")).not.toBeInTheDocument();
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("worker-gems-list")).toBeInTheDocument();
    expect(screen.queryByTestId("worker-gems-total")).not.toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByTestId("worker-gems-list")).not.toBeInTheDocument();
  });
});

describe("ยังไม่ระบุพลอย / ไม่มีพลอย", () => {
  it("unspecified: กล่อง amber 'ยังไม่ระบุพลอย — ถามออฟฟิศก่อนฝัง' · ไม่บล็อกปุ่มรับงาน (ไม่ aria-disabled/disabled)", async () => {
    render(<WorkerApp token={TOKEN} view={view({ state: "unspecified" })} />);
    expect(screen.getByTestId("worker-gems-unspecified")).toHaveTextContent("ใบนี้ยังไม่ระบุพลอย — ถามออฟฟิศก่อนฝัง");
    expect(screen.getByTestId("worker-gems-unspecified")).toHaveAttribute("role", "status");
    const btn = await screen.findByRole("button", { name: "รับงาน" });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("worker-gems-card")).not.toBeInTheDocument();
  });
  it("unspecified ขั้นอื่นก็เตือน (ไม่แสดงรายการ)", () => {
    render(<WorkerApp token={TOKEN} view={view({ state: "unspecified", stageCode: "cast" })} />);
    expect(screen.getByTestId("worker-gems-unspecified")).toBeInTheDocument();
  });
  it("ไม่มี gemsState (ใบไม่มีขั้นฝัง/ไม่มีพลอย): ไม่ render อะไรเลย — จอเดิมเป๊ะ", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view()} />);
    expect(screen.queryByTestId("worker-gems-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("worker-gems-unspecified")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("พลอยที่ต้องใช้");
    expect(container.textContent).not.toContain("ยังไม่ระบุพลอย");
    expect(screen.queryByRole("button", { name: /^พลอย \d+ รายการ/ })).not.toBeInTheDocument();
  });
  it("specified แต่แถวอ่านไม่ได้ทั้งหมด (gems = []): ไม่ render การ์ด ไม่เตือนว่ายังไม่ระบุ ไม่บล็อกขั้นอื่น", async () => {
    render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: [] })} />);
    expect(screen.queryByTestId("worker-gems-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("worker-gems-unspecified")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "รับงาน" })).toBeEnabled();
  });
});

describe("🔴 ไม่มีเงิน/เผื่อแตก/ผู้ขาย/รหัสรายการ", () => {
  it("DOM ของหน้าช่างที่มีพลอย (ทั้งกางและพับ) ไม่มีคำเรื่องราคา/ต้นทุน และไม่มี uuid ของรายการ", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: G })} />);
    expect(container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก|ผู้ขาย|ยังไม่มีราคา/);
    expect(container.innerHTML).not.toMatch(/price|cost|thb|supplier|breakage|gem_item/i);
    unmount();
    const r2 = render(<WorkerApp token={TOKEN} view={view({ state: "specified", gems: G, stageCode: "cast" })} />);
    await user.click(screen.getByRole("button", { name: /พลอย 2 รายการ/ }));
    expect(r2.container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก|ผู้ขาย/);
  });
  it("WorkerGem ที่การ์ดรับมี key เฉพาะ 4 ตัว (type-level — เทสต์ล็อกการประกอบ)", () => {
    const g: WorkerGem = { label: "x", qtyPerPiece: 1, qtyTotal: 1, position: null };
    expect(Object.keys(g).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
  });
});

describe("gemAriaLabel", () => {
  it("ฉลากมี ' · ' และ '×' และ 'มม.' → อ่านออกเสียงเป็นคำ", () => {
    expect(gemAriaLabel({ label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, qtyTotal: 1050, position: null })).toBe("CZ, กลม, 1.5 มิลลิเมตร — 30 เม็ดต่อชิ้น รวม 1,050 เม็ด");
  });
  it("การ์ดที่ถูกเรียกตรง: specified + [] = null", () => {
    const { container } = render(<WorkerGemsCard state="specified" gems={[]} onGemStage />);
    expect(container).toBeEmptyDOMElement();
  });
});
