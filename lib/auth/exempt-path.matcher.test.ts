// lib/auth/exempt-path.matcher.test.ts — เทียบ "matcher จริงของ Next" กับ mirror (exempt-path.ts) ทีละ path
//
// security L4 (ring-size, 24 ต.ค. 69): เทสต์เดิมเทียบแค่สตริงใน middleware.ts กับ exempt-path.ts (ตรวจ drift ของข้อความ)
// แต่ไม่ได้พิสูจน์ว่า matcher ที่ Next คอมไพล์จริงตัดสินเหมือน mirror — ที่นี่ใช้ getMiddlewareMatchers ตัวเดียวกับที่ `next build` ใช้
// แปลง `config.matcher` เป็น regexp (path-to-regexp) แล้วถามว่า middleware "จะรัน" ไหม · รัน = ถูก gate · ไม่รัน = exempt
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { isExemptPath } from "./exempt-path";

// ฟังก์ชันนี้ export ตอน runtime (Next ใช้เองตอน build) แต่ไม่อยู่ใน .d.ts — ระบุ type เอง
// ถ้า Next เปลี่ยนชื่อ/ลายเซ็นในเวอร์ชันหน้า เทสต์นี้จะล้ม (ตั้งใจ: อย่าให้ด่านตรวจ matcher เงียบหาย)
const getMiddlewareMatchers = (
  pageStaticInfo as unknown as {
    getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string; originalSource: string }>;
  }
).getMiddlewareMatchers;

function realMatcherSource(): string {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"\s*,?\s*\]/.exec(mw);
  if (!m) throw new Error("ไม่พบ config.matcher ใน middleware.ts");
  return JSON.parse(`"${m[1]}"`) as string; // ถอด escape ของสตริง TS (\\. → \.)
}

function middlewareRuns(pathname: string): boolean {
  const matchers = getMiddlewareMatchers(realMatcherSource(), {} as never);
  expect(matchers).toHaveLength(1);
  return new RegExp(matchers[0].regexp).test(pathname);
}

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

const PATHS: string[] = [
  // ring-size — exact เท่านั้น
  "/ring-size",
  "/ring-size/",
  "/ring-sizes",
  "/ring-size-admin",
  "/ring-size/x",
  "/ring-size/x/y",
  "/api/ring-size-x",
  "/api/ring-size",
  "/api/ring-size/track",
  "/api/ring-size/",
  "/api/ring-size/stats",
  "/api/ring-size/event",
  "/api/ring-size/event/",
  "/api/ring-size/event/x",
  "/api/ring-size/event/x/y",
  "/api/ring-size/events",
  "/api/ring-size/event-x",
  "/api/ring-size/Event",
  "/api/RING-SIZE/event",
  "/api/ring-sizes/event",
  "/api/ring-size/event//",
  "/api/ring-size//event",
  "/api/ring-size/event%2F",
  "/api/ring-size/event/..",
  "/api/ring-size/event/../../oem",
  "/x/api/ring-size/event",
  "/RING-SIZE",
  "/Ring-Size",
  "/ring-size%2F..",
  "/ring-size%2fx",
  "/ring-size/..",
  "/ring-size/../oem",
  "/x/ring-size",
  "/oem/ring-size",
  "/ring-size/3j-mark.png",
  // gem-quiz (ต้องไม่เปลี่ยนพฤติกรรม)
  "/gem-quiz",
  "/gem-quiz/",
  "/gem-quizzes",
  "/gem-quiz-admin",
  "/gem-quiz/admin",
  "/GEM-QUIZ",
  "/api/gem-quiz/submit",
  "/api/gem-quiz",
  "/api/gem-quiz/stats",
  "/api/gem-quiz/submit/extra",
  // ร้าน / hero / webhooks
  "/shop",
  "/shop/some-product-slug",
  "/shopee-import",
  "/stock/hero",
  "/stock/hero/",
  "/stock/heroes",
  "/api/webhooks/tiktok",
  "/api/webhooksx",
  // หน้าช่าง
  `/w/${TOKEN}`,
  `/w/${TOKEN}/`,
  "/w/abc",
  "/w",
  "/w/",
  "/w/../oem",
  "/w/abc/def",
  `/w/s/${TOKEN}`,
  "/w/sx/abc",
  // static / internals
  "/_next/static/chunk.js",
  "/favicon.ico",
  "/images/logo.png",
  "/some/deep/path/photo.jpg",
  // หน้าที่ gate ปกติ
  "/dashboard",
  "/settings/members",
  "/login",
  "/register",
  "/pending",
  "/",
];

describe("matcher จริงของ Next (getMiddlewareMatchers) ตัดสินตรงกับ isExemptPath ทุก path", () => {
  it("มี matcher ตัวเดียวและมี alternative ของ ring-size (หน้า) กับ api/ring-size/event (exact)", () => {
    expect(realMatcherSource()).toContain("ring-size/?$");
    expect(realMatcherSource()).toContain("|api/ring-size/event/?$|");
  });

  it.each(PATHS)("%s", (p) => {
    // middleware ไม่รัน = exempt (ผ่านโดยไม่ตรวจ session) · รัน = ถูก gate
    expect(!middlewareRuns(p), `${p}: matcher จริง exempt=${!middlewareRuns(p)} mirror exempt=${isExemptPath(p)}`).toBe(isExemptPath(p));
  });

  it("ยืนยันตรงๆ: /ring-size และ /ring-size/ ไม่ผ่าน middleware · ที่เหลือใน family เดียวกันถูก gate", () => {
    expect(middlewareRuns("/ring-size")).toBe(false);
    expect(middlewareRuns("/ring-size/")).toBe(false);
    for (const p of ["/ring-sizes", "/ring-size-admin", "/ring-size/x", "/api/ring-size-x", "/api/ring-size", "/ring-size%2F.."]) {
      expect(middlewareRuns(p), p).toBe(true);
    }
  });

  it("ยืนยันตรงๆ: /api/ring-size/event(/) ไม่ผ่าน middleware · ที่เหลือใน family เดียวกันถูก gate", () => {
    expect(middlewareRuns("/api/ring-size/event")).toBe(false);
    expect(middlewareRuns("/api/ring-size/event/")).toBe(false);
    for (const p of [
      "/api/ring-size", "/api/ring-size/", "/api/ring-size/stats", "/api/ring-size/event/x", "/api/ring-size/events", "/api/ring-size/event-x",
      "/api/ring-size/Event", "/api/RING-SIZE/event", "/api/ring-sizes/event", "/api/ring-size/event//", "/api/ring-size/event%2F", "/api/ring-size/event/..",
    ]) {
      expect(middlewareRuns(p), p).toBe(true);
    }
  });

  it("negative control: matcher ที่เปิดทั้ง subtree (api/ring-size(?:/|$)) จะปล่อย /api/ring-size/stats และ /api/ring-size/event/x หลุด gate — เทสต์นี้จับได้", () => {
    const loose = realMatcherSource().replace("api/ring-size/event/?$", "api/ring-size(?:/|$)");
    const [m] = getMiddlewareMatchers(loose, {} as never);
    expect(new RegExp(m.regexp).test("/api/ring-size/stats")).toBe(false); // หลุด gate = middleware ไม่รัน
    expect(new RegExp(m.regexp).test("/api/ring-size/event/x")).toBe(false);
    expect(isExemptPath("/api/ring-size/stats")).toBe(false); // mirror จริงยัง gate — drift แบบนี้ทำให้เทสต์ข้างบนล้ม
    expect(isExemptPath("/api/ring-size/event/x")).toBe(false);
  });

  it("negative control: เทสต์นี้จับ matcher ที่หลวมได้ (ถ้า alternative เป็น ring-size(?:/|$) จะเห็นว่า /ring-size/x หลุด)", () => {
    const loose = realMatcherSource().replace("ring-size/?$", "ring-size(?:/|$)");
    const [m] = getMiddlewareMatchers(loose, {} as never);
    expect(new RegExp(m.regexp).test("/ring-size/x")).toBe(false); // หลุด gate = middleware ไม่รัน
    expect(isExemptPath("/ring-size/x")).toBe(false); // mirror จริงยัง gate — ถ้า drift แบบนี้เทสต์ข้างบนต้องล้ม
  });
});
