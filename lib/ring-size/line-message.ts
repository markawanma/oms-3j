// lib/ring-size/line-message.ts — ข้อความ + ลิงก์ LINE (spec ข้อ 2.7)
//
// ข้อความมีเฉพาะ: เบอร์ · มม. · วิธี · เทียบจอด้วย — ห้ามข้อมูลส่วนบุคคล/ราคา (เคส QA A6)
// ค่า LINE มาจาก lib/shop/line.ts ที่เดียว (ผ่าน config.ts)
import { lineOaMessageUrl } from "@/lib/shop/line";
import {
  COPY,
  LINE_HELP_MESSAGE,
  LINE_OA_FALLBACK_URL,
  LINE_PRIMARY_MODE,
  METHOD_LABEL,
  REF_LABEL,
  type LineMode,
  type Method,
  type RefKind,
} from "./config";
import { formatMm, type SizeRec } from "./size";

export interface LineMessageInput {
  size: SizeRec;
  method: Method;
  ref: RefKind;
}

export function buildLineMessage({ size, method, ref }: LineMessageInput): string {
  const c = formatMm(size.circ);
  if (size.between) {
    return COPY.line.between(c, size.between.lo, size.between.hi, size.rec, METHOD_LABEL[method], REF_LABEL[ref]);
  }
  return COPY.line.normal(size.rec, c, METHOD_LABEL[method], REF_LABEL[ref]);
}

/** ลิงก์เปิดแชทพร้อมข้อความเตรียมไว้ (ใช้เมื่อ mode = oaMessage) */
export function buildOaMessageUrl(input: LineMessageInput): string {
  return lineOaMessageUrl(buildLineMessage(input));
}

/** ปลายทางของปุ่มหลักตาม mode — copyThenOpen คัดลอกก่อนแล้วเปิดแชทเปล่า · oaMessage เปิดแชทพร้อมข้อความ */
export function primaryLineHref(input: LineMessageInput, mode: LineMode = LINE_PRIMARY_MODE): string {
  return mode === "oaMessage" ? buildOaMessageUrl(input) : LINE_OA_FALLBACK_URL;
}

/** ปุ่ม "ให้แอดมินช่วยวัดทาง LINE" — ไม่มีข้อความเตรียม (LINE_HELP_MESSAGE = null) = เปิดแชทเปล่า */
export function helpLineHref(mode: LineMode = LINE_PRIMARY_MODE): string {
  if (LINE_HELP_MESSAGE !== null && mode === "oaMessage") return lineOaMessageUrl(LINE_HELP_MESSAGE);
  return LINE_OA_FALLBACK_URL;
}

/**
 * คัดลอกข้อความลงคลิปบอร์ด — คืน true เมื่อสำเร็จ · ไม่ throw
 * webview บางตัวไม่มี navigator.clipboard → ลอง execCommand ผ่าน textarea ชั่วคราว
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ตกไปทางสำรอง
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
