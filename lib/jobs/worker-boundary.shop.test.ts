// 🔴 ขอบเขตของหน้า /w/s/<shopToken> (W1 — ช่องสาธารณะที่ "สร้างข้อมูล"):
//   1) กราฟ import ทั้งเส้น (transitive) ของหน้านี้ต้องไม่ลากโมดูลใบผลิต/OEM/แคตตาล็อก/ออฟฟิศเข้ามา (เทสต์เดิมตรวจแค่ import ตรงของไฟล์ — ไม่จับ "ยืมผ่านไฟล์กลาง")
//      เหตุผลที่ MetalSpecFields/MetalTag ของจอใบผลิตเอามาใช้ตรงไม่ได้: มันลาก lib/production/* + lib/oem/* (รูปร่างต้นทุน/margin) ขึ้น client bundle สาธารณะ
//   2) "use server" ในกราฟ = lib/actions/job-worker.ts ไฟล์เดียว
//   3) หน้านี้ import ได้แค่ lib/actions/job-worker.ts เป็น action (ไม่มี job-workers/production/job-office)
//   4) type/โค้ดทั้งโฟลเดอร์ไม่มี field/ข้อความเกี่ยวกับเงิน (ราคา/ต้นทุน/margin/บาท/฿)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const norm = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");

/** รวม import แบบ runtime (ไม่นับ `import type`) จากไฟล์ — คืนเฉพาะ alias "@/" และ relative */
function runtimeImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (m[2]) continue; // import type — ถูกลบตอน compile ไม่เข้า bundle
    out.push(m[4]);
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null; // package ภายนอก
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.mjs")]) {
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
    if (!/\.(ts|tsx|mjs)$/.test(f)) continue;
    for (const spec of runtimeImports(readFileSync(f, "utf8"))) {
      const r = resolveSpec(spec, f);
      if (r) stack.push(r);
    }
  }
  return seen;
}

const ENTRY = join(ROOT, "app", "(worker)", "w", "s", "[shopToken]", "page.tsx");
const FORBIDDEN_PREFIX = ["lib/production/", "lib/oem/", "lib/catalog/", "components/domain/production/", "components/domain/oem/", "lib/auth/", "lib/dev/", "lib/jobs/office-server", "lib/jobs/page-gate", "lib/actions/job-office", "lib/actions/job-workers", "lib/actions/production", "lib/actions/oem"];

describe("หน้า /w/s/<shopToken> — กราฟ import ทั้งเส้น (transitive)", () => {
  const files = closure(ENTRY);
  const rels = [...files].map(norm);

  it("พบหน้า + วิซาร์ด + ตรรกะ pure ในกราฟ (กันเทสต์ว่างเปล่า)", () => {
    expect(rels).toContain("app/(worker)/w/s/[shopToken]/page.tsx");
    expect(rels).toContain("components/domain/jobs/worker/shop/ShopIntakeApp.tsx");
    expect(rels).toContain("components/domain/jobs/worker/shop/ShopOpenFlow.tsx");
    expect(rels).toContain("lib/jobs/shop-open.ts");
    expect(rels).toContain("lib/actions/job-worker.ts");
    expect(rels).toContain("lib/jobs/worker-server.ts");
    expect(rels).toContain("components/ui/PurityPctInput.tsx");
  });

  it("ไม่มีไฟล์ใดในกราฟอยู่ใต้ lib/production · lib/oem · lib/catalog · components/domain/production|oem · session ของแอป · action ออฟฟิศ", () => {
    for (const r of rels) for (const p of FORBIDDEN_PREFIX) expect(r.startsWith(p), `${r} อยู่ในกราฟสาธารณะ — ห้าม (${p})`).toBe(false);
  });

  it("'use server' ในกราฟ = lib/actions/job-worker.ts ไฟล์เดียว", () => {
    const servers = [...files].filter((f) => /\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/m.test(readFileSync(f, "utf8"))).map(norm);
    expect(servers).toEqual(["lib/actions/job-worker.ts"]);
  });

  it("ไฟล์ใต้ lib/actions ที่หน้านี้ import ได้มีตัวเดียว (job-worker)", () => {
    expect(rels.filter((r) => r.startsWith("lib/actions/"))).toEqual(["lib/actions/job-worker.ts"]);
  });

  it("ตัวจับกราฟทำงานจริง: จำลองไฟล์ที่ import production จะถูกจับ", () => {
    // ตรวจที่ตัวแยก import เอง (ไม่เขียนไฟล์ลง repo): `import type` ไม่นับ · import ธรรมดานับ
    expect(runtimeImports(`import type { X } from "@/lib/production/types";`)).toEqual([]);
    expect(runtimeImports(`import { X } from "@/lib/production/types";`)).toEqual(["@/lib/production/types"]);
    expect(runtimeImports(`export { X } from "@/lib/oem/types";`)).toEqual(["@/lib/oem/types"]);
  });
});

describe("โฟลเดอร์ shop + shop-open.ts — ไม่มีเรื่องเงินในโค้ด (ตั้งแต่ type)", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
  }
  const shopFiles = [...walk(join(ROOT, "components", "domain", "jobs", "worker", "shop")), join(ROOT, "app", "(worker)", "w", "s", "[shopToken]", "page.tsx")];
  const MONEY = /ราคา|ต้นทุน|บาท|฿|\bTHB\b|price|cost|margin|baht|unitCost|\bthb\b/i;

  it("พบไฟล์ shop ครบ (กันเทสต์ว่างเปล่า)", () => {
    expect(shopFiles.length).toBeGreaterThanOrEqual(12);
  });
  for (const f of shopFiles) {
    it(norm(f), () => {
      const code = stripComments(readFileSync(f, "utf8"));
      expect(MONEY.test(code), `${norm(f)} มีคำ/field เกี่ยวกับเงิน`).toBe(false);
    });
  }
  it("shop-open.ts: คำเกี่ยวกับเงินมีได้ที่เดียว = regex ตัวกรองข้อความ (isCleanMessage) ที่ใช้ปฏิเสธข้อความที่มีเงิน", () => {
    const code = stripComments(readFileSync(join(ROOT, "lib", "jobs", "shop-open.ts"), "utf8"));
    const hits = code.split("\n").filter((l) => MONEY.test(l));
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatch(/\.test\(t\)/);
  });
});
