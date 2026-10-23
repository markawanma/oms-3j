// @vitest-environment jsdom
// W3 UI — W-9 บรรทัดพลอยใน "ใบที่ฉันเปิด" + W-10 จอ "แก้ JB-xxxx" ส่วนพลอย (อ่าน/ล็อก/แผ่นแก้/บันทึกทั้งชุด) · ทดสอบผ่าน ShopIntakeApp จริง (mock เฉพาะ server action)
// ต้องถูก: แก้ได้เฉพาะเมื่อ DB บอก editable · ล็อกทุก code มีข้อความของตัวเอง · ใบไม่มีขั้นฝัง = แจ้งออฟฟิศ · บันทึกทั้งชุดพร้อม rev (CAS) · gem_conflict → โหลดใหม่ · ถูกล็อกระหว่างแก้ = ปิดแผ่น+ข้อความ ·
//   เหลือ 0 แถว = เตือนก่อนบันทึก · ออกขณะมีแก้ = ยืนยัน · ชื่อคล้ายจาก DB → force เฉพาะชื่อ · แถวผิดผูกกับแถว · 4 state (loading/empty/error/success)
// ต้องไม่พัง: ส่วนรูปของ W2 ยังอยู่ · ไม่มีเงิน/ราคา
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
const intakeListPhotos = vi.fn();
const intakeJobGems = vi.fn();
const intakeSetJobGems = vi.fn();
const intakeGemCatalog = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeJobGems: (...a: unknown[]) => intakeJobGems(...a),
  intakeSetJobGems: (...a: unknown[]) => intakeSetJobGems(...a),
  intakeGemCatalog: (...a: unknown[]) => intakeGemCatalog(...a),
  intakeMyJobs: (...a: unknown[]) => intakeMyJobs(...a),
  intakeListPhotos: (...a: unknown[]) => intakeListPhotos(...a),
  intakeLogin: (...a: unknown[]) => intakeLogin(...a),
  workerLogout: (...a: unknown[]) => workerLogout(...a),
  intakeSearch: (...a: unknown[]) => intakeSearch(...a),
  intakeOpen: (...a: unknown[]) => intakeOpen(...a),
  intakeUploadPhoto: vi.fn(),
  intakeRemovePhoto: vi.fn(),
  intakeReissueToken: vi.fn(),
  intakeSetPrimaryPhoto: vi.fn(),
}));
vi.mock("@/lib/images/client", () => ({ resizeImageVariants: vi.fn() }));

import { ShopIntakeApp } from "./ShopIntakeApp";
import type { ShopInitial } from "./ShopHub";
import type { IntakeHubView } from "@/lib/jobs/worker-server";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const J1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const S1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const I1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const I2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REV1 = "a".repeat(32);
const REV2 = "b".repeat(32);

const hubOf = (): ShopInitial => ({ kind: "hub", hub: { state: "ready", workers: [], worker: { id: WA, displayName: "หัวหน้าช่าง" }, openAllowed: true, profileReady: true, goldProfileReady: true, sessionExpired: false } as IntakeHubView });
const job = (o: Partial<MyIntakeJob> = {}): MyIntakeJob => ({
  jobId: J1, orderNo: "PO-2610-001", jobNo: "JB-0031", designLabel: "แหวนลายใบไม้", metal: "gold", qty: 30, createdAt: "2026-10-21T02:00:00Z", status: "open", photosCount: 2, myPhotosCount: 2, editable: true, gemState: null, gemCount: 0, gemPieces: 0, gemEditable: false, ...o,
});
const list = (jobs: MyIntakeJob[]) => ({ ok: true, openAllowed: true, jobs, maxPhotos: 3 });
const gline = (id: string, label: string, qty: number, position: string | null, typeId: string, shapeId: string, hasLength: boolean, sizeA: number, sizeB: number | null, total: number) => ({
  gemItemId: id, label, typeId, typeName: null, shapeId, shapeName: null, hasLength, sizeA, sizeB, qtyPerPiece: qty, position, qtyTotal: total,
});
const LINES = [
  gline(I1, "โกเมน · ไข่ · 4×6 มม.", 2, "ล้อมรอบ", T1, S2, true, 4, 6, 70),
  gline(I2, "CZ · กลม · 1.5 มม.", 30, null, T2, S1, false, 1.5, null, 1050),
];
const gemsRes = (o: Record<string, unknown> = {}) => ({
  ok: true, job: { jobId: J1, jobNo: "JB-0031", designLabel: "แหวนลายใบไม้", status: "open", qtyPlanned: 35 }, state: "specified", editable: true, lockCode: null, hasGemStage: true, rev: REV1, maxLines: 30, lines: LINES, ...o,
});
const catalog = (o: Record<string, unknown> = {}) => ({
  ok: true,
  types: [{ id: T1, name: "โกเมน" }, { id: T2, name: "CZ" }],
  shapes: [{ id: S1, name: "กลม", hasLength: false }, { id: S2, name: "ไข่", hasLength: true }],
  sizes: [],
  hasTemplate: false,
  template: [],
  maxLines: 30,
  ...o,
});
const SET_OK = { ok: true, changed: true, count: 2, lines: [], summary: { createdTypes: [], createdShapes: [], reused: [], mergedRows: [] }, state: "specified", rev: REV2 };

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  workerLogout.mockResolvedValue({ ok: true });
  intakeMyJobs.mockResolvedValue(list([job()]));
  intakeListPhotos.mockResolvedValue({ ok: true, photos: [], count: 0, max: 3, locked: false, lockCode: null });
  intakeJobGems.mockResolvedValue(gemsRes());
  intakeGemCatalog.mockResolvedValue(catalog());
  intakeSetJobGems.mockResolvedValue(SET_OK);
});

const click = async (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const section = () => within(screen.getByTestId("shop-jobgems"));

/** hub → แตะการ์ดแรก → จอ "แก้ JB-0031" → รอส่วนพลอยโหลดเสร็จ */
async function toW10(opts: { jobs?: MyIntakeJob[]; waitLoaded?: boolean } = {}) {
  if (opts.jobs) intakeMyJobs.mockResolvedValue(list(opts.jobs));
  const view = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
  await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
  await screen.findByRole("heading", { level: 1, name: "แก้ JB-0031" });
  if (opts.waitLoaded !== false) await waitFor(() => expect(screen.queryByRole("status", { name: "กำลังโหลดพลอย" })).not.toBeInTheDocument());
  return view;
}
async function openSheet() {
  await userEvent.click(section().getByRole("button", { name: "แก้พลอย" }));
  return screen.findByRole("dialog", { name: "แก้พลอย JB-0031" });
}
const setCall = (n = 0) => intakeSetJobGems.mock.calls[n][1];

describe("W-9 · บรรทัดพลอยในการ์ด 'ใบที่ฉันเปิด'", () => {
  const card = (name: RegExp) => screen.getByRole("button", { name });
  it("specified: 'พลอย n รายการ · รวม m เม็ด' · not_needed: 'ไม่มีพลอย' · unspecified: '⚑ ยังไม่ระบุพลอย' (amber) · null (DB เก่า) = ไม่มีบรรทัด", async () => {
    intakeMyJobs.mockResolvedValue(
      list([
        job({ jobId: "a1", jobNo: "JB-0001", gemState: "specified", gemCount: 3, gemPieces: 1120 }),
        job({ jobId: "a2", jobNo: "JB-0002", gemState: "not_needed" }),
        job({ jobId: "a3", jobNo: "JB-0003", gemState: "unspecified" }),
        job({ jobId: "a4", jobNo: "JB-0004", gemState: null }),
      ]),
    );
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await screen.findByRole("button", { name: /JB-0001/ });
    expect(within(card(/JB-0001/)).getByTestId("mycard-gems")).toHaveTextContent("พลอย 3 รายการ · รวม 1,120 เม็ด");
    expect(within(card(/JB-0002/)).getByTestId("mycard-gems")).toHaveTextContent("ไม่มีพลอย");
    const warn = within(card(/JB-0003/)).getByTestId("mycard-gems");
    expect(warn).toHaveTextContent("ยังไม่ระบุพลอย");
    expect(warn.className).toContain("text-amber-900"); // amber + ไอคอน ⚑ (ไม่พึ่งสีอย่างเดียว)
    expect(warn.textContent).toContain("⚑");
    expect(within(card(/JB-0004/)).queryByTestId("mycard-gems")).not.toBeInTheDocument();
  });
});

describe("W-10 · ส่วนพลอยของจอ 'แก้ JB-xxxx'", () => {
  it("success: หัว 'แก้ JB-0031' · ส่วนพลอยอยู่บนส่วนรูป · แถวสรุป (ฉลาก · n/ชิ้น → รวม · ตำแหน่ง) · รวมเม็ด · ปุ่ม 'แก้พลอย' ≥ 56px · ส่วนรูปของ W2 ยังอยู่", async () => {
    await toW10();
    expect(intakeJobGems).toHaveBeenCalledWith(TOKEN, J1);
    const s = section();
    expect(s.getByRole("heading", { level: 2, name: "พลอย" })).toBeInTheDocument();
    expect(s.getByText("รวม 1,120 เม็ด")).toBeInTheDocument();
    expect(s.getByText("โกเมน · ไข่ · 4×6 มม.")).toBeInTheDocument();
    expect(s.getByText("2/ชิ้น → 70")).toBeInTheDocument();
    expect(s.getByText("ล้อมรอบ")).toBeInTheDocument();
    expect(s.getByText("30/ชิ้น → 1,050")).toBeInTheDocument();
    expect(s.getByRole("button", { name: "แก้พลอย" }).className).toContain("min-h-14");
    expect(screen.getByRole("region", { name: "รูปจากหน้างาน" })).toBeInTheDocument();
    const order = [screen.getByTestId("shop-jobgems"), screen.getByRole("region", { name: "รูปจากหน้างาน" })];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loading: skeleton 2 แถว (role=status) ไม่บล็อกส่วนอื่น · โหลดเสร็จแล้วหาย", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeJobGems.mockReturnValue(new Promise((r) => (resolve = r)));
    await toW10({ waitLoaded: false });
    expect(screen.getByRole("status", { name: "กำลังโหลดพลอย" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กลับไปใบที่ฉันเปิด" })).toBeEnabled();
    await act(async () => resolve(gemsRes()));
    await waitFor(() => expect(screen.queryByRole("status", { name: "กำลังโหลดพลอย" })).not.toBeInTheDocument());
    expect(section().getByRole("button", { name: "แก้พลอย" })).toBeInTheDocument();
  });

  it("error: 'โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง' + ลองอีกครั้ง · เน็ตหลุด (throw) ก็เหมือนกัน · session หมด → ขอแผ่น PIN", async () => {
    intakeJobGems.mockResolvedValueOnce({ ok: false, error: "x_y", code: "error" });
    const view = await toW10();
    expect(section().getByText("โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง")).toBeInTheDocument();
    intakeJobGems.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(section().getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2));
    expect(await section().findByText("โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง")).toBeInTheDocument();
    intakeJobGems.mockResolvedValueOnce({ ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" });
    await userEvent.click(section().getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // hub โหลดใหม่ + ใส่ PIN ผ่าน (props ใหม่) → จอแก้กลับมา (ไม่ถูกถอด) → ลองอีกครั้งได้
    view.rerender(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await userEvent.click(section().getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(section().getByRole("button", { name: "แก้พลอย" })).toBeInTheDocument());
  });

  it("empty: แก้ได้ไม่มีรายการ → 'ใบนี้ไม่มีพลอย — เพิ่มได้จนช่างเริ่มรับงาน' + [เพิ่มพลอย] · ยังไม่ระบุ (มีขั้นฝังแต่ไม่มีรายการ) → ⚑ amber + [เพิ่มพลอย] · ล็อก+ไม่มีรายการ → 'ใบนี้ไม่มีพลอย' (ไม่มีปุ่ม)", async () => {
    intakeJobGems.mockResolvedValue(gemsRes({ lines: [], state: "not_needed" }));
    const v = await toW10();
    expect(section().getByTestId("shop-jobgems-empty")).toHaveTextContent("ใบนี้ไม่มีพลอย — เพิ่มได้จนช่างเริ่มรับงาน");
    expect(section().getByRole("button", { name: "เพิ่มพลอย" })).toBeInTheDocument();
    v.unmount();
    intakeJobGems.mockResolvedValue(gemsRes({ lines: [], state: "unspecified" }));
    const v2 = await toW10();
    expect(section().getByText("⚑ ยังไม่ระบุพลอย")).toBeInTheDocument();
    expect(section().getByRole("button", { name: "เพิ่มพลอย" })).toBeInTheDocument();
    v2.unmount();
    intakeJobGems.mockResolvedValue(gemsRes({ lines: [], state: "not_needed", editable: false, lockCode: "job_locked" }));
    await toW10();
    expect(section().getByTestId("shop-jobgems-empty")).toHaveTextContent(/^ใบนี้ไม่มีพลอย$/);
    expect(section().queryByRole("button", { name: /พลอย$/ })).not.toBeInTheDocument();
  });

  it.each([
    ["job_locked", true, "ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ"],
    ["job_cancelled", true, "ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้"],
    ["job_closed", true, "ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้"],
    ["job_not_open", true, "ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ"],
    ["no_gem_stage", false, "ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศเพิ่มขั้นฝังพลอย"],
  ])("ล็อก %s: ข้อความของตัวเอง (ไอคอน 🔒 + คำ) · ไม่มีปุ่มแก้ · แถวสรุปยังอ่านได้", async (code, hasStage, msg) => {
    intakeJobGems.mockResolvedValue(gemsRes({ editable: false, lockCode: code, hasGemStage: hasStage }));
    await toW10();
    expect(section().getByTestId("shop-jobgems-lock")).toHaveTextContent(msg);
    expect(section().queryByRole("button", { name: "แก้พลอย" })).not.toBeInTheDocument();
    expect(section().getByText("โกเมน · ไข่ · 4×6 มม.")).toBeInTheDocument();
  });

  it("ใบไม่มีขั้นฝัง (ไม่มี lockCode แต่ hasGemStage=false) = ล็อกด้วยข้อความเดียวกัน (ผู้จัดการเพิ่มขั้นเองไม่ได้)", async () => {
    intakeJobGems.mockResolvedValue(gemsRes({ editable: true, lockCode: null, hasGemStage: false, lines: [], state: "not_needed" }));
    await toW10();
    expect(section().getByTestId("shop-jobgems-lock")).toHaveTextContent("แจ้งออฟฟิศเพิ่มขั้นฝังพลอย");
    expect(section().queryByRole("button", { name: /พลอย$/ })).not.toBeInTheDocument();
  });
});

describe("W-10 · แผ่น 'แก้พลอย' (บันทึกทั้งชุดครั้งเดียว)", () => {
  it("เปิดแผ่นเต็มจอ (dialog · aria-modal · โฟกัสหัว) · แถวเดิมพับ + ป้าย · แก้จำนวนแล้วบันทึก → ส่งทั้งชุดพร้อม rev · สำเร็จ = ปิดแผ่น + 'บันทึกพลอยแล้ว' + โหลดใหม่ + โฟกัสกลับปุ่ม", async () => {
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockResolvedValueOnce(gemsRes({ rev: REV2 }));
    await toW10();
    const dlg = await openSheet();
    expect(dlg).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(within(dlg).getByRole("heading", { level: 2, name: "แก้พลอย JB-0031" })).toHaveFocus());
    expect(within(dlg).getByText(/คูณด้วยจำนวนที่จะผลิต 35 ชิ้น/)).toBeInTheDocument();
    expect(within(dlg).getByTestId("shop-gem-row-label-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "3");
    expect(within(dlg).getByTestId("shop-gem-line-total-1")).toHaveTextContent("รวมทั้งใบ 105 เม็ด (3 × 35)");
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(1));
    expect(intakeSetJobGems).toHaveBeenCalledWith(TOKEN, {
      jobId: J1,
      lines: [{ gemItemId: I1, qtyPerPiece: 3, position: "ล้อมรอบ" }, { gemItemId: I2, qtyPerPiece: 30, position: null }],
      expectedRev: REV1,
      force: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    expect(section().getByTestId("shop-jobgems-notes")).toHaveTextContent("บันทึกพลอยแล้ว");
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(section().getByRole("button", { name: "แก้พลอย" })).toHaveFocus());
  });

  it("เพิ่มแถวใหม่ในแผ่น (ชนิด/รูปทรงจากรายการ) → ส่งแถวใหม่ท้ายชุด · รวม = จำนวน × จำนวนผลิต", async () => {
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "เพิ่มพลอย" }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^ชนิดพลอยแถว 3/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" })).getByRole("option", { name: /^โกเมน/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^รูปทรงแถว 3/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เลือกรูปทรง" })).getByRole("option", { name: /^กลม/ }));
    await userEvent.type(within(dlg).getByLabelText("ขนาด (มม.)"), "4");
    await userEvent.type(within(dlg).getByLabelText("จำนวนต่อชิ้น"), "2");
    expect(within(dlg).getByTestId("shop-gem-line-total-3")).toHaveTextContent("รวมทั้งใบ 70 เม็ด (2 × 35)");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(1));
    expect(setCall().lines).toHaveLength(3);
    expect(setCall().lines[2]).toEqual({ qtyPerPiece: 2, position: null, sizeA: 4, sizeB: null, typeId: T1, shapeId: S1 });
  });

  it("แถวที่ยังไม่ครบ: บันทึกไม่ได้ (ไม่ถึง action) · ข้อความชี้แถว/ช่อง", async () => {
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "เพิ่มพลอย" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(within(dlg).getAllByText("แถว 3 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย").length).toBeGreaterThan(0);
    expect(intakeSetJobGems).not.toHaveBeenCalled();
  });

  it("เหลือ 0 แถว: เตือนก่อนบันทึก ('ขั้นฝังพลอยยังอยู่ ใบจะขึ้นเตือนยังไม่ระบุพลอยจนออฟฟิศถอดขั้น') · focus เริ่มที่ปุ่มปลอดภัย · 'กลับไปแก้' ไม่ส่ง · 'บันทึกอยู่ดี' ส่ง lines ว่าง", async () => {
    await toW10();
    const dlg = await openSheet();
    for (const n of [2, 1]) {
      await userEvent.click(within(dlg).getByRole("button", { name: new RegExp(`แถว ${n}`) }));
      await userEvent.click(within(dlg).getByRole("button", { name: `ลบพลอยแถว ${n}` }));
    }
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    const warn = await screen.findByRole("dialog", { name: "บันทึกโดยไม่มีพลอย?" });
    expect(within(warn).getByText("ขั้นฝังพลอยยังอยู่ ใบจะขึ้นเตือนยังไม่ระบุพลอยจนออฟฟิศถอดขั้น")).toBeInTheDocument();
    await waitFor(() => expect(within(warn).getByRole("button", { name: "กลับไปแก้" })).toHaveFocus());
    await userEvent.click(within(warn).getByRole("button", { name: "กลับไปแก้" }));
    expect(intakeSetJobGems).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "บันทึกโดยไม่มีพลอย?" })).getByRole("button", { name: "บันทึกอยู่ดี" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(1));
    expect(setCall()).toMatchObject({ jobId: J1, lines: [], expectedRev: REV1 });
  });

  it("ออกขณะมีแก้ที่ยังไม่บันทึก: 'ทิ้งการแก้พลอย?' (focus ที่ 'กลับไปแก้ต่อ') · ทิ้ง = ปิดโดยไม่บันทึก · ไม่มีแก้ = ปิดเลย", async () => {
    await toW10();
    let dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" })); // ยังไม่แก้ = ปิดทันที
    expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument();
    dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "9");
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    const ask = await screen.findByRole("dialog", { name: "ทิ้งการแก้พลอย?" });
    await waitFor(() => expect(within(ask).getByRole("button", { name: "กลับไปแก้ต่อ" })).toHaveFocus());
    await userEvent.click(within(ask).getByRole("button", { name: "กลับไปแก้ต่อ" }));
    expect(screen.getByRole("dialog", { name: "แก้พลอย JB-0031" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog", { name: "แก้พลอย JB-0031" })).getByRole("button", { name: "ยกเลิก" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "ทิ้งการแก้พลอย?" })).getByRole("button", { name: "ทิ้งที่แก้" }));
    expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument();
    expect(intakeSetJobGems).not.toHaveBeenCalled();
  });

  it("gem_conflict (อีกเครื่องแก้ไปก่อน): ข้อความ + 'โหลดพลอยใหม่' · กดแล้วปิดแผ่น โหลดใหม่ แจ้งว่าเปลี่ยนไป", async () => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code: "gem_conflict", error: "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง" });
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockResolvedValueOnce(gemsRes({ rev: REV2, lines: [LINES[0]] }));
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("มีการแก้พลอยของใบนี้ไปแล้ว");
    expect(within(dlg).getByRole("button", { name: "บันทึกพลอย" })).toHaveAttribute("aria-disabled", "true"); // ไม่ให้ทับซ้ำ
    await userEvent.click(within(dlg).getByRole("button", { name: "โหลดพลอยใหม่" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2));
    expect(section().queryByText("CZ · กลม · 1.5 มม.")).not.toBeInTheDocument();
    expect(section().getByTestId("shop-jobgems-notes")).toHaveTextContent("มีการแก้พลอยของใบนี้ไปแล้ว");
  });

  it("ช่างรับงานระหว่างผู้จัดการแก้ (job_locked): ปิดแผ่นพร้อมข้อความล็อก (ค่าที่พิมพ์ไม่ถูกบันทึก) · ปุ่มแก้หาย", async () => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code: "job_locked", error: "ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ" });
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockResolvedValueOnce(gemsRes({ editable: false, lockCode: "job_locked" }));
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    expect(section().getByTestId("shop-jobgems-lock")).toHaveTextContent("ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ");
    expect(section().queryByRole("button", { name: "แก้พลอย" })).not.toBeInTheDocument();
  });

  it.each([
    ["job_cancelled", "ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้"],
    ["job_closed", "ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้"],
    ["no_gem_stage", "แจ้งออฟฟิศเพิ่มขั้นฝังพลอย"],
  ])("ถูกล็อกระหว่างแก้ (%s): ปิดแผ่น + ข้อความล็อกทันที แม้โหลดใหม่ไม่ทัน", async (code, msg) => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code, error: "x" });
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockRejectedValueOnce(new Error("offline"));
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(section().getByTestId("shop-jobgems-lock")).toHaveTextContent(msg));
  });

  it("แถวผิดจาก DB: กล่องแดง 'พลอยแถว 1: …' ที่แถวนั้น · โฟกัสช่อง · แผ่นไม่ปิด ค่าคงอยู่ · แก้แล้วข้อความหาย", async () => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code: "gem_line_invalid", error: "พลอยแถว 1: จำนวนต่อชิ้นต้องเป็นเลข 1–1,000", field: "gems", gem: { code: "qty_invalid", row: 1, field: "qty_per_piece" } });
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    const err = await within(dlg).findByTestId("shop-gem-server-error-1");
    expect(err).toHaveTextContent("พลอยแถว 1: จำนวนต่อชิ้นต้องเป็นเลข 1–1,000");
    await waitFor(() => expect(within(dlg).getByLabelText("จำนวนต่อชิ้น")).toHaveFocus());
    expect(within(dlg).getByLabelText("จำนวนต่อชิ้น")).toHaveValue("2");
    await userEvent.type(within(dlg).getByLabelText("จำนวนต่อชิ้น"), "0");
    expect(within(dlg).queryByTestId("shop-gem-server-error-1")).not.toBeInTheDocument();
  });

  it("ชื่อคล้ายที่ DB ถาม: กล่องถาม → 'ไม่ใช่ — เพิ่มใหม่' ส่งซ้ำพร้อม force เฉพาะชื่อนั้น (rev เดิม) · สำเร็จ = ปิดแผ่น", async () => {
    intakeGemCatalog.mockResolvedValue(catalog({ types: [] })); // ฝั่งจอไม่เห็นชนิด → DB เป็นคนถาม
    intakeSetJobGems.mockResolvedValueOnce({ ok: false, code: "gem_similar", error: "x", field: "gems", similar: [{ kind: "type", name: "โกเมนต์", rows: [3], matches: [{ id: T1, name: "โกเมน" }] }] });
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "เพิ่มพลอย" }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^ชนิดพลอยแถว 3/ }));
    const pick = await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" });
    await userEvent.type(within(pick).getByRole("combobox"), "โกเมนต์");
    await userEvent.click(within(pick).getByRole("option", { name: /เพิ่ม “โกเมนต์” เป็นชนิดพลอยใหม่/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^รูปทรงแถว 3/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เลือกรูปทรง" })).getByRole("option", { name: /^กลม/ }));
    await userEvent.type(within(dlg).getByLabelText("ขนาด (มม.)"), "4");
    await userEvent.type(within(dlg).getByLabelText("จำนวนต่อชิ้น"), "2");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    const ask = await screen.findByRole("dialog", { name: "มี “โกเมน” อยู่แล้ว" });
    expect("force" in setCall(0) && setCall(0).force !== null).toBe(false);
    await userEvent.click(within(ask).getByRole("button", { name: "ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(2));
    expect(setCall(1).force).toEqual([{ kind: "type", name: "โกเมนต์" }]);
    expect(setCall(1).expectedRev).toBe(REV1);
    expect(setCall(1).lines[2]).toMatchObject({ newTypeName: "โกเมนต์", shapeId: S1 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
  });

  it("เพดานรายการ/ชื่อใหม่ (gem_name_cap) ในแผ่น: ข้อความกลาง · แผ่นไม่ปิด ค่าคงอยู่", async () => {
    const CAP = "เพิ่มพลอยใหม่ถี่เกินไปวันนี้ — เลือกจากรายการที่มี หรือแจ้งออฟฟิศ";
    intakeSetJobGems.mockResolvedValue({ ok: false, code: "gem_name_cap", error: CAP, field: "gems" });
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent(CAP);
    expect(within(dlg).getByTestId("shop-gem-row-1")).toBeInTheDocument();
  });

  it.each([
    ["order_not_found", "ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง"],
    ["not_allowed", "บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ"],
    ["rate_limited", "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง"],
  ])("code อื่นของ DB (%s): ข้อความไทยตายตัวในแผ่น · แผ่นไม่ปิด ค่าคงอยู่ · ไม่มีรหัสดิบ", async (code, msg) => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code, error: msg });
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    const alert = await within(dlg).findByRole("alert");
    expect(alert).toHaveTextContent(msg);
    expect(alert.textContent).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(within(dlg).getByTestId("shop-gem-row-1")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "แก้พลอย JB-0031" })).toBeInTheDocument();
  });

  it("session หมดเวลาตอนบันทึก: ข้อความ + ขอแผ่น PIN (แผ่นแก้ไม่ถูกถอด ค่าไม่หาย) · เน็ตหลุด: ข้อความ กดซ้ำได้", async () => {
    intakeSetJobGems.mockResolvedValueOnce({ ok: false, code: "session_required", error: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
    const view = await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // แผ่น PIN ซ้อน: จอแก้ถูกซ่อนไม่ถูกถอด (ค่าที่พิมพ์ไม่หาย) → ผ่าน PIN แล้วกลับมาที่เดิม
    expect(within(dlg).getByLabelText("จำนวนต่อชิ้น")).toHaveValue("4");
    view.rerender(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("หมดเวลาแล้ว — ใส่ PIN ใหม่");
    intakeSetJobGems.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(await within(dlg).findByText("ส่งไม่สำเร็จ — เช็คสัญญาณแล้วกด “บันทึกพลอย” อีกครั้ง")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
  });

  it("กันกดซ้ำระหว่างบันทึก: ปุ่ม 'กำลังบันทึกพลอย…' · เรียก action ครั้งเดียว · ปุ่มยกเลิก/ย้อนปิดไม่ได้", async () => {
    let resolve: (v: unknown) => void = () => {};
    intakeSetJobGems.mockReturnValue(new Promise((r) => (resolve = r)));
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    const busy = await within(dlg).findByRole("button", { name: "กำลังบันทึกพลอย…" });
    await userEvent.click(busy);
    await userEvent.click(busy);
    expect(intakeSetJobGems).toHaveBeenCalledTimes(1);
    expect(within(dlg).getByRole("button", { name: "ยกเลิก" })).toBeDisabled();
    await act(async () => resolve(SET_OK));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
  });

  it("แผ่นแก้ใช้รายการชนิด/รูปทรงจาก catalog (ไม่ใช่ action ออฟฟิศ) · โหลดไม่ได้ = แถบ amber + พิมพ์เองได้", async () => {
    intakeGemCatalog.mockResolvedValue({ ok: false, error: "x", code: "error" });
    await toW10();
    const dlg = await openSheet();
    expect(await within(dlg).findByText(/โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้/)).toBeInTheDocument();
    expect(intakeGemCatalog).toHaveBeenCalledWith(TOKEN, null);
  });
});

describe("🔴 ไม่มีเงิน/ราคา/ต้นทุน/เผื่อแตก ในส่วนพลอยของ W-9/W-10 (รวมแผ่นแก้)", () => {
  it("การ์ด · ส่วนพลอย · แผ่นแก้ · กล่องเตือน", async () => {
    intakeMyJobs.mockResolvedValue(list([job({ gemState: "specified", gemCount: 2, gemPieces: 1120 })]));
    await toW10();
    const money = () => expect(document.body.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|เผื่อแตก/i);
    money();
    const dlg = await openSheet();
    money();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    money();
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    money();
  });
});

describe("รอบแก้ review/QA 24 ต.ค. — W-9 / W-10", () => {
  const savedLines = (qty1: number) => [
    { gemItemId: I1, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: qty1, qtyTotal: qty1 * 35, position: "ล้อมรอบ" },
    { gemItemId: I2, label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, qtyTotal: 1050, position: null },
  ];

  it("[1] gem_conflict แล้วแก้แถวต่อ: กล่อง conflict + 'โหลดพลอยใหม่' ไม่หาย (ผูกกับ conflict ไม่ใช่ error) · กดโหลดใหม่ได้ → ปิดแผ่นโหลดใหม่", async () => {
    intakeSetJobGems.mockResolvedValue({ ok: false, code: "gem_conflict", error: "x_y" });
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockResolvedValueOnce(gemsRes({ rev: REV2 }));
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(await within(dlg).findByTestId("shop-gemsheet-conflict")).toHaveTextContent("มีการแก้พลอยของใบนี้ไปแล้ว");
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    expect(within(dlg).getByTestId("shop-gemsheet-conflict")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "โหลดพลอยใหม่" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2));
  });

  it("[2] บันทึกสำเร็จแล้วโหลดซ้ำล้ม: จอใช้แถว/rev จากผลบันทึกทันที · เปิดแผ่นอีกครั้งเห็นค่าใหม่ และบันทึกต่อด้วย rev ใหม่ (ไม่ชน gem_conflict)", async () => {
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockRejectedValue(new Error("offline"));
    intakeSetJobGems.mockResolvedValueOnce({ ...SET_OK, lines: savedLines(5), rev: REV2 }).mockResolvedValueOnce({ ...SET_OK, lines: savedLines(6), rev: "c".repeat(32) });
    await toW10();
    let dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5");
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2)); // โหลดซ้ำเงียบๆ (ล้ม)
    expect(section().getByText("5/ชิ้น → 175")).toBeInTheDocument();
    expect(section().queryByText("2/ชิ้น → 70")).not.toBeInTheDocument();
    dlg = await openSheet();
    expect(within(dlg).getByTestId("shop-gem-row-1")).toHaveTextContent("5 เม็ด/ชิ้น");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(intakeSetJobGems).toHaveBeenCalledTimes(2));
    expect(setCall(1).expectedRev).toBe(REV2);
    expect(setCall(1).lines[0]).toMatchObject({ gemItemId: I1, qtyPerPiece: 5 });
  });

  it("[3] ป้าย W-9 บอกว่าแก้อะไรได้: รูปอย่างเดียว · พลอยอย่างเดียว · ทั้งคู่ · ล็อก 🔒 (ใบ 'ไม่มีพลอย' ไม่บอกว่าแก้พลอยได้)", async () => {
    intakeMyJobs.mockResolvedValue(
      list([
        job({ jobId: "a1", jobNo: "JB-0001", editable: true, gemEditable: false, gemState: "not_needed" }),
        job({ jobId: "a2", jobNo: "JB-0002", editable: true, gemEditable: true, gemState: "specified", gemCount: 1, gemPieces: 60 }),
        job({ jobId: "a3", jobNo: "JB-0003", editable: false, gemEditable: true, gemState: "specified", gemCount: 1, gemPieces: 60 }),
        job({ jobId: "a4", jobNo: "JB-0004", editable: false, gemEditable: false, gemState: "specified", gemCount: 1, gemPieces: 60 }),
      ]),
    );
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await screen.findByRole("button", { name: /JB-0001/ });
    const badge = (n: string) => within(screen.getByRole("button", { name: new RegExp(n) })).getByTestId("mycard-badge");
    expect(badge("JB-0001")).toHaveTextContent("แก้รูปได้");
    expect(badge("JB-0001")).not.toHaveTextContent("พลอย");
    expect(badge("JB-0002")).toHaveTextContent("แก้รูป·พลอยได้");
    expect(badge("JB-0003")).toHaveTextContent("แก้พลอยได้");
    expect(badge("JB-0004")).toHaveTextContent("แก้ไม่ได้ตอนนี้");
    expect(badge("JB-0004").className).toContain("bg-zinc-200"); // 🔒 (ไอคอน + คำ)
  });

  it("[4] ทุกกรณีแก้ไม่ได้มีเหตุผล: DB บอก editable=false แต่ไม่มี lockCode ที่รู้จัก → 'ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้' · แก้ได้ = แถบ ✎ 'แก้พลอยได้จนช่างเริ่มรับงาน' (ล็อก = ไม่มีแถบ)", async () => {
    const v = await toW10();
    expect(section().getByTestId("shop-jobgems-editable")).toHaveTextContent("✎ แก้พลอยได้จนช่างเริ่มรับงาน");
    expect(section().queryByTestId("shop-jobgems-lock")).not.toBeInTheDocument();
    v.unmount();
    intakeJobGems.mockResolvedValue(gemsRes({ editable: false, lockCode: null }));
    await toW10();
    expect(section().getByTestId("shop-jobgems-lock")).toHaveTextContent("ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ");
    expect(section().queryByTestId("shop-jobgems-editable")).not.toBeInTheDocument();
    expect(section().queryByRole("button", { name: "แก้พลอย" })).not.toBeInTheDocument();
  });

  it("[4] ใบของคนอื่น/ออฟฟิศ (order_not_found ตอนโหลด) → 'แก้พลอยได้เฉพาะคนที่เปิดใบนี้' (ไม่ใช่ 'เช็คสัญญาณ')", async () => {
    intakeJobGems.mockResolvedValue({ ok: false, code: "order_not_found", error: "x" });
    await toW10();
    expect(section().getByText("แก้พลอยได้เฉพาะคนที่เปิดใบนี้")).toBeInTheDocument();
    expect(section().queryByText(/เช็คสัญญาณ/)).not.toBeInTheDocument();
  });

  it("[10] ตรวจก่อนบันทึกไม่ผ่าน: focus ไปช่องที่ขาดจริง (เลือกชนิดแล้ว → ช่องรูปทรง)", async () => {
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "เพิ่มพลอย" }));
    await userEvent.click(within(dlg).getByRole("button", { name: /^ชนิดพลอยแถว 3/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เลือกชนิดพลอย" })).getByRole("option", { name: /^โกเมน/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(within(dlg).getByRole("button", { name: /^รูปทรงแถว 3/ })).toHaveFocus());
    expect(intakeSetJobGems).not.toHaveBeenCalled();
  });

  it("[10] แผ่นแก้ถูกซ่อนตอนแผ่น PIN ขึ้น: Esc ไม่ทำงาน (ไม่เด้ง 'ทิ้งการแก้พลอย?') · กลับมามองเห็นแล้ว Esc ทำงานตามปกติ", async () => {
    intakeSetJobGems.mockResolvedValueOnce({ ok: false, code: "session_required", error: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
    const v = await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled()); // hub โหลดใหม่ → จอซ้อนถูกซ่อน (ไม่ถูกถอด)
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "ทิ้งการแก้พลอย?", hidden: true })).not.toBeInTheDocument();
    v.rerender(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "ทิ้งการแก้พลอย?" })).toBeInTheDocument();
  });
});
