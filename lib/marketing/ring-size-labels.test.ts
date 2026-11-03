// lib/marketing/ring-size-labels.test.ts — ป้ายภาษาคนต้องครบทุกขั้น/ทุก bucket ที่ track-schema มี + ไม่มีศัพท์ dev บนจอ
import { describe, expect, it } from "vitest";
import { RING_IN_APP, RING_STAGES } from "@/lib/ring-size/track-schema";
import {
  FRICTION_ROWS,
  IN_APP_LABELS,
  STAGE_ABANDON_LABELS,
  STAGE_REACHED_LABELS,
  inAppLabel,
  stageAbandonLabel,
  stageNumber,
  stageReachedLabel,
} from "./ring-size-labels";

describe("ป้ายขั้น (funnel)", () => {
  it("มีป้าย 'ไปถึง' ครบทุก stage 0–7 ของ RING_STAGES (ไม่ซ้ำกัน ไม่ว่าง)", () => {
    const labels = RING_STAGES.map((_, i) => stageReachedLabel(i));
    expect(labels).toHaveLength(8);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.keys(STAGE_REACHED_LABELS).sort()).toEqual([...RING_STAGES].sort());
  });
  it("มีความหมาย 'เลิกที่ขั้นนี้' ครบ stage 0–6 และ stage 7 = null (จบ ไม่นับเป็นเลิก)", () => {
    for (let i = 0; i < 7; i++) expect(stageAbandonLabel(i)).toBeTruthy();
    expect(stageAbandonLabel(7)).toBeNull();
    expect(Object.keys(STAGE_ABANDON_LABELS).sort()).toEqual(RING_STAGES.filter((s) => s !== "result").sort());
  });
  it("เลขขั้นบนจอ = stage + 1 (เลขสองระบบไม่หลุดข้ามกัน)", () => {
    expect(stageNumber(0)).toBe(1);
    expect(stageNumber(7)).toBe(8);
  });
  it("stage นอกชุด ⇒ fallback ไม่ crash ไม่ undefined", () => {
    expect(stageReachedLabel(99)).not.toMatch(/undefined/);
    expect(stageAbandonLabel(-1)).toBeNull();
  });
});

describe("ป้ายช่องทาง (by_in_app)", () => {
  it("ครบทุก bucket ของ RING_IN_APP (ชุดเดียวกับ track-schema ไม่ประกาศซ้ำ)", () => {
    expect(Object.keys(IN_APP_LABELS).sort()).toEqual([...RING_IN_APP].sort());
    for (const code of RING_IN_APP) expect(inAppLabel(code).length).toBeGreaterThan(0);
  });
  it("รหัสที่ไม่รู้จัก⇒ โชว์รหัสดิบ (ไม่ crash · ไม่ resolve ผ่าน prototype)", () => {
    expect(inAppLabel("zzz")).toBe("zzz");
    expect(inAppLabel("constructor")).toBe("constructor");
    expect(inAppLabel("__proto__")).toBe("__proto__");
  });
});

describe("ป้าย friction", () => {
  it("ไม่มีรหัส G1–G5 / ศัพท์ dev บนจอ", () => {
    const text = FRICTION_ROWS.map((r) => `${r.title} ${r.hint}`).join(" ");
    expect(text).not.toMatch(/\bG[1-5]\b|stage|session|RPC|migration|PDPA/i);
  });
  it("ครบ 4 แถวตาม RPC (remeasured ไม่อยู่ที่นี่ — อยู่ตารางแยกวิธี)", () => {
    expect(FRICTION_ROWS.map((r) => r.key)).toEqual(["zoomBlocked", "calibWarn", "invalid", "staleRecalib"]);
  });
});
