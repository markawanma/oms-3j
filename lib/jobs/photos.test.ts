// lib/jobs/photos.ts + migration 0182 — ชนิดที่ออกถึง client ไม่มี path/ที่มา/ผู้อัปโหลด · รูปร่าง signed URL · ตารางข้อความครอบทุก hint ที่ DB raise · เลขเพดาน 2 ที่ตรงกัน (คอนสแตนต์ ↔ trigger)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_PHOTOS_BUDGET_BYTES, JOB_PHOTO_TOTAL_MAX_BYTES, JOB_PHOTO_CAPTION_MAX, JOB_PHOTO_REASON_MAX, JOB_PHOTO_SIGNED_URL_TTL_S, MAX_BYTES, MAX_JOB_PHOTOS, MAX_REFERENCE_PHOTOS } from "@/lib/images/constants";
import { OFFICE_HINT_TH, officeErrorMessage } from "@/lib/jobs/messages";
import { JOB_PHOTO_COLUMNS, JOB_PHOTO_ERROR_TH, JOB_PHOTO_PATH_RE, isJobPhotoSignedUrl, jobPhotoErrorMessage, mapJobPhotoRow } from "@/lib/jobs/photos";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MD = `${SHOP}/${JOB}/${ID}_md.jpg`;
const SM = `${SHOP}/${JOB}/${ID}_sm.jpg`;
const URL_MD = "https://abc.supabase.co/storage/v1/object/sign/job-photos/x_md.jpg?token=t";
const URL_SM = "https://abc.supabase.co/storage/v1/object/sign/job-photos/x_sm.jpg?token=t";

const dbRow = (o: Record<string, unknown> = {}) => ({
  id: ID, kind: "reference", source: "office", storage_path: MD, variant_sm_path: SM, is_primary: true, sort_order: 2, caption: "ด้านข้าง", created_at: "2026-10-19T09:00:00Z",
  // field ที่ห้ามหลุด แม้ใครเผลอ select มา
  product_image_id: "22222222-2222-4222-8222-222222222222", uploaded_by: "99999999-9999-4999-8999-999999999999", bytes: 123456, ...o,
});

describe("mapJobPhotoRow — ประกอบทีละ field (ไม่ spread)", () => {
  it("ได้เฉพาะ id/smUrl/mdUrl/isPrimary/sortOrder/caption/source/createdAt · ไม่มี path/product_image_id/uploaded_by/bytes/kind", () => {
    const p = mapJobPhotoRow(dbRow(), new Map([[MD, URL_MD], [SM, URL_SM]]));
    expect(p).toEqual({ id: ID, smUrl: URL_SM, mdUrl: URL_MD, isPrimary: true, sortOrder: 2, caption: "ด้านข้าง", source: "office", createdAt: "2026-10-19T09:00:00Z" });
    expect(Object.keys(p ?? {}).sort()).toEqual(["caption", "createdAt", "id", "isPrimary", "mdUrl", "smUrl", "sortOrder", "source"]);
    const json = JSON.stringify(p);
    for (const leak of [SHOP, JOB, `${ID}_md.jpg`, `${ID}_sm.jpg`, "product_image", "uploaded", "22222222", "99999999", "123456", "storage_path"]) expect(json, leak).not.toContain(leak);
  });

  it("เซ็นไม่สำเร็จ = url เป็น null (รูปไม่หาย · UI แสดงไอคอนพัง) · แถวผิดรูป (ไม่มี id / source นอกชุด) = null", () => {
    expect(mapJobPhotoRow(dbRow(), new Map([[MD, URL_MD]]))).toMatchObject({ mdUrl: URL_MD, smUrl: null });
    expect(mapJobPhotoRow(dbRow(), new Map())).toMatchObject({ mdUrl: null, smUrl: null });
    expect(mapJobPhotoRow(dbRow({ id: null }), new Map())).toBeNull();
    expect(mapJobPhotoRow(dbRow({ source: "hacker" }), new Map())).toBeNull();
  });

  it("ค่าแปลก: caption ว่าง = null · sort_order ไม่ใช่ตัวเลข = 0 · is_primary ไม่ใช่ true จริง = false", () => {
    const p = mapJobPhotoRow(dbRow({ caption: "", sort_order: "9", is_primary: "true" }), new Map());
    expect(p).toMatchObject({ caption: null, sortOrder: 0, isPrimary: false });
  });

  it("คอลัมน์ที่ select: มี path (ไว้เซ็น URL ฝั่ง server) แต่ไม่มี product_image_id/uploaded_by/bytes/deleted_*", () => {
    expect(JOB_PHOTO_COLUMNS).toContain("storage_path");
    for (const c of ["product_image_id", "uploaded_by", "bytes", "deleted", "worker_id"]) expect(JOB_PHOTO_COLUMNS, c).not.toContain(c);
  });
});

describe("isJobPhotoSignedUrl — เฉพาะ signed URL ของ bucket job-photos", () => {
  it("ผ่าน: https + /storage/v1/object/sign/job-photos/", () => {
    expect(isJobPhotoSignedUrl(URL_MD)).toBe(true);
  });
  it("ไม่ผ่าน: path ดิบ · http · bucket อื่น (รูปแคตตาล็อก) · public URL · ภายนอก · javascript: · มีช่องว่าง · ยาวเกิน · ไม่ใช่ string", () => {
    for (const bad of [MD, "http://abc.supabase.co/storage/v1/object/sign/job-photos/x?token=t", "https://abc.supabase.co/storage/v1/object/sign/product-images/x?token=t",
      "https://abc.supabase.co/storage/v1/object/public/job-photos/x.jpg", "https://evil.example/photo.jpg", "javascript:alert(1)", "data:image/jpeg;base64,AAAA",
      "https://abc.supabase.co/storage/v1/object/sign/job-photos/a b?token=t", `https://abc.supabase.co/storage/v1/object/sign/job-photos/${"a".repeat(1600)}`, "", null, undefined, 42, {}]) {
      expect(isJobPhotoSignedUrl(bad), String(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("JOB_PHOTO_PATH_RE — รูปแบบ path ที่ DB เก็บ", () => {
  it("<shop>/<job>/<id>_md|sm.jpg ผ่าน", () => {
    expect(JOB_PHOTO_PATH_RE.test(MD)).toBe(true);
    expect(JOB_PHOTO_PATH_RE.test(SM)).toBe(true);
  });
  it("ไม่ผ่าน: พิมพ์ใหญ่ · traversal · segment เกิน · นามสกุลอื่น · ขึ้นบรรทัดใหม่ท้าย · ชื่อเดิม", () => {
    for (const bad of [MD.toUpperCase(), `${SHOP}/${JOB}/../${ID}_md.jpg`, `${SHOP}/${JOB}/x/${ID}_md.jpg`, `${SHOP}/${JOB}/${ID}_md.png`, `${MD}\n`, `${SHOP}/${JOB}/photo_md.jpg`, `${SHOP}/${ID}_md.jpg`, ""]) {
      expect(JOB_PHOTO_PATH_RE.test(bad), bad.slice(0, 50)).toBe(false);
    }
  });
});

describe("ข้อความไทยของด่านรูป", () => {
  it("ทุกข้อความเป็นไทย ไม่มี snake_case/ชื่อตาราง/SQL · ใช้ผ่าน officeErrorMessage ได้ (OFFICE_HINT_TH รวมแล้ว)", () => {
    const THAI = /[฀-๿]/;
    for (const [k, v] of Object.entries(JOB_PHOTO_ERROR_TH)) {
      expect(THAI.test(v), k).toBe(true);
      expect(v, k).not.toMatch(/[a-z]+_[a-z_]+|analytics\.|job_photo|ERROR:/i);
      expect(OFFICE_HINT_TH[k], k).toBe(v);
    }
    expect(officeErrorMessage({ code: "22023", hint: "lot_no_photo", message: "lot_no_photo: x" })).toBe(JOB_PHOTO_ERROR_TH.lot_no_photo);
  });
  it("jobPhotoErrorMessage: รู้จัก = ข้อความ · ไม่รู้จัก/ไม่ใช่ string = undefined", () => {
    expect(jobPhotoErrorMessage("photo_cap_ref")).toBe(JOB_PHOTO_ERROR_TH.photo_cap_ref);
    expect(jobPhotoErrorMessage("nope")).toBeUndefined();
    expect(jobPhotoErrorMessage(null)).toBeUndefined();
    expect(jobPhotoErrorMessage("__proto__")).toBeUndefined();
    expect(jobPhotoErrorMessage("toString")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// migration 0182 ↔ แอป: เลขที่อยู่ 2 ที่ต้องตรงกัน + hint ที่ DB raise ต้องมีข้อความไทยครบ + สิทธิ์ไม่รั่ว
// ---------------------------------------------------------------------------
const SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "0182_job_photos.sql"), "utf8").replace(/\r/g, "");
const code = SQL.replace(/^\s*--.*$/gm, ""); // ตัดคอมเมนต์บรรทัดเต็ม

describe("migration 0182 ตรงกับค่าคงที่ของแอป (เลขที่อยู่ 2 ที่)", () => {
  it("เพดาน: reference 5 · รวม 20 · budget 250 MB · ขนาดไฟล์ 1 MB · TTL 15 นาที", () => {
    expect(code).toContain(`v_ref >= ${MAX_REFERENCE_PHOTOS}`);
    expect(code).toContain(`v_all >= ${MAX_JOB_PHOTOS}`);
    expect(code).toContain(`${JOB_PHOTOS_BUDGET_BYTES / 1024 / 1024} * 1024 * 1024`);
    // L1: bytes = md+sm รวม ⇒ เพดานต่อรูป = 2 × ไฟล์ละ 1 MB · RPC เช็คเพดานเดียวกัน
    expect(JOB_PHOTO_TOTAL_MAX_BYTES).toBe(2 * MAX_BYTES);
    expect(code).toContain(`bytes between 1 and ${JOB_PHOTO_TOTAL_MAX_BYTES}`);
    expect(code).toContain(`p_bytes between 1 and ${JOB_PHOTO_TOTAL_MAX_BYTES}`);
    expect(JOB_PHOTOS_BUDGET_BYTES).toBe(330 * 1024 * 1024);
    expect(code).toContain(`file_size_limit = ${MAX_BYTES}`);
    expect(JOB_PHOTO_SIGNED_URL_TTL_S).toBe(900);
  });
  it("caption ≤ 60 · เหตุผลลบ ≤ 300 ตรงกับ CHECK", () => {
    expect(code).toContain(`length(caption) between 1 and ${JOB_PHOTO_CAPTION_MAX}`);
    expect(code).toContain(`length(delete_reason) between 1 and ${JOB_PHOTO_REASON_MAX}`);
    expect(code).toContain(`'ป้ายรูป', ${JOB_PHOTO_CAPTION_MAX}`);
    expect(code).toContain(`'เหตุผลที่ลบรูป', ${JOB_PHOTO_REASON_MAX}`);
  });
  it("ทุก hint ที่ SQL raise (hint = '...') มีข้อความไทยในตาราง (หรือมาจาก L1 เดิมที่ messages.ts มีอยู่แล้ว)", () => {
    const hints = [...code.matchAll(/hint = '([a-z_]+)'/g)].map((m) => m[1]);
    expect(hints.length).toBeGreaterThan(10);
    const missing = [...new Set(hints)].filter((h) => !(h in OFFICE_HINT_TH));
    expect(missing).toEqual([]);
    // hint ที่ SQL ใช้เป็นเงื่อนไข (v_con = '...') ไม่ใช่ข้อความ — ตรวจเฉพาะ hint ที่ raise
  });
  it("ไม่มี grant ให้ authenticated/anon/public ในไฟล์ (สคีมา analytics ปิด REST — ข้อ 18) · revoke ครบ 4 ชื่อ · ไม่มี current_date (UTC เหลื่อมวัน)", () => {
    expect(code).not.toMatch(/grant[^;]*\bto\b[^;]*\b(authenticated|anon|public)\b/i);
    expect(code).toContain("revoke all on function %s from public, anon, authenticated, service_role");
    expect(code).toContain("revoke all on analytics.job_photo from public, anon, authenticated, service_role");
    expect(code).not.toMatch(/current_date/i);
    expect(code).toContain("analytics.job_today()");
  });
  it("RPC ทุกตัว pin search_path + security definer + crm_require_owner_admin (ความเป็น LF ของไฟล์ตรวจที่ blob ด้วย git show — working tree checkout เป็น CRLF)", () => {
    for (const fn of ["job_photo_add", "job_photo_remove", "job_photo_set_primary", "job_photo_reorder", "job_photo_catalog_source"]) {
      const m = new RegExp(`create or replace function analytics\\.${fn}\\([\\s\\S]*?\\n\\$f\\$;`).exec(code);
      expect(m, fn).not.toBeNull();
      expect(m?.[0], fn).toContain("security definer");
      expect(m?.[0], fn).toContain("set search_path to 'public', 'analytics', 'extensions', 'pg_temp'");
      expect(m?.[0], fn).toContain("analytics.crm_require_owner_admin(p_shop_id)");
    }
  });
  it("bucket private ไม่มี storage policy · ไม่ INSERT/UPDATE/DELETE ตาราง job/job_stage/job_event/job_token/product_image/storage.objects ตรงๆ", () => {
    expect(code).toContain("values ('job-photos', 'job-photos', false, 1048576, array['image/jpeg'])");
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/(insert into|update|delete from)\s+(analytics\.(job|job_stage|job_event|job_token)|public\.product_image|storage\.objects)\b/i);
  });
});
