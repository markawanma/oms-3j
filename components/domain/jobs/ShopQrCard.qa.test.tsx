// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://oms-3j-git-feature-w1-shop-intake-ui-3j.vercel.app/jobs/workers"}
// แก้แล้ว (รอบแก้ security H1 · 21 ต.ค. 69): URL + SVG ของ QR ร้านประกอบที่ server จาก APP_ORIGIN (production เท่านั้น) — client ไม่ render เอง ไม่ใช้ window.location.origin · it.fails ของ BUG-1 เปลี่ยนเป็น it แล้ว
// QA (R2-D2 · 21 ต.ค. 69) — บั๊กที่พบตอน QA การ์ด QR ร้าน (W1) · (BUG-2 สถานะ 'ถูกเพิกถอน' ไม่มีวันขึ้น เพราะ DB คืน issued_at=null หลังเพิกถอน — รายงานในสรุป ไม่ทำเทสต์ เพราะแยก 'เคยออก' กับ 'ไม่เคยออก' จาก props ปัจจุบันไม่ได้) · ใช้ it.fails = เทสต์ผ่านตราบที่บั๊กยังอยู่ · เมื่อแก้แล้วจะ "แดง" ให้มาลบ .fails ออก
//   BUG-1  QR ร้านฝัง window.location.origin ของเบราว์เซอร์ออฟฟิศ — เปิดจาก preview/.vercel.app/localhost แล้วออก QR = QR ชี้ preview (ติด Vercel login) · ออกใหม่เพิกถอนใบเก่าใน DB แล้ว
//          และ QR แสดงครั้งเดียว → ทั้งร้านเปิดงานจากมือถือไม่ได้จนออก QR ใหม่อีกรอบ · QR ใบงานเดิมใช้ APP_ORIGIN ฝั่ง server (lib/jobs/origin.ts) — ต้องแนวเดียวกัน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const renderQr = vi.fn((_text: string) => "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
const SERVER_SVG = "<svg xmlns='http://www.w3.org/2000/svg' data-from='server'></svg>";
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
  issue.mockResolvedValue({ ok: true, data: { svg: SERVER_SVG, issuedAt: "2026-10-21T10:58:40Z", revokedPrevious: 1, warning: null } });
});
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

describe("QA — ShopQrCard", () => {
  it("(ตั้งค่าเทสต์) หน้าที่เปิดอยู่เป็น preview host จริงใน jsdom", () => {
    expect(window.location.origin).toBe("https://oms-3j-git-feature-w1-shop-intake-ui-3j.vercel.app");
  });

  // BUG-1 (แก้แล้ว): ภาพ QR มาจาก server ทั้งก้อน — client ไม่ประกอบลิงก์/ไม่ render เอง จึงฝัง origin ของเบราว์เซอร์ไม่ได้
  it("BUG-1 (แก้แล้ว): ออก QR จากหน้า preview → ใช้ SVG จาก server · client ไม่ render เอง · ไม่มีโดเมน preview/token ใน DOM", async () => {
    wrap(<ShopQrCard status={{ active: false, issuedAt: null, revokedAt: null }} statusError={null} />);
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออก QR ร้าน" }));
    const dlg = await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(renderQr).not.toHaveBeenCalled();
    expect(within(dlg).getByRole("img", { name: "QR ร้าน" }).querySelector("svg[data-from=server]")).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(/vercel\.app|localhost/);
    expect(document.body.innerHTML).not.toContain(RAW);
  });

  it("BUG-1 (แก้แล้ว): server ปฏิเสธ (ไม่ใช่ production) → แสดงข้อความตรงๆ · ไม่มีกล่อง QR · ของเดิมไม่ถูกแตะ (ไม่มี refresh)", async () => {
    issue.mockResolvedValue({ ok: false, error: "ออก QR ร้านได้เฉพาะที่ app.example.test (เว็บ production)", code: "prod_only" });
    wrap(<ShopQrCard status={{ active: true, issuedAt: "2026-10-20T02:12:00Z", revokedAt: null }} statusError={null} />);
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออกใหม่ (เปลี่ยน QR)" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "ออก QR ใหม่?" })).getByRole("button", { name: "ออก QR ใหม่ แล้วพิมพ์" }));
    expect(await within(screen.getByRole("region", { name: "QR ร้าน" })).findByRole("alert")).toHaveTextContent("ออก QR ร้านได้เฉพาะที่ app.example.test (เว็บ production)");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("แยกข้อความตาม code (ไม่เทียบข้อความ): origin_invalid = ข้อความเรื่องการตั้งค่าของ server · code อื่น/ไม่มี code แม้ข้อความหน้าตาเหมือน prod-only = ข้อความกลาง", async () => {
    issue.mockResolvedValueOnce({ ok: false, error: "ตั้งค่า APP_ORIGIN ไม่ถูกต้อง — QR ร้านต้องชี้ที่ https:// เท่านั้น แจ้งผู้ดูแลระบบ", code: "origin_invalid" });
    wrap(<ShopQrCard status={{ active: false, issuedAt: null, revokedAt: null }} statusError={null} />);
    const card = () => screen.getByRole("region", { name: "QR ร้าน" });
    await userEvent.click(within(card()).getByRole("button", { name: "ออก QR ร้าน" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent("ตั้งค่า APP_ORIGIN ไม่ถูกต้อง");
    issue.mockResolvedValueOnce({ ok: false, error: "ออก QR ร้านได้เฉพาะที่ app.example.test", code: "error" });
    await userEvent.click(within(card()).getByRole("button", { name: "ออก QR ร้าน" }));
    await waitFor(() => expect(within(card()).getByRole("alert")).toHaveTextContent("ออก QR ไม่สำเร็จ — ลองอีกครั้ง"));
    issue.mockResolvedValueOnce({ ok: false, error: "ออก QR ร้านได้เฉพาะที่ app.example.test" });
    await userEvent.click(within(card()).getByRole("button", { name: "ออก QR ร้าน" }));
    await waitFor(() => expect(within(card()).getByRole("alert")).toHaveTextContent("ออก QR ไม่สำเร็จ — ลองอีกครั้ง"));
  });

  it("warning จาก server (host ไม่ตรง APP_ORIGIN) แสดงในกล่อง QR", async () => {
    issue.mockResolvedValue({ ok: true, data: { svg: SERVER_SVG, issuedAt: "2026-10-21T10:58:40Z", revokedPrevious: 0, warning: "พิมพ์จาก preview — QR อาจใช้ไม่ได้" } });
    wrap(<ShopQrCard status={{ active: false, issuedAt: null, revokedAt: null }} statusError={null} />);
    await userEvent.click(within(screen.getByRole("region", { name: "QR ร้าน" })).getByRole("button", { name: "ออก QR ร้าน" }));
    const dlg = await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(within(dlg).getByRole("alert")).toHaveTextContent("พิมพ์จาก preview");
  });

  // BUG-2 — สถานะ "ถูกเพิกถอน" ไม่พึ่ง issuedAt (DB หลังเพิกถอนคืน issued_at = null) — ใช้ revokedAt (0188)
  it("BUG-2: revokedAt มี → 'ถูกเพิกถอน เมื่อ …' แม้ issuedAt = null · ไม่มี revokedAt → 'ยังไม่มี QR ร้านที่ใช้งานอยู่' (ไม่ยืนยันว่าไม่เคยออก)", () => {
    const { unmount } = wrap(<ShopQrCard status={{ active: false, issuedAt: null, revokedAt: "2026-10-21T01:00:00Z" }} statusError={null} />);
    const c = screen.getByRole("region", { name: "QR ร้าน" });
    expect(c).toHaveTextContent("ถูกเพิกถอน");
    expect(c).toHaveTextContent(/เมื่อ 21 ต\.ค\. 08:00/);
    expect(c).not.toHaveTextContent("ยังไม่มี QR ร้าน");
    unmount();
    wrap(<ShopQrCard status={{ active: false, issuedAt: null, revokedAt: null }} statusError={null} />);
    const c2 = screen.getByRole("region", { name: "QR ร้าน" });
    expect(c2).toHaveTextContent("ยังไม่มี QR ร้านที่ใช้งานอยู่");
    expect(c2).not.toHaveTextContent("ถูกเพิกถอน");
    expect(c2).not.toHaveTextContent("ไม่เคยออก");
  });

  it("BUG-2: issuedAt มีแต่ไม่ใช่ active และไม่มี revokedAt (DB เก่า 0187) → ไม่ฟันธงว่าถูกเพิกถอน", () => {
    wrap(<ShopQrCard status={{ active: false, issuedAt: "2026-10-20T02:12:00Z", revokedAt: null }} statusError={null} />);
    const c = screen.getByRole("region", { name: "QR ร้าน" });
    expect(c).toHaveTextContent("ยังไม่มี QR ร้านที่ใช้งานอยู่");
    expect(c).not.toHaveTextContent("ถูกเพิกถอน");
  });

});
