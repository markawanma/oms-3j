// lib/auth/exempt-path.tools.test.ts — เคส /tools (hub) ของ matcher จริงของ Next เทียบกับ mirror (exempt-path.ts)
// แยกไฟล์ใหม่เพื่อให้ exempt-path.*.test.ts เดิม diff 0 (design-tools-hub N6)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { isExemptPath } from "./exempt-path";

const getMiddlewareMatchers = (
  pageStaticInfo as unknown as {
    getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string }>;
  }
).getMiddlewareMatchers;

function realMatcherSource(): string {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"/.exec(mw);
  if (!m) throw new Error("ไม่พบ config.matcher ใน middleware.ts");
  return JSON.parse(`"${m[1]}"`) as string;
}
function middlewareRuns(pathname: string): boolean {
  const [m] = getMiddlewareMatchers(realMatcherSource(), {} as never);
  return new RegExp(m.regexp).test(pathname);
}

describe("/tools (hub) — exempt แบบ exact เท่านั้น", () => {
  it.each(["/tools", "/tools/"])("%s ไม่ผ่าน middleware (exempt) ทั้ง matcher จริงและ mirror", (p) => {
    expect(middlewareRuns(p)).toBe(false);
    expect(isExemptPath(p)).toBe(true);
  });

  it.each([
    "/toolsx", "/tools/x", "/tools-admin", "/TOOLS", "/Tools", "/tools/..%2fdashboard", "/tools/../dashboard", "/tools//", "/x/tools",
    "/tool", "/tools.png/x", "/tools%2f", "/api/tools", "/tools/x/y",
  ])("look-alike %s ต้องถูก gate (middleware รัน) และ mirror ตรงกัน", (p) => {
    expect(middlewareRuns(p), `${p} matcher`).toBe(true);
    expect(isExemptPath(p), `${p} mirror`).toBe(false);
  });

  it("negative control: matcher หลวม tools(?:/|$) จะปล่อย /tools/x หลุด — test นี้จับได้", () => {
    const loose = realMatcherSource().replace("tools/?$", "tools(?:/|$)");
    const [m] = getMiddlewareMatchers(loose, {} as never);
    expect(new RegExp(m.regexp).test("/tools/x")).toBe(false);
    expect(isExemptPath("/tools/x")).toBe(false);
  });
});
