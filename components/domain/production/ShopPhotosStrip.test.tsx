// @vitest-environment jsdom
// OfficeAck แถบ "รูปจากหน้างาน" (W2 · UX §6): ดูใหญ่ · ★ ตั้งรูปหลัก · ลบรูปจากหน้างาน = บังคับเหตุผล (ชิป + พิมพ์เอง · whitelist ตัวอักษร/ตัวเลข) — ทดสอบผ่านหน้า /production/[id] จริง
//  ต้องถูก: 4 state (loading/empty/error/success) · ป้ายที่มาเฉพาะรูปปนหลายที่มา · ลบรูปหน้างานไม่มีเหตุผล = ปุ่ม aria-disabled ไม่เรียก server · เหตุผลล่องหน/ช่องว่าง/เครื่องหมายล้วน = ไม่ผ่าน
//  ต้องไม่พัง: ลบรูปออฟฟิศ/แคตตาล็อกไม่บังคับเหตุผล (เรียก removeJobPhoto(id) เหมือนเดิม) · ปุ่มรับทราบไม่ผูกกับรูป · ไม่มี ackJob = การ์ดเดิม · รับทราบแล้ว = ไม่มีแถบ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";
import type { JobPhotoRow } from "@/lib/jobs/photos";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const ack = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: vi.fn(),
  removeProductionOrderItemById: vi.fn(),
  saveProductionOrder: vi.fn(),
  previewProductionOrder: vi.fn(() => new Promise(() => {})),
  doneProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  getProductionItemPrefill: vi.fn(),
  acknowledgeProductionOrder: (...a: unknown[]) => ack(...a),
  bindProductionItemProduct: vi.fn(),
  setProductionItemLabel: vi.fn(),
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

const JOB = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  ack.mockResolvedValue({ ok: true, data: { productionOrderId: "po-1", poNo: "PO-0040", acknowledgedAt: "2026-10-21T03:00:00Z", jobsLogged: 1 } });
  getJobPhotos.mockResolvedValue({ ok: true, data: [photo(1), photo(2), photo(3)] });
  setPrimaryJobPhoto.mockResolvedValue({ ok: true, data: null });
  removeJobPhoto.mockResolvedValue({ ok: true, data: { promotedPhotoId: null } });
});
afterEach(cleanup);

const u = (id: string, v: "sm" | "md", t = "a") => `https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/${id}_${v}.jpg?token=${t}`;
const photo = (n: number, o: Partial<JobPhotoRow> = {}): JobPhotoRow => ({ id: `p${n}`, smUrl: u(`p${n}`, "sm"), mdUrl: u(`p${n}`, "md"), isPrimary: n === 1, sortOrder: n, caption: null, source: "shopfloor", createdAt: "2026-10-21T02:12:00Z", ...o });

const order = (o: Partial<ProductionOrderRow> = {}): ProductionOrderRow => ({
  id: "po-1", poNo: "PO-0040", status: "open", note: null, spotOverrideThbPerGram: null, doneAt: null, cancelledAt: null, cancelReason: null,
  createdAt: "2026-10-21T02:12:00Z", updatedAt: "2026-10-21T02:12:00Z", itemCount: 1, qtyPlannedTotal: 30, qtyDoneTotal: 0, unboundItemCount: 0,
  openedVia: "shopfloor", openedByWorkerName: "หัวหน้าช่าง", acknowledgedAt: null, ...o,
});
const item = (): ProductionOrderItemRow => ({
  id: "i-1", productionOrderId: "po-1", poNo: "PO-0040", orderStatus: "open", productId: "p-1", sku: "RG-0418", productName: "แหวนโกเมนไข่", pendingProductLabel: null,
  currentCostType: "fixed", currentUnitCost: 120, metal: "gold", purity: 0.965, weightG: 3.2, weightSource: "input",
  effectiveMetal: "gold", effectivePurity: 0.965, effectiveWeightG: 3.2, effectiveWeightSource: "input",
  skuMetal: "gold", skuPurity: 0.965, skuWeightG: null, skuMetalKnown: true, metalMismatch: false, qtyPlanned: 30, qtyDone: null, stampedUnitCost: null, prevCostType: null, prevUnitCost: null,
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", makeSpec: null, currentSilverWeightG: null, currentSilverPurity: null, isNewDesign: false, costCalc: null,
});

function renderPage(o: Partial<ProductionOrderRow> = {}, ackJob: { jobId: string; jobNo: string } | null = { jobId: JOB, jobNo: "JB-0031" }) {
  return render(
    <ToastProvider>
      <ProductionOrderDetailClient order={order(o)} items={[item()]} skuOptions={[]} skuOptionsError={null} ackJob={ackJob} />
    </ToastProvider>,
  );
}
const strip = () => screen.getByRole("region", { name: /รูปจากหน้างาน/ });
/** รอจนแถบรูปโหลดเสร็จ (ในหน้ามี <ul> อื่น — ค้นเฉพาะในแถบ) */
const listReady = async () => within(await screen.findByRole("region", { name: /รูปจากหน้างาน/ })).findByRole("list");
const ackBtn = () => within(screen.getByRole("region", { name: /ใบนี้เปิดจากหน้างาน/ })).getByRole("button", { name: /^รับทราบ/ });
const tiles = () => within(strip()).queryAllByRole("button", { name: /แตะเพื่อดู/ });
const viewer = () => screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
const openFirst = async () => {
  await listReady();
  await userEvent.click(tiles()[0]);
};
const deleteViaViewer = async (i = 0) => {
  await listReady();
  await userEvent.click(tiles()[i]);
  await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
  return screen.getByRole("dialog", { name: "ลบรูปนี้ออกจากใบงาน JB-0031?" });
};

describe("4 state ของแถบ", () => {
  it("loading: skeleton 3 ช่อง role=status · ปุ่มรับทราบใช้ได้ระหว่างโหลด (ไม่ผูกกับรูป)", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    getJobPhotos.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    expect(screen.getByRole("status", { name: "กำลังโหลดรูป" })).toBeInTheDocument();
    expect(getJobPhotos).toHaveBeenCalledWith(JOB);
    expect(ackBtn()).not.toHaveAttribute("aria-disabled");
    expect(ackBtn()).toBeEnabled();
    await act(async () => resolve({ ok: true, data: [photo(1)] }));
    expect(await listReady()).toBeInTheDocument();
  });

  it("empty: ไม่มีรูปจากหน้างาน → บรรทัดเดียว (ไม่ใช่กล่องใหญ่ · ไม่มีปุ่มเพิ่ม) — รูปออฟฟิศล้วนก็ถือว่าไม่ได้แนบจากหน้างาน", async () => {
    getJobPhotos.mockResolvedValue({ ok: true, data: [] });
    const { unmount } = renderPage();
    expect(await screen.findByText("ผู้เปิดไม่ได้แนบรูปจากหน้างาน")).toBeInTheDocument();
    expect(within(strip()).queryByRole("list")).not.toBeInTheDocument();
    expect(within(strip()).queryByRole("button")).not.toBeInTheDocument();
    unmount();
    getJobPhotos.mockResolvedValue({ ok: true, data: [photo(1, { source: "office" })] });
    renderPage();
    expect(await screen.findByText("ผู้เปิดไม่ได้แนบรูปจากหน้างาน")).toBeInTheDocument();
  });

  it("error: 'โหลดรูปไม่ได้ — ตรวจรูปที่หน้าใบงานได้' + ลองใหม่ · ไม่บล็อกรับทราบ · ลองใหม่สำเร็จแล้วแสดงรูป", async () => {
    getJobPhotos.mockRejectedValueOnce(new Error("net"));
    renderPage();
    expect(await screen.findByText("โหลดรูปไม่ได้ — ตรวจรูปที่หน้าใบงานได้")).toBeInTheDocument();
    expect(ackBtn()).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await listReady()).toBeInTheDocument();
    expect(screen.queryByText(/โหลดรูปไม่ได้ — ตรวจรูป/)).not.toBeInTheDocument();
    cleanup();
    getJobPhotos.mockResolvedValueOnce({ ok: false, error: "x" });
    renderPage();
    expect(await screen.findByText("โหลดรูปไม่ได้ — ตรวจรูปที่หน้าใบงานได้")).toBeInTheDocument();
  });

  it("success (ทุกรูปมาจากหน้างาน): หัว 'รูปจากหน้างาน · 3 รูป' · ภาพ 3 ช่อง ★ รูปหลัก · caption เดียว 'ถ่าย/ส่งโดย {ชื่อ} · {เวลา}' ไม่มีป้ายต่อภาพ", async () => {
    renderPage();
    await listReady();
    expect(within(strip()).getByRole("heading", { name: "รูปจากหน้างาน · 3 รูป" })).toBeInTheDocument();
    expect(tiles()).toHaveLength(3);
    expect(tiles()[0]).toHaveAccessibleName("รูปที่ 1 จาก 3 · รูปหลัก · แตะเพื่อดู");
    expect(within(tiles()[0]).getByText("รูปหลัก")).toBeInTheDocument();
    expect(strip()).toHaveTextContent(/ถ่าย\/ส่งโดย หัวหน้าช่าง · .+ \(จากหน้างาน\)/);
    expect(within(strip()).queryByText("หน้างาน", { exact: true })).not.toBeInTheDocument();
    expect(within(strip()).queryByText("ออฟฟิศ")).not.toBeInTheDocument();
    expect(strip().querySelector("ul")).toHaveClass("grid");
  });

  it("success (รูปหลายที่มา): ป้ายต่อภาพ หน้างาน/ออฟฟิศ/แคตตาล็อก · ไม่มี caption เดียว · หัวนับเฉพาะรูปจากหน้างาน", async () => {
    getJobPhotos.mockResolvedValue({ ok: true, data: [photo(1), photo(2, { source: "office" }), photo(3, { source: "product" })] });
    renderPage();
    await listReady();
    expect(within(strip()).getByRole("heading", { name: "รูปจากหน้างาน · 1 รูป" })).toBeInTheDocument();
    expect(within(tiles()[0]).getByText("หน้างาน")).toBeInTheDocument();
    expect(within(tiles()[1]).getByText("ออฟฟิศ")).toBeInTheDocument();
    expect(within(tiles()[2]).getByText("แคตตาล็อก")).toBeInTheDocument();
    expect(tiles()[0]).toHaveAccessibleName("รูปที่ 1 จาก 3 · รูปหลัก · จากหน้างาน · แตะเพื่อดู");
    expect(strip()).not.toHaveTextContent(/ถ่าย\/ส่งโดย/);
  });

  it("🔴 ไม่มีเงิน/ต้นทุน/ลิงก์/ชื่อไฟล์ในแถบ", async () => {
    renderPage();
    await listReady();
    expect(strip().textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|\.jpg|storage/i);
    expect(strip().querySelectorAll("a, [href]").length).toBe(0);
  });
});

describe("viewer + จัดการ", () => {
  it("แตะ = viewer ใหญ่ (ปุ่มปิด 44px) มี ★ ตั้งเป็นรูปหลัก + ลบรูปนี้ · ไม่มีปุ่มเลื่อน (≤ 3 รูป ใช้ ★ ตัวเดียว)", async () => {
    renderPage();
    await openFirst();
    expect(within(viewer()).getByRole("button", { name: "ปิดรูป" })).toHaveClass("h-11");
    expect(within(viewer()).getByRole("button", { name: "เป็นรูปหลักอยู่แล้ว" })).toBeDisabled();
    expect(within(viewer()).getByRole("button", { name: "ลบรูปนี้" })).toBeInTheDocument();
    expect(within(viewer()).queryByRole("button", { name: /เลื่อนก่อน|เลื่อนหลัง/ })).not.toBeInTheDocument();
    expect(within(viewer()).queryByText(/รูปหลักอยู่ลำดับแรกเสมอ/)).not.toBeInTheDocument();
  });

  it("★ ตั้งรูปหลัก: optimistic + toast 'ตั้งเป็นรูปหลักแล้ว' เรียก setPrimaryJobPhoto(id) · ล้ม = ย้อน + toast error", async () => {
    renderPage();
    await listReady();
    await userEvent.click(tiles()[1]);
    await userEvent.click(within(viewer()).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    await waitFor(() => expect(setPrimaryJobPhoto).toHaveBeenCalledWith("p2"));
    expect(await screen.findByText("ตั้งเป็นรูปหลักแล้ว")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ปิดรูป" }));
    expect(tiles()[0]).toHaveAccessibleName(/^รูปที่ 1 จาก 3 · รูปหลัก/); // รูปหลักขึ้นหน้า
    // ล้ม
    setPrimaryJobPhoto.mockResolvedValueOnce({ ok: false, error: "ตั้งรูปหลักไม่สำเร็จ" });
    await userEvent.click(tiles()[2]);
    await userEvent.click(within(viewer()).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    expect(await screen.findByText("ตั้งรูปหลักไม่สำเร็จ")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ปิดรูป" }));
    expect(tiles()[0]).toHaveAccessibleName(/รูปหลัก/);
    expect(tiles().filter((t) => /รูปหลัก/.test(t.getAttribute("aria-label") ?? ""))).toHaveLength(1);
  });

  it("ลิงก์รูปหมดอายุ: รูปล้ม → ขอรายการใหม่เงียบๆ ครั้งเดียว ได้ลิงก์ใหม่ (ไม่วน)", async () => {
    renderPage();
    await listReady();
    const calls = getJobPhotos.mock.calls.length;
    getJobPhotos.mockResolvedValue({ ok: true, data: [photo(1, { smUrl: u("p1", "sm", "fresh") }), photo(2), photo(3)] });
    fireEvent.error(strip().querySelector(`img[src="${u("p1", "sm")}"]`)!);
    await waitFor(() => expect(getJobPhotos.mock.calls.length).toBe(calls + 1));
    await waitFor(() => expect(strip().querySelector(`img[src="${u("p1", "sm", "fresh")}"]`)).toBeTruthy());
  });
});

describe("ลบรูปจากหน้างาน = บังคับเหตุผล", () => {
  it("กล่อง: หัว 'ลบรูปนี้ออกจากใบงาน JB-0031?' · ข้อความ 'ผู้จัดการส่งจากหน้างาน · กู้คืนไม่ได้ · บันทึกว่าใครลบและเพราะอะไร' · 'เหตุผล (บังคับ)' · 3 ชิป · ช่องพิมพ์ 0/300 · ปุ่มลบ aria-disabled + บอกเหตุ · focus เริ่มที่ ยกเลิก", async () => {
    renderPage();
    const dlg = await deleteViaViewer(1);
    expect(within(dlg).getByText("รูปนี้ผู้จัดการส่งจากหน้างาน · ลบแล้วกู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบและเพราะอะไร")).toBeInTheDocument();
    expect(within(dlg).getByLabelText("เหตุผล (บังคับ)")).toBeInTheDocument();
    for (const c of ["ไม่ใช่ชิ้นงาน", "ภาพไม่ชัด", "ไม่เหมาะสม"]) expect(within(dlg).getByRole("button", { name: c })).toHaveAttribute("aria-pressed", "false");
    expect(within(dlg).getByText("0/300")).toBeInTheDocument();
    const del = within(dlg).getByRole("button", { name: "ลบรูป" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).not.toBeDisabled(); // aria-disabled ไม่ใช่ disabled เงียบ
    expect(within(dlg).getByText("ใส่เหตุผลก่อนลบ")).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
  });

  it("กดลบโดยไม่มีเหตุผล → ไม่เรียก server · บรรทัดบอกเหตุเป็นสีแดง · ช่องเหตุผล aria-invalid", async () => {
    renderPage();
    const dlg = await deleteViaViewer();
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    expect(removeJobPhoto).not.toHaveBeenCalled();
    expect(within(dlg).getByText("ใส่เหตุผลก่อนลบ")).toHaveClass("text-red-700");
    expect(within(dlg).getByLabelText("เหตุผล (บังคับ)")).toHaveAttribute("aria-invalid", "true");
  });

  it("เหตุผลที่ต้องไม่ผ่าน: ช่องว่างล้วน · ขึ้นบรรทัดใหม่ล้วน · เครื่องหมายล้วน '.' '...' · อีโมจิล้วน 👍 · อักขระล่องหน (U+200B) · U+2800 · VS16 · NEL — ไม่เรียก server", async () => {
    renderPage();
    const dlg = await deleteViaViewer();
    const box = within(dlg).getByLabelText("เหตุผล (บังคับ)");
    for (const bad of ["   ", "\n\n", ".", "...", "👍", "​", "​ไม่ชัด", "⠀", "️", "ไม่ชัด\u0085"]) {
      fireEvent.change(box, { target: { value: bad } });
      await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
      expect(removeJobPhoto, JSON.stringify(bad)).not.toHaveBeenCalled();
      expect(within(dlg).getByRole("button", { name: "ลบรูป" })).toHaveAttribute("aria-disabled", "true");
    }
    // ข้อความอธิบายตรงเหตุ: ล่องหน = บอกว่าห้ามมีอักขระมองไม่เห็น
    fireEvent.change(box, { target: { value: "ไม่ชัด​" } });
    expect(within(dlg).getByText("เหตุผลมีอักขระที่มองไม่เห็นหรืออักขระควบคุมทิศทาง")).toBeInTheDocument();
  });

  it("ชิปเติมข้อความลงช่อง (แก้ต่อได้) · ปุ่มลบพร้อม · ส่ง removeJobPhoto(id, เหตุผล) · สำเร็จ = ปิดกล่อง + toast 'ลบรูปแล้ว' + รูปหายจากแถบ", async () => {
    renderPage();
    const dlg = await deleteViaViewer(1);
    await userEvent.click(within(dlg).getByRole("button", { name: "ไม่ใช่ชิ้นงาน" }));
    const box = within(dlg).getByLabelText("เหตุผล (บังคับ)");
    expect(box).toHaveValue("ไม่ใช่ชิ้นงาน");
    expect(within(dlg).getByRole("button", { name: "ไม่ใช่ชิ้นงาน" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(box, " — เป็นรูปหน้าจอ");
    expect(box).toHaveValue("ไม่ใช่ชิ้นงาน — เป็นรูปหน้าจอ");
    expect(within(dlg).getByRole("button", { name: "ลบรูป" })).not.toHaveAttribute("aria-disabled");
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(removeJobPhoto).toHaveBeenCalledWith("p2", "ไม่ใช่ชิ้นงาน — เป็นรูปหน้าจอ"));
    expect(await screen.findByText("ลบรูปแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).not.toBeInTheDocument());
    expect(tiles()).toHaveLength(2);
    expect(within(strip()).getByRole("heading", { name: "รูปจากหน้างาน · 2 รูป" })).toBeInTheDocument();
  });

  it("พิมพ์เหตุผลเอง (ไทย/ละติน/เลข ผ่าน) · ขึ้นบรรทัดใหม่ในช่อง = ยุบเป็นช่องว่าง (ส่งบรรทัดเดียว) · เหตุผลถูก trim", async () => {
    renderPage();
    const dlg = await deleteViaViewer();
    const box = within(dlg).getByLabelText("เหตุผล (บังคับ)");
    fireEvent.change(box, { target: { value: "  blur 5\nรูปมือ  " } });
    expect(box).toHaveValue("  blur 5 รูปมือ  ");
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(removeJobPhoto).toHaveBeenCalledWith("p1", "blur 5 รูปมือ"));
  });

  it("นับตัวอักษร n/300 · จำกัด 300 (maxLength)", async () => {
    renderPage();
    const dlg = await deleteViaViewer();
    const box = within(dlg).getByLabelText("เหตุผล (บังคับ)") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(300);
    fireEvent.change(box, { target: { value: "ภาพไม่ชัด" } });
    expect(within(dlg).getByText("9/300")).toBeInTheDocument();
  });

  it("server ปฏิเสธ → ข้อความในกล่อง คงกล่อง+เหตุผลไว้ให้กดซ้ำ · รูปยังอยู่", async () => {
    removeJobPhoto.mockResolvedValueOnce({ ok: false, error: "รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่" });
    renderPage();
    const dlg = await deleteViaViewer();
    await userEvent.click(within(dlg).getByRole("button", { name: "ภาพไม่ชัด" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่");
    expect(within(dlg).getByLabelText("เหตุผล (บังคับ)")).toHaveValue("ภาพไม่ชัด");
    expect(tiles()).toHaveLength(3);
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(removeJobPhoto).toHaveBeenCalledTimes(2));
  });

  it("ลบรูปหลักของหน้างาน → ดาวย้ายตาม promotedPhotoId · ข้อความเตือน 'นี่คือรูปหลัก' ยังอยู่ในกล่อง", async () => {
    removeJobPhoto.mockResolvedValueOnce({ ok: true, data: { promotedPhotoId: "p2" } });
    renderPage();
    const dlg = await deleteViaViewer(0);
    expect(within(dlg).getByText("นี่คือรูปหลัก ลบแล้วรูปถัดไปจะเป็นรูปหลักแทน")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ภาพไม่ชัด" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(tiles()[0]).toHaveAccessibleName(/^รูปที่ 1 จาก 2 · รูปหลัก/);
  });

  it("ต้องไม่พัง: ลบรูปออฟฟิศ/แคตตาล็อก (ใบปนหลายที่มา) = กล่องเดิม ไม่บังคับเหตุผล · เรียก removeJobPhoto(id) ไม่มีอาร์กิวเมนต์เหตุผล", async () => {
    getJobPhotos.mockResolvedValue({ ok: true, data: [photo(1), photo(2, { source: "office" }), photo(3, { source: "product" })] });
    renderPage();
    await listReady();
    await userEvent.click(tiles()[1]);
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const dlg = screen.getByRole("dialog", { name: "ลบรูปนี้ออกจากใบงาน JB-0031?" });
    expect(within(dlg).queryByLabelText("เหตุผล (บังคับ)")).not.toBeInTheDocument();
    expect(within(dlg).getByText("กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ")).toBeInTheDocument();
    const del = within(dlg).getByRole("button", { name: "ลบรูป" });
    expect(del).not.toHaveAttribute("aria-disabled");
    await userEvent.click(del);
    await waitFor(() => expect(removeJobPhoto).toHaveBeenCalledTimes(1));
    expect(removeJobPhoto.mock.calls[0]).toEqual(["p2"]);
  });
});

describe("ต้องไม่พัง — การ์ด OfficeAck เดิม", () => {
  it("ไม่ส่ง ackJob (ไม่ใช่ใบหน้างาน/อ่านใบงานไม่ได้) = ไม่มีแถบรูป ไม่เรียก getJobPhotos", () => {
    renderPage({}, null);
    expect(screen.queryByRole("region", { name: /รูปจากหน้างาน/ })).not.toBeInTheDocument();
    expect(getJobPhotos).not.toHaveBeenCalled();
  });

  it("หลังรับทราบ (การ์ดหดเป็นแถบเดียว) = ไม่มีแถบรูป · ใบ office = ไม่มีการ์ด/แถบ", () => {
    renderPage({ acknowledgedAt: "2026-10-21T03:00:00Z" });
    expect(screen.queryByRole("region", { name: /รูปจากหน้างาน/ })).not.toBeInTheDocument();
    expect(getJobPhotos).not.toHaveBeenCalled();
    cleanup();
    renderPage({ openedVia: "office", openedByWorkerName: null });
    expect(screen.queryByRole("region", { name: /รูปจากหน้างาน/ })).not.toBeInTheDocument();
  });

  it("รับทราบได้ตามปกติระหว่างที่แถบรูปล้ม/ว่าง — ปุ่มไม่ผูกกับรูป", async () => {
    getJobPhotos.mockRejectedValue(new Error("net"));
    renderPage();
    await screen.findByText("โหลดรูปไม่ได้ — ตรวจรูปที่หน้าใบงานได้");
    await userEvent.click(ackBtn());
    await waitFor(() => expect(ack).toHaveBeenCalledTimes(1));
  });
});
