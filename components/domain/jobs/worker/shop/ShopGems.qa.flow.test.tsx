// @vitest-environment jsdom
// QA (R2-D2 · 24 ต.ค. 69) — W3 UI: ช่องที่เทสต์ของทีมไม่ครอบ (หาจากการอ่านโค้ดแบบ "คนกดจริง")
// `it.fails` = บั๊กที่ยืนยันแล้ว: เทสต์อธิบายพฤติกรรมที่ "ควรเป็น" และตอนนี้ล้ม (ผ่านใน suite เพราะ it.fails) — เมื่อ dev แก้ เทสต์จะกลับเป็นแดง ให้ลบ .fails
// ที่เหลือ = characterization ของพฤติกรรมที่เป็นอยู่ (ล็อกไว้ไม่ให้เปลี่ยนเงียบ)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { gemSummaryNotices } from "@/lib/jobs/shop-gem-flow";
import type { IntakeHubView, IntakeProduct } from "@/lib/jobs/worker-server";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
const PID = "33333333-3333-4333-8333-333333333333";
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
const gline = (id: string, label: string, qty: number, position: string | null, typeId: string, shapeId: string, hasLength: boolean, sizeA: number, sizeB: number | null, total: number) => ({
  gemItemId: id, label, typeId, typeName: null, shapeId, shapeName: null, hasLength, sizeA, sizeB, qtyPerPiece: qty, position, qtyTotal: total,
});
const LINES = [gline(I1, "โกเมน · ไข่ · 4×6 มม.", 2, "ล้อมรอบ", T1, S2, true, 4, 6, 70), gline(I2, "CZ · กลม · 1.5 มม.", 30, null, T2, S1, false, 1.5, null, 1050)];
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
const product = (): IntakeProduct => ({ id: PID, sku: "RG-0418", name: "แหวนโกเมนไข่", imageUrl: null, prefill: { metal: "silver", purity: 0.925, weightG: null, metalKnown: true } });
const tline = (id: string, label: string, qty: number, position: string | null, sizeA: number, sizeB: number) => ({ gemItemId: id, label, typeId: T1, typeName: "โกเมน", shapeId: S2, shapeName: "ไข่", hasLength: true, sizeA, sizeB, qtyPerPiece: qty, position });
const TEMPLATE = [tline(I1, "โกเมน · ไข่ · 4×6 มม.", 2, "ล้อมรอบ", 4, 6), tline(I2, "โกเมน · ไข่ · 3×5 มม.", 30, null, 3, 5)];

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  workerLogout.mockResolvedValue({ ok: true });
  intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [job()], maxPhotos: 3 });
  intakeListPhotos.mockResolvedValue({ ok: true, photos: [], count: 0, max: 3, locked: false, lockCode: null });
  intakeJobGems.mockResolvedValue(gemsRes());
  intakeGemCatalog.mockResolvedValue(catalog());
  intakeSetJobGems.mockResolvedValue(SET_OK);
  intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
});

const click = async (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const section = () => within(screen.getByTestId("shop-jobgems"));

async function toW10() {
  render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
  await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
  await screen.findByRole("heading", { level: 1, name: "แก้ JB-0031" });
  await waitFor(() => expect(screen.queryByRole("status", { name: "กำลังโหลดพลอย" })).not.toBeInTheDocument());
}
async function openSheet() {
  await userEvent.click(section().getByRole("button", { name: "แก้พลอย" }));
  return screen.findByRole("dialog", { name: "แก้พลอย JB-0031" });
}

describe("W-10 · แผ่นแก้พลอย: gem_conflict", () => {
  const CONFLICT = { ok: false, code: "gem_conflict", error: "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง" };

  it.fails("BUG-1 (เจอถ้าซวย): ชน conflict แล้วแก้ช่องต่อ → ข้อความ+ปุ่ม 'โหลดพลอยใหม่' หายไป แต่ 'บันทึกพลอย' ยัง aria-disabled = ทางตัน (ต้องกดยกเลิก→ทิ้ง→เปิดใหม่) · ควรมีทางไปต่ออย่างน้อยหนึ่งทาง", async () => {
    intakeSetJobGems.mockResolvedValue(CONFLICT);
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    expect(await within(dlg).findByRole("button", { name: "โหลดพลอยใหม่" })).toBeInTheDocument();
    // ผู้ใช้ยังไม่ได้กด "โหลดพลอยใหม่" — แก้จำนวนต่อ (เป็นเรื่องปกติ: ตาจ้องช่องที่กำลังแก้)
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    const save = within(dlg).getByRole("button", { name: "บันทึกพลอย" });
    const reload = within(dlg).queryByRole("button", { name: "โหลดพลอยใหม่" });
    const saveStillDead = save.getAttribute("aria-disabled") === "true";
    const calls = intakeSetJobGems.mock.calls.length;
    await userEvent.click(save);
    const saveWorked = intakeSetJobGems.mock.calls.length > calls;
    // ทางไปต่อ = ปุ่มโหลดใหม่ยังอยู่ หรือ บันทึกแล้วยิงจริง/ขึ้นข้อความอธิบาย
    const hasExit = reload !== null || saveWorked || !saveStillDead;
    expect(hasExit).toBe(true);
  });
});

describe("W-10 · หลังบันทึกสำเร็จแล้วโหลดซ้ำล้ม", () => {
  it.fails("BUG-2 (เจอถ้าซวย): บันทึกสำเร็จ → โหลดซ้ำแบบเงียบล้ม (เน็ตกระตุก) → จอยังโชว์ค่าเก่า + 'บันทึกพลอยแล้ว' · ค่าที่ถูกต้อง (rev ใหม่) มีอยู่ในผลบันทึกแต่ไม่ถูกใช้ → เปิดแผ่นอีกครั้งเห็นจำนวนเก่าและส่ง rev เก่า (จะชน gem_conflict)", async () => {
    const saved = [gline(I1, "โกเมน · ไข่ · 4×6 มม.", 5, "ล้อมรอบ", T1, S2, true, 4, 6, 175), LINES[1]];
    intakeJobGems.mockResolvedValueOnce(gemsRes()).mockRejectedValue(new Error("offline"));
    intakeSetJobGems.mockResolvedValue({ ...SET_OK, lines: saved.map((l) => ({ gemItemId: l.gemItemId, label: l.label, qtyPerPiece: l.qtyPerPiece, qtyTotal: l.qtyTotal, position: l.position })), rev: REV2 });
    await toW10();
    const dlg = await openSheet();
    await userEvent.click(within(dlg).getByRole("button", { name: /แถว 1/ }));
    const qty = within(dlg).getByLabelText("จำนวนต่อชิ้น");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5");
    await userEvent.click(within(dlg).getByRole("button", { name: "เสร็จแถวนี้" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "แก้พลอย JB-0031" })).not.toBeInTheDocument());
    await waitFor(() => expect(intakeJobGems).toHaveBeenCalledTimes(2));
    // ควรเห็นค่าที่เพิ่งบันทึก (5/ชิ้น) — ตอนนี้ยังเห็น 2/ชิ้น
    expect(section().getByText(/^5\/ชิ้น/)).toBeInTheDocument();
  });
});

describe("W-9 ป้ายสถานะการ์ด ↔ ส่วนพลอยของ W-10 (editable ของรูป ไม่ใช่ gemEditable)", () => {
  it("characterization: ใบที่ตอบ 'ไม่มีพลอย' (ไม่มีขั้นฝัง) → การ์ดขึ้น '✎ แก้ได้' (รูปแก้ได้) แต่ส่วนพลอยใน W-10 ล็อก 'แจ้งออฟฟิศเพิ่มขั้นฝังพลอย' · ป้ายไม่บอกว่าแก้อะไรได้ — ล็อกพฤติกรรมไว้ ถ้าจะแยกป้ายต้องแก้เทสต์นี้", async () => {
    intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [job({ editable: true, gemState: "not_needed", gemEditable: false })], maxPhotos: 3 });
    intakeJobGems.mockResolvedValue(gemsRes({ state: "not_needed", editable: false, lockCode: "no_gem_stage", hasGemStage: false, lines: [] }));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    const card = await screen.findByRole("button", { name: /JB-0031/ });
    expect(within(card).getByText("แก้ได้")).toBeInTheDocument();
    expect(within(card).getByTestId("mycard-gems")).toHaveTextContent("ไม่มีพลอย");
    await userEvent.click(card);
    await screen.findByRole("heading", { level: 1, name: "แก้ JB-0031" });
    expect(await within(screen.getByTestId("shop-jobgems")).findByTestId("shop-jobgems-lock")).toHaveTextContent("ใบนี้ไม่มีขั้นฝังพลอย");
    expect(within(screen.getByTestId("shop-jobgems")).queryByRole("button", { name: /แก้พลอย|เพิ่มพลอย/ })).not.toBeInTheDocument();
  });

  it("ล็อกที่ DB (editable=false · gemEditable=false): ป้ายการ์ด 🔒 'แก้รูปไม่ได้ตอนนี้' ตรงกับส่วนพลอยที่ล็อก (ไม่ขัดกัน)", async () => {
    intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [job({ editable: false, gemState: "specified", gemCount: 2, gemPieces: 1120, gemEditable: false })], maxPhotos: 3 });
    intakeJobGems.mockResolvedValue(gemsRes({ editable: false, lockCode: "job_locked" }));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    const card = await screen.findByRole("button", { name: /JB-0031/ });
    expect(within(card).getByText(/แก้รูปไม่ได้ตอนนี้/)).toBeInTheDocument();
    await userEvent.click(card);
    await screen.findByRole("heading", { level: 1, name: "แก้ JB-0031" });
    expect(await within(screen.getByTestId("shop-jobgems")).findByTestId("shop-jobgems-lock")).toHaveTextContent("ช่างรับงานแล้ว แก้พลอยไม่ได้");
  });
});

describe("W-4 · แข่งกับการโหลดแม่แบบของ SKU", () => {
  async function toGemsWithSlowCatalog() {
    let release: (v: unknown) => void = () => {};
    intakeGemCatalog.mockImplementation(() => new Promise((r) => (release = r)));
    intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [], maxPhotos: 3 });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await click("เปิดงานใหม่");
    await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
    await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
    await click("ถัดไป");
    await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
    await click("ถัดไป");
    await screen.findByRole("heading", { level: 1, name: "พลอย" });
    return { release: (v: unknown) => release(v) };
  }

  it.fails("BUG-3 (ต่ำ · เน็ตช้า): SKU ที่มีแม่แบบ — กด 'มีพลอย' ก่อนแม่แบบโหลดเสร็จ → ได้แถวเปล่า และแม่แบบที่มาทีหลังไม่ถูกเติมเลย (ผู้ใช้เข้าใจว่า SKU นี้ไม่มีแม่แบบ) · ควรเติมแม่แบบเมื่อแถวที่มีอยู่ยังเปล่า", async () => {
    const h = await toGemsWithSlowCatalog();
    await userEvent.click(screen.getByRole("radio", { name: "มีพลอย" }));
    expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(1); // แถวเปล่า 1 แถว
    h.release(catalog({ hasTemplate: true, template: TEMPLATE }));
    await waitFor(() => expect(intakeGemCatalog).toHaveBeenCalled());
    // ควรเห็นแม่แบบ 2 แถว (แถวเปล่าที่ยังไม่ได้กรอกถูกแทน) — ตอนนี้ยังเป็นแถวเปล่า 1 แถว
    await waitFor(() => expect(screen.getAllByTestId(/^shop-gem-row-\d+$/)).toHaveLength(2), { timeout: 1500 });
  });

  it("ไม่ทำให้พังเมื่อกดไม่มีพลอยก่อนแม่แบบโหลด: ได้ 'ไม่มีพลอย' ตามที่กด (แม่แบบที่มาทีหลังไม่ทับคำตอบ)", async () => {
    const h = await toGemsWithSlowCatalog();
    await userEvent.click(screen.getByRole("radio", { name: "ไม่มีพลอย" }));
    h.release(catalog({ hasTemplate: true, template: TEMPLATE }));
    await waitFor(() => expect(intakeGemCatalog).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("shop-gem-answer")).toHaveTextContent("ไม่มีพลอย");
    expect(screen.queryByTestId("shop-gem-row-1")).not.toBeInTheDocument();
  });
});

describe("gemSummaryNotices — ข้อความซ้ำ = React key ซ้ำ", () => {
  it.fails("BUG-4 (ต่ำมาก): สองแถวที่พิมพ์ชื่อเดียวกัน (ขนาดต่างกัน) ถูก DB 'ใช้ตัวเดิมให้' ทั้งคู่ → ข้อความเหมือนกัน 2 บรรทัด → ShopOpenSuccess/ShopJobGemsSection ใช้ข้อความเป็น key (key ซ้ำ) · ควรไม่ซ้ำ (รวมหรือใส่เลขแถว)", () => {
    const notices = gemSummaryNotices({ createdTypes: [], createdShapes: [], reused: [{ row: 1, kind: "type", typed: "cz", name: "CZ" }, { row: 2, kind: "type", typed: "cz", name: "CZ" }], mergedRows: [] });
    expect(new Set(notices).size).toBe(notices.length);
  });
});
