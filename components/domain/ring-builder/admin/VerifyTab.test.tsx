// @vitest-environment jsdom
// ตรวจรหัส: 8 สถานะตาม AdminVerifyStates (+ กำลังตรวจ) · "ระบบตรวจไม่ได้" แยกจาก "รหัสผิด" · ส่วนต่างราคารายบรรทัด · ปิดแล้วรายตำแหน่ง · คัดลอกข้อความจาก server
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const check = vi.fn();
vi.mock("@/lib/actions/ring-builder", () => ({ checkRingCode: (...a: unknown[]) => check(...a) }));

import { ToastProvider } from "@/components/ui/Toast";
import { VerifyTab } from "./VerifyTab";
import { checkView } from "./test-fixtures";

async function submit(text = "รหัสทดสอบ 3jr-aaaaa-bbbbb") {
  const u = userEvent.setup();
  render(
    <ToastProvider>
      <VerifyTab />
    </ToastProvider>,
  );
  await u.type(screen.getByLabelText("รหัส หรือข้อความจากลูกค้า"), text);
  await u.click(screen.getByRole("button", { name: "ตรวจ" }));
  return u;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ผลตรวจ 8 สถานะ", () => {
  it("empty: ยังไม่ได้วางรหัส", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "empty", view: null } });
    await submit();
    expect(screen.getByText("ยังไม่ได้วางรหัส")).toBeInTheDocument();
  });
  it("not_found: ไม่พบรหัส · ยังไม่ใช่ 'รหัสผิด'", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "not_found", view: null } });
    await submit();
    expect(screen.getByText("ไม่พบรหัสในข้อความที่วาง")).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่ใช่ "รหัสผิด"/)).toBeInTheDocument();
  });
  it("bad_format: รหัสไม่ผ่านการตรวจเลขท้าย", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "bad_format", view: null } });
    await submit();
    expect(screen.getByText("รูปแบบผิด")).toBeInTheDocument();
    expect(screen.getByText("รหัสไม่ผ่านการตรวจเลขท้าย")).toBeInTheDocument();
  });
  it("not_issued: ระบบไม่ได้ออกรหัสนี้ · ห้ามรับออเดอร์", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "not_issued", view: null } });
    await submit();
    expect(screen.getByText("ไม่ได้ออกโดยระบบ")).toBeInTheDocument();
    expect(screen.getByText(/ห้ามรับออเดอร์จากรหัสนี้/)).toBeInTheDocument();
  });
  it("design_closed: แบบปิดแล้ว แต่ยังแสดงรายละเอียดตามที่บันทึกไว้", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "design_closed", view: { ...checkView, designActive: false, designClosedLabel: "1 พ.ย. 2569", closedBy: "design", closedLabel: "1 พ.ย. 2569" } } });
    await submit();
    expect(screen.getByText("เวอร์ชันเก่า / แบบปิดแล้ว")).toBeInTheDocument();
    expect(screen.getByText(/รหัสถูกต้อง แต่แบบนี้ปิดไปแล้ว \(1 พ.ย. 2569\)/)).toBeInTheDocument();
    expect(screen.getByText("แบบทดสอบ ก", { exact: false })).toBeInTheDocument();
  });
  it("design_closed เพราะทรงพลอยปิด: บอก 'ทรงพลอยปิด' ไม่ใช่ 'แบบปิด'", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "design_closed", view: { ...checkView, shapeActive: false, closedBy: "shape", closedLabel: "5 พ.ย. 2569" } } });
    await submit();
    expect(screen.getByText("ทรงพลอยปิดแล้ว")).toBeInTheDocument();
    expect(screen.getByText(/ทรงพลอยของแบบนี้ปิดไปแล้ว \(5 พ.ย. 2569\)/)).toBeInTheDocument();
    expect(screen.queryByText(/แต่แบบนี้ปิดไปแล้ว/)).not.toBeInTheDocument();
  });
  it("bad_input จาก action: 'วางไม่ถูกต้อง' ไม่ใช่ 'ระบบตรวจไม่ได้' หรือ 'รูปแบบผิด'", async () => {
    check.mockResolvedValue({ ok: false, error: "x", code: "bad_input" });
    await submit();
    expect(screen.getByText("วางไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.queryByText("ระบบตรวจไม่ได้")).not.toBeInTheDocument();
    expect(screen.queryByText("รูปแบบผิด")).not.toBeInTheDocument();
  });
  it("changed: ป้ายส่วนต่าง · ราคารายบรรทัด ตอนสร้าง/ปัจจุบัน/ต่าง · ปิดแล้วรายตำแหน่ง · ชื่อแบบ+ทรง/ขนาด", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: checkView } });
    await submit();
    expect(screen.getByText("ราคาเปลี่ยนจากตอนสร้าง +฿20")).toBeInTheDocument();
    const rowA = screen.getByRole("cell", { name: "พลอยทดสอบ A × 2" }).closest("tr") as HTMLElement;
    expect(within(rowA).getByText("฿160")).toBeInTheDocument();
    expect(within(rowA).getByText("฿180")).toBeInTheDocument();
    expect(within(rowA).getByText("+฿20")).toBeInTheDocument();
    const rowCz = screen.getByRole("cell", { name: "CZ ขาว × 3" }).closest("tr") as HTMLElement;
    expect(within(rowCz).getAllByText("รวมในตัวเรือน")).toHaveLength(2);
    const total = screen.getByRole("cell", { name: "รวม" }).closest("tr") as HTMLElement;
    expect(total).toHaveTextContent("฿640");
    expect(total).toHaveTextContent("฿660");
    // ข้อ 11: ชื่อแบบ + ทรง/ขนาด + ป้ายปิดแล้วรายตำแหน่ง
    expect(screen.getByText("5 เม็ด · แบบทดสอบ ก")).toBeInTheDocument();
    expect(screen.getByText("พลอย กลม 2×2 มม.")).toBeInTheDocument();
    const pos3 = screen.getByText("พลอยทดสอบ B", { selector: "li span" }).closest("li") as HTMLElement;
    expect(within(pos3).getByText("ปิดแล้ว")).toBeInTheDocument();
    const pos1 = screen.getByText("พลอยทดสอบ A", { selector: "li span" }).closest("li") as HTMLElement;
    expect(within(pos1).queryByText("ปิดแล้ว")).not.toBeInTheDocument();
    // กล่องเตือนให้เทียบรูปด้วยตา
    expect(screen.getByRole("note")).toHaveTextContent("เทียบตำแหน่งพลอยกับรูปในแชทด้วยตาเสมอ");
  });
  it("ok: ระบบออกรหัสนี้จริง · ไม่มีปุ่มแจ้งราคาใหม่ · ไม่มีป้ายส่วนต่าง", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "ok", view: { ...checkView, diffTotalThb: 0, currentTotalThb: 640, lines: checkView.lines.map((l) => ({ ...l, closedNow: false })), closedStones: [] } } });
    await submit();
    expect(screen.getByText("ระบบออกรหัสนี้จริง")).toBeInTheDocument();
    expect(screen.queryByText(/ราคาเปลี่ยนจากตอนสร้าง/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คัดลอกสรุปไปใบงาน" })).toBeInTheDocument();
  });
  it("S8: changed จากพลอยปิด/ไซซ์นอกช่วงอย่างเดียว (ยอดต่าง 0) หรือไม่มีข้อความ → ไม่มีปุ่มแจ้งราคาใหม่ · ยอดต่างจริง + มีข้อความ → มีปุ่ม", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: { ...checkView, diffTotalThb: 0, priceNoticeText: "ข้อความ" } } });
    await submit();
    expect(screen.queryByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" })).not.toBeInTheDocument();
    cleanup();
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: { ...checkView, diffTotalThb: null, priceNoticeText: "ข้อความ" } } });
    await submit();
    expect(screen.queryByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" })).not.toBeInTheDocument();
    cleanup();
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: { ...checkView, diffTotalThb: 20, priceNoticeText: "   " } } });
    await submit();
    expect(screen.queryByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" })).not.toBeInTheDocument();
    cleanup();
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: { ...checkView, diffTotalThb: 20, priceNoticeText: "ข้อความแจ้งราคา" } } });
    await submit();
    expect(screen.getByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" })).toBeInTheDocument();
  });
  it("unavailable (จาก action): 'ระบบตรวจไม่ได้' — ไม่ใช่รหัสผิด + บอกห้ามบอกลูกค้าว่ารหัสผิด + ตรวจอีกครั้งได้", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "unavailable", view: null } });
    const u = await submit();
    expect(screen.getByText("ระบบตรวจไม่ได้")).toBeInTheDocument();
    expect(screen.getByText(/ไม่ได้แปลว่ารหัสผิด/)).toBeInTheDocument();
    expect(screen.queryByText("รูปแบบผิด")).not.toBeInTheDocument();
    expect(screen.queryByText("ไม่ได้ออกโดยระบบ")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "ตรวจอีกครั้ง" }));
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("action throw หรือ ok:false → แสดง 'ระบบตรวจไม่ได้' (ไม่ใช่รหัสผิด)", async () => {
    check.mockRejectedValue(new Error("network"));
    await submit();
    expect(screen.getByText("ระบบตรวจไม่ได้")).toBeInTheDocument();
    expect(screen.queryByText("รูปแบบผิด")).not.toBeInTheDocument();
  });
  it("loading: กำลังตรวจ + ปุ่มตรวจปิดกันกดซ้ำ", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    check.mockReturnValue(new Promise((r) => (resolve = r)));
    await submit();
    expect(screen.getByText("กำลังตรวจรหัส…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeDisabled();
    resolve({ ok: true, data: { status: "not_found", view: null } });
    expect(await screen.findByText("ไม่พบรหัสในข้อความที่วาง")).toBeInTheDocument();
  });
});

describe("ข้อความที่คัดลอก = ข้อความที่ server ประกอบ (ไม่คิดเอง)", () => {
  it("คัดลอกสรุป/ข้อความแจ้งราคาใหม่ ส่งสตริงจาก server เป๊ะ", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: checkView } });
    const u = await submit();
    // userEvent.setup() ติดตั้ง clipboard จำลองของตัวเอง — สอดดูหลัง setup
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await u.click(screen.getByRole("button", { name: "คัดลอกข้อความแจ้งราคาใหม่" }));
    expect(writeText).toHaveBeenLastCalledWith("PRICE-NOTICE-FROM-SERVER");
    await u.click(screen.getByRole("button", { name: "คัดลอกสรุปไปใบงาน" }));
    expect(writeText).toHaveBeenLastCalledWith("SUMMARY-TEXT-FROM-SERVER");
    expect(await screen.findByText("คัดลอกสรุปแล้ว")).toBeInTheDocument();
  });
  it("ยอดที่เซ็นไม่ตรงประวัติราคา → เตือนผิดปกติ", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "changed", view: { ...checkView, historyMatchesSignedTotal: false } } });
    await submit();
    expect(screen.getByText(/ไม่ตรงกับยอดที่คิดย้อนจากประวัติราคา/)).toBeInTheDocument();
  });
  it("ไซซ์ให้แอดมินช่วยเช็ก / นอกช่วง แสดงชัด", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "ok", view: { ...checkView, size: null, sizeStatus: "admin_check" } } });
    await submit();
    expect(screen.getByText("ลูกค้าให้แอดมินช่วยเช็กไซซ์")).toBeInTheDocument();
  });
  it("ไซซ์นอกช่วง → เตือน", async () => {
    check.mockResolvedValue({ ok: true, data: { status: "ok", view: { ...checkView, size: 48, sizeStatus: "out_of_range" } } });
    await submit();
    expect(screen.getByText(/ไซซ์นี้อยู่นอกช่วงที่แบบนี้ทำ \(53–68\)/)).toBeInTheDocument();
  });
});
