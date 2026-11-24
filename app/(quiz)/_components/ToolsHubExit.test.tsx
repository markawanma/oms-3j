// @vitest-environment jsdom
// ToolsHubExit + LeaveSheet (ux-tools-navigation §5 · มติเจ้าของ 24 พ.ย. 69)
//   ไม่ dirty = ลิงก์ปกติ ไม่ถาม (N6) · dirty = ถามก่อนออก (N5) · อยู่ต่อ/Esc/พื้นหลัง = ไม่ออก + คืนโฟกัส · ออก = ลิงก์ hub ธรรมดา (N2)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HUB_URL } from "@/lib/site/hosts";
import { ToolsHubExit } from "./ToolsHubExit";

const BODY = "ข้อความทดสอบ body";

/** document-level: บันทึกว่า "คอมโพเนนต์ preventDefault แล้วหรือยัง" ก่อนจะ preventDefault เองกัน jsdom navigation */
let clicks: Array<{ prevented: boolean }> = [];
const onDocClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement | null)?.closest("a")) {
    clicks.push({ prevented: e.defaultPrevented });
    e.preventDefault();
  }
};
beforeEach(() => {
  clicks = [];
  document.addEventListener("click", onDocClick);
});
afterEach(() => {
  document.removeEventListener("click", onDocClick);
  cleanup();
});

const hub = () => screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" });
const dialog = () => screen.queryByRole("alertdialog");

describe("ToolsHubExit — ไม่มีงานค้าง", () => {
  it("N6: คลิกแล้วไม่ถาม ไม่ preventDefault (เบราว์เซอร์พาไป hub เอง) · href = HUB_URL ไม่ target", async () => {
    render(<ToolsHubExit dirty={false} leaveBody={BODY} />);
    expect(hub()).toHaveAttribute("href", HUB_URL);
    expect(hub()).not.toHaveAttribute("target");
    await userEvent.setup().click(hub());
    expect(dialog()).toBeNull();
    expect(clicks).toEqual([{ prevented: false }]);
  });
});

describe("ToolsHubExit — มีงานค้าง", () => {
  it("N5: คลิกซ้ายธรรมดา → preventDefault + LeaveSheet (ชื่อ · body · 2 ปุ่ม) · โฟกัสเริ่มที่ 'อยู่ต่อ' · ยังไม่ไป hub", async () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    await userEvent.setup().click(hub());
    expect(clicks).toEqual([{ prevented: true }]);
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "ออกจากขั้นตอนนี้?" })).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect(d).toHaveAccessibleName("ออกจากขั้นตอนนี้?");
    expect(d).toHaveAccessibleDescription(BODY);
    expect(screen.getByRole("button", { name: "อยู่ต่อ" })).toHaveFocus();
    const leave = screen.getByRole("link", { name: "ออกไปหน้าเครื่องมือ" });
    expect(leave).toHaveAttribute("href", HUB_URL);
    expect(leave).not.toHaveAttribute("target");
  });

  it("sheet อยู่ใน document.body นอกกล่องของจอ (portal — ไม่โดน transform/overflow ของ wrapper ตัดตำแหน่ง fixed)", async () => {
    const { container } = render(<ToolsHubExit dirty leaveBody={BODY} />);
    await userEvent.setup().click(hub());
    expect(container.contains(dialog())).toBe(false);
    expect(document.body.contains(dialog())).toBe(true);
  });

  it("'อยู่ต่อ' → ปิด sheet + คืนโฟกัสมาที่ลิงก์ · ไม่ไป hub", async () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    const u = userEvent.setup();
    await u.click(hub());
    await u.click(screen.getByRole("button", { name: "อยู่ต่อ" }));
    expect(dialog()).toBeNull();
    await waitFor(() => expect(hub()).toHaveFocus());
    expect(clicks).toHaveLength(1); // คลิกเดียวที่เปิด sheet — ไม่มีคลิกที่พาออก
  });

  it("Esc = อยู่ต่อ · แตะพื้นหลัง = อยู่ต่อ", async () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    const u = userEvent.setup();
    await u.click(hub());
    await u.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    await waitFor(() => expect(hub()).toHaveFocus());

    await u.click(hub());
    expect(dialog()).not.toBeNull();
    const backdrop = document.querySelector("button[aria-hidden='true'][tabindex='-1']") as HTMLElement;
    fireEvent.click(backdrop);
    expect(dialog()).toBeNull();
  });

  it("focus trap: Tab/Shift+Tab วนอยู่ใน 'อยู่ต่อ' ↔ 'ออกไปหน้าเครื่องมือ' ไม่หลุดไปหลัง sheet", async () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    const u = userEvent.setup();
    await u.click(hub());
    const stay = screen.getByRole("button", { name: "อยู่ต่อ" });
    const leave = screen.getByRole("link", { name: "ออกไปหน้าเครื่องมือ" });
    expect(stay).toHaveFocus();
    await u.tab();
    expect(leave).toHaveFocus();
    await u.tab(); // สุดทาง → วนกลับต้น
    expect(stay).toHaveFocus();
    await u.tab({ shift: true }); // ต้น ← ย้อน → วนไปท้าย
    expect(leave).toHaveFocus();
  });

  it("'ออกไปหน้าเครื่องมือ' = ลิงก์ hub ธรรมดา: คลิกแล้วเบราว์เซอร์พาไป (ไม่ preventDefault) · ไม่ใช่ปุ่ม JS", async () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    const u = userEvent.setup();
    await u.click(hub());
    await u.click(screen.getByRole("link", { name: "ออกไปหน้าเครื่องมือ" }));
    expect(clicks[1]).toEqual({ prevented: false });
  });

  it("คลิกแบบตั้งใจเปิดแท็บใหม่ (Ctrl/Cmd/Shift/ปุ่มกลาง) ไม่ดัก — ไม่ขึ้น sheet", () => {
    render(<ToolsHubExit dirty leaveBody={BODY} />);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(hub(), init);
    }
    expect(dialog()).toBeNull();
    expect(clicks.every((c) => c.prevented === false)).toBe(true);
  });

  it("dirty กลับเป็น false ระหว่างที่ sheet เปิดอยู่ (เช่น popstate เปลี่ยนจอ) → sheet หายเอง ไม่ค้าง", async () => {
    const { rerender } = render(<ToolsHubExit dirty leaveBody={BODY} />);
    await userEvent.setup().click(hub());
    expect(dialog()).not.toBeNull();
    rerender(<ToolsHubExit dirty={false} leaveBody={BODY} />);
    expect(dialog()).toBeNull();
  });
});
