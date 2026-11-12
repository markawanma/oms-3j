// @vitest-environment jsdom
// QA (R2-D2) เสริม: ช่องที่ test เดิมยังไม่ล็อก
//  - ทุก top3 (60) × ทุกแบบ (3) = ทุกคู่พลอยแสดงครบ ไม่มี undefined/NaN/[object บนจอ
//  - buildResultView ทุกชุดคำตอบ (รวม liked ว่าง) → top3 ยาว 3 ไม่ซ้ำ → href ของ CTA parse กลับได้เสมอ
//  - รูป _assets ไม่มี EXIF/GPS/XMP (มติ TL §7c)
//  - hostile g ผ่าน page จริง ไม่ throw และไม่ฝังค่า g ลงในหน้า
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  GEM_QUIZ_BIRTH_DAY_SCORES,
  GEM_QUIZ_FEELINGS,
  GEM_QUIZ_INTENTIONS,
  GEM_QUIZ_PAIRS,
  GEM_QUIZ_STONE_CODES,
  type GemQuizStoneCode,
} from "@/lib/gem-quiz/config";
import { buildResultView } from "@/lib/gem-quiz/result";
import { buildShowcaseHref, parseGemParam, type GemTop3 } from "@/lib/ring-builder/showcase/quiz-link";
import RingShowcasePage from "./page";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
});

const CODES = GEM_QUIZ_STONE_CODES;
function allTop3(): GemTop3[] {
  const out: GemTop3[] = [];
  for (const a of CODES) for (const b of CODES) for (const c of CODES) if (a !== b && b !== c && a !== c) out.push([a, b, c]);
  return out;
}
const BAD_TEXT = /undefined|NaN|\[object|\bnull\b/;

describe("QA: ทุกคู่พลอย 5×4 แสดงครบบนจอ", () => {
  it("60 top3 × 3 แบบ: มีข้อความคู่พลอย (title/th/fit จาก GEM_QUIZ_PAIRS) ไม่มี undefined/NaN/[object", () => {
    let checked = 0;
    for (const top3 of allTop3()) {
      const { container, unmount } = render(<RingShowcaseClient top3={top3} />);
      for (const idx of [1, 2, 3]) {
        const radios = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") !== null && /อันดับ|แบบ/.test(r.textContent ?? ""));
        // radio พลอยคือกลุ่มแรก 3 ใบ (ไซซ์อยู่ถัดไป)
        fireEvent.click(radios[idx - 1]);
        const text = container.textContent ?? "";
        expect(text, `top3=${top3.join(".")} แบบ ${idx}`).not.toMatch(BAD_TEXT);
        const shown = GEM_QUIZ_PAIRS.filter((p) => text.includes(p.title) && text.includes(p.th) && text.includes(p.fit));
        expect(shown.length, `ไม่เจอข้อความคู่พลอย top3=${top3.join(".")} แบบ ${idx}`).toBeGreaterThan(0);
        checked++;
      }
      unmount();
    }
    expect(checked).toBe(180);
  }, 120000);

  it("GEM_QUIZ_PAIRS ทุกคู่มี title/th/fit ไม่ว่าง และ gems 2 ตัวไม่ซ้ำ", () => {
    for (const p of GEM_QUIZ_PAIRS) {
      expect(p.title.trim()).not.toBe("");
      expect(p.th.trim()).not.toBe("");
      expect(p.fit.trim()).not.toBe("");
      expect(new Set(p.gems).size).toBe(2);
    }
  });
});

describe("QA: CTA หน้าผล quiz สร้าง href ถูกทุกชุดคำตอบ", () => {
  function likedVariants(): GemQuizStoneCode[][] {
    const v: GemQuizStoneCode[][] = [[]];
    for (const a of CODES) {
      v.push([a]);
      for (const b of CODES) {
        if (b === a) continue;
        v.push([a, b]);
        for (const c of CODES) if (c !== a && c !== b) v.push([a, b, c]);
      }
    }
    return v;
  }
  it("rankGems→top3 ยาว 3 ไม่ซ้ำ อยู่ใน 5 พลอยเสมอ · href parse กลับได้เท่าเดิม (ไม่มีเคส top น้อยกว่า 3)", () => {
    const liked = likedVariants();
    expect(liked.length).toBe(86);
    let n = 0;
    for (const birthDay of Object.keys(GEM_QUIZ_BIRTH_DAY_SCORES))
      for (const intention of Object.keys(GEM_QUIZ_INTENTIONS))
        for (const feeling of Object.keys(GEM_QUIZ_FEELINGS))
          for (const l of liked) {
            const view = buildResultView({ answers: { birthDay, intention, feeling, jewelryType: "unknown" }, likedStoneCodes: l });
            expect(view.top3.length).toBe(3);
            expect(new Set(view.top3).size).toBe(3);
            const href = buildShowcaseHref(view.top3);
            const g = new URL(href, "https://x.test").searchParams.get("g");
            expect(parseGemParam(g)).toEqual([...view.top3]);
            n++;
          }
    expect(n).toBe(7 * 6 * 6 * 86);
  }, 120000);

  it("focusStoneCode (ดูพลอยทางเลือก) หรือค่าขยะ ไม่เปลี่ยน top3", () => {
    const base = { answers: { birthDay: "sun", intention: "career", feeling: "energy", jewelryType: "ring" }, likedStoneCodes: ["garnet"] };
    const ref = buildResultView(base).top3;
    for (const focus of [...CODES, "constructor", "__proto__", "", null, undefined]) {
      expect(buildResultView({ ...base, focusStoneCode: focus as string | null | undefined }).top3).toEqual(ref);
    }
  });
});

describe("QA: รูป _assets ไม่มี EXIF / GPS / XMP / comment (มติ §7c)", () => {
  const dir = join(process.cwd(), "app", "(quiz)", "ring-builder", "_assets");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg"));
  it("พบ 5 รูป", () => expect(files.length).toBe(5));
  for (const f of files) {
    it(`${f}: ไม่มี APPn ที่พก metadata ส่วนบุคคล`, () => {
      const buf = readFileSync(join(dir, f));
      expect(buf[0]).toBe(0xff);
      expect(buf[1]).toBe(0xd8);
      const hits: string[] = [];
      let i = 2;
      while (i + 4 < buf.length && buf[i] === 0xff) {
        const marker = buf[i + 1];
        if (marker === 0xda || marker === 0xd9) break; // เริ่มข้อมูลภาพ
        const len = buf.readUInt16BE(i + 2);
        const head = buf.subarray(i + 4, i + 4 + 32).toString("latin1");
        if (marker === 0xe1) hits.push(/^Exif/.test(head) ? "EXIF" : /xap|adobe/i.test(head) ? "XMP" : "APP1");
        if (marker === 0xed) hits.push("APP13/IPTC");
        if (marker === 0xfe) hits.push("COM");
        i += 2 + len;
      }
      expect(hits).toEqual([]);
      expect(buf.toString("latin1")).not.toMatch(/GPSLatitude|<x:xmpmeta|Exif\0\0/);
    });
  }
});

describe("QA: hostile g ผ่าน page จริง", () => {
  it("ค่าอันตรายทุกแบบ → render ได้ ไม่ throw ไม่ฝังค่า g ลงหน้า (XSS/reflect)", async () => {
    const hostile: unknown[] = [
      "<script>alert(1)</script>",
      "constructor.__proto__.toString",
      ["garnet.citrine.peridot", "x"],
      "garnet.citrine.peridot.",
      " garnet.citrine.peridot",
      "GARNET.CITRINE.PERIDOT",
      "garnet.citrine.peridot\n",
      "😀.😀.😀",
      "ก.ข.ค",
      "a".repeat(10000),
      "%00",
    ];
    for (const g of hostile) {
      const el = await RingShowcasePage({ searchParams: Promise.resolve({ g: g as string }) });
      const { container, unmount } = render(el);
      expect(container.textContent).not.toContain("alert(1)");
      expect(container.innerHTML).not.toContain("<script");
      expect(screen.getByRole("link", { name: "ทำแบบทดสอบ 1 นาที" })).toHaveAttribute("href", "/gem-quiz"); // ตกโหมดเข้าตรง
      unmount();
    }
  });
});
