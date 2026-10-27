// lib/ring-size/no-camera-code.test.ts — ทำให้คำสัญญา "หน้านี้ไม่ใช้กล้อง" เป็นจริงด้วยโค้ด (build spec ข้อ 3.4 · A8)
//
// กวาดไฟล์ที่ส่งขึ้นจริงใต้ app/(quiz)/ring-size/** + lib/ring-size/** ด้วย regex ต้องว่าง
// + เดิน import graph จริงจาก entry ของหน้า (รวม dependency ที่ import เข้ามา) — ไฟล์ในโปรเจกต์ที่ถูกลากเข้ามา
//   ต้องไม่มีโค้ดกล้องด้วย และแพ็กเกจภายนอกที่ import ได้มีแค่ react / next (กันไลบรารี QR/สแกนเนอร์หลุดเข้ามา)
// รูปแบบเดียวกับ lib/auth/exempt-graph.test.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RING_APP_DIR, RING_LIB_DIR, ROOT, listSources, readStripped, rel } from "./source-scan.test-util";

const CAMERA_RE = /getUserMedia|mediaDevices|capture\s*=|type\s*=\s*["']file["']|BarcodeDetector/;
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const ALLOWED_PACKAGES = new Set(["react", "next", "next/font/google", "react/jsx-runtime"]);

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`resolve ไม่เจอ: ${spec} (จาก ${rel(from)})`);
}

function walkGraph(entries: string[]): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const pkgs = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(tsx?|m?js)$/.test(f)) continue;
    // ตัดคอมเมนต์ก่อน: ข้อความในคอมเมนต์ที่เขียนว่า import ... ไม่ใช่ import จริง
    for (const m of readStripped(f).matchAll(IMPORT_RE)) {
      const spec = (m[1] ?? m[2] ?? m[3]) as string;
      const local = resolveLocal(f, spec);
      if (local) stack.push(local);
      else pkgs.add(spec);
    }
  }
  return { files: [...seen], packages: [...pkgs].sort() };
}

describe("A8: ไม่มีโค้ดเรียกกล้องใน ring-size", () => {
  it("ซอร์สที่ส่งขึ้นจริงใต้ app/(quiz)/ring-size/** และ lib/ring-size/** ไม่มี getUserMedia · mediaDevices · capture= · input type=file · BarcodeDetector", () => {
    const files = [...listSources(RING_APP_DIR), ...listSources(RING_LIB_DIR)];
    expect(files.length).toBeGreaterThan(20); // กันสแกนว่างแล้วผ่านเงียบๆ
    const hits = files.filter((f) => CAMERA_RE.test(readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });

  it("negative control: regex จับของจริงได้ทุกแบบ (ไม่ใช่ false-negative เงียบๆ)", () => {
    for (const bad of [
      "navigator.mediaDevices.getUserMedia({video:true})",
      "const s = await navigator.mediaDevices",
      '<input type="file" capture="environment" />',
      "<input type='file' />",
      "new BarcodeDetector()",
      "input.capture = 'user'",
    ]) {
      expect(CAMERA_RE.test(bad), bad).toBe(true);
    }
    // และไม่จับโค้ดปกติที่หน้านี้ใช้จริง
    expect(CAMERA_RE.test("e.currentTarget.setPointerCapture(e.pointerId)")).toBe(false);
    expect(CAMERA_RE.test('<input type="range" />')).toBe(false);
  });

  it("import graph จากหน้า: ไฟล์ในโปรเจกต์ที่ลากเข้ามาไม่มีโค้ดกล้อง · แพ็กเกจภายนอกมีแค่ react/next", () => {
    const { files, packages } = walkGraph([
      join(RING_APP_DIR, "page.tsx"),
      join(RING_APP_DIR, "layout.tsx"),
      join(RING_APP_DIR, "RingSizeClient.tsx"),
    ]);
    expect(files.length).toBeGreaterThan(30);
    const hits = files.filter((f) => /\.(tsx?|m?js)$/.test(f) && CAMERA_RE.test(readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
    const outside = packages.filter((p) => !ALLOWED_PACKAGES.has(p) && !p.startsWith("node:"));
    expect(outside).toEqual([]);
  });

  it("graph ของหน้าไม่ลากไฟล์นอกขอบเขต (ต้องเป็น app/(quiz)/ring-size · lib/ring-size · lib/shop/line.ts เท่านั้น)", () => {
    const { files } = walkGraph([join(RING_APP_DIR, "page.tsx"), join(RING_APP_DIR, "layout.tsx"), join(RING_APP_DIR, "RingSizeClient.tsx")]);
    const outside = files
      .map(rel)
      .filter((p) => !p.startsWith("app/(quiz)/ring-size/") && !p.startsWith("lib/ring-size/") && p !== "lib/shop/line.ts");
    expect(outside).toEqual([]);
  });
});
