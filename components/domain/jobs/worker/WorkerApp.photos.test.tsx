// @vitest-environment jsdom
// หน้าช่าง + รูปใบงาน (0182 · 0189 W2): รูปหลักใหญ่เกือบเต็มความกว้างบนหัวจอ (เดิมภาพย่อ 80px) · แตะเต็มจอ ปัดดู · ไม่มีรูป = จอเดิม · ลิงก์หมดอายุ → ขอ view ใหม่ ไม่ค้างรูปแตก
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

describe("รูปหลักใหญ่บนหัวจอ (W2 — มติ 21 ต.ค. แทนภาพย่อ 80px)", () => {
  it("มีรูป: รูปหลักเต็มความกว้างอยู่บนสุดของ <header> เหนือเลขใบงาน · สูงจำกัด min(30vh,13rem) + object-contain (ไม่ดันปุ่ม sticky · ไม่ตัดชิ้นงาน) · ชิป '3 รูป' · ใช้รูปแรก (รูปหลัก) ภาพกลาง md", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view([photo(1), photo(2), photo(3)])} />);
    const t = thumb();
    expect(t).toHaveAccessibleName("รูปงาน JB-0007 3 รูป แตะเพื่อดูเต็มจอ");
    expect(t.className).toContain("w-full");
    expect(t.className).toContain("h-[min(30vh,13rem)]");
    expect(t.className).not.toContain("h-20"); // ไม่ใช่ภาพย่อ 80px แล้ว
    expect(within(t).getByText("3 รูป")).toBeInTheDocument();
    const img = t.querySelector("img")!;
    expect(img).toHaveAttribute("src", u(1, "md")); // md ให้ชัดบนจอ 3x (sm 480px จะเบลอ)
    expect(img.className).toContain("object-contain");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    // อยู่ใน <header> ก่อน h1 (ลำดับ DOM = ลำดับบนจอ) · ชื่อ/จำนวนอยู่ใต้เต็มความกว้าง
    const header = container.querySelector("header")!;
    const h1 = within(header).getByRole("heading", { level: 1, name: "JB-0007" });
    expect(header.contains(t)).toBe(true);
    expect(t.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h1.parentElement).toBe(header);
    expect(header.contains(screen.getByText("แหวนลาย A"))).toBe(true);
  });

  it("🔴 ปุ่มหลัก sticky (รับงาน) ยังอยู่ใน StickyAction (sticky bottom-0) และมาหลังรูป · ใบไม่มีรูป = ไม่มีกล่องรูป", () => {
    const { container } = render(<WorkerApp token={TOKEN} view={view([photo(1)])} />);
    const btn = screen.getByRole("button", { name: "รับงาน" });
    const sticky = btn.closest(".sticky");
    expect(sticky).not.toBeNull();
    expect(sticky!.className).toContain("bottom-0");
    expect(thumb().compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ภาพที่สูงที่สุดที่ CSS ยอมให้ (13rem = 208px) + ช่องไฟ — ต้องไม่ใช่ค่าตายตัวที่เกินจอ 640
    expect(thumb().className).toMatch(/h-\[min\(30vh,13rem\)\]/);
    cleanup();
    const plain = render(<WorkerApp token={TOKEN} view={view()} />);
    expect(plain.container.querySelector("[class*='min(30vh']")).toBeNull();
    expect(container).toBeDefined();
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

describe("hero กันกระพริบหลัง refresh (ลิงก์ใหม่ของรูปเดิม)", () => {
  it("ลิงก์ใหม่ของรูปเดิม (id เดิม): ภาพเก่าค้างใต้ภาพใหม่จนภาพใหม่โหลดเสร็จ · ไม่กลับไปเป็นกรอบ pulse · พอภาพใหม่โหลดแล้วภาพเก่าถูกถอด", () => {
    const { container, rerender } = render(<WorkerApp token={TOKEN} view={view([photo(1, "a")])} />);
    const first = container.querySelector("img")!;
    fireEvent.load(first); // ภาพแรกโหลดสำเร็จ
    expect(container.querySelector(".animate-pulse")).toBeNull();
    rerender(<WorkerApp token={TOKEN} view={view([photo(1, "b")])} />); // router.refresh → ลิงก์ใหม่ (id เดิม)
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs).toHaveLength(2);
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([u(1, "md", "a"), u(1, "md", "b")]); // เก่าอยู่ใต้ ใหม่อยู่บน
    expect(imgs[0].getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".animate-pulse")).toBeNull(); // ไม่กระพริบ
    fireEvent.load(imgs[1]);
    const after = [...container.querySelectorAll("img")];
    expect(after).toHaveLength(1);
    expect(after[0].getAttribute("src")).toBe(u(1, "md", "b"));
  });

  it("เปลี่ยนเป็นรูปอื่น (id ต่าง) = ไม่คงภาพเก่า (ไม่โชว์ผิดชิ้น) · ใบที่ภาพแรกยังไม่เคยโหลด = pulse ตามเดิม", () => {
    const { container, rerender } = render(<WorkerApp token={TOKEN} view={view([photo(1, "a")])} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull(); // ยังไม่เคยโหลด
    fireEvent.load(container.querySelector("img")!);
    rerender(<WorkerApp token={TOKEN} view={view([photo(2, "a")])} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(u(2, "md", "a"));
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("ภาพใหม่โหลดล้ม → สถานะ 'โหลดรูปไม่ได้ แตะลองใหม่' ตามเดิม (ไม่ค้างภาพเก่าเงียบๆ)", () => {
    const { container, rerender } = render(<WorkerApp token={TOKEN} view={view([photo(1, "a")])} />);
    fireEvent.load(container.querySelector("img")!);
    rerender(<WorkerApp token={TOKEN} view={view([photo(1, "b")])} />);
    const imgs = [...container.querySelectorAll("img")];
    fireEvent.error(imgs[1]);
    expect(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" })).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("ลิงก์รูปหมดอายุ (15 นาที · เซสชันช่าง 12 ชม.)", () => {
  it("S2: อัตโนมัติ ≤ 2 ครั้ง (ลิงก์ใหม่พังซ้ำ) แล้วหยุด · แตะ = ขอทันทีและรีเซ็ต", async () => {
    let t = 5_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => t);
    try {
      let n = 0;
      const next = () => view([photo(1, `t${++n}`)]);
      const { container, rerender } = render(<WorkerApp token={TOKEN} view={next()} />);
      for (const calls of [1, 2]) {
        t += 11_000;
        fireEvent.error(container.querySelector("img")!);
        expect(refresh).toHaveBeenCalledTimes(calls);
        rerender(<WorkerApp token={TOKEN} view={next()} />); // server ส่งลิงก์ใหม่ (ที่พังอีก)
      }
      t += 11_000;
      fireEvent.error(container.querySelector("img")!);
      expect(refresh).toHaveBeenCalledTimes(2); // เกินเพดาน — ไม่วนต่อ
      await userEvent.click(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" }));
      expect(refresh).toHaveBeenCalledTimes(3);
      rerender(<WorkerApp token={TOKEN} view={next()} />);
      t += 11_000;
      fireEvent.error(container.querySelector("img")!);
      expect(refresh).toHaveBeenCalledTimes(4); // แตะแล้วรีเซ็ต — อัตโนมัติได้อีก
    } finally {
      now.mockRestore();
    }
  });

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
    expect(container.querySelector("img")).toHaveAttribute("src", u(1, "md", "fresh"));
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
