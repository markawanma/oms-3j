// lib/ring-size/track-ssr.test.ts — เคส E "SSR": ไม่มี window (Node) → track() ต้องไม่ส่ง ไม่ throw
// (environment = node · ไม่ใช่ jsdom — แยกจาก track.test.ts ที่เป็น jsdom)
import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "./track";

afterEach(() => vi.unstubAllGlobals());

describe("SSR (ไม่มี window)", () => {
  it("ไม่มี window → ไม่เรียก fetch/sendBeacon ไม่ throw (เทสต์รันใน node จริง — ยืนยันก่อนว่าไม่มี window)", () => {
    expect(typeof window).toBe("undefined");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const beacon = vi.fn(() => true);
    // Node 21+ มี navigator ให้แล้ว — ใส่ sendBeacon เพื่อพิสูจน์ว่าด่าน SSR กันก่อนถึงตรงนี้
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(() => track({ stage: 1 })).not.toThrow();
    expect(() => track({ stage: 7, cta: "line" })).not.toThrow();
    expect(f).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });
});
