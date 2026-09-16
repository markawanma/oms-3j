// lib/auth/sanitize-next.test.ts — pure function, no mocking needed.
import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, sanitizeNextParam } from "./sanitize-next";

describe("sanitizeNextParam — must reject (open-redirect payloads)", () => {
  it("protocol-relative URL (//evil.com) falls back to DEFAULT_NEXT", () => {
    expect(sanitizeNextParam("//evil.com")).toBe(DEFAULT_NEXT);
  });

  it("absolute URL with scheme (http://evil.com) falls back to DEFAULT_NEXT", () => {
    expect(sanitizeNextParam("http://evil.com")).toBe(DEFAULT_NEXT);
  });

  it("https scheme falls back to DEFAULT_NEXT", () => {
    expect(sanitizeNextParam("https://evil.com/steal")).toBe(DEFAULT_NEXT);
  });

  it("backslash-leading variant some browsers normalize to // falls back", () => {
    expect(sanitizeNextParam("/\\evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextParam("\\\\evil.com")).toBe(DEFAULT_NEXT);
  });

  it("javascript: scheme falls back (doesn't start with /)", () => {
    expect(sanitizeNextParam("javascript:alert(1)")).toBe(DEFAULT_NEXT);
  });

  it("null/undefined/empty fall back", () => {
    expect(sanitizeNextParam(null)).toBe(DEFAULT_NEXT);
    expect(sanitizeNextParam(undefined)).toBe(DEFAULT_NEXT);
    expect(sanitizeNextParam("")).toBe(DEFAULT_NEXT);
  });

  it("bare path with no leading slash falls back", () => {
    expect(sanitizeNextParam("dashboard")).toBe(DEFAULT_NEXT);
  });
});

describe("sanitizeNextParam — must NOT break real same-origin targets", () => {
  it("simple path passes through unchanged", () => {
    expect(sanitizeNextParam("/crm/customers")).toBe("/crm/customers");
  });

  it("path with query string passes through unchanged", () => {
    expect(sanitizeNextParam("/oem/quotes?status=draft&page=2")).toBe("/oem/quotes?status=draft&page=2");
  });

  it("root path passes through unchanged", () => {
    expect(sanitizeNextParam("/")).toBe("/");
  });

  it("single-slash path with a colon later in the string still passes (not a scheme prefix)", () => {
    // e.g. a page that legitimately has ":" in a query value — must not be
    // over-blocked just because it contains a colon somewhere.
    expect(sanitizeNextParam("/crm/customers?note=call%20at%2010:30")).toBe(
      "/crm/customers?note=call%20at%2010:30"
    );
  });
});
