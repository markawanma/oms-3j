// @vitest-environment jsdom
// QA (R2-D2) D1.1: gl-renderer — dispose ถอด listener/ResizeObserver จริง · link fail ก็ถอย V1 · rAF หยุดเมื่อไม่ dirty · event หลัง dispose ไม่ปลุกอะไร
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBypassRing } from "./bypass-ring";
import { createRingRenderer } from "./gl-renderer";
import { FS_GEM_V1, FS_GEM_V2, FS_METAL_V1, FS_METAL_V2 } from "./shaders";

function fakeGl(opts: { failCompile?: (src: string) => boolean; failLink?: (fsSrcs: string[]) => boolean }) {
  const sources = new Map<object, string>();
  const progFs = new Map<object, string[]>();
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn((s: object, src: string) => void sources.set(s, src)),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn((s: object) => !(opts.failCompile?.(sources.get(s) ?? "") ?? false)),
    getShaderInfoLog: vi.fn(() => "boom"),
    createProgram: vi.fn(() => { const p = {}; progFs.set(p, []); return p; }),
    attachShader: vi.fn((p: object, s: object) => void progFs.get(p)?.push(sources.get(s) ?? "")),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((p: object) => !(opts.failLink?.(progFs.get(p) ?? []) ?? false)),
    getProgramInfoLog: vi.fn(() => "link boom"),
    getUniformLocation: vi.fn(() => ({})),
    enable: vi.fn(), disable: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), drawElements: vi.fn(),
    viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), useProgram: vi.fn(),
    uniformMatrix4fv: vi.fn(), uniform3f: vi.fn(), uniform1f: vi.fn(),
    ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8, TRIANGLES: 9, UNSIGNED_SHORT: 10,
    DEPTH_TEST: 11, CULL_FACE: 12, COLOR_BUFFER_BIT: 13, DEPTH_BUFFER_BIT: 14,
  };
  return { gl, sources, progFs };
}

describe("createRingRenderer — QA D1.1", () => {
  let rafQueue: FrameRequestCallback[];
  let roDisconnect: ReturnType<typeof vi.fn>;
  let roObserve: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    rafQueue = [];
    roDisconnect = vi.fn();
    roObserve = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const d = roDisconnect;
    const o = roObserve;
    vi.stubGlobal("ResizeObserver", class { observe = o; disconnect = d; });
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup(glOpts: Parameters<typeof fakeGl>[0] = {}, rOpts: { autoRotate?: boolean } = {}) {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const g = fakeGl(glOpts);
    vi.spyOn(canvas, "getContext").mockReturnValue(g.gl as never);
    const add = vi.spyOn(canvas, "addEventListener");
    const remove = vi.spyOn(canvas, "removeEventListener");
    const r = createRingRenderer(canvas, buildBypassRing(), { autoRotate: rOpts.autoRotate ?? false, reducedMotion: false });
    const flush = () => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb(0)); };
    return { canvas, ...g, r, flush, add, remove };
  }

  it("dispose ถอดทุก listener ที่ canvas ด้วย handler ตัวเดียวกับที่ลง + ResizeObserver.disconnect", () => {
    const { r, add, remove } = setup();
    const added = add.mock.calls.map((c) => [c[0], c[1]] as const);
    expect(added.length).toBeGreaterThanOrEqual(8); // pointerdown/move/up/cancel · wheel · keydown · ctx lost/restored
    expect(roObserve).toHaveBeenCalledTimes(1);
    r.dispose();
    const removed = remove.mock.calls.map((c) => [c[0], c[1]] as const);
    for (const [type, fn] of added) expect(removed, `ไม่ถอด ${String(type)}`).toContainEqual([type, fn]);
    expect(roDisconnect).toHaveBeenCalledTimes(1);
  });
  it("dispose ซ้ำ ไม่ถอด/disconnect ซ้ำ · deleteProgram ไม่ซ้ำ", () => {
    const { r, gl } = setup();
    r.dispose();
    r.dispose();
    expect(roDisconnect).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2); // metal + gem อย่างละครั้ง
  });
  it("หลัง dispose: pointer/keyboard/wheel/context events ไม่ปลุก rAF ไม่วาด", () => {
    const { canvas, gl, r, flush } = setup();
    flush();
    r.dispose();
    gl.drawElements.mockClear();
    canvas.dispatchEvent(new Event("pointerdown"));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    canvas.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: 5 }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    r.setTints([]);
    r.resetView();
    flush();
    expect(rafQueue.length).toBe(0);
    expect(gl.drawElements).not.toHaveBeenCalled();
  });
  it("ไม่มี ResizeObserver → ใช้ window resize แล้วถอดตอน dispose", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const addW = vi.spyOn(window, "addEventListener");
    const rmW = vi.spyOn(window, "removeEventListener");
    const { r } = setup();
    const resizeAdd = addW.mock.calls.find((c) => c[0] === "resize");
    expect(resizeAdd).toBeTruthy();
    r.dispose();
    expect(rmW.mock.calls.some((c) => c[0] === "resize" && c[1] === resizeAdd![1])).toBe(true);
    addW.mockRestore();
    rmW.mockRestore();
  });
  it("shader V2 compile ผ่านแต่ LINK ไม่ผ่าน → ถอย V1 ไม่ throw", () => {
    const a = setup({ failLink: (fs) => fs.includes(FS_METAL_V2) || fs.includes(FS_GEM_V2) });
    const all = [...a.sources.values()];
    expect(all).toContain(FS_METAL_V1);
    expect(all).toContain(FS_GEM_V1);
  });
  it("context restored แล้ว V2 ใช้ไม่ได้ → ถอย V1 และวาดต่อได้ (ไม่ตกเป็น unsupported)", () => {
    let breakV2 = false;
    const onUnsupported = vi.fn();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const g = fakeGl({ failCompile: (src) => breakV2 && (src === FS_METAL_V2 || src === FS_GEM_V2) });
    vi.spyOn(canvas, "getContext").mockReturnValue(g.gl as never);
    createRingRenderer(canvas, buildBypassRing(), { autoRotate: false, reducedMotion: false, onUnsupported });
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    onUnsupported.mockClear();
    breakV2 = true;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onUnsupported).not.toHaveBeenCalled();
    const q = rafQueue; rafQueue = []; q.forEach((cb) => cb(0));
    expect(g.gl.drawElements).toHaveBeenCalled();
  });
  it("autoRotate: วนต่อเฉพาะตอนหมุน · แตะ/ลาก (pointerdown) แล้วหยุดวน · ไม่วนเมื่อไม่มีอะไรเปลี่ยน", () => {
    const { canvas, flush } = setup({}, { autoRotate: true });
    flush();
    expect(rafQueue.length).toBe(1); // ยังหมุนอยู่ → ขอเฟรมต่อ
    canvas.dispatchEvent(new Event("pointerdown"));
    canvas.dispatchEvent(new Event("pointerup"));
    flush();
    flush();
    expect(rafQueue.length).toBe(0);
  });
  it("ลาก/ซูม/คีย์บอร์ดหลายครั้งในเฟรมเดียว → ขอ rAF ได้เพียงเฟรมเดียว (ไม่ซ้อน)", () => {
    const { canvas, flush } = setup();
    flush();
    for (let i = 0; i < 20; i++) canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(rafQueue.length).toBe(1);
  });
  it("wheel ปกติ (ไม่กด Ctrl/⌘) ไม่ preventDefault → หน้าเลื่อนได้ · Ctrl+wheel ซูม", () => {
    const { canvas, flush } = setup();
    flush();
    const plain = new WheelEvent("wheel", { deltaY: 10, cancelable: true });
    canvas.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(rafQueue.length).toBe(0);
    const zoom = new WheelEvent("wheel", { deltaY: 10, ctrlKey: true, cancelable: true });
    canvas.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(rafQueue.length).toBe(1);
  });
});
