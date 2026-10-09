// @vitest-environment jsdom
// Luke — conflict: ผู้ใช้พิมพ์ค้างอยู่แล้ว server เปลี่ยน → ไม่เขียนทับเงียบ
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/content-pieces", () => ({ savePieceBody: vi.fn(), upsertHook: vi.fn() }));
vi.mock("@/components/domain/marketing/ClipBriefPanel", () => ({ ClipBriefPanel: () => null }));

import { PieceEditCard } from "./PieceEditCard";
import { PieceClientShell } from "./PieceClientShell";
import { mapPieceRow } from "@/lib/marketing/piece-types";

const mk = (body: string) =>
  mapPieceRow({
    step_id: "11111111-1111-4111-8111-111111111111",
    piece_status: "in_review",
    effective_piece_status: "in_review",
    piece_kind: "line_message",
    artifact_id: "22222222-2222-4222-8222-222222222222",
    artifact_type: "line_message",
    content_body: body,
  });

const tree = (body: string) => (
  <ToastProvider>
    <PieceClientShell>
      <PieceEditCard piece={mk(body)} />
    </PieceClientShell>
  </ToastProvider>
);

describe("PieceEditCard — server เปลี่ยนขณะผู้ใช้กำลังพิมพ์", () => {
  it("แจ้ง conflict + ปุ่มบันทึกปิด + ไม่ทับข้อความที่พิมพ์ · โหลดค่าล่าสุดแล้วกลับมาปกติ", async () => {
    const { rerender } = render(tree("ข้อความเดิม"));
    await userEvent.click(screen.getByRole("button", { name: "เปิดโหมดแก้" }));
    const box = screen.getByRole("textbox");
    await userEvent.type(box, " แก้เพิ่ม");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeEnabled();
    rerender(tree("ข้อความใหม่จากที่อื่น"));
    expect(screen.getByRole("textbox")).toHaveValue("ข้อความเดิม แก้เพิ่ม");
    expect(screen.getByRole("alert")).toHaveTextContent("ถูกแก้จากที่อื่น");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /โหลดค่าล่าสุด/ }));
    expect(screen.getByRole("textbox")).toHaveValue("ข้อความใหม่จากที่อื่น");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });
});
