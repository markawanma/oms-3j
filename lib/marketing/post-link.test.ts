import { describe, expect, it } from "vitest";
import type { PiecePost } from "./piece-types";
import { availablePlatforms, checkPostUrlHost, nowBangkokLocalInput, platformsForKind, postedAtFromLocalInput } from "./post-link";

function post(platform: string, status = "active"): PiecePost {
  return { postId: "p", platform, postUrl: "https://x", postedAt: null, status, hookId: null };
}

describe("platformsForKind", () => {
  it("คลิป → TikTok · FB/IG → facebook, instagram · LINE/สตอรี่ → ไม่มี", () => {
    expect(platformsForKind("short_clip")).toEqual(["tiktok"]);
    expect(platformsForKind("live_cut")).toEqual(["tiktok"]);
    expect(platformsForKind("ig_fb_post")).toEqual(["facebook", "instagram"]);
    expect(platformsForKind("line_message")).toEqual([]);
    expect(platformsForKind("story")).toEqual([]);
    expect(platformsForKind(null)).toEqual([]);
  });
});

describe("availablePlatforms — ปิดช่องที่มีโพสต์ active แล้ว", () => {
  it("ig_fb_post ที่มี IG แล้ว เหลือ Facebook", () => {
    expect(availablePlatforms("ig_fb_post", [post("instagram")])).toEqual(["facebook"]);
  });
  it("โพสต์ที่ถูกลบ/ปลดแล้ว (ไม่ active) ไม่ปิดช่อง", () => {
    expect(availablePlatforms("ig_fb_post", [post("instagram", "deleted")])).toEqual(["facebook", "instagram"]);
  });
  it("คลิปที่มี TikTok แล้ว = ไม่เหลือช่องทาง", () => {
    expect(availablePlatforms("short_clip", [post("tiktok")])).toEqual([]);
  });
});

describe("checkPostUrlHost", () => {
  it("ลิงก์ที่โฮสต์ตรงช่องทาง → ผ่าน", () => {
    expect(checkPostUrlHost("tiktok", "https://www.tiktok.com/x/video/1").ok).toBe(true);
    expect(checkPostUrlHost("instagram", "https://instagram.com/p/abc").ok).toBe(true);
    expect(checkPostUrlHost("facebook", "https://m.facebook.com/x/posts/1").ok).toBe(true);
  });
  it("วางลิงก์ IG ลงช่อง Facebook → ปฏิเสธ", () => {
    expect(checkPostUrlHost("facebook", "https://www.instagram.com/p/abc").ok).toBe(false);
  });
  it("โฮสต์หลอก (evil-tiktok.com / tiktok.com.evil.io) → ปฏิเสธ", () => {
    expect(checkPostUrlHost("tiktok", "https://evil-tiktok.com/v/1").ok).toBe(false);
    expect(checkPostUrlHost("tiktok", "https://tiktok.com.evil.io/v/1").ok).toBe(false);
  });
  it("javascript: / ว่าง / ไม่ใช่ URL → ปฏิเสธ", () => {
    expect(checkPostUrlHost("tiktok", "javascript:alert(1)").ok).toBe(false);
    expect(checkPostUrlHost("tiktok", "   ").ok).toBe(false);
    expect(checkPostUrlHost("tiktok", "https://").ok).toBe(false);
    expect(checkPostUrlHost("tiktok", "tiktok.com/x").ok).toBe(false);
  });
  it("ส่งค่าที่ trim แล้วกลับมา", () => {
    const r = checkPostUrlHost("tiktok", "  https://www.tiktok.com/x/video/1  ");
    expect(r.ok && r.url).toBe("https://www.tiktok.com/x/video/1");
  });
});

describe("วัน-เวลาโพสต์ (เวลาไทย)", () => {
  const NOW = Date.parse("2026-10-09T08:00:00Z"); // 15:00 ไทย
  it("ค่าเริ่มต้น = ตอนนี้เวลาไทย", () => {
    expect(nowBangkokLocalInput(NOW)).toBe("2026-10-09T15:00");
  });
  it("ตีความเป็น +07:00", () => {
    const r = postedAtFromLocalInput("2026-10-09T14:30", NOW);
    expect(r).toEqual({ ok: true, iso: "2026-10-09T07:30:00.000Z" });
  });
  it("ก่อน 1 ม.ค. 2568 → ปฏิเสธพร้อมข้อความช่วงที่ยอมรับ", () => {
    const r = postedAtFromLocalInput("2024-12-31T23:59", NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("2568");
  });
  it("อนาคต → ปฏิเสธ", () => {
    expect(postedAtFromLocalInput("2026-10-10T10:00", NOW).ok).toBe(false);
  });
  it("รูปแบบผิด → ปฏิเสธ", () => {
    expect(postedAtFromLocalInput("", NOW).ok).toBe(false);
    expect(postedAtFromLocalInput("2026-10-09", NOW).ok).toBe(false);
  });
});
