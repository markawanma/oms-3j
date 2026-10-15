// @vitest-environment jsdom
// 0176 หน้า "แบบการบันทึก" (/jobs/profiles): 4 state · ตารางติ๊กขั้น · ค่าเริ่ม · ปิดใช้ · dirty guard · สร้างจากแบบนี้ · name_dup · nav
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/profiles" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const a = { listProfiles: vi.fn(), saveProfile: vi.fn(), setDefaultProfile: vi.fn(), setProfileActive: vi.fn(), changeJobProfile: vi.fn() };
vi.mock("@/lib/actions/job-profiles", () => ({
  listProfiles: (...x: unknown[]) => a.listProfiles(...x),
  saveProfile: (...x: unknown[]) => a.saveProfile(...x),
  setDefaultProfile: (...x: unknown[]) => a.setDefaultProfile(...x),
  setProfileActive: (...x: unknown[]) => a.setProfileActive(...x),
  changeJobProfile: (...x: unknown[]) => a.changeJobProfile(...x),
}));

vi.mock("@/lib/actions/job-office-write", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProfilesClient } from "./ProfilesClient";
import { JobsSubNav, jobsTabActive } from "./JobsSubNav";
import type { ProfilesData, RecordProfile } from "@/lib/jobs/profile";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";

const DEFS = [
  { code: "wax", nameTh: "เทียน", seq: 1, metalPresent: false, isActive: true },
  { code: "cast", nameTh: "หล่อ", seq: 2, metalPresent: true, isActive: true },
  { code: "file", nameTh: "ตะไบ", seq: 3, metalPresent: true, isActive: true },
  { code: "polish", nameTh: "ขัด", seq: 4, metalPresent: true, isActive: true },
  { code: "old", nameTh: "ขั้นเก่า", seq: 5, metalPresent: true, isActive: false },
];
const prof = (o: Partial<RecordProfile> & { id: string; name: string }): RecordProfile => ({ note: null, requireFinalWeight: false, isActive: true, seq: 10, isDefault: false, isDefaultGold: false, stages: [], jobsOpen: 0, ...o });
const P_GENERAL = prof({ id: P1, name: "แบบ 1 — ชั่งเฉพาะหล่อ", isDefault: true, stages: [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }], jobsOpen: 3 });
const P_NONE = prof({ id: P2, name: "ไม่ชั่ง (รับ/ส่งอย่างเดียว)" });
const P_GOLD = prof({ id: P3, name: "ทอง — ชั่งทุกขั้นที่มีโลหะ", isDefaultGold: true, requireFinalWeight: true,
  stages: [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }, { stageCode: "file", weigh: true, scrapQty: true, scrapWeight: false }, { stageCode: "polish", weigh: true, scrapQty: true, scrapWeight: false }] });
const P_OFF = prof({ id: P4, name: "แบบเก่าที่เลิกใช้", isActive: false });

const data = (o: Partial<ProfilesData> = {}): ProfilesData => ({ profiles: [P_GENERAL, P_NONE, P_GOLD, P_OFF], defaultProfileId: P1, defaultGoldProfileId: P3, stageDefs: DEFS, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  a.listProfiles.mockResolvedValue({ ok: true, data: data() });
  a.saveProfile.mockResolvedValue({ ok: true, data: P_NONE });
  a.setDefaultProfile.mockResolvedValue({ ok: true, data: { defaultProfileId: P1, defaultGoldProfileId: P3 } });
  a.setProfileActive.mockResolvedValue({ ok: true, data: P_NONE });
});

const openEditor = async (name: RegExp | string) => {
  wrap(<ProfilesClient />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return await screen.findByRole("form");
};

describe("0176 หน้าแบบการบันทึก — 4 state", () => {
  it("loading: role=status + skeleton · แล้วรายการขึ้น", async () => {
    let release: (v: unknown) => void = () => undefined;
    a.listProfiles.mockReturnValue(new Promise((r) => { release = r; }));
    wrap(<ProfilesClient />);
    expect(screen.getByRole("status", { name: "กำลังโหลดแบบการบันทึก" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สร้างแบบใหม่/ })).toBeDisabled();
    release({ ok: true, data: data() });
    expect(await screen.findByText("แบบ 1 — ชั่งเฉพาะหล่อ")).toBeInTheDocument();
  });

  it("error: ข้อความจาก server + ลองใหม่ (403 'เฉพาะเจ้าของ/แอดมิน')", async () => {
    a.listProfiles.mockResolvedValueOnce({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานระบบใบงานได้" }).mockResolvedValue({ ok: true, data: data() });
    wrap(<ProfilesClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("เฉพาะเจ้าของร้าน/แอดมินเท่านั้น");
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByText("แบบ 1 — ชั่งเฉพาะหล่อ")).toBeInTheDocument();
  });

  it("throw = ข้อความกลาง ไม่รั่วข้อความดิบ", async () => {
    a.listProfiles.mockRejectedValue(new Error("boom select * from analytics.x"));
    wrap(<ProfilesClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ทำรายการไม่สำเร็จ");
  });

  it("empty: 'ยังไม่มีแบบการบันทึก' + ปุ่มสร้าง", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ profiles: [], defaultProfileId: null, defaultGoldProfileId: null }) });
    wrap(<ProfilesClient />);
    expect(await screen.findByText("ยังไม่มีแบบการบันทึก")).toBeInTheDocument();
  });

  it("empty แล้วกด 'สร้างแบบใหม่' (ทั้งปุ่มหัวและปุ่มใน empty state) = ตัวแก้ไขเปิดจริง · บันทึกส่ง id null", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ profiles: [], defaultProfileId: null, defaultGoldProfileId: null }) });
    wrap(<ProfilesClient />);
    await screen.findByText("ยังไม่มีแบบการบันทึก");
    await userEvent.click(screen.getAllByRole("button", { name: /สร้างแบบใหม่/ }).at(-1)!);
    const form = await screen.findByRole("form", { name: "สร้างแบบการบันทึกใหม่" });
    expect(screen.queryByText("ยังไม่มีแบบการบันทึก", { selector: "p" })).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/ชื่อแบบ/), "แบบแรก");
    await userEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ id: null, name: "แบบแรก" })));
  });

  it("ไม่มีค่าเริ่มทั่วไป: แบนเนอร์เหลือง 'สร้างใบงานไม่ได้'", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ defaultProfileId: null }) });
    wrap(<ProfilesClient />);
    expect(await screen.findByText(/ยังไม่ได้ตั้งค่าเริ่มของงานทั่วไป — สร้างใบงานไม่ได้/)).toHaveAttribute("role", "alert");
  });

  it("success: ชื่อ · badge ค่าเริ่ม · สรุป · ใบที่เปิดอยู่ · แบบปิดใช้ซ่อนจนกด toggle (aria-expanded)", async () => {
    wrap(<ProfilesClient />);
    const row = (await screen.findByRole("button", { name: /แบบ 1 — ชั่งเฉพาะหล่อ/ }));
    expect(within(row).getByText("ค่าเริ่ม · งานทั่วไป")).toBeInTheDocument();
    expect(within(row).getByText(/ชั่ง: หล่อ \/ ชิ้นเสีย: หล่อ \/ เศษ: ไม่มี/)).toBeInTheDocument();
    expect(within(row).getByText("ใช้กับใบที่เปิดอยู่ 3")).toBeInTheDocument();
    const gold = screen.getByRole("button", { name: /ทอง — ชั่งทุกขั้นที่มีโลหะ/ });
    expect(within(gold).getByText("ค่าเริ่ม · งานทอง")).toBeInTheDocument();
    expect(within(gold).getByText(/ชั่ง: ทุกขั้นที่มีโลหะ/)).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /ไม่ชั่ง \(รับ/ })).getByText(/ชั่ง: ไม่มี \/ ชิ้นเสีย: ไม่มี/)).toBeInTheDocument();
    expect(screen.queryByText("แบบเก่าที่เลิกใช้")).not.toBeInTheDocument();
    const t = screen.getByRole("button", { name: /แสดงแบบที่ปิดใช้ \(1\)/ });
    expect(t).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(t);
    expect(t).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("แบบเก่าที่เลิกใช้")).toBeInTheDocument();
  });

  it("ไม่มีแบบที่ปิดใช้ = ไม่มี toggle", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ profiles: [P_GENERAL, P_GOLD] }) });
    wrap(<ProfilesClient />);
    await screen.findByText("แบบ 1 — ชั่งเฉพาะหล่อ");
    expect(screen.queryByRole("button", { name: /แบบที่ปิดใช้/ })).not.toBeInTheDocument();
  });

  it("งานทองไม่มีค่าเริ่มทอง = 'ใช้ตามงานทั่วไป'", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ defaultGoldProfileId: null, profiles: [P_GENERAL, prof({ ...P_GOLD, id: P3, isDefaultGold: false })] }) });
    wrap(<ProfilesClient />);
    expect(await screen.findByText("งานทอง: ใช้ตามงานทั่วไป")).toBeInTheDocument();
  });
});

describe("0176 ตารางติ๊กขั้น", () => {
  it("ติ๊กตามแบบเดิม · ขั้นไม่มีโลหะ (เทียน) ชั่ง/เศษ ติ๊กไม่ได้ + บรรทัด 'ยังไม่มีโลหะ' · ชิ้นเสียติ๊กได้ · ขั้นปิดใช้ที่ไม่มี flag ซ่อน", async () => {
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    expect(within(form).getByLabelText("ชั่งน้ำหนัก — หล่อ")).toBeChecked();
    expect(within(form).getByLabelText("ชิ้นเสีย — หล่อ")).toBeChecked();
    expect(within(form).getByLabelText("เศษโลหะ — หล่อ")).not.toBeChecked();
    expect(within(form).getByLabelText("ชั่งน้ำหนัก — เทียน")).toBeDisabled();
    expect(within(form).getByLabelText("เศษโลหะ — เทียน")).toBeDisabled();
    expect(within(form).getByLabelText("ชิ้นเสีย — เทียน")).toBeEnabled();
    expect(within(form).getByText("ยังไม่มีโลหะ ชั่งไม่ได้")).toBeInTheDocument();
    expect(within(form).getByLabelText("ชั่งน้ำหนัก — เทียน")).toHaveAccessibleDescription("ยังไม่มีโลหะ ชั่งไม่ได้");
    expect(within(form).queryByLabelText("ชั่งน้ำหนัก — ขั้นเก่า")).not.toBeInTheDocument();
    expect(within(form).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(4);
    expect(within(form).getByRole("table")).toBeInTheDocument();
  });

  it("ขั้นที่ปิดใช้แต่ยังมี flag อยู่ = แสดง (จาง + '(ขั้นนี้ปิดใช้แล้ว)')", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ profiles: [prof({ ...P_GENERAL, stages: [{ stageCode: "old", weigh: true, scrapQty: false, scrapWeight: false }] }), P_GOLD] }) });
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    expect(within(form).getByText("(ขั้นนี้ปิดใช้แล้ว)")).toBeInTheDocument();
    expect(within(form).getByLabelText("ชั่งน้ำหนัก — ขั้นเก่า")).toBeChecked();
  });

  it("แบบไม่ติ๊กเลย: ขึ้นคำอธิบาย 'ไม่ชั่ง ไม่ถามของเสีย' · บันทึกได้ (ส่ง flag ปิดทั้งหมด)", async () => {
    wrap(<ProfilesClient />);
    await userEvent.click(await screen.findByRole("button", { name: /สร้างแบบใหม่/ }));
    const form = await screen.findByRole("form");
    expect(within(form).getByText(/ไม่ได้ติ๊กอะไรเลย = ไม่ชั่ง ไม่ถามของเสีย/)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "บันทึก" })).toBeDisabled(); // ยังไม่มีชื่อ
    await userEvent.type(within(form).getByLabelText(/ชื่อแบบ/), "แบบไม่ชั่งใหม่");
    expect(within(form).getByRole("button", { name: "บันทึก" })).toBeEnabled();
    await userEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveProfile).toHaveBeenCalled());
    const sent = a.saveProfile.mock.calls[0][0];
    expect(sent).toMatchObject({ id: null, name: "แบบไม่ชั่งใหม่", requireFinalWeight: false });
    expect(sent.stages.every((s: { weigh: boolean; scrapQty: boolean; scrapWeight: boolean }) => !s.weigh && !s.scrapQty && !s.scrapWeight)).toBe(true);
    expect(await screen.findByText("บันทึกแบบแล้ว")).toBeInTheDocument();
  });

  it("แก้แล้วบันทึก: ส่ง id + flag ใหม่ · ปุ่มบันทึกเปิดเมื่อมีการเปลี่ยนเท่านั้น · บังคับน้ำหนักสุทธิ", async () => {
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    const save = within(form).getByRole("button", { name: "บันทึก" });
    expect(save).toBeDisabled();
    await userEvent.click(within(form).getByLabelText("ชั่งน้ำหนัก — ตะไบ"));
    await userEvent.click(within(form).getByLabelText(/บังคับใส่น้ำหนักสุทธิ/));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(a.saveProfile).toHaveBeenCalled());
    const sent = a.saveProfile.mock.calls[0][0];
    expect(sent.id).toBe(P1);
    expect(sent.requireFinalWeight).toBe(true);
    expect(sent.stages.find((s: { stageCode: string }) => s.stageCode === "file")).toMatchObject({ weigh: true });
    expect(sent.stages.find((s: { stageCode: string }) => s.stageCode === "cast")).toMatchObject({ weigh: true, scrapQty: true });
  });

  it("ชื่อซ้ำ (name_dup): ข้อความที่ช่องชื่อ + aria-invalid + โฟกัส", async () => {
    a.saveProfile.mockResolvedValue({ ok: false, error: 'มีแบบชื่อ "แบบ 1" อยู่แล้ว', code: "name_dup" });
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    const name = within(form).getByLabelText(/ชื่อแบบ/);
    await userEvent.clear(name);
    await userEvent.type(name, "แบบ 1");
    await userEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    expect(await within(form).findByText("มีแบบชื่อนี้อยู่แล้ว")).toHaveAttribute("role", "alert");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
  });

  it("ชื่อมี < หรือยาวเกิน = บันทึกไม่ได้", async () => {
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    const name = within(form).getByLabelText(/ชื่อแบบ/);
    await userEvent.clear(name);
    await userEvent.type(name, "แบบ<b>");
    expect(within(form).getByRole("button", { name: "บันทึก" })).toBeDisabled();
    await userEvent.clear(name);
    expect(within(form).getByRole("button", { name: "บันทึก" })).toBeDisabled();
  });

  it("error อื่นจาก DB: ErrorLine ค้าง ค่าที่กรอกยังอยู่", async () => {
    a.saveProfile.mockResolvedValue({ ok: false, error: "ขั้น เทียน ไม่มีโลหะอยู่ในมือ — ตั้งชั่งน้ำหนัก/น้ำหนักเศษไม่ได้" });
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    await userEvent.click(within(form).getByLabelText("ชิ้นเสีย — หล่อ"));
    await userEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("ไม่มีโลหะอยู่ในมือ");
    expect(within(form).getByLabelText("ชิ้นเสีย — หล่อ")).toBeChecked();
  });
});

describe("0176 ค่าเริ่ม · ปิดใช้ · สร้างจากแบบนี้ · dirty guard", () => {
  it("แบบที่เป็นค่าเริ่ม: ปุ่มปิดใช้ disabled + เหตุผลเห็นเสมอ (ไม่ใช่ title) · ปุ่ม 'เลิกเป็นค่าเริ่มงานทอง' มีเฉพาะแบบทอง", async () => {
    const f1 = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    const close = within(f1).getByRole("button", { name: "ปิดใช้งาน" });
    expect(close).toBeDisabled();
    expect(close).toHaveAccessibleDescription("ปิดไม่ได้ — เป็นค่าเริ่มอยู่ (ตั้งแบบอื่นก่อน)");
    expect(within(f1).queryByRole("button", { name: /เลิกเป็นค่าเริ่มงานทอง/ })).not.toBeInTheDocument();
    cleanup();
    const f3 = await openEditor(/ทอง — ชั่งทุกขั้นที่มีโลหะ/);
    expect(within(f3).getByRole("button", { name: "ปิดใช้งาน" })).toBeDisabled();
    expect(within(f3).getByRole("button", { name: /เลิกเป็นค่าเริ่มงานทอง/ })).toBeEnabled();
  });

  it("แบบที่ไม่ใช่ค่าเริ่ม: ปิดใช้ → กล่องยืนยัน → setProfileActive(false) + toast", async () => {
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    await userEvent.click(within(form).getByRole("button", { name: "ปิดใช้งาน" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/จะเลือกแบบนี้ตอนสร้างใบใหม่ไม่ได้ ใบที่ใช้อยู่ไม่กระทบ/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(a.setProfileActive).toHaveBeenCalledWith(P2, false));
    expect(await screen.findByText("ปิดใช้งานแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("DB ปฏิเสธการปิด (default_cannot_close) = ข้อความค้างในกล่อง ไม่ปิด", async () => {
    a.setProfileActive.mockResolvedValue({ ok: false, error: "ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน" });
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    await userEvent.click(within(form).getByRole("button", { name: "ปิดใช้งาน" }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: "ปิดใช้งาน" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("ปิดแบบที่เป็นค่าเริ่มไม่ได้");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("🔴 แก้ชื่อค้าง แล้วกดปิดใช้/ตั้งค่าเริ่ม = ปุ่มปิด (dirty) · กล่องยืนยันไม่ทำให้ save การแก้ที่ค้าง (saveProfile ไม่ถูกเรียก)", async () => {
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    await userEvent.type(within(form).getByLabelText(/ชื่อแบบ/), " ใหม่");
    expect(within(form).getByRole("button", { name: "ปิดใช้งาน" })).toBeDisabled();
    expect(within(form).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทั่วไป" })).toBeDisabled();
    expect(a.saveProfile).not.toHaveBeenCalled();
    // ไม่แก้ → เปิดกล่องปิดใช้ได้ · ยืนยันในกล่อง = ปิดใช้อย่างเดียว ไม่ save ฟอร์ม
    await userEvent.clear(within(form).getByLabelText(/ชื่อแบบ/));
    await userEvent.type(within(form).getByLabelText(/ชื่อแบบ/), "ไม่ชั่ง (รับ/ส่งอย่างเดียว)");
    await userEvent.click(within(form).getByRole("button", { name: "ปิดใช้งาน" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg.closest("form")).toBeNull();
    await userEvent.click(within(dlg).getByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(a.setProfileActive).toHaveBeenCalledWith(P2, false));
    expect(a.saveProfile).not.toHaveBeenCalled();
  });

  it("แบบปิดอยู่ + แก้ค้าง = ปุ่ม 'เปิดใช้งานอีกครั้ง' ปิดด้วย", async () => {
    wrap(<ProfilesClient />);
    await userEvent.click(await screen.findByRole("button", { name: /แสดงแบบที่ปิดใช้/ }));
    await userEvent.click(screen.getByRole("button", { name: /แบบเก่าที่เลิกใช้/ }));
    const form = await screen.findByRole("form");
    await userEvent.type(within(form).getByLabelText(/ชื่อแบบ/), "x");
    expect(within(form).getByRole("button", { name: "เปิดใช้งานอีกครั้ง" })).toBeDisabled();
  });

  it("แบบที่ปิดอยู่: ปุ่ม 'เปิดใช้งานอีกครั้ง' (ไม่ confirm) · ไม่มีปุ่มตั้งค่าเริ่ม", async () => {
    wrap(<ProfilesClient />);
    await userEvent.click(await screen.findByRole("button", { name: /แสดงแบบที่ปิดใช้/ }));
    await userEvent.click(screen.getByRole("button", { name: /แบบเก่าที่เลิกใช้/ }));
    const form = await screen.findByRole("form");
    expect(within(form).getByText(/แบบนี้ปิดใช้งานอยู่/)).toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: /ตั้งเป็นค่าเริ่ม/ })).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "เปิดใช้งานอีกครั้ง" }));
    await waitFor(() => expect(a.setProfileActive).toHaveBeenCalledWith(P4, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ตั้งค่าเริ่มทั่วไป: ข้อความยืนยัน → setDefaultProfile(id,'general') · แก้ค้าง (dirty) = ปุ่มตั้งค่าเริ่มปิด + บอก 'บันทึกก่อน'", async () => {
    const form = await openEditor(/ไม่ชั่ง \(รับ/);
    const btn = within(form).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทั่วไป" });
    expect(btn).toBeEnabled();
    await userEvent.click(within(form).getByLabelText("ชิ้นเสีย — หล่อ"));
    expect(btn).toBeDisabled();
    expect(within(form).getByText("บันทึกก่อนค่อยตั้งค่าเริ่มหรือปิด/เปิดใช้งาน")).toBeInTheDocument();
    await userEvent.click(within(form).getByLabelText("ชิ้นเสีย — หล่อ")); // กลับเท่าเดิม = ไม่ dirty
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/ตั้ง “ไม่ชั่ง \(รับ\/ส่งอย่างเดียว\)” เป็นค่าเริ่มของงานทั่วไป\? ใบงานใหม่ที่ไม่ใช่ทองจะเริ่มด้วยแบบนี้ ใบที่มีอยู่ไม่เปลี่ยน/)).toBeInTheDocument();
    expect(within(dlg).queryByText(/ไม่มีด่านกันทองหาย/)).not.toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม" }));
    await waitFor(() => expect(a.setDefaultProfile).toHaveBeenCalledWith(P2, "general"));
    expect(await screen.findByText("ตั้งค่าเริ่มแล้ว")).toBeInTheDocument();
  });

  it("ตั้งค่าเริ่มงานทองด้วยแบบที่มีขั้นโลหะไม่ชั่ง: แทรกกล่องแดง (ไม่ต้อง ack) บอกชื่อขั้น · แบบที่ชั่งครบไม่มีกล่องแดง", async () => {
    const f2 = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    await userEvent.click(within(f2).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทอง" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("alert")).toHaveTextContent("ใบทองใหม่ทุกใบจะเริ่มด้วยแบบนี้ — ขั้น ตะไบ, ขัด ไม่ชั่ง ไม่มีด่านกันทองหาย");
    expect(within(dlg).queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    // แบบ "ไม่ชั่ง" ก็เตือน (ทุกขั้นโลหะไม่ชั่ง)
    await userEvent.click(screen.getByRole("button", { name: /ไม่ชั่ง \(รับ/ }));
    await userEvent.click(await screen.findByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทอง" }));
    expect(within(await screen.findByRole("dialog")).getByRole("alert")).toHaveTextContent("หล่อ, ตะไบ, ขัด");
  });

  it("ตั้งค่าเริ่มงานทองด้วยแบบทองที่ชั่งครบ: ไม่มีกล่องแดง", async () => {
    a.listProfiles.mockResolvedValue({ ok: true, data: data({ defaultGoldProfileId: null, profiles: [P_GENERAL, prof({ ...P_GOLD, isDefaultGold: false })] }) });
    const form = await openEditor(/ทอง — ชั่งทุกขั้นที่มีโลหะ/);
    await userEvent.click(within(form).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม · งานทอง" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ตั้งเป็นค่าเริ่ม" }));
    await waitFor(() => expect(a.setDefaultProfile).toHaveBeenCalledWith(P3, "gold"));
  });

  it("เลิกเป็นค่าเริ่มงานทอง → setDefaultProfile(null,'gold')", async () => {
    const form = await openEditor(/ทอง — ชั่งทุกขั้นที่มีโลหะ/);
    await userEvent.click(within(form).getByRole("button", { name: /เลิกเป็นค่าเริ่มงานทอง/ }));
    await waitFor(() => expect(a.setDefaultProfile).toHaveBeenCalledWith(null, "gold"));
  });

  it("สร้างจากแบบนี้: ชื่อ '<ชื่อ> (สำเนา)' โฟกัส+select · ค่าบนจอ (รวมที่ยังไม่บันทึก) ถูกคัดลอก · ไม่ copy ค่าเริ่ม · บันทึกเป็นแบบใหม่ (id null)", async () => {
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    await userEvent.click(within(form).getByLabelText("ชั่งน้ำหนัก — ตะไบ")); // แก้ค้างบนจอ
    await userEvent.click(within(form).getByRole("button", { name: /สร้างจากแบบนี้/ }));
    const clone = await screen.findByRole("form", { name: "สร้างแบบการบันทึกใหม่" });
    const name = within(clone).getByLabelText(/ชื่อแบบ/) as HTMLInputElement;
    expect(name.value).toBe("แบบ 1 — ชั่งเฉพาะหล่อ (สำเนา)");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
    expect(within(clone).getByLabelText("ชั่งน้ำหนัก — ตะไบ")).toBeChecked();
    expect(within(clone).queryByText(/จัดการแบบนี้/)).not.toBeInTheDocument(); // แบบใหม่ยังไม่มีปุ่มค่าเริ่ม
    await userEvent.click(within(clone).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveProfile).toHaveBeenCalled());
    expect(a.saveProfile.mock.calls[0][0]).toMatchObject({ id: null, name: "แบบ 1 — ชั่งเฉพาะหล่อ (สำเนา)" });
    expect(a.saveProfile.mock.calls[0][0].stages.find((s: { stageCode: string }) => s.stageCode === "file")).toMatchObject({ weigh: true });
    expect(a.setDefaultProfile).not.toHaveBeenCalled();
  });

  it("dirty guard: แก้ค้างแล้วกดแบบอื่น/สร้างใหม่/ยกเลิก = ถาม 'ยังไม่ได้บันทึก — ทิ้งการแก้ไขไหม' · กลับไปแก้ = อยู่เดิม · ทิ้ง = ไปต่อ", async () => {
    const form = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    await userEvent.click(within(form).getByLabelText("ชั่งน้ำหนัก — ตะไบ"));
    await userEvent.click(screen.getByRole("button", { name: /ไม่ชั่ง \(รับ/ }));
    const dlg = await screen.findByRole("dialog", { name: "ยังไม่ได้บันทึก" });
    expect(within(dlg).getByText("ยังไม่ได้บันทึก — ทิ้งการแก้ไขไหม")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "กลับไปแก้" }));
    expect(screen.getByLabelText("ชั่งน้ำหนัก — ตะไบ")).toBeChecked();
    // กดแถวเดิมซ้ำ = ไม่ล้าง
    await userEvent.click(screen.getByRole("button", { name: /แบบ 1 — ชั่งเฉพาะหล่อ/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ชั่งน้ำหนัก — ตะไบ")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "ยังไม่ได้บันทึก" })).getByRole("button", { name: "ทิ้ง" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
  });

  it("ไม่ได้แก้อะไร: เปลี่ยนแบบ/ยกเลิกได้เลย ไม่ถาม", async () => {
    await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    await userEvent.click(screen.getByRole("button", { name: /ไม่ชั่ง \(รับ/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("form", { name: "แก้แบบ ไม่ชั่ง (รับ/ส่งอย่างเดียว)" })).toBeInTheDocument();
  });

  it("กล่องฟ้าถาวร: แก้แบบมีผลกับใบที่สร้างหลังจากนี้ · บอกจำนวนใบที่เปิดอยู่ (n>0 เท่านั้น)", async () => {
    const f1 = await openEditor(/แบบ 1 — ชั่งเฉพาะหล่อ/);
    expect(within(f1).getByRole("note")).toHaveTextContent("แก้แบบนี้มีผลกับใบที่สร้างหลังจากนี้เท่านั้น · ใบที่สร้างไปแล้ว (เปิดอยู่ 3 ใบ) ยังใช้กติกาตอนสร้างเหมือนเดิม");
    cleanup();
    const f2 = await openEditor(/ไม่ชั่ง \(รับ/);
    expect(within(f2).getByRole("note")).not.toHaveTextContent("เปิดอยู่");
  });
});

describe("0176 nav", () => {
  it("jobsTabActive: /jobs/profiles สว่างแท็บแบบการบันทึก ไม่สว่างบอร์ด · workers/[id] เดิมไม่เปลี่ยน", () => {
    expect(jobsTabActive("/jobs/profiles", "/jobs/profiles")).toBe(true);
    expect(jobsTabActive("/jobs/profiles", "/jobs")).toBe(false);
    expect(jobsTabActive("/jobs/profiles", "/jobs/workers")).toBe(false);
    expect(jobsTabActive("/jobs/workers", "/jobs")).toBe(false);
    expect(jobsTabActive("/jobs/11111111-1111-4111-8111-111111111111", "/jobs")).toBe(true);
    expect(jobsTabActive("/jobs", "/jobs")).toBe(true);
    expect(jobsTabActive("/jobs/11111111-1111-4111-8111-111111111111", "/jobs/profiles")).toBe(false);
  });
  it("แท็บ 'แบบการบันทึก' อยู่ในเมนู · aria-current ตามพาธ", () => {
    render(<JobsSubNav />);
    expect(screen.getByRole("link", { name: "แบบการบันทึก" })).toHaveAttribute("href", "/jobs/profiles");
    expect(screen.getByRole("link", { name: "แบบการบันทึก" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "บอร์ดใบงาน" })).not.toHaveAttribute("aria-current");
  });
});
