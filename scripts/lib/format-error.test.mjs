// scripts/lib/format-error.test.mjs
//
// Unit tests สำหรับ formatError() — pure ล้วน ไม่มี network
//
// เคสที่ต้องกันให้อยู่มีสองฝั่ง ต้องผ่านทั้งคู่:
//   1. ห้ามหลุด — URL/host จาก err.cause, stack, details ของ PostgrestError
//      (ซึ่งพ่วง cause+stack และ DETAIL ของ Postgres = แถวลูกค้า), object ดิบ,
//      ซอร์สโค้ดของฟังก์ชันที่ถูกโยน
//   2. ห้ามพัง — ยังต้องอ่านรู้เรื่องว่าเกิดอะไรขึ้น โดยเฉพาะ error แบบ plain
//      object ของ supabase-js ที่ไม่มี .name (ห้ามได้ "undefined: ...")
//      และ formatError เองห้าม throw เด็ดขาด — มันถูกเรียกใน catch handler
//      ถ้ามัน throw ข้อความจริงจะหายทั้งบรรทัด

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { formatError } from "./format-error.mjs";

const FAKE_HOST = "udqmamplbymxnknkjnkz.supabase.co";

describe("formatError — Error instance", () => {
  it("คืน name + message", () => {
    expect(formatError(new TypeError("boom"))).toBe("TypeError: boom");
  });

  it("ไม่พ่วง cause.message ที่มี host แต่เอา cause.code มาบอกสาเหตุได้", () => {
    // รูปร่างเดียวกับที่ undici โยนจริงตอนต่อ Supabase ไม่ติด
    const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${FAKE_HOST}`), { code: "ENOTFOUND" });
    const err = new TypeError("fetch failed", { cause });

    const out = formatError(err);
    expect(out).toBe("TypeError: fetch failed (cause ENOTFOUND)");
    expect(out).not.toContain(FAKE_HOST);

    // ยืนยันว่าช่องโหว่เดิมมีจริง: console.error(err) เรียก util.inspect
    // ซึ่งพ่วง cause chain ออกมาทั้งหมด ถ้า assert นี้พังแปลว่า Node
    // เปลี่ยนพฤติกรรม ให้ไปทบทวนเหตุผลที่หัว format-error.mjs ใหม่
    expect(inspect(err)).toContain(FAKE_HOST);
  });

  it("ไม่พ่วง stack ออกมา", () => {
    const out = formatError(new Error("something broke"));
    expect(out).not.toContain("at ");
    expect(out).not.toContain(".mjs");
  });

  it("SystemError ของ Node ไม่ขึ้นต้นซ้ำ (ENOENT: ENOENT: ...)", () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open 'aug.xlsx'"), {
      code: "ENOENT",
    });
    expect(formatError(err)).toBe("ENOENT: no such file or directory, open 'aug.xlsx'");
  });

  it("error ที่ extends Error แต่มี code ต้องไม่กิน code หาย", () => {
    // PostgrestError ของ supabase-js extends Error จริง — จะโดนเมื่อมีคนเติม
    // .throwOnError() วันหน้า เช็ค instanceof ก่อน code จะทำ SQLSTATE หาย
    class PostgrestError extends Error {
      constructor({ message, details, code }) {
        super(message);
        this.name = "PostgrestError";
        this.details = details;
        this.code = code;
      }
    }
    const out = formatError(
      new PostgrestError({
        message: "permission denied for schema analytics",
        details: "Failing row contains (1, สมชาย, 0812345678)",
        code: "42501",
      }),
    );
    expect(out).toBe("42501: permission denied for schema analytics");
    expect(out).not.toContain("0812345678");
  });
});

describe("formatError — plain object (supabase-js ไม่คืน Error จริง)", () => {
  it("ได้ code + message ไม่ใช่ 'undefined: ...' และไม่มี details", () => {
    const postgrestError = {
      message: 'duplicate key value violates unique constraint "stg_import_batch_file_hash_key"',
      details: "Key (file_hash)=(a1b2c3) already exists.",
      hint: null,
      code: "23505",
    };

    const out = formatError(postgrestError);
    expect(out).toBe(`23505: ${postgrestError.message}`);
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("a1b2c3");
  });

  it("details ที่พ่วง cause+stack ของ fetch ต้องไม่หลุด (postgrest-js 2.112.3)", () => {
    // รูปร่างจริงจาก dist/index.cjs:398-410 — cause ไม่ได้ถูกทิ้ง มันย้ายมาอยู่ใน details
    const out = formatError({
      message: "TypeError: fetch failed",
      details: `TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND ${FAKE_HOST} (ENOTFOUND)\n    at GetAddrInfoReqWrap.onlookup (node:dns:118:26)`,
      hint: "",
      code: "",
    });
    expect(out).toBe("TypeError: fetch failed");
    expect(out).not.toContain(FAKE_HOST);
    expect(out).not.toContain("at GetAddrInfoReqWrap");
  });

  it("เอา hint มาด้วย (Postgres สร้างเอง ไม่เคยมีค่าของแถว) แต่ยังไม่เอา details", () => {
    const out = formatError({
      message: "permission denied for schema analytics",
      details: "Failing row contains (1, สมชาย, 0812345678)",
      hint: "GRANT usage on schema analytics to service_role",
      code: "42501",
    });
    expect(out).toBe(
      "42501: permission denied for schema analytics · hint: GRANT usage on schema analytics to service_role",
    );
    expect(out).not.toContain("0812345678");
  });

  it("มีแต่ message (ไม่มี code) ก็ยังอ่านได้", () => {
    expect(formatError({ message: "row not found", code: "" })).toBe("row not found");
  });

  it("มีแต่ code", () => {
    expect(formatError({ code: "PGRST301" })).toBe("error code PGRST301");
  });

  it("ไม่มีทั้ง message และ code — บอกแค่ชนิด ห้าม dump object", () => {
    const out = formatError({ url: `https://${FAKE_HOST}/rest/v1/fact_order`, token: "sb-secret" });
    expect(out).not.toContain(FAKE_HOST);
    expect(out).not.toContain("sb-secret");
    expect(out).toContain("Object");
  });

  it("class นิรนาม (constructor.name === '') ยังได้ชื่อชนิด ไม่ใช่ค่าว่าง", () => {
    // `??` จะปล่อย "" ผ่าน ต้องเป็น `||` เท่านั้น
    expect(formatError(new (class {})())).toBe("(error object ไม่มี message/code — ชนิด Object)");
  });

  it("object ที่ไม่มี prototype ก็ไม่พัง", () => {
    expect(() => formatError(Object.create(null))).not.toThrow();
  });
});

describe("formatError — message เป็นช่องที่ไม่ได้คุม ต้อง redact + ยุบบรรทัด", () => {
  it("Playwright ฝัง call log หลายบรรทัด + URL ไว้ใน message เอง (ไม่ผ่าน cause)", () => {
    const out = formatError(
      new Error(
        'page.goto: Timeout 60000ms exceeded.\nCall log:\n  - navigating to "https://www.3jthailand.com/silver-price", waiting until "load"',
      ),
    );
    expect(out).not.toContain("\n");
    expect(out).not.toContain("3jthailand");
    expect(out).toContain("<url>");
  });

  it("postgrest ยัด body ดิบของ gateway ลง message — ตัด host ก่อนค่อยตัดความยาว", () => {
    const out = formatError({
      message: `<html>Error 502 <b>${FAKE_HOST}</b>${"x".repeat(2000)}</html>`,
    });
    // redact ต้องทำงานบนข้อความเต็มก่อน clamp ไม่งั้น host ที่อยู่ต้นสตริงรอด
    expect(out).not.toContain(FAKE_HOST);
    expect(out).toContain("<supabase-host>");
    expect(out.length).toBeLessThan(400);
  });

  it("ผลลัพธ์เป็นบรรทัดเดียวเสมอ", () => {
    expect(formatError({ message: "a\nb\r\nc", code: "X" })).toBe("X: a b c");
  });
});

describe("formatError — ห้าม throw ออกจาก catch handler", () => {
  it.each([
    ["getter message throw", { get message() { throw new Error("boom"); } }],
    ["getter code throw", { get code() { throw new Error("boom"); } }],
    ["getter constructor throw", { get constructor() { throw new Error("boom"); } }],
    ["getter cause throw", { get cause() { throw new Error("boom"); } }],
    ["Proxy get trap throw", new Proxy({}, { get() { throw new Error("boom"); } })],
    ["Proxy getPrototypeOf throw", new Proxy({}, { getPrototypeOf() { throw new Error("boom"); } })],
    ["name เป็น Symbol", Object.assign(new Error("m"), { name: Symbol("S") })],
  ])("%s", (_label, evil) => {
    expect(() => formatError(evil)).not.toThrow();
    expect(typeof formatError(evil)).toBe("string");
  });
});

describe("formatError — เคสที่จงใจไม่รองรับ (ล็อกไว้ไม่ให้คนหลังคิดว่าบังเอิญ)", () => {
  it("code ที่เป็นตัวเลขไม่ถูกใช้ — ตรงกับ readErrorCode ใน lib/supabase/postgrest-error.ts", () => {
    expect(formatError({ message: "boom", code: 23505 })).toBe("boom");
  });

  it("message ที่ไม่ใช่ string ตกไปใช้ code ไม่ใช่ '[object Object]'", () => {
    const out = formatError({ message: { th: "พัง" }, code: "42501" });
    expect(out).toBe("error code 42501");
    expect(out).not.toContain("[object Object]");
  });

  it("โยนฟังก์ชันไม่พิมพ์ซอร์สโค้ดทั้งก้อน", () => {
    const out = formatError(function secretFn() {
      const KEY = "sb-service-role-supersecret";
      return KEY;
    });
    expect(out).not.toContain("supersecret");
    expect(out).toContain("secretFn");
  });
});

describe("formatError — primitive ที่ถูก throw", () => {
  it.each([
    ["string", "boom", "boom"],
    ["number", 42, "42"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["symbol", Symbol("S"), "Symbol(S)"],
  ])("%s", (_label, input, expected) => {
    expect(formatError(input)).toBe(expected);
  });
});
