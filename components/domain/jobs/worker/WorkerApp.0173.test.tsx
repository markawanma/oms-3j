// @vitest-environment jsdom
// หน้าช่างหลัง 0173 + รอบแก้ QA/security 12 ต.ค.: แพ้การแย่งรับ (เหลือง) · น้ำหนักจุลภาค/กำกวม · เตือนต่าง >20% · ถามก่อนปิดขั้นคนอื่น · prev_not_sent · +1/+5/+10 · แถบขั้น ±1
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/x" }));
const workerReceiveStage = vi.fn();
const workerSendStage = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  workerLogin: vi.fn(),
  workerLogout: vi.fn(),
  workerReceiveStage: (...a: unknown[]) => workerReceiveStage(...a),
  workerSendStage: (...a: unknown[]) => workerSendStage(...a),
}));

import { WorkerApp } from "./WorkerApp";
import type { WorkerView } from "@/lib/jobs/worker-view";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WA = "11111111-1111-4111-8111-111111111111";
type St = "pending" | "received" | "sent" | "skipped";
const stagesOf = (statuses: St[]) =>
  statuses.map((status, i) => ({ seq: i + 1, code: `c${i + 1}`, name: ["ฉีดเทียน", "หล่อ", "ตัดต้น", "ขัด", "ชุบ", "ตรวจ QC", "แพ็ก"][i] ?? `ขั้น${i + 1}`, status })) as WorkerView["job"]["stages"];

const view = (o: Partial<WorkerView> = {}, statuses: St[] = ["sent", "pending", "pending"]): WorkerView => ({
  job: { jobNo: "JB-0007", status: "in_progress", stages: stagesOf(statuses), designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, dueDate: "2026-10-30" },
  viewer: { workerId: WA, displayName: "ช่างเอ" },
  sessionExpired: false,
  nextAction: "receive",
  actionStage: { seq: 2, code: "c2", name: "หล่อ", weightRequired: true },
  prevWeightOutG: 10,
  heldBy: null,
  workers: [],
  scrapReasons: ["porosity", "other"],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  workerReceiveStage.mockResolvedValue({ ok: true });
  workerSendStage.mockResolvedValue({ ok: true });
});

describe("แพ้การแย่งรับขั้น (QA3)", () => {
  it("คนอื่นชนะ (already + by คนอื่น) → ไอคอนเหลือง + 'ช่าง X รับขั้นนี้ไปแล้ว' ไม่ใช่เครื่องหมายถูกเขียว", async () => {
    workerReceiveStage.mockResolvedValue({ ok: true, already: true, by: "ช่างบี", message: "ช่าง ช่างบี รับขั้นนี้ไปแล้ว" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(await screen.findByTestId("done-warn")).toBeInTheDocument();
    expect(screen.queryByTestId("done-ok")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("ช่างบี รับขั้นนี้ไปแล้ว");
    await userEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("กดซ้ำของตัวเอง (already + by = ชื่อเรา) → ถือว่าสำเร็จ เครื่องหมายถูกเขียว", async () => {
    workerReceiveStage.mockResolvedValue({ ok: true, already: true, by: "ช่างเอ", message: "x" });
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(await screen.findByTestId("done-ok")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("รับงานแล้ว — หล่อ");
  });
});

describe("น้ำหนัก: จุลภาค/กำกวม (QA1)", () => {
  it("'95,5' = 95.5 (ไม่ใช่ 955) ส่งต่อให้ server ตามที่พิมพ์ (server แปลงด้วยกฎเดียวกัน)", async () => {
    render(<WorkerApp token={TOKEN} view={view({ prevWeightOutG: null, actionStage: { seq: 2, code: "c2", name: "หล่อ", weightRequired: true } })} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "95,5");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, "95,5"));
  });

  it("'1,234.5' กำกวม → เตือนที่ช่อง ไม่เรียก server", async () => {
    render(<WorkerApp token={TOKEN} view={view({ prevWeightOutG: null })} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "1,234.5");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.getByRole("alert")).toHaveTextContent("กำกวม");
    expect(workerReceiveStage).not.toHaveBeenCalled();
  });
});

describe("น้ำหนักต่างจากขั้นก่อน > 20% → ถามยืนยัน (เตือน ไม่บล็อก)", () => {
  it("12.5 vs 10 (25%) → ถามก่อน · 'กลับไปแก้' ไม่ส่ง · 'ยืนยัน' ส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "12.5");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ต่างจากที่ขั้นก่อนส่งมา");
    expect(workerReceiveStage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "กลับไปแก้" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, "12.5"));
  });

  it("ขอบ: ต่าง 20% พอดี (12 vs 10) ไม่ถาม · ต่ำกว่า 20% ไม่ถาม", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "12");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, "12"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("น้ำหนักน้อยกว่า 20% ก็ถาม (ทั้งสองทิศ)", async () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "7");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("ขั้นก่อนยังอยู่กับคนอื่น (ขั้นไม่บังคับชั่ง auto-close)", () => {
  it("ถามก่อน 'จะปิดขั้นของ X ให้' แล้วค่อยส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={view({ heldBy: "ช่างบี", prevWeightOutG: null, actionStage: { seq: 2, code: "c2", name: "หล่อ", weightRequired: false } })} />);
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ปิดขั้นของ ช่างบี ให้");
    expect(workerReceiveStage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ยืนยัน รับงาน" }));
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, null));
  });
});

describe("prev_not_sent / all_done (QA5-6)", () => {
  it("server ตอบ prev_not_sent ตอนรับ → ข้อความมีชื่อขั้นก่อน", async () => {
    workerReceiveStage.mockResolvedValue({ ok: false, error: "x", code: "prev_not_sent" });
    render(<WorkerApp token={TOKEN} view={view({ prevWeightOutG: null }, ["received", "pending", "pending"])} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ขั้นก่อน (ฉีดเทียน) ยังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ");
  });

  it("next_action = prev_not_sent → ข้อความมีชื่อขั้นก่อน ไม่มีปุ่มรับ", () => {
    render(<WorkerApp token={TOKEN} view={view({ nextAction: "prev_not_sent" }, ["received", "pending", "pending"])} />);
    expect(screen.getByText(/ขั้นก่อน \(ฉีดเทียน\) ยังไม่กดส่งพร้อมน้ำหนัก/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รับงาน" })).not.toBeInTheDocument();
  });

  it("all_done ทั้งที่ยังไม่ระบุตัว → 'งานนี้ทำครบแล้ว รอออฟฟิศปิดงาน' ไม่ถามชื่อ", () => {
    render(<WorkerApp token={TOKEN} view={view({ viewer: null, nextAction: "all_done", actionStage: null }, ["sent", "sent", "skipped"])} />);
    expect(screen.getByText("งานนี้ทำครบแล้ว รอออฟฟิศปิดงาน")).toBeInTheDocument();
    expect(screen.queryByText(/คุณคือใคร/)).not.toBeInTheDocument();
  });
});


describe("ส่งต่อ: ของเสีย +1/+5/+10 และน้ำหนักจุลภาค", () => {
  const send = () => view({ nextAction: "send", prevWeightOutG: null }, ["sent", "received", "pending"]);
  const count = () => Number(document.querySelector("output")!.textContent);

  it("ปุ่มลัดบวก/ลบ ไม่ต่ำกว่า 0 ไม่เกิน 1000", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย 10 ชิ้น" }));
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย 5 ชิ้น" }));
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มของเสีย" }));
    expect(count()).toBe(16);
    await userEvent.click(screen.getByRole("button", { name: "ลดของเสีย 10 ชิ้น" }));
    expect(count()).toBe(6);
    await userEvent.click(screen.getByRole("button", { name: "ลดของเสีย 10 ชิ้น" }));
    expect(count()).toBe(0);
    expect(screen.getByRole("button", { name: "ลดของเสีย 5 ชิ้น" })).toBeDisabled();
  });

  it("ปุ่มลัดทุกปุ่มสูง ≥ 56px (min-h-14)", () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    for (const n of ["เพิ่มของเสีย 10 ชิ้น", "เพิ่มของเสีย 5 ชิ้น", "ลดของเสีย 10 ชิ้น", "ลดของเสีย 5 ชิ้น"]) expect(screen.getByRole("button", { name: n }).className).toMatch(/min-h-14/);
  });

  it("น้ำหนักออก '95,5' ผ่าน · '1,2,3' กำกวม ไม่ส่ง", async () => {
    render(<WorkerApp token={TOKEN} view={send()} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "1,2,3");
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("กำกวม");
    expect(workerSendStage).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/น้ำหนักออก/));
    await userEvent.type(screen.getByLabelText(/น้ำหนักออก/), "95,5");
    await userEvent.click(screen.getByRole("button", { name: /ส่งต่อ/ }));
    await waitFor(() => expect(workerSendStage).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ weightOut: "95,5", qtyScrap: 0 })));
  });
});

describe("แถบขั้นตอน: ปัจจุบัน ±1 · กางดูทั้งหมดได้ · อยู่ใต้ปุ่มหลัก (QA4)", () => {
  const seven = (): St[] => ["sent", "sent", "sent", "pending", "pending", "pending", "pending"];
  const v = () => view({ actionStage: { seq: 4, code: "c4", name: "ขัด", weightRequired: true }, prevWeightOutG: null }, seven());

  it("เห็นเฉพาะขั้นก่อน-ปัจจุบัน-ถัดไป จนกว่าจะกด 'ดูขั้นทั้งหมด'", async () => {
    render(<WorkerApp token={TOKEN} view={v()} />);
    const list = screen.getByRole("list");
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list).toHaveTextContent("ตัดต้น");
    expect(list).toHaveTextContent("ขัด");
    expect(list).toHaveTextContent("ชุบ");
    expect(list).not.toHaveTextContent("ฉีดเทียน");
    await userEvent.click(screen.getByRole("button", { name: /ดูขั้นทั้งหมด \(7\)/ }));
    expect(screen.getByRole("list").querySelectorAll("li")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "ย่อรายการขั้น" }));
    expect(screen.getByRole("list").querySelectorAll("li")).toHaveLength(3);
  });

  it("งานสั้น (≤3 ขั้น) แสดงครบ ไม่มีปุ่มกาง", () => {
    render(<WorkerApp token={TOKEN} view={view()} />);
    expect(screen.getByRole("list").querySelectorAll("li")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /ดูขั้นทั้งหมด/ })).not.toBeInTheDocument();
  });

  it("ปุ่มหลักมาก่อนแถบขั้นใน DOM (อยู่จอแรก)", () => {
    render(<WorkerApp token={TOKEN} view={v()} />);
    const btn = screen.getByRole("button", { name: "รับงาน" });
    const strip = screen.getByRole("list");
    expect(btn.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ก่อน hydrate: skeleton แทนปุ่ม (ปุ่มที่กดตอนนั้นจะไม่ติด)", () => {
  it("HTML จาก SSR มี skeleton (aria-busy) และไม่มีปุ่มรับงาน/แป้น PIN/ปุ่มเปลี่ยนคนที่ใช้ไม่ได้", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(<WorkerApp token={TOKEN} view={view()} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(">รับงาน<");
    expect(html).toContain("JB-0007");
    // ปุ่มเปลี่ยนคนยังอยู่แต่ disabled
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*?ไม่ใช่คุณ/);
  });
});

describe("0174 รอบ 2: ส่งต่อติดล่าง (N2) · รอข้อมูลใหม่ (N5) · งานทอง", () => {
  it("N2: ปุ่มหลักของรับงาน/ส่งต่ออยู่ในกล่อง sticky ติดล่างจอ (จอ 390x740 กดได้โดยไม่ต้องเลื่อนหา)", () => {
    const { unmount } = render(<WorkerApp token={TOKEN} view={view()} />);
    expect(screen.getByRole("button", { name: "รับงาน" }).parentElement!.className).toMatch(/sticky bottom-0/);
    unmount();
    render(<WorkerApp token={TOKEN} view={view({ nextAction: "send", prevWeightOutG: null }, ["sent", "received", "pending"])} />);
    expect(screen.getByRole("button", { name: /ส่งต่อ/ }).parentElement!.className).toMatch(/sticky bottom-0/);
  });

  it("N5: หลังจอสำเร็จ แผงเก่าถูกแทนด้วย skeleton จนกว่าข้อมูลใหม่มา (กดแผงเก่าไม่ได้) แล้วแผงใหม่ขึ้นเมื่อ view เปลี่ยน", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerender } = render(<WorkerApp token={TOKEN} view={view()} />);
      await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
      await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
      await screen.findByTestId("done-ok");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("status", { name: "กำลังโหลด" })).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByRole("button", { name: "รับงาน" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ไม่ใช่คุณ/ })).toBeDisabled();
      // ข้อมูลใหม่มา (ขั้นถัดไปเป็นของส่งต่อ)
      rerender(<WorkerApp token={TOKEN} view={view({ nextAction: "send", prevWeightOutG: null }, ["sent", "received", "pending"])} />);
      expect(screen.queryByRole("status", { name: "กำลังโหลด" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ส่งต่อ/ })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("N5: ถ้าข้อมูลใหม่ไม่มาใน 8 วิ ก็ไม่ค้าง skeleton ตลอดไป", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<WorkerApp token={TOKEN} view={view()} />);
      await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
      await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
      await screen.findByTestId("done-ok");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByRole("status", { name: "กำลังโหลด" })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100);
      });
      expect(screen.queryByRole("status", { name: "กำลังโหลด" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("งานทอง: prev_weight_out_g = null → ไม่มีข้อความ 'ครั้งก่อนส่งออก' และไม่มีกล่องเตือน 20% ไม่ว่าใส่น้ำหนักเท่าไร", async () => {
    render(<WorkerApp token={TOKEN} view={view({ prevWeightOutG: null })} />);
    expect(screen.queryByText(/ครั้งก่อนส่งออก/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "999");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(workerReceiveStage).toHaveBeenCalledWith(TOKEN, 2, "999"));
  });

  it("DB ปฏิเสธ handoff_mismatch (ทอง): แสดงข้อความตายตัวของ server ไม่มีส่วนต่าง · กรอกใหม่ได้", async () => {
    workerReceiveStage.mockResolvedValue({ ok: false, error: "น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ", code: "handoff_mismatch" });
    render(<WorkerApp token={TOKEN} view={view({ prevWeightOutG: null })} />);
    await userEvent.type(screen.getByLabelText(/น้ำหนักเข้า/), "10");
    await userEvent.click(screen.getByRole("button", { name: "รับงาน" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ");
    expect(alert.textContent).not.toMatch(/[0-9]/);
    expect(screen.getByRole("button", { name: "รับงาน" })).toBeEnabled();
  });

  it("prev_not_sent จาก resolve + มีผู้ถือ → ข้อความรอทันที ไม่มีปุ่มรับ และไม่มีกล่อง 'จะปิดขั้นของ X ให้'", () => {
    render(<WorkerApp token={TOKEN} view={view({ nextAction: "prev_not_sent", heldBy: "ช่างบี" }, ["received", "pending", "pending"])} />);
    expect(screen.getByText(/ขั้นก่อน \(ฉีดเทียน\) ยังไม่กดส่งพร้อมน้ำหนัก/)).toBeInTheDocument();
    expect(screen.getByText(/ช่างบี/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รับงาน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
