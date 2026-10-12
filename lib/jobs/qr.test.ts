// QR (vendored uqr@0.1.3): ผลเป็น SVG ล้วน · ไม่มีสคริปต์ · โค้ดที่ vendor ไม่แตะเครือข่าย/ไฟล์/eval
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderQrSvg, workerUrl } from "./qr";

describe("workerUrl", () => {
  it("origin + /w/ + token (ตัด / ท้าย origin)", () => {
    expect(workerUrl("https://app.example.test/", "TOK")).toBe("https://app.example.test/w/TOK");
    expect(workerUrl("https://app.example.test", "TOK")).toBe("https://app.example.test/w/TOK");
  });
});

describe("renderQrSvg", () => {
  const url = workerUrl("https://app.example.test", "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY");
  const svg = renderQrSvg(url);
  it("เป็น SVG ที่มี viewBox (ขยายตามกรอบได้) พื้นขาว โมดูลดำ", () => {
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });
  it("ไม่มีสคริปต์/handler/ลิงก์ภายนอก และ token ไม่ปรากฏเป็นข้อความใน SVG (อยู่ในรูปโมดูลเท่านั้น)", () => {
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/<script|onload|onerror|javascript:|xlink:href|<image|<foreignObject|https?:\/\//i);
    expect(svg).not.toContain("Ab3-_xYz");
  });
  it("ข้อมูลต่างกัน → ภาพต่างกัน · ข้อมูลเดียวกัน → ภาพเดิม (deterministic)", () => {
    expect(renderQrSvg(url)).toBe(svg);
    expect(renderQrSvg(url + "x")).not.toBe(svg);
  });
  it("URL ยาว ~70 ตัวอักษร ได้ QR ขนาดไม่เกิน version 6 (≤ 41 โมดูล) — พิมพ์ ≥ 35 มม. สแกนง่าย", () => {
    const m = /viewBox="0 0 (\d+) \d+"/.exec(svg)!;
    const modules = Number(m[1]) / 8;
    expect(modules).toBeLessThanOrEqual(45); // 41 + quiet zone 2×2
  });
});

describe("vendor/uqr — supply chain", () => {
  const dir = join(process.cwd(), "lib", "vendor", "uqr");
  const src = readFileSync(join(dir, "index.mjs"), "utf8");
  it("ไม่มี network/fs/process/eval/dynamic import ในซอร์สที่ vendor", () => {
    for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /require\s*\(/, /\bimport\s*\(/, /\beval\s*\(/, /new Function/, /process\./, /child_process/, /\bfs\b/, /WebSocket/]) {
      expect(src, String(bad)).not.toMatch(bad);
    }
    expect(src.match(/^import /gm)).toBeNull(); // ไม่มี dependency
  });
  it("เป็นไฟล์เดิมจาก tarball uqr@0.1.3 (sha256 ล็อกไว้ — แก้ไฟล์ = เทสต์ล้ม ต้องไปตรวจ supply chain ใหม่)", () => {
    const h = createHash("sha256").update(readFileSync(join(dir, "index.mjs"))).digest("hex");
    expect(h.startsWith("7f0e61c2f13bb372")).toBe(true);
  });
  it("README ระบุเวอร์ชัน + integrity", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("uqr 0.1.3");
    expect(readme).toContain("sha512-0rjE8iEJe4YmT9TOhwsZtqCMRLc5DXZUI2UEYUUg63ikBkqqE5EYWaI0etFe/5KUcmcYwLih2RND1kq+hrUJXA==");
  });
});
