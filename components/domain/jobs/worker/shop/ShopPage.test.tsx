// @vitest-environment jsdom
// หน้า /w/s/<shopToken> (server component): ผลของ loadIntakeHub → สถานะที่ส่งให้ client · QR ถูกเพิกถอน/ไม่พบ = ข้อความเดียวกัน (ไม่บอกว่า token เคยมีจริงไหม)
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const loadIntakeHub = vi.fn();
vi.mock("@/lib/jobs/worker-server", () => ({ loadIntakeHub: (...a: unknown[]) => loadIntakeHub(...a) }));
const seen: unknown[] = [];
vi.mock("@/components/domain/jobs/worker/shop/ShopIntakeApp", () => ({
  ShopIntakeApp: (p: { token: string; initial: unknown }) => {
    seen.push(p);
    return <div data-testid="app" />;
  },
}));

import ShopIntakePage from "../../../../../app/(worker)/w/s/[shopToken]/page";

async function renderPage() {
  seen.length = 0;
  const ui = await ShopIntakePage({ params: Promise.resolve({ shopToken: "tok-123" }) });
  render(ui);
  return seen[0] as { token: string; initial: { kind: string; hub?: unknown; message?: string } };
}

describe("ShopIntakePage", () => {
  it("สำเร็จ → hub + token จาก URL", async () => {
    const hub = { state: "identify", workers: [], worker: null, openAllowed: false, profileReady: true, goldProfileReady: true, sessionExpired: false };
    loadIntakeHub.mockResolvedValue({ ok: true, data: hub });
    const p = await renderPage();
    expect(loadIntakeHub).toHaveBeenCalledWith("tok-123");
    expect(p.token).toBe("tok-123");
    expect(p.initial).toEqual({ kind: "hub", hub });
  });
  it("invalid_token (เพิกถอน/ไม่พบ ผลเดียวกัน) → closed", async () => {
    loadIntakeHub.mockResolvedValue({ ok: false, code: "invalid_token", error: "x" });
    expect((await renderPage()).initial).toEqual({ kind: "closed" });
  });
  it("rate_limited → ข้อความของระบบ · ล้มอื่น → 'เชื่อมต่อไม่ได้' (ไม่ส่งข้อความดิบ)", async () => {
    loadIntakeHub.mockResolvedValue({ ok: false, code: "rate_limited", error: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง" });
    expect((await renderPage()).initial).toEqual({ kind: "error", message: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง" });
    loadIntakeHub.mockResolvedValue({ ok: false, code: "error", error: "relation analytics.x failed" });
    expect((await renderPage()).initial).toEqual({ kind: "error", message: "เชื่อมต่อไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง" });
  });
  it("loadIntakeHub throw → 'เชื่อมต่อไม่ได้' ไม่ทำให้หน้าล้ม", async () => {
    loadIntakeHub.mockRejectedValue(new Error("boom"));
    expect((await renderPage()).initial).toEqual({ kind: "error", message: "เชื่อมต่อไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง" });
  });
});
