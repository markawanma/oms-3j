// lib/ring-builder/viewer/matrix.ts — เมทริกซ์ 4×4 (column-major) + กล้อง · pure
// พอร์ตตรงตัวจาก trinity-ring-preview.html (mmul/persp/rotX/rotY/trans + ค่ากล้องใน draw()) — 🔴 ห้ามแก้สูตร
import type { CameraFrame } from "./bypass-ring";

export function mmul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function persp(fovy: number, asp: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = t / asp;
  o[5] = t;
  o[10] = (f + n) / (n - f);
  o[11] = -1;
  o[14] = (2 * f * n) / (n - f);
  return o;
}

export function rotX(a: number): Float32Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotY(a: number): Float32Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function trans(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/** มุมกล้อง: FOV (rad) · TILT = เอียงจากมุมมองตรงหน้าแถว เพื่อเห็นข้างตัวเรือน */
export const FOV = 0.42;
export const TILT = 0.5;

export interface CameraMatrices {
  mvp: Float32Array;
  model: Float32Array;
  /** ระยะกล้องจากจุดหมุน (มม.) — ใช้เป็น uCam = (0,0,D) */
  distance: number;
}

export function buildCamera(frame: CameraFrame, yaw: number, pitch: number, zoom: number, width: number, height: number): CameraMatrices {
  const th = Math.tan(FOV / 2);
  const D = (frame.span / 0.86 / (2 * th * Math.min(1, width / height))) * zoom;
  const model = mmul(rotX(pitch), mmul(rotY(yaw), mmul(rotX(Math.PI / 2 - TILT), trans(0, -frame.cy, 0))));
  const mvp = mmul(persp(FOV, width / height, Math.max(1, D - 45), D + 70), mmul(trans(0, 0, -D), model));
  return { mvp, model, distance: D };
}
