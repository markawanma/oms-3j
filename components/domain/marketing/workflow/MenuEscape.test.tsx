// @vitest-environment jsdom
// Escape ในเมนูเพิ่มเติม (PieceActionBar ⋯ และ SubNav "อื่นๆ"): ปิดเมนู + คืนโฟกัสปุ่มเปิด
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/marketing",
}));
vi.mock("@/lib/actions/content-pieces", () => ({ advancePiece: vi.fn(), unlinkPost: vi.fn(), deferPiece: vi.fn(), setPlan: vi.fn(), postPiece: vi.fn(), postPieceNoUrl: vi.fn() }));
vi.mock("@/lib/actions/content", () => ({ inspectContentLink: vi.fn() }));

import { PieceActionBar } from "./PieceActionBar";
import { MarketingSubNav } from "@/components/domain/marketing/MarketingSubNav";
import { mapPieceRow } from "@/lib/marketing/piece-types";

describe("Escape คืนโฟกัสปุ่มเปิดเมนู", () => {
  it("PieceActionBar ⋯: กด Escape ขณะโฟกัสในรายการ → รายการหาย · โฟกัสกลับ ⋯", async () => {
    const piece = mapPieceRow({ step_id: "11111111-1111-4111-8111-111111111111", campaign_id: "c", title: "t", piece_status: "in_review", effective_piece_status: "in_review", piece_kind: "short_clip", resolved_start: "2026-10-12" });
    render(
      <ToastProvider>
        <PieceActionBar piece={piece} hosts={[]} contentTypes={[]} todayTh="2026-10-09" restoreForcesReview={false} />
      </ToastProvider>
    );
    const trigger = screen.getByRole("button", { name: "เมนูเพิ่มเติม" });
    await userEvent.click(trigger);
    const list = screen.getByRole("list", { name: "การกระทำเพิ่มเติม" });
    const first = within(list).getAllByRole("button")[0];
    first.focus();
    expect(first).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "การกระทำเพิ่มเติม" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("SubNav อื่นๆ: กด Escape ขณะโฟกัสในรายการ → รายการหาย · โฟกัสกลับปุ่ม อื่นๆ", async () => {
    render(<MarketingSubNav />);
    const trigger = screen.getByRole("button", { name: /อื่นๆ/ });
    await userEvent.click(trigger);
    const list = screen.getByRole("list", { name: "เมนูการตลาดอื่นๆ" });
    const link = within(list).getAllByRole("link")[0];
    link.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "เมนูการตลาดอื่นๆ" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
