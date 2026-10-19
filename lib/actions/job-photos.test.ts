// lib/actions/job-photos.ts + lib/jobs/photos-server.ts — รูปอ้างอิงบนใบงาน (0182)
// เคสห้ามผ่าน (brief PH-A): ไม่ใช่ JPEG จริง · เกิน 1 MB · Exif/GPS ค้าง · เกินเพดาน · path จาก client/ข้ามใบ/ข้ามร้าน · URL ถาวร/public · ส่วนย่อย · log ทั้งก้อน (PII)
// ต้องไม่พัง: สร้างใบเมื่อไม่มีรูป/copy ล้ม (ดู job-office-photos.test.ts) · ใบปิดแล้วแก้รูปได้ (action ไม่เช็คสถานะ — ด่านอยู่ที่ DB และ DB อนุญาตตามมติ) · catalog รูปเดิมไม่ถูกเขียน
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER_JOB = "55555555-5555-4555-8555-555555555555";
const PH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PH2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIMG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRODUCT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HOST_SECRET = "udqmamplbymxnknkjnkz.supabase.co";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const downloadMock = vi.fn();
const signMock = vi.fn();
const revalidateMock = vi.fn();

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
const results: Record<string, { data: unknown; error: unknown; count?: number }> = {};
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => results[table] ?? { data: [], error: null, count: 0 };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }),
    storage: {
      from: (bucket: string) => ({
        upload: (...a: unknown[]) => uploadMock(bucket, ...a),
        remove: (...a: unknown[]) => removeMock(bucket, ...a),
        download: (...a: unknown[]) => downloadMock(bucket, ...a),
        createSignedUrls: (...a: unknown[]) => signMock(bucket, ...a),
      }),
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidateMock(...a) }));

import { getJobPhotos, pullJobPhotoFromCatalog, removeJobPhoto, reorderJobPhotos, setPrimaryJobPhoto, uploadJobPhoto } from "./job-photos";

// ---- ไฟล์ทดสอบ: JPEG สังเคราะห์ (โครง marker ถูกต้อง ไม่ใช่รูปที่ถอดรหัสได้) ----
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]): number[] => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const JFIF = seg(0xe0, [...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const sof = (w: number, h: number) => [0xff, 0xc0, 0x00, 0x0b, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x01, 0x01, 0x11, 0x00];
const cleanJpeg = (w = 1200, h = 800, pad = 0): Uint8Array => new Uint8Array([0xff, 0xd8, ...JFIF, ...sof(w, h), ...new Array(pad).fill(0x11), 0xff, 0xd9]);
const exifJpeg = (): Uint8Array => new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...ascii("Exif"), 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x1a, 0, 0, 0]), ...JFIF, ...sof(1200, 800), 0xff, 0xd9]);
const xmpJpeg = (): Uint8Array => new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<exif:GPSLatitude/>")]), ...JFIF, ...sof(1200, 800), 0xff, 0xd9]);
const file = (bytes: Uint8Array | string, name = "photo.jpg", type = "image/jpeg") => new File([bytes as BlobPart], name, { type });

function form(o: { jobId?: string | null; md?: unknown; sm?: unknown; caption?: string; extra?: Record<string, string> } = {}): FormData {
  const fd = new FormData();
  if (o.jobId !== null) fd.set("jobId", o.jobId ?? JOB);
  fd.set("md", (o.md ?? file(cleanJpeg())) as Blob | string);
  fd.set("sm", (o.sm ?? file(cleanJpeg(480, 320))) as Blob | string);
  if (o.caption !== undefined) fd.set("caption", o.caption);
  for (const [k, v] of Object.entries(o.extra ?? {})) fd.set(k, v);
  return fd;
}

const signedFor = (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://abc.supabase.co/storage/v1/object/sign/job-photos/${p}?token=t`, error: null })), error: null });
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  uploadMock.mockResolvedValue({ data: {}, error: null });
  removeMock.mockResolvedValue({ data: [], error: null });
  downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
  signMock.mockImplementation(async (_b: string, paths: string[]) => signedFor(paths));
  // RPC เพิ่มรูป: คืน photo_id ตรงกับ uuid ใน path ที่ server ส่งไป (เหมือน RPC จริง)
  rpcMock.mockImplementation(async (fn: string, p: Record<string, unknown>) => {
    if (fn === "job_photo_add") return { data: { ok: true, photo_id: String(p.p_storage_path).split("/")[2].replace("_md.jpg", ""), is_primary: true }, error: null };
    if (fn === "job_photo_remove") return { data: { ok: true, storage_path: `${SHOP}/${JOB}/${PH}_md.jpg`, variant_sm_path: `${SHOP}/${JOB}/${PH}_sm.jpg`, promoted_photo_id: PH2 }, error: null };
    return { data: { ok: true }, error: null };
  });
  results.job = { data: { id: JOB, parent_job_id: null }, error: null };
  results.job_photo = { data: null, error: null, count: 0 };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const rpcCalls = (fn: string) => rpcMock.mock.calls.filter((c) => c[0] === fn) as [string, Record<string, unknown>][];
const untouched = () => {
  expect(rpcMock).not.toHaveBeenCalled();
  expect(uploadMock).not.toHaveBeenCalled();
  expect(removeMock).not.toHaveBeenCalled();
  expect(downloadMock).not.toHaveBeenCalled();
  expect(signMock).not.toHaveBeenCalled();
};
const logged = () => JSON.stringify(errSpy.mock.calls);

describe("สิทธิ์ — ทุก action ปฏิเสธก่อนแตะ DB/Storage", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["getJobPhotos", () => getJobPhotos(JOB)],
    ["uploadJobPhoto", () => uploadJobPhoto(form())],
    ["removeJobPhoto", () => removeJobPhoto(PH)],
    ["setPrimaryJobPhoto", () => setPrimaryJobPhoto(PH)],
    ["reorderJobPhotos", () => reorderJobPhotos(JOB, [PH])],
    ["pullJobPhotoFromCatalog", () => pullJobPhotoFromCatalog(JOB)],
  ];
  it.each(all)("%s: role staff → ปฏิเสธ ไม่แตะ RPC/Storage/DB", async (_n, fn) => {
    roleMock.mockResolvedValue("staff");
    const r = (await fn()) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/เจ้าของร้าน|แอดมิน/);
    untouched();
    expect(calls).toHaveLength(0);
  });
  it.each(all)("%s: ยังไม่ล็อกอิน (เมื่อเปิด gate) → ปฏิเสธก่อนแตะอะไร", async (_n, fn) => {
    requireSessionMock.mockRejectedValue(new Error("no session"));
    expect(((await fn()) as { ok: boolean }).ok).toBe(false);
    untouched();
    expect(calls).toHaveLength(0);
  });
});

describe("uploadJobPhoto — เคสห้ามผ่าน (ด่านไฟล์ก่อนแตะ Storage/RPC)", () => {
  it("ไม่ใช่ FormData · jobId ผิดรูป/ว่าง → ไม่ถึงไหนเลย", async () => {
    expect((await uploadJobPhoto({} as FormData)).ok).toBe(false);
    for (const jobId of [null, "", "x", "../oem", `${JOB}/../x`, "11111111-1111-4111-8111"]) expect((await uploadJobPhoto(form({ jobId }))).ok, String(jobId)).toBe(false);
    untouched();
  });

  it("ไม่มีไฟล์ md/sm หรือส่งเป็นข้อความ (ไม่ใช่ File) · ไฟล์ว่าง → ปฏิเสธ", async () => {
    for (const bad of [{ md: "not-a-file" }, { sm: "not-a-file" }, { md: file(new Uint8Array(0)) }, { sm: file(new Uint8Array(0)) }]) {
      const r = await uploadJobPhoto(form(bad));
      expect(r.ok, JSON.stringify(Object.keys(bad))).toBe(false);
    }
    const fd = new FormData();
    fd.set("jobId", JOB);
    expect((await uploadJobPhoto(fd)).ok).toBe(false);
    untouched();
  });

  it("เกิน 1 MB (1,048,577 bytes) ทั้ง md และ sm → ปฏิเสธ · พอดี 1,048,576 ผ่านด่านขนาด", async () => {
    const big = cleanJpeg(1200, 800, 1_048_577 - cleanJpeg().byteLength);
    expect(big.byteLength).toBe(1_048_577);
    for (const o of [{ md: file(big) }, { sm: file(big) }]) {
      const r = await uploadJobPhoto(form(o));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/1 MB/);
    }
    untouched();
    const exact = cleanJpeg(1200, 800, 1_048_576 - cleanJpeg().byteLength);
    expect(exact.byteLength).toBe(1_048_576);
    expect((await uploadJobPhoto(form({ md: file(exact) }))).ok).toBe(true);
  });

  it("ไม่ใช่ JPEG จริง: PNG / SVG / HTML / PDF / exe ปลอมนามสกุล .jpg + Content-Type image/jpeg → ปฏิเสธที่ byte จริง ไม่อัปโหลด", async () => {
    const fakes: Record<string, Uint8Array | string> = {
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
      html: "<html><script>fetch('/api')</script></html>",
      pdf: "%PDF-1.7 fake",
      exe: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]),
      gif: "GIF89a....",
      jpegSoiOnly: new Uint8Array([0xff, 0xd8]),
    };
    for (const [k, bytes] of Object.entries(fakes)) {
      for (const slot of ["md", "sm"] as const) {
        const r = await uploadJobPhoto(form({ [slot]: file(bytes, "photo.jpg", "image/jpeg") }));
        expect(r.ok, `${k}/${slot}`).toBe(false);
        expect(!r.ok && r.error, `${k}/${slot}`).toMatch(/JPEG/);
      }
    }
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("🔴 JPEG ที่ยังมี Exif (GPS) หรือ XMP — ยิงตรงเข้า action ข้าม client → ปฏิเสธ (ทั้ง md และ sm) · ไม่อัปโหลด ไม่ยิง RPC", async () => {
    for (const bad of [exifJpeg(), xmpJpeg()]) {
      for (const slot of ["md", "sm"] as const) {
        const r = await uploadJobPhoto(form({ [slot]: file(bad) }));
        expect(r.ok, slot).toBe(false);
        expect(!r.ok && r.error, slot).toMatch(/ข้อมูลจากกล้อง/);
      }
    }
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("เกินเพดานรูป reference (นับ 5 อยู่แล้ว) → ปฏิเสธก่อนอ่านไฟล์/อัปโหลด · code photo_cap_ref · ข้อความไทย", async () => {
    results.job_photo = { data: null, error: null, count: 5 };
    const r = await uploadJobPhoto(form());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("photo_cap_ref");
    expect(!r.ok && r.error).toMatch(/ครบ 5 รูป/);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    results.job_photo = { data: null, error: null, count: 4 };
    expect((await uploadJobPhoto(form())).ok).toBe(true);
  });

  it("ใบไม่อยู่ร้านนี้/ไม่มีจริง → job_not_found · ส่วนย่อย (มี parent) → lot_no_photo · ไม่อัปโหลด", async () => {
    results.job = { data: null, error: null };
    let r = await uploadJobPhoto(form());
    expect(!r.ok && r.code).toBe("job_not_found");
    results.job = { data: { id: JOB, parent_job_id: OTHER_JOB }, error: null };
    r = await uploadJobPhoto(form());
    expect(!r.ok && r.code).toBe("lot_no_photo");
    results.job = { data: [], error: null };
    r = await uploadJobPhoto(form());
    expect(!r.ok && r.code).toBe("job_not_found");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    // query ใบกรอง shop_id ของ server
    expect(calls.find((c) => c.table === "job")?.ops).toContainEqual(["eq", "shop_id", SHOP]);
  });

  it("caption ยาวเกิน 60 / มี control char → ปฏิเสธก่อนอัปโหลด · caption ปกติผ่านและตัดช่องว่าง", async () => {
    for (const caption of ["ก".repeat(61), "a\u0000b"]) expect((await uploadJobPhoto(form({ caption }))).ok, caption.slice(0, 8)).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    const r = await uploadJobPhoto(form({ caption: "  ด้านข้าง  " }));
    expect(r.ok).toBe(true);
    expect(rpcCalls("job_photo_add")[0][1].p_caption).toBe("ด้านข้าง");
  });
});

describe("uploadJobPhoto — path/ร้าน/ที่มาสร้างที่ server เท่านั้น · ผลถึง client ไม่มี path", () => {
  it("🔴 FormData ที่ยัด path/shop/source/kind/product_image_id/actor มา: ไม่ถูกใช้เลย — path = <shop จาก server>/<job ที่ DB ยืนยัน>/<uuid ใหม่> · ที่มา office · kind reference · actor จาก session", async () => {
    const r = await uploadJobPhoto(
      form({ extra: { storage_path: "evil/path_md.jpg", path: "../../x", variant_sm_path: "evil/p_sm.jpg", shopId: "ffffffff-ffff-4fff-8fff-ffffffffffff", p_shop_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", source: "product", kind: "stage", product_image_id: PIMG, p_actor: "x", worker_id: PH2, is_primary: "true" } })
    );
    expect(r.ok).toBe(true);
    const [, p] = rpcCalls("job_photo_add")[0];
    expect(p.p_shop_id).toBe(SHOP);
    expect(p.p_actor).toBe(USER);
    expect(p.p_job_id).toBe(JOB);
    expect(p.p_kind).toBe("reference");
    expect(p.p_source).toBe("office");
    expect(p.p_product_image_id).toBeNull();
    expect(String(p.p_storage_path)).toMatch(new RegExp(`^${SHOP}/${JOB}/[0-9a-f-]{36}_md\\.jpg$`));
    const id = String(p.p_storage_path).split("/")[2].replace("_md.jpg", "");
    expect(p.p_variant_sm_path).toBe(`${SHOP}/${JOB}/${id}_sm.jpg`);
    expect(JSON.stringify(p)).not.toMatch(/evil|\.\.|ffffffff-ffff|"worker/);
    // ไฟล์ขึ้น bucket ใบงานที่ path เดียวกับที่ลงทะเบียน · contentType image/jpeg · ไม่ทับของเดิม
    expect(uploadMock.mock.calls.map((c) => [c[0], c[1]])).toEqual([["job-photos", p.p_storage_path], ["job-photos", p.p_variant_sm_path]]);
    for (const c of uploadMock.mock.calls) expect(c[3]).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(uploadMock.mock.calls.every((c) => c[0] === "job-photos")).toBe(true);
  });

  it("ไม่เขียน bucket product-images / ตาราง product_image (ห้ามเขียนกลับ catalog)", async () => {
    await uploadJobPhoto(form());
    expect(uploadMock.mock.calls.some((c) => c[0] === "product-images")).toBe(false);
    expect(removeMock.mock.calls.some((c) => c[0] === "product-images")).toBe(false);
    expect(calls.some((c) => c.table === "product_image")).toBe(false);
  });

  it("สำเร็จ: ผลเป็น JobPhotoRow (signed URL 15 นาที ของ job-photos) — ไม่มี storage_path/path/product_image_id/uploaded_by/bytes/shop/job id ในผล (นอก URL)", async () => {
    const r = await uploadJobPhoto(form({ caption: "ด้านข้าง" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.data).sort()).toEqual(["caption", "createdAt", "id", "isPrimary", "mdUrl", "smUrl", "sortOrder", "source"]);
    expect(r.data.isPrimary).toBe(true);
    expect(r.data.source).toBe("office");
    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock.mock.calls[0][0]).toBe("job-photos");
    expect(signMock.mock.calls[0][2]).toBe(900);
    expect(r.data.mdUrl).toMatch(/^https:\/\/.*\/storage\/v1\/object\/sign\/job-photos\//);
    const stripped = JSON.stringify(r.data).replace(/"https:[^"]*"/g, '"<url>"');
    for (const leak of [SHOP, JOB, "_md.jpg", "_sm.jpg", "storage_path", "variant_sm_path", "product_image", "uploaded_by", "bytes"]) expect(stripped, leak).not.toContain(leak);
    expect(revalidateMock).toHaveBeenCalledWith(`/jobs/${JOB}`);
  });

  it("แถวที่อ่านกลับหลังเก็บ (sort_order/created_at/เป็นรูปหลักหรือไม่ จาก DB) ถูกใช้ในผล · อ่านแถวกลับไม่ได้ก็ยังตอบ ok (รูปถูกเก็บแล้ว ห้ามตอบว่าอัปโหลดล้ม)", async () => {
    rpcMock.mockImplementation(async (fn: string, p: Record<string, unknown>) => {
      const id = String(p.p_storage_path).split("/")[2].replace("_md.jpg", "");
      results.job_photo = { data: { id, kind: "reference", source: "office", storage_path: p.p_storage_path, variant_sm_path: p.p_variant_sm_path, is_primary: false, sort_order: 3, caption: null, created_at: "2026-10-19T09:00:00Z" }, error: null, count: 0 };
      return { data: { ok: true, photo_id: id, is_primary: false }, error: null };
    });
    const r = await uploadJobPhoto(form());
    expect(r.ok && r.data).toMatchObject({ isPrimary: false, sortOrder: 3, createdAt: "2026-10-19T09:00:00Z", source: "office" });
    // อ่านแถวกลับล้ม → ตกกลับไปใช้ค่าที่เพิ่งเก็บ (ok)
    rpcMock.mockImplementation(async (fn: string, p: Record<string, unknown>) => {
      results.job_photo = { data: null, error: { code: "XX000", message: "boom" }, count: 0 };
      return { data: { ok: true, photo_id: String(p.p_storage_path).split("/")[2].replace("_md.jpg", ""), is_primary: true }, error: null };
    });
    const r2 = await uploadJobPhoto(form());
    expect(r2.ok && r2.data).toMatchObject({ isPrimary: true, sortOrder: 0 });
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe("uploadJobPhoto — ล้มกลางทาง: ไม่ทิ้งไฟล์ค้าง · ข้อความไทย · log ไม่รั่ว", () => {
  it("อัปโหลด md ล้ม → ไม่ยิง RPC · ไม่มีอะไรให้ลบ", async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: { message: `getaddrinfo ENOTFOUND ${HOST_SECRET}`, details: "stack at ..." } });
    const r = await uploadJobPhoto(form());
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(HOST_SECRET);
  });

  it("อัปโหลด sm ล้ม → ลบ md ที่เพิ่งอัป · ไม่ยิง RPC", async () => {
    uploadMock.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom", code: "500" } });
    const r = await uploadJobPhoto(form());
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][0]).toBe("job-photos");
    expect(removeMock.mock.calls[0][1]).toEqual([String(uploadMock.mock.calls[0][1])]);
  });

  it("RPC ล้ม (เพดานชนตอน race P0001/P0002/P0003 · ใบปิด/ใบอื่น · caption ผิด) → ลบทั้ง md+sm ที่อัปไปแล้ว · ข้อความไทยตาม hint", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ code: "P0001", hint: "photo_cap_ref", message: "x" }, /ครบ 5 รูป/],
      [{ code: "P0002", hint: "photo_cap_total", message: "x" }, /ครบ 20 รูป/],
      [{ code: "P0003", hint: "photo_budget", message: "x" }, /พื้นที่เก็บรูป/],
      [{ code: "22023", hint: "lot_no_photo", message: "lot_no_photo: x" }, /ส่วนย่อย/],
      [{ code: "22023", hint: "caption_invalid", message: "caption_invalid: x" }, /ป้ายรูป/],
      [{ code: "22023", hint: "photo_path_dup", message: "x" }, /บันทึกไปแล้ว/],
      [{ code: "XX000", message: `relation analytics.job_photo exploded ${HOST_SECRET}` }, /ไม่สำเร็จ/],
    ];
    for (const [err, re] of cases) {
      vi.clearAllMocks();
      uploadMock.mockResolvedValue({ data: {}, error: null });
      removeMock.mockResolvedValue({ data: [], error: null });
      rpcMock.mockResolvedValue({ data: null, error: err });
      const r = await uploadJobPhoto(form());
      expect(r.ok, String(err.hint ?? err.code)).toBe(false);
      expect(!r.ok && r.error, String(err.hint ?? err.code)).toMatch(re);
      expect(JSON.stringify(r), String(err.hint ?? err.code)).not.toMatch(/analytics\.|job_photo|ENOTFOUND|udqmamp/);
      const [paths] = [removeMock.mock.calls[0][1] as string[]];
      expect(removeMock.mock.calls[0][0]).toBe("job-photos");
      expect([...paths].sort()).toEqual([String(uploadMock.mock.calls[0][1]), String(uploadMock.mock.calls[1][1])].sort());
    }
  });

  it("🔴 log: เฉพาะ label + code/hint — ไม่มี path/URL/ชื่อไฟล์/host/ข้อความ error ทั้งก้อน/shop/job", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", hint: "x", message: `secret ${HOST_SECRET} ${SHOP}/${JOB}/${PH}_md.jpg`, details: `Failing row contains (${PH}, ชื่อลูกค้า สมชาย)` } });
    uploadMock.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ data: null, error: { message: `ENOTFOUND ${HOST_SECRET}`, details: "stack" } });
    await uploadJobPhoto(form({ caption: "ด้านข้าง" }));
    await uploadJobPhoto(form({ caption: "ด้านข้าง" }));
    const l = logged();
    expect(errSpy).toHaveBeenCalled();
    for (const leak of [HOST_SECRET, SHOP, JOB, PH, "สมชาย", "ENOTFOUND", "stack", "photo.jpg", "https://", "_md.jpg", "Failing row"]) expect(l, leak).not.toContain(leak);
  });

  it("DB อ่านใบล้ม → ข้อความไทย ไม่รั่วข้อความดิบ · ไม่อัปโหลด", async () => {
    results.job = { data: null, error: { code: "XX000", message: "relation analytics.secret exploded" } };
    const r = await uploadJobPhoto(form());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(logged()).not.toContain("secret");
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("removeJobPhoto / setPrimaryJobPhoto / reorderJobPhotos", () => {
  it("ลบ: RPC แล้วลบไฟล์ใน bucket job-photos ตาม path ที่ RPC คืน · ผลถึง client = promotedPhotoId เท่านั้น (ไม่มี path)", async () => {
    const r = await removeJobPhoto(PH, "  ถ่ายผิดรุ่น  ");
    expect(r).toEqual({ ok: true, data: { promotedPhotoId: PH2 } });
    const [, p] = rpcCalls("job_photo_remove")[0];
    expect(p).toMatchObject({ p_photo_id: PH, p_reason: "ถ่ายผิดรุ่น", p_shop_id: SHOP, p_actor: USER });
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][0]).toBe("job-photos");
    expect([...(removeMock.mock.calls[0][1] as string[])].sort()).toEqual([`${SHOP}/${JOB}/${PH}_md.jpg`, `${SHOP}/${JOB}/${PH}_sm.jpg`].sort());
    expect(JSON.stringify(r)).not.toMatch(/jpg|storage|variant/);
  });

  it("ลบ: เหตุผลไม่บังคับ (null) · เหตุผลยาวเกิน 300 / control char → ปฏิเสธก่อน RPC · id ผิดรูป → ไม่ถึง RPC", async () => {
    expect((await removeJobPhoto(PH)).ok).toBe(true);
    expect(rpcCalls("job_photo_remove")[0][1].p_reason).toBeNull();
    vi.clearAllMocks();
    for (const reason of ["ก".repeat(301), "a\u0000b"]) expect((await removeJobPhoto(PH, reason)).ok, reason.slice(0, 5)).toBe(false);
    for (const id of ["x", "", "../x", `${PH}x`]) expect((await removeJobPhoto(id)).ok, id).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ลบ: RPC ปฏิเสธ (ลบซ้ำ/ไม่พบ) → ไม่ลบไฟล์ · ข้อความไทย · ลบ object ล้ม = ยังตอบ ok (แถวลบแล้ว) + log เฉพาะ code", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "already_deleted", message: "รูปนี้ถูกลบไปแล้ว" } });
    let r = await removeJobPhoto(PH);
    expect(!r.ok && r.code).toBe("already_deleted");
    expect(!r.ok && r.error).toMatch(/ลบไปแล้ว/);
    expect(removeMock).not.toHaveBeenCalled();
    removeMock.mockResolvedValueOnce({ data: null, error: { message: `ENOTFOUND ${HOST_SECRET}`, code: "ETIMEDOUT" } });
    r = await removeJobPhoto(PH);
    expect(r.ok).toBe(true);
    expect(logged()).not.toContain(HOST_SECRET);
    expect(logged()).not.toContain(PH);
  });

  it("ตั้งรูปหลัก: RPC พร้อม actor จาก session · id ผิดรูปไม่ถึง RPC · ข้อความไทยเมื่อล้ม", async () => {
    expect(await setPrimaryJobPhoto(PH)).toEqual({ ok: true, data: null });
    expect(rpcCalls("job_photo_set_primary")[0][1]).toMatchObject({ p_photo_id: PH, p_shop_id: SHOP, p_actor: USER });
    expect((await setPrimaryJobPhoto("x")).ok).toBe(false);
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "photo_not_found", message: "ไม่พบรูปนี้ในร้านนี้" } });
    const r = await setPrimaryJobPhoto(PH);
    expect(!r.ok && r.code).toBe("photo_not_found");
  });

  it("เรียง: ชุด id ผิด (ว่าง/ซ้ำ/ไม่ใช่ uuid/เกิน 20/ไม่ใช่ array) → ไม่ถึง RPC · ชุดถูกส่ง p_ids ตามลำดับ", async () => {
    const dup = [PH, PH];
    const many = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const ids of [[], dup, ["x"], many, "nope", null, [PH, null]] as unknown[]) expect((await reorderJobPhotos(JOB, ids as string[])).ok, JSON.stringify(ids)?.slice(0, 30)).toBe(false);
    expect((await reorderJobPhotos("bad", [PH])).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await reorderJobPhotos(JOB, [PH2, PH])).ok).toBe(true);
    expect(rpcCalls("job_photo_reorder")[0][1]).toMatchObject({ p_job_id: JOB, p_ids: [PH2, PH], p_shop_id: SHOP, p_actor: USER });
  });

  it("เรียง: DB ปฏิเสธชุดไม่ครบ → ข้อความไทย photo_set_mismatch", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "photo_set_mismatch", message: "x" } });
    const r = await reorderJobPhotos(JOB, [PH]);
    expect(!r.ok && r.code).toBe("photo_set_mismatch");
    expect(!r.ok && r.error).toMatch(/โหลดหน้าใหม่/);
  });
});

describe("getJobPhotos", () => {
  it("คืนรูป active (query กรอง shop_id + job_id + deleted_at is null · มี limit) พร้อม URL เซ็นแล้ว · ไม่มี path", async () => {
    results.job_photo = {
      data: [
        { id: PH, kind: "reference", source: "office", storage_path: `${SHOP}/${JOB}/${PH}_md.jpg`, variant_sm_path: `${SHOP}/${JOB}/${PH}_sm.jpg`, is_primary: true, sort_order: 0, caption: null, created_at: "2026-10-19T09:00:00Z" },
        { id: PH2, kind: "reference", source: "product", storage_path: `${SHOP}/${JOB}/${PH2}_md.jpg`, variant_sm_path: `${SHOP}/${JOB}/${PH2}_sm.jpg`, is_primary: false, sort_order: 1, caption: "ซ้าย", created_at: "2026-10-19T09:01:00Z" },
      ],
      error: null,
    };
    const r = await getJobPhotos(JOB);
    expect(r.ok && r.data.map((p) => p.id)).toEqual([PH, PH2]);
    const q = calls.find((c) => c.table === "job_photo")!;
    expect(q.ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(q.ops).toContainEqual(["eq", "job_id", JOB]);
    expect(q.ops).toContainEqual(["is", "deleted_at", null]);
    expect(q.ops.some((o) => o[0] === "limit")).toBe(true);
    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock.mock.calls[0][1]).toHaveLength(4);
    const stripped = JSON.stringify(r).replace(/"https:[^"]*"/g, '"<url>"');
    expect(stripped).not.toMatch(/storage_path|_md\.jpg|_sm\.jpg/);
  });

  it("เซ็นไม่สำเร็จบางรูป → url null (รูปยังอยู่ในรายการ) · อ่าน DB ล้ม → ข้อความไทย ไม่รั่วดิบ · id ผิดรูปไม่ query", async () => {
    results.job_photo = { data: [{ id: PH, kind: "reference", source: "office", storage_path: `${SHOP}/${JOB}/${PH}_md.jpg`, variant_sm_path: `${SHOP}/${JOB}/${PH}_sm.jpg`, is_primary: true, sort_order: 0, caption: null, created_at: null }], error: null };
    signMock.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const r = await getJobPhotos(JOB);
    expect(r.ok && r.data[0]).toMatchObject({ id: PH, smUrl: null, mdUrl: null });
    results.job_photo = { data: null, error: { code: "XX000", message: "relation analytics.secret exploded" } };
    const e = await getJobPhotos(JOB);
    expect(e.ok).toBe(false);
    expect(JSON.stringify(e)).not.toContain("secret");
    expect(logged()).not.toContain("secret");
    calls.length = 0;
    expect((await getJobPhotos("bad")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("pullJobPhotoFromCatalog — copy (ไม่ใช่ link) · ไม่เขียนกลับ catalog", () => {
  const SRC_MD = `${SHOP}/${PRODUCT}/${PIMG}_md.jpg`;
  const SRC_SM = `${SHOP}/${PRODUCT}/${PIMG}_sm.jpg`;
  const blob = (b: Uint8Array) => ({ data: new Blob([b as BlobPart]), error: null });
  const catalogRpc = (over: Record<string, unknown> = {}) =>
    rpcMock.mockImplementation(async (fn: string, p: Record<string, unknown>) => {
      if (fn === "job_photo_catalog_source") return { data: { ok: true, found: true, product_image_id: PIMG, md_path: SRC_MD, sm_path: SRC_SM, bytes: 5000, width: 1200, height: 800, ...over }, error: null };
      if (fn === "job_photo_add") return { data: { ok: true, photo_id: String(p.p_storage_path).split("/")[2].replace("_md.jpg", ""), is_primary: true }, error: null };
      return { data: { ok: true }, error: null };
    });
  beforeEach(() => {
    results.job = { data: { id: JOB, parent_job_id: null, product_id: PRODUCT }, error: null };
    catalogRpc();
    downloadMock.mockImplementation(async (_b: string, path: string) => blob(path === SRC_MD ? cleanJpeg(1200, 800) : cleanJpeg(480, 320)));
  });

  it("สำเร็จ: ดาวน์โหลดจาก product-images (อ่านอย่างเดียว) → อัปเข้า job-photos path ใหม่ของใบ → RPC add source=product + product_image_id → ผลเป็น JobPhotoRow", async () => {
    const r = await pullJobPhotoFromCatalog(JOB);
    expect(r.ok).toBe(true);
    expect(downloadMock.mock.calls.map((c) => [c[0], c[1]]).sort()).toEqual([["product-images", SRC_MD], ["product-images", SRC_SM]].sort());
    expect(uploadMock.mock.calls.every((c) => c[0] === "job-photos")).toBe(true);
    const [, p] = rpcCalls("job_photo_add")[0];
    expect(p).toMatchObject({ p_job_id: JOB, p_kind: "reference", p_source: "product", p_product_image_id: PIMG, p_shop_id: SHOP, p_actor: USER, p_width: 1200, p_height: 800 });
    expect(String(p.p_storage_path)).toMatch(new RegExp(`^${SHOP}/${JOB}/[0-9a-f-]{36}_md\\.jpg$`));
    expect(String(p.p_storage_path)).not.toContain(PRODUCT);
    expect(r.ok && Object.keys(r.data).sort()).toEqual(["caption", "createdAt", "id", "isPrimary", "mdUrl", "smUrl", "sortOrder", "source"]);
  });

  it("🔴 ห้ามเขียนกลับ catalog: ไม่มี upload/remove บน product-images · ไม่แตะตาราง product_image · RPC ที่เรียกมีเฉพาะ catalog_source (อ่าน) + job_photo_add", async () => {
    await pullJobPhotoFromCatalog(JOB);
    expect(uploadMock.mock.calls.some((c) => c[0] === "product-images")).toBe(false);
    expect(removeMock.mock.calls.some((c) => c[0] === "product-images")).toBe(false);
    expect(calls.some((c) => c.table === "product_image")).toBe(false);
    expect(rpcMock.mock.calls.map((c) => c[0]).sort()).toEqual(["job_photo_add", "job_photo_catalog_source"]);
  });

  it("ล้มแล้วใบไม่เสีย: ใบไม่ผูก SKU → ไม่ยิง RPC เลย · SKU ไม่มีรูป · ดาวน์โหลดไม่ได้ · ไฟล์แคตตาล็อกเสีย/มี Exif/ใหญ่เกิน → ไม่อัปโหลด · ข้อความไทย", async () => {
    results.job = { data: { id: JOB, parent_job_id: null, product_id: null }, error: null };
    let r = await pullJobPhotoFromCatalog(JOB);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/ไม่ได้ผูกกับสินค้า/);
    expect(rpcMock).not.toHaveBeenCalled();

    results.job = { data: { id: JOB, parent_job_id: null, product_id: PRODUCT }, error: null };
    catalogRpc({ found: false, reason: "no_catalog_image" });
    r = await pullJobPhotoFromCatalog(JOB);
    expect(!r.ok && r.error).toMatch(/ยังไม่มีรูปในแคตตาล็อก/);
    expect(downloadMock).not.toHaveBeenCalled();

    catalogRpc();
    downloadMock.mockResolvedValue({ data: null, error: { message: `ENOTFOUND ${HOST_SECRET}` } });
    r = await pullJobPhotoFromCatalog(JOB);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(HOST_SECRET);

    for (const bad of [exifJpeg(), xmpJpeg(), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), cleanJpeg(1200, 800, 1_048_577)]) {
      downloadMock.mockImplementation(async () => blob(bad));
      r = await pullJobPhotoFromCatalog(JOB);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/แคตตาล็อก/);
    }
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcCalls("job_photo_add")).toHaveLength(0);
  });

  it("RPC add ล้ม (ดึงซ้ำ photo_catalog_dup / เพดาน / ใบปิด) → ลบไฟล์ที่ copy ไปแล้ว · ข้อความไทย · log ไม่มี path", async () => {
    rpcMock.mockImplementation(async (fn: string, p: Record<string, unknown>) => {
      if (fn === "job_photo_catalog_source") return { data: { ok: true, found: true, product_image_id: PIMG, md_path: SRC_MD, sm_path: SRC_SM }, error: null };
      return { data: null, error: { code: "22023", hint: "photo_catalog_dup", message: `photo_catalog_dup ${String(p.p_storage_path)}` } };
    });
    const r = await pullJobPhotoFromCatalog(JOB);
    expect(!r.ok && r.code).toBe("photo_catalog_dup");
    expect(!r.ok && r.error).toMatch(/ถูกดึงจากแคตตาล็อกเข้าใบงานนี้แล้ว/);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][0]).toBe("job-photos");
    expect((removeMock.mock.calls[0][1] as string[]).length).toBe(2);
    expect(logged()).not.toContain(SHOP);
    expect(logged()).not.toContain(PIMG);
  });

  it("ส่วนย่อย/ใบไม่มี → ไม่ถึง RPC ดึงรูป · id ผิดรูป → ไม่ query", async () => {
    results.job = { data: { id: JOB, parent_job_id: OTHER_JOB, product_id: PRODUCT }, error: null };
    const r = await pullJobPhotoFromCatalog(JOB);
    expect(!r.ok && r.code).toBe("lot_no_photo");
    results.job = { data: null, error: null };
    expect((await pullJobPhotoFromCatalog(JOB)).ok).toBe(false);
    calls.length = 0;
    expect((await pullJobPhotoFromCatalog("bad")).ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
