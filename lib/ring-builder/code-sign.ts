// lib/ring-builder/code-sign.ts — เซ็น/ตรวจรหัสสั่งทำด้วย HMAC-SHA256 (server-only)
// secret = env RING_BUILDER_CODE_SECRET (≥ 32 ตัว · แยกจาก GEM_QUIZ_TOKEN_SECRET) — ไม่มี/สั้นเกิน = ไม่เซ็น ไม่ตรวจ (fail closed: route 503 · แอดมิน "ระบบตรวจไม่ได้" ไม่ใช่ "ถูก")
// ข้อความที่เซ็น = "rb" ‖ ver(1 ไบต์) ‖ payload bits (เติม 0 ให้ครบไบต์) · tag = 60 บิตแรกของ digest · เทียบด้วย timingSafeEqual
// 🔴 RUNBOOK: ห้ามเปลี่ยนค่า secret โดยไม่ขยับ ver (CODE_VERSION ใน code.ts) พร้อมรองรับ secret เก่าแบบตรวจอย่างเดียว — เปลี่ยนเฉยๆ = รหัสที่ลูกค้าถือค้างอยู่ทั้งหมดกลายเป็น "ไม่ได้ออกโดยระบบ" (not_issued) ทั้งที่ออกจริง
// หมุน secret = รหัสเก่าตรวจไม่ได้ (ยอมรับตาม design §2 — ถ้าต้องหมุนจริงใช้ ver nibble) · ห้าม log secret/tag/ข้อความที่เซ็น
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CODE_SECRET_ENV, CODE_SECRET_MIN_LENGTH } from "./config";
import { bitsToBytes, CODE_VERSION, decodeCode, decodeFromText, encodeCode, packPayload, TAG_BITS, type CodeFields, type DecodeFail, type DecodeResult } from "./code";

export function getCodeSecret(): Buffer | null {
  const s = process.env[CODE_SECRET_ENV];
  if (typeof s !== "string" || s.length < CODE_SECRET_MIN_LENGTH) return null;
  return Buffer.from(s, "utf8");
}

function tagFor(payloadBits: string, secret: Buffer): string {
  const msg = Buffer.concat([Buffer.from("rb", "ascii"), Buffer.from([CODE_VERSION]), Buffer.from(bitsToBytes(payloadBits))]);
  const digest = createHmac("sha256", secret).update(msg).digest();
  let bits = "";
  for (let i = 0; i < 8; i++) bits += digest[i].toString(2).padStart(8, "0");
  return bits.slice(0, TAG_BITS);
}

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "secret" | "fields" };

/** ออกรหัส (fields ต้องมาจากผลของ rb_quote เท่านั้น — ผู้เรียกไม่เชื่อ client) */
export function issueCode(fields: CodeFields): IssueResult {
  const secret = getCodeSecret();
  if (!secret) return { ok: false, reason: "secret" };
  const packed = packPayload(fields);
  if (!packed.ok) return { ok: false, reason: "fields" };
  return { ok: true, code: encodeCode(packed.bits, tagFor(packed.bits, secret)) };
}

export type VerifyResult =
  | { status: "empty" }
  | { status: "not_found" }
  | { status: "bad_format"; reason: DecodeFail }
  | { status: "unavailable" }
  | { status: "not_issued" }
  | { status: "valid"; fields: CodeFields; code: string };


/** HMAC ของรหัสที่ถอดรูปแบบ+check char ผ่านแล้ว (ไม่มี secret = unavailable · tag ไม่ตรง = not_issued) */
function verifyDecoded(d: Extract<DecodeResult, { ok: true }>): VerifyResult {
  const secret = getCodeSecret();
  if (!secret) return { status: "unavailable" };
  const expected = Buffer.from(tagFor(d.payloadBits, secret));
  const actual = Buffer.from(d.tagBits);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { status: "not_issued" };
  return { status: "valid", fields: d.fields, code: d.canonical };
}

/** ตรวจรหัสเดี่ยว: รูปแบบ+check char → (ไม่มี secret = unavailable) → HMAC */
export function verifyCode(text: string): VerifyResult {
  const d = decodeCode(text);
  if (!d.ok) return { status: "bad_format", reason: d.reason };
  return verifyDecoded(d);
}

/** ตรวจจากข้อความทั้งก้อน (S11: รหัสที่ถูกตัดบรรทัด/คั่นด้วยช่องว่างก็ได้) · ว่าง = empty · ไม่เจอ = not_found */
export function verifyCodeFromText(text: string): VerifyResult {
  const d = decodeFromText(text);
  if (!d.ok) return d.reason === "empty" || d.reason === "not_found" ? { status: d.reason } : { status: "bad_format", reason: d.reason };
  return verifyDecoded(d);
}
