// @vitest-environment jsdom
// G1a: แม่แบบพลอยของ SKU — ปุ่มในแถว /catalog (ไม่แตะ ProductForm) · กล่องแก้แม่แบบ 4 state · ล้างทั้งหมดต้องยืนยัน · ไม่มีราคา/รวมทั้งใบ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/catalog" }));
const A = { getSkuGemTemplate: vi.fn(), saveSkuGemTemplate: vi.fn(), getGemOptions: vi.fn() };
vi.mock("@/lib/actions/gems", () => ({
  getSkuGemTemplate: (...a: unknown[]) => A.getSkuGemTemplate(...a),
  saveSkuGemTemplate: (...a: unknown[]) => A.saveSkuGemTemplate(...a),
  getGemOptions: (...a: unknown[]) => A.getGemOptions(...a),
}));
// ProductsPageClient ลาก action ของแคตตาล็อกมาด้วย — ไม่ใช่เรื่องของเทสต์นี้
vi.mock("@/lib/actions/catalog", () => ({ deleteProduct: vi.fn() }));
const productForm = vi.fn();
vi.mock("@/components/domain/catalog/ProductForm", () => ({ ProductForm: (p: unknown) => { productForm(p); return <div data-testid="product-form" />; } }));
vi.mock("@/components/domain/catalog/ProductImport", () => ({ ProductImport: () => <div /> }));

import { ToastProvider } from "@/components/ui/Toast";
import { SkuGemBomDialog } from "@/components/domain/catalog/SkuGemBomDialog";
import { ProductsPageClient } from "@/components/domain/catalog/ProductsPageClient";
import type { GemBomLine } from "@/lib/jobs/gems";
import type { ProductRow } from "@/lib/catalog/types";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const PID = "11111111-1111-4111-8111-111111111111";
const I1 = "44444444-4444-4444-8444-444444444441";
const line = (o: Partial<GemBomLine> = {}): GemBomLine => ({ id: null, gemItemId: I1, canonicalItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: null, position: "บ่า", source: null, renamed: false, via: null, ...o });
const dlg = (onClose = vi.fn()) => {
  wrap(<SkuGemBomDialog productId={PID} sku="RG-0418" name="แหวนโกเมนไข่" onClose={onClose} />);
  return onClose;
};
const save = () => screen.getByRole("button", { name: "บันทึกแม่แบบ" });

beforeEach(() => {
  vi.clearAllMocks();
  A.getSkuGemTemplate.mockResolvedValue({ ok: true, data: [line()] });
  A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [], items: [] } });
  A.saveSkuGemTemplate.mockResolvedValue({ ok: true, data: { summary: { changed: true, count: 1, createdTypes: [], createdShapes: [], createdItems: 0, reused: [], mergedRows: [] }, lines: [], window: null } });
});

describe("SkuGemBomDialog", () => {
  it("loading → skeleton · มีบรรทัดอธิบาย 'ใบที่เปิดแล้วไม่เปลี่ยน'", async () => {
    let resolve!: (v: unknown) => void;
    A.getSkuGemTemplate.mockReturnValue(new Promise((r) => (resolve = r)));
    dlg();
    expect(screen.getByRole("status", { name: "กำลังโหลดแม่แบบพลอย" })).toBeInTheDocument();
    expect(screen.getByText(/แม่แบบใช้เป็นค่าเริ่มของใบงานที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน/)).toBeInTheDocument();
    resolve({ ok: true, data: [line()] });
    expect(await screen.findByTestId("gem-row-label-1")).toBeInTheDocument();
    expect(A.getSkuGemTemplate).toHaveBeenCalledWith(PID);
  });
  it("empty: 'SKU นี้ยังไม่มีแม่แบบพลอย' + ทางไปกรอกที่ใบงาน", async () => {
    A.getSkuGemTemplate.mockResolvedValue({ ok: true, data: [] });
    dlg();
    expect(await screen.findByTestId("gem-empty")).toHaveTextContent("SKU นี้ยังไม่มีแม่แบบพลอย");
    expect(screen.getByText(/หรือกรอกที่ใบงานแล้วกด “ตั้งเป็นแม่แบบ SKU” ก็ได้/)).toBeInTheDocument();
  });
  it("error โหลด: ข้อความ + ลองอีกครั้ง", async () => {
    A.getSkuGemTemplate.mockResolvedValueOnce({ ok: false, error: "ขัดข้อง" }).mockResolvedValueOnce({ ok: true, data: [line()] });
    const user = userEvent.setup();
    dlg();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดแม่แบบพลอยไม่ได้");
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByTestId("gem-row-label-1")).toBeInTheDocument();
  });
  it("success: แก้จำนวน → บันทึก = ส่ง gemItemId ทั้งชุด · ไม่มีรวม/เผื่อ/ราคา · ปิดกล่อง", async () => {
    const user = userEvent.setup();
    const onClose = dlg();
    await screen.findByTestId("gem-row-label-1");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("gem-multiplier")).not.toBeInTheDocument();
    expect(screen.queryByTestId("gem-line-total-1")).not.toBeInTheDocument();
    const qty = screen.getByLabelText("จำนวนต่อชิ้น *");
    await user.clear(qty);
    await user.type(qty, "3");
    await user.click(save());
    await waitFor(() => expect(A.saveSkuGemTemplate).toHaveBeenCalledTimes(1));
    expect(A.saveSkuGemTemplate.mock.calls[0][0]).toEqual({ productId: PID, lines: [{ gemItemId: I1, qtyPerPiece: 3, position: "บ่า" }], force: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText("บันทึกแม่แบบพลอย RG-0418 แล้ว")).toBeInTheDocument();
  });
  it("ล้างทั้งหมด: ต้องยืนยัน (โฟกัสเริ่มที่ 'ไม่ล้าง') · ไม่ล้าง = ไม่ส่ง · ยืนยัน = ส่ง lines []", async () => {
    const user = userEvent.setup();
    dlg();
    await screen.findByTestId("gem-row-label-1");
    await user.click(screen.getByRole("button", { name: "ลบพลอยแถว 1" }));
    await user.click(save());
    const c = await screen.findByTestId("gem-confirm");
    expect(c).toHaveTextContent("ล้างแม่แบบพลอยของ RG-0418? ใบที่เปิดใหม่จะไม่มีพลอยมาให้");
    await waitFor(() => expect(within(c).getByRole("button", { name: "ไม่ล้าง" })).toHaveFocus());
    await user.click(within(c).getByRole("button", { name: "ไม่ล้าง" }));
    expect(A.saveSkuGemTemplate).not.toHaveBeenCalled();
    await user.click(save());
    await user.click(within(await screen.findByTestId("gem-confirm")).getByRole("button", { name: "ล้างแม่แบบ" }));
    await waitFor(() => expect(A.saveSkuGemTemplate).toHaveBeenCalledTimes(1));
    expect(A.saveSkuGemTemplate.mock.calls[0][0].lines).toEqual([]);
  });
  it("บันทึกล้ม: 'บันทึกแม่แบบไม่สำเร็จ — ลองอีกครั้ง (ค่าที่กรอกยังอยู่)' · ไม่ปิด · ค่าอยู่", async () => {
    A.saveSkuGemTemplate.mockResolvedValue({ ok: false, error: "ไม่พบ SKU ในร้านนี้", code: "gem_product_invalid", gem: { code: "gem_product_invalid" } });
    const user = userEvent.setup();
    const onClose = dlg();
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getByLabelText("จำนวนต่อชิ้น *");
    await user.clear(qty);
    await user.type(qty, "7");
    await user.click(save());
    expect(await screen.findByText(/บันทึกแม่แบบไม่สำเร็จ — ลองอีกครั้ง \(ค่าที่กรอกยังอยู่\)/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("จำนวนต่อชิ้น *") as HTMLInputElement).value).toBe("7");
  });
  it("แถวไม่ครบ: ไม่ส่ง · แสดงเหตุผลที่แถว", async () => {
    A.getSkuGemTemplate.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();
    dlg();
    await screen.findByTestId("gem-empty");
    await user.click(screen.getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(save());
    expect(A.saveSkuGemTemplate).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("พลอยแถว 1 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย");
  });
  it("🔴 ไม่มีราคา/ต้นทุน/เผื่อแตก ในกล่องแม่แบบ", async () => {
    const { container } = render(<ToastProvider><SkuGemBomDialog productId={PID} sku="RG-0418" name="x" onClose={vi.fn()} /></ToastProvider>);
    await screen.findByTestId("gem-row-label-1");
    expect(container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก/);
    expect(container.innerHTML).not.toMatch(/price|cost|thb/i);
  });
});

describe("/catalog — ปุ่มพลอยในแถว SKU", () => {
  const P = (o: Partial<ProductRow> = {}): ProductRow =>
    ({ productId: PID, sku: "RG-0418", name: "แหวนโกเมนไข่", category: null, isActive: true, costType: "fixed", effectiveUnitCost: 100, listPrice: 300, marginPct: 0.5, primaryImageUrl: null, primaryImageSmUrl: null, ...o }) as unknown as ProductRow;
  it("ปุ่ม aria-label 'พลอยต่อชิ้นของ RG-0418' เปิดกล่องแม่แบบ · ไม่เปิด ProductForm (ไม่ยัดในฟอร์มแก้ SKU)", async () => {
    const user = userEvent.setup();
    wrap(<ProductsPageClient products={[P()]} silverSpot={null} alerts={[]} />);
    await user.click(screen.getByRole("button", { name: "พลอยต่อชิ้นของ RG-0418" }));
    expect(await screen.findByRole("dialog", { name: /พลอยต่อชิ้น — RG-0418/ })).toBeInTheDocument();
    expect(screen.queryByTestId("product-form")).not.toBeInTheDocument();
    expect(A.getSkuGemTemplate).toHaveBeenCalledWith(PID);
  });
  it("ปุ่มแก้ไข SKU เดิมยังเปิด ProductForm ตามเดิม", async () => {
    const user = userEvent.setup();
    wrap(<ProductsPageClient products={[P()]} silverSpot={null} alerts={[]} />);
    await user.click(screen.getByRole("button", { name: "แก้ไข RG-0418" }));
    expect(await screen.findByTestId("product-form")).toBeInTheDocument();
    expect(A.getSkuGemTemplate).not.toHaveBeenCalled();
  });
});
