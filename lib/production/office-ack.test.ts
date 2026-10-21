// lib/production/office-ack.test.ts — ตรรกะ pure ของการ์ดรับทราบ/ป้ายค้าง (W1)
// ต้องถูก: เฉพาะใบ shopfloor+open+ยังไม่รับทราบ · ค้างนับวันปฏิทินไทย (ข้ามเที่ยงคืนไทย ไม่ใช่ UTC) · read-back เนื้อทองในข้อความปุ่ม
// ต้องไม่พัง: ใบ office ไม่มีวันติดด่านรับทราบ · closeBlockers เดิม (ไม่ส่ง opts) เหมือนเดิมเป๊ะ
import { describe, expect, it } from "vitest";
import { ACK_CARD_ID, STALE_CALENDAR_DAYS, ackButtonLabel, ackPending, ackSummary, calendarDaysOpen, effectivePurityPct, isShopfloor, isStale, metalPurityText, relativeThai } from "./office-ack";
import { ACK_BLOCKER_MESSAGE, closeBlockers } from "./metal-ui";
import type { ProductionOrderItemRow } from "./types";

const order = (o: Partial<Parameters<typeof ackPending>[0]> = {}) => ({ status: "open" as const, openedVia: "shopfloor" as const, acknowledgedAt: null, createdAt: "2026-10-19T02:12:00Z", ...o });

const item = (o: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow =>
  ({
    id: "i1", productionOrderId: "po", poNo: "PO-1", orderStatus: "open", productId: "p1", sku: "RG-1", productName: "แหวน", pendingProductLabel: null, currentCostType: "fixed", currentUnitCost: null,
    metal: null, purity: null, weightG: null, weightSource: null, effectiveMetal: "silver", effectivePurity: 0.925, effectiveWeightG: 3.2, effectiveWeightSource: "input",
    skuMetal: null, skuPurity: null, skuWeightG: null, skuMetalKnown: false, metalMismatch: false, qtyPlanned: 30, qtyDone: null, stampedUnitCost: null, prevCostType: null, prevUnitCost: null,
    createdAt: "", updatedAt: "", makeSpec: null, currentSilverWeightG: null, currentSilverPurity: null, isNewDesign: false, costCalc: null, ...o,
  }) as ProductionOrderItemRow;

describe("ackPending / isShopfloor", () => {
  it("ต้องรับทราบเฉพาะ shopfloor + open + ยังไม่รับทราบ", () => {
    expect(ackPending(order())).toBe(true);
    expect(ackPending(order({ acknowledgedAt: "2026-10-20T01:00:00Z" }))).toBe(false);
    expect(ackPending(order({ status: "done" }))).toBe(false);
    expect(ackPending(order({ status: "cancelled" }))).toBe(false);
  });
  it("ใบที่ออฟฟิศเปิดเอง ไม่มีวันต้องรับทราบ", () => {
    expect(ackPending(order({ openedVia: "office" }))).toBe(false);
    expect(isShopfloor({ openedVia: "office" })).toBe(false);
    expect(isShopfloor({ openedVia: "shopfloor" })).toBe(true);
  });
});

describe("ค้างรับทราบ — วันปฏิทินไทย (มติ Q10)", () => {
  it("เปิดจันทร์ → พุธ = ค้าง 3 วัน (เตือน) · จันทร์ → อังคาร = 2 วัน (ยังไม่เตือน)", () => {
    // 2026-10-19 = จันทร์
    expect(calendarDaysOpen("2026-10-19T02:12:00Z", "2026-10-19")).toBe(1);
    expect(calendarDaysOpen("2026-10-19T02:12:00Z", "2026-10-20")).toBe(2);
    expect(calendarDaysOpen("2026-10-19T02:12:00Z", "2026-10-21")).toBe(3);
    expect(STALE_CALENDAR_DAYS).toBe(3);
    expect(isStale(order(), "2026-10-20")).toBe(false);
    expect(isStale(order(), "2026-10-21")).toBe(true);
  });
  it("นับตามวันไทย ไม่ใช่ UTC: เปิด 19 ต.ค. 18:00 UTC (= 20 ต.ค. 01:00 ไทย) → ถึง 22 ต.ค. ไทย = 3 วัน ไม่ใช่ 4", () => {
    expect(calendarDaysOpen("2026-10-19T18:00:00Z", "2026-10-22")).toBe(3);
    expect(calendarDaysOpen("2026-10-19T18:00:00Z", "2026-10-21")).toBe(2);
  });
  it("ใบที่รับทราบแล้ว/ปิดแล้ว/ใบออฟฟิศ ไม่ค้าง · เวลาอ่านไม่ได้ = ไม่เตือน", () => {
    expect(isStale(order({ acknowledgedAt: "2026-10-20T00:00:00Z" }), "2026-12-01")).toBe(false);
    expect(isStale(order({ openedVia: "office" }), "2026-12-01")).toBe(false);
    expect(isStale(order({ createdAt: "ไม่ใช่เวลา" }), "2026-12-01")).toBe(false);
    expect(calendarDaysOpen(null, "2026-10-21")).toBeNull();
  });
  it("relativeThai", () => {
    const base = Date.parse("2026-10-21T10:00:00Z");
    expect(relativeThai("2026-10-21T09:59:40Z", base)).toBe("เมื่อครู่");
    expect(relativeThai("2026-10-21T09:25:00Z", base)).toBe("35 นาทีที่แล้ว");
    expect(relativeThai("2026-10-21T08:00:00Z", base)).toBe("2 ชม. ที่แล้ว");
    expect(relativeThai("2026-10-18T10:00:00Z", base)).toBe("3 วันที่แล้ว");
    expect(relativeThai(null, base)).toBe("");
  });
});

describe("read-back โลหะ/เนื้อ (P8)", () => {
  it("ข้อความต่อโลหะ: เงิน 92.50% · ทอง 96.50% · ทองเหลืองไม่มีเนื้อ", () => {
    expect(metalPurityText(item())).toBe("เงิน 92.50%");
    expect(metalPurityText(item({ effectiveMetal: "gold", effectivePurity: 0.965 }))).toBe("ทอง 96.50%");
    expect(metalPurityText(item({ effectiveMetal: "brass", effectivePurity: 0.5 }))).toBe("ทองเหลือง");
    expect(metalPurityText(item({ effectiveMetal: "gold", effectivePurity: null, purity: null }))).toContain("ไม่ได้ระบุเนื้อ");
  });
  it("พิมพ์ 99.00 แทน 90.00 ต้องเห็นต่างในข้อความปุ่ม", () => {
    expect(ackButtonLabel([item({ effectiveMetal: "gold", effectivePurity: 0.99 })])).toBe("รับทราบ · ทอง 99.00%");
    expect(ackButtonLabel([item({ effectiveMetal: "gold", effectivePurity: 0.9 })])).toBe("รับทราบ · ทอง 90.00%");
  });
  it("หลายรายการ: ไม่ซ้ำ · เกิน 3 แบบ ตัดเป็น 'n แบบ' · ไม่มีรายการ = 'รับทราบ'", () => {
    expect(ackSummary([item(), item({ id: "i2" })])).toBe("เงิน 92.50%");
    expect(ackSummary([item(), item({ id: "i2", effectiveMetal: "gold", effectivePurity: 0.9 })])).toBe("เงิน 92.50%, ทอง 90.00%");
    const four = [0.9, 0.8, 0.7, 0.6].map((p, n) => item({ id: `x${n}`, effectiveMetal: "gold", effectivePurity: p }));
    expect(ackSummary(four)).toBe("4 แบบ");
    expect(ackButtonLabel([])).toBe("รับทราบ");
  });
  it("effectivePurityPct ใช้ค่าที่มีผลก่อน แล้วค่าที่กรอก", () => {
    expect(effectivePurityPct(item({ effectivePurity: null, purity: 0.9 }))).toBe("90.00");
    expect(effectivePurityPct(item({ effectiveMetal: "brass" }))).toBe("100.00");
  });
});

describe("closeBlockers + ack", () => {
  it("ไม่ส่ง opts = เหมือนเดิมเป๊ะ (ใบออฟฟิศไม่ติดข้อ ack)", () => {
    expect(closeBlockers([item()], new Set())).toEqual([]);
    expect(closeBlockers([item()], new Set()).some((b) => b.code === "ack")).toBe(false);
  });
  it("ackPending → มีข้อ ack พาไปการ์ดรับทราบ · ลำดับ: แก้ค้าง → ack → ไม่มี SKU", () => {
    const nosku = item({ id: "n1", productId: null, sku: null, pendingProductLabel: "แบบ A" });
    const b = closeBlockers([item(), nosku], new Set(["i1"]), { ackPending: true, ackAnchorId: ACK_CARD_ID });
    expect(b.map((x) => x.code)).toEqual(["dirty", "ack", "unbound"]);
    expect(b[1]).toMatchObject({ message: ACK_BLOCKER_MESSAGE, anchorId: ACK_CARD_ID });
    expect(b[1].itemId).toBeUndefined();
  });
  it("ไม่มีรายการ = ข้อ empty ข้อเดียว (ack ไม่โผล่ซ้อน)", () => {
    expect(closeBlockers([], new Set(), { ackPending: true }).map((x) => x.code)).toEqual(["empty"]);
  });
});
