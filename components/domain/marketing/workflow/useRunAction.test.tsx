// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing" }));

import { GENERIC_ACTION_ERROR, useRunAction } from "./useRunAction";

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe("useRunAction", () => {
  it("สำเร็จ → refresh + ไม่มี error", async () => {
    refresh.mockClear();
    const { result } = renderHook(() => useRunAction(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.run(async () => ({ ok: true as const, data: 1 }), { success: "เสร็จ" });
    });
    expect(res).toEqual({ ok: true, data: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("ล้มเหลวปกติ → แสดงข้อความไทยจาก action · ไม่ refresh", async () => {
    refresh.mockClear();
    const { result } = renderHook(() => useRunAction(), { wrapper });
    await act(async () => {
      await result.current.run(async () => ({ ok: false as const, error: "วางแผนไม่ได้ — ยังไม่ได้ตั้งวัน" }));
    });
    expect(result.current.error).toBe("วางแผนไม่ได้ — ยังไม่ได้ตั้งวัน");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stale → แสดงข้อความ + refresh ข้อมูลที่เก่า", async () => {
    refresh.mockClear();
    const { result } = renderHook(() => useRunAction(), { wrapper });
    await act(async () => {
      await result.current.run(async () => ({ ok: false as const, error: "ข้อมูลเปลี่ยนไปแล้ว", stale: true }));
    });
    expect(result.current.error).toBe("ข้อมูลเปลี่ยนไปแล้ว");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("exception → ข้อความกลาง ไม่รั่วข้อความดิบ", async () => {
    const { result } = renderHook(() => useRunAction(), { wrapper });
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("relation \"analytics.x\" does not exist");
      });
    });
    expect(result.current.error).toBe(GENERIC_ACTION_ERROR);
  });

  it("กดซ้ำระหว่างทำอยู่ → ไม่เรียก action ที่สองและไม่ทำให้ busy ผิด", async () => {
    const { result } = renderHook(() => useRunAction(), { wrapper });
    let release: (v: { ok: true; data: number }) => void = () => {};
    const slow = vi.fn(() => new Promise<{ ok: true; data: number }>((r) => (release = r)));
    const second = vi.fn(async () => ({ ok: true as const, data: 2 }));
    let p1: Promise<unknown> = Promise.resolve();
    await act(async () => {
      p1 = result.current.run(slow);
    });
    await act(async () => {
      await result.current.run(second);
    });
    expect(second).not.toHaveBeenCalled();
    await act(async () => {
      release({ ok: true, data: 1 });
      await p1;
    });
    expect(result.current.busy).toBe(false);
  });
});
