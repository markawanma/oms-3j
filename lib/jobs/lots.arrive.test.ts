// lib/jobs/lots.arrive.test.ts — 0183: mapper/ป้าย/ข้อความของ "ได้รับเพิ่มแล้ว" (pure · ไม่แตะ DB)
import { describe, expect, it } from "vitest";
import { DISCREPANCY_KIND_LABEL, TREE_COLUMNS, TREE_SUMMARY_COLUMNS, mapDiscrepancy, mapLotPart, openDiscrepancies } from "@/lib/jobs/lots";
import { MY_ACTION_KINDS } from "@/lib/jobs/worker-view";
import { OFFICE_HINT_TH, WORKER_ARRIVE_CODE_TH, WORKER_CODE_TH, officeErrorMessage, workerFailMessage } from "@/lib/jobs/messages";
import { EVENT_TYPE_LABEL } from "@/lib/jobs/types";

const THAI = /[฀-๿]/;
const ctx = { stageById: { s6: { name: "ขัด" }, s7: { name: "ตรวจ QC" } }, labelByJob: { j1: "JB-0038" } };
const row = (o: Record<string, unknown>) => ({ id: "d1", job_id: "j1", qty: 2, status: "resolved", from_stage_id: "s6", to_stage_id: "s7", ...o });

describe("mapDiscrepancy — resolved_kind = arrived", () => {
  it("arrived ผ่านเป็น resolvedKind 'arrived' (ไม่ถูกทิ้งเป็น null) · scrap/lost เดิมเหมือนเดิม · ชนิดแปลก = null", () => {
    expect(mapDiscrepancy(row({ resolved_kind: "arrived" }), ctx)?.resolvedKind).toBe("arrived");
    expect(mapDiscrepancy(row({ resolved_kind: "scrap" }), ctx)?.resolvedKind).toBe("scrap");
    expect(mapDiscrepancy(row({ resolved_kind: "lost" }), ctx)?.resolvedKind).toBe("lost");
    expect(mapDiscrepancy(row({ resolved_kind: "hack" }), ctx)?.resolvedKind).toBeNull();
    expect(mapDiscrepancy(row({ resolved_kind: null, status: "open" }), ctx)?.resolvedKind).toBeNull();
  });
  it("ป้ายไทยของ arrived · ของเดิมไม่เปลี่ยน", () => {
    expect(DISCREPANCY_KIND_LABEL.arrived).toBe("ได้รับเพิ่มแล้ว");
    expect(DISCREPANCY_KIND_LABEL.scrap).toBe("เสียหาย");
    expect(DISCREPANCY_KIND_LABEL.lost).toBe("หาย");
  });
  it("openDiscrepancies: แถว arrived (resolved) ไม่ใช่ค้าง · แถวเดิมที่ถูก void ไม่ใช่ค้าง · แถว open ที่เหลือใหม่ = ค้าง", () => {
    const list = [
      mapDiscrepancy(row({ id: "orig", status: "open", qty: 3 }), ctx),
      mapDiscrepancy(row({ id: "void1", status: "void", void_of_id: "orig", qty: 3 }), ctx),
      mapDiscrepancy(row({ id: "arr", status: "resolved", resolved_kind: "arrived", qty: 1 }), ctx),
      mapDiscrepancy(row({ id: "rem", status: "open", qty: 2 }), ctx),
    ].filter((x): x is NonNullable<typeof x> => x !== null);
    expect(list).toHaveLength(4);
    expect(openDiscrepancies(list).map((d) => d.id)).toEqual(["rem"]);
  });
});

describe("mapLotPart / คอลัมน์ที่อ่าน", () => {
  it("qty_discrepancy_arrived → qtyDiscrepancyArrived (ไม่มี = 0) · ไม่ปนกับ qtyDiscrepancyResolved", () => {
    const base = { job_id: "j1", label: "JB-0038", status: "in_progress", qty_planned: 50 };
    expect(mapLotPart({ ...base, qty_discrepancy_resolved: 1, qty_discrepancy_arrived: 2 })).toMatchObject({ qtyDiscrepancyResolved: 1, qtyDiscrepancyArrived: 2 });
    expect(mapLotPart(base)).toMatchObject({ qtyDiscrepancyResolved: 0, qtyDiscrepancyArrived: 0 });
    expect(mapLotPart({ ...base, qty_discrepancy_arrived: "abc" })).toMatchObject({ qtyDiscrepancyArrived: 0 });
  });
  it("TREE_COLUMNS อ่าน qty_discrepancy_arrived · summary ไม่ต้อง (DB รวมให้แล้ว)", () => {
    expect(TREE_COLUMNS.split(/,\s*/)).toContain("qty_discrepancy_arrived");
    expect(TREE_SUMMARY_COLUMNS.split(/,\s*/)).not.toContain("qty_discrepancy_arrived");
  });
});

describe("worker action kinds + ข้อความ", () => {
  it("MY_ACTION_KINDS มี arrive (ของเดิมครบ)", () => {
    expect([...MY_ACTION_KINDS]).toEqual(["send", "receive", "explain", "arrive"]);
  });
  it("ข้อความ arrive ฝั่งช่างทั้งหมด: ไทย · ไม่มีตัวเลข · ไม่มี snake_case (N1)", () => {
    const all = [
      ...Object.values(WORKER_ARRIVE_CODE_TH),
      WORKER_CODE_TH.arrive_weight_required, WORKER_CODE_TH.arrive_heavy, WORKER_CODE_TH.not_receiver,
    ];
    expect(all.every((t) => typeof t === "string" && t !== "")).toBe(true);
    for (const t of all) {
      expect(THAI.test(t)).toBe(true);
      expect(t).not.toMatch(/\d/);
      expect(t).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });
  it("workerFailMessage: code ใหม่ → ข้อความตาราง (ไม่ใช้ข้อความดิบของ DB ที่มีตัวเลข)", () => {
    for (const code of ["arrive_weight_required", "arrive_heavy", "not_receiver"]) {
      const m = workerFailMessage(code, "ขาด 2.000 g");
      expect(m).toBe(WORKER_CODE_TH[code]);
      expect(m).not.toMatch(/\d/);
    }
  });
  it("ข้อความออฟฟิศ: hint ใหม่ครบ · ข้อความ DB ที่สะอาดใช้ตรงๆ ไม่สะอาดใช้ตาราง", () => {
    for (const h of ["arrive_weight_required", "arrive_heavy", "who_invalid", "who_required", "arrived_no_void", "arrived_no_update"]) expect(THAI.test(OFFICE_HINT_TH[h] ?? ""), h).toBe(true);
    expect(officeErrorMessage({ code: "22023", message: "ทอง: ต้องชั่งน้ำหนักชิ้นที่มาถึงก่อน", hint: "arrive_weight_required" })).toBe("ทอง: ต้องชั่งน้ำหนักชิ้นที่มาถึงก่อน");
    expect(officeErrorMessage({ code: "22023", message: "p_weight_g invalid", hint: "arrive_weight_required" })).toBe(OFFICE_HINT_TH.arrive_weight_required);
  });
  it("EVENT_TYPE_LABEL: discrepancy_arrive มีป้ายไทย (ไม่ใช่รหัสดิบ)", () => {
    expect(THAI.test(EVENT_TYPE_LABEL.discrepancy_arrive)).toBe(true);
    expect(EVENT_TYPE_LABEL.discrepancy_arrive).not.toMatch(/_/);
  });
});
