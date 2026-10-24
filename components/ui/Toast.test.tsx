// @vitest-environment jsdom
// ToastProvider — push แบบเดิมต้องทำงานเหมือนเดิม (4 วิ · batch >3 ใน 5 วิ) + G1b: toast ที่มีปุ่ม action (ย้อนกลับ) อยู่ 10 วิ และ "ไม่ถูก batch"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import type { ToastOptions } from "@/components/ui/Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let push: ReturnType<typeof useToast>["push"];
function Grab() {
  push = useToast().push;
  return null;
}
const mount = () => render(<ToastProvider><Grab /></ToastProvider>);
const fire = (message: string, tone?: "success" | "error", opts?: ToastOptions) => act(() => push(message, tone, opts));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("push แบบเดิม (ไม่มี opts)", () => {
  it("แสดง แล้วหายเองหลัง 4 วินาที", () => {
    mount();
    fire("บันทึกแล้ว");
    expect(screen.getByText("บันทึกแล้ว")).toBeInTheDocument();
    wait(3900);
    expect(screen.getByText("บันทึกแล้ว")).toBeInTheDocument();
    wait(200);
    expect(screen.queryByText("บันทึกแล้ว")).not.toBeInTheDocument();
  });
  it("tone error ใช้ได้ · ปุ่มปิดทำงาน · ไม่มีปุ่ม action", () => {
    mount();
    fire("ผิดพลาด", "error");
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ปิดการแจ้งเตือน" }));
    expect(screen.queryByText("ผิดพลาด")).not.toBeInTheDocument();
  });
  it("เกิน 3 ใน 5 วินาที = รวมเป็นสรุป (พฤติกรรมเดิม)", () => {
    mount();
    for (let i = 1; i <= 4; i++) fire(`ข้อความ ${i}`);
    expect(screen.getByText(/มีการแจ้งเตือนใหม่ 4 รายการ/)).toBeInTheDocument();
    expect(screen.queryByText("ข้อความ 4")).not.toBeInTheDocument();
  });
});

describe("toast ที่มี action", () => {
  it("อยู่ 10 วินาที (ไม่ใช่ 4) แล้วหาย", () => {
    mount();
    fire("ทำเครื่องหมายสั่งแล้ว", "success", { action: { label: "ย้อนกลับ", onClick: vi.fn() } });
    wait(9900);
    expect(screen.getByText("ทำเครื่องหมายสั่งแล้ว")).toBeInTheDocument();
    wait(200);
    expect(screen.queryByText("ทำเครื่องหมายสั่งแล้ว")).not.toBeInTheDocument();
  });
  it("กดปุ่ม = เรียก onClick ครั้งเดียว และ toast ปิด", () => {
    mount();
    const onClick = vi.fn();
    fire("ทำเครื่องหมายสั่งแล้ว", "success", { action: { label: "ย้อนกลับ", onClick } });
    fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("ทำเครื่องหมายสั่งแล้ว")).not.toBeInTheDocument();
  });
  it("ปุ่มอยู่ใน aria-live region และสูง ≥ 44px (min-h-11)", () => {
    mount();
    fire("x", "success", { action: { label: "ย้อนกลับ", onClick: vi.fn() } });
    const btn = screen.getByRole("button", { name: "ย้อนกลับ" });
    expect(btn.closest("[aria-live]")).not.toBeNull();
    expect(btn.className).toMatch(/min-h-11/);
  });
  it("durationMs กำหนดเองได้", () => {
    mount();
    fire("สั้น", "success", { action: { label: "ย้อนกลับ", onClick: vi.fn() }, durationMs: 2000 });
    wait(2100);
    expect(screen.queryByText("สั้น")).not.toBeInTheDocument();
  });
  it("ไม่ถูก batch: push ธรรมดา 4 ครั้งติดกัน (ขึ้นสรุป) แต่ toast ย้อนกลับที่มีอยู่ก่อนยังอยู่ครบพร้อมปุ่ม", () => {
    mount();
    fire("ทำเครื่องหมายสั่งแล้ว: A", "success", { action: { label: "ย้อนกลับ", onClick: vi.fn() } });
    for (let i = 1; i <= 4; i++) fire(`อื่น ${i}`);
    expect(screen.getByText(/มีการแจ้งเตือนใหม่/)).toBeInTheDocument();
    expect(screen.getByText("ทำเครื่องหมายสั่งแล้ว: A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ย้อนกลับ" })).toBeInTheDocument();
  });
  it("ไม่ถูกแทนด้วยสรุป และไม่นับเข้า batch: toast action 5 ครั้งติดกันแสดงครบทุกอัน · ตามด้วย push ธรรมดาแสดงเอง", () => {
    mount();
    for (let i = 1; i <= 5; i++) fire(`ย้อนได้ ${i}`, "success", { action: { label: `ย้อนกลับ ${i}`, onClick: vi.fn() } });
    for (let i = 1; i <= 5; i++) expect(screen.getByText(`ย้อนได้ ${i}`)).toBeInTheDocument();
    expect(screen.queryByText(/มีการแจ้งเตือนใหม่/)).not.toBeInTheDocument();
    fire("ธรรมดา");
    expect(screen.getByText("ธรรมดา")).toBeInTheDocument();
    expect(screen.queryByText(/มีการแจ้งเตือนใหม่/)).not.toBeInTheDocument();
  });
});
