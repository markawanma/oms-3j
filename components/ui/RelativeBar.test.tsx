// @vitest-environment jsdom
// components/ui/RelativeBar.test.tsx — ความยาวแท่งเทียบค่ามากสุด (ย้ายมาจาก ring-size-format: เดิมชื่อ barWidthPct)
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RelativeBar, relativeBarWidth } from "./RelativeBar";

afterEach(cleanup);

describe("relativeBarWidth", () => {
  it("เทียบค่ามากสุด · มีของเล็กน้อยยังเห็นแท่ง · 0 ⇒ 0 · max 0 ⇒ 0 (ไม่หาร 0)", () => {
    expect(relativeBarWidth(50, 100)).toBe(50);
    expect(relativeBarWidth(1, 1000)).toBe(2);
    expect(relativeBarWidth(0, 100)).toBe(0);
    expect(relativeBarWidth(5, 0)).toBe(0);
    expect(relativeBarWidth(0, 0)).toBe(0);
    expect(relativeBarWidth(500, 100)).toBe(100);
    expect(Number.isFinite(relativeBarWidth(NaN, NaN))).toBe(true);
  });

  it("ตาราง (value × max): จำนวนเต็ม 0..100 เสมอ", () => {
    const xs = [0, 1, 2, 7, 29, 30, 31, 100, 1000, 100000, 1e9];
    for (const max of [0, 1, 7, 29, 30, 31, 100, 999, 100000]) {
      for (const value of xs) {
        const w = relativeBarWidth(value, max);
        expect(Number.isInteger(w) && w >= 0 && w <= 100, `${value}/${max}`).toBe(true);
      }
    }
  });

  it("อินพุตเพี้ยน (NaN/Infinity/ลบ/สตริง/null/undefined) ⇒ ไม่ throw ไม่ NaN", () => {
    const junk = [NaN, Infinity, -Infinity, -5, 0.4, "12", null, undefined, {}, [], true] as unknown[];
    for (const a of junk) {
      for (const b of [...junk, 100]) {
        const w = relativeBarWidth(a as number, b as number);
        expect(Number.isFinite(w)).toBe(true);
      }
    }
  });
});

describe("RelativeBar", () => {
  it("aria-hidden · ไม่มี role=progressbar · ความกว้างตามสัดส่วน · tone amber", () => {
    const { container } = render(<RelativeBar value={25} max={100} tone="amber" />);
    const track = container.firstElementChild as HTMLElement;
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[role=progressbar]")).toBeNull();
    const fill = track.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("25%");
    expect(fill.className).toContain("bg-amber-500");
  });
});
