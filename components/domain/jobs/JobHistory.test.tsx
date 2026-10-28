// @vitest-environment jsdom
// แท็บ "ประวัติงาน" /jobs/history: รายการ · ค้นหา (debounce) · สถานะ · เดือน/โลหะ/แหล่ง · แสดงเพิ่ม 25 · URL · empty A/B · truncated · ไม่มีเงิน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => search, usePathname: () => "/jobs/history" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { JobHistory } from "./JobHistory";
import type { HistoryData } from "@/lib/actions/job-office";
import type { HistoryRow } from "@/lib/jobs/history";

const TODAY = "2026-10-20";
let n = 0;
const row = (o: Partial<HistoryRow> = {}): HistoryRow => {
  n += 1;
  return {
    id: `id-${n}`, jobNo: `JB-${String(n).padStart(4, "0")}`, seq: n, sourceKind: "oem", designLabel: `แบบ ${n}`, sku: null, metal: "silver", qtyOrder: 50, qtyPlanned: 50, qtyGood: 48, qtyScrap: 2,
    status: "done", closedAt: "2026-10-19T10:00:00Z", cancelReason: null, surplusDisposition: "stock", updatedAt: null, ...o,
  };
};
const data = (rows: HistoryRow[], o: Partial<HistoryData> = {}): HistoryData => ({ todayTh: TODAY, rows, truncated: false, ...o });

beforeEach(() => {
  n = 0;
  replace.mockClear();
  search = new URLSearchParams();
});

const summary = () => screen.getByText(/^แสดง/, { selector: "p" });

describe("สถานะ A — ยังไม่มีใบที่ปิด", () => {
  it("EmptyState 'ยังไม่มีใบงานที่ปิดแล้ว' + ลิงก์กลับบอร์ด · ไม่มีช่องค้นหา/ตัวกรอง", () => {
    render(<JobHistory data={data([])} />);
    expect(screen.getByRole("heading", { name: "ประวัติงาน", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีใบงานที่ปิดแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับไปบอร์ดใบงาน" })).toHaveAttribute("href", "/jobs");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่พบใบงานที่ตรงกับตัวกรอง/)).not.toBeInTheDocument();
  });
});

describe("รายการ", () => {
  it("แถวเสร็จ: ป้ายเขียว 'เสร็จ' · เลขใบ · ชื่อแบบ · 'สั่ง 50 · ดี 48 · เสีย 2 ชิ้น' · โลหะ · แหล่ง · 'ปิด 19 ต.ค.' (ปีนี้ไม่ใส่ปี) · ลิงก์ทั้งแถวไป /jobs/<id>", () => {
    render(<JobHistory data={data([row({ id: "abc", jobNo: "JB-0018", seq: 18, designLabel: "แหวนโกเมนไข่" })])} />);
    const a = screen.getByRole("link", { name: /JB-0018/ });
    expect(a).toHaveAttribute("href", "/jobs/abc");
    expect(within(a).getByText("เสร็จ")).toBeInTheDocument();
    expect(a).toHaveTextContent("แหวนโกเมนไข่");
    expect(a).toHaveTextContent("สั่ง 50 · ดี 48 · เสีย 2 ชิ้น");
    expect(a).toHaveTextContent("เงิน");
    expect(a).toHaveTextContent("งาน OEM");
    expect(a).toHaveTextContent("ปิด 19 ต.ค.");
    expect(a).not.toHaveTextContent("2569");
    expect(a.className).toMatch(/border-l-green-600/);
  });

  it("แถวยกเลิก: ป้ายเทา 'ยกเลิก' · 'สั่ง 50 ชิ้น' (ไม่มีดี/เสีย) · 'ยกเลิก 5 ก.ย. 2568' ปีอื่นใส่ปี · 'เหตุผล: ...'", () => {
    render(<JobHistory data={data([row({ jobNo: "JB-0009", seq: 9, status: "cancelled", qtyGood: null, qtyScrap: null, closedAt: "2025-09-05T03:00:00Z", cancelReason: "ลูกค้าเปลี่ยนแบบ", sourceKind: "production", metal: "gold" })])} />);
    const a = screen.getByRole("link", { name: /JB-0009/ });
    expect(within(a).getByText("ยกเลิก", { selector: "span" })).toBeInTheDocument();
    expect(a).toHaveTextContent("สั่ง 50 ชิ้น");
    expect(a).not.toHaveTextContent("ดี ");
    expect(a).toHaveTextContent("ยกเลิก 5 ก.ย. 2568");
    expect(a).toHaveTextContent("ผลิตเข้าสต็อก");
    expect(a).toHaveTextContent("ทอง");
    expect(a).toHaveTextContent("เหตุผล: ลูกค้าเปลี่ยนแบบ");
    expect(a.className).toMatch(/border-l-zinc-400/);
  });

  it("วันปิดตามเวลาไทย: 17:30 UTC วันที่ 31 ต.ค. = 1 พ.ย. (ไม่ใช่ 31 ต.ค.)", () => {
    render(<JobHistory data={data([row({ closedAt: "2026-10-31T17:30:00Z" })])} />);
    expect(screen.getByRole("link")).toHaveTextContent("ปิด 1 พ.ย.");
  });

  it("ใบไม่มีเวลาปิด = 'ปิด —' (ไม่เดา)", () => {
    render(<JobHistory data={data([row({ closedAt: null })])} />);
    expect(screen.getByRole("link")).toHaveTextContent("ปิด —");
  });

  it("ของเหลือที่ยังไม่ตัดสิน: ป้ายรอง 'เหลือ 3 ชิ้น ยังไม่ตัดสิน' · ตัดสินแล้ว/ไม่เกิน = ไม่มีป้าย", () => {
    render(<JobHistory data={data([row({ jobNo: "JB-0001", qtyGood: 53, surplusDisposition: "hold" }), row({ jobNo: "JB-0002", qtyGood: 53, surplusDisposition: "stock" }), row({ jobNo: "JB-0003", qtyGood: 50, surplusDisposition: "hold" })])} />);
    expect(screen.getAllByText(/ยังไม่ตัดสิน/)).toHaveLength(1);
    expect(within(screen.getByRole("link", { name: /JB-0001/ })).getByText("เหลือ 3 ชิ้น ยังไม่ตัดสิน")).toBeInTheDocument();
  });

  it("ยอดทั้งต้นไม้แสดงตามที่ส่งมา (ดี 47 ไม่คำนวณซ้ำในหน้าจอ)", () => {
    render(<JobHistory data={data([row({ qtyGood: 47, qtyScrap: 3 })])} />);
    expect(screen.getByRole("link")).toHaveTextContent("ดี 47 · เสีย 3 ชิ้น");
  });

  it("ไม่มีเงิน/ต้นทุน/ลูกค้า/เลขอ้างอิงใบเสนอราคาบนหน้า", () => {
    render(<JobHistory data={data([row(), row({ status: "cancelled", cancelReason: "x" })])} />);
    expect(document.body.textContent ?? "").not.toMatch(/บาท|฿|THB|ราคา|ต้นทุน|ลูกค้า:|QT-|มัดจำ/);
  });
});

describe("ค้นหา", () => {
  const rows = () => [
    row({ jobNo: "JB-0018", seq: 18, designLabel: "แหวนโกเมนไข่", sku: "RG-001" }),
    row({ jobNo: "JB-0019", seq: 19, designLabel: "สร้อยคอ", sku: "NK-010" }),
    row({ jobNo: "JB-0020", seq: 20, designLabel: "ต่างหูห่วง", sku: "ER-100" }),
  ];
  const type = async (v: string) => userEvent.type(screen.getByRole("searchbox", { name: "ค้นหาใบงาน" }), v);

  it("ช่องเป็น type=search · พิมพ์ 'jb18' → เหลือ JB-0018 (หลัง debounce 300ms ไม่ใช่ทันที) · แสดง 1 จาก 1 ใบ", async () => {
    render(<JobHistory data={data(rows())} />);
    expect(screen.getByRole("searchbox", { name: "ค้นหาใบงาน" })).toHaveAttribute("type", "search");
    await type("jb18");
    expect(screen.getAllByRole("link")).toHaveLength(3); // ยังไม่ครบ 300ms
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1), { timeout: 2000 });
    expect(screen.getByRole("link")).toHaveTextContent("JB-0018");
    expect(summary()).toHaveTextContent("แสดง 1 จาก 1 ใบ");
  });

  it("ค้นหาด้วยชื่อแบบ/SKU (ไม่สนขีด/ตัวพิมพ์)", async () => {
    render(<JobHistory data={data(rows())} />);
    await type("er100");
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1), { timeout: 2000 });
    expect(screen.getByRole("link")).toHaveTextContent("ต่างหูห่วง");
  });

  it("เลขล้วน '1' ไม่ใช่ substring (ไม่ติดทุกใบที่มี 1) → ไม่พบ = สถานะ B", async () => {
    render(<JobHistory data={data(rows())} />);
    await type("1");
    expect(await screen.findByText("ไม่พบใบงานที่ตรงกับตัวกรอง", {}, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe("สถานะ B — กรองแล้วไม่เจอ", () => {
  it("แสดง 'ไม่พบใบงานที่ตรงกับตัวกรอง' + 'ล้างตัวกรอง' · กดแล้วกลับมาครบ + ช่องค้นหาว่าง + URL ว่าง", async () => {
    render(<JobHistory data={data([row({ designLabel: "แหวน" }), row({ designLabel: "สร้อย" })])} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(await screen.findByText("ไม่พบใบงานที่ตรงกับตัวกรอง", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(summary()).toHaveTextContent("แสดง 0 จาก 0 ใบ");
    await userEvent.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(summary()).toHaveTextContent("แสดง 2 จาก 2 ใบ");
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/jobs/history", { scroll: false }));
  });

  it("สถานะ 'ยกเลิก' แต่ไม่มีใบยกเลิกเลย = B (ไม่ใช่ A)", async () => {
    render(<JobHistory data={data([row()])} />);
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByText("ไม่พบใบงานที่ตรงกับตัวกรอง")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีใบงานที่ปิดแล้ว")).not.toBeInTheDocument();
  });
});

describe("ตัวกรอง", () => {
  const mixed = () => [
    row({ jobNo: "JB-0001", status: "done", metal: "silver", sourceKind: "oem", closedAt: "2026-10-10T05:00:00Z" }),
    row({ jobNo: "JB-0002", status: "cancelled", metal: "gold", sourceKind: "production", closedAt: "2026-10-12T05:00:00Z", cancelReason: "x" }),
    row({ jobNo: "JB-0003", status: "done", metal: "gold", sourceKind: "oem", closedAt: "2026-09-12T05:00:00Z" }),
  ];

  it("segmented: ทั้งหมดกดอยู่ (aria-pressed) · กด 'เสร็จ' → 2 ใบ · 'ยกเลิก' → 1 ใบ", async () => {
    render(<JobHistory data={data(mixed())} />);
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "เสร็จ" }));
    expect(screen.getByRole("button", { name: "เสร็จ" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveTextContent("JB-0002");
  });

  it("เดือนที่ปิด: ตัวเลือกมาจากข้อมูล (ต.ค. 2569 · ก.ย. 2569) · เลือก ก.ย. → JB-0003", async () => {
    render(<JobHistory data={data(mixed())} />);
    const sel = screen.getByLabelText("เดือนที่ปิด");
    expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["ทุกเดือน", "ต.ค. 2569", "ก.ย. 2569"]);
    await userEvent.selectOptions(sel, "2026-09");
    expect(screen.getByRole("link")).toHaveTextContent("JB-0003");
  });

  it("โลหะ + แหล่ง รวมกัน (AND)", async () => {
    render(<JobHistory data={data(mixed())} />);
    await userEvent.selectOptions(screen.getByLabelText("โลหะ"), "gold");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText("แหล่งงาน"), "oem");
    expect(screen.getByRole("link")).toHaveTextContent("JB-0003");
  });

  it("ตัวกรองลง URL: เปลี่ยนสถานะ/เดือน/โลหะ/แหล่ง → router.replace(?s=…&m=…&metal=…&src=…, {scroll:false}) · ค้นหาลง q หลัง debounce", async () => {
    render(<JobHistory data={data(mixed())} />);
    expect(replace).not.toHaveBeenCalled(); // เปิดหน้าเฉยๆ ไม่ยิง URL
    await userEvent.click(screen.getByRole("button", { name: "เสร็จ" }));
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/jobs/history?s=done", { scroll: false }));
    await userEvent.selectOptions(screen.getByLabelText("โลหะ"), "gold");
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/jobs/history?s=done&metal=gold", { scroll: false }));
    await userEvent.type(screen.getByRole("searchbox"), "JB-0003");
    await waitFor(() => expect(String(replace.mock.calls.at(-1)?.[0])).toContain("q=JB-0003"), { timeout: 2000 });
    // พิมพ์รัว 7 ตัวอักษร ไม่ยิง URL ทุกตัว
    expect(replace.mock.calls.filter((c) => String(c[0]).includes("q=")).length).toBeLessThanOrEqual(2);
  });

  it("เปิดหน้าด้วย URL ที่มีตัวกรอง = ตั้งค่าตามนั้น · ค่านอก whitelist ถูกทิ้ง", () => {
    search = new URLSearchParams("s=cancelled&metal=gold&src=production");
    render(<JobHistory data={data(mixed())} />);
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("โลหะ")).toHaveValue("gold");
    expect(screen.getByLabelText("แหล่งงาน")).toHaveValue("production");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    cleanup();
    search = new URLSearchParams("s=hack&metal=platinum&m=9999-99");
    render(<JobHistory data={data(mixed())} />);
    expect(screen.getByRole("button", { name: "ทั้งหมด" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("ค้นหาจาก URL (?q=JB-0002) กรองทันทีตั้งแต่เปิดหน้า · ช่องค้นหามีค่า", () => {
    search = new URLSearchParams("q=JB-0002");
    render(<JobHistory data={data(mixed())} />);
    expect(screen.getByRole("searchbox")).toHaveValue("JB-0002");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveTextContent("JB-0002");
  });
});

describe("แสดงครั้งละ 25 + แสดงเพิ่ม", () => {
  const sixty = () => Array.from({ length: 60 }, () => row());

  it("เริ่ม 25 ใบ · 'แสดง 25 จาก 60 ใบ' · ปุ่ม 'แสดงเพิ่ม (เหลือ 35)' → 50 → 60 แล้วปุ่มหาย", async () => {
    render(<JobHistory data={data(sixty())} />);
    expect(screen.getAllByRole("link")).toHaveLength(25);
    expect(summary()).toHaveTextContent("แสดง 25 จาก 60 ใบ");
    await userEvent.click(screen.getByRole("button", { name: "แสดงเพิ่ม (เหลือ 35)" }));
    expect(screen.getAllByRole("link")).toHaveLength(50);
    await userEvent.click(screen.getByRole("button", { name: "แสดงเพิ่ม (เหลือ 10)" }));
    expect(screen.getAllByRole("link")).toHaveLength(60);
    expect(summary()).toHaveTextContent("แสดง 60 จาก 60 ใบ");
    expect(screen.queryByRole("button", { name: /แสดงเพิ่ม/ })).not.toBeInTheDocument();
  });

  it("ไม่เกิน 25 = ไม่มีปุ่มแสดงเพิ่ม · เปลี่ยนตัวกรองแล้วกลับไป 25 ใบแรก", async () => {
    render(<JobHistory data={data([...sixty(), row({ status: "cancelled", cancelReason: "x" })])} />);
    await userEvent.click(screen.getByRole("button", { name: "แสดงเพิ่ม (เหลือ 36)" }));
    expect(screen.getAllByRole("link")).toHaveLength(50);
    await userEvent.click(screen.getByRole("button", { name: "เสร็จ" }));
    expect(screen.getAllByRole("link")).toHaveLength(25);
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("button", { name: /แสดงเพิ่ม/ })).not.toBeInTheDocument();
  });

  it("แถบสรุปเป็น aria-live=polite", () => {
    render(<JobHistory data={data(sixty())} />);
    expect(summary()).toHaveAttribute("aria-live", "polite");
  });
});

describe("truncated", () => {
  it("ครบเพดาน = แถบเตือน 'แสดงเฉพาะ 500 ใบล่าสุด' · ปกติไม่มี", () => {
    render(<JobHistory data={data([row()], { truncated: true })} />);
    expect(screen.getByText(/แสดงเฉพาะ 500 ใบล่าสุด/)).toBeInTheDocument();
    cleanup();
    render(<JobHistory data={data([row()])} />);
    expect(screen.queryByText(/แสดงเฉพาะ 500 ใบล่าสุด/)).not.toBeInTheDocument();
  });
});
