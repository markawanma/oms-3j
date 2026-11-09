import { describe, expect, it } from "vitest";
import { circToRec } from "@/lib/ring-size/size";
import { fitsDesignRange, getLastMeasuredSize } from "./last-size";
import { buildGroups, buildLineText, formatThaiDateBkk, formatThaiDateTimeBkk, parseQuoteOk } from "./quote-server";
import { cpLength, formatBaht } from "./util";

describe("เวลาไทย (Asia/Bangkok = UTC+7 ไม่พึ่ง TZ ของเครื่อง)", () => {
  it("ขอบเที่ยงคืนไทย: 16:59:59Z = วันเดิม · 17:00:00Z = วันถัดไป", () => {
    expect(formatThaiDateBkk("2026-11-09T16:59:59Z")).toBe("9 พ.ย. 2569");
    expect(formatThaiDateBkk("2026-11-09T17:00:00Z")).toBe("10 พ.ย. 2569");
  });
  it("ข้ามปี/เดือน + พ.ศ.", () => {
    expect(formatThaiDateBkk("2026-12-31T17:00:00Z")).toBe("1 ม.ค. 2570");
    expect(formatThaiDateTimeBkk("2026-11-09T07:32:00Z")).toBe("9 พ.ย. 2569 14:32");
    expect(formatThaiDateTimeBkk("2026-11-09T16:05:00Z")).toBe("9 พ.ย. 2569 23:05");
  });
  it("ค่าที่ไม่ใช่วันที่ ⇒ สตริงว่าง", () => {
    expect(formatThaiDateBkk("nope")).toBe("");
  });
  it("เงิน", () => {
    expect(formatBaht(1250)).toBe("฿1,250");
    expect(formatBaht(0)).toBe("฿0");
    expect(formatBaht(262143)).toBe("฿262,143");
  });
});

describe("groups / lineText", () => {
  const lines = [
    { pos: 1, stoneNo: 3, name: "โกเมน", priceThb: 80 }, { pos: 2, stoneNo: 0, name: "CZ ขาว", priceThb: 0 }, { pos: 3, stoneNo: 3, name: "โกเมน", priceThb: 80 },
    { pos: 4, stoneNo: 0, name: "CZ ขาว", priceThb: 0 }, { pos: 5, stoneNo: 0, name: "CZ ขาว", priceThb: 0 },
  ];
  it("จัดกลุ่มตามลำดับที่เจอ · ผลรวมกลุ่ม = ผลรวมบรรทัด", () => {
    const g = buildGroups(lines);
    expect(g).toEqual([
      { stoneNo: 3, name: "โกเมน", count: 2, unitPriceThb: 80, subtotalThb: 160 },
      { stoneNo: 0, name: "CZ ขาว", count: 3, unitPriceThb: 0, subtotalThb: 0 },
    ]);
    expect(g.reduce((s, x) => s + x.subtotalThb, 0)).toBe(lines.reduce((s, x) => s + x.priceThb, 0));
  });
  it("lineText ตามร่างของ handoff · ไม่มีคำลงท้ายระบุเพศ · ไม่มีเพชร", () => {
    const t = buildLineText({ stoneCount: 5, design: { name: "แบบ ก", shapeName: "กลม", stoneLabel: "2×2" }, size: null, lines, total: 640, pricedAtLabel: "9 พ.ย. 2569", code: "3JR-X" });
    expect(t.split("\n")).toEqual([
      "สวัสดี ขอสั่งทำแหวนตามแบบนี้",
      "แบบ: แถว 5 เม็ด แบบ ก (พลอยกลม 2×2 มม.)",
      "ไซซ์: รอแอดมินช่วยเช็ก",
      "พลอย (นับซ้ายไปขวา): 1 โกเมน · 2 CZ ขาว · 3 โกเมน · 4 CZ ขาว · 5 CZ ขาว",
      "ราคารวม ฿640 (ณ 9 พ.ย. 2569)",
      "รหัสสั่งทำ: 3JR-X",
      "รบกวนยืนยันราคาและขั้นตอนต่อไป",
    ]);
    expect(t).not.toMatch(/เพชร|ครับ|ค่ะ/);
  });
});

describe("parseQuoteOk — ตรวจรูปร่างผลจาก DB + S10 (ตรงกับที่ขอ · ยอดบวกกลับได้)", () => {
  const mk = (over: Record<string, unknown> = {}) => ({ total: 560, body: 480, priced_at: "2026-11-09T20:12:37Z", design: { name: "ก", shape_name: "กลม", major_mm100: 200, minor_mm100: 200 }, lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: 80 }, { pos: 2, stone_no: 0, name: null, price: 0 }], ...over });
  const asked = [3, 0];
  it("ผ่าน · CZ ชื่อมาจากค่าคงที่ ไม่ใช่ DB", () => {
    expect(parseQuoteOk(mk(), asked)?.lines[1]).toEqual({ pos: 2, stoneNo: 0, name: "CZ ขาว", priceThb: 0 });
    expect(parseQuoteOk(mk(), asked)?.total).toBe(560);
  });
  it.each([
    ["total เป็นสตริง", { total: "560" }], ["total เกินเพดาน", { total: 262144 }], ["total NaN", { total: NaN }], ["ไม่มี design", { design: null }],
    ["พลอยสีราคา 0 (ต้อง ≥ 1)", { lines: [{ pos: 1, stone_no: 3, name: "x", price: 0 }, { pos: 2, stone_no: 0, name: null, price: 0 }], total: 480 }],
    ["พลอยไม่มีชื่อ", { lines: [{ pos: 1, stone_no: 3, name: null, price: 80 }, { pos: 2, stone_no: 0, name: null, price: 0 }] }],
    ["ราคาพลอยติดลบ", { lines: [{ pos: 1, stone_no: 3, name: "x", price: -1 }, { pos: 2, stone_no: 0, name: null, price: 0 }] }],
    ["CZ ขาวมีราคา", { lines: [{ pos: 1, stone_no: 3, name: "x", price: 80 }, { pos: 2, stone_no: 0, name: null, price: 5 }], total: 565 }],
  ])("%s ⇒ null", (_n, over) => expect(parseQuoteOk(mk(over), asked)).toBeNull());
  it("S10: จำนวนบรรทัดไม่ตรง ⇒ null", () => expect(parseQuoteOk(mk(), [3, 0, 0])).toBeNull());
  it("S10: stone_no ไม่ตรงกับที่ขอ (ผิดเม็ด/ผิดลำดับ) ⇒ null แม้ยอดรวมเท่าเดิม", () => {
    expect(parseQuoteOk(mk(), [0, 3])).toBeNull();
    expect(parseQuoteOk(mk(), [5, 0])).toBeNull();
  });
  it("S10: pos ไม่ใช่ 1..n ตามลำดับ ⇒ null", () => {
    expect(parseQuoteOk(mk({ lines: [{ pos: 2, stone_no: 3, name: "x", price: 80 }, { pos: 1, stone_no: 0, name: null, price: 0 }] }), asked)).toBeNull();
    expect(parseQuoteOk(mk({ lines: [{ pos: 1, stone_no: 3, name: "x", price: 80 }, { pos: 1, stone_no: 0, name: null, price: 0 }] }), asked)).toBeNull();
  });
  it("S10: total ≠ body + Σ price ⇒ null (ทั้งมากกว่าและน้อยกว่า)", () => {
    expect(parseQuoteOk(mk({ total: 561 }), asked)).toBeNull();
    expect(parseQuoteOk(mk({ total: 559 }), asked)).toBeNull();
  });
});

describe("util", () => {
  it("cpLength นับ code point (N4) — ไม่ใช่ UTF-16 unit", () => {
    expect(cpLength("กขค")).toBe(3);
    expect(cpLength("a\u{1D173}b")).toBe(3);
    expect(cpLength("\u{1F600}".repeat(5))).toBe(5);
    expect("\u{1F600}".repeat(5).length).toBe(10);
  });
});

describe("last-size — อ่านผลวัดล่าสุดแบบ read-only โดยใช้กฎเบอร์เดียวกับ /ring-size", () => {
  const mem = (value: unknown) => ({ getItem: () => (value === undefined ? null : JSON.stringify(value)), setItem: () => { throw new Error("ห้ามเขียน"); }, removeItem: () => { throw new Error("ห้ามเขียน"); } });
  it.each([[54.2, "A"], [54.2, "B"], [54.5, "A"], [54.5, "B"], [60.4, "A"], [60.4, "B"], [67.9, "B"]] as const)("circ %s วิธี %s ⇒ เบอร์ตรงกับ circToRec", (circ, method) => {
    const r = getLastMeasuredSize(mem({ circ, method, ref: "card", savedAt: 1_700_000_000_000, version: 1 }));
    expect(r?.size).toBe(circToRec(circ, method)?.rec);
    expect(r?.method).toBe(method);
  });
  it("นอกช่วงร้าน ⇒ inShopRange=false · ไม่มีผล/ข้อมูลเสีย ⇒ null", () => {
    expect(getLastMeasuredSize(mem({ circ: 40, method: "A", ref: "coin", savedAt: 1, version: 1 }))?.inShopRange).toBe(false);
    expect(getLastMeasuredSize(mem({ circ: 54, method: "A", ref: "coin", savedAt: 1, version: 1 }))?.inShopRange).toBe(true);
    expect(getLastMeasuredSize(mem(undefined))).toBeNull();
    expect(getLastMeasuredSize(mem({ circ: "x" }))).toBeNull();
    expect(getLastMeasuredSize(null)).toBeNull();
  });
  it("fitsDesignRange", () => {
    expect(fitsDesignRange(53, { sizeMin: 53, sizeMax: 68 })).toBe(true);
    expect(fitsDesignRange(52, { sizeMin: 53, sizeMax: 68 })).toBe(false);
    expect(fitsDesignRange(53.5, { sizeMin: 53, sizeMax: 68 })).toBe(false);
  });
});
