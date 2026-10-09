// @vitest-environment jsdom
// QA (R2-D2) — BUG-QA-1 (พบในเบราว์เซอร์จริง · High): PieceEditCard เก็บ useState(piece.contentBody) ครั้งเดียวตอน mount
// → หลังเจ้าของตอบ [ต้องยืนยัน] (router.refresh ส่ง contentBody ใหม่ที่แทนคำตอบแล้ว) ช่องแก้ยังแสดงข้อความเก่าที่มี marker
//   และปุ่ม "บันทึกเนื้อหา" เปิดทั้งที่ไม่ได้แก้อะไร → กดแล้วเขียนทับเนื้อหาจริงด้วยข้อความเก่า (คำตอบหาย · marker กลับมา · ผลตรวจถูกล้าง)
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

describe("PieceEditCard — ข้อมูลจาก server เปลี่ยนหลัง refresh", () => {
  it("เริ่มต้น: ช่องแก้ = เนื้อหาปัจจุบัน และปุ่มบันทึกปิดอยู่จนกว่าจะแก้", async () => {
    render(tree("สวัสดี [ต้องยืนยัน: ราคา]"));
    await userEvent.click(screen.getByRole("button", { name: "เปิดโหมดแก้" }));
    expect(screen.getByRole("textbox")).toHaveValue("สวัสดี [ต้องยืนยัน: ราคา]");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });

  it("BUG-QA-1: หลัง prop เปลี่ยน (ตอบ [ต้องยืนยัน] แล้ว) ช่องแก้ต้องตามเนื้อหาใหม่ และปุ่มบันทึกต้องยังปิด (ไม่ได้แก้เอง)", async () => {
    const { rerender } = render(tree("สวัสดี [ต้องยืนยัน: ราคา]"));
    await userEvent.click(screen.getByRole("button", { name: "เปิดโหมดแก้" }));
    rerender(tree("สวัสดี 925 บาท")); // = router.refresh() ส่ง piece ใหม่เข้ามา
    expect(screen.getByRole("textbox")).toHaveValue("สวัสดี 925 บาท");
    expect(screen.getByRole("button", { name: "บันทึกเนื้อหา" })).toBeDisabled();
  });
});
