// @vitest-environment jsdom
// IdeaCard: ✓ ต้องเลือกวันเอง · LINE เกินโควตาถามก่อนแต่ไม่บล็อก · 55000 แสดงสิ่งที่ขาด + แก้แผน · ✗ ต้องมีเหตุผล · ยกเลิกการเลือก
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing/triage" }));
const chooseIdea = vi.fn();
const skipIdea = vi.fn();
const holdIdea = vi.fn();
const unchooseIdea = vi.fn();
const resumeIdea = vi.fn();
vi.mock("@/lib/actions/content-triage", () => ({
  chooseIdea: (...a: unknown[]) => chooseIdea(...a),
  skipIdea: (...a: unknown[]) => skipIdea(...a),
  holdIdea: (...a: unknown[]) => holdIdea(...a),
  unchooseIdea: (...a: unknown[]) => unchooseIdea(...a),
  resumeIdea: (...a: unknown[]) => resumeIdea(...a),
}));
vi.mock("@/lib/actions/content-pieces", () => ({ advancePiece: vi.fn(), setPlan: vi.fn() }));

import { ChosenRow, HeldIdeaRow, IdeaCard } from "./IdeaCard";
import type { IdeaCardShared } from "./IdeaCard";
import type { LineQuota, PieceRow } from "@/lib/marketing/piece-types";

const STEP = "11111111-1111-4111-8111-111111111111";
const piece = (o: Partial<PieceRow> = {}): PieceRow =>
  ({
    stepId: STEP,
    title: "ใส่อาบน้ำได้ไหม?",
    pieceStatus: "idea",
    effectiveStatus: "idea",
    holdReason: null,
    pieceKind: "short_clip",
    channel: "tiktok",
    customerGroup: "jewelry_925",
    hypothesis: "คำถามที่ถูกถามซ้ำ จะได้อัตราบันทึกสูงกว่าค่ากลาง",
    metricCode: "save_rate",
    baselineValue: 0.3,
    baselineAsOf: "2026-10-11",
    passThreshold: 0.36,
    passOp: ">=",
    thresholdTooNarrow: false,
    hooks: [],
    draftedByAi: true,
    resolvedStart: null,
    resolvedEnd: null,
    sourceSignalId: null,
    footageStatus: "needs_shoot",
    shootNote: "มือใส่แหวนใต้น้ำ",
    contentTypeCode: null,
    ...o,
  }) as PieceRow;

const quota = (o: Partial<LineQuota> = {}): LineQuota => ({ used28d: 4, planned28d: 1, quota: 4, remaining28d: 0, overQuotaPlanned: true, ...o });
const shared = (o: Partial<IdeaCardShared> = {}): IdeaCardShared => ({
  weekDays: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
  dayCounts: { "2026-10-14": 2 },
  lineQuota: null,
  hosts: [],
  contentTypes: [],
  todayTh: "2026-10-12",
  ...o,
});
const renderCard = (p: PieceRow, s: IdeaCardShared) =>
  render(
    <ToastProvider>
      <ul>
        <IdeaCard piece={p} shared={s} />
      </ul>
    </ToastProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  chooseIdea.mockResolvedValue({ ok: true, data: { date: "2026-10-14" } });
  skipIdea.mockResolvedValue({ ok: true, data: undefined });
  holdIdea.mockResolvedValue({ ok: true, data: undefined });
  unchooseIdea.mockResolvedValue({ ok: true, data: undefined });
  resumeIdea.mockResolvedValue({ ok: true, data: undefined });
});

describe("IdeaCard — ✓ ทำ", () => {
  it("ไม่เลือกวันให้เอง: select ว่าง · ปุ่ม ทำ ปิดอยู่ · มีข้อความบอก", () => {
    renderCard(piece(), shared());
    expect(screen.getByLabelText("ลงวัน")).toHaveValue("");
    expect(screen.getByRole("button", { name: "ทำ" })).toBeDisabled();
    expect(screen.getByText(/เลือกวันก่อนจึงกด/)).toBeInTheDocument();
  });

  it("ตัวเลือกวันบอกจำนวนชิ้นต่อวัน · เลือกวัน → กด ทำ → เรียก chooseIdea(stepId, วัน)", async () => {
    renderCard(piece(), shared());
    const sel = screen.getByLabelText("ลงวัน");
    expect(within(sel).getByRole("option", { name: /มี 2 ชิ้น/ })).toBeInTheDocument();
    await userEvent.selectOptions(sel, "2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    await waitFor(() => expect(chooseIdea).toHaveBeenCalledWith(STEP, "2026-10-14"));
    expect(refresh).toHaveBeenCalled();
  });

  it("LINE + เกินโควตา → กล่องถามก่อน · กลับไปก่อน = ไม่เรียก · ทำต่อ = เรียก (ไม่บล็อก)", async () => {
    renderCard(piece({ pieceKind: "line_message", channel: "line_oa" }), shared({ lineQuota: quota() }));
    await userEvent.selectOptions(screen.getByLabelText("ลงวัน"), "2026-10-15");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    expect(await screen.findByText(/เกินโควตา LINE ในรอบ 28 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/ส่งแล้ว 4\/4/)).toBeInTheDocument();
    expect(chooseIdea).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "กลับไปก่อน" }));
    expect(chooseIdea).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    await userEvent.click(await screen.findByRole("button", { name: "ทำต่อ" }));
    await waitFor(() => expect(chooseIdea).toHaveBeenCalledWith(STEP, "2026-10-15"));
  });

  it("ต้องไม่พัง: คลิป TikTok ที่โควตา LINE เกิน → ไม่ถามอะไร ทำเลย · LINE ที่โควตายังเหลือ → ทำเลย", async () => {
    const { unmount } = renderCard(piece(), shared({ lineQuota: quota() }));
    await userEvent.selectOptions(screen.getByLabelText("ลงวัน"), "2026-10-13");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    await waitFor(() => expect(chooseIdea).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/เกินโควตา LINE/)).not.toBeInTheDocument();
    unmount();
    renderCard(piece({ pieceKind: "line_message", channel: "line_oa" }), shared({ lineQuota: quota({ remaining28d: 2, overQuotaPlanned: false }) }));
    await userEvent.selectOptions(screen.getByLabelText("ลงวัน"), "2026-10-13");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    await waitFor(() => expect(chooseIdea).toHaveBeenCalledTimes(2));
  });

  it("DB ปฏิเสธ 55000 → แสดงรายการที่ขาด + ปุ่ม แก้แผน (ไม่ refresh ไม่หายจากรายการ)", async () => {
    chooseIdea.mockResolvedValue({ ok: false, error: "วางแผนไม่ได้ — ยังไม่มีเกณฑ์ผ่าน · ยังไม่ได้เลือกตัวชี้วัด" });
    renderCard(piece(), shared());
    await userEvent.selectOptions(screen.getByLabelText("ลงวัน"), "2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("ยังไม่มีเกณฑ์ผ่าน")).toBeInTheDocument();
    expect(within(alert).getByText("ยังไม่ได้เลือกตัวชี้วัด")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แก้แผน" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("error อื่น → แสดงข้อความตรงๆ ไม่มีปุ่ม แก้แผน", async () => {
    chooseIdea.mockResolvedValue({ ok: false, error: "บันทึกแผนไม่สำเร็จ ลองใหม่อีกครั้ง" });
    renderCard(piece(), shared());
    await userEvent.selectOptions(screen.getByLabelText("ลงวัน"), "2026-10-14");
    await userEvent.click(screen.getByRole("button", { name: "ทำ" }));
    expect(await screen.findByText("บันทึกแผนไม่สำเร็จ ลองใหม่อีกครั้ง")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "แก้แผน" })).not.toBeInTheDocument();
  });
});

describe("IdeaCard — ไม่ทำ / เลื่อน", () => {
  it("ไม่ทำ: ต้องกรอกเหตุผล ≥3 ตัวอักษรก่อนยืนยัน", async () => {
    renderCard(piece(), shared());
    await userEvent.click(screen.getByRole("button", { name: "ไม่ทำ" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "ไม่ทำ" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "ซ้ำกับคลิปเก่า");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(skipIdea).toHaveBeenCalledWith(STEP, "ซ้ำกับคลิปเก่า"));
  });

  it("เลื่อน: เหตุผลตั้งต้น 'เลื่อนไปรอบหน้า' กดยืนยันได้เลย และแก้ได้", async () => {
    renderCard(piece(), shared());
    await userEvent.click(screen.getByRole("button", { name: "เลื่อน" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toHaveValue("เลื่อนไปรอบหน้า");
    await userEvent.click(within(dialog).getByRole("button", { name: "เลื่อน" }));
    await waitFor(() => expect(holdIdea).toHaveBeenCalledWith(STEP, "เลื่อนไปรอบหน้า"));
  });
});

describe("IdeaCard — เนื้อหาบนการ์ด", () => {
  it("ตัวเลขดิบ ไม่มี % · เตือนเกณฑ์แคบ · peak_viewers ข้อความคงที่ · hook <2 ประเภทของคลิป", () => {
    renderCard(piece({ thresholdTooNarrow: true, metricCode: "peak_viewers" }), shared());
    expect(screen.getByText(/ฐาน 0.3/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("%");
    expect(screen.getByText(/ห่างจากค่าฐานน้อยกว่าช่วงแกว่ง/)).toBeInTheDocument();
    expect(screen.getByText("คลิปเดียวพิสูจน์ยอดไลฟ์ทั้งคืนไม่ได้")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มี hook ตั้งต้น 2 ประเภท")).toBeInTheDocument();
  });

  it("ต้องไม่พัง: ชิ้น LINE ไม่ขึ้นข้อความ hook · ไอเดียที่เคยมีวันบอกวันเดิม แต่ select ยังว่าง", () => {
    renderCard(piece({ pieceKind: "line_message", channel: "line_oa", resolvedStart: "2026-10-16" }), shared());
    expect(screen.queryByText(/hook ตั้งต้น/)).not.toBeInTheDocument();
    expect(screen.getByText(/วันที่ตั้งไว้เดิม/)).toBeInTheDocument();
    expect(screen.getByLabelText("ลงวัน")).toHaveValue("");
  });
});

describe("HeldIdeaRow / ChosenRow", () => {
  it("กลับมาคัด → resumeIdea", async () => {
    render(
      <ToastProvider>
        <ul>
          <HeldIdeaRow piece={piece({ holdReason: "รอภาพ" })} />
        </ul>
      </ToastProvider>
    );
    expect(screen.getByText(/เลื่อนไว้เพราะ: รอภาพ/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "กลับมาคัด" }));
    await waitFor(() => expect(resumeIdea).toHaveBeenCalledWith(STEP));
  });

  it("ยกเลิกการเลือก → unchooseIdea · ล้มแล้วแสดง error", async () => {
    unchooseIdea.mockResolvedValue({ ok: false, error: "เปลี่ยนสถานะไปแล้ว" });
    render(
      <ToastProvider>
        <ul>
          <ChosenRow piece={piece({ pieceStatus: "planned", resolvedStart: "2026-10-14" })} />
        </ul>
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกการเลือก" }));
    await waitFor(() => expect(unchooseIdea).toHaveBeenCalledWith(STEP));
    expect(await screen.findByText("เปลี่ยนสถานะไปแล้ว")).toBeInTheDocument();
  });
});
