// lib/images/server.ts — ด่าน Exif/XMP ของรูปใบงาน (0182 · design-job-photos.md §2.4 · เคสห้ามผ่าน "Exif/GPS ค้าง")
// bytes สังเคราะห์ (ไม่ต้องมีรูปจริง) — QA ยิงไฟล์ JPEG ที่มี GPS จริงเข้า action อีกชั้นหนึ่ง (lib/actions/job-photos.test.ts ครอบ action ด้วย bytes เดียวกัน)
import { describe, expect, it } from "vitest";
import { cleanJpegForStorage, extractJpegDimensions, findExifApp1, findXmpApp1, hasCameraMetadata, looksLikeJpeg, stripJpegMetadata } from "./server";

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** segment ที่มี marker + length + payload */
function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const SOI = [0xff, 0xd8];
const JFIF = segment(0xe0, [...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const SOF0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x01, 0x01, 0x11, 0x00];
const EOI = [0xff, 0xd9];
// TIFF header (little-endian) + IFD0 ที่มี tag 0x8825 (GPS IFD pointer) — โครงจริงของ Exif ที่มีตำแหน่ง GPS
const EXIF_WITH_GPS = [...ascii("Exif"), 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const XMP = [...ascii("http://ns.adobe.com/xap/1.0/"), 0x00, ...ascii("<x:xmpmeta><exif:GPSLatitude>13,45.0N</exif:GPSLatitude></x:xmpmeta>")];

const jpeg = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

describe("findExifApp1 — ปฏิเสธไฟล์ที่ยังมี Exif", () => {
  it("canvas output (JFIF อย่างเดียว ไม่มี APP1) ไม่ถูกจับ — ผู้ใช้ปกติผ่านหน้าเว็บไม่เจอด่านนี้", () => {
    const clean = jpeg(SOI, JFIF, SOF0, EOI);
    expect(findExifApp1(clean)).toBe(false);
    expect(findXmpApp1(clean)).toBe(false);
    expect(hasCameraMetadata(clean)).toBe(false);
    expect(looksLikeJpeg(clean)).toBe(true);
    expect(extractJpegDimensions(clean)).toEqual({ width: 1200, height: 800 });
  });

  it("JPEG ที่มี APP1 Exif (มี GPS IFD) ถูกจับ — ตำแหน่งปกติหลัง SOI", () => {
    const withExif = jpeg(SOI, segment(0xe1, EXIF_WITH_GPS), JFIF, SOF0, EOI);
    expect(findExifApp1(withExif)).toBe(true);
    expect(hasCameraMetadata(withExif)).toBe(true);
  });

  it("Exif หลัง JFIF (ตำแหน่งที่ซ่อนได้) ก็ถูกจับ", () => {
    expect(findExifApp1(jpeg(SOI, JFIF, segment(0xe1, EXIF_WITH_GPS), SOF0, EOI))).toBe(true);
  });

  it("Exif ท้ายสุดของส่วนหัว (ก่อน SOF) และไฟล์ที่ Exif ถูกตัดสั้น (payload ขาด) ก็ถูกจับ — ไม่พึ่ง length ที่ถูกต้อง", () => {
    expect(findExifApp1(jpeg(SOI, JFIF, SOF0, segment(0xe1, EXIF_WITH_GPS), EOI))).toBe(true);
    // ประกาศ length ใหญ่เกินจริง (ผู้ส่งตั้งใจให้ parser เดินข้าม) — สแกน byte ยังเจอ marker+signature
    const lying = [0xff, 0xe1, 0xff, 0xff, ...ascii("Exif"), 0x00, 0x00, 0x49, 0x49];
    expect(findExifApp1(jpeg(SOI, JFIF, lying))).toBe(true);
  });

  it("ซ่อน APP1 หลังขยะ/ไบต์แปลกที่ parser แบบเดินทีละ segment อาจข้าม ก็ถูกจับ", () => {
    expect(findExifApp1(jpeg(SOI, [0xff, 0x00, 0x13, 0x37], segment(0xe1, EXIF_WITH_GPS), JFIF, SOF0, EOI))).toBe(true);
  });

  it("APP1 ที่ไม่ใช่ Exif (ขึ้นต้นอย่างอื่น) และ COM ที่เขียนคำว่า Exif ไม่ถูกจับ (กัน false positive)", () => {
    expect(findExifApp1(jpeg(SOI, segment(0xe1, ascii("NotExifHere")), JFIF, SOF0, EOI))).toBe(false);
    expect(findExifApp1(jpeg(SOI, segment(0xfe, ascii("Exif\0\0 comment")), JFIF, SOF0, EOI))).toBe(false);
  });

  it("ไม่ใช่ JPEG (PNG/SVG/HTML/ว่าง/สั้น) → false ไม่ throw — ด่าน looksLikeJpeg เป็นคนปฏิเสธชนิดไฟล์", () => {
    expect(findExifApp1(new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...ascii("Exif\0\0")]))).toBe(false);
    expect(findExifApp1(new Uint8Array(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")))).toBe(false);
    expect(findExifApp1(new Uint8Array([]))).toBe(false);
    expect(findExifApp1(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });

  it("ไฟล์ 1 MB ที่ไม่มี Exif สแกนจบเร็ว (ไม่เป็นปัญหาต่อ request)", () => {
    const big = new Uint8Array(1_048_576);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const t0 = Date.now();
    expect(findExifApp1(big)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe("findXmpApp1 (นอก design) — XMP ที่อาจมี exif:GPS", () => {
  it("APP1 XMP ถูกจับ · hasCameraMetadata = true", () => {
    const withXmp = jpeg(SOI, segment(0xe1, XMP), JFIF, SOF0, EOI);
    expect(findXmpApp1(withXmp)).toBe(true);
    expect(findExifApp1(withXmp)).toBe(false);
    expect(hasCameraMetadata(withXmp)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H1 (security 0182): stripJpegMetadata — ตัด metadata ระดับ marker ฝั่ง server (ไม่ decode/re-encode)
// ---------------------------------------------------------------------------
const DQT = segment(0xdb, [0x00, ...new Array(64).fill(0x03)]);
const DHT = segment(0xc4, [0x00, ...new Array(16).fill(0), 0x01]);
const DRI = segment(0xdd, [0x00, 0x04]);
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0xff, 0x00, 0x9a]; // FF00 (byte ที่ถูกแทรก) + RST0 อยู่ในข้อมูลภาพ — ต้องรอดครบ
const ICC = segment(0xe2, [...ascii("ICC_PROFILE"), 0x00, 0x01, 0x01, 0xaa, 0xbb, 0xcc]);
const SOFW = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x01, 0x01, 0x11, 0x00]; // 1200×800
const full = (...head: number[][]) => jpeg(SOI, ...head, DQT, SOFW, DHT, SOS, SCAN, EOI);
const latin = (b: Uint8Array | null): string => Buffer.from(b ?? []).toString("latin1");

describe("stripJpegMetadata — ตัด metadata เก็บภาพ", () => {
  it("ภาพสะอาดผ่านโดยไม่เปลี่ยนสักไบต์ (JFIF · DQT · SOF · DHT · SOS · ข้อมูลภาพ · EOI)", () => {
    const clean = full(JFIF);
    expect(stripJpegMetadata(clean)).toEqual(clean);
  });

  it("Exif GPS ถูกตัด · ภาพ/ตาราง/ICC ครบ · ตรวจซ้ำแล้วไม่เหลือ metadata", () => {
    const dirty = full(segment(0xe1, EXIF_WITH_GPS), JFIF, ICC);
    expect(findExifApp1(dirty)).toBe(true);
    const out = stripJpegMetadata(dirty);
    expect(out).not.toBeNull();
    expect(findExifApp1(out as Uint8Array)).toBe(false);
    expect(hasCameraMetadata(out as Uint8Array)).toBe(false);
    expect(latin(out)).not.toContain("Exif");
    expect(out).toEqual(full(JFIF, ICC)); // ผลเท่ากับไฟล์ที่ไม่เคยมี Exif เลย
    expect(extractJpegDimensions(out as Uint8Array)).toEqual({ width: 1200, height: 800 });
  });

  it("ICC (APP2 ICC_PROFILE) คงอยู่ · ตารางทั้งหมดคงอยู่ · ข้อมูลภาพรวม FF00 และ RST ภายในคงอยู่เป๊ะ", () => {
    const out = stripJpegMetadata(full(JFIF, ICC, DRI)) as Uint8Array;
    const txt = latin(out);
    expect(txt).toContain("ICC_PROFILE");
    expect(txt).toContain("JFIF");
    expect(Buffer.from(out).includes(Buffer.from(SCAN))).toBe(true);
    expect(Buffer.from(out).includes(Buffer.from(DQT))).toBe(true);
    expect(Buffer.from(out).includes(Buffer.from(DHT))).toBe(true);
    expect(Buffer.from(out).includes(Buffer.from(DRI))).toBe(true);
  });

  it("ตัด: XMP · Extended XMP (APP1) · APP3–APP15 (APP13 IPTC · APP14 Adobe) · COM · APP0 JFXX (thumbnail ฝัง) · APP2 ที่ไม่ใช่ ICC (MPF) · APP0 ที่ไม่ใช่ JFIF", () => {
    const xmp = segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<exif:GPSLatitude>13.7</exif:GPSLatitude>")]);
    const xmpExt = segment(0xe1, [...ascii("http://ns.adobe.com/xmp/extension/"), 0, ...ascii("A".repeat(40))]);
    const app13 = segment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("secret-iptc-name")]);
    const app14 = segment(0xee, ascii("Adobe-secret"));
    const app3 = segment(0xe3, ascii("Meta-secret"));
    const com = segment(0xfe, ascii("comment-secret"));
    const jfxx = segment(0xe0, [...ascii("JFXX"), 0x00, 0x10, 0xff, 0xd8, ...ascii("thumb-Exif-secret"), 0xff, 0xd9]);
    const mpf = segment(0xe2, [...ascii("MPF"), 0x00, ...ascii("mpf-secret")]);
    const otherApp0 = segment(0xe0, ascii("AVI1secret"));
    const out = stripJpegMetadata(full(JFIF, xmp, xmpExt, app13, app14, app3, com, jfxx, mpf, otherApp0, ICC));
    const txt = latin(out);
    for (const leak of ["xap", "xmp", "GPS", "Photoshop", "secret", "Adobe", "thumb", "MPF", "AVI1"]) expect(txt, leak).not.toContain(leak);
    expect(out).toEqual(full(JFIF, ICC));
    expect(hasCameraMetadata(out as Uint8Array)).toBe(false);
  });

  it("ทุกอย่างหลัง EOI ถูกตัด (Exif ท้ายไฟล์ · ZIP/HTML ต่อท้าย · JPEG ซ้อน)", () => {
    const clean = full(JFIF);
    for (const tail of [segment(0xe1, EXIF_WITH_GPS), ascii("PK\x03\x04zip-payload"), ascii("<script>alert(1)</script>"), [...SOI, ...JFIF, ...EOI]]) {
      const out = stripJpegMetadata(jpeg(Array.from(clean), tail));
      expect(out).toEqual(clean);
    }
  });

  it("fill bytes (FF FF) ก่อน marker ในส่วนหัวและในข้อมูลภาพ: ยอมรับ · ผลไม่มี fill เกินใน marker", () => {
    const withFill = jpeg(SOI, [0xff, 0xff, 0xff], JFIF, [0xff, 0xff], DQT, SOFW, DHT, SOS, [0x12, 0x34], [0xff, 0xff], EOI);
    const out = stripJpegMetadata(withFill);
    expect(out).not.toBeNull();
    expect(extractJpegDimensions(out as Uint8Array)).toEqual({ width: 1200, height: 800 });
  });

  it("RST marker: ในข้อมูลภาพคงอยู่ · นอกข้อมูลภาพ (ส่วนหัว) ถูกทิ้ง ไม่ทำให้พัง", () => {
    const rstInHeader = jpeg(SOI, JFIF, [0xff, 0xd3], DQT, SOFW, DHT, SOS, SCAN, EOI);
    const out = stripJpegMetadata(rstInHeader);
    expect(out).toEqual(full(JFIF));
    expect(Buffer.from(out as Uint8Array).includes(Buffer.from(SCAN))).toBe(true);
  });

  it("progressive: หลาย scan (SOS · DHT · SOS) คงอยู่ครบ", () => {
    const prog = jpeg(SOI, JFIF, DQT, [0xff, 0xc2, 0x00, 0x0b, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x01, 0x01, 0x11, 0x00], DHT, SOS, SCAN, DHT, SOS, [0x01, 0xff, 0x00, 0x02], EOI);
    const out = stripJpegMetadata(jpeg(SOI, segment(0xe1, EXIF_WITH_GPS), Array.from(prog).slice(2)));
    expect(out).toEqual(prog);
  });

  it("🔴 ไฟล์พัง/polyglot/ไม่รู้จัก → null (ผู้เรียกปฏิเสธ): ไม่ใช่ JPEG · ว่าง · byte ขยะระหว่าง segment · ไม่มี SOF · ไม่มี SOS · ไม่มี EOI · ตัดกลางข้อมูลภาพ · SOS ก่อน SOF · SOF ซ้ำ · marker ไม่รู้จัก · length เกิน/น้อยกว่า 2 · SOI ซ้ำ · FF00 นอกข้อมูลภาพ", () => {
    const bad: Record<string, Uint8Array> = {
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
      empty: new Uint8Array([]),
      soiOnly: new Uint8Array([0xff, 0xd8]),
      html: new Uint8Array(ascii("<html><script>x</script></html>")),
      junkBetween: jpeg(SOI, JFIF, ascii("<script>alert(1)</script>"), DQT, SOFW, DHT, SOS, SCAN, EOI),
      noSof: jpeg(SOI, JFIF, DQT, DHT, SOS, SCAN, EOI),
      noSos: jpeg(SOI, JFIF, DQT, SOFW, DHT, EOI),
      noEoi: jpeg(SOI, JFIF, DQT, SOFW, DHT, SOS, SCAN),
      truncatedScan: jpeg(SOI, JFIF, DQT, SOFW, DHT, SOS, [0x12, 0x34]),
      sosFirst: jpeg(SOI, JFIF, DQT, DHT, SOS, SCAN, SOFW, EOI),
      twoSof: jpeg(SOI, JFIF, DQT, SOFW, SOFW, DHT, SOS, SCAN, EOI),
      unknownMarker: jpeg(SOI, JFIF, segment(0xf3, [1, 2, 3]), DQT, SOFW, DHT, SOS, SCAN, EOI),
      reservedMarker: jpeg(SOI, JFIF, segment(0x05, [1, 2, 3]), DQT, SOFW, DHT, SOS, SCAN, EOI),
      lenOverrun: jpeg(SOI, [0xff, 0xdb, 0xff, 0xf0, 0x00]),
      lenTooSmall: jpeg(SOI, [0xff, 0xdb, 0x00, 0x01, 0x00], SOFW, SOS, SCAN, EOI),
      soiTwice: jpeg(SOI, JFIF, SOI, DQT, SOFW, DHT, SOS, SCAN, EOI),
      ff00Outside: jpeg(SOI, JFIF, [0xff, 0x00], DQT, SOFW, DHT, SOS, SCAN, EOI),
      zeroDims: jpeg(SOI, JFIF, DQT, [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x11, 0x00], DHT, SOS, SCAN, EOI),
    };
    for (const [name, b] of Object.entries(bad)) expect(stripJpegMetadata(b), name).toBeNull();
  });

  it("ไม่ throw กับ input แปลก (ไฟล์สุ่ม 2000 ไฟล์ที่ขึ้นต้นเป็น JPEG)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 0) / 0x7fffffff;
    for (let i = 0; i < 2000; i++) {
      const len = 4 + Math.floor(rnd() * 200);
      const b = new Uint8Array(len);
      for (let k = 0; k < len; k++) b[k] = rnd() < 0.3 ? 0xff : Math.floor(rnd() * 256);
      b.set([0xff, 0xd8, 0xff]);
      expect(() => stripJpegMetadata(b)).not.toThrow();
      const r = stripJpegMetadata(b);
      if (r) expect(hasCameraMetadata(r)).toBe(false); // ถ้าผ่าน ต้องสะอาดเสมอ
    }
  });
});

describe("cleanJpegForStorage — ด่านสุดท้ายก่อนเก็บ", () => {
  it("ok: ได้ bytes ที่ตัดแล้ว · broken: โครงพัง · too_large: เกินเพดานหลังตัด (นับหลังตัด ไม่ใช่ก่อน)", () => {
    const dirty = full(segment(0xe1, [...EXIF_WITH_GPS, ...new Array(500).fill(0x41)]), JFIF);
    const clean = full(JFIF);
    const r = cleanJpegForStorage(dirty, clean.byteLength);
    expect(r.ok).toBe(true);
    expect(r.ok && r.bytes).toEqual(clean); // ไฟล์ก่อนตัดใหญ่กว่าเพดาน แต่หลังตัดพอดี = ผ่าน
    expect(cleanJpegForStorage(dirty, clean.byteLength - 1)).toEqual({ ok: false, reason: "too_large" });
    expect(cleanJpegForStorage(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), 1000)).toEqual({ ok: false, reason: "broken" });
  });
});
