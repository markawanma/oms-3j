// @vitest-environment jsdom
// ShootBoard: ติ๊กช็อต (optimistic + ย้อนเมื่อล้ม) · จบรอบ: ถามยืนยันเมื่อช็อตไม่ครบ (3.8) · ส่งเฉพาะชิ้นที่ติ๊ก · ล้มรายชิ้นแสดงรายชิ้น
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing/shoot" }));
const toggleShot = vi.fn();
const deferPiece = vi.fn();
vi.mock("@/lib/actions/content-pieces", () => ({ toggleShot: (...a: unknown[]) => toggleShot(...a), deferPiece: (...a: unknown[]) => deferPiece(...a) }));
const finishShootRound = vi.fn();
vi.mock("@/lib/actions/content-shoot", () => ({ finishShootRound: (...a: unknown[]) => finishShootRound(...a) }));

import { ShootBoard } from "./ShootBoard";
import { toShootItems } from "@/lib/marketing/shoot";
import type { PieceRow } from "@/lib/marketing/piece-types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ART = "33333333-3333-4333-8333-333333333333";
const brief = (shots: { id: string; desc: string; done: boolean }[]) => ({ shots }) as unknown as PieceRow["clipBrief"];
const piece = (o: Partial<PieceRow>): PieceRow =>
  ({ stepId: A, title: "คลิป A", pieceStatus: "approved", footageStatus: "needs_shoot", shootLocation: "factory", shootMinutesEst: 15, resolvedStart: "2026-10-13", artifactId: ART, pieceKind: "short_clip", channel: "tiktok", expectedHostLabel: null, shootNote: null, contentTypeCode: null, ...o }) as PieceRow;

const items = () =>
  toShootItems([
    piece({ stepId: A, title: "คลิป A", clipBrief: brief([{ id: "s1", desc: "ช็อตแรก", done: false }, { id: "s2", desc: "ช็อตสอง", done: false }]) }),
    piece({ stepId: B, title: "อัลบั้ม B", shootLocation: "product_table", clipBrief: null }),
  ]);
const renderBoard = () =>
  render(
    <ToastProvider>
      <ShootBoard items={items()} contentTypes={[]} todayTh="2026-10-12" shareUrlPath="/marketing/shoot" />
    </ToastProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  toggleShot.mockResolvedValue({ ok: true, data: undefined });
  finishShootRound.mockResolvedValue({ ok: true, data: { results: [{ stepId: A, ok: true }, { stepId: B, ok: true }] } });
});

describe("ShootBoard", () => {
  it("แสดงสรุป + กลุ่มสถานที่ + ชิ้นไม่มี shot list บอกชัด", () => {
    renderBoard();
    expect(screen.getByText(/2 ชิ้น · 2 ช็อต · ประเมิน 30 นาที/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /โรงงาน/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /โต๊ะถ่ายสินค้า/ })).toBeInTheDocument();
    expect(screen.getByText(/ไม่มี shot list/)).toBeInTheDocument();
  });

  it("ติ๊กช็อต → เรียก toggleShot(step, artifact, shot, true) และนับเพิ่มทันที", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("checkbox", { name: "ช็อตแรก" }));
    await waitFor(() => expect(toggleShot).toHaveBeenCalledWith(A, ART, "s1", true));
    expect(screen.getByText(/ติ๊กแล้ว 1\/2 ช็อต/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // local state — ไม่รีโหลดทั้งหน้าทุกครั้งที่ติ๊ก
  });

  it("DB ปฏิเสธการติ๊ก → ย้อนกลับ + แสดงข้อความไทย", async () => {
    toggleShot.mockResolvedValue({ ok: false, error: "ติ๊กช็อตไม่สำเร็จ ลองใหม่อีกครั้ง" });
    renderBoard();
    await userEvent.click(screen.getByRole("checkbox", { name: "ช็อตแรก" }));
    expect(await screen.findByText("ติ๊กช็อตไม่สำเร็จ ลองใหม่อีกครั้ง")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "ช็อตแรก" })).not.toBeChecked();
  });

  it("จบรอบโดยไม่ติ๊กชิ้นไหน → บอกให้ติ๊ก ไม่เรียก server", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย/ }));
    expect(await screen.findByText(/ติ๊ก “ถ่ายครบ” อย่างน้อยหนึ่งชิ้น/)).toBeInTheDocument();
    expect(finishShootRound).not.toHaveBeenCalled();
  });

  it("ติ๊กถ่ายครบแต่ช็อตไม่ครบ → กล่องยืนยัน (ย้อนกลับ = ไม่ส่ง · ยืนยัน = ส่ง)", async () => {
    renderBoard();
    await userEvent.click(document.getElementById(`done-${A}`)!);
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/คลิป A — ยังเหลือ 2 ช็อต/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "กลับไปติ๊กช็อต" }));
    expect(finishShootRound).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "ยืนยัน ถ่ายครบแล้ว" }));
    await waitFor(() => expect(finishShootRound).toHaveBeenCalledWith({ stepIds: [A], note: "", folderUrl: "" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("ต้องไม่พัง: ชิ้นไม่มี shot list ติ๊กถ่ายครบได้เลยโดยไม่ถามยืนยัน · ส่ง note/ลิงก์ไปด้วย", async () => {
    renderBoard();
    await userEvent.click(document.getElementById(`done-${B}`)!);
    await userEvent.type(screen.getByLabelText(/ลิงก์โฟลเดอร์ไฟล์/), "https://example.test/f");
    await userEvent.type(screen.getByLabelText(/ต่างจาก storyboard/), "เปลี่ยนมุมกล้อง");
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    await waitFor(() => expect(finishShootRound).toHaveBeenCalledWith({ stepIds: [B], note: "เปลี่ยนมุมกล้อง", folderUrl: "https://example.test/f" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("บางชิ้นล้ม → แสดงรายชิ้นพร้อมข้อความ (ชิ้นอื่นสำเร็จแล้วไม่ถูกย้อน)", async () => {
    finishShootRound.mockResolvedValue({ ok: true, data: { results: [{ stepId: B, ok: false, error: "เปลี่ยนสถานะไปแล้ว" }] } });
    renderBoard();
    await userEvent.click(document.getElementById(`done-${B}`)!);
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    const alert = await screen.findByText(/อัลบั้ม B — เปลี่ยนสถานะไปแล้ว/);
    expect(alert).toBeInTheDocument();
  });
});

describe("ShootBoard — code review should-fix", () => {
  const ui = (its: ReturnType<typeof items>) => (
    <ToastProvider>
      <ShootBoard items={its} contentTypes={[]} todayTh="2026-10-12" shareUrlPath="/marketing/shoot" />
    </ToastProvider>
  );

  it("ข้อ 3: ชิ้นที่ติ๊กถ่ายครบแต่หายจากรายการ (refresh) ไม่ถูกนับและไม่ถูกส่ง", async () => {
    const both = items();
    const { rerender } = render(ui(both));
    await userEvent.click(document.getElementById(`done-${A}`)!);
    await userEvent.click(document.getElementById(`done-${B}`)!);
    expect(screen.getByRole("button", { name: /จบรอบถ่าย \(2 ชิ้น\)/ })).toBeInTheDocument();
    rerender(ui(both.filter((i) => i.piece.stepId === B))); // A หายไป (เปลี่ยนสถานะ/สัปดาห์เปลี่ยน)
    expect(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    await waitFor(() => expect(finishShootRound).toHaveBeenCalledWith({ stepIds: [B], note: "", folderUrl: "" }));
  });

  it("ข้อ 3: ชิ้นที่ติ๊กไว้หายหมด → เท่ากับยังไม่ได้ติ๊ก (ไม่เรียก server)", async () => {
    const { rerender } = render(ui(items()));
    await userEvent.click(document.getElementById(`done-${B}`)!);
    rerender(ui(items().filter((i) => i.piece.stepId === A)));
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(0 ชิ้น\)/ }));
    expect(await screen.findByText(/ติ๊ก “ถ่ายครบ” อย่างน้อยหนึ่งชิ้น/)).toBeInTheDocument();
    expect(finishShootRound).not.toHaveBeenCalled();
  });

  it("ข้อ 10: ป้ายใต้ช่องบอกว่าต่อท้ายหมายเหตุเดิม · จบรอบสำเร็จแล้วล้างช่องหมายเหตุ/ลิงก์ · เตือนรายชิ้นแสดง", async () => {
    finishShootRound.mockResolvedValue({ ok: true, data: { results: [{ stepId: B, ok: true, warning: "หมายเหตุใหม่ยาวเกินที่รับได้ — ตัดให้พอดี (หมายเหตุเดิมไม่ถูกตัด)" }] } });
    render(ui(items()));
    expect(screen.getByLabelText(/ต่อท้ายหมายเหตุเดิมของทุกชิ้นที่ติ๊ก/)).toBeInTheDocument();
    await userEvent.click(document.getElementById(`done-${B}`)!);
    await userEvent.type(screen.getByLabelText(/ลิงก์โฟลเดอร์ไฟล์/), "https://example.test/f");
    await userEvent.type(screen.getByLabelText(/ต่างจาก storyboard/), "เปลี่ยนมุม");
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    await waitFor(() => expect(screen.getByLabelText(/ต่างจาก storyboard/)).toHaveValue(""));
    expect(screen.getByLabelText(/ลิงก์โฟลเดอร์ไฟล์/)).toHaveValue("");
    expect(await screen.findByText(/อัลบั้ม B — หมายเหตุใหม่ยาวเกินที่รับได้/)).toBeInTheDocument();
  });

  it("ข้อ 10: ถ้าชิ้นล้มทั้งหมด ไม่ล้างช่อง (ผู้ใช้ยังไม่เสียสิ่งที่พิมพ์)", async () => {
    finishShootRound.mockResolvedValue({ ok: true, data: { results: [{ stepId: B, ok: false, error: "เปลี่ยนสถานะไปแล้ว" }] } });
    render(ui(items()));
    await userEvent.click(document.getElementById(`done-${B}`)!);
    await userEvent.type(screen.getByLabelText(/ต่างจาก storyboard/), "มุมใหม่");
    await userEvent.click(screen.getByRole("button", { name: /จบรอบถ่าย \(1 ชิ้น\)/ }));
    await screen.findByText(/อัลบั้ม B — เปลี่ยนสถานะไปแล้ว/);
    expect(screen.getByLabelText(/ต่างจาก storyboard/)).toHaveValue("มุมใหม่");
  });
});
