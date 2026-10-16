// @vitest-environment jsdom
// PaymentLinesSection (/oem/rates · 0179): [] ≠ null (ห้ามพูด "ยังไม่ได้ตั้ง" เมื่อโหลดไม่ได้) · validation · error ค้าง · payload
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const setSellerPaymentLines = vi.fn();
vi.mock("@/lib/actions/oem", () => ({ setSellerPaymentLines: (...a: unknown[]) => setSellerPaymentLines(...a) }));

import { ToastProvider } from "@/components/ui/Toast";
import { PaymentLinesSection } from "./PaymentLinesSection";
import { parsePaymentLinesText } from "@/lib/oem/paymentLinesForm";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const LINE_A = "TEST-ONLY ช่องทาง ก";
const LINE_B = "TEST-ONLY ช่องทาง ข";

beforeEach(() => {
  vi.clearAllMocks();
  setSellerPaymentLines.mockResolvedValue({ ok: true, data: undefined });
});

describe("parsePaymentLinesText", () => {
  it("ตัดแถวว่าง/ช่องว่างล้วน · trim · นับเฉพาะบรรทัดที่มีเนื้อ", () => {
    const r = parsePaymentLinesText(`  ${LINE_A}  \n\n   \r\n${LINE_B}\n`);
    expect(r).toEqual({ lines: [LINE_A, LINE_B], count: 2, error: null });
  });
  it("200 ตัวผ่าน · 201 ตกที่บรรทัดตามที่เห็นใน textarea (นับ code point)", () => {
    expect(parsePaymentLinesText("ก".repeat(200)).error).toBeNull();
    expect(parsePaymentLinesText(`${LINE_A}\n\n${"ก".repeat(201)}`).error).toBe("บรรทัดที่ 3 ยาวเกิน 200 ตัวอักษร (กรอก 201)");
    // emoji = 1 code point (ไม่ใช่ 2 UTF-16 units)
    expect(parsePaymentLinesText("😀".repeat(200)).error).toBeNull();
  });
  it("6 บรรทัดผ่าน · 7 ตก", () => {
    const six = Array.from({ length: 6 }, (_, i) => `L${i}`).join("\n");
    expect(parsePaymentLinesText(six).error).toBeNull();
    expect(parsePaymentLinesText(`${six}\nL7`).error).toMatch(/ไม่เกิน 6 บรรทัด/);
  });
  it("ว่างทั้งหมด = 0 บรรทัด ไม่ error (เป็นการล้าง)", () => {
    expect(parsePaymentLinesText("")).toEqual({ lines: [], count: 0, error: null });
  });
});

describe("PaymentLinesSection", () => {
  it("anchor id=oem-payment-lines + หัวข้อ + ข้อความ snapshot", () => {
    const { container } = wrap(<PaymentLinesSection paymentLines={[]} />);
    expect(container.querySelector("#oem-payment-lines")).not.toBeNull();
    expect(screen.getByText("ช่องทางชำระเงิน (พิมพ์บนใบแจ้งหนี้)")).toBeInTheDocument();
    expect(screen.getByText(/เปลี่ยนทีหลังไม่กระทบใบที่ออกไปแล้ว/)).toBeInTheDocument();
  });

  it("[] = อ่านได้แต่ยังไม่ตั้ง → แถบเหลือง 'ยังไม่ได้ตั้ง' · textarea/ปุ่มใช้งานได้ · ไม่มีค่าตัวอย่างใน placeholder", () => {
    wrap(<PaymentLinesSection paymentLines={[]} />);
    expect(screen.getByText(/ยังไม่ได้ตั้งช่องทางชำระเงิน — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะตั้ง/)).toBeInTheDocument();
    const ta = screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง");
    expect(ta).toBeEnabled();
    expect(ta).toHaveAttribute("placeholder", "ใส่ช่องทางชำระเงินของร้าน บรรทัดละ 1 ช่องทาง");
    expect((ta as HTMLTextAreaElement).placeholder).not.toMatch(/\d{4,}|ธนาคาร|พร้อมเพย์/);
    expect(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" })).toBeEnabled();
    expect(screen.getByText("0/6")).toBeInTheDocument();
  });

  it("มีค่า → แถบเขียว 'ตั้งแล้ว N ช่องทาง' + เติมค่าเดิมในช่อง + ตัวนับ", () => {
    wrap(<PaymentLinesSection paymentLines={[LINE_A, LINE_B]} />);
    expect(screen.getByText("ตั้งแล้ว 2 ช่องทาง — ออกใบแจ้งหนี้ได้")).toBeInTheDocument();
    expect(screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง")).toHaveValue(`${LINE_A}\n${LINE_B}`);
    expect(screen.getByText("2/6")).toBeInTheDocument();
  });

  it("null = โหลดไม่ได้ → แถบแดง · ล็อก textarea + ปุ่ม · ห้ามมีคำว่า 'ยังไม่ได้ตั้ง' · ไม่เรียก action", async () => {
    const { container } = wrap(<PaymentLinesSection paymentLines={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดช่องทางชำระไม่สำเร็จ");
    expect(screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง")).toBeDisabled();
    expect(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" })).toBeDisabled();
    expect(container.textContent).not.toContain("ยังไม่ได้ตั้งช่องทางชำระ");
    expect(container.textContent).not.toContain("ตั้งแล้ว");
    // กด submit ตรงๆ ก็ไม่ส่ง (กันบันทึกทับค่าเดิมด้วย [])
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(setSellerPaymentLines).not.toHaveBeenCalled();
  });

  it("บันทึก → ส่ง {lines} ที่ trim + ตัดแถวว่างแล้ว · สำเร็จ → refresh", async () => {
    wrap(<PaymentLinesSection paymentLines={[]} />);
    await userEvent.type(screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง"), `  ${LINE_A}  {enter}{enter}${LINE_B}`);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" }));
    await waitFor(() => expect(setSellerPaymentLines).toHaveBeenCalledTimes(1));
    expect(setSellerPaymentLines).toHaveBeenCalledWith({ lines: [LINE_A, LINE_B] });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("บรรทัดยาวเกิน 200 → ข้อความ 'บรรทัดที่ N ยาวเกิน…' · ปุ่มปิด · ไม่เรียก action", async () => {
    wrap(<PaymentLinesSection paymentLines={[]} />);
    const ta = screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง");
    await userEvent.click(ta);
    await userEvent.paste(`${LINE_A}\n${"ก".repeat(201)}`);
    expect(screen.getByRole("alert")).toHaveTextContent("บรรทัดที่ 2 ยาวเกิน 200 ตัวอักษร (กรอก 201)");
    expect(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" })).toBeDisabled();
    expect(setSellerPaymentLines).not.toHaveBeenCalled();
  });

  it("7 บรรทัด → ตัวนับ 7/6 + error + ปุ่มปิด", async () => {
    wrap(<PaymentLinesSection paymentLines={[]} />);
    await userEvent.click(screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง"));
    await userEvent.paste(Array.from({ length: 7 }, (_, i) => `L${i}`).join("\n"));
    expect(screen.getByText("7/6")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/ไม่เกิน 6 บรรทัด/);
    expect(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" })).toBeDisabled();
  });

  it("server ปฏิเสธ → error ค้าง (role=alert) ไม่ refresh · พิมพ์ต่อแล้วเคลียร์", async () => {
    setSellerPaymentLines.mockResolvedValue({ ok: false, error: "ช่องทางชำระเงินของร้านมีบรรทัดที่ไม่ผ่านเงื่อนไข" });
    wrap(<PaymentLinesSection paymentLines={[]} />);
    const ta = screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง");
    await userEvent.type(ta, LINE_A);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" }));
    await waitFor(() => expect(document.getElementById("oem-payment-lines-error")).toHaveTextContent(/ไม่ผ่านเงื่อนไข/));
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.type(ta, "x");
    expect(document.getElementById("oem-payment-lines-error")).toBeNull();
  });

  it("ล้างทั้งหมดแล้วบันทึก → เตือน + ส่ง lines: [] (ล้างจริง)", async () => {
    wrap(<PaymentLinesSection paymentLines={[LINE_A]} />);
    await userEvent.clear(screen.getByLabelText("ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง"));
    expect(screen.getByText(/กดบันทึกแล้วจะล้างช่องทางชำระที่ตั้งไว้/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "บันทึกช่องทางชำระ" }));
    await waitFor(() => expect(setSellerPaymentLines).toHaveBeenCalledWith({ lines: [] }));
  });
});
