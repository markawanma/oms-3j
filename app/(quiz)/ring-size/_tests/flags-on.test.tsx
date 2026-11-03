// @vitest-environment jsdom
// พิสูจน์ว่า flag ซ่อนค่า "ทำงานจริงทั้งสองฝั่ง": default ปิด (ครอบใน RingSizeClient.test / copy-guard) · ที่นี่ = เปิดแล้วต้องโผล่
// (ค่าทดสอบเป็นสตริงที่เห็นชัดว่าไม่ใช่ของจริง — ห้ามเอาไปใช้ใน config จริง)
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { circToRec } from "@/lib/ring-size/size";
import { resetTrackStateForTests } from "@/lib/ring-size/track";

vi.mock("@/lib/ring-size/config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-size/config")>();
  return {
    ...orig,
    SHOW_FINGER_TIPS: true,
    SHOW_KNUCKLE_RULE: true,
    PAPER_SIZE_HINT: "TEST_ONLY_PAPER_HINT",
    BETWEEN_REASON: "TEST_ONLY_BETWEEN_REASON",
    RING_TOOL_DESTINATIONS: { shop: { label: "TEST_ONLY_SHOP_BUTTON", href: "https://example.invalid/shop" } },
    TRACK_ENABLED: true,
    // ข้อความจริงไม่อยู่ใน bundle (L3) — เทสต์ฉีดสตริงทดสอบเข้าไป เพื่อพิสูจน์ว่า flag + ข้อความต้องมีพร้อมกันจึงจะ render
    COPY: {
      ...orig.COPY,
      r4b: { ...orig.COPY.r4b, knuckle: "TEST_ONLY_KNUCKLE_TEXT" },
      r6: {
        ...orig.COPY.r6,
        tipsTitle: "TEST_ONLY_TIPS_TITLE",
        tips: [
          { q: "TEST_ONLY_Q1", a: "TEST_ONLY_A1" },
          { q: "TEST_ONLY_Q2", a: "TEST_ONLY_A2" },
        ],
      },
    },
  };
});

import { R4B } from "../_screens/R4B";
import { R6 } from "../_screens/R6";

afterEach(cleanup);

// ค่าเริ่มวิธี B (กระดาษ) เพราะ "ระหว่างเบอร์" มีเฉพาะวิธีนี้ (มติเจ้าของ 24 ต.ค. 69: วิธีแหวนไม่ปัดขึ้น)
function r6(c: number, method: "A" | "B" = "B") {
  return render(<R6 step={null} size={circToRec(c, method)!} method={method} refKind="card" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
}

describe("flag เปิด → ค่าที่ซ่อนอยู่โผล่ (พิสูจน์ว่าเป็น flag จริง ไม่ใช่ข้อความที่ลืมใส่)", () => {
  it("SHOW_FINGER_TIPS + มีข้อความ: ส่วนเคล็ดลับโผล่ตามข้อความที่ฉีด", () => {
    r6(54);
    expect(screen.getByText("TEST_ONLY_TIPS_TITLE", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("TEST_ONLY_Q1")).toBeInTheDocument();
    expect(screen.getByText("TEST_ONLY_Q2")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/หน้ากว้าง/);
  });

  it("RING_TOOL_DESTINATIONS.shop: ปุ่มดูแหวนในร้านโผล่ที่ผลปกติ · ไม่โผล่ที่ R6Out", () => {
    r6(54);
    expect(screen.getByRole("link", { name: "TEST_ONLY_SHOP_BUTTON" })).toHaveAttribute("href", "https://example.invalid/shop");
    cleanup();
    r6(42);
    expect(screen.queryByText("TEST_ONLY_SHOP_BUTTON")).toBeNull();
  });

  it("BETWEEN_REASON: เหตุผลต่อท้ายคำอธิบายระหว่างเบอร์", () => {
    r6(54.4);
    expect(screen.getByText(/TEST_ONLY_BETWEEN_REASON/)).toBeInTheDocument();
  });

  it("TRACK_ENABLED: ท้ายหน้าผลเป็นถ้อยคำที่เจ้าของอนุมัติ (บอกสถิติไม่ระบุตัวตน) · ไม่มีคำสัญญาเดิม 'จนกว่าคุณจะกดส่ง'", () => {
    r6(54);
    expect(
      screen.getByText(
        "เบอร์ของคุณเก็บไว้ในเครื่องนี้ · ร้านได้รับสถิติการใช้งานแบบไม่ระบุตัวตน เช่น เบอร์ที่วัดได้ วิธีวัด ปุ่มที่กด และประเภทแอปที่เปิด (เช่น LINE) · ร้านไม่เก็บชื่อ เบอร์โทร หรือรหัสเครื่อง และลบอัตโนมัติภายใน 6 เดือน"
      )
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("จนกว่าคุณจะกดส่ง");
    expect(document.body.textContent).not.toContain("ร้านนับสถิติรวม");
  });

  it("TRACK_ENABLED: ปุ่ม 'ดูแหวนในร้าน' ยิง cta shop ก่อนลิงก์ไป (event พกแค่ stage + cta)", async () => {
    const calls: Array<{ data: Blob }> = [];
    Object.defineProperty(navigator, "sendBeacon", { value: (_u: string, data: Blob) => (calls.push({ data }), true), configurable: true, writable: true });
    const block = (e: Event) => e.preventDefault(); // กัน jsdom นำทางจริง (React handler ทำงานก่อนที่ root)
    document.addEventListener("click", block);
    try {
      resetTrackStateForTests();
      r6(54);
      await userEvent.setup().click(screen.getByRole("link", { name: "TEST_ONLY_SHOP_BUTTON" }));
      expect(calls).toHaveLength(1);
      const text = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.readAsText(calls[0].data);
      });
      expect(JSON.parse(text)).toEqual({ sid: expect.stringMatching(/^[0-9a-f-]{36}$/), stage: 7, cta: "shop" });
    } finally {
      document.removeEventListener("click", block);
      delete (navigator as unknown as Record<string, unknown>).sendBeacon;
    }
  });

  it("R4B: SHOW_KNUCKLE_RULE โผล่กล่องข้อนิ้ว · PAPER_SIZE_HINT แทนข้อความไม่มีตัวเลข", () => {
    render(<R4B step={null} onBack={() => {}} onNext={() => {}} onSwitchA={() => {}} />);
    expect(screen.getByText("TEST_ONLY_KNUCKLE_TEXT")).toBeInTheDocument();
    expect(screen.getByText("TEST_ONLY_PAPER_HINT")).toBeInTheDocument();
    expect(screen.queryByText(/ตัดกระดาษเป็นแถบยาวพอพันรอบนิ้ว/)).toBeNull();
  });
});
