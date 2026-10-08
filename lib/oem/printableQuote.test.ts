// lib/oem/printableQuote.test.ts — 0163: ด่านขอบหน้าพิมพ์ของราคาพิเศษเงินแท่ง
// กติกา (design §6/§8 + oem-quote-invariants ข้อ 1): ราคาเว็บ/เหตุผล/ทุนของราคาพิเศษ "เห็นเฉพาะในระบบ" —
// PrintableQuote ห้ามมี field รองรับ · มี override → ตัดประโยค "ยืนราคาเฉพาะวันดังกล่าว" (silverPriceAsOf/CapturedAt = null)
import { describe, expect, it } from "vitest";
import { toPrintableQuote } from "./printableQuote";
import type { OemQuoteItemRow, OemQuoteRow } from "./types";

// ค่าเฉพาะตัวที่ "ห้ามโผล่" ในผลลัพธ์ — เลือกให้ไม่ชนกับตัวเลขอื่นในใบ
const SECRET_REASON = "ลับ-เหตุผลบวกเผื่อ-ABC";
const SECRET_WEB_PRICE = 1234.5;
const SECRET_COST = 987.65;

function quote(): OemQuoteRow {
  return {
    id: "q1",
    quoteNo: "RT-0001",
    status: "quoted",
    createdAt: "2026-10-07T03:00:00Z",
    quoteValidUntil: "2026-10-17",
    parentQuoteNo: null,
    customerName: "ลูกค้า",
    customerContact: null,
    billLegalName: null,
    billTaxId: null,
    billPhone: null,
    billContactChannel: null,
    billAddress: null,
    piecesSubtotal: 2200,
    nrePrice: 0,
    quoteTotal: 2200,
    discountThb: 0,
    discountReason: null,
    grandTotal: 2200,
    vatMode: "included",
    vatRate: 0.07,
    vatBaseThb: null,
    vatAmountThb: null,
    depositAmountThb: null,
    depositMode: null,
    depositPctEffective: null,
    balanceThb: null,
  } as unknown as OemQuoteRow;
}

function barItem(opts: { override: boolean; id?: string }): OemQuoteItemRow {
  return {
    id: opts.id ?? "i1",
    seq: 1,
    skuSnapshot: "S-1bath",
    productNameSnapshot: null,
    qty: 2,
    pricePerPiece: 1100,
    itemTotal: 2200,
    costPiece: SECRET_COST,
    input: {
      metal: "silver999",
      barSize: "1_baht",
      qty: 2,
      engraveImageThb: null,
      engraveTextThb: null,
      ...(opts.override ? { barPriceOverrideThb: 1100, barPriceOverrideReason: SECRET_REASON } : {}),
    },
    calc: {
      isComplete: true,
      missing: [],
      warnings: [],
      formulaVersion: 4,
      floors: {},
      breakdown: {
        costPiece: SECRET_COST,
        pricePerPiece: 1100,
        bar: {
          size: "1_baht",
          priceColumn: "bar_1_baht",
          barPricePerPiece: 1100,
          engraveImageThb: null,
          engraveTextThb: null,
          marginPctEmbedded: 0.19,
          asOfDate: "2026-10-07",
          sheetTime: "13:00",
          capturedAt: "2026-10-07T06:00:00Z",
          source: "sheet",
          ...(opts.override ? { webPricePerPiece: SECRET_WEB_PRICE, override: { thb: 1100, reason: SECRET_REASON } } : {}),
        },
      },
    },
  } as unknown as OemQuoteItemRow;
}

describe("toPrintableQuote — ราคาพิเศษเงินแท่ง", () => {
  it("มี override: ตัด silverPriceAsOf/CapturedAt (ประโยค 'ยืนราคาเฉพาะวันดังกล่าว') · เหลือ quoteValidUntil", () => {
    const p = toPrintableQuote(quote(), [barItem({ override: true })]);
    expect(p.silverPriceAsOf).toBeNull();
    expect(p.silverPriceCapturedAt).toBeNull();
    expect(p.quoteValidUntil).toBe("2026-10-17");
  });

  it("ไม่มี override: พฤติกรรมเดิม — ยังอ้างอิงราคาเงินแท่ง ณ วัน/เวลาที่ล็อก (ต้องไม่พัง)", () => {
    const p = toPrintableQuote(quote(), [barItem({ override: false })]);
    expect(p.silverPriceAsOf).toBe("2026-10-07");
    expect(p.silverPriceCapturedAt).toBe("2026-10-07T06:00:00Z");
  });

  it("ใบผสม (override + แท่งราคาเว็บ): ตัดประโยคเช่นกัน — ใบยืนถึงวันนี้ตาม least() ของ DB ซึ่งพิมพ์เป็น 'ยืนราคาถึง'", () => {
    const p = toPrintableQuote(quote(), [barItem({ override: false, id: "i1" }), barItem({ override: true, id: "i2" })]);
    expect(p.silverPriceAsOf).toBeNull();
  });

  it("ราคาที่พิมพ์ต่อแท่ง = ราคาที่คิดจริง (override) ไม่ใช่ราคาเว็บ", () => {
    const p = toPrintableQuote(quote(), [barItem({ override: true })]);
    expect(p.items[0].barPricePerPiece).toBe(1100);
    expect(p.items[0].pricePerPiece).toBe(1100);
  });

  it("🔴 ราคาเว็บ / เหตุผล / ทุน / override ไม่หลุดเข้า PrintableQuote ทั้งก้อน (serialize ทั้งใบแล้วหา)", () => {
    const serialized = JSON.stringify(toPrintableQuote(quote(), [barItem({ override: true })]));
    expect(serialized).not.toContain(SECRET_REASON);
    expect(serialized).not.toContain(String(SECRET_WEB_PRICE));
    expect(serialized).not.toContain(String(SECRET_COST));
    expect(serialized).not.toMatch(/override|webPrice|web_price/i);
    // marginPctEmbedded (0.19) ก็ไม่หลุด
    expect(serialized).not.toContain("0.19");
  });

  it("🔴 รายการ field ของ PrintableQuote / PrintableQuoteItem ถูกล็อก — เพิ่ม field = ต้องแก้เทสต์นี้โดยตั้งใจ (ห้ามเพิ่มเพื่อราคาพิเศษ)", () => {
    const p = toPrintableQuote(quote(), [barItem({ override: true })]);
    expect(Object.keys(p.items[0]).sort()).toEqual(
      [
        "barPricePerPiece",
        "barSizeLabel",
        "engraveImageThb",
        "engraveTextThb",
        "id",
        "itemKindFallback",
        "itemTotal",
        "material",
        "pricePerPiece",
        "productNameSnapshot",
        "qty",
        "seq",
        "skuSnapshot",
        "weightG",
      ].sort()
    );
    expect(Object.keys(p).sort()).toEqual(
      [
        "balanceThb",
        "billAddress",
        "billContactChannel",
        "billLegalName",
        "billPhone",
        "billTaxId",
        "createdAt",
        "customerContact",
        "customerName",
        "depositAmountThb",
        "depositMode",
        "depositPctEffective",
        "discountThb",
        "grandTotal",
        "id",
        "items",
        "nrePrice",
        "parentQuoteNo",
        "piecesSubtotal",
        "quoteNo",
        "quoteTotal",
        "quoteValidUntil",
        "silverPriceAsOf",
        "silverPriceCapturedAt",
        "status",
        "vatAmountThb",
        "vatBaseThb",
        "vatMode",
        "vatRate",
      ].sort()
    );
  });
});

// 0164: ชื่อ/ช่องทางติดต่อบนใบแก้ทีหลังได้แล้ว — หน้าพิมพ์ fallback (PrintQuoteClient: billLegalName || customerName) ต้องยังได้ค่าจาก quote ตรงๆ
describe("toPrintableQuote — customerName/customerContact (fallback ของหน้าพิมพ์เมื่อไม่มีข้อมูลออกบิล)", () => {
  it("ส่ง customerName/customerContact จากแถว quote ไปตรงๆ และ billLegalName ว่าง → ให้ฝั่งพิมพ์ใช้ customerName", () => {
    const q = { ...quote(), customerName: "ชื่อที่เติมทีหลัง", customerContact: "LINE: @late", billLegalName: null };
    const p = toPrintableQuote(q, [barItem({ override: false })]);
    expect(p.customerName).toBe("ชื่อที่เติมทีหลัง");
    expect(p.customerContact).toBe("LINE: @late");
    expect(p.billLegalName).toBeNull();
  });
  it("ลูกค้าว่าง (null) ยังเป็น null — ฝั่งพิมพ์แสดงขีดเหมือนเดิม ไม่แปลงเป็นสตริงว่าง", () => {
    const q = { ...quote(), customerName: null, customerContact: null };
    const p = toPrintableQuote(q, [barItem({ override: false })]);
    expect(p.customerName).toBeNull();
    expect(p.customerContact).toBeNull();
  });
});

// ============================================================================
// 0166: รายการสินค้า/บริการ — ทุน / เหตุผลราคา / ราคาแคตตาล็อก / ทุน manual ห้ามหลุดหน้าพิมพ์ (field set ของ PrintableQuote ไม่เปลี่ยน)
// ============================================================================
const P_REASON = "ลับ-เหตุผลลดราคา-XYZ";
const P_LIST = 3456.78;
const P_COST = 765.43;

function productItem(opts: { sku: string | null; name: string | null; id?: string; seq?: number }): OemQuoteItemRow {
  return {
    id: opts.id ?? "p1",
    seq: opts.seq ?? 1,
    skuSnapshot: opts.sku,
    productNameSnapshot: opts.name,
    qty: 3,
    pricePerPiece: 900,
    itemTotal: 2700,
    costPiece: P_COST,
    input: {
      metal: "product",
      qty: 3,
      productId: opts.sku ? "pid-1" : null,
      productName: opts.sku ? null : opts.name,
      unitPriceThb: 900,
      unitCostThb: opts.sku ? null : P_COST,
      priceReason: P_REASON,
    },
    calc: {
      isComplete: true,
      missing: [],
      warnings: ["ต้นทุนจากแคตตาล็อกเป็นค่าประมาณ"],
      formulaVersion: 5,
      floors: {},
      breakdown: {
        costPiece: P_COST,
        pricePerPiece: 900,
        bar: null,
        product: {
          productId: opts.sku ? "pid-1" : null,
          sku: opts.sku,
          name: opts.name,
          category: "หมวดลับ",
          costSource: opts.sku ? "catalog" : "manual",
          costBasis: "fixed",
          catalogListPrice: P_LIST,
          unitPriceThb: 900,
          belowCatalog: true,
          priceReason: P_REASON,
        },
      },
    },
  } as unknown as OemQuoteItemRow;
}

describe("toPrintableQuote — รายการสินค้า/บริการ (0166)", () => {
  it("catalog: ชื่อ/SKU = snapshot · จำนวน · ราคาต่อชิ้น · รวม · weightG null · barSizeLabel null", () => {
    const p = toPrintableQuote(quote(), [productItem({ sku: "T-SKU", name: "สินค้าทดสอบ" })]);
    const it = p.items[0];
    expect(it.skuSnapshot).toBe("T-SKU");
    expect(it.productNameSnapshot).toBe("สินค้าทดสอบ");
    expect(it.qty).toBe(3);
    expect(it.pricePerPiece).toBe(900);
    expect(it.itemTotal).toBe(2700);
    expect(it.weightG).toBeNull();
    expect(it.barSizeLabel).toBeNull();
    expect(it.barPricePerPiece).toBeNull();
    expect(it.material).toBe("product");
  });

  it("ไม่มี SKU: sku = null · ชื่อ fallback = productNameSnapshot (itemKindFallback ไม่ว่าง)", () => {
    const p = toPrintableQuote(quote(), [productItem({ sku: null, name: "กล่องสั่งทำ" })]);
    expect(p.items[0].skuSnapshot).toBeNull();
    expect(p.items[0].productNameSnapshot).toBe("กล่องสั่งทำ");
    expect(p.items[0].itemKindFallback).toBe("กล่องสั่งทำ");
  });

  it("ไม่มีแม้แต่ชื่อ snapshot → fallback กลาง 'สินค้า/บริการ' (หน้าพิมพ์ไม่ว่าง)", () => {
    const p = toPrintableQuote(quote(), [productItem({ sku: null, name: null })]);
    expect(p.items[0].itemKindFallback).toBe("สินค้า/บริการ");
  });

  it("🔴 ทุน / เหตุผลราคา / ราคาแคตตาล็อก / หมวด / ทุน manual ไม่หลุดเข้า PrintableQuote ทั้งก้อน (serialize แล้วหา)", () => {
    for (const item of [productItem({ sku: "T-SKU", name: "สินค้าทดสอบ" }), productItem({ sku: null, name: "กล่องสั่งทำ" })]) {
      const serialized = JSON.stringify(toPrintableQuote(quote(), [item]));
      expect(serialized).not.toContain(P_REASON);
      expect(serialized).not.toContain(String(P_LIST));
      expect(serialized).not.toContain(String(P_COST));
      expect(serialized).not.toContain("หมวดลับ");
      expect(serialized).not.toMatch(/catalogListPrice|belowCatalog|priceReason|costSource|costBasis|breakdown|calc|input/i);
    }
  });

  it("🔴 field set ของ item สินค้าเท่ากับ item เงินแท่ง (ไม่เพิ่ม field เพื่อสินค้า — ห้ามเพิ่ม catalogListPrice)", () => {
    const prodKeys = Object.keys(toPrintableQuote(quote(), [productItem({ sku: "T-SKU", name: "สินค้าทดสอบ" })]).items[0]).sort();
    const barKeys = Object.keys(toPrintableQuote(quote(), [barItem({ override: false })]).items[0]).sort();
    expect(prodKeys).toEqual(barKeys);
  });

  it("ใบสินค้าล้วน: ไม่มีประโยคอ้างอิงราคาเงินแท่ง (silverPriceAsOf/CapturedAt = null) · ใบผสมกับแท่งราคาเว็บยังอ้างอิงตามเดิม", () => {
    const only = toPrintableQuote(quote(), [productItem({ sku: "T-SKU", name: "สินค้าทดสอบ" })]);
    expect(only.silverPriceAsOf).toBeNull();
    expect(only.silverPriceCapturedAt).toBeNull();
    const mixed = toPrintableQuote(quote(), [productItem({ sku: "T-SKU", name: "สินค้าทดสอบ" }), barItem({ override: false, id: "b1" })]);
    expect(mixed.silverPriceAsOf).toBe("2026-10-07");
  });
});

// ============================================================================
// 0167 (มติเจ้าของ): เหตุผลส่วนลด / เหตุผลตอนต่อราคา (discount_reason) ไม่พิมพ์บนใบลูกค้า
// ============================================================================
describe("toPrintableQuote — discount_reason ไม่หลุดหน้าพิมพ์", () => {
  const SECRET_DISCOUNT_REASON = "ลับ-ลูกค้าขู่ย้ายร้าน-ลดให้พิเศษ";
  it("🔴 PrintableQuote ไม่มี field discountReason · เหตุผลไม่ปรากฏเมื่อ serialize ทั้งใบ · ยังเหลือยอดส่วนลด", () => {
    const q = { ...quote(), discountThb: 300, discountReason: SECRET_DISCOUNT_REASON } as OemQuoteRow;
    const p = toPrintableQuote(q, [barItem({ override: false })]);
    expect(p).not.toHaveProperty("discountReason");
    expect(JSON.stringify(p)).not.toContain(SECRET_DISCOUNT_REASON);
    expect(p.discountThb).toBe(300);
  });
});

// ============================================================================
// 0168: เหตุผลอนุมัติ (approval_note — ใช้กับ MOQ/ล็อตโลหะ, note-tier, F2) ห้ามหลุดใบลูกค้า (invariant ข้อ 1)
// ============================================================================
describe("toPrintableQuote — approval_note ไม่หลุดหน้าพิมพ์", () => {
  const SECRET_NOTE = "ลับ-อนุมัติเพราะลูกค้าประจำ-ต่ำกว่า-MOQ";
  it("🔴 PrintableQuote ไม่มี field approvalNote · เหตุผลไม่ปรากฏเมื่อ serialize ทั้งใบ", () => {
    const q = { ...quote(), approvalNote: SECRET_NOTE, lostReason: "ลับ-lost" } as unknown as OemQuoteRow;
    const p = toPrintableQuote(q, [barItem({ override: false })]);
    expect(p).not.toHaveProperty("approvalNote");
    expect(JSON.stringify(p)).not.toContain(SECRET_NOTE);
    expect(JSON.stringify(p)).not.toContain("ลับ-lost");
  });
});

// ============================================================================
// 0169: งานผลิตที่ผู้ใช้พิมพ์ราคาต่อชิ้นทับ — ราคาที่ลูกค้าเห็นคือราคาที่พิมพ์ · ราคาจากสูตร / เหตุผล / ทุน ห้ามหลุด (field set ไม่เปลี่ยน)
// ============================================================================
const OVR_FORMULA = 7654.32;
const OVR_REASON = "ลับ-ลดให้เพราะคู่แข่งเสนอต่ำกว่า";
const OVR_COST = 3210.98;

function productionOverrideItem(): OemQuoteItemRow {
  return {
    id: "po1",
    seq: 1,
    skuSnapshot: null,
    productNameSnapshot: null,
    qty: 50,
    pricePerPiece: 4000,
    itemTotal: 200000,
    costPiece: OVR_COST,
    input: {
      metal: "silver",
      itemKind: "แหวน",
      weightG: 3.5,
      qty: 50,
      unitPriceOverrideThb: 4000,
      priceOverrideReason: OVR_REASON,
    },
    calc: {
      isComplete: true,
      missing: [],
      warnings: [],
      formulaVersion: 3,
      floors: { priceVsCost: { applies: true, pass: true } },
      breakdown: {
        costPiece: OVR_COST,
        pricePerPiece: 4000,
        bar: null,
        product: null,
        productionOverride: { thb: 4000, reason: OVR_REASON, formulaPricePerPiece: OVR_FORMULA },
      },
    },
  } as unknown as OemQuoteItemRow;
}

describe("toPrintableQuote — งานผลิตที่พิมพ์ราคาทับ (0169)", () => {
  it("ราคาต่อชิ้น/ยอดรวมบนใบ = ราคาที่พิมพ์ (pricePerPiece/itemTotal ที่เก็บ) · ชนิดงาน/น้ำหนักตามปกติ", () => {
    const it = toPrintableQuote(quote(), [productionOverrideItem()]).items[0];
    expect(it.pricePerPiece).toBe(4000);
    expect(it.itemTotal).toBe(200000);
    expect(it.itemKindFallback).toBe("แหวน");
    expect(it.weightG).toBe(3.5);
    expect(it.barSizeLabel).toBeNull();
  });

  it("🔴 ราคาจากสูตร / เหตุผล / ทุน / price_vs_cost ไม่หลุดเข้า PrintableQuote ทั้งก้อน (serialize แล้วหา)", () => {
    const serialized = JSON.stringify(toPrintableQuote(quote(), [productionOverrideItem()]));
    expect(serialized).not.toContain(OVR_REASON);
    expect(serialized).not.toContain(String(OVR_FORMULA));
    expect(serialized).not.toContain(String(OVR_COST));
    expect(serialized).not.toMatch(/productionOverride|production_override|formulaPrice|priceVsCost|price_vs_cost|priceOverrideReason|unitPriceOverride/i);
  });

  it("🔴 field set ของ item งานผลิตที่พิมพ์ราคาทับ = field set ของ item เงินแท่ง (ไม่เพิ่ม field เพื่อ override)", () => {
    const a = Object.keys(toPrintableQuote(quote(), [productionOverrideItem()]).items[0]).sort();
    const b = Object.keys(toPrintableQuote(quote(), [barItem({ override: false })]).items[0]).sort();
    expect(a).toEqual(b);
  });
});

// ============================================================================
// 0170: ค่า NRE ของรายการที่พิมพ์ราคาทับตามราคา — บนใบลูกค้าเห็นแค่ค่า NRE ที่คิดแล้ว (nrePrice) · ทุน NRE / margin ที่ใช้คิด ห้ามหลุด (field set ไม่เปลี่ยน)
// ============================================================================
describe("toPrintableQuote — NRE ของรายการที่พิมพ์ราคาทับ (0170)", () => {
  const SECRET_NRE_COST = 4321.99;
  const SECRET_NRE_MARGIN = 0.6789;
  function quoteWithNre(): OemQuoteRow {
    return { ...quote(), nrePrice: 5000, nreCost: SECRET_NRE_COST, piecesSubtotal: 200000, quoteTotal: 205000, grandTotal: 205000 } as unknown as OemQuoteRow;
  }
  function itemWithNreMargin(): OemQuoteItemRow {
    const base = productionOverrideItem() as unknown as { calc: { breakdown: Record<string, unknown> } };
    base.calc.breakdown.nre = { cad: 1, print3d: 1, mold: 1, cost: SECRET_NRE_COST, price: 5000 };
    (base.calc.breakdown.productionOverride as Record<string, unknown>).nreMarginUsed = SECRET_NRE_MARGIN;
    return base as unknown as OemQuoteItemRow;
  }

  it("ค่า NRE บนใบ = nrePrice ของใบ (ค่าที่ DB คิดใหม่) · ยอดรวมตรงกัน", () => {
    const p = toPrintableQuote(quoteWithNre(), [itemWithNreMargin()]);
    expect(p.nrePrice).toBe(5000);
    expect(p.piecesSubtotal).toBe(200000);
    expect(p.quoteTotal).toBe(205000);
  });

  it("🔴 ทุน NRE / margin ที่ใช้คิด NRE / nreMarginUsed ไม่หลุดเข้า PrintableQuote ทั้งก้อน (serialize แล้วหา)", () => {
    const serialized = JSON.stringify(toPrintableQuote(quoteWithNre(), [itemWithNreMargin()]));
    expect(serialized).not.toContain(String(SECRET_NRE_COST));
    expect(serialized).not.toContain(String(SECRET_NRE_MARGIN));
    expect(serialized).not.toMatch(/nreCost|nre_cost|nreMargin|nre_margin/i);
  });
});
