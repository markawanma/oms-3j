// @vitest-environment jsdom
// บอร์ดใบงาน (W1 · UX B.10.3): tile ที่ 5 "รอรับทราบ" (ปุ่มกรอง · แดงถ้าค้างครบกำหนด) + ป้ายบนการ์ด จากหน้างาน/ยังไม่ผูก SKU/โลหะต่างจาก SKU
//  ต้องไม่พัง: ไม่มีใบจากหน้างาน = tile = 0 (ไม่ซ่อน — เลย์เอาต์ไม่กระโดด) · การ์ดเดิมไม่มีป้ายเพิ่ม
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("@/lib/actions/job-office", () => ({ getJobBoard: vi.fn() }));

import { JobBoard } from "./JobBoard";
import type { BoardData } from "@/lib/actions/job-office";
import type { BoardIntake, BoardRow, StageDef } from "@/lib/jobs/types";

const TODAY = "2026-10-21";
const STAGES: StageDef[] = [{ code: "wax", nameTh: "ฉีดแว๊กซ์", seq: 3 }];
let n = 0;
const row = (o: Partial<BoardRow> = {}): BoardRow => {
  n += 1;
  return {
    id: `id-${n}`, jobNo: `JB-${String(n).padStart(4, "0")}`, seq: n, sourceKind: "production", sourceRef: `PO-${n}`, designLabel: `แบบ ${n}`, sku: "RG-1", metal: "silver", qtyPlanned: 30, status: "in_progress", dueDate: null,
    stageCode: "wax", stageName: "ฉีดแว๊กซ์", stageStatus: "received", holderName: "ช่างสมชาย", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
    stageCount: 13, stageDoneCount: 3, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
    boardColumn: "wax", handoffGapG: null, handoffMismatchCount: 0, qtyOrder: 30, qtySurplus: null, underPlanned: false, surplusPending: false, surplusDisposition: null, targetPieceG: null, metalPlanG: null, profileName: null, hasWeigh: false, goldUnguarded: false, ...o,
  };
};
const intake = (o: Partial<BoardIntake> = {}): BoardIntake => ({ ackPending: true, openedAt: "2026-10-21T02:00:00Z", metalMismatch: false, ...o });
const board = (rows: BoardRow[], extra: Partial<BoardData> = {}): BoardData => ({ todayTh: TODAY, rows, stages: STAGES, truncated: false, workers: [], ...extra });

beforeEach(() => {
  n = 0;
  window.matchMedia = ((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const tiles = () => within(screen.getByRole("region", { name: "สรุป" }));
const tile = (re: RegExp) => tiles().getByRole("button", { name: re });
const tileN = (re: RegExp) => Number(/(\d+)\s*$/.exec(tile(re).textContent ?? "")?.[1]);
const boardCards = (c: HTMLElement) => c.querySelectorAll('li[id^="board-job-"]');

describe("tile 'รอรับทราบ'", () => {
  it("มี 5 tile · grid sm:3 lg:5 · นับเฉพาะใบที่ใบผลิตรอรับทราบ · amber เมื่อ n>0 ยังไม่ค้าง", () => {
    render(<JobBoard initial={board([row({ intake: intake() }), row({ intake: intake({ ackPending: false }) }), row()])} />);
    expect(tiles().getAllByRole("button")).toHaveLength(5);
    expect(screen.getByRole("region", { name: "สรุป" }).className).toMatch(/sm:grid-cols-3/);
    expect(screen.getByRole("region", { name: "สรุป" }).className).toMatch(/lg:grid-cols-5/);
    expect(tileN(/รอรับทราบ/)).toBe(1);
    expect(tile(/รอรับทราบ/).className).toMatch(/amber/);
  });
  it("มีใบค้างครบกำหนดเตือน (เปิดจันทร์ ดูพุธ) → tile แดง", () => {
    render(<JobBoard initial={board([row({ intake: intake({ openedAt: "2026-10-19T02:00:00Z" }) })])} />);
    expect(tile(/รอรับทราบ/).className).toMatch(/red/);
  });
  it("กดแล้วกรองเหลือใบรอรับทราบ ตัวเลขเท่าการ์ดบนบอร์ด · กดซ้ำล้าง · aria-pressed", async () => {
    const { container } = render(<JobBoard initial={board([row({ intake: intake() }), row({ intake: intake() }), row({ intake: intake({ ackPending: false }) }), row()])} />);
    expect(boardCards(container)).toHaveLength(4);
    await userEvent.click(tile(/รอรับทราบ/));
    expect(tile(/รอรับทราบ/)).toHaveAttribute("aria-pressed", "true");
    expect(boardCards(container)).toHaveLength(tileN(/รอรับทราบ/));
    expect(boardCards(container)).toHaveLength(2);
    expect(screen.getByText(/กำลังกรอง/)).toHaveTextContent("รอรับทราบ");
    await userEvent.click(tile(/รอรับทราบ/));
    expect(boardCards(container)).toHaveLength(4);
  });
  it("ไม่มีใบจากหน้างานเลย: tile ยังอยู่ = 0 (เทา disabled — ไม่ซ่อน)", () => {
    render(<JobBoard initial={board([row(), row()])} />);
    expect(tileN(/รอรับทราบ/)).toBe(0);
    expect(tile(/รอรับทราบ/)).toBeDisabled();
  });
});

describe("ข้อ 4: อ่านสถานะรับทราบล้ม → tile ขึ้น '—' ไม่ใช่ 0", () => {
  it("intakeFailed → ตัวเลข '—' + title/ข้อความ 'อ่านสถานะรับทราบไม่ได้' · กดไม่ได้ (ไม่มีตัวเลขให้กรอง) · tile อื่นยังนับปกติ", () => {
    render(<JobBoard initial={board([row(), row()], { intakeFailed: true })} />);
    const t = tile(/รอรับทราบ/);
    expect(t).toHaveTextContent("—");
    expect(t).not.toHaveTextContent(/\b0\b/);
    expect(t).toHaveAttribute("title", "อ่านสถานะรับทราบไม่ได้");
    expect(t).toHaveTextContent("อ่านสถานะรับทราบไม่ได้");
    expect(t).toBeDisabled();
    expect(t.className).not.toMatch(/amber|red/);
    expect(tileN(/ใบงานที่เปิดอยู่/)).toBe(2);
  });
  it("อ่านได้ปกติ (ไม่มี key) แต่ไม่มีใบรอรับทราบ → ยังเป็น 0 จริง (แยกจากอ่านล้ม)", () => {
    render(<JobBoard initial={board([row(), row()])} />);
    expect(tile(/รอรับทราบ/)).toHaveTextContent("0");
    expect(tile(/รอรับทราบ/)).not.toHaveAttribute("title");
  });
});

describe("ป้ายบนการ์ด", () => {
  it("ใบรอรับทราบ: ป้ายหลัก 'รอรับทราบ' (แดงเมื่อค้าง) + รอง 'จากหน้างาน'", () => {
    const { container } = render(<JobBoard initial={board([row({ intake: intake({ openedAt: "2026-10-19T02:00:00Z" }) })])} />);
    const card = boardCards(container)[0] as HTMLElement;
    expect(within(card).getByText("รอรับทราบ ค้าง 3 วัน")).toBeInTheDocument();
    expect(within(card).getByText("จากหน้างาน")).toBeInTheDocument();
  });
  it("ยังไม่ผูก SKU + โลหะต่างจาก SKU: ป้ายรอง (ข้อความเสมอ)", () => {
    const { container } = render(<JobBoard initial={board([row({ sku: null, intake: intake({ ackPending: false, metalMismatch: true }) })])} />);
    const card = boardCards(container)[0] as HTMLElement;
    expect(within(card).getByText(/ยังไม่ผูก SKU/)).toBeInTheDocument();
    expect(within(card).getByText("โลหะต่างจาก SKU")).toBeInTheDocument();
    expect(within(card).getByText("จากหน้างาน")).toBeInTheDocument();
    expect(within(card).getByText("เดินปกติ")).toBeInTheDocument();
  });
  it("การ์ดเดิม (ไม่มี intake): ไม่มีป้ายใหม่", () => {
    const { container } = render(<JobBoard initial={board([row({ sku: null })])} />);
    const card = boardCards(container)[0] as HTMLElement;
    expect(within(card).queryByText(/จากหน้างาน|รอรับทราบ|ยังไม่ผูก SKU|โลหะต่างจาก SKU/)).toBeNull();
  });
});
