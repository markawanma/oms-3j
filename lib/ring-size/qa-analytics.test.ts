// lib/ring-size/qa-analytics.test.ts — QA รอบ 2 (27 ต.ค. 69) · regression ของ auth gate กลางสำหรับ endpoint สถิติ
// ข้อค้นพบ: branch feature/ring-size-analytics-r2 แตกจาก 4fced33 แต่ main ไปไกลแล้ว (H1 d81eb37/396c595 ปิดช่อง `.*\.png`) ⇒
// `middleware.ts` · `exempt-path.ts` (+ worker test · qa-regression.test) ชนกันตอน merge แน่นอน (git merge-tree)
// ไฟล์นี้ทำ 2 อย่าง:
//   (A) "ผลหลัง rebase ที่ถูกต้อง" = matcher ของ main ตอนนี้ (ตรึงจาก fd9aaaf) + เพิ่ม alternative เดียว api/ring-size/event/?$
//       ⇒ differential เทียบ main: ต้องต่างเฉพาะ /api/ring-size/event และ /api/ring-size/event/ · H1 ต้องไม่ย้อนกลับ
//   (B) H1 guard บน matcher จริงในไฟล์ middleware.ts ของ branch — 🔴 FAIL บน branch นี้จนกว่าจะ rebase เอา matcher ของ main มา
//       (ถ้าแก้ conflict โดยเลือกฝั่ง branch = เปิด `.*\.png` กลับมา — เทสต์นี้จับได้)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";

const getMiddlewareMatchers = (
  pageStaticInfo as unknown as {
    getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string }>;
  }
).getMiddlewareMatchers;

/** matcher ของ main ณ fd9aaaf (หลัง H1) — คัดลอกจาก `git show main:middleware.ts` · ห้ามแก้ตามโค้ดใหม่ */
const MAIN_NOW =
  "/((?!_next/static|_next/image|favicon\\.ico|api/webhooks(?:/|$)|api/gem-quiz/submit/?$|shop(?:/|$)|gem-quiz/?$|ring-size/?$|stock/hero(?:/|$)|w/[A-Za-z0-9_-]+/?$|w/s/[A-Za-z0-9_-]+/?$|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|gem-quiz/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$|ring-size/[^/]+\\.(?:svg|png|jpg|jpeg|webp)$).*)";

const ALT_NEW = "api/ring-size/event/?$|";
/** ผลที่ถูกต้องหลัง rebase: แทรก alternative ใหม่ตัวเดียวถัดจาก gem-quiz/submit (เหมือนที่ branch ทำ) */
const REBASED = MAIN_NOW.replace("api/gem-quiz/submit/?$|", `api/gem-quiz/submit/?$|${ALT_NEW}`);

function runsFor(matcher: string): (p: string) => boolean {
  const ms = getMiddlewareMatchers(matcher, {} as never);
  expect(ms).toHaveLength(1);
  const re = new RegExp(ms[0].regexp);
  return (p) => re.test(p);
}

function branchMatcher(): string {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"\s*,?\s*\]/.exec(mw);
  if (!m) throw new Error("ไม่พบ config.matcher ใน middleware.ts");
  return JSON.parse(`"${m[1]}"`) as string;
}

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const BASES = [
  "api/ring-size/event", "api/ring-size", "api/ring-size/events", "api/ring-size/event/x", "api/ring-size/stats", "api/ring-sizes/event", "api/ring-size-x",
  "ring-size", "ring-sizes", "gem-quiz", "api/gem-quiz/submit", "api/gem-quiz", "shop", `w/${TOKEN}`, `w/s/${TOKEN}`, "stock/hero", "api/webhooks/tiktok",
  "dashboard", "login", "oem/quote", "crm/import", "marketing/ring-size", "marketing/gem-quiz", "settings/members", "api", "",
];
const SUFFIXES = ["", "/", "/x", "//", "/..", "%2F", ".png", "/a.png", "/x.png", "/a.svg", ".jpg", ".json", ".rsc", "/x.json", "?x=1", " ", "/ "];
const CORPUS: string[] = [];
for (const b of BASES) for (const s of SUFFIXES) CORPUS.push(`/${b}${s}`);
// รูปแบบข้อมูล RSC/Next data ของ endpoint ใหม่ — ต้องไม่เป็นช่องเลี่ยง gate
CORPUS.push(
  "/_next/data/BUILD/api/ring-size/event.json", "/api/ring-size/event.rsc", "/api/ring-size/event.segments/a.segment.rsc",
  "/api/ring-size/event.json", "/api/ring-size/event.png", "/api/ring-size/event/logo.png", "/x/api/ring-size/event", "/ring-size/api/ring-size/event",
  "/api/ring-size/Event", "/api/RING-SIZE/event", "/api/ring-size/event%00", "/api/ring-size/event\n",
);

describe("QA (A) หลัง rebase ที่ถูกต้อง: matcher ของ main ปัจจุบัน + alternative เดียว ⇒ ต่างจาก main เฉพาะ endpoint สถิติ", () => {
  const before = runsFor(MAIN_NOW);
  const after = runsFor(REBASED);

  it("การแทรกทำงานจริง (กัน false-pass: REBASED ≠ MAIN_NOW) และ corpus ใหญ่พอ", () => {
    expect(REBASED).not.toBe(MAIN_NOW);
    expect(REBASED).toContain("|api/ring-size/event/?$|");
    expect(CORPUS.length).toBeGreaterThan(450);
  });

  it("path ที่พฤติกรรมเปลี่ยน = {/api/ring-size/event, /api/ring-size/event/} เท่านั้น · เปลี่ยนจาก gated → ไม่ผ่าน middleware", () => {
    const changed = CORPUS.filter((p) => before(p) !== after(p));
    expect(new Set(changed)).toEqual(new Set(["/api/ring-size/event", "/api/ring-size/event/"]));
    for (const p of changed) {
      expect(before(p), `${p} เดิมต้องถูก gate`).toBe(true);
      expect(after(p), `${p} ใหม่ต้อง exempt`).toBe(false);
    }
  });

  it("ของเดิมไม่ขยับ: gem-quiz · gem-quiz/submit · shop · /w/* · webhooks · stock/hero · /ring-size ยัง exempt เหมือน main ทุกตัว", () => {
    for (const p of ["/gem-quiz", "/gem-quiz/", "/api/gem-quiz/submit", "/shop", "/shop/x", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/api/webhooks/tiktok", "/stock/hero", "/ring-size", "/ring-size/", "/favicon.ico", "/logo.png", "/gem-quiz/a.png", "/ring-size/a.png"]) {
      expect(after(p), p).toBe(false);
      expect(before(p), `${p} (main)`).toBe(false);
    }
  });

  it("ต้องยังถูก gate: dashboard · api อื่น · หน้า marketing/ring-size · look-alike ของ endpoint · รูปแบบ .json/.rsc/ซ้อนใน path อื่น · H1 (.png ซ้อนใน subpath)", () => {
    for (const p of [
      "/dashboard", "/login", "/oem/quote", "/crm/import", "/marketing/ring-size", "/marketing/gem-quiz", "/api", "/api/gem-quiz", "/api/gem-quiz/stats",
      "/api/ring-size", "/api/ring-size/", "/api/ring-size/stats", "/api/ring-size/events", "/api/ring-size/event/x", "/api/ring-size/event-x", "/api/ring-sizes/event",
      "/api/ring-size-x", "/api/ring-size/Event", "/api/RING-SIZE/event", "/api/ring-size/event//", "/api/ring-size/event%2F", "/api/ring-size/event/..",
      "/api/ring-size/event.json", "/api/ring-size/event.rsc", "/_next/data/BUILD/api/ring-size/event.json", "/x/api/ring-size/event", "/ring-size/api/ring-size/event",
      "/api/ring-size/event.png", "/api/ring-size/event/logo.png", "/x/logo.png", "/oem/logo.png", "/api/x.png", "/dashboard/a.svg",
    ]) {
      expect(after(p), p).toBe(true);
    }
  });
});

describe("QA (B) H1 guard บน matcher จริงของ branch — 🔴 ล้มบน branch นี้จนกว่าจะ rebase (ดูหัวไฟล์)", () => {
  const real = branchMatcher();
  const run = runsFor(real);

  it("matcher จริงต้องไม่มี `.*\\.(?:svg|png…)` (ช่อง extension-gate bypass ที่ H1 ปิดไปแล้วบน main)", () => {
    expect(real, "branch ยังใช้ matcher ก่อน H1 — ต้อง rebase บน main แล้วเพิ่มเฉพาะ api/ring-size/event/?$").not.toContain(".*\\.(?:svg");
  });

  it("พฤติกรรมจริง: /x/logo.png · /oem/logo.png · /api/ring-size/event/logo.png ต้องถูก gate (middleware ต้องรัน)", () => {
    for (const p of ["/x/logo.png", "/oem/logo.png", "/dashboard/a.svg", "/api/ring-size/event/logo.png", "/api/x.png"]) {
      expect(run(p), p).toBe(true);
    }
  });

  it("endpoint ใหม่ exempt จริงในไฟล์ของ branch (ส่วนนี้ถูกต้องอยู่แล้ว)", () => {
    expect(run("/api/ring-size/event")).toBe(false);
    expect(run("/api/ring-size/event/")).toBe(false);
    expect(run("/api/ring-size/stats")).toBe(true);
  });
});
