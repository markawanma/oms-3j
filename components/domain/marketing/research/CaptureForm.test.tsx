// @vitest-environment jsdom
// CaptureForm: ไม่ออกเครือข่ายตอนพิมพ์ลิงก์ · ประโยคตรวจจากสตริง · error ใต้ช่อง · ซ้ำ → ลิงก์ไปรายการเดิม · สำเร็จ → แปะอีกอัน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const captureSignal = vi.fn();
vi.mock("@/lib/actions/content-signal-capture", () => ({ captureSignal: (...a: unknown[]) => captureSignal(...a) }));

import { CaptureForm } from "./CaptureForm";

const DUP = "44444444-4444-4444-8444-444444444444";
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  captureSignal.mockResolvedValue({ ok: true, data: { id: "55555555-5555-4555-8555-555555555555" } });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ห้ามออกเครือข่าย"));
});
afterEach(() => fetchSpy.mockRestore());

describe("CaptureForm", () => {
  it("พิมพ์ลิงก์ TikTok → ประโยคตรวจ 'TikTok · @user' · ไม่มี request ออกเครือข่ายเลย", async () => {
    render(<CaptureForm />);
    await userEvent.type(screen.getByLabelText("ลิงก์คลิปที่เจอ"), "https://www.tiktok.com/@some.user/video/123?is_from_webapp=1");
    expect(screen.getByText(/TikTok · @some.user · ตรวจว่าเคยแปะไหมตอนกดบันทึก/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ลิงก์ผิด (javascript:) → เตือนใต้ช่องทันที", async () => {
    render(<CaptureForm />);
    await userEvent.type(screen.getByLabelText("ลิงก์คลิปที่เจอ"), "javascript:alert(1)");
    expect(screen.getByText(/ลิงก์ต้องขึ้นต้นด้วย http/)).toBeInTheDocument();
  });

  it("กรอกลิงก์+hook+ตัวเลขย่อ → ส่งค่าตามที่พิมพ์ให้ server (server parse) แล้วขึ้นหน้าสำเร็จ → แปะอีกอัน", async () => {
    render(<CaptureForm />);
    await userEvent.type(screen.getByLabelText("ลิงก์คลิปที่เจอ"), "https://www.tiktok.com/@a/video/1");
    await userEvent.type(screen.getByLabelText(/ประโยคเปิดของคลิป/), "ใส่อาบน้ำได้ไหม?");
    await userEvent.click(screen.getByText("ตัวเลขที่เห็นบนจอ (ไม่บังคับ)"));
    await userEvent.type(screen.getByLabelText("ยอดวิว"), "1.2M");
    await userEvent.click(screen.getByRole("button", { name: "บันทึกลิงก์" }));
    await waitFor(() => expect(captureSignal).toHaveBeenCalledTimes(1));
    expect(captureSignal.mock.calls[0][0]).toMatchObject({ url: "https://www.tiktok.com/@a/video/1", hookText: "ใส่อาบน้ำได้ไหม?", views: "1.2M", source: "owner" });
    expect(await screen.findByText("บันทึกลิงก์แล้ว")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "แปะอีกอัน" }));
    expect(screen.getByLabelText("ลิงก์คลิปที่เจอ")).toHaveValue("");
  });

  it("error ของช่อง → แสดงใต้ช่องนั้น (aria) · ข้อมูลที่พิมพ์ยังอยู่", async () => {
    captureSignal.mockResolvedValue({ ok: false, error: "พิมพ์ประโยคเปิดของคลิป", field: "hook" });
    render(<CaptureForm />);
    await userEvent.type(screen.getByLabelText("ลิงก์คลิปที่เจอ"), "https://www.tiktok.com/@a/video/1");
    await userEvent.click(screen.getByRole("button", { name: "บันทึกลิงก์" }));
    expect(await screen.findByText("พิมพ์ประโยคเปิดของคลิป")).toBeInTheDocument();
    expect(screen.getByLabelText("ลิงก์คลิปที่เจอ")).toHaveValue("https://www.tiktok.com/@a/video/1");
  });

  it("ซ้ำ → ข้อความ + ลิงก์ไปรายการเดิม (?id=)", async () => {
    captureSignal.mockResolvedValue({ ok: false, error: "ลิงก์นี้เคยแปะแล้ว", field: "url", duplicateId: DUP });
    render(<CaptureForm />);
    await userEvent.type(screen.getByLabelText("ลิงก์คลิปที่เจอ"), "https://www.tiktok.com/@a/video/1");
    await userEvent.click(screen.getByRole("button", { name: "บันทึกลิงก์" }));
    expect(await screen.findByText("ลิงก์นี้เคยแปะแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ไปดูรายการเดิม" })).toHaveAttribute("href", `/marketing/research?id=${DUP}`);
  });

  it("server ล้มแบบไม่คาดคิด → ข้อความกลาง ไม่ค้างปุ่ม", async () => {
    captureSignal.mockRejectedValue(new Error("boom"));
    render(<CaptureForm />);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกลิงก์" }));
    expect(await screen.findByText(/ทำรายการไม่สำเร็จ/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกลิงก์" })).toBeEnabled();
  });
});
