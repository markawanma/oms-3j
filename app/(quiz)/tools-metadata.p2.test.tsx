// @vitest-environment jsdom
// P2 (18 พ.ย. 69) — metadataBase / og:url / canonical ของ hub + 3 หน้าลูกค้า ต้อง resolve เป็น https://tools.3jthailand.com/<path>
// (ไม่มี query · ไม่พึ่ง fallback ของ Vercel · ไม่มี app. เหลือในไฟล์ page) — ring-size มี page-og.test.tsx ของตัวเอง
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { TOOLS_ORIGIN } from "@/lib/site/hosts";
import { metadata as gemQuiz } from "./gem-quiz/page";
import { metadata as ringBuilder } from "./ring-builder/page";
import { metadata as ringSize } from "./ring-size/page";
import { metadata as hub } from "./tools/page";

const CASES: Array<[string, Metadata, string, string]> = [
  ["hub", hub, "/", "tools/page.tsx"],
  ["gem-quiz", gemQuiz, "/gem-quiz", "gem-quiz/page.tsx"],
  ["ring-builder", ringBuilder, "/ring-builder", "ring-builder/page.tsx"],
  ["ring-size", ringSize, "/ring-size", "ring-size/page.tsx"],
];

describe.each(CASES)("%s", (_name, md, path, file) => {
  const base = new URL(String(md.metadataBase));
  const abs = (u: unknown) => new URL(String(u), base).href;
  it("metadataBase = TOOLS_ORIGIN", () => {
    expect(base.origin).toBe(TOOLS_ORIGIN);
  });
  it("canonical + og:url = https://tools.3jthailand.com + path (ไม่มี query/hash)", () => {
    const want = `${TOOLS_ORIGIN}${path}`;
    expect(abs((md.alternates as { canonical: string }).canonical)).toBe(want);
    expect(abs((md.openGraph as { url: string }).url)).toBe(want);
  });
  it("og:image (ถ้ามี) resolve ไป tools. · ไม่ชี้ app.", () => {
    const imgs = ((md.openGraph as { images?: unknown[] }).images ?? []).map((i) => abs(typeof i === "string" ? i : (i as { url: string }).url));
    for (const u of imgs) expect(new URL(u).origin).toBe(TOOLS_ORIGIN);
  });
  it("ไฟล์หน้าไม่มี app.3jthailand.com / process.env", () => {
    const src = readFileSync(join(process.cwd(), "app", "(quiz)", file), "utf8");
    expect(src).not.toMatch(/app\.3jthailand\.com|process\.env\.(?:APP|SITE|NEXT_PUBLIC)/);
  });
  it("noindex คงเดิม (เจ้าของยังไม่สั่งเปิด index)", () => {
    expect(md.robots).toMatchObject({ index: false });
  });
});

it("gem-quiz: og:image เดิม /gem-quiz/og.png → tools.", () => {
  const imgs = (gemQuiz.openGraph as { images: string[] }).images;
  expect(new URL(imgs[0], new URL(String(gemQuiz.metadataBase))).href).toBe(`${TOOLS_ORIGIN}/gem-quiz/og.png`);
});
