// @vitest-environment jsdom
// G1b UI รอบแก้ (security M1/M2/L2 · review B1/S1/N3/N5/N9): expected ทุกครั้งที่ติ๊ก · ปุ่มย้อนจากผล server · แถบหลังคัดลอก (snapshot/หมดอายุ/qty_changed/modal) ·
// removed_after_order forceShow + chip · print:hidden ของต้นทุน · ต้นทุนไม่โผล่เลขเก่าตอนเปิดใหม่
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/jobs/gems-to-buy" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const A = { markGemPurchase: vi.fn(), getGemPurchaseCost: vi.fn() };
vi.mock("@/lib/actions/gems", () => ({
  markGemPurchase: (...a: unknown[]) => A.markGemPurchase(...a),
  getGemPurchaseCost: (...a: unknown[]) => A.getGemPurchaseCost(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { GemsToBuyClient, COST_SWITCH_STORAGE_KEY } from "@/components/domain/jobs/gems-to-buy/GemsToBuyClient";
import { REMOVED_DISMISSED_STORAGE_KEY, removedKey } from "@/components/domain/jobs/gems-to-buy/GemsToBuyNotices";
import { GTB_EMPTY_FILTERS, MARK_MULTI_LINE_MESSAGE, MARK_QTY_CHANGED_AFTER_COPY_MESSAGE, MARK_QTY_CHANGED_MESSAGE } from "@/lib/jobs/gems-to-buy";
import type { GemsToBuyView, GtbGroup, GtbJob, GtbTab } from "@/lib/jobs/gems-to-buy";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-24";
const J = (n: number, o: Partial<GtbJob> = {}): GtbJob => ({
  jobId: U(1000 + n), jobNo: `JB-${String(n).padStart(4, "0")}`, designLabel: `แบบ ${n}`, dueDate: null, qtyNeededNow: 10, qtyOrdered: 0, qtyRemaining: 10, qtyExcess: 0,
  isOrdered: false, changedAfterOrder: false, orderedAt: null, orderedBy: null, lineIds: [U(2000 + n)], ...o,
});
const G = (n: number, jobs: GtbJob[], o: Partial<GtbGroup> = {}): GtbGroup => ({
  canonicalItemId: U(n), typeId: U(100 + n), typeName: "โกเมน", shapeId: U(200 + n), shapeName: "ไข่", sizeA: 4, sizeB: 6, sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
  qtyNeededNow: jobs.reduce((s, j) => s + j.qtyNeededNow, 0), qtyOrdered: jobs.reduce((s, j) => s + j.qtyOrdered, 0), qtyRemaining: jobs.reduce((s, j) => s + j.qtyRemaining, 0), qtyExcess: jobs.reduce((s, j) => s + j.qtyExcess, 0),
  jobCount: jobs.length, earliestDue: null, earliestDueRemaining: null, jobs, ...o,
});
const view = (groups: GtbGroup[], o: Partial<GemsToBuyView> = {}): GemsToBuyView => ({
  serverNow: "2026-10-24T14:32:10+07:00", todayBkk: TODAY, groups, unspecifiedJobs: [], removedAfterOrder: [],
  totals: { groups: groups.length, jobs: 0, qtyNeededNow: 0, qtyOrdered: 0, qtyRemaining: 0, qtyExcess: 0, unspecifiedJobs: 0 }, ...o,
});
const G2 = (): GtbGroup => G(2, [J(3, { qtyNeededNow: 120, qtyRemaining: 120 })], { typeName: "ไพลิน", shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "ไพลิน · กลม · 2 มม." });
const G1 = (): GtbGroup => G(1, [J(1, { qtyNeededNow: 30, qtyRemaining: 30 }), J(2, { qtyNeededNow: 40, qtyRemaining: 40 })]);

const el = (v: GemsToBuyView, tab: GtbTab = "pending") => (
  <ToastProvider>
    <GemsToBuyClient view={v} initialTab={tab} initialFilters={GTB_EMPTY_FILTERS} />
  </ToastProvider>
);
const mount = (v: GemsToBuyView, tab: GtbTab = "pending") => render(el(v, tab));
const table = () => within(screen.getByTestId("gems-table"));

type MarkIn = { lineIds: string[]; ordered: boolean; expected?: Record<string, number> };
const markImpl = (o: { changed?: number; prev?: (i: number) => number | null; needed?: number } = {}) => async (input: MarkIn) => {
  const n = input.lineIds.length;
  const changed = o.changed ?? n;
  return {
    ok: true,
    data: {
      requested: n, changed, unchanged: n - changed, ordered: input.ordered,
      lines: input.lineIds.map((id, i) => {
        const needed = input.expected?.[id] ?? o.needed ?? 10;
        const prev = o.prev ? o.prev(i) : undefined;
        return {
          lineId: id, jobId: U(1), jobNo: "JB-0001", canonicalItemId: U(1), isOrdered: input.ordered, qtyNeededNow: needed, qtyOrdered: input.ordered ? needed : 0, qtyRemaining: input.ordered ? 0 : needed, qtyExcess: 0, changedAfterOrder: false,
          prevOrderedQty: input.ordered ? (prev === undefined ? null : prev) : prev === undefined ? needed : prev, newOrderedQty: input.ordered ? needed : null,
        };
      }),
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/jobs/gems-to-buy");
  A.markGemPurchase.mockImplementation(markImpl());
});

describe("🔴 ปุ่มย้อนกลับตัดสินจากผล server (security M1)", () => {
  it("ใบผสม: บางแถวเคยติ๊กไว้แล้ว (prev 70) ปนกับแถวใหม่ → ไม่มีปุ่มย้อน แม้ summary จะบอก isOrdered=false ทั้งใบ", async () => {
    const user = userEvent.setup();
    // ใบเดียว 2 line ของรายการเดียว (ใบผสม) — ข้อมูลระดับใบบอก isOrdered=false (bool_and) · ผล server บอกแถวที่ 2 เคยติ๊ก 70
    const mixed = G(1, [J(1, { lineIds: [U(2001)], qtyNeededNow: 10, qtyRemaining: 10 }), J(2, { lineIds: [U(2002)], qtyNeededNow: 20, qtyRemaining: 20 })]);
    A.markGemPurchase.mockImplementation(markImpl({ prev: (i) => (i === 1 ? 70 : null) }));
    mount(view([mixed]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(await screen.findByText(/ย้อนกลับด้วยปุ่มไม่ได้/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("ทุกแถว prev null = มีปุ่มย้อน → กด = ยกเลิกด้วย lineIds เดิม ไม่ส่ง expected", async () => {
    const user = userEvent.setup();
    mount(view([G1()]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    await user.click(await screen.findByRole("button", { name: "ย้อนกลับ" }));
    await waitFor(() => expect(A.markGemPurchase).toHaveBeenCalledTimes(2));
    expect(A.markGemPurchase.mock.calls[1][0]).toEqual({ lineIds: [U(2001), U(2002)], ordered: false });
  });
  it("ย้อนของการยกเลิก (ติ๊กใหม่) ส่ง expected = ยอดสดจากผล server ของแถวนั้น", async () => {
    const user = userEvent.setup();
    mount(view([G(1, [J(1, { qtyNeededNow: 10, qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })])]), "ordered");
    await user.click(table().getByRole("button", { name: /^ยกเลิกสั่งแล้ว — โกเมน/ }));
    await user.click(await screen.findByRole("button", { name: "ย้อนกลับ" }));
    await waitFor(() => expect(A.markGemPurchase).toHaveBeenCalledTimes(2));
    expect(A.markGemPurchase.mock.calls[1][0]).toEqual({ lineIds: [U(2001)], ordered: true, expected: { [U(2001)]: 10 } });
  });
  it("ยกเลิกแถวที่ยอดล้าง ≠ ยอดที่ต้องใช้ตอนนี้ (prev 70, ใช้ 90) = ไม่เสนอย้อน", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(async (i: MarkIn) => {
      const r = await markImpl({ prev: () => 70 })(i);
      return { ...r, data: { ...r.data, lines: r.data.lines.map((l) => ({ ...l, qtyNeededNow: 90 })) } };
    });
    mount(view([G(1, [J(1, { qtyNeededNow: 90, qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true })])]), "ordered");
    await user.click(table().getByRole("button", { name: /^ยกเลิกสั่งแล้ว — โกเมน/ }));
    expect(await screen.findByText(/ย้อนกลับด้วยปุ่มไม่ได้/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("N3: ข้อมูลหน้าโหลดใหม่ (rerender view ใหม่) ระหว่างรอ — toast ย้อนกลับยังใช้ได้ และยังยิงคำสั่งตรงข้ามด้วย lineIds เดิม", async () => {
    const user = userEvent.setup();
    const v1 = view([G1()]);
    const r = mount(v1);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    const undo = await screen.findByRole("button", { name: "ย้อนกลับ" });
    r.rerender(el(view([G2()]))); // หน้าโหลดใหม่ — แถวเดิมหายไปจากรายการ
    await user.click(undo);
    await waitFor(() => expect(A.markGemPurchase).toHaveBeenCalledTimes(2));
    expect(A.markGemPurchase.mock.calls[1][0]).toEqual({ lineIds: [U(2001), U(2002)], ordered: false });
  });
  it("N3: purchase_line_not_found (ไม่พบ/ขั้นฝังรับแล้ว) ตอนย้อน = แจ้ง 'มีรายการที่เปลี่ยนไป' + โหลดใหม่", async () => {
    const user = userEvent.setup();
    mount(view([G1()]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    const undo = await screen.findByRole("button", { name: "ย้อนกลับ" });
    A.markGemPurchase.mockResolvedValueOnce({ ok: false, error: "x", code: "purchase_line_not_found" });
    refresh.mockClear();
    await user.click(undo);
    expect(await screen.findByText(/มีรายการที่เปลี่ยนไป/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("🔴 expected ทุกครั้งที่ติ๊ก (security M2)", () => {
  it("ปุ่มแถว/ใบ/bulk ส่ง expected = qty_needed_now ต่อ line ที่จอเห็น (ไม่ใช่ยอดที่เหลือ)", async () => {
    const user = userEvent.setup();
    mount(view([G(1, [J(1, { qtyNeededNow: 90, qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true })]), G2()]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(A.markGemPurchase.mock.calls[0][0]).toEqual({ lineIds: [U(2001)], ordered: true, expected: { [U(2001)]: 90 } });
    await user.click(table().getByRole("checkbox", { name: "เลือก โกเมน · ไข่ · 4×6 มม." }));
    await user.click(table().getByRole("checkbox", { name: "เลือก ไพลิน · กลม · 2 มม." }));
    await user.click(screen.getByRole("button", { name: "สั่งแล้ว (2)" }));
    expect(A.markGemPurchase.mock.calls[1][0]).toEqual({ lineIds: [U(2001), U(2003)], ordered: true, expected: { [U(2001)]: 90, [U(2003)]: 120 } });
  });
  it("ยอดในระบบเปลี่ยน (qty_changed) = ล้มทั้งชุด ข้อความชัด + โหลดใหม่ · ไม่ลองซ้ำเอง", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockResolvedValue({ ok: false, error: "x", code: "qty_changed" });
    mount(view([G1()]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(await screen.findByText(MARK_QTY_CHANGED_MESSAGE)).toBeInTheDocument();
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });
  it("ใบที่มีหลาย line ของรายการเดียวกัน: ไม่มียอดต่อ line → ไม่ยิง (ไม่แบ่งยอดเดา) + บอกเหตุผล · ยกเลิกติ๊กยังทำได้", async () => {
    const user = userEvent.setup();
    const multi = G(1, [J(1, { lineIds: [U(2001), U(2101)], qtyNeededNow: 20, qtyRemaining: 20 })]);
    const r = mount(view([multi]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(A.markGemPurchase).not.toHaveBeenCalled();
    expect(await screen.findByText(MARK_MULTI_LINE_MESSAGE)).toBeInTheDocument();
    r.unmount();
    const ordered = G(1, [J(1, { lineIds: [U(2001), U(2101)], qtyNeededNow: 20, qtyOrdered: 20, qtyRemaining: 0, isOrdered: true })]);
    mount(view([ordered]), "ordered");
    await user.click(table().getByRole("button", { name: /^ยกเลิกสั่งแล้ว — โกเมน/ }));
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(A.markGemPurchase.mock.calls[0][0]).toEqual({ lineIds: [U(2001), U(2101)], ordered: false });
  });
});

describe("แถบถามหลังคัดลอก — snapshot / หมดอายุ / modal", () => {
  const clipSpy = () => vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  it("ติ๊กจากแถบใช้ expected ของ snapshot ตอนคัดลอก (ยอดที่ส่งร้านจริง)", async () => {
    const user = userEvent.setup();
    clipSpy();
    mount(view([G1(), G2()]));
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (2)" }));
    await user.click(await screen.findByRole("button", { name: "ทำเครื่องหมายว่าสั่งแล้ว (2)" }));
    expect(A.markGemPurchase.mock.calls[0][0]).toEqual({ lineIds: [U(2001), U(2002), U(2003)], ordered: true, expected: { [U(2001)]: 30, [U(2002)]: 40, [U(2003)]: 120 } });
  });
  it("qty_changed หลังคัดลอก: ข้อความ 'ยอดเปลี่ยนหลังคัดลอก — คัดลอกใหม่แล้วส่งร้านส่วนต่าง'", async () => {
    const user = userEvent.setup();
    clipSpy();
    mount(view([G1()]));
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (1)" }));
    A.markGemPurchase.mockResolvedValue({ ok: false, error: "x", code: "qty_changed" });
    await user.click(await screen.findByRole("button", { name: "ทำเครื่องหมายว่าสั่งแล้ว (1)" }));
    expect(await screen.findByText(MARK_QTY_CHANGED_AFTER_COPY_MESSAGE)).toBeInTheDocument();
  });
  it("ข้อมูลหน้าเปลี่ยน (view ใหม่) = แถบหายทันที (ยอดบนจอไม่ตรงกับที่คัดลอกแล้ว)", async () => {
    const user = userEvent.setup();
    clipSpy();
    const r = mount(view([G1()]));
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (1)" }));
    expect(await screen.findByText(/ส่งร้านพลอยแล้วใช่ไหม/)).toBeInTheDocument();
    r.rerender(el(view([G1()])));
    await waitFor(() => expect(screen.queryByText(/ส่งร้านพลอยแล้วใช่ไหม/)).not.toBeInTheDocument());
  });
  it("N9: คัดลอกไม่ได้ → ปิด modal 'คัดลอกเอง' แล้วแถบถามขึ้น (ใช้ snapshot ของที่แสดงใน modal)", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    mount(view([G1()]));
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (1)" }));
    const dlg = await screen.findByRole("dialog");
    expect(screen.queryByText(/ส่งร้านพลอยแล้วใช่ไหม/)).not.toBeInTheDocument();
    await user.click(within(dlg).getAllByRole("button", { name: "ปิด" }).at(-1) as HTMLElement);
    expect(await screen.findByText(/ส่งร้านพลอยแล้วใช่ไหม/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ทำเครื่องหมายว่าสั่งแล้ว (1)" }));
    expect(A.markGemPurchase.mock.calls[0][0]).toEqual({ lineIds: [U(2001), U(2002)], ordered: true, expected: { [U(2001)]: 30, [U(2002)]: 40 } });
  });
});

describe("removed_after_order — กลับมาเมื่อมีแถวเดียวกันที่ยังไม่สั่ง (review B1)", () => {
  const entry = { jobId: U(1001), jobNo: "JB-0001", canonicalItemId: U(1), label: "โกเมน · ไข่ · 4×6 มม.", qty: 70, removedAt: "2026-10-23T03:00:00+00:00" };
  it("เคยปิดไว้ แต่ใบนั้นมีรายการเดียวกันยังไม่สั่งในแท็บยังไม่สั่ง → โผล่ + ปิดไม่ได้ · chip เคยสั่งไว้ N เม็ดก่อนถูกลบที่บรรทัดใบ", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([removedKey(entry)]));
    mount(view([G1()], { removedAfterOrder: [entry] }));
    expect(await screen.findByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 1 รายการ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ปิดคำเตือนทั้งหมด" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ดูรายการ/ }));
    expect(screen.getByText(/ใบนี้มีรายการนี้ที่ยังไม่สั่งอยู่/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ปิดคำเตือน ใบ/ })).not.toBeInTheDocument();
    await user.click(table().getByRole("button", { name: /ดูใบ — โกเมน/ }));
    const line = table().getByRole("link", { name: "JB-0001" }).closest("li") as HTMLElement;
    expect(within(line).getByText(/เคยสั่งไว้ 70 เม็ดก่อนถูกลบ/)).toBeInTheDocument();
    const other = table().getByRole("link", { name: "JB-0002" }).closest("li") as HTMLElement;
    expect(within(other).queryByText(/เคยสั่งไว้/)).not.toBeInTheDocument();
  });
  it("ไม่มีแถวเดียวกันในแท็บยังไม่สั่ง → ที่ปิดไว้ยังซ่อนอยู่ตามเดิม", async () => {
    window.localStorage.setItem(REMOVED_DISMISSED_STORAGE_KEY, JSON.stringify([removedKey(entry)]));
    mount(view([G2()], { removedAfterOrder: [entry] }));
    expect(await screen.findByText(/ซ่อนคำเตือนสั่งซ้ำไว้ 1 รายการ/)).toBeInTheDocument();
  });
});

describe("🔴 ต้นทุน: print:hidden + ไม่โผล่เลขเก่า", () => {
  const costData = () => ({
    todayBkk: TODAY,
    groups: [
      { canonicalItemId: U(1), qtyRemaining: 70, qtyOrdered: 0, costRemainingThb: 7391.25, costOrderedThb: 0, missingPriceRemaining: false, missingPriceOrdered: false, missingPrice: false },
      { canonicalItemId: U(2), qtyRemaining: 120, qtyOrdered: 0, costRemainingThb: null, costOrderedThb: 0, missingPriceRemaining: true, missingPriceOrdered: false, missingPrice: true },
    ],
    totals: { groups: 2, groupsMissingPrice: 1, costRemainingThb: 7391.25, costOrderedThb: 0, complete: false },
  });
  it("หัวคอลัมน์ · เซลล์ · chip ไม่มีราคา · ยอดรวม ต้องมี print:hidden (Ctrl+P ตอนสวิตช์เปิดไม่พิมพ์ต้นทุน)", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    mount(view([G1(), G2()]));
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    const num = await table().findByText("7,391.25 ฿");
    expect(num.className).toMatch(/print:hidden/);
    expect(table().getByRole("columnheader", { name: /ต้นทุนประมาณ/ }).className).toMatch(/print:hidden/);
    expect(num.closest("td")?.className).toMatch(/print:hidden/);
    expect(table().getByText("ยังไม่มีราคา").closest("span.print\\:hidden")).not.toBeNull();
    expect(screen.getByTestId("gem-cost-totals").className).toMatch(/print:hidden/);
    // การ์ดมือถือ: บรรทัดต้นทุนก็ซ่อนตอนพิมพ์
    const cards = within(screen.getByTestId("gems-cards"));
    expect(cards.getAllByText(/ต้นทุนประมาณ \(ส่วนที่ยังไม่สั่ง\):/)[0].className).toMatch(/print:hidden/);
  });
  it("N5: ปิดสวิตช์แล้วเปิดใหม่ — ระหว่างรอ ไม่โผล่เลขของรอบก่อน (เห็น skeleton)", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValueOnce({ ok: true, data: costData() });
    mount(view([G1(), G2()]));
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(screen.queryByText("7,391.25 ฿")).not.toBeInTheDocument();
    A.getGemPurchaseCost.mockReturnValueOnce(new Promise(() => {})); // ไม่ resolve
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(screen.queryByText("7,391.25 ฿")).not.toBeInTheDocument();
    expect(table().getAllByRole("status", { name: "กำลังคำนวณต้นทุน" }).length).toBeGreaterThan(0);
  });
  it("สวิตช์ปิด: ไม่มีเลข/คอลัมน์ต้นทุนใน DOM และไม่เรียก action (จำค่า '0')", async () => {
    window.localStorage.setItem(COST_SWITCH_STORAGE_KEY, "0");
    mount(view([G1()]));
    await new Promise((r) => setTimeout(r, 20));
    expect(A.getGemPurchaseCost).not.toHaveBeenCalled();
    expect(document.body.textContent ?? "").not.toMatch(/฿/);
  });
});
