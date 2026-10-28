// QA (W2 · 21 ต.ค. 69) — เคสเพิ่มของ intakeUploadPhoto ที่ job-worker.photos.test.ts ยังไม่ครอบ (เน้นตัด Exif/XMP ที่ bytes ถึง storage mock)
// แต่ละเคสมี "ตัวตรวจอิสระ" = ค้น byte ของค่า GPS ตรงๆ ใน bytes ที่ส่งให้ storage (ไม่พึ่ง hasCameraMetadata ตัวเดียว)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES } from "@/lib/images/constants";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const NEWPH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "idem0123456789abcdef";
const HOST = "abc.supabase.co";
const GPS_MARK = "GPS13.7563N100.5018E";

const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const signMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: SESSION }), set: () => {} }),
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

import { intakeUploadPhoto } from "./job-worker";

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]): number[] => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const JFIF = seg(0xe0, [...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const sof = (w: number, h: number, marker = 0xc0) => [0xff, marker, 0x00, 0x0b, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x01, 0x01, 0x11, 0x00];
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78];
const jpeg = (o: { before?: number[][]; w?: number; h?: number; sofMarker?: number; tail?: number[]; scanPad?: number } = {}): Uint8Array =>
  new Uint8Array([0xff, 0xd8, ...(o.before ?? []).flat(), ...JFIF, ...sof(o.w ?? 1200, o.h ?? 800, o.sofMarker ?? 0xc0), ...SOS, ...SCAN, ...new Array(o.scanPad ?? 0).fill(0x11), 0xff, 0xd9, ...(o.tail ?? [])]);
const EXIF_GPS = seg(0xe1, [...ascii("Exif"), 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x1a, 0, 0, 0, ...ascii(GPS_MARK)]);
const XMP = seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<exif:GPSLatitude>13.7563</exif:GPSLatitude>")]);
const XMP_EXT = seg(0xe1, [...ascii("http://ns.adobe.com/xmp/extension/"), 0, ...ascii("<exif:GPSLongitude>100.5018</exif:GPSLongitude>")]);
const IPTC = seg(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("8BIM"), ...ascii("lat=13.7563")]);
const MPF = seg(0xe2, [...ascii("MPF"), 0, ...ascii(GPS_MARK)]);
const file = (bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg") => new File([bytes as BlobPart], name, { type });
const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s));

function form(md: File, sm: File, idem = IDEM): FormData {
  const fd = new FormData();
  fd.set("idemKey", idem);
  fd.set("md", md);
  fd.set("sm", sm);
  return fd;
}
const fn = (name: string) => rpcMock.mock.calls.filter((c) => c[0] === name);
const stored = () => uploadMock.mock.calls.map((c) => c[2] as Uint8Array);
let beginN = 0;

beforeEach(() => {
  vi.clearAllMocks();
  beginN = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  uploadMock.mockResolvedValue({ data: {}, error: null });
  removeMock.mockResolvedValue({ data: [], error: null });
  signMock.mockImplementation(async (_b: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://${HOST}/storage/v1/object/sign/job-photos/${p}?token=t`, error: null })), error: null }));
  rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "job_worker_photo_begin") {
      beginN += 1;
      const id = `cccccccc-cccc-4ccc-8ccc-${String(beginN).padStart(12, "0")}`;
      return { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: id, count: 0, max: 3 }, error: null };
    }
    if (name === "job_worker_photo_add") return { data: { ok: true, photo_id: args.p_photo_id, is_primary: false, count: 1, max: 3 }, error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("ตัด metadata — รูปแบบอื่นนอกจาก APP1 Exif เดี่ยว (ยิงตรง action)", () => {
  it("Exif ซ้อนหลาย APP1 + XMP ปกติ + XMP extension + IPTC(APP13) + APP2(MPF) ที่ฝังพิกัด → ไม่เหลือสักอัน", async () => {
    const dirty = jpeg({ before: [EXIF_GPS, EXIF_GPS, XMP, XMP_EXT, IPTC, MPF], tail: [...EXIF_GPS, ...XMP_EXT] });
    const r = await intakeUploadPhoto(TOKEN, form(file(dirty), file(jpeg({ before: [EXIF_GPS], w: 480, h: 320 }))));
    expect(r.ok).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    for (const b of stored()) {
      for (const needle of [GPS_MARK, "exif:GPS", "lat=13.7563", "Photoshop", "xmp/extension", "xap/1.0"]) expect(has(b, needle), needle).toBe(false);
    }
  });

  it("progressive JPEG (SOF2) ที่มี Exif GPS → ตัดแล้วเก็บได้ · มิติอ่านได้ถูก (1200x800)", async () => {
    const r = await intakeUploadPhoto(TOKEN, form(file(jpeg({ before: [EXIF_GPS], sofMarker: 0xc2 })), file(jpeg({ w: 480, h: 320, sofMarker: 0xc2 }))));
    expect(r.ok).toBe(true);
    for (const b of stored()) expect(has(b, GPS_MARK)).toBe(false);
    const add = fn("job_worker_photo_add")[0][1] as Record<string, unknown>;
    expect(add.p_width).toBe(1200);
    expect(add.p_height).toBe(800);
  });

  it("md สะอาด + sm สกปรก (และกลับกัน) → ทั้งสองไฟล์ที่เก็บสะอาด · ตัวที่สะอาดอยู่แล้วต้องไม่ถูกทำให้พัง (bytes ยังเป็น JPEG ที่ SOI/EOI ครบ)", async () => {
    for (const [md, sm] of [
      [jpeg(), jpeg({ before: [EXIF_GPS], w: 480, h: 320 })],
      [jpeg({ before: [XMP] }), jpeg({ w: 480, h: 320 })],
    ] as const) {
      uploadMock.mockClear();
      const r = await intakeUploadPhoto(TOKEN, form(file(md), file(sm)));
      expect(r.ok).toBe(true);
      for (const b of stored()) {
        expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
        expect([b[b.length - 2], b[b.length - 1]]).toEqual([0xff, 0xd9]);
        expect(has(b, GPS_MARK) || has(b, "exif:GPS")).toBe(false);
      }
    }
  });

  it("segment ประกาศความยาวเกินไฟล์ (ตัดครึ่ง APP1) / ไฟล์มีแต่ SOI → broken · ไม่ upload · ไม่ add", async () => {
    const trunc = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, ...ascii("Exif"), 0, 0, ...ascii(GPS_MARK)]);
    for (const bad of [trunc, new Uint8Array([0xff, 0xd8]), new Uint8Array([0xff, 0xd8, 0xff])]) {
      const r = await intakeUploadPhoto(TOKEN, form(file(bad), file(jpeg({ w: 480, h: 320 }))));
      expect(r.ok).toBe(false);
    }
    expect(uploadMock).not.toHaveBeenCalled();
    expect(fn("job_worker_photo_add")).toHaveLength(0);
  });

  it("ชื่อไฟล์ภาษาไทย/emoji + content-type ปลอม (text/html) → ตัดสินจาก bytes: เก็บได้ · ชื่อไฟล์ไม่ไปถึง storage/RPC", async () => {
    const r = await intakeUploadPhoto(TOKEN, form(file(jpeg(), "ภาพแหวน😀<script>.html", "text/html"), file(jpeg({ w: 480, h: 320 }), "../../ที่อยู่ลูกค้า.png", "image/png")));
    expect(r.ok).toBe(true);
    const blob = JSON.stringify([uploadMock.mock.calls.map((c) => [c[1], c[3]]), rpcMock.mock.calls]);
    expect(blob).not.toContain("แหวน");
    expect(blob).not.toContain("script");
    expect(blob).not.toContain("ที่อยู่ลูกค้า");
    expect(uploadMock.mock.calls.every((c) => (c[3] as { contentType: string }).contentType === "image/jpeg")).toBe(true);
  });
});

describe("ขอบขนาด", () => {
  it("ไฟล์ดิบเกือบเต็ม MAX_BYTES + Exif → ตัดแล้วผ่านและสะอาด · ไฟล์ MAX_BYTES + 1 ไบต์ ตก tooLarge ก่อนแตะ DB", async () => {
    const fat = jpeg({ before: [EXIF_GPS], scanPad: MAX_BYTES - 600 });
    expect(fat.byteLength).toBeLessThan(MAX_BYTES);
    expect(fat.byteLength).toBeGreaterThan(MAX_BYTES - 700);
    const r0 = await intakeUploadPhoto(TOKEN, form(file(fat), file(jpeg({ w: 480, h: 320 }))));
    expect(r0.ok).toBe(true);
    for (const b of stored()) expect(has(b, GPS_MARK)).toBe(false);
    rpcMock.mockClear();
    uploadMock.mockClear();
    const over = new Uint8Array(MAX_BYTES + 1);
    over.set(jpeg());
    const r1 = await intakeUploadPhoto(TOKEN, form(file(over), file(jpeg({ w: 480, h: 320 }))));
    expect(r1.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("พร้อมกัน/ซ้ำ", () => {
  it("อัปโหลด 3 รูปพร้อมกัน (Promise.all) ใบเดียวกัน: แต่ละครั้ง begin ของตัวเอง → path ไม่ชนกัน · ไม่มี object ซ้ำ · ทุก add ตรงกับ object ที่เก็บ", async () => {
    const results = await Promise.all([0, 1, 2].map(() => intakeUploadPhoto(TOKEN, form(file(jpeg({ before: [EXIF_GPS] })), file(jpeg({ before: [EXIF_GPS], w: 480, h: 320 }))))));
    expect(results.every((r) => r.ok)).toBe(true);
    const paths = uploadMock.mock.calls.map((c) => c[1] as string);
    expect(paths).toHaveLength(6);
    expect(new Set(paths).size).toBe(6);
    for (const b of stored()) expect(has(b, GPS_MARK)).toBe(false);
    const addIds = fn("job_worker_photo_add").map((c) => (c[1] as Record<string, unknown>).p_photo_id as string).sort();
    expect(new Set(addIds).size).toBe(3);
    for (const id of addIds) expect(paths.some((p) => p.includes(id))).toBe(true);
  });

  it("3 พร้อมกันแต่ DB ตอบรูปที่ 3 ตก photo_cap_shopfloor (แข่งกัน) → ลบ object ของรูปที่ตกเท่านั้น · ตัวที่สำเร็จไม่ถูกลบ", async () => {
    let adds = 0;
    rpcMock.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "job_worker_photo_begin") {
        beginN += 1;
        return { data: { ok: true, job_id: JOB, shop_id: SHOP, photo_id: `cccccccc-cccc-4ccc-8ccc-${String(beginN).padStart(12, "0")}`, count: 0, max: 3 }, error: null };
      }
      if (name === "job_worker_photo_add") {
        adds += 1;
        if (adds === 3) return { data: { ok: false, code: "photo_cap_shopfloor", message: "x" }, error: null };
        return { data: { ok: true, photo_id: args.p_photo_id, is_primary: false, count: adds, max: 3 }, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    const results = await Promise.all([0, 1, 2].map(() => intakeUploadPhoto(TOKEN, form(file(jpeg()), file(jpeg({ w: 480, h: 320 }))))));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    const failedAdd = fn("job_worker_photo_add")[2][1] as Record<string, unknown>;
    const removed = removeMock.mock.calls[0][1] as string[];
    expect(removed).toHaveLength(2);
    expect(removed.every((p) => p.includes(failedAdd.p_photo_id as string))).toBe(true);
  });
});

void NEWPH;
