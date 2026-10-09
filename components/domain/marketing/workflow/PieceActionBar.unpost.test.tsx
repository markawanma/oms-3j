// @vitest-environment jsdom
// code review ข้อ 6: ปลดโพสต์หลายช่องทางล้มกลางทาง → บอกจำนวนที่ปลดไปแล้ว + stale (refresh) ไม่ใช่ error ธรรมดา
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const unlinkPost = vi.fn();
vi.mock("@/lib/actions/content-pieces", () => ({
  advancePiece: vi.fn(),
  unlinkPost: (...a: unknown[]) => unlinkPost(...a),
  deferPiece: vi.fn(),
  setPlan: vi.fn(),
  postPiece: vi.fn(),
  postPieceNoUrl: vi.fn(),
}));
vi.mock("@/lib/actions/content", () => ({ inspectContentLink: vi.fn() }));

import { PieceActionBar } from "./PieceActionBar";
import { mapPieceRow } from "@/lib/marketing/piece-types";

const STEP = "11111111-1111-4111-8111-111111111111";
const posted = mapPieceRow({
  step_id: STEP,
  campaign_id: "c",
  title: "โพสต์ 2 ช่องทาง",
  piece_status: "posted",
  effective_piece_status: "posted",
  piece_kind: "ig_fb_post",
  channel: "facebook",
  resolved_start: "2026-10-08",
  posts: [
    { post_id: "p1", platform: "facebook", post_url: "https://facebook.com/x", status: "active" },
    { post_id: "p2", platform: "instagram", post_url: "https://instagram.com/x", status: "active" },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function unpost() {
  render(
    <ToastProvider>
      <PieceActionBar piece={posted} hosts={[]} contentTypes={[]} todayTh="2026-10-09" restoreForcesReview={false} />
    </ToastProvider>
  );
  await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
  await userEvent.click(screen.getByRole("button", { name: "ปลดโพสต์…" }));
  const dlg = await screen.findByRole("dialog");
  await userEvent.type(within(dlg).getByRole("textbox"), "ส่งผิดช่อง");
  await userEvent.click(within(dlg).getByRole("button", { name: "ปลดโพสต์" }));
  return dlg;
}

describe("ปลดโพสต์หลายช่องทาง", () => {
  it("ใบแรกสำเร็จ ใบสองล้ม → 'ปลดไปแล้ว 1 จาก 2' + stale ปิดกล่อง + refresh", async () => {
    unlinkPost.mockResolvedValueOnce({ ok: true, data: undefined }).mockResolvedValueOnce({ ok: false, error: "พัง" });
    await unpost();
    await waitFor(() => expect(unlinkPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
  it("ใบแรกล้ม → ไม่ลองใบต่อไป · ข้อความเดิมของ action ค้างในกล่อง", async () => {
    unlinkPost.mockResolvedValueOnce({ ok: false, error: "ปลดไม่ได้เพราะเหตุผลก" });
    const dlg = await unpost();
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("ปลดไม่ได้เพราะเหตุผลก");
    expect(unlinkPost).toHaveBeenCalledTimes(1);
  });
  it("ทั้งสองใบสำเร็จ → ปิดกล่อง", async () => {
    unlinkPost.mockResolvedValue({ ok: true, data: undefined });
    await unpost();
    await waitFor(() => expect(unlinkPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
