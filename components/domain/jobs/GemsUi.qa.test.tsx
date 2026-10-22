// @vitest-environment jsdom
// QA G1a UI (R2-D2 · 22 ต.ค. 69) — เคสนอกชุดของ dev: ช่องที่ QA เจอตอนอ่านโค้ด/ยิง RPC จริง
//  ปกติ (it)      = พฤติกรรมที่ต้องไม่พัง
//  เดิม KNOWN-GAP (it.fails) — แก้โค้ดแล้วจึงเปลี่ยนเป็น it ธรรมดา (ถ้ากลับมาพัง เทสต์จะแดง)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

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
vi.mock("@/lib/actions/job-office-write", () => ({}));
const A = { getJobGems: vi.fn(), saveJobGems: vi.fn(), getGemOptions: vi.fn(), makeSkuGemTemplateFromJob: vi.fn() };
vi.mock("@/lib/actions/gems", () => ({
  getGemOptions: (...a: unknown[]) => A.getGemOptions(...a),
  getJobGems: (...a: unknown[]) => A.getJobGems(...a),
  saveJobGems: (...a: unknown[]) => A.saveJobGems(...a),
  makeSkuGemTemplateFromJob: (...a: unknown[]) => A.makeSkuGemTemplateFromJob(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "@/components/domain/jobs/JobCreateDialog";
import { JobGemsEditDialog } from "@/components/domain/jobs/JobGemsEditDialog";
import { priceIssue } from "@/components/domain/gems/GemPriceDialog";
import { useGemFail } from "@/components/domain/gems/useGemFail";
import type { GemBomLine, JobGems } from "@/lib/jobs/gems";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const S_ROUND = "bbbbbbbb-0000-4000-8000-000000000001";
const ITEM_GEM = "cccccccc-0000-4000-8000-000000000001";
const JOB = "99999999-1111-4111-8111-111111111111";

const PF = [{ id: "99999999-0000-4000-8000-000000000001", name: "แบบ 1", note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, stages: [], jobsOpen: 0 }];
const STAGES = [
  { code: "cast", nameTh: "หล่อ", defaultSelected: true },
  { code: "gem_set", nameTh: "ฝังพลอย", defaultSelected: true },
];
const suggestion = () => ({ ok: true, data: { profiles: PF, defaultProfileId: PF[0].id, metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: STAGES, targetPieceG: 4, targetPieceGSource: "quote" } });
const tpl = (): GemBomLine => ({ id: null, gemItemId: ITEM_GEM, canonicalItemId: ITEM_GEM, label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 60, position: "บ่า", source: "product", renamed: false, via: null });
const plan = (gemBom: unknown[] = []) => ({
  ok: true,
  data: { qtyOrder: 30, qtyPlannedSuggest: 35, bufferQty: 5, qtyPlannedEff: 30, underPlanned: false, rejectBasis: { castPct: 6, polishPct: 3, platePct: 2, hasPlating: false }, targetPieceG: 4, targetPieceGSource: "quote", metal: "silver", metalPlanG: 120, metalPlanBasis: { missing: [] }, missing: [], gemBom },
});

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
  await screen.findByTestId("job-create-gems");
}
const gems = () => screen.getByTestId("job-create-gems");
const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;

describe("ฟอร์มสร้างใบงาน — ลบแถวแม่แบบทั้งหมด", () => {
  it("ผู้ใช้ลบแถวจากแม่แบบจนว่าง -> ส่ง gemLines: [] (ระบุว่าไม่มีพลอย) ไม่ใช่ปล่อยให้ DB คัดลอกแม่แบบกลับมา", async () => {
    getJobPlanSuggest.mockResolvedValue(plan([tpl()]));
    const user = userEvent.setup();
    await openCreate();
    await within(gems()).findByTestId("gem-row-label-1");
    await user.click(within(gems()).getByRole("button", { name: "ลบพลอยแถว 1" }));
    expect(within(gems()).getByTestId("gem-empty")).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(createJob.mock.calls[0][0].gemLines).toEqual([]);
    expect(createJob.mock.calls[0][0].stageCodes).toContain("gem_set"); // ติ๊กขั้นฝังค้างไว้ = ใบจะขึ้น "ยังไม่ระบุพลอย" (จอเตือนแล้ว ไม่บล็อก)
  });
});

describe("แก้แล้ว (รอบ review/QA 22 ต.ค.): force ('ไม่ใช่ — เพิ่มใหม่') ค้างทั้งฟอร์ม", () => {
  async function pickNewType(user: ReturnType<typeof userEvent.setup>, name: string, rowLabelRe: RegExp) {
    await user.click(within(gems()).getByRole("button", { name: rowLabelRe }));
    await user.type(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ }), name);
    await user.click(screen.getByRole("option", { name: new RegExp(`เพิ่ม “${name}”`) }));
  }
  it("ยืนยัน 'เพิ่มใหม่' ให้ชื่อ X แล้วเปลี่ยนแถวเป็นชื่อใหม่ Y ที่ไม่เคยถูกถาม -> คำขอถัดไปต้องไม่พก gemForce (ตอนนี้ force ค้าง = ชื่อคล้ายตัวที่ 2 ผ่านโดยไม่ถูกถาม)", async () => {
    createJob
      .mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้ายกัน", code: "gem_similar", gem: { code: "gem_similar", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T, name: "โกเมน" }] }] } })
      .mockResolvedValueOnce({ ok: false, error: "ขนาดต้องเป็นตัวเลขมากกว่า 0", code: "size_invalid", gem: { code: "size_invalid", row: 1, field: "size_a" } })
      .mockResolvedValueOnce({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
    A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }], items: [] } }); // ฝั่งจอไม่รู้จักชนิดใดเลย -> ปล่อยให้ DB ดัก
    const user = userEvent.setup();
    await openCreate();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await pickNewType(user, "โกเมนต์", /ชนิดพลอยแถว 1/);
    await user.click(within(gems()).getByRole("button", { name: /รูปทรงแถว 1/ }));
    await user.click(within(await screen.findByRole("listbox", { name: /รายการรูปทรง/ })).getByRole("option", { name: /^กลม/ }));
    await user.type(within(gems()).getByLabelText("ขนาด (มม.)"), "2");
    await user.type(within(gems()).getByLabelText("จำนวนต่อชิ้น *"), "1");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn()); // 1: DB ถามชื่อคล้าย
    await user.click(within(await screen.findByTestId("gem-similar-prompt")).getByRole("button", { name: /ไม่ใช่ — เพิ่ม “โกเมนต์” ใหม่/ })); // 2: force=true แล้วแถวผิดขนาด
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(2));
    expect(createJob.mock.calls[1][0].gemForce).toBe(true);
    await screen.findByTestId("gem-server-error-1");
    // ผู้ใช้เปลี่ยนชนิดของแถว 1 เป็นชื่อใหม่อีกชื่อ (ยังไม่เคยถูกถาม) แล้วสร้างใบอีกรอบ
    await pickNewType(user, "ทับทิมม", /ชนิดพลอยแถว 1/);
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await user.click(submitBtn()); // 3
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(3));
    expect(createJob.mock.calls[2][0]).not.toHaveProperty("gemForce");
  });

  it("useGemFail: reset() หลังผู้ใช้แก้แถว ควรล้าง force ด้วย (วันนี้ reset ไม่แตะ force — ล้างได้เฉพาะตอนเปลี่ยน itemId)", () => {
    const { result } = renderHook(() => useGemFail());
    act(() => result.current.setForce(true));
    act(() => result.current.reset());
    expect(result.current.force).toBe(false);
  });
});



describe("GemPicker popover ในฟอร์มสร้างใบงาน", () => {
  it("Esc ในช่องค้นหาของ popover ปิดแค่ popover (คืนโฟกัสที่ปุ่ม) — ฟอร์มสร้างใบงานไม่ถูกปิด", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByTestId("qty-order");
    await screen.findByTestId("job-create-gems");
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    const btn = within(gems()).getByRole("button", { name: /ชนิดพลอยแถว 1/ });
    await user.click(btn);
    expect(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(btn).toHaveFocus();
  });
  it("พิมพ์ชื่อไทยยาวมาก/อีโมจิ/ตัวพิเศษในช่องค้นหา ไม่ทำให้ล้ม · เพิ่มชื่อที่ไม่ผ่านกติกา = แจ้ง error ในแผ่น ไม่ปิดแผ่น", async () => {
    const user = userEvent.setup();
    await openCreate();
    await user.click(within(gems()).getByRole("button", { name: /เพิ่มพลอย/ }));
    await user.click(within(gems()).getByRole("button", { name: /ชนิดพลอยแถว 1/ }));
    const box = screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ });
    for (const t of ["👍👍", "12", "<b>x</b>", "ก", "ก".repeat(60)]) {
      await user.clear(box);
      await user.type(box, t);
      const add = screen.queryByRole("option", { name: /เพิ่ม “/ });
      if (add) await user.click(add);
      expect(screen.getByRole("combobox", { name: /ค้นหาหรือพิมพ์ชื่อชนิดพลอย/ })).toBeInTheDocument(); // แผ่นยังเปิด (ชื่อใช้ไม่ได้ = error · ชื่อที่ใช้ได้ถึงจะปิดแผ่น)
      if (t === "👍👍" || t === "12" || t === "<b>x</b>" || t === "ก") expect(screen.getByRole("alert")).toHaveTextContent(/ชื่อต้องมี 2-40/);
    }
  });
});

describe("แก้แล้ว (รอบ review/QA 22 ต.ค.): Modal ซ้อนกัน — Esc ปิดทุกชั้นพร้อมกัน", () => {
  it("กด Esc ที่กล่องถามชื่อคล้าย (ซ้อนบนฟอร์มสร้างใบงาน) ต้องปิดแค่กล่องถาม — ฟอร์มสร้างใบงาน (พร้อมแถวพลอยที่กรอก) ต้องไม่ถูกปิดตาม", async () => {
    createJob.mockResolvedValueOnce({ ok: false, error: "พบชื่อที่คล้ายกัน", code: "gem_similar", gem: { code: "gem_similar", similar: [{ kind: "type", name: "โกเมนต์", rows: [1], matches: [{ id: T, name: "โกเมน" }] }] } });
    A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [{ id: S_ROUND, name: "กลม", hasLength: false }], items: [] } });
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByTestId("qty-order");
    await screen.findByTestId("job-create-gems");
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
    await screen.findByTestId("gem-similar-prompt");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("gem-similar-prompt")).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("แก้แล้ว (รอบ review/QA 22 ต.ค.): กล่องแก้พลอย — หน้าต่างเปลี่ยนเป็น reason_required ระหว่างแก้", () => {
  const bl = (id: string, label: string, q: number): GemBomLine => ({ id: `r-${id}`, gemItemId: id, canonicalItemId: id, label, qtyPerPiece: q, qtyTotal: q * 35, position: null, source: "manual", renamed: false, via: null });
  const jobGems = (window: JobGems["window"]): { ok: true; data: JobGems } => ({
    ok: true,
    data: { jobId: JOB, jobNo: "JB-0031", qtyPlanned: 35, window, state: "specified", gemStage: "pending", lines: [bl(ITEM_GEM, "โกเมน · ไข่ · 4×6 มม.", 2)], template: null, differsFromTemplate: null, history: [], },
  });
  it("เปิดตอน free_before_start แล้วช่างฝังรับขณะที่แก้ (DB ตอบ reason_required) -> กล่องควรแสดงช่องเหตุผลให้กรอกต่อได้ (วันนี้มีแต่ข้อความผิด ไม่มีช่อง ต้องปิดแล้วเปิดใหม่ = ค่าที่แก้หาย)", async () => {
    A.getJobGems.mockResolvedValue(jobGems("free_before_start"));
    A.saveJobGems.mockResolvedValue({ ok: false, error: "ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง", code: "reason_required", gem: { code: "reason_required" } });
    const user = userEvent.setup();
    wrap(<JobGemsEditDialog jobId={JOB} onClose={vi.fn()} />);
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "9");
    await user.click(screen.getByRole("button", { name: "บันทึกพลอย" }));
    expect(await screen.findByText("ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง")).toBeInTheDocument();
    expect(screen.getByLabelText(/เหตุผลที่แก้/)).toBeInTheDocument();
  });
});

describe("แก้แล้ว (รอบ review/QA 22 ต.ค.): ช่องราคาพลอยตีความ ',' เป็นจุดทศนิยมเสมอ", () => {
  it("มติ review (22 ต.ค.): ช่องราคาห้ามจุลภาคทุกแบบ รวม '1,5' (เดิมรับเป็น 1.5) — ใช้จุดเท่านั้น", () => {
    expect(priceIssue("1,5")).not.toBeNull();
    expect(priceIssue("1.5")).toBeNull();
  });
  it("'1,250' (คั่นหลักพันแบบที่คนไทยพิมพ์ — เจตนา 1,250 บาท/เม็ด) ต้องไม่ผ่านเงียบๆ (วันนี้กลายเป็น 1.250 = 1.25 บาท ต่ำกว่าที่ตั้งใจ 1,000 เท่า แล้ว audit เก็บเป็นราคาจริง)", () => {
    expect(priceIssue("1,250")).not.toBeNull();
  });
  it("'12,500.50' ถูกปฏิเสธ (มีจุดและจุลภาค) · '1250' ผ่าน", () => {
    expect(priceIssue("12,500.50")).not.toBeNull();
    expect(priceIssue("1250")).toBeNull();
  });
});
