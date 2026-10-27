// lib/auth/exempt-graph.test.ts
//
// แทนที่ lib/gem-quiz/no-server-action-graph.test.ts (ลบแล้ว — scanner เดิมย้ายมาไว้ที่นี่
// ที่เดียว ไม่มีสองสำเนาให้ drift) · H1 Phase 2, design §4 (27 ต.ค. 69)
//
// ปัญหาราก: หน้าที่ถูก exempt จาก auth gate (middleware.ts / lib/auth/exempt-path.ts) ไม่ผ่าน
// session check เลย — ถ้า module graph ของหน้านั้นไปถึงไฟล์ "use server" ใดๆ (ทางอ้อมก็ตาม)
// ทุก export ของไฟล์นั้นจะกลายเป็น Server Action ที่ถูก dispatch ได้โดยไม่มี gate
// เทสต์นี้เดิน import graph จริงแบบ transitive จาก entry ของแต่ละหน้า exempt (รวม layout ทุกชั้น
// ที่ Next bundle ไปด้วย — /stock/hero ได้ auth.ts มาจาก layout ไม่ใช่จาก page) แล้ว assert ว่า
// "use server" ที่ไปถึงได้ต้องเป็นรายการที่ตั้งใจเท่านั้น
//
// ⚠️ นี่คือด่านโครงสร้าง ไม่ใช่ proof: scanner ตาม import สตริงคงที่เท่านั้น (import(variable) /
// barrel นอก EXTS หลุด) — ด่านจริงคือ guard ในตัว action (action-guard-coverage.test.ts)
// สองชั้นนี้ต้องอยู่คู่กัน
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
// จับ "use server" directive ระดับไฟล์ (บรรทัดแรกๆ ของไฟล์ ตาม Next.js spec)
const USE_SERVER_LINE = /^\s*["']use server["'];?\s*$/m;

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return listFiles(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // แพ็กเกจภายนอก (node_modules) — ไม่ตามเข้าไป
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  // resolve ไม่เจอ = throw (ไม่เงียบ) — เป็น negative control ในตัว: graph ที่เดินไม่ครบต้องล้ม ไม่ใช่ผ่านเพราะมองไม่เห็น
  throw new Error(`resolve ไม่เจอ: ${spec} (จาก ${relative(ROOT, from)})`);
}

function serverActionModulesReachableFrom(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(tsx?|m?js)$/.test(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(IMPORT_RE)) {
      const r = resolveSpec(f, (m[1] ?? m[2] ?? m[3]) as string);
      if (r) stack.push(r);
    }
  }
  return [...seen]
    .filter((f) => /\.(tsx?|m?js)$/.test(f) && USE_SERVER_LINE.test(readFileSync(f, "utf8")))
    .map((f) => rel(f))
    .sort();
}

function rel(f: string): string {
  return relative(ROOT, f).split("\\").join("/");
}

/** ตัดคอมเมนต์ก่อน regex (แบบ lib/jobs/worker-boundary.test.ts) — คอมเมนต์ที่เอ่ยชื่อคำต้องห้ามต้องไม่ทำให้ล้มหรือหลอกให้ผ่าน */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const p = (...segs: string[]) => join(ROOT, ...segs);

// ---- SENSITIVE: คำนวณจาก readdir จริง ไม่ hardcode denylist --------------------------------
// ไฟล์ action ใหม่ใน lib/actions ถูกคุ้มครองเองโดยไม่ต้องมีใครจำมาเพิ่ม
// (หลักเดียวกับ scripts/check-analytics-grants.sql) · allowlist = ที่ตั้งใจเปิดจริงเท่านั้น
const NON_SENSITIVE_ALLOWLIST = new Set([
  "lib/actions/hero-stock.ts", // /stock/hero จอสาธารณะ (มติเจ้าของ) — select เฉพาะ sku/name/is_active/qty · ดู "คุณสมบัติของ allowlist" ด้านล่าง
  "lib/actions/auth.ts", // signOut — ไม่มีข้อมูล · ถูก bundle เข้า /stock/hero ผ่าน dashboard layout อยู่แล้ว
  "lib/actions/job-worker.ts", // ช่างพิสูจน์ตัวด้วย token+PIN ที่ DB โดยตั้งใจ — ขอบเขตกันโดย lib/jobs/worker-boundary*.test.ts
]);

const ACTION_FILES = readdirSync(p("lib", "actions"))
  .filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n))
  .map((n) => `lib/actions/${n}`)
  .filter((f) => USE_SERVER_LINE.test(readFileSync(p(f), "utf8")));

const SENSITIVE = new Set(ACTION_FILES.filter((f) => !NON_SENSITIVE_ALLOWLIST.has(f)));

function expectNoSensitive(found: string[]) {
  // assert แยกอีกข้อให้อ่าน failure ง่าย: บอกตรงๆ ว่า "ไฟล์ sensitive ไหนหลุดเข้า graph"
  expect(
    found.filter((f) => SENSITIVE.has(f)),
    "ไฟล์ 'use server' ที่ sensitive หลุดเข้า graph ของหน้า exempt",
  ).toEqual([]);
}

describe("เกณฑ์ SENSITIVE (negative controls — กัน scanner/allowlist เงียบ)", () => {
  it("(3) allowlist ทุกตัวต้องมีอยู่จริงและเป็น 'use server' · SENSITIVE มีขนาดสมเหตุสมผล (กัน readdir ว่าง)", () => {
    for (const f of NON_SENSITIVE_ALLOWLIST) expect(ACTION_FILES, `${f} ไม่อยู่ใน lib/actions แล้ว?`).toContain(f);
    expect(SENSITIVE.size).toBeGreaterThanOrEqual(30);
  });

  it("(2) denylist จับของจริง: /orders (+layout) ไปถึง lib/actions/orders.ts ซึ่งอยู่ใน SENSITIVE", () => {
    const found = serverActionModulesReachableFrom([
      p("app", "(dashboard)", "orders", "page.tsx"),
      p("app", "(dashboard)", "layout.tsx"),
      p("app", "layout.tsx"),
    ]);
    expect(found).toContain("lib/actions/orders.ts");
    expect(found.filter((f) => SENSITIVE.has(f))).toContain("lib/actions/orders.ts");
    expect(SENSITIVE.has("lib/actions/auth.ts")).toBe(false); // auth.ts มากับ layout แต่ไม่ sensitive
  });
});

describe("คุณสมบัติของ allowlist (กัน allowlist เสื่อม)", () => {
  it("hero-stock.ts ต้องไม่แตะราคา/ต้นทุน/margin/PII/catalog action — เพราะมันเปิดสาธารณะ", () => {
    const src = stripComments(readFileSync(p("lib", "actions", "hero-stock.ts"), "utf8"));
    const hit = src.match(/unit_cost|list_price|margin|cost_type|buyer_|phone|address|@\/lib\/actions\/catalog/i);
    expect(hit?.[0] ?? null, "hero-stock.ts เริ่มแตะข้อมูลที่ไม่ควรอยู่บนจอสาธารณะ").toBeNull();
  });

  it("auth.ts ต้องไม่ import getServiceClient (signOut ใช้ user client เท่านั้น)", () => {
    const src = stripComments(readFileSync(p("lib", "actions", "auth.ts"), "utf8"));
    expect(/getServiceClient/.test(src)).toBe(false);
  });

  it("mutant ของตัวตรวจ: regex จับคำต้องห้ามจริง และคอมเมนต์ไม่ทำให้ล้ม", () => {
    const re = /unit_cost|list_price|margin|cost_type|buyer_|phone|address|@\/lib\/actions\/catalog/i;
    expect(re.test(stripComments('.select("sku, unit_cost")'))).toBe(true);
    expect(re.test(stripComments('import { x } from "@/lib/actions/catalog";'))).toBe(true);
    expect(re.test(stripComments("// margin phone address\n/* unit_cost */ const a = 1;"))).toBe(false);
  });
});

describe("หน้า exempt ห้ามมี Server Action ที่ไม่ได้ตั้งใจ", () => {
  it("/shop : app/(public)/** + app/layout.tsx -> ไม่มี 'use server' เลย", () => {
    const found = serverActionModulesReachableFrom([...listFiles(p("app", "(public)")), p("app", "layout.tsx")]);
    expectNoSensitive(found);
    expect(found).toEqual([]);
  });

  it("/gem-quiz : app/(quiz)/gem-quiz/** + (quiz)/layout + lib/gem-quiz/** + app/layout -> ไม่มี 'use server' เลย", () => {
    // เคสเดิมของ R-9 / security audit M2 (4 ต.ค. 69)
    const found = serverActionModulesReachableFrom([
      ...listFiles(p("app", "(quiz)", "gem-quiz")),
      p("app", "(quiz)", "layout.tsx"),
      ...listFiles(p("lib", "gem-quiz")),
      p("app", "layout.tsx"),
    ]);
    expectNoSensitive(found);
    expect(found).toEqual([]);
  });

  it("/ring-size : app/(quiz)/ring-size/** + (quiz)/layout + app/layout -> ไม่มี 'use server' เลย", () => {
    const found = serverActionModulesReachableFrom([
      ...listFiles(p("app", "(quiz)", "ring-size")),
      p("app", "(quiz)", "layout.tsx"),
      p("app", "layout.tsx"),
    ]);
    expectNoSensitive(found);
    expect(found).toEqual([]);
  });

  it("/stock/hero : page + (dashboard)/layout + app/layout -> เท่ากับ {auth.ts, hero-stock.ts} เป๊ะ (equality ไม่ใช่ subset — เพิ่มอะไรก็ล้ม)", () => {
    const found = serverActionModulesReachableFrom([
      p("app", "(dashboard)", "stock", "hero", "page.tsx"),
      p("app", "(dashboard)", "layout.tsx"),
      p("app", "layout.tsx"),
    ]);
    expectNoSensitive(found);
    expect(found).toEqual(["lib/actions/auth.ts", "lib/actions/hero-stock.ts"]);
  });

  it("(1) negative control: /stock/hero ต้องเจอ hero-stock.ts จริง (scanner ไม่ false-negative เงียบ)", () => {
    const found = serverActionModulesReachableFrom([p("app", "(dashboard)", "stock", "hero", "page.tsx")]);
    expect(found).toContain("lib/actions/hero-stock.ts");
  });

  it("/w/[token] + /w/s/[shopToken] : app/(worker)/** + app/layout -> เท่ากับ {job-worker.ts} เป๊ะ", () => {
    const found = serverActionModulesReachableFrom([...listFiles(p("app", "(worker)")), p("app", "layout.tsx")]);
    expectNoSensitive(found);
    expect(found).toEqual(["lib/actions/job-worker.ts"]);
  });

  it("/api/webhooks/[channel] : route.ts -> ไม่มี 'use server' (route handler ไม่ dispatch action แต่กันไว้ถูกกว่า)", () => {
    const found = serverActionModulesReachableFrom([p("app", "api", "webhooks", "[channel]", "route.ts")]);
    expectNoSensitive(found);
    expect(found).toEqual([]);
  });

  it("/api/gem-quiz/submit : route.ts -> ไม่มี 'use server'", () => {
    const found = serverActionModulesReachableFrom([p("app", "api", "gem-quiz", "submit", "route.ts")]);
    expectNoSensitive(found);
    expect(found).toEqual([]);
  });
});
