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

// 0187 W1 — QR ร้าน /w/s/<token>: exempt "เฉพาะ w/s/ + หนึ่งเซกเมนต์ base64url" (ผู้จัดการเปิดใบโดยไม่ login · พิสูจน์ตัวที่ DB ด้วย token ร้าน + PIN)
describe("isExemptPath — /w/s/<token> (QR ร้าน) ต้อง exempt", () => {
  it.each([`/w/s/${TOKEN}`, `/w/s/${TOKEN}/`, "/w/s/abc", "/w/s/A", "/w/s/a-b_c-D"])("%s", (p) => {
    expect(isExemptPath(p)).toBe(true);
  });
});

describe("isExemptPath — /w/s ที่ห้ามหลุด gate (traversal · look-alike · เซกเมนต์ซ้อน)", () => {
  it.each([
    ["/w/s//", "slash ซ้อน"],
    [`/w/s/${TOKEN}/x`, "เซกเมนต์ซ้อนหลัง token (ไม่มีหน้าในแอปที่ต้อง exempt)"],
    [`/w/s/${TOKEN}/jobs`, "ต่อท้ายหลัง token"],
    ["/w/s/../oem", "traversal"],
    ["/w/s/../../oem/quotes", "traversal ลึก"],
    ["/w/s/%2e%2e/oem", "traversal แบบเข้ารหัส"],
    ["/w/s/%2E%2E/jobs", "traversal แบบเข้ารหัสตัวใหญ่"],
    ["/w/s/./jobs", "จุดเดียว"],
    ["/w/s/abc%2Fdef", "slash เข้ารหัส"],
    ["/w/s/abc def", "ช่องว่าง"],
    ["/w/s/abc?x=1", "query ติดอยู่ในพาธ"],
    ["/w/sx/abc", "look-alike: s ไม่ใช่ตัวเดียวเป๊ะ"],
    ["/w/ss/abc", "look-alike: ss"],
    ["/w/S/abc", "ตัวพิมพ์ใหญ่ (ไม่ใช่ /w/s/)"],
    ["/jobs/w/s/abc", "ซ้อนใต้หน้าอื่น"],
    ["/oem/w/s/abc", "ซ้อนใต้หน้าอื่น"],
    ["/x/w/s/abc", "ซ้อนใต้หน้าอื่น"],
    ["/w/s/abc/def/ghi", "เซกเมนต์ซ้อนหลายชั้น"],
  ])("%s (%s)", (p) => {
    expect(isExemptPath(p)).toBe(false);
  });
  it("/w/s (ไม่มี token) = ตรง alternative เดิม w/<token> (token ชื่อ 's') — พฤติกรรมเดิมไม่เปลี่ยน · หน้าช่างแสดง 'ใช้ไม่ได้'", () => {
    expect(isExemptPath("/w/s")).toBe(true);
    expect(isExemptPath("/w/s/")).toBe(true);
  });
});

describe("middleware.ts matcher ตรงกับ exempt-path.ts (ไม่ drift)", () => {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const ex = readFileSync(join(process.cwd(), "lib/auth/exempt-path.ts"), "utf8");
  it("ทั้งสองไฟล์มี alternative ของ /w/ ตัวเดียวกัน", () => {
    expect(mw).toContain("w/[A-Za-z0-9_-]+/?$");
    expect(ex).toContain("w\\/[A-Za-z0-9_-]+\\/?$");
  });
  it("ทั้งสองไฟล์มี alternative ของ /w/s/ (QR ร้าน) ตัวเดียวกัน — แคบ: ต้องไม่มี wildcard/subtree", () => {
    expect(mw).toContain("w/s/[A-Za-z0-9_-]+/?$");
    expect(ex).toContain("w\\/s\\/[A-Za-z0-9_-]+\\/?$");
    expect(mw).not.toMatch(/w\/s(?:\/|\(\?:)[^|]*\.\*/);
    expect(mw).not.toContain("w/s(?:/|$)");
  });
  it("ทั้งสองไฟล์มี alternative ของ /ring-size ตัวเดียวกัน — exact path: ต้องไม่มี wildcard/subtree/(?:/|$)", () => {
    expect(mw).toContain("|ring-size/?$|");
    expect(ex).toContain("|ring-size\\/?$|");
    expect(mw).not.toMatch(/ring-size(?:\(\?:|\/\.|\.\*|\/\*)/);
    expect(mw).not.toContain("ring-size(?:/|$)");
    expect(ex).not.toContain("ring-size(?:\\/|$)");
    expect(mw.match(/ring-size/g)!.length).toBeGreaterThan(0);
    const m = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)!;
    // matcher จริงมี ring-size 2 alternative เท่านั้น: หน้า (ring-size/?$) + endpoint สถิติ exact (api/ring-size/event/?$)
    expect(m[1].match(/ring-size/g)).toHaveLength(2);
    expect(m[1]).toContain("|ring-size/?$|");
    expect(m[1]).toContain("|api/ring-size/event/?$|");
  });
  it("ทั้งสองไฟล์มี alternative ของ api/ring-size/event ตัวเดียวกัน — exact endpoint: ต้องไม่เป็น api/ring-size(?:/|$) หรือมี wildcard", () => {
    expect(mw).toContain("|api/ring-size/event/?$|");
    expect(ex).toContain("|api\\/ring-size\\/event\\/?$|");
    expect(mw).not.toContain("api/ring-size(?:/|$)");
    expect(ex).not.toContain("api\\/ring-size(?:\\/|$)");
    expect(mw).not.toMatch(/api\/ring-size\/event(?:\(\?:|\/\.|\.\*|\/\*)/);
    const m = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)!;
    expect(m[1].match(/api\/ring-size/g)).toHaveLength(1);
  });
  it("ไม่มีปีกกา {n,m} ใน matcher (path-to-regexp ตีความผิดได้)", () => {
    const m = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)!;
    expect(m[1]).not.toMatch(/\{\d/);
  });
});
