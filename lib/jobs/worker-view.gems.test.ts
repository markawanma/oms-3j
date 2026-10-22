// 0190 G1a: พลอยบนหน้าช่าง — key ล็อก 4 ตัว · ไม่มีราคา · ก่อน PIN ไม่มี · ใบเดิมเหมือนเดิมเป๊ะ
import { describe, expect, it } from "vitest";
import { findForbiddenKeys, sanitizeWorkerView } from "./worker-view";

const WID = "11111111-1111-4111-8111-111111111111";
const gemRow = (o: Record<string, unknown> = {}) => ({ label: "โกเมน · ไข่ · 4×6 มม.", qty_per_piece: 2, qty_total: 70, position: "บ่าซ้าย-ขวา", ...o });
const raw = (jobExtra: Record<string, unknown> = {}, identified = true) => ({
  ok: true,
  job: { job_no: "JB-0001", status: "open", stages: [{ seq: 1, code: "cast", name: "หล่อ", status: "pending" }], ...(identified ? { design_label: "แหวน", sku: "RG-1", metal: "silver", qty_planned: 35, due_date: null } : {}), ...jobExtra },
  viewer: identified ? { worker_id: WID, display_name: "ช่างเอ" } : null,
  session_expired: false,
  next_action: identified ? "receive" : "identify",
  action_stage: null,
  prev_weight_out_g: null,
  held_by: null,
  workers: [],
  scrap_reasons: [],
});

describe("sanitizeWorkerView — พลอย (0190)", () => {
  it("ระบุตัวแล้ว: gems ประกอบทีละ key {label, qtyPerPiece, qtyTotal, position} เท่านั้น", () => {
    const v = sanitizeWorkerView(raw({ gems_state: "specified", gems: [gemRow()] }))!;
    expect(v.job.gemsState).toBe("specified");
    expect(v.job.gems).toEqual([{ label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: "บ่าซ้าย-ขวา" }]);
    expect(Object.keys(v.job.gems![0]).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
  });
  it("🔴 key ราคา/ต้นทุน/เผื่อแตก/รหัสรายการ/ผู้ขาย ที่ DB ส่งมาในแถว (แม้ผิดพลาด) ถูกทิ้ง — ทั้งก้อน view ไม่มีเลขนั้นและไม่มี forbidden key", () => {
    const poison = gemRow({ price_thb_per_unit: 7391.2468, unit_cost: 12, supplier: "ร้านลับ", gem_item_id: WID, breakage_allow_pct: 5, oem_tier: "กลาง", cost: 9 });
    const v = sanitizeWorkerView(raw({ gems_state: "specified", gems: [poison] }))!;
    expect(Object.keys(v.job.gems![0]).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
    const text = JSON.stringify(v);
    for (const leak of ["7391", "ร้านลับ", "breakage", "กลาง", WID.slice(0, 8) + "-1111-4111-8111-1111111111aa"]) expect(text).not.toContain(leak);
    expect(findForbiddenKeys(v)).toEqual([]);
  });
  it("ก่อนระบุตัว (ไม่มี viewer): gems/gems_state ที่ DB ส่งมาถูกทิ้ง (ด่านซ้ำ) · ไม่มี key ใน view", () => {
    const v = sanitizeWorkerView(raw({ gems_state: "specified", gems: [gemRow()] }, false))!;
    expect("gems" in v.job).toBe(false);
    expect("gemsState" in v.job).toBe(false);
  });
  it("ใบเดิม (DB ไม่ส่ง key พลอย): view ไม่มี key gems/gemsState — เหมือนเดิมเป๊ะ", () => {
    const v = sanitizeWorkerView(raw())!;
    expect("gems" in v.job).toBe(false);
    expect("gemsState" in v.job).toBe(false);
  });
  it("gems_state = unspecified: gems = [] (จอเตือน 'ยังไม่ระบุพลอย')", () => {
    const v = sanitizeWorkerView(raw({ gems_state: "unspecified", gems: [] }))!;
    expect(v.job.gemsState).toBe("unspecified");
    expect(v.job.gems).toEqual([]);
  });
  it("state ที่ไม่รู้จัก (not_needed/อื่น) = ไม่ใส่ key · แถวที่ไม่ผ่าน (จำนวน 0/1.5/1001/ฉลากว่าง/ไม่ใช่ object) ถูกทิ้ง · specified แต่ไม่เหลือแถว = ยัง specified ตาม DB (ไม่แปลงเป็น unspecified — จอจะไม่บอกช่างว่า 'ยังไม่ระบุพลอย' ทั้งที่ออฟฟิศระบุแล้ว)", () => {
    expect("gems" in sanitizeWorkerView(raw({ gems_state: "not_needed", gems: [gemRow()] }))!.job).toBe(false);
    expect("gems" in sanitizeWorkerView(raw({ gems_state: "weird", gems: [gemRow()] }))!.job).toBe(false);
    const bad = [gemRow({ qty_per_piece: 0 }), gemRow({ qty_per_piece: 1.5 }), gemRow({ qty_per_piece: 1001 }), gemRow({ label: "" }), gemRow({ qty_total: -1 }), "x", null];
    const v = sanitizeWorkerView(raw({ gems_state: "specified", gems: bad }))!;
    expect(v.job.gems).toEqual([]);
    expect(v.job.gemsState).toBe("specified");
  });
  it("ตำแหน่งว่าง = null · ไม่เกิน 30 แถว", () => {
    const many = Array.from({ length: 40 }, (_, i) => gemRow({ label: `พลอย ${i} · กลม · ${i + 1} มม.`, position: "" }));
    const v = sanitizeWorkerView(raw({ gems_state: "specified", gems: many }))!;
    expect(v.job.gems).toHaveLength(30);
    expect(v.job.gems![0].position).toBeNull();
  });
});
