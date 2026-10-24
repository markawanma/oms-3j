// @vitest-environment jsdom
// พิสูจน์ว่า flag ซ่อนค่า "ทำงานจริงทั้งสองฝั่ง": default ปิด (ครอบใน RingSizeClient.test / copy-guard) · ที่นี่ = เปิดแล้วต้องโผล่
// (ค่าทดสอบเป็นสตริงที่เห็นชัดว่าไม่ใช่ของจริง — ห้ามเอาไปใช้ใน config จริง)
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";

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
  };
});

import { R4B } from "../_screens/R4B";
import { R6 } from "../_screens/R6";

afterEach(cleanup);

function r6(c: number) {
  return render(<R6 step={null} size={circToRec(c)!} method="A" refKind="card" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
}

describe("flag เปิด → ค่าที่ซ่อนอยู่โผล่ (พิสูจน์ว่าเป็น flag จริง ไม่ใช่ข้อความที่ลืมใส่)", () => {
  it("SHOW_FINGER_TIPS: ส่วน 'เคล็ดลับก่อนสั่ง' โผล่ (2 ข้อ ไม่มีข้อหน้ากว้าง)", () => {
    r6(54);
    expect(screen.getByText("เคล็ดลับก่อนสั่ง")).toBeInTheDocument();
    expect(screen.getByText("นิ้วขนาดไม่เท่ากันตลอดวัน")).toBeInTheDocument();
    expect(screen.getByText("ข้อนิ้วใหญ่กว่าโคนนิ้ว")).toBeInTheDocument();
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

  it("TRACK_ENABLED: ต่อท้ายประโยคความเป็นส่วนตัวว่านับสถิติรวมแบบไม่ระบุตัวตน", () => {
    r6(54);
    expect(screen.getByText(/ร้านนับสถิติรวมแบบไม่ระบุตัวตน/)).toBeInTheDocument();
  });

  it("R4B: SHOW_KNUCKLE_RULE โผล่กล่องข้อนิ้ว · PAPER_SIZE_HINT แทนข้อความไม่มีตัวเลข", () => {
    render(<R4B step={null} onBack={() => {}} onNext={() => {}} onSwitchA={() => {}} />);
    expect(screen.getByText(/ลองสวมแถบกระดาษผ่านข้อนิ้ว/)).toBeInTheDocument();
    expect(screen.getByText("TEST_ONLY_PAPER_HINT")).toBeInTheDocument();
    expect(screen.queryByText(/ตัดกระดาษเป็นแถบยาวพอพันรอบนิ้ว/)).toBeNull();
  });
});
