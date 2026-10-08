import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasDbEnv, seedTenant } from "./helpers/db";

// guard ของ supabase/tests/helpers/db.ts (SEC-M5): suite ข้าม (skip) เมื่อไม่มี TEST_DB_ADMIN_URL · seedTenant ปฏิเสธ host ที่ไม่ใช่ localhost เว้นแต่ ALLOW_SHARED_DB_TEARDOWN=1 — ทุกเคสไม่ต่อ DB จริง (db เป็น Proxy ที่ throw ถ้าถูกแตะ)
// R2-3: requireAdminUrl เทียบ project ref ของ TEST_DB_ADMIN_URL กับ SUPABASE_URL (assertSameProject) — เคส "ผ่าน guard" ทุกเคสต้องตั้ง SUPABASE_URL ที่ตรงกันด้วย
// ส่วน guard ฝั่ง SQL ของ cleanupTenant (ชื่อ QA Test Shop + อายุ ≤ 1 ชม. + for update) ต้องมี DB — ดูการพิสูจน์ใน scripts/verify หรือรายงานส่งมอบ
const touched = { n: 0 };
const fakeDb = new Proxy({}, { get() { touched.n += 1; throw new Error("DB TOUCHED"); } }) as unknown as SupabaseClient;
const KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TEST_DB_ADMIN_URL", "ALLOW_SHARED_DB_TEARDOWN"] as const;
const saved: Record<string, string | undefined> = {};
const REF = "abcdefghijklmnopqrst";   // project ref ปลอมรูปเดียวกับของจริง (20 ตัว a-z)
const OTHER_REF = "zyxwvutsrqponmlkjihg";

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
  it("host ไม่ใช่ localhost + ALLOW=1 + project เดียวกับ SUPABASE_URL → ผ่าน guard (ไปแตะ DB = proxy throw)", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`;
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
    expect(touched.n).toBe(1);
  });
  it("localhost / 127.0.0.1 / [::1] ผ่าน guard โดยไม่ต้อง ALLOW", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
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

// R2-3 (ปิดช่องที่ QA รอบ 2 เจอ — เดิมเป็น it.fails "KNOWN GAP"): SUPABASE_URL กับ TEST_DB_ADMIN_URL คนละ DB ⇒ ร้านทดสอบถูกสร้างบน DB หนึ่งแต่ลบอีก DB ⇒ ร้านค้างใน DB จริง
// assertSameProject เทียบ project ref · ไม่ตรง/ระบุไม่ได้/ไม่มี SUPABASE_URL = throw ก่อนแตะ DB · ALLOW_SHARED_DB_TEARDOWN ไม่ข้ามด่านนี้
describe("SUPABASE_URL กับ TEST_DB_ADMIN_URL ต้องเป็น DB เดียวกัน (R2-3)", () => {
  it("SUPABASE_URL = DB จริง + TEST_DB_ADMIN_URL = localhost (ไม่ตั้ง ALLOW) → ปฏิเสธก่อนแตะ DB (เคสที่เดิมเป็น KNOWN GAP)", async () => {
    process.env.SUPABASE_URL = "https://prod-project.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/SUPABASE_URL/);
    expect(touched.n).toBe(0);
  });
  it("SUPABASE_URL = project ref จริง + ADMIN = localhost → ปฏิเสธ (ไม่ตั้ง ALLOW)", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่ DB เดียวกัน/);
    expect(touched.n).toBe(0);
  });
  it("SUPABASE_URL = localhost + ADMIN = DB จริง + ALLOW=1 → ยังปฏิเสธ (ALLOW ไม่ข้ามด่าน project)", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321"; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่ DB เดียวกัน/);
    expect(touched.n).toBe(0);
  });
  it("คนละ project ref (host ตรง pattern ทั้งคู่) + ALLOW=1 → ปฏิเสธ · ข้อความมี ref ไม่มีรหัสผ่าน", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:SECRETPW@db.${OTHER_REF}.supabase.co:5432/postgres`;
    await seedTenant(fakeDb).then(() => { throw new Error("should throw"); }, (e: Error) => {
      expect(e.message).toMatch(/ไม่ใช่ DB เดียวกัน/); expect(e.message).toContain(REF); expect(e.message).toContain(OTHER_REF); expect(e.message).not.toContain("SECRETPW");
    });
    expect(touched.n).toBe(0);
  });
  it("ไม่มี SUPABASE_URL (เทียบไม่ได้) + host ผ่าน → ปฏิเสธ ไม่เดาว่าเป็น DB เดียวกัน", async () => {
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่พบ SUPABASE_URL/);
    expect(touched.n).toBe(0);
  });
  it("SUPABASE_URL เป็นโดเมนอื่น (ระบุ project ไม่ได้) + ADMIN ตรง pattern → ปฏิเสธแบบอนุรักษ์", async () => {
    process.env.SUPABASE_URL = "https://api.example.com"; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ระบุไม่ได้/);
    expect(touched.n).toBe(0);
  });
  it("SUPABASE_URL อ่านไม่ได้เป็น URL → ปฏิเสธ ไม่พิมพ์ค่า", async () => {
    process.env.SUPABASE_URL = "not a url SECRETURL"; process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await seedTenant(fakeDb).then(() => { throw new Error("should throw"); }, (e: Error) => { expect(e.message).toMatch(/ระบุไม่ได้/); expect(e.message).not.toContain("SECRETURL"); });
    expect(touched.n).toBe(0);
  });
  it("ต้องไม่พัง: ทั้งคู่ localhost (คนละพอร์ต) ผ่าน · ไม่ต้อง ALLOW", async () => {
    process.env.SUPABASE_URL = "http://localhost:54321"; process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
    expect(touched.n).toBe(1);
  });
  it("ต้องไม่พัง: pooler (user postgres.<ref>) ตรง project กับ SUPABASE_URL + ALLOW=1 ผ่าน (ทางที่ทีมใช้จริง)", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres.${REF}:pw%40x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
    expect(touched.n).toBe(1);
  });
  it("pooler คนละ project (user postgres.<other>) → ปฏิเสธ", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres.${OTHER_REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ไม่ใช่ DB เดียวกัน/);
    expect(touched.n).toBe(0);
  });
  it("pooler แต่ username ไม่มี ref (postgres เฉยๆ) → ปฏิเสธ (ระบุ project ไม่ได้)", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ระบุไม่ได้/);
    expect(touched.n).toBe(0);
  });
  it("host หลอกให้เหมือน pooler (pooler.supabase.com.evil.com) + user มี ref → ไม่ถือว่าตรง", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres.${REF}:pw@aws-0.pooler.supabase.com.evil.com:5432/postgres`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/ระบุไม่ได้/);
    expect(touched.n).toBe(0);
  });
});

// R3-L1: query param ที่ pg-connection-string ใช้ทับ host/port/user/dbname — URL ที่ hostname ดูเป็น localhost แต่ ?host=evil.com ต่อไปที่อื่นจริง
describe("TEST_DB_ADMIN_URL ห้ามมี query param ที่ทับ host/user/port/dbname (R3-L1)", () => {
  for (const q of ["host=evil.com", "hostaddr=10.0.0.9", "user=postgres", "port=5432", "dbname=prod", "database=prod", "HOST=evil.com", "Port=1", "sslmode=require&host=evil.com"]) {
    it(`localhost + ?${q} → ปฏิเสธก่อนแตะ DB · ไม่พิมพ์รหัสผ่าน`, async () => {
      process.env.SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:SECRETPW@127.0.0.1:54322/postgres?${q}`;
      await seedTenant(fakeDb).then(() => { throw new Error("should throw"); }, (e: Error) => {
        expect(e.message).toMatch(/query param/); expect(e.message).not.toContain("SECRETPW"); expect(e.message).not.toContain("evil.com");
      });
      expect(touched.n).toBe(0);
    });
  }
  it("ALLOW=1 + project ตรง + ?host= → ยังปฏิเสธ (ALLOW ไม่ข้ามด่าน param)", async () => {
    process.env.SUPABASE_URL = `https://${REF}.supabase.co`; process.env.ALLOW_SHARED_DB_TEARDOWN = "1";
    process.env.TEST_DB_ADMIN_URL = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres?host=evil.com`;
    await expect(seedTenant(fakeDb)).rejects.toThrow(/query param/);
    expect(touched.n).toBe(0);
  });
  it("ต้องไม่พัง: param ที่ไม่ทับ host (sslmode / application_name / connect_timeout) ผ่าน", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.TEST_DB_ADMIN_URL = "postgresql://postgres:pw@127.0.0.1:54322/postgres?sslmode=disable&application_name=qa&connect_timeout=5";
    await expect(seedTenant(fakeDb)).rejects.toThrow(/DB TOUCHED/);
    expect(touched.n).toBe(1);
  });
});
