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
        "discountReason",
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
