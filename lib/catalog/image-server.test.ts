// lib/catalog/image-server.test.ts — coverage for the pure byte-parsing
// helpers in image-server.ts (magic-byte check + JPEG SOF dimension read).
// No canvas/browser APIs involved, so this runs fine under Vitest's node
// environment (vitest.config.ts).
import { describe, expect, it } from "vitest";
import { extractJpegDimensions, looksLikeJpeg } from "./image-server";

/**
 * Builds a minimal, structurally-valid JPEG marker stream: SOI -> APP0
 * (JFIF) -> SOF0 (carrying width/height) -> EOI. Not a decodable image (no
 * huffman tables/scan data) but that's fine — extractJpegDimensions only
 * walks marker headers, it never decodes pixels.
 */
function buildFakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length=16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // version
    0x00, // units
    0x00, 0x01, 0x00, 0x01, // density x/y
    0x00, 0x00, // thumbnail w/h
    0xff, 0xc0, // SOF0, length=11
    0x00, 0x0b,
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, // numComponents
    0x01, 0x11, 0x00, // component 1
    0xff, 0xd9, // EOI
  ]);
}

describe("looksLikeJpeg", () => {
  it("accepts real JPEG magic bytes (FF D8 FF)", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("rejects a PNG (89 50 4E 47)", () => {
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("rejects a buffer shorter than 3 bytes without throwing", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([]))).toBe(false);
  });
});

describe("extractJpegDimensions", () => {
  it("reads width/height from a well-formed SOF0 segment", () => {
    const bytes = buildFakeJpeg(1200, 800);
    expect(extractJpegDimensions(bytes)).toEqual({ width: 1200, height: 800 });
  });

  it("handles portrait (height > width) correctly — SOF stores height before width", () => {
    const bytes = buildFakeJpeg(480, 640);
    expect(extractJpegDimensions(bytes)).toEqual({ width: 480, height: 640 });
  });

  it("returns null for a non-JPEG buffer", () => {
    expect(extractJpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
  });

  it("returns null (not a throw) for a truncated JPEG with no SOF marker reached", () => {
    const bytes = buildFakeJpeg(100, 100).slice(0, 10);
    expect(extractJpegDimensions(bytes)).toBeNull();
  });

  it("returns null when EOI is reached with no SOF segment at all", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // SOI immediately followed by EOI
    expect(extractJpegDimensions(bytes)).toBeNull();
  });
});
