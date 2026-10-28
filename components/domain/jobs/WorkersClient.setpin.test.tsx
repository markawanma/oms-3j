// @vitest-environment jsdom
// 0185: "ตั้ง PIN เอง" (4 หลักอะไรก็ได้) แยกจากปุ่ม "รีเซ็ต PIN" (สุ่ม) — ปุ่มคู่บนแถว · ในกล่องแก้ไขช่าง · PIN ไม่ลง storage/URL · แสดงครั้งเดียว
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
const worker = (o: Partial<WorkerRow> & { id: string; displayName: string }): WorkerRow => ({
  stageCodes: ["finish"], isActive: true, lockedUntil: null, createdAt: null, lockState: "none", failedAttempts: 0, pinWarning: false, canOpenJob: false, canExternal: false, ...o,
});
const data = (): WorkersData => ({ workers: [worker({ id: W1, displayName: "ช่างเอ" })], stages: [{ code: "finish", nameTh: "แต่ง" }, { code: "buff", nameTh: "ขัด" }], retiredStages: [] });
const row = () => screen.getByText("ช่างเอ").closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  a.resetWorkerPin.mockResolvedValue({ ok: true, data: { pin: null } });
});

describe("แถวช่าง: ปุ่มรีเซ็ต (สุ่ม) เดิม + ปุ่มตั้ง PIN เอง แยกกัน", () => {
  it("มีทั้ง 'รีเซ็ต PIN' และ 'ตั้ง PIN เอง' · ปุ่มห่อบรรทัดได้ (ไม่ล้นแถวบนมือถือ)", () => {
    wrap(<WorkersClient data={data()} />);
    expect(within(row()).getByRole("button", { name: "รีเซ็ต PIN ของ ช่างเอ" })).toHaveTextContent("รีเซ็ต PIN");
    expect(within(row()).getByRole("button", { name: "ตั้ง PIN เองให้ ช่างเอ" })).toHaveTextContent("ตั้ง PIN เอง");
    const group = within(row()).getByRole("button", { name: "ตั้ง PIN เองให้ ช่างเอ" }).parentElement as HTMLElement;
    expect(group.className).toContain("flex-wrap");
    expect(group.className).not.toContain("flex-nowrap");
  });
  it("ปุ่มรีเซ็ตเดิมยังทำงาน: สุ่มให้ (ส่ง pin=null) แล้วแสดง PIN ที่สุ่มครั้งเดียว", async () => {
    a.resetWorkerPin.mockResolvedValue({ ok: true, data: { pin: "4831" } });
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(within(row()).getByRole("button", { name: "รีเซ็ต PIN ของ ช่างเอ" }));
    const dlg = await screen.findByRole("dialog", { name: /รีเซ็ต PIN/ });
    expect(within(dlg).queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "สุ่ม PIN ใหม่" }));
    await waitFor(() => expect(a.resetWorkerPin).toHaveBeenCalledWith(W1, null));
    expect(await screen.findByText("4831")).toBeInTheDocument();
  });
});

describe("กล่อง 'ตั้ง PIN เอง'", () => {
  const open = async () => {
    await userEvent.click(within(row()).getByRole("button", { name: "ตั้ง PIN เองให้ ช่างเอ" }));
    return await screen.findByRole("dialog", { name: /ตั้ง PIN เองให้ ช่างเอ/ });
  };
  it("ช่อง PIN: inputMode numeric · autoComplete off · 4 หลัก · ตัดตัวอักษรออก · ปุ่มยืนยันกดได้เมื่อครบ 4 หลัก · บอกว่า PIN เดิมใช้ไม่ได้ + ช่างที่เปิดค้างต้องระบุตัวใหม่", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await open();
    const input = within(dlg).getByLabelText(/PIN ใหม่ 4 หลัก/) as HTMLInputElement;
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("maxlength", "4");
    expect(dlg).toHaveTextContent("PIN เดิมใช้ไม่ได้");
    expect(dlg).toHaveTextContent("ระบุตัวใหม่");
    const ok = within(dlg).getByRole("button", { name: "ตั้ง PIN นี้" });
    expect(ok).toBeDisabled();
    await userEvent.type(input, "1a1");
    expect(input.value).toBe("11");
    expect(ok).toBeDisabled();
    expect(dlg).toHaveTextContent("PIN ต้องเป็นตัวเลข 4 หลัก");
    await userEvent.type(input, "11");
    expect(input.value).toBe("1111");
    expect(ok).toBeEnabled();
  });
  it("เลขเบิ้ล/เรียง (1111 · 1212 · 1234 · 0000) ส่งถึง resetWorkerPin ตามที่ตั้ง แล้วแสดง PIN ครั้งเดียวในกล่องเดิม · ไม่ลง localStorage/sessionStorage/URL", async () => {
    for (const pin of ["1111", "1212", "1234", "0000"]) {
      a.resetWorkerPin.mockClear();
      wrap(<WorkersClient data={data()} />);
      const dlg = await open();
      await userEvent.type(within(dlg).getByLabelText(/PIN ใหม่ 4 หลัก/), pin);
      await userEvent.click(within(dlg).getByRole("button", { name: "ตั้ง PIN นี้" }));
      await waitFor(() => expect(a.resetWorkerPin).toHaveBeenCalledWith(W1, pin));
      const shown = await screen.findByRole("dialog", { name: "PIN ของ ช่างเอ" });
      expect(within(shown).getByRole("status")).toHaveTextContent(pin);
      expect(shown).toHaveTextContent("แสดงครั้งเดียว");
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(pin);
      expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(pin);
      expect(window.location.href).not.toContain(pin);
      await userEvent.click(within(shown).getByRole("button", { name: "จดแล้ว ปิด" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByText(pin)).not.toBeInTheDocument();
      cleanup();
    }
  });
  it("DB/แอปปฏิเสธ (ok:false): ขึ้นข้อความผิดพลาดในกล่อง · กล่องไม่ปิด · ไม่แสดง PIN", async () => {
    a.resetWorkerPin.mockResolvedValue({ ok: false, error: "PIN ต้องเป็นตัวเลข 4 หลัก" });
    wrap(<WorkersClient data={data()} />);
    const dlg = await open();
    await userEvent.type(within(dlg).getByLabelText(/PIN ใหม่ 4 หลัก/), "1234");
    await userEvent.click(within(dlg).getByRole("button", { name: "ตั้ง PIN นี้" }));
    await waitFor(() => expect(a.resetWorkerPin).toHaveBeenCalledTimes(1));
    expect(await within(dlg).findByText("PIN ต้องเป็นตัวเลข 4 หลัก", { selector: "[role=alert], p, div" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "PIN ของ ช่างเอ" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /ตั้ง PIN เองให้/ })).toBeInTheDocument();
  });
});

describe("จากกล่องแก้ไขช่าง: แก้ค้างไว้แล้วกด 'ตั้ง PIN เอง'", () => {
  const openEdit = async () => {
    await userEvent.click(within(row()).getByRole("button", { name: "แก้ไข ช่างเอ" }));
    return await screen.findByRole("dialog", { name: /แก้ไข ช่างเอ/ });
  };
  it("แก้ชื่อค้าง → ถามยืนยัน 'ยังไม่ได้บันทึกการแก้ไข' ก่อน · กลับไปแก้ต่อ = ชื่อที่แก้ยังอยู่ · ยืนยันทิ้ง = ไปกล่องตั้ง PIN", async () => {
    wrap(<WorkersClient data={data()} />);
    let edit = await openEdit();
    const name = within(edit).getByLabelText(/ชื่อที่ช่างเห็น/) as HTMLInputElement;
    await userEvent.type(name, "X");
    await userEvent.click(within(edit).getByRole("button", { name: "ตั้ง PIN เอง" }));
    expect(within(edit).getByRole("alert")).toHaveTextContent("ยังไม่ได้บันทึกการแก้ไข — ทิ้งแล้วไปตั้ง PIN?");
    expect(screen.queryByRole("dialog", { name: /ตั้ง PIN เองให้/ })).not.toBeInTheDocument();
    await userEvent.click(within(edit).getByRole("button", { name: "กลับไปแก้ต่อ" }));
    expect(within(edit).queryByRole("alert")).not.toBeInTheDocument();
    expect((within(edit).getByLabelText(/ชื่อที่ช่างเห็น/) as HTMLInputElement).value).toBe("ช่างเอX");
    await userEvent.click(within(edit).getByRole("button", { name: "ตั้ง PIN เอง" }));
    await userEvent.click(within(edit).getByRole("button", { name: "ทิ้งการแก้ไขแล้วไปตั้ง PIN" }));
    expect(await screen.findByRole("dialog", { name: /ตั้ง PIN เองให้ ช่างเอ$/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /แก้ไข ช่างเอ/ })).not.toBeInTheDocument();
    expect(a.saveWorker).not.toHaveBeenCalled();
  });
  it("แก้ขั้น (ติ๊กเพิ่ม) ก็นับว่าแก้ค้าง · ติ๊กแล้วติ๊กกลับ = ไม่แก้ → ไม่ถาม", async () => {
    wrap(<WorkersClient data={data()} />);
    let edit = await openEdit();
    await userEvent.click(within(edit).getByRole("checkbox", { name: "ขัด" }));
    await userEvent.click(within(edit).getByRole("button", { name: "ตั้ง PIN เอง" }));
    expect(within(edit).getByRole("alert")).toBeInTheDocument();
    await userEvent.click(within(edit).getByRole("button", { name: "กลับไปแก้ต่อ" }));
    await userEvent.click(within(edit).getByRole("checkbox", { name: "ขัด" }));
    await userEvent.click(within(edit).getByRole("button", { name: "ตั้ง PIN เอง" }));
    expect(await screen.findByRole("dialog", { name: /ตั้ง PIN เองให้ ช่างเอ$/ })).toBeInTheDocument();
  });
});

describe("จากกล่องแก้ไขช่าง", () => {
  it("แก้ช่างเดิม: มีปุ่ม 'ตั้ง PIN เอง' → ปิดกล่องแก้ไขแล้วเปิดกล่องตั้ง PIN · เพิ่มช่างใหม่: ไม่มีปุ่มนี้ (มีช่อง PIN ในฟอร์มอยู่แล้ว)", async () => {
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(within(row()).getByRole("button", { name: "แก้ไข ช่างเอ" }));
    const edit = await screen.findByRole("dialog", { name: /แก้ไข ช่างเอ/ });
    await userEvent.click(within(edit).getByRole("button", { name: "ตั้ง PIN เอง" }));
    expect(await screen.findByRole("dialog", { name: /ตั้ง PIN เองให้ ช่างเอ/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /แก้ไข ช่างเอ/ })).not.toBeInTheDocument();
    cleanup();
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    const add = await screen.findByRole("dialog", { name: "เพิ่มช่าง" });
    expect(within(add).queryByRole("button", { name: "ตั้ง PIN เอง" })).not.toBeInTheDocument();
    expect(within(add).getByLabelText(/PIN 4 หลัก/)).toHaveAttribute("inputmode", "numeric");
    await userEvent.type(within(add).getByLabelText(/PIN 4 หลัก/), "11a");
    expect(add).toHaveTextContent("PIN ต้องเป็นตัวเลข 4 หลัก");
  });
});
