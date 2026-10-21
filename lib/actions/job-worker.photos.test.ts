// lib/actions/job-worker.ts (intakeUploadPhoto · intakeRemovePhoto · intakeListPhotos · intakeMyJobs) + lib/jobs/shop-photo-server.ts — W2 (0189): ผู้จัดการแนบรูปจากหน้างานผ่าน QR ร้าน + PIN
// storage (bucket job-photos) ทดสอบใน SQL ไม่ได้ → ครอบที่นี่ด้วย mock: "ไม่มี object เกิดใน bucket เมื่อ DB ปฏิเสธ" · ตัด Exif ที่ server · ล้มกลางทาง = ลบ object · path ไม่ออกถึง client
// เคสห้ามผ่าน (ระบุด่าน): begin ล้ม (idem ช่างอื่น/ใบล็อก/ยกเลิก/token revoked/session หมด/ถอนสิทธิ์/rate limit) → ด่าน = RPC begin ก่อน storage · ไฟล์ไม่ใช่ JPEG/ใหญ่/พิกเซลเกิน/Exif GPS ยิงตรง → ด่าน = server ตัด+ตรวจซ้ำ
// ต้องไม่พัง: อัปโหลดปกติ (idem key / job id) · ลบของตัวเอง · ลบซ้ำ · list · ใบที่ฉันเปิด
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasCameraMetadata } from "@/lib/images/server";
import { MAX_BYTES, MD_MAX_PX, SM_MAX_PX, JOB_PHOTO_DIM_SLACK_PX } from "@/lib/images/constants";
import { JOB_PHOTO_FILE_CODE, JOB_PHOTO_FILE_ERROR_TH } from "@/lib/jobs/photos";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const PH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PH2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEWPH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "idem0123456789abcdef";
const HOST = "abc.supabase.co";
const md = (id: string) => `${SHOP}/${JOB}/${id}_md.jpg`;
const sm = (id: string) => `${SHOP}/${JOB}/${id}_sm.jpg`;

const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const signMock = vi.fn();
let hasSession = true;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (hasSession ? { value: SESSION } : undefined), set: () => {} }),
  headers: async () => ({ get: (n: string) => (n === "user-agent" ? "ua-test" : null) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock }),
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => uploadMock(bucket, ...a),
        remove: (...a: unknown[]) => removeMock(bucket, ...a),
        createSignedUrls: (...a: unknown[]) => signMock(bucket, ...a),
      }),
    },
  }),
}));

import { intakeListPhotos, intakeMyJobs, intakeRemovePhoto, intakeUploadPhoto } from "./job-worker";

// ---- JPEG สังเคราะห์ (โครง marker ถูกต้อง) ----
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]): number[] => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const JFIF = seg(0xe0, [...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const sof = (w: number, h: number) => [0xff, 0xc0, 0x00, 0x0b, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x01, 0x01, 0x11, 0x00];
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78];
const jpegWith = (before: number[][] = [], w = 1200, h = 800, tail: number[] = []): Uint8Array => new Uint8Array([0xff, 0xd8, ...before.flat(), ...JFIF, ...sof(w, h), ...SOS, ...SCAN, 0xff, 0xd9, ...tail]);
const cleanJpeg = (w = 1200, h = 800): Uint8Array => jpegWith([], w, h);
const EXIF_GPS = seg(0xe1, [...ascii("Exif"), 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x1a, 0, 0, 0, ...ascii("GPS13.7563N100.5018E")]);
const XMP = seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<exif:GPSLatitude>13.7563</exif:GPSLatitude>")]);
const file = (bytes: Uint8Array | string, name = "photo.jpg", type = "image/jpeg") => new File([bytes as BlobPart], name, { type });

function form(o: { idemKey?: string | null; jobId?: string | null; md?: unknown; sm?: unknown; isPrimary?: string } = {}): FormData {
  const fd = new FormData();
  if (o.idemKey !== null) fd.set("idemKey", o.idemKey ?? IDEM);
  if (o.jobId) fd.set("jobId", o.jobId);
  if (o.md !== null) fd.set("md", (o.md ?? file(cleanJpeg())) as Blob | string);
  if (o.sm !== null) fd.set("sm", (o.sm ?? file(cleanJpeg(480, 320))) as Blob | string);
  if (o.isPrimary !== undefined) fd.set("isPrimary", o.isPrimary);
  return fd;
}

const fn = (name: string) => rpcMock.mock.calls.filter((c) => c[0] === name);
const fail = (code: string, message = "ข้อความของ DB") => ({ data: { ok: false, code, message }, error: null });
let beginResult: unknown;
let addResult: unknown;
let listResult: unknown;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  hasSession = true;
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  beginResult = { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: NEWPH, count: 0, max: 3 }, error: null };
  addResult = { data: { ok: true, photo_id: NEWPH, is_primary: true, count: 1, max: 3 }, error: null };
  listResult = { data: { ok: true, locked: false, lock_code: null, count: 1, max: 3, photos: [{ id: NEWPH, sm_path: sm(NEWPH), md_path: md(NEWPH), is_primary: true, mine: true }] }, error: null };
  uploadMock.mockResolvedValue({ data: {}, error: null });
  removeMock.mockResolvedValue({ data: [], error: null });
  signMock.mockImplementation(async (_b: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://${HOST}/storage/v1/object/sign/job-photos/${p}?token=t`, error: null })), error: null }));
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "job_worker_photo_begin") return beginResult;
    if (name === "job_worker_photo_add") return addResult;
    if (name === "job_worker_photo_list") return listResult;
    if (name === "job_worker_photo_remove") return { data: { ok: true, storage_path: md(PH), variant_sm_path: sm(PH), promoted_photo_id: PH2 }, error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("intakeUploadPhoto — อัปโหลดปกติ (ต้องไม่พัง)", () => {
  it("ผ่าน begin ก่อน → upload md+sm → add · path ประกอบจาก uuid/ร้าน/ใบของ DB · bytes = md+sm · ผลเป็น signed URL ไม่มี path", async () => {
    const mdf = file(cleanJpeg());
    const smf = file(cleanJpeg(480, 320));
    const r = await intakeUploadPhoto(TOKEN, form({ md: mdf, sm: smf }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual(["job_worker_photo_begin", "job_worker_photo_add"]);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    const paths = uploadMock.mock.calls.map((c) => c[1]);
    expect(paths).toEqual([md(NEWPH), sm(NEWPH)]);
    expect(uploadMock.mock.calls.every((c) => c[0] === "job-photos" && (c[3] as { upsert: boolean }).upsert === false && (c[3] as { contentType: string }).contentType === "image/jpeg")).toBe(true);
    // ลำดับ: begin มาก่อน upload ทุกครั้ง
    expect(rpcMock.mock.invocationCallOrder[0]).toBeLessThan(uploadMock.mock.invocationCallOrder[0]);
    expect(uploadMock.mock.invocationCallOrder[1]).toBeLessThan(rpcMock.mock.invocationCallOrder[1]);
    const add = fn("job_worker_photo_add")[0][1] as Record<string, unknown>;
    const stored = uploadMock.mock.calls.map((c) => c[2] as Uint8Array);
    expect(add.p_photo_id).toBe(NEWPH);
    expect(add.p_storage_path).toBe(md(NEWPH));
    expect(add.p_variant_sm_path).toBe(sm(NEWPH));
    expect(add.p_bytes).toBe(stored[0].byteLength + stored[1].byteLength);
    expect(add.p_width).toBe(1200);
    expect(add.p_height).toBe(800);
    expect(add.p_idem_key).toBe(IDEM);
    expect(add.p_job_id).toBeNull();
    expect(add.p_is_primary).toBe(false);
    expect(r.photo).toEqual({ id: NEWPH, smUrl: expect.stringContaining("/sign/job-photos/"), mdUrl: expect.stringContaining("/sign/job-photos/"), isPrimary: true, mine: true });
    expect(r.count).toBe(1);
    expect(r.max).toBe(3);
    // ไม่มี path/id ของร้าน-ใบ ใน key ของผล (URL เซ็นแล้วมี path ในตัวมันเอง — ตั้งใจ: 15 นาที)
    expect(Object.keys(r).sort()).toEqual(["count", "max", "ok", "photo"]);
    expect(Object.keys(r.photo).sort()).toEqual(["id", "isPrimary", "mdUrl", "mine", "smUrl"]);
  });

  it("อ้างใบด้วย jobId (จากรายการใบของฉัน): ส่ง p_job_id + p_idem_key null ทั้ง begin และ add · isPrimary=true ส่งต่อ", async () => {
    const r = await intakeUploadPhoto(TOKEN, form({ idemKey: null, jobId: JOB, isPrimary: "true" }));
    expect(r.ok).toBe(true);
    const b = fn("job_worker_photo_begin")[0][1] as Record<string, unknown>;
    const a = fn("job_worker_photo_add")[0][1] as Record<string, unknown>;
    expect(b.p_job_id).toBe(JOB);
    expect(b.p_idem_key).toBeNull();
    expect(a.p_job_id).toBe(JOB);
    expect(a.p_idem_key).toBeNull();
    expect(a.p_is_primary).toBe(true);
  });

  it("พารามิเตอร์ที่ส่งถึง RPC มีเฉพาะที่ระบุ — ไม่มี shop id/ที่มา/ชื่อไฟล์ · token/session ส่งเป็น sha256 (64 hex)", async () => {
    await intakeUploadPhoto(TOKEN, form());
    const keys = (c: unknown[]) => Object.keys(c[1] as Record<string, unknown>).sort();
    expect(keys(fn("job_worker_photo_begin")[0])).toEqual(["p_idem_key", "p_ip_hash", "p_job_id", "p_session_hash", "p_token_hash"]);
    expect(keys(fn("job_worker_photo_add")[0])).toEqual(["p_bytes", "p_height", "p_idem_key", "p_ip_hash", "p_is_primary", "p_job_id", "p_photo_id", "p_session_hash", "p_storage_path", "p_token_hash", "p_user_agent", "p_variant_sm_path", "p_width"]);
    const b = fn("job_worker_photo_begin")[0][1] as Record<string, unknown>;
    expect(b.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.p_session_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.p_token_hash).not.toBe(TOKEN);
  });
});

describe("intakeUploadPhoto — begin ปฏิเสธ = ไม่มี object เกิดใน bucket (ด่าน = RPC begin ก่อน storage)", () => {
  const cases: [string, string][] = [
    ["order_not_found", "idem key ของช่างคนอื่น/ไม่มีจริง/ใบออฟฟิศ"],
    ["job_locked", "ใบที่ช่างรับงานแล้ว"],
    ["job_cancelled", "ใบ cancelled"],
    ["invalid_token", "token ร้าน revoked"],
    ["session_required", "session หมดอายุ"],
    ["not_allowed", "can_open_job=false (ถอนสิทธิ์หลังเปิดใบ)"],
    ["rate_limited", "rate limit เกิน"],
    ["photo_cap_shopfloor", "รูปที่ 4 จากหน้างาน"],
    ["photo_cap_ref", "reference รวมที่ 6"],
  ];
  for (const [code, why] of cases) {
    it(`${why} → ${code}: ไม่ upload · ไม่ remove · ไม่ add · ข้อความไทย`, async () => {
      beginResult = fail(code);
      const r = await intakeUploadPhoto(TOKEN, form());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe(code);
      expect(r.error).toMatch(/[ก-๙]/);
      expect(r.error).not.toContain("ข้อความของ DB");
      expect(uploadMock).not.toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
      expect(fn("job_worker_photo_add")).toHaveLength(0);
    });
  }

  it("begin คืน id ผิดรูป (ไม่ใช่ uuid พิมพ์เล็ก) → ไม่ upload", async () => {
    beginResult = { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: "NOT-A-UUID" }, error: null };
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    beginResult = { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: NEWPH.toUpperCase() }, error: null };
    expect((await intakeUploadPhoto(TOKEN, form())).ok).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("begin ผลที่มี key เงิน/ต้นทุน → ทิ้ง ไม่ upload", async () => {
    beginResult = { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: NEWPH, unit_cost_thb: 5 }, error: null };
    expect((await intakeUploadPhoto(TOKEN, form())).ok).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("RPC ระบบล้ม (throw) → ข้อความกลาง ไม่ upload · ไม่ log ก้อน error (ไม่มี hash/ข้อความดิบ)", async () => {
    rpcMock.mockRejectedValueOnce(Object.assign(new Error("boom host abc.supabase.co " + sha64()), { code: "XX000" }));
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("abc.supabase.co");
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/[0-9a-f]{64}/);
  });
});
const sha64 = () => "a".repeat(64);

describe("intakeUploadPhoto — ก่อนถึง DB (ไม่มี session/ไฟล์/ref ผิด)", () => {
  it("ไม่มี cookie session → session_required · ไม่เรียก RPC ใดเลย · ไม่ upload", async () => {
    hasSession = false;
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("session_required");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("token ผิดรูป → invalid_token · ไม่เรียก RPC", async () => {
    const r = await intakeUploadPhoto("short", form());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_token");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ref ผิด: ไม่ส่งสักทาง · ส่งทั้งสอง · idem สั้น · jobId ไม่ใช่ uuid → ปฏิเสธก่อน RPC", async () => {
    for (const fd of [form({ idemKey: null }), form({ jobId: JOB }), form({ idemKey: "short" }), form({ idemKey: null, jobId: "not-a-uuid" })]) {
      const r = await intakeUploadPhoto(TOKEN, fd);
      expect(r.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(await intakeUploadPhoto(TOKEN, "x" as unknown as FormData)).toMatchObject({ ok: false });
  });

  it("ไฟล์: ขาด md/sm · ว่าง · เกิน 1 MB ต่อไฟล์ → ปฏิเสธก่อน RPC (ไม่แตะ DB/bucket)", async () => {
    const r1 = await intakeUploadPhoto(TOKEN, form({ md: null }));
    expect(r1).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.missing });
    const r1b = await intakeUploadPhoto(TOKEN, form({ sm: "ไม่ใช่ไฟล์" }));
    expect(r1b).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.missing });
    const r2 = await intakeUploadPhoto(TOKEN, form({ md: file(new Uint8Array(0)) }));
    expect(r2).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.empty, error: JOB_PHOTO_FILE_ERROR_TH.empty });
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const r3 = await intakeUploadPhoto(TOKEN, form({ md: file(big) }));
    expect(r3).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.tooLarge });
    const r4 = await intakeUploadPhoto(TOKEN, form({ sm: file(big) }));
    expect(r4).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.tooLarge });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("intakeUploadPhoto — ไฟล์ที่ยิงตรง action (ข้าม client) ต้องไม่เข้า bucket", () => {
  it("ไม่ใช่ JPEG จริง (svg/html/png/pdf ปลอม content-type) → notJpeg · ผ่าน begin แล้วแต่ไม่ upload/ไม่ add", async () => {
    for (const body of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "<html><body>x</body></html>", "%PDF-1.7 ...", String.fromCharCode(0x89) + "PNG\r\n"]) {
      const r = await intakeUploadPhoto(TOKEN, form({ md: file(body, "x.jpg", "image/jpeg") }));
      expect(r).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.notJpeg });
    }
    expect(uploadMock).not.toHaveBeenCalled();
    expect(fn("job_worker_photo_add")).toHaveLength(0);
  });

  it("Exif GPS / XMP ยิงตรง → object ที่เก็บไม่มี APP1 (ตัดที่ marker) · เก็บเฉพาะ bytes ที่ตัดแล้ว · ต้นฉบับมี Exif จริง", async () => {
    const dirty = jpegWith([EXIF_GPS, XMP, seg(0xfe, ascii("comment ชื่อลูกค้า")), seg(0xed, ascii("Photoshop 3.0"))], 1200, 800, [...EXIF_GPS]);
    const dirtySm = jpegWith([EXIF_GPS], 480, 320, [...XMP]);
    expect(hasCameraMetadata(dirty)).toBe(true);
    expect(hasCameraMetadata(dirtySm)).toBe(true);
    const r = await intakeUploadPhoto(TOKEN, form({ md: file(dirty), sm: file(dirtySm) }));
    expect(r.ok).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    for (const c of uploadMock.mock.calls) {
      const bytes = c[2] as Uint8Array;
      expect(hasCameraMetadata(bytes)).toBe(false);
      expect(Buffer.from(bytes).includes(Buffer.from("GPS13.7563N"))).toBe(false);
      expect(Buffer.from(bytes).includes(Buffer.from("exif:GPS"))).toBe(false);
      expect(Buffer.from(bytes).includes(Buffer.from("Photoshop"))).toBe(false);
    }
    const add = fn("job_worker_photo_add")[0][1] as Record<string, unknown>;
    expect(add.p_bytes).toBe(uploadMock.mock.calls.reduce((s, c) => s + (c[2] as Uint8Array).byteLength, 0));
  });

  it("โครงสร้างพัง/polyglot (ขยะระหว่าง segment · ไม่มี EOI) → broken · ไม่ upload", async () => {
    const valid = cleanJpeg();
    const junk = new Uint8Array([0xff, 0xd8, ...JFIF, 0x00, 0x00, 0x41, ...sof(1200, 800), ...SOS, ...SCAN, 0xff, 0xd9]); // ขยะระหว่าง segment (ไม่ resync)
    const noEoi = valid.slice(0, valid.length - 2);
    for (const bad of [junk, noEoi]) {
      const r = await intakeUploadPhoto(TOKEN, form({ md: file(bad) }));
      expect(r).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.broken });
    }
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("พิกเซลเกินเพดานของ md/sm → tooLargeDim · ขอบ (เพดาน+เผื่อ) ผ่าน (ต้องไม่พัง)", async () => {
    const r1 = await intakeUploadPhoto(TOKEN, form({ md: file(cleanJpeg(MD_MAX_PX + JOB_PHOTO_DIM_SLACK_PX + 1, 800)) }));
    expect(r1).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.tooLargeDim });
    const r2 = await intakeUploadPhoto(TOKEN, form({ sm: file(cleanJpeg(300, SM_MAX_PX + JOB_PHOTO_DIM_SLACK_PX + 1)) }));
    expect(r2).toMatchObject({ ok: false, code: JOB_PHOTO_FILE_CODE.tooLargeDim });
    expect(uploadMock).not.toHaveBeenCalled();
    const ok = await intakeUploadPhoto(TOKEN, form({ md: file(cleanJpeg(MD_MAX_PX + JOB_PHOTO_DIM_SLACK_PX, 800)), sm: file(cleanJpeg(SM_MAX_PX + JOB_PHOTO_DIM_SLACK_PX, 300)) }));
    expect(ok.ok).toBe(true);
  });
});

describe("intakeUploadPhoto — ล้มกลางทาง = ลบ object ที่เพิ่งอัป", () => {
  it("add ถูกปฏิเสธ (สถานะเปลี่ยนระหว่างอัปโหลด: ช่างรับงาน/เพดาน/rate limit) → ลบ md+sm · ข้อความไทย", async () => {
    for (const code of ["job_locked", "photo_cap_shopfloor", "rate_limited", "photo_path_dup", "job_cancelled", "not_allowed", "invalid_token"]) {
      removeMock.mockClear();
      uploadMock.mockClear();
      addResult = fail(code);
      const r = await intakeUploadPhoto(TOKEN, form());
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe(code);
      expect(uploadMock).toHaveBeenCalledTimes(2);
      expect(removeMock).toHaveBeenCalledTimes(1);
      expect(removeMock.mock.calls[0][1]).toEqual([md(NEWPH), sm(NEWPH)]);
    }
  });

  it("อัปโหลด sm ล้ม → ลบ md (และ sm) · ไม่เรียก add · อัปโหลด md ล้ม → ไม่เรียก add (ไม่มีอะไรให้ลบ)", async () => {
    uploadMock.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom", statusCode: "500" } });
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][1]).toEqual([md(NEWPH), sm(NEWPH)]);
    expect(fn("job_worker_photo_add")).toHaveLength(0);
    removeMock.mockClear();
    uploadMock.mockReset();
    uploadMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const r2 = await intakeUploadPhoto(TOKEN, form());
    expect(r2.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
    expect(fn("job_worker_photo_add")).toHaveLength(0);
  });

  it("add ผลกำกวม (RPC throw): ถาม list → แถวเกิดแล้ว = สำเร็จ ไม่ลบ object", async () => {
    addResult = undefined;
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "job_worker_photo_begin") return beginResult;
      if (name === "job_worker_photo_add") throw Object.assign(new Error("net"), { code: "ECONN" });
      if (name === "job_worker_photo_list") return listResult;
      return { data: { ok: true }, error: null };
    });
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("add ผลกำกวม: list ไม่พบรูปนี้ = ลบ object · list ล้มด้วย = เก็บไว้ (ไฟล์ค้างดีกว่ารูปพัง)", async () => {
    const mk = (list: () => unknown) =>
      rpcMock.mockImplementation(async (name: string) => {
        if (name === "job_worker_photo_begin") return beginResult;
        if (name === "job_worker_photo_add") throw Object.assign(new Error("net"), { code: "ECONN" });
        if (name === "job_worker_photo_list") return list();
        return { data: { ok: true }, error: null };
      });
    mk(() => ({ data: { ok: true, locked: false, count: 0, photos: [] }, error: null }));
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    expect(removeMock).toHaveBeenCalledTimes(1);
    removeMock.mockClear();
    mk(() => {
      throw new Error("down");
    });
    const r2 = await intakeUploadPhoto(TOKEN, form());
    expect(r2.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("add ตอบ photo_id ไม่ตรง (ผิดสัญญา) → ไม่ลบ object (แถวอาจเกิดแล้ว) · ข้อความกลาง", async () => {
    addResult = { data: { ok: true, photo_id: PH2, is_primary: true, count: 1 }, error: null };
    const r = await intakeUploadPhoto(TOKEN, form());
    expect(r.ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe("intakeRemovePhoto", () => {
  it("ลบของตัวเอง: RPC → ลบ object md+sm (path จาก DB เท่านั้น) · ผลไม่มี path · promoted id", async () => {
    const r = await intakeRemovePhoto(TOKEN, PH);
    expect(r).toEqual({ ok: true, promotedPhotoId: PH2, already: false });
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][1]).toEqual([md(PH), sm(PH)]);
    const p = fn("job_worker_photo_remove")[0][1] as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["p_ip_hash", "p_photo_id", "p_session_hash", "p_token_hash", "p_user_agent"]);
  });

  it("รูปของคนอื่น/รูปออฟฟิศ/ไม่มีจริง → photo_not_found · ไม่ลบ object · ใบล็อก/ถอนสิทธิ์/rate limit → ปฏิเสธ ไม่ลบ", async () => {
    for (const code of ["photo_not_found", "job_locked", "job_cancelled", "not_allowed", "rate_limited", "invalid_token", "session_required"]) {
      removeMock.mockClear();
      rpcMock.mockResolvedValueOnce(fail(code));
      const r = await intakeRemovePhoto(TOKEN, PH);
      expect(r).toMatchObject({ ok: false, code });
      expect(removeMock).not.toHaveBeenCalled();
    }
  });

  it("ลบซ้ำ (already_deleted) = สำเร็จ · ไม่ลบ object ซ้ำ · uuid ผิดรูป = ไม่ถึง RPC", async () => {
    rpcMock.mockResolvedValueOnce(fail("already_deleted"));
    expect(await intakeRemovePhoto(TOKEN, PH)).toEqual({ ok: true, promotedPhotoId: null, already: true });
    expect(removeMock).not.toHaveBeenCalled();
    rpcMock.mockClear();
    expect(await intakeRemovePhoto(TOKEN, "nope")).toMatchObject({ ok: false });
    expect(await intakeRemovePhoto(TOKEN, null as unknown as string)).toMatchObject({ ok: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ลบ object ล้ม → ยังสำเร็จ (แถวลบแล้ว · ไฟล์ค้าง = หนี้ sweep) · path ที่ DB ส่งมาผิดรูป = ไม่ส่งไปลบ", async () => {
    removeMock.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect((await intakeRemovePhoto(TOKEN, PH)).ok).toBe(true);
    removeMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: { ok: true, storage_path: "../../etc/passwd", variant_sm_path: `${SHOP}/${JOB}/x.png`, promoted_photo_id: null }, error: null });
    expect((await intakeRemovePhoto(TOKEN, PH)).ok).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe("intakeListPhotos / intakeMyJobs", () => {
  it("list: เซ็น URL เฉพาะ path ที่ DB ส่ง (รูปร่างถูก) · ผลไม่มี path · path ผิดรูปถูกทิ้ง · ref ผิด = ไม่ถึง RPC", async () => {
    listResult = { data: { ok: true, locked: true, lock_code: "job_locked", count: 2, photos: [
      { id: PH, sm_path: sm(PH), md_path: md(PH), is_primary: true, mine: true },
      { id: PH2, sm_path: "../x/y.jpg", md_path: "https://evil/x.jpg", is_primary: false, mine: false },
    ] }, error: null };
    const r = await intakeListPhotos(TOKEN, { idemKey: IDEM });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.locked).toBe(true);
    expect(r.lockCode).toBe("job_locked");
    expect(r.max).toBe(3);
    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock.mock.calls[0][1]).toEqual([md(PH), sm(PH)]);
    expect(r.photos[0]).toEqual({ id: PH, smUrl: expect.stringContaining("job-photos"), mdUrl: expect.stringContaining("job-photos"), isPrimary: true, mine: true });
    expect(r.photos[1]).toEqual({ id: PH2, smUrl: null, mdUrl: null, isPrimary: false, mine: false });
    expect(JSON.stringify(r)).not.toContain("evil");
    rpcMock.mockClear();
    expect(await intakeListPhotos(TOKEN, {})).toMatchObject({ ok: false });
    expect(await intakeListPhotos(TOKEN, { idemKey: IDEM, jobId: JOB })).toMatchObject({ ok: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  const row = (o: Record<string, unknown> = {}) => ({ job_id: JOB, order_no: "PO-2610-001", job_no: "JB-0001", design_label: "แหวนลาย A", metal: "silver", qty: 3, created_at: "2026-10-21T02:00:00Z", status: "open", photos_count: 2, my_photos_count: 1, editable: true, ...o });

  it("ใบที่ฉันเปิด: allowlist ทีละ field · แถวผิดรูปถูกข้าม · editable=false ส่งต่อ · open_allowed=false = รายการว่าง", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true, open_allowed: true, max_photos: 3, jobs: [row(), row({ job_id: PH2, editable: false, metal: "platinum" }), row({ job_id: "bad" }), "x", row({ job_no: "" })] }, error: null });
    const r = await intakeMyJobs(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toEqual({ jobId: JOB, orderNo: "PO-2610-001", jobNo: "JB-0001", designLabel: "แหวนลาย A", metal: "silver", qty: 3, createdAt: "2026-10-21T02:00:00Z", status: "open", photosCount: 2, myPhotosCount: 1, editable: true });
    expect(r.jobs[1]).toMatchObject({ jobId: PH2, editable: false, metal: null });
    rpcMock.mockResolvedValueOnce({ data: { ok: true, open_allowed: false, jobs: [] }, error: null });
    expect(await intakeMyJobs(TOKEN)).toMatchObject({ ok: true, openAllowed: false, jobs: [] });
  });

  it("ใบที่ฉันเปิด: ผลดิบมี key เงิน/ต้นทุน → ทิ้งทั้งก้อน · token ร้านถูกเพิกถอน/ไม่มี session → ล้มโดยไม่ถึง RPC (ไม่มี session)", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true, open_allowed: true, jobs: [{ ...row(), unit_cost_thb: 9 }] }, error: null });
    expect((await intakeMyJobs(TOKEN)).ok).toBe(false);
    rpcMock.mockResolvedValueOnce(fail("invalid_token"));
    expect(await intakeMyJobs(TOKEN)).toMatchObject({ ok: false, code: "invalid_token" });
    hasSession = false;
    rpcMock.mockClear();
    expect(await intakeMyJobs(TOKEN)).toMatchObject({ ok: false, code: "session_required" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ผลทุกแบบของทางแนบรูปไม่มีคำ/key เงิน (ตรวจ key ทุกระดับ)", async () => {
    const r = await intakeUploadPhoto(TOKEN, form());
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
    };
    walk(r);
    expect(keys.some((k) => /price|cost|thb|margin|baht|target_piece|customer|token/i.test(k))).toBe(false);
  });
});
