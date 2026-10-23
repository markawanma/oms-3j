// @vitest-environment jsdom
// W1 ฝั่งออฟฟิศบน /production/[id]: การ์ดรับทราบ (OfficeAck) + ผูก SKU + แก้ชื่อแบบ + ปุ่มผลิตเสร็จ aria-disabled ต่อกับเช็คลิสต์
//  ต้องถูก: เห็นผู้เปิด/เวลา/ตารางโลหะเนื้อน้ำหนักเด่น · ปุ่มมี read-back ของเนื้อ · ผลิตเสร็จติด "ยังไม่รับทราบ" · ผูก SKU ต้องยืนยัน · เตือนโลหะไม่ตรงจาก response
//  ต้องไม่พัง: ใบออฟฟิศ (office) ไม่มีการ์ด/ไม่ติดข้อ ack · ใบที่รับทราบแล้วหดเป็นแถบ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow, ProductionOrderRow, ProductionSkuOption } from "@/lib/production/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const ack = vi.fn();
const bind = vi.fn();
const setLabel = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: vi.fn(),
  removeProductionOrderItemById: vi.fn(),
  saveProductionOrder: vi.fn(),
  previewProductionOrder: vi.fn(() => new Promise(() => {})),
  doneProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  getProductionItemPrefill: vi.fn(),
  acknowledgeProductionOrder: (...a: unknown[]) => ack(...a),
  bindProductionItemProduct: (...a: unknown[]) => bind(...a),
  setProductionItemLabel: (...a: unknown[]) => setLabel(...a),
}));
vi.mock("@/lib/actions/catalog-sku", () => ({ listSkuPrefixes: () => Promise.resolve({ ok: true, data: [] }), createCatalogSku: vi.fn() }));
vi.mock("@/lib/actions/oem", () => ({}));
vi.mock("@/lib/actions/job-office-write", () => ({}));
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: vi.fn() }));
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: vi.fn(), changeJobProfile: vi.fn() }));
const getJobPhotos = vi.fn();
const setPrimaryJobPhoto = vi.fn();
const removeJobPhoto = vi.fn();
vi.mock("@/lib/actions/job-photos", () => ({
  getJobPhotos: (...a: unknown[]) => getJobPhotos(...a),
  setPrimaryJobPhoto: (...a: unknown[]) => setPrimaryJobPhoto(...a),
  removeJobPhoto: (...a: unknown[]) => removeJobPhoto(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionOrderDetailClient } from "./ProductionOrderDetailClient";

beforeEach(() => {
  vi.clearAllMocks();
  // fixture ลงวันที่ 21 ต.ค. 69 — การ์ดอ่าน "วันนี้" จาก Date.now() (ค้าง ≥ N วัน = ป้ายแดง "ค้าง N วัน" แทน "ยังไม่รับทราบ")
  // ล็อกเฉพาะ Date ที่เวลาหลังเปิดใบ 3 ชม. (ไม่ fake timer อื่น — userEvent/waitFor ยังเดินปกติ) · ไม่ผูกกับเวลาจริงของเครื่องที่รันเทสต์
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T05:00:00Z"));
  Element.prototype.scrollIntoView = vi.fn();
  ack.mockResolvedValue({ ok: true, data: { productionOrderId: "po-1", poNo: "PO-0040", acknowledgedAt: "2026-10-21T03:00:00Z", jobsLogged: 1 } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const order = (o: Partial<ProductionOrderRow> = {}): ProductionOrderRow => ({
  id: "po-1", poNo: "PO-0040", status: "open", note: null, spotOverrideThbPerGram: null, doneAt: null, cancelledAt: null, cancelReason: null,
  createdAt: "2026-10-21T02:12:00Z", updatedAt: "2026-10-21T02:12:00Z", itemCount: 1, qtyPlannedTotal: 30, qtyDoneTotal: 0, unboundItemCount: 0,
  openedVia: "shopfloor", openedByWorkerName: "หัวหน้าช่าง", acknowledgedAt: null, ...o,
});

const row = (o: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow => ({
  id: "i-1", productionOrderId: "po-1", poNo: "PO-0040", orderStatus: "open", productId: "p-1", sku: "RG-0418", productName: "แหวนโกเมนไข่", pendingProductLabel: null,
  currentCostType: "fixed", currentUnitCost: 120, metal: "gold", purity: 0.965, weightG: 3.2, weightSource: "input",
  effectiveMetal: "gold", effectivePurity: 0.965, effectiveWeightG: 3.2, effectiveWeightSource: "input",
  skuMetal: "silver", skuPurity: 0.925, skuWeightG: null, skuMetalKnown: true, metalMismatch: true, qtyPlanned: 30, qtyDone: null, stampedUnitCost: null, prevCostType: null, prevUnitCost: null,
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", makeSpec: null, currentSilverWeightG: null, currentSilverPurity: null, isNewDesign: false, costCalc: null, ...o,
});
const noSku = (o: Partial<ProductionOrderItemRow> = {}) =>
  row({ id: "i-ns", productId: null, sku: null, productName: null, pendingProductLabel: "แหวนลายใบไม้", currentCostType: null, currentUnitCost: null, skuMetal: null, skuPurity: null, skuMetalKnown: false, metalMismatch: false, ...o });

const SKUS: ProductionSkuOption[] = [
  { productId: "p-1", sku: "RG-0418", name: "แหวนโกเมนไข่", costType: "fixed" },
  { productId: "p-9", sku: "RG-0999", name: "แหวนลายใบไม้ใหม่", costType: "fixed" },
];

function renderPage(items: ProductionOrderItemRow[], o: Partial<ProductionOrderRow> = {}, skuOptions: ProductionSkuOption[] = SKUS, skuOptionsError: string | null = null) {
  return render(
    <ToastProvider>
      <ProductionOrderDetailClient order={order(o)} items={items} skuOptions={skuOptions} skuOptionsError={skuOptionsError} />
    </ToastProvider>
  );
}
const card = () => screen.getByRole("region", { name: /ใบนี้เปิดจากหน้างาน/ });
const doneBtn = () => screen.getByRole("button", { name: "ผลิตเสร็จ" });

describe("การ์ดรับทราบ (ก่อนรับทราบ)", () => {
  it("เห็นผู้เปิด + เวลา + ตาราง โลหะ/เนื้อ/น้ำหนัก/จำนวน + ป้ายยังไม่รับทราบ", () => {
    renderPage([row({ metalMismatch: false })]);
    const c = card();
    expect(within(c).getByRole("heading", { name: "ใบนี้เปิดจากหน้างาน" })).toBeInTheDocument();
    expect(c).toHaveTextContent("เปิดโดย หัวหน้าช่าง");
    expect(within(c).getByText("ยังไม่รับทราบ")).toBeInTheDocument();
    const table = within(c).getByRole("table");
    expect(within(table).getByText("ทอง")).toBeInTheDocument();
    expect(within(table).getByText("96.50 %")).toBeInTheDocument();
    expect(within(table).getByText("3.200 กรัม")).toBeInTheDocument();
    expect(within(table).getByText("30 ชิ้น")).toBeInTheDocument();
    expect(within(c).getByText("ที่หน้างานกรอก — ตรวจให้ตรงของจริง")).toBeInTheDocument();
  });

  it("น้ำหนักไม่ระบุ = 'ไม่ได้ระบุ' · ทองเหลืองเนื้อ 100 %", () => {
    renderPage([row({ metalMismatch: false, effectiveWeightG: null, weightG: null, effectiveMetal: "brass", metal: "brass" })]);
    const t = within(card()).getByRole("table");
    expect(within(t).getByText("ไม่ได้ระบุ")).toBeInTheDocument();
    expect(within(t).getByText("100 %")).toBeInTheDocument();
  });

  it("ปุ่มหลักเดียว 'รับทราบ · ทอง 96.50%' (read-back ในปุ่ม)", () => {
    renderPage([row({ metalMismatch: false })]);
    expect(within(card()).getByRole("button", { name: "✓ รับทราบ · ทอง 96.50%".replace("✓ ", "") })).toBeInTheDocument();
  });

  it("metal_mismatch → ป้ายเตือน 'ต่างจากสินค้าในระบบ: SKU ระบุเป็น เงิน แต่หน้างานเลือก ทอง'", () => {
    renderPage([row()]);
    expect(within(card()).getByRole("note")).toHaveTextContent("ต่างจากสินค้าในระบบ: RG-0418 ระบุเป็น เงิน แต่หน้างานเลือก ทอง");
  });

  it("ไม่มี SKU → ⓘ ผูกที่การ์ดรายการด้านล่าง", () => {
    renderPage([noSku()]);
    expect(card()).toHaveTextContent("รายการนี้ยังไม่มี SKU — ผูกที่การ์ดรายการด้านล่าง");
  });

  it("กดรับทราบ → เรียก acknowledgeProductionOrder({productionOrderId}) → toast + refresh · ปุ่ม loading 'กำลังบันทึก…'", async () => {
    let resolve: (v: unknown) => void = () => {};
    ack.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage([row({ metalMismatch: false })]);
    await userEvent.click(within(card()).getByRole("button", { name: /^รับทราบ/ }));
    expect(ack).toHaveBeenCalledWith({ productionOrderId: "po-1" });
    expect(await within(card()).findByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
    resolve({ ok: true, data: { productionOrderId: "po-1", poNo: "PO-0040", acknowledgedAt: "2026-10-21T03:00:00Z", jobsLogged: 1 } });
    expect(await screen.findByText("รับทราบ PO-0040 แล้ว")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("error: ข้อความ role=alert + ปุ่มโหลดใหม่ (router.refresh) · ค่าบนการ์ดคงอยู่", async () => {
    ack.mockResolvedValue({ ok: false, error: "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่" });
    renderPage([row({ metalMismatch: false })]);
    await userEvent.click(within(card()).getByRole("button", { name: /^รับทราบ/ }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent("ใบนี้ไม่ได้เปิดอยู่แล้ว");
    expect(within(card()).getByRole("table")).toBeInTheDocument();
    await userEvent.click(within(card()).getByRole("button", { name: "โหลดใหม่" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("ข้อ 6: ใบถูกยกเลิกระหว่างเปิดหน้า → 'ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่' · ข้อความ DB ที่มีคำอังกฤษไม่ถึงจอ", async () => {
    ack.mockResolvedValue({ ok: false, error: "ใบผลิต PO-0040 สถานะ cancelled แล้ว รับทราบไม่ได้" });
    renderPage([row({ metalMismatch: false })]);
    await userEvent.click(within(card()).getByRole("button", { name: /^รับทราบ/ }));
    const a = await within(card()).findByRole("alert");
    expect(a).not.toHaveTextContent(/cancelled/);
    expect(a).toHaveTextContent("รับทราบไม่สำเร็จ — ลองอีกครั้ง");
    ack.mockResolvedValue({ ok: false, error: "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่" });
    await userEvent.click(within(card()).getByRole("button", { name: /^รับทราบ/ }));
    await waitFor(() => expect(within(card()).getByRole("alert")).toHaveTextContent("ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่"));
  });

  it("เครือข่ายล้ม (throw) → 'รับทราบไม่สำเร็จ — ลองอีกครั้ง' · ปุ่มกลับมากดได้", async () => {
    ack.mockRejectedValue(new Error("net"));
    renderPage([row({ metalMismatch: false })]);
    await userEvent.click(within(card()).getByRole("button", { name: /^รับทราบ/ }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent("รับทราบไม่สำเร็จ — ลองอีกครั้ง");
    expect(within(card()).getByRole("button", { name: /^รับทราบ/ })).toBeEnabled();
  });

  it("ช่วยเหลือ: 'ผิดโลหะ? ยกเลิกใบงานแล้วเปิดใหม่ (โลหะล็อกพร้อมใบงาน)'", () => {
    renderPage([row({ metalMismatch: false })]);
    expect(within(card()).getByText(/ผิดโลหะ\? ยกเลิกใบงานแล้วเปิดใหม่ \(โลหะล็อกพร้อมใบงาน\)/)).toBeInTheDocument();
  });
});

describe("ปุ่มผลิตเสร็จ ต่อกับเช็คลิสต์ (ยังไม่รับทราบ)", () => {
  it("ใบหน้างานที่ยังไม่รับทราบ: aria-disabled + เหตุผล 'ยังไม่ได้ รับทราบ' · เช็คลิสต์มีข้อ ack · กด = พาไปเช็คลิสต์ ไม่เปิด dialog", async () => {
    renderPage([row({ metalMismatch: false })]);
    expect(doneBtn()).toHaveAttribute("aria-disabled", "true");
    const list = screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" });
    expect(list).toHaveTextContent("ยังไม่ได้ \"รับทราบ\"");
    await userEvent.click(doneBtn());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(list).toHaveFocus();
    await userEvent.click(within(list).getByRole("button", { name: "ไปที่การ์ดรับทราบ" }));
    expect(card()).toHaveFocus();
  });

  it("หลังรับทราบ: การ์ดหดเป็นแถบ · ข้อติดหาย · ปุ่มผลิตเสร็จกดได้", () => {
    renderPage([row({ metalMismatch: false })], { acknowledgedAt: "2026-10-21T03:00:00Z" });
    const bar = card();
    expect(bar).toHaveTextContent("รับทราบแล้ว");
    expect(within(bar).queryByRole("table")).toBeNull();
    expect(within(bar).queryByRole("button", { name: /^รับทราบ/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
    expect(doneBtn()).not.toHaveAttribute("aria-disabled");
  });

  it("ใบออฟฟิศ (opened_via=office): ไม่มีการ์ด · ไม่ติดข้อ ack · ผลิตเสร็จกดได้เหมือนเดิม", () => {
    renderPage([row({ metalMismatch: false })], { openedVia: "office", openedByWorkerName: null });
    expect(screen.queryByRole("region", { name: /ใบนี้เปิดจากหน้างาน/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toBeNull();
    expect(doneBtn()).not.toHaveAttribute("aria-disabled");
  });

  it("ใบหน้างานที่ปิดแล้ว (done): แถบข้อมูล ไม่มีปุ่มรับทราบ", () => {
    renderPage([row({ metalMismatch: false })], { status: "done", doneAt: "2026-10-21T05:00:00Z" });
    expect(card()).toHaveTextContent("ไม่ได้รับทราบก่อนปิด");
    expect(screen.queryByRole("button", { name: /^รับทราบ/ })).toBeNull();
  });
});

describe("การ์ดรายการไม่มี SKU: ผูก SKU", () => {
  const panel = () => screen.getByRole("region", { name: "ผูก SKU" });
  const type = async (t: string) => userEvent.type(within(panel()).getByLabelText("ค้นหา SKU"), t);

  it("ไม่เสนอ SKU ที่อยู่ในใบนี้แล้ว · ปุ่มผูก aria-disabled จนกว่าจะเลือก SKU ที่ตรง", async () => {
    renderPage([row({ metalMismatch: false }), noSku()]);
    const opts = [...panel().querySelectorAll("datalist option")].map((o) => (o as HTMLOptionElement).value);
    expect(opts).toEqual(["RG-0999 · แหวนลายใบไม้ใหม่"]);
    const btn = within(panel()).getByRole("button", { name: "ผูก SKU" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    expect(within(panel()).queryByRole("alertdialog")).toBeNull();
  });

  it("เลือก SKU → ยืนยัน 2 ขั้น (ผูกแล้วแก้ไม่ได้) → bindProductionItemProduct → toast + refresh", async () => {
    bind.mockResolvedValue({ ok: true, data: { itemId: "i-ns", productId: "p-9", sku: "RG-0999", name: "x", pendingLabelBefore: "แหวนลายใบไม้", jobsUpdated: 1, itemMetal: "silver", skuMetal: "silver", skuMetalKnown: false, metalMismatch: false, weightFilled: false } });
    renderPage([row({ metalMismatch: false }), noSku()]);
    await type("RG-0999 · แหวนลายใบไม้ใหม่");
    await userEvent.click(within(panel()).getByRole("button", { name: "ผูก SKU" }));
    const dlg = within(panel()).getByRole("alertdialog", { name: "ยืนยันผูก SKU" });
    expect(dlg).toHaveTextContent("ผูกแล้วแก้ไม่ได้");
    expect(bind).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "ยืนยันผูก SKU" }));
    expect(bind).toHaveBeenCalledWith({ productionOrderId: "po-1", itemId: "i-ns", productId: "p-9" });
    expect(await screen.findByText(/ผูก RG-0999 แล้ว/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("กด 'กลับ' ที่ขั้นยืนยัน = ไม่ผูก", async () => {
    renderPage([noSku()]);
    await type("RG-0999 · แหวนลายใบไม้ใหม่");
    await userEvent.click(within(panel()).getByRole("button", { name: "ผูก SKU" }));
    await userEvent.click(within(panel()).getByRole("button", { name: "กลับ" }));
    expect(bind).not.toHaveBeenCalled();
    expect(within(panel()).queryByRole("alertdialog")).toBeNull();
  });

  it("เตือนโลหะไม่ตรง + เติมน้ำหนัก มาจาก response ของ DB (ไม่คิดเอง)", async () => {
    bind.mockResolvedValue({ ok: true, data: { itemId: "i-ns", productId: "p-9", sku: "RG-0999", name: "x", pendingLabelBefore: null, jobsUpdated: 0, itemMetal: "gold", skuMetal: "silver", skuMetalKnown: true, metalMismatch: true, weightFilled: true } });
    renderPage([noSku({ effectiveMetal: "gold", metal: "gold" })]);
    await type("RG-0999 · แหวนลายใบไม้ใหม่");
    await userEvent.click(within(panel()).getByRole("button", { name: "ผูก SKU" }));
    await userEvent.click(within(panel()).getByRole("button", { name: "ยืนยันผูก SKU" }));
    const toast = await screen.findByText(/ผูก RG-0999 แล้ว/);
    expect(toast.textContent).toContain("โลหะไม่ตรง: SKU ระบุเป็นเงิน แต่รายการเป็นทอง");
    expect(toast.textContent).toContain("เติมน้ำหนักจาก SKU");
  });

  it("DB ปฏิเสธ (เช่น SKU ซ้ำ): ข้อความ role=alert · ค่าที่เลือกอยู่ · ไม่ refresh", async () => {
    bind.mockResolvedValue({ ok: false, error: "SKU นี้มีอยู่ในใบผลิตนี้แล้ว" });
    renderPage([noSku()]);
    await type("RG-0999 · แหวนลายใบไม้ใหม่");
    await userEvent.click(within(panel()).getByRole("button", { name: "ผูก SKU" }));
    await userEvent.click(within(panel()).getByRole("button", { name: "ยืนยันผูก SKU" }));
    expect(await within(panel()).findByRole("alert")).toHaveTextContent("SKU นี้มีอยู่ในใบผลิตนี้แล้ว");
    expect(within(panel()).getByLabelText("ค้นหา SKU")).toHaveValue("RG-0999 · แหวนลายใบไม้ใหม่");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("โหลดรายการ SKU ล้ม → ข้อความ · ไม่มี SKU ให้เลือก → ข้อความ empty", () => {
    const { unmount } = renderPage([noSku()], {}, [], "โหลดรายการ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(within(panel()).getByRole("alert")).toHaveTextContent("โหลดรายการ SKU ไม่สำเร็จ");
    unmount();
    renderPage([noSku()], {}, []);
    expect(panel()).toHaveTextContent("ยังไม่มี SKU ที่เลือกได้");
  });

  it("ผูกแล้วชื่อที่หน้างานตั้งยังแสดงเป็นบรรทัดรอง · ไม่มีแผงผูกอีก", () => {
    renderPage([row({ metalMismatch: false, pendingProductLabel: "แหวนลายใบไม้" })]);
    expect(screen.getByText("ชื่อที่หน้างานตั้ง: แหวนลายใบไม้")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ผูก SKU" })).toBeNull();
  });

  it("แก้ชื่อแบบก่อนผูก → setProductionItemLabel → toast + refresh", async () => {
    setLabel.mockResolvedValue({ ok: true, data: { label: "แหวนใบไม้ทอง" } });
    renderPage([noSku()]);
    const p = panel();
    await userEvent.click(within(p).getByText("แก้ชื่อแบบ (ก่อนผูก SKU)"));
    const input = within(p).getByLabelText("ชื่อแบบ");
    await userEvent.clear(input);
    await userEvent.type(input, "แหวนใบไม้ทอง");
    await userEvent.click(within(p).getByRole("button", { name: "บันทึกชื่อแบบ" }));
    await waitFor(() => expect(setLabel).toHaveBeenCalledWith({ productionOrderId: "po-1", itemId: "i-ns", label: "แหวนใบไม้ทอง" }));
    expect(await screen.findByText(/แก้ชื่อแบบเป็น "แหวนใบไม้ทอง" แล้ว/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("ชื่อซ้ำ (DB label_duplicate) → ข้อความใต้ช่อง ไม่ล้มทั้งการ์ด", async () => {
    setLabel.mockResolvedValue({ ok: false, error: "มีรายการชื่อนี้ในใบนี้แล้ว" });
    renderPage([noSku()]);
    const p = panel();
    await userEvent.click(within(p).getByText("แก้ชื่อแบบ (ก่อนผูก SKU)"));
    const input = within(p).getByLabelText("ชื่อแบบ");
    await userEvent.clear(input);
    await userEvent.type(input, "ชื่ออื่น");
    await userEvent.click(within(p).getByRole("button", { name: "บันทึกชื่อแบบ" }));
    expect(await within(p).findByText("มีรายการชื่อนี้ในใบนี้แล้ว")).toBeInTheDocument();
  });

  it("ปุ่มผูก SKU ถูกกั้นเมื่อการ์ดรายการมีค่าที่แก้ค้าง (refresh จะรีเซ็ตสิ่งที่พิมพ์)", async () => {
    renderPage([noSku()]);
    const card = screen.getByRole("region", { name: /รายการ ไม่มี SKU/ });
    const w = within(card).getByLabelText(/น้ำหนัก\/ชิ้น/);
    await userEvent.type(w, "3.2");
    const btn = within(panel()).getByRole("button", { name: "ผูก SKU" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(within(panel()).getByText("บันทึกรายการนี้ก่อน แล้วค่อยผูก SKU")).toBeInTheDocument();
  });

  it("ผ่านด่านผลิตเสร็จต้องผูกครบ: ไม่มี SKU ยังติดข้อ 'ยังไม่ผูก SKU ให้ …' ในเช็คลิสต์", () => {
    renderPage([noSku()], { acknowledgedAt: "2026-10-21T03:00:00Z" });
    expect(screen.getByRole("region", { name: "ก่อนกดผลิตเสร็จ" })).toHaveTextContent('ยังไม่ผูก SKU ให้ "แหวนลายใบไม้"');
    expect(doneBtn()).toHaveAttribute("aria-disabled", "true");
  });
});
