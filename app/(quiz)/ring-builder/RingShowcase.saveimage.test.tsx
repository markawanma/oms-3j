// @vitest-environment jsdom
// 25 พ.ย. 69 — ปุ่ม "บันทึกรูป" (S1–S18 / N1–N11) + ปุ่ม "แก้" P1d · gl-renderer ถูก mock ที่ระดับโมดูล · make-image/deliver mock เฉพาะกลไกภายใน
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { EMPTY_SHOWCASE_PARAMS, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_COPY, formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { buildShowcaseLineHref } from "@/lib/ring-builder/showcase/line-message";
import { buildShowcaseDetailRows } from "@/lib/ring-builder/showcase/detail-rows";
import { DESIGNS } from "@/lib/ring-builder/showcase/designs";
import { OrderSummary } from "./_components/OrderSummary";
import { RingShowcaseClient } from "./RingShowcaseClient";

const h = vi.hoisted(() => {
  const state = { webgl: true, opts: null as null | { onReady?: () => void; onUnsupported?: (r: string) => void } };
  const capture = vi.fn((_w?: number, _h?: number) => new Uint8Array(4) as Uint8Array | null);
  const renderer = { setTints: vi.fn(), setRing: vi.fn(), resetView: vi.fn(), dispose: vi.fn(), captureFront: capture };
  const createRingRenderer = vi.fn((_c: unknown, _r: unknown, opts: { onReady?: () => void; onUnsupported?: (r: string) => void }) => {
    state.opts = opts;
    opts.onReady?.();
    return renderer;
  });
  const makeSaveImage = vi.fn();
  const deliverImage = vi.fn();
  return { state, renderer, capture, createRingRenderer, makeSaveImage, deliverImage };
});

vi.mock("@/lib/ring-builder/viewer/gl-renderer", () => ({
  isWebGLAvailable: () => h.state.webgl,
  createRingRenderer: h.createRingRenderer,
}));
vi.mock("@/lib/ring-builder/save-image/make-image", () => ({ makeSaveImage: h.makeSaveImage }));
vi.mock("@/lib/ring-builder/save-image/deliver", async (orig) => {
  const m = await orig<typeof import("@/lib/ring-builder/save-image/deliver")>();
  return { ...m, deliverImage: h.deliverImage };
});

const URLS = { created: [] as string[], revoked: [] as string[] };
function okImage() {
  return { ok: true, file: new File([new Uint8Array([1])], "3j-ring-20261125.jpg", { type: "image/jpeg" }), alt: "แบบแหวน ไขว้ · ราคา 890 บาท" };
}

beforeEach(() => {
  h.state.webgl = true;
  h.createRingRenderer.mockClear();
  h.capture.mockClear();
  h.makeSaveImage.mockReset();
  h.deliverImage.mockReset();
  URLS.created = [];
  URLS.revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:test/${++n}`;
    URLS.created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => {
    URLS.revoked.push(u);
  });
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const saveBtn = () => screen.queryByRole("button", { name: new RegExp(`${SHOWCASE_COPY.saveButton}|${SHOWCASE_COPY.saveBusy}`) });
async function readyStage() {
  await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalled());
  await waitFor(() => expect(saveBtn()).toBeEnabled());
}
const OWN_DESIGN: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS };

describe("สถานะปุ่มตามเวที (§4)", () => {
  it("เวที ready → ปุ่มกดได้ · ไม่มีข้อความรอ", async () => {
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    expect(screen.queryByText(SHOWCASE_COPY.saveWaitStage)).toBeNull();
  });

  it("เวทียังไม่ ready (mount ใหม่ · loading) → ปุ่ม disabled + ข้อความรอ", () => {
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByText(SHOWCASE_COPY.saveWaitStage)).toBeInTheDocument();
  });

  it("unsupported (ไม่มี WebGL) → ซ่อนปุ่ม · คัดลอกข้อความยังอยู่ (S5)", async () => {
    h.state.webgl = false;
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await waitFor(() => expect(screen.queryByText(SHOWCASE_COPY.saveWaitStage)).toBeNull());
    expect(saveBtn()).toBeNull();
    expect(screen.getByRole("button", { name: SHOWCASE_COPY.copyButton })).toBeInTheDocument();
  });

  it("context lost → disabled + ข้อความรอ · กลับมา ready เอง → ปุ่มเปิด (N6)", async () => {
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    act(() => h.state.opts?.onUnsupported?.("context_lost"));
    await waitFor(() => expect(saveBtn()).toBeDisabled());
    expect(screen.getByText(SHOWCASE_COPY.saveWaitStage)).toBeInTheDocument();
    act(() => h.state.opts?.onReady?.());
    await waitFor(() => expect(saveBtn()).toBeEnabled());
  });

  it("แถวรองมี คัดลอกข้อความ → บันทึกรูป ตามลำดับ DOM หลังปุ่ม LINE (N10) · ปุ่ม ≥44px (min-h-14) ไอคอน aria-hidden (S17)", async () => {
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    const line = screen.getByRole("link", { name: new RegExp(SHOWCASE_COPY.lineButton) });
    const copy = screen.getByRole("button", { name: SHOWCASE_COPY.copyButton });
    const save = saveBtn()!;
    const order = [line, copy, save].map((el) => Array.from(document.querySelectorAll("a,button")).indexOf(el));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(save.className).toContain("min-h-14");
    expect(save.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("กดบันทึกรูป", () => {
  it("ยังไม่มีรูปที่เตรียมไว้: สร้างจาก capture + input ตอนกด แล้วเปิด sheet · ไม่เรียก share หลัง await (iOS gesture) · ไม่ขึ้น 'บันทึกแล้ว'", async () => {
    h.makeSaveImage.mockResolvedValue(okImage());
    const u = userEvent.setup();
    const { container } = render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    await screen.findByRole("dialog", { name: SHOWCASE_COPY.saveSheetTitle });
    const args = h.makeSaveImage.mock.calls[0][0];
    expect(args.input).toMatchObject({ designId: "bypass2", size: null });
    expect(typeof args.capture).toBe("function");
    expect(h.deliverImage).not.toHaveBeenCalled();
    expect(saveBtn()).toBeEnabled();
    expect(container.textContent).not.toMatch(/บันทึกแล้ว|✓.*รูป/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("S12: busy → ปุ่ม disabled + aria-busy + ข้อความ 'กำลังสร้างรูป…' · กดซ้ำไม่เรียก make ซ้ำ", async () => {
    let release!: (v: unknown) => void;
    h.makeSaveImage.mockReturnValue(new Promise((r) => (release = r)));
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    const busy = screen.getByRole("button", { name: SHOWCASE_COPY.saveBusy });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("status").some((s) => s.textContent === SHOWCASE_COPY.saveBusy)).toBe(true);
    await u.click(busy);
    expect(h.makeSaveImage).toHaveBeenCalledTimes(1);
    await act(async () => release(okImage()));
    await screen.findByRole("dialog");
    expect(h.deliverImage).not.toHaveBeenCalled();
  });

  it("Error: สร้างรูปไม่สำเร็จ → role=alert + ปุ่มกลับมากดซ้ำได้ · ไม่เปิด sheet · ไม่เรียก share", async () => {
    h.makeSaveImage.mockResolvedValueOnce({ ok: false });
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    expect(await screen.findByRole("alert")).toHaveTextContent(SHOWCASE_COPY.saveFailed);
    expect(saveBtn()).toBeEnabled();
    expect(h.deliverImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    h.makeSaveImage.mockResolvedValueOnce(okImage());
    h.deliverImage.mockResolvedValue("shared");
    await u.click(saveBtn()!);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("needSheet → dialog: หัว · รูป alt=รายละเอียด · คำแนะนำกดค้าง (ไม่อ้างชื่อเมนู OS) · Esc ปิด · คืนโฟกัสไปปุ่ม · revoke objectURL (S13)", async () => {
    h.makeSaveImage.mockResolvedValue(okImage());
    h.deliverImage.mockResolvedValue("needSheet");
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    const dlg = await screen.findByRole("dialog", { name: SHOWCASE_COPY.saveSheetTitle });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    const img = within(dlg).getByRole("img");
    expect(img).toHaveAttribute("src", URLS.created[0]);
    expect(img.getAttribute("alt")).toContain("ราคา");
    expect(within(dlg).getByText(SHOWCASE_COPY.saveSheetHint)).toBeInTheDocument();
    expect(SHOWCASE_COPY.saveSheetHint).not.toMatch(/Photos|แกลเลอรี|อัลบั้ม|Safari|Chrome/);
    const close = within(dlg).getByRole("button", { name: SHOWCASE_COPY.saveSheetClose });
    expect(close.className).toContain("min-h-11");
    expect(close).toHaveFocus();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(URLS.revoked).toEqual([URLS.created[0]]);
    expect(saveBtn()).toHaveFocus();
  });

  it("sheet: focus trap (Tab วนในปุ่มของ sheet) · ปุ่มบันทึกรูปใน sheet แสดงเมื่อแชร์ไฟล์ได้ → เรียก share ด้วยไฟล์เดิมใน click", async () => {
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: vi.fn(), configurable: true });
    const made = okImage();
    h.makeSaveImage.mockResolvedValue(made);
    h.deliverImage.mockResolvedValueOnce("needSheet").mockResolvedValue("shared");
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    const dlg = await screen.findByRole("dialog");
    const inSheet = within(dlg).getByRole("button", { name: SHOWCASE_COPY.saveButton });
    await u.tab(); // close → saveButton
    expect(inSheet).toHaveFocus();
    await u.tab(); // วนกลับ close ไม่หลุดออกนอก sheet
    expect(within(dlg).getByRole("button", { name: SHOWCASE_COPY.saveSheetClose })).toHaveFocus();
    await u.click(inSheet);
    expect(h.deliverImage).toHaveBeenLastCalledWith(made.file);
    expect(within(dlg).queryByText(/บันทึกแล้ว/)).toBeNull();
    delete (navigator as unknown as Record<string, unknown>).canShare;
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it("sheet: เครื่องแชร์ไฟล์ไม่ได้ → ไม่มีปุ่มบันทึกรูปที่กดแล้วไม่เกิดอะไร (เหลือแค่ปิด + กดค้าง)", async () => {
    h.makeSaveImage.mockResolvedValue(okImage());
    h.deliverImage.mockResolvedValue("needSheet");
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByRole("button", { name: SHOWCASE_COPY.saveButton })).toBeNull();
  });

  it("S13: unmount ขณะ sheet เปิด → revoke · unmount ระหว่างสร้าง → ไม่เปิด sheet ไม่ error", async () => {
    h.makeSaveImage.mockResolvedValue(okImage());
    h.deliverImage.mockResolvedValue("needSheet");
    const u = userEvent.setup();
    const a = render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    await screen.findByRole("dialog");
    a.unmount();
    expect(URLS.revoked).toContain(URLS.created[0]);

    let release!: (v: unknown) => void;
    h.makeSaveImage.mockReturnValue(new Promise((r) => (release = r)));
    const b = render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(saveBtn()!);
    b.unmount();
    const createdBefore = URLS.created.length;
    await act(async () => release(okImage()));
    expect(URLS.created.length).toBe(createdBefore);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("N1–N3: ปุ่ม LINE / คัดลอก / ลิงก์เดิมไม่เปลี่ยน", () => {
  it("N1: href ปุ่ม LINE byte เดิมทุกแบบ (เทียบ buildShowcaseLineHref) · target/rel เดิม · ไม่ disabled · ไม่เรียก capture", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    for (const d of DESIGNS) {
      await u.click(screen.getByRole("radio", { name: `${d.name} ${formatPriceThb(d.id)}` }));
      const a = screen.getByRole("link", { name: new RegExp(SHOWCASE_COPY.lineButton) });
      expect(a.getAttribute("href")).toBe(buildShowcaseLineHref({ designId: d.id, choice: { kind: "direct" }, size: null }));
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
      expect(a).not.toHaveAttribute("aria-disabled");
    }
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.makeSaveImage).not.toHaveBeenCalled();
  });

  it("N1: เวที unsupported → ปุ่ม LINE ยังเป็นลิงก์ปกติ", async () => {
    h.state.webgl = false;
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    expect(screen.getByRole("link", { name: new RegExp(SHOWCASE_COPY.lineButton) }).getAttribute("href")).toMatch(/^https:\/\//);
  });

  it("N2: คัดลอกข้อความยังทำงาน (clipboard) แม้ปุ่มบันทึกรูปอยู่ข้างๆ", async () => {
    const u = userEvent.setup(); // user-event ติดตั้ง clipboard ปลอมของตัวเอง — spy หลัง setup
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await readyStage();
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.copyButton }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: SHOWCASE_COPY.copiedButton })).toBeInTheDocument();
  });

  it("N3: กดบันทึกรูปไม่เปลี่ยน URL/การเลือก", async () => {
    h.makeSaveImage.mockResolvedValue(okImage());
    h.deliverImage.mockResolvedValue("shared");
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...OWN_DESIGN, ring: "channel4" }} />);
    await readyStage();
    const before = window.location.search;
    await u.click(saveBtn()!);
    await screen.findByRole("dialog");
    expect(window.location.search).toBe(before);
  });
});

describe("S2–S4 / N5: เส้นแบ่ง client-only (ไม่มี network/storage/track ในโค้ดของฟีเจอร์นี้)", () => {
  const root = join(process.cwd());
  const files = [
    ...readdirSync(join(root, "lib/ring-builder/save-image")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(root, "lib/ring-builder/save-image", f)),
    join(root, "app/(quiz)/ring-builder/_components/SaveImageButton.tsx"),
    join(root, "app/(quiz)/ring-builder/_components/SavePreviewSheet.tsx"),
    join(root, "lib/ring-builder/viewer/capture-pixels.ts"),
  ];
  it("ไม่มี fetch/XMLHttpRequest/sendBeacon/localStorage/sessionStorage/cookie/indexedDB/trackCta/<a download>", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const code = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      expect(code, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|trackCta|download=|\.download\b/);
    }
  });
  it("RingViewer ยังไม่ fetch (N5)", () => {
    const src = readFileSync(join(root, "app/(quiz)/ring-builder/_components/RingViewer.tsx"), "utf8");
    expect(src.replace(/\/\/.*$/gm, "")).not.toMatch(/\bfetch\s*\(/);
  });
  it("คำว่า 'เพชร' และ URL ไม่อยู่ใน copy ใหม่ (X7/Q3)", () => {
    const newKeys = ["saveButton", "saveBusy", "saveWaitStage", "saveFailed", "saveSheetTitle", "saveSheetHint", "saveSheetClose", "saveWordmark", "saveImageNote", "editButton", "retakeQuiz"] as const;
    for (const k of newKeys) {
      const v = String(SHOWCASE_COPY[k]);
      expect(v).not.toMatch(/เพชร|https?:|\.com|line\.me|@/);
    }
  });
});

describe("OrderSummary: ปุ่ม แก้ (P1d) + ไม่มี prop = เดิม", () => {
  const input = { designId: "bypass2", choice: { kind: "own", top: GEM_QUIZ_STONES[0].code, bottom: "cz" }, size: null } as const;

  it("ไม่มี onEdit/saveImage → ไม่มีปุ่ม แก้ · ไม่มีปุ่มบันทึกรูป (เทสต์เดิมไม่ต้องแก้ · N8)", () => {
    render(<OrderSummary designId="bypass2" choice={input.choice as never} size={null} />);
    expect(screen.queryByRole("button", { name: /^แก้|เลือกไซซ์/ })).toBeNull();
    expect(saveBtn()).toBeNull();
    expect(screen.queryByText(SHOWCASE_COPY.saveWaitStage)).toBeNull();
  });

  it("onEdit: ปุ่มเฉพาะ 3 แถว (แบบ/พลอย/ไซซ์) · ไม่มีในแถวย่อยและราคา · ไซซ์ยังไม่เลือก = 'เลือก' (aria เลือกไซซ์) · ≥44px", async () => {
    const onEdit = vi.fn();
    const u = userEvent.setup();
    render(<OrderSummary designId="bypass2" choice={input.choice as never} size={null} onEdit={onEdit} />);
    const dl = document.querySelector("dl")!;
    const btns = within(dl).getAllByRole("button");
    expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual([SHOWCASE_COPY.editAriaDesign, SHOWCASE_COPY.editAriaGems, SHOWCASE_COPY.editAriaSizeSelect]);
    expect(btns.map((b) => b.textContent)).toEqual(["แก้", "แก้", "เลือก"]);
    for (const b of btns) expect(b.className).toContain("min-h-11");
    await u.click(btns[0]);
    await u.click(btns[1]);
    await u.click(btns[2]);
    expect(onEdit.mock.calls.map((c) => c[0])).toEqual(["design", "gems", "size"]);
    // ค่าของแถวยังเหมือนเดิม (ราคาไม่มีปุ่ม)
    const rows = buildShowcaseDetailRows({ designId: "bypass2", choice: input.choice as never, size: null })!;
    expect(dl.textContent).toContain(rows[rows.length - 1].value);
  });

  it("เลือกไซซ์แล้ว = 'แก้ไซซ์'", () => {
    render(<OrderSummary designId="bypass2" choice={{ kind: "direct" }} size={56} onEdit={vi.fn()} />);
    expect(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaSize })).toHaveTextContent("แก้");
  });

  it("S6: แถวสรุปบนจอ = แถวของ helper (label/value ตรงกัน) ทุกแบบ ทั้งมีและไม่มี onEdit", () => {
    for (const d of DESIGNS) {
      for (const onEdit of [undefined, vi.fn()]) {
        const { container, unmount } = render(<OrderSummary designId={d.id} choice={{ kind: "direct" }} size={d.sizes[0]} onEdit={onEdit} />);
        const dom = Array.from(container.querySelectorAll("dl > div")).map((row) => [row.querySelector("dt")!.textContent, (row.querySelector("dd > span:first-child") ?? row.querySelector("dd"))!.textContent]);
        const helper = buildShowcaseDetailRows({ designId: d.id, choice: { kind: "direct" }, size: d.sizes[0] })!.map((r) => [r.label, r.value]);
        expect(dom).toEqual(helper);
        unmount();
      }
    }
  });

  it("saveImage ไซซ์ผิด (href null) = ซ่อนปุ่มบันทึกรูปเหมือนปุ่ม LINE", () => {
    render(<OrderSummary designId="bypass2" choice={{ kind: "direct" }} size={999} saveImage={{ ready: true, capture: vi.fn() }} />);
    expect(saveBtn()).toBeNull();
  });
});

describe("P1d ในหน้า: กด แก้ → เลื่อน + โฟกัสหัวข้อ + ประกาศ · ไม่รีเซ็ตค่า (N7)", () => {
  it("แก้แบบแหวน/ไซซ์ → โฟกัส h2 ของหัวข้อ · scrollIntoView · ประกาศ 'ไปที่ …' · เลือกไซซ์ไว้ก่อนแล้วยังอยู่", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await u.click(screen.getByRole("radio", { name: "เบอร์ 56" }));
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaDesign }));
    const designH = screen.getByRole("heading", { name: SHOWCASE_COPY.designHeading });
    expect(designH).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getAllByRole("status").some((s) => s.textContent === SHOWCASE_COPY.jumpAnnounce(SHOWCASE_COPY.designHeading))).toBe(true);
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaSize }));
    expect(screen.getByRole("heading", { name: new RegExp(SHOWCASE_COPY.sizeHeading) })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "เบอร์ 56" })).toBeChecked();
  });

  it("แก้ชุดพลอย โหมดแนะนำ → หัว 'อยากเสริมเรื่องไหน' แม้เลือกเรื่องแล้ว (กริดยุบ) · ค่าเรื่องไม่เปลี่ยน", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, intention: "calm" }} />);
    const before = window.location.search;
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaGems }));
    expect(screen.getByRole("heading", { name: SHOWCASE_COPY.intentionHeading })).toHaveFocus();
    expect(window.location.search).toBe(before);
  });

  it("แก้ชุดพลอย โหมดเลือกเอง → หัว 'พลอยที่คุณเลือกได้' (sr-only) · พลอยที่เลือกไว้ไม่ถูกล้าง", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await u.click(screen.getByRole("radio", { name: SHOWCASE_COPY.modeOwn }));
    await u.click(within(screen.getByRole("radiogroup", { name: /พลอยหลัก/ })).getByRole("radio", { name: GEM_QUIZ_STONES[0].labelTh }));
    const before = window.location.search;
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaGems }));
    const hd = screen.getByRole("heading", { name: SHOWCASE_COPY.pickerHeading });
    expect(hd).toHaveFocus();
    expect(hd.className).toContain("sr-only");
    expect(window.location.search).toBe(before);
    expect(within(screen.getByRole("radiogroup", { name: /พลอยหลัก/ })).getByRole("radio", { name: GEM_QUIZ_STONES[0].labelTh })).toBeChecked();
  });

  it("แบบเม็ดเดี่ยวใช้ได้ (ไม่มีหัวพลอยรายเม็ด ไม่ error)", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...OWN_DESIGN, ring: "solitaire" }} />);
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaGems }));
    expect(screen.getByRole("heading", { name: SHOWCASE_COPY.intentionHeading })).toHaveFocus();
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaDesign }));
    expect(screen.getByRole("heading", { name: SHOWCASE_COPY.designHeading })).toHaveFocus();
  });

  it("หาหัวข้อไม่เจอ = ไม่ทำอะไร ไม่ throw", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    document.querySelector('[data-jump="size"]')!.remove();
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaSizeSelect }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reduced-motion → scroll behavior auto (ไม่ smooth)", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const u = userEvent.setup();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    await u.click(screen.getByRole("button", { name: SHOWCASE_COPY.editAriaDesign }));
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ behavior: "auto" });
    vi.unstubAllGlobals();
  });

  it("ลิงก์ 'ทำแบบทดสอบใหม่' → /gem-quiz เฉพาะโหมดแนะนำที่มีชุดแล้ว · ยังไม่มีเรื่อง/โหมดเลือกเอง ไม่มี", async () => {
    const u = userEvent.setup();
    const a = render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, intention: "calm" }} />);
    const link = screen.getByRole("link", { name: SHOWCASE_COPY.retakeQuiz });
    expect(link).toHaveAttribute("href", "/gem-quiz");
    expect(link.className).toContain("min-h-11");
    await u.click(screen.getByRole("radio", { name: SHOWCASE_COPY.modeOwn }));
    expect(screen.queryByRole("link", { name: SHOWCASE_COPY.retakeQuiz })).toBeNull();
    a.unmount();
    render(<RingShowcaseClient params={OWN_DESIGN} />);
    expect(screen.queryByRole("link", { name: SHOWCASE_COPY.retakeQuiz })).toBeNull();
  });
});
