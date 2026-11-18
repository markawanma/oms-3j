// lib/fonts/self-host-fonts.test.ts — ฟอนต์ต้อง self-host (18 พ.ย. 69: Vercel build พัง 3 ครั้งจาก next/font/google fetch)
// 1) ไม่มี next/font/google ในโค้ด  2) ทุก path ใน localFont ชี้ไฟล์ที่มีจริงและเป็น woff2 จริง (magic "wOF2")
// 3) tailwind stack ของ font-sans / quiz-* อ้างทั้งตัวแปร latin และ thai · latin มาก่อน thai · และตัวแปรทุกตัวมี layout ประกาศจริง
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LAYOUTS = [join(ROOT, "app", "layout.tsx"), join(ROOT, "app", "(quiz)", "layout.tsx")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (["node_modules", ".next", ".git", ".claude"].includes(n)) return [];
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|mjs|js)$/.test(p) ? [p] : [];
  });
}

describe("self-host fonts", () => {
  it("ไม่มีโค้ดไหน import next/font/google", () => {
    const hits = ["app", "components", "lib"]
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => !f.endsWith("self-host-fonts.test.ts"))
      .filter((f) => /next\/font\/google/.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "")));
    expect(hits).toEqual([]);
  });

  it("ทุก path ใน localFont ชี้ไฟล์ woff2 จริง", () => {
    let n = 0;
    for (const layout of LAYOUTS) {
      const code = readFileSync(layout, "utf8");
      for (const m of code.matchAll(/path:\s*"([^"]+\.woff2)"/g)) {
        const p = resolve(dirname(layout), m[1]);
        expect(existsSync(p), p).toBe(true);
        expect(readFileSync(p).subarray(0, 4).toString("latin1"), p).toBe("wOF2");
        n++;
      }
    }
    expect(n).toBe(12); // root: Noto Sans Thai 2 · quiz: Cormorant 2 + Noto Serif Thai 2 + IBM Plex 6
  });

  it("ตัวแปรใน tailwind stack ทุกตัวถูกประกาศใน layout และ latin มาก่อน thai", () => {
    const declared = new Set(LAYOUTS.flatMap((l) => [...readFileSync(l, "utf8").matchAll(/variable:\s*"(--[\w-]+)"/g)].map((m) => m[1])));
    const ff = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>;
    for (const key of ["sans", "quiz-display", "quiz-serif", "quiz-sans"]) {
      const vars = ff[key].filter((v) => v.startsWith("var(")).map((v) => /var\((--[\w-]+)\)/.exec(v)![1]);
      for (const v of vars) expect(declared.has(v), `${key} → ${v}`).toBe(true);
    }
    for (const key of ["sans", "quiz-serif", "quiz-sans"]) {
      const vars = ff[key].filter((v) => v.startsWith("var("));
      expect(vars).toHaveLength(2);
      expect(vars[0]).toMatch(/-latin\)$/);
      expect(vars[1]).toMatch(/-thai\)$/);
    }
  });

  it("layout ใส่ class .variable ครบทุก call (ไม่ลืมตัวแปรใดใน className)", () => {
    for (const layout of LAYOUTS) {
      const code = readFileSync(layout, "utf8");
      const names = [...code.matchAll(/const (\w+) = localFont\(/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      for (const nm of names) expect(code, nm).toContain(`\${${nm}.variable}`);
    }
  });
});
