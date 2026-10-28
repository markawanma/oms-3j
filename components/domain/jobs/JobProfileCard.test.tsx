// @vitest-environment jsdom
// 0176 หน้ารายละเอียดใบงาน: การ์ดแบบการบันทึก · เปลี่ยนแบบ · ป้ายต่อขั้น · event profile_set · DoneDialog น้ำหนักสุทธิ
// ต้องไม่พัง: ใบเดิม (ไม่มีแบบ) = "กติกาเดิม" · ป้าย "ต้องชั่ง" เดิม · DoneDialog ทองบังคับน้ำหนักสุทธิเหมือนเดิม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/jobs" }));
// 0182: JobDetailClient render การ์ดรูปงาน (JobPhotosCard) ซึ่ง import action รูป — mock เหมือน action อื่นของหน้า (เทสต์นี้ไม่ทดสอบรูป: ดู JobPhotosCard.test.tsx)
vi.mock("@/lib/actions/job-photos", () => ({ getJobPhotos: vi.fn(), uploadJobPhoto: vi.fn(), removeJobPhoto: vi.fn(), setPrimaryJobPhoto: vi.fn(), reorderJobPhotos: vi.fn(), pullJobPhotoFromCatalog: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const w = { doneJob: vi.fn() };
vi.mock("@/lib/actions/job-office-write", () => ({
  doneJob: (...a: unknown[]) => w.doneJob(...a),
  setJobSurplus: vi.fn(), setJobQtyPlanned: vi.fn(), setJobPlan: vi.fn(), cancelJob: vi.fn(), reopenJobStage: vi.fn(), setJobDesignLabel: vi.fn(),
  setJobDue: vi.fn(), setJobStartGateNote: vi.fn(), skipJobStage: vi.fn(), officeReceiveStage: vi.fn(), officeSendStage: vi.fn(), issueJobQr: vi.fn(),
}));
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: vi.fn() }));
const listProfiles = vi.fn();
const changeJobProfile = vi.fn();
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: (...a: unknown[]) => listProfiles(...a), changeJobProfile: (...a: unknown[]) => changeJobProfile(...a) }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobDetailClient } from "./JobDetailClient";
import { DoneDialog } from "./JobDialogs";
import { mapBoardRow, mapJobDetail, summarizeEvent, mapEventRow } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import type { JobDetailData } from "@/lib/actions/job-office";
import type { ProfilesData, RecordProfile } from "@/lib/jobs/profile";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const PA = "aaaaaaaa-0000-4000-8000-000000000001";
const PB = "aaaaaaaa-0000-4000-8000-000000000002";

const stage = (code: string, seq: number, status: string, o: Partial<StageRow> = {}): StageRow => ({
  id: `s-${code}`, seq, code, name: ({ wax: "เทียน", cast: "หล่อ", file: "ตะไบ", qc: "ตรวจ QC", pack: "แพ็ก" } as Record<string, string>)[code] ?? code, status,
  weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: code !== "wax", receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null, ...o,
});
// แบบ 1: ชั่งเฉพาะหล่อ + ชิ้นเสียหล่อ · ตะไบ/QC ไม่ถามอะไร (scrapQtyAsk false)
const PROFILED = [
  stage("cast", 1, "pending", { weighRequired: true, scrapQtyAsk: true }),
  stage("file", 2, "pending", { weighRequired: false, scrapQtyAsk: false }),
  stage("qc", 3, "pending", { weighRequired: false, scrapQtyAsk: false }),
];
const LEGACY = [stage("cast", 1, "pending", { weighRequired: true }), stage("qc", 2, "pending"), stage("pack", 3, "pending")];

function detail(job: Record<string, unknown> = {}, stages: StageRow[] = PROFILED, boardOver: Record<string, unknown> = {}, events: JobDetailData["events"] = []): JobDetailData {
  const base = { id: JOB, job_no: "JB-0100", source_kind: "production", design_label: "แหวนลาย A", sku_snapshot: null, metal: "silver", qty_planned: 30, qty_order: 30, status: "open", profile_id: PA, profile_name: "แบบ 1", require_final_weight: false, weigh_required: true, ...job };
  const board = { id: JOB, job_no: "JB-0100", seq: 100, source_kind: "production", metal: base.metal, qty_planned: 30, qty_order: 30, status: base.status, ...boardOver };
  return { job: mapJobDetail(base)!, board: mapBoardRow(board), stages, loss: {}, events, eventsTruncated: false, activeTokens: 0, workers: [], source: null, todayTh: "2026-10-15" };
}

const prof = (id: string, name: string, stages: { stageCode: string; weigh?: boolean; scrapQty?: boolean; scrapWeight?: boolean }[], o: Partial<RecordProfile> = {}): RecordProfile => ({
  id, name, note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: false, isDefaultGold: false, jobsOpen: 0,
  stages: stages.map((s) => ({ stageCode: s.stageCode, weigh: !!s.weigh, scrapQty: !!s.scrapQty, scrapWeight: !!s.scrapWeight })), ...o,
});
const LIST: ProfilesData = {
  profiles: [prof(PA, "แบบ 1", [{ stageCode: "cast", weigh: true, scrapQty: true }], { isDefault: true }), prof(PB, "ไม่ชั่ง", []), prof("aaaaaaaa-0000-4000-8000-000000000003", "แบบปิดแล้ว", [], { isActive: false })],
  defaultProfileId: PA, defaultGoldProfileId: null,
  stageDefs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  w.doneJob.mockResolvedValue({ ok: true, data: null });
  listProfiles.mockResolvedValue({ ok: true, data: LIST });
  changeJobProfile.mockResolvedValue({ ok: true, data: { profileId: PB, profileName: "ไม่ชั่ง" } });
});

const card = () => screen.getByRole("region", { name: /แบบการบันทึก|กติกาเดิม/ });

describe("0176 JobProfileCard", () => {
  it("ใบที่มีแบบ: ชื่อแบบ + สรุปจาก snapshot ของขั้น + ข้อความ 'แก้แบบทีหลังไม่กระทบใบนี้'", () => {
    wrap(<JobDetailClient data={detail()} />);
    const c = within(card());
    expect(c.getByRole("heading", { name: "แบบการบันทึก: แบบ 1" })).toBeInTheDocument();
    expect(c.getByText(/ชั่ง: หล่อ \/ ชิ้นเสีย: หล่อ \/ เศษ: ไม่มี/)).toBeInTheDocument();
    expect(c.getByText(/ตามที่ตั้งไว้ตอนสร้างใบ — แก้แบบทีหลังไม่กระทบใบนี้/)).toBeInTheDocument();
    expect(c.getByRole("button", { name: "เปลี่ยนแบบ" })).not.toHaveAttribute("aria-disabled");
  });

  it("ใบเดิม (ไม่มีแบบ): 'กติกาเดิม (ก่อนมีแบบการบันทึก)' + สรุปจากขั้นของใบ · ป้ายขั้น 'ต้องชั่ง' เดิม ไม่มีชิป ชั่ง/ชิ้นเสีย · เปลี่ยนแบบได้ถ้ายังไม่เริ่ม", () => {
    wrap(<JobDetailClient data={detail({ profile_id: null, profile_name: null }, LEGACY)} />);
    const c = within(card());
    expect(c.getByRole("heading", { name: "กติกาเดิม (ก่อนมีแบบการบันทึก)" })).toBeInTheDocument();
    expect(c.getByText(/ใบนี้สร้างก่อนมีแบบการบันทึก/)).toBeInTheDocument();
    expect(screen.getByText("ต้องชั่ง")).toBeInTheDocument();
    expect(screen.queryByText("ชิ้นเสีย", { selector: "span" })).not.toBeInTheDocument();
    expect(c.getByRole("button", { name: "เปลี่ยนแบบ" })).not.toHaveAttribute("aria-disabled");
  });

  it("ป้ายต่อขั้น (ใบที่มีแบบ): ชั่ง / ชิ้นเสีย ตาม snapshot · ขั้นที่ไม่ถามอะไรไม่มีป้าย · ไม่มีป้าย 'ต้องชั่ง' เก่า", () => {
    wrap(<JobDetailClient data={detail()} />);
    const items = screen.getAllByRole("listitem").filter((li) => /^\d\. /.test(li.textContent ?? ""));
    expect(within(items[0]).getByText("ชั่ง")).toBeInTheDocument();
    expect(within(items[0]).getByText("ชิ้นเสีย")).toBeInTheDocument();
    expect(within(items[1]).queryByText("ชิ้นเสีย")).not.toBeInTheDocument();
    expect(within(items[1]).queryByText("ชั่ง")).not.toBeInTheDocument();
    expect(screen.queryByText("ต้องชั่ง")).not.toBeInTheDocument();
  });

  it("ใบทอง: ขั้นโลหะอยู่ในมือแต่ไม่ชั่ง = ป้ายแดง 'ไม่ชั่ง' ต่อขั้น (2) + ป้ายหัว 'ทอง · ไม่มีด่านชั่ง' ตัวเดียว (ไม่ซ้ำในการ์ดแบบ) · เงินไม่มี", () => {
    wrap(<JobDetailClient data={detail({ metal: "gold" }, PROFILED, { metal: "gold", gold_unguarded: true })} />);
    expect(screen.getAllByText("ไม่ชั่ง")).toHaveLength(2);
    expect(screen.getAllByText(/ทอง · ไม่มีด่านชั่ง/)).toHaveLength(1);
    expect(within(card()).queryByText(/ทอง · ไม่มีด่านชั่ง/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("สถานะที่ต้องดู")).toContainElement(screen.getByText("ทอง · ไม่มีด่านชั่ง"));
    cleanup();
    wrap(<JobDetailClient data={detail({ metal: "silver" })} />);
    expect(screen.queryByText("ไม่ชั่ง")).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่มีด่านชั่ง/)).not.toBeInTheDocument();
  });

  it("ใบทองที่ขั้นโลหะชั่งครบ / ขั้นไม่มีโลหะ (เทียน) ไม่ชั่ง = ไม่มีแถบแดง", () => {
    const st = [stage("wax", 1, "pending", { scrapQtyAsk: false }), stage("cast", 2, "pending", { weighRequired: true })];
    wrap(<JobDetailClient data={detail({ metal: "gold" }, st)} />);
    expect(screen.queryByText(/ไม่มีด่านชั่ง/)).not.toBeInTheDocument();
    expect(screen.queryByText("ไม่ชั่ง")).not.toBeInTheDocument();
  });

  it("ใบทองที่ปิดแล้ว: ไม่ขึ้นแถบแดง (ไม่มีอะไรให้ทำแล้ว) · ไม่มีปุ่มเปลี่ยนแบบ (อ่านอย่างเดียว)", () => {
    wrap(<JobDetailClient data={detail({ metal: "gold", status: "done" }, PROFILED, { status: "done" })} />);
    expect(screen.queryByText(/ไม่มีด่านชั่ง/)).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "เปลี่ยนแบบ" })).not.toBeInTheDocument();
  });

  it.each(["done", "cancelled"])("ใบ %s: ไม่มีปุ่มเปลี่ยนแบบ", (status) => {
    wrap(<JobDetailClient data={detail({ status }, PROFILED, { status })} />);
    expect(within(card()).queryByRole("button", { name: "เปลี่ยนแบบ" })).not.toBeInTheDocument();
  });

  it("🔴 ใบที่เคยรับงานแล้วย้อนขั้นจนทุกขั้นกลับเป็น pending (มี event stage_receive) = ถือว่าเริ่มแล้ว: ปุ่มเปลี่ยนแบบ aria-disabled ตรงกับ DB L1", async () => {
    const ev = [{ id: "e1", type: "stage_receive", occurredOn: "2026-10-14", recordedAt: "2026-10-14T03:00:00Z", channel: "worker_qr", workerName: "ช่างเอ", stageCode: "cast", summary: null }];
    wrap(<JobDetailClient data={detail({}, PROFILED, {}, ev)} />);
    const btn = within(card()).getByRole("button", { name: "เปลี่ยนแบบ" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("event อื่น (ไม่ใช่ stage_receive) ไม่ล็อก", () => {
    const ev = [{ id: "e1", type: "due_set", occurredOn: "2026-10-14", recordedAt: "2026-10-14T03:00:00Z", channel: "job_page", workerName: null, stageCode: null, summary: null }];
    wrap(<JobDetailClient data={detail({}, PROFILED, {}, ev)} />);
    expect(within(card()).getByRole("button", { name: "เปลี่ยนแบบ" })).not.toHaveAttribute("aria-disabled");
  });

  it("เริ่มแล้ว (ช่างรับขั้นแรก): ปุ่ม aria-disabled + ข้อความเห็นได้ผูก aria-describedby · กดแล้วไม่เปิดกล่อง", async () => {
    const st = [stage("cast", 1, "received", { weighRequired: true }), stage("file", 2, "pending"), stage("qc", 3, "pending")];
    wrap(<JobDetailClient data={detail({ status: "in_progress" }, st)} />);
    const btn = within(card()).getByRole("button", { name: "เปลี่ยนแบบ" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAccessibleDescription("เปลี่ยนได้ก่อนช่างรับงานขั้นแรก — ใบนี้เริ่มแล้ว");
    expect(within(card()).getByText("เปลี่ยนได้ก่อนช่างรับงานขั้นแรก — ใบนี้เริ่มแล้ว")).toBeVisible();
    await userEvent.click(btn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listProfiles).not.toHaveBeenCalled();
  });
});

describe("0176 ChangeProfileDialog", () => {
  const open = async (data = detail()) => {
    wrap(<JobDetailClient data={data} />);
    await userEvent.click(within(card()).getByRole("button", { name: "เปลี่ยนแบบ" }));
    return await screen.findByRole("dialog", { name: "เปลี่ยนแบบการบันทึก" });
  };

  it("โหลดรายการ (loading → พร้อม) · เลือกแบบปัจจุบันไว้ · แบบที่ปิดใช้ไม่อยู่ในรายการ · ปุ่มเปลี่ยนปิดจนเลือกแบบอื่น", async () => {
    let release: (v: unknown) => void = () => undefined;
    listProfiles.mockReturnValue(new Promise((r) => { release = r; }));
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "เปลี่ยนแบบ" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("status", { name: "กำลังโหลดแบบการบันทึก" })).toBeInTheDocument();
    release({ ok: true, data: LIST });
    const select = (await within(dlg).findByLabelText(/^แบบการบันทึก \(ช่าง/)) as HTMLSelectElement;
    expect(select.value).toBe(PA);
    expect(within(select).queryByRole("option", { name: "แบบปิดแล้ว" })).not.toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" })).toBeDisabled();
    await userEvent.selectOptions(select, PB);
    expect(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" })).toBeEnabled();
  });

  it("ใบเดิม: placeholder 'เลือกแบบ…' (ไม่เดาแบบให้) · เลือกแล้วส่ง changeJobProfile(jobId, id) + toast + refresh + ปิดกล่อง", async () => {
    const dlg = await open(detail({ profile_id: null, profile_name: null }, LEGACY));
    const select = (await within(dlg).findByLabelText(/^แบบการบันทึก \(ช่าง/)) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByRole("option", { name: "เลือกแบบ…" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" })).toBeDisabled();
    await userEvent.selectOptions(select, PB);
    await userEvent.click(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" }));
    await waitFor(() => expect(changeJobProfile).toHaveBeenCalledWith(JOB, PB));
    expect(await screen.findByText("เปลี่ยนเป็น “ไม่ชั่ง” แล้ว")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("started (ช่างรับไปแล้วระหว่างเปิดกล่อง): ข้อความ DB ค้างในกล่อง + refresh หน้า · ไม่ปิดกล่อง", async () => {
    changeJobProfile.mockResolvedValue({ ok: false, error: "เปลี่ยนแบบการบันทึกได้เฉพาะก่อนช่างรับงานขั้นแรก", code: "started" });
    const dlg = await open();
    await userEvent.selectOptions(await within(dlg).findByLabelText(/^แบบการบันทึก \(ช่าง/), PB);
    await userEvent.click(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("เปลี่ยนแบบการบันทึกได้เฉพาะก่อนช่างรับงานขั้นแรก");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("โหลดรายการล้ม: ข้อความ + ลองใหม่ ได้", async () => {
    listProfiles.mockResolvedValueOnce({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานระบบใบงานได้" }).mockResolvedValue({ ok: true, data: LIST });
    wrap(<JobDetailClient data={detail()} />);
    await userEvent.click(within(card()).getByRole("button", { name: "เปลี่ยนแบบ" }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("เฉพาะเจ้าของร้าน/แอดมิน");
    await userEvent.click(within(dlg).getByRole("button", { name: "ลองใหม่" }));
    expect(await within(dlg).findByLabelText(/^แบบการบันทึก \(ช่าง/)).toBeInTheDocument();
  });

  it("ใบทอง: เปลี่ยนเป็นแบบที่ขั้นโลหะไม่ชั่ง = กล่องแดง + ต้องติ๊กรับทราบก่อนปุ่มเปิด · ขั้นที่ข้ามไม่นับ", async () => {
    const st = [stage("cast", 1, "pending", { weighRequired: true }), stage("file", 2, "skipped"), stage("qc", 3, "pending")];
    const dlg = await open(detail({ metal: "gold" }, st));
    await userEvent.selectOptions(await within(dlg).findByLabelText(/^แบบการบันทึก \(ช่าง/), PB);
    const box = within(dlg).getByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น").closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("หล่อ, ตรวจ QC");
    expect(box).not.toHaveTextContent("ตะไบ");
    expect(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" })).toBeDisabled();
    await userEvent.click(within(box).getByLabelText(/รับทราบ/));
    expect(within(dlg).getByRole("button", { name: "เปลี่ยนแบบ" })).toBeEnabled();
  });
});

describe("0176 event profile_set + DoneDialog", () => {
  it("summarizeEvent profile_set: before → after · ใบเดิม (ไม่มีแบบ) = 'กติกาเดิม' · ไม่ dump payload", () => {
    expect(summarizeEvent("profile_set", { before: { profile_name: null, stages: [{ x: 1 }] }, after: { profile_name: "แบบ 1" } })).toBe("กติกาเดิม → แบบ 1");
    expect(summarizeEvent("profile_set", { before: { profile_name: "แบบ 1" }, after: { profile_name: "ไม่ชั่ง" } })).toBe("แบบ 1 → ไม่ชั่ง");
    expect(summarizeEvent("profile_set", null)).toBe("กติกาเดิม → กติกาเดิม");
    const e = mapEventRow({ id: "e1", event_type: "profile_set", payload: { before: { profile_name: null }, after: { profile_name: "แบบ 1" } }, channel: "job_page" }, {}, {});
    expect(e).toMatchObject({ type: "profile_set", summary: "กติกาเดิม → แบบ 1" });
  });

  it("หน้าใบงานแสดงเหตุการณ์ 'เปลี่ยนแบบการบันทึก' พร้อมสรุป", () => {
    const ev = [{ id: "e1", type: "profile_set", occurredOn: "2026-10-15", recordedAt: "2026-10-15T03:00:00Z", channel: "job_page", workerName: null, stageCode: null, summary: "กติกาเดิม → แบบ 1" }];
    wrap(<JobDetailClient data={detail({}, PROFILED, {}, ev)} />);
    expect(screen.getByText("เปลี่ยนแบบการบันทึก", { selector: "li *" })).toBeInTheDocument();
    expect(screen.getByText(/กติกาเดิม → แบบ 1/)).toBeInTheDocument();
  });

  const dlg = (p: Partial<{ metal: string; requireFinalWeight: boolean; weighRequired: boolean }> = {}) =>
    wrap(<DoneDialog jobId={JOB} planned={30} qtyOrder={30} sourceKind="production" metal={p.metal ?? "silver"} requireFinalWeight={p.requireFinalWeight} weighRequired={p.weighRequired} onClose={vi.fn()} />);
  const closeBtn = () => screen.getByRole("button", { name: "ปิดงาน" });

  it("ทอง + มีขั้นชั่ง: บังคับน้ำหนักสุทธิ (ปุ่มปิดจนกรอก · label 'งานทองต้องใส่')", async () => {
    dlg({ metal: "gold", requireFinalWeight: false, weighRequired: true });
    expect(screen.getByLabelText(/น้ำหนักสุทธิ.*งานทองต้องใส่/)).toBeInTheDocument();
    expect(closeBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/น้ำหนักสุทธิ/), "12.5");
    expect(closeBtn()).toBeEnabled();
  });

  it("ทอง + แบบไม่ชั่งเลย + ไม่บังคับ: ไม่บังคับน้ำหนักสุทธิ (ปิดได้เลย)", () => {
    dlg({ metal: "gold", requireFinalWeight: false, weighRequired: false });
    expect(screen.getByLabelText(/น้ำหนักสุทธิ.*ไม่บังคับ/)).toBeInTheDocument();
    expect(closeBtn()).toBeEnabled();
  });

  it("ทอง + แบบไม่ชั่งแต่ติ๊ก 'บังคับน้ำหนักสุทธิ' = บังคับ · เงิน + บังคับ = บังคับ (label แบบการบันทึกนี้บังคับ)", async () => {
    dlg({ metal: "gold", requireFinalWeight: true, weighRequired: false });
    expect(closeBtn()).toBeDisabled();
    cleanup();
    dlg({ metal: "silver", requireFinalWeight: true, weighRequired: false });
    expect(screen.getByLabelText(/น้ำหนักสุทธิ.*แบบการบันทึกนี้บังคับ/)).toBeInTheDocument();
    expect(closeBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/น้ำหนักสุทธิ/), "10");
    expect(closeBtn()).toBeEnabled();
  });

  it("เงิน + ไม่บังคับ = ไม่บังคับ แม้มีขั้นชั่ง", () => {
    dlg({ metal: "silver", requireFinalWeight: false, weighRequired: true });
    expect(closeBtn()).toBeEnabled();
  });

  it("ผู้เรียกเก่า (ไม่ส่ง flag แบบ) = กติกา J1 เดิม: ทองบังคับ · เงินไม่บังคับ", () => {
    dlg({ metal: "gold" });
    expect(closeBtn()).toBeDisabled();
    cleanup();
    dlg({ metal: "silver" });
    expect(closeBtn()).toBeEnabled();
  });

  it("🔴 ค่าเริ่มชิ้นเสีย: เสีย = ของเสียที่ช่างแจ้งในขั้น · ดี = เริ่มผลิต − เสีย · บรรทัด 'ของเสียที่บันทึกในขั้น: 5 ชิ้น' · ส่ง doneJob ด้วยค่านั้น", async () => {
    wrap(<DoneDialog jobId={JOB} planned={35} qtyOrder={30} sourceKind="production" metal="silver" recordedScrap={5} onClose={vi.fn()} />);
    expect((screen.getByLabelText("จำนวนดี (ชิ้น)") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("จำนวนเสีย (ชิ้น)") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("ของเสียที่บันทึกในขั้น: 5 ชิ้น")).toBeInTheDocument();
    // ดี 30 = สั่ง 30 → ไม่มี "ของเหลือ" ผิดๆ (เดิมเสนอ ดี 35 → ของเหลือ 5)
    expect(screen.queryByText(/ของเหลือ/)).not.toBeInTheDocument();
    await userEvent.click(closeBtn());
    await waitFor(() => expect(w.doneJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB, qtyGood: 30, qtyScrap: 5 })));
  });

  it("ไม่มีของเสียที่บันทึก = ค่าเริ่มเดิม (ดี = เริ่มผลิต · เสีย 0 · ไม่มีบรรทัด) · ผู้ใช้แก้ได้ · ผลรวมผิด = ปุ่มปิด", async () => {
    wrap(<DoneDialog jobId={JOB} planned={30} qtyOrder={30} sourceKind="production" metal="silver" onClose={vi.fn()} />);
    expect((screen.getByLabelText("จำนวนดี (ชิ้น)") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("จำนวนเสีย (ชิ้น)") as HTMLInputElement).value).toBe("0");
    expect(screen.queryByText(/ของเสียที่บันทึกในขั้น/)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("จำนวนเสีย (ชิ้น)"));
    await userEvent.type(screen.getByLabelText("จำนวนเสีย (ชิ้น)"), "2");
    expect(closeBtn()).toBeDisabled();
  });

  it("ของเสียที่บันทึกเกินเริ่มผลิต (ข้อมูลแปลก) = ไม่ติดลบ: เสียไม่เกินเริ่มผลิต · ดี ≥ 0 · ค่าไม่ใช่จำนวนเต็ม/ติดลบ = เมินเป็น 0", () => {
    wrap(<DoneDialog jobId={JOB} planned={10} qtyOrder={10} sourceKind="production" metal="silver" recordedScrap={99} onClose={vi.fn()} />);
    expect((screen.getByLabelText("จำนวนดี (ชิ้น)") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("จำนวนเสีย (ชิ้น)") as HTMLInputElement).value).toBe("10");
    cleanup();
    for (const bad of [-3, 1.5, Number.NaN]) {
      wrap(<DoneDialog jobId={JOB} planned={10} qtyOrder={10} sourceKind="production" metal="silver" recordedScrap={bad} onClose={vi.fn()} />);
      expect((screen.getByLabelText("จำนวนดี (ชิ้น)") as HTMLInputElement).value).toBe("10");
      cleanup();
    }
  });

  it("หน้าใบงาน: ผลรวม qty_scrap ของทุกขั้นเป็นค่าเริ่ม (ขั้นหล่อเสีย 3 + ขั้นขัดเสีย 2 = 5 → ดี = เริ่มผลิต − 5)", async () => {
    const st = [stage("cast", 1, "sent", { qtyScrap: 3 }), stage("file", 2, "sent", { qtyScrap: 2 }), stage("qc", 3, "skipped")];
    wrap(<JobDetailClient data={detail({ status: "in_progress", qty_planned: 35, qty_order: 30 }, st)} />);
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    const d = await screen.findByRole("dialog");
    expect((within(d).getByLabelText("จำนวนดี (ชิ้น)") as HTMLInputElement).value).toBe("30");
    expect((within(d).getByLabelText("จำนวนเสีย (ชิ้น)") as HTMLInputElement).value).toBe("5");
    expect(within(d).getByText("ของเสียที่บันทึกในขั้น: 5 ชิ้น")).toBeInTheDocument();
  });

  it("หน้าใบงาน: ส่ง flag ของใบเข้า DoneDialog (ใบทองที่แบบไม่ชั่ง ปิดงานได้โดยไม่ต้องกรอกน้ำหนักสุทธิ)", async () => {
    const done = [stage("cast", 1, "sent"), stage("qc", 2, "skipped")];
    wrap(<JobDetailClient data={detail({ metal: "gold", weigh_required: false, require_final_weight: false, status: "in_progress" }, done)} />);
    await userEvent.click(screen.getByRole("button", { name: "ปิดงาน" }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByRole("button", { name: "ปิดงาน" })).toBeEnabled();
  });
});
