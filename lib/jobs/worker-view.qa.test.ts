// QA (R2-D2) — J1 ด่านข้อมูลหน้าช่าง: payload ที่ DB/RPC คืนมามี field แปลกปลอม → ต้องไม่ผ่าน sanitizeWorkerView
// (หน้าช่างเป็นสาธารณะ: ต่อให้ RPC พลาดคืนราคา/ชื่อลูกค้า หน้าต้องไม่ส่งต่อไปยัง client/RSC)
import { describe, expect, it } from "vitest";
import { findForbiddenKeys, sanitizeWorkerView } from "@/lib/jobs/worker-view";

const W1 = "11111111-1111-4111-8111-111111111111";

function hostile(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    unit_price_thb: 999,
    customer_name: "คุณลูกค้าลับ",
    quote_no: "OEM-2610-001",
    job: {
      job_no: "JB-0001",
      status: "in_progress",
      design_label: "แหวน",
      metal: "gold",
      qty_planned: 5,
      due_date: "2026-10-20",
      customer_name: "คุณลูกค้าลับ",
      price: 1234,
      cost_thb: 50,
      stages: [
        { seq: 1, code: "cast", name: "หล่อ", status: "sent", received_on: "2026-10-12", unit_cost: 5, customer: "x" },
        { seq: 2, code: "polish", name: "ขัด", status: "bogus_status" },
        null,
        "string",
      ],
    },
    viewer: { worker_id: W1, display_name: "ช่าง", phone: "0800000000", email: "a@b.c" },
    next_action: "send",
    action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: true, price: 1 },
    workers: [{ id: W1, display_name: "ช่าง", pin_hash: "$2a$..." }, { id: "not-a-uuid", display_name: "ผี" }],
    scrap_reasons: ["porosity", "<script>", 5, "other"],
    margin_pct: 40,
    ...extra,
  };
}

describe("sanitizeWorkerView — payload ปนของต้องห้าม", () => {
  it("ไม่มี key ต้องห้ามหลงเหลือ (ราคา/ต้นทุน/ลูกค้า/เลขใบเสนอ/โทร/อีเมล/pin_hash/margin) แม้ซ้อนใน stages/viewer/workers", () => {
    const v = sanitizeWorkerView(hostile());
    expect(v).not.toBeNull();
    expect(findForbiddenKeys(v)).toEqual([]);
    const s = JSON.stringify(v);
    for (const bad of ["คุณลูกค้าลับ", "OEM-2610", "999", "1234", "0800000000", "a@b.c", "pin_hash", "$2a$", "margin"]) expect(s).not.toContain(bad);
  });
  it("stage สถานะแปลก/ไม่ใช่ object ถูกทิ้ง · worker id ไม่ใช่ uuid ถูกทิ้ง · เหตุผลของเสียนอก whitelist ถูกทิ้ง", () => {
    const v = sanitizeWorkerView(hostile())!;
    expect(v.job.stages.map((s) => s.code)).toEqual(["cast"]);
    expect(v.workers.map((w) => w.id)).toEqual([W1]);
    expect(v.scrapReasons).toEqual(["porosity", "other"]);
  });
  it("ไม่มี viewer → บังคับ identify แม้ RPC บอก send (ห้ามเห็นปุ่มโดยไม่ล็อกอิน)", () => {
    const v = sanitizeWorkerView(hostile({ viewer: null }))!;
    expect(v.nextAction).toBe("identify");
  });
  it("viewer ที่ worker_id ไม่ใช่ uuid ถือว่าไม่มี viewer", () => {
    const v = sanitizeWorkerView(hostile({ viewer: { worker_id: "'; drop table--", display_name: "x" } }))!;
    expect(v.viewer).toBeNull();
    expect(v.nextAction).toBe("identify");
  });
  it("next_action แปลก → none (ไม่ใช่ค่าที่ client ตีความเป็นปุ่ม)", () => {
    expect(sanitizeWorkerView(hostile({ next_action: "delete_everything" }))!.nextAction).toBe("none");
  });
  it("รายชื่อช่างเกิน 50 ถูกตัด · ข้อความยาวผิดปกติถูกตัด · emoji/ไทยผ่าน", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, display_name: "ช่าง🙂" + i }));
    const raw = hostile({ workers: many });
    (raw.job as Record<string, unknown>).design_label = "ก".repeat(5000);
    const v = sanitizeWorkerView(raw)!;
    expect(v.workers).toHaveLength(50);
    expect(v.job.designLabel!.length).toBeLessThanOrEqual(200);
    expect(v.workers[0].displayName).toContain("🙂");
  });
  it("รูปผิดทุกแบบ → null (หน้าแสดง 'ลิงก์ใช้ไม่ได้' ไม่ throw)", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { ok: false }, { ok: true }, { ok: true, job: [] }, { ok: true, job: { job_no: "" } }, { ok: true, job: { job_no: 5 } }]) {
      expect(sanitizeWorkerView(bad as never)).toBeNull();
    }
  });
  it("prototype pollution ใน payload ไม่รั่วเข้า view", () => {
    const raw = JSON.parse('{"ok":true,"__proto__":{"polluted":1},"job":{"job_no":"JB-9","stages":[]},"constructor":{"x":1}}');
    const v = sanitizeWorkerView(raw)!;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("polluted");
  });
});
