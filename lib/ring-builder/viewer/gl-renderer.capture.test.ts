// @vitest-environment jsdom
// 25 พ.ย. 69 — renderer.captureFront(): จับมุมหน้า w×h ใน task เดียว · มุม/ขนาด canvas กลับค่าเดิมทุกกรณี (S9 · N4) · ล้ม/ว่าง/lost = null
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingRenderer } from "./gl-renderer";
import { buildCamera } from "./matrix";
import { clearShowcaseRingCache, getShowcaseRing } from "./showcase-rings";

function fakeGl() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
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
    deleteShader: vi.fn(),
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
    readPixels: vi.fn((_x: number, _y: number, w: number, h: number, _f: number, _t: number, px: Uint8Array) => {
      px.fill(7, 0, w * h * 4);
    }),
    isContextLost: vi.fn(() => false),
    drawingBufferWidth: undefined as number | undefined,
    drawingBufferHeight: undefined as number | undefined,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    FLOAT: 8,
    TRIANGLES: 9,
    UNSIGNED_SHORT: 10,
    UNSIGNED_BYTE: 15,
    RGBA: 16,
    DEPTH_TEST: 11,
    CULL_FACE: 12,
    COLOR_BUFFER_BIT: 13,
    DEPTH_BUFFER_BIT: 14,
  };
  return gl;
}

describe("RingRenderer.captureFront", () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    clearShowcaseRingCache();
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

  function setup() {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const gl = fakeGl();
    vi.spyOn(canvas, "getContext").mockReturnValue(gl as never);
    const onUnsupported = vi.fn();
    const ring = getShowcaseRing("bypass2");
    const r = createRingRenderer(canvas, ring, { autoRotate: false, reducedMotion: true, onUnsupported });
    const flush = () => {
      const q = rafQueue;
      rafQueue = [];
      q.forEach((cb) => cb(0));
    };
    flush();
    return { canvas, gl, r, flush, ring, onUnsupported };
  }
  const drag = (canvas: HTMLCanvasElement, dx: number, dy: number) => {
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 + dx, clientY: 100 + dy }));
    canvas.dispatchEvent(new MouseEvent("pointerup"));
  };
  // การวาดหนึ่งเฟรมเรียก uniformMatrix4fv ต่อ program 2 ครั้ง (uMVP แล้ว uModel) × (โลหะ + เม็ด) → uMVP ของ program สุดท้าย = ตัวรองสุดท้าย
  const lastMvp = (gl: ReturnType<typeof fakeGl>) => Array.from(gl.uniformMatrix4fv.mock.calls[gl.uniformMatrix4fv.mock.calls.length - 2][1 + 1] as Float32Array);
  const mvpOf = (ring: ReturnType<typeof getShowcaseRing>, yaw: number, pitch: number, zoom: number, w: number, h: number) => Array.from(buildCamera(ring.frame, yaw, pitch, zoom, w, h).mvp);

  it("คืน RGBA ขนาด w×h×4 · วาดด้วย viewport w×h และกล้องมุมหน้า (yaw 0 · pitch 0 · zoom 1) แล้ว readPixels ทันทีหลังวาด", () => {
    const { gl, r, ring, canvas } = setup();
    drag(canvas, 80, 30); // ผู้ใช้หมุนไว้ก่อน
    const out = r.captureFront(1080, 810);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out?.length).toBe(1080 * 810 * 4);
    expect(gl.readPixels).toHaveBeenCalledTimes(1);
    expect(gl.readPixels.mock.calls[0].slice(0, 6)).toEqual([0, 0, 1080, 810, 16, 15]);
    // ลำดับ: drawElements ของรอบจับ (มี viewport 1080×810) มาก่อน readPixels
    const viewportCalls = gl.viewport.mock.calls.map((c) => c.join("x"));
    expect(viewportCalls).toContain("0x0x1080x810");
    const captureMvpIdx = gl.uniformMatrix4fv.mock.calls.findIndex((c) => JSON.stringify(Array.from(c[2] as Float32Array)) === JSON.stringify(mvpOf(ring, 0, 0, 1, 1080, 810)));
    expect(captureMvpIdx).toBeGreaterThanOrEqual(0);
  });

  it("S9: หลังจับ — ขนาด canvas เดิม · วาดคืนด้วยมุมที่ผู้ใช้หมุนไว้ (ไม่ใช่มุมหน้า) · ขนาด buffer เดิม", () => {
    const { gl, r, ring, canvas } = setup();
    drag(canvas, 80, 30);
    const before = { w: canvas.width, h: canvas.height };
    const yaw = 80 * 0.01;
    const pitch = 30 * 0.01;
    r.captureFront(1080, 810);
    expect(canvas.width).toBe(before.w);
    expect(canvas.height).toBe(before.h);
    // การวาดครั้งสุดท้ายของ captureFront = มุมที่ผู้ใช้หมุนไว้ ขนาดเดิม
    expect(lastMvp(gl)).toEqual(mvpOf(ring, yaw, pitch, 1, before.w, before.h));
    expect(gl.viewport.mock.calls[gl.viewport.mock.calls.length - 1]).toEqual([0, 0, before.w, before.h]);
  });

  it("S9: readPixels throw → null · มุม/ขนาดกลับค่าเดิม · ไม่ throw ออกนอก", () => {
    const { gl, r, ring, canvas } = setup();
    drag(canvas, 40, -20);
    const before = { w: canvas.width, h: canvas.height };
    gl.readPixels.mockImplementation(() => {
      throw new Error("boom");
    });
    let out: Uint8Array | null | undefined;
    expect(() => {
      out = r.captureFront(1080, 810);
    }).not.toThrow();
    expect(out).toBeNull();
    expect(canvas.width).toBe(before.w);
    expect(canvas.height).toBe(before.h);
    expect(lastMvp(gl)).toEqual(mvpOf(ring, 40 * 0.01, -20 * 0.01, 1, before.w, before.h));
  });

  it("S9: draw ของรอบจับ throw (gl พังกลางทาง) → null · ขนาดกลับค่าเดิม", () => {
    const { gl, r, canvas } = setup();
    const before = { w: canvas.width, h: canvas.height };
    gl.drawElements.mockImplementationOnce(() => {
      throw new Error("draw boom");
    });
    expect(r.captureFront(640, 480)).toBeNull();
    expect(canvas.width).toBe(before.w);
    expect(canvas.height).toBe(before.h);
  });

  it("S10: context lost ระหว่างจับ (isContextLost จริงหลังวาด) → null ไม่ readPixels", () => {
    const { gl, r } = setup();
    gl.isContextLost.mockReturnValue(true);
    expect(r.captureFront(1080, 810)).toBeNull();
    expect(gl.readPixels).not.toHaveBeenCalled();
  });

  it("framebuffer ได้ขนาดไม่ตรงที่ขอ (drawingBuffer เล็กกว่า) → null ไม่ส่งภาพผิดขนาด", () => {
    const { gl, r } = setup();
    gl.drawingBufferWidth = 540;
    gl.drawingBufferHeight = 405;
    expect(r.captureFront(1080, 810)).toBeNull();
    expect(gl.readPixels).not.toHaveBeenCalled();
  });

  it("context lost (event) / dispose / ขนาดไม่สมเหตุผล = null โดยไม่แตะ GL", () => {
    const a = setup();
    a.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(a.r.captureFront(1080, 810)).toBeNull();
    expect(a.gl.readPixels).not.toHaveBeenCalled();

    const b = setup();
    b.r.dispose();
    expect(b.r.captureFront(1080, 810)).toBeNull();

    const c = setup();
    for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [1.5, 5], [5000, 100], [100, 5000], [Number.NaN, 5]] as const) {
      expect(c.r.captureFront(w, h)).toBeNull();
    }
    expect(c.gl.readPixels).not.toHaveBeenCalled();
  });

  it("ค่าเริ่มต้นของ design แนบ LINE (1200×630) · จับได้หลายครั้งติดกัน ไม่สะสมสถานะ", () => {
    const { gl, r, canvas } = setup();
    const before = { w: canvas.width, h: canvas.height };
    expect(r.captureFront()?.length).toBe(1200 * 630 * 4);
    expect(r.captureFront(100, 50)?.length).toBe(100 * 50 * 4);
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(before.w);
  });

  it("N4: หลังจับ ยังมีเฟรมถัดไปให้วาด (rAF-on-dirty ยังทำงาน) และไม่ค้างลูป", () => {
    const { r, flush } = setup();
    r.captureFront(1080, 810);
    expect(rafQueue.length).toBeGreaterThan(0);
    flush();
    expect(rafQueue.length).toBe(0);
  });
});
