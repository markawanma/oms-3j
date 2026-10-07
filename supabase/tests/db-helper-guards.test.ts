import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasDbEnv, seedTenant } from "./helpers/db";

// guard ของ supabase/tests/helpers/db.ts (SEC-M5): suite ข้าม (skip) เมื่อไม่มี TEST_DB_ADMIN_URL · seedTenant ปฏิเสธ host ที่ไม่ใช่ localhost เว้นแต่ ALLOW_SHARED_DB_TEARDOWN=1 — ทุกเคสไม่ต่อ DB จริง (db เป็น Proxy ที่ throw ถ้าถูกแตะ)
// ส่วน guard ฝั่ง SQL ของ cleanupTenant (ชื่อ QA Test Shop + อายุ ≤ 1 ชม. + for update) ต้องมี DB — ดูการพิสูจน์ใน scripts/verify หรือรายงานส่งมอบ
const touched = { n: 0 };
const fakeDb = new Proxy({}, { get() { touched.n += 1; throw new Error("DB TOUCHED"); } }) as unknown as SupabaseClient;
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TEST_DB_ADMIN_URL", "ALLOW_SHARED_DB_TEARDOWN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } touched.n = 0; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("hasDbEnv", () => {
  it("false เมื่อไม่มี env เลย", () => { expect(hasDbEnv()).toBe(false); });
  it("false (skip ไม่ใช่ throw) เมื่อมี URL+key แต่ไม่มี TEST_DB_ADMIN_URL", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    expect(hasDbEnv()).toBe(false);
  });
  it("true เมื่อครบสามตัว", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.TEST_DB_ADMIN_URL = "postgresql://u:p@127.0.0.1:5432/x";
    expect(hasDbEnv()).toBe(true);
  });
});

describe("seedTenant → requireAdminUrl guard (ก่อนแตะ DB)", () => {
  it("host ไม่ใช่ localhost + ไม่มี ALLOW → throw ข้อความไทย ไม่แตะ DB ไม่พิมพ์รหัสผ่าน", async () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:SECRETPW@db.example.supabase.co:5432/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
    await seedTenant(fakeDb).catch((e: Error) => { expect(e.message).not.toContain("SECRETPW"); });
    expect(touched.n).toBe(0);
  });
  it("host ไม่ใช่ localhost + ALLOW=0 → ยัง throw", async () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@db.example.supabase.co:5432/postgres"; process.env.ALLOW_SHARED_DB_TEARDOWN = "0";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
    expect(touched.n).toBe(0);
  });
  it("host ไม่ใช่ localhost + ALLOW=1 → ผ่าน guard (ไปแตะ DB = proxy throw)", async () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@db.example.supabase.co:5432/postgres"; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
    expect(touched.n).toBe(1);
  });
  it("localhost / 127.0.0.1 / [::1] ผ่าน guard โดยไม่ต้อง ALLOW", async () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
      process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@${h}:54322/postgres`; touched.n = 0;
      await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
      expect(touched.n).toBe(1);
    }
  });
  it("URL ที่อ่านไม่ได้ → throw ไม่แตะ DB ไม่พิมพ์ค่า", async () => {
    process.env.TEST_DB_ADMIN_URL = "not a url SECRETPW";
    await seedTenant(fakeDb).then(() => { throw new Error("should throw"); }, (e: Error) => { expect(e.message).toMatch(/ไม่ใช่ URL/); expect(e.message).not.toContain("SECRETPW"); });
    expect(touched.n).toBe(0);
  });
  it("host หลอก (localhost.evil.com / 127.0.0.1.evil.com) ไม่ผ่าน", async () => {
    for (const h of ["localhost.evil.com", "127.0.0.1.evil.com", "evil.com"]) {
      process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@${h}:5432/postgres`;
      await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
    }
    expect(touched.n).toBe(0);
  });
});
