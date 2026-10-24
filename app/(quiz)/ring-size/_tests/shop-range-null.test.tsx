// @vitest-environment jsdom
// A14: SHOP_RING_SIZES = null → ไม่มีทั้ง chip และกล่องนอกช่วง (ห้ามแต่งช่วงเอง)
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";

vi.mock("@/lib/ring-size/config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-size/config")>();
  return { ...orig, SHOP_RING_SIZES: null };
});

import { R6 } from "../_screens/R6";

afterEach(cleanup);

describe("SHOP_RING_SIZES = null", () => {
  it.each([30.5, 44, 54, 60, 90])("c=%s → ไม่มี chip ไม่มีกล่องนอกช่วง · ปุ่ม LINE ปกติ", (c) => {
    render(<R6 step={null} size={circToRec(c, "A")!} method="A" refKind="coin" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
    expect(screen.queryByText(/อยู่ในช่วงเบอร์ที่ร้านทำ/)).toBeNull();
    expect(screen.queryByText(/อยู่นอกช่วงที่ร้านทำ/)).toBeNull();
    expect(screen.queryByText(/ร้านทำเบอร์/)).toBeNull();
    expect(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" })).toBeInTheDocument();
    cleanup();
  });
});
