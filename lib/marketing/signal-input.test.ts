import { describe, expect, it } from "vitest";
import { cleanSignalUrl, describeLink, parseMetric } from "./signal-input";

describe("parseMetric", () => {
  it("ว่าง = ไม่เห็น (null) · ตัวเลขเต็ม · มี , คั่น", () => {
    expect(parseMetric("")).toEqual({ ok: true, value: null, abbreviated: false });
    expect(parseMetric("   ")).toEqual({ ok: true, value: null, abbreviated: false });
    expect(parseMetric("1,234")).toEqual({ ok: true, value: 1234, abbreviated: false });
    expect(parseMetric("0")).toEqual({ ok: true, value: 0, abbreviated: false }); // 0 ที่เห็นจริง ไม่ใช่ว่าง
  });
  it("ตัวย่อ K/M/B + ไทย → จำนวนเต็ม + ธงประมาณ", () => {
    expect(parseMetric("16K")).toEqual({ ok: true, value: 16000, abbreviated: true });
    expect(parseMetric("1.2m")).toEqual({ ok: true, value: 1_200_000, abbreviated: true });
    expect(parseMetric("2.5 หมื่น")).toEqual({ ok: true, value: 25000, abbreviated: true });
    expect(parseMetric("3 แสน")).toEqual({ ok: true, value: 300000, abbreviated: true });
    expect(parseMetric("๑๒K")).toMatchObject({ ok: false }); // เลขไทยไม่รับ (NFKC ไม่แปลงให้) — ให้ผู้ใช้พิมพ์เลขอารบิก
  });
  it("ห้ามผ่าน: ติดลบ · NaN · Infinity · ข้อความ · ทศนิยมไม่มีตัวย่อ · เกินเพดาน", () => {
    for (const bad of ["-5", "NaN", "Infinity", "abc", "12.5", "1e9", "1..2K", "K", "10001M", "99999999999"]) {
      expect(parseMetric(bad).ok, bad).toBe(false);
    }
  });
  it("เพดาน 10,000,000,000 ผ่านพอดี", () => {
    expect(parseMetric("10B")).toMatchObject({ ok: true, value: 10_000_000_000 });
    expect(parseMetric("10000M")).toMatchObject({ ok: true, value: 10_000_000_000 });
  });
  it("ไม่ใช่ string → ว่าง ไม่ throw", () => {
    expect(parseMetric(undefined as unknown as string)).toEqual({ ok: true, value: null, abbreviated: false });
  });
});

describe("cleanSignalUrl", () => {
  it("ตัด tracking param + fragment · คง param ที่มีความหมาย", () => {
    const r = cleanSignalUrl("https://www.tiktok.com/@abc/video/123?is_from_webapp=1&sender_device=pc&_t=x#frag");
    expect(r).toEqual({ ok: true, url: "https://www.tiktok.com/@abc/video/123" });
    const y = cleanSignalUrl("https://www.youtube.com/watch?v=AbC123&si=zzz&t=30");
    expect(y).toEqual({ ok: true, url: "https://www.youtube.com/watch?v=AbC123&t=30" });
  });
  it("youtu.be/ID → watch?v=ID (D4)", () => {
    expect(cleanSignalUrl("https://youtu.be/AbC123?si=xx")).toEqual({ ok: true, url: "https://www.youtube.com/watch?v=AbC123" });
    expect(cleanSignalUrl("https://youtu.be/").ok).toBe(false);
  });
  it("ห้ามผ่าน: ไม่ใช่ http(s) · user:pass@ · ช่องว่าง/อักขระต้องห้าม · ว่าง · ยาวเกิน · ไม่ใช่ URL", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test/a", "https://u:p@x.test/a", "https://x.test/a b", 'https://x.test/"a', "https://x.test/<a>", "", "   ", "ไม่ใช่ลิงก์", "https://" + "a".repeat(600) + ".test"]) {
      expect(cleanSignalUrl(bad).ok, bad.slice(0, 30)).toBe(false);
    }
  });
  it("ลิงก์สั้นไม่ถูก resolve (ไม่ออกเครือข่าย) — ผ่านตามเดิม", () => {
    expect(cleanSignalUrl("https://vt.tiktok.com/ZSabc/")).toEqual({ ok: true, url: "https://vt.tiktok.com/ZSabc/" });
  });
});

describe("describeLink", () => {
  it("TikTok + @handle · IG/FB/YT จากโฮสต์ · ไม่รู้จัก = ไม่เดา", () => {
    expect(describeLink("https://www.tiktok.com/@some.user/video/1")).toEqual({ platform: "tiktok", platformLabel: "TikTok", account: "@some.user" });
    expect(describeLink("https://vt.tiktok.com/ZS1/")).toMatchObject({ platform: "tiktok", account: null });
    expect(describeLink("https://www.instagram.com/reel/abc/")).toMatchObject({ platform: "instagram", account: null });
    expect(describeLink("https://fb.watch/abc/")).toMatchObject({ platform: "facebook" });
    expect(describeLink("https://www.youtube.com/watch?v=1")).toMatchObject({ platform: "youtube" });
    expect(describeLink("https://example.test/x")).toEqual({ platform: null, platformLabel: "ไม่รู้จักแพลตฟอร์ม", account: null });
  });
  it("โฮสต์ปลอมที่มีชื่อแพลตฟอร์มเป็นส่วนหนึ่ง ไม่ถูกนับ", () => {
    expect(describeLink("https://tiktok.com.evil.test/@a/video/1").platform).toBeNull();
    expect(describeLink("https://nottiktok.com/@a").platform).toBeNull();
  });
  it("สตริงไม่ใช่ URL → ไม่ throw", () => {
    expect(describeLink("abc").platform).toBeNull();
  });
});
