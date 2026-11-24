// @vitest-environment jsdom
// drag hint (เจ้าของสั่ง 24 พ.ย.) — จุดขาวแนะนำให้ลากหมุน: แสดงเมื่อ 3D พร้อมเท่านั้น · หายเมื่อแตะ/เล่นจบ · ไม่โผล่ซ้ำตอนเปลี่ยนแบบ · reduced-motion ไม่แสดง · ไม่ใช้ storage
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EMPTY_SHOWCASE_PARAMS } from "@/lib/ring-builder/showcase/quiz-link";
import { RingShowcaseClient } from "./RingShowcaseClient";

const h = vi.hoisted(() => {
  const state = { webgl: true, autoReady: true, failIds: new Set<string>(), opts: null as null | { onReady?: () => void; onUnsupported?: (r: string) => void } };
  const renderer = { setTints: vi.fn(), setRing: vi.fn(), resetView: vi.fn(), dispose: vi.fn() };
  const createRingRenderer = vi.fn((_c: unknown, _r: unknown, opts: { onReady?: () => void; onUnsupported?: (r: string) => void }) => {
    state.opts = opts;
    if (state.autoReady) opts.onReady?.();
    return renderer;
  });
  return { state, renderer, createRingRenderer };
});
vi.mock("@/lib/ring-builder/viewer/gl-renderer", () => ({
  isWebGLAvailable: () => h.state.webgl,
  createRingRenderer: h.createRingRenderer,
}));
vi.mock("@/lib/ring-builder/viewer/showcase-rings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-builder/viewer/showcase-rings")>();
  return {
    ...orig,
    getShowcaseRing: (id: string) => {
      if (h.state.failIds.has(id)) throw new Error(`boom ${id}`);
      return orig.getShowcaseRing(id as never);
    },
  };
});

const hint = () => screen.queryByTestId("drag-hint");

function stageEl(): HTMLElement {
  const el = document.querySelector("section[aria-label]");
  if (!el) throw new Error("ไม่พบ stage");
  return el as HTMLElement;
}

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
}

beforeEach(() => {
  h.state.webgl = true;
  h.state.autoReady = true;
  h.state.failIds.clear();
  h.state.opts = null;
  h.createRingRenderer.mockClear();
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
  mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("drag hint บน stage 3D", () => {
  it("แสดงหลัง 3D โหลดเสร็จ · aria-hidden · ไม่รับ pointer · ป้าย 'ลากเพื่อหมุน' เดิมยังอยู่", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    expect(hint()).toHaveAttribute("aria-hidden", "true");
    expect(hint()).toHaveClass("pointer-events-none");
    expect(screen.getByText("ลากเพื่อหมุน")).toBeInTheDocument();
  });

  it("ไม่แสดงตอนยังโหลด (viewer ยังไม่ onReady)", async () => {
    h.state.autoReady = false;
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalled());
    expect(hint()).toBeNull();
    // พอ ready แล้วค่อยขึ้น
    act(() => h.state.opts?.onReady?.());
    expect(hint()).toBeInTheDocument();
  });

  it("ไม่แสดงเมื่อเครื่องไม่รองรับ 3D (fallback รูป)", async () => {
    h.state.webgl = false;
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(hint()).toBeNull();
  });

  it("ไม่แสดง/หายเมื่อ context lost", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    act(() => h.state.opts?.onUnsupported?.("context_lost"));
    expect(hint()).toBeNull();
  });

  it("ไม่แสดงเมื่อโมเดลของแบบนี้สร้างไม่ได้ (designFailed)", async () => {
    h.state.failIds.add("bypass2");
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /ลองอีกครั้ง/ })).toBeInTheDocument());
    expect(hint()).toBeNull();
  });

  it("หายทันทีเมื่อ pointerdown บน stage · ไม่กลับมาอีกแม้เปลี่ยนแบบ", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    fireEvent.pointerDown(stageEl());
    expect(hint()).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /TRINITY/ }));
    expect(hint()).toBeNull();
  });

  it("หายเมื่อ touchstart บน stage", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    fireEvent.touchStart(stageEl());
    expect(hint()).toBeNull();
  });

  it("หายเองหลังเล่นครบ ~3 รอบ (timer 6 วิ) และไม่โผล่ซ้ำตอนเปลี่ยนแบบ", async () => {
    const spy = vi.spyOn(window, "setTimeout");
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    const call = spy.mock.calls.find((c) => c[1] === 6000);
    expect(call).toBeDefined();
    act(() => (call![0] as () => void)());
    expect(hint()).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /เม็ดเดี่ยว/ }));
    expect(hint()).toBeNull();
  });

  it("เปลี่ยนแบบระหว่างเล่น: จุดยังเล่นต่อ ไม่รีเซ็ต (แสดงครั้งเดียวต่อการโหลดหน้า)", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    const el = hint();
    fireEvent.click(screen.getByRole("radio", { name: /TRINITY/ }));
    expect(hint()).toBe(el);
  });

  it("prefers-reduced-motion: reduce = ไม่แสดงจุดเลย (ป้ายเดิมยังอยู่)", async () => {
    mockReducedMotion(true);
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(screen.getByText("ลากเพื่อหมุน")).toBeInTheDocument());
    expect(hint()).toBeNull();
  });

  it("ไม่ใช้ storage", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await waitFor(() => expect(hint()).toBeInTheDocument());
    fireEvent.pointerDown(stageEl());
    expect(set).not.toHaveBeenCalled();
  });
});
