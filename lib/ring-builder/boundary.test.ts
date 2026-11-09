// 🔴 ขอบเขตของหน้า/route สาธารณะ Ring Builder (exempt path — ไม่ผ่าน auth gate):
//  1) กราฟ import runtime ของ route/catalog/quote/code/types ต้องไม่ลาก lib/actions/** · ไฟล์ "use server" · lib/jobs/gems* · admin-server.ts · admin-types.ts
//     (ไฟล์ "use server" ที่ถูก import เข้ากราฟ = ทุก export กลายเป็น Server Action ที่รันได้โดยไม่ผ่าน middleware)
//  2) จาก lib/ring-size ใช้ได้โดยตรงแค่ calibration.ts และ size.ts (อ่านผลวัดล่าสุด read-only)
//  3) key ของ PublicCatalog ที่ mapper ประกอบจริง = allowlist เป๊ะ · ไม่หลุด field ดิบ (ต้นทุน/id/flag หลังบ้าน) แม้ DB ส่งมา
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPublicCatalog, cardImageUrl } from "./catalog-server";
import { PUBLIC_CATALOG_KEYS, PUBLIC_DESIGN_KEYS, PUBLIC_OFFER_KEYS, PUBLIC_STONE_KEYS } from "./types";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
const isUseServer = (src: string): boolean => /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*["']use server["']/.test(src);

function runtimeImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (m[2]) continue;
    const named = /^\{([^}]*)\}$/.exec(m[3].trim());
    if (named && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[4]);
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  throw new Error(`resolve ไม่เจอ: ${spec} (จาก ${rel(from)})`);
}

/** closure runtime — ไฟล์ "use server" ถูกนับ (เป็น node ในกราฟ) แต่ไม่เดินต่อข้างใน เหมือนที่ bundler ทำ */
function closure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    if (isUseServer(src)) continue;
    for (const spec of runtimeImports(src)) {
      const r = resolveSpec(spec, f);
      if (r) stack.push(r);
    }
  }
  return seen;
}

const PUBLIC_ENTRIES = [
  "app/api/ring-builder/quote/route.ts",
  "lib/ring-builder/catalog-server.ts",
  "lib/ring-builder/quote-server.ts",
  "lib/ring-builder/quote-schema.ts",
  "lib/ring-builder/code.ts",
  "lib/ring-builder/code-sign.ts",
  "lib/ring-builder/types.ts",
  "lib/ring-builder/config.ts",
  "lib/ring-builder/mm.ts",
  "lib/ring-builder/last-size.ts",
];
/** path ของ page.tsx → URL (ตัด route group `(x)` ออก · ไม่ฮาร์ดโค้ดที่ตั้งของหน้า) · เช่น app/(dashboard)/catalog/ring-builder/page.tsx → /catalog/ring-builder */
export function urlOfPage(file: string): string {
  const segs = file.replace(/\\/g, "/").split("/").slice(1, -1).filter((s) => !/^\(.+\)$/.test(s));
  return "/" + segs.join("/");
}

function pagesAt(url: string): string[] {
  return walk(join(ROOT, "app")).map(rel).filter((f) => /\/page\.tsx$/.test(f) && urlOfPage(f) === url);
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const FORBIDDEN = (f: string): string | null => {
  if (f.startsWith("lib/actions/")) return "lib/actions/**";
  if (/^lib\/jobs\/gems[^/]*\.ts$/.test(f)) return "lib/jobs/gems*";
  if (f === "lib/ring-builder/admin-server.ts" || f === "lib/ring-builder/admin-types.ts") return "admin";
  return null;
};

describe("กราฟ runtime ของหน้า/route สาธารณะ", () => {
  // หน้าสาธารณะ /ring-builder หาจากโครงไฟล์ (ทุก page ที่ URL = /ring-builder ไม่ว่าอยู่ใต้ route group ไหน) + ไฟล์ทั้งโฟลเดอร์ของหน้านั้น
  const publicPages = pagesAt("/ring-builder");
  const pageDirFiles = publicPages.flatMap((p) => walk(join(ROOT, p, "..")));
  const entries = [...PUBLIC_ENTRIES.map((e) => join(ROOT, e)), ...pageDirFiles];
  const files = [...closure(entries)].map(rel);

  it("ครบทุก entry และกราฟไม่ว่าง", () => {
    for (const e of PUBLIC_ENTRIES) expect(files).toContain(e);
    expect(files.length).toBeGreaterThan(10);
  });
  it("หน้า /ring-builder (ถ้ามี) ต้องไม่อยู่ใต้ (dashboard) หรือ route group ที่ผ่าน auth gate — มีได้เฉพาะกลุ่มสาธารณะ (quiz)", () => {
    for (const p of publicPages) {
      expect(p, p).not.toMatch(/\(dashboard\)/);
    }
  });
  it("urlOfPage ตัด route group และไม่จับ /catalog/ring-builder ของหลังบ้านผิดเป็น /ring-builder", () => {
    expect(urlOfPage("app/(quiz)/ring-builder/page.tsx")).toBe("/ring-builder");
    expect(urlOfPage("app/ring-builder/page.tsx")).toBe("/ring-builder");
    expect(urlOfPage("app/(dashboard)/ring-builder/page.tsx")).toBe("/ring-builder");
    expect(urlOfPage("app/(dashboard)/catalog/ring-builder/page.tsx")).toBe("/catalog/ring-builder");
    expect(urlOfPage("app/(dashboard)/catalog/ring-builder/[id]/page.tsx")).toBe("/catalog/ring-builder/[id]");
    expect(urlOfPage("app/(quiz)/ring-builders/page.tsx")).toBe("/ring-builders");
    // หน้าหลังบ้านไม่ถูกนับเป็นหน้าสาธารณะ
    expect(pagesAt("/ring-builder").every((f) => !/\/catalog\//.test(f))).toBe(true);
  });
  it("ไม่ลาก lib/actions/** · lib/jobs/gems* · admin-server/admin-types", () => {
    const bad = files.map((f) => [f, FORBIDDEN(f)] as const).filter(([, why]) => why);
    expect(bad).toEqual([]);
  });
  it('ไม่มีไฟล์ "use server" ในกราฟ', () => {
    expect(files.filter((f) => isUseServer(readFileSync(join(ROOT, f), "utf8")))).toEqual([]);
  });
  it("จาก lib/ring-size import ตรงได้แค่ calibration.ts และ size.ts (ไฟล์ของ ring-builder)", () => {
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, "lib/ring-builder"))) {
      for (const spec of runtimeImports(readFileSync(f, "utf8"))) {
        if (/ring-size/.test(spec) && !/^@\/lib\/ring-size\/(calibration|size)$/.test(spec)) offenders.push(`${rel(f)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("ตัวจับจริง (กันเทสต์หลวม): กราฟของ lib/actions/ring-builder.ts มี admin-server.ts และ lib/actions — scanner เห็นของต้องห้ามจริง", () => {
    const adminFiles = [...closure([join(ROOT, "lib/ring-builder/admin-server.ts")])].map(rel);
    expect(adminFiles).toContain("lib/ring-builder/admin-server.ts");
    expect(adminFiles.map(FORBIDDEN).filter(Boolean).length).toBeGreaterThan(0);
    const actionFiles = [...closure([join(ROOT, "lib/actions/ring-builder.ts")])].map(rel);
    expect(actionFiles).toContain("lib/actions/ring-builder.ts");
    expect(isUseServer(readFileSync(join(ROOT, "lib/actions/ring-builder.ts"), "utf8"))).toBe(true);
  });
});

// sec#2: เทียบที่ "path ที่ resolve แล้ว" ไม่ใช่ข้อความในซอร์ส — ครอบ ./x · ../x · @/ · dynamic import · export … from · import ข้ามบรรทัด
interface Imp {
  spec: string;
  /** import type / export type / ทุกชื่อที่ import ขึ้นต้น type — ถูกลบตอน compile */
  typeOnly: boolean;
}
function allImports(src: string): Imp[] {
  const out: Imp[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const named = /^\{([^}]*)\}$/.exec(m[2].trim());
    const allNamedType = !!named && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    out.push({ spec: m[3], typeOnly: !!m[1] || allNamedType });
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push({ spec: m[1], typeOnly: false });
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], typeOnly: false });
  return out;
}
function resolveQuiet(spec: string, from: string): string | null {
  try {
    return resolveSpec(spec, from);
  } catch {
    return null;
  }
}
/** ไฟล์ทั้งแอป (app/lib/components ไม่รวม test) ที่ import ไฟล์ปลายทางนี้ — ตาม path ที่ resolve แล้ว */
function importersOf(target: string): { file: string; typeOnly: boolean }[] {
  const abs = join(ROOT, target);
  const out: { file: string; typeOnly: boolean }[] = [];
  for (const d of ["app", "lib", "components"]) {
    for (const f of walk(join(ROOT, d))) {
      for (const i of allImports(readFileSync(f, "utf8"))) {
        if (resolveQuiet(i.spec, f) === abs) out.push({ file: rel(f), typeOnly: i.typeOnly });
      }
    }
  }
  return out;
}

describe("importers ของไฟล์หลังบ้าน (resolve path ก่อนเทียบ)", () => {
  it("admin-server.ts: มีแค่ lib/actions/ring-builder.ts ที่ import (ไม่มีทางอื่นเข้า — ไม่ว่าเขียน path แบบไหน)", () => {
    expect([...new Set(importersOf("lib/ring-builder/admin-server.ts").map((i) => i.file))]).toEqual(["lib/actions/ring-builder.ts"]);
  });
  // admin-types = type อย่างเดียว — หน้าจอหลังบ้านต้องใช้ type ของ AdminCatalog · เปิดให้เฉพาะ action + 2 โฟลเดอร์ของหลังบ้าน (+ ไฟล์ admin-* ในโฟลเดอร์ lib/ring-builder เอง) และต้องเป็น import type
  it("admin-types.ts: import ได้เฉพาะ action + หลังบ้าน (components/domain/ring-builder/admin · app/(dashboard)/catalog/ring-builder · lib/ring-builder/admin-*) และต้องเป็น import type", () => {
    const allowed = (p: string) =>
      p === "lib/actions/ring-builder.ts" || p.startsWith("components/domain/ring-builder/admin/") || p.startsWith("app/(dashboard)/catalog/ring-builder/") || /^lib\/ring-builder\/admin-[a-z]+\.ts$/.test(p);
    const offenders: string[] = [];
    for (const i of importersOf("lib/ring-builder/admin-types.ts")) {
      if (!allowed(i.file)) offenders.push(`${i.file} (ไม่อยู่ในโฟลเดอร์หลังบ้าน)`);
      else if (!i.typeOnly) offenders.push(`${i.file} (ไม่ใช่ import type)`);
    }
    expect(offenders).toEqual([]);
  });
  it("admin-ui.ts (ตารางข้อความ + ตัวช่วยหลังบ้าน): ไม่อยู่ในกราฟสาธารณะ — importer เป็นหลังบ้าน/server admin เท่านั้น", () => {
    const allowed = (p: string) => p.startsWith("components/domain/ring-builder/admin/") || p.startsWith("app/(dashboard)/catalog/ring-builder/") || /^lib\/ring-builder\/admin-[a-z]+\.ts$/.test(p);
    expect(importersOf("lib/ring-builder/admin-ui.ts").map((i) => i.file).filter((f) => !allowed(f))).toEqual([]);
  });
  it("ตัวจับจริง (กันเทสต์หลวม): scanner เห็น importer ที่เขียนแบบ ./ และ dynamic import", () => {
    expect(importersOf("lib/ring-builder/util.ts").map((i) => i.file)).toContain("lib/ring-builder/quote-server.ts"); // import แบบ "./util"
    const imps = allImports('import type { A } from "../x";\nimport { type B, type C } from "./y";\nimport { D } from "./z";\nconst m = import("../w");\nexport * from "./v";\nimport {\n  E,\n} from "./u";');
    expect(imps).toEqual([
      { spec: "../x", typeOnly: true }, { spec: "./y", typeOnly: true }, { spec: "./z", typeOnly: false }, { spec: "./v", typeOnly: false }, { spec: "./u", typeOnly: false }, { spec: "../w", typeOnly: false },
    ]);
  });
  // N2: admin-types ต้องไม่มี export ที่เป็นค่า (const/let/var/function/class/enum/default) — กัน runtime code หลุดเข้าไปในไฟล์ที่ client import
  it("N2: admin-types.ts มีแต่ type/interface — ไม่มี export ค่า", () => {
    const src = readFileSync(join(ROOT, "lib/ring-builder/admin-types.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src.match(/^\s*export\s+(?:declare\s+)?(?:const|let|var|function|async|class|enum|default|\{|\*)/gm) ?? []).toEqual([]);
    expect(src.match(/^\s*export\s+(?:type|interface)\s/gm)?.length).toBeGreaterThan(5);
    expect(runtimeImports(src)).toEqual([]);
  });
});

describe("allowlist ของ PublicCatalog (mapper ประกอบทีละ field)", () => {
  const rawDesign = {
    no: 7, name: "แบบ ก", stone_count: 5, shape_kind: "oval", shape_name: "ไข่", major_mm100: 400, minor_mm100: 300, stone_axis: "across_row",
    size_min: 53, size_max: 68, body_price_thb: 480, card_image_path: "designs/0f0f0f0f-1111-2222-3333-444444444444.jpg",
    offers: [{ stone_no: 3, price_thb: 120, cost: 55, id: "x" }],
    // field ที่ "ต้องไม่หลุด" แม้ DB ส่งมา
    id: "uuid", shop_id: "uuid", is_active: true, published_at: "2026-01-01", cost_thb: 99, margin: 0.4, model: { x: 1 },
  };
  const raw = {
    catalog_at: "2026-11-10T03:00:00Z", sizes: { min: 45, max: 68 },
    stones: [{ no: 3, name: "โกเมน", short_name: "โกเมน", color_hex: "#7A1F2B", cost: 10, id: "uuid", group: "soft" }],
    designs: [rawDesign], extra_top: 1,
  };
  const cat = mapPublicCatalog(raw, "https://example.supabase.co");

  it("key ทุกระดับ = allowlist เป๊ะ", () => {
    expect(cat).not.toBeNull();
    if (!cat) return;
    expect(Object.keys(cat).sort()).toEqual([...PUBLIC_CATALOG_KEYS]);
    expect(Object.keys(cat.designs[0]).sort()).toEqual([...PUBLIC_DESIGN_KEYS]);
    expect(Object.keys(cat.designs[0].offers[0]).sort()).toEqual([...PUBLIC_OFFER_KEYS]);
    expect(Object.keys(cat.stones[0]).sort()).toEqual([...PUBLIC_STONE_KEYS]);
    expect(Object.keys(cat.designs[0].shape).sort()).toEqual(["kind", "name"]);
    expect(Object.keys(cat.designs[0].stoneMm100).sort()).toEqual(["major", "minor"]);
  });
  it("ไม่มีตัวเลข/ข้อความต้นทุนที่แอบมาใน JSON ที่ serialize แล้ว", () => {
    const text = JSON.stringify(cat);
    for (const leaked of ["cost", "margin", "uuid", "is_active", "published_at", "shop_id", "extra_top", '"id"', "group"]) expect(text).not.toContain(leaked);
    expect(text).not.toContain("55");
  });
  it("ค่า: stoneLabel/cardImageUrl/model ประกอบที่ server", () => {
    const d = cat?.designs[0];
    expect(d?.stoneLabel).toBe("4×3");
    expect(d?.model).toEqual({ kind: "none" });
    expect(d?.cardImageUrl).toBe("https://example.supabase.co/storage/v1/object/public/ring-builder/designs/0f0f0f0f-1111-2222-3333-444444444444.jpg");
    expect(d?.stoneAxis).toBe("across_row");
  });
  it("ผิดรูป ⇒ ข้ามแถว (fail closed) · โครงบนสุดผิด ⇒ null", () => {
    const bad = { ...raw, designs: [rawDesign, { ...rawDesign, no: 8, body_price_thb: 0 }, { ...rawDesign, no: 9, shape_kind: "star" }, { ...rawDesign, no: 10, major_mm100: 200, minor_mm100: 300 }, { ...rawDesign, no: 11, size_min: 60, size_max: 50 }, { ...rawDesign, no: 12, shape_kind: "oval", stone_axis: null }, "x", null] };
    expect(mapPublicCatalog(bad, null)?.designs.map((d) => d.no)).toEqual([7]);
    for (const v of [null, undefined, "x", [], {}, { ...raw, catalog_at: "yesterday" }, { ...raw, sizes: null }, { ...raw, stones: {} }]) expect(mapPublicCatalog(v, null)).toBeNull();
  });
  it("cardImageUrl: path ผิดรูป/traversal/ไม่มี env ⇒ null", () => {
    for (const p of ["designs/../x.jpg", "x/0f0f0f0f-1111-2222-3333-444444444444.jpg", "designs/0f0f0f0f-1111-2222-3333-444444444444.png", null, 5]) {
      expect(cardImageUrl(p, "https://example.supabase.co")).toBeNull();
    }
    expect(cardImageUrl("designs/0f0f0f0f-1111-2222-3333-444444444444.jpg", null)).toBeNull();
  });
  it("ทรงกลมไม่มีทิศ (แม้ DB ส่งมา)", () => {
    const c = mapPublicCatalog({ ...raw, designs: [{ ...rawDesign, shape_kind: "round", major_mm100: 200, minor_mm100: 200, stone_axis: "along_row" }] }, null);
    expect(c?.designs[0].stoneAxis).toBeNull();
  });
});
