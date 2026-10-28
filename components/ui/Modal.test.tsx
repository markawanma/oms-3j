// @vitest-environment jsdom
// Modal (ของกลาง): Esc ปิดเฉพาะชั้นบนสุด · เคารพ defaultPrevented · confirmBeforeClose · prop wide เดิมไม่เปลี่ยน
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { Modal } from "./Modal";

afterEach(cleanup);

const esc = (init: { cancel?: boolean } = {}) => {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (init.cancel) ev.preventDefault();
  act(() => {
    document.dispatchEvent(ev);
  });
  return ev;
};

describe("Esc", () => {
  it("Modal เดียว: Esc ปิด (เหมือนเดิม)", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="ก">x</Modal>);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("🔴 keydown ที่ defaultPrevented=true (ตัวในกล่องรับ Esc ไปแล้ว เช่น popover) → Modal ไม่ปิด", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="ก">x</Modal>);
    const ev = esc({ cancel: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("🔴 Modal ซ้อน 2 ชั้น: Esc ปิดแค่ชั้นบน · Esc อีกครั้งจึงปิดชั้นล่าง", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function App() {
      const [innerOpen, setInner] = useState(true);
      return (
        <Modal open onClose={outer} title="นอก">
          <Modal
            open={innerOpen}
            onClose={() => {
              inner();
              setInner(false);
            }}
            title="ใน"
          >
            y
          </Modal>
        </Modal>
      );
    }
    render(<App />);
    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    esc();
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });
  it("ชั้นบนปิดไปแล้ว stack คืนให้ชั้นล่าง (ไม่ค้างตัวผี) · เปิดชั้นบนใหม่ก็ใช้ได้อีก", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function App() {
      const [innerOpen, setInner] = useState(false);
      return (
        <Modal open onClose={outer} title="นอก">
          <button type="button" onClick={() => setInner(true)}>เปิดชั้นใน</button>
          <Modal open={innerOpen} onClose={() => { inner(); setInner(false); }} title="ใน">y</Modal>
        </Modal>
      );
    }
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "เปิดชั้นใน" }));
    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    esc();
    expect(outer).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "เปิดชั้นใน" }));
    esc();
    expect(inner).toHaveBeenCalledTimes(2);
    expect(outer).toHaveBeenCalledTimes(1);
  });
  it("Modal ปิด (open=false) ไม่รับ Esc · unmount ล้าง listener", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Modal open={false} onClose={onClose} title="ก">x</Modal>);
    esc();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    const o2 = vi.fn();
    const r2 = render(<Modal open onClose={o2} title="ข">x</Modal>);
    r2.unmount();
    esc();
    expect(o2).not.toHaveBeenCalled();
  });
  it("confirmBeforeClose ยังใช้กับ Esc: คืน false = ไม่ปิด", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="ก" confirmBeforeClose={() => false}>x</Modal>);
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("รูปแบบเดิม", () => {
  it("ไม่ส่ง wide = max-w-lg · wide = md:max-w-3xl", () => {
    const { rerender } = render(<Modal open onClose={vi.fn()} title="ก">x</Modal>);
    expect(screen.getByRole("dialog").className).toContain("max-w-lg");
    expect(screen.getByRole("dialog").className).not.toContain("max-w-3xl");
    rerender(<Modal open onClose={vi.fn()} title="ก" wide>x</Modal>);
    expect(screen.getByRole("dialog").className).toContain("md:max-w-3xl");
  });
});
