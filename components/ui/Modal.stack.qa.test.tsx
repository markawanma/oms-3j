// @vitest-environment jsdom
// QA R2-D2 (22 ต.ค. 69) — re-QA Modal stack: รูปแบบการใช้ Modal ในแอป (62 ไฟล์) ที่ Modal.test.tsx ของ dev ยังไม่ครอบ
//  sibling (กล่องยืนยันเป็นพี่น้อง ไม่ได้ซ้อนใน DOM) · เปิด-ปิดซ้ำไม่มีตัวผี · ปุ่ม X/พื้นหลัง/Esc ผ่าน confirmBeforeClose ทุกทาง · X ไม่ submit ฟอร์มที่ห่ออยู่ · confirmBeforeClose ของชั้นล่างไม่ถูกเรียกตอนปิดชั้นบน
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

afterEach(cleanup);
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

describe("Modal stack — รูปแบบการใช้ในแอป", () => {
  it("sibling (พี่น้องใน DOM · เปิดทีหลัง เช่น GemItemDetailDialog + GemConfirm): Esc ปิดเฉพาะตัวที่เปิดทีหลัง แล้วอีกครั้งปิดตัวแรก", () => {
    const a = vi.fn();
    const b = vi.fn();
    function H() {
      const [openB, setB] = useState(false);
      return (
        <>
          <Modal open onClose={a} title="A">
            <button onClick={() => setB(true)}>เปิด B</button>
          </Modal>
          {openB && <Modal open onClose={() => { b(); setB(false); }} title="B">b</Modal>}
        </>
      );
    }
    render(<H />);
    fireEvent.click(screen.getByText("เปิด B"));
    esc();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    esc();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("เปิด-ปิด 5 รอบ (toggle open) แล้ว Esc ครั้งเดียว = onClose ครั้งเดียว (ไม่มีตัวผีค้างใน stack)", () => {
    const onClose = vi.fn();
    function H() {
      const [o, setO] = useState(true);
      return (
        <>
          <button onClick={() => setO((v) => !v)}>toggle</button>
          <Modal open={o} onClose={onClose} title="T">x</Modal>
        </>
      );
    }
    render(<H />);
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByText("toggle")); // ปิด/เปิดสลับ 10 ครั้ง → จบที่ open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirmBeforeClose: Esc / ปุ่ม X / พื้นหลัง ผ่านด่านทุกทาง · false = ไม่ปิด · true = ปิด · ปิดผ่าน onClose ที่ลูกเรียกเอง ไม่ผ่านด่าน", async () => {
    const onClose = vi.fn();
    const guard = vi.fn(() => false);
    const { container } = render(<Modal open onClose={onClose} title="G" confirmBeforeClose={guard}>x</Modal>);
    esc();
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    fireEvent.click(container.querySelector('[aria-hidden="true"].absolute') as HTMLElement);
    expect(guard).toHaveBeenCalledTimes(3);
    expect(onClose).not.toHaveBeenCalled();
    guard.mockReturnValue(true);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledTimes(5);
  });

  it("ชั้นล่างมี confirmBeforeClose: Esc ที่ชั้นบนปิดแค่ชั้นบน และไม่เรียกด่านของชั้นล่าง", () => {
    const lowerGuard = vi.fn(() => true);
    const lowerClose = vi.fn();
    const upperClose = vi.fn();
    render(
      <Modal open onClose={lowerClose} title="ล่าง" confirmBeforeClose={lowerGuard}>
        <Modal open onClose={upperClose} title="บน">u</Modal>
      </Modal>,
    );
    esc();
    expect(upperClose).toHaveBeenCalledTimes(1);
    expect(lowerGuard).not.toHaveBeenCalled();
    expect(lowerClose).not.toHaveBeenCalled();
  });

  it("Modal ที่อยู่ใน <form>: ปุ่ม X ไม่ submit ฟอร์ม (type=button)", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Modal open onClose={() => {}} title="F">x</Modal>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "ปิด" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("พิมพ์ข้อความในช่องแล้วกด Esc (โฟกัสอยู่ใน input ของ Modal) ปิดตามปกติ · re-render ของพ่อไม่ทำให้ stack ซ้ำ", async () => {
    const onClose = vi.fn();
    function H() {
      const [v, setV] = useState("");
      return (
        <Modal open onClose={onClose} title="I">
          <input aria-label="ช่อง" value={v} onChange={(e) => setV(e.target.value)} />
        </Modal>
      );
    }
    const user = userEvent.setup();
    render(<H />);
    await user.type(screen.getByLabelText("ช่อง"), "สวัสดี 123");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
