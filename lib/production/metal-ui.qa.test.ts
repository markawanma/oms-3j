// QA (R2-D2) — เคสโหด/ขอบที่ test ของ dev ยังไม่ครอบ: ภาษาไทย/ตัวเลขเต็มความกว้าง/e-notation/ช่องว่างล่องหน/ค่าใหญ่ผิดปกติ
// ครอบ: ช่องน้ำหนัก/เนื้อ/จำนวน (metal-ui) + ตัวแปลงราคาทอง/ทองเหลือง (metal-price) + brassPerGramToKgText
import { describe, expect, it } from "vitest";
import { purityFieldIssue, qtyFieldIssue, weightFieldIssue, closeBlockers, itemDisplayName } from "./metal-ui";
import { brassPerGramToKgText, convertMetalPriceInput, isMetalPricePerGramInRange } from "@/lib/oem/metal-price";
import type { ProductionOrderItemRow } from "./types";

describe("QA: ช่องน้ำหนัก — input แปลกต้องถูกปฏิเสธ ไม่หลุดเป็นตัวเลข", () => {
  const bad = ["๓.๒", "３.２", "3,2", "3.2g", "1e2", "0x10", "+3", "-3", ".5", "3.", "  .  ", "0", "0.000", "10000.001", "100000", "NaN", "Infinity", "3.2 5", "3​.2", "😀"];
  it.each(bad)("ปฏิเสธ %j", (t) => {
    expect(weightFieldIssue(t)).not.toBeNull();
  });
  const good = ["", "   ", "0.001", "10000", "10000.000", "3.2", " 3.200 ", "00003.2"];
  it.each(good)("ผ่าน %j", (t) => {
    expect(weightFieldIssue(t)).toBeNull();
  });
});

describe("QA: ช่องจำนวน — จำนวนเต็ม 1-100000 เท่านั้น", () => {
  it.each(["", "0", "-1", "1.5", "1e3", "１２", "๑๒", "100001", "1234567", " ", "12 3"])("ปฏิเสธ %j", (t) => {
    expect(qtyFieldIssue(t)).not.toBeNull();
  });
  it.each(["1", "100000", " 5 ", "000001"])("ผ่าน %j", (t) => {
    expect(qtyFieldIssue(t)).toBeNull();
  });
});

describe("QA: ช่องเนื้อ — ทองห้ามผ่านด้วยค่าว่าง/ล่องหน/สัดส่วน · เงินว่างได้ (มติเจ้าของ) · ทองเหลืองไม่ตรวจ", () => {
  it("ทอง: ว่าง/ช่องว่างล้วน = บังคับกรอก", () => {
    expect(purityFieldIssue("gold", "")).not.toBeNull();
    expect(purityFieldIssue("gold", "   ")).not.toBeNull();
  });
  it("ทอง: 0.965 (สัดส่วน) / ไทย / เกินช่วง / ต่ำกว่าขั้นต่ำ / ทศนิยม 3 ตำแหน่ง ถูกปฏิเสธ", () => {
    for (const t of ["0.965", "๙๖.๕", "100.01", "37.49", "96.555", "abc", "96,5", "1e2", "-96.5", "0"]) {
      expect(purityFieldIssue("gold", t), t).not.toBeNull();
    }
  });
  it("ทอง: ขอบ 37.50 และ 100 ผ่าน", () => {
    expect(purityFieldIssue("gold", "37.50")).toBeNull();
    expect(purityFieldIssue("gold", "100")).toBeNull();
    expect(purityFieldIssue("gold", "96.5")).toBeNull();
  });
  it("เงิน: ว่างไม่ error (ค่าเริ่ม 92.50) แต่ถ้าพิมพ์มาแล้วผิดก็ยังต้อง error", () => {
    expect(purityFieldIssue("silver", "")).toBeNull();
    expect(purityFieldIssue("silver", "0.925")).not.toBeNull();
    expect(purityFieldIssue("silver", "37.49")).not.toBeNull();
  });
  it("ทองเหลือง: ไม่ตรวจเนื้อ (ล็อก 100) แม้ค่าในช่องเป็นขยะ", () => {
    expect(purityFieldIssue("brass", "xyz")).toBeNull();
  });
});

describe("QA: ตัวแปลงราคาทอง (ราคาสมาคมบาทละ → บาท/กรัม 100%) — input โหด", () => {
  it.each([
    ["", "invalid"],
    ["   ", "invalid"],
    ["abc", "invalid"],
    ["๔๑๒๕๐", "invalid"],
    ["４１２５０", "invalid"],
    ["41250e0", "invalid"],
    ["-41250", "invalid"],
    ["0", "invalid"],
    ["0.00", "invalid"],
    ["NaN", "invalid"],
    ["Infinity", "invalid"],
    ["100000000", "invalid"],
    ["41250.001", "decimals"],
    ["41250.5555", "decimals"],
  ])("ทอง %j → %s", (input, issue) => {
    const r = convertMetalPriceInput("gold", input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue).toBe(issue);
  });
  it("number ที่เป็น NaN/Infinity/1e21/ลบ ถูกปฏิเสธ", () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, 1e21, -1, 0]) {
      expect(convertMetalPriceInput("gold", n).ok).toBe(false);
      expect(convertMetalPriceInput("brass", n).ok).toBe(false);
    }
  });
  it("ขอบช่วงทอง (golden ตาม UX A.8.1): 29,420.92 ผ่าน · 29,420.00 ตก · 117,683.68 ผ่าน · 117,684.00 ตก", () => {
    const lo = convertMetalPriceInput("gold", "29,420.92");
    expect(lo.ok).toBe(true);
    if (lo.ok) expect(lo.perGramText).toBe("2000.0000");
    const below = convertMetalPriceInput("gold", "29,420.00");
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.issue).toBe("range");
    expect(convertMetalPriceInput("gold", "117,683.68").ok).toBe(true);
    const above = convertMetalPriceInput("gold", "117,684.00");
    expect(above.ok).toBe(false);
  });
  it("พิมพ์ราคาต่อกรัมผิดหน่วย (เช่น 2,000 บาท/กรัม ลงช่องบาทละ) → ตก range ไม่ถูกเก็บ", () => {
    for (const t of ["2000", "4736", "8000", "41.25"]) {
      const r = convertMetalPriceInput("gold", t);
      expect(r.ok, t).toBe(false);
    }
  });
  it("ราคาทองเหลืองกรอกเป็นบาท/กรัม (0.35) หรือสตางค์ผิดหน่วย → ตก range", () => {
    for (const t of ["0.35", "1", "99.99", "1000.01", "350000"]) {
      expect(convertMetalPriceInput("brass", t).ok, t).toBe(false);
    }
    for (const t of ["100", "1000", "350.00", "1,000.00"]) {
      expect(convertMetalPriceInput("brass", t).ok, t).toBe(true);
    }
  });
  it("ปัดครึ่งขึ้นที่ 4 ตำแหน่ง ตรงกับ numeric: ทองเหลือง 350.05 บาท/กก. = 0.35005 → 0.3501", () => {
    const r = convertMetalPriceInput("brass", "350.05");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perGramText).toBe("0.3501");
  });
});

describe("QA: isMetalPricePerGramInRange — ค่าเดิมในแถว (ใช้ตัดสินป้าย 'นอกช่วง')", () => {
  it("ทอง 25 ส.ค. 4,736 อยู่ในช่วง · ทองเหลือง 1.0000 ขอบบนผ่าน · 1.0001 ตก · 0.0999 ตก", () => {
    expect(isMetalPricePerGramInRange("gold", 4736)).toBe(true);
    expect(isMetalPricePerGramInRange("brass", 1)).toBe(true);
    expect(isMetalPricePerGramInRange("brass", 1.0001)).toBe(false);
    expect(isMetalPricePerGramInRange("brass", 0.0999)).toBe(false);
    expect(isMetalPricePerGramInRange("brass", 0.1)).toBe(true);
  });
  it("NaN/ลบ/0/e-notation ตก ไม่ throw", () => {
    for (const n of [Number.NaN, -1, 0, 1e21, 1e-7, Number.POSITIVE_INFINITY]) {
      expect(isMetalPricePerGramInRange("gold", n)).toBe(false);
    }
  });
});

describe("QA: brassPerGramToKgText — แสดงผลอย่างเดียว ห้ามเพี้ยน/ห้าม throw", () => {
  it("0.3506 → 350.6 · 1 → 1,000 · 0.1 → 100", () => {
    expect(brassPerGramToKgText("0.3506")).toBe("350.6");
    expect(brassPerGramToKgText("1")).toBe("1,000");
    expect(brassPerGramToKgText("0.1000")).toBe("100");
  });
  it("ไม่ใช่ตัวเลขที่ถูกต้อง → null", () => {
    for (const t of ["", "abc", "-1", "1.00001", "1e3", "๑", "1,5"]) expect(brassPerGramToKgText(t), t).toBeNull();
  });
});

describe("QA: closeBlockers / itemDisplayName กับข้อมูลชื่อแบบแปลกๆ", () => {
  function item(over: Partial<ProductionOrderItemRow>): ProductionOrderItemRow {
    return {
      id: "i", productionOrderId: "po", poNo: "PO", orderStatus: "open", productId: null, sku: null, productName: null, pendingProductLabel: null,
      currentCostType: null, currentUnitCost: null, metal: null, purity: null, weightG: null, weightSource: null,
      effectiveMetal: "silver", effectivePurity: 0.925, effectiveWeightG: null, effectiveWeightSource: null,
      skuMetal: null, skuPurity: null, skuWeightG: null, skuMetalKnown: false, qtyPlanned: 1, qtyDone: null, stampedUnitCost: null,
      prevCostType: null, prevUnitCost: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", makeSpec: null,
      currentSilverWeightG: null, currentSilverPurity: null, isNewDesign: false, costCalc: null, ...over,
    } as ProductionOrderItemRow;
  }
  it("ชื่อแบบไทย+emoji+ยาวมาก ไม่ throw และไม่ตัดข้อความกลางทาง (CSS เป็นคนห่อ)", () => {
    const label = "แหวน😀ลายใบไม้".repeat(30);
    const b = closeBlockers([item({ pendingProductLabel: label })], new Set());
    expect(b).toHaveLength(1);
    expect(b[0].message).toContain(label);
    expect(itemDisplayName(item({ pendingProductLabel: label }))).toContain(label);
  });
  it("ไม่มีทั้ง SKU และชื่อแบบ (ข้อมูลเสีย) → ไม่พิมพ์ 'null'/'undefined'", () => {
    const b = closeBlockers([item({})], new Set());
    expect(b[0].message).not.toMatch(/null|undefined/);
    expect(itemDisplayName(item({}))).not.toMatch(/null|undefined/);
  });
  it("SKU spec ที่น้ำหนักขาด + ไม่มี SKU อีกรายการ: ทั้ง 2 ข้อขึ้น เรียง unbound → weight", () => {
    const b = closeBlockers(
      [item({ id: "a", productId: "p", sku: "S-1", currentCostType: "spec", effectiveWeightG: null }), item({ id: "b", pendingProductLabel: "x" })],
      new Set()
    );
    expect(b.map((x) => x.code)).toEqual(["unbound", "weight"]);
  });
});
