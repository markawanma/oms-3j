// @vitest-environment jsdom
// ProductionOrderDetailClient (PM-B · UX A.2): การ์ดรายการ + เช็คลิสต์ก่อนผลิตเสร็จ + ปุ่ม aria-disabled + beforeunload + 4 state
//  ต้องถูก: ข้อติดครบ 4 ข้อ (แก้ค้างยังไม่บันทึก · ไม่มี SKU · น้ำหนักขาด spot/spec · ไม่มีรายการ) · aria-disabled พร้อมเหตุผล · กดตอนติด = พาไปเช็คลิสต์ ไม่เปิด dialog
//  ต้องไม่พัง: ใบปกติ (เงินเดิม) ไม่มีเช็คลิสต์ กดผลิตเสร็จเปิด dialog ได้ · ใบ done/cancelled อ่านอย่างเดียว ไม่มีเช็คลิสต์/ปุ่ม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const removeById = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: vi.fn(),
  removeProductionOrderItemById: (...a: unknown[]) => removeById(...a),
  saveProductionOrder: vi.fn(),
  previewProductionOrder: vi.fn(() => new Promise(() => {})),
  doneProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  getProductionItemPrefill: vi.fn(),
}));
vi.mock("@/lib/actions/catalog-sku", () => ({ listSkuPrefixes: () => Promise.resolve({ ok: true, data: [] }), createCatalogSku: vi.fn() }));
vi.mock("@/lib/actions/oem", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionOrderDetailClient } from "./ProductionOrderDetailClient";

beforeEach(() => {
  refresh.mockReset();
  removeById.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const baseOrder: ProductionOrderRow = {
  id: "po-1", poNo: "PO-0034", status: "open", note: null, spotOverrideThbPerGram: null, doneAt: null, cancelledAt: null, cancelReason: null,
  createdAt: "2026-10-20T02:12:00Z", updatedAt: "2026-10-20T02:12:00Z", itemCount: 1, qtyPlannedTotal: 30, qtyDoneTotal: 0, unboundItemCount: 0, openedVia: "office", openedByWorkerName: null, acknowledgedAt: null,
};

function row(over: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow {
  return {
    id: "i-1", productionOrderId: "po-1", poNo: "PO-0034", orderStatus: "open", productId: "p-1", sku: "GR-0007", productName: "แหวนลายใบไม้", pendingProductLabel: null,
    currentCostType: "fixed", currentUnitCost: 120, metal: null, purity: null, weightG: null, weightSource: null,
    effectiveMetal: "silver", effectivePurity: 0.925, effectiveWeightG: 3.2, effectiveWeightSource: "product",
    skuMetal: "silver", skuPurity: 0.925, skuWeightG: 3.2, skuMetalKnown: false, metalMismatch: false, qtyPlanned: 30, qtyDone: null, stampedUnitCost: null, prevCostType: null, prevUnitCost: null,
    createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", makeSpec: null, currentSilverWeightG: 3.2, currentSilverPurity: 0.925, isNewDesign: false, costCalc: null, ...over,
  };
}

const noSku = (over: Partial<ProductionOrderItemRow> = {}) =>
  row({ id: "i-ns", productId: null, sku: null, productName: null, pendingProductLabel: "แหวนลายใบไม้ทดลอง", currentCostType: null, currentUnitCost: null, skuMetal: null, skuPurity: null, skuWeightG: null, effectiveWeightG: null, effectiveWeightSource: null, ...over });

function renderPage(items: ProductionOrderItemRow[], order: Partial<ProductionOrderRow> = {}, extra: { activeJobs?: Record<string, string> } = {}) {
  return render(
    <ToastProvider>
      <ProductionOrderDetailClient order={{ ...baseOrder, ...order }} items={items} skuOptions={[]} skuOptionsError={null} {...extra} />
    </ToastProvider>
  );
}

const doneBtn = () => screen.getByRole("button", { name: "ผลิตเสร็จ" });

describe("ใบปกติ (เงินเดิม) — ต้องไม่พัง", () => {
  it("ไม่มีเช็คลิสต์ · ปุ่มผลิตเสร็จไม่ aria-disabled · กดเปิด dialog ยืนยัน", async () => {
    renderPage([row()]);
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
    expect(doneBtn()).not.toHaveAttribute("aria-disabled");
    await userEvent.click(doneBtn());
    expect(await screen.findByText(/ยืนยันผลิตเสร็จ — PO-0034/)).toBeInTheDocument();
  });

  it("รายการแสดงเป็นการ์ด (ไม่ใช่ตาราง) · หัวข้อ 'รายการ (n)'", () => {
    renderPage([row(), row({ id: "i-2", sku: "GR-0008", productId: "p-2" })]);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "รายการ (2)" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /^รายการ / })).toHaveLength(2);
  });
});

describe("เช็คลิสต์ + aria-disabled", () => {
  it("รายการไม่มี SKU: เช็คลิสต์ข้อ 'ยังไม่ผูก SKU' + บรรทัดเหตุผลใต้ปุ่ม + aria-disabled/aria-describedby · กดแล้วพา focus ไปเช็คลิสต์ ไม่เปิด dialog", async () => {
    renderPage([noSku()]);
    const list = screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" });
    expect(list).toHaveTextContent('ยังไม่ผูก SKU ให้ "แหวนลายใบไม้ทดลอง"');
    expect(within(list).getByRole("heading")).toHaveTextContent('ก่อนกด "ผลิตเสร็จ" ต้องทำอีก 1 ข้อ');
    const btn = doneBtn();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent('ยังไม่ผูก SKU ให้ "แหวนลายใบไม้ทดลอง"');
    await userEvent.click(btn);
    expect(screen.queryByText(/ยืนยันผลิตเสร็จ — PO-0034/)).toBeNull();
    expect(list).toHaveFocus();
  });

  it("น้ำหนักขาด (spot/spec) ติด · fixed ไม่ติด", () => {
    renderPage([row({ currentCostType: "spec", effectiveWeightG: null, effectiveWeightSource: null })]);
    expect(screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toHaveTextContent("ยังไม่ระบุน้ำหนัก/ชิ้นของ GR-0007 — ต้นทุนโหมดนี้ต้องใช้น้ำหนัก");
    cleanup();
    renderPage([row({ currentCostType: "fixed", effectiveWeightG: null, effectiveWeightSource: null })]);
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
  });

  it("หลายข้อ: เหตุผลใต้ปุ่ม = ข้อแรก + 'ติดอีก n ข้อ' · ปุ่ม 'ไปที่รายการ' โฟกัสการ์ดที่เกี่ยวข้อง", async () => {
    renderPage([noSku(), row({ id: "i-2", productId: "p-2", sku: "GR-2", currentCostType: "spec", effectiveWeightG: null, effectiveWeightSource: null })]);
    const btn = doneBtn();
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent("ติดอีก 1 ข้อ");
    const goButtons = screen.getAllByRole("button", { name: "ไปที่รายการ" });
    await userEvent.click(goButtons[0]);
    expect(document.getElementById("po-item-i-ns")).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("empty: ไม่มีรายการ → EmptyState + ปุ่มผลิตเสร็จ aria-disabled 'ยังไม่มีรายการ' · ยังเพิ่มรายการได้", () => {
    renderPage([]);
    expect(screen.getByText("ยังไม่มีรายการในใบนี้", { selector: "p" })).toBeInTheDocument();
    // flag ALLOW_UNBOUND_ITEM_OFFICE เปิด (W1 UI — มีปุ่มผูก SKU แล้ว) — ชวนเพิ่มได้ทั้งมี/ไม่มี SKU
    expect(screen.getByText("เพิ่มรายการด้านล่างได้เลย (มี SKU หรือไม่มี SKU ก็ได้)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ไม่มี SKU/ })).toBeInTheDocument();
    expect(doneBtn()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("region", { name: "เพิ่มรายการ" })).toBeInTheDocument();
  });

  it("แก้ค้างยังไม่บันทึก: ปุ่ม aria-disabled + ข้อติดอันดับแรก (ก่อนไม่มี SKU) · บันทึก/ย้อนค่า → ข้อติดหาย", async () => {
    renderPage([row(), noSku()]);
    const qty = screen.getAllByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ })[0];
    await userEvent.clear(qty);
    await userEvent.type(qty, "31");
    const list = screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" });
    await waitFor(() => expect(list).toHaveTextContent('มีรายการที่แก้ไว้แต่ยังไม่บันทึก — กด "บันทึกรายการ" ก่อน'));
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("แก้ไว้แต่ยังไม่บันทึก");
    expect(items[1]).toHaveTextContent("ยังไม่ผูก SKU");
    await userEvent.clear(qty);
    await userEvent.type(qty, "30");
    await waitFor(() => expect(list).not.toHaveTextContent("แก้ไว้แต่ยังไม่บันทึก"));
  });

  it("dirty → beforeunload ถูกดักและ preventDefault · ไม่ dirty → ไม่ดัก", async () => {
    renderPage([row()]);
    const evt = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(evt()).toBe(false);
    const qty = screen.getByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ });
    await userEvent.clear(qty);
    await userEvent.type(qty, "31");
    await waitFor(() => expect(evt()).toBe(true));
  });
});

describe("ลิงก์ '← กลับ' เมื่อมีการ์ดแก้ค้าง", () => {
  const back = () => screen.getByRole("link", { name: /กลับไปรายการใบผลิต/ });
  it("ไม่มีการ์ดแก้ค้าง → ไม่ถาม (ไม่ขัดการนำทาง)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage([row()]);
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    back().dispatchEvent(evt);
    expect(confirm).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });
  it("มีการ์ดแก้ค้าง → confirm ก่อนออก · ตอบ 'ไม่' = ยกเลิกการนำทาง (preventDefault) · ตอบ 'ตกลง' = ออกได้", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage([row()]);
    const qty = screen.getByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ });
    await userEvent.clear(qty);
    await userEvent.type(qty, "31");
    await waitFor(() => expect(screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeInTheDocument());
    const stay = new MouseEvent("click", { bubbles: true, cancelable: true });
    back().dispatchEvent(stay);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("แก้ไว้แต่ยังไม่บันทึก"));
    expect(stay.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    const leave = new MouseEvent("click", { bubbles: true, cancelable: true });
    back().dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
  });
});

describe("ล็อกโลหะด้วยใบงาน", () => {
  it("activeJobs ส่งเลขใบงานลงการ์ดของรายการนั้นเท่านั้น", () => {
    renderPage([row(), row({ id: "i-2", productId: "p-2", sku: "GR-2" })], {}, { activeJobs: { "i-2": "JB-0031" } });
    const groups = screen.getAllByRole("radiogroup", { name: "วัสดุ" });
    expect(groups[0]).not.toHaveAttribute("aria-disabled");
    expect(groups[1]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/มีใบงาน JB-0031 เดินอยู่/)).toBeInTheDocument();
  });
});

describe("ลบรายการ", () => {
  it("ยืนยันแล้วเรียก removeProductionOrderItemById ด้วย item id (รองรับไม่มี SKU) · สำเร็จ → refresh", async () => {
    removeById.mockResolvedValue({ ok: true, data: undefined });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage([noSku()]);
    await userEvent.click(screen.getByRole("button", { name: "ลบ แหวนลายใบไม้ทดลอง" }));
    await waitFor(() => expect(removeById).toHaveBeenCalledWith({ productionOrderId: "po-1", itemId: "i-ns" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("ลบไม่ได้ (job_history — ใบงานที่ยกเลิกแล้ว): แสดงข้อความที่ action ส่งมา (ตัดชื่อฟังก์ชันที่ humanizeProductionError แล้ว) พร้อมทางออก 'ยกเลิกทั้งใบผลิตแล้วเปิดใหม่' · ไม่ refresh", async () => {
    removeById.mockResolvedValue({ ok: false, error: "ลบรายการไม่ได้ — เคยมีใบงาน JB-0040 (ยกเลิกแล้ว แต่เก็บไว้เป็นหลักฐาน) — ถ้ารายการนี้ไม่ใช้แล้วให้ยกเลิกทั้งใบผลิตแล้วเปิดใบใหม่" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage([noSku()]);
    await userEvent.click(screen.getByRole("button", { name: "ลบ แหวนลายใบไม้ทดลอง" }));
    expect(await screen.findByText(/ให้ยกเลิกทั้งใบผลิตแล้วเปิดใบใหม่/)).toBeInTheDocument();
    expect(screen.queryByText(/production_order_item_remove_by_id/)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("ไม่ยืนยัน → ไม่ลบ", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage([row()]);
    await userEvent.click(screen.getByRole("button", { name: "ลบ GR-0007" }));
    expect(removeById).not.toHaveBeenCalled();
  });
});

describe("ใบ done / cancelled — อ่านอย่างเดียว", () => {
  it("done: ไม่มีเช็คลิสต์/ปุ่มผลิตเสร็จ/ฟอร์มเพิ่ม/ช่องกรอก · แสดงค่าที่ล็อก", () => {
    renderPage([row({ orderStatus: "done", qtyDone: 30, stampedUnitCost: 150 })], { status: "done", doneAt: "2026-10-20T05:00:00Z", qtyDoneTotal: 30 });
    expect(screen.queryByRole("button", { name: "ผลิตเสร็จ" })).toBeNull();
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
    expect(screen.queryByRole("region", { name: "เพิ่มรายการ" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/ผลิตเข้าแล้ว 30 ชิ้น เมื่อ/)).toBeInTheDocument();
    expect(screen.getByText(/ต้นทุนที่ล็อกไว้:/)).toBeInTheDocument();
  });
  it("cancelled: อ่านอย่างเดียว · แสดงเหตุผลยกเลิก · ไม่มีเช็คลิสต์ แม้มีรายการไม่มี SKU", () => {
    renderPage([noSku({ orderStatus: "cancelled" })], { status: "cancelled", cancelledAt: "2026-10-20T05:00:00Z", cancelReason: "ลูกค้ายกเลิก" });
    expect(screen.getByText(/เหตุผล: ลูกค้ายกเลิก/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ผลิตเสร็จ" })).toBeNull();
  });
});

describe("a11y: ลำดับหน้า", () => {
  it("เช็คลิสต์อยู่ก่อนหมายเหตุ/รายการ และก่อนฟอร์มเพิ่ม (ลำดับการอ่าน = งานที่ต้องทำ → ข้อมูล → รายการ → เพิ่ม)", () => {
    renderPage([noSku()]);
    const checklist = screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" });
    const items = screen.getByRole("heading", { name: "รายการ (1)" });
    const add = screen.getByRole("region", { name: "เพิ่มรายการ" });
    expect(checklist.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Tab" });
  });
});
