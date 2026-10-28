// @vitest-environment jsdom
// W-1 hub ของ QR ร้าน: 4 สภาพหลัก + W-1d/e/f · state ครบ 4 (loading/empty/error/success) · ไม่มีเลขเงิน · ไม่มีลิงก์ออก
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/s/x" }));
const intakeLogin = vi.fn();
const workerLogout = vi.fn();
const intakeSearch = vi.fn();
const intakeOpen = vi.fn();
const intakeMyJobs = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeMyJobs: (...a: unknown[]) => intakeMyJobs(...a),
  intakeLogin: (...a: unknown[]) => intakeLogin(...a),
  workerLogout: (...a: unknown[]) => workerLogout(...a),
  intakeSearch: (...a: unknown[]) => intakeSearch(...a),
  intakeOpen: (...a: unknown[]) => intakeOpen(...a),
}));

import { ShopIntakeApp } from "./ShopIntakeApp";
import type { ShopInitial } from "./ShopHub";
import type { IntakeHubView } from "@/lib/jobs/worker-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const WB = "22222222-2222-4222-8222-222222222222";

const hub = (o: Partial<IntakeHubView> = {}): ShopInitial => ({
  kind: "hub",
  hub: { state: "identify", workers: [{ id: WA, displayName: "หัวหน้าช่าง" }, { id: WB, displayName: "ช่าง ก" }], worker: null, openAllowed: false, profileReady: true, goldProfileReady: true, sessionExpired: false, ...o },
});
const ready = (o: Partial<IntakeHubView> = {}): ShopInitial => hub({ state: "ready", workers: [], worker: { id: WA, displayName: "หัวหน้าช่าง" }, openAllowed: true, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [], maxPhotos: 3 });
  intakeLogin.mockResolvedValue({ ok: true });
  workerLogout.mockResolvedValue({ ok: true });
});

describe("W-1a ยังไม่ PIN", () => {
  it("แสดงเฉพาะรายชื่อที่ server ส่งมา (คนมีสิทธิ์เปิดงาน) + หัวข้อ 'ใครกำลังเปิดงาน?' · ไม่มีลิงก์", () => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={hub()} />);
    expect(screen.getByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "หัวหน้าช่าง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ช่าง ก" })).toBeInTheDocument();
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
  });

  it("เลือกชื่อ → แป้น PIN → ครบ 4 หลักเรียก intakeLogin(token, id, pin) แล้วโหลด hub ใหม่ (ไม่ใช่ workerLogin ของ QR ใบงาน)", async () => {
    const user = userEvent.setup();
    render(<ShopIntakeApp token={TOKEN} initial={hub()} />);
    await user.click(screen.getByRole("button", { name: "หัวหน้าช่าง" }));
    for (const k of ["1", "2", "3", "4"]) await user.click(screen.getByRole("button", { name: k }));
    await waitFor(() => expect(intakeLogin).toHaveBeenCalledWith(TOKEN, WA, "1234"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("PIN ผิด: แสดงข้อความของ action เหนือแป้น (role=alert) · แป้นล้างค่า · ไม่เขียนเลข 5/10/15", async () => {
    intakeLogin.mockResolvedValue({ ok: false, error: "ชื่อหรือ PIN ไม่ถูกต้อง · เหลืออีก 4 ครั้งก่อนถูกล็อกชั่วคราว", code: "bad_credentials" });
    const user = userEvent.setup();
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={hub()} />);
    await user.click(screen.getByRole("button", { name: "ช่าง ก" }));
    for (const k of ["9", "9", "9", "9"]) await user.click(screen.getByRole("button", { name: k }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อหรือ PIN ไม่ถูกต้อง");
    expect(refresh).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/\b(5|10|15) ครั้ง|\b15 นาที/);
  });

  it("ล็อกจนออฟฟิศปลดล็อก / งบ QR ร้านหมด: แป้นถูกปิด", async () => {
    intakeLogin.mockResolvedValue({ ok: false, error: "วันนี้ใส่ PIN ผิดครบกำหนดแล้ว — ขอ QR ร้านใหม่จากออฟฟิศ", code: "token_budget_exhausted" });
    const user = userEvent.setup();
    render(<ShopIntakeApp token={TOKEN} initial={hub()} />);
    await user.click(screen.getByRole("button", { name: "ช่าง ก" }));
    for (const k of ["1", "1", "1", "1"]) await user.click(screen.getByRole("button", { name: k }));
    expect(await screen.findByText(/ขอ QR ร้านใหม่จากออฟฟิศ/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5" })).toBeDisabled();
  });

  it("empty: ไม่มีใครได้สิทธิ์ → ข้อความบอกให้แจ้งออฟฟิศ", () => {
    render(<ShopIntakeApp token={TOKEN} initial={hub({ workers: [] })} />);
    expect(screen.getByText("ยังไม่มีใครได้รับสิทธิ์เปิดงานจากมือถือ — แจ้งออฟฟิศ")).toBeInTheDocument();
  });

  it("session หมดเวลา: แสดง 'หมดเวลาแล้ว — ใส่ PIN ใหม่'", () => {
    render(<ShopIntakeApp token={TOKEN} initial={hub({ sessionExpired: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("หมดเวลาแล้ว — ใส่ PIN ใหม่");
  });
});

describe("W-1b มี session แต่ไม่มีสิทธิ์", () => {
  it("ข้อความ + ปุ่ม 'ไม่ใช่ฉัน' ปุ่มเดียว · ไม่มีปุ่มเปิดงาน/คิวงาน (ไม่แสดงปุ่ม disabled ที่ไม่มีวันกดได้)", async () => {
    const user = userEvent.setup();
    render(<ShopIntakeApp token={TOKEN} initial={ready({ openAllowed: false })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("สวัสดี หัวหน้าช่าง");
    expect(screen.getByText(/บัญชีนี้ยังไม่มีสิทธิ์เปิดงานใหม่/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เปิดงานใหม่/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/คิวงาน/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "ไม่ใช่ฉัน — เลือกชื่อใหม่" }));
    await waitFor(() => expect(workerLogout).toHaveBeenCalled());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("W-1c มีสิทธิ์", () => {
  it("ปุ่มหลักเดียว 'เปิดงานใหม่' + ลิงก์ข้อความ 'ไม่ใช่ฉัน' · ไม่มีคิวงาน", () => {
    render(<ShopIntakeApp token={TOKEN} initial={ready()} />);
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไม่ใช่ฉัน — เลือกชื่อใหม่" })).toBeInTheDocument();
    // W2 (W-9): + ปุ่ม "รีเฟรช" ของรายการ "ใบที่ฉันเปิด" — ปุ่มพื้นทึบ (primary) ยังมีตัวเดียวคือ "เปิดงานใหม่"
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["เปิดงานใหม่", "รีเฟรช", "ไม่ใช่ฉัน — เลือกชื่อใหม่"]);
    expect(screen.getAllByRole("button").filter((b) => b.className.includes("bg-primary-600"))).toHaveLength(1);
    expect(screen.queryByText(/คิวงานของฉัน/)).not.toBeInTheDocument();
  });
  it("กด 'เปิดงานใหม่' → W-2 ผลิตอะไร?", async () => {
    const user = userEvent.setup();
    render(<ShopIntakeApp token={TOKEN} initial={ready()} />);
    await user.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    expect(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส")).toBeInTheDocument();
  });
});

describe("W-1f ร้านยังไม่พร้อม (UX R1 — รู้ตั้งแต่ hub)", () => {
  it("ไม่มีแบบทั้งเงิน/ทองเหลือง และทอง → ข้อความ ไม่มีปุ่มเปิดงาน · ไม่ชี้ URL", () => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={ready({ profileReady: false, goldProfileReady: false })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ยังเปิดงานจากมือถือไม่ได้ — ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน");
    expect(screen.queryByRole("button", { name: "เปิดงานใหม่" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/https?:|\/jobs|\/oem|\/production/);
  });
  it("มีแต่แบบทอง → ยังเปิดงานได้ (กั้นเฉพาะโลหะที่ไม่มีแบบตอนเลือก)", () => {
    render(<ShopIntakeApp token={TOKEN} initial={ready({ profileReady: false, goldProfileReady: true })} />);
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });
});

describe("W-1d / W-1e", () => {
  it("QR ถูกยกเลิก/ไม่พบ: role=alert · ไม่มีรายชื่อ/ฟอร์ม/ปุ่ม · ข้อความเดียวกัน", () => {
    render(<ShopIntakeApp token={TOKEN} initial={{ kind: "closed" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("QR ร้านนี้ใช้ไม่ได้แล้ว");
    expect(screen.getByText("ขอ QR ใหม่จากออฟฟิศ")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
  it("เชื่อมต่อไม่ได้: ปุ่มลองอีกครั้ง → โหลดใหม่ · มีข้อความใช้กระดาษ", async () => {
    const user = userEvent.setup();
    render(<ShopIntakeApp token={TOKEN} initial={{ kind: "error", message: "เชื่อมต่อไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("เชื่อมต่อไม่ได้");
    expect(screen.getByText("ใช้กระดาษไปก่อนถ้าเน็ตยังไม่มา")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("หลังกดลองอีกครั้ง/ใส่ PIN ผ่าน: skeleton จนกว่า props ใหม่มา (ปุ่มเก่ากดไม่ได้) แล้วกลับเป็นของใหม่", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={{ kind: "error", message: "เชื่อมต่อไม่ได้" }} />);
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(screen.getByRole("status", { name: "กำลังโหลด" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองอีกครั้ง" })).not.toBeInTheDocument();
    rerender(<ShopIntakeApp token={TOKEN} initial={ready()} />);
    expect(screen.queryByRole("status", { name: "กำลังโหลด" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });
});

describe("🔴 ไม่มีเงิน/ต้นทุนบนจอ hub ทุกสภาพ", () => {
  it.each([
    ["identify", hub()],
    ["no-permission", ready({ openAllowed: false })],
    ["allowed", ready()],
    ["closed", { kind: "closed" } as ShopInitial],
    ["error", { kind: "error", message: "เชื่อมต่อไม่ได้" } as ShopInitial],
  ])("%s", (_n, initial) => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={initial} />);
    expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost/i);
  });
});
