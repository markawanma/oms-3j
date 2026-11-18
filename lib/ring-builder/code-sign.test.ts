import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bitsToChars, checkChar, decodeCode, formatCode, packPayload, TAG_BITS, type CodeFields } from "./code";
import { getCodeSecret, issueCode, verifyCode, verifyCodeFromText } from "./code-sign";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const fields: CodeFields = { designNo: 7, size: 54, positions: [3, 0, 0, 5, 0, 0, 3], totalThb: 720, pricedAtSec: 24_000_000 };
const saved = process.env.RING_BUILDER_CODE_SECRET;

beforeEach(() => {
  process.env.RING_BUILDER_CODE_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.RING_BUILDER_CODE_SECRET;
  else process.env.RING_BUILDER_CODE_SECRET = saved;
});

function issue(f = fields): string {
  const r = issueCode(f);
  if (!r.ok) throw new Error(r.reason);
  return r.code;
}

describe("secret (fail closed)", () => {
  it("ไม่มี / สั้นกว่า 32 / ว่าง ⇒ ไม่เซ็น ไม่ตรวจ", () => {
    for (const v of [undefined, "", "short", "x".repeat(31)]) {
      if (v === undefined) delete process.env.RING_BUILDER_CODE_SECRET;
      else process.env.RING_BUILDER_CODE_SECRET = v;
      expect(getCodeSecret()).toBeNull();
      expect(issueCode(fields)).toEqual({ ok: false, reason: "secret" });
    }
  });
  it("ไม่มี secret: verify = unavailable (ไม่ใช่ valid · ไม่ใช่ not_issued) แม้รูปแบบถูก", () => {
    const code = issue();
    delete process.env.RING_BUILDER_CODE_SECRET;
    expect(verifyCode(code)).toEqual({ status: "unavailable" });
    expect(verifyCodeFromText(`รหัส ${code}`)).toEqual({ status: "unavailable" });
  });
  it("รูปแบบผิดยังบอก bad_format แม้ไม่มี secret (ไม่ปนกับตรวจไม่ได้)", () => {
    delete process.env.RING_BUILDER_CODE_SECRET;
    expect(verifyCode("3JR-AAAAA").status).toBe("bad_format");
  });
  it("secret 32 ตัวพอดีใช้ได้", () => {
    process.env.RING_BUILDER_CODE_SECRET = "k".repeat(32);
    expect(getCodeSecret()).not.toBeNull();
    expect(verifyCode(issue()).status).toBe("valid");
  });
});

describe("issue → verify", () => {
  it("รหัสที่ออกเอง valid · fields ตรง · canonical ตรง", () => {
    const code = issue();
    const v = verifyCode(code);
    expect(v).toEqual({ status: "valid", fields, code });
  });
  it("ผ่านข้อความทั้งก้อน (ตัวพิมพ์เล็ก/ปนข้อความไทย)", () => {
    const code = issue();
    const v = verifyCodeFromText(`สวัสดี ขอสั่งทำ\nรหัสสั่งทำ: ${code.toLowerCase()}\nรบกวนยืนยัน`);
    expect(v.status).toBe("valid");
  });
  it("ข้อความว่าง = empty · ไม่มีรหัส = not_found", () => {
    expect(verifyCodeFromText("")).toEqual({ status: "empty" });
    expect(verifyCodeFromText("  \n ")).toEqual({ status: "empty" });
    expect(verifyCodeFromText("สวัสดี ไม่มีรหัส")).toEqual({ status: "not_found" });
  });
  it("secret คนละตัว ⇒ not_issued (รูปแบบถูกแต่ลายเซ็นไม่ตรง)", () => {
    const code = issue();
    process.env.RING_BUILDER_CODE_SECRET = "another-secret-9876543210-zyxwvutsrqponm";
    expect(verifyCode(code)).toEqual({ status: "not_issued" });
  });
  it("ออกโดย fields ที่ผิดช่วง ⇒ ไม่ออก", () => {
    expect(issueCode({ ...fields, totalThb: 262144 })).toEqual({ ok: false, reason: "fields" });
  });
  it("secret คนละตัว/fields ต่างกัน ⇒ tag ต่าง (ไม่ใช่ค่าคงที่)", () => {
    const a = issue();
    const b = issue({ ...fields, totalThb: 721 });
    expect(a).not.toBe(b);
  });
});

describe("X2: พลิกทีละบิตทุกบิตของ payload/tag (คำนวณ check char ใหม่ให้รูปแบบผ่าน) ⇒ ห้ามได้ valid", () => {
  for (const n of [5, 7]) {
    it(`n=${n}`, () => {
      const f = { ...fields, positions: fields.positions.slice(0, n) };
      const code = issue(f);
      const d = decodeCode(code);
      if (!d.ok) throw new Error();
      const all = d.payloadBits + d.tagBits;
      let notIssued = 0;
      let format = 0;
      for (let b = 0; b < all.length; b++) {
        const bits = all.slice(0, b) + (all[b] === "1" ? "0" : "1") + all.slice(b + 1);
        const body = bitsToChars(bits);
        const forged = formatCode(body + checkChar(body));
        const r = verifyCode(forged);
        expect(r.status, `บิต ${b}`).not.toBe("valid");
        if (r.status === "not_issued") notIssued++;
        else if (r.status === "bad_format") format++;
        else throw new Error(`สถานะที่ไม่คาด: ${r.status}`);
      }
      expect(notIssued + format).toBe(all.length);
      // บิตของ tag ทุกบิตต้องตกที่ HMAC (ไม่ใช่ format)
      expect(notIssued).toBeGreaterThanOrEqual(TAG_BITS);
    });
  }
  it("ver ผิด · ตัด/ต่อท้าย · บิตเติมท้าย · ตัวอักษรนอกชุด ⇒ ไม่ valid", () => {
    const code = issue();
    expect(verifyCode(code.slice(0, -1)).status).not.toBe("valid");
    expect(verifyCode(code + "0").status).not.toBe("valid");
    expect(verifyCode(code.replace(/.$/, "U")).status).toBe("bad_format");
    expect(verifyCode("3JR-" + code.slice(4).replace(/-/g, "").toLowerCase().replace(/^./, "u")).status).not.toBe("valid");
  });
  it("tag ที่ถูกแต่ payload ถูกแก้ราคา ⇒ not_issued (รูปแบบถูกแต่ไม่ได้ออกโดยระบบ)", () => {
    const cheap = packPayload({ ...fields, totalThb: 100 });
    const real = decodeCode(issue());
    if (!cheap.ok || !real.ok) throw new Error();
    const body = bitsToChars(cheap.bits + real.tagBits);
    expect(verifyCode(formatCode(body + checkChar(body)))).toEqual({ status: "not_issued" });
  });
});
