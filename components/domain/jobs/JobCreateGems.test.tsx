// @vitest-environment jsdom
// G1a: ส่วน "พลอยต่อชิ้น" ในฟอร์มสร้างใบงาน — แม่แบบ SKU (ไม่แตะ = DB คัดลอกเอง) · ติ๊กขั้นฝังให้ · แถวไม่ครบไม่ส่ง · error ผิดแถว/ชื่อคล้ายจาก DB · ไม่มีราคา
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const suggestJob = vi.fn();
const createJob = vi.fn();
const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
  getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a),
}));
vi.mock("@/lib/actions/job-office-write", () => ({}));
const getGemOptions = vi.fn();
vi.mock("@/lib/actions/gems", () => ({ getGemOptions: (...a: unknown[]) => getGemOptions(...a) }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "./JobCreateDialog";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const S_ROUND = "bbbbbbbb-0000-4000-8000-000000000001";
const S_OVAL = "bbbbbbbb-0000-4000-8000-000000000002";
const ITEM_GEM = "cccccccc-0000-4000-8000-000000000001";

const PF = [{ id: "99999999-0000-4000-8000-000000000001", name: "แบบ 1", note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, stages: [], jobsOpen: 0 }];
const STAGES = [
  { code: "cast", nameTh: "หล่อ", defaultSelected: true },
  { code: "gem_set", nameTh: "ฝังพลอย", defaultSelected: false },
];
const suggestion = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: STAGES, targetPieceG: 4, targetPieceGSource: "quote", ...o },
});
const tpl = (o: Record<string, unknown> = {}) => ({ id: null, gemItemId: ITEM_GEM, canonicalItemId: ITEM_GEM, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 60, position: "บ่า", source: "product", renamed: false, via: null, ...o });
const plan = (gemBom: unknown[] = []) => ({
  ok: true,
  data: {
    qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 30, underPlanned: false,
    rejectBasis: { castPct: 6, polishPct: 3, platePct: 2, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "quote", metal: "silver", metalPlanG: 120,
    metalPlanBasis: { missing: [] }, missing: [], gemBom,
  },
});

async function open() {
  wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByTestId("qty-order");
  await screen.findByTestId("job-create-gems");
}
const gems = () => screen.getByTestId("job-create-gems");
const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
const stageBox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(plan());
  getGemOptions.mockResolvedValue({
    ok: true,
    data: { types: [{ id: T, name: "โกเมน" }], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }, { id: S_OVAL, name: "ไข่", hasLength: true }], items: [] },
  });
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
});

describe("ฟอร์มสร้างใบงาน — ส่วนพลอย", () => {
  it("empty: 'ยังไม่มีพลอยในใบนี้' + ปุ่มเพิ่มพลอย · ไม่ติ๊กขั้นฝัง = ไม่เตือน · สร้างโดยไม่ส่ง gemLines (ไม่แตะ = DB ตัดสินเอง)", async () => {
    const user = userEvent.setup();
    await open();
    expect(within(gems()).getByTestId("gem-empty")).toHaveTextContent("ยังไม่มีพลอยในใบนี้");
    expect(within(gems()).queryByText(/⚠/)).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("gemLines");
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("gemForce");
  });

  it("แม่แบบ SKU: แถวมาให้ป้าย 'จากแม่แบบ' · ขั้นฝังติ๊กตามค่าเริ่มของ DB · ไม่แตะ = ไม่ส่ง gemLines (DB คัดลอกแม่แบบ)", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    suggestJob.mockResolvedValue(suggestion({ stages: [STAGES[0], { ...STAGES[1], defaultSelected: true }] }));
    const user = userEvent.setup();
    await open();
    expect(await within(gems()).findByTestId("gem-row-label-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(within(gems()).getByText("จากแม่แบบ")).toBeInTheDocument();
    expect(within(gems()).getByTestId("gem-line-total-1")).toHaveTextContent("รวม 60 เม็ด"); // 2 × 30
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(createJob.mock.calls[0][0]).not.toHaveProperty("gemLines");
    expect(createJob.mock.calls[0][0].stageCodes).toContain("gem_set");
  });

  it("แม่แบบมี แต่ไม่ได้ติ๊กขั้นฝัง: เตือน 'จะไม่ถูกคัดลอก' (ไม่บล็อก) · ไม่ส่ง gemLines", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    await open();
    expect(await within(gems()).findByText(/แม่แบบพลอย 1 รายการของ SKU นี้จะไม่ถูกคัดลอก เพราะไม่ได้ติ๊กขั้น “ฝังพลอย”/)).toBeInTheDocument();
  });

  it("แก้แถวจากแม่แบบ → แตะแล้ว: ส่งทั้งชุดเป็น gemItemId (ฉลาก snapshot คงเดิม) + ป้าย 'แก้แล้ว'", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    suggestJob.mockResolvedValue(suggestion({ stages: [STAGES[0], { ...STAGES[1], defaultSelected: true }] }));
    const user = userEvent.setup();
    await open();
    const qty = await within(gems()).findByLabelText("จำนวนต่อชิ้น *");
    await user.clear(qty);
    await user.type(qty, "5");
    expect(within(gems()).getByText("แก้แล้ว")).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(createJob.mock.calls[0][0].gemLines).toEqual([{ gemItemId: ITEM_GEM, qtyPerPiece: 5, position: "บ่า" }]);
  });

  it("เพิ่มแถวแรก → ติ๊กขั้น 'ฝังพลอย' ให้ + บอก · เอาติ๊กออก = เตือน amber (ไม่บล็อก)", async () => {
    const user = userEvent.setup();
    await open();
    expect(stageBox("ฝังพลอย").checked).toBe(false);
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    expect(stageBox("ฝังพลอย").checked).toBe(true);
    expect(within(gems()).getByText("ติ๊กขั้น “ฝังพลอย” ให้แล้ว เพราะมีพลอย")).toBeInTheDocument();
    await user.click(stageBox("ฝังพลอย"));
    expect(within(gems()).getByText(/มีพลอยแต่ไม่ได้ติ๊กขั้น “ฝังพลอย” — พลอยจะไม่อยู่ในขั้นไหน/)).toBeInTheDocument();
  });

  it("ใบไม่มีขั้นฝังให้เลือก (profile ไม่มี): เตือนให้ออฟฟิศเพิ่มขั้นเอง · ระบบไม่เพิ่มขั้นให้", async () => {
    suggestJob.mockResolvedValue(suggestion({ stages: [STAGES[0]] }));
    const user = userEvent.setup();
    await open();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    expect(within(gems()).getByText(/ใบนี้ไม่มีขั้น “ฝังพลอย” ให้เลือก/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "ฝังพลอย" })).not.toBeInTheDocument();
  });

  it("ติ๊กขั้นฝังแต่ไม่มีพลอย: เตือน 'หน้าช่างจะเตือนว่ายังไม่ระบุพลอย' (ไม่บล็อก — มติ 22 ต.ค.)", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(stageBox("ฝังพลอย"));
    expect(within(gems()).getByText(/ติ๊กขั้น “ฝังพลอย” แต่ไม่มีพลอย|ยังไม่ระบุพลอย — หน้าช่างจะเตือน/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
  });

  async function fillRound(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems()).getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการชนิดพลอย/ })).getByRole("option", { name: "โกเมน" }));
    await user.click(within(gems()).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการรูปทรง/ })).getByRole("option", { name: /^กลม/ }));
    await user.type(within(gems()).getByLabelText("ขนาด (มม.)"), "2");
    await user.type(within(gems()).getByLabelText("จำนวนต่อชิ้น *"), "3");
  }

  it("กรอกครบ → ส่ง gemLines ผ่าน allowlist (typeId/shapeId/ขนาด/จำนวน) · รวม 3 × 30 = 90 เม็ด", async () => {
    const user = userEvent.setup();
    await open();
    await fillRound(user);
    expect(within(gems()).getByTestId("gem-grand-total")).toHaveTextContent("รวม 1 รายการ · 90 เม็ด");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    const input = createJob.mock.calls[0][0];
    expect(input.gemLines).toEqual([{ typeId: T, shapeId: S_ROUND, sizeA: 2, sizeB: null, qtyPerPiece: 3, position: null }]);
    expect(input.stageCodes).toContain("gem_set");
    expect(JSON.stringify(input.gemLines)).not.toMatch(/price|cost|breakage|thb/i);
  });

  it("แถวไม่ครบ → ไม่เรียก createJob · แสดงเหตุผล (พลอยแถว 1 ยังไม่ครบ — …) · ฟอร์มคงอยู่", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    expect(createJob).not.toHaveBeenCalled();
    expect(await within(gems()).findByTestId("job-create-gems-blocking")).toHaveTextContent("พลอยแถว 1 ยังไม่ครบ — เลือกหรือพิมพ์ชนิดพลอย");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("DB ปฏิเสธแถว 1 (ไม่เปิดใบ): กล่องแดงที่แถวนั้น · ไม่ใช่ error ระดับฟอร์ม · ค่าที่กรอกอยู่", async () => {
    createJob.mockResolvedValue({ ok: false, error: "ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม.", code: "size_invalid", gem: { code: "size_invalid", row: 1, field: "size_a" } });
    const user = userEvent.setup();
    await open();
    await fillRound(user);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    expect(await within(gems()).findByTestId("gem-server-error-1")).toHaveTextContent("พลอยแถว 1: ขนาดต้องเป็นตัวเลขมากกว่า 0");
    expect((within(gems()).getByLabelText("ขนาด (มม.)") as HTMLInputElement).value).toBe("2");
    expect(push).not.toHaveBeenCalled();
  });

  it("ชื่อคล้ายจาก DB (ยังไม่เขียนอะไร): ถาม → 'ใช้ตัวที่มี' แก้แถวให้แล้วส่งซ้ำ (ไม่ force)", async () => {
    createJob
      .mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้ายกัน", code: "gem_similar", gem: { code: "gem_similar", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T, name: "โกเมน" }] }] } })
      .mockResolvedValueOnce({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
    getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }], items: [] } }); // ฝั่งจอไม่รู้จัก "โกเมน" → ปล่อยให้ DB ดัก
    const user = userEvent.setup();
    await open();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems()).getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ }), "โกเมนต์");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “โกเมนต์”/ }));
    await user.click(within(gems()).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการรูปทรง/ })).getByRole("option", { name: /^กลม/ }));
    await user.type(within(gems()).getByLabelText("ขนาด (มม.)"), "2");
    await user.type(within(gems()).getByLabelText("จำนวนต่อชิ้น *"), "1");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    const prompt = await screen.findByTestId("gem-similar-prompt");
    await user.click(within(prompt).getByRole("button", { name: /ใช้ “โกเมน”/ }));
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(2));
    const second = createJob.mock.calls[1][0];
    expect(second.gemLines[0].typeId).toBe(T);
    expect(second.gemLines[0]).not.toHaveProperty("newTypeName");
    expect(second).not.toHaveProperty("gemForce");
  });

  it("ชื่อคล้ายจาก DB → 'ไม่ใช่ — เพิ่มใหม่' = ส่งซ้ำพร้อม gemForce=true", async () => {
    createJob
      .mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้ายกัน", code: "gem_similar", gem: { code: "gem_similar", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T, name: "โกเมน" }] }] } })
      .mockResolvedValueOnce({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [], gemSummary: { changed: true, count: 1, createdTypes: ["โกเมนต์"], createdShapes: [], createdItems: 1, reused: [], mergedRows: [] } } });
    getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }], items: [] } });
    const user = userEvent.setup();
    await open();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems()).getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ }), "โกเมนต์");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “โกเมนต์”/ }));
    await user.click(within(gems()).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการรูปทรง/ })).getByRole("option", { name: /^กลม/ }));
    await user.type(within(gems()).getByLabelText("ขนาด (มม.)"), "2");
    await user.type(within(gems()).getByLabelText("จำนวนต่อชิ้น *"), "1");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await user.click(within(await screen.findByTestId("gem-similar-prompt")).getByRole("button", { name: /ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่/ }));
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(2));
    expect(createJob.mock.calls[1][0].gemForce).toBe(true);
    expect(createJob.mock.calls[1][0].gemLines[0].newTypeName).toBe("โกเมนต์");
  });

  it("สำเร็จแล้ว DB 'ใช้ตัวเดิมให้' → แจ้งเป็นข้อมูล (toast)", async () => {
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [], gemSummary: { changed: true, count: 1, createdTypes: [], createdShapes: [], createdItems: 0, reused: [{ row: 1, kind: "type", typed: "cz", name: "CZ" }], mergedRows: [] } } });
    const user = userEvent.setup();
    await open();
    await fillRound(user);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("ชนิด “cz” มีในระบบอยู่แล้ว — ใช้ตัวเดิม “CZ” ให้", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("โหลดรายการพลอยไม่ได้ (error): แถบเตือน + ลองอีกครั้ง · ยังกรอก/สร้างใบได้ · ฟอร์มสร้างใบไม่ล้ม", async () => {
    getGemOptions.mockResolvedValueOnce({ ok: false, error: "ขัดข้อง" }).mockResolvedValueOnce({ ok: true, data: { types: [], shapes: [], items: [] } });
    const user = userEvent.setup();
    await open();
    expect(await within(gems()).findByText(/โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(within(gems()).getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(within(gems()).queryByText(/โหลดรายการพลอยไม่ได้/)).not.toBeInTheDocument());
  });

  it("🔴 ฟอร์มสร้างใบงาน (staff ใช้ได้): ส่วนพลอยไม่มีข้อความ/ช่องเรื่องราคา ต้นทุน 'ยังไม่มีราคา' เผื่อแตก", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    await open();
    await within(gems()).findByTestId("gem-row-label-1");
    const html = gems().innerHTML;
    expect(gems().textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก|ยังไม่มีราคา/);
    expect(html).not.toMatch(/price|cost|thb|supplier/i);
  });

  it("เปลี่ยนจำนวนผลิต (เผื่อของเสีย) → รวมทั้งใบอัปเดต + บอกตัวคูณ 'สั่ง 30 + เผื่อ 5'", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    const user = userEvent.setup();
    await open();
    await within(gems()).findByTestId("gem-row-label-1");
    expect(within(gems()).getByTestId("gem-multiplier")).toHaveTextContent("จำนวนที่จะผลิต 30 ชิ้น");
    await user.click(screen.getByRole("switch", { name: /เผื่อของเสีย/ }));
    await user.type(screen.getByLabelText("เผื่อเพิ่ม (ชิ้น)"), "5");
    await waitFor(() => expect(within(gems()).getByTestId("gem-line-total-1")).toHaveTextContent("รวม 70 เม็ด")); // 2 × 35
    expect(within(gems()).getByTestId("gem-multiplier")).toHaveTextContent("จำนวนที่จะผลิต 35 ชิ้น (สั่ง 30 + เผื่อ 5)");
  });
});
