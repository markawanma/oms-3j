// @vitest-environment jsdom
// QA 27 ต.ค. 69 (R2-D2) — 0194/0195 ฝั่ง TS: ป้ายทอง exempt (ขัด) · picker ใน JobCreateDialog · ค่าเริ่มทองใน ProfilesClient · mapper เข้ม · DEPT_ORDER
// เติมจาก GoldWeighExempt.test.tsx (ของ Han) ในจุดที่เขาไม่ได้ครอบ: ขอบ mapper (ค่าที่ไม่ใช่ true เป๊ะ) · exempt แต่ไม่มีโลหะ · ขั้นข้าม · UI จริงสองจุดที่ใช้ goldWeighExempt
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/lib/actions/gems", () => ({ getGemOptions: () => Promise.resolve({ ok: true, data: { types: [], shapes: [], items: [] } }) }));
const profilesApi = { listProfiles: vi.fn(), saveProfile: vi.fn(), setDefaultProfile: vi.fn(), setProfileActive: vi.fn(), changeJobProfile: vi.fn() };
vi.mock("@/lib/actions/job-profiles", () => ({
  listProfiles: (...x: unknown[]) => profilesApi.listProfiles(...x),
  saveProfile: (...x: unknown[]) => profilesApi.saveProfile(...x),
  setDefaultProfile: (...x: unknown[]) => profilesApi.setDefaultProfile(...x),
  setProfileActive: (...x: unknown[]) => profilesApi.setProfileActive(...x),
  changeJobProfile: (...x: unknown[]) => profilesApi.changeJobProfile(...x),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "./JobCreateDialog";
import { ProfilesClient } from "./ProfilesClient";
import { StageFlagChips } from "./StageFlagChips";
import { profileSummaryParts } from "./ProfileSummary";
import { mapProfileStageDef } from "@/lib/jobs/profile";
import type { ProfilesData, RecordProfile } from "@/lib/jobs/profile";
import { analyzePicker, goldUnguardedStages } from "@/lib/jobs/profile-summary";
import { needsGoldAck } from "./ProfilePicker";
import { mapStageRow } from "@/lib/jobs/types";
import { oemScopeSort } from "@/lib/oem/display";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

// ---------------------------------------------------------------------------------------------------------------------------------
describe("QA · mapper เข้ม — เฉพาะ true เป๊ะ ถึงเป็น exempt (ไม่รู้ = เข้มไว้ก่อน)", () => {
  const base = { code: "buff", name_th: "ขัด", seq_default: 105, metal_present: true, is_active: true };
  it.each([["true"], [1], ["t"], [null], [undefined], [0], [false], [{}]])("mapProfileStageDef: gold_weigh_exempt = %j -> ไม่มี key", (v) => {
    expect(mapProfileStageDef({ ...base, gold_weigh_exempt: v })).not.toHaveProperty("goldWeighExempt");
  });
  it("mapProfileStageDef: true -> มี key และไม่ทำให้ฟิลด์อื่นเพี้ยน", () => {
    expect(mapProfileStageDef({ ...base, gold_weigh_exempt: true })).toEqual({ code: "buff", nameTh: "ขัด", seq: 105, metalPresent: true, isActive: true, goldWeighExempt: true });
  });
  it("mapStageRow: record ที่ goldWeighExempt=false/undefined -> ไม่มี key · ไม่รู้จักรหัส -> metalPresent=false", () => {
    const row = { id: "s1", stage_code: "buff", status: "pending", weigh_required: false };
    expect(mapStageRow(row, {}, {}, { buff: { metalPresent: true, goldWeighExempt: false } })).not.toHaveProperty("goldWeighExempt");
    expect(mapStageRow(row, {}, {}, { gem_set: { metalPresent: true, goldWeighExempt: true } })).toMatchObject({ metalPresent: false });
    expect(mapStageRow(row, {}, {}, { gem_set: { metalPresent: true, goldWeighExempt: true } })).not.toHaveProperty("goldWeighExempt");
  });
  it("mapStageRow: exempt แต่ metalPresent=false -> มี key exempt แต่ goldUnguardedStages ยังว่าง (ไม่มีโลหะ = ไม่นับเสมอ)", () => {
    const m = mapStageRow({ id: "s1", stage_code: "wax", status: "pending", weigh_required: false }, {}, {}, { wax: { metalPresent: false, goldWeighExempt: true } });
    expect(m).toMatchObject({ metalPresent: false, goldWeighExempt: true });
    expect(goldUnguardedStages([{ code: "wax", metalPresent: m!.metalPresent, goldWeighExempt: m!.goldWeighExempt, weigh: false }])).toEqual([]);
  });
});

describe("QA · goldUnguardedStages — ลำดับ/ขั้นข้าม/หลาย exempt", () => {
  const st = (code: string, metalPresent: boolean, weigh: boolean, o: { skipped?: boolean; goldWeighExempt?: boolean } = {}) => ({ code, metalPresent, weigh, ...o });
  it("คืนรหัสตามลำดับที่ส่งมา: finish -> gem_set -> plating (ขัด exempt ตกไป) — ลำดับใหม่ไม่ถูก sort ซ้ำเป็นลำดับเก่า", () => {
    expect(goldUnguardedStages([st("finish", true, false), st("gem_set", true, false), st("buff", true, false, { goldWeighExempt: true }), st("plating", true, false)])).toEqual(["finish", "gem_set", "plating"]);
  });
  it("ขั้นไม่ exempt ที่ข้าม (skipped) ไม่ติดป้าย · ขั้น exempt ที่ข้ามก็ไม่ติด", () => {
    expect(goldUnguardedStages([st("gem_set", true, false, { skipped: true }), st("buff", true, false, { goldWeighExempt: true, skipped: true })])).toEqual([]);
  });
  it("exempt หลายขั้น (ร้านตั้งเพิ่มในอนาคต) — ไม่ติดทุกขั้นที่ exempt · ขั้นอื่นยังติด", () => {
    expect(goldUnguardedStages([st("buff", true, false, { goldWeighExempt: true }), st("polish2", true, false, { goldWeighExempt: true }), st("qc", true, false)])).toEqual(["qc"]);
  });
  it("0 ขั้น -> []", () => {
    expect(goldUnguardedStages([])).toEqual([]);
  });
});

describe("QA · StageFlagChips — ตารางขั้นใน /jobs/[id]", () => {
  const base = { status: "pending", weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, metalPresent: true };
  it("ใบเงิน: ขั้นไม่ exempt ไม่ชั่ง = ไม่มีป้ายแดง (gold=false)", () => {
    const { container } = render(<StageFlagChips stage={base} gold={false} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("ใบทอง: ขั้นไม่ exempt + ข้ามแล้ว = ไม่มีป้ายแดง", () => {
    const { container } = render(<StageFlagChips stage={{ ...base, status: "skipped" }} gold />);
    expect(container).toBeEmptyDOMElement();
  });
  it("ใบทอง: ขั้นไม่มีโลหะ + exempt = ไม่มีป้าย", () => {
    const { container } = render(<StageFlagChips stage={{ ...base, metalPresent: false, goldWeighExempt: true }} gold />);
    expect(container).toBeEmptyDOMElement();
  });
  it("ใบทอง: exempt แต่ใบนี้ตั้งชั่งไว้ (ใบเก่าก่อน 0195) -> ป้ายเทา 'ชั่ง' ยังขึ้น · ไม่มีป้ายแดง", () => {
    render(<StageFlagChips stage={{ ...base, weighRequired: true, goldWeighExempt: true }} gold />);
    expect(screen.getByText("ชั่ง")).toBeInTheDocument();
    expect(screen.queryByText("ไม่ชั่ง")).not.toBeInTheDocument();
  });
  it("ใบทอง: exempt + ถามชิ้นเสีย -> ป้าย 'ชิ้นเสีย' ขึ้น แต่ไม่มี 'ไม่ชั่ง' (exempt ไม่ซ่อนป้ายอื่น)", () => {
    render(<StageFlagChips stage={{ ...base, scrapQtyAsk: true, goldWeighExempt: true }} gold />);
    expect(screen.getByText("ชิ้นเสีย")).toBeInTheDocument();
    expect(screen.queryByText("ไม่ชั่ง")).not.toBeInTheDocument();
  });
});

describe("QA · profileSummaryParts — ขอบของป้าย 'ยกเว้น'", () => {
  const flag = (c: string, weigh: boolean) => ({ stageCode: c, weigh, scrapQty: false, scrapWeight: false });
  it("ทะเบียนมีขั้นโลหะเดียวและเป็น exempt (ไม่มี guarded) -> ไม่ใช้ป้าย 'ยกเว้น' · ไม่ throw", () => {
    const defs = [{ code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true }];
    expect(profileSummaryParts(defs, [flag("buff", false)]).weigh).toBe("ไม่มี");
    expect(profileSummaryParts(defs, [flag("buff", false)]).weigh).not.toContain("ยกเว้น");
  });
  it("def exempt ที่ปิดใช้ (isActive=false) ไม่นับ -> ไม่โชว์ 'ยกเว้นขัด' ทั้งที่ขัดไม่อยู่ในทะเบียนแล้ว", () => {
    const defs = [
      { code: "cast", nameTh: "หล่อ", metalPresent: true },
      { code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true, isActive: false },
    ];
    expect(profileSummaryParts(defs, [flag("cast", true)]).weigh).toBe("ทุกขั้นที่มีโลหะ");
  });
  it("ชั่งขั้นที่ไม่มีโลหะเพิ่มด้วย (ข้อมูลหลุดจากแบบ) -> ไม่หลอกว่า 'ทุกขั้นที่มีโลหะ (ยกเว้นขัด)'", () => {
    const defs = [
      { code: "wax", nameTh: "เทียน", metalPresent: false },
      { code: "cast", nameTh: "หล่อ", metalPresent: true },
      { code: "gem_set", nameTh: "ฝังพลอย", metalPresent: true },
      { code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true },
    ];
    const w = profileSummaryParts(defs, [flag("cast", true), flag("wax", true), flag("buff", false)]).weigh;
    expect(w).not.toBe("ทุกขั้นที่มีโลหะ (ยกเว้นขัด)");
  });
  it("ป้ายตามลำดับใหม่: ชื่อขั้นที่ยกเว้นอ่านจากทะเบียน (ไม่ hardcode 'ขัด')", () => {
    const defs = [
      { code: "cast", nameTh: "หล่อ", metalPresent: true },
      { code: "gem_set", nameTh: "ฝังพลอย", metalPresent: true },
      { code: "buff2", nameTh: "ขัดละเอียด", metalPresent: true, goldWeighExempt: true },
    ];
    expect(profileSummaryParts(defs, [flag("cast", true), flag("gem_set", true)]).weigh).toBe("ทุกขั้นที่มีโลหะ (ยกเว้นขัดละเอียด)");
  });
});

describe("QA · analyzePicker/needsGoldAck — exempt ไม่ลดด่านขั้นอื่น", () => {
  const mk = (stages: { code: string; nameTh: string; metalPresent: boolean; goldWeighExempt?: boolean }[], weighCodes: string[], requireFinalWeight = true) => ({
    profile: {
      id: "p", name: "p", note: null, requireFinalWeight, isActive: true, seq: 1, isDefault: false, isDefaultGold: false, jobsOpen: 0,
      stages: weighCodes.map((c) => ({ stageCode: c, weigh: true, scrapQty: false, scrapWeight: false })),
    } as RecordProfile,
    stages,
  });
  const S = [
    { code: "finish", nameTh: "แต่ง", metalPresent: true },
    { code: "gem_set", nameTh: "ฝังพลอย", metalPresent: true },
    { code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true },
    { code: "plating", nameTh: "ชุบ", metalPresent: true },
  ];
  it("ทอง: ไม่ชั่งฝังพลอย -> เตือนเฉพาะ ฝังพลอย (ไม่ใช่ขัด)", () => {
    const m = mk(S, ["finish", "plating"]);
    expect(analyzePicker(m.profile, m.stages, "gold").goldUnguarded).toEqual(["ฝังพลอย"]);
    expect(needsGoldAck(m.profile, m.stages, "gold")).toBe(true);
  });
  it("ทอง: ชั่ง finish/gem_set/plating (ขัดไม่ชั่ง) -> ไม่ต้อง ack", () => {
    const m = mk(S, ["finish", "gem_set", "plating"]);
    expect(analyzePicker(m.profile, m.stages, "gold").goldUnguarded).toEqual([]);
    expect(needsGoldAck(m.profile, m.stages, "gold")).toBe(false);
  });
  it("ทอง: ขาด key goldWeighExempt จาก server (TS ใหม่ + DB ก่อน 0195) -> ขัดติดเตือนเหมือนเดิม (ไม่หลวมเอง)", () => {
    const noKey = S.map(({ goldWeighExempt: _g, ...r }) => r);
    const m = mk(noKey, ["finish", "gem_set", "plating"]);
    expect(analyzePicker(m.profile, m.stages, "gold").goldUnguarded).toEqual(["ขัด"]);
  });
  it("เงิน/โลหะไม่ระบุ: ไม่เตือนเลยแม้ไม่ชั่งสักขั้น", () => {
    const m = mk(S, []);
    expect(analyzePicker(m.profile, m.stages, "silver").goldUnguarded).toEqual([]);
    expect(analyzePicker(m.profile, m.stages, "").goldUnguarded).toEqual([]);
  });
});

describe("QA · DEPT_ORDER (0194) — หน้าตั้งค่าเรต", () => {
  it("แผนกที่ไม่รู้จัก (เช่น 'แต่ง' ที่ไม่มีในเรต) ต่อท้ายหลัง 'แพ็ก' · สองตัวที่ไม่รู้จักเรียง th · ชื่อเดียวกัน = 0", () => {
    expect(oemScopeSort("dept", "แต่ง", "แพ็ก")).toBeGreaterThan(0);
    expect(oemScopeSort("dept", "ขัด", "แต่ง")).toBeLessThan(0);
    expect(oemScopeSort("dept", "ขัด", "ขัด")).toBe(0);
    expect(["ฮ", "ก"].sort((a, b) => oemScopeSort("dept", a, b))).toEqual(["ก", "ฮ"]);
  });
  it("ลำดับอื่นของหน้าเรต (วัสดุ/ประเภทชิ้น) ไม่ถูกกระทบ: แหวน มาก่อน สร้อยคอ", () => {
    expect(oemScopeSort("item_kind", "แหวน", "สร้อยคอ")).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("QA · JobCreateDialog — ใบทอง ลำดับใหม่ แต่ง → ฝังพลอย → ขัด → ชุบ", () => {
  const ITEM = "11111111-1111-4111-8111-111111111111";
  const PG = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const PNO = "aaaaaaaa-0000-4000-8000-0000000000a2";
  const prof = (id: string, name: string, weighCodes: string[], o: Record<string, unknown> = {}) => ({
    id, name, note: null, requireFinalWeight: true, isActive: true, seq: 10, isDefault: false, isDefaultGold: true, jobsOpen: 0,
    stages: weighCodes.map((c) => ({ stageCode: c, weigh: true, scrapQty: true, scrapWeight: false })), ...o,
  });
  // server ส่งตามลำดับ seq_default ใหม่: gem_set (100) ก่อน buff (105)
  const stages = (withExemptKey: boolean) => [
    { code: "finish", nameTh: "แต่ง", defaultSelected: true, metalPresent: true },
    { code: "gem_set", nameTh: "ฝังพลอย", defaultSelected: true, metalPresent: true },
    { code: "buff", nameTh: "ขัด", defaultSelected: true, metalPresent: true, ...(withExemptKey ? { goldWeighExempt: true } : {}) },
    { code: "plating", nameTh: "ชุบ", defaultSelected: true, metalPresent: true },
  ];
  const suggestion = (o: Record<string, unknown>) => ({
    ok: true,
    data: { metal: "gold", qty: 5, designLabel: "แหวนทอง", depositMissing: false, existingJob: null, targetPieceG: null, targetPieceGSource: null, stages: stages(true), ...o },
  });
  const planOk = { ok: true, data: { qtyOrder: 5, qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 5, underPlanned: false, rejectBasis: { castPct: null, polishPct: null, platePct: null, hasPlating: false }, targetPieceG: null, targetPieceGSource: null, metal: "gold", metalPlanG: null, metalPlanBasis: null, missing: [] } };
  const open = async () => {
    wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนทอง × 5" onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId("qty-order");
  };
  const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
  const RED = "ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น";

  beforeEach(() => {
    vi.clearAllMocks();
    getJobPlanSuggest.mockResolvedValue(planOk);
    createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
  });

  it("แบบทองใหม่ (ชั่ง แต่ง/ฝังพลอย/ชุบ · ขัดไม่ชั่ง) -> ไม่มีกล่องแดง · ปุ่มสร้างเปิดโดยไม่ต้อง ack", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [prof(PG, "ทอง (ยกเว้นขัด)", ["finish", "gem_set", "plating"])], defaultProfileId: PG }));
    await open();
    expect(screen.queryByText(RED)).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("ห้ามผ่าน: แบบทองที่ไม่ชั่ง 'ฝังพลอย' -> กล่องแดงโผล่ + ระบุ ฝังพลอย · ไม่ระบุ ขัด · ปุ่มสร้างปิดจน ack", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [prof(PG, "ทองลืมฝังพลอย", ["finish", "plating"])], defaultProfileId: PG }));
    await open();
    const box = screen.getByText(RED).closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("ฝังพลอย");
    expect(box).not.toHaveTextContent("ขัด");
    expect(submitBtn()).toBeDisabled();
  });

  it("ห้ามผ่าน: แบบทองที่ไม่ชั่ง 'ชุบ' -> กล่องแดงระบุ ชุบ เท่านั้น (exempt ไม่รั่วไปขั้นถัดจากขัด)", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [prof(PG, "ทองลืมชุบ", ["finish", "gem_set"])], defaultProfileId: PG }));
    await open();
    const box = screen.getByText(RED).closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("ชุบ");
    expect(box).not.toHaveTextContent("ขัด");
    expect(box).not.toHaveTextContent("ฝังพลอย");
  });

  it("server ไม่ส่ง key gold_weigh_exempt (DB ยังไม่ apply 0195): ขัดติดเตือนเหมือนก่อน — fail-closed", async () => {
    suggestJob.mockResolvedValue(suggestion({ stages: stages(false), profiles: [prof(PG, "ทอง", ["finish", "gem_set", "plating"])], defaultProfileId: PG }));
    await open();
    const box = screen.getByText(RED).closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("ขัด");
  });

  it("เงิน + แบบไม่ชั่งเลย: ไม่มีกล่องแดงทั้งที่มีขั้นโลหะ (exempt ไม่เกี่ยวกับเงิน)", async () => {
    suggestJob.mockResolvedValue(suggestion({ metal: "silver", profiles: [prof(PNO, "ไม่ชั่ง", [], { requireFinalWeight: false, isDefaultGold: false, isDefault: true })], defaultProfileId: PNO }));
    await open();
    expect(screen.queryByText(RED)).not.toBeInTheDocument();
  });

  it("รายการติ๊กขั้น: ฝังพลอยอยู่ก่อนขัดบนจอ (ตามลำดับที่ server ส่ง) · ไม่ถูกเรียงกลับเป็นลำดับเก่า", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [prof(PG, "ทอง", ["finish", "gem_set", "plating"])], defaultProfileId: PG }));
    await open();
    const gem = screen.getByLabelText("ฝังพลอย");
    const buff = screen.getByLabelText("ขัด");
    const plating = screen.getByLabelText("ชุบ");
    expect(gem.compareDocumentPosition(buff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(buff.compareDocumentPosition(plating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("สร้างใบ: stageCodes ที่ส่งเรียงตามลำดับของ server (finish, gem_set, buff, plating)", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [prof(PG, "ทอง", ["finish", "gem_set", "plating"])], defaultProfileId: PG }));
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob.mock.calls[0][0].stageCodes).toEqual(["finish", "gem_set", "buff", "plating"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("QA · ProfilesClient — ตั้งค่าเริ่มงานทอง (SetDefaultDialog ใช้ goldUnguardedStages)", () => {
  const P1 = "11111111-1111-4111-8111-111111111111";
  const P2 = "22222222-2222-4222-8222-222222222222";
  const P3 = "33333333-3333-4333-8333-333333333333";
  const DEFS = [
    { code: "wax", nameTh: "เทียน", seq: 1, metalPresent: false, isActive: true },
    { code: "cast", nameTh: "หล่อ", seq: 2, metalPresent: true, isActive: true },
    { code: "gem_set", nameTh: "ฝังพลอย", seq: 3, metalPresent: true, isActive: true },
    { code: "buff", nameTh: "ขัด", seq: 4, metalPresent: true, isActive: true, goldWeighExempt: true },
  ];
  const prof = (o: Partial<RecordProfile> & { id: string; name: string }): RecordProfile => ({ note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: false, isDefaultGold: false, stages: [], jobsOpen: 0, ...o });
  const W = (c: string) => ({ stageCode: c, weigh: true, scrapQty: true, scrapWeight: false });
  const P_GEN = prof({ id: P1, name: "แบบทั่วไป", isDefault: true, stages: [W("cast")] });
  const P_GOLD_OK = prof({ id: P2, name: "ทองชั่งยกเว้นขัด", requireFinalWeight: true, stages: [W("cast"), W("gem_set")] });
  const P_GOLD_NOGEM = prof({ id: P3, name: "ทองไม่ชั่งฝังพลอย", requireFinalWeight: true, stages: [W("cast")] });
  const data = (): ProfilesData => ({ profiles: [P_GEN, P_GOLD_OK, P_GOLD_NOGEM], defaultProfileId: P1, defaultGoldProfileId: null, stageDefs: DEFS });

  beforeEach(() => {
    vi.clearAllMocks();
    profilesApi.listProfiles.mockResolvedValue({ ok: true, data: data() });
    profilesApi.setDefaultProfile.mockResolvedValue({ ok: true, data: { defaultProfileId: P1, defaultGoldProfileId: P2 } });
  });

  const openGoldDialog = async (name: RegExp) => {
    wrap(<ProfilesClient />);
    await userEvent.click(await screen.findByRole("button", { name }));
    const form = await screen.findByRole("form");
    await userEvent.click(within(form).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทอง" }));
    return await screen.findByRole("dialog");
  };

  it("แบบที่ชั่ง หล่อ+ฝังพลอย (ขัดไม่ชั่ง ซึ่ง exempt) -> ไม่มีกล่องแดงตอนตั้งเป็นค่าเริ่มทอง", async () => {
    const dlg = await openGoldDialog(/ทองชั่งยกเว้นขัด/);
    expect(within(dlg).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ห้ามผ่าน: แบบที่ไม่ชั่งฝังพลอย -> กล่องแดงบอก ฝังพลอย · ไม่บอก ขัด", async () => {
    const dlg = await openGoldDialog(/ทองไม่ชั่งฝังพลอย/);
    const alert = within(dlg).getByRole("alert");
    expect(alert).toHaveTextContent("ฝังพลอย");
    expect(alert).not.toHaveTextContent("ขัด");
  });
});
