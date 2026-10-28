// @vitest-environment jsdom
// ชื่อไฟล์ PDF ของโปสเตอร์ QR ร้าน: `YYMMDD_QR-ร้าน` (วันที่ออก QR ตามเวลาไทย) — ตั้งเฉพาะตอนพิมพ์ · เปิด/ปิด modal ไม่เปลี่ยน title ของหน้า
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' data-from='server'></svg>";
const issue = vi.fn();
vi.mock("@/lib/actions/job-workers", () => ({
  saveWorker: vi.fn(), setWorkerActive: vi.fn(), resetWorkerPin: vi.fn(), unlockWorker: vi.fn(),
  issueShopIntakeToken: (...x: unknown[]) => issue(...x), revokeShopIntakeToken: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/workers" }));

import { ToastProvider } from "@/components/ui/Toast";
import { ShopQrCard } from "@/components/domain/jobs/ShopQrCard";

beforeEach(() => {
  vi.clearAllMocks();
  document.title = "3J Insight";
  window.print = vi.fn();
  // 2026-10-22T17:30Z = 00:30 วันที่ 23 ตามเวลาไทย
  issue.mockResolvedValue({ ok: true, data: { svg: SVG, issuedAt: "2026-10-22T17:30:00Z", revokedPrevious: 0, warning: null } });
});

describe("ShopQrCard — ชื่อไฟล์ PDF โปสเตอร์", () => {
  it("เปิด modal ไม่เปลี่ยน title · beforeprint = 261023_QR-ร้าน · afterprint คืนเดิม · ปิด modal ไม่ค้าง", async () => {
    render(
      <ToastProvider>
        <ShopQrCard status={{ active: false, issuedAt: null, revokedAt: null }} statusError={null} />
      </ToastProvider>,
    );
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออก QR ร้าน" }));
    const dlg = await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(document.title).toBe("3J Insight");

    // ปุ่มพิมพ์ เรียก window.print() ตรง — เบราว์เซอร์ยิง beforeprint ก่อนเปิดกล่องพิมพ์
    await userEvent.click(within(dlg).getByRole("button", { name: "พิมพ์โปสเตอร์ QR" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe("261023_QR-ร้าน");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("3J Insight");

    window.dispatchEvent(new Event("beforeprint"));
    expect(document.title).toBe("261023_QR-ร้าน");
    await userEvent.click(within(dlg).getByRole("button", { name: "จดแล้ว ปิด" })); // พิมพ์แล้ว (printed=true) → ปิดได้เลย
    expect(document.title).toBe("3J Insight");
  });
});
