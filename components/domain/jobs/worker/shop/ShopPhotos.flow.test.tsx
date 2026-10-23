// @vitest-environment jsdom
// W2 UI: W-5 ใส่รูปให้ช่างดู · แถวรูปที่ W-6/7 · W-8 ส่งรูป + QR gate + รูปหลักคู่ QR + exit guard + ล็อก/PIN — ทดสอบผ่าน ShopIntakeApp จริง (mock เฉพาะ action + ตัวย่อรูป)
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
const intakeGemCatalog = vi.fn();
vi.mock("@/lib/actions/job-worker", () => ({
  intakeGemCatalog: (...a: unknown[]) => intakeGemCatalog(...a),
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

import { ShopIntakeApp } from "./ShopIntakeApp";
import type { ShopInitial } from "./ShopHub";
import type { IntakeHubView, IntakeOpenResult, IntakeProduct } from "@/lib/jobs/worker-server";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const JOB_TOKEN = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx9";
const WA = "11111111-1111-4111-8111-111111111111";
const WB = "55555555-5555-4555-8555-555555555555";
const PID = "33333333-3333-4333-8333-333333333333";

const hubOf = (id = WA): ShopInitial => ({ kind: "hub", hub: { state: "ready", workers: [], worker: { id, displayName: "หัวหน้าช่าง" }, openAllowed: true, profileReady: true, goldProfileReady: true, sessionExpired: false } as IntakeHubView });
const identifyHub = (): ShopInitial => ({ kind: "hub", hub: { state: "identify", workers: [{ id: WA, displayName: "หัวหน้าช่าง" }], worker: null, openAllowed: false, profileReady: true, goldProfileReady: true, sessionExpired: true } });
const product = (): IntakeProduct => ({ id: PID, sku: "RG-0418", name: "แหวนโกเมนไข่", imageUrl: null, prefill: { metal: "silver", purity: 0.925, weightG: null, metalKnown: true } });
const okResult = (o: Partial<IntakeOpenResult> = {}): { ok: true; result: IntakeOpenResult } => ({
  ok: true,
  result: { already: false, status: "open", jobNo: "JB-0031", token: JOB_TOKEN, designLabel: "แหวนโกเมนไข่", sku: "RG-0418", skuPending: false, metal: "silver", qtyOrder: 30, qtyPlanned: null, isNewDesign: false, dueDate: null, ...o },
});

let urlSeq = 0;
const created: string[] = [];
const revoked: string[] = [];
const variants = (name: string) => ({
  md: { blob: new Blob([`md-${name}`]), width: 1200, height: 900, bytes: 10, quality: 0.9 },
  sm: { blob: new Blob([`sm-${name}`]), width: 480, height: 360, bytes: 5, quality: 0.9 },
});
const named = (name: string) => Object.assign(new Error("x"), { name });
const sp = (id: string, primary = false) => ({ id, smUrl: `https://s/${id}_sm`, mdUrl: `https://s/${id}_md`, isPrimary: primary, mine: true });

/** server จำลอง: รูปที่ n ตอบ p<n> (รูปแรกเป็นหลัก) */
let uploadN = 0;
function uploadOk() {
  intakeUploadPhoto.mockImplementation(async (_t: string, fd: FormData) => {
    uploadN += 1;
    return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1 || fd.get("isPrimary") === "true"), count: uploadN, max: 3 };
  });
}

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
  intakeSearch.mockResolvedValue({ ok: true, items: [product()] });
  intakeOpen.mockResolvedValue(okResult());
  workerLogout.mockResolvedValue({ ok: true });
  intakeSetPrimaryPhoto.mockResolvedValue({ ok: true, changed: true });
  intakeMyJobs.mockResolvedValue({ ok: true, openAllowed: true, jobs: [], maxPhotos: 3 });
  intakeGemCatalog.mockResolvedValue({ ok: true, types: [], shapes: [], sizes: [], hasTemplate: false, template: [], maxLines: 30 });
  intakeRemovePhoto.mockResolvedValue({ ok: true, promotedPhotoId: null, already: false });
  intakeListPhotos.mockResolvedValue({ ok: true, photos: [], count: 0, max: 3, locked: false, lockCode: null });
  resizeMock.mockImplementation(async (f: File) => variants(f.name));
  uploadOk();
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

/** W-4 พลอย: ตอบ "ไม่มีพลอย" แล้วไปต่อ (ไม่มีแม่แบบ = ต้องตอบก่อน) */
async function answerNoGems() {
  await userEvent.click(await screen.findByRole("radio", { name: "ไม่มีพลอย" }));
  await click("ถัดไป");
}
/** เปิดวิซาร์ด → เลือก SKU → จำนวน → พลอย (ไม่มี) → ถึง W-5 */
async function toPhotos(qty = "30") {
  await click("เปิดงานใหม่");
  await userEvent.type(screen.getByLabelText("ค้นชื่อสินค้าหรือรหัส"), "แหวน");
  await userEvent.click(await screen.findByRole("button", { name: /RG-0418/ }, { timeout: 3000 }));
  await click("ถัดไป");
  await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), qty);
  await click("ถัดไป");
  await answerNoGems();
  expect(screen.getByRole("heading", { level: 1, name: "ใส่รูปให้ช่างดู" })).toBeInTheDocument();
}
async function toPhotosNew() {
  await click("เปิดงานใหม่");
  await click("+ สินค้าใหม่ (ยังไม่มีรหัส)");
  await userEvent.type(screen.getByLabelText(/ชื่อแบบ/), "แหวนลายใบไม้");
  await click("ถัดไป");
  await click("ถัดไป");
  await userEvent.type(screen.getByLabelText("ต้องการเข้าสต็อก (ชิ้น)"), "30");
  await click("ถัดไป");
  await answerNoGems();
}
const tiles = () => within(screen.getByRole("list")).queryAllByRole("button");

describe("W-5 ใส่รูปให้ช่างดู", () => {
  it("เข้าขั้น: หัวขั้น + 'ไม่บังคับ · ใส่ได้สูงสุด 3 รูป' + ตัวนับ n/N ขยับเอง (มี SKU 4/5) · ว่าง = ข้อความมี SKU · ปุ่ม sticky = ข้าม (secondary)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("ไม่บังคับ · ใส่ได้สูงสุด 3 รูป")).toBeInTheDocument();
    expect(screen.getByText("รูป 0/3")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรูป — ไม่บังคับ ช่างดูจากชื่อและรหัสสินค้าได้")).toBeInTheDocument();
    const skip = screen.getByRole("button", { name: "ข้าม ไม่ใส่รูป" });
    expect(skip).not.toHaveClass("bg-primary-600"); // ไม่ใช่ปุ่มหลัก — รูปไม่ใช่ด่าน
    expect(skip).toHaveClass("border-2");
    expect(screen.getByText(/รูปยังอยู่ในเครื่องนี้ ยังไม่ส่ง — จะส่งหลังกด "เปิดงาน"/)).toBeInTheDocument();
    expect(screen.getByText("ถ่ายเฉพาะชิ้นงาน/แบบที่ต้องการ · ช่างทุกขั้นเห็นรูปนี้")).toBeInTheDocument();
    // ปุ่มเพิ่ม: ถ่ายรูป + เลือกจากคลัง (ป้ายของมือถือผู้จัดการ) ตัวหนังสือ ≥ 18px (text-lg)
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toHaveClass("text-lg", "min-h-14");
    expect(screen.getByRole("button", { name: "เลือกจากคลัง" })).toBeInTheDocument();
    expect(intakeOpen).not.toHaveBeenCalled(); // ขั้นนี้ไม่ใช้เน็ต ไม่ส่งอะไรไป
  });

  it("สินค้าใหม่ไม่มีรหัส: ข้อความ empty หนักกว่า (ตัวหนา) · ไม่บล็อก — ข้ามได้ · ตัวนับ 5/6", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotosNew();
    expect(screen.getByText("5/6")).toBeInTheDocument();
    const msg = screen.getByText("สินค้าใหม่ไม่มีรหัส — ถ่ายรูปให้ช่างรู้ว่าทำชิ้นไหน");
    expect(msg).toHaveClass("font-bold");
    await click("ข้าม ไม่ใส่รูป");
    expect(screen.getByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" })).toBeInTheDocument();
    // W-6/7: ไม่มีรูป + สินค้าใหม่ไม่มี SKU = ธงเตือน (ไม่บล็อก)
    expect(screen.getByText("ไม่มีรูป")).toBeInTheDocument();
    expect(screen.getByText("⚑ ช่างจะไม่เห็นภาพชิ้นงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดงาน" })).toBeEnabled();
  });

  it("เลือก 2 รูป: ภาพย่อ 3 คอลัมน์ · รูปแรก = รูปหลัก (★ + คำ) · ปุ่ม sticky เปลี่ยนเป็น 'ถัดไป' (primary) · ตัวนับ รูป 2/3", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    expect(screen.getByText("รูป 2/3")).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveClass("grid-cols-3");
    expect(tiles()[0]).toHaveAccessibleName("รูปที่ 1 จาก 2 · รูปหลัก · แตะเพื่อดู");
    expect(tiles()[1]).toHaveAccessibleName("รูปที่ 2 จาก 2 · แตะเพื่อดู");
    expect(within(tiles()[0]).getByText("รูปหลัก")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถัดไป" })).toHaveClass("bg-primary-600");
    expect(screen.queryByRole("button", { name: "ข้าม ไม่ใส่รูป" })).not.toBeInTheDocument();
    // ไม่วางปุ่ม ×/★ ทับภาพ (ช่อง ≈104px)
    expect(within(screen.getByRole("list")).queryAllByRole("button")).toHaveLength(2);
    // ยังอยู่ในเครื่อง — ไม่ส่งอะไร
    expect(intakeUploadPhoto).not.toHaveBeenCalled();
  });

  it("ระหว่างย่อ: ช่องขึ้น 'กำลังย่อรูป…' · 'ถัดไป' = aria-disabled 'รอย่อรูป…' กดแล้วไม่ไปไหน · ย่อเสร็จแล้วไปต่อได้", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    resizeMock.mockImplementation(async (f: File) => {
      await gate;
      return variants(f.name);
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a"]);
    expect(await screen.findByRole("status", { name: "กำลังย่อรูปที่ 1" })).toHaveAttribute("aria-busy", "true");
    const next = screen.getByRole("button", { name: "รอย่อรูป…" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(next);
    expect(screen.getByRole("heading", { level: 1, name: "ใส่รูปให้ช่างดู" })).toBeInTheDocument();
    await act(async () => release());
    await waitTrue(() => tiles().length === 1);
    await click("ถัดไป");
    expect(screen.getByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" })).toBeInTheDocument();
  });

  it("ไฟล์เปิดไม่ได้ (HEIC/เสีย): แถวแจ้ง role=alert ไม่กินช่อง ไม่บล็อกขั้น · ปิดแถวได้ · เลือกหลายไฟล์บอกว่ารูปที่ n ที่เลือก", async () => {
    resizeMock.mockImplementation(async (f: File) => {
      if (f.name === "b") throw named("HeicNotSupportedError");
      return variants(f.name);
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("รูปที่ 2 ที่เลือก — ไฟล์ HEIC เปิดไม่ได้");
    expect(alert).toHaveTextContent("iPhone: ตั้งค่า > กล้อง > รูปแบบ > รองรับมากที่สุด");
    await waitTrue(() => tiles().length === 1);
    expect(screen.getByText("รูป 1/3")).toBeInTheDocument(); // ไม่กินช่อง
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
    await click("ปิดข้อความนี้");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("เลือกเกินที่เหลือ: ตัดท้าย + แถบ amber role=status (ไม่ใช่ error)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    pick(["c", "d", "e"]);
    expect(await screen.findByText("เลือกมา 3 รูป ใส่ได้อีก 1 รูป — ตัด 2 รูปท้ายออก")).toHaveAttribute("role", "status");
    await waitTrue(() => tiles().length === 3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ครบ 3: ปุ่มเพิ่มหาย แทนด้วยกล่อง 'ครบ 3 รูปแล้ว' (focus ย้ายมาที่กล่อง ไม่หล่น)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b", "c"]);
    await waitTrue(() => tiles().length === 3);
    const full = screen.getByText("ครบ 3 รูปแล้ว — เอารูปออกก่อนถ้าจะเพิ่ม");
    expect(full).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    expect(screen.getByText("รูป 3/3")).toBeInTheDocument();
    await waitFor(() => expect(full).toHaveFocus());
  });

  it("แตะภาพ → viewer เต็มจอ (ปุ่มปิด 56px) · ตั้งเป็นรูปหลักได้ · เอารูปนี้ออกไม่ถามยืนยัน (ถ่ายใหม่ได้) · เอารูปสุดท้ายออก = ปิด viewer เอง", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    await userEvent.click(tiles()[1]);
    const dlg = screen.getByRole("dialog", { name: "รูปงาน ใบใหม่" });
    expect(within(dlg).getByRole("button", { name: "ปิดรูป" })).toHaveClass("h-14", "w-14");
    await userEvent.click(within(dlg).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    expect(await screen.findByText("ตั้งเป็นรูปหลักแล้ว")).toBeInTheDocument();
    await click("ปิดรูป");
    expect(tiles()[0]).toHaveAccessibleName(/รูปหลัก/); // รูปหลักขึ้นหน้า
    // เอารูปนี้ออก (รูปหลัก = b ตอนนี้อยู่ที่ 1)
    await userEvent.click(tiles()[0]);
    await userEvent.click(within(screen.getByRole("dialog", { name: "รูปงาน ใบใหม่" })).getByRole("button", { name: "เอารูปนี้ออก" }));
    expect(screen.queryByRole("dialog", { name: /ลบรูปนี้/ })).not.toBeInTheDocument(); // ไม่ถามยืนยัน
    expect(await screen.findByText("เอารูปออกแล้ว")).toBeInTheDocument();
    await waitTrue(() => tiles().length === 1);
    expect(tiles()[0]).toHaveAccessibleName(/รูปหลัก/); // รูปถัดไปเป็นหลักแทน
    await userEvent.click(tiles()[0]);
    await userEvent.click(within(screen.getByRole("dialog", { name: "รูปงาน ใบใหม่" })).getByRole("button", { name: "เอารูปนี้ออก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "รูปงาน ใบใหม่" })).not.toBeInTheDocument());
    expect(screen.getByText("รูป 0/3")).toBeInTheDocument();
    expect(revoked.length).toBe(created.length); // blob ทุกอันถูก revoke
    expect(screen.getByRole("button", { name: "ข้าม ไม่ใส่รูป" })).toBeInTheDocument();
  });

  it("กลับไปขั้นก่อนแล้วกลับมา รูปคงอยู่ · เปลี่ยนคน (workerId) = รูปหายพร้อมฟอร์ม + revoke ทุก blob", async () => {
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    await click("ย้อนกลับ");
    await click("ถัดไป");
    expect(tiles()).toHaveLength(2);
    expect(revoked).toHaveLength(0);
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WB)} />);
    await waitFor(() => expect(screen.getByText(/เปลี่ยนคนแล้ว — ล้างฟอร์มเดิม/)).toBeInTheDocument());
    expect(revoked.length).toBe(created.length);
    expect(created.length).toBeGreaterThan(0);
  });
});

describe("W-6/7 ทวน — แถวรูป", () => {
  it("แถวสุดท้ายของการ์ด: ภาพย่อ 56px + 'n รูป' + 'จะส่งหลังกด เปิดงาน' + [แก้] กลับ W-5 (รูปคงอยู่) · บรรทัดท้ายจอ 'ส่งรูป n รูปหลังเปิดงาน'", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b", "c"]);
    await waitTrue(() => tiles().length === 3);
    await click("ถัดไป");
    expect(screen.getByRole("heading", { level: 1, name: "ทวนก่อนเปิดงาน" })).toBeInTheDocument();
    expect(screen.getByText("3 รูป")).toBeInTheDocument();
    expect(screen.getByText('จะส่งหลังกด "เปิดงาน"')).toBeInTheDocument();
    expect(screen.getByText("ส่งรูป 3 รูปหลังเปิดงาน — อยู่หน้าจอนี้จนส่งเสร็จ")).toBeInTheDocument();
    const imgs = screen.getAllByRole("img", { name: /^รูปที่ \d จาก 3$/ });
    expect(imgs).toHaveLength(3);
    // แถวรูปเป็นแถวสุดท้ายของการ์ด (หลัง "แบบใหม่")
    const row = screen.getByText("รูป", { selector: "p" });
    expect(row.parentElement?.previousElementSibling).toHaveTextContent("แบบใหม่");
    await click("แก้รูป");
    expect(screen.getByRole("heading", { level: 1, name: "ใส่รูปให้ช่างดู" })).toBeInTheDocument();
    expect(tiles()).toHaveLength(3);
    expect(intakeOpen).not.toHaveBeenCalled();
  });

  it("เปิดงาน: คำขอเปิดใบ 'ไม่มีรูปไปด้วย' (รูปส่งแยกหลังเปิดสำเร็จ) · error ของการเปิด = รูปยังอยู่ในเครื่อง กดเปิดซ้ำด้วย idem key เดิม", async () => {
    intakeOpen.mockResolvedValueOnce({ ok: false, error: "เปิดงานไม่สำเร็จ", code: "error" });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a"]);
    await waitTrue(() => tiles().length === 1);
    await click("ถัดไป");
    await click("เปิดงาน");
    await waitFor(() => expect(intakeOpen).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(intakeOpen.mock.calls[0][1])).not.toMatch(/photo|md|sm|blob/i);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(intakeUploadPhoto).not.toHaveBeenCalled(); // ใบยังไม่เกิด — ไม่ส่งรูป
    expect(screen.getByText("1 รูป")).toBeInTheDocument();
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    expect(intakeOpen.mock.calls[1][1].idemKey).toBe(intakeOpen.mock.calls[0][1].idemKey);
  });
});

/** ถึงหน้า W-8 พร้อมรูป n รูป (รอ upload ตาม uploadImpl) */
async function openWithPhotos(names: string[]) {
  await toPhotos();
  pick(names);
  await waitTrue(() => tiles().length === names.length);
  await click("ถัดไป");
  await click("เปิดงาน");
  await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
}

describe("W-8 ส่งรูปหลังเปิดใบ + QR gate", () => {
  it("ส่งทีละรูป หลักก่อน ผูกด้วย idem key เดียวกับที่เปิดใบ · ระหว่างส่ง QR ซ่อน (กล่อง sky) + ข้อความ gate + ลิงก์ 'แสดง QR เลย' · ส่งครบ = QR + รูปหลักคู่ + แถบพับ", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    intakeUploadPhoto.mockImplementation(async (_t: string, fd: FormData) => {
      order.push(`${(fd.get("md") as File).size}:${fd.get("isPrimary") ?? "-"}`);
      uploadN += 1;
      if (uploadN === 1) await gate;
      return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    await userEvent.click(tiles()[1]);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ตั้งเป็นรูปหลัก" })); // b = หลัก
    await click("ปิดรูป");
    await click("ถัดไป");
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });

    // กำลังส่ง: QR ซ่อน · มี gate
    expect(screen.queryByRole("img", { name: /QR ใบงาน/ })).not.toBeInTheDocument();
    expect(screen.getByText("QR จะขึ้นเมื่อส่งรูปครบ — ให้ช่างรอก่อนสแกน จะได้เห็นรูปตอนรับงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แสดง QR เลย (รูปที่เหลือส่งต่อได้ถ้าช่างยังไม่รับงาน)" })).toBeInTheDocument();
    expect(screen.queryByText(/QR นี้แสดงครั้งเดียว/)).not.toBeInTheDocument();
    expect(screen.getByText("QR รอรูปส่งครบ")).toBeInTheDocument();
    // การ์ดรูป: หัว + ตัวนับ ส่งแล้ว/ทั้งหมด
    expect(screen.getByText("รูปจากหน้างาน")).toBeInTheDocument();
    expect(screen.getByText("รูป 0/2")).toBeInTheDocument();
    expect(screen.getByText("อย่าปิดหน้านี้ · อย่าล็อกจอ")).toBeInTheDocument();
    await waitFor(() => expect(intakeUploadPhoto).toHaveBeenCalledTimes(1));
    expect(intakeUploadPhoto.mock.calls[0][0]).toBe(TOKEN);
    const first = intakeUploadPhoto.mock.calls[0][1] as FormData;
    expect(first.get("idemKey")).toBe(intakeOpen.mock.calls[0][1].idemKey);
    expect(first.get("jobId")).toBeNull();
    expect(first.get("isPrimary")).toBe("true"); // รูป b ที่ผู้ใช้เลือกเป็นหลักไปก่อน
    expect(String(first.get("clientPhotoKey"))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // idempotency ต่อรูป (uuid)
    expect(screen.getAllByText("กำลังส่ง…").length).toBeGreaterThanOrEqual(1); // แถวรูป (+ ป้ายบนรูปหลักคู่ QR)
    expect(within(screen.getByTestId("qr-pair-photo")).getByText("กำลังส่ง…")).toBeInTheDocument();
    expect(screen.getByText("รอคิวส่ง")).toBeInTheDocument();

    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument());
    expect(order).toEqual([`${"md-b".length}:true`, `${"md-a".length}:-`]);
    // ส่งครบ: แถบพับ + QR คู่รูปหลัก
    expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument();
    expect(screen.getByText("แก้ได้จนช่างเริ่มรับงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /จัดการ/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("qr-pair-photo")).toBeInTheDocument();
    expect(screen.getByText("★ รูปหลัก · ช่างจะเห็นรูปนี้")).toBeInTheDocument();
    expect(screen.queryByTestId("qr-gate-box")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /แสดง QR เลย/ })).not.toBeInTheDocument();
    expect(screen.getByText(/QR นี้แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(screen.getByText("ส่งรูปครบแล้ว — QR พร้อมให้สแกน")).toBeInTheDocument(); // live region
    // รูปหลักบนคู่ = รูปจากไฟล์ในเครื่อง (ไม่รอ signed URL)
    expect(within(screen.getByTestId("qr-pair-photo")).getByRole("img", { name: "รูปหลักของใบงาน" }).getAttribute("src")).toMatch(/^blob:mock-/);
    // ไม่มี path/URL ของ server โผล่ในหน้า
    expect(document.body.innerHTML).not.toMatch(/https:\/\/s\//);
  });

  it("'แสดง QR เลย' ระหว่างส่ง → QR ขึ้นทันที รูปที่เหลือส่งต่อ · QR ไม่ซ่อนย้อนหลังเมื่อสถานะเปลี่ยน", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      await gate;
      return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    await click("ถัดไป");
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว/ });
    await click(/แสดง QR เลย/);
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.queryByText("QR จะขึ้นเมื่อส่งรูปครบ — ให้ช่างรอก่อนสแกน จะได้เห็นรูปตอนรับงาน")).not.toBeInTheDocument();
    expect(screen.getByText(/QR นี้แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(screen.getByText("อย่าปิดหน้านี้ · อย่าล็อกจอ")).toBeInTheDocument(); // ยังส่งอยู่
    await act(async () => release());
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
  });

  it("มีรูปล้ม (ไม่ busy): QR แสดง + กล่อง amber 'รูปที่ k ยังไม่ได้ส่ง…' · แถวล้ม ⚠ + ลองใหม่/เอาออก · รูปหลักคู่ QR มีป้าย ⚠ ยังไม่ได้ส่ง", async () => {
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      if (uploadN === 1) throw new Error("net");
      return { ok: true, photo: sp(`p${uploadN}`, false), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText("⚠ ส่งไม่สำเร็จ — ลองอีกครั้ง")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.getByText("รูปที่ 1 ยังไม่ได้ส่ง — ให้ช่างสแกนได้เลย แต่ช่างจะยังไม่เห็นรูปนั้น · ลองส่งใหม่ได้จนช่างรับงาน")).toBeInTheDocument();
    expect(within(screen.getByTestId("qr-pair-photo")).getByText("⚠ ยังไม่ได้ส่ง")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "ลองใหม่" });
    expect(retry).toHaveClass("min-h-12");
    expect(screen.getByRole("button", { name: "เอาออก" })).toBeInTheDocument();
    // ลองใหม่สำเร็จ → รูปหลักคู่ QR หายป้าย · กล่อง amber หาย
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, true), count: uploadN, max: 3 };
    });
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    expect(screen.queryByText("⚠ ยังไม่ได้ส่ง")).not.toBeInTheDocument();
  });

  it("เอาออกรูปที่ส่งไม่สำเร็จ = ทิ้งในเครื่องทันที ไม่เรียก server · เหลือรูปเดียวที่ถึง server = แถบพับ", async () => {
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      if (uploadN === 2) return { ok: false, error: "ไฟล์ไม่ใช่ JPEG จริง", code: "photo_file_not_jpeg" };
      return { ok: true, photo: sp(`p${uploadN}`, true), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText("⚠ ไฟล์ไม่ใช่ JPEG จริง")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument(); // ลองใหม่ไม่ช่วย — มีแต่เอาออก
    await click("เอาออก");
    expect(intakeRemovePhoto).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
  });

  it("ส่งถี่ (rate_limited) → ข้อความ 'รอสักครู่แล้วกด ลองใหม่' · ครบเพดาน → 'ใบนี้มีรูปจากหน้างานครบ 3 รูปแล้ว' (ไม่มีลองใหม่)", async () => {
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      if (uploadN === 1) return { ok: false, error: "x", code: "rate_limited", retryAfterSeconds: 30 };
      return { ok: false, error: "x", code: "photo_cap_shopfloor" };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText('⚠ ส่งถี่เกินไป — รอสักครู่แล้วกด "ลองใหม่"')).toBeInTheDocument());
    expect(screen.getByText("⚠ ใบนี้มีรูปจากหน้างานครบ 3 รูปแล้ว")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "ลองใหม่" })).toHaveLength(1);
  });

  it("โควตาหน้างานเต็ม (photo_daily_cap): ทุกแถวขึ้น '⚠ วันนี้แนบรูปครบกำหนดแล้ว' ไม่มีปุ่ม ลองใหม่ (มีแต่ เอาออก) · ยิง server ครั้งเดียว · QR แสดง + กล่องเตือนรูปที่ยังไม่ได้ส่ง", async () => {
    intakeUploadPhoto.mockResolvedValue({ ok: false, error: "วันนี้แนบรูปครบกำหนดแล้ว", code: "photo_daily_cap" });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getAllByText("⚠ วันนี้แนบรูปครบกำหนดแล้ว")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ลองใหม่ทั้งหมด/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "เอาออก" })).toHaveLength(2);
    expect(intakeUploadPhoto).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.getByText(/รูปที่ 1, 2 ยังไม่ได้ส่ง — ให้ช่างสแกนได้เลย/)).toBeInTheDocument();
  });

  it("ล้มตั้งแต่ ≥ 2 รูป + มีเน็ต: ปุ่ม 'ลองใหม่ทั้งหมด (n รูป)' · ไม่ส่งเองอัตโนมัติ", async () => {
    let fail = true;
    intakeUploadPhoto.mockImplementation(async () => {
      if (fail) throw new Error("net");
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "ลองใหม่" })).toHaveLength(2));
    const calls = intakeUploadPhoto.mock.calls.length;
    fail = false;
    await click("ลองใหม่ทั้งหมด (2 รูป)");
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    expect(intakeUploadPhoto.mock.calls.length).toBeGreaterThan(calls);
  });

  it("เน็ตหลุดระหว่างส่ง: แถบ amber 'ไม่มีอินเทอร์เน็ต…' · เน็ตกลับ + มีรูปแดง = 'เน็ตกลับมาแล้ว — แตะ ลองใหม่…'", async () => {
    let fail = true;
    intakeUploadPhoto.mockImplementation(async () => {
      if (fail) throw new Error("net");
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, true), count: uploadN, max: 3 };
    });
    const nav = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    await waitFor(() => expect(screen.getByText("⚠ ส่งไม่สำเร็จ — ไม่มีเน็ต")).toBeInTheDocument());
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("ไม่มีอินเทอร์เน็ต — ส่งรูปไม่ได้ตอนนี้ ห้ามปิดหน้านี้")).toBeInTheDocument();
    nav.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByText('เน็ตกลับมาแล้ว — แตะ "ลองใหม่" ที่รูปสีแดง')).toBeInTheDocument();
    fail = false;
    await click("ลองใหม่");
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
  });
});

describe("ล็อก — ช่างรับงานแล้ว", () => {
  it("server ตอบ job_locked: แถบ 🔒 'ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ' · รูปที่ยังไม่ส่ง = 'ไม่ได้ส่ง — ช่างรับงานแล้ว' + เอาออก · ซ่อนเพิ่ม/ลองใหม่/จัดการ · QR ยังแสดง", async () => {
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      if (uploadN === 1) return { ok: true, photo: sp("p1", true), count: 1, max: 3 };
      return { ok: false, error: "ช่างเริ่มรับงานแล้ว", code: "job_locked" };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b", "c"]);
    await waitFor(() => expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument());
    expect(screen.getAllByText("⚠ ไม่ได้ส่ง — ช่างรับงานแล้ว")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /จัดการ/ })).not.toBeInTheDocument();
    expect(screen.queryByText("อย่าปิดหน้านี้ · อย่าล็อกจอ")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    // รูปที่ส่งแล้วดูได้ (viewer ไม่มีแถบจัดการ) · ลบ/★ ไม่ได้
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 1 จาก 3 · รูปหลัก · แตะเพื่อดู/ }));
    const dlg = screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
    expect(within(dlg).queryByRole("button", { name: /ตั้งเป็นรูปหลัก|ลบรูปนี้|เอารูปนี้ออก/ })).not.toBeInTheDocument();
    await click("ปิดรูป");
    // เอารูปที่ยังไม่ส่งออก (ในเครื่อง) ได้
    await userEvent.click(screen.getAllByRole("button", { name: "เอาออก" })[0]);
    expect(intakeRemovePhoto).not.toHaveBeenCalled();
    expect(screen.getAllByText("⚠ ไม่ได้ส่ง — ช่างรับงานแล้ว")).toHaveLength(1);
  });

  it("exit guard ตอนล็อก + มีรูปไม่ได้ส่ง: ข้อความ 'ช่างรับงานแล้ว ส่งเพิ่มไม่ได้' · ปุ่มหลัก = 'ออกจากหน้านี้'", async () => {
    intakeUploadPhoto.mockResolvedValue({ ok: false, error: "x", code: "job_locked" });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    await waitFor(() => expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument());
    await click("เสร็จแล้ว");
    const dlg = screen.getByRole("dialog", { name: "ยังส่งรูปไม่ครบ" });
    expect(within(dlg).getByText("รูปที่ไม่ได้ส่งจะหาย — ช่างรับงานแล้ว ส่งเพิ่มไม่ได้")).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole("button", { name: "ออกจากหน้านี้" }));
    expect(await screen.findByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });
});

describe("exit guard", () => {
  it("กด 'เสร็จแล้ว'/'เปิดอีกใบ' ตอนยังส่งไม่ครบ → แผ่นยืนยัน (focus เริ่มที่ 'กลับไปส่งรูปต่อ') · QR ก็จะหาย · ใบยังอยู่ใน 'ใบที่ฉันเปิด' · ออกเลย = ทิ้งรูป + revoke", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    intakeUploadPhoto.mockImplementation(async () => {
      await gate;
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await click("เสร็จแล้ว");
    const dlg = screen.getByRole("dialog", { name: "ยังส่งรูปไม่ครบ" });
    expect(within(dlg).getByText("รูปที่ 1, 2 ยังไม่ได้ส่ง ถ้าออกตอนนี้รูปนั้นจะหาย")).toBeInTheDocument();
    expect(within(dlg).getByText(/และ QR ก็จะหายจากจอด้วย — ดูซ้ำไม่ได้/)).toBeInTheDocument();
    expect(within(dlg).getByText('ใบนี้ยังอยู่ใน "ใบที่ฉันเปิด" เพิ่มรูปใหม่ได้ถ้าช่างยังไม่รับงาน')).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByRole("button", { name: "กลับไปส่งรูปต่อ" })).toHaveFocus());
    await userEvent.click(within(dlg).getByRole("button", { name: "กลับไปส่งรูปต่อ" }));
    expect(screen.queryByRole("dialog", { name: "ยังส่งรูปไม่ครบ" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /เปิดงานแล้ว/ })).toBeInTheDocument();
    // เปิดอีกใบ ก็ถูกด่านเดียวกัน
    await click("เปิดอีกใบ");
    expect(screen.getByRole("dialog", { name: "ยังส่งรูปไม่ครบ" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ออกเลย — ทิ้งรูปที่ยังไม่ส่ง" }));
    expect(screen.getByRole("heading", { level: 1, name: "ผลิตอะไร?" })).toBeInTheDocument();
    expect(revoked.length).toBe(created.length);
    await act(async () => release());
  });

  it("ส่งครบแล้ว / ไม่เลือกรูป = ออกได้ทันที ไม่มีขั้นเพิ่ม", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
    await click("เสร็จแล้ว");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "เปิดงานใหม่" })).toBeInTheDocument();
  });

  it("beforeunload: ลงทะเบียนเมื่อมีรูปค้าง · ถอนเมื่อส่งครบ", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    intakeUploadPhoto.mockImplementation(async () => {
      await gate;
      return { ok: true, photo: sp("p1", true), count: 1, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    expect(add.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
    expect(remove.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
  });
});

describe("session หมดเวลากลางส่ง (PIN) — ฟอร์ม/รูป/QR ไม่หาย", () => {
  it("แถวล้ม 'หมดเวลาแล้ว — ใส่ PIN ใหม่' + ปุ่ม 'ใส่ PIN ใหม่' → โหลด hub (แผ่น PIN) · ใส่ PIN แล้วกลับมา QR/รูปยังอยู่ · กด ลองใหม่ ส่งต่อได้", async () => {
    let expired = true;
    intakeUploadPhoto.mockImplementation(async () => {
      if (expired) return { ok: false, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" };
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, uploadN === 1), count: uploadN, max: 3 };
    });
    const { rerender } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getAllByText("⚠ หมดเวลาแล้ว — ใส่ PIN ใหม่")).toHaveLength(2));
    expect(intakeUploadPhoto).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: "ใส่ PIN ใหม่" }));
    expect(refresh).toHaveBeenCalled();
    // hub โหลดใหม่เป็นแผ่น PIN (ฟอร์มซ่อน — ไม่ unmount)
    rerender(<ShopIntakeApp token={TOKEN} initial={identifyHub()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "ใครกำลังเปิดงาน?" })).toBeInTheDocument();
    // ฟอร์ม/QR ยังอยู่ใน DOM (ซ่อนไว้ ไม่ unmount) — แค่มองไม่เห็นระหว่างแผ่น PIN
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031", hidden: true })).not.toBeVisible();
    // คนเดิมใส่ PIN สำเร็จ → กลับมาที่หน้า W-8 เดิม
    expired = false;
    rerender(<ShopIntakeApp token={TOKEN} initial={hubOf(WA)} />);
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument();
    expect(screen.getAllByText("⚠ หมดเวลาแล้ว — ใส่ PIN ใหม่")).toHaveLength(2);
    await click("ลองใหม่ทั้งหมด (2 รูป)");
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
  });
});

describe("ไม่เลือกรูป / W-8b / ยกเลิก", () => {
  it("ไม่เลือกรูปเลย: W-8a เดิมทุกประการ (QR 200px ไม่มี gate/คู่รูป) + แถวเดียว '＋ เพิ่มรูป' · เพิ่มแล้วการ์ดรูปขึ้น QR คงอยู่", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    await click("ข้าม ไม่ใส่รูป");
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว JB-0031/ });
    const qr = screen.getByRole("img", { name: "QR ใบงาน JB-0031" });
    expect(qr).toHaveClass("h-[200px]", "w-[200px]");
    expect(screen.queryByTestId("qr-pair-photo")).not.toBeInTheDocument();
    expect(screen.queryByText(/QR จะขึ้นเมื่อส่งรูปครบ/)).not.toBeInTheDocument();
    expect(screen.queryByText("รูปจากหน้างาน")).not.toBeInTheDocument();
    expect(intakeUploadPhoto).not.toHaveBeenCalled();
    expect(screen.getByText(/QR นี้แสดงครั้งเดียว/)).toBeInTheDocument();
    // แถวเดียวใต้ QR
    await click("＋ เพิ่มรูป (ช่างจะเห็นตอนสแกน)");
    pick(["z"]);
    await waitFor(() => expect(intakeUploadPhoto).toHaveBeenCalledTimes(1));
    expect((intakeUploadPhoto.mock.calls[0][1] as FormData).get("idemKey")).toBe(intakeOpen.mock.calls[0][1].idemKey);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "QR ใบงาน JB-0031" })).toBeInTheDocument(); // ไม่ซ่อนย้อนหลัง
    expect(screen.queryByText(/QR จะขึ้นเมื่อส่งรูปครบ/)).not.toBeInTheDocument();
  });

  it("W-8b (กดซ้ำ/เน็ตสะดุด 'เปิดไว้แล้ว'): ไม่มี QR ไม่มี gate · รูปยังส่งต่อได้ด้วยการ์ดเดียวกัน · เสร็จแล้วใช้ exit guard เดียวกัน", async () => {
    intakeOpen.mockResolvedValue(okResult({ already: true, token: null }));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    intakeUploadPhoto.mockImplementation(async () => {
      await gate;
      uploadN += 1;
      return { ok: true, photo: sp(`p${uploadN}`, true), count: uploadN, max: 3 };
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a"]);
    await waitTrue(() => tiles().length === 1);
    await click("ถัดไป");
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดไว้แล้ว JB-0031/ });
    expect(screen.queryByRole("img", { name: /QR ใบงาน/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/QR จะขึ้นเมื่อส่งรูปครบ/)).not.toBeInTheDocument();
    expect(screen.getByText("รูปจากหน้างาน")).toBeInTheDocument();
    await click("เสร็จแล้ว");
    expect(screen.getByRole("dialog", { name: "ยังส่งรูปไม่ครบ" })).toBeInTheDocument();
    expect(screen.queryByText(/และ QR ก็จะหายจากจอด้วย/)).not.toBeInTheDocument(); // ไม่มี QR ให้หาย
    await userEvent.click(screen.getByRole("button", { name: "กลับไปส่งรูปต่อ" }));
    await act(async () => release());
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
  });

  it("ใบถูกยกเลิกไปแล้ว: ไม่แสดงการ์ดรูป · ไม่ส่งรูป · รูปที่ค้างหายพร้อมหน้า (revoke)", async () => {
    intakeOpen.mockResolvedValue(okResult({ already: true, status: "cancelled", token: null }));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await toPhotos();
    pick(["a"]);
    await waitTrue(() => tiles().length === 1);
    await click("ถัดไป");
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /ใบนี้ถูกยกเลิกแล้ว JB-0031/ });
    expect(screen.queryByText("รูปจากหน้างาน")).not.toBeInTheDocument();
    expect(intakeUploadPhoto).not.toHaveBeenCalled();
    expect(revoked.length).toBe(created.length);
    await click("เสร็จแล้ว");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ตั้งรูปหลักหลังส่งแล้ว (intakeSetPrimaryPhoto)", () => {
  async function sentTwo() {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    await click(/จัดการ/);
  }
  const openViewerOf = async (n: number) => {
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^รูปที่ ${n} จาก 2 ·`) }));
    return screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
  };

  it("ปุ่ม ★ เปิดหลังส่งแล้ว: เรียก intakeSetPrimaryPhoto(token, { idemKey ของใบ, photoId }) · ดาวย้ายทันที + 'ตั้งเป็นรูปหลักแล้ว' · รูปหลักอยู่แล้ว = ปุ่ม disabled", async () => {
    await sentTwo();
    const d1 = await openViewerOf(1);
    expect(within(d1).getByRole("button", { name: "เป็นรูปหลักอยู่แล้ว" })).toBeDisabled();
    await click("ปิดรูป");
    const d2 = await openViewerOf(2);
    await userEvent.click(within(d2).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    await waitFor(() => expect(intakeSetPrimaryPhoto).toHaveBeenCalledTimes(1));
    expect(intakeSetPrimaryPhoto).toHaveBeenCalledWith(TOKEN, { idemKey: intakeOpen.mock.calls[0][1].idemKey, photoId: "p2" });
    expect(await screen.findByText("ตั้งเป็นรูปหลักแล้ว")).toBeInTheDocument();
    await click("ปิดรูป");
    expect(within(screen.getByRole("region", { name: "รูปจากหน้างาน" })).getAllByRole("listitem")[0]).toHaveTextContent("รูปที่ 1");
    expect(within(screen.getByRole("region", { name: "รูปจากหน้างาน" })).getAllByRole("listitem")[0]).toHaveTextContent("★ รูปหลัก");
  });

  it("primary_locked (ออฟฟิศตั้งรูปหลักไว้) → ข้อความ 'รูปหลักออฟฟิศตั้งไว้แล้ว — แจ้งออฟฟิศถ้าจะเปลี่ยน' · ดาวย้อนกลับ · ปุ่มยังอยู่ (ไม่ล็อกใบ)", async () => {
    intakeSetPrimaryPhoto.mockResolvedValue({ ok: false, error: "รูปหลักตั้งโดยออฟฟิศแล้ว — เปลี่ยนไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ", code: "primary_locked" });
    await sentTwo();
    const d2 = await openViewerOf(2);
    await userEvent.click(within(d2).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    expect(await screen.findByText("รูปหลักออฟฟิศตั้งไว้แล้ว — แจ้งออฟฟิศถ้าจะเปลี่ยน")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "รูปงาน JB-0031" })).getByRole("button", { name: "ตั้งเป็นรูปหลัก" })).toBeEnabled();
    await click("ปิดรูป");
    expect(within(screen.getByRole("region", { name: "รูปจากหน้างาน" })).getAllByRole("listitem")[0]).toHaveTextContent("★ รูปหลัก");
    expect(screen.queryByText(/🔒/)).not.toBeInTheDocument();
  });

  it("ตั้งรูปหลักแล้วช่างเพิ่งรับงาน (job_locked) → ล็อกทั้งจอ: แถบ 🔒 · ซ่อนเพิ่ม/จัดการ", async () => {
    intakeSetPrimaryPhoto.mockResolvedValue({ ok: false, error: "x", code: "job_locked" });
    await sentTwo();
    const d2 = await openViewerOf(2);
    await userEvent.click(within(d2).getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));
    expect(await screen.findByText("ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ", { selector: "p[role=status]" })).toBeInTheDocument();
    await click("ปิดรูป");
    expect(screen.getByText("🔒 ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ถ่ายรูป" })).not.toBeInTheDocument();
  });
});

describe("ลบรูปที่ส่งแล้ว (หลังเปิด)", () => {
  it("แถบพับ → จัดการ ▾ → ปุ่มเพิ่มรูป + ข้อความกลับมาแก้ที่ 'ใบที่ฉันเปิด' · แตะ thumb → viewer · ลบ = กล่องยืนยัน (focus ที่ ยกเลิก) · ลบสำเร็จเรียก server + toast", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    await click(/จัดการ/);
    expect(screen.getByText('ออกจากหน้านี้แล้ว กลับมาแก้ได้ที่ "ใบที่ฉันเปิด" จนช่างเริ่มรับงาน')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถ่ายรูป" })).toBeInTheDocument();
    expect(screen.getByText("รูป 2/2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 2 จาก 2 · แตะเพื่อดู/ }));
    const dlg = screen.getByRole("dialog", { name: "รูปงาน JB-0031" });
    expect(within(dlg).getByRole("button", { name: "ตั้งเป็นรูปหลัก" })).toBeEnabled(); // รูปที่ส่งแล้วตั้งรูปหลักได้ (intakeSetPrimaryPhoto)
    await userEvent.click(within(dlg).getByRole("button", { name: "ลบรูปนี้" }));
    const confirm = screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
    expect(intakeRemovePhoto).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(intakeRemovePhoto).toHaveBeenCalledWith(TOKEN, "p2"));
    expect(await screen.findByText("ลบรูปแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /ลบรูปนี้/ })).not.toBeInTheDocument());
    expect(screen.getByText("รูป 1/1")).toBeInTheDocument();
  });

  it("ลบล้ม (เน็ต) → ข้อความในกล่อง คงกล่องไว้ให้กดซ้ำ · รูปยังอยู่", async () => {
    intakeRemovePhoto.mockRejectedValueOnce(new Error("net"));
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /รูปที่ 1 จาก 1 · รูปหลัก · แตะเพื่อดู/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "รูปงาน JB-0031" })).getByRole("button", { name: "ลบรูปนี้" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).getByRole("button", { name: "ลบรูป" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ลบรูปไม่สำเร็จ — เช็คสัญญาณแล้วลองอีกครั้ง");
    expect(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog", { name: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้" })).getByRole("button", { name: "ลบรูป" }));
    await waitFor(() => expect(intakeRemovePhoto).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /ลบรูปนี้/ })).not.toBeInTheDocument());
  });
});

describe("รอบแก้ review/QA", () => {
  it("QA🐞3 เอาออกแถวที่ส่งล้มแบบไม่รู้ผล (คำขอหลุดกลางทาง) → ข้อความ 'ถ้ารูปนี้ส่งถึงแล้ว จะอยู่ใน ใบที่ฉันเปิด — ลบได้ที่นั่น' · ล้มแบบ server ตอบปฏิเสธ = ไม่มีข้อความนี้", async () => {
    intakeUploadPhoto.mockImplementation(async () => {
      uploadN += 1;
      if (uploadN === 1) throw new Error("net"); // ไม่รู้ผล
      return { ok: false, error: "ไฟล์ไม่ใช่ JPEG จริง", code: "photo_file_not_jpeg" }; // server ตอบชัดเจน
    });
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a", "b"]);
    await waitFor(() => expect(screen.getByText("⚠ ส่งไม่สำเร็จ — ลองอีกครั้ง")).toBeInTheDocument());
    const notice = 'ถ้ารูปนี้ส่งถึงแล้ว จะอยู่ใน "ใบที่ฉันเปิด" — ลบได้ที่นั่น';
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    const rowsNow = within(screen.getByRole("region", { name: "รูปจากหน้างาน" })).getAllByRole("listitem");
    const uncertain = rowsNow.find((r) => r.textContent?.includes("ส่งไม่สำเร็จ — ลองอีกครั้ง"))!;
    const definite = rowsNow.find((r) => r.textContent?.includes("ไฟล์"))!;
    await userEvent.click(within(definite).getByRole("button", { name: "เอาออก" }));
    expect(screen.queryByText(notice)).not.toBeInTheDocument(); // server ปฏิเสธชัดเจน = รูปไม่อยู่ที่ server
    await userEvent.click(within(uncertain).getByRole("button", { name: "เอาออก" }));
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(intakeRemovePhoto).not.toHaveBeenCalled();
  });

  it("security L1: <img> ใหม่ทุกจอรูปมี referrerpolicy=no-referrer (W-5 ภาพย่อ · ทวน · การ์ด/แถบพับ · รูปหลักคู่ QR)", async () => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    const all = () => [...container.querySelectorAll("img")];
    const ok = () => {
      expect(all().length).toBeGreaterThan(0);
      for (const im of all()) expect(im.getAttribute("referrerpolicy"), im.outerHTML.slice(0, 60)).toBe("no-referrer");
    };
    await toPhotos();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    ok();
    await click("ถัดไป");
    ok();
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว/ });
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    ok();
    expect(screen.getByTestId("qr-pair-photo").querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
    await click(/จัดการ/);
    ok();
  });

  it("คู่รูปหลัก+QR ไม่ล้นที่จอ 320: ซ้อนแนวตั้ง (flex-col) ต่ำกว่า 360px · วางคู่ (flex-row) ตั้งแต่ 360px (128+8+184 = 320 ≤ เนื้อหา 328)", async () => {
    render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    await openWithPhotos(["a"]);
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 1 รูป")).toBeInTheDocument());
    const wrap = screen.getByTestId("qr-pair-photo").parentElement!;
    expect(wrap.className).toContain("flex-col");
    expect(wrap.className).toContain("min-[360px]:flex-row");
    expect(wrap.className).toContain("items-center");
    expect(screen.getByTestId("qr-pair-photo")).toHaveClass("h-32", "w-32", "shrink-0");
  });
});

describe("🔴 ไม่มีเงิน/น้ำหนักทอง/ลิงก์ ทุกจอรูป", () => {
  it("W-5 · W-6/7 · W-8 (ระหว่างส่ง/ส่งครบ/ล้ม)", async () => {
    const { container } = render(<ShopIntakeApp token={TOKEN} initial={hubOf()} />);
    const clean = () => {
      expect(container.textContent).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|กรัม/i);
      expect(container.querySelectorAll("a, [href]").length).toBe(0);
    };
    await toPhotos();
    clean();
    pick(["a", "b"]);
    await waitTrue(() => tiles().length === 2);
    clean();
    await click("ถัดไป");
    clean();
    await click("เปิดงาน");
    await screen.findByRole("heading", { level: 1, name: /เปิดงานแล้ว/ });
    clean();
    await waitFor(() => expect(screen.getByText("✓ ส่งรูปแล้ว 2 รูป")).toBeInTheDocument());
    clean();
  });
});
