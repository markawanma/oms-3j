// หน้าช่าง /w/<token> (J1) — exempt แบบ prefix ที่แคบที่สุด: เซกเมนต์เดียวต่อท้าย /w/ ที่เป็น base64url ล้วน
// ต้องไม่เปิดช่องให้ traversal / look-alike / subtree หลุด gate — และต้องไม่พังกับ token จริง
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isExemptPath } from "./exempt-path";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY"; // 43 ตัว base64url

describe("isExemptPath — /w/<token> ต้อง exempt", () => {
  it.each([`/w/${TOKEN}`, `/w/${TOKEN}/`, "/w/abc", "/w/A", "/w/a-b_c-D"])("%s", (p) => {
    expect(isExemptPath(p)).toBe(true);
  });
});

describe("isExemptPath — /w ที่ห้ามหลุด gate (traversal · look-alike · subtree)", () => {
  it.each([
    ["/w", "ไม่มี /"],
    ["/w/", "ไม่มี token"],
    ["/wx", "look-alike ขึ้นต้นด้วย w"],
    ["/wx/abc", "look-alike มี subpath"],
    ["/wallet", "ขึ้นต้นด้วย w"],
    ["/w/../oem", "traversal"],
    ["/w/../oem/quotes", "traversal ลึก"],
    ["/w/%2e%2e/oem", "traversal แบบเข้ารหัส"],
    ["/w/%2E%2E/jobs", "traversal แบบเข้ารหัสตัวใหญ่"],
    ["/w/./jobs", "จุดเดียว"],
    ["/w/abc/def", "เซกเมนต์ซ้อน (ไม่มีหน้าในแอปที่ต้อง exempt)"],
    [`/w/${TOKEN}/jobs`, "ต่อท้ายหลัง token"],
    ["/w//oem", "slash ซ้อน"],
    ["/w/abc%2Fdef", "slash เข้ารหัส"],
    ["/w/abc def", "ช่องว่าง"],
    ["/w/abc?x=1", "query ติดอยู่ในพาธ (pathname ปกติไม่มี — กันไว้)"],
    ["/jobs", "หน้าออฟฟิศ"],
    ["/jobs/w/abc", "/w ซ้อนใต้หน้าอื่น"],
    ["/oem/w/abc", "/w ซ้อนใต้หน้าอื่น"],
  ])("%s (%s)", (p) => {
    expect(isExemptPath(p)).toBe(false);
  });
});

describe("middleware.ts matcher ตรงกับ exempt-path.ts (ไม่ drift)", () => {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const ex = readFileSync(join(process.cwd(), "lib/auth/exempt-path.ts"), "utf8");
  it("ทั้งสองไฟล์มี alternative ของ /w/ ตัวเดียวกัน", () => {
    expect(mw).toContain("w/[A-Za-z0-9_-]+/?$");
    expect(ex).toContain("w\\/[A-Za-z0-9_-]+\\/?$");
  });
  it("ไม่มีปีกกา {n,m} ใน matcher (path-to-regexp ตีความผิดได้)", () => {
    const m = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)!;
    expect(m[1]).not.toMatch(/\{\d/);
  });
});
