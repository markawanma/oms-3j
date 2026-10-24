// header ของหน้าช่าง /w/* (next.config.mjs) — token อยู่ใน URL จึงต้อง: ไม่รั่วผ่าน Referer · ไม่ถูกเก็บ/แคช · ไม่ถูกฝังใน iframe
import { describe, expect, it } from "vitest";

async function rules() {
  const mod = (await import("../../next.config.mjs")) as { default: { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> } };
  return mod.default.headers();
}
const val = (hs: { key: string; value: string }[], k: string) => hs.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value;

describe("headers ของ /w/:path*", () => {
  it("มีกฎของหน้าช่างเดียวที่ source = /w/:path* (ไม่กระทบหน้าออฟฟิศ) + กฎ exact /ring-size ของเครื่องมือวัดไซส์ (24 ต.ค. 69 — ดู lib/ring-size/headers.test.ts)", async () => {
    const r = await rules();
    expect(r.map((x) => x.source)).toEqual(["/w/:path*", "/ring-size"]);
    // กฎ /ring-size ต้องไม่ลามมาเป็น header ของหน้าช่าง (Permissions-Policy มีเฉพาะ /ring-size)
    expect(r[0].headers.some((h) => h.key.toLowerCase() === "permissions-policy")).toBe(false);
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
