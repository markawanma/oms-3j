// @vitest-environment jsdom
// useRefreshGate (S2): อัตโนมัติ ≤ maxAuto ห่าง ≥ minGap · แตะผ่านเสมอและรีเซ็ต · รอบหมดอายุใหม่นับใหม่
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRefreshGate } from "./useRefreshGate";

afterEach(() => vi.restoreAllMocks());

function gate(opts?: Parameters<typeof useRefreshGate>[0]) {
  let t = 10_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => t);
  const { result } = renderHook(() => useRefreshGate(opts));
  return { allow: result.current, advance: (ms: number) => (t += ms) };
}

describe("useRefreshGate", () => {
  it("อัตโนมัติผ่าน 2 ครั้งแล้วหยุด (ค่าเริ่ม) แม้เวลาผ่านไปเกิน 10 วินาที", () => {
    const g = gate();
    expect(g.allow("error")).toBe(true);
    g.advance(11_000);
    expect(g.allow("error")).toBe(true);
    g.advance(11_000);
    expect(g.allow("error")).toBe(false);
    g.advance(60_000);
    expect(g.allow("error")).toBe(false);
  });

  it("ห่างน้อยกว่า 10 วินาที = ไม่ผ่าน (ไม่นับเป็นครั้ง)", () => {
    const g = gate();
    expect(g.allow("error")).toBe(true);
    g.advance(5_000);
    expect(g.allow("error")).toBe(false);
    g.advance(6_000);
    expect(g.allow("error")).toBe(true); // ครั้งที่ 2 ยังได้ (ครั้งที่ถูกปฏิเสธไม่กินโควตา)
  });

  it("แตะ (tap) ผ่านเสมอ แม้เกินเพดาน · แล้วรีเซ็ตให้อัตโนมัติได้อีก 2 ครั้ง", () => {
    const g = gate();
    g.allow("error");
    g.advance(11_000);
    g.allow("error");
    g.advance(11_000);
    expect(g.allow("error")).toBe(false);
    expect(g.allow("tap")).toBe(true);
    g.advance(11_000);
    expect(g.allow("error")).toBe(true);
    g.advance(11_000);
    expect(g.allow("error")).toBe(true);
    g.advance(11_000);
    expect(g.allow("error")).toBe(false);
  });

  it("ผ่านไปเกิน resetAfterMs (ลิงก์หมดอายุรอบใหม่) = นับใหม่เอง", () => {
    const g = gate({ resetAfterMs: 5 * 60_000 });
    g.allow("error");
    g.advance(11_000);
    g.allow("error");
    g.advance(11_000);
    expect(g.allow("error")).toBe(false);
    g.advance(5 * 60_000);
    expect(g.allow("error")).toBe(true);
  });
});
