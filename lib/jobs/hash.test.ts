import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, ipHashOrNull, sessionHashOrNull, sha256Hex, tokenHashOrNull } from "./hash";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

describe("sha256Hex — ตรงกับสัญญา 0172 (sha256 hex พิมพ์เล็ก 64 ตัวของ UTF-8 ตรงๆ)", () => {
  it("ค่าอ้างอิงมาตรฐาน", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("token จริง → 64 ตัว hex พิมพ์เล็ก และตรงกับ node:crypto", () => {
    const h = sha256Hex(TOKEN);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash("sha256").update(TOKEN).digest("hex"));
  });
  it("UTF-8 ไม่ใช่ latin1 (ภาษาไทย)", () => {
    expect(sha256Hex("ก")).toBe(createHash("sha256").update(Buffer.from("ก", "utf8")).digest("hex"));
  });
});

describe("tokenHashOrNull / sessionHashOrNull", () => {
  it("token รูปแบบถูก → hash · ไม่ส่งค่าดิบไปไหน", () => {
    expect(tokenHashOrNull(TOKEN)).toBe(sha256Hex(TOKEN));
    expect(sessionHashOrNull(TOKEN)).toBe(sha256Hex(TOKEN));
  });
  it("ห้ามผ่านรูปแบบ: ว่าง · สั้น · ยาวเกิน · อักขระต้องห้าม · เลขงาน · ไม่ใช่ string", () => {
    for (const bad of ["", "abc", "x".repeat(65), "has space aaaaaaaaaaaaaaaa", "../etc/passwd/aaaaaaaa", "JB-0001", "a".repeat(20) + "%", null, undefined, 123, {}, []]) {
      expect(tokenHashOrNull(bad), String(bad)).toBeNull();
      expect(sessionHashOrNull(bad), String(bad)).toBeNull();
    }
  });
  it("hash ของ token ที่ถูกพิมพ์ใหม่ (อ่านผิดเป็นตัวพิมพ์เล็ก) ต่างจากของจริง — ไม่ normalize ตัวพิมพ์", () => {
    expect(tokenHashOrNull(TOKEN.toLowerCase())).not.toBe(tokenHashOrNull(TOKEN));
  });
});

describe("ipHashOrNull / clientIpFromHeaders", () => {
  it("IP → sha256 (ไม่เก็บ ip ดิบ) · ว่าง → null", () => {
    expect(ipHashOrNull("203.0.113.9")).toBe(sha256Hex("203.0.113.9"));
    expect(ipHashOrNull(" ")).toBeNull();
    expect(ipHashOrNull(null)).toBeNull();
  });
  it("ใช้ IP แรกของ x-forwarded-for · fallback x-real-ip · ยาวเกิน/ว่าง = null", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "x".repeat(100) }))).toBeNull();
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });
});
