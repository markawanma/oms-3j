// @vitest-environment jsdom
// บอร์ดใบงาน v2: tile = ปุ่มกรอง (ตัวเลข = แถวส่วนบน = การ์ดบอร์ด) · งานที่วิ่งอยู่ + cap 10 · focusJob/scrollIntoView · polling ไม่ล้างตัวกรอง · stage rail/chips · empty ก/ข · ไม่มีราคา/ลูกค้า/sourceRef
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const getJobBoard = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({ getJobBoard: (...a: unknown[]) => getJobBoard(...a) }));

import { JobBoard, BOARD_POLL_MS, HIGHLIGHT_MS } from "./JobBoard";
import type { BoardData } from "@/lib/actions/job-office";
import type { BoardRow, StageDef } from "@/lib/jobs/types";

const TODAY = "2026-10-14";
const STAGES: StageDef[] = [
  { code: "cad", nameTh: "ออกแบบ CAD", seq: 1 },
  { code: "print3d", nameTh: "ปริ้น 3D ต้นแบบ", seq: 2 },
  { code: "wax", nameTh: "ฉีดแว๊กซ์", seq: 3 },
];

let n = 0;
const row = (o: Partial<BoardRow> = {}): BoardRow => {
  n += 1;
  return {
    id: `id-${n}`, jobNo: `JB-${String(n).padStart(4, "0")}`, seq: n, sourceKind: "oem", sourceRef: null, designLabel: `แบบ ${n}`, sku: null, metal: "silver", qtyPlanned: 30, status: "in_progress", dueDate: null,
    stageCode: "print3d", stageName: "ปริ้น 3D ต้นแบบ", stageStatus: "received", holderName: "ช่างสมชาย", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
    stageCount: 13, stageDoneCount: 3, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
    boardColumn: o.stageCode === undefined ? "print3d" : (o.stageCode ?? null), handoffGapG: null, handoffMismatchCount: 0, ...o,
  };
};
const board = (rows: BoardRow[], extra: Partial<BoardData> = {}): BoardData => ({ todayTh: TODAY, rows, stages: STAGES, truncated: false, workers: [], ...extra });

let desktop = true;
let visiblePrefix: "board-job-" | "list-job-" = "board-job-";
const scrolled: Array<{ id: string; opts: unknown }> = [];

beforeEach(() => {
  n = 0;
  desktop = true;
  visiblePrefix = "board-job-";
  scrolled.length = 0;
  getJobBoard.mockReset();
  window.matchMedia = ((q: string) => ({ matches: q.includes("min-width") ? desktop : false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = function (this: Element, opts?: boolean | ScrollIntoViewOptions) {
    scrolled.push({ id: this.id, opts });
  };
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.id.startsWith(visiblePrefix) ? [{}] : []) as unknown as DOMRectList;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tiles = () => within(screen.getByRole("region", { name: "สรุป" }));
const tile = (label: RegExp) => tiles().getByRole("button", { name: label });
const tileN = (label: RegExp) => Number(/(\d+)\s*$/.exec(tile(label).textContent ?? "")?.[1]);
const chip = (name: RegExp | string) => within(screen.getByRole("group", { name: "กรองตามขั้น" })).getByRole("button", { name });
const activeRows = (c: HTMLElement) => c.querySelectorAll("li[data-job-id]");
const boardCards = (c: HTMLElement) => c.querySelectorAll('li[id^="board-job-"]');
const listCards = (c: HTMLElement) => c.querySelectorAll('li[id^="list-job-"]');

describe("tile = ปุ่มกรอง · ตัวเลข = แถวส่วนบน = การ์ดบอร์ด", () => {
  const mixed = () => [
    row({ isOverdue: true, dueDate: "2026-10-11" }), row({ isOverdue: true, dueDate: "2026-10-12", metal: "gold" }),
    row({ dueDate: "2026-10-16" }), row({ isStale: true }), row({ isStale: true, status: "on_hold" }), row(), row(),
  ];
  it("ตัวเลข tile เท่าจำนวนแถวส่วนบนและการ์ดบอร์ดหลังกด · กดซ้ำล้าง", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board(mixed())} />);
    expect([tileN(/ใบงานที่เปิดอยู่/), tileN(/เลยกำหนด/), tileN(/ครบใน 3 วัน/), tileN(/นิ่งเกิน 3 วัน/)]).toEqual([7, 2, 1, 2]);
    for (const [label, expected] of [[/เลยกำหนด/, 2], [/ครบใน 3 วัน/, 1], [/นิ่งเกิน 3 วัน/, 2]] as const) {
      await user.click(tile(label));
      expect(tile(label)).toHaveAttribute("aria-pressed", "true");
      expect(activeRows(container)).toHaveLength(expected);
      expect(boardCards(container)).toHaveLength(expected);
      expect(listCards(container)).toHaveLength(expected);
      await user.click(tile(label));
      expect(tile(label)).toHaveAttribute("aria-pressed", "false");
      expect(activeRows(container)).toHaveLength(7);
    }
  });
  it("tile 'เปิดอยู่' ล้าง signal · แถบกำลังกรองบอกเงื่อนไข + x จาก y + ล้างตัวกรอง", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board(mixed())} />);
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
    await user.click(tile(/เลยกำหนด/));
    const status = screen.getByText(/กำลังกรอง/);
    expect(status.closest("[role=status]")).toBeTruthy();
    expect(status.textContent).toContain("แสดง 2 จาก 7 ใบ");
    await user.click(tile(/ใบงานที่เปิดอยู่/));
    expect(activeRows(container)).toHaveLength(7);
    await user.click(tile(/นิ่งเกิน 3 วัน/));
    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(activeRows(container)).toHaveLength(7);
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
  });
  it("ตัวเลข tile นับหลังกรอง dropdown (โลหะ) แต่ก่อนกรอง signal · dropdown กรองทั้งสองส่วน", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board(mixed())} />);
    await user.selectOptions(screen.getByLabelText("โลหะ"), "gold");
    expect([tileN(/ใบงานที่เปิดอยู่/), tileN(/เลยกำหนด/), tileN(/ครบใน 3 วัน/), tileN(/นิ่งเกิน 3 วัน/)]).toEqual([1, 1, 0, 0]);
    expect(activeRows(container)).toHaveLength(1);
    expect(boardCards(container)).toHaveLength(1);
    await user.click(tile(/เลยกำหนด/));
    expect(activeRows(container)).toHaveLength(1);
  });
  it("dropdown แหล่ง/ผู้ถือ ยังกรองถูก", async () => {
    const user = userEvent.setup();
    const rows = [row({ sourceKind: "production", holderName: "ช่างเอ" }), row({ holderName: "ช่างบี" }), row({ holderName: "ช่างบี" })];
    const { container } = render(<JobBoard initial={board(rows)} />);
    await user.selectOptions(screen.getByLabelText("แหล่ง"), "production");
    expect(activeRows(container)).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("แหล่ง"), "");
    await user.selectOptions(screen.getByLabelText("ผู้ถือ"), "ช่างบี");
    expect(activeRows(container)).toHaveLength(2);
    expect(boardCards(container)).toHaveLength(2);
  });
  it("tile n=0 → disabled · ยกเว้นที่กำลังเลือกอยู่ (รีเฟรชแล้วเหลือ 0 ต้องกดออกได้)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<JobBoard initial={board([row({ isOverdue: true, dueDate: "2026-10-12" }), row()])} />);
    expect(tile(/ครบใน 3 วัน/)).toBeDisabled();
    expect(tile(/นิ่งเกิน 3 วัน/)).toBeDisabled();
    expect(tile(/เลยกำหนด/)).toBeEnabled();
    await user.click(tile(/เลยกำหนด/));
    getJobBoard.mockResolvedValue({ ok: true, data: board([row(), row()]) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(tileN(/เลยกำหนด/)).toBe(0);
    expect(tile(/เลยกำหนด/)).toBeEnabled();
    expect(tile(/เลยกำหนด/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("ไม่มีใบงานที่ตรงตัวกรอง")).toBeInTheDocument();
    await user.click(tile(/เลยกำหนด/));
    expect(screen.queryByText("ไม่มีใบงานที่ตรงตัวกรอง")).toBeNull();
  });
});

describe("งานที่วิ่งอยู่ — ป้ายสถานะ/เรียง/cap 10", () => {
  it("เรียงเร่งด่วนก่อน · ต้องดู k ใบ · ป้ายหลักเป็นข้อความ", () => {
    const rows = [row({ designLabel: "ปกติ" }), row({ designLabel: "นิ่ง", isStale: true }), row({ designLabel: "เลย", isOverdue: true, dueDate: "2026-10-11" })];
    const { container } = render(<JobBoard initial={board(rows)} />);
    const order = [...activeRows(container)].map((li) => li.textContent ?? "");
    expect(order[0]).toContain("เลย");
    expect(order[0]).toContain("เลยกำหนด 3 วัน");
    expect(order[1]).toContain("นิ่ง");
    expect(order[2]).toContain("เดินปกติ");
    expect(screen.getByText(/ต้องดู 2 ใบ/)).toBeInTheDocument();
  });
  it("ไม่มีใบที่ต้องตาม → ข้อความเขียว 'ไม่มีงานที่ต้องตามเป็นพิเศษ'", () => {
    render(<JobBoard initial={board([row(), row()])} />);
    expect(screen.getByText("ไม่มีงานที่ต้องตามเป็นพิเศษ")).toBeInTheDocument();
  });
  it("stale + on_hold เห็นป้ายนิ่ง (tile อ้าง) และป้ายพักไว้", () => {
    const { container } = render(<JobBoard initial={board([row({ isStale: true, status: "on_hold" })])} />);
    const li = activeRows(container)[0] as HTMLElement;
    expect(li.textContent).toContain("นิ่งเกิน 3 วัน");
    expect(li.textContent).toContain("พักไว้");
  });
  for (const total of [1, 10, 11, 50]) {
    it(`cap 10 — ข้อมูล ${total} ใบ`, async () => {
      const user = userEvent.setup();
      const { container } = render(<JobBoard initial={board(Array.from({ length: total }, () => row()))} />);
      expect(activeRows(container)).toHaveLength(Math.min(total, 10));
      const btn = screen.queryByRole("button", { name: `แสดงทั้งหมด ${total} ใบ` });
      if (total <= 10) {
        expect(btn).toBeNull();
        return;
      }
      expect(btn).toHaveAttribute("aria-expanded", "false");
      await user.click(btn!);
      expect(activeRows(container)).toHaveLength(total);
      expect(screen.getByRole("button", { name: "แสดงน้อยลง" })).toHaveAttribute("aria-expanded", "true");
      await user.click(screen.getByRole("button", { name: "แสดงน้อยลง" }));
      expect(activeRows(container)).toHaveLength(10);
    });
  }
  it("แถวมี control 2 ตัวที่ไม่ซ้อนกัน: ปุ่มดูในบอร์ด + ลิงก์ไปใบงาน", () => {
    const r = row();
    const { container } = render(<JobBoard initial={board([r])} />);
    const li = activeRows(container)[0];
    const btn = li.querySelector("button")!;
    const link = li.querySelector("a")!;
    expect(btn.contains(link)).toBe(false);
    expect(btn.querySelector("div, p, a, button")).toBeNull();
    expect(link).toHaveAttribute("href", `/jobs/${r.id}`);
    expect(link).toHaveAttribute("aria-label", `เปิดใบงาน ${r.jobNo}`);
  });
});

describe("focusJob — กดแถวแล้วเลื่อนไปการ์ดในบอร์ด", () => {
  it("PC โหมดบอร์ด: scrollIntoView กับการ์ดที่มองเห็น (board-job-) · focus ลิงก์การ์ด · ไฮไลต์ 3 วิแล้วถอด · aria-live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const r = row({ isOverdue: true, dueDate: "2026-10-11" });
    const { container } = render(<JobBoard initial={board([r, row()])} />);
    await user.click(activeRows(container)[0].querySelector("button")!);
    expect(scrolled.map((s) => s.id)).toEqual([`board-job-${r.id}`]);
    expect(scrolled[0].opts).toMatchObject({ block: "center", inline: "center", behavior: "smooth" });
    const link = container.querySelector(`#board-job-${r.id} a`) as HTMLElement;
    expect(link).toHaveFocus();
    expect(link.className).toContain("ring-primary-600");
    expect(link.className).toContain("bg-primary-50");
    expect(screen.getByText(`เลื่อนไปที่ ${r.jobNo} ในขั้น ปริ้น 3D ต้นแบบ`)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIGHLIGHT_MS + 50);
    });
    expect(link.className).not.toContain("bg-primary-50");
  });
  it("prefers-reduced-motion → behavior auto", async () => {
    const user = userEvent.setup();
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const { container } = render(<JobBoard initial={board([row()])} />);
    await user.click(activeRows(container)[0].querySelector("button")!);
    expect(scrolled[0].opts).toMatchObject({ behavior: "auto" });
  });
  it("มือถือ: ตั้ง chip ขั้นของใบนั้น (setStage) แล้วเลื่อนไปการ์ดชุด list", async () => {
    desktop = false;
    visiblePrefix = "list-job-";
    const user = userEvent.setup();
    const a = row({ stageCode: "wax", boardColumn: "wax", stageName: "ฉีดแว๊กซ์" });
    const { container } = render(<JobBoard initial={board([row(), a])} />);
    expect(chip(/^ทุกขั้น/)).toHaveAttribute("aria-pressed", "true");
    await user.click(container.querySelector(`li[data-job-id="${a.id}"] > button`)!);
    expect(chip(/^ฉีดแว๊กซ์/)).toHaveAttribute("aria-pressed", "true");
    expect(scrolled.map((s) => s.id)).toEqual([`list-job-${a.id}`]);
    expect(listCards(container)).toHaveLength(1);
  });
  it("PC โหมดรายการ: setStage แล้วเลื่อนชุด list", async () => {
    visiblePrefix = "list-job-";
    const user = userEvent.setup();
    const a = row({ stageCode: "wax", boardColumn: "wax", stageName: "ฉีดแว๊กซ์" });
    const { container } = render(<JobBoard initial={board([row(), a])} />);
    await user.click(screen.getByRole("button", { name: /รายการ/ }));
    await user.click(container.querySelector(`li[data-job-id="${a.id}"] > button`)!);
    expect(chip(/^ฉีดแว๊กซ์/)).toHaveAttribute("aria-pressed", "true");
    expect(scrolled.map((s) => s.id)).toEqual([`list-job-${a.id}`]);
  });
  it("ลิงก์เปิดใบงานไม่เรียก focusJob (ไม่เลื่อน ไม่ไฮไลต์)", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board([row()])} />);
    const link = activeRows(container)[0].querySelector("a")!;
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);
    expect(scrolled).toHaveLength(0);
    expect(screen.queryByText(/เลื่อนไปที่/)).toBeNull();
  });
  it("ปุ่ม 'กลับไปงานที่วิ่งอยู่' เลื่อนกลับ h2 + คืน focus แถวที่กดมา", async () => {
    const user = userEvent.setup();
    const r = row();
    const { container } = render(<JobBoard initial={board([r])} />);
    const rowBtn = activeRows(container)[0].querySelector("button")!;
    await user.click(rowBtn);
    scrolled.length = 0;
    await user.click(screen.getByRole("button", { name: /กลับไปงานที่วิ่งอยู่/ }));
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].id).toBe("active-jobs-heading");
    expect(rowBtn).toHaveFocus();
  });
});

describe("polling 30 วิ", () => {
  it("ตัวกรอง/tile/chip ขั้น/showAll/ไฮไลต์ไม่หลุด · focusReq ไม่ยิงซ้ำเมื่อ data เปลี่ยน", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    desktop = false;
    visiblePrefix = "list-job-";
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const base = Array.from({ length: 12 }, (_, i) => row({ isStale: true, stageCode: i % 2 ? "wax" : "print3d", boardColumn: i % 2 ? "wax" : "print3d" }));
    const { container } = render(<JobBoard initial={board(base)} />);
    await user.click(tile(/นิ่งเกิน 3 วัน/));
    await user.selectOptions(screen.getByLabelText("โลหะ"), "silver");
    await user.click(screen.getByRole("button", { name: "แสดงทั้งหมด 12 ใบ" }));
    await user.click(container.querySelector(`li[data-job-id="${base[1].id}"] > button`)!);
    const scrollsBefore = scrolled.length;
    expect(scrollsBefore).toBe(1);
    // รีเฟรชมือก่อนไฮไลต์ครบ 3 วิ → ไฮไลต์ต้องไม่หลุด (polling 30 วิภายหลังเลยเวลาไฮไลต์อยู่แล้ว)
    getJobBoard.mockResolvedValue({ ok: true, data: board(base.map((b) => ({ ...b, daysInStage: 9 }))) });
    await user.click(screen.getByRole("button", { name: "รีเฟรชบอร์ด" }));
    expect((container.querySelector(`#list-job-${base[1].id} a`) as HTMLElement).className).toContain("bg-primary-50");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(getJobBoard).toHaveBeenCalledTimes(2);
    expect(tile(/นิ่งเกิน 3 วัน/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("โลหะ")).toHaveValue("silver");
    expect(chip(/^ฉีดแว๊กซ์/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "แสดงน้อยลง" })).toHaveAttribute("aria-expanded", "true");
    expect(scrolled).toHaveLength(scrollsBefore);
  });
  it("ล้ม = ข้อมูลเดิมไม่หาย + แถบ amber + ลองใหม่ (สำเร็จแล้วแถบหาย)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(<JobBoard initial={board([row(), row()])} />);
    getJobBoard.mockResolvedValueOnce({ ok: false, error: "x" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(screen.getByText(/อัปเดตไม่สำเร็จ แสดงข้อมูลเดิม ณ/)).toBeInTheDocument();
    expect(activeRows(container)).toHaveLength(2);
    getJobBoard.mockResolvedValueOnce({ ok: true, data: board([row(), row(), row()]) });
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(screen.queryByText(/อัปเดตไม่สำเร็จ/)).toBeNull();
    expect(activeRows(container)).toHaveLength(3);
  });
  it("throw = ถือเป็นล้ม ไม่พังหน้า", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<JobBoard initial={board([row()])} />);
    getJobBoard.mockRejectedValueOnce(new Error("net"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(screen.getByText(/อัปเดตไม่สำเร็จ/)).toBeInTheDocument();
    expect(activeRows(container)).toHaveLength(1);
  });
});

describe("ตามขั้นตอนการผลิต — rail / chips / toggle", () => {
  it("rail: ทุกขั้นตามลำดับ · มีงาน = ปุ่ม · ว่าง = ป้ายประไม่ใช่ปุ่ม · คอลัมน์ว่างไม่ render จนกว่า toggle", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board([row(), row(), row({ stageCode: "wax", boardColumn: "wax", stageName: "ฉีดแว๊กซ์" })])} />);
    const rail = within(screen.getByRole("navigation", { name: "ขั้นตอนทั้งหมด" }));
    expect(rail.getByRole("button", { name: /ปริ้น 3D ต้นแบบ\s*2/ })).toBeInTheDocument();
    expect(rail.getByRole("button", { name: /ฉีดแว๊กซ์\s*1/ })).toBeInTheDocument();
    expect(rail.queryByRole("button", { name: /ออกแบบ CAD/ })).toBeNull();
    expect(rail.getByText(/ออกแบบ CAD/).closest("li")!.textContent).toMatch(/ออกแบบ CAD\s*0/);
    expect(container.querySelector("#board-col-cad")).toBeNull();
    expect(container.querySelector("#board-col-print3d")).not.toBeNull();
    // ว่าง: cad + awaiting_close = 2 (ยังไม่เริ่มว่างถูกซ่อนเสมอ)
    const toggle = screen.getByRole("checkbox", { name: /แสดงขั้นที่ไม่มีงาน \(2\)/ });
    await user.click(toggle);
    expect(container.querySelector("#board-col-cad")).not.toBeNull();
    expect(container.querySelector("#board-col-awaiting_close")).not.toBeNull();
    await user.click(toggle);
    expect(container.querySelector("#board-col-cad")).toBeNull();
  });
  it("กด pill ใน rail → เลื่อนไปคอลัมน์ (inline center) + focus h3", async () => {
    const user = userEvent.setup();
    render(<JobBoard initial={board([row(), row({ stageCode: "wax", boardColumn: "wax" })])} />);
    await user.click(within(screen.getByRole("navigation", { name: "ขั้นตอนทั้งหมด" })).getByRole("button", { name: /ฉีดแว๊กซ์/ }));
    expect(scrolled.at(-1)).toMatchObject({ id: "board-col-wax", opts: { inline: "center" } });
    expect(document.getElementById("board-col-wax")).toHaveFocus();
  });
  it("chips: โหมดรายการสลับได้ · กรองถูก · เฉพาะขั้นที่มีงาน + 'อีก n ขั้นยังไม่มีงาน' · ขั้นที่เลือกว่างหลังรีเฟรช → ทุกขั้น", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const w = row({ stageCode: "wax", boardColumn: "wax" });
    const { container } = render(<JobBoard initial={board([row(), row(), w])} />);
    await user.click(screen.getByRole("button", { name: /รายการ/ }));
    expect(chip("ทุกขั้น (3)")).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "กรองตามขั้น" })).queryByRole("button", { name: /ออกแบบ CAD/ })).toBeNull();
    expect(screen.getByText("อีก 2 ขั้นยังไม่มีงาน")).toBeInTheDocument();
    await user.click(chip("ฉีดแว๊กซ์ (1)"));
    expect(listCards(container)).toHaveLength(1);
    expect(boardCards(container)).toHaveLength(0);
    getJobBoard.mockResolvedValue({ ok: true, data: board([row(), row()]) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(chip("ทุกขั้น (2)")).toHaveAttribute("aria-pressed", "true");
    expect(listCards(container)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "บอร์ด" }));
    expect(boardCards(container)).toHaveLength(2);
  });
});

describe("empty / ความปลอดภัยของข้อมูล", () => {
  it("(ก) ไม่มีใบเลย: EmptyState เดิม · ซ่อน tile/ตัวกรอง/สองส่วน", () => {
    render(<JobBoard initial={board([])} />);
    expect(screen.getByText("ยังไม่มีใบงานที่เปิดอยู่")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "สรุป" })).toBeNull();
    expect(screen.queryByLabelText("โลหะ")).toBeNull();
    expect(screen.queryByText(/งานที่วิ่งอยู่/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "ใบงานผลิต" })).toBeInTheDocument();
  });
  it("(ข) กรองแล้วไม่เจอ: tile+ตัวกรอง+แถบกำลังกรองยังอยู่ · ซ่อนส่วนบอร์ด · ปุ่มล้างตัวกรองคืนข้อมูล", async () => {
    const user = userEvent.setup();
    const { container } = render(<JobBoard initial={board([row(), row()])} />);
    await user.selectOptions(screen.getByLabelText("โลหะ"), "gold");
    expect(screen.getByText("ไม่มีใบงานที่ตรงตัวกรอง")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "สรุป" })).toBeInTheDocument();
    expect(screen.getByText(/กำลังกรอง/)).toBeInTheDocument();
    expect(screen.queryByText("ตามขั้นตอนการผลิต")).toBeNull();
    const clear = screen.getAllByRole("button", { name: "ล้างตัวกรอง" });
    await user.click(clear[clear.length - 1]);
    expect(activeRows(container)).toHaveLength(2);
    expect(screen.getByLabelText("โลหะ")).toHaveValue("");
  });
  it("truncated = แถบเดิมยังอยู่", () => {
    render(<JobBoard initial={board([row()], { truncated: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("แสดงใบงานไม่ครบ");
  });
  it("🔴 DOM ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/sourceRef", () => {
    const rows = [row({ sourceRef: "QT-SECRET-2610-007", sku: "SKU-HIDDEN-1", isOverdue: true, dueDate: "2026-10-10" }), row({ sourceRef: "PO-CUSTOMER-ACME" })];
    const { container } = render(<JobBoard initial={board(rows)} />);
    const html = container.innerHTML;
    for (const s of ["QT-SECRET-2610-007", "PO-CUSTOMER-ACME", "SKU-HIDDEN-1"]) expect(html).not.toContain(s);
    expect(container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|margin|ลูกค้า/);
  });
  it("มือถือ: ปุ่มตัวกรอง (n) พับ/กางได้ aria-expanded", async () => {
    const user = userEvent.setup();
    render(<JobBoard initial={board([row()])} />);
    const btn = screen.getByRole("button", { name: /^ตัวกรอง/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await user.selectOptions(screen.getByLabelText("โลหะ"), "silver");
    expect(screen.getByRole("button", { name: "ตัวกรอง (1)" })).toBeInTheDocument();
  });
});
