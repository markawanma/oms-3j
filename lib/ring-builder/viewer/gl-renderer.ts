// lib/ring-builder/viewer/gl-renderer.ts — viewer WebGL1 ดิบ (ไม่มีไลบรารีภายนอก · ไม่ fetch · ไม่โหลดอะไรจากโดเมนอื่น)
//
// พอร์ตจากส่วน "3) viewer WebGL1 ดิบ" ของ docs/3j-jewelry/cad/trinity-ring-preview.html — ลำดับวาด · กล้อง · ลากหมุน
// 🔴 D1.1 (17 พ.ย. 69): แก้ได้เฉพาะ fragment shader (ไฟล์ shaders.ts · ค่าแสงที่ SILVER_LOOK) — ห้ามแก้สูตรกล้อง (matrix.ts) และ bypass-ring.ts
//   shader V2 (เงินขัดเงา) compile/link ไม่ผ่าน → ถอยไปใช้ shader V1 ของ D1 ก่อน · V1 ก็ไม่ผ่าน → throw ให้ผู้เรียกตก fallback เป็นรูปจริง
// ส่วนที่เพิ่มจากต้นฉบับ:
//   · ซูมด้วย wheel เฉพาะเมื่อกด Ctrl/⌘ (pinch บนแทร็กแพดก็เป็นแบบนี้) — เพราะเวทีติดบนจอ ล้อเลื่อนปกติต้องเลื่อนหน้าได้
//   · คีย์บอร์ด (ลูกศร = หมุน · +/- = ซูม · Home = กลับมุมหน้า) · หมุนช้าอัตโนมัติ (ปิดเมื่อมีการโต้ตอบ/reduced-motion)
//   · dispose() · callback onReady / onUnsupported แทนข้อความใน DOM (UI ตัดสินใจเอง)
//   · D2-1: requestAnimationFrame ทำงานเฉพาะเมื่อมีอะไรเปลี่ยน (dirty / กำลังหมุน / กำลังเลื่อนกลับมุมหน้า) + ResizeObserver แทนการอ่านขนาดทุกเฟรม
import type { BypassRing, RingMesh } from "./bypass-ring";
import type { GemTint } from "./gem-colors";
import { buildCamera } from "./matrix";
import { FS_GEM_V1, FS_GEM_V2, FS_METAL_V1, FS_METAL_V2, VS } from "./shaders";

export type UnsupportedReason = "no_webgl" | "context_lost" | "low_perf";

export interface RingRendererOptions {
  /** หมุนช้าเองจนกว่าผู้ใช้จะแตะ/ลาก/กดคีย์ (ผู้เรียกส่ง false เมื่อ prefers-reduced-motion) */
  autoRotate: boolean;
  /** กลับมุมหน้าแบบทันที ไม่มี easing (reduced-motion) */
  reducedMotion: boolean;
  onReady?: () => void;
  onUnsupported?: (reason: UnsupportedReason) => void;
}

export interface RingRenderer {
  setTints(tints: readonly GemTint[]): void;
  resetView(): void;
  dispose(): void;
}

const CONTEXT_ATTRS: WebGLContextAttributes = { antialias: true, alpha: true, premultipliedAlpha: false, failIfMajorPerformanceCaveat: true };

/** ตรวจว่าเครื่องนี้สร้าง WebGL context ได้ (เงื่อนไขเดียวกับตัววาดจริง) — ใช้ก่อน lazy-load viewer · ไม่ throw */
export function isWebGLAvailable(): boolean {
  try {
    if (typeof document === "undefined") return false;
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl", CONTEXT_ATTRS) as WebGLRenderingContext | null;
    if (!gl) return false;
    // คืน context ทันที (มือถือจำกัดจำนวน context)
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface Prog {
  pr: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}
interface Buf {
  pb: WebGLBuffer;
  nb: WebGLBuffer;
  ib: WebGLBuffer;
  count: number;
}

const DEFAULT_TINT: GemTint = { rgb: [0.9, 0.92, 0.96], cz: true };

/** สร้างตัววาดบน canvas — throw เมื่อสร้าง context/shader ไม่ได้ (ผู้เรียกตก fallback เป็นรูปจริง) */
export function createRingRenderer(canvas: HTMLCanvasElement, ring: BypassRing, opts: RingRendererOptions): RingRenderer {
  const maybeGl = canvas.getContext("webgl", CONTEXT_ATTRS) as WebGLRenderingContext | null;
  if (!maybeGl) throw new Error("no webgl");
  const gl: WebGLRenderingContext = maybeGl;

  let pm: Prog;
  let pg: Prog;
  let metalBuf: Buf | null = null;
  let gemBufs: Buf[] = [];
  let lost = false;
  let dirty = true;
  let disposed = false;
  let raf = 0;
  let tints: GemTint[] = ring.gems.map(() => DEFAULT_TINT);
  let resizeObserver: ResizeObserver | null = null;

  let yaw = 0;
  let pitch = 0;
  let zoom = 1;
  let drag = false;
  let lx = 0;
  let ly = 0;
  let anim = false;
  let spin = opts.autoRotate && !opts.reducedMotion;

  function compile(type: number, src: string): WebGLShader {
    const s = gl.createShader(type);
    if (!s) throw new Error("createShader failed");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
    return s;
  }
  function program(fs: string, names: string[]): Prog {
    const pr = gl.createProgram();
    if (!pr) throw new Error("createProgram failed");
    gl.attachShader(pr, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pr, 0, "aPos");
    gl.bindAttribLocation(pr, 1, "aNormal");
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) ?? "program link failed");
    const u: Record<string, WebGLUniformLocation | null> = {};
    names.forEach((nm) => {
      u[nm] = gl.getUniformLocation(pr, nm);
    });
    return { pr, u };
  }
  function buildPrograms(fsMetal: string, fsGem: string) {
    // uniform ที่ shader ไม่ได้ใช้ (เช่น uColor ใน V2 · uCz ใน V1) ได้ location = null → gl.uniform* เป็น no-op ไม่ error
    pm = program(fsMetal, ["uMVP", "uModel", "uCam", "uColor"]);
    pg = program(fsGem, ["uMVP", "uModel", "uCam", "uTint", "uSpark", "uCap", "uGlow", "uCz"]);
  }
  function initGL() {
    try {
      buildPrograms(FS_METAL_V2, FS_GEM_V2);
    } catch {
      buildPrograms(FS_METAL_V1, FS_GEM_V1); // shader เงินขัดเงา compile ไม่ผ่าน → shader D1
    }
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }
  function upMesh(m: RingMesh): Buf {
    const pb = gl.createBuffer();
    const nb = gl.createBuffer();
    const ib = gl.createBuffer();
    if (!pb || !nb || !ib) throw new Error("createBuffer failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, m.nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    return { pb, nb, ib, count: m.idx.length };
  }
  function freeMesh(b: Buf | null) {
    if (b) {
      gl.deleteBuffer(b.pb);
      gl.deleteBuffer(b.nb);
      gl.deleteBuffer(b.ib);
    }
  }
  function uploadRing() {
    freeMesh(metalBuf);
    gemBufs.forEach(freeMesh);
    metalBuf = upMesh(ring.metal);
    gemBufs = ring.gems.map((g) => upMesh(g.mesh));
  }
  function drawBuf(b: Buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pb);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.nb);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ib);
    gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
  }

  function resizeIfNeeded(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(canvas.clientWidth * dpr);
    const H = Math.round(canvas.clientHeight * dpr);
    if (W > 0 && H > 0 && (canvas.width !== W || canvas.height !== H)) {
      canvas.width = W;
      canvas.height = H;
      return true;
    }
    return false;
  }

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H || !metalBuf) return;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { mvp, model, distance: D } = buildCamera(ring.frame, yaw, pitch, zoom, W, H);

    gl.useProgram(pm.pr);
    gl.uniformMatrix4fv(pm.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(pm.u.uModel, false, model);
    gl.uniform3f(pm.u.uCam, 0, 0, D);
    gl.uniform3f(pm.u.uColor, 0.86, 0.87, 0.9); // ใช้เฉพาะ shader V1 (V2 คำนวณสีเงินจาก F0 ใน shaders.ts)
    drawBuf(metalBuf);

    gl.useProgram(pg.pr);
    gl.uniformMatrix4fv(pg.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(pg.u.uModel, false, model);
    gl.uniform3f(pg.u.uCam, 0, 0, D);
    for (let i = 0; i < gemBufs.length; i++) {
      const s = tints[i] ?? DEFAULT_TINT;
      const c = s.rgb;
      gl.uniform3f(pg.u.uTint, c[0], c[1], c[2]);
      gl.uniform1f(pg.u.uCz, s.cz ? 1 : 0);
      if (s.cz) {
        gl.uniform3f(pg.u.uSpark, 1, 1, 1);
        gl.uniform3f(pg.u.uCap, 1, 1, 1);
      } else {
        gl.uniform3f(pg.u.uSpark, 1 + (c[0] - 1) * 0.65, 1 + (c[1] - 1) * 0.65, 1 + (c[2] - 1) * 0.65); // ประกายคงโทนสี ไม่ขาวล้วน
        gl.uniform3f(pg.u.uCap, Math.min(1, c[0] * 1.3 + 0.12), Math.min(1, c[1] * 1.3 + 0.12), Math.min(1, c[2] * 1.3 + 0.12));
      }
      gl.uniform1f(pg.u.uGlow, 0);
      drawBuf(gemBufs[i]);
    }
  }

  /** ขอวาดเฟรมถัดไป (ไม่ซ้อน · ไม่ทำอะไรเมื่อ dispose/context lost) — ไม่มี rAF วนเมื่อไม่มีอะไรเปลี่ยน (D2-1) */
  function schedule() {
    if (disposed || lost || raf) return;
    raf = requestAnimationFrame(frame);
  }
  function markDirty() {
    dirty = true;
    schedule();
  }

  function frame() {
    raf = 0;
    if (disposed || lost) return;
    if (anim) {
      const ty = Math.round(yaw / (2 * Math.PI)) * 2 * Math.PI;
      yaw += (ty - yaw) * 0.18;
      pitch += (0 - pitch) * 0.18;
      zoom += (1 - zoom) * 0.18;
      dirty = true;
      if (Math.abs(ty - yaw) < 0.003 && Math.abs(pitch) < 0.003 && Math.abs(1 - zoom) < 0.003) {
        yaw = 0;
        pitch = 0;
        zoom = 1;
        anim = false;
      }
    }
    if (spin && !drag) {
      yaw += 0.004;
      dirty = true;
    }
    if (dirty) {
      resizeIfNeeded();
      dirty = false;
      draw();
    }
    // วนต่อเฉพาะเมื่อยังมีการเคลื่อนไหวที่ต้องวาด — นอกนั้นหยุด รอ markDirty()
    if (anim || (spin && !drag)) schedule();
  }

  /* ---------- โต้ตอบ ---------- */
  function stopSpin() {
    spin = false;
  }
  function onPointerDown(e: PointerEvent) {
    drag = true;
    anim = false;
    stopSpin();
    lx = e.clientX;
    ly = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ไม่กระทบการลาก
    }
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    yaw += (e.clientX - lx) * 0.01;
    pitch += (e.clientY - ly) * 0.01;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    lx = e.clientX;
    ly = e.clientY;
    markDirty();
  }
  function onPointerEnd() {
    drag = false;
  }
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return; // ล้อเลื่อนปกติ = เลื่อนหน้า (เวทีติดบนจอ)
    e.preventDefault();
    stopSpin();
    zoom *= 1 + (e.deltaY > 0 ? 1 : -1) * 0.08;
    zoom = Math.max(0.5, Math.min(2.2, zoom));
    markDirty();
  }
  function onKeyDown(e: KeyboardEvent) {
    let used = true;
    switch (e.key) {
      case "ArrowLeft":
        yaw -= 0.15;
        break;
      case "ArrowRight":
        yaw += 0.15;
        break;
      case "ArrowUp":
        pitch = Math.max(-1.5, pitch - 0.1);
        break;
      case "ArrowDown":
        pitch = Math.min(1.5, pitch + 0.1);
        break;
      case "+":
      case "=":
        zoom = Math.max(0.5, zoom / 1.1);
        break;
      case "-":
        zoom = Math.min(2.2, zoom * 1.1);
        break;
      case "Home":
        resetView();
        break;
      default:
        used = false;
    }
    if (used) {
      e.preventDefault();
      stopSpin();
      markDirty();
    }
  }
  function onContextLost(e: Event) {
    e.preventDefault();
    lost = true;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    opts.onUnsupported?.("context_lost");
  }
  function onContextRestored() {
    lost = false;
    try {
      initGL();
      uploadRing();
      markDirty();
      opts.onReady?.();
    } catch {
      opts.onUnsupported?.("no_webgl");
    }
  }

  function resetView() {
    stopSpin();
    if (opts.reducedMotion) {
      yaw = 0;
      pitch = 0;
      zoom = 1;
      markDirty();
    } else {
      anim = true;
      schedule();
    }
  }

  initGL();
  uploadRing();
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  // ขนาดเปลี่ยน (หมุนจอ/ย่อขยายหน้าต่าง/layout ขยับ) → วาดใหม่ · เบราว์เซอร์ที่ไม่มี ResizeObserver ใช้ resize ของ window
  const onWindowResize = () => markDirty();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => markDirty());
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", onWindowResize);
  }
  markDirty();
  opts.onReady?.();

  return {
    setTints(next) {
      tints = [...next];
      markDirty();
    },
    resetView,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      // ไม่เรียก loseContext(): React StrictMode (dev) mount→unmount→mount บน canvas เดิม — context ที่ถูก lose แล้วจะใช้ซ้ำไม่ได้
      // คืนทรัพยากรด้วยการลบ buffer/program แทน · canvas ถูกถอดจาก DOM ตอน unmount จริง ให้ GC เก็บ context เอง
      if (!lost) {
        freeMesh(metalBuf);
        gemBufs.forEach(freeMesh);
        gl.deleteProgram(pm.pr);
        gl.deleteProgram(pg.pr);
      }
      metalBuf = null;
      gemBufs = [];
    },
  };
}
