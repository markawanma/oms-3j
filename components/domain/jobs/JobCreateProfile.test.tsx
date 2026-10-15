// @vitest-environment jsdom
// 0176 ฟอร์มสร้างใบงาน — ProfilePicker: ค่าเริ่ม · พรีวิวตามขั้นที่ติ๊ก · เตือนเทา/เหลือง/แดงทอง (ack) · ไม่มีแบบ = สร้างไม่ได้ · profile_invalid
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

import { ToastProvider } from "@/components/ui/Toast";
import { JobCreateDialog } from "./JobCreateDialog";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const ITEM = "11111111-1111-4111-8111-111111111111";
const PA = "aaaaaaaa-0000-4000-8000-000000000001";
const PB = "aaaaaaaa-0000-4000-8000-000000000002";
const PC = "aaaaaaaa-0000-4000-8000-000000000003";

const prof = (id: string, name: string, stages: { stageCode: string; weigh?: boolean; scrapQty?: boolean; scrapWeight?: boolean }[], o: Record<string, unknown> = {}) => ({
  id, name, note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: false, isDefaultGold: false, jobsOpen: 0,
  stages: stages.map((s) => ({ stageCode: s.stageCode, weigh: !!s.weigh, scrapQty: !!s.scrapQty, scrapWeight: !!s.scrapWeight })), ...o,
});
// แบบ 1 = ชั่งเฉพาะหล่อ (ค่าเริ่ม) · ไม่ชั่ง · ทอง = ชั่งหล่อ+ขัด (ไม่ชั่งตะไบ)
const P_ONE = prof(PA, "แบบ 1", [{ stageCode: "cast", weigh: true, scrapQty: true }]);
const P_NONE = prof(PB, "ไม่ชั่ง", []);
const P_GOLDISH = prof(PC, "ทองชั่งครบ", [{ stageCode: "cast", weigh: true, scrapQty: true }, { stageCode: "polish", weigh: true, scrapQty: true }, { stageCode: "file", weigh: true }], { requireFinalWeight: true });
const STAGES = [
  { code: "wax", nameTh: "เทียน", defaultSelected: false, metalPresent: false },
  { code: "cast", nameTh: "หล่อ", defaultSelected: true, metalPresent: true },
  { code: "file", nameTh: "ตะไบ", defaultSelected: false, metalPresent: true },
  { code: "polish", nameTh: "ขัด", defaultSelected: true, metalPresent: true },
];
const suggestion = (o: Record<string, unknown> = {}) => ({
  ok: true,
  data: { metal: "silver", qty: 30, designLabel: "แหวนลาย A", depositMissing: false, existingJob: null, stages: STAGES, targetPieceG: null, targetPieceGSource: null, profiles: [P_ONE, P_NONE, P_GOLDISH], defaultProfileId: PA, ...o },
});
const planOk = { ok: true, data: { qtyOrder: 30, qtyPlannedSuggest: null, bufferQty: null, qtyPlannedEff: 30, underPlanned: false, rejectBasis: { castPct: null, polishPct: null, platePct: null, hasPlating: false }, targetPieceG: null, targetPieceGSource: null, metal: "silver", metalPlanG: null, metalPlanBasis: null, missing: [] } };

async function open() {
  wrap(<JobCreateDialog kind="oem" itemId={ITEM} itemLabel="แหวนลาย A × 30" onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByLabelText(/เริ่มผลิต/);
}
const submitBtn = () => screen.getAllByRole("button", { name: "สร้างใบงาน" }).at(-1)!;
const select = () => screen.getByLabelText(/แบบการบันทึก/) as HTMLSelectElement;
const dl = () => screen.getByLabelText("สิ่งที่ช่างต้องทำในใบนี้");

beforeEach(() => {
  vi.clearAllMocks();
  suggestJob.mockResolvedValue(suggestion());
  getJobPlanSuggest.mockResolvedValue(planOk);
  createJob.mockResolvedValue({ ok: true, data: { jobId: "J9", jobNo: "JB-0009", planMissing: [] } });
});

describe("0176 ProfilePicker ในฟอร์มสร้างใบงาน", () => {
  it("select ขึ้นหลังขั้นตอน · ตัวที่เป็นค่าเริ่มต่อท้าย ' (ค่าเริ่ม)' และถูกเลือกไว้ · มีลิงก์จัดการแบบ (แท็บใหม่ noopener)", async () => {
    await open();
    expect(select().value).toBe(PA);
    expect(within(select()).getByRole("option", { name: "แบบ 1 (ค่าเริ่ม)" })).toBeInTheDocument();
    expect(within(select()).getByRole("option", { name: "ไม่ชั่ง" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /จัดการแบบ/ });
    expect(link).toHaveAttribute("href", "/jobs/profiles");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // ลำดับ: ขั้นตอน → แบบการบันทึก → ชื่อเรียกภายใน
    const order = [screen.getByText("ขั้นตอน (ติ๊กที่ต้องผ่าน)"), select(), screen.getByLabelText(/ชื่อเรียกภายใน/)];
    for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("พรีวิวเฉพาะขั้นที่ติ๊ก: แบบ 1 + (หล่อ,ขัด) = ชั่ง หล่อ · ชิ้นเสีย หล่อ · เศษ ไม่มี · ไม่บังคับน้ำหนักสุทธิ · ติ๊กตะไบเพิ่มไม่เปลี่ยน (แบบไม่ได้ตั้ง)", async () => {
    await open();
    const d = within(dl());
    expect(d.getByText("ชั่งน้ำหนัก").nextElementSibling).toHaveTextContent("หล่อ");
    expect(d.getByText("ชิ้นเสีย").nextElementSibling).toHaveTextContent("หล่อ");
    expect(d.getByText("เศษโลหะ").nextElementSibling).toHaveTextContent("ไม่มี");
    expect(d.getByText("ปิดงาน").nextElementSibling).toHaveTextContent("ไม่บังคับน้ำหนักสุทธิ");
    await userEvent.click(screen.getByLabelText("ตะไบ"));
    expect(d.getByText("ชั่งน้ำหนัก").nextElementSibling).toHaveTextContent(/^หล่อ$/);
  });

  it("เปลี่ยนเป็นแบบทองชั่งครบ: พรีวิวตามขั้นที่ติ๊ก · ตะไบถูกเพิ่มเมื่อติ๊ก · บังคับน้ำหนักสุทธิ", async () => {
    await open();
    await userEvent.selectOptions(select(), PC);
    const d = within(dl());
    expect(d.getByText("ชั่งน้ำหนัก").nextElementSibling).toHaveTextContent("หล่อ, ขัด");
    expect(d.getByText("ปิดงาน").nextElementSibling).toHaveTextContent("บังคับใส่น้ำหนักสุทธิ");
    await userEvent.click(screen.getByLabelText("ตะไบ"));
    expect(d.getByText("ชั่งน้ำหนัก").nextElementSibling).toHaveTextContent("หล่อ, ตะไบ, ขัด");
  });

  it("เทา: แบบตั้งชั่งที่ 'ตะไบ' แต่ใบนี้ไม่ผ่านขั้นนั้น — ข้ามไป (ไม่ใช่คำเตือนบล็อก)", async () => {
    await open();
    await userEvent.selectOptions(select(), PC);
    expect(screen.getByText(/แบบนี้ตั้งชั่งที่ ‘ตะไบ’ แต่ใบนี้ไม่ผ่านขั้นนั้น — ข้ามไป/)).toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(screen.getByLabelText("ตะไบ"));
    expect(screen.queryByText(/แต่ใบนี้ไม่ผ่านขั้นนั้น/)).not.toBeInTheDocument();
  });

  it("เหลือง: แบบที่มีขั้นชั่งแต่ขั้นที่เลือกไม่มีขั้นไหนชั่งเลย · แบบไม่ชั่งเลย (ไม่ใช่ทอง) ไม่เตือน · ยังสร้างได้", async () => {
    await open();
    await userEvent.click(screen.getByLabelText("หล่อ")); // เหลือแต่ ขัด → แบบ 1 ชั่งเฉพาะหล่อ
    expect(await screen.findByText(/แบบนี้ตั้งให้ชั่ง แต่ขั้นที่เลือกไม่มีขั้นไหนที่ชั่งเลย/)).toHaveAttribute("role", "status");
    await userEvent.selectOptions(select(), PB);
    expect(screen.queryByText(/แบบนี้ตั้งให้ชั่ง แต่ขั้นที่เลือกไม่มีขั้นไหนที่ชั่งเลย/)).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("สร้าง: ส่ง profileId ที่เลือก (ค่าเริ่ม = ส่งด้วย ไม่เดา)", async () => {
    await open();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ profileId: PA }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/J9"));
    createJob.mockClear();
    cleanup();
    await open();
    await userEvent.selectOptions(select(), PB);
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(submitBtn());
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ profileId: PB }));
  });
});

describe("0176 ใบทอง — กล่องแดง + ติ๊กรับทราบ", () => {
  const gold = (o: Record<string, unknown> = {}) => suggestion({ metal: "gold", ...o });

  it("ทอง + แบบ 1 (ชั่งเฉพาะหล่อ) + ขั้นตะไบ/ขัดโลหะอยู่ในมือแต่ไม่ชั่ง: กล่องแดง role=alert บอกขั้น · ปุ่มสร้างปิดจนติ๊กรับทราบ · ส่ง profileId (ack ไม่ถูกส่ง)", async () => {
    suggestJob.mockResolvedValue(gold());
    await open();
    const box = screen.getByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น").closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("ขัด");
    // ทอง + แบบที่มีขั้นชั่ง (หล่อ) = DB บังคับน้ำหนักสุทธิตอนปิดอยู่แล้ว → กล่องแดงต้องไม่บอกว่า "ไม่บังคับ"
    expect(box).not.toHaveTextContent("ตอนปิดงานไม่บังคับใส่น้ำหนักสุทธิ");
    expect(box).toHaveTextContent("±0.05 กรัม");
    expect(box.className).toContain("border-red-400");
    expect(submitBtn()).toBeDisabled();
    await userEvent.click(within(box).getByLabelText(/รับทราบ — ยังต้องการใช้แบบนี้กับใบทอง/));
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    await userEvent.click(submitBtn());
    const sent = createJob.mock.calls[0][0];
    expect(sent.profileId).toBe(PA);
    expect(JSON.stringify(sent)).not.toMatch(/ack/i);
  });

  it("ack รีเซ็ตเมื่อเปลี่ยนแบบ และเมื่อเปลี่ยนขั้น", async () => {
    suggestJob.mockResolvedValue(gold());
    await open();
    const ackBox = () => screen.getByLabelText(/รับทราบ — ยังต้องการใช้แบบนี้กับใบทอง/) as HTMLInputElement;
    await userEvent.click(ackBox());
    expect(ackBox().checked).toBe(true);
    await userEvent.selectOptions(select(), PB); // แบบไม่ชั่ง: ขั้นโลหะไม่ชั่งทั้งหมด → ยังแดง แต่ต้องติ๊กใหม่
    expect(ackBox().checked).toBe(false);
    await userEvent.click(ackBox());
    await userEvent.click(screen.getByLabelText("ตะไบ")); // เปลี่ยนขั้น
    expect(ackBox().checked).toBe(false);
    expect(submitBtn()).toBeDisabled();
  });

  it("ทอง + แบบไม่ชั่งเลย (ไม่บังคับน้ำหนักสุทธิ): กล่องแดงบอกว่า 'ตอนปิดงานไม่บังคับใส่น้ำหนักสุทธิ' · พรีวิวปิดงานตรงกัน", async () => {
    suggestJob.mockResolvedValue(gold());
    await open();
    await userEvent.selectOptions(select(), PB);
    const box = screen.getByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น").closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent("ตอนปิดงานไม่บังคับใส่น้ำหนักสุทธิ");
    expect(within(dl()).getByText("ปิดงาน").nextElementSibling).toHaveTextContent("ไม่บังคับน้ำหนักสุทธิ");
  });

  it("ทอง + แบบที่ชั่งครบทุกขั้นโลหะของใบ: ไม่มีกล่องแดง · สร้างได้เลย", async () => {
    suggestJob.mockResolvedValue(gold({ stages: STAGES.map((s) => ({ ...s, defaultSelected: s.code === "cast" || s.code === "polish" })) }));
    await open();
    await userEvent.selectOptions(select(), PC);
    expect(screen.queryByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น")).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("ไม่ใช่ทอง (เงิน) ขั้นโลหะไม่ชั่ง = ไม่มีกล่องแดง", async () => {
    await open();
    await userEvent.selectOptions(select(), PB);
    expect(screen.queryByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น")).not.toBeInTheDocument();
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("ขั้นที่ไม่มีโลหะ (เทียน) ไม่นับเป็นขั้นไม่มีด่าน", async () => {
    suggestJob.mockResolvedValue(gold({ stages: STAGES.map((s) => ({ ...s, defaultSelected: s.code === "wax" || s.code === "cast" })) }));
    await open();
    await userEvent.selectOptions(select(), PC);
    expect(screen.queryByText("ใบทองนี้ไม่มีด่านกันทองหายในบางขั้น")).not.toBeInTheDocument();
  });
});

describe("0176 ไม่มีแบบ / ไม่มีค่าเริ่ม / แบบถูกเปลี่ยน", () => {
  it("ไม่มีแบบที่ใช้งาน: กล่องเหลือง + ลิงก์ · ปุ่มสร้างปิด", async () => {
    suggestJob.mockResolvedValue(suggestion({ profiles: [], defaultProfileId: null }));
    await open();
    const box = screen.getByText(/ยังไม่มีแบบการบันทึกที่ใช้งานอยู่/);
    expect(box).toHaveAttribute("role", "alert");
    expect(within(box).getByRole("link", { name: /แบบการบันทึก/ })).toHaveAttribute("href", "/jobs/profiles");
    expect(screen.queryByLabelText(/แบบการบันทึก \(/)).not.toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it("มีแบบแต่ไม่มีค่าเริ่ม (default null): ต้องเลือกเอง — ปุ่มสร้างปิดจนเลือก · ไม่เดาให้", async () => {
    suggestJob.mockResolvedValue(suggestion({ defaultProfileId: null }));
    await open();
    expect(select().value).toBe("");
    expect(submitBtn()).toBeDisabled();
    await userEvent.selectOptions(select(), PB);
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
  });

  it("DB ปฏิเสธ profile_invalid: ข้อความ 'เลือกใหม่' + ดึงรายการแบบใหม่ (suggest ซ้ำ) เก็บขั้นที่ติ๊ก · ไม่ปิดกล่อง", async () => {
    createJob.mockResolvedValue({ ok: false, error: "แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งานแล้ว)", code: "profile_invalid" });
    await open();
    await userEvent.click(screen.getByLabelText("ตะไบ"));
    await waitFor(() => expect(submitBtn()).toBeEnabled(), { timeout: 3000 });
    suggestJob.mockResolvedValue(suggestion({ profiles: [P_NONE], defaultProfileId: PB }));
    await userEvent.click(submitBtn());
    expect(await screen.findByText("แบบที่เลือกถูกปิดใช้หรือแก้ไปแล้ว — เลือกใหม่")).toBeInTheDocument();
    await waitFor(() => expect(select().value).toBe(PB));
    expect(screen.queryByRole("option", { name: "แบบ 1 (ค่าเริ่ม)" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("ตะไบ")).toBeChecked();
    expect(push).not.toHaveBeenCalled();
  });
});
