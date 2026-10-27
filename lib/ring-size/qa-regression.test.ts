// lib/ring-size/qa-regression.test.ts — QA (24 ต.ค. 69) regression รอบรัศมีกระแทกของงาน /ring-size ที่แตะของกลาง 2 ตัว
//   (1) middleware matcher (ด่าน auth กลาง): เทียบ "matcher ของ main ที่ตรึงไว้" กับ matcher ปัจจุบัน ทีละ path
//       → ต้องต่างกัน "เฉพาะ /ring-size · /ring-size/ · /api/ring-size/event · /api/ring-size/event/" เท่านั้น
//         (25 ต.ค. 69: baseline ขยายโดยตั้งใจ 2 path สำหรับ endpoint สถิติ — ห้ามผ่อน regex แล้วมาเพิ่มรายการในชุดนี้) · ที่เหลือ (gem-quiz · shop · /w/* · api · dashboard · static) เหมือนเดิมทุกตัว
//   (2) next.config headers: คอมไพล์ source ด้วยตัวเดียวกับที่ `next build` ใช้ (buildCustomRoute) แล้วถามว่า path ไหนโดน rule ไหน
//       → /w/* โดนเฉพาะ rule หน้าช่าง (6 header เดิม) · /ring-size โดนเฉพาะ rule ring-size · path อื่นไม่โดนอะไรเลย
// ตั้งใจไม่ใช้สูตร/regex ชุดเดียวกับโค้ดที่ทดสอบ: baseline คือสตริงที่คัดลอกจาก main ตอน QA (frozen)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import nextConfig from "../../next.config.mjs";

const getMiddlewareMatchers = (
  pageStaticInfo as unknown as {
    getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string }>;
  }
).getMiddlewareMatchers;

/** matcher ของ main (ก่อนมี /ring-size) — คัดลอกจาก `git show main:middleware.ts` ตอน QA · ห้ามแก้ตามโค้ดใหม่ */
const MAIN_MATCHER =
  "/((?!_next/static|_next/image|favicon\\.ico|api/webhooks(?:/|$)|api/gem-quiz/submit/?$|shop(?:/|$)|gem-quiz/?$|stock/hero(?:/|$)|w/[A-Za-z0-9_-]+/?$|w/s/[A-Za-z0-9_-]+/?$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)";

function currentMatcher(): string {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"\s*,?\s*\]/.exec(mw);
  if (!m) throw new Error("ไม่พบ config.matcher ใน middleware.ts");
  return JSON.parse(`"${m[1]}"`) as string;
}

function runsFor(matcher: string): (p: string) => boolean {
  const ms = getMiddlewareMatchers(matcher, {} as never);
  expect(ms).toHaveLength(1);
  const re = new RegExp(ms[0].regexp);
  return (p) => re.test(p);
}

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const BASES = [
  "ring-size", "ring-sizes", "ring-size-admin", "api/ring-size", "api/ring-size/event", "api/ring-size/events", "api/ring-size/event/x", "api/ring-size-x", "api/ring-sizes/event", "gem-quiz", "gem-quizzes", "shop", "shopee-import", "w", `w/${TOKEN}`, "w/s", `w/s/${TOKEN}`,
  "stock/hero", "stock", "api/webhooks", "api/gem-quiz/submit", "api/gem-quiz", "api", "dashboard", "login", "register", "pending", "oem", "oem/quote",
  "catalog", "crm/import", "tiktok/upload", "settings/members", "_next/static", "_next/image", "favicon.ico", "",
];
const SUFFIXES = ["", "/", "/x", "/x/y", "//", "/..", "%2F", "%2f..", ".png", "/a.svg", ".jpg/x", "?x=1", " ", "/ "];
const CORPUS: string[] = [];
for (const b of BASES) for (const s of SUFFIXES) CORPUS.push(`/${b}${s}`);
// เพิ่มรูปแปลกๆ
CORPUS.push("/api/ring-size/Event", "/api/RING-SIZE/event", "/api/ring-size/event.", "/api/ring-size/event%00", "/api/ring-size/event/api/ring-size/event", "/api/ring-size//event", "/Ring-Size", "/RING-SIZE/", "/ring%2Dsize", "/ring-size%00", "/ring-size\n", "/ring-size.", "/ring-size.html", "/x/ring-size", "/oem/ring-size", "/ring-size/ring-size");

describe("middleware matcher: ต่างจาก main เฉพาะ /ring-size · /ring-size/ · /api/ring-size/event · /api/ring-size/event/ (differential เทียบ baseline ที่ตรึงไว้)", () => {
  const before = runsFor(MAIN_MATCHER);
  const after = runsFor(currentMatcher());

  it("corpus ใหญ่พอ (กัน false-pass)", () => {
    expect(CORPUS.length).toBeGreaterThan(400);
  });

  it("path ที่พฤติกรรมเปลี่ยน = {/ring-size, /ring-size/, /api/ring-size/event, /api/ring-size/event/} เท่านั้น · และเปลี่ยนจาก 'ถูก gate' เป็น 'ไม่ผ่าน middleware'", () => {
    const changed = CORPUS.filter((p) => before(p) !== after(p));
    expect(new Set(changed)).toEqual(new Set(["/ring-size", "/ring-size/", "/api/ring-size/event", "/api/ring-size/event/"]));
    for (const p of changed) {
      expect(before(p), `${p} เดิมต้องถูก gate`).toBe(true);
      expect(after(p), `${p} ใหม่ต้อง exempt`).toBe(false);
    }
  });

  it("ของเดิมที่ต้องยัง exempt เหมือนเดิม: gem-quiz · shop · /w/* · api/webhooks · gem-quiz submit · stock/hero · static", () => {
    for (const p of ["/gem-quiz", "/gem-quiz/", "/api/gem-quiz/submit", "/api/ring-size/event", "/api/ring-size/event/", "/shop", "/shop/abc", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/stock/hero", "/api/webhooks/tiktok", "/_next/static/a.js", "/favicon.ico", "/x/logo.png"]) {
      expect(after(p), p).toBe(false);
    }
  });

  it("ของเดิมที่ต้องยังถูก gate เหมือนเดิม: dashboard · login · oem · api อื่น · gem-quiz ลูก · look-alike ของ ring-size", () => {
    for (const p of [
      "/dashboard", "/login", "/oem/quote", "/crm/import", "/tiktok/upload", "/settings/members", "/", "/api/gem-quiz", "/api/gem-quiz/stats",
      "/gem-quiz/admin", "/gem-quizzes", "/w", "/w/", "/w/abc/def", "/ring-sizes", "/ring-size-admin", "/ring-size/x", "/ring-size/x/y", "/api/ring-size", "/api/ring-size-x",
      "/RING-SIZE", "/Ring-Size", "/ring-size/..", "/ring-size%2Fx", "/x/ring-size", "/oem/ring-size",
      // family ของ endpoint สถิติ: ยกเว้นเฉพาะ /api/ring-size/event(/) — ที่เหลือต้องถูก gate
      "/api/ring-size/", "/api/ring-size/stats", "/api/ring-size/event/x", "/api/ring-size/event/x/y", "/api/ring-size/events", "/api/ring-size/event-x",
      "/api/ring-size/Event", "/api/RING-SIZE/event", "/api/ring-sizes/event", "/api/ring-size/event//", "/api/ring-size/event%2F", "/api/ring-size/event/..",
    ]) {
      expect(after(p), p).toBe(true);
    }
  });
});

describe("next.config headers: คอมไพล์ source แบบเดียวกับ next build แล้วดูว่า path ไหนโดน rule ไหน", () => {
  type Rule = { source: string; headers: Array<{ key: string; value: string }> };
  async function compiled() {
    const rules = (await (nextConfig as unknown as { headers: () => Promise<Rule[]> }).headers()) as Rule[];
    return rules.map((r) => ({ rule: r, re: new RegExp((buildCustomRoute("header", r as never) as { regex: string }).regex, "i") }));
  }
  const hit = async (p: string) => (await compiled()).filter((c) => c.re.test(p)).map((c) => c.rule.source);

  it("/ring-size และ /ring-size/ โดนเฉพาะ rule ring-size", async () => {
    expect(await hit("/ring-size")).toEqual(["/ring-size"]);
    expect(await hit("/ring-size/")).toEqual(["/ring-size"]);
  });

  it("/w/* โดนเฉพาะ rule หน้าช่าง และได้ 6 header เดิมครบ · ไม่ได้ Permissions-Policy", async () => {
    for (const p of ["/w", "/w/", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/w/a/b"]) expect(await hit(p), p).toEqual(["/w/:path*"]);
    const w = (await compiled()).find((c) => c.rule.source === "/w/:path*")!.rule;
    expect(w.headers.map((h) => h.key)).toEqual(["Referrer-Policy", "X-Robots-Tag", "Cache-Control", "X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy"]);
  });

  it("path อื่นทั้งหมดไม่โดน rule ไหนเลย (gem-quiz · shop · dashboard · look-alike · api)", async () => {
    for (const p of [
      "/gem-quiz", "/shop", "/shop/x", "/dashboard", "/oem/quote", "/", "/login", "/ring-sizes", "/ring-size-admin", "/ring-size/x", "/ring-size/x/y",
      "/api/ring-size", "/api/ring-size-x", "/api/ring-size/event", "/api/ring-size/event/", "/api/ring-size/stats", "/api/gem-quiz/submit", "/api/webhooks/tiktok", "/wx", "/wow/abc", "/x/w/abc", "/oem/ring-size", "/x/ring-size",
    ]) {
      expect(await hit(p), p).toEqual([]);
    }
  });
});
