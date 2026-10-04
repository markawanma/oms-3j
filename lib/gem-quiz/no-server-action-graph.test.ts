// lib/gem-quiz/no-server-action-graph.test.ts
//
// Security audit finding M2 (4 ต.ค. 69): design doc §1.2 ตั้งใจให้กฎ "ห้าม
// import ไฟล์ "use server" เข้า app/(quiz)/** หรือ lib/gem-quiz/**" เป็นกฎ
// โครงสร้าง ไม่ใช่วินัย — แต่จนถึงตอนนี้มีแค่คอมเมนต์ + grep มือ ไม่มีด่าน
// อัตโนมัติจริง ถ้าวันหน้า frontend-dev import component กลางที่บังเอิญดึง
// ไฟล์ "use server" มาทางอ้อม export ทุกตัวในไฟล์นั้นจะกลายเป็น Server Action
// ที่รันได้โดยไม่ผ่าน middleware เลย (เพราะ /gem-quiz ถูก exempt จาก auth gate
// — ดู middleware.ts §1.2/F3) เทสต์นี้เดิน import graph จริงแบบ transitive
// จาก entry point ทุกตัวที่หน้า /gem-quiz จะโหลด แล้วยืนยันว่าไม่มีไฟล์ไหนมี
// "use server" directive เลย
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
    .map((f) => relative(ROOT, f).split("\\").join("/"))
    .sort();
}

describe("R-9: module graph ของหน้าสาธารณะ gem-quiz ห้ามมี Server Action", () => {
  it("app/(quiz)/** + lib/gem-quiz/** + app/layout.tsx ไม่ไปถึงไฟล์ 'use server' เลย", () => {
    const entries = [
      ...listFiles(join(ROOT, "app", "(quiz)")),
      ...listFiles(join(ROOT, "lib", "gem-quiz")),
      join(ROOT, "app", "layout.tsx"),
    ];
    expect(serverActionModulesReachableFrom(entries)).toEqual([]);
  });

  it("negative control: /stock/hero (หน้า exempt อื่นที่มี server action อยู่แล้ว) ต้องจับได้ว่ามี", () => {
    // ยืนยันว่า scanner ตัวนี้ทำงานจริง ไม่ใช่ false-negative เงียบๆ — ถ้าเทสต์นี้
    // เริ่ม FAIL (ไม่เจอ server action ใน /stock/hero) แปลว่า scanner พังไปแล้ว
    const entries = [join(ROOT, "app", "(dashboard)", "stock", "hero", "page.tsx")];
    const found = serverActionModulesReachableFrom(entries);
    expect(found.length).toBeGreaterThan(0);
  });
});
