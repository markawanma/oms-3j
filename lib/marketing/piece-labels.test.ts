import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  CHANNEL_LABEL,
  CUSTOMER_GROUPS,
  CUSTOMER_GROUP_LABEL,
  EFFECTIVE_PIECE_STATUSES,
  EVENT_KIND_LABEL,
  FOOTAGE_STATUSES,
  FOOTAGE_STATUS_LABEL,
  GATE_KINDS,
  GATE_KIND_LABEL,
  GATE_STATUSES,
  GATE_STATUS_LABEL,
  HOOK_TYPES,
  HOOK_TYPE_LABEL,
  KIND_CHANNELS,
  METRIC_CODES,
  METRIC_CODE_LABEL,
  PIECE_KINDS,
  PIECE_KIND_LABEL,
  PIECE_STATUS_LABEL,
  PIECE_STATUS_TONE,
  RAW_PIECE_STATUSES,
  SHOOT_LOCATIONS,
  SHOOT_LOCATION_LABEL,
  STEPPER_STEPS,
  TIME_SLOTS,
  TIME_SLOT_LABEL,
  gateStatusLabel,
  isContentLocked,
  nextStepperLabel,
  pieceKindHasPostUrl,
  pieceStatusLabel,
  primaryActionFor,
  stepperIndex,
} from "./piece-labels";

const THAI = /[฀-๿]/;

describe("label maps cover every DB enum", () => {
  it("ทุกค่า enum มีป้ายไทยไม่ว่าง (กัน enum ใหม่หลุดเป็นอังกฤษดิบ)", () => {
    const checks: Array<[readonly string[], Record<string, string>]> = [
      [EFFECTIVE_PIECE_STATUSES, PIECE_STATUS_LABEL],
      [PIECE_KINDS, PIECE_KIND_LABEL],
      [CHANNELS, CHANNEL_LABEL],
      [CUSTOMER_GROUPS, CUSTOMER_GROUP_LABEL],
      [TIME_SLOTS, TIME_SLOT_LABEL],
      [FOOTAGE_STATUSES, FOOTAGE_STATUS_LABEL],
      [SHOOT_LOCATIONS, SHOOT_LOCATION_LABEL],
      [METRIC_CODES, METRIC_CODE_LABEL],
      [HOOK_TYPES, HOOK_TYPE_LABEL],
      [GATE_KINDS, GATE_KIND_LABEL],
      [GATE_STATUSES, GATE_STATUS_LABEL],
    ];
    for (const [keys, map] of checks) {
      for (const k of keys) expect(map[k], `missing label for ${k}`).toBeTruthy();
    }
    for (const label of Object.values(PIECE_STATUS_LABEL)) expect(label).toMatch(THAI);
  });

  it("ทุกสถานะ effective มี tone", () => {
    for (const s of EFFECTIVE_PIECE_STATUSES) expect(PIECE_STATUS_TONE[s]).toBeTruthy();
  });

  it("อนุมัติแล้วกับผลิตแล้วต้อง tone ต่างกัน (แยกด้วยตาใน 3 วินาที — แผน §5.1)", () => {
    expect(PIECE_STATUS_TONE.approved).not.toBe(PIECE_STATUS_TONE.produced);
  });

  it("สถานะดิบทั้งหมดอยู่ใน effective ด้วย", () => {
    for (const s of RAW_PIECE_STATUSES) expect(EFFECTIVE_PIECE_STATUSES).toContain(s);
  });

  it("event kind ที่ DB อนุญาตทั้ง 13 ชนิดมีป้าย", () => {
    for (const k of ["create", "advance", "revert", "hold", "resume", "defer", "cancel", "restore", "post", "unpost", "gate", "confirm", "plan"]) {
      expect(EVENT_KIND_LABEL[k]).toBeTruthy();
    }
  });

  it("ค่าไม่รู้จักไม่หลุดเป็นภาษาอังกฤษ", () => {
    expect(pieceStatusLabel("whatever")).toBe("ไม่ทราบสถานะ");
    expect(pieceStatusLabel(null)).toBe("ยังไม่ระบุ");
    expect(gateStatusLabel(null)).toBe("รอตรวจ");
    expect(gateStatusLabel("zzz")).toBe("ไม่ทราบสถานะ");
  });

  it("ตารางชนิด↔ช่องทางครอบคลุมทุกชนิดและช่องทางที่ใช้ได้อยู่ใน CHANNELS", () => {
    for (const k of PIECE_KINDS) {
      expect(KIND_CHANNELS[k].length).toBeGreaterThan(0);
      for (const c of KIND_CHANNELS[k]) expect(CHANNELS).toContain(c);
    }
  });
});

describe("stepper (ไม่มีเลข — brief 0.4)", () => {
  it("มี 9 ขั้น", () => {
    expect(STEPPER_STEPS).toHaveLength(9);
  });
  it("ตำแหน่งตามสถานะ effective", () => {
    expect(stepperIndex("in_review", "in_review")).toBe(3);
    expect(stepperIndex("posted", "measuring")).toBe(7);
    expect(stepperIndex("posted", "measured")).toBe(8);
  });
  it("on_hold/cancelled ใช้สถานะดิบ · missed_measure ยืนที่ posted", () => {
    expect(stepperIndex("approved", "on_hold")).toBe(4);
    expect(stepperIndex("idea", "cancelled")).toBe(0);
    expect(stepperIndex("posted", "missed_measure")).toBe(6);
  });
  it("ไม่รู้จัก = null (ไม่เดา)", () => {
    expect(stepperIndex(null, null)).toBeNull();
    expect(stepperIndex("xxx", "xxx")).toBeNull();
    expect(nextStepperLabel(null)).toBeNull();
    expect(nextStepperLabel(8)).toBeNull();
    expect(nextStepperLabel(3)).toBe("อนุมัติแล้ว");
  });
});

describe("primaryActionFor — ปุ่มหลัก 1 อันต่อสถานะ (§2.4)", () => {
  const base = { pieceKind: "short_clip", footageStatus: null as string | null };
  it("ไอเดีย → วางแผน", () => expect(primaryActionFor({ ...base, effective: "idea" }).key).toBe("plan"));
  it("planned → ไม่มีปุ่มหลัก (รอ AI ร่าง)", () => expect(primaryActionFor({ ...base, effective: "planned" }).key).toBe("none"));
  it("drafting → ส่งตรวจ", () => expect(primaryActionFor({ ...base, effective: "drafting" }).key).toBe("submit_review"));
  it("in_review → อนุมัติ", () => expect(primaryActionFor({ ...base, effective: "in_review" }).key).toBe("approve"));
  it("approved คลิป needs_shoot → ถ่ายแล้ว", () => {
    expect(primaryActionFor({ ...base, effective: "approved", footageStatus: "needs_shoot" }).key).toBe("mark_produced");
  });
  it("approved คลิปที่ยังไม่ระบุสถานะภาพ → ถ่ายแล้ว (DB ปฏิเสธการข้าม produced เมื่อภาพยังไม่ยืนยัน)", () => {
    expect(primaryActionFor({ ...base, effective: "approved", footageStatus: null }).key).toBe("mark_produced");
  });
  it("approved คลิปมีภาพแล้ว → โพสต์แล้ว", () => {
    expect(primaryActionFor({ ...base, effective: "approved", footageStatus: "has_footage" }).key).toBe("mark_posted");
  });
  it("approved โพสต์ FB/IG ที่ needs_shoot → ถ่ายแล้ว · ไม่ระบุ → โพสต์แล้ว", () => {
    expect(primaryActionFor({ pieceKind: "ig_fb_post", footageStatus: "needs_shoot", effective: "approved" }).key).toBe("mark_produced");
    expect(primaryActionFor({ pieceKind: "ig_fb_post", footageStatus: null, effective: "approved" }).key).toBe("mark_posted");
  });
  it("approved ข้อความ LINE/สตอรี่ → โพสต์แล้ว", () => {
    expect(primaryActionFor({ pieceKind: "line_message", footageStatus: null, effective: "approved" }).key).toBe("mark_posted");
    expect(primaryActionFor({ pieceKind: "story", footageStatus: null, effective: "approved" }).key).toBe("mark_posted");
  });
  it("produced → โพสต์แล้ว", () => expect(primaryActionFor({ ...base, effective: "produced" }).key).toBe("mark_posted"));
  it("on_hold → กลับมาทำต่อ · cancelled → กู้คืน", () => {
    expect(primaryActionFor({ ...base, effective: "on_hold" }).key).toBe("resume");
    expect(primaryActionFor({ ...base, effective: "cancelled" }).key).toBe("restore");
  });
  it("posted/measuring/measured/missed_measure → ไม่มีปุ่มหลัก (ดูผล)", () => {
    for (const s of ["posted", "measuring", "measured", "missed_measure"]) {
      expect(primaryActionFor({ ...base, effective: s }).key).toBe("none");
    }
  });
  it("ปุ่มหลักทุกสถานะเป็นการเดินหน้า/คืนสถานะที่ตั้งใจ ไม่มีการถอยจาก approved (F11)", () => {
    for (const s of EFFECTIVE_PIECE_STATUSES) {
      const k = primaryActionFor({ ...base, effective: s }).key;
      expect(["plan", "submit_review", "approve", "mark_produced", "mark_posted", "resume", "restore", "none"]).toContain(k);
    }
  });
});

describe("helpers", () => {
  it("เนื้อหาแก้ได้เฉพาะ drafting/in_review", () => {
    expect(isContentLocked("drafting")).toBe(false);
    expect(isContentLocked("in_review")).toBe(false);
    for (const s of ["idea", "planned", "approved", "produced", "posted", "cancelled", null]) {
      expect(isContentLocked(s)).toBe(true);
    }
  });
  it("ชนิดที่มีลิงก์โพสต์", () => {
    expect(pieceKindHasPostUrl("short_clip")).toBe(true);
    expect(pieceKindHasPostUrl("live_cut")).toBe(true);
    expect(pieceKindHasPostUrl("ig_fb_post")).toBe(true);
    expect(pieceKindHasPostUrl("line_message")).toBe(false);
    expect(pieceKindHasPostUrl("story")).toBe(false);
    expect(pieceKindHasPostUrl(null)).toBe(false);
  });
});

describe("gateKindLabel / hookTypeLabel", () => {
  it("ด่านใหม่ไม่ขึ้นชื่อดิบ · ป้ายเดิมของบอร์ดยังชนะ · ไม่รู้จัก = ด่านตรวจ", async () => {
    const { gateKindLabel, hookTypeLabel } = await import("./piece-labels");
    expect(gateKindLabel("fact_check")).toBe("ข้อเท็จจริง");
    expect(gateKindLabel("brand_rule")).toBe("กฎแบรนด์");
    expect(gateKindLabel("risk_owner")).toBe("ความเสี่ยง");
    expect(gateKindLabel("pdpa_consent", { pdpa_consent: "PDPA consent" })).toBe("PDPA consent");
    expect(gateKindLabel("something_new")).toBe("ด่านตรวจ");
    expect(gateKindLabel(null)).toBe("ด่านตรวจ");
    expect(hookTypeLabel("question")).toBe("คำถาม");
    expect(hookTypeLabel("contrast")).toBe("ยังไม่ระบุประเภท");
    expect(hookTypeLabel(null)).toBe("ยังไม่ระบุประเภท");
  });
});
