// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://oms-3j-git-feature-w1-shop-intake-ui-3j.vercel.app/jobs/workers"}
// QA (R2-D2 · 21 ต.ค. 69) — บั๊กที่พบตอน QA การ์ด QR ร้าน (W1) · (BUG-2 สถานะ 'ถูกเพิกถอน' ไม่มีวันขึ้น เพราะ DB คืน issued_at=null หลังเพิกถอน — รายงานในสรุป ไม่ทำเทสต์ เพราะแยก 'เคยออก' กับ 'ไม่เคยออก' จาก props ปัจจุบันไม่ได้) · ใช้ it.fails = เทสต์ผ่านตราบที่บั๊กยังอยู่ · เมื่อแก้แล้วจะ "แดง" ให้มาลบ .fails ออก
//   BUG-1  QR ร้านฝัง window.location.origin ของเบราว์เซอร์ออฟฟิศ — เปิดจาก preview/.vercel.app/localhost แล้วออก QR = QR ชี้ preview (ติด Vercel login) · ออกใหม่เพิกถอนใบเก่าใน DB แล้ว
//          และ QR แสดงครั้งเดียว → ทั้งร้านเปิดงานจากมือถือไม่ได้จนออก QR ใหม่อีกรอบ · QR ใบงานเดิมใช้ APP_ORIGIN ฝั่ง server (lib/jobs/origin.ts) — ต้องแนวเดียวกัน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const renderQr = vi.fn((_text: string) => "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
vi.mock("@/lib/jobs/qr-client", async (orig) => ({ ...(await orig<typeof import("@/lib/jobs/qr-client")>()), renderQrSvgClient: (t: string) => renderQr(t) }));
const issue = vi.fn();
vi.mock("@/lib/actions/job-workers", () => ({
  saveWorker: vi.fn(), setWorkerActive: vi.fn(), resetWorkerPin: vi.fn(), unlockWorker: vi.fn(),
  issueShopIntakeToken: (...x: unknown[]) => issue(...x), revokeShopIntakeToken: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/workers" }));

import { ToastProvider } from "@/components/ui/Toast";
import { ShopQrCard } from "@/components/domain/jobs/ShopQrCard";

const RAW = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx9";
beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  issue.mockResolvedValue({ ok: true, data: { token: RAW, issuedAt: "2026-10-21T10:58:40Z", revokedPrevious: 1 } });
});
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

describe("QA — ShopQrCard", () => {
  it("(ตั้งค่าเทสต์) หน้าที่เปิดอยู่เป็น preview host จริงใน jsdom", () => {
    expect(window.location.origin).toBe("https://oms-3j-git-feature-w1-shop-intake-ui-3j.vercel.app");
  });

  // BUG-1 — ข้อเท็จจริงปัจจุบัน (characterization): ลิงก์ใน QR = origin ของหน้าที่ออฟฟิศเปิดอยู่
  it("BUG-1 (สภาพปัจจุบัน): ออก QR จากหน้า preview → ลิงก์ใน QR ชี้ preview", async () => {
    wrap(<ShopQrCard status={{ active: false, issuedAt: null }} statusError={null} />);
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออก QR ร้าน" }));
    await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(renderQr).toHaveBeenCalledTimes(1);
    expect(renderQr.mock.calls[0][0]).toBe(`${window.location.origin}/w/s/${RAW}`);
  });

  // BUG-1 — สิ่งที่ "ควรเป็น" (fix-agnostic): QR ที่จะติดผนังห้ามชี้ *.vercel.app / localhost ที่ไม่ใช่ production
  it.fails("BUG-1 (ควรเป็น): ออก QR จากหน้า preview ต้องไม่ฝังโดเมน preview (.vercel.app/localhost) ใน QR", async () => {
    wrap(<ShopQrCard status={{ active: false, issuedAt: null }} statusError={null} />);
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออก QR ร้าน" }));
    await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    const url = new URL(renderQr.mock.calls[0][0]);
    expect(url.host).not.toMatch(/\.vercel\.app$|^localhost/);
  });

});
