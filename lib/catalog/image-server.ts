// lib/catalog/image-server.ts — server-side (Node-safe, no DOM/canvas)
// byte-level checks for uploaded product images. Plain module, no "use
// server" — imported by lib/actions/catalog-images.ts and unit-tested
// directly (pure buffer parsing, no browser APIs, unlike lib/catalog/
// image-client.ts's resize step).
//
// OWN ADDITION beyond the design brief: the design only asked for a magic-
// byte JPEG check server-side ("ตรวจ magic bytes ว่าเป็น JPEG จริง"); it did
// not specify how width/height (required columns on public.product_image,
// 0104) get populated. Rather than trust client-reported dimensions (the
// server action's FormData contract only carries `productId, md, sm` per
// the design's own function signature — no width/height fields), this file
// derives them from the actual uploaded bytes server-side. See the handoff
// report for the trade-off.

/** Magic-byte check — every real JPEG starts with the SOI marker (FF D8)
 * followed by another FF (start of the first marker segment, almost always
 * APP0/APP1). Mirrors lib/labels/pdf.ts's looksLikePdf: never trust the
 * client's declared Content-Type/extension, check the bytes themselves. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export interface JpegDimensions {
  width: number;
  height: number;
}

// Start-Of-Frame marker range covering every JPEG encoding mode a browser's
// canvas.toBlob('image/jpeg') can realistically produce (baseline 0xC0,
// progressive 0xC2, etc.) while excluding markers that share the 0xC0-0xCF
// byte range but aren't SOF (0xC4 DHT, 0xC8 JPG reserved, 0xCC DAC).
function isSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

/**
 * Walks the JPEG marker segments to find the SOF segment and read its
 * width/height fields directly — no decoding, just header parsing, so this
 * works even on a JPEG this app couldn't otherwise render. Returns null
 * (never throws) on anything that doesn't look like a well-formed JPEG
 * marker stream; callers must treat that as "dimensions unknown," not an
 * upload failure (see 0104's column comment: width/height are informational
 * only).
 */
export function extractJpegDimensions(bytes: Uint8Array): JpegDimensions | null {
  if (!looksLikeJpeg(bytes)) return null;

  let offset = 2; // past the SOI marker (FF D8)
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resync on a stray non-marker byte rather than bail out
      continue;
    }
    const marker = bytes[offset + 1];

    // Markers with no length-prefixed payload: TEM (0x01) and the restart
    // markers RST0-RST7 (0xD0-0xD7) — skip just the 2 marker bytes.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null; // EOI reached, no SOF found — not fatal, just unknown

    if (offset + 4 > bytes.length) return null; // truncated before a length field
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null; // malformed — a valid segment length always counts itself

    if (isSofMarker(marker)) {
      // Payload after the 2-byte length: 1 byte precision, 2 bytes height,
      // 2 bytes width, ...
      if (offset + 9 > bytes.length) return null;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }

    offset += 2 + segmentLength;
  }
  return null;
}
