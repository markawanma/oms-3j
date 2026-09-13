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
import { readErrorCode, readErrorMessage } from "./postgrest-error";

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
