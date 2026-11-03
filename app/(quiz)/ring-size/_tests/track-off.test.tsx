// @vitest-environment jsdom
// TRACK_ENABLED ปิด = สวิตช์ฆ่าสถิติ: (1) ไม่ส่งอะไรเลย (2) ข้อความความเป็นส่วนตัวกลับเป็นแบบ "ไม่มีการส่งสถิติ" (ไม่สัญญาเกินจริง)
// คู่กับ flags-on.test.tsx (เปิด) และ lib/ring-size/copy-guard.test.ts (default จริง = เปิด + ถ้อยคำใหม่)
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";

vi.mock("@/lib/ring-size/config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-size/config")>();
  return { ...orig, TRACK_ENABLED: false };
});

import { track, trackMeasured } from "@/lib/ring-size/track";
import { R1Pick } from "../_screens/R1Pick";
import { R6 } from "../_screens/R6";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TRACK_ENABLED = false", () => {
  it("R6: ข้อความเดิม (ไม่มีการส่งสถิติ) — ไม่พูดถึงสถิติ", () => {
    render(<R6 step={null} size={circToRec(54, "A")!} method="A" refKind="card" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
    expect(screen.getByText("เบอร์ของคุณเก็บไว้ในเครื่องนี้ ร้านไม่ได้รับชื่อหรือข้อมูลส่วนตัวของคุณ จนกว่าคุณจะกดส่งทาง LINE เอง")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/สถิติ/);
  });

  it("R1Pick: ข้อความเดิม (จำแค่ค่าขนาดจอและผลล่าสุดไว้ในเครื่อง) — ไม่พูดถึงสถิติ", () => {
    render(<R1Pick step={null} onBack={() => {}} onPick={() => {}} missingCalibration={false} />);
    expect(screen.getByText(/จำแค่ค่าขนาดจอและผลล่าสุดไว้ในเครื่องของคุณ/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/สถิติ/);
  });

  it("E: track() ไม่เรียก sendBeacon/fetch เลย (ทุกชนิด event)", () => {
    const beacon = vi.fn(() => true);
    const f = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
    vi.stubGlobal("fetch", f);
    try {
      track({ stage: 0, in_app: "line", is_return: false });
      trackMeasured({ method: "A", circ_mm: 54, size: 54, between: false });
      track({ stage: 7, cta: "line" });
      expect(beacon).not.toHaveBeenCalled();
      expect(f).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem("ringSize:sid:v1")).toBeNull(); // ไม่สร้าง sid ด้วย
    } finally {
      delete (navigator as unknown as Record<string, unknown>).sendBeacon;
    }
  });
});
