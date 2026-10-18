// QA scratch: unit + static guards for M1 buffer switch (not for commit)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attentionCount, bufferQtyOf, primaryStatus, statusSignals } from "@/lib/jobs/board";
import { parseBufferText } from "@/lib/jobs/input";
import { mapBoardRow } from "@/lib/jobs/types";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const TODAY = "2026-10-15";
const row = (o: Record<string, unknown> = {}) =>
  mapBoardRow({ id: "11111111-1111-4111-8111-111111111111", job_no: "JB-0100", seq: 100, source_kind: "oem", metal: "silver", qty_planned: 30, qty_order: 30, status: "in_progress", ...o })!;

describe("parseBufferText adversarial", () => {
  it.each(["0", "5", " 5 ", "\t7\n", "05", "99970"])("accepts %j (order 30)", (t) => {
    expect(parseBufferText(t, 30).ok).toBe(true);
  });
  it.each([
    "-1", "-0", "+5", "1,5", "1.5", "3.", ".5", "1e3", "1E3", "0x10", "0b1", "๕", "５", "٥", "5 ชิ้น", "😀", "", "   ", "abc", "5​", "5 5", "Infinity", "NaN",
    "99999999999999999999", "99971", "１２", "5-", "--5", "(5)", "1_000",
  ])("rejects %j", (t) => {
    expect(parseBufferText(t, 30).ok).toBe(false);
  });
  it.each([null, undefined, {}, [], [5], true, NaN, Infinity, -1, 5.5, 1e21, -0.5])("rejects non-string/number %j", (v) => {
    expect(parseBufferText(v, 30).ok).toBe(false);
  });
  it("number 5 and -0 behave (String(-0) === '0')", () => {
    expect(parseBufferText(5, 30)).toMatchObject({ ok: true, value: 5 });
    expect(parseBufferText(-0, 30).ok).toBe(true);
  });
  it("ceiling boundary exactly 100000 total", () => {
    expect(parseBufferText("99970", 30)).toMatchObject({ ok: true, value: 99970 });
    expect(parseBufferText("99971", 30).ok).toBe(false);
    expect(parseBufferText("0", 100000).ok).toBe(true);
    expect(parseBufferText("1", 100000).ok).toBe(false);
  });
  it("error message for over-cap states how many extra allowed", () => {
    const r = parseBufferText("99971", 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("99,970");
  });
  it("order already over cap (impossible but defensive): 0 rejected with 'ไม่เกิน 0'", () => {
    const r = parseBufferText("0", 100001);
    expect(r.ok).toBe(false);
  });
});

describe("board: buffer chip never inflates attention / primary", () => {
  it("rows with buffer (any size) → primary normal; attentionCount 0", () => {
    const rows = [row({ qty_planned: 31 }), row({ qty_planned: 100000, qty_order: 30 }), row({ qty_planned: 30 }), row({ qty_planned: 20, under_planned: true })];
    expect(attentionCount(rows, TODAY)).toBe(0);
    for (const r of rows) expect(primaryStatus(r, TODAY).key).toBe("normal");
  });
  it("buffer + overdue: overdue stays primary; buffer only secondary", () => {
    const r = row({ qty_planned: 35, due_date: "2026-10-01", is_overdue: true });
    expect(primaryStatus(r, TODAY).key).toBe("overdue");
    expect(statusSignals(r, TODAY).map((s) => s.key)).toContain("buffer");
  });
  it("bufferQtyOf: equal / less / zero-order edge", () => {
    expect(bufferQtyOf({ qtyOrder: 30, qtyPlanned: 30 })).toBe(0);
    expect(bufferQtyOf({ qtyOrder: 30, qtyPlanned: 29 })).toBe(0);
    expect(bufferQtyOf({ qtyOrder: 0, qtyPlanned: 5 })).toBe(5);
    expect(bufferQtyOf({ qtyOrder: 30, qtyPlanned: 31 })).toBe(1);
  });
  it("chip label has no money/weight (qty only)", () => {
    const s = statusSignals(row({ qty_planned: 35 }), TODAY).find((x) => x.key === "buffer")!;
    expect(s.label).toBe("เผื่อ +5");
  });
});

describe("static guards: create path never uses the suggestion", () => {
  it("JobCreateDialog does not read qtyPlannedSuggest / qtyPlannedEff / bufferQty", () => {
    const src = read("components/domain/jobs/JobCreateDialog.tsx");
    expect(src).not.toMatch(/qtyPlannedSuggest|qtyPlannedEff|bufferQty/);
    expect(src).not.toMatch(/useEffect\([^)]*setBufferText/s);
  });
  it("createJob action: no suggestion fallback; qtyPlanned only forwarded when provided", () => {
    const src = read("lib/actions/job-office.ts");
    const i = src.indexOf("export async function createJob");
    const body = src.slice(i);
    expect(body).not.toMatch(/suggest/i);
    expect(body).toMatch(/if \(input\.qtyPlanned !== null && input\.qtyPlanned !== undefined\)/);
  });
  it("0176 job_create_* bodies: coalesce(p_qty_planned, v_qty_order) x2, no v_suggest / plan_suggest call", () => {
    const sql = read("supabase/migrations/0176_job_record_profile.sql");
    const start = sql.indexOf("create or replace function analytics.job_create_from_quote_item");
    expect(start).toBeGreaterThan(0);
    const prod = sql.indexOf("create or replace function analytics.job_create_from_production_item");
    const endMarker = sql.indexOf("create or replace function", prod + 10);
    const seg = sql.slice(start, endMarker);
    expect((seg.match(/coalesce\(p_qty_planned, v_qty_order\)/g) ?? []).length).toBe(2);
    expect(seg).not.toMatch(/v_suggest|job_plan_suggest\(|qty_planned_suggest/);
  });
  it("no later migration redefines job_create_* (0177/0178)", () => {
    for (const f of ["0177_job_plan_rate_unit_fix.sql", "0178_job_scrap_guard_name_check.sql"]) {
      const sql = read(`supabase/migrations/${f}`);
      expect(sql).not.toMatch(/create or replace function analytics\.job_create/i);
    }
  });
});
