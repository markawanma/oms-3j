// ป้ายประวัติ (EVENT_TYPE_LABEL) ต้องครอบทุก event_type ที่ CHECK job_event_event_type_ck อนุญาต — ไม่งั้นประวัติโชว์รหัสดิบให้ออฟฟิศ (QA 0176)
// อ่านรายการจาก migration จริง: ฉบับล่าสุดที่ replace constraint นี้ (0176) — migration ถัดไปที่เพิ่ม event type ต้องอัปเดตเทสต์นี้ให้อ่านฉบับใหม่
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_LABEL, EVENT_TYPE_LABEL, mapEventRow } from "@/lib/jobs/types";

const MIG_DIR = join(process.cwd(), "supabase", "migrations");
const THAI = /[฀-๿]/;

/** event_type ทั้งหมดใน constraint ฉบับสุดท้ายที่ migration ประกาศ (ไล่ไฟล์ตามเลข · ฉบับหลังทับฉบับก่อน) */
function checkedEventTypes(): string[] {
  let found: string[] | null = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    const sql = readFileSync(join(MIG_DIR, f), "utf8");
    // รูปแบบ 0176: check (event_type in (...)) · รูปแบบ 0181: check (event_type = any (array[...]))
    const m = /add constraint job_event_event_type_ck check \(event_type (?:in \(([^)]*)\)|= any \(array\[([^\]]*)\]\))\)/.exec(sql);
    if (m) found = [...(m[1] ?? m[2]).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  if (!found) throw new Error("ไม่พบ job_event_event_type_ck ใน migrations");
  return found;
}

describe("EVENT_TYPE_LABEL ครอบทุก event_type ใน CHECK ของ DB", () => {
  const types = checkedEventTypes();
  it("อ่านรายการจาก migration ได้ และมี profile_set / plan_change / surplus_set", () => {
    expect(types.length).toBeGreaterThanOrEqual(21);
    for (const t of ["profile_set", "plan_change", "surplus_set", "stage_receive", "token_revoke", "split", "split_cancel", "discrepancy", "discrepancy_resolve"]) expect(types).toContain(t);
  });
  it.each(types)("%s มีป้ายไทย (ไม่ใช่รหัสดิบ)", (t) => {
    const label = EVENT_TYPE_LABEL[t];
    expect(label, t).toBeTruthy();
    expect(THAI.test(label), t).toBe(true);
    expect(label).not.toMatch(/_/);
  });
  it("ไม่มีป้ายเกิน: ทุก key ของ EVENT_TYPE_LABEL อยู่ใน CHECK (กันป้ายของ event ที่ไม่มีจริง)", () => {
    for (const k of Object.keys(EVENT_TYPE_LABEL)) expect(types, k).toContain(k);
  });
  it("mapEventRow: event ใหม่ผ่านโดยคงชนิดไว้ (หน้าจอแปลด้วย EVENT_TYPE_LABEL) · channel ที่รู้จักมีป้าย", () => {
    for (const t of ["plan_change", "surplus_set", "profile_set"]) expect(mapEventRow({ id: "e", event_type: t, channel: "job_page", payload: {} }, {}, {})).toMatchObject({ type: t });
    expect(CHANNEL_LABEL.job_page).toBeTruthy();
  });
});
