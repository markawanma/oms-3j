// lib/gem-quiz/form-token.test.ts — R-4 (token ปลอม/หมดอายุ → 400 ที่ route
// แมปจาก reason เหล่านี้), R-5 (token เร็วเกิน → 204 เงียบ), R-9 (secret ไม่ตั้ง
// → 503 fail closed ที่ route แมปจาก reason "secret_unset")
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueFormToken, verifyFormToken } from "./form-token";

// ≥32 chars (L4: getSecret() now rejects anything shorter as "unset")
const SECRET = "test-secret-do-not-use-in-prod-0123456789";
const ORIGINAL_SECRET = process.env.GEM_QUIZ_TOKEN_SECRET;

beforeEach(() => {
  process.env.GEM_QUIZ_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.GEM_QUIZ_TOKEN_SECRET;
  else process.env.GEM_QUIZ_TOKEN_SECRET = ORIGINAL_SECRET;
});

describe("issueFormToken", () => {
  it("คืน token รูปแบบ {issuedAtMs}.{hex signature} เมื่อ secret ตั้งแล้ว", () => {
    const token = issueFormToken(1_000_000);
    expect(token).toMatch(/^1000000\.[0-9a-f]{64}$/);
  });

  it("คืน null เมื่อ GEM_QUIZ_TOKEN_SECRET ไม่ได้ตั้ง (R-9 fail closed)", () => {
    delete process.env.GEM_QUIZ_TOKEN_SECRET;
    expect(issueFormToken(1_000_000)).toBeNull();
  });

  it("คืน null เมื่อ secret เป็น string ว่าง", () => {
    process.env.GEM_QUIZ_TOKEN_SECRET = "";
    expect(issueFormToken(1_000_000)).toBeNull();
  });

  it("คืน null เมื่อ secret สั้นกว่า 32 ตัวอักษร (L4 — ปฏิเสธเหมือนไม่ได้ตั้ง)", () => {
    process.env.GEM_QUIZ_TOKEN_SECRET = "short-secret-31-chars-exactly!!";
    expect(process.env.GEM_QUIZ_TOKEN_SECRET.length).toBe(32 - 1);
    expect(issueFormToken(1_000_000)).toBeNull();
  });

  it("ยอมรับ secret ที่พอดี 32 ตัวอักษร (ขอบล่าง)", () => {
    const exactly32 = "x".repeat(32);
    process.env.GEM_QUIZ_TOKEN_SECRET = exactly32;
    expect(issueFormToken(1_000_000)).not.toBeNull();
  });
});

describe("verifyFormToken", () => {
  const ISSUED_AT = 1_000_000;

  it("token ที่ออกถูกต้อง + อายุพอดี (5 วินาที) ⇒ ok:true", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT + 5_000);
    expect(result).toEqual({ ok: true });
  });

  it("R-9: secret ไม่ได้ตั้ง ⇒ reason:secret_unset ไม่ว่า token จะเป็นอะไร", () => {
    const token = issueFormToken(ISSUED_AT);
    delete process.env.GEM_QUIZ_TOKEN_SECRET;
    const result = verifyFormToken(token, ISSUED_AT + 5_000);
    expect(result).toEqual({ ok: false, reason: "secret_unset" });
  });

  it.each([null, undefined, ""])("token = %p ⇒ reason:missing", (bad) => {
    expect(verifyFormToken(bad, ISSUED_AT + 5_000)).toEqual({ ok: false, reason: "missing" });
  });

  it.each(["no-dot-here", ".nodigitsissuedat", "abc.def"])("token รูปแบบผิด (%s) ⇒ reason:malformed", (bad) => {
    const result = verifyFormToken(bad, ISSUED_AT + 5_000);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("R-4: ลายเซ็นถูกแก้ ⇒ reason:bad_signature", () => {
    const token = issueFormToken(ISSUED_AT)!;
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const result = verifyFormToken(tampered, ISSUED_AT + 5_000);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("ลายเซ็นถูกเซ็นด้วย secret อื่น ⇒ reason:bad_signature", () => {
    const token = issueFormToken(ISSUED_AT)!;
    // ≥32 chars ด้วย (L4) — ต้องการให้ reject ด้วย bad_signature ไม่ใช่ secret_unset
    process.env.GEM_QUIZ_TOKEN_SECRET = "a-completely-different-secret-value";
    const result = verifyFormToken(token, ISSUED_AT + 5_000);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("R-5: อายุ < 4 วินาที ⇒ reason:too_fast", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT + 3_999);
    expect(result).toEqual({ ok: false, reason: "too_fast" });
  });

  it("ขอบเขตล่างพอดี: อายุ = 4 วินาทีเป๊ะ ⇒ ok:true (>= ไม่ใช่ >)", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT + 4_000);
    expect(result).toEqual({ ok: true });
  });

  it("R-4: อายุ > 2 ชั่วโมง ⇒ reason:too_old", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT + 2 * 60 * 60 * 1000 + 1);
    expect(result).toEqual({ ok: false, reason: "too_old" });
  });

  it("ขอบเขตบนพอดี: อายุ = 2 ชั่วโมงเป๊ะ ⇒ ok:true (<= ไม่ใช่ <)", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT + 2 * 60 * 60 * 1000);
    expect(result).toEqual({ ok: true });
  });

  it("token ที่ issuedAt อยู่ในอนาคตเทียบกับเวลาตรวจ ⇒ reason:malformed (ไม่เดาเจตนา)", () => {
    const token = issueFormToken(ISSUED_AT);
    const result = verifyFormToken(token, ISSUED_AT - 1_000);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
