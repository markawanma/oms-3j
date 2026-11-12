// lib/ring-builder/viewer/gl-renderer.ts — viewer WebGL1 ดิบ (ไม่มีไลบรารีภายนอก · ไม่ fetch · ไม่โหลดอะไรจากโดเมนอื่น)
//
// พอร์ตจากส่วน "3) viewer WebGL1 ดิบ" ของ docs/3j-jewelry/cad/trinity-ring-preview.html — shader · ลำดับวาด · กล้อง · ลากหมุน
// 🔴 ห้ามแก้ shader/สูตรกล้อง (matrix.ts) — TL เปิดเทียบกับต้นฉบับด้วยตา · ส่วนที่เพิ่มจากต้นฉบับมีแค่:
//   · ซูมด้วย wheel เฉพาะเมื่อกด Ctrl/⌘ (pinch บนแทร็กแพดก็เป็นแบบนี้) — เพราะเวทีติดบนจอ ล้อเลื่อนปกติต้องเลื่อนหน้าได้
//   · คีย์บอร์ด (ลูกศร = หมุน · +/- = ซูม · Home = กลับมุมหน้า) · หมุนช้าอัตโนมัติ (ปิดเมื่อมีการโต้ตอบ/reduced-motion)
//   · dispose() · callback onReady / onUnsupported แทนข้อความใน DOM (UI ตัดสินใจเอง)
import type { BypassRing, RingMesh } from "./bypass-ring";
import type { GemTint } from "./gem-colors";
import { buildCamera } from "./matrix";

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

const VS = [
  "attribute vec3 aPos;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat4 uModel;",
  "varying vec3 vN;varying vec3 vW;",
  "void main(){vN=(uModel*vec4(aNormal,0.0)).xyz;vW=(uModel*vec4(aPos,1.0)).xyz;gl_Position=uMVP*vec4(aPos,1.0);}",
].join("\n");
const PREC = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
const FS_METAL =
  PREC +
  [
    "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;uniform vec3 uColor;",
    "vec3 env(vec3 R){",
    "  float sky=smoothstep(-0.6,0.8,R.y);",
    "  vec3 c=mix(vec3(0.16,0.17,0.19),vec3(0.98,0.98,1.0),sky);",
    "  c+=vec3(1.0)*pow(max(dot(R,normalize(vec3(0.35,0.75,0.55))),0.0),24.0)*0.8;",
    "  c+=vec3(0.9,0.92,1.0)*pow(max(dot(R,normalize(vec3(-0.8,0.2,0.4))),0.0),16.0)*0.5;",
    "  float b=(R.y+0.05)*5.0;",
    "  c*=1.0-0.55*exp(-b*b);",
    "  return c;",
    "}",
    "void main(){",
    "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
    "  if(dot(N,V)<0.0)N=-N;",
    "  vec3 R=reflect(-V,N);",
    "  float ndv=max(dot(N,V),0.0);",
    "  vec3 col=uColor*(0.10+0.90*env(R))+pow(1.0-ndv,4.0)*0.06;",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");
const FS_GEM =
  PREC +
  [
    "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;uniform vec3 uTint;uniform vec3 uSpark;uniform vec3 uCap;uniform float uGlow;",
    "void main(){",
    "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
    "  if(dot(N,V)<0.0)N=-N;",
    "  vec3 R=reflect(-V,N);",
    "  float dif=0.5+0.5*dot(N,normalize(vec3(0.25,0.55,0.8)));",
    "  float h=fract(sin(dot(N.xy+N.z,vec2(12.9898,78.233)))*43758.5453);",
    "  float k=(0.30+0.70*dif)*(0.85+0.30*h);",
    "  float sp=pow(max(dot(R,normalize(vec3(0.4,0.8,0.6))),0.0),8.0)*0.9",
    "          +pow(max(dot(R,normalize(vec3(-0.7,0.3,0.55))),0.0),10.0)*0.7",
    "          +pow(max(dot(R,normalize(vec3(0.0,-0.6,0.8))),0.0),6.0)*0.5;",
    "  vec3 col=uTint*k+uSpark*sp+vec3(uGlow);",
    "  gl_FragColor=vec4(min(col,uCap),1.0);",
    "}",
  ].join("\n");

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
  function initGL() {
    pm = program(FS_METAL, ["uMVP", "uModel", "uCam", "uColor"]);
    pg = program(FS_GEM, ["uMVP", "uModel", "uCam", "uTint", "uSpark", "uCap", "uGlow"]);
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
    gl.uniform3f(pm.u.uColor, 0.86, 0.87, 0.9);
    drawBuf(metalBuf);

    gl.useProgram(pg.pr);
    gl.uniformMatrix4fv(pg.u.uMVP, false, mvp);
    gl.uniformMatrix4fv(pg.u.uModel, false, model);
    gl.uniform3f(pg.u.uCam, 0, 0, D);
    for (let i = 0; i < gemBufs.length; i++) {
      const s = tints[i] ?? DEFAULT_TINT;
      const c = s.rgb;
      gl.uniform3f(pg.u.uTint, c[0], c[1], c[2]);
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

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (lost) return;
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
    if (resizeIfNeeded()) dirty = true;
    if (!dirty) return;
    dirty = false;
    draw();
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
    dirty = true;
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
    dirty = true;
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
      dirty = true;
    }
  }
  function onContextLost(e: Event) {
    e.preventDefault();
    lost = true;
    opts.onUnsupported?.("context_lost");
  }
  function onContextRestored() {
    lost = false;
    try {
      initGL();
      uploadRing();
      dirty = true;
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
      dirty = true;
    } else {
      anim = true;
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
  raf = requestAnimationFrame(frame);
  opts.onReady?.();

  return {
    setTints(next) {
      tints = [...next];
      dirty = true;
    },
    resetView,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
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
