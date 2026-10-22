// @vitest-environment jsdom
// /oem/gems — แท็บ · ตารางรายการ (ราคา/ยังไม่มีราคา/กรอง) · ตั้งราคา (ตรวจก่อนส่ง + note ย้อนหลัง) · รายละเอียด (ประวัติ/ลบเฉพาะไม่ถูกใช้) · รวมชื่อ (preview ก่อนปุ่ม) · เปลี่ยนชื่อ · เพิ่มรายการ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/oem/gems" }));

const A = {
  setGemPrice: vi.fn(),
  getGemPriceHistory: vi.fn(),
  removeGem: vi.fn(),
  setGemActive: vi.fn(),
  previewGemMerge: vi.fn(),
  mergeGem: vi.fn(),
  renameGem: vi.fn(),
  createGemItem: vi.fn(),
  getGemOptions: vi.fn(),
};
vi.mock("@/lib/actions/gems", () => ({
  setGemPrice: (...a: unknown[]) => A.setGemPrice(...a),
  getGemPriceHistory: (...a: unknown[]) => A.getGemPriceHistory(...a),
  removeGem: (...a: unknown[]) => A.removeGem(...a),
  setGemActive: (...a: unknown[]) => A.setGemActive(...a),
  previewGemMerge: (...a: unknown[]) => A.previewGemMerge(...a),
  mergeGem: (...a: unknown[]) => A.mergeGem(...a),
  renameGem: (...a: unknown[]) => A.renameGem(...a),
  createGemItem: (...a: unknown[]) => A.createGemItem(...a),
  getGemOptions: (...a: unknown[]) => A.getGemOptions(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { GemCatalogClient } from "@/components/domain/gems/GemCatalogClient";
import { mergePairs } from "@/components/domain/gems/GemMergeSuggestions";
import { dateIssue, priceIssue } from "@/components/domain/gems/GemPriceDialog";
import { isRecentFromShop } from "@/components/domain/gems/GemItemsTable";
import type { GemCatalog, GemCatalogItem, GemCatalogName } from "@/lib/jobs/gems";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-22";

const name = (n: number, nm: string, o: Partial<GemCatalogName> = {}): GemCatalogName => ({
  id: id(n), name: nm, isActive: true, mergedInto: null, mergedIntoName: null, via: "office", createdAt: "2026-10-01T03:00:00Z", itemCount: 1, usedJobsOpen: 0, usedTemplates: 0, ...o,
});
const item = (n: number, o: Partial<GemCatalogItem> = {}): GemCatalogItem => ({
  gemItemId: id(100 + n), typeId: id(1), typeName: "โกเมน", shapeId: id(11), shapeName: "ไข่", sizeA: 4, sizeB: 6, sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม.",
  isActive: true, mergedInto: null, via: "office", createdAt: "2026-09-01T03:00:00Z", price: 12.5, priceEffectiveFrom: "2026-10-01", priceSupplier: null, hasPrice: true, priceRows: 1, usedJobsOpen: 3, usedJobsTotal: 5, usedTemplates: 1, ...o,
});

const CAT: GemCatalog = {
  types: [name(1, "โกเมน", { usedJobsOpen: 12, usedTemplates: 3, itemCount: 5 }), name(2, "โกเมนต์", { via: "shopfloor", createdAt: "2026-10-20T05:00:00Z", usedJobsOpen: 1, usedTemplates: 1, itemCount: 1 }), name(3, "ทับทิม", { itemCount: 0 }), name(4, "CZ", { itemCount: 2, usedJobsOpen: 4 })],
  shapes: [{ ...name(11, "ไข่"), hasLength: true }, { ...name(12, "กลม"), hasLength: false }],
  items: [
    item(1),
    item(2, { sizeA: 5, sizeB: 7, sizeLabel: "5×7", label: "โกเมน · ไข่ · 5×7 มม.", price: null, hasPrice: false, priceEffectiveFrom: null, usedJobsOpen: 0, usedJobsTotal: 0, usedTemplates: 0 }),
    item(3, { typeId: id(4), typeName: "CZ", shapeId: id(12), shapeName: "กลม", sizeA: 1.5, sizeB: null, sizeLabel: "1.5", label: "CZ · กลม · 1.5 มม.", via: "shopfloor", createdAt: "2026-10-20T05:00:00Z", price: 0.35, priceEffectiveFrom: "2026-10-20" }),
    item(4, { typeId: id(9), typeName: "เก่า", sizeLabel: "9", sizeA: 9, sizeB: null, label: "เก่า · ไข่ · 9 มม.", isActive: false }),
  ],
};

const open = (cat: GemCatalog = CAT, tab: "items" | "types" | "shapes" = "items") => wrap(<GemCatalogClient catalog={cat} todayBkk={TODAY} initialTab={tab} />);

beforeEach(() => {
  vi.clearAllMocks();
  A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [], items: [] } });
});

describe("pure helpers", () => {
  it("priceIssue: 0 · ติดลบ · NaN · ทศนิยม 5 ตำแหน่ง · > 1,000,000 ปฏิเสธ · 0.0001 และ 1,000,000 ผ่าน · รับ , เป็นจุด", () => {
    for (const bad of ["", "0", "0.0000", "-1", "abc", "NaN", "1e3", "0.12345", "1000000.01", "10000000"]) expect(priceIssue(bad), bad).not.toBeNull();
    for (const ok of ["0.0001", "12.5", "1000000", "3,5"]) expect(priceIssue(ok), ok).toBeNull();
  });
  it("dateIssue: ก่อน 2020 · เกินหนึ่งปีข้างหน้า · รูปแบบผิด ปฏิเสธ", () => {
    expect(dateIssue("2019-12-31", TODAY)).not.toBeNull();
    expect(dateIssue("2027-10-23", TODAY)).not.toBeNull();
    expect(dateIssue("2026-13-45", TODAY)).not.toBeNull();
    expect(dateIssue("2020-01-01", TODAY)).toBeNull();
    expect(dateIssue("2027-10-22", TODAY)).toBeNull();
  });
  it("isRecentFromShop: เฉพาะจากหน้างานใน 7 วัน (วันไทย)", () => {
    expect(isRecentFromShop({ via: "shopfloor", createdAt: "2026-10-16T05:00:00Z" }, TODAY)).toBe(true);
    expect(isRecentFromShop({ via: "shopfloor", createdAt: "2026-10-14T05:00:00Z" }, TODAY)).toBe(false);
    expect(isRecentFromShop({ via: "office", createdAt: "2026-10-20T05:00:00Z" }, TODAY)).toBe(false);
  });
  it("mergePairs: โกเมน↔โกเมนต์ คู่เดียว · ทับทิม/CZ ไม่ถูกจับ · a = ตัวที่ใช้น้อยกว่า", () => {
    const p = mergePairs(CAT.types);
    expect(p).toHaveLength(1);
    expect(p[0].a.name).toBe("โกเมนต์");
    expect(p[0].b.name).toBe("โกเมน");
  });
});

describe("แท็บ", () => {
  it("tablist 3 แท็บ · ค่าเริ่ม = รายการพลอย · ลูกศรสลับแท็บ · aria-selected", async () => {
    const user = userEvent.setup();
    open();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["รายการพลอย", "ชนิด", "รูปทรง"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "ชนิด" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("gem-names-type")).toBeInTheDocument();
  });
  it("initialTab=shapes เปิดแท็บรูปทรง พร้อมคอลัมน์ 'ขนาดกี่ค่า'", () => {
    open(CAT, "shapes");
    expect(screen.getByTestId("gem-names-shape")).toHaveTextContent("2 ค่า (กว้าง×ยาว)");
    expect(screen.getByTestId("gem-names-shape")).toHaveTextContent("1 ค่า");
  });
});

describe("รายการพลอย — 4 state", () => {
  it("success: ราคาแสดงเป็นเลข (บาทต่อเม็ด) · ไม่มีราคา = chip amber 'ยังไม่มีราคา' (ไม่ใช่ 0 ไม่ใช่ —) · ซ่อนที่ปิดใช้งานเป็นค่าเริ่ม", () => {
    open();
    const t = screen.getByTestId("gem-items-table");
    expect(within(t).getByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." })).toHaveTextContent("12.50");
    const no = within(t).getByRole("row", { name: "โกเมน · ไข่ · 5×7 มม." });
    expect(no).toHaveTextContent("ยังไม่มีราคา");
    expect(no).not.toHaveTextContent(/\b0\.00\b/);
    expect(within(t).getByRole("row", { name: "CZ · กลม · 1.5 มม." })).toHaveTextContent("0.35");
    expect(within(t).queryByRole("row", { name: /เก่า/ })).not.toBeInTheDocument();
  });
  it("ราคาทศนิยม 4 ตำแหน่งแสดงครบ (ไม่ปัดเงียบ)", () => {
    open({ ...CAT, items: [item(1, { price: 0.0125 })] });
    expect(screen.getByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." })).toHaveTextContent("0.0125");
  });
  it("ติ๊ก 'แสดงที่ปิดใช้งาน' → เห็นแถวปิด", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("checkbox", { name: "แสดงที่ปิดใช้งาน" }));
    expect(screen.getByRole("row", { name: /เก่า/ })).toHaveTextContent("ปิดใช้งาน");
  });
  it("tile กรอง aria-pressed: ยังไม่มีราคา 1 · จากหน้างาน 7 วัน 1 · กดแล้วเหลือแถวเดียว", async () => {
    const user = userEvent.setup();
    open();
    const tiles = screen.getByRole("group", { name: "กรองด่วน" });
    expect(within(tiles).getByRole("button", { name: /ยังไม่มีราคา/ })).toHaveTextContent("1");
    await user.click(within(tiles).getByRole("button", { name: /ยังไม่มีราคา/ }));
    expect(within(tiles).getByRole("button", { name: /ยังไม่มีราคา/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("gem-items-table")).getAllByRole("row")).toHaveLength(2); // หัว + 1
    await user.click(within(tiles).getByRole("button", { name: /เพิ่มจากหน้างาน/ }));
    expect(screen.getByRole("row", { name: "CZ · กลม · 1.5 มม." })).toBeInTheDocument();
  });
  it("empty (กรองแล้วไม่เจอ): ข้อความ + ล้างตัวกรอง", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("ค้นหาชื่อ"), "ไพลิน");
    expect(screen.getByText("ไม่พบรายการที่ตรงกับตัวกรอง")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(screen.getByTestId("gem-items-table")).toBeInTheDocument();
  });
  it("ค้นหาไม่สนช่องว่าง/ตัวพิมพ์: 'cz กลม' เจอ CZ", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("ค้นหาชื่อ"), "cz กลม");
    expect(screen.getByRole("row", { name: "CZ · กลม · 1.5 มม." })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: "โกเมน · ไข่ · 4×6 มม." })).not.toBeInTheDocument();
  });
  it("empty (ไม่มีรายการเลย — ไม่ seed): คำอธิบาย + ปุ่มเพิ่มรายการ", () => {
    open({ types: [], shapes: [], items: [] });
    expect(screen.getByText("ยังไม่มีรายการพลอย")).toBeInTheDocument();
    expect(screen.getByText(/รายการจะเข้ามาเองเมื่อหน้างานหรือออฟฟิศใส่พลอยในใบงาน/)).toBeInTheDocument();
  });
});

describe("ตั้งราคา", () => {
  async function openPrice(label = "โกเมน · ไข่ · 5×7 มม.") {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: `ตั้งราคา ${label}` }));
    return user;
  }
  it("รายการที่ยังไม่เคยตั้งราคา: 'ยังไม่เคยตั้งราคา' · วันเริ่มต้น = วันนี้", async () => {
    await openPrice();
    expect(screen.getByTestId("gem-price-current")).toHaveTextContent("ยังไม่เคยตั้งราคา");
    expect((screen.getByLabelText(/มีผลตั้งแต่/) as HTMLInputElement).value).toBe(TODAY);
  });
  it("ราคาที่มีอยู่: แสดง 'ราคาปัจจุบัน … บาท/เม็ด · ตั้งแต่ …'", async () => {
    await openPrice("โกเมน · ไข่ · 4×6 มม.");
    expect(screen.getByTestId("gem-price-current")).toHaveTextContent("ราคาปัจจุบัน 12.50 บาท/เม็ด · ตั้งแต่ 1 ต.ค. 2569");
  });
  it("ราคา 0 / NaN / ทศนิยมเกิน / เกิน 1,000,000: ไม่ส่ง DB · ข้อความตามสเปก · ค่าที่กรอกอยู่", async () => {
    const user = await openPrice();
    const price = screen.getByLabelText(/ราคาใหม่/);
    for (const bad of ["0", "abc", "1.23456", "1000001"]) {
      await user.clear(price);
      await user.type(price, bad);
      await user.click(screen.getByRole("button", { name: "บันทึกราคา" }));
      expect(screen.getByText(/ราคาต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท/)).toBeInTheDocument();
      expect((price as HTMLInputElement).value).toBe(bad);
    }
    expect(A.setGemPrice).not.toHaveBeenCalled();
  });
  it("วันที่ก่อน 2020: ปฏิเสธ", async () => {
    const user = await openPrice();
    await user.type(screen.getByLabelText(/ราคาใหม่/), "1");
    const d = screen.getByLabelText(/มีผลตั้งแต่/);
    await user.clear(d);
    await user.type(d, "2019-01-01");
    await user.click(screen.getByRole("button", { name: "บันทึกราคา" }));
    expect(screen.getByText(/วันที่มีผลต้องอยู่ระหว่างปี 2020/)).toBeInTheDocument();
    expect(A.setGemPrice).not.toHaveBeenCalled();
  });
  it("บันทึกวันนี้: ส่ง price เป็นข้อความ + effectiveFrom + ไม่บังคับ note · toast + ปิด", async () => {
    A.setGemPrice.mockResolvedValue({ ok: true, data: { effectiveFrom: TODAY, replaced: false } });
    const user = await openPrice();
    await user.type(screen.getByLabelText(/ราคาใหม่/), "12.5");
    await user.click(screen.getByRole("button", { name: "บันทึกราคา" }));
    await waitFor(() => expect(A.setGemPrice).toHaveBeenCalledTimes(1));
    expect(A.setGemPrice).toHaveBeenCalledWith({ itemId: id(102), price: "12.5", effectiveFrom: TODAY, supplier: null, note: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
  it("ตั้งราคาย้อนหลัง = หมายเหตุบังคับ (aria-disabled จนมีตัวอักษรจริง · อีโมจิ/จุดล้วนไม่ผ่าน)", async () => {
    A.setGemPrice.mockResolvedValue({ ok: true, data: { effectiveFrom: "2026-10-01", replaced: false } });
    const user = await openPrice();
    await user.type(screen.getByLabelText(/ราคาใหม่/), "2");
    const d = screen.getByLabelText(/มีผลตั้งแต่/);
    await user.clear(d);
    await user.type(d, "2026-10-01");
    expect(screen.getByText(/ตั้งราคาย้อนหลัง ต้องระบุเหตุผล/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "บันทึกราคา" });
    await user.click(save);
    expect(A.setGemPrice).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/หมายเหตุ/), " . 👍 ");
    await user.click(save);
    expect(A.setGemPrice).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/หมายเหตุ/), "แก้ตามใบเสร็จ");
    await user.click(save);
    await waitFor(() => expect(A.setGemPrice).toHaveBeenCalledTimes(1));
    expect(A.setGemPrice.mock.calls[0][0].note).toContain("แก้ตามใบเสร็จ");
  });
  it("ทับวันเดิม (วันที่เท่ากับราคาปัจจุบัน) = ต้องหมายเหตุ", async () => {
    const user = await openPrice("โกเมน · ไข่ · 4×6 มม.");
    await user.type(screen.getByLabelText(/ราคาใหม่/), "13");
    const d = screen.getByLabelText(/มีผลตั้งแต่/);
    await user.clear(d);
    await user.type(d, "2026-10-01");
    expect(screen.getByText(/แก้ราคาทับวันเดิม ต้องระบุเหตุผล/)).toBeInTheDocument();
  });
  it("DB ปฏิเสธ (error ไทย) → แสดงในกล่อง ไม่ปิด · ค่าที่กรอกอยู่ · note_required จาก DB ทำให้ช่องหมายเหตุบังคับ", async () => {
    A.setGemPrice.mockResolvedValue({ ok: false, error: "แก้ราคาทับวันเดิม หรือตั้งราคาย้อนหลัง ต้องระบุหมายเหตุ (เหตุผลที่แก้)", code: "note_required" });
    const user = await openPrice();
    await user.type(screen.getByLabelText(/ราคาใหม่/), "5");
    await user.click(screen.getByRole("button", { name: "บันทึกราคา" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ต้องระบุหมายเหตุ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((screen.getByLabelText(/ราคาใหม่/) as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("* จำเป็น")).toBeInTheDocument();
  });
});

describe("รายละเอียดรายการ", () => {
  const HIST = { ok: true, data: { rows: [{ effectiveFrom: "2026-10-01", price: 12.5, supplier: "ร้าน ก", note: null, updatedAt: null }], audit: [{ action: "update", effectiveFrom: "2026-10-01", oldPrice: 11, newPrice: 12.5, note: "แก้ตามบิล", actor: null, recordedAt: "2026-10-02T03:00:00Z" }] } };
  it("loading → ประวัติราคา + audit (old → new + note)", async () => {
    let resolve!: (v: unknown) => void;
    A.getGemPriceHistory.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "รายละเอียด โกเมน · ไข่ · 4×6 มม." }));
    expect(screen.getByRole("status", { name: "กำลังโหลดประวัติราคา" })).toBeInTheDocument();
    resolve(HIST);
    const tbl = await screen.findByTestId("gem-price-history");
    expect(tbl).toHaveTextContent("12.50");
    expect(tbl).toHaveTextContent("ร้าน ก");
    expect(screen.getByTestId("gem-price-audit")).toHaveTextContent("11.00 → 12.50");
    expect(screen.getByTestId("gem-price-audit")).toHaveTextContent("แก้ตามบิล");
  });
  it("error: ข้อความ + ลองอีกครั้ง", async () => {
    A.getGemPriceHistory.mockResolvedValueOnce({ ok: false, error: "โหลดไม่สำเร็จ" }).mockResolvedValueOnce(HIST);
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "รายละเอียด โกเมน · ไข่ · 4×6 มม." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดไม่สำเร็จ");
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByTestId("gem-price-history")).toBeInTheDocument();
  });
  it("รายการที่ถูกใช้: ไม่มีปุ่มลบ + ข้อความ 'ลบไม่ได้ — ถูกใช้ใน n ใบงาน'", async () => {
    A.getGemPriceHistory.mockResolvedValue(HIST);
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "รายละเอียด โกเมน · ไข่ · 4×6 มม." }));
    expect(screen.queryByRole("button", { name: "ลบรายการ" })).not.toBeInTheDocument();
    expect(screen.getByTestId("gem-no-delete")).toHaveTextContent("ลบไม่ได้ — ถูกใช้ใน 5 ใบงาน และ 1 แม่แบบ");
  });
  it("รายการที่ไม่ถูกใช้: ลบได้ผ่านกล่องยืนยัน (โฟกัสเริ่มที่ยกเลิก) → removeGem(kind=item)", async () => {
    A.getGemPriceHistory.mockResolvedValue({ ok: true, data: { rows: [], audit: [] } });
    A.removeGem.mockResolvedValue({ ok: true, data: { removed: true } });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "รายละเอียด โกเมน · ไข่ · 5×7 มม." }));
    await user.click(await screen.findByRole("button", { name: "ลบรายการ" }));
    const c = await screen.findByTestId("gem-confirm");
    await waitFor(() => expect(within(c).getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
    await user.click(within(c).getByRole("button", { name: "ลบรายการ" }));
    await waitFor(() => expect(A.removeGem).toHaveBeenCalledWith({ kind: "item", id: id(102) }));
  });
  it("ปิดใช้งาน → setGemActive(active=false)", async () => {
    A.getGemPriceHistory.mockResolvedValue({ ok: true, data: { rows: [], audit: [] } });
    A.setGemActive.mockResolvedValue({ ok: true, data: { isActive: false } });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "รายละเอียด โกเมน · ไข่ · 4×6 มม." }));
    await user.click(await screen.findByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(A.setGemActive).toHaveBeenCalledWith({ kind: "item", id: id(101), active: false }));
  });
});

describe("ชนิด/รูปทรง — ลบเฉพาะที่ไม่ถูกใช้ · เปลี่ยนชื่อ · ข้อเสนอรวมชื่อ", () => {
  it("ปุ่มลบมีเฉพาะชื่อที่ไม่ถูกใช้เลย (ทับทิม) · โกเมน/CZ ไม่มีปุ่มลบ", () => {
    open(CAT, "types");
    expect(screen.getByRole("button", { name: "ลบ ทับทิม" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลบ โกเมน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลบ CZ" })).not.toBeInTheDocument();
  });
  it("ลบ: กล่องยืนยัน → removeGem(kind=type)", async () => {
    A.removeGem.mockResolvedValue({ ok: true, data: { removed: true } });
    const user = userEvent.setup();
    open(CAT, "types");
    await user.click(screen.getByRole("button", { name: "ลบ ทับทิม" }));
    await user.click(within(await screen.findByTestId("gem-confirm")).getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(A.removeGem).toHaveBeenCalledWith({ kind: "type", id: id(3) }));
  });
  it("ข้อเสนอรวมชื่อ: โกเมนต์↔โกเมน · ซ่อนเมื่อไม่มีคู่", () => {
    const { unmount } = open(CAT, "types");
    expect(screen.getByTestId("gem-merge-suggestions")).toHaveTextContent("“โกเมนต์” ↔ “โกเมน”");
    unmount();
    open({ ...CAT, types: [name(3, "ทับทิม"), name(4, "ไพลิน")] }, "types");
    expect(screen.queryByTestId("gem-merge-suggestions")).not.toBeInTheDocument();
  });
  it("ปิดใช้งาน/ที่ถูกรวมแล้ว: ซ่อนเป็นค่าเริ่ม · แสดง 'รวมเข้ากับ …' เมื่อติ๊ก", async () => {
    const user = userEvent.setup();
    open({ ...CAT, types: [name(1, "โกเมน"), name(2, "โกเมนต์", { mergedInto: id(1), mergedIntoName: "โกเมน", isActive: false })] }, "types");
    expect(screen.queryByText(/รวมเข้ากับ โกเมน/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "แสดงที่ปิดใช้งาน" }));
    expect(screen.getByText(/รวมเข้ากับ โกเมน/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เปลี่ยนชื่อ โกเมนต์/ })).not.toBeInTheDocument();
  });
  it("เปลี่ยนชื่อ: ชื่อเดิม/เลขล้วนปฏิเสธก่อนส่ง · ส่ง renameGem · คล้าย → กล่อง amber + ยืนยัน force", async () => {
    A.renameGem.mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้าย", code: "gem_similar", gem: { code: "gem_similar", similar: [{ kind: "type", name: "ทับทิม2", rows: [], matches: [{ id: id(1), name: "โกเมน" }] }] } });
    A.renameGem.mockResolvedValueOnce({ ok: true, data: { name: "ทับทิม2" } });
    const user = userEvent.setup();
    open(CAT, "types");
    await user.click(screen.getByRole("button", { name: "เปลี่ยนชื่อ ทับทิม" }));
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));
    expect(screen.getByText("⚠ ชื่อยังเหมือนเดิม")).toBeInTheDocument();
    const inp = screen.getByLabelText(/ชื่อใหม่/);
    await user.clear(inp);
    await user.type(inp, "12");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));
    expect(screen.getByText(/ชื่อต้องมี 2-40 ตัวอักษร/)).toBeInTheDocument();
    expect(A.renameGem).not.toHaveBeenCalled();
    await user.clear(inp);
    await user.type(inp, "ทับทิม2");
    await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));
    expect(await screen.findByTestId("gem-rename-similar")).toHaveTextContent("คล้ายกับ “โกเมน”");
    await user.click(screen.getByRole("button", { name: /ยืนยัน — เป็นคนละตัว/ }));
    await waitFor(() => expect(A.renameGem).toHaveBeenLastCalledWith({ kind: "type", id: id(3), name: "ทับทิม2", force: true }));
  });
});

describe("รวมชื่อ A → B", () => {
  const PLAN = { from: { id: id(2), name: "โกเมนต์" }, into: { id: id(1), name: "โกเมน" }, itemsMoved: 1, itemsCollapsed: 2, pricesNotMoved: 3, collapsedMissingPriceOnTarget: 0, templateLinesRepointed: 1, templateLinesSummed: 0, templateQtyOverflow: 0, templateProducts: [id(50)], jobsOpenUsing: 1, jobsUsingTotal: 4 };
  async function openMerge(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /รวมชื่อ โกเมนต์ เข้ากับ โกเมน/ }));
  }
  it("เปิดจากข้อเสนอ: A/B ถูกเลือกให้ · loading 'กำลังตรวจผลกระทบ…' + ปุ่มรวม aria-disabled → preview มาแล้วจึงรวมได้", async () => {
    let resolve!: (v: unknown) => void;
    A.previewGemMerge.mockReturnValue(new Promise((r) => (resolve = r)));
    A.mergeGem.mockResolvedValue({ ok: true, data: PLAN });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    expect((screen.getByLabelText(/ชื่อที่จะเลิกใช้/) as HTMLSelectElement).value).toBe(id(2));
    expect((screen.getByLabelText(/เปลี่ยนไปใช้ชื่อ/) as HTMLSelectElement).value).toBe(id(1));
    expect(screen.getAllByText("กำลังตรวจผลกระทบ…").length).toBeGreaterThan(0);
    const btn = screen.getByRole("button", { name: "รวมชื่อ" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await user.click(btn);
    expect(A.mergeGem).not.toHaveBeenCalled();
    resolve({ ok: true, data: PLAN });
    const eff = await screen.findByTestId("gem-merge-effects");
    expect(btn).not.toHaveAttribute("aria-disabled");
    expect(eff).toHaveTextContent("รายการพลอย 1 ขนาด และแม่แบบ SKU 1 รายการ ย้ายไปอยู่ภายใต้ “โกเมน”");
    expect(eff).toHaveTextContent("ราคาของ “โกเมนต์” 3 ราคา จะไม่ถูกย้าย");
    expect(eff).toHaveTextContent("ใบงานที่เปิดแล้ว (4 ใบ) ยังแสดงชื่อเดิมตอนสั่ง (“โกเมนต์”) ไม่เปลี่ยน");
    expect(eff).toHaveTextContent("ย้อนกลับไม่ได้");
    await user.click(btn);
    await waitFor(() => expect(A.mergeGem).toHaveBeenCalledWith({ kind: "type", fromId: id(2), intoId: id(1) }));
  });
  it("focus เริ่มที่ 'ยกเลิก' (ปุ่มรวมเป็น danger outline ไม่ใช่ primary)", async () => {
    A.previewGemMerge.mockResolvedValue({ ok: true, data: PLAN });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "รวมชื่อ" }).className).not.toContain("bg-primary-600");
  });
  it("preview ล้ม: 'ตรวจผลกระทบไม่ได้ — ลองอีกครั้ง' · ปุ่มรวมกดไม่ได้ · ลองอีกครั้งแล้วผ่าน", async () => {
    A.previewGemMerge.mockResolvedValueOnce({ ok: false, error: "ขัดข้อง" }).mockResolvedValueOnce({ ok: true, data: PLAN });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ตรวจผลกระทบไม่ได้ — ลองอีกครั้ง");
    expect(screen.getByRole("button", { name: "รวมชื่อ" })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(alert).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByTestId("gem-merge-effects")).toBeInTheDocument();
  });
  it("B ว่างราคาแต่ A มีราคา → เตือน amber (ไม่บล็อก)", async () => {
    A.previewGemMerge.mockResolvedValue({ ok: true, data: { ...PLAN, collapsedMissingPriceOnTarget: 1 } });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    expect(await screen.findByTestId("gem-merge-price-warn")).toHaveTextContent("“โกเมน” ยังไม่มีราคา ส่วนของ “โกเมนต์” มีราคา — ตั้งราคาให้ “โกเมน” หลังรวม");
    expect(screen.getByRole("button", { name: "รวมชื่อ" })).not.toHaveAttribute("aria-disabled");
  });
  it("แม่แบบรวมแล้วเกิน 1,000 → บล็อก (aria-disabled + เหตุผล)", async () => {
    A.previewGemMerge.mockResolvedValue({ ok: true, data: { ...PLAN, templateQtyOverflow: 2 } });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    await screen.findByTestId("gem-merge-effects");
    expect(screen.getAllByText(/เกิน 1,000 — แก้แม่แบบเหล่านั้นก่อนรวม/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "รวมชื่อ" })).toHaveAttribute("aria-disabled", "true");
  });
  it("A ≠ B: ตัวเลือก B ไม่มี A · เลือก A เท่ากับ B เดิม → ล้าง B", async () => {
    A.previewGemMerge.mockResolvedValue({ ok: true, data: PLAN });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    const bSel = screen.getByLabelText(/เปลี่ยนไปใช้ชื่อ/) as HTMLSelectElement;
    expect([...bSel.options].map((o) => o.value)).not.toContain(id(2));
    await user.selectOptions(screen.getByLabelText(/ชื่อที่จะเลิกใช้/), id(1));
    expect((screen.getByLabelText(/เปลี่ยนไปใช้ชื่อ/) as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "รวมชื่อ" })).toHaveAttribute("aria-disabled", "true");
  });
  it("DB ปฏิเสธการรวม (เช่น gem_merge_blocked) → ข้อความในกล่อง ไม่ปิด", async () => {
    A.previewGemMerge.mockResolvedValue({ ok: true, data: PLAN });
    A.mergeGem.mockResolvedValue({ ok: false, error: "รวมชื่อไม่ได้ — มีรายการที่ติดเงื่อนไข ตรวจรายการนั้นก่อนรวม" });
    const user = userEvent.setup();
    open(CAT, "types");
    await openMerge(user);
    await screen.findByTestId("gem-merge-effects");
    await user.click(screen.getByRole("button", { name: "รวมชื่อ" }));
    expect(await screen.findByText(/รวมชื่อไม่ได้ — มีรายการที่ติดเงื่อนไข/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("เพิ่มรายการ (ทางรอง)", () => {
  it("เปิด → กรอกชนิด/รูปทรง/ขนาด → createGemItem(ไม่มีจำนวนจากผู้ใช้) · ปุ่ม aria-disabled จนครบ", async () => {
    A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [{ id: id(1), name: "โกเมน" }], shapes: [{ id: id(12), name: "กลม", hasLength: false }], items: [] } });
    A.createGemItem.mockResolvedValue({ ok: true, data: { gemItemId: id(200), label: "โกเมน · กลม · 2 มม.", created: true } });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "＋ เพิ่มรายการ" }));
    const dlg = await screen.findByRole("dialog");
    const submit = within(dlg).getByRole("button", { name: "เพิ่มรายการ" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(A.getGemOptions).toHaveBeenCalled());
    await user.click(within(dlg).getByRole("button", { name: /ชนิดพลอย/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการชนิดพลอย/ })).getByRole("option", { name: "โกเมน" }));
    await user.click(within(dlg).getByRole("button", { name: /รูปทรง/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการรูปทรง/ })).getByRole("option", { name: /^กลม/ }));
    await user.type(within(dlg).getByLabelText("ขนาด (มม.)"), "2");
    expect(submit).not.toHaveAttribute("aria-disabled");
    await user.click(submit);
    await waitFor(() => expect(A.createGemItem).toHaveBeenCalledTimes(1));
    expect(A.createGemItem.mock.calls[0][0]).toMatchObject({ typeId: id(1), shapeId: id(12), sizeA: 2, qtyPerPiece: 1 });
    expect(A.createGemItem.mock.calls[0][1]).toBe(false);
  });
});

describe("🔴 สิทธิ์ราคา: หน้าแคตตาล็อกไม่เรียก action ราคาตอนโหลด", () => {
  it("เปิดหน้าเฉยๆ ไม่เรียก setGemPrice/getGemPriceHistory", () => {
    open();
    expect(A.setGemPrice).not.toHaveBeenCalled();
    expect(A.getGemPriceHistory).not.toHaveBeenCalled();
  });
});
