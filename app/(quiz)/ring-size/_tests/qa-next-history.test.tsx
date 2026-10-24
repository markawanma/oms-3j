// @vitest-environment jsdom
// QA-3: ปฏิสัมพันธ์กับ history ของ Next App Router (ที่ jsdom เปล่าๆ ไม่เห็น)
//
// ที่มา: next@15.5.25 `dist/client/components/app-router.js`
//   - HistoryUpdater (useInsertionEffect) ตั้ง history.state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE } ตอน mount
//   - Router ใช้ useEffect (ใน component แม่) "ครอบ" pushState/replaceState ให้คัดลอก __NA จาก state ปัจจุบันไปใส่ state ใหม่
//   - onPopState: ถ้า event.state มี แต่ไม่มี __NA → window.location.reload()
// React รัน effect "ลูกก่อนแม่" → effect ตอน mount ของ RingSizeClient (replaceState({rs:"R0",i})) รันก่อน patch ของ Router
//   = เรียก replaceState ตัวจริงของเบราว์เซอร์ → ทับ state ของ Next ทิ้ง (ไม่มี __NA) → entry ถัดๆ ไปไม่มี __NA ด้วย
//   → กด Back (ของเครื่อง หรือปุ่มย้อนบนจอที่เรียก history.back()) = Next สั่ง reload หน้า → ค่าที่วัดค้างหาย / กลับ R0
// เทสต์นี้จำลอง 3 พฤติกรรมข้างบนด้วยโค้ดที่คัดลอกความหมายจากไฟล์นั้น (ไม่ได้รัน Next จริง — ต้องยืนยันบน preview จริง)
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useEffect, useInsertionEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RingSizeClient } from "../RingSizeClient";
import { mockRects, resetBrowserState } from "./setup.test-util";

const reload = vi.fn();

function NextLikeRouter({ children }: { children: ReactNode }) {
  useInsertionEffect(() => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["tree"] }, "");
  }, []);
  useEffect(() => {
    const origPush = window.history.pushState.bind(window.history);
    const origReplace = window.history.replaceState.bind(window.history);
    const copyInternals = (data: Record<string, unknown> | null | undefined) => {
      const d = data ?? {};
      const cur = window.history.state as Record<string, unknown> | null;
      if (cur?.__NA) d.__NA = cur.__NA;
      if (cur?.__PRIVATE_NEXTJS_INTERNALS_TREE) d.__PRIVATE_NEXTJS_INTERNALS_TREE = cur.__PRIVATE_NEXTJS_INTERNALS_TREE;
      return d;
    };
    window.history.pushState = (data: unknown, u: string, url?: string | URL | null) => {
      const d = data as Record<string, unknown> | null;
      if (d?.__NA || d?._N) return origPush(data, u, url);
      return origPush(copyInternals(d), u, url);
    };
    window.history.replaceState = (data: unknown, u: string, url?: string | URL | null) => {
      const d = data as Record<string, unknown> | null;
      if (d?.__NA || d?._N) return origReplace(data, u, url);
      return origReplace(copyInternals(d), u, url);
    };
    const onPop = (e: PopStateEvent) => {
      if (!e.state) return;
      if (!(e.state as Record<string, unknown>).__NA) {
        reload();
        return;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return <>{children}</>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  reload.mockReset();
  resetBrowserState();
});
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
});

const btn = (name: string | RegExp) => screen.getByRole("button", { name });

describe("QA-3: history ของหน้านี้ต้องคงตัวบ่งชี้ของ Next App Router (__NA) ไม่งั้น Back = reload", () => {
  // it.fails: ผ่านตราบที่บั๊กยังอยู่ (assert ล้ม) · ถ้า Luke แก้แล้วเทสต์จะ "ล้ม" → เปลี่ยนเป็น it
  it.fails("QA-3a หลัง mount: history.state ยังมี __NA (ไม่ถูก replaceState ของหน้าทับทิ้ง)", async () => {
    render(
      <NextLikeRouter>
        <RingSizeClient />
      </NextLikeRouter>
    );
    await screen.findByRole("button", { name: "เริ่มวัดไซส์" });
    expect((window.history.state as Record<string, unknown>).__NA).toBe(true);
  });

  it.fails("QA-3b กดเริ่ม → R1Pick → ปุ่มย้อนบนจอ → ต้องไม่ทำให้ Next สั่ง reload หน้า", async () => {
    const u = userEvent.setup();
    render(
      <NextLikeRouter>
        <RingSizeClient />
      </NextLikeRouter>
    );
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    expect(screen.getByText("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).not.toHaveBeenCalled();
  });

  it("negative control: ถ้า state ของแต่ละ entry มี __NA (ซึ่งเป็นสิ่งที่ Next ต้องการ) harness นี้ไม่สั่ง reload — พิสูจน์ว่าเทสต์ข้างบนจับของจริง", async () => {
    // ผู้ใช้เรียก pushState/replaceState "หลัง" Router ติดตั้ง patch แล้ว (เช่นใน event handler) → ได้ __NA ครบ
    render(<NextLikeRouter><div /></NextLikeRouter>);
    window.history.pushState({ rs: "R1Pick", i: 1 }, "");
    expect((window.history.state as Record<string, unknown>).__NA).toBe(true);
    window.history.back();
    await new Promise((r) => setTimeout(r, 20));
    expect(reload).not.toHaveBeenCalled();
  });
});
