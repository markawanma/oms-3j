// @vitest-environment jsdom
// วิซาร์ดเปิดใบ W-2 → W-2b → W-3 → W-6/7 → W-8 (+ W-8b replay) · error ทุก code (B.8) ฟอร์มไม่หาย · idem key คงเดิมข้ามการลองใหม่
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/s/x" }));
const intakeLogin = vi.fn();
const workerLogout = vi.fn();
const intakeSearch = vi.fn();
const intakeOpen = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeLogin: (...a: unknown[]) => intakeLogin(...a),
  workerLogout: (...a: unknown[]) => workerLogout(...a),
  intakeSearch: (...a: unknown[]) => intakeSearch(...a),
  intakeOpen: (...a: unknown[]) => intakeOpen(...a),
}));

import { ShopIntakeApp } from "./ShopIntakeApp";
import type { ShopInitial } from "./ShopHub";
import type { IntakeHubView, IntakeOpenResult, IntakeProduct } from "@/lib/jobs/worker-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const JOB_TOKEN = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx9";
const WA = "11111111-1111-4111-8111-111111111111";
const PID = "33333333-3333-4333-8333-333333333333";

const readyHub = (o: Partial<IntakeHubView> = {}): ShopInitial => ({
  kind: "hub",
  hub: { state: "ready", workers: [], worker: { id: WA, displayName: "หัวหน้าช่าง" }, openAllowed: true, profileReady: true, goldProfileReady: true, sessionExpired: false, ...o },
});
const identifyHub = (): ShopInitial => ({ kind: "hub", hub: { state: "identify", workers: [{ id: WA, displayName: "หัวหน้าช่าง" }], worker: null, openAllowed: false, profileReady: true, goldProfileReady: true, sessionExpired: true } });

const product = (o: Partial<IntakeProduct["prefill"]> = {}, rest: Partial<IntakeProduct> = {}): IntakeProduct => ({
  id: PID, sku: "RG-0418", name: "แหวนโกเมนไข่", imageUrl: null, prefill: { metal: "silver", purity: 0.925, weightG: null, metalKnown: true, ...o }, ...rest,
});
const okResult = (o: Partial<IntakeOpenResult> = {}): { ok: true; result: IntakeOpenResult } => ({
  ok: true,
  result: { already: false, status: "open", jobNo: "JB-0031", token: JOB_TOKEN, designLabel: "แหวนโกเมนไข่", sku: "RG-0418", skuPending: false, metal: "silver", qtyOrder: 30, qtyPlanned: null, isNewDesign: false, dueDate: null, ...o },
});

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
  intakeOpen.mockResolvedValue(okResult());
  workerLogout.mockResolvedValue({ ok: true });
});

const GOLD = /^ทอง(?!เหลือง)/;
const click = async (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

/** เปิดวิซาร์ด + ค้น + เลือกสินค้าแรก → ถึง W-3 */
async function toQty(items: IntakeProduct[] = [product()]) {
  intakeSearch.mockResolvedValue({ ok: true, items });
  await click("เปิดงานใหม่");
  await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
  const row = await screen.findByRole("button", { name: new RegExp(items[0].name) }, { timeout: 3000 });
  await userEvent.click(row);
  await click("ถัดไป");
}
async function fillQtyAndNext(qty = "30") {
  await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), qty);
  await click("ถัดไป");
}
const submitBtn = () => screen.getByRole("button", { name: /^(เปิดงาน|รอ \d+ วิ…|กำลังเปิดงาน…|เปิดงานไม่ได้)$/ });

describe("W-2 ค้นสินค้า", () => {
  it("ยังไม่พิมพ์: 'พิมพ์ชื่อสินค้าหรือรหัส' + กล่อง 'ไม่มีในรายการ?' อยู่เสมอ · ปุ่มถัดไป aria-disabled 'เลือกสินค้าก่อน'", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    expect(screen.getByText("พิมพ์ชื่อสินค้าหรือรหัส")).toBeInTheDocument();
    expect(screen.getByText("ไม่มีในรายการ?")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "เลือกสินค้าก่อน" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(next);
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
  });

  it("ค้นเจอ: แสดงชื่อ/รหัส/ป้ายโลหะเฉพาะ SKU ที่ระบุโลหะ (known) · ไม่แสดงป้ายให้ SKU ที่ไม่ระบุ (P1)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    intakeSearch.mockResolvedValue({
      ok: true,
      items: [product({ metal: "silver", metalKnown: true }), product({ metal: "silver", metalKnown: false }, { id: "44444444-4444-4444-8444-444444444444", sku: "RG-0402", name: "แหวนโกเมนกลม" })],
    });
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    expect(await screen.findByText("เจอ 2 รายการ", {}, { timeout: 3000 })).toBeInTheDocument();
    const known = screen.getByRole("button", { name: /RG-0418/ });
    const unknown = screen.getByRole("button", { name: /RG-0402/ });
    expect(within(known).getByText("เงิน")).toBeInTheDocument();
    expect(within(unknown).queryByText("เงิน")).not.toBeInTheDocument();
    expect(intakeSearch).toHaveBeenCalledWith(TOKEN, "แหวน");
  });

  it("loading: skeleton ระหว่างค้น + ช่องค้นยังพิมพ์ต่อได้", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeSearch.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    const input = screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส");
    await userEvent.type(input, "ก");
    expect(await screen.findByRole("status", { name: "กำลังค้น" })).toBeInTheDocument();
    expect(input).toBeEnabled();
    await act(async () => resolve({ ok: true, items: [] }));
  });

  it("ค้นไม่เจอ: ข้อความ + ปุ่ม '+ สินค้าใหม่' เป็นปุ่มหลัก", async () => {
    intakeSearch.mockResolvedValue({ ok: true, items: [] });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "ซซซ");
    expect(await screen.findByText(/ไม่พบ .ซซซ. — ลองคำอื่น หรือเปิดเป็นสินค้าใหม่/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ สินค้าใหม่ (ยังไม่มีรหัส)" })).toHaveClass("bg-primary-600");
  });

  it("ค้นล้ม: 'ค้นไม่สำเร็จ — ลองอีกครั้ง' + ปุ่มลองอีกครั้ง · กิ่งสินค้าใหม่ยังใช้ได้", async () => {
    intakeSearch.mockResolvedValueOnce({ ok: false, error: "x_y", code: "error" });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    expect(await screen.findByText("ค้นไม่สำเร็จ — ลองอีกครั้ง", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ สินค้าใหม่ (ยังไม่มีรหัส)" })).toBeEnabled();
    intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
    await click("ลองอีกครั้ง");
    expect(await screen.findByText("เจอ 1 รายการ", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("ค้นแล้ว session หมด (session_required) → ขอโหลด hub ใหม่ (แผ่น PIN)", async () => {
    intakeSearch.mockResolvedValue({ ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("ผลค้นเก่าที่มาช้ากว่าไม่ทับผลใหม่ (seq)", async () => {
    let first: (v: unknown) => void = () => {};
    intakeSearch.mockImplementationOnce(() => new Promise((r) => (first = r)));
    intakeSearch.mockImplementationOnce(() => Promise.resolve({ ok: true, items: [product({}, { name: "ใหม่กว่า", sku: "NEW-1" })] }));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    const input = screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส");
    await userEvent.type(input, "ก");
    await waitFor(() => expect(intakeSearch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await userEvent.type(input, "ข");
    expect(await screen.findByText("ใหม่กว่า", {}, { timeout: 3000 })).toBeInTheDocument();
    await act(async () => first({ ok: true, items: [product({}, { name: "เก่า", sku: "OLD-1" })] }));
    expect(screen.queryByText("เก่า")).not.toBeInTheDocument();
    expect(screen.getByText("ใหม่กว่า")).toBeInTheDocument();
  });
});

describe("กิ่งสินค้าใหม่ (ไม่มี SKU) + W-2b ทำจากอะไร", () => {
  async function toNew() {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await click("+ สินค้าใหม่ (ยังไม่มีรหัส)");
  }

  it("ชื่อแบบ: บังคับ · ตัวนับ n/60 · ถัดไป aria-disabled 'ใส่ชื่อแบบก่อน' · กดแล้วขึ้น error + โฟกัสช่อง", async () => {
    await toNew();
    expect(screen.getByRole("heading", { level: 1, name: "สินค้าใหม่" })).toBeInTheDocument();
    expect(screen.getByText("0/60")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "ใส่ชื่อแบบก่อน" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(next);
    expect(screen.getByRole("alert")).toHaveTextContent("ใส่ชื่อแบบก่อน");
    expect(screen.getByLabelText(/ชื่อแบบ/)).toHaveFocus();
  });

  it("ชื่อยาวเกิน 60 / มีขึ้นบรรทัดใหม่/ล่องหน/< > = ไม่ผ่านด้วยข้อความไทย", async () => {
    await toNew();
    const input = screen.getByLabelText(/ชื่อแบบ/);
    fireEvent.change(input, { target: { value: "ก".repeat(61) } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent("ยาวเกิน 60");
    fireEvent.change(input, { target: { value: "ก<ข" } });
    expect(screen.getByRole("alert")).toHaveTextContent("<");
    fireEvent.change(input, { target: { value: "ก​ข" } });
    expect(screen.getByRole("alert")).toHaveTextContent("มองไม่เห็น");
  });

  it("ค่าเริ่ม = เงิน เนื้อ 92.50 · ทองว่างบังคับ: กดถัดไปตอนว่าง = error ใต้ช่อง + โฟกัสช่องเนื้อ + เลื่อน", async () => {
    await toNew();
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวนลายใบไม้");
    await click("ถัดไป");
    expect(screen.getByRole("heading", { level: 1, name: "ทำจากอะไร?" })).toBeInTheDocument();
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /เงิน/ })).toBeChecked();
    expect(screen.getByLabelText(/เนื้อโลหะ/)).toHaveValue("92.50");
    await userEvent.click(screen.getByRole("radio", { name: GOLD }));
    expect(screen.getByLabelText(/เนื้อโลหะ/)).toHaveValue("");
    expect(screen.getByText("เนื้อรีเซ็ตตามโลหะใหม่")).toBeInTheDocument();
    expect(screen.getByText(/ทองหลายเนื้อ \(K\)/)).toBeInTheDocument();
    await click("ถัดไป");
    expect(screen.getByRole("alert")).toHaveTextContent("ทองต้องกรอกเนื้อทอง");
    expect(screen.getByLabelText(/เนื้อโลหะ/)).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "ทำจากอะไร?" })).toBeInTheDocument();
  });

  it("ทองเหลือง: เนื้อ 100.00 อ่านอย่างเดียว + 'ทองเหลืองไม่ต้องระบุเนื้อ'", async () => {
    await toNew();
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "กำไล");
    await click("ถัดไป");
    await userEvent.click(screen.getByRole("radio", { name: /ทองเหลือง/ }));
    const purity = screen.getByLabelText(/เนื้อโลหะ/);
    expect(purity).toHaveValue("100.00");
    expect(purity).toHaveAttribute("readonly");
    expect(screen.getByText("ทองเหลืองไม่ต้องระบุเนื้อ")).toBeInTheDocument();
  });

  it("เงิน: เนื้อ 92.50 แก้ได้ (99.90) · น้ำหนักผิดรูป = error ใต้ช่องหลัง blur · ไม่มีช่องราคา", async () => {
    await toNew();
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวน");
    await click("ถัดไป");
    const purity = screen.getByLabelText(/เนื้อโลหะ/);
    await userEvent.clear(purity);
    await userEvent.type(purity, "99.90");
    expect(purity).toHaveValue("99.90");
    const w = screen.getByLabelText(/น้ำหนักต่อชิ้น/);
    await userEvent.type(w, "3.2345");
    fireEvent.blur(w);
    expect(screen.getByRole("alert")).toHaveTextContent("น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)");
    expect(screen.queryByLabelText(/ราคา|ต้นทุน/)).not.toBeInTheDocument();
    await userEvent.clear(w);
    await userEvent.type(w, "3.2");
    await click("ถัดไป");
    expect(screen.getByRole("heading", { level: 1, name: "เท่าไร · เสร็จเมื่อไร" })).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
  });

  it("pre-check โปรไฟล์ทอง (R1): ไม่มีแบบทอง → กล่องเดียวกันทันที + ถัดไป aria-disabled + ไม่มีปุ่มเปลี่ยนโลหะให้", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub({ goldProfileReady: false })} />);
    await click("เปิดงานใหม่");
    await click("+ สินค้าใหม่ (ยังไม่มีรหัส)");
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวนทอง");
    await click("ถัดไป");
    await userEvent.click(screen.getByRole("radio", { name: GOLD }));
    await userEvent.type(screen.getByLabelText(/เนื้อโลหะ/), "90");
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("อย่าเปลี่ยนเป็นโลหะอื่นเพื่อเปิดผ่าน");
    const next = screen.getByRole("button", { name: "เปิดงานวัสดุนี้ไม่ได้ตอนนี้" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(next);
    expect(screen.getByRole("heading", { level: 1, name: "ทำจากอะไร?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /เงิน/ }));
    expect(screen.getByRole("button", { name: "ถัดไป" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("W-3 มี SKU: บล็อก 'ทำจาก' + แผ่นแก้", () => {
  it("แสดงบล็อกทำจาก (ป้ายเงิน · เนื้อ 92.50% · น้ำหนัก ยังไม่ระบุ · ค่าจากสินค้าในระบบ) · จำนวนเริ่มว่าง · เผื่อค่าเริ่มปิด · กำหนดเสร็จค่าเริ่มยังไม่กำหนด · แบบใหม่ไม่ติ๊ก", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    const block = screen.getByRole("region", { name: "ทำจาก" });
    expect(within(block).getByText("เงิน")).toBeInTheDocument();
    expect(within(block).getByText("เนื้อ 92.50%")).toBeInTheDocument();
    expect(within(block).getByText("น้ำหนัก ยังไม่ระบุ")).toBeInTheDocument();
    expect(within(block).getByText("ค่าจากสินค้าในระบบ")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "ยังไม่กำหนด" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /แบบใหม่/ })).not.toBeChecked();
    expect(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)")).toHaveValue("");
  });

  it("แก้เป็นทองบน SKU ที่ระบุเงิน (known) → กล่องเตือนเหลืองในแผ่น · ใช้ค่านี้ต้องมีเนื้อ · ยกเลิก = ไม่เปลี่ยนอะไร", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await click("แก้");
    const dlg = screen.getByRole("dialog", { name: "แก้วัสดุ" });
    await userEvent.click(within(dlg).getByRole("radio", { name: GOLD }));
    expect(within(dlg).getByRole("note")).toHaveTextContent("สินค้านี้ในระบบเป็น เงิน — คุณเลือก ทอง");
    await userEvent.click(within(dlg).getByRole("button", { name: "ใช้ค่านี้" }));
    expect(within(dlg).getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("ทองต้องกรอกเนื้อทอง");
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    const block = screen.getByRole("region", { name: "ทำจาก" });
    expect(within(block).getByText("เงิน")).toBeInTheDocument();
    expect(within(block).getByText("ค่าจากสินค้าในระบบ")).toBeInTheDocument();
  });

  it("แก้เป็นทอง 96.5 → บล็อกขึ้นทอง + 'แก้แล้ว' + ต่างจากสินค้าในระบบ · ส่ง payload metal/เนื้อ", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await click("แก้");
    const dlg = screen.getByRole("dialog", { name: "แก้วัสดุ" });
    await userEvent.click(within(dlg).getByRole("radio", { name: GOLD }));
    await userEvent.type(within(dlg).getByLabelText(/เนื้อโลหะ/), "96.5");
    await userEvent.click(within(dlg).getByRole("button", { name: "ใช้ค่านี้" }));
    const block = screen.getByRole("region", { name: "ทำจาก" });
    expect(within(block).getByText("ทอง")).toBeInTheDocument();
    expect(within(block).getByText("เนื้อ 96.50%")).toBeInTheDocument();
    expect(within(block).getByText("แก้แล้ว")).toBeInTheDocument();
    expect(within(block).getByRole("note")).toHaveTextContent("ต่างจากสินค้าในระบบ");
    await fillQtyAndNext("12");
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(intakeOpen.mock.calls[0][1]).toMatchObject({ productId: PID, metal: "gold", purityPct: "96.5", qty: "12" });
  });

  it("SKU ไม่ระบุโลหะ (known=false): กล่องกลาง 'ยังไม่ระบุโลหะในระบบ' ไม่ใช่คำเตือน แม้เลือกทอง", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty([product({ metalKnown: false })]);
    await click("แก้");
    const dlg = screen.getByRole("dialog", { name: "แก้วัสดุ" });
    await userEvent.click(within(dlg).getByRole("radio", { name: GOLD }));
    const note = within(dlg).getByRole("note");
    expect(note).toHaveTextContent("ยังไม่ระบุโลหะในระบบ — ตรวจให้ตรงของจริง");
    expect(note.textContent).not.toMatch(/⚠/);
  });

  it("SKU ทองที่เนื้อว่าง: บล็อกขึ้น 'ต้องใส่เนื้อ' · กดถัดไป → เปิดแผ่นแก้อัตโนมัติ + โฟกัสช่องเนื้อ (ไม่รอ error จากเซิร์ฟเวอร์)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty([product({ metal: "gold", purity: null, weightG: null })]);
    expect(within(screen.getByRole("region", { name: "ทำจาก" })).getAllByText(/ต้องใส่เนื้อ/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "ใส่เนื้อก่อน" })).toBeInTheDocument();
    await click("ใส่เนื้อก่อน");
    const dlg = screen.getByRole("dialog", { name: "แก้วัสดุ" });
    await waitFor(() => expect(within(dlg).getByLabelText(/เนื้อโลหะ/)).toHaveFocus());
    expect(within(dlg).getByRole("alert")).toHaveTextContent("ทองต้องกรอกเนื้อทอง");
    expect(intakeOpen).not.toHaveBeenCalled();
  });

  it("จำนวนว่าง/ผิด: error ใต้ช่อง + โฟกัส · สวิตช์เผื่อ: เปิดแล้วมีช่อง + 'เริ่มผลิต N ชิ้น' · เลือกวัน", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await click("ถัดไป");
    expect(screen.getByRole("alert")).toHaveTextContent("ใส่จำนวนชิ้นที่ต้องการ");
    expect(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)")).toHaveFocus();
    await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await userEvent.type(screen.getByLabelText("เผื่อเพิ่มกี่ชิ้น"), "5");
    expect(screen.getByText("เริ่มผลิต 35 ชิ้น")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "เลือกวัน" }));
    const date = screen.getByLabelText("วันที่กำหนดเสร็จ");
    fireEvent.change(date, { target: { value: "2025-01-01" } });
    await click("ถัดไป");
    expect(screen.getByRole("alert")).toHaveTextContent("ย้อนหลัง");
    expect(date).toHaveFocus();
  });
});

describe("W-6/7 ทวน → เปิดงาน → W-8", () => {
  it("เส้นทางเต็ม มี SKU ไม่แก้อะไร: ส่งแค่ productId + จำนวน · QR ใบงานบนจอ + 'แสดงครั้งเดียว' · ไม่มีปุ่มยกเลิก", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext("30");
    expect(screen.getByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" })).toBeInTheDocument();
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.getByText("30 ชิ้น · ไม่เผื่อ")).toBeInTheDocument();
    expect(screen.getAllByText("ยังไม่กำหนด").length).toBeGreaterThan(0);
    expect(screen.getByText("เปิดแล้วช่างเริ่มได้ทันที · ออฟฟิศจะ “รับทราบ” และพิมพ์ใบ A5 ให้")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    const [tok, input] = intakeOpen.mock.calls[0];
    expect(tok).toBe(TOKEN);
    expect(input).toMatchObject({ productId: PID, qty: "30", isNewDesign: false, dueDate: null, note: null });
    expect(input.idemKey).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect("metal" in input).toBe(false);
    const h = await screen.findByRole("heading", { level: 1 });
    expect(h).toHaveTextContent("เปิดงานแล้ว JB-0031");
    expect(h).toHaveFocus();
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.getByText(/QR นี้แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดอีกใบ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เสร็จแล้ว" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยกเลิก/ })).not.toBeInTheDocument();
    expect(screen.getByText(/เปิดผิด\? แจ้งออฟฟิศ/)).toBeInTheDocument();
  });

  it("สินค้าใหม่ทอง: แถว 'ทำจาก' กรอบหนาเหลือง · ป้ายไม่มีรหัสสินค้า · payload label+metal+เนื้อ+น้ำหนัก · W-8 มีป้ายทองและธง ⚑ แต่ไม่โชว์น้ำหนัก", async () => {
    intakeOpen.mockResolvedValue(okResult({ metal: "gold", sku: null, skuPending: true, designLabel: "แหวนลายใบไม้" }));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await click("+ สินค้าใหม่ (ยังไม่มีรหัส)");
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวนลายใบไม้");
    await click("ถัดไป");
    await userEvent.click(screen.getByRole("radio", { name: GOLD }));
    await userEvent.type(screen.getByLabelText(/เนื้อโลหะ/), "96.5");
    await userEvent.type(screen.getByLabelText(/น้ำหนักต่อชิ้น/), "3.200");
    await click("ถัดไป");
    await fillQtyAndNext("30");
    expect(screen.getByText(/ไม่มีรหัสสินค้า/)).toBeInTheDocument();
    expect(screen.getByText("เนื้อ 96.50%").closest("div[class*='border-yellow-600']")).not.toBeNull();
    expect(screen.getByText("น้ำหนัก 3.2 กรัม/ชิ้น")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(intakeOpen.mock.calls[0][1]).toMatchObject({ label: "แหวนลายใบไม้", metal: "gold", purityPct: "96.5", weight: "3.200", qty: "30" });
    expect("productId" in intakeOpen.mock.calls[0][1]).toBe(false);
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    expect(screen.getByText("ทอง")).toBeInTheDocument();
    expect(screen.getByText("เนื้อ 96.50%")).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มีรหัสสินค้า — ออฟฟิศจะผูกให้/)).toBeInTheDocument();
    // N1: หลังเปิดไม่โชว์น้ำหนักงานทอง
    expect(document.body.textContent).not.toMatch(/3\.2|3\.200|กรัม/);
  });

  it("เผื่อ/กำหนด/แบบใหม่/หมายเหตุ ไปถึง payload · ปุ่มแก้สินค้ากลับ W-2 โดยคงสินค้าที่เลือก", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.type(screen.getByLabelText("เผื่อเพิ่มกี่ชิ้น"), "5");
    await userEvent.click(screen.getByRole("radio", { name: /^7 วัน/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /แบบใหม่/ }));
    await click("ถัดไป");
    expect(screen.getByText("สั่ง 30 + เผื่อ 5 = เริ่มผลิต 35 ชิ้น")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/หมายเหตุ/), "เร่งด่วน");
    await click("แก้สินค้า");
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 })).toHaveAttribute("aria-pressed", "true");
    await click("ถัดไป");
    await click("ถัดไป");
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(intakeOpen.mock.calls[0][1]).toMatchObject({ qty: "30", buffer: "5", isNewDesign: true, note: "เร่งด่วน" });
    expect(intakeOpen.mock.calls[0][1].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("กดซ้ำรัวๆ ระหว่างส่ง → เรียก intakeOpen ครั้งเดียว · ปุ่ม 'กำลังเปิดงาน…' · ช่อง/ปุ่มแก้ถูกปิด", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeOpen.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext();
    const btn = screen.getByRole("button", { name: "เปิดงาน" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByRole("button", { name: "กำลังเปิดงาน…" });
    expect(intakeOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/หมายเหตุ/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "แก้สินค้า" })).toBeDisabled();
    await act(async () => resolve(okResult()));
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว/ });
    expect(intakeOpen).toHaveBeenCalledTimes(1);
  });

  it("เปิดอีกใบ = ฟอร์มใหม่ + idem key ใหม่ · เสร็จแล้ว = กลับ hub (QR หายจากจอ)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext();
    await click("เปิดงาน");
    await screen.findByRole("img", { name: /QR ใบงาน/ });
    const key1 = intakeOpen.mock.calls[0][1].idemKey;
    await click("เปิดอีกใบ");
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR ใบงาน/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
    await click("ถัดไป");
    await fillQtyAndNext();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).not.toBe(key1);
    await screen.findByRole("img", { name: /QR ใบงาน/ });
    await click("เสร็จแล้ว");
    expect(screen.queryByRole("img", { name: /QR ใบงาน/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });
});

describe("W-8b replay (key เดิม — เปิดไปแล้ว)", () => {
  async function toReview() {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext("30");
  }

  it("เน็ตสะดุดครั้งแรก → ข้อความ + กดซ้ำด้วย idem key เดิม → 'เปิดไว้แล้ว JB-xxxx' ไม่มี QR ไม่มีเปิดอีกใบ ไม่มียกเลิก · ค่ามาจาก DB ไม่ใช่ฟอร์ม", async () => {
    intakeOpen.mockRejectedValueOnce(new Error("network"));
    intakeOpen.mockResolvedValueOnce(okResult({ already: true, token: null, designLabel: "ชื่อจาก DB", qtyOrder: 45, qtyPlanned: 50 }));
    await toReview();
    await click("เปิดงาน");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ส่งไม่สำเร็จ — เช็คสัญญาณแล้วกด \"เปิดงาน\" อีกครั้ง (กดซ้ำได้ ระบบไม่เปิดซ้ำซ้อน)");
    expect(screen.getByText("30 ชิ้น · ไม่เผื่อ")).toBeInTheDocument(); // ฟอร์มไม่หาย
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).toBe(intakeOpen.mock.calls[0][1].idemKey);
    const h = await screen.findByRole("heading", { level: 1 });
    expect(h).toHaveTextContent("เปิดไว้แล้ว JB-0031");
    expect(screen.getByText(/ชื่อจาก DB/)).toBeInTheDocument();
    expect(screen.getByText(/50 ชิ้น/)).toBeInTheDocument();
    expect(screen.queryByText(/30 ชิ้น/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดอีกใบ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยกเลิก/ })).not.toBeInTheDocument();
    expect(screen.getByText(/QR แสดงซ้ำไม่ได้/)).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("done-already")).toBeInTheDocument();
  });

  it("replay แต่ใบถูกยกเลิกแล้ว (status=cancelled) → 'ใบนี้ถูกยกเลิกแล้ว' ไม่ใช่ 'เปิดไว้แล้ว'", async () => {
    intakeOpen.mockResolvedValue(okResult({ already: true, token: null, status: "cancelled" }));
    await toReview();
    await click("เปิดงาน");
    const h = await screen.findByRole("heading", { level: 1 });
    expect(h).toHaveTextContent("ใบนี้ถูกยกเลิกแล้ว JB-0031");
    expect(h).not.toHaveTextContent("เปิดไว้แล้ว");
    expect(screen.queryByRole("img", { name: /QR/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("done-cancelled")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("B.8 ข้อผิดพลาดตอนกด 'เปิดงาน' — ฟอร์มและค่าที่กรอกไม่หายทุกกรณี", () => {
  async function toReview() {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext("30");
  }
  const stillThere = () => expect(screen.getByText("30 ชิ้น · ไม่เผื่อ")).toBeInTheDocument();

  it("rate_limited + retryAfter: ข้อความ + ปุ่ม 'รอ n วิ…' aria-disabled → กลับ 'เปิดงาน' เอง · ประกาศครั้งเดียว (ตัวเลขรายวินาที aria-hidden)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "rate_limited", retryAfterSeconds: 3 });
    await toReview();
    await click("เปิดงาน");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ส่งถี่เกินไป — รอสักครู่แล้วกด \"เปิดงาน\" อีกครั้ง");
    expect(alert).toHaveTextContent("ลองใหม่ได้ใน 3 วินาที");
    const wait = screen.getByRole("button", { name: "รอ 3 วิ…" });
    expect(wait).toHaveAttribute("aria-disabled", "true");
    expect(alert.querySelector("[aria-hidden='true']")).toHaveTextContent("รอ 3 วิ…");
    fireEvent.click(wait);
    expect(intakeOpen).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "รอ 2 วิ…" })).toBeInTheDocument();
    // alert ไม่ถูกเขียนใหม่ทุกวินาที (ข้อความหลักคงเดิม)
    expect(screen.getByRole("alert")).toHaveTextContent("ลองใหม่ได้ใน 3 วินาที");
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    const again = screen.getByRole("button", { name: "เปิดงาน" });
    expect(again).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("พร้อมแล้ว");
    stillThere();
    intakeOpen.mockResolvedValueOnce(okResult());
    fireEvent.click(again);
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).toBe(intakeOpen.mock.calls[0][1].idemKey);
  });

  it("rate_limited ไม่มี retryAfter: ข้อความ + กดซ้ำได้ทันที", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "rate_limited" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("ส่งถี่เกินไป");
    expect(screen.getByRole("button", { name: "เปิดงาน" })).not.toHaveAttribute("aria-disabled");
    stillThere();
  });

  it("no_default_profile: ข้อความ + ลองอีกครั้ง (รอง) · ไม่ชี้ URL", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "no_default_profile" });
    await toReview();
    await click("เปิดงาน");
    const a = await screen.findByRole("alert");
    expect(a).toHaveTextContent("ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน");
    expect(a.textContent).not.toMatch(/https?:|\//);
    intakeOpen.mockResolvedValueOnce(okResult());
    await click("ลองอีกครั้ง");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).toBe(intakeOpen.mock.calls[0][1].idemKey);
  });

  it("no_gold_profile (ผ่านด่าน client มาแล้ว): ข้อความ + กลับไปแก้ · ไม่มีปุ่มเปลี่ยนโลหะ", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "no_gold_profile" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("อย่าเปลี่ยนเป็นโลหะอื่นเพื่อเปิดผ่าน");
    expect(screen.queryByRole("button", { name: /เปลี่ยน/ })).not.toBeInTheDocument();
    await click("กลับไปแก้");
    expect(screen.getByRole("dialog", { name: "แก้วัสดุ" })).toBeInTheDocument();
  });

  it("job_exists: ข้อความมีเลขใบที่ชน + 'กลับไปเลือกสินค้า' · ไม่มีลิงก์", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "SKU นี้มีใบงาน JB-0031 เปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น", code: "job_exists" });
    await toReview();
    await click("เปิดงาน");
    const a = await screen.findByRole("alert");
    expect(a).toHaveTextContent("SKU นี้มีใบงาน JB-0031 เปิดอยู่แล้ว");
    expect(document.querySelectorAll("a, [href]").length).toBe(0);
    await click("กลับไปเลือกสินค้า");
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 })).toHaveAttribute("aria-pressed", "true");
  });

  it("session_required: โหลด hub ใหม่ → แผ่น PIN (ฟอร์มซ่อน ไม่หาย) → ใส่ PIN ผ่าน → ฟอร์มเดิมกลับมา กดเปิดงานต่อด้วย key เดิม", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "session_required" });
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await fillQtyAndNext("30");
    await click("เปิดงาน");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // server ส่ง hub ใหม่: ต้องใส่ PIN
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("หมดเวลาแล้ว — ใส่ PIN ใหม่ · ข้อมูลที่กรอกยังอยู่");
    // ใส่ PIN ผ่าน → hub ready อีกครั้ง
    rerender(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    expect(screen.getByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" })).toBeInTheDocument();
    stillThere();
    intakeOpen.mockResolvedValueOnce(okResult());
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).toBe(intakeOpen.mock.calls[0][1].idemKey);
  });

  it("invalid_token ระหว่างกรอก: ข้อความ 'ถูกยกเลิกแล้ว' + ปุ่มเปิดงาน aria-disabled + ฟอร์มคงอยู่ · ลองอีกครั้งได้", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "invalid_token" });
    await toReview();
    await click("เปิดงาน");
    const a = await screen.findByRole("alert");
    expect(a).toHaveTextContent("QR ร้านนี้ถูกยกเลิกแล้ว — เปิดงานไม่ได้ ให้ออฟฟิศออก QR ใหม่");
    expect(a).toHaveTextContent("ข้อมูลที่กรอกยังอยู่ในเครื่อง");
    expect(screen.getByRole("button", { name: "เปิดงานไม่ได้" })).toHaveAttribute("aria-disabled", "true");
    stillThere();
    expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // ไม่โหลด hub ใหม่ (จะเสียฟอร์ม)
  });

  it("token_budget_exhausted: 'ขอ QR ร้านใหม่จากออฟฟิศ' · จบ", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "token_budget_exhausted" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("ขอ QR ร้านใหม่จากออฟฟิศ");
    expect(screen.getByRole("button", { name: "เปิดงานไม่ได้" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "ลองอีกครั้ง" })).not.toBeInTheDocument();
  });

  it("not_allowed (ออฟฟิศถอนสิทธิ์ระหว่างกรอก): 'บัญชีนี้ไม่มีสิทธิ์เปิดงานแล้ว — แจ้งออฟฟิศ' · จบ", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "not_allowed" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("บัญชีนี้ไม่มีสิทธิ์เปิดงานแล้ว — แจ้งออฟฟิศ");
    expect(screen.getByRole("button", { name: "เปิดงานไม่ได้" })).toHaveAttribute("aria-disabled", "true");
  });

  it("idem_conflict: สร้างคีย์ใหม่ให้ แล้วกดซ้ำได้ (ครั้งที่สองใช้คีย์ใหม่ ไม่ใช่คีย์ที่ชน)", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "idem_conflict" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("ระบบสร้างรหัสคำขอใหม่ให้แล้ว");
    intakeOpen.mockResolvedValueOnce(okResult());
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(intakeOpen.mock.calls[1][1].idemKey).not.toBe(intakeOpen.mock.calls[0][1].idemKey);
    stillThere;
  });

  it("ข้อมูลผิดรูปที่ server จับได้ (field=qty): ข้อความ + 'กลับไปแก้' พาไปช่องจำนวน (ค่าเดิมยังอยู่)", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "จำนวนต้องอยู่ระหว่าง 1–100,000", code: "qty_invalid", field: "qty" });
    await toReview();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("จำนวนต้องอยู่ระหว่าง 1–100,000");
    await click("กลับไปแก้");
    expect(screen.getByRole("heading", { level: 1, name: "เท่าไร · เสร็จเมื่อไร" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)")).toHaveFocus());
    expect(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)")).toHaveValue("30");
  });

  it("ข้อความดิบที่ไม่สะอาดจาก server ไม่ถึงจอ (snake_case / ชื่อตาราง / เงิน)", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "relation analytics.production_order violates constraint ต้นทุน 120 บาท", code: "error" });
    await toReview();
    await click("เปิดงาน");
    const a = await screen.findByRole("alert");
    expect(a.textContent).not.toMatch(/analytics|production_order|constraint|ต้นทุน|บาท/);
    expect(a).toHaveTextContent("ส่งไม่สำเร็จ — เช็คสัญญาณ");
  });

  it("ทุก error ข้างบนไม่มีตัวเลขเงิน/รหัสดิบบนจอ (ไล่ code ที่รู้จักทั้งหมด)", async () => {
    const codes = ["rate_limited", "no_default_profile", "no_gold_profile", "not_ready", "idem_conflict", "name_invalid", "gold_purity_required", "metal_required", "invalid_input"];
    for (const code of codes) {
      cleanup();
      vi.clearAllMocks();
      intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
      intakeOpen.mockResolvedValueOnce({ ok: false, error: "x_y", code, retryAfterSeconds: code === "rate_limited" ? 5 : undefined });
      await toReview();
      await click("เปิดงาน");
      const a = await screen.findByRole("alert");
      expect(a.textContent, code).not.toMatch(/[A-Za-z]+_[A-Za-z_]+|บาท|฿|ราคา|ต้นทุน/);
    }
  });
});

describe("ย้อนกลับ/ออก", () => {
  it("‹ ที่ W-2 กลับ hub · ‹ ที่ขั้นอื่นกลับขั้นก่อน (ค่าที่กรอกคงอยู่)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toQty();
    await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
    await click("ย้อนกลับ");
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    await click("ถัดไป");
    expect(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)")).toHaveValue("30");
    await click("ย้อนกลับ");
    await click("ย้อนกลับ");
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });
});

describe("🔴 ไม่มีเงิน/ต้นทุน/ลิงก์ ทุกจอของวิซาร์ด", () => {
  it("W-2 · W-3 · W-6/7 · W-8", async () => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    const money = () => expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost/i);
    await click("เปิดงานใหม่");
    money();
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
    await click("ถัดไป");
    money();
    await fillQtyAndNext();
    money();
    await click("เปิดงาน");
    await screen.findByRole("img", { name: /QR ใบงาน/ });
    money();
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
  });
});
