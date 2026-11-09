// @vitest-environment jsdom
// หลังบ้านออกแบบแหวน: 3 แท็บ · ฟอร์มขนาด 2 ช่อง · ป้ายล็อก · error code → ไทย · ค่าที่กรอกไม่หายเมื่อ error · ปิดทรง/แก้ราคาต้องยืนยัน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const A = {
  getRingBuilderAdmin: vi.fn(), saveRingShape: vi.fn(), saveRingStone: vi.fn(), saveRingOffer: vi.fn(), setRingOfferPrice: vi.fn(), saveRingDesign: vi.fn(),
  setRingDesignPrice: vi.fn(), publishRingDesign: vi.fn(), duplicateRingDesign: vi.fn(), setRingActive: vi.fn(), uploadRingCardImage: vi.fn(), clearRingCardImage: vi.fn(), checkRingCode: vi.fn(),
};
vi.mock("@/lib/actions/ring-builder", () => ({
  getRingBuilderAdmin: (...a: unknown[]) => A.getRingBuilderAdmin(...a),
  saveRingShape: (...a: unknown[]) => A.saveRingShape(...a),
  saveRingStone: (...a: unknown[]) => A.saveRingStone(...a),
  saveRingOffer: (...a: unknown[]) => A.saveRingOffer(...a),
  setRingOfferPrice: (...a: unknown[]) => A.setRingOfferPrice(...a),
  saveRingDesign: (...a: unknown[]) => A.saveRingDesign(...a),
  setRingDesignPrice: (...a: unknown[]) => A.setRingDesignPrice(...a),
  publishRingDesign: (...a: unknown[]) => A.publishRingDesign(...a),
  duplicateRingDesign: (...a: unknown[]) => A.duplicateRingDesign(...a),
  setRingActive: (...a: unknown[]) => A.setRingActive(...a),
  uploadRingCardImage: (...a: unknown[]) => A.uploadRingCardImage(...a),
  clearRingCardImage: (...a: unknown[]) => A.clearRingCardImage(...a),
  checkRingCode: (...a: unknown[]) => A.checkRingCode(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { RingBuilderAdminClient } from "./RingBuilderAdminClient";
import type { RingAdminTab } from "@/lib/ring-builder/admin-ui";
import type { AdminCatalog } from "@/lib/ring-builder/admin-types";
import { catalogEmpty, catalogFull, ID } from "./test-fixtures";

function mount(opts: { initial?: AdminCatalog | null; error?: string | null; tab?: RingAdminTab } = {}) {
  return render(
    <ToastProvider>
      <RingBuilderAdminClient initial={opts.initial === undefined ? catalogFull : opts.initial} initialError={opts.error ?? null} initialTab={opts.tab ?? "gems"} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  A.getRingBuilderAdmin.mockResolvedValue({ ok: true, data: catalogFull });
  window.history.replaceState(null, "", "/catalog/ring-builder");
});

describe("โครงหน้า + แท็บ", () => {
  it("มี 3 แท็บ ตามจอ · สลับด้วยการกด · ?tab= อัปเดต", async () => {
    const u = userEvent.setup();
    mount();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["พลอย (ราคาขาย)", "แบบแหวน", "ตรวจรหัสสั่งทำ"]);
    expect(screen.getByRole("tab", { name: "พลอย (ราคาขาย)" })).toHaveAttribute("aria-selected", "true");
    await u.click(screen.getByRole("tab", { name: "แบบแหวน" }));
    expect(screen.getByRole("heading", { name: "แบบแหวน", level: 2 })).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=designs");
  });

  it("แคตตาล็อกโหลดไม่สำเร็จ: ErrorState + ลองใหม่ได้ · แท็บตรวจรหัสยังใช้ได้", async () => {
    const u = userEvent.setup();
    mount({ initial: null, error: "โหลดไม่สำเร็จ XYZ" });
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดไม่สำเร็จ XYZ");
    await u.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(A.getRingBuilderAdmin).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("พลอยทดสอบ A")).toBeInTheDocument();
  });
  it("โหลดไม่สำเร็จแล้วสลับไปแท็บตรวจรหัสได้", async () => {
    const u = userEvent.setup();
    mount({ initial: null, error: "โหลดไม่สำเร็จ" });
    await u.click(screen.getByRole("tab", { name: "ตรวจรหัสสั่งทำ" }));
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeInTheDocument();
  });
});

describe("แท็บ พลอย (ราคาขาย)", () => {
  it("แสดงแถวพลอย ราคาตามทรง+ขนาด coverage ที่ขาด + CZ ขาวค่าเริ่มต้น", () => {
    mount();
    const row = screen.getByText("พลอยทดสอบ A").closest("tr") as HTMLElement;
    expect(within(row).getByText(/กลม 2×2/)).toBeInTheDocument();
    expect(within(row).getByText("฿80")).toBeInTheDocument();
    expect(within(row).getByText("฿120")).toBeInTheDocument();
    expect(within(row).getByText("2/3 แบบ")).toBeInTheDocument();
    expect(within(row).getByText(/ขาด 5 เม็ด แบบทดสอบ ข.*ยังไม่มีราคาทรง\/ขนาดนี้/)).toBeInTheDocument();
    const cz = screen.getByText("CZ ขาว").closest("tr") as HTMLElement;
    expect(within(cz).getByText("ค่าเริ่มต้น")).toBeInTheDocument();
    expect(within(cz).getByText("รวมในตัวเรือน")).toBeInTheDocument();
  });

  it("ว่าง: 'ยังไม่มีพลอย' + บอกว่าลูกค้าเลือกได้แค่ CZ ขาว", () => {
    mount({ initial: catalogEmpty });
    expect(screen.getByText("ยังไม่มีพลอย")).toBeInTheDocument();
    expect(screen.getByText(/ลูกค้าจะเลือกได้แค่ CZ ขาว/)).toBeInTheDocument();
  });

  it("แถบทรงพลอยแสดง 'ใช้ใน x แบบ' · ปิดทรงต้องยืนยันและบอกจำนวนแบบที่กระทบ", async () => {
    const u = userEvent.setup();
    A.setRingActive.mockResolvedValue({ ok: true, data: { changed: true, affectedDesigns: 2 } });
    mount();
    expect(screen.getByText("ใช้ใน 2 แบบ")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "ปิดทรง กลม" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(/ใช้ใน 2 แบบ/)).toBeInTheDocument();
    expect(A.setRingActive).not.toHaveBeenCalled();
    await u.click(within(dlg).getByRole("button", { name: "ปิดทรง" }));
    expect(A.setRingActive).toHaveBeenCalledWith({ kind: "shape", id: ID.round, active: false });
  });

  it("เพิ่มทรง: error name_dup → ข้อความไทย และชื่อที่กรอกไม่หาย", async () => {
    const u = userEvent.setup();
    A.saveRingShape.mockResolvedValue({ ok: false, error: "x", code: "name_dup" });
    mount();
    await u.click(screen.getByRole("button", { name: "＋ เพิ่มทรง" }));
    const dlg = screen.getByRole("dialog");
    await u.type(within(dlg).getByLabelText("ชื่อทรง (ลูกค้าเห็น)"), "ทรงทดสอบ");
    await u.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("มีรายการชื่อนี้อยู่แล้ว");
    expect(within(dlg).getByLabelText("ชื่อทรง (ลูกค้าเห็น)")).toHaveValue("ทรงทดสอบ");
    expect(A.saveRingShape).toHaveBeenCalledWith({ id: null, name: "ทรงทดสอบ", renderKind: "round" });
  });

  it("แก้พลอย: error short_name_invalid → ไทย · ค่าที่กรอกคงอยู่ · ส่งค่าตามที่กรอก", async () => {
    const u = userEvent.setup();
    A.saveRingStone.mockResolvedValue({ ok: false, error: "raw", code: "short_name_invalid" });
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const dlg = screen.getByRole("dialog");
    const name = within(dlg).getByLabelText("ชื่อพลอย (ลูกค้าเห็น)");
    await u.clear(name);
    await u.type(name, "ชื่อใหม่ทดสอบ");
    await u.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    expect(A.saveRingStone).toHaveBeenCalledWith({ id: ID.stoneA, name: "ชื่อใหม่ทดสอบ", shortName: "ทดA", colorHex: "#112233", sort: 1 });
    expect(await within(dlg).findByText("ชื่อสั้น (แถบตำแหน่ง) ต้องยาว 1-6 ตัวอักษร")).toBeInTheDocument();
    expect(name).toHaveValue("ชื่อใหม่ทดสอบ");
  });

  it("เพิ่มราคาทรง/ขนาด: ขนาด 2 ช่อง กว้าง/ยาว → ส่ง '3×2' แล้วตั้งราคา", async () => {
    const u = userEvent.setup();
    A.saveRingOffer.mockResolvedValue({ ok: true, data: { offerId: "o-new", created: true, reactivated: false } });
    A.setRingOfferPrice.mockResolvedValue({ ok: true, data: { unchanged: false } });
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const form = screen.getByRole("form", { name: "เพิ่มทรงและขนาด" });
    expect(within(form).getByLabelText("กว้าง (มม.)")).toBeInTheDocument();
    expect(within(form).getByLabelText("ยาว (มม.)")).toBeInTheDocument();
    await u.selectOptions(within(form).getByLabelText("ทรง"), ID.oval);
    await u.type(within(form).getByLabelText("กว้าง (มม.)"), "3");
    await u.type(within(form).getByLabelText("ยาว (มม.)"), "2");
    await u.type(within(form).getByLabelText("ราคา (บาท/เม็ด)"), "95");
    await u.click(within(form).getByRole("button", { name: "เพิ่มทรง/ขนาด" }));
    expect(A.saveRingOffer).toHaveBeenCalledWith({ stoneId: ID.stoneA, shapeId: ID.oval, size: "3×2" });
    expect(A.setRingOfferPrice).toHaveBeenCalledWith({ offerId: "o-new", priceThb: 95 });
  });

  it("ทรงกลม: ช่องยาวล็อกตามกว้าง · ส่ง 'กว้าง×กว้าง'", async () => {
    const u = userEvent.setup();
    A.saveRingOffer.mockResolvedValue({ ok: true, data: { offerId: "o2", created: true, reactivated: false } });
    A.setRingOfferPrice.mockResolvedValue({ ok: true, data: { unchanged: false } });
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const form = screen.getByRole("form", { name: "เพิ่มทรงและขนาด" });
    await u.type(within(form).getByLabelText("กว้าง (มม.)"), "3");
    expect(within(form).getByLabelText("ยาว (มม.)")).toBeDisabled();
    expect(within(form).getByLabelText("ยาว (มม.)")).toHaveValue("3");
    await u.type(within(form).getByLabelText("ราคา (บาท/เม็ด)"), "110");
    await u.click(within(form).getByRole("button", { name: "เพิ่มทรง/ขนาด" }));
    expect(A.saveRingOffer).toHaveBeenCalledWith({ stoneId: ID.stoneA, shapeId: ID.round, size: "3×3" });
  });

  it("เตือนขนาดซ้ำ (ทรง+ขนาดเดียวกับที่มี) และบล็อกการเพิ่ม", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const form = screen.getByRole("form", { name: "เพิ่มทรงและขนาด" });
    await u.type(within(form).getByLabelText("กว้าง (มม.)"), "2");
    await u.type(within(form).getByLabelText("ราคา (บาท/เม็ด)"), "90");
    expect(within(form).getByRole("alert")).toHaveTextContent("กลม 2×2 ซ้ำกับรายการที่มีอยู่");
    expect(within(form).getByRole("button", { name: "เพิ่มทรง/ขนาด" })).toBeDisabled();
  });

  it("แก้ราคา: ต้องยืนยัน (บอกว่ารหัสเก่าคงราคาเดิม) ก่อนเรียก setRingOfferPrice", async () => {
    const u = userEvent.setup();
    A.setRingOfferPrice.mockResolvedValue({ ok: true, data: { unchanged: false } });
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const input = screen.getAllByLabelText("ราคา (บาท/เม็ด)")[0];
    await u.clear(input);
    await u.type(input, "90");
    await u.click(screen.getAllByRole("button", { name: "บันทึกราคา" })[0]);
    expect(A.setRingOfferPrice).not.toHaveBeenCalled();
    const grp = screen.getByRole("group", { name: "ยืนยันแก้ราคา" });
    expect(grp).toHaveTextContent("฿90");
    expect(grp).toHaveTextContent("เดิม ฿80");
    expect(grp).toHaveTextContent("รหัสเก่าคงราคาเดิม");
    await u.click(within(grp).getByRole("button", { name: "ยืนยัน" }));
    expect(A.setRingOfferPrice).toHaveBeenCalledWith({ offerId: ID.offerA1, priceThb: 90 });
  });

  it("ราคาไม่ใช่จำนวนเต็มบาท: ปุ่มบันทึกราคาปิด ไม่เรียก action", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    const input = screen.getAllByLabelText("ราคา (บาท/เม็ด)")[0];
    await u.clear(input);
    await u.type(input, "9.5");
    expect(screen.getAllByRole("button", { name: "บันทึกราคา" })[0]).toBeDisabled();
  });

  it("ปิดพลอย: ยืนยันพร้อมข้อความเตือนตามจอ", async () => {
    const u = userEvent.setup();
    A.setRingActive.mockResolvedValue({ ok: true, data: { changed: true, affectedDesigns: 0 } });
    mount();
    await u.click(screen.getByRole("button", { name: "แก้ไข พลอยทดสอบ A" }));
    await u.click(screen.getByRole("button", { name: "ปิดพลอยนี้" }));
    const dlgs = screen.getAllByRole("dialog");
    const top = dlgs[dlgs.length - 1];
    expect(top).toHaveTextContent("ลูกค้าที่กำลังออกแบบต้องเลือกพลอยใหม่");
    await u.click(within(top).getByRole("button", { name: "ปิดพลอย" }));
    expect(A.setRingActive).toHaveBeenCalledWith({ kind: "stone", id: ID.stoneA, active: false });
  });
});

describe("แท็บ แบบแหวน", () => {
  it("ป้ายล็อกคือ 'ล็อก · เคยเปิดขาย' (ไม่มีตัวนับรหัส/คำว่ามีรหัสแล้ว) · แสดงช่วงไซซ์ · ราคาตัวเรือน", async () => {
    const u = userEvent.setup();
    mount({ tab: "designs" });
    expect(screen.getByText("ล็อก · เคยเปิดขาย")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/มีรหัสแล้ว|ออกรหัสสั่งทำไปแล้ว|\d+ รหัส/);
    const row = screen.getByText("แบบทดสอบ ก").closest("tr") as HTMLElement;
    expect(within(row).getByText("53–68")).toBeInTheDocument();
    expect(within(row).getByText("฿480")).toBeInTheDocument();
    expect(within(row).getByText("เปิดขาย")).toBeInTheDocument();
    const draft = screen.getByText("แบบทดสอบ ข").closest("tr") as HTMLElement;
    expect(within(draft).getByText("ร่าง · ยังไม่เปิดขาย")).toBeInTheDocument();
    expect(within(draft).getByText("ยังไม่ตั้งราคา")).toBeInTheDocument();
    void u;
  });

  it("กรองตามจำนวนเม็ด", async () => {
    const u = userEvent.setup();
    mount({ tab: "designs" });
    expect(screen.getByRole("button", { name: "ทั้งหมด 2" })).toHaveAttribute("aria-pressed", "true");
    await u.click(screen.getByRole("button", { name: "5 เม็ด · 1" }));
    expect(screen.queryByText("แบบทดสอบ ก")).not.toBeInTheDocument();
    expect(screen.getByText("แบบทดสอบ ข")).toBeInTheDocument();
  });

  it("ว่าง: ยังไม่มีแบบแหวน", () => {
    mount({ tab: "designs", initial: catalogEmpty });
    expect(screen.getByText("ยังไม่มีแบบแหวน")).toBeInTheDocument();
  });

  it("แบบที่ล็อก: จำนวนเม็ด/ทรง/กว้าง/ยาวแก้ไม่ได้ · ไซซ์ต่ำสุด–สูงสุดแก้ได้ · มีปุ่มทำสำเนา · ไม่มีปุ่มเปิดขาย", async () => {
    const u = userEvent.setup();
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "แก้ไข 3 เม็ด แบบทดสอบ ก" }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByLabelText("จำนวนเม็ด")).toBeDisabled();
    expect(within(dlg).getByLabelText("ทรงพลอย")).toBeDisabled();
    expect(within(dlg).getByLabelText("กว้าง (มม.)")).toBeDisabled();
    expect(within(dlg).getByLabelText("ยาว (มม.)")).toBeDisabled();
    expect(within(dlg).getByLabelText("ไซซ์ต่ำสุด")).toBeEnabled();
    expect(within(dlg).getByLabelText("ไซซ์ต่ำสุด")).toHaveValue("53");
    expect(within(dlg).getByLabelText("ไซซ์สูงสุด")).toHaveValue("68");
    expect(within(dlg).getByRole("button", { name: "ทำสำเนาเป็นแบบใหม่" })).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: "เปิดขาย" })).not.toBeInTheDocument();
    expect(within(dlg).getAllByTestId("ring-stone")).toHaveLength(3);
  });

  it("ทำสำเนา: เรียก duplicateRingDesign", async () => {
    const u = userEvent.setup();
    A.duplicateRingDesign.mockResolvedValue({ ok: true, data: { id: ID.design2, designNo: 9 } });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "แก้ไข 3 เม็ด แบบทดสอบ ก" }));
    await u.click(screen.getByRole("button", { name: "ทำสำเนาเป็นแบบใหม่" }));
    expect(A.duplicateRingDesign).toHaveBeenCalledWith(ID.design1);
  });

  it("เพิ่มแบบใหม่ (ทรงกลม): ส่งขนาด 2 ช่อง + ช่วงไซซ์ + ราคาตัวเรือน · ไม่ส่งทิศ", async () => {
    const u = userEvent.setup();
    A.saveRingDesign.mockResolvedValue({ ok: true, data: { id: ID.design2, designNo: 3, created: true } });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "＋ เพิ่มแบบ" }));
    const dlg = screen.getByRole("dialog");
    await u.type(within(dlg).getByLabelText("ชื่อแบบ (ลูกค้าเห็น)"), "แบบทดสอบ ใหม่");
    await u.type(within(dlg).getByLabelText("กว้าง (มม.)"), "2");
    await u.type(within(dlg).getByLabelText("ราคาตัวเรือน (บาท · ทุกไซซ์)"), "480");
    await u.click(within(dlg).getByRole("button", { name: "บันทึกเป็นร่าง" }));
    expect(A.saveRingDesign).toHaveBeenCalledWith({
      id: null, name: "แบบทดสอบ ใหม่", stoneCount: 5, shapeId: ID.round, size: "2×2", stoneAxis: null, sizeMin: 45, sizeMax: 68, sort: null, bodyPriceThb: 480,
    });
  });

  it("ทรงไข่ต้องเลือกทิศ (ก่อนส่ง) · เลือกแล้วส่ง along_row และขนาด '4×3'", async () => {
    const u = userEvent.setup();
    A.saveRingDesign.mockResolvedValue({ ok: true, data: { id: ID.design2, designNo: 3, created: true } });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "＋ เพิ่มแบบ" }));
    const dlg = screen.getByRole("dialog");
    await u.type(within(dlg).getByLabelText("ชื่อแบบ (ลูกค้าเห็น)"), "แบบไข่ทดสอบ");
    await u.selectOptions(within(dlg).getByLabelText("ทรงพลอย"), ID.oval);
    await u.type(within(dlg).getByLabelText("กว้าง (มม.)"), "4");
    await u.type(within(dlg).getByLabelText("ยาว (มม.)"), "3");
    await u.click(within(dlg).getByRole("button", { name: "บันทึกเป็นร่าง" }));
    expect(A.saveRingDesign).not.toHaveBeenCalled();
    expect(await within(dlg).findByText(/ทรงไข่ต้องระบุทิศเม็ด/)).toBeInTheDocument();
    await u.selectOptions(within(dlg).getByLabelText("ทิศเม็ดไข่"), "along_row");
    await u.click(within(dlg).getByRole("button", { name: "บันทึกเป็นร่าง" }));
    expect(A.saveRingDesign).toHaveBeenCalledWith(expect.objectContaining({ size: "4×3", stoneAxis: "along_row", shapeId: ID.oval, bodyPriceThb: null }));
  });

  it("error design_locked → ข้อความไทย · ค่าที่กรอกไม่หาย", async () => {
    const u = userEvent.setup();
    A.saveRingDesign.mockResolvedValue({ ok: false, error: "raw-db", code: "design_locked" });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "แก้ไข 3 เม็ด แบบทดสอบ ก" }));
    const dlg = screen.getByRole("dialog");
    const name = within(dlg).getByLabelText("ชื่อแบบ (ลูกค้าเห็น)");
    await u.clear(name);
    await u.type(name, "ชื่อแก้ใหม่");
    await u.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    expect(await within(dlg).findByText(/แบบนี้เปิดขายแล้ว — แก้จำนวนเม็ด\/ทรง\/ขนาดเม็ด\/ทิศเม็ดไม่ได้/)).toBeInTheDocument();
    expect(within(dlg).queryByText("raw-db")).not.toBeInTheDocument();
    expect(name).toHaveValue("ชื่อแก้ใหม่");
  });

  it("แบบที่เปิดขายแล้วแก้ราคาตัวเรือน: ต้องยืนยันก่อนบันทึก", async () => {
    const u = userEvent.setup();
    A.saveRingDesign.mockResolvedValue({ ok: true, data: { id: ID.design1, designNo: 1, created: false } });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "แก้ไข 3 เม็ด แบบทดสอบ ก" }));
    const price = screen.getByLabelText("ราคาตัวเรือน (บาท · ทุกไซซ์)");
    await u.clear(price);
    await u.type(price, "500");
    await u.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(A.saveRingDesign).not.toHaveBeenCalled();
    const dlgs = screen.getAllByRole("dialog");
    expect(dlgs[dlgs.length - 1]).toHaveTextContent("รหัสสั่งทำที่ออกไปแล้วคงราคาเดิม");
    await u.click(within(dlgs[dlgs.length - 1]).getByRole("button", { name: "ยืนยันบันทึก" }));
    expect(A.saveRingDesign).toHaveBeenCalledWith(expect.objectContaining({ id: ID.design1, bodyPriceThb: 500, size: "2×2" }));
  });

  it("ร่าง: ปุ่มเปิดขาย → ยืนยัน (เตือนล็อกถาวร) → publishRingDesign", async () => {
    const u = userEvent.setup();
    A.publishRingDesign.mockResolvedValue({ ok: true, data: { already: false } });
    mount({ tab: "designs" });
    await u.click(screen.getByRole("button", { name: "แก้ไข 5 เม็ด แบบทดสอบ ข" }));
    await u.click(screen.getByRole("button", { name: "เปิดขาย" }));
    const dlgs = screen.getAllByRole("dialog");
    const top = dlgs[dlgs.length - 1];
    expect(top).toHaveTextContent("ล็อกถาวร");
    await u.click(within(top).getByRole("button", { name: "เปิดขาย" }));
    expect(A.publishRingDesign).toHaveBeenCalledWith(ID.design2);
  });
});

describe("แท็บ ตรวจรหัสสั่งทำ — ดูไฟล์ VerifyTab.test.tsx สำหรับ 8 สถานะ", () => {
  it("เริ่มต้น = สถานะ 'ยังว่าง' · ปุ่มตรวจปิดเมื่อไม่มีข้อความ", () => {
    mount({ tab: "verify" });
    expect(screen.getByText("ยังไม่ได้วางรหัส")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeDisabled();
  });
});
