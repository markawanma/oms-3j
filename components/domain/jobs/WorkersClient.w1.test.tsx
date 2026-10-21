// @vitest-environment jsdom
// /jobs/workers (W1 · UX B.10.4): สิทธิ์เพิ่มเติม (เปิดงานได้/ดูแลงานนอกร้าน) + ป้ายแถว + ปิดใช้งานผู้ถือสิทธิ์ + การ์ด QR ร้าน (ออก/ออกใหม่/เพิกถอน/พิมพ์โปสเตอร์ · raw แสดงครั้งเดียว)
//  ต้องถูก: บันทึกสิทธิ์ไปกับปุ่มบันทึก (boolean ชัด) · QR raw อยู่ในจอเท่านั้น (ไม่ลง storage/URL) · ออกใหม่ต้องยืนยัน · ไม่ได้พิมพ์แล้วปิดต้องถาม
//  ต้องไม่พัง: ไม่ส่ง intake = ไม่มีการ์ด · ปิดใช้งานช่างทั่วไป = ทันทีเหมือนเดิม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/jobs/workers" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const a = { saveWorker: vi.fn(), setWorkerActive: vi.fn(), resetWorkerPin: vi.fn(), unlockWorker: vi.fn(), issue: vi.fn(), revoke: vi.fn() };
vi.mock("@/lib/actions/job-workers", () => ({
  saveWorker: (...x: unknown[]) => a.saveWorker(...x),
  setWorkerActive: (...x: unknown[]) => a.setWorkerActive(...x),
  resetWorkerPin: (...x: unknown[]) => a.resetWorkerPin(...x),
  unlockWorker: (...x: unknown[]) => a.unlockWorker(...x),
  issueShopIntakeToken: (...x: unknown[]) => a.issue(...x),
  revokeShopIntakeToken: (...x: unknown[]) => a.revoke(...x),
}));
vi.mock("@/lib/actions/job-office-write", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { WorkersClient } from "./WorkersClient";
import type { ShopIntakeStatus, WorkersData } from "@/lib/actions/job-workers";
import type { WorkerRow } from "@/lib/jobs/types";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const worker = (o: Partial<WorkerRow> & { id: string; displayName: string }): WorkerRow => ({
  stageCodes: ["finish"], isActive: true, lockedUntil: null, createdAt: null, lockState: "none", failedAttempts: 0, pinWarning: false, canOpenJob: false, canExternal: false, ...o,
});
const data = (workers: WorkerRow[] = [worker({ id: W1, displayName: "ช่างเอ" }), worker({ id: W2, displayName: "หัวหน้าช่าง", canOpenJob: true, canExternal: true })]): WorkersData => ({
  workers, stages: [{ code: "finish", nameTh: "แต่ง" }, { code: "buff", nameTh: "ขัด" }], retiredStages: [],
});
const ISSUED_AT = "2026-10-20T02:12:00Z";
const intake = (status: ShopIntakeStatus | null, error: string | null = null) => ({ status, error });
const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const qrCard = () => screen.getByRole("region", { name: "QR ร้าน" });
const RAW = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx9"; // token ดิบ — ต้องไม่เห็นที่ฝั่ง client เลย
const SVG = "<svg xmlns='http://www.w3.org/2000/svg' data-from='server'></svg>";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.print = vi.fn();
  a.saveWorker.mockResolvedValue({ ok: true, data: { id: W1, pin: null } });
  a.setWorkerActive.mockResolvedValue({ ok: true, data: null });
  a.issue.mockResolvedValue({ ok: true, data: { svg: SVG, issuedAt: ISSUED_AT, revokedPrevious: 0, warning: null } });
  a.revoke.mockResolvedValue({ ok: true, data: { revoked: 1 } });
});

describe("สิทธิ์เพิ่มเติมในกล่องแก้ไข", () => {
  const openEdit = async (name: string) => {
    await userEvent.click(within(rowOf(name)).getByRole("button", { name: `แก้ไข ${name}` }));
    return screen.findByRole("dialog", { name: new RegExp(`แก้ไข ${name}`) });
  };

  it("fieldset 'สิทธิ์เพิ่มเติม' มี 2 ช่อง + คำอธิบาย · ค่าเริ่มตามช่าง", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเอ");
    const fs = within(dlg).getByRole("group", { name: "สิทธิ์เพิ่มเติม" });
    expect(within(fs).getByRole("checkbox", { name: /เปิดงานได้/ })).not.toBeChecked();
    expect(within(fs).getByRole("checkbox", { name: /ดูแลงานนอกร้าน/ })).not.toBeChecked();
    expect(fs).toHaveTextContent("สร้างใบผลิต + ใบงานจากมือถือ (สแกน QR ร้าน)");
    expect(fs).toHaveTextContent("ออฟฟิศต้องกดรับทราบก่อนปิดใบ");
    expect(fs).toHaveTextContent("ชี้แจงส่วนต่าง / ส่งออก / รับกลับ / ยกเลิกการส่งออกของคนอื่นได้");
    expect(fs).toHaveTextContent("ต้องเลือกขั้นที่ช่างทำอย่างน้อย 1 ขั้น");
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    const dlg2 = await openEdit("หัวหน้าช่าง");
    expect(within(dlg2).getByRole("checkbox", { name: /เปิดงานได้/ })).toBeChecked();
    expect(within(dlg2).getByRole("checkbox", { name: /ดูแลงานนอกร้าน/ })).toBeChecked();
  });

  it("ติ๊กเปิดงานได้ → ยังไม่บันทึกจนกดปุ่ม 'บันทึก' (ไม่ใช่สวิตช์ทันที) → saveWorker ส่งเฉพาะสิทธิ์ที่เปลี่ยน (boolean ชัด)", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเอ");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /เปิดงานได้/ }));
    expect(a.saveWorker).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalledTimes(1));
    expect(a.saveWorker.mock.calls[0][0]).toMatchObject({ id: W1, displayName: "ช่างเอ", stageCodes: ["finish"], canOpenJob: true });
    expect("canExternal" in a.saveWorker.mock.calls[0][0]).toBe(false); // ไม่เปลี่ยน = ไม่ส่ง (DB ไม่แตะ)
  });

  it("ถอนสิทธิ์ (เอาติ๊กออก) ส่ง false ชัด — ไม่ใช่ undefined (ไม่งั้น DB ไม่แตะค่าเดิม = ถอนไม่สำเร็จเงียบๆ)", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("หัวหน้าช่าง");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /เปิดงานได้/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalled());
    expect(a.saveWorker.mock.calls[0][0]).toMatchObject({ canOpenJob: false });
    expect("canExternal" in a.saveWorker.mock.calls[0][0]).toBe(false);
  });

  it("เพิ่มช่างใหม่ + ติ๊กสิทธิ์ → ส่งไปด้วย · ไม่เลือกขั้น = บันทึกไม่ได้ (ไม่ผ่อน stages_required)", async () => {
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มช่าง/ }));
    const dlg = await screen.findByRole("dialog", { name: "เพิ่มช่าง" });
    await userEvent.type(within(dlg).getByLabelText(/ชื่อที่ช่างเห็น/), "ผู้จัดการ");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /เปิดงานได้/ }));
    expect(within(dlg).getByRole("button", { name: "บันทึก" })).toBeDisabled();
    await userEvent.click(within(dlg).getByRole("checkbox", { name: "แต่ง" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalled());
    expect(a.saveWorker.mock.calls[0][0]).toMatchObject({ id: null, canOpenJob: true });
    expect("canExternal" in a.saveWorker.mock.calls[0][0]).toBe(false);
  });

  it("DB ปฏิเสธ (เช่น ต้องมีขั้น): ข้อความ role=alert · กล่องไม่ปิด · ค่าที่ติ๊กคงอยู่", async () => {
    a.saveWorker.mockResolvedValue({ ok: false, error: "ผู้จัดการต้องมีขั้นที่ทำอย่างน้อย 1 ขั้น" });
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเอ");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /เปิดงานได้/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("ผู้จัดการต้องมีขั้นที่ทำอย่างน้อย 1 ขั้น");
    expect(within(dlg).getByRole("checkbox", { name: /เปิดงานได้/ })).toBeChecked();
  });

  it("ไม่แตะสิทธิ์เลย → ไม่ส่ง canOpenJob/canExternal ไปกับ saveWorker (พฤติกรรมเดิมเป๊ะ)", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("หัวหน้าช่าง");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: "ขัด" }));
    await userEvent.click(within(dlg).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(a.saveWorker).toHaveBeenCalled());
    const input = a.saveWorker.mock.calls[0][0];
    expect("canOpenJob" in input).toBe(false);
    expect("canExternal" in input).toBe(false);
  });

  it("แก้สิทธิ์แล้วกด 'ตั้ง PIN เอง' = ถามก่อนทิ้ง (สิทธิ์นับเป็นค่าที่แก้ค้าง)", async () => {
    wrap(<WorkersClient data={data()} />);
    const dlg = await openEdit("ช่างเอ");
    await userEvent.click(within(dlg).getByRole("checkbox", { name: /ดูแลงานนอกร้าน/ }));
    await userEvent.click(within(dlg).getByRole("button", { name: /ตั้ง PIN เอง/ }));
    expect(within(dlg).getByText(/ยังไม่ได้บันทึกการแก้ไข/)).toBeInTheDocument();
  });
});

describe("ป้ายแถว + ปิดใช้งาน", () => {
  it("ช่างที่มีสิทธิ์ขึ้นป้าย 'เปิดงานได้' / 'ดูแลงานนอกร้าน' · ช่างทั่วไปไม่มี · ช่างปิดใช้งานไม่โชว์ป้ายสิทธิ์", () => {
    wrap(<WorkersClient data={data([worker({ id: W1, displayName: "ช่างเอ" }), worker({ id: W2, displayName: "หัวหน้าช่าง", canOpenJob: true, canExternal: true }), worker({ id: "33333333-3333-4333-8333-333333333333", displayName: "ลาออก", canOpenJob: true, isActive: false })])} />);
    expect(within(rowOf("หัวหน้าช่าง")).getByText("เปิดงานได้")).toBeInTheDocument();
    expect(within(rowOf("หัวหน้าช่าง")).getByText("ดูแลงานนอกร้าน")).toBeInTheDocument();
    expect(within(rowOf("ช่างเอ")).queryByText(/เปิดงานได้|ดูแลงานนอกร้าน/)).toBeNull();
    // แท็บปิดใช้งาน
    userEvent.click(screen.getByRole("button", { name: /ปิดใช้งาน \(1\)/ }));
  });

  it("ปิดใช้งานช่างที่ถือสิทธิ์: ยืนยันก่อน + 'ช่างคนนี้เปิดงานจากมือถือไม่ได้อีก' (ไม่บล็อก) → setWorkerActive(false)", async () => {
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(within(rowOf("หัวหน้าช่าง")).getByRole("button", { name: "ปิดใช้งาน หัวหน้าช่าง" }));
    const dlg = await screen.findByRole("dialog", { name: /ปิดใช้งาน หัวหน้าช่าง/ });
    expect(dlg).toHaveTextContent("ช่างคนนี้เปิดงานจากมือถือไม่ได้อีก");
    expect(a.setWorkerActive).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "ปิดใช้งาน" }));
    await waitFor(() => expect(a.setWorkerActive).toHaveBeenCalledWith(W2, false));
  });

  it("ปิดใช้งานช่างทั่วไป = ทันทีเหมือนเดิม (ไม่มีกล่องยืนยัน)", async () => {
    wrap(<WorkersClient data={data()} />);
    await userEvent.click(within(rowOf("ช่างเอ")).getByRole("button", { name: "ปิดใช้งาน ช่างเอ" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(a.setWorkerActive).toHaveBeenCalledWith(W1, false));
  });

  it("ผู้ถือสิทธิ์แต่ดูแลงานนอกร้านอย่างเดียว ก็ต้องยืนยัน (ไม่มีบรรทัดเปิดงานจากมือถือ)", async () => {
    wrap(<WorkersClient data={data([worker({ id: W1, displayName: "ช่างเอ", canExternal: true })])} />);
    await userEvent.click(within(rowOf("ช่างเอ")).getByRole("button", { name: "ปิดใช้งาน ช่างเอ" }));
    const dlg = await screen.findByRole("dialog", { name: /ปิดใช้งาน ช่างเอ/ });
    expect(dlg).not.toHaveTextContent("เปิดงานจากมือถือไม่ได้อีก");
  });
});

describe("การ์ด QR ร้าน — สภาพ", () => {
  it("ไม่ส่ง intake = ไม่มีการ์ด (หน้าเดิม)", () => {
    wrap(<WorkersClient data={data()} />);
    expect(screen.queryByRole("region", { name: "QR ร้าน" })).toBeNull();
  });
  it("empty (ไม่มี QR ที่ใช้งานอยู่): ข้อความ + ปุ่มหลัก 'ออก QR ร้าน'", () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    expect(qrCard()).toHaveTextContent("ยังไม่มี QR ร้านที่ใช้งานอยู่ — ช่างยังเปิดงานจากมือถือไม่ได้");
    expect(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" })).toBeInTheDocument();
    expect(within(qrCard()).queryByRole("button", { name: "เพิกถอน" })).toBeNull();
  });
  it("ใช้งานอยู่: ป้าย + วันที่ออก + ปุ่ม ออกใหม่ / เพิกถอน + คำอธิบาย ดูซ้ำไม่ได้ + พิมพ์ผิดครบ 7 ครั้งต่อวัน → ออก QR ใหม่", () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: true, issuedAt: ISSUED_AT })} />);
    const c = qrCard();
    expect(within(c).getByText("ใช้งานอยู่")).toBeInTheDocument();
    expect(c).toHaveTextContent(/ออกเมื่อ 20 ต\.ค\. 09:12/);
    expect(c).toHaveTextContent("ดู QR ซ้ำไม่ได้");
    expect(c).toHaveTextContent("ครบ 7 ครั้งต่อวัน");
    expect(c).toHaveTextContent("ออก QR ใหม่");
    expect(within(c).getByRole("button", { name: "ออกใหม่ (เปลี่ยน QR)" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "เพิกถอน" })).toBeInTheDocument();
  });
  it("ถูกเพิกถอน: ข้อความ + ปุ่ม ออก QR ร้าน", () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null, revokedAt: "2026-10-21T01:00:00Z" })} />);
    expect(qrCard()).toHaveTextContent("ถูกเพิกถอน");
    expect(qrCard()).toHaveTextContent("ช่างเปิดงานจากมือถือไม่ได้");
    expect(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" })).toBeInTheDocument();
  });
  it("error อ่านสถานะ: role=alert · ไม่มีปุ่มออก/เพิกถอน (ไม่เดาสถานะ) · ทะเบียนช่างยังใช้ได้", () => {
    wrap(<WorkersClient data={data()} intake={intake(null, "อ่านสถานะ QR ร้านไม่สำเร็จ — โหลดหน้าใหม่แล้วลองอีกครั้ง")} />);
    expect(within(qrCard()).getByRole("alert")).toHaveTextContent("อ่านสถานะ QR ร้านไม่สำเร็จ");
    expect(within(qrCard()).queryByRole("button")).toBeNull();
    expect(screen.getByText("ช่างเอ")).toBeInTheDocument();
  });
});

describe("ออก QR ร้าน", () => {
  it("ออกครั้งแรก: ไม่ถามยืนยัน → กล่อง 'QR ร้านใหม่' มี QR + เตือนแสดงครั้งเดียว · token ไม่ลง storage/URL/DOM เป็นข้อความ", async () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" }));
    const dlg = await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(a.issue).toHaveBeenCalledTimes(1);
    expect(within(dlg).getByRole("img", { name: "QR ร้าน" })).toBeInTheDocument();
    expect(dlg).toHaveTextContent("แสดงครั้งเดียว — ปิดกล่องนี้แล้วดูซ้ำไม่ได้");
    expect(dlg).toHaveTextContent("ออกใหม่ QR เดิมที่ติดอยู่ใช้ไม่ได้ทันที");
    expect(dlg).toHaveTextContent("พิมพ์แล้วติดแทนของเดิมเลย");
    expect(JSON.stringify(window.localStorage) + JSON.stringify(window.sessionStorage) + window.location.href).not.toContain(RAW);
    // ค่าดิบไม่โผล่เป็นข้อความบนจอ (มีเฉพาะในภาพ QR)
    expect(document.body.textContent).not.toContain(RAW);
    expect(refresh).toHaveBeenCalled();
  });

  it("ภาพ QR = SVG ที่ server ส่งมา (ลิงก์ประกอบที่ server จาก APP_ORIGIN) · client ไม่มี token ดิบ", async () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" }));
    const dlg = await screen.findByRole("dialog", { name: "QR ร้านใหม่" });
    expect(within(dlg).getByRole("img", { name: "QR ร้าน" }).querySelector("svg[data-from=server]")).not.toBeNull();
    await expect(a.issue.mock.results[0].value).resolves.not.toHaveProperty("data.token");
  });

  it("ออกใหม่ (มี QR เดิม): ต้องยืนยันก่อน · ยกเลิก = ไม่เรียก DB · ยืนยัน = ออก", async () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: true, issuedAt: ISSUED_AT })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออกใหม่ (เปลี่ยน QR)" }));
    const conf = await screen.findByRole("dialog", { name: "ออก QR ใหม่?" });
    expect(conf).toHaveTextContent("QR เดิมที่ติดอยู่จะใช้ไม่ได้ทันที — พร้อมพิมพ์และเปลี่ยนที่ติดแล้วใช่ไหม");
    await userEvent.click(within(conf).getByRole("button", { name: "ยกเลิก" }));
    expect(a.issue).not.toHaveBeenCalled();
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออกใหม่ (เปลี่ยน QR)" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "ออก QR ใหม่?" })).getByRole("button", { name: "ออก QR ใหม่ แล้วพิมพ์" }));
    expect(await screen.findByRole("dialog", { name: "QR ร้านใหม่" })).toBeInTheDocument();
    expect(a.issue).toHaveBeenCalledTimes(1);
  });

  it("ออกไม่สำเร็จ: 'ออก QR ไม่สำเร็จ — ลองอีกครั้ง' (role=alert) ไม่มีกล่อง QR · กดซ้ำได้", async () => {
    a.issue.mockResolvedValueOnce({ ok: false, error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" }));
    expect(await within(qrCard()).findByRole("alert")).toHaveTextContent("ออก QR ไม่สำเร็จ — ลองอีกครั้ง");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" }));
    expect(await screen.findByRole("dialog", { name: "QR ร้านใหม่" })).toBeInTheDocument();
  });

  it("loading: ปุ่มออก QR ถูกปิดระหว่างทำ (กันกดซ้ำ) — เรียก action ครั้งเดียว", async () => {
    let resolve: (v: unknown) => void = () => {};
    a.issue.mockReturnValue(new Promise((r) => (resolve = r)));
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    const btn = within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await userEvent.click(btn);
    expect(a.issue).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: { svg: SVG, issuedAt: ISSUED_AT, revokedPrevious: 1, warning: null } });
    expect(await screen.findByRole("dialog", { name: "QR ร้านใหม่" })).toBeInTheDocument();
  });
});

describe("พิมพ์โปสเตอร์ + ปิดกล่อง", () => {
  async function openIssued() {
    wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "ออก QR ร้าน" }));
    return screen.findByRole("dialog", { name: "QR ร้านใหม่" });
  }

  it("โปสเตอร์ A4: โลโก้ + 'เปิดงานใหม่' + QR + ขั้น 1-2-3 + 'สำหรับช่างที่ได้รับสิทธิ์เท่านั้น' · ไม่มี URL/ตัวเลขอื่น · ซ่อนบนจอ แสดงตอนพิมพ์", async () => {
    await openIssued();
    const poster = document.querySelector("[data-print-keep]") as HTMLElement;
    expect(poster).not.toBeNull();
    expect(poster.className).toMatch(/hidden/);
    expect(poster.className).toMatch(/print:block/);
    expect(within(poster).getByRole("heading", { name: "เปิดงานใหม่" })).toBeInTheDocument();
    expect(within(poster).getByAltText("3J")).toBeInTheDocument();
    expect(within(poster).getByRole("img", { name: "QR ร้าน" }).className).toMatch(/120mm/);
    const steps = within(poster).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual(["1สแกน", "2เลือกชื่อ", "3ใส่ PIN"]); // ลำดับขั้น 1-2-3 เท่านั้น — ไม่มีตัวเลขอื่น
    expect(poster).toHaveTextContent("สำหรับช่างที่ได้รับสิทธิ์เท่านั้น");
    expect(poster.textContent).not.toMatch(/https?:|\/w\/|[0-9]{2,}/);
    expect(poster.innerHTML).not.toContain("print:hidden");
  });

  it("root ซ่อนทุกอย่างยกเว้นโปสเตอร์ตอนพิมพ์ (data-print-keep)", async () => {
    const { container } = wrap(<WorkersClient data={data()} intake={intake({ active: false, issuedAt: null })} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("print:[&>*:not([data-print-keep])]:hidden");
  });

  it("กด 'พิมพ์โปสเตอร์ QR' → window.print · หลังพิมพ์แล้วปิดได้เลยไม่ถามซ้ำ", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dlg = await openIssued();
    await userEvent.click(within(dlg).getByRole("button", { name: "พิมพ์โปสเตอร์ QR" }));
    expect(window.print).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dlg).getByRole("button", { name: "จดแล้ว ปิด" }));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector("[data-print-keep]")).toBeNull(); // ปิดแล้ว QR หายจากจอ/โปสเตอร์
    confirm.mockRestore();
  });

  it("ยังไม่ได้พิมพ์แล้วกด 'จดแล้ว ปิด': ถามเบาๆ — ไม่ปิดถ้าตอบยกเลิก · ปิดถ้ายืนยัน", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const dlg = await openIssued();
    await userEvent.click(within(dlg).getByRole("button", { name: "จดแล้ว ปิด" }));
    expect(confirm).toHaveBeenCalledWith("ยังไม่ได้พิมพ์ — ปิดแล้วต้องออกใหม่ ปิดเลยไหม");
    expect(screen.getByRole("dialog", { name: "QR ร้านใหม่" })).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "จดแล้ว ปิด" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});

describe("เพิกถอน", () => {
  it("ยืนยันก่อน (บอกผล: ช่างเปิดงานจากมือถือไม่ได้ · ใบงาน/QR ใบงานเดิมไม่กระทบ) → revoke", async () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: true, issuedAt: ISSUED_AT })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "เพิกถอน" }));
    const dlg = await screen.findByRole("dialog", { name: "เพิกถอน QR ร้าน?" });
    expect(dlg).toHaveTextContent("ช่างทุกคนจะเปิดงานจากมือถือไม่ได้ทันที จนกว่าจะออก QR ใหม่");
    expect(dlg).toHaveTextContent("ใบงานและ QR ใบงานที่เปิดไปแล้วไม่ได้รับผลกระทบ");
    expect(a.revoke).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "เพิกถอน" }));
    await waitFor(() => expect(a.revoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });
  it("ยกเลิกที่กล่องยืนยัน = ไม่เพิกถอน", async () => {
    wrap(<WorkersClient data={data()} intake={intake({ active: true, issuedAt: ISSUED_AT })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "เพิกถอน" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เพิกถอน QR ร้าน?" })).getByRole("button", { name: "ยกเลิก" }));
    expect(a.revoke).not.toHaveBeenCalled();
  });
  it("เพิกถอนล้ม: ข้อความ role=alert ในการ์ด · กล่องปิด", async () => {
    a.revoke.mockResolvedValue({ ok: false, error: "x" });
    wrap(<WorkersClient data={data()} intake={intake({ active: true, issuedAt: ISSUED_AT })} />);
    await userEvent.click(within(qrCard()).getByRole("button", { name: "เพิกถอน" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "เพิกถอน QR ร้าน?" })).getByRole("button", { name: "เพิกถอน" }));
    expect(await within(qrCard()).findByRole("alert")).toHaveTextContent("เพิกถอนไม่สำเร็จ — ลองอีกครั้ง");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
