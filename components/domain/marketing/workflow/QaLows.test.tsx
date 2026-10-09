// @vitest-environment jsdom
// รอบแก้ QA Low: (1) การ์ดข้อเสนอ AI ค้างบรรทัดสรุปหลังตอบ แม้ server เอาแถวออกจาก list (2) ชิ้น LINE โพสต์แล้วไม่ขึ้น "ถัดไป: กำลังวัดผล"
// (3) ตัวนับเกินเพดานต้องปิดปุ่มส่ง (4) stale ในกล่องเหตุผล → ปิดกล่อง + refresh
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing" }));
const respondReco = vi.fn();
vi.mock("@/lib/actions/content-inbox", () => ({ respondReco: (...a: unknown[]) => respondReco(...a) }));
vi.mock("@/lib/actions/content-pieces", () => ({ recordGate: vi.fn() }));

import { AiQuestionList } from "./AiQuestionCard";
import { PieceStatusStepper } from "./PieceStatusStepper";
import { TransitionDialog } from "./TransitionDialog";
import { mapRecoRow } from "@/lib/marketing/piece-types";

const reco = (id: string) =>
  mapRecoRow({ item_kind: "reco", item_id: id, kind: "question", title: "ส่งตัวเลขยอด LINE", effective_action: "pending", content_token: "tok" });

describe("AiQuestionList — บรรทัดสรุปหลังตอบ", () => {
  it("ตอบแล้วแถวหายจาก props (revalidate) แต่บรรทัดสรุปยังค้างจนกด ปิด", async () => {
    respondReco.mockResolvedValue({ ok: true, data: { late: false, wasExpired: false } });
    const r1 = reco("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const { rerender } = render(
      <ToastProvider>
        <ul>
          <AiQuestionList rows={[r1]} />
        </ul>
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "ตอบ" }));
    await userEvent.type(screen.getByRole("textbox"), "123");
    await userEvent.click(screen.getByRole("button", { name: "ส่งคำตอบ" }));
    await waitFor(() => expect(screen.getByText(/ตอบแล้ว · ส่งตัวเลขยอด LINE/)).toBeInTheDocument());
    expect(respondReco).toHaveBeenCalledWith(expect.objectContaining({ token: "tok", action: "done", response: "123" }));
    rerender(
      <ToastProvider>
        <ul>
          <AiQuestionList rows={[]} />
        </ul>
      </ToastProvider>
    );
    expect(screen.getByText(/ตอบแล้ว · ส่งตัวเลขยอด LINE/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(screen.queryByText(/ตอบแล้ว · ส่งตัวเลขยอด LINE/)).not.toBeInTheDocument();
  });

  it("คำตอบเกิน 1000 ตัวอักษร → ปุ่มส่งปิด", async () => {
    render(
      <ToastProvider>
        <ul>
          <AiQuestionList rows={[reco("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")]} />
        </ul>
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "ตอบ" }));
    const box = screen.getByRole("textbox");
    await userEvent.click(box);
    await userEvent.paste("ก".repeat(1001));
    expect(screen.getByText("1001/1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่งคำตอบ" })).toBeDisabled();
  });
});

describe("PieceStatusStepper — LINE/สตอรี่", () => {
  it("โพสต์แล้ว: ไม่ขึ้น 'ถัดไป: กำลังวัดผล' และไม่มีขั้นผลิต/วัดผล · บอก 'ไม่มีการวัดผลรายชิ้น'", () => {
    render(<PieceStatusStepper rawStatus="posted" effectiveStatus="posted" pieceKind="line_message" />);
    expect(screen.queryByText(/ถัดไป/)).not.toBeInTheDocument();
    expect(screen.queryByText("กำลังวัดผล")).not.toBeInTheDocument();
    expect(screen.queryByText("ผลิตแล้ว")).not.toBeInTheDocument();
    expect(screen.getByText("ไม่มีการวัดผลรายชิ้น")).toBeInTheDocument();
  });
  it("คลิปโพสต์แล้ว: ยังบอกถัดไป = กำลังวัดผล", () => {
    render(<PieceStatusStepper rawStatus="posted" effectiveStatus="posted" pieceKind="short_clip" />);
    expect(screen.getByText(/ถัดไป:/)).toBeInTheDocument();
    expect(screen.getAllByText("กำลังวัดผล").length).toBeGreaterThan(0);
  });
});

describe("TransitionDialog — stale", () => {
  it("แท็บเก่า (stale) → ปิดกล่อง + refresh (ไม่ค้างกล่องที่กดซ้ำไม่ได้)", async () => {
    refresh.mockClear();
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: "ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด", stale: true });
    render(
      <ToastProvider>
        <TransitionDialog open variant="sendBack" onClose={onClose} onSubmit={onSubmit} />
      </ToastProvider>
    );
    await userEvent.type(screen.getByRole("textbox"), "แก้หน่อย");
    await userEvent.click(screen.getByRole("button", { name: "ส่งกลับ" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });
  it("error ปกติ (ไม่ stale) → ค้างกล่อง คงข้อความที่พิมพ์", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร" });
    render(
      <ToastProvider>
        <TransitionDialog open variant="cancel" onClose={onClose} onSubmit={onSubmit} />
      </ToastProvider>
    );
    await userEvent.type(screen.getByRole("textbox"), "ยกเลิกนะ");
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกชิ้นงาน" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ใส่เหตุผล"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("ยกเลิกนะ");
  });
});
