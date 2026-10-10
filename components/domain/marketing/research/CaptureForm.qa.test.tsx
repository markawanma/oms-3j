// @vitest-environment jsdom
// QA (R2-D2) P1b — BUG-QA-4 (พบบน DB จริง): ช่องลิงก์ maxLength=500 ตัดลิงก์ที่ยาวกว่าเงียบๆ → ถูกบันทึกเป็น "ลิงก์ที่ถูกตัดท้าย" (คนละลิงก์)
// ทั้งที่ server มีข้อความ "ลิงก์ยาวเกิน 500 ตัวอักษร" รออยู่ แต่ไม่มีทางไปถึงจาก UI
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
const captureSignal = vi.fn();
vi.mock("@/lib/actions/content-signal-capture", () => ({ captureSignal: (...a: unknown[]) => captureSignal(...a) }));

import { CaptureForm } from "./CaptureForm";

describe("CaptureForm — ลิงก์ยาวเกิน 500", () => {
  it("BUG-QA-4: วางลิงก์ 520 ตัวอักษร ช่องต้องไม่ตัดท้ายเงียบ (ต้องเก็บครบเพื่อให้ตรวจแล้วเตือน)", async () => {
    render(<CaptureForm />);
    const input = screen.getByLabelText("ลิงก์คลิปที่เจอ") as HTMLInputElement;
    const long = "https://example.com/" + "a".repeat(500);
    await userEvent.click(input);
    await userEvent.paste(long);
    expect(input.value.length).toBe(long.length);
    // เตือนใต้ช่องทันที + กดบันทึกแล้วไม่ถึง server
    expect(screen.getByText("ลิงก์ยาวเกิน 500 ตัวอักษร")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "บันทึกลิงก์" }));
    expect(captureSignal).not.toHaveBeenCalled();
    expect((await screen.findAllByText("ลิงก์ยาวเกิน 500 ตัวอักษร")).length).toBeGreaterThan(0);
  });
});
