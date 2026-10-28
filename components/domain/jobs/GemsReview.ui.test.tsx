// @vitest-environment jsdom
// รอบ review/QA 22 ต.ค. (UI): form ซ้อน · แจ้งแถวที่ DB รวมให้ · เหตุผลล่องหน · ป้าย SKU · popover blur · sheet a11y · บันไดพิมพ์ (fonts reset · แผ่น 1 ยังล้น · unspecified)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const suggestJob = vi.fn();
const createJob = vi.fn();
const getJobPlanSuggest = vi.fn();
vi.mock("@/lib/actions/job-office", () => ({
  suggestJob: (...a: unknown[]) => suggestJob(...a),
  createJob: (...a: unknown[]) => createJob(...a),
  getJobPlanSuggest: (...a: unknown[]) => getJobPlanSuggest(...a),
}));
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: vi.fn() }));
const A = { getJobGems: vi.fn(), saveJobGems: vi.fn(), getGemOptions: vi.fn() };
vi.mock("@/lib/actions/gems", () => ({
  getGemOptions: (...a: unknown[]) => A.getGemOptions(...a),
  getJobGems: (...a: unknown[]) => A.getJobGems(...a),
  saveJobGems: (...a: unknown[]) => A.saveJobGems(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "@/components/domain/jobs/JobCreateDialog";
import { JobGemsEditDialog } from "@/components/domain/jobs/JobGemsEditDialog";
import { JobPrintClient } from "@/components/domain/jobs/JobPrintClient";
import { GemPicker } from "@/components/domain/gems/GemPicker";
import type { GemBomLine, JobGems } from "@/lib/jobs/gems";
import type { PrintableJob } from "@/lib/jobs/print";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const S_ROUND = "bbbbbbbb-0000-4000-8000-000000000001";
const ITEM_GEM = "cccccccc-0000-4000-8000-000000000001";
const JOB = "99999999-1111-4111-8111-111111111111";

const PF = [{ id: "99999999-0000-4000-8000-000000000001", name: "แบบ 1", note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, stages: [], jobsOpen: 0 }];
const STAGES = [{ code: "cast", nameTh: "หล่อ", defaultSelected: true }, { code: "gem_set", nameTh: "ฝังพลอย", defaultSelected: true }];
const suggestion = (o: Record<string, unknown> = {}) => ({ ok: true, data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: STAGES, targetPieceG: 4, targetPieceGSource: "quote", ...o } });
const tpl = (): GemBomLine => ({ id: null, gemItemId: ITEM_GEM, canonicalItemId: ITEM_GEM, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 60, position: null, source: "product", renamed: false, via: null });
const plan = (gemBom: unknown[] = []) => ({ ok: true, data: { qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 30, underPlanned: false, rejectBasis: { castPct: 6, polishPct: 3, platePct: 2, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "quote", metal: "silver", metalPlanG: 120, metalPlanBasis: { missing: [] }, missing: [], gemBom } });

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(plan());
  A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [{ id: T, name: "โกเมน" }], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }], items: [] } });
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
});

async function openCreate() {
  wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByTestId("qty-order");
  return await screen.findByTestId("job-create-gems");
}

describe("🔴 form ซ้อน (review B3): สร้างรูปทรงใหม่ต้องไม่บันทึกฟอร์มแม่", () => {
  it("เลือก 2 ค่า → ตกลง: ไม่เรียก createJob · ไม่มี <form> ซ้อน <form> · ฟอร์มสร้างใบยังเปิดและรูปทรงใหม่ถูกใส่ในแถว", async () => {
    const user = userEvent.setup();
    const gems = await openCreate();
    await user.click(within(gems).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อรูปทรง/ }), "ทรงใบไม้");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทรงใบไม้”/ }));
    const ask = await screen.findByTestId("gem-new-shape-ask");
    expect(document.querySelectorAll("form form")).toHaveLength(0);
    await user.click(within(ask).getByRole("radio", { name: /2 ค่า/ }));
    await user.click(within(ask).getByRole("button", { name: "ตกลง" }));
    expect(createJob).not.toHaveBeenCalled();
    expect(screen.queryByTestId("gem-new-shape-ask")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "สร้างใบงาน" })).toBeInTheDocument();
    expect(within(gems).getByRole("button", { name: /รูปทรงแถว 1: ทรงใบไม้/ })).toBeInTheDocument();
    expect(within(gems).getByLabelText("ขนาดด้านยาว (มม.)")).toBeInTheDocument();
  });
  it("กด 'ตกลง' ขณะยังไม่เลือก / กดยกเลิก / กด X ของกล่องซ้อน = ไม่ submit ฟอร์มแม่", async () => {
    const user = userEvent.setup();
    const gems = await openCreate();
    await user.click(within(gems).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อรูปทรง/ }), "ทรงใบไม้");
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทรงใบไม้”/ }));
    let ask = await screen.findByTestId("gem-new-shape-ask");
    await user.click(within(ask).getByRole("button", { name: "ตกลง" }));
    expect(screen.getByTestId("gem-new-shape-ask")).toBeInTheDocument();
    await user.click(within(ask).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByTestId("gem-new-shape-ask")).not.toBeInTheDocument();
    // แผ่นเลือกยังเปิดอยู่หลังยกเลิก → กดเพิ่มอีกครั้งแล้วกด X (ปุ่มปิดของ Modal ซ้อน — ต้องเป็น type=button ไม่ใช่ submit ของฟอร์มแม่)
    await user.click(screen.getByRole("option", { name: /เพิ่ม “ทรงใบไม้”/ }));
    ask = await screen.findByTestId("gem-new-shape-ask");
    const x = within(ask.closest('[role="dialog"]') as HTMLElement).getByRole("button", { name: "ปิด" });
    expect(x).toHaveAttribute("type", "button");
    await user.click(x);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe("ป้ายแม่แบบ + รหัส SKU (review nit)", () => {
  it("suggestJob ส่ง sku + มีแม่แบบ → 'จากแม่แบบ SKU RG-0418' · ไม่มี sku = ไม่มีป้ายหัวส่วน", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    suggestJob.mockResolvedValue(suggestion({ sku: "RG-0418" }));
    const gems = await openCreate();
    expect(await within(gems).findByText("จากแม่แบบ SKU RG-0418")).toBeInTheDocument();
  });
  it("ไม่มี sku", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    const gems = await openCreate();
    await within(gems).findByTestId("gem-row-label-1");
    expect(within(gems).queryByText(/จากแม่แบบ SKU/)).not.toBeInTheDocument();
  });
});

describe("กล่องแก้พลอย", () => {
  const bl = (): GemBomLine => ({ id: "r1", gemItemId: ITEM_GEM, canonicalItemId: ITEM_GEM, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: null, source: "manual", renamed: false, via: null });
  const jobGems = (window: JobGems["window"]): { ok: true; data: JobGems } => ({ ok: true, data: { jobId: JOB, jobNo: "JB-0031", qtyPlanned: 35, window, state: "specified", gemStage: "pending", lines: [bl()], template: null, differsFromTemplate: null, history: [] } });
  const summary = (mergedRows: number[][]) => ({ ok: true, data: { summary: { changed: true, count: 1, createdTypes: [], createdShapes: [], createdItems: 0, reused: [], mergedRows }, lines: [], window: "free_before_start" } });

  it("DB รวมแถวซ้ำให้ (merged_rows) → แจ้ง 'รวมแถวซ้ำ n แถว' (ไม่เงียบ)", async () => {
    A.getJobGems.mockResolvedValue(jobGems("free_before_start"));
    A.saveJobGems.mockResolvedValue(summary([[1, 2]]));
    const user = userEvent.setup();
    wrap(<JobGemsEditDialog jobId={JOB} onClose={vi.fn()} />);
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "3");
    await user.click(screen.getByRole("button", { name: "บันทึกพลอย" }));
    expect(await screen.findByText(/รวมแถวซ้ำ 1 แถว \(แถว 1, 2\)/, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("เหตุผลที่มีอักขระล่องหนปน (x + ZWSP) ถูกปฏิเสธที่จอก่อนส่ง พร้อมข้อความเฉพาะ · ปกติผ่าน", async () => {
    A.getJobGems.mockResolvedValue(jobGems("reason_required"));
    const user = userEvent.setup();
    wrap(<JobGemsEditDialog jobId={JOB} onClose={vi.fn()} />);
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "3");
    const reason = screen.getByLabelText(/เหตุผลที่แก้/);
    fireEvent.change(reason, { target: { value: "​x" } });
    await user.click(screen.getByRole("button", { name: "บันทึกพลอย" }));
    expect(A.saveJobGems).not.toHaveBeenCalled();
    expect(screen.getByText(/เหตุผลห้ามมีอักขระควบคุมหรืออักขระล่องหน/)).toBeInTheDocument();
    await user.clear(reason);
    await user.type(reason, "ช่างฝังเปลี่ยนแบบ");
    await user.click(screen.getByRole("button", { name: "บันทึกพลอย" }));
    await waitFor(() => expect(A.saveJobGems).toHaveBeenCalledTimes(1));
  });

  it("แถวที่แก้เป็น 'ซ้ำกับแถวอื่น' ตอนบันทึก → ไม่ส่ง (คำนวณจากแถวทุกครั้ง)", async () => {
    A.getJobGems.mockResolvedValue({ ok: true, data: { ...jobGems("free_before_start").data, lines: [bl(), { ...bl(), id: "r2", gemItemId: "cccccccc-0000-4000-8000-000000000002", canonicalItemId: "cccccccc-0000-4000-8000-000000000002", label: "โกเมน · ไข่ · 5×7 มม." }] } });
    const user = userEvent.setup();
    wrap(<JobGemsEditDialog jobId={JOB} onClose={vi.fn()} />);
    await screen.findByTestId("gem-row-label-2");
    // แถว 2 ถูกปลดล็อกแล้วไม่มี options → ว่าง ไม่ครบ = บล็อก
    await user.click(screen.getAllByRole("button", { name: "เปลี่ยนรายการ" })[1]);
    await user.click(screen.getByRole("button", { name: "บันทึกพลอย" }));
    expect(A.saveJobGems).not.toHaveBeenCalled();
    expect(await screen.findByText(/พลอยแถว 2 ยังไม่ครบ/)).toBeInTheDocument();
  });
});

describe("GemPicker: popover ปิดเมื่อโฟกัสออก · sheet a11y", () => {
  const props = { kind: "type" as const, id: "pk", label: "ชนิดพลอย", options: [{ id: T, name: "โกเมน" }], pending: [], value: null, onSelect: vi.fn() };
  it("popover: Tab ออกไปช่องอื่น = ปิด · คลิกในพื้นที่ว่างของแผ่นไม่ปิด · aria-haspopup=listbox", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <GemPicker {...props} />
        <button type="button">ช่องถัดไป</button>
      </div>,
    );
    const btn = screen.getByRole("button", { name: "ชนิดพลอย" });
    expect(btn).toHaveAttribute("aria-haspopup", "listbox");
    await user.click(btn);
    const box = screen.getByRole("combobox");
    expect(box).toHaveFocus();
    fireEvent.mouseDown(screen.getByTestId("pk-panel")); // พื้นที่ว่าง → preventDefault กันเสียโฟกัส
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });
  it("sheet: panel role=dialog aria-modal มีชื่อ · ปุ่มเปิด aria-haspopup=dialog", async () => {
    const user = userEvent.setup();
    render(<GemPicker {...props} presentation="sheet" />);
    const btn = screen.getByRole("button", { name: "ชนิดพลอย" });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(btn);
    const panel = screen.getByTestId("pk-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAccessibleName("เลือกชนิดพลอย");
  });
});

describe("บันไดพิมพ์ (review S5 · QA)", () => {
  const PHOTO = "https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p1_md.jpg?token=a";
  const GEMS = [{ label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: "บ่า" }, { label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, qtyTotal: 1050, position: null }];
  const job = (o: Partial<PrintableJob> = {}): PrintableJob => ({
    jobId: "11111111-1111-4111-8111-111111111111", jobNo: "JB-0031", designLabel: "แหวนโกเมนไข่", sku: null, metalLabel: "เงิน", qtyOrder: 35, qtyPlanned: 35, targetPieceG: null, metalPlanG: null, dueDate: null,
    sourceLabel: "งานลูกค้า", weightStartG: null, profileName: null, primaryPhotoUrl: PHOTO, gems: GEMS, gemsState: "specified",
    stages: [{ seq: 1, name: "หล่อ", weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false }], ...o,
  });
  const stepNow = () => (screen.queryByTestId("sheet-gems-pointer") ? "page2" : screen.queryByTestId("sheet-gems-table")?.getAttribute("data-compact") ? "compact" : screen.queryByTestId("print-photo") ? "normal" : "noPhoto");

  it("ฟอนต์โหลดเสร็จ (ความสูงเปลี่ยน) → ไล่บันไดใหม่จากขั้นแรก: ขั้นที่เคยล้นด้วยเหตุที่หายไปแล้วไม่ค้าง (รูปกลับมา)", async () => {
    let heights: Record<string, number> = { normal: 205, noPhoto: 190 };
    let release!: () => void;
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((r) => (release = r)) } });
    render(<JobPrintClient job={job()} measureMm={() => heights[stepNow()] ?? 0} />);
    expect(stepNow()).toBe("noPhoto");
    heights = { normal: 190 };
    await act(async () => {
      release();
    });
    await waitFor(() => expect(stepNow()).toBe("normal"));
    expect(screen.queryByTestId("print-gems-notice")).not.toBeInTheDocument();
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
  });

  it("หมดบันได (แผ่น 1 ยังล้นตอน page2) → แถบเตือนบนจอ print:hidden · ไม่เงียบ", () => {
    render(<JobPrintClient job={job()} measureMm={() => 210} />);
    expect(screen.getByTestId("sheet-gems-pointer")).toBeInTheDocument();
    const bar = screen.getByTestId("print-gems-overflow");
    expect(bar).toHaveTextContent("แผ่นที่ 1 ยังล้นหน้า A5");
    expect(bar.closest("section")!.className).toContain("print:hidden");
  });
  it("พอดี = ไม่มีแถบล้น", () => {
    render(<JobPrintClient job={job()} measureMm={() => 150} />);
    expect(screen.queryByTestId("print-gems-overflow")).not.toBeInTheDocument();
  });

  it("ยังไม่ระบุพลอย (มีแต่บรรทัดเตือน) ก็ถูกวัด: ล้น → ตัดรูปได้ขั้นเดียว แล้วเตือนล้น (ไม่ไป compact/แผ่น 2 ที่ไม่มีแถว)", () => {
    const m = vi.fn(() => 205);
    render(<JobPrintClient job={job({ gems: [], gemsState: "unspecified" })} measureMm={m} />);
    expect(m).toHaveBeenCalled();
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sheet-gems-page2")).not.toBeInTheDocument();
    expect(screen.getByTestId("sheet-gems-unspecified")).toBeInTheDocument();
    expect(screen.getByTestId("print-gems-overflow")).toBeInTheDocument();
  });
  it("ใบไม่มีพลอยและไม่ใช่ unspecified ไม่ถูกวัดเลย", () => {
    const m = vi.fn(() => 999);
    render(<JobPrintClient job={job({ gems: [], gemsState: "not_needed" })} measureMm={m} />);
    expect(m).not.toHaveBeenCalled();
  });
  it("แถวพลอยใส่ break-inside-avoid (ไม่ฉีกแถวข้ามหน้า)", () => {
    render(<JobPrintClient job={job()} measureMm={() => 100} />);
    for (const r of screen.getAllByTestId("sheet-gem-row")) expect(r.className).toContain("break-inside-avoid");
  });
});
