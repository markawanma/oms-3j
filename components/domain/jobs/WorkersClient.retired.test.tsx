// @vitest-environment jsdom
// 0184: หน้าทะเบียนช่างกับขั้นที่เลิกใช้ (polish "แต่ง ขัด") — แสดงชื่อไทย + ป้าย ไม่โชว์รหัสดิบ · ตัวเลือกให้ติ๊กยังเฉพาะขั้นที่เปิด · บันทึกแล้วคงรหัสที่เลิกใช้ไว้ ไม่หลุด
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/workers" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const a = { saveWorker: vi.fn(), setWorkerActive: vi.fn(), resetWorkerPin: vi.fn(), unlockWorker: vi.fn() };
vi.mock("@/lib/actions/job-workers", () => ({
  saveWorker: (...x: unknown[]) => a.saveWorker(...x),
  setWorkerActive: (...x: unknown[]) => a.setWorkerActive(...x),
  resetWorkerPin: (...x: unknown[]) => a.resetWorkerPin(...x),
  unlockWorker: (...x: unknown[]) => a.unlockWorker(...x),
}));
vi.mock("@/lib/actions/job-office-write", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { WorkersClient } from "./WorkersClient";
import type { WorkersData } from "@/lib/actions/job-workers";
import type { WorkerRow } from "@/lib/jobs/types";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const worker = (o: Partial<WorkerRow> & { id: string; displayName: string }): WorkerRow => ({
  stageCodes: [], isActive: true, lockedUntil: null, createdAt: null, lockState: "none", failedAttempts: 0, pinWarning: false, canOpenJob: false, canExternal: false, ...o,
});
const STAGES = [
  { code: "cut_sprue", nameTh: "ตัดต้น" },
  { code: "finish", nameTh: "แต่ง" },
  { code: "buff", nameTh: "ขัด" },
];
const RETIRED = [{ code: "polish", nameTh: "แต่ง ขัด" }];
const data = (o: Partial<WorkersData> = {}): WorkersData => ({
  workers: [
    worker({ id: W1, displayName: "ช่างเก่า", stageCodes: ["cut_sprue", "polish", "finish", "buff"] }),
    worker({ id: W2, displayName: "ช่างใหม่", stageCodes: ["finish", "buff"] }),
  ],
  stages: STAGES,
  retiredStages: RETIRED,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  a.saveWorker.mockResolvedValue({ ok: true, data: { id: W1, pin: null } });
});

describe("รายการช่าง: ขั้นที่เลิกใช้", () => {
  it("แสดงชื่อไทย + ป้าย (เลิกใช้) แทนรหัส polish ดิบ", () => {
    wrap(<WorkersClient data={data()} />);
    const li = screen.getByText("ช่างเก่า").closest("li") as HTMLElement;
    expect(li).toHaveTextContent("แต่ง ขัด (เลิกใช้)");
    expect(li.textContent).not.toMatch(/polish/);
    expect(li).toHaveTextContent("ตัดต้น");
  });
  it("ช่างที่ไม่ถือขั้นเลิกใช้ ไม่มีป้าย · ข้อมูลเก่าที่ไม่มี retiredStages ไม่พัง (รหัสที่ไม่รู้จักแสดงรหัสเดิม)", () => {
    wrap(<WorkersClient data={data()} />);
    expect((screen.getByText("ช่างใหม่").closest("li") as HTMLElement).textContent).not.toMatch(/เลิกใช้/);
    cleanup();
    wrap(<WorkersClient data={{ ...data(), retiredStages: undefined }} />);
    expect((screen.getByText("ช่างเก่า").closest("li") as HTMLElement).textContent).toMatch(/polish/);
  });
});

describe("dialog แก้ช่าง: ตัวเลือกยังเฉพาะขั้นที่เปิด", () => {
  const openEdit = async (name: string) => {
    await userEvent.click(within(screen.getByText(name).closest("li") as HTMLElement).getByRole("button", { name: /แก้ไข/ }));
    return await screen.findByRole("dialog");
  };
  it("ช่างที่ถือ polish: เห็น 'แต่ง ขัด (เลิกใช้)' ติ๊กอยู่ · ช่างที่ไม่ถือ: ไม่เห็นตัวเลือกเลิกใช้เลย · เพิ่มช่างใหม่: ไม่เห็น", async () => {
    wrap(<WorkersClient data={data()} />);
    let dlg = await openEdit("ช่างเก่า");
    const PERMS = 2; // W1: เปิดงานได้ · ดูแลงานนอกร้าน
    const held = within(dlg).getByRole("checkbox", { name: /แต่ง ขัด \(เลิกใช้\)/ });
    expect(held).toBeChecked();
    expect(within(dlg).getAllByRole("checkbox")).toHaveLength(STAGES.length + 1 + PERMS);
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    dlg = await openEdit("ช่างใหม่");
    expect(within(dlg).queryByText(/เลิกใช้/)).not.toBeInTheDocument();
    expect(within(dlg).getAllByRole("checkbox")).toHaveLength(STAGES.length + PERMS);
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByText(/เลิกใช้/)).not.toBeInTheDocument();
    expect(within(dlg).getAllByRole("checkbox")).toHaveLength(STAGES.length + PERMS);
  });
  it("กดบันทึกโดยไม่แตะขั้น: รหัส polish คงอยู่ในที่ส่งไป (ไม่หลุด) และไม่ error", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเก่า");
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalledTimes(1));
    const arg = a.saveWorker.mock.calls[0][0] as { id: string; stageCodes: string[] };
    expect(arg.id).toBe(W1);
    expect([...arg.stageCodes].sort()).toEqual(["buff", "cut_sprue", "finish", "polish"]);
  });
  it("เอาขั้นเลิกใช้ออกเองได้ (ติ๊กออก) แล้วบันทึกไม่มี polish", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเก่า");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /แต่ง ขัด \(เลิกใช้\)/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalledTimes(1));
    expect((a.saveWorker.mock.calls[0][0] as { stageCodes: string[] }).stageCodes).not.toContain("polish");
  });
});
