// QA guard: M1 สวิตช์เผื่อของเสีย — ห้ามใช้ค่าแนะนำเงียบ (มติ 18 ต.ค. 69)
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
  });
  it("createJob action: no suggestion fallback; qtyPlanned only forwarded when provided", () => {
    const src = read("lib/actions/job-office.ts");
    const i = src.indexOf("export async function createJob");
    const body = src.slice(i);
    expect(body).not.toMatch(/suggest/i);
    expect(body).toMatch(/if \(input\.qtyPlanned !== null && input\.qtyPlanned !== undefined\)/);
  });
  // ผูกข้อความ SQL ตรงตัว (coalesce(p_qty_planned, v_qty_order)) โดยตั้งใจ — ถ้าแก้ตรรกะ/จัดรูปแบบใหม่ ต้องมาอัปเดตเทสต์นี้พร้อมทบทวนว่ายังไม่ใช้ค่าแนะนำ
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
  it("no later migration (เลข > 0176) redefines job_create_* with the suggestion — กวาดทุกไฟล์ ไม่ล็อกรายชื่อ", () => {
    // 0186 (PM-A) ต้อง replace job_create_insert (ตัวแกนที่ job_create_from_* ทุกตัวเรียก) เพื่อปิดช่อง fallback เงียบของแบบทอง (no_gold_profile) —
    // ฟังก์ชันนั้นรับจำนวนมาจากผู้เรียกตรงๆ ไม่คำนวณ/ไม่อ่านค่าแนะนำเลย ⇒ เจตนาของด่านนี้ ("เส้นสร้างใบไม่ใช้ค่าแนะนำเป็นค่าตั้งต้นเงียบๆ") ยังครบ:
    // จึงเปลี่ยนจาก "ห้ามมี migration ใหม่ replace job_create_*" เป็น "ถ้ามี ตัวฟังก์ชันต้องไม่เรียก/อ้างค่าแนะนำ" (ยังกวาดทุกไฟล์ ไม่ล็อกชื่อ)
    const later = readdirSync(join(root, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 176);
    expect(later.length).toBeGreaterThan(0);
    const startRe = /create or replace function analytics\.job_create\w*/gi;
    for (const f of later) {
      const sql = read(`supabase/migrations/${f}`);
      for (const m of sql.matchAll(startRe)) {
        const from = m.index ?? 0;
        const rest = sql.slice(from);
        // ตัวฟังก์ชันจบที่ dollar-quote ปิดบรรทัดแรกหลังเริ่ม (`$fn$;` / `$function$;` / `$f$;`)
        const end = rest.search(/\n\$[a-z_0-9]*\$;/i);
        const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 20000);
        expect(body, `${f}: ${m[0]}`).not.toMatch(/v_suggest|job_plan_suggest\(|qty_planned_suggest/);
      }
    }
  });
  it("0186 redefines only job_create_insert among job_create_* (the 3 job_create_from_*/entry RPCs untouched — their bodies are the 0176 ones this file pins above)", () => {
    const sql = read("supabase/migrations/0186_production_item_metal.sql");
    const names = [...sql.matchAll(/create or replace function analytics\.(job_create\w*)/gi)].map((m) => m[1]);
    expect(names).toEqual(["job_create_insert"]);
  });
});
