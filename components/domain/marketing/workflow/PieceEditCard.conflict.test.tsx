// @vitest-environment jsdom
// Luke — conflict: ผู้ใช้พิมพ์ค้างอยู่แล้ว server เปลี่ยน → ไม่เขียนทับเงียบ
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const savePieceBody = vi.fn();
vi.mock("@/lib/actions/content-pieces", () => ({ savePieceBody: (...a: unknown[]) => savePieceBody(...a), upsertHook: vi.fn() }));
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

describe("PieceEditCard — หลังบันทึกเอง server ส่งค่าที่เพิ่งบันทึกกลับมา (ไม่ใช่ conflict)", () => {
  async function saveThenRefresh(typed: string, serverReturns: string) {
    savePieceBody.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(tree("ข้อความเดิม"));
    await userEvent.click(screen.getByRole("button", { name: "เปิดโหมดแก้" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, typed);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกเนื้อหา" }));
    await waitFor(() => expect(savePieceBody).toHaveBeenCalled());
    rerender(tree(serverReturns)); // = router.refresh() ส่งค่าที่ server เก็บกลับมา
  }

  it("server ส่งค่าเป๊ะเท่าที่บันทึก → ไม่มี alert · ปุ่มบันทึกปิด", async () => {
    await saveThenRefresh("ข้อความใหม่", "ข้อความใหม่");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("ข้อความใหม่");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });

  it("server trim / ตัดอักขระล่องหนให้ → ยังไม่ใช่ conflict · ช่องตามค่าที่ server เก็บ", async () => {
    await saveThenRefresh("ข้อความใหม่  ", "ข้อความใหม่");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("ข้อความใหม่");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });

  it("บันทึกแล้วพิมพ์ต่อ ก่อน refresh มา → คงที่พิมพ์ต่อไว้ ไม่เตือน ปุ่มบันทึกเปิด (แก้เพิ่มจริง)", async () => {
    savePieceBody.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(tree("ข้อความเดิม"));
    await userEvent.click(screen.getByRole("button", { name: "เปิดโหมดแก้" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "รอบแรก");
    await userEvent.click(screen.getByRole("button", { name: "บันทึกเนื้อหา" }));
    await waitFor(() => expect(savePieceBody).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("textbox"), " พิมพ์เพิ่ม");
    rerender(tree("รอบแรก"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("รอบแรก พิมพ์เพิ่ม");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeEnabled();
  });

  it("ยังเตือนเมื่อ server เปลี่ยนเป็นค่าอื่นที่ไม่ใช่ที่เราบันทึก (อีกแท็บแก้)", async () => {
    await saveThenRefresh("ข้อความใหม่", "คนอื่นแก้เป็นอย่างอื่น");
    expect(screen.getByRole("alert")).toHaveTextContent("ถูกแก้จากที่อื่น");
    expect(screen.getByRole("textbox")).toHaveValue("ข้อความใหม่");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });
});
