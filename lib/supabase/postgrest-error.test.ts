// lib/supabase/postgrest-error.test.ts
//
// Unit tests for readErrorMessage/readErrorCode (lib/supabase/postgrest-error.ts).
// Pure in-memory tests — no disk I/O, no DB — same style as
// lib/import/order-diff.test.ts.
//
// Context: postgrest-js returns `{ code, message, details, hint }` as a
// PLAIN object (not an Error instance) unless `.throwOnError()` is chained.
// These tests pin down the "read structurally, never via instanceof"
// contract for every shape a catch block might actually see.

import { describe, expect, it } from "vitest";
import { readErrorCode, readErrorMessage, redactUrls } from "./postgrest-error";

describe("readErrorMessage", () => {
  it("reads message off a plain PostgREST-shaped error object", () => {
    expect(readErrorMessage({ code: "P0001", message: "x" })).toBe("x");
  });

  it("reads message off a real Error instance", () => {
    expect(readErrorMessage(new Error("y"))).toBe("y");
  });

  it("returns '' for null", () => {
    expect(readErrorMessage(null)).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(readErrorMessage(undefined)).toBe("");
  });

  it("returns '' for a bare string (not a container object)", () => {
    expect(readErrorMessage("boom")).toBe("");
  });

  it("returns '' for a number", () => {
    expect(readErrorMessage(42)).toBe("");
  });

  it("returns '' when message is present but not a string", () => {
    expect(readErrorMessage({ message: 123 })).toBe("");
  });

  it("returns '' when message is present but not a string, even on a real Error instance (code-reviewer nit: instanceof shortcut used to skip this check)", () => {
    const err = Object.assign(new Error("x"), { message: 123 });
    expect(readErrorMessage(err)).toBe("");
  });

  it("returns '' for an empty object", () => {
    expect(readErrorMessage({})).toBe("");
  });
});

describe("readErrorCode", () => {
  it("reads code off a plain PostgREST-shaped error object", () => {
    expect(readErrorCode({ code: "22023" })).toBe("22023");
  });

  it("reads code off an Error that had code assigned onto it (throwOnError path)", () => {
    const err = Object.assign(new Error("m"), { code: "22023" });
    expect(readErrorCode(err)).toBe("22023");
  });

  it("returns undefined for null", () => {
    expect(readErrorCode(null)).toBeUndefined();
  });

  it("returns undefined when code is present but not a string", () => {
    expect(readErrorCode({ code: 22023 })).toBeUndefined();
  });

  it("returns undefined for a bare string (not a container object)", () => {
    expect(readErrorCode("str")).toBeUndefined();
  });
});

// Low fix (security รอบ 3, 27 ก.ย. 69): redactUrls had zero test coverage
// despite living right next to readErrorMessage/readErrorCode in this same
// file's test suite — this is the module content.ts's M1 fix relies on to
// keep a caller-supplied URL (which can carry another platform's
// tracking/session query params, see redactUrls's own header comment) out
// of logs.
describe("redactUrls", () => {
  it("masks a single scheme://... URL down to a fixed placeholder", () => {
    expect(redactUrls("content_post_upsert: ได้รับ: https://example.com/x?utm=1")).toBe(
      "content_post_upsert: ได้รับ: <url>"
    );
  });

  it("masks multiple URLs on the same line, each one independently", () => {
    const input = "เดิม https://a.example.com/1?x=1 ใหม่ https://b.example.com/2?y=2 ไม่ตรงกัน";
    expect(redactUrls(input)).toBe("เดิม <url> ใหม่ <url> ไม่ตรงกัน");
  });

  it("masks a non-http(s) scheme too (the regex isn't hardcoded to http/https)", () => {
    expect(redactUrls("ftp://files.example.com/secret.csv")).toBe("<url>");
  });

  it("a bare domain with no scheme is NOT masked (real behavior — the regex requires '://')", () => {
    // This documents an actual gap, not an aspiration: a raw message like
    // "ได้รับ: example.com/x?utm=1" (no scheme) passes through untouched.
    // Every post_url this app ever stores is validated to start with
    // http(s):// before it reaches storage (upsertContentPost's own check),
    // so a scheme-less URL shouldn't occur in practice for THIS caller —
    // but the function itself provides no guarantee for arbitrary input.
    expect(redactUrls("ได้รับ: example.com/x?utm=1")).toBe("ได้รับ: example.com/x?utm=1");
  });

  it("plain text with a colon but no '://' is NOT masked (e.g. a time or a label)", () => {
    expect(redactUrls("เวลา 20:00 น. status: failed")).toBe("เวลา 20:00 น. status: failed");
  });

  it("text with no URL-shaped substring at all passes through unchanged", () => {
    expect(redactUrls("บันทึกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง")).toBe("บันทึกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  });

  it("empty string stays empty", () => {
    expect(redactUrls("")).toBe("");
  });
});
