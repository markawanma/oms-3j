// @vitest-environment jsdom
// RemovedAfterOrderNotice — ปิดได้ทีละรายการ/ทั้งหมด จำใน localStorage (try/catch) · รายการใหม่ต้องโผล่อีก · พลาดทางปลอดภัย (อ่านไม่ได้ = แสดง)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { REMOVED_DISMISSED_STORAGE_KEY, RemovedAfterOrderNotice, removedKey } from "@/components/domain/jobs/gems-to-buy/GemsToBuyNotices";
import type { GemPurchaseRemovedAfterOrder } from "@/lib/jobs/gem-purchase";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const E = (n: number, o: Partial<GemPurchaseRemovedAfterOrder> = {}): GemPurchaseRemovedAfterOrder => ({
  jobId: U(n), jobNo: `JB-00${n}`, canonicalItemId: U(500 + n), label: "โกเมน · ไข่ · 4×6 มม.", qty: 70, removedAt: `2026-10-2${n}T03:00:00+00:00`, ...o,
});
const stored = () => JSON.parse(window.localStorage.getItem(REMOVED_DISMISSED_STORAGE_KEY) ?? "[]") as string[];

beforeEach(() => window.localStorage.clear());

describe("RemovedAfterOrderNotice", () => {
  it("0 รายการ = ไม่ render", () => {
    const { container } = render(<RemovedAfterOrderNotice items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("ปิดทีละรายการ: รายการนั้นหาย อีกรายการยังอยู่ · จำใน localStorage · มีตัวบอกว่าซ่อนไว้กี่รายการ", async () => {
    const user = userEvent.setup();
    render(<RemovedAfterOrderNotice items={[E(1), E(2)]} />);
    await user.click(screen.getByRole("button", { name: /ดูรายการ/ }));
    await user.click(screen.getByRole("button", { name: "ปิดคำเตือน ใบ JB-001" }));
    expect(screen.queryByText("JB-001")).not.toBeInTheDocument();
    expect(screen.getByText("JB-002")).toBeInTheDocument();
    expect(stored()).toEqual([removedKey(E(1))]);
    expect(screen.getByText(/ซ่อนไว้อีก 1 รายการ/)).toBeInTheDocument();
  });
  it("โหลดหน้าใหม่: รายการที่เคยปิดไม่โผล่ · แต่ 'รายการใหม่' (ใบ/เวลาลบใหม่) โผล่เสมอ", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([removedKey(E(1))]));
    const { rerender } = render(<RemovedAfterOrderNotice items={[E(1)]} />);
    expect(await screen.findByText(/ซ่อนคำเตือนสั่งซ้ำไว้ 1 รายการ/)).toBeInTheDocument();
    expect(screen.queryByText(/เคยสั่งพลอยไว้แต่รายการถูกลบ/)).not.toBeInTheDocument();
    rerender(<RemovedAfterOrderNotice items={[E(1), E(3)]} />);
    expect(await screen.findByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 1 รายการ/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ดูรายการ/ }));
    expect(screen.getByText("JB-003")).toBeInTheDocument();
    expect(screen.queryByText("JB-001")).not.toBeInTheDocument();
  });
  it("แถวเดิมแต่ถูกลบซ้ำคนละเวลา = คีย์ใหม่ = โผล่อีก", async () => {
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([removedKey(E(1))]));
    render(<RemovedAfterOrderNotice items={[E(1, { removedAt: "2026-10-30T03:00:00+00:00" })]} />);
    expect(await screen.findByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 1 รายการ/)).toBeInTheDocument();
  });
  it("ปิดทั้งหมด → เหลือบรรทัดเล็ก + แสดงที่ปิดไว้ได้ · เลิกปิดทั้งหมดล้าง storage", async () => {
    const user = userEvent.setup();
    render(<RemovedAfterOrderNotice items={[E(1), E(2)]} />);
    await user.click(screen.getByRole("button", { name: "ปิดคำเตือนทั้งหมด" }));
    expect(screen.queryByText(/ระวังสั่งซ้ำ/)).not.toBeInTheDocument();
    expect(stored().sort()).toEqual([removedKey(E(1)), removedKey(E(2))].sort());
    await user.click(screen.getByRole("button", { name: "แสดงที่ปิดไว้" }));
    expect(screen.getByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 2 รายการ/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เลิกปิดทั้งหมด" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/ระวังสั่งซ้ำ/)).toBeInTheDocument();
  });
  it("คีย์ใน storage ที่ไม่มีในข้อมูลปัจจุบันถูกทิ้ง (storage ไม่โตเรื่อยๆ)", async () => {
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([removedKey(E(1)), "old:gone:key"]));
    render(<RemovedAfterOrderNotice items={[E(1)]} />);
    await screen.findByText(/ซ่อนคำเตือนสั่งซ้ำไว้ 1 รายการ/);
    expect(stored()).toEqual([removedKey(E(1))]);
  });
  it("localStorage พัง (throw) / ค่าเสีย: ไม่ crash · แสดงคำเตือนทุกรายการ (ไม่ซ่อนโดยไม่รู้ตัว) · ปิดได้เฉพาะรอบนี้", async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<RemovedAfterOrderNotice items={[E(1)]} />);
    expect(screen.getByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 1 รายการ/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ปิดคำเตือนทั้งหมด" }));
    expect(screen.queryByText(/ระวังสั่งซ้ำ/)).not.toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
    cleanup();
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, "{not json");
    render(<RemovedAfterOrderNotice items={[E(1)]} />);
    expect(screen.getByText(/ระวังสั่งซ้ำ/)).toBeInTheDocument();
  });
  it("ปุ่มปิดสูง ≥ 44px และอยู่ใน role=status", () => {
    render(<RemovedAfterOrderNotice items={[E(1)]} />);
    const btn = screen.getByRole("button", { name: "ปิดคำเตือนทั้งหมด" });
    expect(btn.className).toMatch(/min-h-11/);
    expect(within(screen.getByRole("status")).getByRole("button", { name: "ปิดคำเตือนทั้งหมด" })).toBe(btn);
  });
});
