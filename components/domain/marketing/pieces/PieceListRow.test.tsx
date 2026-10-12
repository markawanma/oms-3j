// @vitest-environment jsdom
// PieceListRow: ปุ่ม "กู้คืน" เฉพาะชิ้นที่ยกเลิก · ต้องกรอกเหตุผลก่อนส่ง restore · ชิ้นอื่นไม่มีปุ่ม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing/pieces" }));
const advancePiece = vi.fn();
vi.mock("@/lib/actions/content-pieces", () => ({ advancePiece: (...a: unknown[]) => advancePiece(...a) }));

import { PieceListRow } from "./PieceListRow";
import type { PieceRow } from "@/lib/marketing/piece-types";

const STEP = "11111111-1111-4111-8111-111111111111";
const piece = (o: Partial<PieceRow> = {}): PieceRow =>
  ({ stepId: STEP, title: "คลิปกินเจ", pieceStatus: "cancelled", effectiveStatus: "cancelled", holdReason: null, pieceKind: "short_clip", channel: "tiktok", resolvedStart: "2026-10-10", resolvedEnd: null, campaignName: "กินเจ", ...o }) as PieceRow;
const renderRow = (p: PieceRow) =>
  render(
    <ToastProvider>
      <ul>
        <PieceListRow piece={p} />
      </ul>
    </ToastProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  advancePiece.mockResolvedValue({ ok: true, data: { to: "x" } });
});

describe("PieceListRow", () => {
  it("ชิ้นที่ยกเลิก: กู้คืนต้องมีเหตุผล ≥3 → advancePiece(restore, {reason})", async () => {
    renderRow(piece());
    await userEvent.click(screen.getByRole("button", { name: "กู้คืน" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "กู้คืน" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "เจ้าของเปลี่ยนใจ");
    await userEvent.click(confirm);
    await waitFor(() => expect(advancePiece).toHaveBeenCalledWith(STEP, "restore", { reason: "เจ้าของเปลี่ยนใจ" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("ต้องไม่พัง: ชิ้นที่ยังเดินอยู่ไม่มีปุ่มกู้คืน · ลิงก์ไปหน้าชิ้นงานพร้อม from=pieces · ไม่มีวัน = บอกชัด", () => {
    renderRow(piece({ pieceStatus: "planned", effectiveStatus: "planned", resolvedStart: null }));
    expect(screen.queryByRole("button", { name: "กู้คืน" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "คลิปกินเจ" })).toHaveAttribute("href", `/marketing/pieces/${STEP}?from=pieces`);
    expect(screen.getByText(/ยังไม่ตั้งวัน/)).toBeInTheDocument();
  });

  it("กู้คืนล้ม (DB ปฏิเสธ) → กล่องค้างพร้อมข้อความไทย ไม่ปิดเงียบ", async () => {
    advancePiece.mockResolvedValue({ ok: false, error: "ไม่พบประวัติการยกเลิก — กู้คืนไม่ได้" });
    renderRow(piece());
    await userEvent.click(screen.getByRole("button", { name: "กู้คืน" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "ขอกู้คืน");
    await userEvent.click(within(dialog).getByRole("button", { name: "กู้คืน" }));
    expect(await within(dialog).findByText("ไม่พบประวัติการยกเลิก — กู้คืนไม่ได้")).toBeInTheDocument();
  });
});
