// 🔴 ขอบเขตราคาพลอย (G1a UI): ราคา = ต้นทุน — ต้องอยู่เฉพาะ /oem/gems (owner/admin)
//  1) กราฟ import (runtime — ไม่นับ `import type`) ของ หน้าช่าง (WorkerApp) และใบพิมพ์ (JobPrintClient) ต้องไม่ลาก lib/jobs/gems.ts (ตัวแปลงราคา) / lib/actions/gems.ts / หน้าแคตตาล็อกพลอย เข้า bundle สาธารณะ/ติดถุงงาน
//  2) ฟอร์มที่ staff ใช้ได้ (ตัวแก้พลอย · ฟอร์มสร้างใบงาน · การ์ดพลอยบนใบงาน · แม่แบบ SKU) ต้องไม่ import จอราคา (GemPriceDialog · GemItemsTable · GemItemDetailDialog · GemCatalogClient)
//  3) จอราคาถูก import ได้จากหน้า /oem/gems เท่านั้น
//  4) ไฟล์ที่ประกอบส่วนพลอยของใบ/ช่าง/A5 ไม่มีชื่อ field ราคา
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");

/** directive "use server" ต้องอยู่ต้นไฟล์ (หลังคอมเมนต์ได้) — ไม่ใช่โผล่บรรทัดไหนก็ได้ (กันข้อความในคอมเมนต์/สตริงถูกนับเป็น directive แล้วตัดกราฟทิ้งเงียบๆ) */
const isUseServer = (src: string): boolean => /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*["']use server["']/.test(src);

/** import แบบ runtime (ไม่นับ `import type` / `export type`) — alias "@/" และ relative เท่านั้น */
function runtimeImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (m[2]) continue;
    // import { type A, type B } — ทุกตัวเป็น type = ถูกลบตอน compile
    const named = /^\{([^}]*)\}$/.exec(m[3].trim());
    if (named && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[4]);
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  // dynamic import("...") ก็ลากโมดูลเข้า bundle (lazy chunk)
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
  return null;
}

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    // ไฟล์ "use server": ฝั่ง client ได้แค่ตัวอ้างอิง action (stub) — โค้ดและ import ข้างในไม่ขึ้น bundle ของ client → ไม่เดินต่อ
    if (isUseServer(src)) continue;
    for (const spec of runtimeImports(src)) {
      const r = resolveSpec(spec, f);
      if (r) stack.push(r);
    }
  }
  return seen;
}

const PRICE_MODULES = ["lib/jobs/gems.ts", "lib/actions/gems.ts", "lib/jobs/gems-server.ts"];
const PRICE_SCREENS = ["components/domain/gems/GemPriceDialog.tsx", "components/domain/gems/GemItemsTable.tsx", "components/domain/gems/GemItemDetailDialog.tsx", "components/domain/gems/GemCatalogClient.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("ราคาพลอยไม่เข้า bundle หน้าช่าง/ใบพิมพ์", () => {
  for (const entry of ["components/domain/jobs/worker/WorkerApp.tsx", "components/domain/jobs/JobPrintClient.tsx", "components/domain/jobs/worker/WorkerGemsCard.tsx", "components/domain/jobs/JobSheetGems.tsx"]) {
    it(`${entry} — กราฟ runtime ไม่มี ${PRICE_MODULES.join(" · ")} หรือจอราคา`, () => {
      const files = [...closure(join(ROOT, entry))].map(rel);
      expect(files, entry).toContain(entry);
      for (const bad of [...PRICE_MODULES, ...PRICE_SCREENS, "components/domain/gems/GemRowsEditor.tsx", "components/domain/gems/GemPicker.tsx"]) {
        expect(files, `${entry} ลาก ${bad}`).not.toContain(bad);
      }
    });
  }
  it("ตัวจับจริง: closure ของ GemCatalogClient มี lib/actions/gems.ts และ GemPriceDialog (กันเทสต์หลวม)", () => {
    const files = [...closure(join(ROOT, "components/domain/gems/GemCatalogClient.tsx"))].map(rel);
    expect(files).toContain("lib/actions/gems.ts");
    expect(files).toContain("components/domain/gems/GemPriceDialog.tsx");
  });
});

describe("ฟอร์มที่ staff ใช้ได้ไม่ import จอราคา", () => {
  for (const entry of [
    "components/domain/gems/GemRowsEditor.tsx",
    "components/domain/gems/GemPicker.tsx",
    "components/domain/jobs/JobCreateGems.tsx",
    "components/domain/jobs/JobCreateDialog.tsx",
    "components/domain/jobs/JobGemsCard.tsx",
    "components/domain/jobs/JobGemsEditDialog.tsx",
    "components/domain/catalog/SkuGemBomDialog.tsx",
  ]) {
    it(`${entry} — กราฟ runtime ไม่มีจอราคา`, () => {
      const files = [...closure(join(ROOT, entry))].map(rel);
      for (const bad of PRICE_SCREENS) expect(files, `${entry} ลาก ${bad}`).not.toContain(bad);
    });
  }
});

describe("จอราคา import ได้จากหน้า /oem/gems เท่านั้น", () => {
  it("ไม่มีไฟล์นอก components/domain/gems/ และ app/(dashboard)/oem/gems/ import จอราคา", () => {
    const names = PRICE_SCREENS.map((s) => s.split("/").pop()!.replace(/\.tsx$/, ""));
    const allowedDirs = ["components/domain/gems/", "app/(dashboard)/oem/gems/"];
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))];
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) {
      const r = rel(f);
      if (allowedDirs.some((d) => r.startsWith(d))) continue;
      const code = strip(readFileSync(f, "utf8"));
      for (const n of names) expect(new RegExp(`from\\s+["'][^"']*/${n}["']|import\\(\\s*["'][^"']*/${n}["']`).test(code), `${r} import ${n}`).toBe(false);
    }
  });
  it("ภายใน components/domain/gems/ มีเฉพาะไฟล์ของแคตตาล็อกที่ import จอราคา (ตัวแก้พลอยร่วมไม่ import)", () => {
    const shared = ["GemRowsEditor", "GemPicker", "GemSizeFields", "GemSimilarPrompt", "GemNewShapeAsk", "GemConfirm", "useGemFail", "useGemOptions", "ui"];
    for (const n of shared) {
      const f = join(ROOT, "components/domain/gems", n.endsWith("ui") || n.startsWith("use") ? (existsSync(join(ROOT, "components/domain/gems", `${n}.tsx`)) ? `${n}.tsx` : `${n}.ts`) : `${n}.tsx`);
      const code = strip(readFileSync(f, "utf8"));
      for (const s of ["GemPriceDialog", "GemItemsTable", "GemItemDetailDialog", "GemCatalogClient", "fmtGemPrice"]) expect(code.includes(s), `${rel(f)} อ้าง ${s}`).toBe(false);
    }
  });
});

describe("worker-view.ts: ส่วนพลอย (WorkerGem · mapGem) ไม่มี field ราคา", () => {
  // ไฟล์นี้มีรายชื่อ key ต้องห้าม (findForbiddenKeys) ที่มีคำเรื่องราคาอยู่แล้วโดยตั้งใจ — ตรวจเฉพาะท่อนของพลอย
  const src = strip(readFileSync(join(ROOT, "lib/jobs/worker-view.ts"), "utf8"));
  const slice = (from: string, to: string) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    expect(a, from).toBeGreaterThan(-1);
    expect(b, to).toBeGreaterThan(a);
    return src.slice(a, b);
  };
  it("interface WorkerGem = 4 key เท่านั้น", () => {
    const body = slice("export interface WorkerGem", "export const MY_ACTION_KINDS");
    expect(body.match(/^\s*(\w+)\??:/gm)?.map((m) => m.replace(/[\s?:]/g, ""))).toEqual(["label", "qtyPerPiece", "qtyTotal", "position"]);
  });
  it("mapGem อ่านเฉพาะ label · qty_per_piece · qty_total · position", () => {
    const body = slice("function mapGem", "function mapPart");
    const read = [...body.matchAll(/raw\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(read)].sort()).toEqual(["label", "position", "qty_per_piece", "qty_total"]);
  });
});

describe("ตัวจับ directive 'use server' ต้องอยู่ต้นไฟล์", () => {
  it("จับของจริง (หลังคอมเมนต์หัวไฟล์ได้) · ไม่จับข้อความในคอมเมนต์/สตริงกลางไฟล์", () => {
    expect(isUseServer('"use server";\nimport x from "y";')).toBe(true);
    expect(isUseServer('// หัวไฟล์\n/* บล็อก */\n"use server";\nexport {}')).toBe(true);
    expect(isUseServer('import x from "y";\n// "use server" ในคอมเมนต์\nconst s = 1;')).toBe(false);
    expect(isUseServer('import x from "y";\n"use server";\n')).toBe(false);
    expect(isUseServer('const note = `\n"use server"\n`;')).toBe(false);
  });
});

describe("ไฟล์ส่วนพลอยของใบ/ช่าง/A5 ไม่มี field ราคา", () => {
  const FILES = [
    "components/domain/jobs/worker/WorkerGemsCard.tsx",
    "components/domain/jobs/JobSheetGems.tsx",
    "components/domain/jobs/JobCreateGems.tsx",
    "components/domain/jobs/JobGemsCard.tsx",
    "components/domain/jobs/JobGemsEditDialog.tsx",
    "components/domain/jobs/GemTemplateDiffDialog.tsx",
    "components/domain/catalog/SkuGemBomDialog.tsx",
    "components/domain/gems/GemRowsEditor.tsx",
    "components/domain/gems/GemPicker.tsx",
    "lib/jobs/gem-draft.ts",
    "lib/jobs/gem-wire.ts",
    "lib/jobs/print-gems.ts",
    // ชั้นที่ประกอบข้อมูลพลอยส่งให้ช่าง/ใบพิมพ์/การ์ดใบงาน (type boundary) — ห้ามมีชื่อ field ราคา
    "lib/jobs/print.ts",
    "lib/jobs/gems-server.ts",
    "components/domain/jobs/JobPrintClient.tsx",
  ];
  for (const f of FILES) {
    it(f, () => {
      const code = strip(readFileSync(join(ROOT, f), "utf8"));
      expect(/\bprice\b|unit_cost|unitCost|breakage|supplier|oem_tier|\bcost\b|priceEffectiveFrom|hasPrice/i.test(code), `${f} มีชื่อ field ราคา`).toBe(false);
    });
  }
});

// 0191 W3: ชั้นสาธารณะของหน้างาน (QR ร้าน + PIN — action/ชั้น server ที่ผู้จัดการกรอกพลอย) ต้องไม่ import ตัวแปลงราคา/แคตตาล็อกฝั่งออฟฟิศ แม้แต่ import type
// (allowlist แถวพลอยย้ายไป lib/jobs/gem-wire.ts เพื่อเหตุนี้ — gems.ts มี mapGemCatalog/mapGemPriceHistory)
describe("W3: ชั้นสาธารณะของหน้างานไม่ import ตัวแปลงราคา (gems.ts · actions/gems.ts · gems-server.ts)", () => {
  const PUBLIC_GEM_FILES = ["lib/actions/job-worker.ts", "lib/jobs/worker-server.ts", "lib/jobs/shop-photo-server.ts", "lib/jobs/gem-wire.ts"];
  for (const f of PUBLIC_GEM_FILES) {
    it(`${f} — ไม่มี import ตัวแปลงราคา`, () => {
      const code = strip(readFileSync(join(ROOT, f), "utf8"));
      expect(/from\s+["']@\/lib\/(?:jobs\/gems|actions\/gems|jobs\/gems-server)["']|import\(\s*["']@\/lib\/(?:jobs\/gems|actions\/gems|jobs\/gems-server)["']\s*\)/.test(code), `${f} import ตัวแปลงราคา/แคตตาล็อกออฟฟิศ`).toBe(false);
    });
  }
  it("ตัวจับจริง: lib/actions/gems.ts (ฝั่งออฟฟิศ) import lib/jobs/gems — เทสต์ข้างบนไม่ว่างเปล่า", () => {
    const code = strip(readFileSync(join(ROOT, "lib/actions/gems.ts"), "utf8"));
    expect(/from\s+["']@\/lib\/jobs\/gems["']/.test(code)).toBe(true);
  });
  it("gem-wire.ts ไม่ import อะไรเลย (pure ล้วน) · gems.ts re-export toWireGemLines จากที่นี่ (import เดิมของออฟฟิศใช้ต่อได้)", () => {
    expect(runtimeImports(readFileSync(join(ROOT, "lib/jobs/gem-wire.ts"), "utf8"))).toEqual([]);
    expect(/export\s*\{\s*toWireGemLines\s*\}\s*from\s*["']@\/lib\/jobs\/gem-wire["']/.test(readFileSync(join(ROOT, "lib/jobs/gems.ts"), "utf8"))).toBe(true);
  });
});
