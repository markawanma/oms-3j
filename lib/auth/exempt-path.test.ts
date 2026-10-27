// lib/auth/exempt-path.test.ts — proves middleware.ts's config.matcher
// anchoring (H3, security review 2026-09-16) via its pure mirror,
// lib/auth/exempt-path.ts. The last describe block (25 ต.ค. 69) ALSO compiles
// middleware.ts's real matcher literal with Next's own compiler and checks
// both agree on every case — so drift between the two files fails here.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// getMiddlewareMatchers มีที่ runtime (ตัวที่ `next build` ใช้คอมไพล์ matcher) แต่ไม่อยู่ใน .d.ts → cast; ถ้า Next เวอร์ชันหน้าย้าย/ลบ เทสต์นี้จะล้มดัง ๆ ให้มาแก้
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { isExemptPath } from "./exempt-path";

const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (matcher: string[], config: { basePath: string; i18n: undefined }) => { regexp: string }[];
};

describe("isExemptPath — must NOT exempt (prefix look-alikes)", () => {
  it.each([
    ["/shopee-import", "starts with 'shop' but is not /shop or /shop/..."],
    ["/shopping-cart", "same 'shop' prefix trap"],
    ["/stock/heroes", "starts with 'stock/hero' but is a different route"],
    ["/stock/heroic-sales", "same 'stock/hero' prefix trap"],
    ["/api/webhooksx", "starts with 'api/webhooks' but is a different route"],
    ["/api/webhooks-legacy", "same 'api/webhooks' prefix trap"],
    ["/gem-quizzes", "starts with 'gem-quiz' but is a different route (R-10)"],
    ["/gem-quiz-admin", "same 'gem-quiz' prefix trap (R-10)"],
    ["/gem-quiz/admin", "subtree under /gem-quiz, not the exact page (M3)"],
    ["/api/gem-quiz-x", "starts with 'api/gem-quiz' but is a different route (R-10)"],
    ["/api/gem-quizzes", "same 'api/gem-quiz' prefix trap (R-10)"],
    ["/api/gem-quiz", "only /submit under this prefix is exempt, not the bare prefix (M3)"],
    ["/api/gem-quiz/stats", "a future route under this prefix must earn its own exemption (M3)"],
    ["/api/gem-quiz/submit/extra", "subtree under /submit, not the exact endpoint (M3)"],
    ["/GEM-QUIZ", "matching is case-sensitive: an upper-case look-alike is not exempt (same rule as /RING-SIZE)"],
    // ring-size (public ring-size measuring tool, 24 ต.ค. 69) — exact page only, same anchoring as gem-quiz
    ["/ring-sizes", "starts with 'ring-size' but is a different route (R-10)"],
    ["/ring-size-admin", "same 'ring-size' prefix trap (R-10)"],
    ["/ring-size/x", "subtree under /ring-size, not the exact page (M3)"],
    ["/ring-size/x/y", "deeper subtree (M3)"],
    ["/ring-size//", "double slash"],
    ["/api/ring-size-x", "starts with 'api/ring-size' but is a different route (R-10)"],
    ["/api/ring-size", "ring-size has no API — nothing under /api/ring-size is exempt"],
    ["/api/ring-size/track", "a future route must earn its own exemption (M3)"],
    ["/RING-SIZE", "case-sensitive: upper-case is not exempt (same as gem-quiz)"],
    ["/Ring-Size", "case-sensitive: mixed-case is not exempt"],
    ["/ring-size%2F..", "encoded slash + traversal tail"],
    ["/ring-size%2fx", "encoded slash"],
    ["/ring-size/..", "traversal"],
    ["/ring-size/../oem", "traversal into a gated page"],
    ["/ring-size?x=1", "query glued into the path (pathname never carries it — guarded anyway)"],
    ["/ring-size ", "trailing space"],
    ["/x/ring-size", "nested under another page"],
    ["/oem/ring-size", "nested under a gated page"],
  ])("%s (%s)", (path) => {
    expect(isExemptPath(path)).toBe(false);
  });
});

describe("isExemptPath — must exempt (the real routes + their subpaths)", () => {
  it.each([
    "/shop",
    "/shop/some-product-slug",
    "/stock/hero",
    "/stock/hero/",
    "/api/webhooks/tiktok",
    "/api/webhooks/shopee",
    "/gem-quiz",
    "/gem-quiz/",
    "/api/gem-quiz/submit",
    "/ring-size",
    "/ring-size/",
    "/ring-size/3j-mark.png", // static asset of the page (exempt by the ring-size/<file> asset rule, one level only)
    "/_next/static/chunk.js",
    "/_next/image?url=x",
    "/favicon.ico",
  ])("%s", (path) => {
    expect(isExemptPath(path)).toBe(true);
  });
});

// ไฟล์ที่มีจริงใน public/ ต้องไม่พัง (logo ใช้ในหน้า login/print/QR poster · og.png ใช้ใน metadata ของหน้า quiz สาธารณะ)
describe("isExemptPath — public/ assets ที่มีจริง ต้องยัง exempt (ห้ามพัง)", () => {
  it.each(["/3j-logo.svg", "/3j-logo.png", "/gem-quiz/og.png", "/favicon.ico", "/root-file.png", "/a.webp", "/a.gif", "/a.jpeg"])(
    "%s",
    (path) => {
      expect(isExemptPath(path)).toBe(true);
    },
  );
});

// 25 ต.ค. 69 — extension-gate bypass: เดิม `.*\.(svg|png|...)$` ยอมนามสกุลที่ความลึกใดก็ได้ → dynamic route ของแอปหลุด gate
describe("isExemptPath — นามสกุลรูปใต้ route จริง ต้อง gate (extension-gate bypass)", () => {
  it.each([
    ["/live/x.png", "live/[id] — ช่องที่ยืนยันบน production"],
    ["/orders/x.png", "orders/[id]"],
    ["/crm/customers/x.png", "crm/customers/[id]"],
    ["/oem/quotes/x.svg", "oem/quotes/[id]"],
    ["/oem/invoices/x.png", "oem/invoices/[id]"],
    ["/oem/receipts/x.png", "oem/receipts/[id]"],
    ["/production/x.jpg", "production/[id]"],
    ["/jobs/x.webp", "jobs/[id]"],
    ["/marketing/pieces/x.ico", "marketing/pieces/[stepId]"],
    ["/marketing/calendar/x.gif", "marketing/calendar/[stepId]"],
    ["/marketing/content/history/x.jpeg", "marketing/content/history/[postId]"],
    ["/images/logo.png", "ไม่มีโฟลเดอร์ images ใน public/ — เดิมเคย exempt (ถอดออกโดยตั้งใจ)"],
    ["/some/deep/path/photo.jpg", "ลึกหลายชั้น — เดิมเคย exempt (ถอดออกโดยตั้งใจ)"],
    ["/gem-quiz/deep/x.png", "ลึกกว่า gem-quiz/<ไฟล์> หนึ่งชั้น"],
    ["/gem-quiz/a/b/c.png", "ลึกหลายชั้นใต้ gem-quiz"],
    ["/shopee-import/x.png", "look-alike ของ /shop — ต้องไม่ติดสิทธิ์ของ /shop(?:/|$)"],
    ["/w/s/abc/x.png", "ลึกกว่า QR ร้าน"],
    ["/w/abc/x.png", "ลึกกว่าหน้าช่าง"],
    ["/dashboard/x.png", "ใต้ route ทั่วไป"],
    ["/stock/x.png", "stock ที่ไม่ใช่ /stock/hero"],
    ["/api/foo/x.png", "api ที่ไม่ใช่ webhooks/gem-quiz submit"],
    ["/settings/members/x.png", "ใต้หน้าเจ้าของ"],
    ["//orders/x.png", "slash ซ้อนนำหน้า"],
    ["/live//x.png", "slash ซ้อนกลางทาง"],
    ["/gem-quiz/og.png.exe", "นามสกุลไม่ใช่รูป"],
    ["/gem-quiz/og.pngx", "นามสกุลเกินตัว"],
    ["/gem-quiz/og.gif", "gif ไม่อยู่ในชุดของ gem-quiz/ (มีแค่ svg|png|jpg|jpeg|webp)"],
    ["/gem-quiz/og.ico", "ico ไม่อยู่ในชุดของ gem-quiz/"],
  ])("%s (%s)", (path) => {
    expect(isExemptPath(path)).toBe(false);
  });
});

describe("isExemptPath — ordinary gated pages, unaffected either way", () => {
  it.each(["/dashboard", "/catalog", "/settings/members", "/login", "/register", "/pending", "/"])(
    "%s is not exempt",
    (path) => {
      expect(isExemptPath(path)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// matcher จริงของ middleware.ts ต้องตอบเหมือน isExemptPath ทุกเคส
// ดึง literal ออกจากซอร์ส middleware.ts แล้วคอมไพล์ด้วยตัวคอมไพเลอร์ matcher ของ Next เอง
// (getMiddlewareMatchers — ตัวเดียวกับที่ `next build` ใช้) ไม่ใช่ new RegExp เดา ๆ
// → ถ้าแก้ไฟล์เดียวแล้วลืมอีกไฟล์ เทสต์นี้ล้ม
// ---------------------------------------------------------------------------
describe("middleware.ts matcher (คอมไพล์ด้วย Next) ตรงกับ isExemptPath ทุกเคส", () => {
  const src = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const literal = /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/.exec(src)?.[1];
  const compiled = (() => {
    if (!literal) return null;
    const [m] = getMiddlewareMatchers([JSON.parse(literal) as string], { basePath: "", i18n: undefined });
    return new RegExp(m.regexp);
  })();
  /** true = middleware ทำงาน (gated) · false = ข้าม (exempt) */
  const middlewareRuns = (p: string) => compiled!.test(p);

  const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
  const EXEMPT = [
    "/3j-logo.svg", "/3j-logo.png", "/gem-quiz/og.png", "/favicon.ico",
    "/_next/static/chunk.js", "/_next/image",
    "/shop", "/shop/some-product-slug", "/stock/hero", "/stock/hero/",
    "/api/webhooks/tiktok", "/api/webhooks/shopee",
    "/gem-quiz", "/gem-quiz/", "/api/gem-quiz/submit",
    `/w/${TOKEN}`, `/w/${TOKEN}/`, `/w/s/${TOKEN}`, `/w/s/${TOKEN}/`,
  ];
  const GATED = [
    "/live/x.png", "/orders/x.png", "/crm/customers/x.png", "/oem/quotes/x.svg", "/production/x.jpg",
    "/jobs/x.webp", "/marketing/pieces/x.ico", "/images/logo.png", "/some/deep/path/photo.jpg",
    "/gem-quiz/deep/x.png", "/shopee-import/x.png", "/oem/invoices/x.png", "/w/s/abc/x.png",
    "/gem-quiz/og.gif", "/gem-quiz/og.png.exe",
    "/ring-size/deep/x.png", "/ring-size/3j-mark.gif", "/ring-sizes/x.png",
    // RSC / data suffix ที่ Next ต่อท้ายให้ — ห้ามกลายเป็นช่องใหม่
    "/orders/x.png.rsc", "/live/x.png.rsc", "/_next/data/BUILD/live/x.png.json",
    "/dashboard", "/catalog", "/settings/members", "/login", "/register", "/pending", "/",
    "/shopee-import", "/shopping-cart", "/stock/heroes", "/api/webhooksx", "/gem-quizzes", "/gem-quiz/admin",
    "/api/gem-quiz/stats", "/w", "/w/", "/w/../oem", "/w/abc/def", `/w/s/${TOKEN}/x`,
  ];

  it("ดึง literal ของ matcher ออกจาก middleware.ts ได้", () => {
    expect(literal).toBeTruthy();
    expect(compiled).not.toBeNull();
  });

  it.each(EXEMPT)("exempt: %s — ทั้ง matcher จริงและ mirror", (p) => {
    expect(middlewareRuns(p)).toBe(false);
    expect(isExemptPath(p)).toBe(true);
  });

  it.each(GATED)("gated: %s — ทั้ง matcher จริงและ mirror", (p) => {
    expect(middlewareRuns(p)).toBe(true);
    expect(isExemptPath(p)).toBe(false);
  });

  it("ไม่เหลือ alternative `.*\.ext$` (any-depth) ทั้งใน matcher และ mirror", () => {
    // literal = ข้อความดิบในซอร์ส (backslash คู่) · exempt-path.ts เก็บเป็น regex literal (backslash เดี่ยว)
    expect(literal).not.toContain(".*\\\\.(?:");
    const mirror = readFileSync(join(process.cwd(), "lib/auth/exempt-path.ts"), "utf8");
    expect(mirror).not.toMatch(/\|\.\*\\\.\(\?:svg/);
    expect(mirror).toContain("|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|gem-quiz\\/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$|ring-size\\/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$)/;");
  });

  it("ไม่มี route ระดับ root ที่เป็น dynamic segment (app/[slug]) — ถ้ามี alternative ระดับ root `/x.png` จะไม่ปลอดภัย", () => {
    const roots = [join(process.cwd(), "app")];
    const offenders: string[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        // route group (xxx) ไม่นับเป็นชั้นของ URL — เดินผ่านโดยไม่เพิ่ม depth
        const isGroup = /^\(.+\)$/.test(e.name);
        if (!isGroup && depth === 0 && /^\[.+\]$/.test(e.name)) offenders.push(join(dir, e.name));
        if (isGroup) walk(join(dir, e.name), depth);
      }
    };
    for (const r of roots) walk(r, 0);
    expect(offenders).toEqual([]);
  });
});
