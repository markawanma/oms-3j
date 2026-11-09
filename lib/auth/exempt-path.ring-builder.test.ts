// lib/auth/exempt-path.ring-builder.test.ts — exempt path ของ Ring Builder (10 พ.ย. 69): exact เท่านั้น
// เทียบทั้ง mirror (isExemptPath) และ matcher จริงของ middleware.ts (คอมไพล์ด้วย getMiddlewareMatchers ของ Next) ทีละ path — ล้มถ้าแก้ไฟล์เดียวแล้วลืมอีกไฟล์
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { isExemptPath } from "./exempt-path";

const getMiddlewareMatchers = (
  pageStaticInfo as unknown as { getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string }> }
).getMiddlewareMatchers;

function middlewareRuns(pathname: string): boolean {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"\s*,?\s*\]/.exec(mw);
  if (!m) throw new Error("ไม่พบ config.matcher");
  const matchers = getMiddlewareMatchers(JSON.parse(`"${m[1]}"`) as string, {} as never);
  return new RegExp(matchers[0].regexp).test(pathname);
}

const MUST_PASS = ["/ring-builder", "/ring-builder/", "/api/ring-builder/quote", "/api/ring-builder/quote/"];

const MUST_NOT = [
  "/ring-builders", "/ring-builder-admin", "/ring-builder/x", "/ring-builder/x/y", "/ring-builder//", "/ring-builder/..", "/ring-builder/../oem",
  "/ring-builder%2fx", "/ring-builder ", "/RING-BUILDER", "/Ring-Builder", "/x/ring-builder", "/oem/ring-builder", "/catalog/ring-builder",
  "/api/ring-builder", "/api/ring-builder/", "/api/ring-builder/x", "/api/ring-builder/quotes", "/api/ring-builder/quote-x", "/api/ring-builder/quotex",
  "/api/ring-builder/Quote", "/api/ring-builder/QUOTE", "/api/RING-BUILDER/quote", "/api/ring-builders/quote", "/api/ring-builder-x/quote",
  "/api/ring-builder/quote/x", "/api/ring-builder/quote/x/y", "/api/ring-builder/quote//", "/api/ring-builder//quote", "/api/ring-builder/quote%2F",
  "/api/ring-builder/quote/..", "/api/ring-builder/quote/../../oem", "/api/ring-builder/quote ", "/x/api/ring-builder/quote",
  "/ring-builder/api/ring-builder/quote", "/api/ring-builder/admin", "/api/ring-builder/code-check",
  // รูปใต้ ring-builder ไม่มีกฎ asset (รูปการ์ดอยู่ Storage) — ต้องถูก gate
  "/ring-builder/x.png", "/ring-builder/og.png", "/api/ring-builder/quote.png",
];

describe("ring-builder exempt path — must pass (exact เท่านั้น)", () => {
  it.each(MUST_PASS)("%s — mirror และ matcher จริงตรงกัน (exempt)", (p) => {
    expect(isExemptPath(p)).toBe(true);
    expect(middlewareRuns(p)).toBe(false);
  });
});

describe("ring-builder exempt path — must NOT (look-alike/subtree/traversal ต้องถูก gate)", () => {
  it.each(MUST_NOT)("%s — mirror และ matcher จริงตรงกัน (gated)", (p) => {
    expect(isExemptPath(p)).toBe(false);
    expect(middlewareRuns(p)).toBe(true);
  });
});

describe("ของเดิมไม่พัง (differential: เพิ่มอย่างเดียว)", () => {
  it.each(["/ring-size", "/ring-size/", "/api/ring-size/event", "/gem-quiz", "/api/gem-quiz/submit", "/shop", "/stock/hero", "/ring-size/og.png"])("%s ยัง exempt", (p) => {
    expect(isExemptPath(p)).toBe(true);
    expect(middlewareRuns(p)).toBe(false);
  });
  it.each(["/ring-sizes", "/api/ring-size", "/api/ring-size/event/x", "/dashboard", "/catalog", "/"])("%s ยัง gated", (p) => {
    expect(isExemptPath(p)).toBe(false);
    expect(middlewareRuns(p)).toBe(true);
  });
});
