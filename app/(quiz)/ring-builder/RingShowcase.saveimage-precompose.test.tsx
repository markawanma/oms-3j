// @vitest-environment jsdom
// 25 พ.ย. 69 — แก้ review "iOS gesture หมดอายุ": สร้างรูปล่วงหน้า (pre-compose) แล้วกดแล้ว share() แบบ sync
//   · กดตอนพร้อม → navigator.share ถูกเรียกก่อน microtask ใดๆ (ไม่มี await) · กดตอนไม่พร้อม → ไม่ share ไป sheet
//   · เปลี่ยนค่าแล้วรูปเก่าไม่ถูกใช้ · ไม่ pre-compose ระหว่างลาก · ไม่ซ้อนงาน · ไม่ทำเมื่อเครื่องไม่มี share · designFailed ข้อความตรง
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { EMPTY_SHOWCASE_PARAMS, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_COPY, formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { DESIGNS } from "@/lib/ring-builder/showcase/designs";
import { RingShowcaseClient } from "./RingShowcaseClient";
import { SaveImageButton, PRECOMPOSE_DELAY_MS } from "./_components/SaveImageButton";

const h = vi.hoisted(() => {
  const state = { opts: null as null | { onReady?: () => void; onUnsupported?: (r: string) => void } };
  const renderer = { setTints: vi.fn(), setRing: vi.fn(), resetView: vi.fn(), dispose: vi.fn(), captureFront: vi.fn(() => new Uint8Array(4) as Uint8Array | null) };
  const createRingRenderer = vi.fn((_c: unknown, _r: unknown, opts: { onReady?: () => void; onUnsupported?: (r: string) => void }) => {
    state.opts = opts;
    opts.onReady?.();
    return renderer;
  });
  const makeSaveImage = vi.fn();
  return { state, renderer, createRingRenderer, makeSaveImage };
});

vi.mock("@/lib/ring-builder/viewer/gl-renderer", () => ({ isWebGLAvailable: () => true, createRingRenderer: h.createRingRenderer }));
vi.mock("@/lib/ring-builder/save-image/make-image", () => ({ makeSaveImage: h.makeSaveImage }));

/** รูปปลอมที่ชื่อไฟล์/alt บอกว่าสร้างจากแบบไหน — ใช้ตรวจว่ารูปที่ถูก share ตรงค่าปัจจุบัน */
function imageFor(input: { designId: string; size: number | null }) {
  return { ok: true, file: new File([new Uint8Array([1])], `3j-${input.designId}-${input.size ?? "x"}.jpg`, { type: "image/jpeg" }), alt: `${input.designId} ${formatPriceThb(input.designId as never)}` };
}

const OWN: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS };
const second = DESIGNS.find((d) => d.id !== "bypass2")!; // ค่าเริ่มต้นของเวทีคือ bypass2
const saveBtn = () => screen.getByRole("button", { name: new RegExp(`${SHOWCASE_COPY.saveButton}|${SHOWCASE_COPY.saveBusy}`) });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, PRECOMPOSE_DELAY_MS + 150))));
async function readyStage() {
  await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalled());
  await waitFor(() => expect(saveBtn()).toBeEnabled());
}
const nav = navigator as unknown as Record<string, unknown>;
function enableShare(share = vi.fn(async (_d: { files: File[] }) => undefined)) {
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  return share;
}

beforeEach(() => {
  h.createRingRenderer.mockClear();
  h.makeSaveImage.mockReset();
  h.makeSaveImage.mockImplementation(async (a: { input: { designId: string; size: number | null } }) => imageFor(a.input));
  URL.createObjectURL = vi.fn(() => "blob:test/1");
  URL.revokeObjectURL = vi.fn();
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  delete nav.canShare;
  delete nav.share;
});

describe("กดตอนรูปพร้อม → share() แบบ sync ใน gesture", () => {
  it("ค่านิ่ง → สร้างล่วงหน้า 1 ครั้ง · กด → share ถูกเรียกทันที (ก่อน microtask) ด้วยไฟล์ที่เตรียมไว้ · ไม่สร้างซ้ำ · ไม่ขึ้น 'บันทึกแล้ว' ไม่มี alert/sheet (S7)", async () => {
    const share = enableShare();
    const { container } = render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    expect(h.makeSaveImage).not.toHaveBeenCalled(); // ยังไม่นิ่ง
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    expect(h.makeSaveImage.mock.calls[0][0].input).toMatchObject({ designId: "bypass2", size: null });

    fireEvent.click(saveBtn()); // sync — ห้าม await ก่อนตรวจ
    expect(share).toHaveBeenCalledTimes(1); // เรียกใน handler เลย ไม่มี microtask คั่น
    const arg = share.mock.calls[0][0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe("3j-bypass2-x.jpg");
    expect(Object.keys(arg)).toEqual(["files"]); // ไม่ส่ง title/text/url
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);

    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).not.toMatch(/บันทึกแล้ว|✓.*รูป/);
    expect(saveBtn()).toBeEnabled();
  });

  it("S8: ผู้ใช้ยกเลิกเมนูแชร์ (AbortError) = เงียบ · share ล้มแบบอื่น (NotAllowedError) = เปิด sheet ให้กดค้าง", async () => {
    const share = enableShare(vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }))));
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    fireEvent.click(saveBtn());
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    share.mockImplementationOnce(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })));
    fireEvent.click(saveBtn());
    expect(await screen.findByRole("dialog", { name: SHOWCASE_COPY.saveSheetTitle })).toBeInTheDocument();
  });

  it("กดซ้ำระหว่างเมนูแชร์เปิดอยู่ → ไม่เรียก share ซ้อน", async () => {
    let finish!: () => void;
    const share = enableShare(vi.fn(() => new Promise<undefined>((r) => (finish = () => r(undefined)))));
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    fireEvent.click(saveBtn());
    fireEvent.click(saveBtn());
    expect(share).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    fireEvent.click(saveBtn());
    expect(share).toHaveBeenCalledTimes(2);
  });
});

describe("กดตอนยังไม่พร้อม → ไม่ share ไป sheet", () => {
  it("กดก่อนค่านิ่ง (ยังไม่มีรูปเตรียมไว้) → สร้างแล้วเปิด sheet · navigator.share ไม่ถูกเรียก", async () => {
    const share = enableShare();
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await u.click(saveBtn());
    expect(await screen.findByRole("dialog", { name: SHOWCASE_COPY.saveSheetTitle })).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
  });

  it("เครื่องไม่มี Web Share → ไม่สร้างล่วงหน้าเลย (ไม่ได้ประโยชน์) · กดแล้วเปิด sheet ตามเดิม", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    expect(h.makeSaveImage).not.toHaveBeenCalled();
    await u.click(saveBtn());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("สร้างล่วงหน้าไม่สำเร็จ → ไม่มีรูปเก็บไว้ · กดแล้วสร้างใหม่ (ไม่ share) · ยังล้ม = alert", async () => {
    const share = enableShare();
    h.makeSaveImage.mockResolvedValue({ ok: false });
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    await u.click(saveBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(SHOWCASE_COPY.saveFailed);
    expect(h.makeSaveImage).toHaveBeenCalledTimes(2);
    expect(share).not.toHaveBeenCalled();
  });
});

describe("เปลี่ยนค่า → รูปเก่าไม่ถูกใช้", () => {
  const pick = (u: ReturnType<typeof userEvent.setup>, id: string) => {
    const d = DESIGNS.find((x) => x.id === id)!;
    return u.click(screen.getByRole("radio", { name: `${d.name} ${formatPriceThb(d.id)}` }));
  };

  it("เตรียมรูปแบบ A แล้วเปลี่ยนเป็นแบบ B ทันทีแล้วกด → ไม่ share รูป A (key ไม่ตรง) · สร้างจากค่าใหม่แล้วเปิด sheet", async () => {
    const share = enableShare();
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    await pick(u, second.id);
    await u.click(saveBtn());
    expect(share).not.toHaveBeenCalled();
    const calls = h.makeSaveImage.mock.calls.map((c) => c[0].input.designId);
    expect(calls[calls.length - 1]).toBe(second.id);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("เปลี่ยนแบบ + ไซซ์ แล้วรอนิ่ง → รูปที่ share ตรงค่าใหม่ (ชื่อไฟล์/ราคาใน alt มาจาก input ใหม่ ไม่ใช่รูปเก่า)", async () => {
    const share = enableShare();
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle(); // รูป A
    await pick(u, second.id);
    await settle(); // รูป B
    fireEvent.click(saveBtn());
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files[0].name).toContain(second.id);
    expect(share.mock.calls[0][0].files[0].name).not.toContain("bypass2");
  });

  it("เปลี่ยนค่าถี่ๆ ภายในช่วง debounce → สร้างครั้งเดียวจากค่าสุดท้าย (ไม่สร้างทุกครั้งที่กด)", async () => {
    enableShare();
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await pick(u, DESIGNS.filter((d) => d.id !== "bypass2")[1].id);
    await pick(u, DESIGNS.filter((d) => d.id !== "bypass2")[2].id);
    await pick(u, second.id);
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    expect(h.makeSaveImage.mock.calls[0][0].input.designId).toBe(second.id);
  });
});

describe("ไม่กระตุกตอนลาก · ไม่ซ้อนงาน", () => {
  it("กำลังลากแหวน (pointerdown บน canvas) → ไม่ pre-compose · ปล่อยแล้วค่อยสร้าง", async () => {
    enableShare();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    const canvas = document.querySelector("canvas")!;
    expect(canvas).toBeTruthy();
    fireEvent.pointerDown(canvas);
    await settle();
    expect(h.makeSaveImage).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas);
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
  });

  it("pointerdown นอก canvas (เช่นกดปุ่มอื่น) ไม่นับเป็นลาก", async () => {
    enableShare();
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    fireEvent.pointerDown(document.body);
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
  });

  it("job กำลังวิ่ง แล้วผู้ใช้กด → รอ job เดิม (ไม่เริ่มงานซ้อน) · จบแล้วเปิด sheet จากรูปนั้น · ไม่ share", async () => {
    const share = enableShare();
    let release!: (v: unknown) => void;
    h.makeSaveImage.mockReturnValue(new Promise((r) => (release = r)));
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle(); // job เริ่มแล้วแต่ยังไม่จบ
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    fireEvent.click(saveBtn());
    expect(saveBtn()).toBeDisabled();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    await act(async () => release(imageFor({ designId: "bypass2", size: null })));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
  });

  it("เปลี่ยนค่าขณะ job เก่ายังวิ่ง → ไม่เริ่มงานซ้อน · รอเก่าจบแล้วสร้างใหม่ · รูปเก่าไม่ถูกเก็บ", async () => {
    const share = enableShare();
    const u = userEvent.setup();
    const releases: ((v: unknown) => void)[] = [];
    h.makeSaveImage.mockImplementation((a: { input: { designId: string; size: number | null } }) => new Promise((r) => releases.push(() => r(imageFor(a.input)))));
    render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle(); // job A วิ่งค้าง
    await u.click(screen.getByRole("radio", { name: `${second.name} ${formatPriceThb(second.id)}` }));
    await settle(); // ครบ debounce ของค่า B แต่ A ยังวิ่ง
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    await act(async () => releases[0](undefined)); // A จบ (ผลถูกทิ้ง)
    await settle();
    expect(h.makeSaveImage).toHaveBeenCalledTimes(2);
    expect(h.makeSaveImage.mock.calls[1][0].input.designId).toBe(second.id);
    await act(async () => releases[1](undefined));
    fireEvent.click(saveBtn());
    expect(share.mock.calls[0][0].files[0].name).toContain(second.id);
  });

  it("unmount ระหว่างสร้างล่วงหน้า → ไม่ error ไม่เปิดอะไร", async () => {
    enableShare();
    let release!: (v: unknown) => void;
    h.makeSaveImage.mockReturnValue(new Promise((r) => (release = r)));
    const a = render(<RingShowcaseClient params={OWN} />);
    await readyStage();
    await settle();
    a.unmount();
    await act(async () => release(imageFor({ designId: "bypass2", size: null })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled(); // ไม่มี objectURL ค้างจากรูปเตรียมไว้
  });
});

describe("designFailed: ข้อความตรงสาเหตุ", () => {
  const input = { designId: "bypass2", choice: { kind: "direct" }, size: null } as const;
  it("designFailed → 'บันทึกรูปไม่ได้ เพราะภาพ 3 มิติของแบบนี้โหลดไม่ได้' ไม่ใช่ 'รอโหลด' · ปุ่ม disabled", () => {
    render(<SaveImageButton input={input} ready={false} capture={null} designFailed />);
    expect(screen.getByText(SHOWCASE_COPY.saveDesignFailed)).toBeInTheDocument();
    expect(screen.queryByText(SHOWCASE_COPY.saveWaitStage)).toBeNull();
    expect(screen.getByRole("button", { name: SHOWCASE_COPY.saveButton })).toBeDisabled();
  });
  it("ยังโหลดอยู่ (ไม่ใช่ designFailed) → ข้อความรอเดิม", () => {
    render(<SaveImageButton input={input} ready={false} capture={null} />);
    expect(screen.getByText(SHOWCASE_COPY.saveWaitStage)).toBeInTheDocument();
    expect(screen.queryByText(SHOWCASE_COPY.saveDesignFailed)).toBeNull();
  });
  it("copy ใหม่ไม่มี 'เพชร'/URL/@", () => {
    expect(SHOWCASE_COPY.saveDesignFailed).not.toMatch(/เพชร|https?:|\.com|line\.me|@/);
  });
});
