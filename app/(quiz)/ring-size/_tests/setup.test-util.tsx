// ตัวช่วยของเทสต์ component ring-size (jsdom) — ไม่ถูกส่งขึ้นจริง
import { vi } from "vitest";
import { CALIBRATION_STORAGE_KEY, CALIBRATION_VERSION, LAST_RESULT_STORAGE_KEY, currentFingerprint, type Calibration, type LastResult } from "@/lib/ring-size/calibration";

/** jsdom ไม่มี layout — ทุก element ได้ขนาดเท่ากัน เพื่อให้เวทีมีขนาดที่วัดได้ */
export function mockRects(width = 390, height = 300) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // บล็อกบนของ R5B (header) สูงตามจริง 52 px — องค์ประกอบอื่นได้ขนาดเดียวกันหมด
    const h = this.hasAttribute("data-rs-top") ? 52 : height;
    return { width, height: h, top: 0, left: 0, right: width, bottom: h, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}

export function setViewport(opts: { innerHeight?: number; innerWidth?: number }) {
  if (opts.innerHeight !== undefined) Object.defineProperty(window, "innerHeight", { value: opts.innerHeight, configurable: true, writable: true });
  if (opts.innerWidth !== undefined) Object.defineProperty(window, "innerWidth", { value: opts.innerWidth, configurable: true, writable: true });
}

export function setVisualViewport(vv: Partial<VisualViewport> | undefined) {
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
}

/** ค่าเทียบจอที่ "ตรงกับเครื่องนี้" (ไม่ stale) */
export function seedCalibration(over: Partial<Calibration> = {}): Calibration {
  const fp = currentFingerprint();
  const c: Calibration = { pxPerMm: 6, ref: "coin", ...fp, savedAt: Date.now(), version: CALIBRATION_VERSION, ...over };
  window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(c));
  return c;
}

export function seedLastResult(over: Partial<LastResult> = {}): LastResult {
  const r: LastResult = { circ: 54, method: "A", ref: "coin", savedAt: new Date(2026, 9, 24, 12).getTime(), version: 1, ...over };
  window.localStorage.setItem(LAST_RESULT_STORAGE_KEY, JSON.stringify(r));
  return r;
}

/** jsdom: screen.width/height = 0 — ตั้งค่าคงที่ให้ fingerprint นิ่ง (ไม่ขึ้นกับ innerHeight) */
function setScreen(width: number, height: number) {
  Object.defineProperty(window.screen, "width", { value: width, configurable: true });
  Object.defineProperty(window.screen, "height", { value: height, configurable: true });
}

export function resetBrowserState() {
  setScreen(390, 844);
  window.localStorage.clear();
  window.history.replaceState(null, "");
  setVisualViewport(undefined);
  // ถือแนวตั้งเป็นค่าเริ่ม (portraitWidth ใน fingerprint ถูกใช้งานจริงในเทสต์)
  setViewport({ innerHeight: 844, innerWidth: 390 });
}

/** เลข/ข้อความตัวอย่างจาก mockup ที่ห้ามโผล่ใน screen ตอนยังไม่มีผลวัดจริง (A12) */
export const MOCKUP_NUMBERS = /(?<![\d.])(54|58|57\.5|43|54\.1|37\.7|2569)(?![\d])/;
