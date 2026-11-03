// @vitest-environment jsdom
// รูปตัวอย่างลิงก์ (Open Graph) ของ /ring-size — LINE OA broadcast แปะ https://app.3jthailand.com/ring-size แล้วต้องขึ้นการ์ดมีรูป
//
// ที่เทสต์นี้กัน:
//   1) metadata ชี้รูปที่ "มีจริง" · absolute URL · ขนาดตรงไฟล์ · twitter summary_large_image · og:url = ลิงก์ที่เจ้าของแปะ
//   2) ไฟล์รูป: PNG จริง 1200×630 ≤ 300 KB (LINE ข้ามรูปใหญ่/ผิดสัดส่วน)
//   3) URL รูป "เปิดได้โดยไม่ล็อกอิน" — exempt ใน middleware (LINE crawler ไม่มี session) และ exempt ไม่กว้างกว่า exact path
//   4) ข้อความบนรูป = ข้อความที่มีบนหน้า (COPY) เท่านั้น — สคริปต์ gen-ring-size-og.cjs คัดลอกมา เทสต์นี้เทียบให้
//   5) metadata เดิมไม่หาย (referrer · noindex) และหน้ายัง static (ไม่มี dynamic/headers/cookies)
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COPY, NOINDEX } from "@/lib/ring-size/config";
import { isExemptPath } from "@/lib/auth/exempt-path";
import { metadata } from "../page";

const ROOT = process.cwd(); // vitest รันที่ root repo (jsdom ไม่มี import.meta.url แบบ file:)
const OG_FILE = join(ROOT, "public", "ring-size", "og.png");
const SCRIPT = readFileSync(join(ROOT, "scripts", "gen-ring-size-og.cjs"), "utf8");
const PAGE_SRC = readFileSync(join(ROOT, "app", "(quiz)", "ring-size", "page.tsx"), "utf8");

/** ตัด // คอมเมนต์ออกจากสคริปต์ก่อนอ่านค่า (ค่าจริงอยู่ในโค้ด ไม่ใช่ในคำอธิบาย) */
const SCRIPT_CODE = SCRIPT.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

const base = new URL(String(metadata.metadataBase));
const og = metadata.openGraph as NonNullable<typeof metadata.openGraph>;
const ogImage = (og.images as Array<{ url: string; width: number; height: number; alt: string; type: string }>)[0];
const resolve = (u: string | URL) => new URL(String(u), base);

describe("OG metadata", () => {
  it("รูป og: absolute https ที่ origin เว็บจริง + path ของไฟล์ที่มีอยู่ + ขนาด/ชนิดตรงไฟล์", () => {
    expect(base.origin).toBe("https://app.3jthailand.com");
    expect(resolve(ogImage.url).href).toBe("https://app.3jthailand.com/ring-size/og.png");
    expect(ogImage.width).toBe(1200);
    expect(ogImage.height).toBe(630);
    expect(ogImage.type).toBe("image/png");
    expect(ogImage.alt.length).toBeGreaterThan(0);
    expect((og.images as unknown[]).length).toBe(1);
    expect(existsSync(OG_FILE)).toBe(true);
  });

  it("og:url = ลิงก์ที่เจ้าของแปะ (/ring-size ไม่มี / ท้าย — ไม่ให้ชี้ไปที่ต้อง redirect)", () => {
    expect(resolve(String(og.url)).href).toBe("https://app.3jthailand.com/ring-size");
  });

  it("og title/description = ของหน้า (ไม่ใช่คำอธิบายระบบภายในของ root layout) · type website · locale th_TH", () => {
    expect(og.title).toBe(metadata.title);
    expect(og.description).toBe(metadata.description);
    expect(String(og.title)).toContain("วัดไซส์แหวน");
    expect(String(og.description)).not.toMatch(/OMS|ระบบภายใน|3J Insight/);
    expect((og as { type?: string }).type).toBe("website");
    expect(og.locale).toBe("th_TH");
  });

  it("twitter = summary_large_image + รูปเดียวกัน", () => {
    const tw = metadata.twitter as { card: string; images: string[] };
    expect(tw.card).toBe("summary_large_image");
    expect(tw.images).toHaveLength(1);
    expect(resolve(tw.images[0]).href).toBe(resolve(ogImage.url).href);
  });

  it("ของเดิมไม่หาย: referrer = strict-origin · noindex ตาม NOINDEX (ยังเป็น true — เจ้าของไม่ได้สั่งเปิด index)", () => {
    expect(metadata.referrer).toBe("strict-origin");
    expect(NOINDEX).toBe(true);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("หน้ายัง static: page.tsx ไม่ตั้ง dynamic/revalidate/fetchCache และไม่อ่าน headers()/cookies()/process.env/generateMetadata", () => {
    const code = PAGE_SRC.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(code).not.toMatch(/export\s+const\s+(dynamic|revalidate|fetchCache|runtime)\b/);
    expect(code).not.toMatch(/next\/headers|\bcookies\s*\(|\bheaders\s*\(|process\.env|generateMetadata/);
    expect(code).not.toMatch(/export\s+(default\s+)?async\s+function/);
  });

  it("ไม่ใช้ opengraph-image/twitter-image convention (route ใหม่ไม่ exempt → LINE เด้ง /login)", () => {
    for (const name of ["opengraph-image", "twitter-image"]) {
      for (const ext of ["tsx", "ts", "js", "jsx", "png", "jpg"]) {
        expect(existsSync(join(ROOT, "app", "(quiz)", "ring-size", `${name}.${ext}`)), `${name}.${ext}`).toBe(false);
      }
    }
  });
});

describe("ไฟล์ public/ring-size/og.png", () => {
  const buf = readFileSync(OG_FILE);

  it("เป็น PNG จริง (signature + IHDR) กว้าง 1200 สูง 630", () => {
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("ขนาดไฟล์ ≤ 300 KB", () => {
    expect(statSync(OG_FILE).size).toBeLessThanOrEqual(300 * 1024);
  });
});

describe("URL รูปเปิดได้โดยไม่ล็อกอิน (LINE crawler ไม่มี session)", () => {
  it("path ของรูปใน metadata ผ่าน exempt ของ middleware", () => {
    expect(isExemptPath(resolve(ogImage.url).pathname)).toBe(true);
    expect(isExemptPath("/ring-size/og.png")).toBe(true);
  });

  it("exempt ไม่กว้างกว่า exact: นามสกุลแปลก · ซ้อนชั้น · look-alike · traversal ยังถูก gate", () => {
    for (const p of [
      "/ring-size/og.png.exe",
      "/ring-size/og.pngx",
      "/ring-size/og.gif",
      "/ring-size/deep/og.png",
      "/ring-size/og.png/x",
      "/ring-sizes/og.png",
      "/ring-size-admin/og.png",
      "/og/ring-size/og.png",
      "/ring-size/../orders/x.png",
      "/ring-size/%2e%2e/orders/x.png",
      "/orders/og.png",
    ]) {
      expect(isExemptPath(p), p).toBe(false);
    }
  });
});

describe("ข้อความบนรูป = ข้อความที่มีบนหน้า (COPY) เท่านั้น", () => {
  const lines = (SCRIPT_CODE.match(/const TITLE_LINES = \[([^\]]*)\]/)?.[1] ?? "").match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const sub = SCRIPT_CODE.match(/const SUBTITLE = "([^"]+)"/)?.[1];
  const shop = SCRIPT_CODE.match(/const SHOP = "([^"]+)"/)?.[1];

  it("หัวเรื่อง (ต่อบรรทัดที่ตัดเอง) = COPY.r0.title เป๊ะ", () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).toBe(COPY.r0.title);
  });

  it("บรรทัดรอง = COPY.r0.descReturn เป๊ะ และเป็นประโยคแรกของ COPY.r0.desc ที่หน้าแรกแสดง", () => {
    expect(sub).toBe(COPY.r0.descReturn);
    expect(COPY.r0.desc.startsWith(COPY.r0.descReturn)).toBe(true);
  });

  it("ชื่อร้าน = COPY.common.logoAlt", () => {
    expect(shop).toBe(COPY.common.logoAlt);
  });

  it("ไม่มีคำ/ค่าต้องห้ามใน 3 ข้อความนั้น (แม่นยำ 100% · มาตรฐานสากล · ราคา · โปร · URL · เบอร์ · LINE)", () => {
    const all = [...lines, sub ?? "", shop ?? ""].join(" ");
    expect(all).not.toMatch(/100\s*%|แม่นยำ|มาตรฐานสากล|ราคา|โปร|ลด|ฟรี|https?:|www\.|\.com|@|LINE|ไลน์/i);
    // ไม่มีตัวเลขในหัวเรื่อง/บรรทัดรอง (ไม่มีเบอร์แหวนตัวอย่าง/มม./ราคา) — ชื่อร้าน "3J" มีเลข 3 เป็นชื่อแบรนด์ จึงไม่นับ
    expect([...lines, sub ?? ""].join(" ")).not.toMatch(/\d|[๐-๙]/);
  });

  it("สคริปต์ไม่ฝังค่าภายนอก: ไม่มี URL · @handle · เบอร์โทร และอ่านโลโก้จากไฟล์จริง public/3j-logo.png (ไม่วาดโลโก้เอง)", () => {
    expect(SCRIPT_CODE).not.toMatch(/https?:\/\/|@[a-z0-9_]{3,}|\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/i);
    expect(SCRIPT_CODE).toMatch(/"public", "3j-logo\.png"|3j-logo\.png/);
    expect(existsSync(join(ROOT, "public", "3j-logo.png"))).toBe(true);
  });
});
