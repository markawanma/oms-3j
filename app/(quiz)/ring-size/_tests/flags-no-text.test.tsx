// @vitest-environment jsdom
// L3: flag เปิดแต่ "ไม่มีข้อความ" (ข้อความไม่อยู่ใน bundle) → ต้องไม่ render อะไรเลย (ไม่มีกล่อง/หัวข้อเปล่า)
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";

vi.mock("@/lib/ring-size/config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-size/config")>();
  return { ...orig, SHOW_FINGER_TIPS: true, SHOW_KNUCKLE_RULE: true };
});

import { R4B } from "../_screens/R4B";
import { R6 } from "../_screens/R6";

afterEach(cleanup);

describe("flag เปิดแต่ไม่มีข้อความ → ไม่ render", () => {
  it("R6: ไม่มีส่วนเคล็ดลับ ไม่มีหัวข้อเปล่า", () => {
    render(<R6 step={null} size={circToRec(54)!} method="A" refKind="coin" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
    expect(screen.queryByText("เคล็ดลับก่อนสั่ง")).toBeNull();
    expect(screen.queryByRole("region", { name: /เคล็ดลับ/ })).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });
  it("R4B: ไม่มีกล่องข้อนิ้วเปล่า", () => {
    const { container } = render(<R4B step={null} onBack={() => {}} onNext={() => {}} onSwitchA={() => {}} />);
    expect(container.querySelector('[class*="--rs-warn)]"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/ข้อนิ้ว/);
  });
});
