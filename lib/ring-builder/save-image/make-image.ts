// lib/ring-builder/save-image/make-image.ts — ประกอบขั้น "จับภาพ → compose → File" ของปุ่มบันทึกรูป (ux-ring-save-image §3.1)
// 🔴 ลำดับสำคัญ: จับภาพ 3D (sync) ทำก่อน await แรกเสมอ → ได้ภาพ = ค่า ณ ตอนเรียก (ไม่ใช่ state ที่เปลี่ยนทีหลัง) · ปุ่มเรียกล่วงหน้าตอนค่านิ่ง (pre-compose) ไม่ใช่ตอนกด — เพราะ iOS ต้องเรียก share() ใน gesture โดยไม่มี await คั่น
// 🔴 ด่านเดียวกับปุ่ม LINE: buildShowcaseLineMessage(input) !== null (แบบ/ไซซ์/พลอยถูกต้อง) ไม่ผ่าน = ไม่สร้างรูป
// ล้มทุกทาง (capture null · พิกเซลว่าง · ไม่มี token · toBlob null · เกินเวลา) = { ok:false } ไม่ throw · เกินเวลา = resolve ล้มเลย แต่ compose อาจยังวิ่งอยู่ → onTimeout ส่ง promise "งานจบจริง" ให้ผู้เรียกถือ busy ไว้ (กันซ้อนงาน) · ไม่มี network/storage
import type { ShowcaseLineInput } from "@/lib/ring-builder/showcase/line-message";
import { buildShowcaseLineMessage } from "@/lib/ring-builder/showcase/line-message";
import { buildShowcaseDetailRows } from "@/lib/ring-builder/showcase/detail-rows";
import { isBlankCapture } from "@/lib/ring-builder/viewer/capture-pixels";
import type { CaptureFrontFn } from "@/lib/ring-builder/viewer/gl-renderer";
import { composeSaveImage, readSaveTheme, type ComposeEnv, type SaveTheme } from "./compose";
import { formatThaiDate, STAGE_H, STAGE_W } from "./layout";

export const SAVE_TIMEOUT_MS = 8000;

export type MakeImageResult = { ok: true; file: File; alt: string } | { ok: false };

export interface MakeImageArgs {
  capture: CaptureFrontFn;
  input: ShowcaseLineInput;
  /** element ใต้ wrapper ของเครื่องมือ (อ่าน token สี/ฟอนต์จากตรงนี้) */
  themeEl: Element;
  now?: Date;
  timeoutMs?: number;
  /** เรียกเฉพาะตอนเกินเวลา (ก่อน resolve ล้ม): `done` resolve เมื่องานข้างในจบจริง (ไม่ reject) — ผู้เรียกรอมันก่อนปล่อยปุ่ม */
  onTimeout?: (done: Promise<void>) => void;
  /** เทสต์เท่านั้น */
  deps?: { readTheme?: (el: Element) => SaveTheme; compose?: typeof composeSaveImage; env?: ComposeEnv };
}

/** ชื่อไฟล์ตายตัว (ไม่มีข้อมูลลูกค้า): 3j-ring-<YYYYMMDD>.jpg ตามเวลาเครื่อง */
export function saveFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `3j-ring-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.jpg`;
}

export function makeSaveImage(args: MakeImageArgs): Promise<MakeImageResult> {
  const fail: MakeImageResult = { ok: false };
  const now = args.now ?? new Date();
  // --- ส่วน sync (ก่อน await แรก): ตรวจ + จับภาพ ---
  let rgba: Uint8Array | null;
  let rows: ReturnType<typeof buildShowcaseDetailRows>;
  try {
    if (buildShowcaseLineMessage(args.input) === null) return Promise.resolve(fail);
    rows = buildShowcaseDetailRows(args.input);
    if (!rows) return Promise.resolve(fail);
    rgba = args.capture(STAGE_W, STAGE_H);
  } catch {
    return Promise.resolve(fail);
  }
  if (!rgba || isBlankCapture(rgba, STAGE_W, STAGE_H)) return Promise.resolve(fail); // S10: ภาพว่าง/ขนาดผิด = ไม่ใช่รูป
  const pixels = rgba;
  const detail = rows;

  let theme: SaveTheme;
  try {
    theme = (args.deps?.readTheme ?? readSaveTheme)(args.themeEl);
  } catch {
    return Promise.resolve(fail);
  }

  const alt = detail.map((r) => `${r.label} ${r.value}`).join(" · ");
  const compose = args.deps?.compose ?? composeSaveImage;
  const work = (async (): Promise<MakeImageResult> => {
    try {
      const r = await compose({ rgba: pixels, rows: detail, dateText: formatThaiDate(now), theme }, args.deps?.env);
      return { ok: true, file: new File([r.blob], saveFileName(now), { type: "image/jpeg" }), alt };
    } catch {
      return fail;
    }
  })();
  const timeoutMs = args.timeoutMs ?? SAVE_TIMEOUT_MS;
  return new Promise<MakeImageResult>((resolve) => {
    const timer = setTimeout(() => {
      args.onTimeout?.(work.then(() => undefined));
      resolve(fail);
    }, timeoutMs);
    work.then((r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}
