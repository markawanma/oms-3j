// @vitest-environment jsdom
// ProductionItemCard (PM-B · UX A.3) — ทุก state + error + a11y หลัก
//  ต้องถูก: โลหะเปลี่ยนรีเซ็ตเนื้อ/ล้างน้ำหนักจาก SKU · ทองไม่มีเนื้อบันทึกไม่ได้+focus · ส่งเฉพาะช่องที่เปลี่ยน · ล็อกโลหะเมื่อมีใบงาน · ป้าย ยังไม่ผูก SKU · done = อ่านอย่างเดียว
//  ต้องไม่พัง: แถวเดิมก่อน 0186 (คอลัมน์ว่าง) แสดงเงิน/เนื้อ/น้ำหนักเดิมเป๊ะและปุ่มบันทึกปิดอยู่ · ไม่โชว์ต้นทุนในที่ที่เดิมไม่โชว์
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow } from "@/lib/production/types";

const setItem = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: (...a: unknown[]) => setItem(...a),
}));
vi.mock("@/lib/actions/job-office", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionItemCard } from "./ProductionItemCard";

afterEach(cleanup);
// ห้าม return mock จาก beforeEach (mockReset คืนตัว mock เอง — vitest จะเอาไปเรียกเป็น teardown หลังเทสต์ทุกครั้ง)
beforeEach(() => {
  setItem.mockReset();
});

function row(over: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow {
  return {
    id: "i-1",
    productionOrderId: "po-1",
    poNo: "PO-0034",
    orderStatus: "open",
    productId: "p-1",
    sku: "GR-0007",
    productName: "แหวนลายใบไม้",
    pendingProductLabel: null,
    currentCostType: "fixed",
    currentUnitCost: 120,
    metal: null,
    purity: null,
    weightG: null,
    weightSource: null,
    effectiveMetal: "silver",
    effectivePurity: 0.925,
    effectiveWeightG: 3.2,
    effectiveWeightSource: "product",
    skuMetal: "silver",
    skuPurity: 0.925,
    skuWeightG: 3.2,
    skuMetalKnown: false, metalMismatch: false,
    qtyPlanned: 30,
    qtyDone: null,
    stampedUnitCost: null,
    prevCostType: null,
    prevUnitCost: null,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    makeSpec: null,
    currentSilverWeightG: 3.2,
    currentSilverPurity: 0.925,
    isNewDesign: false,
    costCalc: null,
    ...over,
  };
}

const openOrder = { id: "po-1", poNo: "PO-0034", status: "open" as const };

function renderCard(r: ProductionOrderItemRow, extra: Partial<React.ComponentProps<typeof ProductionItemCard>> = {}) {
  const onSaved = vi.fn();
  const onDirtyChange = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <ToastProvider>
      <ProductionItemCard order={openOrder} row={r} onSaved={onSaved} onDirtyChange={onDirtyChange} onRemove={onRemove} {...extra} />
    </ToastProvider>
  );
  return { ...utils, onSaved, onDirtyChange, onRemove };
}

const purityBox = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const weightBox = () => screen.getByRole("textbox", { name: /น้ำหนัก\/ชิ้น/ }) as HTMLInputElement;
const qtyBox = () => screen.getByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ }) as HTMLInputElement;
const saveBtn = () => screen.getByRole("button", { name: "บันทึกรายการ" });
const metalRadio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("แถวเดิมก่อน 0186 (คอลัมน์ metal/purity/weight ว่าง) — ต้องไม่พัง", () => {
  it("แสดงเงิน · 92.50 · 3.2 เดิมเป๊ะ · ปุ่มบันทึกปิด (ไม่ dirty) · ป้ายโลหะเงิน · ต้นทุนคงที่ยังโชว์เหมือนเดิม", () => {
    renderCard(row());
    expect(metalRadio("เงิน").checked).toBe(true);
    expect(purityBox().value).toBe("92.50");
    expect(weightBox().value).toBe("3.2");
    expect(qtyBox().value).toBe("30");
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByText(/ต้นทุนปัจจุบัน \(อ้างอิง\):/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GR-0007 · แหวนลายใบไม้" })).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่ผูก SKU")).toBeNull();
    // ต้นทุนไม่ถูกโชว์ในโหมด spot/spec (คงพฤติกรรมเดิม — M5) และ fixed แสดงเลขเดิม
    cleanup();
    renderCard(row({ currentCostType: "spot" }));
    expect(screen.getByText("ต้นทุน: คำนวณตอนกดผลิตเสร็จ")).toBeInTheDocument();
    expect(screen.queryByText(/120/)).toBeNull();
  });
});

describe("เปลี่ยนโลหะ", () => {
  it("เงิน→ทอง: เนื้อว่าง + ป้าย *บังคับกรอก + ล้างน้ำหนักจาก SKU + บอกผู้ใช้ทั้งสองข้อ + dirty", async () => {
    const { onDirtyChange } = renderCard(row());
    await userEvent.click(metalRadio("ทอง"));
    expect(metalRadio("ทอง").checked).toBe(true);
    expect(purityBox().value).toBe("");
    expect(weightBox().value).toBe("");
    expect(screen.getByText("*บังคับกรอก")).toBeInTheDocument();
    expect(screen.getByText("เนื้อรีเซ็ตตามโลหะใหม่")).toBeInTheDocument();
    expect(screen.getByText("ล้างน้ำหนักจากสินค้าแล้ว (ใช้กับเงินเท่านั้น)")).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่บันทึก/)).toBeInTheDocument();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith("i-1", true));
    expect(saveBtn()).toBeEnabled();
  });

  it("ทองเหลือง: เนื้อล็อก 100.00 อ่านอย่างเดียว + ข้อความล็อก", async () => {
    renderCard(row());
    await userEvent.click(metalRadio("ทองเหลือง"));
    expect(purityBox().value).toBe("100.00");
    expect(purityBox()).toHaveAttribute("readonly");
    expect(screen.getByText("ทองเหลืองล็อกเนื้อ 100%")).toBeInTheDocument();
  });

  it("ทอง→เงิน: เติม 92.50 ในช่องให้เห็นชัด + ข้อความ 'ค่าเริ่ม 92.50 แก้ได้ · ว่าง = 92.50' · เงินเว้นว่างบันทึกได้ไม่ error และส่ง 0.925 ชัดเจน", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "x", pendingProductLabel: null, qtyPlanned: 30, isNewDesign: false, metal: "silver", purity: 0.925, weightG: null, weightSource: null } });
    renderCard(row({ effectiveMetal: "gold", effectivePurity: 0.9, effectiveWeightG: null, effectiveWeightSource: null }));
    await userEvent.click(metalRadio("เงิน"));
    expect(purityBox().value).toBe("92.50");
    expect(screen.getByText(/ค่าเริ่ม 92.50 แก้ได้ · ว่าง = 92.50/)).toBeInTheDocument();
    await userEvent.clear(purityBox());
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: "p-1", qtyPlanned: 30, metal: "silver", purity: 0.925 });
    expect(screen.queryByText(/กรอกเนื้อเงิน/)).toBeNull();
    // หลังบันทึก หน้าจอโชว์ค่าที่ server เก็บ (92.50) ไม่ใช่ช่องว่าง
    await waitFor(() => expect(purityBox().value).toBe("92.50"));
  });

  it("กลับมาโลหะเดิม = คืนเนื้อ/น้ำหนักเดิม และไม่ dirty อีก", async () => {
    const { onDirtyChange } = renderCard(row());
    await userEvent.click(metalRadio("ทอง"));
    await userEvent.click(metalRadio("เงิน"));
    expect(purityBox().value).toBe("92.50");
    expect(weightBox().value).toBe("3.2");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith("i-1", false));
    expect(saveBtn()).toBeDisabled();
  });
});

describe("ข้อความเทียบ SKU (P1 — กัน warning fatigue)", () => {
  it("SKU ไม่ระบุโลหะ (metal_known=false): ข้อความกลาง ⓘ ไม่ใช่คำเตือน แม้เลือกทอง", async () => {
    renderCard(row({ skuMetalKnown: false }));
    await userEvent.click(metalRadio("ทอง"));
    expect(screen.getByText(/สินค้านี้ยังไม่ระบุโลหะในระบบ — ตรวจให้ตรงของจริง/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("SKU ระบุโลหะชัด (known) และรายการต่างจาก SKU: เตือนสีเหลือง (role=note) · ตรงกัน = ไม่เตือน ไม่มีข้อความกลาง", async () => {
    renderCard(row({ skuMetalKnown: true, skuMetal: "silver" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/ยังไม่ระบุโลหะในระบบ/)).toBeNull();
    await userEvent.click(metalRadio("ทอง"));
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("สินค้านี้ระบุเป็น เงิน แต่รายการนี้เป็น ทอง");
  });
});

describe("บันทึก — validation + focus", () => {
  it("ทองไม่กรอกเนื้อ → ไม่ยิง server · แสดง error ใต้ช่อง (role=alert) · focus ช่องเนื้อ", async () => {
    renderCard(row());
    await userEvent.click(metalRadio("ทอง"));
    await userEvent.click(saveBtn());
    expect(setItem).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("ทองต้องกรอกเนื้อทอง (%) — ขั้นต่ำ 37.50%");
    await waitFor(() => expect(purityBox()).toHaveFocus());
  });

  it("น้ำหนัก 10001 → error ตาม spec + focus ช่องน้ำหนัก · ไม่ยิง server", async () => {
    renderCard(row());
    await userEvent.clear(weightBox());
    await userEvent.type(weightBox(), "10001");
    await userEvent.click(saveBtn());
    expect(setItem).not.toHaveBeenCalled();
    expect(await screen.findByText("น้ำหนักต้องมากกว่า 0 และไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)")).toBeInTheDocument();
    await waitFor(() => expect(weightBox()).toHaveFocus());
  });

  it("พิมพ์ 0.925 ในช่องเนื้อ → ข้อความของ purity.ts เดิม (ไม่ใช่สัดส่วน) · ไม่ยิง server", async () => {
    renderCard(row());
    await userEvent.clear(purityBox());
    await userEvent.type(purityBox(), "0.925");
    await userEvent.click(saveBtn());
    expect(setItem).not.toHaveBeenCalled();
    expect(await screen.findByText(/กรอกเป็น % เช่น 92.50 \(ไม่ใช่สัดส่วน 0.925\)/)).toBeInTheDocument();
  });

  it("ข้อความ error น้ำหนักไม่ขึ้นระหว่างพิมพ์ (ขึ้นหลัง blur/หลังกดบันทึก)", async () => {
    renderCard(row());
    await userEvent.clear(weightBox());
    await userEvent.type(weightBox(), "3.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("บันทึก — payload + success + error", () => {
  it("เงิน→ทอง เนื้อ 96.5: ยิง setProductionOrderItem ส่ง metal=gold purity=0.965 clearWeight · ไม่ส่ง weightG · โชว์ค่าที่ server คืน · toast + onSaved", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "แหวนลายใบไม้", pendingProductLabel: null, qtyPlanned: 30, isNewDesign: false, metal: "gold", purity: 0.965, weightG: null, weightSource: null } });
    const { onSaved } = renderCard(row());
    await userEvent.click(metalRadio("ทอง"));
    await userEvent.type(purityBox(), "96.5");
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: "p-1", qtyPlanned: 30, metal: "gold", purity: 0.965, clearWeight: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText("บันทึก GR-0007 แล้ว")).toBeInTheDocument();
    // ค่าที่เก็บจริงของ server แสดงเป็นเนื้อ 96.50 และการ์ดกลับเป็นไม่ dirty
    expect(purityBox().value).toBe("96.50");
    expect(saveBtn()).toBeDisabled();
  });

  it("แก้จำนวนอย่างเดียว: ไม่ส่ง metal/purity (ไม่ pin แถวเดิม)", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "x", pendingProductLabel: null, qtyPlanned: 40, isNewDesign: false, metal: null, purity: null, weightG: null, weightSource: null } });
    renderCard(row());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "40");
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: "p-1", qtyPlanned: 40 });
  });

  it("loading: ระหว่างบันทึกปุ่ม loading (disabled) + ช่องเนื้อ/น้ำหนัก/จำนวนทั้งสามช่อง disabled + ปุ่มลบ disabled + radio โลหะ aria-disabled · จบแล้วกลับมาแก้ได้", async () => {
    let resolve!: (v: unknown) => void;
    setItem.mockReturnValue(new Promise((r) => (resolve = r)));
    renderCard(row());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "40");
    await userEvent.click(saveBtn());
    await waitFor(() => expect(qtyBox()).toBeDisabled());
    expect(purityBox()).toBeDisabled();
    expect(weightBox()).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByRole("button", { name: "ลบ GR-0007" })).toBeDisabled();
    expect(screen.getByRole("radiogroup", { name: "วัสดุ" })).toHaveAttribute("aria-disabled", "true");
    for (const r of screen.getAllByRole("radio")) expect(r).toHaveAttribute("aria-disabled", "true");
    resolve({ ok: false, error: "x" });
    await waitFor(() => expect(qtyBox()).toBeEnabled());
    expect(purityBox()).toBeEnabled();
    expect(weightBox()).toBeEnabled();
  });

  it("error จาก server: กล่อง role=alert บนการ์ด แสดงข้อความที่ action ส่งมาตรงๆ (ตัดชื่อฟังก์ชันที่ humanizeProductionError แล้ว) · ค่าที่กรอกคงอยู่ · ยัง dirty บันทึกซ้ำได้", async () => {
    setItem.mockResolvedValue({ ok: false, error: "เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ" });
    renderCard(row());
    await userEvent.click(metalRadio("ทองเหลือง"));
    await userEvent.click(saveBtn());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ");
    expect(metalRadio("ทองเหลือง").checked).toBe(true);
    expect(saveBtn()).toBeEnabled();
  });

  it("server action throw (เครือข่ายล้ม): saving ไม่ค้าง — ช่อง/ปุ่มกลับมาใช้ได้ + ข้อความ alert · ค่าที่กรอกคงอยู่ (try/finally)", async () => {
    setItem.mockImplementation(async () => {
      throw new Error("network down");
    });
    renderCard(row());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "40");
    await userEvent.click(saveBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกไม่สำเร็จ ลองอีกครั้ง (ค่าที่กรอกยังอยู่)");
    expect(qtyBox()).toBeEnabled();
    expect(qtyBox().value).toBe("40");
    expect(saveBtn()).toBeEnabled();
  });
});

describe("ป้าย 'จาก SKU / แก้ในใบนี้' + ข้อความใต้ช่อง", () => {
  it("ค่าเท่า SKU → 'จาก SKU' ทั้งสองช่อง · แก้เนื้อแล้วป้ายเนื้อ 'จาก SKU' หาย (เปลี่ยนเป็น 'แก้ในใบนี้') แต่ป้ายน้ำหนักยังอยู่", async () => {
    renderCard(row());
    expect(screen.getAllByText("จาก SKU", { selector: "span" })).toHaveLength(2);
    await userEvent.clear(purityBox());
    await userEvent.type(purityBox(), "90");
    expect(screen.getAllByText("จาก SKU", { selector: "span" })).toHaveLength(1);
    expect(screen.getByText("แก้ในใบนี้", { selector: "span" })).toBeInTheDocument();
    await userEvent.clear(weightBox());
    await userEvent.type(weightBox(), "4.5");
    expect(screen.queryByText("จาก SKU", { selector: "span" })).toBeNull();
    expect(screen.getAllByText("แก้ในใบนี้", { selector: "span" })).toHaveLength(2);
  });

  it("ข้อความใต้ช่อง: เนื้อเงิน 'ว่าง = 92.50' · น้ำหนักของ SKU เงิน 'ว่าง = ใช้น้ำหนักจาก SKU' · ทอง/ไม่มี SKU ไม่ใช้ข้อความ SKU", async () => {
    renderCard(row());
    expect(screen.getByText(/ว่าง = 92.50/)).toBeInTheDocument();
    expect(screen.getByText(/ว่าง = ใช้น้ำหนักจาก SKU/)).toBeInTheDocument();
    await userEvent.click(metalRadio("ทอง"));
    expect(screen.queryByText(/ว่าง = 92.50/)).toBeNull();
    expect(screen.queryByText(/ว่าง = ใช้น้ำหนักจาก SKU/)).toBeNull();
  });
});

describe("rerender: การ์ดอื่นบันทึกแล้ว refresh — การ์ดที่แก้ค้างอยู่ไม่ถูกรีเซ็ต", () => {
  it("การ์ด A แก้ค้าง (จำนวน 31) · รับ row ใหม่ของ B (A เท่าเดิม) → A ยังเป็น 31 และ dirty · ถ้า A เองเปลี่ยนจริง (updatedAt ใหม่) → A ตั้ง baseline ใหม่", async () => {
    const rowA = row({ id: "i-a", sku: "AA-1" });
    const rowB = row({ id: "i-b", sku: "BB-1", productId: "p-2" });
    const onDirtyA = vi.fn();
    const ui = (a: ProductionOrderItemRow, b: ProductionOrderItemRow) => (
      <ToastProvider>
        <ProductionItemCard order={openOrder} row={a} onDirtyChange={onDirtyA} />
        <ProductionItemCard order={openOrder} row={b} />
      </ToastProvider>
    );
    const { rerender } = render(ui(rowA, rowB));
    const qtyA = () => screen.getAllByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ })[0] as HTMLInputElement;
    await userEvent.clear(qtyA());
    await userEvent.type(qtyA(), "31");
    await waitFor(() => expect(onDirtyA).toHaveBeenLastCalledWith("i-a", true));
    // B บันทึกแล้ว refresh: ได้ object row ใหม่ของ A (เนื้อหาเท่าเดิม) + B เปลี่ยน
    rerender(ui({ ...rowA }, { ...rowB, updatedAt: "2026-10-21T02:00:00Z", qtyPlanned: 99 }));
    expect(qtyA().value).toBe("31");
    expect(onDirtyA).toHaveBeenLastCalledWith("i-a", true);
    // A เองเปลี่ยนจริง → baseline ใหม่ (ไม่ dirty)
    rerender(ui({ ...rowA, updatedAt: "2026-10-21T03:00:00Z", qtyPlanned: 31 }, rowB));
    await waitFor(() => expect(qtyA().value).toBe("31"));
    await waitFor(() => expect(onDirtyA).toHaveBeenLastCalledWith("i-a", false));
  });
});

describe("โลหะล็อกเมื่อมีใบงาน (A.3.2)", () => {
  it("radiogroup aria-disabled + เหตุผลมีเลขใบงาน (aria-describedby) · กดเปลี่ยนไม่ได้ · เนื้อ/จำนวนยังแก้ได้ · บอกว่าน้ำหนักเป้าใบงานไม่เปลี่ยนตาม", async () => {
    renderCard(row(), { activeJobNo: "JB-0031" });
    const group = screen.getByRole("radiogroup", { name: "วัสดุ" });
    expect(group).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText(/เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่ · ยกเลิกใบงานก่อน แล้วแก้โลหะ/);
    expect(group.getAttribute("aria-describedby")).toBe(reason.id);
    // radio แต่ละตัวบอก aria-disabled ด้วย (ไม่ใช่แค่กลุ่ม — screen reader บางตัวอ่านที่ตัวเลือก)
    for (const r of screen.getAllByRole("radio")) expect(r).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(metalRadio("ทอง"));
    expect(metalRadio("เงิน").checked).toBe(true);
    expect(purityBox()).toBeEnabled();
    expect(qtyBox()).toBeEnabled();
    expect(screen.getByText("น้ำหนักเป้าของใบงานไม่เปลี่ยนตาม — แก้ที่ใบงานถ้าต้องการ")).toBeInTheDocument();
  });
  it("ไม่มีใบงาน → ไม่ล็อก ไม่มีข้อความ", () => {
    renderCard(row());
    expect(screen.getByRole("radiogroup", { name: "วัสดุ" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("รายการไม่มี SKU (A.3.3)", () => {
  const nosku = () =>
    row({ productId: null, sku: null, productName: null, pendingProductLabel: "แหวนทดลองลายใบไม้", currentCostType: null, currentUnitCost: null, skuMetal: null, skuPurity: null, skuWeightG: null, skuMetalKnown: false, effectiveWeightG: null, effectiveWeightSource: null });

  it("ป้าย 'ยังไม่ผูก SKU' (amber ไม่ใช่ error แดง) + ต้นทุน 'ยังคิดไม่ได้' + ไม่มีช่องแบบใหม่ + ไม่มีปุ่มผูก + ข้อความเตือนทางตัน · ไม่มีข้อความเทียบ SKU", () => {
    renderCard(nosku());
    expect(screen.getByText(/ยังไม่ผูก SKU/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ไม่มี SKU · แหวนทดลองลายใบไม้" })).toBeInTheDocument();
    expect(screen.getByText("ต้นทุน: ยังคิดไม่ได้ — ต้องผูก SKU ก่อน")).toBeInTheDocument();
    expect(screen.queryByText("แบบใหม่ (คิดค่าออกแบบ)")).toBeNull();
    expect(screen.queryByRole("button", { name: /ผูก SKU/ })).toBeNull();
    expect(screen.getByText(/ยกเลิกทั้งใบผลิตแล้วเปิดใหม่/)).toBeInTheDocument();
    expect(screen.queryByText(/สินค้านี้ยังไม่ระบุโลหะ/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("บันทึกส่งชื่อแบบ + metal เสมอ (DB ต้องการโลหะ) ไม่ส่ง productId", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: null, sku: null, name: "แหวนทดลองลายใบไม้", pendingProductLabel: "แหวนทดลองลายใบไม้", qtyPlanned: 5, isNewDesign: false, metal: "silver", purity: 0.925, weightG: null, weightSource: null } });
    renderCard(nosku());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "5");
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", pendingProductLabel: "แหวนทดลองลายใบไม้", qtyPlanned: 5, metal: "silver" });
  });
});

describe("โหมด spec: ช่อง 'แบบใหม่' อยู่ในการ์ด (ไม่บันทึกทันทีเหมือนเดิม — บันทึกด้วยปุ่ม)", () => {
  it("ติ๊กแล้ว dirty → กดบันทึกส่ง isNewDesign=true เท่านั้น", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "x", pendingProductLabel: null, qtyPlanned: 30, isNewDesign: true, metal: null, purity: null, weightG: null, weightSource: null } });
    renderCard(row({ currentCostType: "spec" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /แบบใหม่/ }));
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: "p-1", qtyPlanned: 30, isNewDesign: true });
  });
});

describe("ปุ่มลบ + dirty cleanup", () => {
  it("ลบเรียก onRemove ด้วย row · ปุ่มมี aria-label ระบุรายการ", async () => {
    const r = row();
    const { onRemove } = renderCard(r);
    await userEvent.click(screen.getByRole("button", { name: "ลบ GR-0007" }));
    expect(onRemove).toHaveBeenCalledWith(r);
  });
  it("unmount = รายงาน dirty=false (ไม่ทิ้งข้อติดค้างในเช็คลิสต์)", async () => {
    const { onDirtyChange, unmount } = renderCard(row());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "9");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith("i-1", true));
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith("i-1", false);
  });
});

describe("ใบ done / cancelled — อ่านอย่างเดียวจาก snapshot", () => {
  const done = { id: "po-1", poNo: "PO-0034", status: "done" as const };
  it("ไม่มีช่องกรอก/ปุ่มบันทึก/ปุ่มลบ · เนื้อ 96.50% · น้ำหนัก 3.200 g/ชิ้น · ต้นทุนที่ล็อกไว้ (ขีดฆ่าค่าเก่าเมื่อเปลี่ยน)", () => {
    render(
      <ToastProvider>
        <ProductionItemCard
          order={done}
          row={row({ orderStatus: "done", effectiveMetal: "gold", effectivePurity: 0.965, effectiveWeightG: 3.2, qtyDone: 28, stampedUnitCost: 1500, prevUnitCost: 1200, prevCostType: "fixed" })}
        />
      </ToastProvider>
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("96.50%")).toBeInTheDocument();
    expect(screen.getByText("3.200 g/ชิ้น")).toBeInTheDocument();
    expect(screen.getByText(/ผลิตเข้าแล้ว 28 ชิ้น/)).toBeInTheDocument();
    expect(screen.getByText(/ต้นทุนที่ล็อกไว้:/)).toBeInTheDocument();
  });
  it("ค่าว่างแสดง 'ไม่ได้ระบุ' ไม่ใช่ 0", () => {
    render(
      <ToastProvider>
        <ProductionItemCard order={done} row={row({ orderStatus: "done", effectivePurity: null, effectiveWeightG: null })} />
      </ToastProvider>
    );
    expect(screen.getAllByText("ไม่ได้ระบุ")).toHaveLength(2);
  });
});

describe("a11y", () => {
  it("การ์ดเป็น section มี aria-label + tabIndex -1 (ให้เช็คลิสต์ focus ได้) · ทุกช่องมี label ผูกด้วย htmlFor", () => {
    renderCard(row());
    const card = screen.getByRole("region", { name: "รายการ GR-0007 · แหวนลายใบไม้" });
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(card.id).toBe("po-item-i-1");
    expect(within(card).getAllByRole("radio")).toHaveLength(3);
  });
  it("radio โลหะ: ลูกศรเลื่อนได้ด้วย native radio (name เดียวกัน)", () => {
    renderCard(row());
    const names = new Set(within(screen.getByRole("radiogroup", { name: "วัสดุ" })).getAllByRole("radio").map((r) => r.getAttribute("name")));
    expect(names.size).toBe(1);
    fireEvent.click(metalRadio("ทอง"));
    expect(metalRadio("ทอง").checked).toBe(true);
  });
});
