// @vitest-environment jsdom
// QA kill-switch (design-ring-size-analytics §9 เคส 16 · §4.4): TRACK_ENABLED = false ทั้งหน้า (RingSizeClient จริง ทุกจอ)
//   (1) flow วัดครบ + ทุกปุ่มหน้าผลทำงาน โดยไม่มี error  (2) ไม่เรียก sendBeacon/fetch เลยสักครั้ง · ไม่สร้าง sid
//   (3) ข้อความ *Off กลับมาถูกทุกจุดที่เคยพูดถึงสถิติ — ไม่มีคำว่า "สถิติ" ที่ไหนเลย และ R6 ยังเป็นข้อความเดิมก่อน P2
// (track-off.test.tsx ของ dev ครอบแค่ R6/R1Pick แบบ render ตรง + track() ตรงๆ — ไฟล์นี้เดินทั้ง flow ผ่าน client จริง)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY } from "@/lib/ring-size/config";
import { resetTrackStateForTests } from "@/lib/ring-size/track";
import { RingSizeClient } from "../RingSizeClient";
import { mockRects, resetBrowserState, seedCalibration } from "./setup.test-util";

vi.mock("@/lib/ring-size/config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-size/config")>();
  return { ...orig, TRACK_ENABLED: false };
});

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });

const beacon = vi.fn(() => true);
const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }));
const restorers: Array<() => void> = [];

beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  resetTrackStateForTests();
  window.sessionStorage.clear();
  beacon.mockClear();
  fetchSpy.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
  restorers.push(() => delete (navigator as unknown as Record<string, unknown>).sendBeacon);
  vi.stubGlobal("fetch", fetchSpy);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  const block = (e: Event) => e.preventDefault();
  document.addEventListener("click", block);
  restorers.push(() => document.removeEventListener("click", block));
});
afterEach(() => {
  cleanup();
  while (restorers.length) restorers.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBrowserState();
});

describe("TRACK_ENABLED=false: ทั้ง flow ไม่ส่งอะไร + ข้อความ *Off", () => {
  it("เดินครบ R0 → R1Pick → เทียบจอ → วัด → R6 → ทุก CTA: ไม่มี network · ไม่มี sid · ไม่มีคำว่า 'สถิติ' · R6 เป็นข้อความเดิม", async () => {
    const seen: string[] = [];
    const snap = () => seen.push(document.body.textContent ?? "");
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" })); // คนใหม่ → R1Pick
    snap(); // R1Pick
    expect(screen.getByText(/จำแค่ค่าขนาดจอและผลล่าสุดไว้ในเครื่องของคุณ/)).toBeInTheDocument();
    await u.click(btn(/เหรียญ 10 บาท/));
    snap();
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    snap(); // R3 เลือกวิธี
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    snap();
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    snap();
    fireEvent.keyDown(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" }), { key: "ArrowUp" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    snap(); // R6
    expect(screen.getByText(COPY.r6.privacyOff)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(COPY.r6.privacy);

    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    snap(); // ShareCardSheet เปิด
    await u.click(screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" }));
    await u.click(screen.getByRole("link", { name: "เปิดแชท LINE" }));

    for (const t of seen) {
      expect(t).not.toMatch(/สถิติ/);
      expect(t).not.toContain(COPY.pick.privacyBody);
    }
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("ringSize:sid:v1")).toBeNull();
  });

  it("คนกลับมา + G4 + วัดใหม่ + ดูผลเดิม: ยังไม่เรียก network · ไม่มี error บนจอ", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "12" } });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByRole("alert")).toHaveTextContent("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้"); // G4 ทำงานเหมือนเดิม
    await u.click(btn("วัดใหม่"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "15" } });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/สถิติ|TypeError|ผิดพลาด/);
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
