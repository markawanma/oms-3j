// @vitest-environment jsdom
// บอร์ด (0181): 1 การ์ดต่อใบแม่ · บรรทัด "เสร็จ x/N · ขั้น n …" · ป้าย "n ส่วน" + "รอชี้แจง n ชิ้น" · ใบเดี่ยวไม่เปลี่ยน
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("@/lib/actions/job-office", () => ({ getJobBoard: vi.fn() }));

import { JobBoard } from "./JobBoard";
import { JobCard } from "./JobCard";
import type { BoardData } from "@/lib/actions/job-office";
import type { BoardRow, StageDef } from "@/lib/jobs/types";

const TODAY = "2026-10-19";
const STAGES: StageDef[] = [
  { code: "cast", nameTh: "หล่อ", seq: 1 },
  { code: "setting", nameTh: "ฝังพลอย", seq: 2 },
  { code: "qc", nameTh: "ตรวจ QC", seq: 3 },
];

const row = (o: Partial<BoardRow> = {}): BoardRow => ({
  id: "id-solo", jobNo: "JB-0021", seq: 21, sourceKind: "production", sourceRef: null, designLabel: "แหวนใบไม้", sku: null, metal: "silver", qtyPlanned: 30, status: "in_progress", dueDate: null,
  stageCode: "cast", stageName: "หล่อ", stageStatus: "received", holderName: "ช่าง ก", daysInStage: 1, isOverdue: false, lastEventAt: null, lastScanAt: null, isStale: false,
  stageCount: 8, stageDoneCount: 1, hasAutoClosed: false, depositMissing: false, startGateNotePresent: false, quoteQtyMismatch: false, quoteItemQty: null, createdAt: null,
  boardColumn: "cast", handoffGapG: null, handoffMismatchCount: 0, qtyOrder: 30, qtySurplus: null, underPlanned: false, surplusPending: false, surplusDisposition: null, targetPieceG: null, metalPlanG: null,
  profileName: null, hasWeigh: false, goldUnguarded: false, ...o,
});

const split = (o: Partial<BoardRow> = {}): BoardRow =>
  row({
    id: "id-split", jobNo: "JB-0020", seq: 20, designLabel: "แหวนโกเมนไข่", qtyPlanned: 100, qtyOrder: 100, stageCode: "cast", boardColumn: "cast",
    partsCount: 4, partsOpen: 4, dominantStageCode: "setting", lotsLine: "เสร็จ 34/100 · ฝังพลอย 60 · ตรวจ QC 5 · เสีย 1", lotsSumOk: true, ...o,
  });

const board = (rows: BoardRow[]): BoardData => ({ todayTh: TODAY, rows, stages: STAGES, truncated: false, workers: [] });

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.id.startsWith("board-job-") ? [{}] : []) as unknown as DOMRectList;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JobCard", () => {
  it("ใบแยกส่วน: บรรทัดสรุปทั้งใบ + ป้าย '4 ส่วน' · title บอก 'รวม 100 ครบ' ตาม sum_check ของ DB", () => {
    render(<ul><JobCard row={split()} todayTh={TODAY} /></ul>);
    const line = screen.getByText("เสร็จ 34/100 · ฝังพลอย 60 · ตรวจ QC 5 · เสีย 1");
    expect(line).toHaveAttribute("title", "รวม 100 ครบ");
    expect(screen.getByText("4 ส่วน")).toBeInTheDocument();
  });

  it("sum_check เป็นเท็จ: ขึ้น '(ตัวเลขรวมไม่ครบ)' ไม่อ้างว่าครบ", () => {
    render(<ul><JobCard row={split({ lotsSumOk: false })} todayTh={TODAY} /></ul>);
    expect(screen.getByText(/ตัวเลขรวมไม่ครบ/)).toBeInTheDocument();
    expect(screen.queryByTitle("รวม 100 ครบ")).not.toBeInTheDocument();
  });

  it("รอชี้แจง n ชิ้น = ป้ายหลัก (ต้องดู) · ใบเดี่ยวไม่มีบรรทัด/ป้ายส่วน", () => {
    const { unmount } = render(<ul><JobCard row={split({ qtyPendingExplanation: 5 })} todayTh={TODAY} /></ul>);
    expect(screen.getByText("รอชี้แจง 5 ชิ้น")).toBeInTheDocument();
    unmount();
    render(<ul><JobCard row={row()} todayTh={TODAY} /></ul>);
    expect(screen.queryByText(/ส่วน$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/เสร็จ \d+\/\d+/)).not.toBeInTheDocument();
    expect(screen.getByText("เดินปกติ")).toBeInTheDocument();
  });
});

describe("JobBoard", () => {
  it("การ์ดต่อใบแม่ใบละ 1 ใบ (ไม่ใช่ต่อส่วน) · ใบเดี่ยวข้างเคียงไม่ถูกแตะ", () => {
    const { container } = render(<JobBoard initial={board([split(), row()])} />);
    expect(container.querySelectorAll('li[id^="board-job-"]')).toHaveLength(2);
    expect(container.querySelectorAll('li[id="board-job-id-split"]')).toHaveLength(1);
    const solo = container.querySelector('li[id="board-job-id-solo"]') as HTMLElement;
    expect(within(solo).queryByText(/เสร็จ \d+\/\d+/)).not.toBeInTheDocument();
  });

  it("ใบที่ของกระจายหลายขั้นไปอยู่คอลัมน์ของขั้นที่มีชิ้นมากสุด (ฝังพลอย) ไม่ใช่ขั้นของส่วนหลัก (หล่อ)", () => {
    const { container } = render(<JobBoard initial={board([split()])} />);
    const card = container.querySelector('li[id="board-job-id-split"]') as HTMLElement;
    const col = card.closest("div.w-72") as HTMLElement;
    expect(within(col).getByRole("heading", { level: 3 })).toHaveTextContent("ฝังพลอย");
  });

  it("ในส่วน 'งานที่วิ่งอยู่' แถวของใบแยกส่วนมีบรรทัดสรุปเช่นกัน", () => {
    const { container } = render(<JobBoard initial={board([split()])} />);
    const active = container.querySelector("li[data-job-id='id-split']") as HTMLElement;
    expect(within(active).getByText(/เสร็จ 34\/100/)).toBeInTheDocument();
  });
});
