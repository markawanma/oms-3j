// header ของหน้าช่าง /w/* (next.config.mjs) — token อยู่ใน URL จึงต้อง: ไม่รั่วผ่าน Referer · ไม่ถูกเก็บ/แคช · ไม่ถูกฝังใน iframe
import { describe, expect, it } from "vitest";

async function rules() {
  const mod = (await import("../../next.config.mjs")) as { default: { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> } };
  return mod.default.headers();
}
const val = (hs: { key: string; value: string }[], k: string) => hs.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value;

describe("headers ของ /w/:path*", () => {
  // รายการ source เต็มของ headers() ยืนยันที่ lib/ring-size/headers.test.ts ที่เดียว — ที่นี่เช็กเฉพาะกฎของหน้าช่าง
  it("มีกฎของหน้าช่างที่ source = /w/:path* ตัวเดียว · ไม่มีกฎอื่นชี้ /w (ไม่กระทบหน้าออฟฟิศ) · ไม่มี Permissions-Policy ลามมาจากกฎ /ring-size", async () => {
    const r = await rules();
    expect(r.filter((x) => x.source === "/w/:path*")).toHaveLength(1);
    expect(r.filter((x) => x.source.startsWith("/w"))).toHaveLength(1);
    const w = r.find((x) => x.source === "/w/:path*")!;
    expect(w.headers.some((h) => h.key.toLowerCase() === "permissions-policy")).toBe(false);
    expect(r[0].source).toBe("/w/:path*"); // กฎอื่นต่อท้ายเท่านั้น ไม่เปลี่ยนลำดับ/ตัวเดิม
  });
  it("Referrer-Policy no-referrer · noindex · no-store · nosniff", async () => {
    const hs = (await rules())[0].headers;
    expect(val(hs, "Referrer-Policy")).toBe("no-referrer");
    expect(val(hs, "X-Robots-Tag")).toMatch(/noindex/);
    expect(val(hs, "Cache-Control")).toMatch(/no-store/);
    expect(val(hs, "X-Content-Type-Options")).toBe("nosniff");
  });
  it("กัน clickjacking: X-Frame-Options DENY + CSP frame-ancestors 'none'", async () => {
    const hs = (await rules())[0].headers;
    expect(val(hs, "X-Frame-Options")).toBe("DENY");
    expect(val(hs, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });
});
