// 0195 ใบทองไม่บังคับชั่งขั้นขัด (gold_weigh_exempt) — นิยามฝั่ง TS ต้องตรงกับ DB:
// gold_unguarded = metal_present ∧ ¬gold_weigh_exempt ∧ ¬weigh_required ∧ status <> 'skipped'
// QA 27 ต.ค. 69: ย้ายจาก lib/jobs/ — vitest ไม่มี project ไหน include lib/**/*.test.tsx (node = *.test.ts · components = components/**/*.test.tsx) ⇒ ไฟล์เดิมไม่เคยถูกรันเลย ("No test files found")
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageFlagChips } from "./StageFlagChips";
import { profileSummaryParts } from "./ProfileSummary";
import { mapProfileStageDef } from "@/lib/jobs/profile";
import { analyzePicker, goldUnguardedStages } from "@/lib/jobs/profile-summary";
import { mapStageRow } from "@/lib/jobs/types";

afterEach(cleanup);

const st = (code: string, metalPresent: boolean, weigh: boolean, extra: { skipped?: boolean; goldWeighExempt?: boolean } = {}) => ({ code, metalPresent, weigh, ...extra });

describe("goldUnguardedStages — exempt", () => {
  it("ขัด (exempt) ไม่ชั่ง = ไม่ติดป้าย · ฝังพลอย (ไม่ exempt) ไม่ชั่ง = ติดป้าย", () => {
    expect(goldUnguardedStages([st("cast", true, true), st("buff", true, false, { goldWeighExempt: true })])).toEqual([]);
    expect(goldUnguardedStages([st("cast", true, true), st("gem_set", true, false), st("buff", true, false, { goldWeighExempt: true })])).toEqual(["gem_set"]);
  });
  it("ไม่มี key goldWeighExempt = false (เข้มไว้ก่อน) · exempt ไม่ทำให้ขั้นไม่มีโลหะติดป้าย", () => {
    expect(goldUnguardedStages([st("buff", true, false)])).toEqual(["buff"]);
    expect(goldUnguardedStages([st("wax", false, false, { goldWeighExempt: true })])).toEqual([]);
  });
  it("exempt แต่ชั่งอยู่ก็ไม่ติดป้าย (exempt ≠ ห้ามชั่ง)", () => {
    expect(goldUnguardedStages([st("buff", true, true, { goldWeighExempt: true })])).toEqual([]);
  });
});

describe("analyzePicker — ใบทอง + exempt", () => {
  const flags = [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }];
  const stages = [
    { code: "cast", nameTh: "หล่อ", metalPresent: true },
    { code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true },
    { code: "plating", nameTh: "ชุบ", metalPresent: true },
  ];
  it("เตือนเฉพาะขั้นที่ไม่ exempt", () => {
    expect(analyzePicker({ requireFinalWeight: true, stages: flags }, stages, "gold").goldUnguarded).toEqual(["ชุบ"]);
  });
  it("ใบเงินไม่เตือนเลย", () => {
    expect(analyzePicker({ requireFinalWeight: false, stages: flags }, stages, "silver").goldUnguarded).toEqual([]);
  });
});

describe("mapper", () => {
  it("mapProfileStageDef: key มีเฉพาะเมื่อ true", () => {
    expect(mapProfileStageDef({ code: "buff", name_th: "ขัด", seq_default: 105, metal_present: true, is_active: true, gold_weigh_exempt: true })).toMatchObject({ goldWeighExempt: true });
    expect(mapProfileStageDef({ code: "cast", name_th: "หล่อ", seq_default: 70, metal_present: true, is_active: true, gold_weigh_exempt: false })).not.toHaveProperty("goldWeighExempt");
    expect(mapProfileStageDef({ code: "cast", name_th: "หล่อ", seq_default: 70, metal_present: true, is_active: true })).not.toHaveProperty("goldWeighExempt");
  });
  it("mapStageRow: รับ record แบบใหม่ (metalPresent + exempt) และแบบเดิม (boolean)", () => {
    const row = { id: "s1", stage_code: "buff", status: "pending", weigh_required: false };
    expect(mapStageRow(row, {}, {}, { buff: { metalPresent: true, goldWeighExempt: true } })).toMatchObject({ metalPresent: true, goldWeighExempt: true });
    expect(mapStageRow(row, {}, {}, { buff: { metalPresent: true } })).toMatchObject({ metalPresent: true });
    expect(mapStageRow(row, {}, {}, { buff: { metalPresent: true } })).not.toHaveProperty("goldWeighExempt");
    expect(mapStageRow(row, {}, {}, { buff: true })).toMatchObject({ metalPresent: true });
    expect(mapStageRow(row, {}, {}, {})).toMatchObject({ metalPresent: false });
  });
});

describe("StageFlagChips — ป้ายแดง 'ไม่ชั่ง'", () => {
  const base = { status: "pending", weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, metalPresent: true };
  it("ใบทอง ขั้นที่ exempt ไม่ติดป้าย", () => {
    const { container } = render(<StageFlagChips stage={{ ...base, goldWeighExempt: true }} gold />);
    expect(container).toBeEmptyDOMElement();
  });
  it("ใบทอง ขั้นที่ไม่ exempt ติดป้ายเหมือนเดิม", () => {
    render(<StageFlagChips stage={base} gold />);
    expect(screen.getByText(/ไม่ชั่ง/)).toBeInTheDocument();
  });
});

describe("profileSummaryParts — แบบทองปริยายใหม่", () => {
  const defs = [
    { code: "cast", nameTh: "หล่อ", metalPresent: true },
    { code: "gem_set", nameTh: "ฝังพลอย", metalPresent: true },
    { code: "buff", nameTh: "ขัด", metalPresent: true, goldWeighExempt: true },
  ];
  const flag = (c: string, weigh: boolean) => ({ stageCode: c, weigh, scrapQty: false, scrapWeight: false });
  it("ชั่งครบทุกขั้นที่มีโลหะ ยกเว้นขัด → ป้ายตรงตามจริง", () => {
    expect(profileSummaryParts(defs, [flag("cast", true), flag("gem_set", true), flag("buff", false)]).weigh).toBe("ทุกขั้นที่มีโลหะ (ยกเว้นขัด)");
  });
  it("ชั่งครบทุกขั้นรวมขัด → ยังเป็น 'ทุกขั้นที่มีโลหะ'", () => {
    expect(profileSummaryParts(defs, [flag("cast", true), flag("gem_set", true), flag("buff", true)]).weigh).toBe("ทุกขั้นที่มีโลหะ");
  });
  it("ชั่งไม่ครบ (ขาดฝังพลอย) → ไม่ใช้ป้ายยกเว้น", () => {
    expect(profileSummaryParts(defs, [flag("cast", true), flag("buff", false)]).weigh).not.toContain("ยกเว้น");
  });
  it("ไม่มี exempt ในทะเบียน → พฤติกรรมเดิม", () => {
    const plain = defs.map(({ goldWeighExempt: _g, ...d }) => d);
    expect(profileSummaryParts(plain, [flag("cast", true), flag("gem_set", true)]).weigh).not.toContain("ยกเว้น");
  });
});
