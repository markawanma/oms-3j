import "server-only";

// lib/gem-quiz/form-token.ts
//
// Signed form token (design §5.2 L2) — `issueFormToken()` ถูกเรียกจาก server
// component ของหน้า /gem-quiz (app/(quiz)/gem-quiz/page.tsx, force-dynamic,
// token ต้องสดทุกครั้ง) `verifyFormToken()` ถูกเรียกจาก
// app/api/gem-quiz/submit/route.ts ก่อนจะเชื่อ body อะไรเลย
//
// "server-only" ต้องอยู่บรรทัดบนสุดของไฟล์ (ก่อน comment นี้ด้วยซ้ำตามกฎของ
// แพ็กเกจนี้) — ป้องกันไม่ให้ไฟล์นี้ถูก bundle เข้า client โดยไม่ตั้งใจ แม้ว่า
// lib/gem-quiz/** ที่เหลือจะถูกออกแบบให้ import ได้ทั้ง client/server ก็ตาม
// (ต่างจาก config.ts/recommend.ts/validate.ts — ไฟล์นี้ถือ secret จริง ห้าม
// รั่วไปฝั่ง browser เด็ดขาด)
import { createHmac, timingSafeEqual } from "node:crypto";

// ≥4 วินาที (R-5: กันกรอกเร็วผิดมนุษย์) · ≤2 ชั่วโมง (R-4: token หมดอายุ)
const MIN_AGE_MS = 4_000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type TokenVerifyFailureReason =
  | "secret_unset"
  | "missing"
  | "malformed"
  | "bad_signature"
  | "too_old"
  | "too_fast";

export type TokenVerifyResult = { ok: true } | { ok: false; reason: TokenVerifyFailureReason };

// Security audit L4 (4 ต.ค. 69): ไม่บังคับความยาวขั้นต่ำมาก่อน — ตั้งเป็น "x"
// ก็ผ่านและ HMAC ยัง sign/verify ได้ตามปกติ (สั้นแค่ไหนก็ไม่พังทางเทคนิค) แต่
// secret สั้นเดารหัสผ่าน brute-force ได้ง่ายกว่าหลายระดับ ปฏิเสธว่า "ไม่ได้ตั้ง"
// (fail closed เหมือนไม่มีค่าเลย) ถ้าสั้นกว่าที่แนะนำใน .env.local.example
// (`openssl rand -hex 32` = 64 ตัวอักษร) ให้ปลอดภัยไว้ก่อน
const MIN_SECRET_LENGTH = 32;

function getSecret(): string | null {
  const secret = process.env.GEM_QUIZ_TOKEN_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

function sign(issuedAtMs: string, secret: string): string {
  return createHmac("sha256", secret).update(issuedAtMs).digest("hex");
}

/** ออก token ใหม่ — คืน null ถ้า GEM_QUIZ_TOKEN_SECRET ยังไม่ตั้ง (fail closed:
 * ดีกว่าออก token ที่ verifyFormToken ปฏิเสธอยู่ดี — route.ts ต้องตอบ 503 ใน
 * เคสนี้เหมือนกัน R-9/§10). */
export function issueFormToken(now: number = Date.now()): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const issuedAtMs = String(now);
  return `${issuedAtMs}.${sign(issuedAtMs, secret)}`;
}

/** ตรวจ token จาก POST body. ใช้ timingSafeEqual เทียบลายเซ็น (ห้าม === ตรงๆ
 * กับค่าที่มาจาก secret — บรีฟ) เทียบความยาวก่อนเสมอเพราะ timingSafeEqual
 * ของ Node throw ถ้า buffer สองฝั่งยาวไม่เท่ากัน (ไม่ใช่แค่คืน false) — ความยาว
 * ของ hex digest ของ HMAC-SHA256 คงที่ 64 ตัวอักษรเสมอไม่ขึ้นกับเนื้อหา secret
 * เทียบความยาวก่อนจึงไม่รั่วข้อมูลเพิ่มจากที่ digest length มันคงที่อยู่แล้ว. */
export function verifyFormToken(token: string | null | undefined, now: number = Date.now()): TokenVerifyResult {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "secret_unset" };

  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return { ok: false, reason: "malformed" };

  const issuedAtMsStr = token.slice(0, dotIndex);
  const providedSignature = token.slice(dotIndex + 1);

  if (!/^\d+$/.test(issuedAtMsStr) || providedSignature.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const expectedSignature = sign(issuedAtMsStr, secret);
  const expectedBuf = Buffer.from(expectedSignature, "utf-8");
  const providedBuf = Buffer.from(providedSignature, "utf-8");

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  const issuedAtMs = Number(issuedAtMsStr);
  const ageMs = now - issuedAtMs;

  // token ที่ดูเหมือน "ออกในอนาคต" เทียบกับเวลาตรวจ ณ ตอนนี้ — ไม่เดาเจตนา
  // (นาฬิกาเพี้ยน/ค่าปลอม) ปฏิเสธเหมือนกรณีผิดรูปแบบอื่น
  if (ageMs < 0) return { ok: false, reason: "malformed" };
  if (ageMs < MIN_AGE_MS) return { ok: false, reason: "too_fast" };
  if (ageMs > MAX_AGE_MS) return { ok: false, reason: "too_old" };

  return { ok: true };
}
