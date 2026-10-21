// lib/jobs/shop-open.test.ts — ตรรกะ pure ของหน้าผู้จัดการเปิดใบ (W1)
// ต้องถูก: skuMetalNote 3 กรณี (P1) · ทอง+เนื้อว่างไม่ผ่าน · ทองเหลืองล็อก 100 · เปลี่ยนโลหะรีเซ็ตเนื้อ · payload ส่งเฉพาะที่แก้ · ข้อความ error ทุกเคสไม่มีรหัส/เงิน
// ต้องไม่พัง: เงินเว้นเนื้อว่างได้ · SKU ที่ไม่แก้อะไรส่งแค่ productId
import { describe, expect, it, vi } from "vitest";
import {
  MSG_NETWORK, SHOP_METALS, backToSearch, bufferIssue, buildIntakeInput, changeMetal, defaultPurityText, dueIssue, dueLabel, effectivePurityText, isCleanMessage, labelIssue,
  metalIssues, newForm, newIdemKey, profileBlockMessage, purityIssue, purityLabel, qtyIssue, qtySummary, resolveDue, searchErrorMessage, selectProduct, shopErrorView, shopOpenIssues,
  skuMetalNote, skuNoteOf, specEdited, specOfProduct, startNewProduct, stepProgress, stepsFor, weightIssue, weightLabel,
} from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";
import type { IntakeProduct } from "@/lib/jobs/worker-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as METAL_UI from "@/lib/production/metal-ui";
import { METAL_TAG } from "@/lib/production/metal-ui";
import * as LEAF from "@/lib/units/metal-tag";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import { OEM_DEFAULT_PURITY } from "@/lib/oem/quoteForm";
import { INTAKE_CODE_PROBE } from "./shop-open.test-helpers";

const TODAY = "2026-10-21";
const prod = (o: Partial<IntakeProduct["prefill"]> = {}, rest: Partial<IntakeProduct> = {}): IntakeProduct => ({
  id: "11111111-1111-4111-8111-111111111111", sku: "RG-0418", name: "แหวนโกเมนไข่", imageUrl: null,
  prefill: { metal: "silver", purity: 0.925, weightG: 3.2, metalKnown: true, ...o }, ...rest,
});

describe("สี/ค่าเริ่มของโลหะ — ที่เดียว (leaf module lib/units/metal-tag.ts) ใช้ร่วมกับจอใบผลิต", () => {
  it("metal-ui re-export ตัวเดียวกัน (identity) ไม่ใช่สำเนา · ชื่อไทยตรง PRODUCTION_METAL_LABEL_TH", () => {
    expect(METAL_TAG).toBe(LEAF.METAL_TAG);
    expect(METAL_UI.MSG_METAL_RESET_PURITY).toBe(LEAF.MSG_METAL_RESET_PURITY);
    expect(METAL_UI.MSG_WEIGHT_CLEARED_FROM_SKU).toBe(LEAF.MSG_WEIGHT_CLEARED_FROM_SKU);
    for (const m of SHOP_METALS) {
      expect(LEAF.METAL_TAG[m].label, m).toBe(PRODUCTION_METAL_LABEL_TH[m]);
      expect(METAL_UI.defaultPurityText(m), m).toBe(defaultPurityText(m));
    }
  });
  it("leaf module ไม่มี import เลย (ไม่ลาก lib/production · lib/oem เข้ากราฟสาธารณะ)", () => {
    const src = readFileSync(join(process.cwd(), "lib", "units", "metal-tag.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(/\bimport\b|\brequire\(/.test(src)).toBe(false);
  });
  it("ค่าเริ่มเนื้อ: เงิน 92.50 · ทอง ว่าง · ทองเหลือง 100.00 ตรง OEM_DEFAULT_PURITY", () => {
    for (const m of SHOP_METALS) expect(defaultPurityText(m), m).toBe(OEM_DEFAULT_PURITY[m]);
    expect(defaultPurityText("silver")).toBe("92.50");
    expect(defaultPurityText("gold")).toBe("");
  });
});

describe("skuMetalNote (P1 — ตัวหลัก)", () => {
  it("known && ต่าง → warn", () => expect(skuMetalNote({ selected: "gold", sku: { metal: "silver", known: true } })).toBe("warn"));
  it("known && เท่ากัน → none", () => expect(skuMetalNote({ selected: "silver", sku: { metal: "silver", known: true } })).toBe("none"));
  it("ไม่ระบุโลหะ (known=false) → neutral ไม่ว่าเลือกอะไร (ห้ามเตือนเหลือง)", () => {
    for (const sel of SHOP_METALS) expect(skuMetalNote({ selected: sel, sku: { metal: "silver", known: false } }), sel).toBe("neutral");
  });
  it("ไม่มี SKU (สินค้าใหม่) → none", () => expect(skuMetalNote({ selected: "gold", sku: null })).toBe("none"));
  it("skuNoteOf ผูกกับฟอร์ม: SKU เงิน known เลือกทอง = warn · สินค้าใหม่ = none", () => {
    const f = changeMetal(selectProduct(newForm("k".repeat(20)), prod()), "gold").form;
    expect(skuNoteOf(f)).toBe("warn");
    expect(skuNoteOf(startNewProduct(f))).toBe("none");
  });
});

describe("ขั้น/ความคืบหน้า", () => {
  it("มี SKU 3 ขั้น · สินค้าใหม่ 4 ขั้น — n/N จากรายการขั้นจริง", () => {
    expect(stepsFor({ mode: "sku" })).toEqual(["search", "qty", "review"]);
    expect(stepsFor({ mode: "new" })).toEqual(["search", "metal", "qty", "review"]);
    expect(stepProgress({ mode: "new" }, "qty")).toEqual({ n: 3, total: 4 });
    expect(stepProgress({ mode: "sku" }, "qty")).toEqual({ n: 2, total: 3 });
  });
});

describe("เนื้อ/น้ำหนัก", () => {
  it("ทอง + เนื้อว่าง = ไม่ผ่าน · เงินเว้นว่างได้ · ทองเหลืองไม่ตรวจ", () => {
    expect(purityIssue("gold", "")).toMatch(/ทอง/);
    expect(purityIssue("gold", "   ")).not.toBeNull();
    expect(purityIssue("silver", "")).toBeNull();
    expect(purityIssue("brass", "")).toBeNull();
    expect(purityIssue("brass", "abc")).toBeNull();
  });
  it("เนื้อผิดกติกาเดิม (lib/units/purity): ต่ำกว่า 37.50 · เกิน 100 · ทศนิยม 3 ตำแหน่ง · ไม่ใช่ตัวเลข", () => {
    for (const bad of ["36", "101", "92.505", "abc", "0.925", "1"]) expect(purityIssue("gold", bad), bad).not.toBeNull();
    for (const ok of ["96.5", "96.50", "37.5", "100", "90"]) expect(purityIssue("gold", ok), ok).toBeNull();
  });
  it("น้ำหนัก: ว่างได้ · > 0 · ≤ 10,000 · ทศนิยม ≤ 3 · ข้อความเดียวตามสเปก", () => {
    expect(weightIssue("")).toBeNull();
    expect(weightIssue("3.2")).toBeNull();
    expect(weightIssue("3,2")).toBeNull();
    for (const bad of ["0", "-1", "1e3", "3.2345", "10001", "abc", "1,234.5"]) expect(weightIssue(bad), bad).toBe("น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)");
  });
  it("metalIssues รวม 2 ช่อง", () => {
    expect(metalIssues({ metal: "gold", purityText: "", weightText: "x" })).toEqual({ purity: expect.any(String), weight: expect.any(String) });
    expect(metalIssues({ metal: "silver", purityText: "92.50", weightText: "" })).toEqual({});
  });
  it("effectivePurityText/purityLabel: เงินว่าง = 92.50 · ทองเหลือง 100 · ทองว่าง = ต้องใส่เนื้อ", () => {
    expect(effectivePurityText("silver", "")).toBe("92.50");
    expect(purityLabel("silver", "")).toBe("เนื้อ 92.50%");
    expect(purityLabel("gold", "96.5")).toBe("เนื้อ 96.50%");
    expect(purityLabel("gold", "")).toBe("ต้องใส่เนื้อ");
    expect(purityLabel("brass", "")).toBe("เนื้อ 100%");
  });
  it("weightLabel", () => {
    expect(weightLabel("3.200")).toBe("น้ำหนัก 3.2 กรัม/ชิ้น");
    expect(weightLabel("")).toBe("น้ำหนัก ยังไม่ระบุ");
  });
});

describe("เปลี่ยนโลหะ", () => {
  const base = (): ShopForm => startNewProduct(newForm("a".repeat(20)));
  it("เปลี่ยนแล้วเนื้อรีเซ็ตตามโลหะใหม่ + บอกข้อความ", () => {
    const g = changeMetal({ ...base(), purityText: "99.90" }, "gold");
    expect(g.form.purityText).toBe("");
    expect(g.notes).toContain("เนื้อรีเซ็ตตามโลหะใหม่");
    const b = changeMetal(g.form, "brass");
    expect(b.form.purityText).toBe("100.00");
    const s = changeMetal(b.form, "silver");
    expect(s.form.purityText).toBe("92.50");
  });
  it("เลือกโลหะเดิม = ไม่เปลี่ยนอะไร ไม่มีข้อความ", () => {
    const f = base();
    const r = changeMetal(f, "silver");
    expect(r.form).toBe(f);
    expect(r.notes).toEqual([]);
  });
  it("น้ำหนักจาก SKU (เงิน) ล้างเมื่อย้ายไปโลหะอื่น + บอก · กลับมาโลหะเดิมได้ค่าจากสินค้าคืน", () => {
    const f = selectProduct(newForm("b".repeat(20)), prod());
    expect(f.weightText).toBe("3.2");
    const g = changeMetal(f, "gold");
    expect(g.form.weightText).toBe("");
    expect(g.notes.join(" ")).toContain("ล้างน้ำหนักจากสินค้าแล้ว");
    const back = changeMetal(g.form, "silver");
    expect(back.form.weightText).toBe("3.2");
    expect(back.form.purityText).toBe("92.50");
  });
  it("น้ำหนักที่ผู้จัดการพิมพ์เอง (ไม่ใช่ของ SKU) ไม่ถูกล้าง", () => {
    const f = { ...selectProduct(newForm("c".repeat(20)), prod()), weightText: "5" };
    expect(changeMetal(f, "gold").form.weightText).toBe("5");
  });
});

describe("ค่าที่มากับสินค้า (specOfProduct)", () => {
  it("เงินไม่มีเนื้อ → 92.50 · ทองไม่มีเนื้อ → ว่าง · ทองเหลือง → 100.00 · น้ำหนักเฉพาะเงิน", () => {
    expect(specOfProduct(prod({ purity: null, weightG: null }))).toEqual({ metal: "silver", purityText: "92.50", weightText: "" });
    expect(specOfProduct(prod({ metal: "gold", purity: null, weightG: 9 }))).toEqual({ metal: "gold", purityText: "", weightText: "" });
    expect(specOfProduct(prod({ metal: "gold", purity: 0.965 }))).toMatchObject({ purityText: "96.50" });
    expect(specOfProduct(prod({ metal: "brass", purity: 0.5 }))).toMatchObject({ purityText: "100.00" });
  });
});

describe("ตรวจช่องอื่น", () => {
  it("ชื่อแบบ: บังคับ · ≤ 60 · ห้ามขึ้นบรรทัด/ล่องหน/< >", () => {
    expect(labelIssue("")).toBe("ใส่ชื่อแบบก่อน");
    expect(labelIssue("   ")).toBe("ใส่ชื่อแบบก่อน");
    expect(labelIssue("แหวนลายใบไม้")).toBeNull();
    expect(labelIssue("ก".repeat(60))).toBeNull();
    expect(labelIssue("ก".repeat(61))).toMatch(/60/);
    expect(labelIssue("a\nb")).toMatch(/บรรทัดใหม่/);
    expect(labelIssue("a\tb")).toMatch(/บรรทัดใหม่/);
    expect(labelIssue("a​b")).toMatch(/มองไม่เห็น/);
    expect(labelIssue("a⠀")).toMatch(/มองไม่เห็น/);
    expect(labelIssue("<b>x</b>")).toMatch(/</);
  });
  it("จำนวน: ว่าง/0/ทศนิยม/ลูกน้ำ/เกินเพดาน = ไม่ผ่าน (ไม่กรองอักขระทิ้งเงียบ)", () => {
    expect(qtyIssue("")).toBe("ใส่จำนวนชิ้นที่ต้องการ");
    for (const bad of ["0", "1,5", "3.5", "-2", "abc", "100001"]) expect(qtyIssue(bad), bad).not.toBeNull();
    expect(qtyIssue("35")).toBeNull();
  });
  it("เผื่อ: ปิด = ผ่าน · เปิดว่าง = 0 ผ่าน · รวมเกินเพดานไม่ผ่าน", () => {
    expect(bufferIssue({ qtyText: "30", bufferOn: false, bufferText: "x" })).toBeNull();
    expect(bufferIssue({ qtyText: "30", bufferOn: true, bufferText: "" })).toBeNull();
    expect(bufferIssue({ qtyText: "30", bufferOn: true, bufferText: "5" })).toBeNull();
    expect(bufferIssue({ qtyText: "30", bufferOn: true, bufferText: "3.5" })).not.toBeNull();
    expect(bufferIssue({ qtyText: "100000", bufferOn: true, bufferText: "1" })).not.toBeNull();
  });
  it("กำหนดเสร็จ: ย้อนหลังไม่ผ่าน · ว่างเมื่อเลือกวันไม่ผ่าน · chip วัน คำนวณจากวันนี้ (เวลาไทยที่ผู้เรียกส่งมา)", () => {
    expect(dueIssue({ kind: "none" }, TODAY)).toBeNull();
    expect(dueIssue({ kind: "days", days: 3 }, TODAY)).toBeNull();
    expect(dueIssue({ kind: "date", date: "" }, TODAY)).not.toBeNull();
    expect(dueIssue({ kind: "date", date: "2026-10-20" }, TODAY)).toMatch(/ย้อนหลัง/);
    expect(dueIssue({ kind: "date", date: "2026-10-21" }, TODAY)).toBeNull();
    expect(resolveDue({ kind: "days", days: 3 }, TODAY)).toBe("2026-10-24");
    expect(resolveDue({ kind: "days", days: 7 }, "2026-12-30")).toBe("2027-01-06");
    expect(resolveDue({ kind: "none" }, TODAY)).toBeNull();
    expect(dueLabel({ kind: "none" }, TODAY)).toBe("ยังไม่กำหนด");
    expect(dueLabel({ kind: "days", days: 7 }, TODAY)).toBe("28 ต.ค.");
  });
  it("qtySummary: ไม่เผื่อ / เผื่อ", () => {
    expect(qtySummary({ qtyText: "30", bufferOn: false, bufferText: "" })).toBe("30 ชิ้น · ไม่เผื่อ");
    expect(qtySummary({ qtyText: "30", bufferOn: true, bufferText: "5" })).toBe("สั่ง 30 + เผื่อ 5 = เริ่มผลิต 35 ชิ้น");
    expect(qtySummary({ qtyText: "30", bufferOn: true, bufferText: "0" })).toBe("30 ชิ้น · ไม่เผื่อ");
  });
  it("shopOpenIssues: ฟอร์มว่างทุกช่องที่บังคับ", () => {
    const f = newForm("d".repeat(20));
    expect(shopOpenIssues(f, TODAY).map((i) => i.field)).toEqual(["product", "qty"]);
    const n = startNewProduct(f);
    expect(shopOpenIssues({ ...n, metal: "gold", purityText: "" }, TODAY).map((i) => i.field)).toEqual(["label", "purity", "qty"]);
    const ok = { ...selectProduct(f, prod()), qtyText: "30" };
    expect(shopOpenIssues(ok, TODAY)).toEqual([]);
  });
});

describe("pre-check โปรไฟล์ (R1)", () => {
  it("ทองดู goldProfileReady · เงิน/ทองเหลืองดู profileReady", () => {
    expect(profileBlockMessage("gold", { profileReady: true, goldProfileReady: false })).toMatch(/งานทอง/);
    expect(profileBlockMessage("gold", { profileReady: false, goldProfileReady: true })).toBeNull();
    expect(profileBlockMessage("silver", { profileReady: false, goldProfileReady: true })).toMatch(/แบบการบันทึก/);
    expect(profileBlockMessage("brass", { profileReady: true, goldProfileReady: false })).toBeNull();
  });
  it("ข้อความทองห้ามเสนอให้เปลี่ยนโลหะ", () => {
    expect(profileBlockMessage("gold", { profileReady: true, goldProfileReady: false })).toContain("อย่าเปลี่ยนเป็นโลหะอื่นเพื่อเปิดผ่าน");
  });
});

describe("buildIntakeInput — ส่งเฉพาะที่ต้องส่ง", () => {
  const f0 = (): ShopForm => ({ ...newForm("e".repeat(24)), qtyText: "30" });
  it("มี SKU ไม่แก้อะไร → ส่งแค่ productId (+ จำนวน/คีย์) ไม่ส่ง metal/purity/weight", () => {
    const f = selectProduct(f0(), prod());
    expect(specEdited(f)).toBe(false);
    const i = buildIntakeInput(f, TODAY);
    expect(i).toEqual({ idemKey: "e".repeat(24), qty: "30", isNewDesign: false, dueDate: null, note: null, productId: f.product?.id });
    expect("metal" in i).toBe(false);
    expect("label" in i).toBe(false);
  });
  it("มี SKU แก้เนื้อ → ส่ง metal + เนื้อ + น้ำหนักที่เห็นบนจอ", () => {
    const f = { ...selectProduct(f0(), prod()), purityText: "99.90" };
    expect(specEdited(f)).toBe(true);
    expect(buildIntakeInput(f, TODAY)).toMatchObject({ productId: f.product?.id, metal: "silver", purityPct: "99.90", weight: "3.2" });
  });
  it("มี SKU ทองเนื้อว่าง → ผู้จัดการกรอกเนื้อ → ส่ง metal gold + เนื้อ (ไม่ใช่เงียบ)", () => {
    const f = { ...selectProduct(f0(), prod({ metal: "gold", purity: null, weightG: null })), purityText: "90" };
    expect(buildIntakeInput(f, TODAY)).toMatchObject({ metal: "gold", purityPct: "90" });
  });
  it("มี SKU เปลี่ยนโลหะเป็นทองเหลือง → ไม่ส่งเนื้อ", () => {
    const f = changeMetal(selectProduct(f0(), prod()), "brass").form;
    const i = buildIntakeInput(f, TODAY);
    expect(i.metal).toBe("brass");
    expect("purityPct" in i).toBe(false);
  });
  it("สินค้าใหม่ → label (ยุบช่องว่าง/trim) + metal + เนื้อ + น้ำหนัก · ไม่มี productId", () => {
    const f = { ...startNewProduct(f0()), label: "  แหวน   ลายใบไม้ ", metal: "gold" as const, purityText: "96.5", weightText: "3.200" };
    const i = buildIntakeInput(f, TODAY);
    expect(i).toMatchObject({ label: "แหวน ลายใบไม้", metal: "gold", purityPct: "96.5", weight: "3.200" });
    expect("productId" in i).toBe(false);
  });
  it("สินค้าใหม่เงินเว้นเนื้อ → ไม่ส่งเนื้อ (DB ใช้ค่าเริ่ม 92.50)", () => {
    const f = { ...startNewProduct(f0()), label: "ก", purityText: "" };
    expect("purityPct" in buildIntakeInput(f, TODAY)).toBe(false);
  });
  it("เผื่อ/กำหนด/แบบใหม่/หมายเหตุ", () => {
    const f = { ...selectProduct(f0(), prod()), bufferOn: true, bufferText: "5", due: { kind: "days", days: 7 } as const, isNewDesign: true, note: "  เร่ง  " };
    expect(buildIntakeInput(f, TODAY)).toMatchObject({ buffer: "5", dueDate: "2026-10-28", isNewDesign: true, note: "เร่ง" });
    expect(buildIntakeInput({ ...f, bufferText: "" }, TODAY).buffer).toBe("0");
    expect("buffer" in buildIntakeInput({ ...f, bufferOn: false }, TODAY)).toBe(false);
  });
  it("payload ไม่มี field เกี่ยวกับเงิน/ต้นทุน/โปรไฟล์/ร้าน/ขั้น", () => {
    const keys = Object.keys(buildIntakeInput({ ...startNewProduct(f0()), label: "ก", metal: "gold", purityText: "90", weightText: "1" }, TODAY));
    for (const k of keys) expect(k, k).not.toMatch(/price|cost|margin|thb|profile|shop|stage/i);
  });
  it("backToSearch เก็บชื่อที่พิมพ์ไว้ (ข้อมูลไม่หาย)", () => {
    const f = { ...startNewProduct(f0()), label: "แหวน" };
    expect(backToSearch(f).label).toBe("แหวน");
    expect(backToSearch(f).mode).toBe("sku");
  });
});

describe("idem key — ไม่มี crypto = ล้มดังๆ (ไม่ใช้ค่าคงที่)", () => {
  it("ไม่มีทั้ง randomUUID และ getRandomValues → throw", () => {
    vi.stubGlobal("crypto", {});
    expect(() => newIdemKey()).toThrow("crypto_unavailable");
    vi.stubGlobal("crypto", undefined);
    expect(() => newIdemKey()).toThrow("crypto_unavailable");
    vi.unstubAllGlobals();
  });
  it("มีแค่ getRandomValues → คีย์สุ่ม 32 hex ไม่ซ้ำ ตรง IDEM_RE", () => {
    let n = 0;
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => (b.fill(++n), b) });
    const a = newIdemKey();
    const b = newIdemKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    vi.unstubAllGlobals();
  });
});

describe("idem key", () => {
  it("รูปแบบตรง IDEM_RE ของ action และไม่ซ้ำ", () => {
    const a = newIdemKey();
    const b = newIdemKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(a).not.toBe(b);
  });
  it("ฟอร์มเดียวกัน = คีย์เดิมข้ามการเปลี่ยนค่า (สร้างตอน newForm ครั้งเดียว)", () => {
    const f = newForm();
    expect(selectProduct(f, prod()).idemKey).toBe(f.idemKey);
    expect(changeMetal(f, "gold").form.idemKey).toBe(f.idemKey);
    expect(buildIntakeInput({ ...f, qtyText: "3" }, TODAY).idemKey).toBe(f.idemKey);
  });
});

describe("shopErrorView — B.8 ทุกเคส", () => {
  it("rate_limited: มี retryAfter → นับถอยหลัง · ไม่มี → กดซ้ำได้", () => {
    const a = shopErrorView({ code: "rate_limited", error: "x", retryAfterSeconds: 12 });
    expect(a).toMatchObject({ action: "wait", waitSeconds: 12 });
    expect(a.message).toContain("ส่งถี่เกินไป");
    expect(a.message).toContain("12 วินาที");
    expect(shopErrorView({ code: "rate_limited", error: "x" })).toMatchObject({ action: "retry" });
    expect(shopErrorView({ code: "rate_limited", error: "x", retryAfterSeconds: 99999 }).waitSeconds).toBe(600);
  });
  it("no_default_profile / not_ready: ปุ่มลองอีกครั้ง · ไม่ชี้ URL", () => {
    const v = shopErrorView({ code: "no_default_profile", error: "x" });
    expect(v.message).toContain("ร้านยังไม่ได้ตั้งแบบการบันทึกงาน");
    expect(v.retryButton).toBe(true);
    expect(v.message).not.toMatch(/https?:|\/jobs|\/oem/);
    expect(shopErrorView({ code: "not_ready", error: "x" }).retryButton).toBe(true);
  });
  it("no_gold_profile: กลับไปแก้โลหะ · ห้ามมีปุ่ม/ข้อความเสนอเปลี่ยนโลหะ", () => {
    const v = shopErrorView({ code: "no_gold_profile", error: "x" });
    expect(v).toMatchObject({ action: "back", field: "metal" });
    expect(v.message).toContain("อย่าเปลี่ยนเป็นโลหะอื่นเพื่อเปิดผ่าน");
    expect(v.retryButton).toBeUndefined();
  });
  it("job_exists: ใช้ข้อความที่มีเลขใบ · กลับไปเลือกสินค้า", () => {
    const v = shopErrorView({ code: "job_exists", error: "SKU นี้มีใบงาน JB-0031 เปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น" });
    expect(v).toMatchObject({ action: "pick" });
    expect(v.message).toContain("JB-0031");
  });
  it("session_required → แผ่น PIN · invalid_token → จบ (ฟอร์มยังอยู่ · ลองอีกครั้งได้) · token_budget_exhausted / not_allowed → จบ", () => {
    expect(shopErrorView({ code: "session_required", error: "x" })).toMatchObject({ action: "pin", message: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
    const t = shopErrorView({ code: "invalid_token", error: "x" });
    expect(t).toMatchObject({ action: "final", retryButton: true });
    expect(t.message).toContain("ข้อมูลที่กรอกยังอยู่ในเครื่อง");
    const b = shopErrorView({ code: "token_budget_exhausted", error: "x" });
    expect(b).toMatchObject({ action: "final" });
    expect(b.message).toContain("ขอ QR ร้านใหม่จากออฟฟิศ");
    expect(shopErrorView({ code: "not_allowed", error: "x" })).toMatchObject({ action: "final", message: "บัญชีนี้ไม่มีสิทธิ์เปิดงานแล้ว — แจ้งออฟฟิศ" });
  });
  it("idem_conflict / idem_invalid / field key → สร้างคีย์ใหม่ + กดซ้ำได้", () => {
    for (const c of ["idem_conflict", "idem_invalid"]) expect(shopErrorView({ code: c, error: "x" }), c).toMatchObject({ action: "retry", newKey: true });
    expect(shopErrorView({ error: "x", field: "key" })).toMatchObject({ newKey: true });
  });
  it("ช่องผิด → กลับไปแก้ที่ช่องนั้น (จาก code หรือ field)", () => {
    expect(shopErrorView({ code: "name_invalid", error: "ชื่อแบบไม่ถูกต้อง" })).toMatchObject({ action: "back", field: "label" });
    expect(shopErrorView({ code: "gold_purity_required", error: "ทองต้องใส่เนื้อทอง (ขั้นต่ำ 37.50%)" })).toMatchObject({ action: "back", field: "purity" });
    expect(shopErrorView({ error: "จำนวนต้องอยู่ระหว่าง 1–100,000", field: "qty" })).toMatchObject({ action: "back", field: "qty" });
    expect(shopErrorView({ code: "due_invalid", error: "x_y" })).toMatchObject({ field: "due" });
  });
  it("เน็ตหลุด/code ไม่รู้จัก/ข้อความไม่สะอาด → ข้อความ 'เช็คสัญญาณ' กดซ้ำได้ (ไม่หลุดข้อความดิบ)", () => {
    expect(shopErrorView({ code: "weird_code", error: "ERROR: relation analytics.foo violates constraint" })).toEqual({ message: MSG_NETWORK, action: "retry" });
    expect(MSG_NETWORK).toContain("ระบบไม่เปิดซ้ำซ้อน");
  });
  it("ข้อความสะอาดของ DB ที่ไม่รู้จัก code ผ่านต่อได้", () => {
    expect(shopErrorView({ code: "something_new", error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" })).toMatchObject({ message: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง", action: "retry" });
  });
  it("ทุกข้อความที่ได้จากทุก code ที่รู้จัก: ไม่มี snake_case/ชื่อตาราง/เงิน", () => {
    for (const f of INTAKE_CODE_PROBE) {
      const v = shopErrorView(f);
      expect(v.message, f.code ?? f.field).not.toMatch(/[A-Za-z]+_[A-Za-z_]+/);
      expect(v.message, f.code ?? f.field).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|cost|price/i);
      expect(v.message, f.code ?? f.field).not.toMatch(/analytics|public\.|select |insert /i);
    }
  });
});

describe("isCleanMessage / searchErrorMessage", () => {
  it("ปฏิเสธข้อความที่มี snake_case · เงิน · SQL · ว่าง · ยาวเกิน", () => {
    for (const bad of ["not_allowed", "ต้นทุน 120", "ราคา 5 บาท", "฿100", "select * from x", "", "   ", "ก".repeat(301), "violates constraint"]) expect(isCleanMessage(bad), bad).toBe(false);
    expect(isCleanMessage(123)).toBe(false);
    expect(isCleanMessage("ชื่อหรือ PIN ไม่ถูกต้อง · เหลืออีก 2 ครั้งก่อนถูกล็อกชั่วคราว")).toBe(true);
  });
  it("ข้อความค้นสินค้าล้ม", () => {
    expect(searchErrorMessage({ error: "x" })).toBe("ค้นไม่สำเร็จ — ลองอีกครั้ง");
    expect(searchErrorMessage({ code: "rate_limited", error: "x" })).toContain("ค้นถี่เกินไป");
    expect(searchErrorMessage({ code: "session_required", error: "x" })).toBe("หมดเวลาแล้ว — ใส่ PIN ใหม่");
  });
});
