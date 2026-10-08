// lib/oem/quoteForm.test.ts — 0163 ราคาพิเศษเงินแท่ง: ด่านฝั่งฟอร์ม (รูปร่างของข้อมูลที่จะส่งไป calc) + วันยืนราคา
// ไม่มีการคิดเงินในไฟล์นี้ — ฟอร์มแค่ validate รูปร่าง "ต่ำกว่าทุนไหม" ตัดสินที่ DB (verify-0163.sql)
import { describe, expect, it } from "vitest";
import {
  OEM_BAR_OVERRIDE_MAX_DAYS,
  addDaysIso,
  aggregateQuotePreview,
  applyProductSelection,
  calcBelowQtyFloors,
  bangkokToday,
  barOverrideIssue,
  barValidUntilIssue,
  buildJobInput,
  createJobForm,
  enterProductMode,
  jobHasBarOverride,
  productFormIssue,
  shouldAutoSwitchToProduct,
} from "./quoteForm";
import type { JobForm } from "./quoteForm";
import type { OemPriceCalcResult, OemProductOption } from "./types";

function barJob(over: Partial<JobForm> = {}): JobForm {
  return { ...createJobForm(30), metal: "silver999", barSize: "1_baht", qty: "2", ...over };
}

describe("buildJobInput — เงินแท่ง ไม่มีราคาพิเศษ (พฤติกรรมเดิม)", () => {
  it("override เป็น null ทั้งคู่เมื่อช่องว่าง", () => {
    const input = buildJobInput(barJob());
    expect(input).toEqual({
      metal: "silver999",
      barSize: "1_baht",
      qty: 2,
      engraveImageThb: null,
      engraveTextThb: null,
      barPriceOverrideThb: null,
      barPriceOverrideReason: null,
    });
  });

  it("เหตุผลลอย (ราคายังว่าง) ไม่ถูกส่งต่อ — reason ไม่ไป calc ถ้าราคายังว่าง", () => {
    const input = buildJobInput(barJob({ barPriceOverrideReason: "พิมพ์เหตุผลก่อนราคา" }));
    expect(input).not.toBeNull();
    expect(input?.barPriceOverrideThb).toBeNull();
    expect(input?.barPriceOverrideReason).toBeNull();
  });

  it("ราคาเป็นเว้นวรรคล้วน = ไม่มี override", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "   ", barPriceOverrideReason: "x" }));
    expect(input?.barPriceOverrideThb).toBeNull();
    expect(jobHasBarOverride(barJob({ barPriceOverrideThb: "   " }))).toBe(false);
  });
});

describe("buildJobInput — เงินแท่ง มีราคาพิเศษ", () => {
  it("ราคา + เหตุผลครบ → ส่งตัวเลขจริง (ไม่ปัด) + เหตุผลที่ trim แล้ว", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "  bid งาน A  " }));
    expect(input?.barPriceOverrideThb).toBe(1100);
    expect(input?.barPriceOverrideReason).toBe("bid งาน A");
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1234.56", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(1234.56);
  });

  it("มีราคาแต่ไม่มีเหตุผล / เหตุผลเว้นวรรค → null (ไม่ยิง calc ระหว่างพิมพ์)", () => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1100" }))).toBeNull();
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "   " }))).toBeNull();
  });

  it.each(["0", "-5", "abc", "1e7", "1000001", "1234.567", "Infinity", "NaN"])("ราคา %s → null", (price) => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: price, barPriceOverrideReason: "x" }))).toBeNull();
  });

  it("ขอบ: 0.01 และ 1,000,000 ผ่านรูปร่าง (DB เป็นคนตัดสินเรื่องทุน/เพดาน 2 เท่า)", () => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: "0.01", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(0.01);
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1000000", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(1000000);
  });

  it("ค่ายิงเลเซอร์ยังทำงานคู่กับราคาพิเศษ", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "x", engraveImageThb: "150" }));
    expect(input?.engraveImageThb).toBe(150);
    expect(input?.barPriceOverrideThb).toBe(1100);
  });
});

describe("งานผลิต — ช่อง override ที่หลงมาต้องไม่รั่วเข้า input", () => {
  it("metal=silver ที่มีค่าค้างในช่องราคาพิเศษ → ไม่มี key override ใน input และ jobHasBarOverride=false", () => {
    const job: JobForm = {
      ...createJobForm(30),
      metal: "silver",
      itemKind: "แหวน",
      polishTier: "เรียบ",
      qty: "10",
      weightG: "5",
      barPriceOverrideThb: "1100",
      barPriceOverrideReason: "ค้างจากตอนเป็นเงินแท่ง",
    };
    const input = buildJobInput(job);
    expect(input).not.toBeNull();
    expect(input).not.toHaveProperty("barPriceOverrideThb");
    expect(input).not.toHaveProperty("barPriceOverrideReason");
    expect(jobHasBarOverride(job)).toBe(false);
    expect(barOverrideIssue(job)).toBeNull();
  });
});

describe("barOverrideIssue", () => {
  it("ไม่มีราคาพิเศษ → null", () => {
    expect(barOverrideIssue(barJob())).toBeNull();
  });
  it("ราคาผิดรูปร่าง / ทศนิยมเกิน 2 / ไม่มีเหตุผล → ข้อความ (ไม่ใช่ null)", () => {
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "-1", barPriceOverrideReason: "x" }))).toMatch(/มากกว่า 0/);
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "10.123", barPriceOverrideReason: "x" }))).toMatch(/2 ตำแหน่ง/);
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "1100" }))).toMatch(/เหตุผล/);
  });
  it("ครบ → null", () => {
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "x" }))).toBeNull();
  });
});

describe("วันยืนราคา (เวลาไทย)", () => {
  it("bangkokToday: ช่วง 00:00-07:00 ไทยต้องเป็นวันใหม่ ไม่ใช่เมื่อวานแบบ UTC", () => {
    expect(bangkokToday(new Date("2026-10-06T18:30:00Z"))).toBe("2026-10-07"); // 01:30 ไทย
    expect(bangkokToday(new Date("2026-10-07T16:59:59Z"))).toBe("2026-10-07"); // 23:59:59 ไทย
    expect(bangkokToday(new Date("2026-10-07T17:00:00Z"))).toBe("2026-10-08"); // 00:00 ไทยวันถัดไป
  });

  it("addDaysIso: ข้ามเดือน/ข้ามปี/ปีอธิกสุรทิน", () => {
    expect(addDaysIso("2026-10-07", 30)).toBe("2026-11-06");
    expect(addDaysIso("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDaysIso("2028-02-15", 30)).toBe("2028-03-16");
    expect(addDaysIso("2026-10-07", 0)).toBe("2026-10-07");
  });

  const now = new Date("2026-10-06T18:30:00Z"); // วันนี้ (ไทย) = 2026-10-07
  it("วันนี้ และ วันนี้+30 ผ่าน (ต้องไม่พัง)", () => {
    expect(barValidUntilIssue("2026-10-07", now)).toBeNull();
    expect(barValidUntilIssue(addDaysIso("2026-10-07", OEM_BAR_OVERRIDE_MAX_DAYS), now)).toBeNull();
  });
  it("เมื่อวาน (ไทย) / +31 / ว่าง / รูปแบบผิด → ข้อความ", () => {
    expect(barValidUntilIssue("2026-10-06", now)).toMatch(/ย้อนหลัง/);
    expect(barValidUntilIssue(addDaysIso("2026-10-07", 31), now)).toMatch(/ไม่เกิน 30 วัน/);
    expect(barValidUntilIssue("", now)).toMatch(/เลือกวัน/);
    expect(barValidUntilIssue("07/10/2026", now)).toMatch(/เลือกวัน/);
  });
});

// ============================================================================
// 0166 รายการสินค้า/บริการ (metal='product') — ฟอร์มแค่ตั้งราคาตั้งต้น + pre-check รูปร่าง · ราคา/ทุนจริงตัดสินที่ DB
// (ตัวเลข fixture สมมติ ไม่ใช่ราคา/ทุนจริง)
// ============================================================================
const SKU_A: OemProductOption = { productId: "p-a", sku: "T-A", name: "สินค้าเอ", category: null, listPrice: 1000 };
const SKU_NO_PRICE: OemProductOption = { productId: "p-n", sku: "T-N", name: "สินค้าไม่มีราคา", category: null, listPrice: null };

function productJob(over: Partial<JobForm> = {}): JobForm {
  return { ...createJobForm(30), metal: "product", qty: "2", unitPriceThb: "900", ...over };
}

describe("applyProductSelection — เลือก SKU แล้วราคาตั้งต้น = ราคาแคตตาล็อก", () => {
  it("โหมดสินค้า: เลือก SKU → ราคาตั้งต้น = list price · ตั้ง label ครบ · ล้างทุน/ชื่อ/เหตุผลของโหมดเก่า", () => {
    const job = applyProductSelection(
      productJob({ unitPriceThb: "", unitCostThb: "50", productName: "ชื่อเก่า", priceReason: "เหตุผลเก่า" }),
      SKU_A
    );
    expect(job.unitPriceThb).toBe("1000");
    expect(job.productId).toBe("p-a");
    expect(job.skuSnapshot).toBe("T-A");
    expect(job.productNameSnapshot).toBe("สินค้าเอ");
    expect(job.listPriceThb).toBe(1000);
    expect(job.unitCostThb).toBe("");
    expect(job.productName).toBe("");
    expect(job.priceReason).toBe("");
  });

  it("เปลี่ยน SKU → ราคาตั้งต้นเปลี่ยนตาม SKU ใหม่ (ไม่ค้างราคาของ SKU เก่า)", () => {
    const a = applyProductSelection(productJob(), SKU_A);
    const n = applyProductSelection(a, SKU_NO_PRICE);
    expect(n.unitPriceThb).toBe(""); // SKU ไม่มีราคา → ให้กรอกเอง ไม่เดา
    expect(n.listPriceThb).toBeNull();
  });

  it("ล้าง SKU (null) → กลับโหมดไม่มี SKU: คงราคาที่กรอก · ล้าง label/list", () => {
    const a = applyProductSelection(productJob(), SKU_A);
    const cleared = applyProductSelection({ ...a, unitPriceThb: "850" }, null);
    expect(cleared.productId).toBeNull();
    expect(cleared.skuSnapshot).toBeNull();
    expect(cleared.listPriceThb).toBeNull();
    expect(cleared.unitPriceThb).toBe("850");
  });

  it("ไม่ใช่โหมดสินค้า (งานผลิต/เงินแท่ง): SKU เป็น label เหมือนเดิม — ไม่แตะช่องราคา (ต้องไม่พัง)", () => {
    const prod = { ...createJobForm(30), metal: "silver" as const, itemKind: "แหวน", unitPriceThb: "" };
    const next = applyProductSelection(prod, SKU_A);
    expect(next.productId).toBe("p-a");
    expect(next.skuSnapshot).toBe("T-A");
    expect(next.unitPriceThb).toBe("");
    expect(next.metal).toBe("silver");
  });
});

describe("shouldAutoSwitchToProduct / enterProductMode", () => {
  it("รายการงานผลิตที่ยังไม่ได้กรอกประเภท/น้ำหนัก/ระดับขัด → สลับเป็นสินค้าได้ (qty ที่พิมพ์ไว้ไม่นับ)", () => {
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), qty: "3" })).toBe(true);
  });
  it("กรอกงานผลิตไปแล้ว (ประเภท หรือ น้ำหนัก หรือ ระดับขัด) → ไม่สลับ (SKU เป็น label เหมือนเดิม)", () => {
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), itemKind: "แหวน" })).toBe(false);
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), weightG: "3.5" })).toBe(false);
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), polishTier: "เรียบ" })).toBe(false);
  });
  it("เงินแท่ง / สินค้าอยู่แล้ว → ไม่สลับ", () => {
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), metal: "silver999" })).toBe(false);
    expect(shouldAutoSwitchToProduct({ ...createJobForm(30), metal: "product" })).toBe(false);
  });
  it("เปลี่ยนวัสดุเป็นสินค้าเมื่อมี SKU label ผูกอยู่ → ใช้ราคาแคตตาล็อกเป็นราคาตั้งต้น (ช่องว่างเท่านั้น) · ไม่มีทุน", () => {
    const labelled = { ...createJobForm(30), productId: "p-a", skuSnapshot: "T-A", productNameSnapshot: "สินค้าเอ" };
    const e = enterProductMode(labelled, [SKU_A]);
    expect(e.metal).toBe("product");
    expect(e.unitPriceThb).toBe("1000");
    expect(e.listPriceThb).toBe(1000);
    expect(e.unitCostThb).toBe("");
    // ราคาที่กรอกไว้แล้วไม่ถูกทับ
    expect(enterProductMode({ ...labelled, unitPriceThb: "777" }, [SKU_A]).unitPriceThb).toBe("777");
    // ไม่มี SKU → โหมดไม่มี SKU
    const none = enterProductMode(createJobForm(30), [SKU_A]);
    expect(none.productId).toBeNull();
    expect(none.listPriceThb).toBeNull();
  });
});

describe("buildJobInput — รายการสินค้า", () => {
  it("catalog: ส่ง productId + ราคา · ไม่มีทุน/ชื่อ (null) · เหตุผลที่ไม่ว่างเท่านั้น", () => {
    const job = applyProductSelection(productJob({ priceReason: "  ลูกค้าประจำ  " }), SKU_A);
    const withPrice = { ...job, unitPriceThb: "1200" }; // เท่าหรือสูงกว่า list → ไม่ต้องมีเหตุผล
    expect(buildJobInput(withPrice)).toEqual({
      metal: "product",
      qty: 2,
      productId: "p-a",
      productName: null,
      unitPriceThb: 1200,
      unitCostThb: null,
      priceReason: null, // applyProductSelection ล้างเหตุผลของ SKU เก่า — กรอกใหม่หลังเลือก
    });
    expect(buildJobInput({ ...withPrice, priceReason: "  ลูกค้าประจำ  " })?.priceReason).toBe("ลูกค้าประจำ");
  });

  it("manual: ต้องมีชื่อ + ทุน → ส่ง productName (trim) + unitCostThb · ไม่มี productId", () => {
    const job = productJob({ productName: "  กล่องสั่งทำ ", unitPriceThb: "100.5", unitCostThb: "60.25", qty: "3" });
    expect(buildJobInput(job)).toEqual({
      metal: "product",
      qty: 3,
      productId: null,
      productName: "กล่องสั่งทำ",
      unitPriceThb: 100.5,
      unitCostThb: 60.25,
      priceReason: null,
    });
  });

  it.each([
    ["manual ไม่มีชื่อ", productJob({ unitCostThb: "50" })],
    ["manual ไม่มีทุน", productJob({ productName: "ค่าส่ง" })],
    ["manual ทุน 0", productJob({ productName: "ค่าส่ง", unitCostThb: "0" })],
    ["ราคาว่าง", productJob({ productName: "ค่าส่ง", unitCostThb: "5", unitPriceThb: "" })],
    ["ราคา 0", productJob({ productName: "ค่าส่ง", unitCostThb: "5", unitPriceThb: "0" })],
    ["ราคาทศนิยม 3 ตำแหน่ง", productJob({ productName: "ค่าส่ง", unitCostThb: "5", unitPriceThb: "1.005" })],
    ["ราคาเกิน 1,000,000", productJob({ productName: "ค่าส่ง", unitCostThb: "5", unitPriceThb: "1000001" })],
    ["จำนวนว่าง", productJob({ productName: "ค่าส่ง", unitCostThb: "5", qty: "" })],
    ["จำนวนทศนิยม", productJob({ productName: "ค่าส่ง", unitCostThb: "5", qty: "1.5" })],
    ["ชื่อมีขึ้นบรรทัดใหม่", productJob({ productName: "a\nb", unitCostThb: "5" })],
  ])("%s → null (ไม่ยิง calc) และมีข้อความบอกสาเหตุ", (_n, job) => {
    expect(buildJobInput(job)).toBeNull();
    expect(productFormIssue(job)).toBeTruthy();
  });

  it("catalog + มีทุนค้างในฟอร์ม → ทุนไม่ถูกส่ง (productInputFromForm ตัดทิ้งเมื่อมี productId)", () => {
    const job = { ...applyProductSelection(productJob(), SKU_A), unitPriceThb: "1000", unitCostThb: "999" };
    const input = buildJobInput(job);
    expect(input).not.toBeNull();
    expect(input?.unitCostThb).toBeNull();
  });
});

describe("productFormIssue — ต่ำกว่าราคาแคตตาล็อกต้องมีเหตุผล (pre-check · DB ตัดสินซ้ำ)", () => {
  const base = () => applyProductSelection(productJob(), SKU_A); // list 1000

  it("ต่ำกว่า list ไม่มีเหตุผล → มีข้อความ · buildJobInput = null", () => {
    const job = { ...base(), unitPriceThb: "999" };
    expect(productFormIssue(job)).toContain("เหตุผล");
    expect(buildJobInput(job)).toBeNull();
  });
  it("เหตุผลมีแต่อักขระล่องหน/ช่องว่าง = ไม่มีเหตุผล", () => {
    expect(productFormIssue({ ...base(), unitPriceThb: "999", priceReason: String.fromCharCode(0x2060, 0xfeff) + " " })).toContain("เหตุผล");
  });
  it("ต่ำกว่า list + มีเหตุผล → ผ่าน", () => {
    expect(productFormIssue({ ...base(), unitPriceThb: "999", priceReason: "โปร" })).toBeNull();
  });
  it("ต้องไม่พัง: เท่า list / สูงกว่า list ไม่ต้องมีเหตุผล", () => {
    expect(productFormIssue({ ...base(), unitPriceThb: "1000" })).toBeNull();
    expect(productFormIssue({ ...base(), unitPriceThb: "1500" })).toBeNull();
  });
  it("ต้องไม่พัง: SKU ไม่มี list price → เทียบไม่ได้ ไม่บังคับเหตุผล (DB เตือนอย่างเดียว)", () => {
    const job = { ...applyProductSelection(productJob(), SKU_NO_PRICE), unitPriceThb: "10" };
    expect(productFormIssue(job)).toBeNull();
  });
  it("ไม่ใช่โหมดสินค้า → null เสมอ", () => {
    expect(productFormIssue({ ...createJobForm(30), metal: "silver" })).toBeNull();
  });
});

describe("aggregateQuotePreview — รายการสินค้าเข้าสรุปทั้งใบเหมือนรายการทั่วไป (บวกเลขที่ DB คำนวณแล้ว)", () => {
  function productCalc(total: number, cost: number): OemPriceCalcResult {
    return {
      isComplete: true,
      missing: [],
      warnings: [],
      formulaVersion: 5,
      floors: {
        qty: { pass: true, moq: null, actual: 1 },
        jobValue: { pass: true, min: 0 },
        metalWeight: { pass: true, applies: false },
        margin: { state: null, value: null, blended: null, target: 0.3 },
      },
      breakdown: {
        costPiece: cost,
        pricePerPiece: total,
        quoteTotal: total,
        marginActualPct: null,
        marginPctUsed: 0,
        nre: { cad: null, print3d: null, mold: null, cost: 0, price: 0 },
        metal: { perPiece: 0 },
      },
    } as unknown as OemPriceCalcResult;
  }
  it("รายการสินค้า margin.value = null ไม่ทำให้ minMarginChargedPct ขยับ · ผลรวมถูก", () => {
    const p = aggregateQuotePreview([{ calc: productCalc(1800, 600), metal: "product", qty: 2 }], 0);
    expect(p.isComplete).toBe(true);
    expect(p.minMarginChargedPct).toBeNull();
    expect(p.quoteTotal).toBe(1800);
    expect(p.marginAfterDiscountPct).toBeCloseTo(1 / 3, 4);
  });
});

// ============================================================================
// 0168: MOQ / ล็อตโลหะ = ออกใบได้เมื่อมีเหตุผล — pre-check ฝั่งฟอร์ม (DB ตัดสิน · verify-0168)
// ============================================================================
describe("calcBelowQtyFloors", () => {
  const calcWith = (qtyPass: boolean | null, applies: boolean, mwPass: boolean | null): OemPriceCalcResult =>
    ({
      isComplete: true,
      missing: [],
      warnings: [],
      formulaVersion: 3,
      breakdown: {},
      floors: {
        qty: { pass: qtyPass, moq: 50, actual: 3 },
        jobValue: { pass: true, min: 0 },
        metalWeight: { pass: mwPass, applies },
        margin: { state: null, value: 0.5, blended: 0.5, target: 0.3 },
      },
    }) as unknown as OemPriceCalcResult;

  it("MOQ ไม่ผ่าน → true", () => expect(calcBelowQtyFloors(calcWith(false, false, true))).toBe(true));
  it("ล็อตโลหะ (ทอง) ไม่ผ่านอย่างเดียว → true", () => expect(calcBelowQtyFloors(calcWith(true, true, false))).toBe(true));
  it("ทอง 3 ชิ้น (ไม่ผ่านทั้งคู่) → true", () => expect(calcBelowQtyFloors(calcWith(false, true, false))).toBe(true));
  it("ผ่านทั้งคู่ → false", () => expect(calcBelowQtyFloors(calcWith(true, true, true))).toBe(false));
  it("ล็อตโลหะไม่ applies (เงิน/ทองเหลือง) แม้ pass=false → ไม่นับ", () => expect(calcBelowQtyFloors(calcWith(true, false, false))).toBe(false));
  it("ยังคำนวณไม่ได้ (null / ไม่มี calc) → false (isComplete ดักอยู่แล้ว ไม่ใช่เรื่องของเหตุผลอนุมัติ)", () => {
    expect(calcBelowQtyFloors(calcWith(null, true, null))).toBe(false);
    expect(calcBelowQtyFloors(null)).toBe(false);
    expect(calcBelowQtyFloors(undefined)).toBe(false);
  });
});
