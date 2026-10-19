// lib/images/server.ts — ด่าน Exif/XMP ของรูปใบงาน (0182 · design-job-photos.md §2.4 · เคสห้ามผ่าน "Exif/GPS ค้าง")
// bytes สังเคราะห์ (ไม่ต้องมีรูปจริง) — QA ยิงไฟล์ JPEG ที่มี GPS จริงเข้า action อีกชั้นหนึ่ง (lib/actions/job-photos.test.ts ครอบ action ด้วย bytes เดียวกัน)
import { describe, expect, it } from "vitest";
import { extractJpegDimensions, findExifApp1, findXmpApp1, hasCameraMetadata, looksLikeJpeg } from "./server";

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
