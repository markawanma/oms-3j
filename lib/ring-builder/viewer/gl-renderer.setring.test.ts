// @vitest-environment jsdom
// D1.2 — renderer.setRing(): สลับแบบบน context เดิม · คืน buffer เดิมครบ (3×(1+เม็ดเดิม)) · อัปโหลดใหม่ · tints ยาวตาม · พังกลางทาง = onUnsupported · lost/dispose
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingRenderer } from "./gl-renderer";
import { clearShowcaseRingCache, getShowcaseRing } from "./showcase-rings";

function fakeGl() {
  return {
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
}

describe("RingRenderer.setRing", () => {
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

  function setup(reducedMotion = false) {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 300 });
    Object.defineProperty(canvas, "clientHeight", { value: 200 });
    const gl = fakeGl();
    const getContext = vi.spyOn(canvas, "getContext").mockReturnValue(gl as never);
    const onReady = vi.fn();
    const onUnsupported = vi.fn();
    const r = createRingRenderer(canvas, getShowcaseRing("bypass2"), { autoRotate: false, reducedMotion, onReady, onUnsupported });
    const flush = () => {
      const q = rafQueue;
      rafQueue = [];
      q.forEach((cb) => cb(0));
    };
    return { canvas, gl, getContext, r, flush, onReady, onUnsupported };
  }

  it("คืน buffer เดิมครบ 3×(1+เม็ดเดิม) · อัปโหลดใหม่ 3×(1+เม็ดใหม่) · ไม่สร้าง WebGL context ใหม่ · วาดโลหะ+ทุกเม็ดของแบบใหม่", () => {
    const { gl, getContext, r, flush } = setup();
    flush();
    expect(gl.createBuffer).toHaveBeenCalledTimes(3 * (1 + 4)); // ไขว้ = เรือน + 4 เม็ด
    gl.createBuffer.mockClear();
    gl.deleteBuffer.mockClear();
    gl.drawElements.mockClear();

    r.setRing(getShowcaseRing("channel6"));
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(3 * (1 + 4));
    expect(gl.createBuffer).toHaveBeenCalledTimes(3 * (1 + 6));
    expect(getContext).toHaveBeenCalledTimes(1);
    flush();
    expect(gl.drawElements).toHaveBeenCalledTimes(1 + 6);
  });

  it("สลับครบ 7 แบบวนไปมา: ทุกครั้ง buffer ไม่รั่ว (delete = create ของรอบก่อน) และวาดจำนวนเม็ดถูก", () => {
    const { gl, r, flush } = setup(true);
    flush();
    const ids = ["trinity", "scroll6", "channel4", "channel6", "bar7", "small7", "bypass2", "scroll6", "bypass2"] as const;
    let prevGems = 4;
    for (const id of ids) {
      const ring = getShowcaseRing(id);
      gl.createBuffer.mockClear();
      gl.deleteBuffer.mockClear();
      gl.drawElements.mockClear();
      r.setRing(ring);
      expect(gl.deleteBuffer).toHaveBeenCalledTimes(3 * (1 + prevGems));
      expect(gl.createBuffer).toHaveBeenCalledTimes(3 * (1 + ring.gems.length));
      flush();
      expect(gl.drawElements).toHaveBeenCalledTimes(1 + ring.gems.length);
      prevGems = ring.gems.length;
    }
  });

  it("tints เดิมสั้นกว่าจำนวนเม็ดใหม่ → เติม CZ ไม่ throw ตอนวาด · setTints ตามหลังได้", () => {
    const { r, flush, gl } = setup();
    flush();
    r.setTints([{ rgb: [1, 0, 0], cz: false }, { rgb: [0, 1, 0], cz: false }]);
    r.setRing(getShowcaseRing("small7"));
    expect(() => flush()).not.toThrow();
    r.setTints(Array.from({ length: 7 }, () => ({ rgb: [0, 0, 1] as const, cz: false })));
    gl.uniform1f.mockClear();
    flush();
    expect(gl.uniform1f).toHaveBeenCalled();
  });

  it("กลับมุมหน้าหลังสลับ (reduced-motion = ทันที · ปกติ = easing แล้วหยุดเอง)", () => {
    const a = setup(false);
    a.flush();
    a.r.setRing(getShowcaseRing("trinity"));
    let frames = 0;
    while (rafQueue.length && frames < 400) {
      a.flush();
      frames++;
    }
    expect(rafQueue.length).toBe(0);
    expect(frames).toBeLessThan(400);
  });

  it("อัปโหลดล้ม (createBuffer คืน null) → onUnsupported('no_webgl') ไม่ throw · วาดต่อไม่พัง (ไม่มี buffer ที่ถูกลบค้าง)", () => {
    const { gl, r, flush, onUnsupported } = setup();
    flush();
    gl.createBuffer.mockReturnValue(null as never);
    expect(() => r.setRing(getShowcaseRing("bar7"))).not.toThrow();
    expect(onUnsupported).toHaveBeenCalledWith("no_webgl");
    gl.drawElements.mockClear();
    expect(() => flush()).not.toThrow();
    expect(gl.drawElements).not.toHaveBeenCalled();
  });

  it("context lost ระหว่างสลับ → ไม่อัปโหลด · restored แล้วอัปโหลดแหวนปัจจุบัน (แบบใหม่) และวาดถูกจำนวน", () => {
    const { canvas, gl, r, flush, onReady } = setup();
    flush();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    gl.createBuffer.mockClear();
    r.setRing(getShowcaseRing("channel4"));
    expect(gl.createBuffer).not.toHaveBeenCalled();
    onReady.mockClear();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(gl.createBuffer).toHaveBeenCalledTimes(3 * (1 + 4));
    expect(onReady).toHaveBeenCalled();
    gl.drawElements.mockClear();
    flush();
    expect(gl.drawElements).toHaveBeenCalledTimes(1 + 4);
  });

  it("หลัง dispose: setRing เป็น no-op (ไม่แตะ GL ไม่ขอเฟรม)", () => {
    const { gl, r, flush } = setup();
    flush();
    r.dispose();
    gl.createBuffer.mockClear();
    r.setRing(getShowcaseRing("trinity"));
    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(rafQueue.length).toBe(0);
  });
});
