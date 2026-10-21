// @vitest-environment jsdom
// W2 UI: W-9 "ใบที่ฉันเปิด" (4 state) · W-10 จอแก้รูปของใบ (เพิ่ม/ลบ/ล็อก/ปิด/PIN/ลิงก์หมดอายุ/exit guard) · ปุ่ม "ออก QR ใหม่" — ทดสอบผ่าน ShopIntakeApp จริง (mock เฉพาะ action + ตัวย่อรูป)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/w/s/x" }));
const intakeLogin = vi.fn();
const workerLogout = vi.fn();
const intakeSearch = vi.fn();
const intakeOpen = vi.fn();
const intakeUploadPhoto = vi.fn();
const intakeRemovePhoto = vi.fn();
const intakeListPhotos = vi.fn();
const intakeMyJobs = vi.fn();
const intakeReissueToken = vi.fn();
const intakeSetPrimaryPhoto = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeSetPrimaryPhoto: (...a: unknown[]) => intakeSetPrimaryPhoto(...a),
  intakeLogin: (...a: unknown[]) => intakeLogin(...a),
  workerLogout: (...a: unknown[]) => workerLogout(...a),
  intakeSearch: (...a: unknown[]) => intakeSearch(...a),
  intakeOpen: (...a: unknown[]) => intakeOpen(...a),
  intakeUploadPhoto: (...a: unknown[]) => intakeUploadPhoto(...a),
  intakeRemovePhoto: (...a: unknown[]) => intakeRemovePhoto(...a),
  intakeListPhotos: (...a: unknown[]) => intakeListPhotos(...a),
  intakeMyJobs: (...a: unknown[]) => intakeMyJobs(...a),
  intakeReissueToken: (...a: unknown[]) => intakeReissueToken(...a),
}));
const resizeMock = vi.fn();
vi.mock("@/lib/images/client", () => ({ resizeImageVariants: (f: File) => resizeMock(f) }));
const qrSpy = vi.fn();
vi.mock("@/lib/jobs/qr-client", async (orig) => {
  const m = await orig<typeof import("@/lib/jobs/qr-client")>();
  return { ...m, renderQrSvgClient: (t: string) => { qrSpy(t); return m.renderQrSvgClient(t); } };
});

import { ShopIntakeApp } from "./ShopIntakeApp";
import type { ShopInitial } from "./ShopHub";
import type { IntakeHubView } from "@/lib/jobs/worker-server";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const RAW_QR = "Qr9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx7";
const WA = "11111111-1111-4111-8111-111111111111";
const WB = "55555555-5555-4555-8555-555555555555";
const J1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const J2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const hubOf = (id = WA): ShopInitial => ({ kind: "hub", hub: { state: "ready", workers: [], worker: { id, displayName: "หัวหน้าช่าง" }, openAllowed: true, profileReady: true, goldProfileReady: true, sessionExpired: false } as IntakeHubView });
const identifyHub = (): ShopInitial => ({ kind: "hub", hub: { state: "identify", workers: [{ id: WA, displayName: "หัวหน้าช่าง" }], worker: null, openAllowed: false, profileReady: true, goldProfileReady: true, sessionExpired: true } });

const job = (o: Partial<MyIntakeJob> = {}): MyIntakeJob => ({
  jobId: J1, orderNo: "PO-2610-001", jobNo: "JB-0031", designLabel: "แหวนลายใบไม้", metal: "gold", qty: 30, createdAt: "2026-10-21T02:00:00Z", status: "open", photosCount: 2, myPhotosCount: 2, editable: true, ...o,
});
const list = (jobs: MyIntakeJob[]) => ({ ok: true, openAllowed: true, jobs, maxPhotos: 3 });
const sp = (id: string, o: Record<string, unknown> = {}) => ({ id, smUrl: `https://s/${id}_sm`, mdUrl: `https://s/${id}_md`, isPrimary: false, mine: true, ...o });
const photosRes = (photos: ReturnType<typeof sp>[], o: Record<string, unknown> = {}) => ({ ok: true, photos, count: photos.filter((p) => p.mine).length, max: 3, locked: false, lockCode: null, ...o });

const created: string[] = [];
const revoked: string[] = [];
let urlSeq = 0;
const variants = (name: string) => ({
  md: { blob: new Blob([`md-${name}`]), width: 1200, height: 900, bytes: 10, quality: 0.9 },
  sm: { blob: new Blob([`sm-${name}`]), width: 480, height: 360, bytes: 5, quality: 0.9 },
});
let uploadN = 0;

beforeEach(() => {
  vi.clearAllMocks();
  uploadN = 0;
  urlSeq = 0;
  created.length = 0;
  revoked.length = 0;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    const u = `blob:mock-${++urlSeq}`;
    created.push(u);
    return u;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
  workerLogout.mockResolvedValue({ ok: true });
  intakeSetPrimaryPhoto.mockResolvedValue({ ok: true, changed: true });
  intakeMyJobs.mockResolvedValue(list([job()]));
  intakeListPhotos.mockResolvedValue(photosRes([sp("m1", { isPrimary: true }), sp("m2")]));
  intakeRemovePhoto.mockResolvedValue({ ok: true, promotedPhotoId: null, already: false });
  intakeUploadPhoto.mockImplementation(async (_t: string, fd: FormData) => {
    uploadN += 1;
    return { ok: true, photo: sp(`n${uploadN}`, { isPrimary: fd.get("isPrimary") === "true" }), count: uploadN, max: 3 };
  });
  intakeReissueToken.mockResolvedValue({ ok: true, token: RAW_QR, printNo: 2, jobNo: "JB-0031" });
  resizeMock.mockImplementation(async (f: File) => variants(f.name));
});

const click = async (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const pick = (names: string[]) => fireEvent.change(screen.getAllByTestId("photo-input-pick")[0], { target: { files: names.map(file) } });
const waitTrue = (pred: () => boolean, timeout = 3000) =>
  waitFor(
    () => {
      if (!pred()) throw new Error("ยังไม่ถึงสถานะที่รอ");
    },
    { timeout },
  );

/** เปิด hub → รอรายการ → แตะการ์ดแรก → รอจอ W-10 โหลดเสร็จ */
async function toW10(opts: { jobs?: MyIntakeJob[] } = {}) {
  if (opts.jobs) intakeMyJobs.mockResolvedValue(list(opts.jobs));
  const view = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
  const card = await screen.findByRole("button", { name: /JB-0031/ });
  await userEvent.click(card);
  await screen.findByRole("heading", { level: 1, name: /แก้รูป JB-0031/ });
  await waitFor(() => expect(screen.queryByRole("status", { name: "กำลังโหลดรูป" })).not.toBeInTheDocument());
  return view;
}
const rows = () => within(screen.getByRole("region", { name: "รูปจากหน้างาน" })).queryAllByRole("listitem");

describe("W-9 ใบที่ฉันเปิด", () => {
  it("loading: skeleton 2 การ์ด role=status · ปุ่ม 'เปิดงานใหม่' ใช้ได้ทันทีไม่รอรายการ", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    intakeMyJobs.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    expect(await screen.findByRole("status", { name: "กำลังโหลดรายการใบ" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 2, name: "ใบที่ฉันเปิด" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeEnabled();
    expect(intakeMyJobs).toHaveBeenCalledWith(TOKEN);
    await act(async () => resolve(list([])));
  });

  it("empty: บรรทัดเดียว 'ยังไม่มีใบที่เปิดไว้' + คำอธิบาย (ไม่มีกล่องใหญ่ ไม่มีปุ่ม)", async () => {
    intakeMyJobs.mockResolvedValue(list([]));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    expect(await screen.findByText("ยังไม่มีใบที่เปิดไว้")).toBeInTheDocument();
    expect(screen.getByText("ใบที่เปิดจากมือถือและยังไม่ปิดจะมาอยู่ตรงนี้")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "กำลังโหลดรายการใบ" })).not.toBeInTheDocument();
  });

  it("error: 'โหลดรายการใบไม่ได้…' + ลองอีกครั้ง · ปุ่มเปิดงานใหม่ใช้ได้ตามเดิม · ลองอีกครั้งสำเร็จแล้วแสดงรายการ", async () => {
    intakeMyJobs.mockRejectedValueOnce(new Error("net"));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    expect(await screen.findByText("โหลดรายการใบไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeEnabled();
    await click("ลองอีกครั้ง");
    expect(await screen.findByRole("button", { name: /JB-0031/ })).toBeInTheDocument();
    expect(screen.queryByText(/โหลดรายการใบไม่ได้/)).not.toBeInTheDocument();
  });

  it("error จาก server (ok:false) ก็ขึ้นแบบเดียวกัน · session_required → โหลด hub ใหม่ (แผ่น PIN)", async () => {
    intakeMyJobs.mockResolvedValueOnce({ ok: false, error: "x", code: "error" });
    const { unmount } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    expect(await screen.findByText(/โหลดรายการใบไม่ได้/)).toBeInTheDocument();
    unmount();
    intakeMyJobs.mockResolvedValueOnce({ ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("success: การ์ดมีแค่ ชื่อแบบ · JB · ป้ายโลหะ · จำนวน · รูป n/3 · ป้ายสถานะ (ไอคอน+คำ) · การ์ดล็อกยังแตะได้ · ไม่มีเนื้อ%/น้ำหนัก/เงิน", async () => {
    intakeMyJobs.mockResolvedValue(
      list([
        job(),
        job({ jobId: J2, jobNo: "JB-0030", designLabel: "กำไลเกลียว", metal: "silver", qty: 12, myPhotosCount: 0, editable: false }),
      ]),
    );
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    const a = await screen.findByRole("button", { name: /JB-0031/ });
    expect(within(a).getByText("แหวนลายใบไม้")).toBeInTheDocument();
    expect(within(a).getByText("ทอง")).toBeInTheDocument();
    expect(within(a).getByText(/30 ชิ้น/)).toBeInTheDocument();
    expect(within(a).getByText("รูป 2/3")).toBeInTheDocument();
    expect(within(a).getByText("แก้ได้")).toBeInTheDocument();
    expect(a).toHaveClass("min-h-[88px]");
    const b = screen.getByRole("button", { name: /JB-0030/ });
    expect(within(b).getByText("ช่างรับงานแล้ว")).toBeInTheDocument();
    expect(within(b).getByText("ไม่มีรูป")).toBeInTheDocument();
    expect(within(b).getByText("เงิน")).toBeInTheDocument();
    expect(b).toBeEnabled(); // แตะได้ (ดูอย่างเดียว)
    expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|กรัม|เนื้อ|ลูกค้า|%/i);
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
    // "เปิดงานใหม่" ยังเป็นปุ่มพื้นทึบตัวเดียว · การ์ดเป็นปุ่มรอง (ขอบ)
    expect(screen.getAllByRole("button").filter((x) => x.className.includes("bg-primary-600"))).toHaveLength(1);
  });

  it("เกิน 5 ใบ: แสดง 5 ใบแรก + 'ดูทั้งหมด (8)' ขยายในหน้าเดิม · ย่อรายการได้", async () => {
    const many = Array.from({ length: 8 }, (_, i) => job({ jobId: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`, jobNo: `JB-00${40 + i}`, designLabel: `แบบ ${i + 1}` }));
    intakeMyJobs.mockResolvedValue(list(many));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await screen.findByRole("button", { name: /JB-0040/ });
    expect(screen.getAllByRole("button", { name: /^แบบ \d/ })).toHaveLength(5);
    await click("ดูทั้งหมด (8)");
    expect(screen.getAllByRole("button", { name: /^แบบ \d/ })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "ย่อรายการ" })).toHaveAttribute("aria-expanded", "true");
    await click("ย่อรายการ");
    expect(screen.getAllByRole("button", { name: /^แบบ \d/ })).toHaveLength(5);
  });

  it("รีเฟรช: โหลดใหม่ · ผลเก่าที่มาช้ากว่าไม่ทับผลใหม่", async () => {
    let first: (v: unknown) => void = () => undefined;
    intakeMyJobs.mockImplementationOnce(() => new Promise((r) => (first = r)));
    intakeMyJobs.mockImplementationOnce(() => Promise.resolve(list([job({ designLabel: "ใหม่กว่า" })])));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await waitFor(() => expect(intakeMyJobs).toHaveBeenCalledTimes(1));
    // ระหว่างโหลดปุ่มรีเฟรช disabled — ปลดด้วยการให้ผลแรกมา แล้วกดรีเฟรช: จำลองกดซ้อนผ่านการ resolve สลับลำดับ
    await act(async () => first(list([job({ designLabel: "เก่า" })])));
    expect(await screen.findByText("เก่า")).toBeInTheDocument();
    await click("รีเฟรช");
    expect(await screen.findByText("ใหม่กว่า")).toBeInTheDocument();
    expect(screen.queryByText("เก่า")).not.toBeInTheDocument();
    expect(intakeMyJobs).toHaveBeenCalledTimes(2);
  });

  it("เปลี่ยนคน (ไม่ใช่ฉัน) → รายการของคนก่อนไม่ค้าง (unmount ตามสภาพ identify)", async () => {
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await screen.findByRole("button", { name: /JB-0031/ });
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" });
    expect(screen.queryByText(/JB-0031/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "ใบที่ฉันเปิด" })).not.toBeInTheDocument();
  });
});

describe("W-10 จอแก้รูปของใบ", () => {
  it("เข้าจอ: loading skeleton (ปุ่มกลับใช้ได้) → แถวรูป · หัว 'แก้รูป JB-0031' + แบบ/โลหะ/จำนวน · แถบ sky 'แก้ได้จนช่างเริ่มรับงาน' · รูปที่บันทึกแล้วไม่โชว์ 'ส่งแล้ว' · รูปออฟฟิศ (mine=false) ไม่ขึ้น · ตัวนับ 2/3", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    intakeListPhotos.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
    expect(await screen.findByRole("status", { name: "กำลังโหลดรูป" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กลับไปใบที่ฉันเปิด" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: "แก้รูป JB-0031" })).toBeInTheDocument();
    expect(intakeListPhotos).toHaveBeenCalledWith(TOKEN, { jobId: J1 });
    await act(async () => resolve(photosRes([sp("m1", { isPrimary: true }), sp("m2"), sp("office", { mine: false, isPrimary: false })])));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText("แหวนลายใบไม้")).toBeInTheDocument();
    expect(screen.getByText("✎ แก้ได้จนช่างเริ่มรับงาน")).toBeInTheDocument();
    expect(screen.getByText("รูป 2/3")).toBeInTheDocument();
    expect(screen.queryByText("✓ ส่งแล้ว")).not.toBeInTheDocument();
    expect(within(rows()[0]).getByText("★ รูปหลัก")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกจากคลัง" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กลับ" })).toHaveClass("min-h-14");
  });

  it("empty (แก้ได้ 0 รูป): ข้อความ + ปุ่มเพิ่ม · empty (ล็อก 0 รูป): 'ใบนี้ไม่มีรูป — ช่างรับงานแล้ว เพิ่มไม่ได้' ไม่มีปุ่มเพิ่ม", async () => {
    intakeListPhotos.mockResolvedValue(photosRes([]));
    const { unmount } = await toW10();
    expect(screen.getByText("ยังไม่มีรูป — ถ่ายให้ช่างดูได้จนช่างเริ่มรับงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toBeInTheDocument();
    unmount();
    intakeListPhotos.mockResolvedValue(photosRes([], { locked: true, lockCode: "job_locked" }));
    await toW10();
    expect(screen.getByText("ใบนี้ไม่มีรูป — ช่างรับงานแล้ว เพิ่มไม่ได้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
  });

  it("ล็อก (ช่างรับงานแล้ว): แถบ 🔒 แทนแถบ แก้ได้ · ซ่อนปุ่มเพิ่ม · แตะ thumb ดูได้แต่ไม่มีแถบจัดการ · ปุ่มออก QR ใหม่ยังอยู่ (QR ไม่ล็อกตามช่างรับงาน)", async () => {
    intakeListPhotos.mockResolvedValue(photosRes([sp("m1", { isPrimary: true })], { locked: true, lockCode: "job_locked" }));
    await toW10({ jobs: [job({ editable: false })] });
    expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument();
    expect(screen.queryByText("✎ แก้ได้จนช่างเริ่มรับงาน")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 1 จาก 1 · รูปหลัก · แตะเพื่อดู/ }));
    const dlg = screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
    expect(within(dlg).queryByRole("button", { name: /ตั้งเป็นรูปหลัก|ลบรูปนี้|เอารูปนี้ออก/ })).not.toBeInTheDocument();
    await click("ปิดรูป");
    expect(screen.getByRole("button", { name: "ออก QR ใหม่" })).toBeInTheDocument();
  });

  it("ใบปิด/ยกเลิกระหว่างเปิดจอ: แถบ info 'ใบนี้ปิดหรือยกเลิกแล้ว' + 'กลับไปรายการ' (โหลดรายการใหม่) · ไม่แสดงรูป/ปุ่มแก้", async () => {
    intakeListPhotos.mockResolvedValue(photosRes([sp("m1", { isPrimary: true })], { locked: true, lockCode: "job_cancelled" }));
    await toW10();
    expect(screen.getByText("ใบนี้ปิดหรือยกเลิกแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "รูปจากหน้างาน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ออก QR ใหม่" })).not.toBeInTheDocument();
    intakeMyJobs.mockResolvedValue(list([]));
    await click("กลับไปรายการ");
    expect(await screen.findByText("ยังไม่มีใบที่เปิดไว้")).toBeInTheDocument();
    expect(intakeMyJobs).toHaveBeenCalledTimes(2);
  });

  it("โหลดรูปไม่ได้: 'โหลดรูปไม่ได้…' + ลองอีกครั้ง · กลับได้ · ลองใหม่สำเร็จแล้วแสดงรูป", async () => {
    intakeListPhotos.mockRejectedValueOnce(new Error("net"));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดรูปไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง");
    expect(screen.getByRole("button", { name: "กลับไปใบที่ฉันเปิด" })).toBeEnabled();
    await click("ลองอีกครั้ง");
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("โหลดรูปแล้ว session หมดเวลา: โหลด hub ใหม่ (แผ่น PIN ขึ้นเอง · จอนี้ซ่อนไว้ไม่ unmount) · ใส่ PIN แล้วกลับมาที่จอเดิม กด ลองอีกครั้ง ได้", async () => {
    intakeListPhotos.mockResolvedValueOnce({ ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" });
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" });
    // ข้อความของจอแก้รูปยังอยู่ใน DOM (ซ่อน — ไม่ unmount) คู่กับแบนเนอร์ของแผ่น PIN ที่มองเห็น
    expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(2);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WA)} />);
    await screen.findByRole("heading", { level: 1, name: "แก้รูป JB-0031" });
    expect(screen.getByRole("alert")).toHaveTextContent("หมดเวลาแล้ว — ใส่ PIN ใหม่");
    await click("ลองอีกครั้ง");
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("คนอื่น login แทน (หลัง PIN) → ปิดจอแก้รูป ไม่โชว์ใบของคนเดิม", async () => {
    const { rerender } = await toW10();
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" });
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WB)} />);
    expect(await screen.findByRole("heading", { level: 2, name: "ใบที่ฉันเปิด" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: /แก้รูป/ })).not.toBeInTheDocument();
  });

  it("เพิ่มรูป: ย่อ → ส่งด้วย jobId (ไม่มี idemKey) → แถว '✓ ส่งแล้ว' · ตัวนับ 3/3 · ครบ 3 ปุ่มเพิ่มหายแทนด้วยกล่อง", async () => {
    await toW10();
    pick(["z"]);
    await waitFor(() => expect(intakeUploadPhoto).toHaveBeenCalledTimes(1));
    const fd = intakeUploadPhoto.mock.calls[0][1] as FormData;
    expect(fd.get("jobId")).toBe(J1);
    expect(fd.get("idemKey")).toBeNull();
    expect(fd.get("isPrimary")).toBeNull(); // รูปหลักของใบอยู่แล้ว — ไม่ขอสลับ
    await waitFor(() => expect(screen.getByText("✓ ส่งแล้ว")).toBeInTheDocument());
    expect(screen.getByText("รูป 3/3")).toBeInTheDocument();
    expect(screen.getByText("ครบ 3 รูปแล้ว — เอารูปออกก่อนถ้าจะเพิ่ม")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
  });

  it("ส่งรูปใหม่ล้ม → แถวล้ม ⚠ + ลองใหม่/เอาออก · ลองใหม่สำเร็จ", async () => {
    intakeUploadPhoto.mockRejectedValueOnce(new Error("net"));
    await toW10();
    pick(["z"]);
    await waitFor(() => expect(screen.getByText("⚠ ส่งไม่สำเร็จ — ลองอีกครั้ง")).toBeInTheDocument());
    await click("ลองใหม่");
    await waitFor(() => expect(screen.getByText("✓ ส่งแล้ว")).toBeInTheDocument());
  });

  it("ส่งรูปใหม่แล้วช่างเพิ่งรับงาน (job_locked) → แถบ 🔒 ขึ้น ปุ่มเพิ่มหาย · รูปที่ส่งไม่ได้ = 'ไม่ได้ส่ง — ช่างรับงานแล้ว'", async () => {
    intakeUploadPhoto.mockResolvedValueOnce({ ok: false, error: "x", code: "job_locked" });
    await toW10();
    pick(["z"]);
    await waitFor(() => expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument());
    expect(screen.getByText("⚠ ไม่ได้ส่ง — ช่างรับงานแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    expect(screen.queryByText("✎ แก้ได้จนช่างเริ่มรับงาน")).not.toBeInTheDocument();
  });

  it("ลบรูปที่บันทึกแล้ว: กล่องยืนยัน 'ลบรูปนี้? ลบแล้วกู้คืนไม่ได้' → เรียก intakeRemovePhoto(token, id) · ตัวนับลด", async () => {
    await toW10();
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 2 จาก 2 · แตะเพื่อดู/ }));
    const dlg = screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
    expect(within(dlg).getByRole("button", { name: "ตั้งเป็นรูปหลัก" })).toBeEnabled(); // intakeSetPrimaryPhoto เปิดให้รูปที่บันทึกแล้ว
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูปนี้" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(intakeRemovePhoto).toHaveBeenCalledWith(TOKEN, "m2"));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText("รูป 1/3")).toBeInTheDocument();
  });

  it("ลบรูปหลักของตัวเอง → ดาวย้ายตาม promotedPhotoId ของ server", async () => {
    intakeRemovePhoto.mockResolvedValue({ ok: true, promotedPhotoId: "m2", already: false });
    await toW10();
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 1 จาก 2 · รูปหลัก · แตะเพื่อดู/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "รูปงาน JB-0031" })).getByRole("button", { name: "ลบรูปนี้" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]).getByText("★ รูปหลัก")).toBeInTheDocument();
  });

  it("ลบแล้วช่างรับงานแล้ว (job_locked) → ข้อความในกล่อง + ล็อกทั้งจอ", async () => {
    intakeRemovePhoto.mockResolvedValue({ ok: false, error: "ช่างเริ่มรับงานแล้ว", code: "job_locked" });
    await toW10();
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 2 จาก 2 · แตะเพื่อดู/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "รูปงาน JB-0031" })).getByRole("button", { name: "ลบรูปนี้" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).getByRole("button", { name: "ลบรูป" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ");
    await waitFor(() => expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument());
  });

  it("ลิงก์รูปหมดอายุ (15 นาที): รูปโหลดล้ม → ขอรายการใหม่เงียบๆ 1 ครั้ง ได้ URL ใหม่ (ไม่วน)", async () => {
    await toW10();
    const before = intakeListPhotos.mock.calls.length;
    intakeListPhotos.mockResolvedValue(photosRes([sp("m1", { isPrimary: true, smUrl: "https://s/NEW_sm" }), sp("m2")]));
    const img = document.querySelector('img[src="https://s/m1_sm"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    await waitFor(() => expect(intakeListPhotos.mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(document.querySelector('img[src="https://s/NEW_sm"]')).toBeTruthy());
  });

  it("ปุ่มกลับ: ไม่มีรูปค้าง = กลับทันที + รายการโหลดใหม่ · มีรูปค้าง = exit guard (ไม่มีบรรทัด QR / ไม่มีบรรทัด 'ยังอยู่ในใบที่ฉันเปิด') · ออกเลย = ทิ้งรูปค้าง + revoke", async () => {
    await toW10();
    await click("กลับ");
    expect(await screen.findByRole("heading", { level: 2, name: "ใบที่ฉันเปิด" })).toBeInTheDocument();
    expect(intakeMyJobs).toHaveBeenCalledTimes(2);
    // รอบสอง: มีรูปส่งล้มค้าง
    intakeUploadPhoto.mockRejectedValue(new Error("net"));
    await userEvent.click(await screen.findByRole("button", { name: /JB-0031/ }));
    await screen.findByRole("heading", { level: 1, name: /แก้รูป JB-0031/ });
    await waitFor(() => expect(rows()).toHaveLength(2));
    pick(["z"]);
    await waitFor(() => expect(screen.getByText("⚠ ส่งไม่สำเร็จ — ลองอีกครั้ง")).toBeInTheDocument());
    await click("กลับไปใบที่ฉันเปิด");
    const g = screen.getByRole("dialog", { name: "ยังส่งรูปไม่ครบ" });
    expect(within(g).getByText("รูปที่ 3 ยังไม่ได้ส่ง ถ้าออกตอนนี้รูปนั้นจะหาย")).toBeInTheDocument();
    expect(within(g).queryByText(/QR/)).not.toBeInTheDocument();
    expect(within(g).queryByText(/ใบนี้ยังอยู่ใน/)).not.toBeInTheDocument();
    await userEvent.click(within(g).getByRole("button", { name: "กลับไปส่งรูปต่อ" }));
    expect(screen.getByRole("heading", { level: 1, name: /แก้รูป JB-0031/ })).toBeInTheDocument();
    await click("กลับ");
    await userEvent.click(screen.getByRole("button", { name: "ออกเลย — ทิ้งรูปที่ยังไม่ส่ง" }));
    expect(await screen.findByRole("heading", { level: 2, name: "ใบที่ฉันเปิด" })).toBeInTheDocument();
    expect(revoked.length).toBe(created.length);
  });

  it("session หมดเวลากลางส่งรูปใหม่: แถบ PIN ในการ์ด → ใส่ PIN แล้วกลับมา รูปที่ถ่ายยังอยู่ กดลองใหม่ส่งต่อได้", async () => {
    intakeUploadPhoto.mockResolvedValueOnce({ ok: false, error: "x", code: "session_required" });
    const { rerender } = await toW10();
    pick(["z"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("หมดเวลาแล้ว — ใส่ PIN ใหม่");
    await userEvent.click(within(alert).getByRole("button", { name: "ใส่ PIN ใหม่" }));
    expect(refresh).toHaveBeenCalled();
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" });
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WA)} />);
    await screen.findByRole("heading", { level: 1, name: "แก้รูป JB-0031" });
    await click("ลองใหม่");
    await waitFor(() => expect(screen.getByText("✓ ส่งแล้ว")).toBeInTheDocument());
  });

  it("🔴 ไม่มีเงิน/น้ำหนัก/ลิงก์/ชื่อลูกค้า บนจอ W-10", async () => {
    const { container } = await toW10();
    expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|กรัม|ลูกค้า/i);
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
    expect(document.body.innerHTML).not.toMatch(/storage_path|_md\.jpg|\/storage\/v1/);
  });
});

describe("ออก QR ใหม่", () => {
  it("ปุ่ม + ข้อความ (QR ใบงานแสดงซ้ำไม่ได้ · QR เดิมยังใช้ได้) · กดแล้วมีกล่องยืนยัน (ไม่ออกทันที) · ยกเลิกไม่เรียก server", async () => {
    await toW10();
    expect(screen.getByText(/QR ใบงานแสดงซ้ำไม่ได้ — ออก QR ใหม่ได้ \(QR เดิมที่ติดไปแล้วยังใช้ได้\)/)).toBeInTheDocument();
    await click("ออก QR ใหม่");
    const dlg = screen.getByRole("dialog", { name: "ออก QR ใหม่ของ JB-0031?" });
    expect(within(dlg).getByText(/QR เดิมที่ให้ช่างไปแล้วยังใช้ได้ · ใบงานหนึ่งมี QR ที่ใช้งานอยู่ได้ไม่เกิน 5 ใบ/)).toBeInTheDocument();
    expect(intakeReissueToken).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog", { name: /ออก QR ใหม่ของ/ })).not.toBeInTheDocument();
    expect(intakeReissueToken).not.toHaveBeenCalled();
  });

  it("ยืนยัน → เรียก intakeReissueToken(token, jobId) → จอ 'QR ใหม่ JB-0031' มี QR + รูปหลักคู่ QR · QR เข้ารหัส URL /w/<token> แต่ token ดิบไม่ขึ้นเป็นข้อความ/attribute ในหน้า · เสร็จแล้ว → QR หายจากหน้า", async () => {
    await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog", { name: "ออก QR ใหม่ของ JB-0031?" })).getByRole("button", { name: "ออก QR ใหม่" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    expect(intakeReissueToken).toHaveBeenCalledWith(TOKEN, J1, expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/)); // idem key ต่อการออก (กันกินโควตาซ้ำ)
    expect(qrSpy).toHaveBeenCalledWith(`${window.location.origin}/w/${RAW_QR}`);
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.getByTestId("qr-pair-photo")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "รูปหลักของใบงาน" })).toHaveAttribute("src", "https://s/m1_sm");
    expect(screen.getByText("⚠ QR นี้แสดงครั้งเดียว — ออกจากหน้านี้แล้วจะหายจากจอ")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(RAW_QR);
    await click("เสร็จแล้ว");
    expect(screen.getByRole("heading", { level: 1, name: "แก้รูป JB-0031" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "QR ใบงาน JB-0031" })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(RAW_QR);
  });

  it("ใบไม่มีรูป → QR 200px กลางจอ (ไม่มีคู่รูป)", async () => {
    intakeListPhotos.mockResolvedValue(photosRes([]));
    await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    const qr = await screen.findByRole("img", { name: "QR ใบงาน JB-0031" });
    expect(qr).toHaveClass("h-[200px]", "w-[200px]");
    expect(screen.queryByTestId("qr-pair-photo")).not.toBeInTheDocument();
  });

  it("กดซ้ำรัวๆ ระหว่างออก → เรียก server ครั้งเดียว (ไม่มี idem key — กดซ้ำ = กินโควตา 5 ใบ) · ปุ่ม 'กำลังออก QR…'", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    intakeReissueToken.mockReturnValue(new Promise((r) => (resolve = r)));
    await toW10();
    await click("ออก QR ใหม่");
    const btn = within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" });
    await userEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByRole("button", { name: "กำลังออก QR…" })).toBeDisabled();
    expect(intakeReissueToken).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, token: RAW_QR, printNo: 2, jobNo: "JB-0031" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    expect(intakeReissueToken).toHaveBeenCalledTimes(1);
  });

  it("ครบเพดาน 5 (token_cap) → ข้อความในกล่อง ไม่มีปุ่มลองซ้ำ มีแต่ 'ปิด' · ใบปิด/ไม่ใช่ผู้เปิด ก็เช่นกัน", async () => {
    for (const [code, text] of [
      ["token_cap", "ใบนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — แจ้งออฟฟิศให้เพิกถอนก่อน"],
      ["job_closed", "ใบนี้ปิดหรือยกเลิกแล้ว — ออก QR ใหม่ไม่ได้"],
      ["not_allowed", "แก้รูปได้เฉพาะคนที่เปิดใบนี้"],
      ["token_not_issued", "ออก QR ไม่ได้ตอนนี้ — แจ้งออฟฟิศ"],
    ] as const) {
      intakeReissueToken.mockResolvedValueOnce({ ok: false, error: "x", code });
      const { unmount } = await toW10();
      await click("ออก QR ใหม่");
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
      expect(await screen.findByRole("alert"), code).toHaveTextContent(text);
      expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "ออก QR ใหม่" }), code).not.toBeInTheDocument();
      const closers = within(screen.getByRole("dialog")).getAllByRole("button", { name: "ปิด" }); // X ของ Modal + ปุ่ม "ปิด"
      expect(closers.length, code).toBe(2);
      await userEvent.click(closers[1]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("เน็ตหลุด → กดลองใหม่ได้ด้วย idem key เดิม · session หมด → โหลด hub ใหม่ (แผ่น PIN) ปิดกล่อง · ใส่ PIN แล้วกด ออก QR ใหม่ ซ้ำได้ (key เดิมจนกว่าจะได้ผลชัดเจน)", async () => {
    intakeReissueToken.mockRejectedValueOnce(new Error("net"));
    const { rerender } = await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ออก QR ไม่สำเร็จ — เช็คสัญญาณแล้วลองอีกครั้ง");
    expect(screen.getByRole("alert").textContent).not.toMatch(/โควตา/); // ลองซ้ำปลอดภัยแล้ว (idempotent) ไม่ต้องขู่
    intakeReissueToken.mockResolvedValueOnce({ ok: false, error: "x", code: "session_required" });
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(intakeReissueToken.mock.calls[1][2]).toBe(intakeReissueToken.mock.calls[0][2]); // ลองใหม่ = key เดิม
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" });
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WA)} />);
    await screen.findByRole("heading", { level: 1, name: "แก้รูป JB-0031" });
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    expect(intakeReissueToken.mock.calls[2][2]).toBe(intakeReissueToken.mock.calls[0][2]);
  });

  it("ออกสำเร็จแล้วกดออกอีกใบ = key ใหม่ (QR ใบใหม่จริง ไม่ใช่ replay) · คนละการกด = คนละ key", async () => {
    await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    await click("เสร็จแล้ว");
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await waitFor(() => expect(intakeReissueToken).toHaveBeenCalledTimes(2));
    expect(intakeReissueToken.mock.calls[1][2]).not.toBe(intakeReissueToken.mock.calls[0][2]);
  });

  it("already:true (key เดิมออกไปแล้ว คำขอก่อนหน้าตอบไม่ถึง · server ไม่มี QR ดิบ) → 'ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง' ไม่มีจอ QR · กดใหม่ = key ใหม่ ได้ QR", async () => {
    intakeReissueToken.mockResolvedValueOnce({ ok: true, already: true, token: null, printNo: null, jobNo: "JB-0031" });
    await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง");
    expect(screen.queryByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" })).not.toBeInTheDocument();
    expect(qrSpy).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    expect(intakeReissueToken).toHaveBeenCalledTimes(2);
    expect(intakeReissueToken.mock.calls[1][2]).not.toBe(intakeReissueToken.mock.calls[0][2]);
  });

  it("🔴 ไม่มีเงิน/น้ำหนักบนจอ QR ใหม่", async () => {
    const { container } = await toW10();
    await click("ออก QR ใหม่");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ออก QR ใหม่" }));
    await screen.findByRole("heading", { level: 1, name: "QR ใหม่ JB-0031" });
    expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|กรัม/i);
    expect(container.querySelectorAll("a, [href]").length).toBe(0);
  });
});
