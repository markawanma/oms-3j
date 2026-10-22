// lib/jobs/gems.db-contract.qa.test.ts — QA G1a UI (R2-D2 · 22 ต.ค. 69): สัญญาระหว่าง RPC 0190 "ของจริง" กับ mapper/ตัวตัดสินฝั่ง TS ที่ UI ใช้
// ข้อมูลเข้า = ผลลัพธ์ RPC ที่จับจาก DB จริง (gems.db-contract.qa.fixtures.ts · สร้างจาก scripts/verify/verify-0190-qa-ui.sql ใน tx rollback) — ไม่ใช่ mock ที่เขียนเอง
// เคสที่เป็นช่องรู้แล้ว (KNOWN-GAP) ใช้ it.fails: ผ่านเมื่อพฤติกรรมยังเป็นอย่างที่ QA รายงาน · เมื่อแก้แล้วจะ "ล้ม" เพื่อเตือนให้เปลี่ยนเป็น it ธรรมดา
import { describe, expect, it } from "vitest";

import { FX } from "@/lib/jobs/gems.db-contract.qa.fixtures";
import { applySimilarChoice, interpretGemFail } from "@/lib/jobs/gem-save";
import { draftRowsToInputs, findDuplicateRows, rowFromBomLine, emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { toWireGemLines, mapGemBomLine, mapGemCatalog, mapGemMergePlan, mapGemOptions, mapGemPriceHistory, mapGemSaveSummary, mapJobGems, parseGemRpcError } from "@/lib/jobs/gems";
import { findForbiddenKeys, sanitizeWorkerView } from "@/lib/jobs/worker-view";
import { oemNotePresent } from "@/lib/oem/display";

const PRICEY = /price|cost|thb|supplier|margin|profit|tier|breakage/i;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => deepKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), deepKeys(x, out));
  return out;
}

describe("สัญญา RPC 0190 จริง -> mapper (ฟอร์ม/การ์ดใบงาน)", () => {
  it("job_gem_bom_get (ใบใหม่) -> JobGems: window free_before_start · state specified · รวม = ต่อชิ้น x 35", () => {
    const g = mapJobGems(FX.job_gem_bom_get);
    expect(g).not.toBeNull();
    expect(g!.window).toBe("free_before_start");
    expect(g!.state).toBe("specified");
    expect(g!.qtyPlanned).toBe(35);
    expect(g!.lines.map((l) => [l.label, l.qtyPerPiece, l.qtyTotal, l.position])).toEqual([
      ["ZZUI โกเมน · ไข่ · 4×6 มม.", 2, 70, "บ่าซ้าย-ขวา"],
      ["ZZUI CZ · กลม · 1.5 มม.", 30, 1050, null],
    ]);
  });

  it("job_gem_bom_get หลังขั้นฝังรับ + แก้ -> window reason_required · history มีเหตุผล/ก่อน/หลัง", () => {
    const g = mapJobGems(FX.job_gem_bom_get_after_edit);
    expect(g!.window).toBe("reason_required");
    expect(g!.history.length).toBeGreaterThanOrEqual(1);
    const withReason = g!.history.find((h) => h.reason);
    expect(withReason).toBeTruthy();
    expect(withReason!.before.length).toBeGreaterThan(0);
    expect(withReason!.after.length).toBeGreaterThan(0);
  });

  it("gem_summary ตอนสร้างใบ -> GemSaveSummary (ชนิดใหม่ 2 · รายการ 2) ตามที่ createJob ประกอบ", () => {
    const s = mapGemSaveSummary({ summary: FX.create_res.gem_summary, changed: true, count: FX.create_res.gem_lines });
    expect(s).not.toBeNull();
    expect(s!.createdTypes).toEqual(["ZZUI โกเมน", "ZZUI CZ"]);
    expect(s!.createdItems).toBe(2);
    expect(s!.count).toBe(2);
    expect(s!.reused).toEqual([]);
  });

  it("ตัวดักชื่อคล้ายตอนบันทึกใบ: parseGemRpcError -> similar[0] -> interpretGemFail เปิดกล่องถาม (ไม่ใช่ error ของแถว) -> ใช้ตัวที่มี แก้แถว 3", () => {
    const info = parseGemRpcError({ code: FX.similar_err._state, hint: FX.similar_err._hint, details: FX.similar_err._detail });
    expect(info?.code).toBe("gem_similar");
    expect(info?.similar?.[0]).toMatchObject({ kind: "type", name: "ZZUI โกเมนต์", rows: [3] });
    expect(info?.similar?.[0].matches[0].name).toBe("ZZUI โกเมน");
    const rows: GemDraftRow[] = [emptyGemRow(), emptyGemRow(), { ...emptyGemRow(), type: { kind: "new", name: "ZZUI โกเมนต์" } }];
    const v = interpretGemFail({ error: FX.similar_err._err, code: "gem_similar", gem: info! }, rows);
    expect(v.similar?.rows).toEqual([3]);
    expect(v.rowErrors).toEqual({});
    expect(v.generalError).toBeNull();
    const next = applySimilarChoice(rows, v.similar!, v.similar!.matches[0], null);
    expect(next[2].type).toEqual({ kind: "existing", id: v.similar!.matches[0].id, name: "ZZUI โกเมน" });
    expect(next[0]).toBe(rows[0]);
  });

  it("เปลี่ยนชื่อไปชื่อคล้าย (rows=[]): similar มี 2 ตัว · GemRenameDialog อ่าน similar[0].matches ได้", () => {
    const info = parseGemRpcError({ code: FX.rename_similar_err._state, hint: FX.rename_similar_err._hint, details: FX.rename_similar_err._detail });
    expect(info?.similar?.[0].rows).toEqual([]);
    expect(info?.similar?.[0].matches.map((m) => m.name)).toEqual(["ZZUI โกเมน", "ZZUI โกเมนต์"]);
  });

  it("gem_merge_preview -> GemMergePlan ครบ field ที่ GemMergeDialog ใช้", () => {
    const p = mapGemMergePlan(FX.merge_preview);
    expect(p).not.toBeNull();
    expect(p!.itemsCollapsed).toBe(2);
    expect(p!.templateLinesRepointed).toBe(1);
    expect(p!.templateProducts).toHaveLength(1);
    expect(p!.templateQtyOverflow).toBe(0);
    expect(p!.pricesNotMoved).toBe(0);
  });

  it("gem_options_list -> GemOptions (ไม่มี key ราคา/ผู้ขายในผลดิบ)", () => {
    const o = mapGemOptions(FX.options_list);
    expect(o!.types.length).toBeGreaterThan(0);
    expect(o!.shapes.length).toBeGreaterThanOrEqual(12);
    expect(o!.shapes.find((s) => s.name === "ไข่")?.hasLength).toBe(true);
    expect(o!.items.length).toBeGreaterThan(0);
    expect(deepKeys(FX.options_list).filter((k) => PRICEY.test(k))).toEqual([]);
  });

  it("gem_catalog_list รายการ/ชนิด/รูปทรง -> GemCatalog: ยังไม่มีราคา = price null + hasPrice false (ไม่ใช่ 0)", () => {
    const c = mapGemCatalog({ types: [FX.catalog_type], shapes: [FX.catalog_shape], items: [FX.catalog_item] });
    expect(c!.items[0].price).toBeNull();
    expect(c!.items[0].hasPrice).toBe(false);
    expect(c!.types[0].usedJobsOpen).toBe(2);
    expect(c!.shapes[0].hasLength).toBe(false);
  });

  it("gem_price_history -> rows + audit (ราคาเดิม -> ใหม่ + note) ที่ GemItemDetailDialog แสดง", () => {
    const h = mapGemPriceHistory(FX.price_history);
    expect(h!.rows[0]).toMatchObject({ effectiveFrom: expect.any(String), price: 7000, note: "พิมพ์ผิดตัวเลข" });
    // ลำดับ audit ในทรานแซกชันเดียวกัน (เวลาเท่ากัน) ไม่แน่นอน — เทียบแบบไม่สนลำดับ
    expect(h!.audit.map((a) => [a.action, a.oldPrice, a.newPrice]).sort()).toEqual([
      ["insert", null, 7391.2468],
      ["update", 7391.2468, 7000],
    ]);
  });

  it("แม่แบบ SKU (product_gem_bom_get.lines + job_plan_suggest.gem_bom) -> GemBomLine: ฉลาก/จำนวน/ตำแหน่ง · canonical = ตัวเอง · ไม่มี key ราคา", () => {
    const tpl = (FX.product_gem_bom_get.lines as unknown[]).map(mapGemBomLine);
    expect(tpl[0]).toMatchObject({ label: "ZZUI โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, position: "หัวแหวน" });
    expect(tpl[0]!.canonicalItemId).toBe(tpl[0]!.gemItemId);
    const plan = (FX.plan_gem_bom as unknown[]).map(mapGemBomLine);
    expect(plan[0]).toMatchObject({ qtyPerPiece: 2, qtyTotal: 14, source: "product" });
    expect(deepKeys(FX.plan_gem_bom).filter((k) => PRICEY.test(k))).toEqual([]);
    expect(deepKeys(FX.product_gem_bom_get).filter((k) => PRICEY.test(k))).toEqual([]);
  });

  it("job_worker_resolve (หลัง PIN) -> WorkerView: gems 4 key เท่านั้น · state specified · ไม่มี key ต้องห้ามทั้งก้อน", () => {
    expect(findForbiddenKeys(FX.worker_resolve)).toEqual([]);
    const view = sanitizeWorkerView(FX.worker_resolve);
    expect(view).not.toBeNull();
    expect(view!.job.gemsState).toBe("specified");
    expect(view!.job.gems).toHaveLength(2);
    for (const g of view!.job.gems!) expect(Object.keys(g).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
    expect(view!.job.gems!.map((g) => g.qtyTotal)).toEqual([110, 300]);
  });

  it("ผลดิบฝั่งผู้จัดการ/ช่าง/ใบสร้าง ไม่มี key ราคา-ต้นทุนเลย (job_gem_bom_get · create · worker_resolve)", () => {
    for (const k of ["job_gem_bom_get", "job_gem_bom_get_after_edit", "create_res", "worker_resolve"]) {
      expect(deepKeys(FX[k]).filter((x) => PRICEY.test(x)), k).toEqual([]);
    }
  });
});

// ตาราง "ผล DB จริง" ของเหตุผลหลังขั้นฝังรับ (job_gem_bom_set p_reason) — จาก verify-0190-qa-ui.sql (UI6) · ok = DB รับ
const DB_REASON: { id: string; text: string; ok: boolean }[] = [
  { id: "👍", text: "👍", ok: false },
  { id: ".", text: ".", ok: false },
  { id: "U+2800", text: "⠀", ok: false },
  { id: "0", text: "0", ok: true },
  { id: "ก", text: "ก", ok: true },
  { id: "ok", text: "ok", ok: true },
  { id: "…", text: "…", ok: false },
  { id: "a+VS16", text: "a️", ok: true },
  { id: "3 ช่องว่าง", text: "   ", ok: false },
  { id: "ว่าง", text: "", ok: false },
  { id: "---", text: "---", ok: false },
  { id: "ครับ!", text: "ครับ!", ok: true },
  { id: "12", text: "12", ok: true },
  { id: "๑", text: "๑", ok: true },
  { id: "300 ตัว", text: "ก".repeat(300), ok: true },
  { id: "sentence", text: "เติมพลอยเพิ่ม 1 เม็ด", ok: true },
];
// DB ปฏิเสธเพราะมีอักขระล่องหน "ปน" อยู่ (oem_note_valid) ทั้งที่มีตัวอักษรจริง — oemNotePresent (ที่ JobGemsEditDialog ใช้เป็น pre-check) ตัดล่องหนทิ้งแล้วเห็นตัวอักษร -> ผ่าน
const DB_REJECTS_INVISIBLE_MIXED: { id: string; text: string }[] = [
  { id: "ZWSP+x", text: "​x" },
  { id: "NEL+1", text: "\u00851" },
];

describe("เหตุผลแก้พลอยหลังขั้นฝังรับ: pre-check ฝั่งจอ (oemNotePresent) เทียบ DB จริง", () => {
  for (const c of DB_REASON) {
    it(`เหมือน DB: ${c.id} -> ${c.ok ? "รับ" : "ปฏิเสธ"}`, () => {
      expect(oemNotePresent(c.text)).toBe(c.ok);
    });
  }
  // KNOWN-GAP (ต่ำ): จอปล่อยผ่านเหตุผลที่มีอักขระล่องหนปน -> DB ตีกลับ "ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง" ทั้งที่ผู้ใช้พิมพ์ x/1 (ข้อความงง) · JobGemsEditDialog ไม่ใช้ approvalNoteIssue
  for (const c of DB_REJECTS_INVISIBLE_MIXED) {
    it.fails(`KNOWN-GAP: ${c.id} DB ปฏิเสธ แต่ oemNotePresent บอกว่ามีเหตุผล`, () => {
      expect(oemNotePresent(c.text)).toBe(false);
    });
  }
});

describe("แถวซ้ำที่ DB รวมให้เงียบๆ แต่จอไม่จับ (UI4a/4b ใน verify-0190-qa-ui.sql)", () => {
  // DB จริง: [gem_item_id X qty1] + [type/shape/size เดียวกัน qty2] -> บันทึกผ่านเป็น 1 แถว qty 3 · summary.merged_rows=[{rows:[1,2]}] · จอไม่แสดง mergedRows
  const item = FX.job_gem_bom_get.lines[0];
  const line = mapGemBomLine(item)!;
  const tpl = rowFromBomLine(line, "template");
  const manual: GemDraftRow = {
    ...emptyGemRow("manual"),
    type: { kind: "existing", id: "11111111-1111-4111-8111-111111111111", name: "ZZUI โกเมน" },
    shape: { kind: "existing", id: "22222222-2222-4222-8222-222222222221", name: "ไข่", hasLength: true },
    sizeA: "4",
    sizeB: "6",
    qty: "2",
  };
  it.fails("KNOWN-GAP: แถวจากแม่แบบ (รู้แค่ gem_item_id) + แถวที่ผู้ใช้เลือก ชนิด/รูปทรง/ขนาดเดียวกัน ต้องถูกจับเป็นแถวซ้ำ (ให้กด 'รวมเข้าแถว n' เอง ไม่รวมเงียบ)", () => {
    // ใช้ options ที่รู้ว่า item นี้คือชนิด/รูปทรง/ขนาดอะไร จึงควรเทียบได้ — วันนี้ rowDupKey ใช้ `item:<id>` กับ `t:..|s:..|size` ไม่มีทางเท่ากัน
    expect(findDuplicateRows([tpl, manual]).size).toBe(1);
  });
  it("ยืนยันว่า GemSaveSummary เก็บ mergedRows จาก DB (แต่ไม่มีจอใดอ่านไปแจ้งผู้ใช้ — ดู grep mergedRows ใน components/)", () => {
    const s = mapGemSaveSummary({ summary: { merged_rows: [{ rows: [1, 2] }], created_items: [], created_types: [], created_shapes: [], reused: [] }, changed: true, count: 1 });
    expect(s!.mergedRows).toEqual([[1, 2]]);
  });
});

describe("payload ที่ UI ประกอบจริง (draftRowsToInputs -> toWireGemLines) = รูปที่ยิง RPC จริงใน verify-0190-qa-ui.sql", () => {
  const EGG = "22222222-2222-4222-8222-222222222221";
  const ROUND = "22222222-2222-4222-8222-222222222222";
  const row = (o: Partial<GemDraftRow>): GemDraftRow => ({ ...emptyGemRow("manual"), ...o });
  it("พิมพ์ชนิดใหม่ + รูปทรง 2 ค่า + ตำแหน่ง · 1 ค่าไม่มี size_b/position · กรอก 6x4 ถูกเรียงเป็น 4x6 ก่อนส่ง · size/qty เป็น JSON number · ไม่มี key ราคา", () => {
    const rows: GemDraftRow[] = [
      row({ type: { kind: "new", name: "ZZUI โกเมน" }, shape: { kind: "existing", id: EGG, name: "ไข่", hasLength: true }, sizeA: "6", sizeB: "4", qty: "2", position: "  บ่าซ้าย-ขวา " }),
      row({ type: { kind: "new", name: "ZZUI CZ" }, shape: { kind: "existing", id: ROUND, name: "กลม", hasLength: false }, sizeA: "1,5", qty: "30" }),
      { ...rowFromBomLine({ id: null, gemItemId: "33333333-3333-4333-8333-333333333333", canonicalItemId: "33333333-3333-4333-8333-333333333333", label: "x", qtyPerPiece: 7, qtyTotal: null, position: null, source: "product", renamed: false, via: null }, "template") },
      row({ type: { kind: "new", name: "ZZ ทรงใหม่" }, shape: { kind: "new", name: "ZZ ทรงใหม่", hasLength: true }, sizeA: "3", sizeB: "5", qty: "1" }),
    ];
    const w = toWireGemLines(draftRowsToInputs(rows));
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.value).toEqual([
      { new_type_name: "ZZUI โกเมน", shape_id: EGG, size_a: 4, size_b: 6, qty_per_piece: 2, position: "บ่าซ้าย-ขวา" },
      { new_type_name: "ZZUI CZ", shape_id: ROUND, size_a: 1.5, qty_per_piece: 30 },
      { gem_item_id: "33333333-3333-4333-8333-333333333333", qty_per_piece: 7 },
      { new_type_name: "ZZ ทรงใหม่", new_shape: { name: "ZZ ทรงใหม่", has_length: true }, size_a: 3, size_b: 5, qty_per_piece: 1 },
    ]);
    expect(JSON.stringify(w.value)).not.toMatch(/price|cost|thb|breakage/i);
  });
  it("key แปลก (price/cost) ในแถว = ปฏิเสธที่ allowlist ก่อนถึง DB ไม่ถูกทิ้งเงียบ", () => {
    const w = toWireGemLines([{ typeId: "x", shapeId: "y", sizeA: 1, qtyPerPiece: 1, price: 5 }]);
    expect(w.ok).toBe(false);
    if (!w.ok) expect([w.code, w.row, w.field]).toEqual(["line_invalid", 1, "price"]);
  });
});
