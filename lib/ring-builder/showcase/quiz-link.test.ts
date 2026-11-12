// X1 + X2: parser ของ param g · ลิงก์จากหน้าผล quiz · อ่าน key เดียว
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONE_CODES } from "@/lib/gem-quiz/config";
import { buildShowcaseHref, parseGemParam, readShowcaseParams } from "./quiz-link";

describe("parseGemParam — ค่าที่ถูกต้อง", () => {
  it("3 รหัสไม่ซ้ำใน 5 พลอย → top3 ตามลำดับ", () => {
    expect(parseGemParam("citrine.garnet.peridot")).toEqual(["citrine", "garnet", "peridot"]);
    expect(parseGemParam("blue_topaz.amethyst.garnet")).toEqual(["blue_topaz", "amethyst", "garnet"]);
  });
  it("ทุกการเรียง 3 จาก 5 (60 แบบ) ผ่านและกลับค่าเดิม", () => {
    let n = 0;
    for (const a of GEM_QUIZ_STONE_CODES)
      for (const b of GEM_QUIZ_STONE_CODES)
        for (const c of GEM_QUIZ_STONE_CODES) {
          if (a === b || b === c || a === c) continue;
          n++;
          expect(parseGemParam(`${a}.${b}.${c}`)).toEqual([a, b, c]);
        }
    expect(n).toBe(60);
  });
});

describe("X1: ผิดรูป → null ไม่ throw (ตกโหมดเข้าตรง)", () => {
  const bad: [string, unknown][] = [
    ["รหัสนอก 5 พลอย", "ruby.garnet.citrine"],
    ["รหัสพลอยเก่า v1", "diamond.garnet.citrine"],
    ["constructor", "constructor.garnet.citrine"],
    ["__proto__", "__proto__.garnet.citrine"],
    ["toString", "toString.garnet.citrine"],
    ["hasOwnProperty", "garnet.hasOwnProperty.citrine"],
    ["ซ้ำ", "garnet.garnet.citrine"],
    ["ซ้ำตัวท้าย", "garnet.citrine.garnet"],
    ["ไม่ครบ (2)", "garnet.citrine"],
    ["ไม่ครบ (1)", "garnet"],
    ["เกิน 3", "garnet.citrine.peridot.amethyst"],
    ["ว่าง", ""],
    ["ตัวคั่นผิด", "garnet,citrine,peridot"],
    ["จุดซ้อน", "garnet..citrine"],
    ["ตัวพิมพ์ใหญ่", "Garnet.Citrine.Peridot"],
    ["ช่องว่าง", "garnet. citrine.peridot"],
    ["ยาวเกิน 64", "a".repeat(65)],
    ["ยาวเกิน 64 แต่ขึ้นต้นถูก", "garnet.citrine.peridot" + "x".repeat(60)],
    ["HTML", "<script>alert(1)</script>.garnet.citrine"],
    ["HTML ในรหัส", "garnet.citrine.<b>peridot</b>"],
    ["array", ["garnet.citrine.peridot"]],
    ["array หลายตัว", ["garnet", "citrine", "peridot"]],
    ["undefined", undefined],
    ["null", null],
    ["number", 123],
    ["object", { toString: () => "garnet.citrine.peridot" }],
  ];
  for (const [name, raw] of bad) {
    it(`${name} → null`, () => {
      expect(() => parseGemParam(raw)).not.toThrow();
      expect(parseGemParam(raw)).toBeNull();
    });
  }
  it("ยาว 64 พอดีแต่ผิด ก็ null · ไม่ใช่ error", () => {
    expect(parseGemParam("g".repeat(64))).toBeNull();
  });
});

describe("X2: อ่าน key เดียวคือ g", () => {
  it("?price= ?size= ?design= ไม่มีผลต่อผลลัพธ์", () => {
    const base = readShowcaseParams({ g: "garnet.citrine.peridot" });
    const noisy = readShowcaseParams({ g: "garnet.citrine.peridot", price: "1", size: "99", design: "9", d: "3", src: "x" });
    expect(noisy).toEqual(base);
    expect(noisy).toEqual({ top3: ["garnet", "citrine", "peridot"] });
    expect(readShowcaseParams({ price: "1", size: "99", design: "9" })).toEqual({ top3: null });
  });
  it("แตะ searchParams เฉพาะ key g (ตรวจด้วย Proxy)", () => {
    const touched: (string | symbol)[] = [];
    const proxy = new Proxy({ g: "garnet.citrine.peridot", price: "1", size: "2", design: "3" } as Record<string, unknown>, {
      get(t, k) {
        touched.push(k);
        return t[k as string];
      },
    });
    readShowcaseParams(proxy);
    expect(touched).toEqual(["g"]);
  });
});

describe("buildShowcaseHref", () => {
  it("ประกอบจากรหัสที่ตรวจแล้ว และ parse กลับได้ครบ", () => {
    expect(buildShowcaseHref(["garnet", "citrine", "blue_topaz"])).toBe("/ring-builder?g=garnet.citrine.blue_topaz");
    const href = buildShowcaseHref(["peridot", "amethyst", "garnet"]);
    const g = new URL(href, "https://x.test").searchParams.get("g");
    expect(parseGemParam(g)).toEqual(["peridot", "amethyst", "garnet"]);
  });
  it("ความยาวสูงสุดที่เป็นไปได้ (3 รหัสที่ยาวที่สุด) ไม่เกิน 64 — parser ไม่ปฏิเสธลิงก์ที่ระบบสร้างเอง", () => {
    const longest = [...GEM_QUIZ_STONE_CODES].sort((a, b) => b.length - a.length).slice(0, 3);
    expect(longest.join(".").length).toBeLessThanOrEqual(64);
    expect(parseGemParam(longest.join("."))).not.toBeNull();
  });
});
