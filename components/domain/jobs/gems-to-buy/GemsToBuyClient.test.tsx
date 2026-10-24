// @vitest-environment jsdom
// /jobs/gems-to-buy (G1b UI) — state ครบ 4 · แท็บ ยังไม่สั่ง/สั่งแล้ว · เลือก ∩ ที่เห็น · คัดลอก (ไม่มีราคา) · ติ๊ก all-or-nothing · undo · >200 แถว · ต้นทุนเฉพาะเมื่อเปิดสวิตช์
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

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
import { GTB_EMPTY_FILTERS, MARK_CHANGED_MESSAGE, MARK_TOO_MANY_BULK_MESSAGE, MARK_TOO_MANY_GROUP_MESSAGE } from "@/lib/jobs/gems-to-buy";
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

// โกเมน ไข่ 4×6 (2 ใบ: เลยกำหนด 2 วัน + ปกติ) · ไพลิน กลม 2 (ไม่มีกำหนด) · ทับทิม กลม 1.5 (ครบใน 3 วัน)
const G1 = G(1, [J(1, { dueDate: "2026-10-22", qtyNeededNow: 30, qtyRemaining: 30 }), J(2, { dueDate: "2026-10-28", qtyNeededNow: 40, qtyRemaining: 40 })]);
const G2 = G(2, [J(3, { qtyNeededNow: 120, qtyRemaining: 120 })], { typeName: "ไพลิน", shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "ไพลิน · กลม · 2 มม." });
const G3 = G(3, [J(4, { dueDate: "2026-10-27", qtyNeededNow: 1050, qtyRemaining: 1050 })], { typeName: "ทับทิม", shapeName: "กลม", sizeA: 1.5, sizeB: null, sizeLabel: "1.5", label: "ทับทิม · กลม · 1.5 มม." });
const BASE = view([G1, G2, G3]);

const mount = (v: GemsToBuyView, tab: GtbTab = "pending") =>
  render(
    <ToastProvider>
      <GemsToBuyClient view={v} initialTab={tab} initialFilters={GTB_EMPTY_FILTERS} />
    </ToastProvider>,
  );
const table = () => within(screen.getByTestId("gems-table"));
const dataRows = () => table().getAllByRole("row").filter((r) => r.hasAttribute("aria-label"));
type MarkIn = { lineIds: string[]; ordered: boolean; expected?: Record<string, number> };
/** ผลของ gem_purchase_mark ตามรูปที่ DB ส่ง (lines ต่อแถวพร้อม prevOrderedQty/newOrderedQty) — prev: ยอดที่ติ๊กไว้ก่อนคำสั่ง (null = ไม่เคยติ๊ก) */
const markImpl = (o: { changed?: number; prev?: number | null } = {}) => async (input: MarkIn) => {
  const n = input.lineIds.length;
  const changed = o.changed ?? n;
  return {
    ok: true,
    data: {
      requested: n, changed, unchanged: n - changed, ordered: input.ordered,
      lines: input.lineIds.map((id) => {
        const needed = input.expected?.[id] ?? 10;
        return {
          lineId: id, jobId: U(1), jobNo: "JB-0001", canonicalItemId: U(1), isOrdered: input.ordered, qtyNeededNow: needed, qtyOrdered: input.ordered ? needed : 0, qtyRemaining: input.ordered ? 0 : needed, qtyExcess: 0, changedAfterOrder: false,
          prevOrderedQty: input.ordered ? (o.prev ?? null) : o.prev === undefined ? needed : o.prev, newOrderedQty: input.ordered ? needed : null,
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

describe("หน้า — success", () => {
  it("หัวหน้า · ข้อมูล ณ จาก server · บรรทัดคงที่ 'ต้องใช้ ไม่ใช่ต้องสั่ง' · แท็บมีเลขนับ", () => {
    mount(BASE);
    expect(screen.getByRole("heading", { name: "พลอยที่ต้องสั่งซื้อ" })).toBeInTheDocument();
    expect(screen.getByTestId("gtb-asof")).toHaveTextContent("ข้อมูล ณ 14:32 น.");
    expect(screen.getByText(/ยอดที่ใบงานต้องใช้ — ยังไม่หักพลอยที่มีในร้าน เทียบของที่มีก่อนสั่ง · ไม่เผื่อแตก/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ยังไม่สั่ง 3/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /สั่งแล้ว 0/ })).toHaveAttribute("aria-selected", "false");
  });
  it("หัวคอลัมน์ 'ต้องใช้ (เม็ด)' · ไม่มีคำว่า 'ต้องสั่ง' (นอกชื่อหน้า) · ไม่มีปุ่มพิมพ์", () => {
    mount(BASE);
    expect(table().getByRole("columnheader", { name: "ต้องใช้ (เม็ด)" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/ต้องสั่ง(?!ซื้อ)/);
    expect(screen.queryByRole("button", { name: /พิมพ์/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/ได้รับของ|ควรสั่งภายใน/)).not.toBeInTheDocument();
  });
  it("เรียงเร่งด่วน: เลยกำหนด → ครบใน 3 วัน → ไม่ระบุกำหนดท้ายสุด · ป้ายคู่คำ", () => {
    mount(BASE);
    const rows = table().getAllByRole("row").filter((r) => r.hasAttribute("aria-label"));
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["โกเมน · ไข่ · 4×6 มม.", "ทับทิม · กลม · 1.5 มม.", "ไพลิน · กลม · 2 มม."]);
    expect(within(rows[0]).getByText("เลยกำหนด 2 วัน")).toBeInTheDocument();
    expect(within(rows[1]).getByText("ครบใน 3 วัน")).toBeInTheDocument();
    expect(within(rows[2]).getByText("ไม่ระบุกำหนด")).toBeInTheDocument();
  });
  it("ตัวเลขหลักพัน · จำนวนใบ · นับรายการ/ใบ", () => {
    mount(BASE);
    expect(table().getByText("1,050")).toBeInTheDocument();
    expect(screen.getByTestId("gtb-count")).toHaveTextContent("3 รายการ · จาก 4 ใบ");
  });
  it("แถวสั่งไปแล้วบางส่วน: ต้องใช้ 70 + chip สั่งไปแล้ว 40 + ยังไม่สั่ง 30 (แยกกัน ไม่หักลบ)", () => {
    const g = G(1, [J(1, { qtyNeededNow: 40, qtyOrdered: 40, qtyRemaining: 0, isOrdered: true }), J(2, { qtyNeededNow: 30, qtyRemaining: 30 })]);
    mount(view([g]));
    const row = table().getByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." });
    expect(within(row).getByText("70")).toBeInTheDocument();
    expect(within(row).getByText("สั่งไปแล้ว 40")).toBeInTheDocument();
    expect(within(row).getByText("ยังไม่สั่ง 30")).toBeInTheDocument();
  });
  it("ทั้งตารางและการ์ด render ข้อมูลเดียวกัน (CSS ซ่อนตาม breakpoint)", () => {
    mount(BASE);
    expect(screen.getByTestId("gems-cards").querySelectorAll("li[aria-label]")).toHaveLength(3);
  });
});

describe("state: empty", () => {
  it("ว่างจริง = 'ไม่มีพลอยที่ต้องใช้ตอนนี้'", () => {
    mount(view([]));
    expect(screen.getByText("ไม่มีพลอยที่ต้องใช้ตอนนี้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /คัดลอก.*\(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /คัดลอกไปส่งร้านพลอย \(0\)/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("ไม่มีรายการให้คัดลอก")).toBeInTheDocument();
  });
  it("ว่างแต่มีใบยังไม่ระบุพลอย: กล่องเตือนอยู่ + ห้ามขึ้น 'ไม่ต้องสั่งอะไร'", async () => {
    const user = userEvent.setup();
    mount(view([], { unspecifiedJobs: [{ jobId: U(70), jobNo: "JB-0070", designLabel: "แหวนไพลิน", dueDate: "2026-10-30" }, { jobId: U(71), jobNo: "JB-0071", designLabel: null, dueDate: null }] }));
    expect(screen.getByText(/ใบที่ยังไม่ได้ใส่พลอย 2 ใบ — ยอดด้านล่างยังไม่รวมใบเหล่านี้/)).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรายการพลอยให้สั่ง")).toBeInTheDocument();
    expect(screen.getByText(/แต่มี 2 ใบที่ยังไม่ได้ใส่พลอย \(ดูด้านบน\)/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/ไม่ต้องสั่งอะไร|ไม่มีพลอยที่ต้องใช้ตอนนี้/);
    await user.click(screen.getByRole("button", { name: /ดูใบ/ }));
    const link = screen.getAllByRole("link", { name: /เปิดใบเพื่อใส่พลอย/ })[0];
    expect(link).toHaveAttribute("href", `/jobs/${U(70)}`);
  });
  it("กล่องใบไม่ระบุพลอยแสดงเหนือตารางที่มีรายการด้วย · 0 ใบ = ไม่ render", () => {
    const { unmount } = mount(view([G1], { unspecifiedJobs: [{ jobId: U(70), jobNo: "JB-0070", designLabel: null, dueDate: null }] }));
    expect(screen.getByText(/ใบที่ยังไม่ได้ใส่พลอย 1 ใบ/)).toBeInTheDocument();
    unmount();
    mount(view([G1]));
    expect(screen.queryByText(/ใบที่ยังไม่ได้ใส่พลอย/)).not.toBeInTheDocument();
  });
  it("สั่งครบแล้ว = 'สั่งครบแล้ว' + ปุ่มสลับไปแท็บสั่งแล้ว", async () => {
    const user = userEvent.setup();
    mount(view([G(1, [J(1, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })])]));
    expect(screen.getByText("สั่งครบแล้ว")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ดูรายการที่สั่งแล้ว" }));
    expect(screen.getByRole("tab", { name: /สั่งแล้ว 1/ })).toHaveAttribute("aria-selected", "true");
    expect(table().getByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." })).toBeInTheDocument();
  });
  it("แท็บสั่งแล้วว่าง", async () => {
    mount(BASE, "ordered");
    expect(screen.getByText("ยังไม่มีรายการที่ทำเครื่องหมายว่าสั่งแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /คัดลอก/ })).not.toBeInTheDocument();
  });
  it("กรองแล้วไม่เจอ = 'ไม่พบรายการที่ตรงกับตัวกรอง' + ล้างตัวกรอง", async () => {
    const user = userEvent.setup();
    mount(BASE);
    await user.type(screen.getByRole("searchbox", { name: "ค้นหาพลอย" }), "ไม่มีชื่อนี้");
    expect(screen.getByText("ไม่พบรายการที่ตรงกับตัวกรอง")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "ล้างตัวกรอง" })[0]);
    expect(dataRows()).toHaveLength(3);
  });
});

describe("กล่องเตือน: ติ๊กแล้วแต่รายการถูกลบ (กันสั่งซ้ำ)", () => {
  it("แสดงเหนือรายการเสมอ (ทั้งสองแท็บ) · กางดูใบ X เคยสั่ง N เม็ด", async () => {
    const user = userEvent.setup();
    mount(view([], { removedAfterOrder: [{ jobId: U(31), jobNo: "JB-0031", canonicalItemId: U(1), label: "โกเมน · ไข่ · 4×6 มม.", qty: 70, removedAt: "2026-10-24T03:00:00+00:00" }] }), "ordered");
    expect(screen.getByText(/เคยสั่งพลอยไว้แต่รายการถูกลบออกจากใบ 1 รายการ/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ดูรายการ/ }));
    const li = screen.getByText("JB-0031").closest("li");
    expect(li).toHaveTextContent("ใบ JB-0031 เคยสั่ง โกเมน · ไข่ · 4×6 มม. ไว้ 70 เม็ด แต่รายการถูกลบ");
    expect(within(li as HTMLElement).getByRole("link", { name: /เปิดใบ/ })).toHaveAttribute("href", `/jobs/${U(31)}`);
  });
});

describe("แถวกาง + ใบ", () => {
  it("กางแล้วเห็นเฉพาะใบที่ยังไม่สั่ง · ลิงก์ JB · มากกว่า 10 ใบ = ดูอีก n ใบ", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 12 }, (_, i) => J(i + 1, { qtyNeededNow: 5, qtyRemaining: 5 }));
    mount(view([G(1, [...jobs, J(99, { qtyOrdered: 5, qtyRemaining: 0, isOrdered: true })])]));
    await user.click(table().getByRole("button", { name: /ดูใบ — โกเมน/ }));
    expect(table().getByRole("link", { name: "JB-0001" })).toHaveAttribute("href", `/jobs/${U(1001)}`);
    expect(table().queryByRole("link", { name: "JB-0099" })).not.toBeInTheDocument();
    expect(table().queryByRole("link", { name: "JB-0012" })).not.toBeInTheDocument();
    await user.click(table().getByRole("button", { name: "ดูอีก 2 ใบ" }));
    expect(table().getByRole("link", { name: "JB-0012" })).toBeInTheDocument();
  });
  it("ใบที่ยอดเปลี่ยนหลังสั่ง: ป้าย 'ใบแก้จำนวนหลังสั่ง' + ยอดเดิม → ใหม่ + ที่เหลือแยกจากส่วนเกิน", async () => {
    const user = userEvent.setup();
    mount(view([G(1, [J(1, { qtyNeededNow: 90, qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true })])]));
    await user.click(table().getByRole("button", { name: /ดูใบ — โกเมน/ }));
    expect(table().getAllByText(/ใบแก้จำนวนหลังสั่ง/).length).toBeGreaterThan(0);
    expect(table().getByText("ใบแก้จำนวนหลังสั่ง: สั่งไว้ 70 → ตอนนี้ 90")).toBeInTheDocument();
    expect(table().getAllByText(/ยังไม่สั่ง/).length).toBeGreaterThan(0);
  });
});

describe("แท็บ สั่งแล้ว", () => {
  const ordered = view([
    G(1, [J(1, { qtyNeededNow: 50, qtyOrdered: 70, qtyRemaining: 0, qtyExcess: 20, isOrdered: true, orderedAt: "2026-10-22T07:05:00+00:00", orderedBy: "me" }), J(2, { qtyNeededNow: 10, qtyOrdered: 10, qtyRemaining: 0, isOrdered: true, orderedAt: "2026-10-23T03:00:00+00:00", orderedBy: "other" })]),
    G(2, [J(3)], { typeName: "ไพลิน", shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "ไพลิน · กลม · 2 มม." }),
  ]);
  it("แสดงเฉพาะรายการที่สั่งแล้ว · ยอด 'สั่งไว้' · ส่วนเกินแสดงแยก · ไม่มีปุ่มคัดลอก/พิมพ์/คอลัมน์ต้นทุน", async () => {
    const user = userEvent.setup();
    mount(ordered);
    await user.click(screen.getByRole("tab", { name: /สั่งแล้ว 1/ }));
    expect(table().getByRole("columnheader", { name: "สั่งไว้ (เม็ด)" })).toBeInTheDocument();
    expect(table().queryByRole("row", { name: "ไพลิน · กลม · 2 มม." })).not.toBeInTheDocument();
    const row = table().getByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." });
    expect(within(row).getByText("80")).toBeInTheDocument(); // 70 + 10 จาก DB (qtyOrdered ของกลุ่ม)
    expect(within(row).getByText("สั่งเกินที่ใช้ตอนนี้ 20")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /คัดลอก/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ต้นทุนประมาณ")).not.toBeInTheDocument();
  });
  it("แถวกาง: สั่งไว้ · ตอนนี้ใช้ (เกิน) · สั่งเมื่อ · โดยคุณ/โดยคนอื่น (ไม่มีอีเมล/uuid)", async () => {
    const user = userEvent.setup();
    mount(ordered, "ordered");
    await user.click(table().getByRole("button", { name: /ดูใบ — โกเมน/ }));
    expect(table().getByText(/ตอนนี้ใช้ 50 \(เกิน 20\)/)).toBeInTheDocument();
    expect(table().getByText(/สั่งเมื่อ .* · โดยคุณ/)).toBeInTheDocument();
    expect(table().getByText(/สั่งเมื่อ .* · โดยคนอื่น/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
  it("ยกเลิกสั่งแล้ว (n) เมื่อเลือก → markGemPurchase ordered:false ด้วย lineIds ของแถวที่เลือก", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl());
    mount(ordered, "ordered");
    await user.click(table().getByRole("checkbox", { name: "เลือก โกเมน · ไข่ · 4×6 มม." }));
    await user.click(screen.getByRole("button", { name: "ยกเลิกสั่งแล้ว (1)" }));
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(A.markGemPurchase).toHaveBeenCalledWith({ lineIds: [U(2001), U(2002)], ordered: false });
  });
});

describe("ติ๊ก 'สั่งแล้ว' + ย้อนกลับ", () => {
  it("ปุ่มระดับรายการ → lineIds ของใบที่ยังไม่สั่งเท่านั้น · ไม่มีกล่องยืนยัน · toast พร้อมปุ่มย้อนกลับ · โหลดข้อมูลใหม่", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl());
    mount(BASE);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน · ไข่ · 4×6 มม\./ }));
    expect(A.markGemPurchase).toHaveBeenCalledWith({ lineIds: [U(2001), U(2002)], ordered: true, expected: { [U(2001)]: 30, [U(2002)]: 40 } });
    expect(await screen.findByText(/ทำเครื่องหมายสั่งแล้ว: โกเมน · ไข่ · 4×6 มม\. \(2 ใบ\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ย้อนกลับ" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("ย้อนกลับ = คำสั่งตรงข้ามด้วย lineIds เดิม (ไม่ใช่ 'undo ล่าสุด') แล้วมี toast ย้อนของการย้อน", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl());
    mount(BASE);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน · ไข่ · 4×6 มม\./ }));
    await user.click(await screen.findByRole("button", { name: "ย้อนกลับ" }));
    await waitFor(() => expect(A.markGemPurchase).toHaveBeenCalledTimes(2));
    expect(A.markGemPurchase).toHaveBeenNthCalledWith(2, { lineIds: [U(2001), U(2002)], ordered: false });
    expect(await screen.findByText(/ยกเลิกสั่งแล้ว: โกเมน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ย้อนกลับ" })).toBeInTheDocument();
  });
  it("ปุ่มระดับใบ → lineIds ของใบนั้นใบเดียว", async () => {
    const user = userEvent.setup();
    mount(BASE);
    await user.click(table().getByRole("button", { name: /ดูใบ — โกเมน/ }));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — JB-0002/ }));
    expect(A.markGemPurchase).toHaveBeenCalledWith({ lineIds: [U(2002)], ordered: true, expected: { [U(2002)]: 40 } });
  });
  it("ติ๊กซ้ำใบที่ยอดเปลี่ยนหลังสั่ง (server บอก prev 70): ไม่เสนอปุ่มย้อนกลับ (ยกเลิกจะได้ 0 ไม่ใช่ยอดเดิม → สั่งซ้ำ) + บอกเหตุผล · ตัดสินจากผล server", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl({ prev: 70 }));
    mount(view([G(1, [J(1, { qtyNeededNow: 90, qtyOrdered: 70, qtyRemaining: 20, isOrdered: true, changedAfterOrder: true })])]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน · ไข่ · 4×6 มม\./ }));
    expect(await screen.findByText(/ย้อนกลับด้วยปุ่มไม่ได้/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("คนอื่นติ๊กไว้แล้ว (changed 0) = ไม่ error · บอกว่ามีคนทำไว้ · ไม่เสนอย้อน (ไม่แตะของคนอื่น)", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl({ changed: 0 }));
    mount(BASE);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน · ไข่ · 4×6 มม\./ }));
    expect(await screen.findByText(/มีคนทำไว้แล้ว ไม่มีอะไรเปลี่ยน/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("เปลี่ยนไม่ครบทุกแถว (บางแถวคนอื่นทำไว้) = ไม่เสนอย้อน", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl({ changed: 1 }));
    mount(BASE);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน · ไข่ · 4×6 มม\./ }));
    await screen.findByText(/ทำเครื่องหมายสั่งแล้ว: โกเมน/);
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("🔴 all-or-nothing ล้ม (ขั้นฝังรับแล้ว/ใบปิด/ไม่พบ) = แจ้ง + โหลดใหม่ · ยิงครั้งเดียว ไม่ข้ามแถวแล้วติ๊กที่เหลือ", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockResolvedValue({ ok: false, error: "x", code: "gem_stage_started" });
    mount(BASE);
    await user.click(table().getByRole("checkbox", { name: "เลือก โกเมน · ไข่ · 4×6 มม." }));
    await user.click(table().getByRole("checkbox", { name: "เลือก ไพลิน · กลม · 2 มม." }));
    await user.click(screen.getByRole("button", { name: "สั่งแล้ว (2)" }));
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(MARK_CHANGED_MESSAGE)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).not.toBeInTheDocument();
  });
  it("error อื่น/exception = 'บันทึกไม่สำเร็จ ลองอีกครั้ง' · ไม่แสดงรหัส DB", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockRejectedValue(new Error("boom: relation analytics.job_gem_bom"));
    mount(BASE);
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — ไพลิน/ }));
    expect(await screen.findByText("บันทึกไม่สำเร็จ ลองอีกครั้ง")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/analytics|boom/);
  });
  it("🔴 กลุ่ม line_ids > 200: ไม่ยิง action (ห้ามแบ่งหลายรอบ) · ขึ้นข้อความให้ติ๊กทีละใบ", async () => {
    const user = userEvent.setup();
    const jobs = Array.from({ length: 201 }, (_, i) => J(i + 1, { qtyNeededNow: 1, qtyRemaining: 1 }));
    mount(view([G(1, jobs)]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(A.markGemPurchase).not.toHaveBeenCalled();
    expect(await screen.findByText(MARK_TOO_MANY_GROUP_MESSAGE)).toBeInTheDocument();
  });
  it("ติ๊กพอดี 200 แถว = ยิงครั้งเดียว", async () => {
    const user = userEvent.setup();
    A.markGemPurchase.mockImplementation(markImpl());
    const jobs = Array.from({ length: 200 }, (_, i) => J(i + 1, { qtyNeededNow: 1, qtyRemaining: 1 }));
    mount(view([G(1, jobs)]));
    await user.click(table().getByRole("button", { name: /^สั่งแล้ว — โกเมน/ }));
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(A.markGemPurchase.mock.calls[0][0].lineIds).toHaveLength(200);
  });
  it("เลือกหลายรายการรวมเกิน 200 แถว = ไม่ยิง · ขึ้นข้อความ", async () => {
    const user = userEvent.setup();
    const a = G(1, Array.from({ length: 120 }, (_, i) => J(i + 1, { qtyNeededNow: 1, qtyRemaining: 1 })));
    const b = G(2, Array.from({ length: 120 }, (_, i) => J(i + 500, { qtyNeededNow: 1, qtyRemaining: 1 })), { typeName: "ไพลิน", label: "ไพลิน · ไข่ · 4×6 มม." });
    mount(view([a, b]));
    await user.click(screen.getByRole("checkbox", { name: "เลือกที่เห็นทั้งหมด" }));
    await user.click(screen.getByRole("button", { name: "สั่งแล้ว (2)" }));
    expect(A.markGemPurchase).not.toHaveBeenCalled();
    expect(await screen.findByText(MARK_TOO_MANY_BULK_MESSAGE)).toBeInTheDocument();
  });
  it("ไม่มีปุ่ม 'สั่งแล้วทั้งหมด' — 'สั่งแล้ว (n)' มีเฉพาะเมื่อเลือก", async () => {
    const user = userEvent.setup();
    mount(BASE);
    expect(screen.queryByRole("button", { name: /^สั่งแล้ว \(/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /สั่งแล้วทั้งหมด/ })).not.toBeInTheDocument();
    await user.click(table().getByRole("checkbox", { name: "เลือก ไพลิน · กลม · 2 มม." }));
    expect(screen.getByRole("button", { name: "สั่งแล้ว (1)" })).toBeInTheDocument();
  });
});

describe("คัดลอก — scope + ไม่มีราคา", () => {
  const clipSpy = () => vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  it("ไม่เลือก/ไม่กรอง: คัดลอกทั้งหมด · ข้อความตามรูปแบบ · มีวันที่ทำรายการจาก DB · ยอด = ยังไม่สั่ง · แล้วถามว่าส่งแล้วหรือยัง", async () => {
    const user = userEvent.setup();
    const spy = clipSpy();
    mount(BASE);
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const text = spy.mock.calls[0][0];
    expect(text.split("\n")[0]).toBe("รายการสั่งซื้อพลอย · 24 ต.ค. 69");
    expect(text).toContain("- ไข่ 4×6 มม. 70 เม็ด");
    expect(text).toContain("- กลม 1.5 มม. 1,050 เม็ด");
    expect(text).toContain("- กลม 2 มม. 120 เม็ด");
    expect(text).toContain("รวม 3 รายการ");
    expect(text).not.toMatch(/บาท|฿|ราคา|ต้นทุน|JB-/);
    expect(await screen.findByText("คัดลอก 3 รายการแล้ว — ส่งร้านพลอยแล้วใช่ไหม?")).toBeInTheDocument();
    // ไม่ติ๊กให้อัตโนมัติ (คัดลอก ≠ ส่งแล้ว)
    expect(A.markGemPurchase).not.toHaveBeenCalled();
  });
  it("ยอดที่คัดลอกของรายการที่สั่งไปบางส่วน = ส่วนที่ยังไม่สั่ง (30 ไม่ใช่ 70)", async () => {
    const user = userEvent.setup();
    const spy = clipSpy();
    const g = G(1, [J(1, { qtyNeededNow: 40, qtyOrdered: 40, qtyRemaining: 0, isOrdered: true }), J(2, { qtyNeededNow: 30, qtyRemaining: 30 })]);
    mount(view([g]));
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (1)" }));
    expect(spy.mock.calls[0][0]).toContain("- ไข่ 4×6 มม. 30 เม็ด");
    expect(spy.mock.calls[0][0]).not.toContain("70");
  });
  it("🔴 เปิดสวิตช์ต้นทุนอยู่ + ทุกรายการมีราคา: ข้อความคัดลอกก็ไม่มีเลขต้นทุนจริงของรายการใด", async () => {
    const user = userEvent.setup();
    const spy = clipSpy();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    window.localStorage.setItem(COST_SWITCH_STORAGE_KEY, "1");
    mount(BASE);
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    const text = spy.mock.calls[0][0];
    for (const price of ["7391", "7,391", "2608", "10000", "10,000", "9999"]) expect(text).not.toContain(price);
  });
  it("ตามตัวกรอง: ปุ่มบอก 'n จาก N' · ข้อความมีเฉพาะที่เห็น", async () => {
    const user = userEvent.setup();
    const spy = clipSpy();
    mount(BASE);
    await user.selectOptions(screen.getByRole("combobox", { name: "กรองตามชนิด" }), U(102));
    await user.click(screen.getByRole("button", { name: "คัดลอกตามตัวกรอง (1 จาก 3)" }));
    const text = spy.mock.calls[0][0];
    expect(text).toContain("ไพลิน");
    expect(text).not.toContain("โกเมน");
    expect(text).not.toContain("ทับทิม");
    expect(await screen.findByText("คัดลอก 1 จาก 3 รายการ (ตามตัวกรอง)")).toBeInTheDocument();
  });
  it("เลือกแล้วค่อยกรอง: รายการที่เลือกแต่ถูกซ่อนไม่ถูกคัดลอก/ไม่ถูกติ๊ก", async () => {
    const user = userEvent.setup();
    const spy = clipSpy();
    mount(BASE);
    await user.click(table().getByRole("checkbox", { name: "เลือก ไพลิน · กลม · 2 มม." }));
    await user.click(table().getByRole("checkbox", { name: "เลือก ทับทิม · กลม · 1.5 มม." }));
    await user.selectOptions(screen.getByRole("combobox", { name: "กรองตามชนิด" }), U(102)); // เห็นเฉพาะไพลิน
    expect(screen.getByRole("button", { name: "คัดลอกที่เลือก (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "คัดลอกที่เลือก (1)" }));
    expect(spy.mock.calls[0][0]).not.toContain("ทับทิม");
    await user.click(screen.getByRole("button", { name: "สั่งแล้ว (1)" }));
    expect(A.markGemPurchase).toHaveBeenCalledWith({ lineIds: [U(2003)], ordered: true, expected: { [U(2003)]: 120 } });
  });
  it("nudge: 'ทำเครื่องหมายว่าสั่งแล้ว (n)' ใช้ชุดรายการเดียวกับที่เพิ่งคัดลอก (ไม่ใช่ที่เลือกตอนนี้) · 'ยังไม่ได้ส่ง' ปิดแถบ", async () => {
    const user = userEvent.setup();
    clipSpy();
    mount(BASE);
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    await user.click(table().getByRole("checkbox", { name: "เลือก ไพลิน · กลม · 2 มม." })); // เลือกอีกอย่างหลังคัดลอก
    await user.click(await screen.findByRole("button", { name: "ทำเครื่องหมายว่าสั่งแล้ว (3)" }));
    expect(A.markGemPurchase).toHaveBeenCalledTimes(1);
    expect(new Set(A.markGemPurchase.mock.calls[0][0].lineIds)).toEqual(new Set([U(2001), U(2002), U(2003), U(2004)]));
    expect(A.markGemPurchase.mock.calls[0][0].ordered).toBe(true);
  });
  it("nudge ปิดด้วย 'ยังไม่ได้ส่ง' · และหายเมื่อเปลี่ยนตัวกรอง", async () => {
    const user = userEvent.setup();
    clipSpy();
    mount(BASE);
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    await user.click(await screen.findByRole("button", { name: "ยังไม่ได้ส่ง" }));
    expect(screen.queryByText(/ส่งร้านพลอยแล้วใช่ไหม/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    await screen.findByText(/ส่งร้านพลอยแล้วใช่ไหม/);
    await user.type(screen.getByRole("searchbox", { name: "ค้นหาพลอย" }), "ไพ");
    expect(screen.queryByText(/ส่งร้านพลอยแล้วใช่ไหม/)).not.toBeInTheDocument();
  });
  it("คัดลอกไม่ได้ (clipboard ถูกบล็อก) → Modal 'คัดลอกเอง' มี textarea ข้อความเดียวกัน · ยังไม่ถามว่าส่งแล้ว", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    mount(BASE);
    await user.click(screen.getByRole("button", { name: "คัดลอกไปส่งร้านพลอย (3)" }));
    const dlg = await screen.findByRole("dialog");
    const ta = within(dlg).getByRole("textbox", { name: "ข้อความรายการสั่งซื้อพลอย" }) as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
    expect(ta.value).toContain("รายการสั่งซื้อพลอย · 24 ต.ค. 69");
    expect(ta.value).not.toMatch(/บาท|฿|ราคา|ต้นทุน/);
    expect(screen.queryByText(/ส่งร้านพลอยแล้วใช่ไหม/)).not.toBeInTheDocument();
    await user.click(within(dlg).getAllByRole("button", { name: "ปิด" }).at(-1) as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function costData(o: { missingId?: string } = {}) {
  const g = (n: number, qty: number, cost: number | null) => ({ canonicalItemId: U(n), qtyRemaining: qty, qtyOrdered: 0, costRemainingThb: cost, costOrderedThb: 0, missingPriceRemaining: cost === null, missingPriceOrdered: false, missingPrice: cost === null });
  void o;
  // ยอดรวมของ DB ตั้งให้ "ไม่เท่า" ผลบวกแถว เพื่อพิสูจน์ว่าจอแสดงของ DB ไม่บวกเอง (7391.25 + 2608.74 = 9999.99 ≠ 10000.00)
  return { todayBkk: TODAY, groups: [g(1, 70, 7391.25), g(2, 120, 2608.74), g(3, 1050, 0.01)], totals: { groups: 3, groupsMissingPrice: 0, costRemainingThb: 10000, costOrderedThb: 0, complete: true } };
}
const costWithMissing = () => {
  const d = costData();
  return { ...d, groups: d.groups.map((x) => (x.canonicalItemId === U(2) ? { ...x, costRemainingThb: null, missingPriceRemaining: true, missingPrice: true } : x)), totals: { ...d.totals, groupsMissingPrice: 1, costRemainingThb: 7391.26, complete: false } };
};

describe("🔴 ต้นทุนประมาณ", () => {
  it("สวิตช์ปิดเป็นค่าเริ่ม: ไม่เรียก getGemPurchaseCost เลย · DOM ไม่มีเลขเงิน/฿", async () => {
    mount(BASE);
    await new Promise((r) => setTimeout(r, 30));
    expect(A.getGemPurchaseCost).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "ต้นทุนประมาณ" })).toHaveAttribute("aria-checked", "false");
    expect(document.body.textContent ?? "").not.toMatch(/฿|บาท/);
    expect(screen.queryByRole("columnheader", { name: /ต้นทุน/ })).not.toBeInTheDocument();
  });
  it("เปิดสวิตช์ → เรียกครั้งเดียว · แสดงเลขของ DB ตรงๆ · ยอดรวม = totals ของ DB (ไม่บวกเอง) · จำค่าไว้", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
    expect(A.getGemPurchaseCost).toHaveBeenCalledTimes(1);
    expect(table().getByText("2,608.74 ฿")).toBeInTheDocument();
    expect(table().getByText("0.01 ฿")).toBeInTheDocument();
    const totals = screen.getByTestId("gem-cost-totals");
    expect(totals).toHaveTextContent("10,000.00 ฿");
    expect(totals).not.toHaveTextContent("9,999.99");
    expect(totals).toHaveTextContent("ต้นทุนประมาณรวม (ส่วนที่ยังไม่สั่ง)");
    expect(window.localStorage.getItem(COST_SWITCH_STORAGE_KEY)).toBe("1");
  });
  it("จำค่า: เปิดไว้จากครั้งก่อน → โหลดเมื่อเข้าหน้า · ปิดแล้วเลขหายและจำว่าปิด", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    window.localStorage.setItem(COST_SWITCH_STORAGE_KEY, "1");
    mount(BASE);
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(screen.queryByText("7,391.25 ฿")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(COST_SWITCH_STORAGE_KEY)).toBe("0");
  });
  it("localStorage ใช้ไม่ได้ (throw) → ไม่พัง · ปิดไว้ · สวิตช์ยังเปิดได้ในรอบนี้", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount(BASE);
    expect(screen.getByRole("switch", { name: "ต้นทุนประมาณ" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
  it("ไม่มีราคา = chip 'ยังไม่มีราคา' + ลิงก์ตั้งราคาเปิดแท็บใหม่ (ไม่ใช่ 0/—) · ยอดรวม 'เฉพาะรายการที่มีราคา' + ไม่รวม n จาก N", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costWithMissing() });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    const row = await waitFor(() => table().getByRole("row", { name: "ไพลิน · กลม · 2 มม." }));
    await waitFor(() => expect(within(row).getByText("ยังไม่มีราคา")).toBeInTheDocument());
    const link = within(row).getByRole("link", { name: /ตั้งราคา/ });
    expect(link).toHaveAttribute("href", "/oem/gems");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(row).queryByText(/^0(\.00)?\s*฿/)).not.toBeInTheDocument();
    const totals = screen.getByTestId("gem-cost-totals");
    expect(totals).toHaveTextContent("ต้นทุนประมาณ (เฉพาะรายการที่มีราคา)");
    expect(totals).toHaveTextContent("ไม่รวม 1 จาก 3 รายการที่ยังไม่มีราคา");
    expect(totals.textContent).not.toMatch(/รวมต้นทุน/);
  });
  it("ทุกรายการไม่มีราคา = ไม่โชว์ยอดรวม 0 (บอกว่ายังไม่มีราคาสักรายการ)", async () => {
    const user = userEvent.setup();
    const d = costData();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: { ...d, groups: d.groups.map((x) => ({ ...x, costRemainingThb: null, missingPriceRemaining: true, missingPrice: true })), totals: { ...d.totals, costRemainingThb: 0, groupsMissingPrice: 3, complete: false } } });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    const totals = await screen.findByTestId("gem-cost-totals");
    expect(totals).toHaveTextContent("ยังไม่มีราคาสักรายการ");
    expect(totals.textContent).not.toMatch(/0\.00/);
  });
  it("โหลดต้นทุนล้ม = ErrorBanner 'โหลดต้นทุนไม่ได้' + เซลล์ 'โหลดไม่ได้' (ไม่ใช่ 0/ว่าง) + ลองใหม่", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValueOnce({ ok: false, error: "x" });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(await screen.findByText("โหลดต้นทุนไม่ได้")).toBeInTheDocument();
    expect(table().getAllByText("โหลดไม่ได้")).toHaveLength(3);
    A.getGemPurchaseCost.mockResolvedValueOnce({ ok: true, data: costData() });
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
  });
  it("ระหว่างโหลด = skeleton + สถานะ 'กำลังคำนวณต้นทุน' (ไม่แสดงเลขเก่า)", async () => {
    const user = userEvent.setup();
    let resolve: (v: unknown) => void = () => {};
    A.getGemPurchaseCost.mockReturnValue(new Promise((r) => (resolve = r)));
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    expect(table().getAllByRole("status", { name: "กำลังคำนวณต้นทุน" }).length).toBe(3);
    resolve({ ok: true, data: costData() });
    expect(await table().findByText("7,391.25 ฿")).toBeInTheDocument();
  });
  it("ต้นทุนที่ qty ไม่ตรงกับยอดบนจอ (สองชุดมาต่างเวลา) = ไม่แสดงเลข", async () => {
    const user = userEvent.setup();
    const d = costData();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: { ...d, groups: d.groups.map((x) => (x.canonicalItemId === U(1) ? { ...x, qtyRemaining: 999 } : x)) } });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    await table().findByText("2,608.74 ฿");
    expect(screen.queryByText("7,391.25 ฿")).not.toBeInTheDocument();
    expect(table().getByText(/ต้นทุนยังไม่อัปเดต/)).toBeInTheDocument();
  });
  it("มีตัวกรอง: ยอดรวมบอกว่านับทุกรายการ ไม่ตามตัวกรอง", async () => {
    const user = userEvent.setup();
    A.getGemPurchaseCost.mockResolvedValue({ ok: true, data: costData() });
    mount(BASE);
    await user.click(screen.getByRole("switch", { name: "ต้นทุนประมาณ" }));
    await table().findByText("7,391.25 ฿");
    await user.selectOptions(screen.getByRole("combobox", { name: "กรองตามชนิด" }), U(102));
    expect(screen.getByTestId("gem-cost-totals")).toHaveTextContent("ไม่ตามตัวกรอง");
  });
  it("แท็บสั่งแล้ว: ไม่มีสวิตช์/คอลัมน์ต้นทุน และไม่เรียก action", async () => {
    mount(view([G(1, [J(1, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })])]), "ordered");
    expect(screen.queryByRole("switch", { name: "ต้นทุนประมาณ" })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(A.getGemPurchaseCost).not.toHaveBeenCalled();
  });
});

describe("แท็บ + URL + แป้นพิมพ์", () => {
  it("ลูกศรขวา/ซ้าย/Home/End สลับแท็บ · roving tabindex · aria-controls", async () => {
    const user = userEvent.setup();
    mount(BASE);
    const t1 = screen.getByRole("tab", { name: /ยังไม่สั่ง/ });
    const t2 = screen.getByRole("tab", { name: /สั่งแล้ว/ });
    expect(t1).toHaveAttribute("tabindex", "0");
    expect(t2).toHaveAttribute("tabindex", "-1");
    t1.focus();
    await user.keyboard("{ArrowRight}");
    expect(t2).toHaveAttribute("aria-selected", "true");
    expect(t2).toHaveFocus();
    await user.keyboard("{Home}");
    expect(t1).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(t2).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "gtb-tab-ordered");
  });
  it("แท็บ+ตัวกรองเก็บใน URL (replaceState) · ค่าเริ่มไม่อยู่ใน URL", async () => {
    const user = userEvent.setup();
    mount(BASE);
    expect(window.location.search).toBe("");
    await user.type(screen.getByRole("searchbox", { name: "ค้นหาพลอย" }), "ไพ");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("ไพ");
    await user.click(screen.getByRole("tab", { name: /สั่งแล้ว/ }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("ordered");
    await user.click(screen.getByRole("tab", { name: /ยังไม่สั่ง/ }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
  });
  it("เปิดจาก URL: initialFilters ใช้ได้ (เร่งด่วน)", () => {
    render(
      <ToastProvider>
        <GemsToBuyClient view={BASE} initialTab="pending" initialFilters={{ ...GTB_EMPTY_FILTERS, urgent: true }} />
      </ToastProvider>,
    );
    expect(dataRows()).toHaveLength(2); // ไม่ระบุกำหนดไม่นับเป็นเร่งด่วน
    expect(screen.getByRole("button", { name: /เร่งด่วน 2/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("เปลี่ยนแท็บล้างที่เลือก (กัน 'ติ๊กของที่มองไม่เห็น')", async () => {
    const user = userEvent.setup();
    mount(view([G1, G(2, [J(3, { qtyOrdered: 10, qtyRemaining: 0, isOrdered: true })], { typeName: "ไพลิน", shapeName: "กลม", sizeA: 2, sizeB: null, sizeLabel: "2", label: "ไพลิน · กลม · 2 มม." })]));
    await user.click(table().getByRole("checkbox", { name: "เลือก โกเมน · ไข่ · 4×6 มม." }));
    expect(screen.getByRole("button", { name: "สั่งแล้ว (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /สั่งแล้ว/ }));
    await user.click(screen.getByRole("tab", { name: /ยังไม่สั่ง/ }));
    expect(screen.queryByRole("button", { name: /^สั่งแล้ว \(/ })).not.toBeInTheDocument();
  });
});
