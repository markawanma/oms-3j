// QA guard (24 พ.ย. 69) — ux-tools-navigation §16 · N2 · N16 · Q6 · Q7
// static scan ของไฟล์ที่ branch นี้เพิ่ม/แก้: ห้ามมี storage ใหม่ · ห้ามเปิดแท็บใหม่/ลิงก์นอก · ปุ่ม "ดูแหวนด้วยเบอร์ N" ห้ามยิง trackCta
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// ตัดคอมเมนต์ก่อน scan (คอมเมนต์อธิบายกฎเหล่านี้เองจึงมีคำต้องห้ามอยู่)
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NAV_FILES = [
  "app/(quiz)/_components/LeaveSheet.tsx",
  "app/(quiz)/_components/ToolsHubExit.tsx",
  "app/(quiz)/_components/ToolsHubLink.tsx",
  "lib/nav/screen-history.ts",
  "app/(quiz)/gem-quiz/_components/QuizHeader.tsx",
  "app/(quiz)/ring-size/_components/RsHeader.tsx",
];

describe("nav files: ไม่มี storage ใหม่ · ไม่เปิดแท็บใหม่ · ไม่มีลิงก์นอก (Q6 · N2 · N16)", () => {
  for (const f of NAV_FILES) {
    it(f, () => {
      const src = strip(read(f));
      expect(src).not.toMatch(/sessionStorage|localStorage|document\.cookie/);
      expect(src).not.toMatch(/window\.open|target\s*=\s*["']_blank["']|next\/link/);
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/tiktok|shopee/i);
    });
  }

  it("GemQuizClient: ไม่เพิ่ม sessionStorage (Q6 ไม่เก็บคำตอบ)", () => {
    expect(strip(read("app/(quiz)/gem-quiz/GemQuizClient.tsx"))).not.toMatch(/sessionStorage/);
  });
});

describe("R6: ปุ่ม 'ดูแหวนด้วยเบอร์ N' ไม่ยิง trackCta (Q7)", () => {
  it("RsButton ที่ href=SHOWCASE_PATH ไม่มี onClick", () => {
    const src = strip(read("app/(quiz)/ring-size/_screens/R6.tsx"));
    const m = src.match(/<RsButton[^>]*href=\{SHOWCASE_PATH\}[^>]*>/);
    expect(m, "ไม่พบปุ่ม SHOWCASE_PATH").not.toBeNull();
    expect(m![0]).not.toMatch(/onClick|trackCta/);
  });

  it("trackCta ใน R6 ยังมีเฉพาะค่าที่อยู่ใน allowlist เดิม (ไม่เพิ่มค่า cta ใหม่)", () => {
    const src = read("app/(quiz)/ring-size/_screens/R6.tsx");
    const used = [...src.matchAll(/trackCta\(\s*["']([a-z_]+)["']/g)].map((x) => x[1]);
    const schema = read("lib/ring-size/track-schema.ts");
    for (const v of used) expect(schema, v).toContain(`"${v}"`);
  });
});
