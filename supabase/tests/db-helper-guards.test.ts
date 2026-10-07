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

// ---- QA รอบ 2 (R2-D2 · 7 ต.ค. 69) — เคสที่ "คิดว่าจะหลุด" เพิ่ม · ทุกเคสไม่ต่อ DB จริง ----
describe("hasDbEnv — ค่าเพี้ยน", () => {
  it("URL/key เป็นช่องว่างล้วน → false (ไม่ใช่ truthy)", () => {
    process.env.SUPABASE_URL = "   "; process.env.SUPABASE_SERVICE_ROLE_KEY = "\t"; process.env.TEST_DB_ADMIN_URL = "postgresql://u:p@127.0.0.1:5432/x";
    expect(hasDbEnv()).toBe(false);
  });
  it("มี URL+key แต่ TEST_DB_ADMIN_URL เป็นช่องว่างล้วน → false", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; process.env.TEST_DB_ADMIN_URL = "  ";
    expect(hasDbEnv()).toBe(false);
  });
  it("มีแต่ TEST_DB_ADMIN_URL ไม่มี URL/key → false", () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://u:p@127.0.0.1:5432/x";
    expect(hasDbEnv()).toBe(false);
  });
});

describe("requireAdminUrl — ALLOW_SHARED_DB_TEARDOWN ต้องเป็น '1' เป๊ะ", () => {
  for (const v of ["true", "yes", "1 ", " 1", "01", "11", ""]) {
    it(`ALLOW=${JSON.stringify(v)} + host ไกล → ยัง throw ไม่แตะ DB`, async () => {
      process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@db.example.supabase.co:5432/postgres"; process.env.ALLOW_SHARED_DB_TEARDOWN = v;
      await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
      expect(touched.n).toBe(0);
    });
  }
  it("host หลอกด้วย userinfo (127.0.0.1@evil.com) → host จริงคือ evil.com ไม่ผ่าน", async () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://127.0.0.1:pw@evil.com:5432/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
    expect(touched.n).toBe(0);
  });
  it("host localhost. (จุดท้าย) / 0.0.0.0 / ::1 ไม่ใส่วงเล็บ → ปฏิเสธแบบอนุรักษ์ ไม่ผ่านเงียบ", async () => {
    for (const h of ["localhost.", "0.0.0.0"]) {
      process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@${h}:5432/postgres`;
      await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่เครื่องตัวเอง/);
    }
    expect(touched.n).toBe(0);
  });
  it("ข้อความ error ของทุกทางปฏิเสธไม่มีรหัสผ่านใน URL", async () => {
    const urls = ["postgresql://postgres:TOPSECRET@db.example.supabase.co:5432/postgres", "postgresql://postgres:TOPSECRET@evil.com/postgres", "::::TOPSECRET::::"];
    for (const u of urls) {
      process.env.TEST_DB_ADMIN_URL = u;
      await seedTenant(fakeDb).then(() => { throw new Error("should throw"); }, (e: Error) => { expect(e.message).not.toContain("TOPSECRET"); });
    }
    expect(touched.n).toBe(0);
  });
});

// ช่องที่ยังไม่มีด่าน (finding QA รอบ 2): requireAdminUrl ตรวจแค่ host ของ TEST_DB_ADMIN_URL — ไม่ได้เทียบกับ SUPABASE_URL ที่ seedTenant ใช้สร้างร้านจริง
// SUPABASE_URL ชี้ DB จริง + TEST_DB_ADMIN_URL ชี้ localhost ⇒ ผ่านด่าน → สร้างร้านทดสอบบน DB จริง แล้ว cleanupTenant ลบที่ localhost (ไม่เจอ) ⇒ ร้านค้างใน DB จริง
// it.fails = ผ่านตราบที่ช่องนี้ยังไม่ถูกปิด · เมื่อปิดแล้ว test นี้จะ "ล้ม" ให้เปลี่ยนเป็น it ปกติ
describe("KNOWN GAP — SUPABASE_URL กับ TEST_DB_ADMIN_URL คนละ DB", () => {
  it.fails("SUPABASE_URL = ไม่ใช่เครื่องตัวเอง + TEST_DB_ADMIN_URL = localhost (ไม่ตั้ง ALLOW) ควรถูกปฏิเสธก่อนแตะ DB", async () => {
    process.env.SUPABASE_URL = "https://prod-project.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/SUPABASE_URL|ไม่ใช่เครื่องตัวเอง/);
    expect(touched.n).toBe(0);
  });
});
