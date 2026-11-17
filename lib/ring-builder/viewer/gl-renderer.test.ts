// @vitest-environment jsdom
// shader V2 (source สมเหตุสมผล · V1 คงเดิม) + gl-renderer ด้วย GL ปลอม: fallback V1 · rAF เฉพาะ dirty (D2-1) · context lost · dispose
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBypassRing } from "./bypass-ring";
import { createRingRenderer } from "./gl-renderer";
import { FS_GEM_V1, FS_GEM_V2, FS_METAL_V1, FS_METAL_V2, SILVER_LOOK, buildFsGemV2, buildFsMetalV2, glf } from "./shaders";

describe("shaders", () => {
  it("V2: ไม่มี NaN/undefined · ทุกเลขเป็น float literal · ไม่มี texture/loop/extension", () => {
    for (const src of [FS_METAL_V2, FS_GEM_V2]) {
      expect(src).not.toMatch(/NaN|undefined|Infinity/);
      expect(src).not.toMatch(/sampler|texture2D|for\s*\(|while\s*\(|#extension/);
      expect(src).toContain("tonemap");
      expect(src).toContain("0.45454545"); // gamma 1/2.2
    }
    expect((FS_METAL_V2.match(/env\(R\)/g) ?? []).length).toBe(1); // env 1 ครั้ง/fragment โลหะ
    expect(FS_GEM_V2).toContain("uCz");
  });
  it("glf: จำนวนเต็มได้จุดทศนิยม · ค่าไม่จำกัด throw", () => {
    expect(glf(2)).toBe("2.0");
    expect(glf(0.55)).toBe("0.55");
    expect(() => glf(NaN)).toThrow();
    expect(() => buildFsMetalV2({ ...SILVER_LOOK, exposure: Infinity })).toThrow();
    expect(() => buildFsGemV2({ ...SILVER_LOOK, envFloor: NaN })).toThrow();
  });
  it("ค่าแสงอยู่ในช่วงที่สมเหตุสมผล และเงินเป็นกลาง (|R−B| ของ F0 ≤ 0.06)", () => {
    expect(Math.abs(SILVER_LOOK.silverF0[0] - SILVER_LOOK.silverF0[2])).toBeLessThanOrEqual(0.06);
    expect(SILVER_LOOK.horizonDepth).toBeGreaterThan(0.3); // ต้องมีเส้นมืด ไม่งั้นพลาสติกขาว
  });
  it("V1 (fallback ของ D1) ยังเป็น shader เดิม", () => {
    expect(FS_METAL_V1).toContain("uColor*(0.10+0.90*env(R))");
    expect(FS_GEM_V1).toContain("gl_FragColor=vec4(min(col,uCap),1.0)");
  });
});

// ---- GL ปลอม ----
function fakeGl(failFs: (src: string) => boolean) {
  const sources = new Map<object, string>();
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn((s: object, src: string) => void sources.set(s, src)),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn((s: object) => !failFs(sources.get(s) ?? "")),
    getShaderInfoLog: vi.fn(() => "boom"),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    getUniformLocation: vi.fn(() => ({})),
    enable: vi.fn(),
    disable: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawElements: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    useProgram: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    uniform3f: vi.fn(),
    uniform1f: vi.fn(),
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    FLOAT: 8,
    TRIANGLES: 9,
    UNSIGNED_SHORT: 10,
    DEPTH_TEST: 11,
    CULL_FACE: 12,
    COLOR_BUFFER_BIT: 13,
    DEPTH_BUFFER_BIT: 14,
  };
  return { gl, sources };
}

describe("createRingRenderer (GL ปลอม)", () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup(failFs: (src: string) => boolean = () => false) {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const { gl, sources } = fakeGl(failFs);
    vi.spyOn(canvas, "getContext").mockReturnValue(gl as never);
    const onReady = vi.fn();
    const onUnsupported = vi.fn();
    const r = createRingRenderer(canvas, buildBypassRing(), { autoRotate: false, reducedMotion: false, onReady, onUnsupported });
    const flush = () => {
      const q = rafQueue;
      rafQueue = [];
      q.forEach((cb) => cb(0));
    };
    return { canvas, gl, sources, r, flush, onReady, onUnsupported };
  }

  it("D2-1: วาด 1 เฟรมแล้วหยุด — ไม่มี rAF วนเมื่อไม่มีอะไรเปลี่ยน", () => {
    const { gl, flush } = setup();
    expect(rafQueue.length).toBe(1);
    flush();
    expect(gl.drawElements).toHaveBeenCalledTimes(5); // เรือน + 4 พลอย
    expect(rafQueue.length).toBe(0);
  });
  it("setTints → ขอเฟรมเดียว (ไม่ซ้อน) แล้ววาดใหม่", () => {
    const { gl, r, flush } = setup();
    flush();
    gl.drawElements.mockClear();
    r.setTints([]);
    r.setTints([]);
    expect(rafQueue.length).toBe(1);
    flush();
    expect(gl.drawElements).toHaveBeenCalledTimes(5);
    expect(rafQueue.length).toBe(0);
  });
  it("resetView (มี easing) วนจนถึงมุมหน้าแล้วหยุดเอง", () => {
    const { r, flush } = setup();
    flush();
    r.resetView();
    let frames = 0;
    while (rafQueue.length && frames < 400) {
      flush();
      frames++;
    }
    expect(rafQueue.length).toBe(0);
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(400);
  });
  it("shader V2 compile ไม่ผ่าน → ถอยใช้ V1 (ไม่ throw) · V1 ก็ไม่ผ่าน → throw (UI ตกรูปจริง)", () => {
    const a = setup((src) => src === FS_METAL_V2 || src === FS_GEM_V2);
    const used = [...a.sources.values()];
    expect(used).toContain(FS_METAL_V1);
    expect(used).toContain(FS_GEM_V1);
    expect(() => setup(() => true)).toThrow();
  });
  it("context lost → หยุดวาด + แจ้ง · restored → วาดต่อ + onReady", () => {
    const { canvas, gl, flush, onUnsupported, onReady } = setup();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onUnsupported).toHaveBeenCalledWith("context_lost");
    gl.drawElements.mockClear();
    flush();
    expect(gl.drawElements).not.toHaveBeenCalled();
    onReady.mockClear();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(onReady).toHaveBeenCalled();
    flush();
    expect(gl.drawElements).toHaveBeenCalledTimes(5);
  });
  it("dispose → ไม่วาดอีก ไม่ขอเฟรมใหม่ · เรียกซ้ำได้", () => {
    const { gl, r, flush } = setup();
    r.dispose();
    r.dispose();
    gl.drawElements.mockClear();
    flush();
    r.setTints([]);
    expect(gl.drawElements).not.toHaveBeenCalled();
    expect(rafQueue.length).toBe(0);
  });
});
