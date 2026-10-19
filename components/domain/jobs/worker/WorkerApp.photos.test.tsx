// @vitest-environment jsdom
// หน้าช่าง + รูปใบงาน (0182): ภาพย่อ 80px มุมขวาบนข้างเลขใบงาน · แตะเต็มจอ ปัดดู · ไม่มีรูป = จอเดิม · ลิงก์หมดอายุ → ขอ view ใหม่ ไม่ค้างรูปแตก
// 🔴 ต้องไม่มี: ปุ่มจัดการ/อัปโหลด · ลิงก์ · ป้าย "จากแคตตาล็อก" · ตัวเลขเงิน · ชื่อลูกค้า/ชื่อผู้อัปโหลด
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
vi.mock("@/lib/actions/job-worker", () => ({ workerLogin: vi.fn(), workerLogout: vi.fn(), workerReceiveStage: vi.fn(), workerSendStage: vi.fn() }));

import { WorkerApp } from "./WorkerApp";
import type { WorkerPhoto, WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const u = (n: number, v: "sm" | "md", t = "a") => `https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p${n}_${v}.jpg?token=${t}`;
const photo = (n: number, t = "a"): WorkerPhoto => ({ id: `p${n}`, smUrl: u(n, "sm", t), mdUrl: u(n, "md", t), isPrimary: n === 1, caption: null });

const view = (photos?: WorkerPhoto[], viewer: WorkerView["viewer"] = { workerId: WA, displayName: "ช่างเอ" }): WorkerView => ({
  job: {
    jobNo: "JB-0007", status: "in_progress", designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, dueDate: "2026-10-30",
    stages: [{ seq: 1, code: "wax_inject", name: "ฉีดเทียน", status: "sent" }, { seq: 2, code: "cast", name: "หล่อ", status: "pending" }],
    ...(photos ? { photos } : {}),
  },
  viewer,
  sessionExpired: false,
  nextAction: "receive",
  actionStage: { seq: 2, code: "cast", name: "หล่อ", weightRequired: true },
  prevWeightOutG: 11.2,
  heldBy: null,
  workers: [],
  scrapReasons: [],
});

beforeEach(() => vi.clearAllMocks());

const thumb = () => screen.getByRole("button", { name: /^รูปงาน JB-0007 .*แตะเพื่อดูเต็มจอ$/ });
const viewer = () => screen.getByRole("dialog", { name: "รูปงาน JB-0007" });

describe("ภาพย่อหัวใบงาน", () => {
  it("มีรูป: ภาพย่อ 80×80px อยู่แถวเดียวกับเลขใบงาน (ขวา) · ชิป '3 รูป' · ชื่อ/จำนวนอยู่ใต้เต็มความกว้าง · ใช้รูปแรก (รูปหลัก)", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view([photo(1), photo(2), photo(3)])} />);
    const t = thumb();
    expect(t).toHaveAccessibleName("รูปงาน JB-0007 3 รูป แตะเพื่อดูเต็มจอ");
    expect(t.className).toContain("h-20");
    expect(t.className).toContain("w-20");
    expect(within(t).getByText("3 รูป")).toBeInTheDocument();
    expect(t.querySelector("img")).toHaveAttribute("src", u(1, "sm"));
    expect(t.querySelector("img")).toHaveAttribute("loading", "lazy");
    const row = t.parentElement!;
    expect(row.className).toContain("justify-between");
    expect(within(row).getByRole("heading", { level: 1, name: "JB-0007" })).toBeInTheDocument();
    // ชื่อ/จำนวนอยู่นอกแถวรูป (เต็มความกว้าง ไม่ถูกรูปบีบ)
    const name = screen.getByText("แหวนลาย A");
    expect(row.contains(name)).toBe(false);
    expect(container.querySelector("header")!.contains(name)).toBe(true);
  });

  it("รูปเดียว: ไม่มีชิป 'n รูป' · ป้ายสำหรับ screen reader ไม่มีจำนวน", () => {
    render(<WorkerApp token={TOKEN} view={view([photo(1)])} />);
    expect(thumb()).toHaveAccessibleName("รูปงาน JB-0007 แตะเพื่อดูเต็มจอ");
    expect(within(thumb()).queryByText(/รูป$/)).not.toBeInTheDocument();
  });

  it("ไม่มีรูป (ไม่มี key photos) = จอเดิม: ไม่มี <img>/ปุ่มรูป/กรอบเปล่า · h1 อยู่ใน <header> ตรงๆ (ไม่มีแถว flex ห่อ)", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /แตะเพื่อดูเต็มจอ/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).parentElement!.tagName).toBe("HEADER");
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeInTheDocument();
  });

  it("ก่อนระบุตัว (ไม่มีรูปใน view) ไม่มีภาพย่อ", () => {
    const v = view(undefined, null);
    v.nextAction = "identify";
    v.actionStage = null;
    v.workers = [{ id: WA, displayName: "ช่างเอ" }];
    const { container } = render(<WorkerApp token={TOKEN} view={v} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("viewer หน้าช่าง", () => {
  it("แตะ = เปิดเต็มจอ 'JB-0007 · 1/3' · ปัด/ปุ่ม › ไปรูปถัดไป · ปิด 56px แล้วกลับจอเดิม (ไม่ reload · ปุ่มรับงานยังอยู่)", async () => {
    render(<WorkerApp token={TOKEN} view={view([photo(1), photo(2), photo(3)])} />);
    await userEvent.click(thumb());
    expect(within(viewer()).getByText("JB-0007 · 1/3")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "รูปถัดไป" }));
    expect(within(viewer()).getByText("JB-0007 · 2/3")).toBeInTheDocument();
    expect(within(viewer()).getByAltText("รูปงาน JB-0007 รูปที่ 2 จาก 3")).toHaveAttribute("src", u(2, "sm"));
    const close = within(viewer()).getByRole("button", { name: "ปิดรูป" });
    expect(close.className).toContain("h-14");
    await userEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Esc ปิด · ดูอย่างเดียว: ไม่มีปุ่มตั้งรูปหลัก/เลื่อน/ลบ/อัปโหลด/ดาวน์โหลด · ไม่มีลิงก์ · ไม่มีป้ายจากแคตตาล็อก", async () => {
    render(<WorkerApp token={TOKEN} view={view([photo(1), photo(2)])} />);
    await userEvent.click(thumb());
    const labels = within(viewer()).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["ปิดรูป", "รูปก่อนหน้า", "รูปถัดไป"]);
    expect(within(viewer()).queryByRole("link")).not.toBeInTheDocument();
    expect(viewer().textContent).not.toMatch(/แคตตาล็อก|ลบ|อัปโหลด|ดาวน์โหลด|บาท|฿|ราคา/);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("รูปเดียว: ไม่มีปุ่ม ‹ ›", async () => {
    render(<WorkerApp token={TOKEN} view={view([photo(1)])} />);
    await userEvent.click(thumb());
    expect(within(viewer()).queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
  });
});

describe("ลิงก์รูปหมดอายุ (15 นาที · เซสชันช่าง 12 ชม.)", () => {
  it("ภาพย่อโหลดล้ม → 'โหลดรูปไม่ได้ · แตะลองใหม่' + ขอ view ใหม่อัตโนมัติครั้งเดียว (ไม่สลับแผงเป็น skeleton) · ล้มซ้ำในช่วงห้ามยิง ไม่ยิงซ้ำ · แตะ = ขอใหม่ทันที", async () => {
    const { container, rerender } = render(<WorkerApp token={TOKEN} view={view([photo(1), photo(2)])} />);
    fireEvent.error(container.querySelector("img")!);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" })).toBeInTheDocument();
    // แผงรับ/ส่งไม่ถูกแทนด้วย skeleton ระหว่างขอรูปใหม่ (ค่าที่ช่างกรอกค้างอยู่ต้องไม่หาย)
    expect(screen.queryByRole("status", { name: "กำลังโหลด" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeInTheDocument();
    // server ส่ง view ใหม่ (ลิงก์ใหม่) → รูปกลับมาเอง ไม่ค้างรูปแตก
    rerender(<WorkerApp token={TOKEN} view={view([photo(1, "fresh"), photo(2, "fresh")])} />);
    expect(container.querySelector("img")).toHaveAttribute("src", u(1, "sm", "fresh"));
    expect(screen.queryByText(/โหลดรูปไม่ได้/)).not.toBeInTheDocument();
    // ล้มอีกครั้งทันที → ไม่ยิงอัตโนมัติซ้ำ แต่แตะได้
    fireEvent.error(container.querySelector("img")!);
    expect(refresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("viewer: รูปย่อและรูปกลางพังทั้งคู่ → 'โหลดรูปไม่ได้' + [ลองใหม่] ขอ view ใหม่ · ลิงก์ใหม่มา = รูปกลับมา", async () => {
    const { rerender } = render(<WorkerApp token={TOKEN} view={view([photo(1)])} />);
    await userEvent.click(thumb());
    fireEvent.error(within(viewer()).getByAltText("รูปงาน JB-0007 รูปที่ 1 จาก 1"));
    fireEvent.error(viewer().querySelector(`img[src="${u(1, "md")}"]`)!);
    expect(within(viewer()).getByText("โหลดรูปไม่ได้")).toBeInTheDocument();
    refresh.mockClear();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลองใหม่" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<WorkerApp token={TOKEN} view={view([photo(1, "fresh")])} />);
    expect(within(viewer()).getByAltText("รูปงาน JB-0007 รูปที่ 1 จาก 1")).toHaveAttribute("src", u(1, "sm", "fresh"));
  });
});
