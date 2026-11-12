// ค่าจากเจ้าของ + copy-guard (X4/X6/X7) ของทั้งหน้า: lib/ring-builder/showcase/** · lib/ring-builder/viewer/** · app/(quiz)/ring-builder/**
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_PAIRS } from "@/lib/gem-quiz/config";
import { RING_BUILDER_SIZES } from "../config";
import {
  SHOWCASE_COPY,
  SHOWCASE_DESIGN_NAME,
  SHOWCASE_LEAD_DAYS,
  SHOWCASE_OVAL_MM,
  SHOWCASE_PRICE_THB,
  SHOWCASE_SIZES,
  SHOWCASE_SIZE_RANGE,
  formatPriceThb,
  leadTimeLabel,
} from "./config";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const FILES = [
  ...sources(join(ROOT, "lib/ring-builder/showcase")),
  ...sources(join(ROOT, "lib/ring-builder/viewer")),
  ...sources(join(ROOT, "app/(quiz)/ring-builder")),
];
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
/** ตัดคอมเมนต์ออก (คอมเมนต์อธิบายข้อห้ามได้) — เทียบเฉพาะโค้ด/ข้อความที่จะถึงลูกค้า */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/ .*$/gm, "");
}

describe("ค่าจากเจ้าของ (12 พ.ย. 69)", () => {
  it("ราคา 800 · ไซซ์ 55–58 · พลอยไข่ 7×5 · pre-order 21 วัน", () => {
    expect(SHOWCASE_PRICE_THB).toBe(800);
    expect([...SHOWCASE_SIZES]).toEqual([55, 56, 57, 58]);
    expect(SHOWCASE_SIZE_RANGE).toEqual({ min: 55, max: 58 });
    expect(SHOWCASE_OVAL_MM).toEqual({ long: 7, short: 5 });
    expect(SHOWCASE_LEAD_DAYS).toBe(21);
    expect(formatPriceThb()).toBe("800 บาท");
    expect(leadTimeLabel()).toBe("พรีออเดอร์ ทำภายใน 21 วัน");
  });
  it("ไซซ์อยู่ในช่วงร้าน 45–68 (ล็อกกับ RING_BUILDER_SIZES ซึ่ง parity กับ DB)", () => {
    for (const s of SHOWCASE_SIZES) {
      expect(s).toBeGreaterThanOrEqual(RING_BUILDER_SIZES.min);
      expect(s).toBeLessThanOrEqual(RING_BUILDER_SIZES.max);
    }
  });
  it("ชื่อแบบชั่วคราว + มี TODO_OWNER_DESIGN_NAME กำกับที่ config", () => {
    expect(SHOWCASE_DESIGN_NAME).toBe("แหวนไขว้พลอยไข่ 2 เม็ด");
    expect(readFileSync(join(ROOT, "lib/ring-builder/showcase/config.ts"), "utf8")).toContain("TODO_OWNER_DESIGN_NAME");
  });
});

describe("copy-guard ของไฟล์ที่ถึงลูกค้า", () => {
  it("พบไฟล์ของหน้า (กัน glob ว่างแล้วเทสต์ผ่านเงียบ)", () => {
    expect(FILES.length).toBeGreaterThan(15);
    expect(FILES.map(rel)).toContain("app/(quiz)/ring-builder/page.tsx");
  });
  it("X7: ไม่มีคำว่า 'เพชร' และคำสรรพคุณที่ห้ามใช้ในโค้ด/ข้อความใหม่", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const c = code(readFileSync(f, "utf8"));
      for (const w of ["เพชร", "นำโชค", "เสริมดวง", "diamond", "Diamond"]) if (c.includes(w)) hits.push(`${rel(f)}: ${w}`);
    }
    expect(hits).toEqual([]);
  });
  it("X6: ไม่มีน้ำหนัก/ต้นทุน/spec/โหมด dev ในไฟล์ของหน้า", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const c = code(readFileSync(f, "utf8"));
      for (const re of [/\bbuildSpec\b/, /\bbuildRowRing\b/, /#dev\b/, /devonly/, /\bcost\b/i, /ต้นทุน/, /น้ำหนัก/, /\b3\.2\s*g\b/, /กรัม/, /margin/i]) {
        if (re.test(c)) hits.push(`${rel(f)}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it("ราคาไม่ถูกพิมพ์ซ้ำนอก config: ไม่มีเลข 800 ในไฟล์อื่นของหน้า", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      if (rel(f) === "lib/ring-builder/showcase/config.ts") continue;
      if (/\b800\b/.test(code(readFileSync(f, "utf8")))) hits.push(rel(f));
    }
    expect(hits).toEqual([]);
  });
  it("X4: มีแบบเดียว — ไม่มีชื่อแบบอื่นของ spike ในไฟล์ของหน้า", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const c = code(readFileSync(f, "utf8"));
      for (const re of [/TRINITY/i, /SCROLL6/, /CHANNEL[46]/, /BAR7/, /SMALL7/, /ก้นหอย/, /ฝังล็อค/, /เตย 7/, /แถวเล็ก/]) if (re.test(c)) hits.push(`${rel(f)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
  it("TODO_OWNER อยู่ในคอมเมนต์เท่านั้น ไม่หลุดเป็นข้อความที่ถึงลูกค้า", () => {
    const hits: string[] = [];
    for (const f of FILES) if (/TODO_OWNER/.test(code(readFileSync(f, "utf8")))) hits.push(rel(f));
    expect(hits).toEqual([]);
  });
  it("ข้อความ UI (SHOWCASE_COPY ทุกค่า) ไม่มีคำว่า 'เพชร'", () => {
    for (const v of Object.values(SHOWCASE_COPY)) {
      const s = typeof v === "function" ? v(1) : v;
      expect(s).not.toContain("เพชร");
    }
  });
  it("SHOWCASE_COPY ไม่ซ้ำข้อความคำอธิบายพลอยของ GEM_QUIZ_PAIRS — ต้องดึงจาก config เดิมเท่านั้น", () => {
    const joined = Object.values(SHOWCASE_COPY)
      .map((v) => (typeof v === "function" ? v(1) : v))
      .join("\n");
    for (const pair of GEM_QUIZ_PAIRS) {
      expect(joined).not.toContain(pair.fit);
      expect(joined).not.toContain(pair.th);
    }
  });
});
