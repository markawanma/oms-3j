// @vitest-environment jsdom
// การ์ด "รูปงาน" (ออฟฟิศ): อัปโหลด (ย่อก่อนส่งเสมอ) · ล้มแล้วลองใหม่ · ตั้งรูปหลัก · ลบ (ยืนยัน) · เรียง · ครบ 5 · ดึงรูป SKU · ใบปิดแล้วยังแก้ได้ · ลิงก์หมดอายุ
// ต้องไม่พัง: ล้ม = ย้อนค่า (rollback) · ครบ 5 ไม่มีปุ่มเพิ่ม · ใบไม่มีรูปเตือนเบาๆ ไม่บล็อก
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("@/lib/actions/job-office-write", () => ({}));
vi.mock("@/lib/actions/job-office", () => ({ getJobPlanSuggest: vi.fn() }));
vi.mock("@/lib/actions/job-profiles", () => ({ listProfiles: vi.fn(), changeJobProfile: vi.fn() }));
const act_ = {
  getJobPhotos: vi.fn(), uploadJobPhoto: vi.fn(), removeJobPhoto: vi.fn(), setPrimaryJobPhoto: vi.fn(), reorderJobPhotos: vi.fn(), pullJobPhotoFromCatalog: vi.fn(),
};
vi.mock("@/lib/actions/job-photos", () => ({
  getJobPhotos: (...a: unknown[]) => act_.getJobPhotos(...a),
  uploadJobPhoto: (...a: unknown[]) => act_.uploadJobPhoto(...a),
  removeJobPhoto: (...a: unknown[]) => act_.removeJobPhoto(...a),
  setPrimaryJobPhoto: (...a: unknown[]) => act_.setPrimaryJobPhoto(...a),
  reorderJobPhotos: (...a: unknown[]) => act_.reorderJobPhotos(...a),
  pullJobPhotoFromCatalog: (...a: unknown[]) => act_.pullJobPhotoFromCatalog(...a),
}));
const resize = vi.fn();
vi.mock("@/lib/images/client", async (orig) => ({ ...(await orig<typeof import("@/lib/images/client")>()), resizeImageVariants: (...a: unknown[]) => resize(...a) }));

import { ToastProvider } from "@/components/ui/Toast";
import { HeicNotSupportedError } from "@/lib/images/client";
import { JobPhotosCard } from "./JobPhotosCard";
import { JobDetailClient } from "./JobDetailClient";
import { mapBoardRow, mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";
import type { JobDetailData } from "@/lib/actions/job-office";
import type { JobPhotoRow } from "@/lib/jobs/photos";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const url = (id: string, v: "sm" | "md", t = "a") => `https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/${id}_${v}.jpg?token=${t}`;
const row = (n: number, o: Partial<JobPhotoRow> = {}): JobPhotoRow => ({ id: `p${n}`, smUrl: url(`p${n}`, "sm"), mdUrl: url(`p${n}`, "md"), isPrimary: n === 1, sortOrder: n, caption: null, source: "office", createdAt: null, ...o });
const rows = (n: number): JobPhotoRow[] => Array.from({ length: n }, (_, i) => row(i + 1));

const variants = () => ({
  md: { blob: new Blob(["md"], { type: "image/jpeg" }), width: 1200, height: 900, bytes: 2, quality: 0.9 },
  sm: { blob: new Blob(["s"], { type: "image/jpeg" }), width: 480, height: 360, bytes: 1, quality: 0.9 },
});
const file = (name = "IMG_0001.jpg", body = "RAW-ORIGINAL-BYTES-LARGER") => new File([body], name, { type: "image/jpeg" });

type Props = Partial<React.ComponentProps<typeof JobPhotosCard>>;
const card = (p: Props = {}) =>
  wrap(<JobPhotosCard jobId={JOB} jobNo="JB-0034" sku={null} sourceKind="production" activeTokens={0} photos={rows(0)} {...p} />);
const section = () => screen.getByRole("region", { name: "รูปงาน" });
const pick = () => screen.getByTestId("photo-input-pick");
const tile = (n: number, of: number) => screen.getByRole("button", { name: new RegExp(`^รูปที่ ${n} จาก ${of} ·`) });
const viewer = () => screen.getByRole("dialog", { name: "รูปงาน JB-0034" });

beforeEach(() => {
  vi.clearAllMocks();
  resize.mockImplementation(async () => variants());
  act_.uploadJobPhoto.mockImplementation(async () => ({ ok: true, data: row(1, { id: "new1", isPrimary: true, smUrl: url("new1", "sm"), mdUrl: url("new1", "md") }) }));
  act_.removeJobPhoto.mockResolvedValue({ ok: true, data: { promotedPhotoId: null } });
  act_.setPrimaryJobPhoto.mockResolvedValue({ ok: true, data: null });
  act_.reorderJobPhotos.mockResolvedValue({ ok: true, data: null });
  act_.getJobPhotos.mockResolvedValue({ ok: true, data: rows(2) });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("โครง · empty · loading · error", () => {
  it("ใบไม่มีรูป: หัวข้อ + 0/5 + ปุ่มเพิ่ม + 'ยังไม่มีรูปงาน' · มีรหัส SKU = ข้อความถ่ายให้ช่างดู · ไม่มีรหัส = ข้อความสินค้าใหม่", () => {
    const a = card({ sku: "RG-001" });
    expect(within(section()).getByRole("heading", { name: "รูปงาน" })).toBeInTheDocument();
    expect(screen.getByText("0/5")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรูปงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toBeInTheDocument();
    a.unmount();
    card({ sku: null });
    expect(screen.getByText("สินค้าใหม่ไม่มีรหัส — ถ่ายรูปให้ช่างรู้ว่าทำชิ้นไหน")).toBeInTheDocument();
  });

  it("id=job-photos (ให้ #job-photos เลื่อนมาถึง) · มีรูป: ตารางรูปเป็น <ul> ของ <button> · ตัวนับ n/5", () => {
    card({ photos: rows(3) });
    expect(section()).toHaveAttribute("id", "job-photos");
    expect(within(section()).getAllByRole("listitem")).toHaveLength(3);
    expect(tile(1, 3)).toHaveAccessibleName("รูปที่ 1 จาก 3 · รูปหลัก · แตะเพื่อดู");
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีรูปงาน")).not.toBeInTheDocument();
  });

  it("อ่านรูปไม่ได้ (photos undefined) ≠ ไม่มีรูป: แถบแดง + ลองใหม่ · ไม่มีปุ่มเพิ่ม/ตัวนับ · ลองใหม่สำเร็จ = เห็นรูป", async () => {
    card({ photos: undefined });
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรูปงานไม่ได้");
    expect(screen.queryByText("ยังไม่มีรูปงาน")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    expect(screen.queryByText(/\/5$/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(act_.getJobPhotos).toHaveBeenCalledWith(JOB);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  });

  it("โหลดรายการ (client) กำลังทำ = skeleton 3 ช่อง role=status · ล้ม = ข้อความจาก server ค้างให้ลองอีก", async () => {
    let release: (v: unknown) => void = () => undefined;
    act_.getJobPhotos.mockImplementationOnce(() => new Promise((r) => (release = r)));
    card({ photos: undefined });
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(screen.getByRole("status", { name: "กำลังโหลดรูป" })).toBeInTheDocument();
    await act(async () => release({ ok: false, error: "โหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" }));
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
});

describe("อัปโหลด", () => {
  it("เลือกไฟล์ → ย่อ (resizeImageVariants) ก่อน → ส่งเฉพาะ md+sm ที่ย่อแล้ว (ไม่ส่งไฟล์ดิบ) + jobId · รูปแรก = รูปหลัก · ตัวนับ 1/5", async () => {
    card();
    const raw = file();
    await userEvent.upload(pick(), raw);
    await waitFor(() => expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(1));
    expect(resize).toHaveBeenCalledWith(raw);
    const fd = act_.uploadJobPhoto.mock.calls[0][0] as FormData;
    expect(fd.get("jobId")).toBe(JOB);
    const md = fd.get("md") as File;
    const sm = fd.get("sm") as File;
    expect([md.size, sm.size]).toEqual([2, 1]); // ขนาดของ blob ที่ย่อแล้ว ไม่ใช่ไฟล์ดิบ
    expect(md.size).not.toBe(raw.size);
    expect(fd.get("path")).toBeNull();
    expect(fd.get("shop")).toBeNull();
    expect(md.name).not.toContain("IMG_0001"); // ชื่อไฟล์เดิมของกล้องไม่รั่วไปกับคำขอ
    expect(await screen.findByRole("button", { name: /^รูปที่ 1 จาก 1 · รูปหลัก/ })).toBeInTheDocument();
    expect(screen.getByText("1/5")).toBeInTheDocument();
  });

  it("เลือกหลายรูป: ส่งทีละรูป (action ถูกเรียกครบทุกรูป) · ทำพร้อมกันไม่เกิน 2", async () => {
    let inflight = 0;
    let peak = 0;
    act_.uploadJobPhoto.mockImplementation(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      return { ok: true, data: row(2, { id: `n${Math.random()}`, isPrimary: false }) };
    });
    card();
    await userEvent.upload(pick(), [file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")]);
    await waitFor(() => expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(4), { timeout: 3000 });
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    expect(peak).toBeLessThanOrEqual(2);
    expect(resize).toHaveBeenCalledTimes(4);
  });

  it("ระหว่างส่ง: ช่อง 'กำลังส่ง' + สรุปสำหรับ screen reader · ส่งเสร็จแล้วหาย", async () => {
    let release: (v: unknown) => void = () => undefined;
    act_.uploadJobPhoto.mockImplementationOnce(() => new Promise((r) => (release = r)));
    card();
    await userEvent.upload(pick(), file());
    expect(await screen.findByRole("group", { name: "กำลังส่งรูป" })).toBeInTheDocument();
    expect(screen.getByText("กำลังส่งรูป 1 รูป")).toBeInTheDocument();
    expect(screen.getByText("ยังมีรูปที่ส่งไม่เสร็จ — อย่าปิดหน้านี้")).toBeInTheDocument();
    expect(screen.getByText("1/5")).toBeInTheDocument(); // นับรูปที่กำลังส่งด้วย
    await act(async () => release({ ok: true, data: row(1, { id: "z" }) }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "กำลังส่งรูป" })).not.toBeInTheDocument());
  });

  it("ส่งล้ม (ลองใหม่ได้): ช่องแดง 'ส่งไม่สำเร็จ · แตะลองใหม่' + เหตุผล → แตะ = ส่งใหม่ (ย่อซ้ำ) → สำเร็จกลายเป็นรูป", async () => {
    act_.uploadJobPhoto.mockResolvedValueOnce({ ok: false, error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" });
    card();
    await userEvent.upload(pick(), file());
    const retry = await screen.findByRole("button", { name: "ส่งรูปไม่สำเร็จ แตะเพื่อลองใหม่" });
    expect(retry).toHaveTextContent("ส่งไม่สำเร็จ · แตะลองใหม่");
    expect(retry).toHaveTextContent("อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(screen.getByText("0/5")).toBeInTheDocument(); // ที่ล้มไม่นับ
    await userEvent.click(retry);
    expect(await screen.findByRole("button", { name: /^รูปที่ 1 จาก 1/ })).toBeInTheDocument();
    expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("action โยน exception (เน็ตหลุดกลางทาง) = ช่องแดงลองใหม่ได้ · ไม่ค้างหมุน · [×] เอาออกได้โดยไม่ยืนยัน", async () => {
    act_.uploadJobPhoto.mockRejectedValueOnce(new Error("network"));
    card();
    await userEvent.upload(pick(), file());
    expect(await screen.findByRole("button", { name: "ส่งรูปไม่สำเร็จ แตะเพื่อลองใหม่" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "เอารูปนี้ออก" }));
    expect(screen.queryByRole("button", { name: "ส่งรูปไม่สำเร็จ แตะเพื่อลองใหม่" })).not.toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรูปงาน")).toBeInTheDocument();
  });

  it("ลองใหม่ไม่ช่วย — HEIC: ข้อความวิธีแก้ + ปุ่ม 'เอาออก' เท่านั้น (ไม่มีลองใหม่) · ไม่เรียก action", async () => {
    resize.mockRejectedValueOnce(new HeicNotSupportedError());
    card();
    await userEvent.upload(pick(), file("IMG.heic"));
    expect(await screen.findByText(/ไฟล์ HEIC เปิดไม่ได้ — iPhone: ตั้งค่า > กล้อง/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /แตะเพื่อลองใหม่/ })).not.toBeInTheDocument();
    expect(act_.uploadJobPhoto).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "เอาออก" }));
    expect(screen.getByText("ยังไม่มีรูปงาน")).toBeInTheDocument();
  });

  it("ลองใหม่ไม่ช่วย — ใบมีรูปครบ 5 ชนกันสองคน (photo_cap_ref): ไม่มีปุ่มลองใหม่ มีแต่เอาออก", async () => {
    act_.uploadJobPhoto.mockResolvedValueOnce({ ok: false, error: "ใบงานนี้มีรูปอ้างอิงครบ 5 รูปแล้ว — ลบรูปเก่าก่อนเพิ่ม", code: "photo_cap_ref" });
    card();
    await userEvent.upload(pick(), file());
    expect(await screen.findByText(/ใบงานนี้มีรูปอ้างอิงครบ 5 รูปแล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /แตะเพื่อลองใหม่/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เอาออก" })).toBeInTheDocument();
  });

  it("ครบ 5: ปุ่มเพิ่มหาย + ข้อความเหตุผล · ตัวนับ 5/5", () => {
    card({ photos: rows(5) });
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มรูป" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("photo-input-pick")).not.toBeInTheDocument();
    expect(screen.getByText("ครบ 5 รูปแล้ว — ลบรูปก่อนถ้าจะเพิ่ม")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
  });

  it("เลือกเกินที่ใส่ได้: รับเท่าที่เหลือ + แถบเหลืองบอกจำนวนที่ตัด", async () => {
    card({ photos: rows(3) });
    await userEvent.upload(pick(), [file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")]);
    expect(await screen.findByText("เลือกมา 4 รูป ใส่ได้อีก 2 รูป — ตัด 2 รูปท้ายออก")).toBeInTheDocument();
    await waitFor(() => expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(2));
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("ไม่มีเน็ต: แถบเหลือง 'ห้ามปิดหน้า' · เน็ตกลับมา + มีรูปล้มค้าง ≥ 2 = ปุ่ม 'ส่งใหม่ทั้งหมด (2 รูป)' (ไม่ส่งเอง)", async () => {
    act_.uploadJobPhoto.mockRejectedValue(new Error("offline"));
    card();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/ไม่มีอินเทอร์เน็ต — ส่งรูปไม่ได้ตอนนี้ รูปที่ถ่ายไว้ค้างอยู่ในหน้านี้ ห้ามปิดหน้า/)).toBeInTheDocument();
    await userEvent.upload(pick(), [file("a.jpg"), file("b.jpg")]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "ส่งรูปไม่สำเร็จ แตะเพื่อลองใหม่" })).toHaveLength(2));
    expect(screen.getAllByText("ไม่มีเน็ต")).toHaveLength(2);
    const callsBefore = act_.uploadJobPhoto.mock.calls.length;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.getByText(/เน็ตกลับมาแล้ว — แตะรูปสีแดงเพื่อส่งใหม่/)).toBeInTheDocument();
    expect(act_.uploadJobPhoto.mock.calls.length).toBe(callsBefore); // ไม่ส่งเองอัตโนมัติ
    act_.uploadJobPhoto.mockReset();
    act_.uploadJobPhoto.mockResolvedValue({ ok: true, data: row(2, { id: `n${Math.random()}`, isPrimary: false }) });
    await userEvent.click(screen.getByRole("button", { name: "ส่งใหม่ทั้งหมด (2 รูป)" }));
    await waitFor(() => expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(2));
  });

  it("ปิดหน้าขณะมีรูปค้าง: beforeunload ถูกกัน · ไม่มีรูปค้าง = ไม่กัน", async () => {
    let release: (v: unknown) => void = () => undefined;
    act_.uploadJobPhoto.mockImplementationOnce(() => new Promise((r) => (release = r)));
    card();
    const idle = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    await userEvent.upload(pick(), file());
    await screen.findByRole("group", { name: "กำลังส่งรูป" });
    const busy = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
    await act(async () => release({ ok: true, data: row(1, { id: "z" }) }));
    await waitFor(() => expect(screen.queryByText("ยังมีรูปที่ส่งไม่เสร็จ — อย่าปิดหน้านี้")).not.toBeInTheDocument());
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe("ตั้งรูปหลัก · เรียง · ลบ (ใน viewer)", () => {
  it("แตะรูป = เปิด viewer ที่รูปนั้น · ตั้งเป็นรูปหลัก → เรียก action + รูปนั้นขึ้นเป็นรูปแรก + toast", async () => {
    card({ photos: rows(3) });
    await userEvent.click(tile(3, 3));
    expect(within(viewer()).getByText("JB-0034 · 3/3")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    await waitFor(() => expect(act_.setPrimaryJobPhoto).toHaveBeenCalledWith("p3"));
    expect(await screen.findByText("ตั้งเป็นรูปหลักแล้ว")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ปิดรูป" }));
    expect(tile(1, 3)).toHaveAccessibleName("รูปที่ 1 จาก 3 · รูปหลัก · แตะเพื่อดู");
    // รูปเดิม p1 ไม่ใช่รูปหลักแล้ว (รูปหลักมีรูปเดียว)
    expect(screen.getAllByRole("button", { name: /รูปหลัก · แตะเพื่อดู/ })).toHaveLength(1);
  });

  it("รูปหลักอยู่แล้ว: ปุ่มบนเป็น 'เป็นรูปหลักอยู่แล้ว' (ปิด + เหตุผลบนปุ่ม) · ไม่มีปุ่มเลื่อน", async () => {
    card({ photos: rows(3) });
    await userEvent.click(tile(1, 3));
    const b = within(viewer()).getByRole("button", { name: "เป็นรูปหลักอยู่แล้ว" });
    expect(b).toBeDisabled();
    expect(within(viewer()).queryByRole("button", { name: "เลื่อนก่อน" })).not.toBeInTheDocument();
    expect(within(viewer()).queryByRole("button", { name: "เลื่อนหลัง" })).not.toBeInTheDocument();
  });

  it("ตั้งรูปหลักล้ม → ย้อนลำดับเดิม + toast error", async () => {
    act_.setPrimaryJobPhoto.mockResolvedValue({ ok: false, error: "รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่" });
    card({ photos: rows(3) });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    expect(await screen.findByText("รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ปิดรูป" }));
    expect(tile(1, 3)).toHaveAccessibleName("รูปที่ 1 จาก 3 · รูปหลัก · แตะเพื่อดู");
    expect(tile(2, 3)).toHaveAccessibleName("รูปที่ 2 จาก 3 · แตะเพื่อดู");
  });

  it("เลื่อนหลัง: reorderJobPhotos(jobId, [รูปหลัก, ...สลับ]) · รูปหลักยังอยู่แรกเสมอ · ปุ่มเลื่อนก่อนของรูปที่ 2 ปิด (ข้ามรูปหลักไม่ได้)", async () => {
    card({ photos: rows(4) });
    await userEvent.click(tile(2, 4));
    expect(within(viewer()).getByRole("button", { name: "เลื่อนก่อน" })).toBeDisabled();
    await userEvent.click(within(viewer()).getByRole("button", { name: "เลื่อนหลัง" }));
    await waitFor(() => expect(act_.reorderJobPhotos).toHaveBeenCalledWith(JOB, ["p1", "p3", "p2", "p4"]));
    // หลังสลับ p2 อยู่ตำแหน่ง 3 → เลื่อนหลังได้อีก 1 ครั้ง เลื่อนก่อนได้แล้ว
    await waitFor(() => expect(within(viewer()).getByRole("button", { name: "เลื่อนก่อน" })).toBeEnabled());
    // viewer ยังอยู่ที่ p2 (ตัวนับขยับเป็น 3/4)
    expect(within(viewer()).getByText("JB-0034 · 3/4")).toBeInTheDocument();
  });

  it("เลื่อนล้ม → ย้อนลำดับ + toast error", async () => {
    act_.reorderJobPhotos.mockResolvedValue({ ok: false, error: "รูปในใบเปลี่ยนไปแล้ว — โหลดหน้าใหม่แล้วเรียงอีกครั้ง" });
    card({ photos: rows(4) });
    await userEvent.click(tile(2, 4));
    await userEvent.click(within(viewer()).getByRole("button", { name: "เลื่อนหลัง" }));
    expect(await screen.findByText("รูปในใบเปลี่ยนไปแล้ว — โหลดหน้าใหม่แล้วเรียงอีกครั้ง")).toBeInTheDocument();
    expect(within(viewer()).getByText("JB-0034 · 2/4")).toBeInTheDocument();
  });

  it("ลบ: ต้องยืนยันก่อน (กดลบรูปนี้ยังไม่เรียก action) · focus เริ่มที่ 'ยกเลิก' · ยกเลิก = ไม่ลบ", async () => {
    card({ photos: rows(3) });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: "ลบรูปนี้ออกจากใบงาน JB-0034?" });
    expect(act_.removeJobPhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(within(d).getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
    expect(within(d).getByText("กู้คืนไม่ได้ · ระบบจะบันทึกว่าใครลบ")).toBeInTheDocument();
    await userEvent.click(within(d).getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).not.toBeInTheDocument();
    expect(act_.removeJobPhoto).not.toHaveBeenCalled();
    expect(within(viewer()).getByText("JB-0034 · 2/3")).toBeInTheDocument();
  });

  it("ยืนยันลบ → removeJobPhoto(id) · รูปหายจากการ์ด · viewer เลื่อนไปรูปถัดไป · toast 'ลบรูปแล้ว'", async () => {
    card({ photos: rows(3) });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    await userEvent.click(within(d).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(act_.removeJobPhoto).toHaveBeenCalledWith("p2"));
    expect(await screen.findByText("ลบรูปแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).not.toBeInTheDocument();
    expect(within(viewer()).getByText("JB-0034 · 2/2")).toBeInTheDocument();
    await userEvent.click(within(viewer()).getByRole("button", { name: "ปิดรูป" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("ลบรูปสุดท้าย: เตือนว่าใบจะไม่มีรูป · ลบแล้ว viewer ปิดเอง · การ์ดกลับเป็นว่าง", async () => {
    card({ photos: rows(1) });
    await userEvent.click(tile(1, 1));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    expect(within(d).getByText("ลบแล้วใบงานนี้จะไม่มีรูป ใบ A5 ที่พิมพ์ครั้งต่อไปจะไม่มีรูปหลัก")).toBeInTheDocument();
    await userEvent.click(within(d).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รูปงาน JB-0034" })).not.toBeInTheDocument());
    expect(screen.getByText("ยังไม่มีรูปงาน")).toBeInTheDocument();
  });

  it("ลบรูปหลัก (ยังมีรูปอื่น): เตือน + รูปที่ DB เลื่อนขึ้น (promotedPhotoId) กลายเป็นรูปหลักในการ์ด", async () => {
    act_.removeJobPhoto.mockResolvedValue({ ok: true, data: { promotedPhotoId: "p2" } });
    card({ photos: rows(3) });
    await userEvent.click(tile(1, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    expect(within(d).getByText("นี่คือรูปหลัก ลบแล้วรูปถัดไปจะเป็นรูปหลักแทน")).toBeInTheDocument();
    await userEvent.click(within(d).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(act_.removeJobPhoto).toHaveBeenCalledWith("p1"));
    await userEvent.click(await within(viewer()).findByRole("button", { name: "ปิดรูป" }));
    expect(tile(1, 2)).toHaveAccessibleName("รูปที่ 1 จาก 2 · รูปหลัก · แตะเพื่อดู");
  });

  it("ลบรูปจากแคตตาล็อก: บอกว่ารูปในแคตตาล็อกไม่หาย", async () => {
    card({ photos: [row(1), row(2, { source: "product" }), row(3)] });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    expect(within(d).getByText("ลบจากใบงานนี้เท่านั้น — รูปในแคตตาล็อกไม่หาย")).toBeInTheDocument();
  });

  it("ลบล้มเหลว: ข้อความในกล่อง คงกล่อง + รูปยังอยู่ · กดซ้ำได้", async () => {
    act_.removeJobPhoto.mockResolvedValueOnce({ ok: false, error: "รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่" });
    card({ photos: rows(3) });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    const d = await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    await userEvent.click(within(d).getByRole("button", { name: "ลบรูป" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่");
    expect(screen.getByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).toBeInTheDocument();
    await userEvent.click(within(d).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).not.toBeInTheDocument());
    expect(act_.removeJobPhoto).toHaveBeenCalledTimes(2);
  });

  it("Esc ในกล่องยืนยันปิดเฉพาะกล่อง — viewer ยังเปิดอยู่", async () => {
    card({ photos: rows(3) });
    await userEvent.click(tile(2, 3));
    await userEvent.click(within(viewer()).getByRole("button", { name: "ลบรูปนี้" }));
    await screen.findByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /ลบรูปนี้ออกจากใบงาน/ })).not.toBeInTheDocument());
    expect(viewer()).toBeInTheDocument();
  });
});

describe("ดึงรูปจากแคตตาล็อก (กดเอง)", () => {
  it("ใบผูก SKU ที่ยังไม่มีรูปจากแคตตาล็อก → ปุ่มขึ้น · กด → pullJobPhotoFromCatalog(jobId) → รูป 'จากแคตตาล็อก' ขึ้นเป็นรูปหลัก", async () => {
    act_.pullJobPhotoFromCatalog.mockResolvedValue({ ok: true, data: row(1, { id: "cat1", source: "product", isPrimary: true }) });
    card({ sku: "RG-001" });
    await userEvent.click(screen.getByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ }));
    await waitFor(() => expect(act_.pullJobPhotoFromCatalog).toHaveBeenCalledWith(JOB));
    expect(await screen.findByRole("button", { name: "รูปที่ 1 จาก 1 · รูปหลัก · แตะเพื่อดู · จากแคตตาล็อก" })).toBeInTheDocument();
    expect(await screen.findByText("ดึงรูปจากแคตตาล็อกแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ })).not.toBeInTheDocument(); // ดึงแล้วไม่ขึ้นซ้ำ
  });

  it("ดึงไม่ได้ (SKU ไม่มีรูป) → toast ข้อความจาก server · ไม่เปลี่ยนรายการ", async () => {
    act_.pullJobPhotoFromCatalog.mockResolvedValue({ ok: false, error: "สินค้านี้ยังไม่มีรูปในแคตตาล็อก" });
    card({ sku: "RG-001" });
    await userEvent.click(screen.getByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ }));
    expect(await screen.findByText("สินค้านี้ยังไม่มีรูปในแคตตาล็อก")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรูปงาน")).toBeInTheDocument();
  });

  it("ไม่ขึ้นปุ่ม: ไม่มี SKU · มีรูปจากแคตตาล็อกแล้ว · ครบ 5", () => {
    const a = card({ sku: null });
    expect(screen.queryByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ })).not.toBeInTheDocument();
    a.unmount();
    const b = card({ sku: "RG-001", photos: [row(1, { source: "product" })] });
    expect(screen.queryByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ })).not.toBeInTheDocument();
    b.unmount();
    card({ sku: "RG-001", photos: rows(5) });
    expect(screen.queryByRole("button", { name: /ดึงรูปจากแคตตาล็อก/ })).not.toBeInTheDocument();
  });
});

describe("ลิงก์รูปหมดอายุ 15 นาที", () => {
  it("รูปในการ์ดโหลดล้ม → ขอรายการใหม่ (signed URL ใหม่) อัตโนมัติ · รูปใช้ URL ใหม่ ไม่ค้างรูปแตก", async () => {
    act_.getJobPhotos.mockResolvedValue({ ok: true, data: [row(1, { smUrl: url("p1", "sm", "fresh") })] });
    const { container } = card({ photos: [row(1)] });
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(act_.getJobPhotos).toHaveBeenCalledWith(JOB));
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(url("p1", "sm", "fresh")));
  });

  it("ล้มซ้ำภายใน 10 วินาที ไม่ยิงซ้ำ (กันวนเมื่อรูปพังด้วยเหตุอื่น) แต่ผู้ใช้แตะ 'ลองใหม่' ได้ทุกครั้ง", async () => {
    act_.getJobPhotos.mockResolvedValue({ ok: true, data: [row(1, { smUrl: url("p1", "sm", "t2") })] });
    const { container } = card({ photos: [row(1)] });
    fireEvent.error(container.querySelector("img")!);
    await waitFor(() => expect(act_.getJobPhotos).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(url("p1", "sm", "t2")));
    fireEvent.error(container.querySelector("img")!); // ล้มอีก ในช่วงห้ามยิง
    await screen.findByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" });
    expect(act_.getJobPhotos).toHaveBeenCalledTimes(1);
    act_.getJobPhotos.mockResolvedValue({ ok: true, data: [row(1, { smUrl: url("p1", "sm", "t3") })] });
    await userEvent.click(screen.getByRole("button", { name: "โหลดรูปไม่ได้ แตะเพื่อลองใหม่" }));
    await waitFor(() => expect(act_.getJobPhotos).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe(url("p1", "sm", "t3")));
  });
});

describe("ข้อความช่วย + หน้าใบงาน (JobDetailClient)", () => {
  it("เคยพิมพ์ใบแล้ว (QR ใช้งาน > 0) และมีรูป → บอกว่ากระดาษใบเก่าไม่มีรูป ช่างดูมือถือได้ · ใบ OEM บอกว่าช่างทุกขั้นเห็น", () => {
    const a = card({ photos: rows(2), activeTokens: 1 });
    expect(screen.getByText(/ใบกระดาษที่พิมพ์ไปแล้วไม่มีรูปหลัก — ช่างดูรูปจากมือถือ \(สแกน QR\) ได้ทันที/)).toBeInTheDocument();
    a.unmount();
    card({ photos: rows(2), activeTokens: 0, sourceKind: "oem" });
    expect(screen.getByText("รูปนี้ช่างทุกขั้นเห็นผ่าน QR และพิมพ์บนใบงาน")).toBeInTheDocument();
    expect(screen.queryByText(/ใบกระดาษที่พิมพ์ไปแล้ว/)).not.toBeInTheDocument();
  });

  const stage = (code: string, seq: number, status: string): StageRow => ({
    id: `s-${code}`, seq, code, name: code, status, weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, metalPresent: false, receivedOn: null, sentOn: null, workerId: null, holderName: null,
    autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null,
  });
  const detail = (job: Record<string, unknown> = {}, photosIn: JobPhotoRow[] | "unreadable" = [], activeTokens = 0): JobDetailData => {
    const photos = photosIn === "unreadable" ? undefined : photosIn; // undefined = อ่านรูปไม่ได้ (default param ของ TS ทับ undefined จึงใช้คำแทน)
    const base = { id: JOB, job_no: "JB-0034", source_kind: "production", design_label: "แหวนลาย A", sku_snapshot: "RG-001", metal: "silver", qty_planned: 10, qty_order: 10, status: "open", ...job };
    return {
      job: mapJobDetail(base)!, board: mapBoardRow({ id: JOB, job_no: "JB-0034", seq: 34, source_kind: "production", metal: "silver", qty_planned: 10, qty_order: 10, status: base.status }),
      stages: [stage("cast", 1, "pending"), stage("pack", 2, "pending")], loss: {}, events: [], eventsTruncated: false, activeTokens, workers: [], source: null, todayTh: "2026-10-19", photos,
    };
  };

  it("ใบไม่มีรูป: เตือนใต้ 'QR ที่ใช้งานอยู่' + ลิงก์ไป #job-photos · ปุ่มพิมพ์ใบงานยังกดได้ (ไม่บล็อก) · การ์ดรูปอยู่ในหน้า", () => {
    wrap(<JobDetailClient data={detail()} />);
    const warn = screen.getByText(/ใบนี้ยังไม่มีรูป — ใบพิมพ์จะไม่มีรูปหลัก/);
    expect(within(warn).getByRole("link", { name: "เพิ่มรูป" })).toHaveAttribute("href", "#job-photos");
    expect(screen.getByRole("link", { name: /พิมพ์ใบงาน \(QR\)/ })).toHaveAttribute("href", `/jobs/${JOB}/print`);
    expect(screen.getByRole("region", { name: "รูปงาน" })).toBeInTheDocument();
  });

  it("ใบมีรูป / อ่านรูปไม่ได้ (undefined): ไม่ขึ้นข้อความ 'ยังไม่มีรูป' เตือนที่หัวใบ (ไม่รู้ ≠ ไม่มี)", () => {
    const a = wrap(<JobDetailClient data={detail({}, rows(2))} />);
    expect(screen.queryByText(/ใบนี้ยังไม่มีรูป/)).not.toBeInTheDocument();
    a.unmount();
    wrap(<JobDetailClient data={detail({}, "unreadable")} />);
    expect(screen.queryByText(/ใบนี้ยังไม่มีรูป/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรูปงานไม่ได้");
  });

  it("ใบที่ปิดแล้ว (done) ยังเพิ่ม/ลบรูปได้ (มติเจ้าของ 19 ต.ค.): มีปุ่มเพิ่ม + viewer มีแถบจัดการ · ไม่มีข้อความเตือนก่อนพิมพ์ (ปิดแล้วพิมพ์ไม่ได้)", async () => {
    wrap(<JobDetailClient data={detail({ status: "done", qty_good: 10, qty_scrap: 0 }, rows(2))} />);
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "เพิ่มรูป" })).toBeEnabled();
    await userEvent.click(tile(2, 2));
    expect(within(viewer()).getByRole("button", { name: "ลบรูปนี้" })).toBeEnabled();
    expect(within(viewer()).getByRole("button", { name: "ตั้งเป็นรูปหลัก" })).toBeEnabled();
  });

  it("ใบปิดแล้ว (cancelled) ไม่มีรูป: อัปโหลดได้ + ไม่ขึ้นเตือนก่อนพิมพ์", async () => {
    wrap(<JobDetailClient data={detail({ status: "cancelled" }, [])} />);
    expect(screen.queryByText(/ใบนี้ยังไม่มีรูป — ใบพิมพ์/)).not.toBeInTheDocument();
    await userEvent.upload(pick(), file());
    await waitFor(() => expect(act_.uploadJobPhoto).toHaveBeenCalledTimes(1));
  });
});
