import { describe, expect, it } from "vitest";
import {
  ADVANCE_TARGETS,
  buildGatePayload,
  checkConfirmAnswer,
  checkHookInput,
  checkReason,
  checkRecoResponse,
  checkSourceUrl,
  cleanText,
  isAdvanceTarget,
  normalizeReviewSeconds,
  reasonAlwaysRequired,
  sanitizePlanSet,
} from "./piece-input";

describe("cleanText / checkReason", () => {
  it("ตัดอักขระล่องหนและช่องว่าง", () => {
    expect(cleanText("  a​b﻿ ")).toBe("ab");
    expect(cleanText(123)).toBe("");
  });
  it("เหตุผลที่มีแต่อักขระล่องหน/ช่องว่างไม่นับ", () => {
    expect(checkReason("​ ​", true).ok).toBe(false);
    expect(checkReason("ab", true).ok).toBe(false);
    expect(checkReason("abc", true)).toEqual({ ok: true, value: "abc" });
  });
  it("ไม่บังคับ: ว่างผ่านเป็น null · แต่ถ้าพิมพ์ก็ต้อง ≥3", () => {
    expect(checkReason("", false)).toEqual({ ok: true, value: null });
    expect(checkReason("ก", false).ok).toBe(false);
  });
  it("ยาวเกิน 500 ปฏิเสธ", () => {
    expect(checkReason("ก".repeat(501), true).ok).toBe(false);
    expect(checkReason("ก".repeat(500), true).ok).toBe(true);
  });
});

describe("advance", () => {
  it("allowlist ปลายทาง — ค่าอื่นปฏิเสธ", () => {
    for (const t of ADVANCE_TARGETS) expect(isAdvanceTarget(t)).toBe(true);
    for (const t of ["measured", "deleted", "", null, 5, "IN_REVIEW"]) expect(isAdvanceTarget(t)).toBe(false);
  });
  it("hold/ยกเลิก/กู้คืนต้องมีเหตุผลเสมอ · อื่นๆ ให้ DB ตัดสิน", () => {
    expect(reasonAlwaysRequired("hold")).toBe(true);
    expect(reasonAlwaysRequired("cancelled")).toBe(true);
    expect(reasonAlwaysRequired("restore")).toBe(true);
    expect(reasonAlwaysRequired("approved")).toBe(false);
    expect(reasonAlwaysRequired("drafting")).toBe(false);
  });
  it("review seconds: จำนวนเต็ม 0–86400 · นอกช่วง/ไม่ใช่เลข = ไม่ส่ง (0 เป็นค่าจริง)", () => {
    expect(normalizeReviewSeconds(0)).toBe(0);
    expect(normalizeReviewSeconds(95.9)).toBe(95);
    expect(normalizeReviewSeconds(86_400)).toBe(86_400);
    expect(normalizeReviewSeconds(86_401)).toBeNull();
    expect(normalizeReviewSeconds(-1)).toBeNull();
    expect(normalizeReviewSeconds(NaN)).toBeNull();
    expect(normalizeReviewSeconds("30")).toBeNull();
  });
});

describe("checkSourceUrl", () => {
  it("http/https เท่านั้น", () => {
    expect(checkSourceUrl("https://example.org/a?b=1").ok).toBe(true);
    expect(checkSourceUrl("http://example.org").ok).toBe(true);
  });
  it("javascript: · มีช่องว่าง · ไม่มีโปรโตคอล · ว่าง · ยาวเกิน → ปฏิเสธ", () => {
    for (const bad of ["javascript:alert(1)", "https://a b.com", "example.org", "", "ftp://x.org", "https://" + "a".repeat(600)]) {
      expect(checkSourceUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("buildGatePayload", () => {
  it("fact_check ผ่านโดยไม่มีแหล่ง → ปฏิเสธด้วยข้อความเดียวกับ DB", () => {
    const r = buildGatePayload({ gateKind: "fact_check", status: "passed", sources: [] }, null);
    expect(r).toEqual({ ok: false, error: "ผ่านได้ต้องมีลิงก์แหล่งอ้างอิงอย่างน้อย 1 ลิงก์" });
  });
  it("fact_check ผ่านพร้อมแหล่ง → ส่งทั้งชุด (sources + flagged) และตัดซ้ำ", () => {
    const r = buildGatePayload(
      { gateKind: "fact_check", status: "passed", sources: ["https://a.org/x", "https://a.org/x", "https://b.org"], flagged: ["ประโยค 1"] },
      null
    );
    expect(r.ok && r.value.detail).toEqual({ sources: ["https://a.org/x", "https://b.org"], flagged: ["ประโยค 1"] });
  });
  it("fact_check ติด (blocked) ไม่ต้องมีแหล่ง", () => {
    expect(buildGatePayload({ gateKind: "fact_check", status: "blocked", flagged: ["x"] }, null).ok).toBe(true);
  });
  it("ลิงก์แหล่ง javascript: → ปฏิเสธ", () => {
    expect(buildGatePayload({ gateKind: "fact_check", status: "passed", sources: ["javascript:alert(1)"] }, null).ok).toBe(false);
  });
  it("brand_rule ส่ง rules_hit ทั้งชุด", () => {
    const r = buildGatePayload({ gateKind: "brand_rule", status: "blocked", rulesHit: ["ห้ามเปิดราคารับซื้อคืน"] }, null);
    expect(r.ok && r.value.detail).toEqual({ rules_hit: ["ห้ามเปิดราคารับซื้อคืน"] });
  });
  it("risk_owner: ใช้ 'คำถามเดิม' ที่ผู้เรียกอ่านจาก DB — ไม่รับจาก input · answer ใส่ได้", () => {
    const r = buildGatePayload({ gateKind: "risk_owner", status: "passed", answer: "ใช้ได้" }, "ประโยคนี้เกี่ยวกับผิวหนังไหม");
    expect(r.ok && r.value.detail).toEqual({ question: "ประโยคนี้เกี่ยวกับผิวหนังไหม", answer: "ใช้ได้" });
  });
  it("risk_owner: ไม่มีทั้งคำถามและคำตอบ → detail null", () => {
    const r = buildGatePayload({ gateKind: "risk_owner", status: "na" }, null);
    expect(r.ok && r.value.detail).toBeNull();
  });
  it("risk_owner: คำตอบที่มี [ต้องยืนยัน → ปฏิเสธ", () => {
    expect(buildGatePayload({ gateKind: "risk_owner", status: "passed", answer: "[ต้องยืนยัน: x]" }, "q").ok).toBe(false);
  });
  it("หมายเหตุยาวเกิน 500 → ปฏิเสธ", () => {
    expect(buildGatePayload({ gateKind: "brand_rule", status: "blocked", note: "ก".repeat(501) }, null).ok).toBe(false);
  });
});

describe("checkConfirmAnswer", () => {
  it("ว่าง / มี [ต้องยืนยัน / ยาวเกิน → ปฏิเสธ", () => {
    expect(checkConfirmAnswer("  ").ok).toBe(false);
    expect(checkConfirmAnswer("ตอบ [ต้องยืนยัน").ok).toBe(false);
    expect(checkConfirmAnswer("ก".repeat(1001)).ok).toBe(false);
    expect(checkConfirmAnswer(" ยี่ห้อ ก ")).toEqual({ ok: true, value: "ยี่ห้อ ก" });
  });
});

describe("checkRecoResponse", () => {
  it("rejected ต้องมีเหตุผล ≥3 · done ไม่บังคับ", () => {
    expect(checkRecoResponse("rejected", "").ok).toBe(false);
    expect(checkRecoResponse("rejected", "ไม").ok).toBe(false);
    expect(checkRecoResponse("rejected", "ไม่เหมาะ")).toEqual({ ok: true, value: { action: "rejected", response: "ไม่เหมาะ" } });
    expect(checkRecoResponse("done", "")).toEqual({ ok: true, value: { action: "done", response: null } });
  });
  it("action นอก allowlist → ปฏิเสธ · ยาวเกิน 1000 → ปฏิเสธ · [ต้องยืนยัน → ปฏิเสธ", () => {
    expect(checkRecoResponse("expired", "x").ok).toBe(false);
    expect(checkRecoResponse("done", "ก".repeat(1001)).ok).toBe(false);
    expect(checkRecoResponse("done", "[ต้องยืนยัน: a]").ok).toBe(false);
  });
});

describe("sanitizePlanSet", () => {
  it("key นอก allowlist (เช่น audience_segment) → ปฏิเสธ", () => {
    expect(sanitizePlanSet({ audience_segment: "x" }).ok).toBe(false);
    expect(sanitizePlanSet({ piece_status: "approved" }).ok).toBe(false);
    expect(sanitizePlanSet({ shop_id: "x" }).ok).toBe(false);
  });
  it("ค่า 0 เป็นค่าจริง (ไม่ใช้ truthiness)", () => {
    const r = sanitizePlanSet({ baseline_value: 0, pass_threshold: 0, baseline_spread: 0 });
    expect(r.ok && r.value).toEqual({ baseline_value: 0, pass_threshold: 0, baseline_spread: 0 });
  });
  it("null = ล้างค่า ยกเว้น date ล้างไม่ได้ (D11: date:null โดน DB ปฏิเสธ)", () => {
    expect(sanitizePlanSet({ shoot_note: null })).toEqual({ ok: true, value: { shoot_note: null } });
    expect(sanitizePlanSet({ date: null }).ok).toBe(false);
  });
  it("NaN / Infinity / ตัวเลขเป็นสตริง → ปฏิเสธ", () => {
    expect(sanitizePlanSet({ baseline_value: NaN }).ok).toBe(false);
    expect(sanitizePlanSet({ pass_threshold: Infinity }).ok).toBe(false);
    expect(sanitizePlanSet({ baseline_value: "5" }).ok).toBe(false);
  });
  it("enum นอกรายการ → ปฏิเสธ · ในรายการ → ผ่าน", () => {
    expect(sanitizePlanSet({ piece_kind: "video" }).ok).toBe(false);
    expect(sanitizePlanSet({ piece_kind: "short_clip", channel: "tiktok", customer_group: "silver_bar" }).ok).toBe(true);
    expect(sanitizePlanSet({ pass_op: "=" }).ok).toBe(false);
    expect(sanitizePlanSet({ pass_op: ">=" }).ok).toBe(true);
  });
  it("วันที่: รูปแบบผิด/วันที่ไม่มีจริง → ปฏิเสธ", () => {
    expect(sanitizePlanSet({ date: "2026-02-30" }).ok).toBe(false);
    expect(sanitizePlanSet({ date: "09/10/2026" }).ok).toBe(false);
    expect(sanitizePlanSet({ date: "2026-10-09" }).ok).toBe(true);
  });
  it("เวลา: 24:00 ปฏิเสธ · 20:30 ผ่าน", () => {
    expect(sanitizePlanSet({ start_time: "24:00" }).ok).toBe(false);
    expect(sanitizePlanSet({ start_time: "20:30" }).ok).toBe(true);
  });
  it("ข้อความว่างปฏิเสธ (ล้างต้องส่ง null) · ยาวเกินปฏิเสธ", () => {
    expect(sanitizePlanSet({ hypothesis: "   " }).ok).toBe(false);
    expect(sanitizePlanSet({ hypothesis: "ก".repeat(1001) }).ok).toBe(false);
    expect(sanitizePlanSet({ hypothesis: " สมมติฐาน " })).toEqual({ ok: true, value: { hypothesis: "สมมติฐาน" } });
  });
  it("เวลาประเมินถ่ายทำ: จำนวนเต็มนาที ไม่ติดลบ", () => {
    expect(sanitizePlanSet({ shoot_minutes_est: 12.5 }).ok).toBe(false);
    expect(sanitizePlanSet({ shoot_minutes_est: -1 }).ok).toBe(false);
    expect(sanitizePlanSet({ shoot_minutes_est: 0 }).ok).toBe(true);
  });
  it("host id ต้องเป็น uuid · ว่างทั้งก้อน → ไม่มีค่าที่เปลี่ยน", () => {
    expect(sanitizePlanSet({ expected_host_id: "not-a-uuid" }).ok).toBe(false);
    expect(sanitizePlanSet({ expected_host_id: "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7" }).ok).toBe(true);
    expect(sanitizePlanSet({})).toEqual({ ok: false, error: "ไม่มีค่าที่เปลี่ยน" });
    expect(sanitizePlanSet(null).ok).toBe(false);
    expect(sanitizePlanSet([1]).ok).toBe(false);
  });
});

describe("checkHookInput", () => {
  const ok = { label: "A" as const, text: "ข้อความ", hookType: "question" };
  it("ผ่านเมื่อครบ", () => expect(checkHookInput(ok).ok).toBe(true));
  it("ประเภทนอก 8 ค่า / label นอก A,B / ข้อความว่าง/ยาวเกิน → ปฏิเสธ", () => {
    expect(checkHookInput({ ...ok, hookType: "contrast" }).ok).toBe(false);
    expect(checkHookInput({ ...ok, label: "C" as unknown as "A" }).ok).toBe(false);
    expect(checkHookInput({ ...ok, text: " " }).ok).toBe(false);
    expect(checkHookInput({ ...ok, text: "ก".repeat(501) }).ok).toBe(false);
  });
});
