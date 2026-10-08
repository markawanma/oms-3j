// lib/oem/productItem.test.ts — 0167 F2 pre-check: รายการสินค้าที่ทุนกรอกเอง ต้องมีเหตุผลเมื่อไหร่ (ฟอร์มแค่บวกเลขที่ DB คำนวณแล้ว — DB ตัดสินซ้ำ
// ที่ oem_quote_save / oem_quote_renegotiate · ชุดเดียวกับ verify-0167 P3/P4) · ตัวเลข fixture สมมติ
import { describe, expect, it } from "vitest";
import { manualCostNoteReason } from "./productItem";
import type { ManualCostRow } from "./productItem";

const manual = (price: number, cost: number): ManualCostRow => ({ isManualCost: true, priceTotal: price, costTotal: cost });
const other = (price: number, cost: number): ManualCostRow => ({ isManualCost: false, priceTotal: price, costTotal: cost });

describe("manualCostNoteReason", () => {
  it("ไม่มีรายการทุน manual เลย → null เสมอ (แม้มีส่วนลด/ขาดทุน — ด่านอื่นดูแล)", () => {
    expect(manualCostNoteReason([other(1000, 600)], 500)).toBeNull();
    expect(manualCostNoteReason([other(100, 1000)], 0)).toBeNull();
    expect(manualCostNoteReason([], 100)).toBeNull();
  });

  it("(ก) มีทุน manual + ส่วนลด > 0 → 'discount'", () => {
    expect(manualCostNoteReason([other(5000, 2500), manual(1000, 1)], 100)).toBe("discount");
    expect(manualCostNoteReason([manual(1000, 600)], 0.01)).toBe("discount");
  });

  it("ส่วนลดเป็น 0 / ติดลบ / NaN ไม่นับเป็นส่วนลด", () => {
    expect(manualCostNoteReason([manual(1000, 600)], 0)).toBeNull();
    expect(manualCostNoteReason([manual(1000, 600)], -5)).toBeNull();
    expect(manualCostNoteReason([manual(1000, 600)], Number.NaN)).toBeNull();
  });

  it("(ข) รายการขาดทุน (manual) + รายการกลบ (manual) → 'cover' (นับ manual เฉพาะส่วนขาดทุน)", () => {
    expect(manualCostNoteReason([manual(100, 1000), manual(1000, 0.01)], 0)).toBe("cover");
  });

  it("(ข) รายการขาดทุนจากแคตตาล็อก + manual กลบ → 'cover'", () => {
    expect(manualCostNoteReason([other(100, 600), manual(1000, 0.01)], 0)).toBe("cover");
  });

  it("ต้องไม่พัง: manual ล้วนไม่มีส่วนลด → null · manual ขาดทุนเล็ก + ส่วนที่เหลือบวกชัด → null", () => {
    expect(manualCostNoteReason([manual(1000, 600)], 0)).toBeNull();
    expect(manualCostNoteReason([manual(100, 150), other(2000, 1500)], 0)).toBeNull();
  });

  it("กำไรของ manual ไม่ถูกนับ: ส่วนที่เหลือเท่าทุนพอดี + manual กำไร → null (net = 0 ไม่ใช่ติดลบ)", () => {
    expect(manualCostNoteReason([other(600, 600), manual(1000, 1)], 0)).toBeNull();
  });
});
