// หน้าช่าง = ช่องทางสาธารณะ: payload ต้องมีเฉพาะ key ใน allowlist — ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/เลขใบเสนอราคา/เลข PO
import { describe, expect, it } from "vitest";
import { FORBIDDEN_KEY_PATTERN, findForbiddenKeys, sanitizeWorkerView } from "./worker-view";

const WID = "11111111-1111-4111-8111-111111111111";
const stage = (o: Record<string, unknown> = {}) => ({ seq: 1, code: "cast", name: "หล่อ", status: "pending", ...o });
const base = (o: Record<string, unknown> = {}) => ({
  ok: true,
  job: { job_no: "JB-0001", status: "open", stages: [stage()] },
  viewer: null,
  session_expired: false,
  next_action: "identify",
  action_stage: null,
  prev_weight_out_g: null,
  held_by: null,
  workers: [{ id: WID, display_name: "ช่างเอ" }],
  scrap_reasons: [],
  ...o,
});
const full = () =>
  base({
    job: { job_no: "JB-0001", status: "in_progress", design_label: "แหวนลาย A", sku: "RG-001", metal: "silver", qty_planned: 10, due_date: "2026-10-30", stages: [stage({ received_on: "2026-10-12", worker_name: "ช่างเอ", auto_closed: false })] },
    viewer: { worker_id: WID, display_name: "ช่างเอ" },
    next_action: "receive",
    action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: true },
    prev_weight_out_g: 12.345,
  });

describe("sanitizeWorkerView — ทิ้ง key ที่ไม่อยู่ใน allowlist (แม้ DB ส่งมา)", () => {
  const POISON = {
    price_per_piece: 999, unit_cost: 12, margin_pct: 40, customer_name: "บริษัท ลับ จำกัด", quote_no: "Q-2610-001", po_no: "PO-0001",
    grand_total: 12345, deposit_thb: 5000, phone: "0812345678", address: "ที่อยู่ลับ", tax_id: "0123456789012",
  };
  it("ปนใน job / stage / viewer / workers / action_stage / ระดับบนสุด → ไม่มีในผลลัพธ์", () => {
    const raw = full() as Record<string, unknown>;
    (raw.job as Record<string, unknown>).oem = POISON;
    Object.assign(raw.job as Record<string, unknown>, POISON);
    Object.assign(((raw.job as { stages: unknown[] }).stages[0]) as Record<string, unknown>, POISON);
    Object.assign(raw.viewer as Record<string, unknown>, POISON);
    Object.assign(raw.action_stage as Record<string, unknown>, POISON);
    (raw.workers as Record<string, unknown>[])[0] = { ...(raw.workers as Record<string, unknown>[])[0], ...POISON };
    Object.assign(raw, POISON, { costs: POISON });
    const v = sanitizeWorkerView(raw)!;
    expect(v).not.toBeNull();
    expect(findForbiddenKeys(v)).toEqual([]);
    const json = JSON.stringify(v);
    for (const secret of ["บริษัท ลับ", "Q-2610-001", "PO-0001", "0812345678", "ที่อยู่ลับ", "0123456789012", "12345", "999"]) expect(json).not.toContain(secret);
  });

  it("ผลสมบูรณ์มีเฉพาะ key ที่ตั้งใจ (snapshot ของโครง)", () => {
    const v = sanitizeWorkerView(full())!;
    expect(Object.keys(v).sort()).toEqual(["actionStage", "heldBy", "job", "nextAction", "prevWeightOutG", "scrapReasons", "sessionExpired", "viewer", "workers"]);
    expect(Object.keys(v.job).sort()).toEqual(["designLabel", "dueDate", "jobNo", "metal", "qtyPlanned", "sku", "stages", "status"]);
    expect(Object.keys(v.job.stages[0]).sort()).toEqual(["autoClosed", "code", "name", "receivedOn", "sentOn", "seq", "status", "workerName"].filter((k) => k !== "sentOn" || "sentOn" in v.job.stages[0]));
    expect(v.nextAction).toBe("receive");
    expect(v.prevWeightOutG).toBe(12.345);
  });

  it("ยังไม่ระบุตัว: ไม่มีรายละเอียดการผลิต (ชื่อแบบ/SKU/จำนวน) — เห็นแค่เลขงาน + แถบขั้น + รายชื่อที่เลือกได้", () => {
    const v = sanitizeWorkerView(base())!;
    expect(v.job.designLabel).toBeUndefined();
    expect(v.job.sku).toBeUndefined();
    expect(v.job.qtyPlanned).toBeUndefined();
    expect(v.viewer).toBeNull();
    expect(v.nextAction).toBe("identify");
    expect(v.workers).toEqual([{ id: WID, displayName: "ช่างเอ" }]);
  });

  it("ไม่มี viewer แต่ DB บอก next_action=send → บังคับ identify (ไม่เชื่อปุ่มที่ไม่มีตัวตน)", () => {
    expect(sanitizeWorkerView(base({ next_action: "send" }))!.nextAction).toBe("identify");
  });

  it("next_action นอก enum (รวม 'none' เดิม) → null ทั้ง view (0173: ไม่เดาปุ่ม)", () => {
    for (const na of ["drop table", "none", "", null, 5]) {
      expect(sanitizeWorkerView(base({ next_action: na, viewer: { worker_id: WID, display_name: "ช่างเอ" } })), String(na)).toBeNull();
    }
  });

  it("all_done: ผ่านได้แม้ยังไม่ระบุตัว (ไม่มีอะไรให้ทำ) · คนที่ระบุตัวแล้วก็ได้ค่าเดียวกัน", () => {
    expect(sanitizeWorkerView(base({ next_action: "all_done" }))!.nextAction).toBe("all_done");
    expect(sanitizeWorkerView(base({ next_action: "all_done", viewer: { worker_id: WID, display_name: "ช่างเอ" } }))!.nextAction).toBe("all_done");
  });

  it("ค่าแปลก: สถานะขั้นนอก enum → ทิ้งขั้นนั้น · เหตุผลของเสียนอก allowlist → ทิ้ง · worker id ไม่ใช่ uuid → ทิ้ง", () => {
    const v = sanitizeWorkerView(
      base({
        next_action: "send",
        viewer: { worker_id: WID, display_name: "ช่างเอ" },
        job: { job_no: "JB-1", status: "open", design_label: "x", stages: [stage({ status: "weird" }), stage({ seq: 2, code: "polish" })] },
        scrap_reasons: ["porosity", "<script>", "other"],
        workers: [{ id: "not-uuid", display_name: "ผี" }],
      })
    )!;
    expect(v.nextAction).toBe("send");
    expect(v.job.stages.map((s) => s.code)).toEqual(["polish"]);
    expect(v.scrapReasons).toEqual(["porosity", "other"]);
    expect(v.workers).toEqual([]);
  });

  it("รูปไม่ใช่ view ที่ใช้ได้ → null (ผู้เรียกแสดง 'ลิงก์ใช้ไม่ได้')", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { ok: false, code: "invalid_token" }, { ok: true }, { ok: true, job: {} }, { ok: true, job: { job_no: "" } }]) {
      expect(sanitizeWorkerView(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("ตัดความยาวข้อความ (กัน payload บวม) · ตัวเลขไม่ใช่ finite → null", () => {
    const v = sanitizeWorkerView(full() as never)!;
    expect(v.job.designLabel!.length).toBeLessThanOrEqual(200);
    const long = sanitizeWorkerView({ ...(full() as object), job: { ...(full() as { job: object }).job, design_label: "ก".repeat(500) }, prev_weight_out_g: "NaN" })!;
    expect(long.job.designLabel).toHaveLength(200);
    expect(long.prevWeightOutG).toBeNull();
  });
});

describe("findForbiddenKeys / FORBIDDEN_KEY_PATTERN — ตัวตรวจที่ใช้ในเทสต์หน้าช่าง/หน้าพิมพ์", () => {
  it("จับ key ต้องห้ามทุกระดับ ไม่สนตัวพิมพ์", () => {
    expect(findForbiddenKeys({ a: { b: [{ Price: 1 }] } })).toEqual(["$.a.b[0].Price"]);
    expect(findForbiddenKeys({ customerName: "x", Quote_No: "y" })).toEqual(["$.customerName", "$.Quote_No"]);
  });
  it("ไม่จับ key ปกติของใบงาน (กัน false positive จนเทสต์หมดความหมาย)", () => {
    const okKeys = ["jobNo", "designLabel", "qtyPlanned", "weightInG", "stageName", "receivedOn", "heldBy", "workerName", "scrapReasons", "dueDate", "sku", "metal", "status", "nextAction"];
    for (const k of okKeys) expect(FORBIDDEN_KEY_PATTERN.test(k), k).toBe(false);
  });
});
