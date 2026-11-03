// @vitest-environment jsdom
// L2 (security 97339e8): หน้า /ring-size ตั้ง <meta name="referrer"> = strict-origin — Referer ของ beacon สถิติและลิงก์ที่ออกจากหน้า
// เหลือแค่ origin (ไม่ติด query เช่น fbclid จาก in-app browser) · ไม่ใช่ no-referrer (Origin header ที่ route เช็คต้องอยู่)
import { describe, expect, it } from "vitest";
import { metadata } from "../page";

describe("page metadata", () => {
  it("referrer = strict-origin (ค่าที่ Next แปลงเป็น <meta name=referrer>)", () => {
    expect(metadata.referrer).toBe("strict-origin");
    expect(metadata.referrer).not.toBe("no-referrer");
  });

  it("metadata เดิมไม่เปลี่ยน: noindex + title/description ของหน้า (ไม่ใช่คำอธิบายระบบภายใน)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(String(metadata.title)).toContain("วัดไซส์แหวน");
    expect(String(metadata.description)).not.toMatch(/OMS|ระบบภายใน/);
  });
});
