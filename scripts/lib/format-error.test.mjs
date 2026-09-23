// scripts/lib/format-error.test.mjs
//
// Unit tests สำหรับ formatError() — pure ล้วน ไม่มี network
//
// เคสที่ต้องกันให้อยู่มีสองฝั่ง ต้องผ่านทั้งคู่:
//   1. ห้ามหลุด — URL/host จาก err.cause ของ fetch, stack, details ของ
//      PostgrestError, ตัว object ดิบ
//   2. ห้ามพัง — ยังต้องอ่านรู้เรื่องว่าเกิดอะไรขึ้น โดยเฉพาะ error แบบ
//      plain object ของ supabase-js ที่ไม่มี .name (ห้ามได้ "undefined: ...")

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { formatError } from "./format-error.mjs";

const FAKE_HOST = "udqmamplbymxnknkjnkz.supabase.co";

describe("formatError — Error instance", () => {
  it("คืน name + message", () => {
    expect(formatError(new TypeError("boom"))).toBe("TypeError: boom");
  });

  it("ไม่พ่วง cause ของ fetch ที่มี host/URL ออกมา", () => {
    // รูปร่างเดียวกับที่ undici โยนจริงตอนต่อ Supabase ไม่ติด
    const err = new TypeError("fetch failed", {
      cause: new Error(`getaddrinfo ENOTFOUND ${FAKE_HOST}`),
    });

    const out = formatError(err);
    expect(out).toBe("TypeError: fetch failed");
    expect(out).not.toContain(FAKE_HOST);

    // ยืนยันว่าช่องโหว่เดิมมีจริง: console.error(err) เรียก util.inspect
    // ซึ่งพ่วง cause chain ออกมาทั้งหมด ถ้า assert นี้พังแปลว่า Node
    // เปลี่ยนพฤติกรรม ให้ไปทบทวนเหตุผลที่หัว format-error.mjs ใหม่
    expect(inspect(err)).toContain(FAKE_HOST);
  });

  it("ไม่พ่วง stack ออกมา", () => {
    const err = new Error("something broke");
    expect(formatError(err)).not.toContain("at ");
    expect(formatError(err)).not.toContain(".mjs");
  });
});

describe("formatError — plain object (supabase-js ไม่คืน Error จริง)", () => {
  it("ได้ code + message ไม่ใช่ 'undefined: ...'", () => {
    const postgrestError = {
      message: 'duplicate key value violates unique constraint "stg_import_batch_file_hash_key"',
      details: "Key (file_hash)=(a1b2c3) already exists.",
      hint: null,
      code: "23505",
    };

    const out = formatError(postgrestError);
    expect(out).toBe(`23505: ${postgrestError.message}`);
    expect(out).not.toContain("undefined");
    // details เป็น free-form (บางทีมีค่าของแถวที่ชนกัน) — ไม่เอาออก log
    expect(out).not.toContain("a1b2c3");
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

  it("object ที่ไม่มี prototype ก็ไม่พัง", () => {
    expect(() => formatError(Object.create(null))).not.toThrow();
  });
});

describe("formatError — primitive ที่ถูก throw", () => {
  it.each([
    ["string", "boom", "boom"],
    ["number", 42, "42"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
  ])("%s", (_label, input, expected) => {
    expect(formatError(input)).toBe(expected);
  });
});
