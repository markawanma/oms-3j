// lib/ring-size/headers.test.ts — อ่าน next.config.mjs จริงแล้วยืนยัน header ของ /ring-size
//
// Permissions-Policy: camera=(), microphone=(), geolocation=() ผูกเฉพาะ path นี้ (exact — ไม่ใช่ subtree/wildcard)
// ไม่กระทบหน้าอื่น และไม่แตะ rule เดิมของ /w/:path*
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

type Rule = { source: string; headers: Array<{ key: string; value: string }> };

async function rules(): Promise<Rule[]> {
  const fn = (nextConfig as unknown as { headers?: () => Promise<Rule[]> }).headers;
  expect(typeof fn).toBe("function");
  return (await fn!()) as Rule[];
}

describe("next.config headers() — /ring-size", () => {
  it("มี rule ของ /ring-size ตัวเดียว: exact path ไม่ใช่ /ring-size/:path* หรือ wildcard", async () => {
    const rs = (await rules()).filter((r) => r.source.includes("ring-size"));
    expect(rs).toHaveLength(1);
    expect(rs[0].source).toBe("/ring-size");
    expect(rs[0].source).not.toMatch(/[:*(]/);
  });

  it("header ของ /ring-size ครบ 3 ตัวเท่านั้น: Permissions-Policy ปิดกล้อง/ไมค์/ตำแหน่ง · กันฝังใน iframe (X-Frame-Options + CSP frame-ancestors) — ไม่มี header อื่นแอบเพิ่ม", async () => {
    const rule = (await rules()).find((r) => r.source === "/ring-size")!;
    expect(rule.headers).toEqual([
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ]);
  });

  it("CSP ของ /ring-size มีแค่ frame-ancestors (ไม่ใส่ script-src/default-src ที่อาจทำหน้าพัง)", async () => {
    const rule = (await rules()).find((r) => r.source === "/ring-size")!;
    const csp = rule.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toBe("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src|default-src|style-src|connect-src/);
  });

  it("ไม่มี rule อื่นใดผูก Permissions-Policy (ไม่กระทบหน้าอื่น)", async () => {
    for (const r of await rules()) {
      if (r.source === "/ring-size") continue;
      expect(r.headers.map((h) => h.key.toLowerCase())).not.toContain("permissions-policy");
    }
  });

  it("rule เดิมของหน้าช่าง /w/:path* ไม่เปลี่ยน (ครบ 6 header เดิม)", async () => {
    const w = (await rules()).find((r) => r.source === "/w/:path*")!;
    expect(w.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ]);
  });

  // รายการ source ทั้งหมดของ headers() ยืนยัน "ที่เดียว" ที่นี่ (lib/jobs/headers.test.ts ไม่เทียบรายการเต็มแล้ว — กันต้องแก้สองไฟล์ทุกครั้งที่เพิ่ม rule)
  it("sources ทั้งหมดมีแค่ 2 rule (หน้าช่าง + ring-size)", async () => {
    expect((await rules()).map((r) => r.source)).toEqual(["/w/:path*", "/ring-size"]);
  });
});
