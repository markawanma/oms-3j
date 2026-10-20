// lib/production/metal-ui.ts — ฟังก์ชัน pure ของจอใบผลิตโลหะต่อรายการ (PM-B)
// ต้องถูก: ค่าเริ่มต่อโลหะตรง OEM · ตรวจช่อง · เปลี่ยนโลหะรีเซ็ตเนื้อ/ล้างน้ำหนักจาก SKU เฉพาะเงิน→อื่น · payload ส่งเฉพาะช่องที่เปลี่ยน · closeBlockers ครบ 4 ข้อ + ลำดับ
// ต้องไม่พัง: แถวเดิมก่อน 0186 (คอลัมน์ว่าง) ได้ draft เงิน/เนื้อ/น้ำหนักเดิมเป๊ะ และไม่ dirty
import { describe, expect, it } from "vitest";
import {
  applyMetalChange,
  buildItemSaveInput,
  buildNewItemInput,
  closeBlockers,
  closeReasonLine,
  defaultPurityText,
  draftFromRow,
  isDraftDirty,
  itemDisplayName,
  labelKey,
  metalSpecIssues,
  MSG_GOLD_PURITY_REQUIRED,
  MSG_WEIGHT_INVALID,
  normalizeWeightText,
  purityFieldIssue,
  stripFnPrefix,
  weightFieldIssue,
  weightSourceFor,
} from "./metal-ui";
import { OEM_DEFAULT_PURITY } from "@/lib/oem/quoteForm";
import type { ProductionOrderItemRow } from "./types";

function row(over: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow {
  return {
    id: "i-1",
    productionOrderId: "po-1",
    poNo: "PO-1",
    orderStatus: "open",
    productId: "p-1",
    sku: "SV-0001",
    productName: "แหวนเงิน",
    pendingProductLabel: null,
    currentCostType: "fixed",
    currentUnitCost: 100,
    metal: null,
    purity: null,
    weightG: null,
    weightSource: null,
    effectiveMetal: "silver",
    effectivePurity: 0.925,
    effectiveWeightG: 3.2,
    effectiveWeightSource: "product",
    skuMetal: "silver",
    skuPurity: 0.925,
    skuWeightG: 3.2,
    skuMetalKnown: false,
    qtyPlanned: 30,
    qtyDone: null,
    stampedUnitCost: null,
    prevCostType: null,
    prevUnitCost: null,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    makeSpec: null,
    currentSilverWeightG: 3.2,
    currentSilverPurity: 0.925,
    isNewDesign: false,
    costCalc: null,
    ...over,
  };
}

describe("defaultPurityText — ตรงกับ OEM_DEFAULT_PURITY ทุกโลหะ (กติการ้านเดียวกัน ไม่มีสูตรซ้ำ)", () => {
  it("เงิน 92.50 · ทองเหลือง 100.00 · ทองว่าง (บังคับกรอก)", () => {
    expect(defaultPurityText("silver")).toBe("92.50");
    expect(defaultPurityText("brass")).toBe("100.00");
    expect(defaultPurityText("gold")).toBe("");
    for (const m of ["silver", "gold", "brass"] as const) expect(defaultPurityText(m)).toBe(OEM_DEFAULT_PURITY[m]);
  });
});

describe("ตรวจช่อง", () => {
  it("น้ำหนัก: ว่าง/ถูกต้องผ่าน · 0/ติดลบ/เกิน 10,000/ทศนิยม 4 ตำแหน่ง/e-notation/ลูกน้ำ/NaN ตก ด้วยข้อความเดียวตาม spec", () => {
    for (const ok of ["", "  ", "3.2", "0.001", "10000", "9999.999", "12"]) expect(weightFieldIssue(ok)).toBeNull();
    for (const bad of ["0", "0.0", "-1", "10000.001", "10001", "1.2345", "1e3", "1,5", "abc", "NaN", "Infinity", ".5", "3."]) {
      expect(weightFieldIssue(bad), bad).toBe(MSG_WEIGHT_INVALID);
    }
    expect(MSG_WEIGHT_INVALID).toBe("น้ำหนักต้องมากกว่า 0 และไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)");
  });

  it("เนื้อ: ทองว่าง = บังคับกรอก · ทองเหลืองล็อกไม่ตรวจ · อื่นๆ ใช้กติกา purity.ts (0.925 → ข้อความ 'ไม่ใช่สัดส่วน')", () => {
    expect(purityFieldIssue("gold", "")).toBe(MSG_GOLD_PURITY_REQUIRED);
    expect(MSG_GOLD_PURITY_REQUIRED).toBe("ทองต้องกรอกเนื้อทอง (%) — ขั้นต่ำ 37.50%");
    expect(purityFieldIssue("gold", "96.50")).toBeNull();
    expect(purityFieldIssue("brass", "")).toBeNull();
    expect(purityFieldIssue("brass", "abc")).toBeNull();
    expect(purityFieldIssue("silver", "0.925")).toContain("ไม่ใช่สัดส่วน");
    expect(purityFieldIssue("gold", "37.49")).toContain("ต่ำกว่า 37.50%");
    expect(purityFieldIssue("silver", "100.01")).toContain("ไม่เกิน 100%");
    expect(purityFieldIssue("silver", "")).not.toBeNull();
  });

  it("metalSpecIssues คืนเฉพาะช่องที่ผิด (รวมจำนวน)", () => {
    expect(metalSpecIssues({ metal: "silver", purityText: "92.50", weightText: "", qtyText: "1" })).toEqual({});
    const e = metalSpecIssues({ metal: "gold", purityText: "", weightText: "-3", qtyText: "0" });
    expect(Object.keys(e).sort()).toEqual(["purity", "qty", "weight"]);
  });
});

describe("draftFromRow / isDraftDirty — แถวเดิมก่อน 0186 ต้องไม่พัง", () => {
  it("คอลัมน์ metal/purity/weight ว่าง (legacy) แสดงค่า effective เดิมเป๊ะ: เงิน · 92.50 · 3.2 · ไม่ dirty", () => {
    const d = draftFromRow(row());
    expect(d).toEqual({ metal: "silver", purityText: "92.50", weightText: "3.2", qtyText: "30", isNewDesign: false });
    expect(isDraftDirty(d, draftFromRow(row()))).toBe(false);
  });

  it("เงินแท่ง 0.999 → 99.90 (ไม่ถูกบังคับเป็น 92.50) · SKU fixed ไม่มีน้ำหนัก → ช่องว่างจริง (ไม่ใช่ 0)", () => {
    const d = draftFromRow(row({ effectivePurity: 0.999, effectiveWeightG: null, effectiveWeightSource: null }));
    expect(d.purityText).toBe("99.90");
    expect(d.weightText).toBe("");
  });

  it("ทองเหลือง = 100.00 เสมอ · ทองที่ยังไม่มีเนื้อ = ช่องว่าง", () => {
    expect(draftFromRow(row({ effectiveMetal: "brass", effectivePurity: 1 })).purityText).toBe("100.00");
    expect(draftFromRow(row({ effectiveMetal: "gold", effectivePurity: null })).purityText).toBe("");
  });

  it("dirty: แก้ช่องใดช่องหนึ่งจริง = dirty · พิมพ์ 3.20 แทน 3.2 = ไม่ dirty (ค่าเท่ากัน) · เว้นวรรคท้ายไม่ dirty", () => {
    const base = draftFromRow(row());
    expect(isDraftDirty({ ...base, weightText: "3.20" }, base)).toBe(false);
    expect(isDraftDirty({ ...base, qtyText: "30 " }, base)).toBe(false);
    expect(isDraftDirty({ ...base, qtyText: "31" }, base)).toBe(true);
    expect(isDraftDirty({ ...base, purityText: "92.5" }, base)).toBe(false);
    expect(isDraftDirty({ ...base, purityText: "90" }, base)).toBe(true);
    expect(isDraftDirty({ ...base, metal: "gold" }, base)).toBe(true);
    expect(isDraftDirty({ ...base, isNewDesign: true }, base)).toBe(true);
    expect(normalizeWeightText("3.200")).toBe("3.2");
  });
});

describe("applyMetalChange — เปลี่ยนโลหะ", () => {
  const base = draftFromRow(row());
  it("เงิน→ทอง: เนื้อรีเซ็ตเป็นว่าง · น้ำหนักที่มาจาก SKU ถูกล้าง + บอกผู้ใช้ทั้งสองข้อ", () => {
    const r = applyMetalChange(base, "gold", base, "product");
    expect(r.draft.metal).toBe("gold");
    expect(r.draft.purityText).toBe("");
    expect(r.draft.weightText).toBe("");
    expect(r.notes).toEqual(["เนื้อรีเซ็ตตามโลหะใหม่", "ล้างน้ำหนักจากสินค้าแล้ว (ใช้กับเงินเท่านั้น)"]);
  });
  it("เงิน→ทองเหลือง: เนื้อ 100.00 · น้ำหนักจาก SKU ล้าง", () => {
    const r = applyMetalChange(base, "brass", base, "product");
    expect(r.draft.purityText).toBe("100.00");
    expect(r.draft.weightText).toBe("");
  });
  it("น้ำหนักที่ผู้ใช้พิมพ์เอง (source input) คงไว้เมื่อเปลี่ยนโลหะ · ไม่มีข้อความล้าง", () => {
    const b = draftFromRow(row({ effectiveWeightSource: "input" }));
    const r = applyMetalChange(b, "gold", b, "input");
    expect(r.draft.weightText).toBe("3.2");
    expect(r.notes).toEqual(["เนื้อรีเซ็ตตามโลหะใหม่"]);
  });
  it("แก้น้ำหนักก่อนเปลี่ยนโลหะ (ต่างจากค่า SKU) = ถือเป็นของที่พิมพ์เอง คงไว้", () => {
    const edited = { ...base, weightText: "4.5" };
    expect(applyMetalChange(edited, "gold", base, "product").draft.weightText).toBe("4.5");
  });
  it("กดกลับมาโลหะเดิม = คืนเนื้อ/น้ำหนักเดิมที่บันทึกไว้ (ไม่เสียค่าเพราะกดผิดแล้วกดกลับ)", () => {
    const toGold = applyMetalChange(base, "gold", base, "product").draft;
    const back = applyMetalChange({ ...toGold, purityText: "90" }, "silver", base, "product");
    expect(back.draft.purityText).toBe("92.50");
    expect(back.draft.weightText).toBe("3.2");
    expect(back.notes).toEqual([]);
  });
  it("โลหะเท่าเดิม = ไม่ทำอะไร", () => {
    expect(applyMetalChange(base, "silver", base, "product")).toEqual({ draft: base, notes: [] });
  });
});

describe("buildItemSaveInput — ส่งเฉพาะช่องที่เปลี่ยน (undefined = ไม่แตะค่าเดิม)", () => {
  const r0 = row();
  const base = draftFromRow(r0);
  const mk = (draft = base, r = r0) => buildItemSaveInput({ orderId: "po-1", row: r, draft, base: draftFromRow(r) });

  it("แก้จำนวนอย่างเดียว: ไม่ส่ง metal/purity/weight/isNewDesign (ไม่ pin แถวเดิม)", () => {
    const res = mk({ ...base, qtyText: "40" });
    expect(res).toEqual({ ok: true, input: { productionOrderId: "po-1", productId: "p-1", qtyPlanned: 40 } });
  });

  it("เงิน→ทอง เนื้อ 96.50: ส่ง metal gold + purity 0.965 + clearWeight (น้ำหนักจาก SKU ถูกล้าง)", () => {
    const d = { ...applyMetalChange(base, "gold", base, "product").draft, purityText: "96.50" };
    const res = mk(d);
    expect(res).toEqual({ ok: true, input: { productionOrderId: "po-1", productId: "p-1", qtyPlanned: 30, metal: "gold", purity: 0.965, clearWeight: true } });
  });

  it("ทองไม่กรอกเนื้อ → ไม่สร้าง payload (errors.purity) · ไม่ปัดเป็นค่าอื่น", () => {
    const d = applyMetalChange(base, "gold", base, "product").draft;
    const res = mk(d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.purity).toBe(MSG_GOLD_PURITY_REQUIRED);
  });

  it("ทองเหลือง: ส่ง purity = 1 เสมอ", () => {
    const d = applyMetalChange(base, "brass", base, "product").draft;
    const res = mk(d);
    expect(res.ok && res.input.metal).toBe("brass");
    expect(res.ok && res.input.purity).toBe(1);
  });

  it("น้ำหนักเปลี่ยนเป็นค่าใหม่ = ส่งค่า + source input · พิมพ์เท่าน้ำหนัก SKU เป๊ะ (เงิน) = source product", () => {
    const withInput = mk({ ...base, weightText: "4.5" });
    expect(withInput.ok && withInput.input).toMatchObject({ weightG: 4.5, weightSource: "input" });
    const noWeightRow = row({ effectiveWeightG: null, effectiveWeightSource: null });
    const typedSkuWeight = mk({ ...draftFromRow(noWeightRow), weightText: "3.2" }, noWeightRow);
    expect(typedSkuWeight.ok && typedSkuWeight.input).toMatchObject({ weightG: 3.2, weightSource: "product" });
  });

  it("ล้างช่องน้ำหนัก = clearWeight (ไม่ส่ง weightG)", () => {
    const res = mk({ ...base, weightText: "" });
    expect(res.ok && res.input.clearWeight).toBe(true);
    expect(res.ok && res.input.weightG).toBeUndefined();
  });

  it("แบบใหม่: ส่งเฉพาะรายการ spec ที่ผู้ใช้ติ๊ก/ถอดติ๊กจริง · fixed ไม่ส่งแม้ state เปลี่ยน", () => {
    const spec = row({ currentCostType: "spec" });
    const on = mk({ ...draftFromRow(spec), isNewDesign: true }, spec);
    expect(on.ok && on.input.isNewDesign).toBe(true);
    const untouched = mk({ ...draftFromRow(spec), qtyText: "31" }, spec);
    expect(untouched.ok && untouched.input.isNewDesign).toBeUndefined();
    const fixed = mk({ ...base, isNewDesign: true });
    expect(fixed.ok && fixed.input.isNewDesign).toBeUndefined();
  });

  it("รายการไม่มี SKU: ส่งชื่อแบบ + metal เสมอ (DB ต้องการโลหะ) · ไม่ส่ง productId", () => {
    const nosku = row({ productId: null, sku: null, productName: null, pendingProductLabel: "แหวนทดลอง", currentCostType: null, skuMetal: null, skuPurity: null, skuWeightG: null, effectiveWeightG: null, effectiveWeightSource: null });
    const res = mk({ ...draftFromRow(nosku), qtyText: "5" }, nosku);
    expect(res).toEqual({ ok: true, input: { productionOrderId: "po-1", pendingProductLabel: "แหวนทดลอง", qtyPlanned: 5, metal: "silver" } });
  });

  it("จำนวน/น้ำหนัก/เนื้อผิด → ไม่สร้าง payload (ไม่ยิง server)", () => {
    for (const d of [
      { ...base, qtyText: "0" },
      { ...base, qtyText: "1.5" },
      { ...base, weightText: "10001" },
      { ...base, purityText: "0.925" },
    ]) expect(mk(d).ok).toBe(false);
  });
});

describe("buildNewItemInput — การ์ดร่างตอนเพิ่ม (ส่งค่าทั้งสามชัดเจน)", () => {
  const draft = { metal: "silver" as const, purityText: "92.50", weightText: "3.2", qtyText: "10", isNewDesign: false };
  it("มี SKU: ส่ง productId + metal + purity + weight(source product เมื่อตรง SKU)", () => {
    const res = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft, skuWeightG: 3.2, isSpecSku: false });
    expect(res).toEqual({ ok: true, input: { productionOrderId: "po-1", productId: "p-1", qtyPlanned: 10, metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product" } });
  });
  it("ไม่มี SKU: ส่ง pendingProductLabel + metal · น้ำหนักว่าง = ไม่ส่ง · ไม่ส่ง isNewDesign", () => {
    const res = buildNewItemInput({ orderId: "po-1", productId: null, label: "แหวนทดลอง", draft: { ...draft, weightText: "" }, skuWeightG: null, isSpecSku: false });
    expect(res).toEqual({ ok: true, input: { productionOrderId: "po-1", pendingProductLabel: "แหวนทดลอง", qtyPlanned: 10, metal: "silver", purity: 0.925 } });
  });
  it("ทอง 90.00 น้ำหนักพิมพ์เอง → source input · ทองไม่มีเนื้อ → ปฏิเสธ", () => {
    const g = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft: { ...draft, metal: "gold", purityText: "90.00" }, skuWeightG: 3.2, isSpecSku: false });
    expect(g.ok && g.input).toMatchObject({ metal: "gold", purity: 0.9, weightG: 3.2, weightSource: "input" });
    const bad = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft: { ...draft, metal: "gold", purityText: "" }, skuWeightG: null, isSpecSku: false });
    expect(bad.ok).toBe(false);
  });
  it("แบบใหม่: ส่ง true เฉพาะ SKU spec ที่ติ๊ก — ไม่ติ๊กไม่ส่ง false (กันรีเซ็ตเงียบเมื่อเพิ่มซ้ำ)", () => {
    const a = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft: { ...draft, isNewDesign: true }, skuWeightG: null, isSpecSku: true });
    expect(a.ok && a.input.isNewDesign).toBe(true);
    const b = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft, skuWeightG: null, isSpecSku: true });
    expect(b.ok && "isNewDesign" in b.input).toBe(false);
    const c = buildNewItemInput({ orderId: "po-1", productId: "p-1", label: null, draft: { ...draft, isNewDesign: true }, skuWeightG: null, isSpecSku: false });
    expect(c.ok && "isNewDesign" in c.input).toBe(false);
  });
});

describe("weightSourceFor", () => {
  it("product เฉพาะ มี SKU + เงิน + ตัวเลขตรงเป๊ะ", () => {
    expect(weightSourceFor({ hasSku: true, metal: "silver", weightText: "3.2", skuWeightG: 3.2 })).toBe("product");
    expect(weightSourceFor({ hasSku: true, metal: "gold", weightText: "3.2", skuWeightG: 3.2 })).toBe("input");
    expect(weightSourceFor({ hasSku: false, metal: "silver", weightText: "3.2", skuWeightG: 3.2 })).toBe("input");
    expect(weightSourceFor({ hasSku: true, metal: "silver", weightText: "3.21", skuWeightG: 3.2 })).toBe("input");
    expect(weightSourceFor({ hasSku: true, metal: "silver", weightText: "3.2", skuWeightG: null })).toBe("input");
  });
});

describe("closeBlockers — 4 ข้อ + ลำดับ (① dirty ③ ไม่มี SKU ④ น้ำหนักขาด ⑤ ไม่มีรายการ)", () => {
  const noSku = row({ id: "i-ns", productId: null, sku: null, productName: null, pendingProductLabel: "แหวนลายใบไม้", currentCostType: null });
  const noWeight = row({ id: "i-nw", currentCostType: "spec", effectiveWeightG: null, effectiveWeightSource: null });
  const fixedNoWeight = row({ id: "i-fx", currentCostType: "fixed", effectiveWeightG: null, effectiveWeightSource: null });

  it("ไม่มีรายการ → ข้อเดียว 'ยังไม่มีรายการ'", () => {
    expect(closeBlockers([], new Set()).map((b) => b.code)).toEqual(["empty"]);
  });
  it("ทุกอย่างปกติ → ไม่มีข้อติด · fixed ที่ไม่มีน้ำหนักไม่ติด (ไม่ใช้น้ำหนักคิดต้นทุน)", () => {
    expect(closeBlockers([row(), fixedNoWeight], new Set())).toEqual([]);
  });
  it("ลำดับ dirty → unbound → weight · ข้อความตาม spec", () => {
    const b = closeBlockers([noWeight, noSku, row()], new Set(["i-1"]));
    expect(b.map((x) => x.code)).toEqual(["dirty", "unbound", "weight"]);
    expect(b[0].message).toBe('มีรายการที่แก้ไว้แต่ยังไม่บันทึก — กด "บันทึกรายการ" ก่อน');
    expect(b[1].message).toBe('ยังไม่ผูก SKU ให้ "แหวนลายใบไม้" — ผูก SKU ก่อน ระบบถึงคิดต้นทุนและเข้าสต็อกได้');
    expect(b[1].itemId).toBe("i-ns");
    expect(b[2].message).toBe("ยังไม่ระบุน้ำหนัก/ชิ้นของ SV-0001 — ต้นทุนโหมดนี้ต้องใช้น้ำหนัก");
  });
  it("dirty id ของรายการที่ถูกลบไปแล้วไม่ติด", () => {
    expect(closeBlockers([row()], new Set(["ghost"]))).toEqual([]);
  });
  it("closeReasonLine: ข้อแรก + ติดอีก n ข้อ · ไม่ติด = null", () => {
    const b = closeBlockers([noWeight, noSku], new Set(["i-nw"]));
    expect(closeReasonLine(b)).toBe(`${b[0].message} · ติดอีก 2 ข้อ`);
    expect(closeReasonLine(closeBlockers([noSku], new Set()))).toBe(closeBlockers([noSku], new Set())[0].message);
    expect(closeReasonLine([])).toBeNull();
  });
});

describe("อื่นๆ", () => {
  it("stripFnPrefix ตัดชื่อฟังก์ชันหน้าข้อความ DB · ข้อความที่ไม่มีคำนำหน้าคงเดิม", () => {
    expect(stripFnPrefix("production_order_item_set: เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่")).toBe("เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่");
    expect(stripFnPrefix("ราคาทองไม่ถูกต้อง: ลองใหม่")).toBe("ราคาทองไม่ถูกต้อง: ลองใหม่");
  });
  it("itemDisplayName ไม่พิมพ์ 'null' · labelKey ยุบช่องว่าง+พิมพ์เล็ก", () => {
    expect(itemDisplayName({ sku: "A-1", productName: "แหวน", pendingProductLabel: null })).toBe("A-1 · แหวน");
    expect(itemDisplayName({ sku: null, productName: null, pendingProductLabel: "แบบ X" })).toBe("ไม่มี SKU · แบบ X");
    expect(labelKey("  แหวน   A ")).toBe(labelKey("แหวน a"));
  });
});
