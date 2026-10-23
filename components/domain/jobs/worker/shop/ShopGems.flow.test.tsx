// @vitest-environment jsdom
// W3 UI — W-4 "พลอย" บนมือถือผู้จัดการ (วิซาร์ดเปิดใบ) + แถวพลอยในหน้าทวน + สรุปใน W-8 · ทดสอบผ่าน ShopIntakeApp จริง (mock เฉพาะ server action)
// ต้องถูก: ตอบ "ฝังพลอยไหม" ก่อน (ไม่มีค่าเริ่มเมื่อไม่มีแม่แบบ) · มีพลอยต้อง ≥ 1 แถวครบไม่ซ้ำ · แถวไม่ครบพับไม่ได้ · แถวซ้ำต้องรวมเอง · ชื่อใหม่/ชื่อคล้าย · แม่แบบส่ง "template" เมื่อไม่แตะ ·
//   server ปฏิเสธแถวไหน พากลับแถว/ช่องนั้น ฟอร์มคงอยู่ · ชื่อคล้ายจาก DB ถาม → force เฉพาะชื่อนั้น · เพดาน gem_name_cap ข้อความกลาง · 4 state (loading/empty/error/success)
// ต้องไม่พัง: ตัวนับขั้น · ฟอร์ม/คำตอบคงอยู่ตอนย้อน · ไม่มีเงิน/ราคาในทุกจอ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
const intakeMyJobs = vi.fn();
const intakeGemCatalog = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeGemCatalog: (...a: unknown[]) => intakeGemCatalog(...a),
  intakeMyJobs: (...a: unknown[]) => intakeMyJobs(...a),
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
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const I1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const I2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const readyHub = (): ShopInitial => ({ kind: "hub", hub: { state: "ready", workers: [], worker: { id: WA, displayName: "หัวหน้าช่าง" }, openAllowed: true, profileReady: true, goldProfileReady: true, sessionExpired: false } as IntakeHubView });
const product = (): IntakeProduct => ({ id: PID, sku: "RG-0418", name: "แหวนโกเมนไข่", imageUrl: null, prefill: { metal: "silver", purity: 0.925, weightG: null, metalKnown: true } });
const okResult = (o: Partial<IntakeOpenResult> = {}): { ok: true; result: IntakeOpenResult } => ({
  ok: true,
  result: { already: false, status: "open", jobNo: "JB-0031", token: JOB_TOKEN, designLabel: "แหวนโกเมนไข่", sku: "RG-0418", skuPending: false, metal: "silver", qtyOrder: 30, qtyPlanned: null, isNewDesign: false, dueDate: null, ...o },
});
const catalog = (o: Record<string, unknown> = {}) => ({
  ok: true,
  types: [{ id: T1, name: "โกเมน" }, { id: T2, name: "CZ" }],
  shapes: [{ id: S1, name: "กลม", hasLength: false }, { id: S2, name: "ไข่", hasLength: true }],
  sizes: [{ typeId: T1, shapeId: S1, sizeA: 4, sizeB: null }, { typeId: T1, shapeId: S1, sizeA: 5, sizeB: null }],
  hasTemplate: false,
  template: [],
  maxLines: 30,
  ...o,
});
const tline = (id: string, label: string, qty: number, position: string | null, sizeA: number, sizeB: number) => ({ gemItemId: id, label, typeId: T1, typeName: "โกเมน", shapeId: S2, shapeName: "ไข่", hasLength: true, sizeA, sizeB, qtyPerPiece: qty, position });
const TEMPLATE = [tline(I1, "โกเมน · ไข่ · 4×6 มม.", 2, "ล้อมรอบ", 4, 6), tline(I2, "โกเมน · ไข่ · 3×5 มม.", 30, null, 3, 5)];

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [], maxPhotos: 3 });
  intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
  intakeOpen.mockResolvedValue(okResult());
  workerLogout.mockResolvedValue({ ok: true });
  intakeGemCatalog.mockResolvedValue(catalog());
});

const click = async (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const radio = (name: string) => screen.getByRole("radio", { name });

/** เปิดวิซาร์ด → เลือก SKU → จำนวน → ถึง W-4 */
async function toGems(qty = "30") {
  await click("เปิดงานใหม่");
  await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
  await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
  await click("ถัดไป");
  await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), qty);
  await click("ถัดไป");
  await screen.findByRole("heading", { level: 1, name: "พลอย" });
}
/** เลือกจากแผ่นเลือกชนิด/รูปทรง (GemPicker แบบ sheet) */
async function pickOption(kind: "ชนิดพลอย" | "รูปทรง", row: number, option: string | RegExp) {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${kind}แถว ${row}`) }));
  const dlg = await screen.findByRole("dialog", { name: `เลือก${kind}` });
  await userEvent.click(within(dlg).getByRole("option", { name: option }));
}
/** แถวพลอยทรงกลมครบ (ชนิดจากรายการ · ขนาดเดียว) */
async function fillRound(row: number, o: { type?: string | RegExp; size?: string; qty?: string } = {}) {
  await pickOption("ชนิดพลอย", row, o.type ?? /^โกเมน/);
  await pickOption("รูปทรง", row, /^กลม/);
  await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), o.size ?? "4");
  await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), o.qty ?? "2");
}
async function answerHas() {
  await userEvent.click(radio("มีพลอย"));
}
/** ผ่าน W-5 รูป (ข้าม) → หน้าทวน */
async function toReviewFromGems() {
  await click("ถัดไป");
  await click("ข้าม ไม่ใส่รูป");
  await screen.findByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" });
}
const submitCall = (n = 0) => intakeOpen.mock.calls[n][1];

describe("W-4 · ตอบก่อน 'ฝังพลอยไหม' (SKU ไม่มีแม่แบบ)", () => {
  it("เข้าขั้น: หัว 'พลอย' (โฟกัส) · ตัวนับ 3/5 · คำถาม + radiogroup 2 ข้อ ไม่มีค่าเริ่ม · ปุ่มถัดไป aria-disabled + เหตุผล · กดแล้วไม่ไป + โฟกัสตัวเลือก", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    const h = screen.getByRole("heading", { level: 1, name: "พลอย" });
    expect(h).toHaveFocus();
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "ชิ้นนี้ฝังพลอยไหม?" })).toBeInTheDocument();
    expect(radio("มีพลอย")).toHaveAttribute("aria-checked", "false");
    expect(radio("ไม่มีพลอย")).toHaveAttribute("aria-checked", "false");
    const next = screen.getByRole("button", { name: "ถัดไป" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("เลือกก่อนว่าฝังพลอยไหม")).toBeInTheDocument();
    expect(next.getAttribute("aria-describedby")).toBe(screen.getByText("เลือกก่อนว่าฝังพลอยไหม").id);
    await userEvent.click(next);
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
    expect(radio("มีพลอย")).toHaveFocus();
    expect(intakeGemCatalog).toHaveBeenCalledWith(TOKEN, PID);
  });

  it("ตอบ 'ไม่มีพลอย' → สรุป + [เปลี่ยน] · ถัดไปได้ → W-5 · ส่ง gems = none", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await userEvent.click(radio("ไม่มีพลอย"));
    expect(screen.getByTestId("shop-gem-answer")).toHaveTextContent("ไม่มีพลอย");
    expect(screen.getByTestId("shop-gem-none-summary")).toHaveTextContent("ไม่มีพลอย — ใบนี้ไม่มีขั้นฝังพลอย");
    expect(screen.getByRole("button", { name: "ถัดไป" })).not.toHaveAttribute("aria-disabled");
    await toReviewFromGems();
    expect(within(screen.getByTestId("shop-review-gems")).getByText("ไม่มี")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toEqual({ answer: "none" });
  });

  it("[เปลี่ยน] กลับไปเลือกใหม่ได้ · เปลี่ยนเป็น 'มีพลอย' → มีแถวเปล่าพร้อมกรอก (โฟกัสช่องชนิด)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await userEvent.click(radio("ไม่มีพลอย"));
    await click("เปลี่ยน");
    expect(radio("ไม่มีพลอย")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(radio("มีพลอย"));
    expect(screen.getByTestId("shop-gem-answer")).toHaveTextContent("มีพลอย");
    expect(screen.getByTestId("shop-gem-row-1")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ })).toHaveFocus());
  });
});

describe("W-4 · state: loading / error ของรายการพลอย (ไม่บล็อกการกรอก)", () => {
  it("loading: skeleton ในจอ · แถวกรอกได้ทันทีไม่รอ · sheet แสดง skeleton ในรายการ · โหลดเสร็จแล้ว skeleton หาย", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeGemCatalog.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    expect(screen.getByRole("status", { name: "กำลังโหลดรายการพลอย" })).toBeInTheDocument();
    const typeBtn = screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ });
    expect(typeBtn).toBeEnabled();
    await userEvent.click(typeBtn);
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    expect(within(dlg).getByRole("status", { name: "กำลังโหลดรายการชนิดพลอย" })).toBeInTheDocument();
    await userEvent.type(within(dlg).getByRole("combobox"), "ทับทิม");
    await act(async () => resolve(catalog()));
    await waitFor(() => expect(screen.queryByRole("status", { name: "กำลังโหลดรายการพลอย" })).not.toBeInTheDocument());
  });

  it("error: แถบ amber 'โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ …' + ลองอีกครั้ง (โหลดซ้ำได้) · ไม่บล็อก", async () => {
    intakeGemCatalog.mockResolvedValueOnce({ ok: false, error: "x_y", code: "error" });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    const bar = await screen.findByText("โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้");
    expect(bar.closest("[role=status]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ })).toBeEnabled();
    await click("ลองอีกครั้ง");
    await waitFor(() => expect(intakeGemCatalog).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/โหลดรายการพลอยไม่ได้/)).not.toBeInTheDocument());
  });

  it("เน็ตหลุด (throw) = error เหมือนกัน · session_required → ขอโหลด hub ใหม่ (แผ่น PIN) ฟอร์มไม่หาย", async () => {
    intakeGemCatalog.mockRejectedValueOnce(new Error("offline"));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    expect(await screen.findByText(/โหลดรายการพลอยไม่ได้/)).toBeInTheDocument();
    intakeGemCatalog.mockResolvedValueOnce({ ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" });
    await click("ลองอีกครั้ง");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // hub กำลังโหลดใหม่ (แผ่น PIN) — วิซาร์ดถูกซ่อนไม่ถูกถอด: ฟอร์ม/แถวยังอยู่
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/, hidden: true })).toBeInTheDocument();
  });

  it("ยังไม่ได้ตอบ + กำลังโหลดรายการ: skeleton ใต้คำถาม (ตอบได้ทันที ไม่รอ) · โหลดไม่ได้: แถบ amber + ลองอีกครั้ง (SKU ที่มีแม่แบบจะรู้ว่าแม่แบบยังไม่มา)", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeGemCatalog.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    expect(screen.getByTestId("shop-gem-catalog-loading")).toBeInTheDocument();
    expect(radio("มีพลอย")).toBeEnabled();
    await act(async () => resolve({ ok: false, error: "x_y", code: "error" }));
    const bar = await screen.findByTestId("shop-gem-catalog-error");
    expect(bar).toHaveTextContent("โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้");
    expect(screen.queryByTestId("shop-gem-catalog-loading")).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(screen.queryByTestId("shop-gem-catalog-error")).not.toBeInTheDocument());
    expect(intakeGemCatalog).toHaveBeenCalledTimes(2);
  });
});

describe("W-4 · กรอกแถวพลอย", () => {
  it("เปลี่ยนจำนวนผลิต (ย้อนไป W-3 แล้วกลับมา): รวมทั้งใบอัปเดตตามจำนวนใหม่ (คำนวณจาก state ไม่ cache)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems("30");
    await answerHas();
    await fillRound(1, { qty: "2" });
    await click("เสร็จแถวนี้");
    expect(screen.getByTestId("shop-gem-grand-total")).toHaveTextContent("รวมพลอยทั้งใบ 1 รายการ · 60 เม็ด");
    await click("ย้อนกลับ");
    const q = screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)");
    await userEvent.clear(q);
    await userEvent.type(q, "40");
    await click("ถัดไป");
    await screen.findByRole("heading", { level: 1, name: "พลอย" });
    expect(screen.getByTestId("shop-gem-multiplier")).toHaveTextContent("คูณด้วยจำนวนที่จะผลิต 40 ชิ้น");
    expect(screen.getByTestId("shop-gem-grand-total")).toHaveTextContent("รวมพลอยทั้งใบ 1 รายการ · 80 เม็ด");
  });

  it("แถวครบ: ตัวอย่างชื่อ · รวมแถว (จำนวน × จำนวนผลิต) · เสร็จแถวนี้ → พับเป็นสรุป · รวมพลอยทั้งใบ · ไป W-5 · หน้าทวนมีแถวพลอย · ส่ง gems = has + lines", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems("30");
    await answerHas();
    await fillRound(1, { size: "4", qty: "2" });
    expect(screen.getByTestId("shop-gem-preview-1")).toHaveTextContent("ตัวอย่างชื่อ: โกเมน · กลม · 4 มม.");
    expect(screen.getByTestId("shop-gem-line-total-1")).toHaveTextContent("รวมทั้งใบ 60 เม็ด (2 × 30)");
    expect(screen.getByTestId("shop-gem-multiplier")).toHaveTextContent("คูณด้วยจำนวนที่จะผลิต 30 ชิ้น");
    await click("เสร็จแถวนี้");
    const head = screen.getByRole("button", { name: /แถว 1/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("shop-gem-row-label-1")).toHaveTextContent("โกเมน · กลม · 4 มม.");
    expect(within(screen.getByTestId("shop-gem-row-1")).getByText(/2 เม็ด\/ชิ้น · รวม 60 เม็ด/)).toBeInTheDocument();
    expect(screen.getByTestId("shop-gem-grand-total")).toHaveTextContent("รวมพลอยทั้งใบ 1 รายการ · 60 เม็ด");
    await toReviewFromGems();
    const row = within(screen.getByTestId("shop-review-gems"));
    expect(row.getByText("1 รายการ · รวม 60 เม็ด")).toBeInTheDocument();
    expect(row.getByText("โกเมน · กลม · 4 มม.")).toBeInTheDocument();
    expect(row.getByText("2/ชิ้น → 60")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toEqual({ answer: "has", lines: [{ qtyPerPiece: 2, position: null, sizeA: 4, sizeB: null, typeId: T1, shapeId: S1 }] });
  });

  it("เผื่อของเสีย: รวมใช้ 'จำนวนที่จะเริ่มผลิต' (สั่ง 30 + เผื่อ 5 = 35) · ไม่บวกเผื่อพลอยแตก", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await click("เปิดงานใหม่");
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
    await click("ถัดไป");
    await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.type(screen.getByLabelText("เผื่อเพิ่มกี่ชิ้น"), "5");
    await click("ถัดไป");
    await answerHas();
    expect(screen.getByTestId("shop-gem-multiplier")).toHaveTextContent("คูณด้วยจำนวนที่จะผลิต 35 ชิ้น (สั่ง 30 + เผื่อ 5)");
    await fillRound(1, { qty: "30" });
    expect(screen.getByTestId("shop-gem-line-total-1")).toHaveTextContent("รวมทั้งใบ 1,050 เม็ด (30 × 35)");
  });

  it("แถวไม่ครบ: พับไม่ได้ (aria-disabled + เหตุผลชี้ช่องที่ขาด) · เพิ่มพลอยไม่ได้ (กรอกแถว 1 ให้ครบก่อน) · ถัดไปไม่ไป + บอกเหตุผล", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    const done = screen.getByRole("button", { name: "เสร็จแถวนี้" });
    expect(done).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("แถว 1 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย").length).toBeGreaterThan(0);
    await userEvent.click(done);
    expect(screen.getByTestId("shop-gem-row-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ })).toBeInTheDocument(); // ยังเปิดอยู่
    const add = screen.getByRole("button", { name: "เพิ่มพลอย" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("กรอกแถว 1 ให้ครบก่อน")).toBeInTheDocument();
    await userEvent.click(add);
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
    expect(screen.getAllByText("แถว 1 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย").length).toBeGreaterThan(1);
  });

  it("เหตุผลตามช่องที่ขาด: ชนิด → รูปทรง → ขนาด → จำนวน (ทีละข้อ)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await pickOption("ชนิดพลอย", 1, /^โกเมน/);
    expect(screen.getAllByText("แถว 1 ยังไม่ครบ — เลือกรูปทรง").length).toBeGreaterThan(0);
    await pickOption("รูปทรง", 1, /^กลม/);
    expect(screen.getAllByText("แถว 1 ยังไม่ครบ — ใส่ขนาด (มม.)").length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), "4");
    expect(screen.getAllByText(/แถว 1 ยังไม่ครบ — จำนวนต่อชิ้นต้องเป็นเลข 1–1,000/).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    expect(screen.queryByText(/แถว 1 ยังไม่ครบ/)).not.toBeInTheDocument();
  });

  it("รูปทรง 2 ค่า (ไข่): ช่องกว้าง × ยาว · กรอกกลับด้าน 6×4 → 'เรียงเป็น 4×6 ให้' · ส่ง sizeA ≤ sizeB", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await pickOption("ชนิดพลอย", 1, /^โกเมน/);
    await pickOption("รูปทรง", 1, /^ไข่/);
    await userEvent.type(screen.getByLabelText("ขนาดด้านกว้าง (มม.)"), "6");
    await userEvent.type(screen.getByLabelText("ขนาดด้านยาว (มม.)"), "4");
    expect(screen.getByTestId("shop-gem-swapped")).toHaveTextContent("เรียงเป็น 4×6 ให้");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    await toReviewFromGems();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems.lines[0]).toMatchObject({ sizeA: 4, sizeB: 6, typeId: T1, shapeId: S2 });
  });

  it("ขนาดผิด (ทศนิยม 3 ตำแหน่ง) = ข้อความใต้ช่อง + ไม่ผ่าน · ขนาด > 30 มม. ต้องติ๊กยืนยันก่อนถึงครบ · ชิป 'เคยใช้' เติมช่อง", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await pickOption("ชนิดพลอย", 1, /^โกเมน/);
    await pickOption("รูปทรง", 1, /^กลม/);
    // ชิปเคยใช้ (โกเมน+กลม: 4 / 5)
    const chips = within(screen.getByRole("group", { name: "ขนาดที่เคยใช้" }));
    await userEvent.click(chips.getByRole("button", { name: "5" }));
    expect(screen.getByLabelText("ขนาด (มม.)")).toHaveValue("5");
    const size = screen.getByLabelText("ขนาด (มม.)");
    await userEvent.clear(size);
    await userEvent.type(size, "1.234");
    await userEvent.click(screen.getByRole("button", { name: "เสร็จแถวนี้" })); // แตะแล้ว = ขึ้นข้อความ
    expect(screen.getAllByText("ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)").length).toBeGreaterThan(0);
    await userEvent.clear(size);
    await userEvent.type(size, "35");
    expect(screen.getByTestId("shop-gem-big-size")).toHaveTextContent("ขนาด 35 มม. ใหญ่ผิดปกติสำหรับพลอยเครื่องประดับ — ตรวจว่าเป็นมิลลิเมตร");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    expect(screen.getByRole("button", { name: "เสร็จแถวนี้" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("checkbox", { name: "ใช่ ขนาดนี้ถูกต้อง" }));
    expect(screen.getByRole("button", { name: "เสร็จแถวนี้" })).not.toHaveAttribute("aria-disabled");
  });

  it("ลบแถวจนเหลือ 0: 'ลบแถวแล้ว' · โฟกัสไม่หล่น (ไปปุ่มเพิ่มพลอย) · ถัดไปไม่ผ่าน 'เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก “ไม่มีพลอย”'", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await click("ลบพลอยแถว 1");
    expect(screen.getByTestId("shop-gem-notice")).toHaveTextContent("ลบแถวแล้ว");
    await waitFor(() => expect(screen.getByRole("button", { name: "เพิ่มพลอย" })).toHaveFocus());
    expect(screen.getByTestId("shop-gem-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(screen.getAllByText("เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก “ไม่มีพลอย”").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
  });

  it("แถวซ้ำ: กล่อง amber 'มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1' + 'รวมเข้าแถว 1' (ไม่รวมเงียบ) · ถัดไปไม่ผ่านจนกว่าจะรวม · รวมแล้วบวกจำนวน", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1, { qty: "2" });
    await click("เสร็จแถวนี้");
    await click("เพิ่มพลอย");
    await fillRound(2, { qty: "3" });
    expect(screen.getByTestId("shop-gem-dup-2")).toHaveTextContent("มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1");
    await click("เสร็จแถวนี้");
    await userEvent.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
    expect(screen.getAllByText(/แถว 2: มีพลอยแบบเดียวกันอยู่แล้วที่แถว 1/).length).toBeGreaterThan(0);
    await click("รวมเข้าแถว 1");
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(1);
    expect(screen.getByTestId("shop-gem-notice")).toHaveTextContent("รวมเข้าแถว 1 แล้ว");
    expect(screen.getByLabelText("จำนวนต่อชิ้น")).toHaveValue("5");
    expect(screen.queryByTestId("shop-gem-dup-1")).not.toBeInTheDocument();
  });
});

describe("W-4 · ชนิด/รูปทรงใหม่ + ตัวดักชื่อคล้าย", () => {
  it("พิมพ์ชนิดใหม่ (ยังไม่เข้าแคตตาล็อก): ป้าย 'ใหม่' · ขึ้นในรายการของแถวถัดไปพร้อมป้าย · หน้าทวนบอกว่าชื่อจะเข้ารายการเมื่อเปิดงาน · ส่ง newTypeName", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(dlg).getByRole("combobox"), "ทับทิม");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “ทับทิม” เป็นชนิดพลอยใหม่/ }));
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1: ทับทิม/ })).toHaveTextContent("ใหม่");
    expect(within(screen.getByTestId("shop-gem-row-1")).getByText("ใหม่", { selector: "span.inline-flex" })).toBeInTheDocument();
    await pickOption("รูปทรง", 1, /^กลม/);
    await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), "3");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "1");
    await click("เสร็จแถวนี้");
    await click("เพิ่มพลอย");
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 2/ }));
    const dlg2 = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    expect(within(dlg2).getByRole("option", { name: /^ทับทิม/ })).toHaveTextContent("ใหม่");
    await userEvent.click(within(dlg2).getByRole("button", { name: "กลับ" }));
    await click("ลบพลอยแถว 2");
    await toReviewFromGems();
    expect(screen.getByText("ชื่อใหม่จะเข้ารายการพลอยของร้านเมื่อเปิดงาน")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems.lines[0]).toMatchObject({ newTypeName: "ทับทิม", shapeId: S1, sizeA: 3 });
    expect("typeId" in submitCall().gems.lines[0]).toBe(false);
  });

  it("ชื่อคล้ายของเดิม ('โกเมนต์' ↔ 'โกเมน'): กล่อง 'มี “โกเมน” อยู่แล้ว' ปุ่มหลัก = ใช้ตัวที่มี (focus ที่นั่น) → ได้ชนิดเดิม ไม่เกิดชื่อซ้ำ", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(dlg).getByRole("combobox"), "โกเมนต์");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    const ask = await screen.findByRole("dialog", { name: "มี “โกเมน” อยู่แล้ว" });
    await waitFor(() => expect(within(ask).getByRole("button", { name: "ใช้ “โกเมน”" })).toHaveFocus());
    await userEvent.click(within(ask).getByRole("button", { name: "ใช้ “โกเมน”" }));
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1: โกเมน/ })).not.toHaveTextContent("ใหม่");
  });

  it("เลือก 'ไม่ใช่ — เพิ่มใหม่' ข้ามตัวดักได้เสมอ (ตัวดัก ไม่ใช่ตัวบล็อก) → ส่ง force เฉพาะชื่อที่ยืนยัน", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(dlg).getByRole("combobox"), "โกเมนต์");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    const ask = await screen.findByRole("dialog", { name: "มี “โกเมน” อยู่แล้ว" });
    await userEvent.click(within(ask).getByRole("button", { name: "ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่" }));
    expect(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1: โกเมนต์/ })).toHaveTextContent("ใหม่");
    await pickOption("รูปทรง", 1, /^กลม/);
    await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), "4");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "1");
    await toReviewFromGems();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toMatchObject({ answer: "has", force: [{ kind: "type", name: "โกเมนต์" }] });
  });

  it("รูปทรงใหม่: ถาม 1 ค่า/2 ค่า ก่อน (ตกลง aria-disabled จนเลือก) → ช่องขนาดตามที่ตอบ · ส่ง newShape", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await pickOption("ชนิดพลอย", 1, /^โกเมน/);
    await userEvent.click(screen.getByRole("button", { name: /^รูปทรงแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกรูปทรง" });
    await userEvent.type(within(dlg).getByRole("combobox"), "ทรงใบไม้");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “ทรงใบไม้” เป็นรูปทรงใหม่/ }));
    const ask = await screen.findByRole("dialog", { name: "รูปทรงใหม่: “ทรงใบไม้”" });
    expect(within(ask).getByRole("button", { name: "ตกลง" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(within(ask).getByRole("radio", { name: /2 ค่า/ }));
    await userEvent.click(within(ask).getByRole("button", { name: "ตกลง" }));
    expect(screen.getByLabelText("ขนาดด้านกว้าง (มม.)")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("ขนาดด้านกว้าง (มม.)"), "4");
    await userEvent.type(screen.getByLabelText("ขนาดด้านยาว (มม.)"), "6");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    await toReviewFromGems();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems.lines[0]).toMatchObject({ typeId: T1, newShape: { name: "ทรงใบไม้", hasLength: true }, sizeA: 4, sizeB: 6 });
  });

  it("แคตตาล็อกว่างทั้งระบบ (ไม่ seed): sheet บอกให้พิมพ์ชื่อแรกได้เลย", async () => {
    intakeGemCatalog.mockResolvedValue(catalog({ types: [], shapes: [], sizes: [] }));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    expect(within(dlg).getByText("ยังไม่มีชนิดพลอยในระบบ — พิมพ์ชื่อแรกได้เลย ชื่อที่ใส่จะอยู่ในรายการให้คนถัดไป")).toBeInTheDocument();
  });
});

describe("W-4 · SKU ที่มีแม่แบบพลอย", () => {
  beforeEach(() => intakeGemCatalog.mockResolvedValue(catalog({ hasTemplate: true, template: TEMPLATE })));

  it("เข้าขั้น = 'มีพลอย' + แถวมาให้ (ป้าย 'จากแม่แบบ') ไม่ต้องตอบ · ไม่แตะอะไร → ส่ง 'template' (DB คัดลอกเอง)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await waitFor(() => expect(screen.getByTestId("shop-gem-answer")).toHaveTextContent("มีพลอย"));
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2);
    expect(screen.getAllByText("จากแม่แบบ")).toHaveLength(2);
    expect(screen.getByTestId("shop-gem-row-label-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(screen.getByTestId("shop-gem-grand-total")).toHaveTextContent("รวมพลอยทั้งใบ 2 รายการ · 960 เม็ด"); // (2 + 30) × 30
    await toReviewFromGems();
    expect(within(screen.getByTestId("shop-review-gems")).getByText("2 รายการ · รวม 960 เม็ด")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toEqual({ answer: "template" });
  });

  it("แก้จำนวนของแถวจากแม่แบบ → ป้าย 'แก้แล้ว' · ส่ง 'has' + แถวเดิม (gemItemId + จำนวนใหม่) · ไม่เขียนกลับแม่แบบ (ไม่มี field ของแม่แบบ)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await waitFor(() => expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2));
    await userEvent.click(within(screen.getByTestId("shop-gem-row-1")).getByRole("button", { name: /แถว 1/ }));
    expect(screen.getByText(/เฉพาะใบนี้ — แม่แบบ SKU ไม่เปลี่ยน/)).toBeInTheDocument();
    const qty = screen.getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "3");
    expect(within(screen.getByTestId("shop-gem-row-1")).getByText("แก้แล้ว")).toBeInTheDocument();
    await click("เสร็จแถวนี้");
    await toReviewFromGems();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toEqual({ answer: "has", lines: [{ gemItemId: I1, qtyPerPiece: 3, position: "ล้อมรอบ" }, { gemItemId: I2, qtyPerPiece: 30, position: null }] });
  });

  it("ลบแถวจากแม่แบบ: 'ลบแถวแล้ว · เฉพาะใบนี้' · ส่ง 'has' ที่เหลือแถวเดียว", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await waitFor(() => expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2));
    await userEvent.click(within(screen.getByTestId("shop-gem-row-2")).getByRole("button", { name: /แถว 2/ }));
    await click("ลบพลอยแถว 2");
    expect(screen.getByTestId("shop-gem-notice")).toHaveTextContent("ลบแถวแล้ว · เฉพาะใบนี้");
    await toReviewFromGems();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(submitCall().gems).toEqual({ answer: "has", lines: [{ gemItemId: I1, qtyPerPiece: 2, position: "ล้อมรอบ" }] });
  });

  it("เลือก 'ไม่มีพลอย' ที่มีแถวอยู่: กล่องยืนยัน 'ล้างพลอย 2 รายการ …' · focus เริ่มที่ 'ไม่ล้าง' · ไม่ล้าง = คงแถว · ล้างออก = none · กลับมา 'มีพลอย' = ได้แม่แบบใหม่", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await waitFor(() => expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2));
    await click("เปลี่ยน");
    await userEvent.click(radio("ไม่มีพลอย"));
    const box = await screen.findByRole("dialog", { name: "ล้างพลอยออกจากใบนี้?" });
    expect(within(box).getByText("ล้างพลอย 2 รายการออกจากใบนี้? (เฉพาะใบนี้ แม่แบบ SKU ไม่เปลี่ยน)")).toBeInTheDocument();
    await waitFor(() => expect(within(box).getByRole("button", { name: "ไม่ล้าง" })).toHaveFocus());
    await userEvent.click(within(box).getByRole("button", { name: "ไม่ล้าง" }));
    expect(screen.queryByRole("dialog", { name: "ล้างพลอยออกจากใบนี้?" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2);
    await userEvent.click(radio("ไม่มีพลอย"));
    await click("ล้างออก");
    expect(screen.getByTestId("shop-gem-answer")).toHaveTextContent("ไม่มีพลอย");
    expect(screen.queryByTestId("shop-gem-row-1")).not.toBeInTheDocument();
    await click("เปลี่ยน");
    await userEvent.click(radio("มีพลอย"));
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2);
    expect(screen.getAllByText("จากแม่แบบ")).toHaveLength(2);
  });

  it("แม่แบบของ SKU เก่าไม่ตามไปกับสินค้าใหม่ในฟอร์มเดียวกัน: เปลี่ยนเป็นสินค้าใหม่ (ไม่มี SKU) = ขอรายการใหม่ (productId null) · ต้องตอบเองใหม่ · ไม่หยิบแม่แบบเก่ามาใช้", async () => {
    intakeGemCatalog.mockImplementation(async (_t: string, pid: string | null) => (pid ? catalog({ hasTemplate: true, template: TEMPLATE }) : catalog()));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await waitFor(() => expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2));
    await click("ย้อนกลับ"); // qty
    await click("ย้อนกลับ"); // search (SKU ยังถูกเลือกอยู่)
    await click("+ สินค้าใหม่ (ยังไม่มีรหัส)");
    await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวนลายใบไม้");
    await click("ถัดไป");
    await click("ถัดไป");
    await click("ถัดไป"); // จำนวนที่กรอกไว้ยังอยู่ → W-4
    await screen.findByRole("heading", { level: 1, name: "พลอย" });
    expect(screen.getByText("4/6")).toBeInTheDocument();
    expect(radio("มีพลอย")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("shop-gem-row-1")).not.toBeInTheDocument();
    expect(intakeGemCatalog).toHaveBeenLastCalledWith(TOKEN, null);
  });
});

describe("เปิดงานแล้ว server ปฏิเสธพลอย → กลับ W-4 แถว/ช่องที่ผิด (ฟอร์มคงอยู่)", () => {
  const ROW_ERR = { ok: false, error: "พลอยแถว 2: ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)", code: "gem_line_invalid", field: "gems", gem: { code: "size_invalid", row: 2, field: "size_a" } };

  async function twoRowsToReview() {
    await toGems("30");
    await answerHas();
    await fillRound(1, { size: "4", qty: "2" });
    await click("เสร็จแถวนี้");
    await click("เพิ่มพลอย");
    await fillRound(2, { size: "5", qty: "7" });
    await click("เสร็จแถวนี้");
    await toReviewFromGems();
  }

  it("แถวผิด: แบนเนอร์ในหน้าทวน + 'กลับไปแก้' → W-4 เปิดแถว 2 · กล่องแดง 'พลอยแถว 2: …' · โฟกัสช่องขนาด · แถว 1 + ค่าที่กรอกคงอยู่ · แก้แล้วข้อความหาย · ส่งซ้ำด้วย key เดิม", async () => {
    intakeOpen.mockResolvedValueOnce(ROW_ERR);
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await twoRowsToReview();
    await click("เปิดงาน");
    const banner = await screen.findByText(/^พลอยแถว 2: ขนาดต้องเป็นตัวเลข/, { selector: "p[role=alert]" });
    expect(banner).toBeInTheDocument();
    await click("กลับไปแก้");
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
    const err = screen.getByTestId("shop-gem-server-error-2");
    expect(err).toHaveTextContent("พลอยแถว 2: ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม.");
    expect(err).toHaveAttribute("role", "alert");
    await waitFor(() => expect(screen.getByLabelText("ขนาด (มม.)")).toHaveFocus());
    expect(screen.getByLabelText("ขนาด (มม.)")).toHaveValue("5");
    expect(screen.getByLabelText("จำนวนต่อชิ้น")).toHaveValue("7");
    expect(within(screen.getByTestId("shop-gem-row-1")).getByText(/2 เม็ด\/ชิ้น/)).toBeInTheDocument();
    // แก้แล้ว → ข้อความเก่าไม่ค้าง
    const size2 = screen.getByLabelText("ขนาด (มม.)");
    await userEvent.clear(size2);
    await userEvent.type(size2, "6");
    expect(screen.queryByTestId("shop-gem-server-error-2")).not.toBeInTheDocument();
    await click("เสร็จแถวนี้");
    await click("ถัดไป");
    await click("ข้าม ไม่ใส่รูป");
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(submitCall(1).idemKey).toBe(submitCall(0).idemKey);
    expect(submitCall(1).gems.lines[1]).toMatchObject({ sizeA: 6, qtyPerPiece: 7 });
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
  });

  it("ชื่อคล้ายที่ DB ถาม (ไม่ใช่ error): กล่อง 'มี “โกเมน” อยู่แล้ว' บนหน้าทวน · 'ไม่ใช่ — เพิ่มใหม่' = ส่งซ้ำพร้อม force เฉพาะชื่อที่ DB ถาม (key เดิม)", async () => {
    intakeGemCatalog.mockResolvedValue(catalog({ types: [], shapes: [{ id: S1, name: "กลม", hasLength: false }], sizes: [] })); // ฝั่งจอไม่เห็นชื่อ → DB เป็นคนถาม
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้ายกับที่มีอยู่แล้ว", code: "gem_similar", field: "gems", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T1, name: "โกเมน" }] }] });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(dlg).getByRole("combobox"), "โกเมนต์");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    await pickOption("รูปทรง", 1, /^กลม/);
    await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), "4");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    await toReviewFromGems();
    await click("เปิดงาน");
    const ask = await screen.findByRole("dialog", { name: "มี “โกเมน” อยู่แล้ว" });
    expect(screen.queryByText(/พบชื่อที่คล้ายกับที่มีอยู่แล้ว/)).not.toBeInTheDocument(); // ไม่ใช่แบนเนอร์ error
    expect(submitCall(0).gems).toMatchObject({ answer: "has" });
    expect("force" in submitCall(0).gems).toBe(false);
    await userEvent.click(within(ask).getByRole("button", { name: "ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่" }));
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(submitCall(1).gems).toMatchObject({ answer: "has", force: [{ kind: "type", name: "โกเมนต์" }] });
    expect(submitCall(1).idemKey).toBe(submitCall(0).idemKey);
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
  });

  it("ชื่อคล้ายที่ DB ถาม → 'ใช้ “โกเมน”' = แก้แถวให้ชี้ชนิดเดิม แล้วส่งซ้ำโดยไม่มี force/ชื่อใหม่", async () => {
    intakeGemCatalog.mockResolvedValue(catalog({ types: [], shapes: [{ id: S1, name: "กลม", hasLength: false }], sizes: [] }));
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "x", code: "gem_similar", field: "gems", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T1, name: "โกเมน" }] }] });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    const dlg = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(dlg).getByRole("combobox"), "โกเมนต์");
    await userEvent.click(within(dlg).getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    await pickOption("รูปทรง", 1, /^กลม/);
    await userEvent.type(screen.getByLabelText("ขนาด (มม.)"), "4");
    await userEvent.type(screen.getByLabelText("จำนวนต่อชิ้น"), "2");
    await toReviewFromGems();
    await click("เปิดงาน");
    const ask = await screen.findByRole("dialog", { name: "มี “โกเมน” อยู่แล้ว" });
    await userEvent.click(within(ask).getByRole("button", { name: "ใช้ “โกเมน”" }));
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    const lines = submitCall(1).gems.lines;
    expect(lines[0]).toMatchObject({ typeId: T1, shapeId: S1 });
    expect("newTypeName" in lines[0]).toBe(false);
    expect("force" in submitCall(1).gems).toBe(false);
  });

  it("เพดานชื่อ/รายการใหม่ (gem_name_cap): ข้อความกลาง (ไม่บอกว่าเป็นเรื่องชื่ออย่างเดียว) ทั้งแบนเนอร์และ W-4", async () => {
    const CAP = "เพิ่มพลอยใหม่ถี่เกินไปวันนี้ — เลือกจากรายการที่มี หรือแจ้งออฟฟิศ";
    intakeOpen.mockResolvedValueOnce({ ok: false, error: CAP, code: "gem_name_cap", field: "gems" });
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1);
    await toReviewFromGems();
    await click("เปิดงาน");
    expect(await screen.findByText(CAP, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(CAP).not.toMatch(/ชื่อ/);
    await click("กลับไปแก้");
    expect(screen.getByTestId("shop-gem-general-error")).toHaveTextContent(CAP);
    expect(screen.getByTestId("shop-gem-row-1")).toBeInTheDocument(); // แถวคงอยู่
  });

  it("เน็ตหลุดตอนส่ง: ฟอร์ม/แถวพลอยไม่หาย · กดเปิดงานซ้ำได้ด้วย key เดิม", async () => {
    intakeOpen.mockRejectedValueOnce(new Error("offline"));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1);
    await toReviewFromGems();
    await click("เปิดงาน");
    expect(await screen.findByRole("alert")).toHaveTextContent("ส่งไม่สำเร็จ");
    expect(within(screen.getByTestId("shop-review-gems")).getByText("1 รายการ · รวม 60 เม็ด")).toBeInTheDocument();
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(2));
    expect(submitCall(1).idemKey).toBe(submitCall(0).idemKey);
    expect(submitCall(1).gems).toEqual(submitCall(0).gems);
  });

  it("ปุ่ม [แก้] ของแถวพลอยในหน้าทวน → กลับ W-4 (แถวคงอยู่ · ยังไม่ส่งอะไร)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1);
    await toReviewFromGems();
    await click("แก้พลอย");
    expect(screen.getByRole("heading", { level: 1, name: "พลอย" })).toBeInTheDocument();
    expect(screen.getByTestId("shop-gem-row-1")).toBeInTheDocument();
    expect(intakeOpen).not.toHaveBeenCalled();
  });
});

describe("W-8 สำเร็จ — สรุปพลอยจาก DB + แจ้งสิ่งที่ระบบทำให้ (ไม่เงียบ)", () => {
  it("พลอย n รายการ · รวม m เม็ด + 'ใช้ตัวเดิมให้' + รวมแถวซ้ำ + ชื่อใหม่เข้ารายการ", async () => {
    intakeOpen.mockResolvedValue(okResult({ gem: { count: 2, total: 1120, state: "specified", createdTypes: ["ทับทิม"], createdShapes: [], reused: [{ row: 1, kind: "type", typed: "โกเมนต์", name: "โกเมน" }], mergedRows: [[1, 2]] } }));
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1);
    await toReviewFromGems();
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    const box = within(screen.getByTestId("done-gems"));
    expect(box.getByText("พลอย 2 รายการ · รวม 1,120 เม็ด")).toBeInTheDocument();
    expect(box.getByText(/ชนิด “โกเมนต์” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “โกเมน” ให้/)).toBeInTheDocument();
    expect(box.getByText(/รวมแถวซ้ำ 1 แถว \(แถว 1, 2\)/)).toBeInTheDocument();
    expect(box.getByText(/เพิ่มเข้ารายการพลอยของร้านแล้ว: ทับทิม/)).toBeInTheDocument();
  });

  it("ใบไม่มีพลอย (DB ไม่ส่ง gem หรือ not_needed) = ไม่แสดงบรรทัดพลอย", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await userEvent.click(radio("ไม่มีพลอย"));
    await toReviewFromGems();
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    expect(screen.queryByTestId("done-gems")).not.toBeInTheDocument();
  });
});

describe("W-4 · a11y + เปลี่ยนสินค้า", () => {
  it("radiogroup มีชื่อ · radio aria-checked สลับ · แถวพับเป็นปุ่ม aria-expanded · ปุ่มลบ/เพิ่ม มีชื่อ · รวมทั้งใบประกาศผ่าน status (ไม่ใช่ทุกตัวอักษร)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    expect(screen.getByTestId("shop-gem-row-1").querySelector("[aria-expanded=true]")).not.toBeNull();
    await fillRound(1);
    expect(screen.getByRole("button", { name: "ลบพลอยแถว 1" })).toBeInTheDocument();
    await click("เสร็จแถวนี้");
    expect(screen.getByRole("button", { name: /แถว 1/ })).toHaveAttribute("aria-expanded", "false");
    const live = screen.getAllByRole("status").find((n) => n.getAttribute("aria-live") === "polite" && n.className.includes("sr-only"));
    expect(live).toBeDefined();
    await waitFor(() => expect(live).toHaveTextContent("รวมพลอยทั้งใบ 1 รายการ · 60 เม็ด"), { timeout: 2000 });
    expect(screen.getByTestId("shop-gem-grand-total")).toHaveAttribute("aria-hidden", "true");
  });

  it("เลือกสินค้าใหม่ (กลับ W-2 แล้วเลือกซ้ำ) = ล้างคำตอบพลอย ต้องตอบใหม่ (แถวของ SKU เก่าไม่ติดไป)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    await toGems();
    await answerHas();
    await fillRound(1);
    await click("ย้อนกลับ");
    await click("ย้อนกลับ");
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
    await click("ถัดไป");
    await click("ถัดไป");
    await screen.findByRole("heading", { level: 1, name: "พลอย" });
    expect(radio("มีพลอย")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("shop-gem-row-1")).not.toBeInTheDocument();
  });
});

describe("🔴 ไม่มีเงิน/ราคา/ต้นทุน/เผื่อแตก ในจอพลอยทุกสภาพ", () => {
  it("W-4 (ตอบ/แถว/sheet/กล่องถาม) · หน้าทวน · W-8", async () => {
    intakeOpen.mockResolvedValue(okResult({ gem: { count: 1, total: 60, state: "specified", createdTypes: [], createdShapes: [], reused: [], mergedRows: [] } }));
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={readyHub()} />);
    const money = () => expect(document.body.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|เผื่อแตก/i);
    await toGems();
    money();
    await answerHas();
    money();
    await userEvent.click(screen.getByRole("button", { name: /^ชนิดพลอยแถว 1/ }));
    await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    money();
    await userEvent.click(within(screen.getByRole("dialog", { name: "เลือกชนิดพลอย" })).getByRole("button", { name: "กลับ" }));
    await fillRound(1);
    money();
    await toReviewFromGems();
    money();
    await click("เปิดงาน");
    await screen.findByRole("img", { name: /QR ใบงาน/ });
    money();
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
  });
});
