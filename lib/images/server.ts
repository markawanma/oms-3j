// lib/images/server.ts (เดิม lib/catalog/image-server.ts) — server-side (Node-safe, no DOM/canvas)
// byte-level checks for uploaded images. Plain module, no "use server" — imported by lib/actions/catalog-images.ts +
// lib/actions/job-photos.ts and unit-tested directly (pure buffer parsing, no browser APIs, unlike lib/images/client.ts's resize step).
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

// ============================================================================
// 0182 รูปใบงาน: ปฏิเสธไฟล์ที่ยังมีข้อมูลจากกล้อง (Exif / XMP — GPS อยู่ในนี้) — design-job-photos.md §2.4
// ============================================================================
// client ย่อรูปผ่าน canvas ซึ่งทิ้ง metadata ทั้งหมดโดยโครงสร้าง (ดู lib/images/client.ts) แต่ action รับไฟล์จากใคร/อะไรก็ได้ที่ยิงตรง (ข้าม client) —
// server จึงยืนยันซ้ำ · "ไม่ strip เอง" โดยตั้งใจ: เขียน JPEG ใหม่ฝั่ง server โดยไม่มีไลบรารี = ความเสี่ยงที่ไม่คุ้ม (เหตุผลเดียวกับ 0105 ที่ไม่เอา sharp) — ปฏิเสธแล้วให้ผู้ใช้อัปผ่านหน้าเว็บ
//
// วิธีตรวจ = สแกน byte ทั้งไฟล์หาลำดับ "FF E1 <len 2 byte> <signature>" ไม่เดิน marker ทีละ segment: ข้อมูลภาพที่บีบอัดแล้วไม่มีทางมี FF E1 ดิบ (FF ในข้อมูลถูกแทรก 00 เสมอ)
// ⇒ เจอลำดับนี้ = marker APP1 จริง · ไม่พึ่ง parser ที่ resync ข้ามขยะ (ผู้ส่งซ่อน APP1 หลัง byte แปลกๆ เพื่อหลบ walker ไม่ได้) · ไฟล์ 1 MB สแกนไม่ถึงมิลลิวินาที

const EXIF_SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_SIG = Array.from("http://ns.adobe.com/xap/1.0/\0", (c) => c.charCodeAt(0));

function hasApp1(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (!looksLikeJpeg(bytes)) return false;
  const last = bytes.length - (4 + sig.length);
  for (let i = 0; i <= last; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xe1) continue;
    let ok = true;
    for (let k = 0; k < sig.length; k++) {
      if (bytes[i + 4 + k] !== sig[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** มี segment APP1 ที่ payload ขึ้นต้น "Exif\0\0" (EXIF — รวม GPS/รุ่นกล้อง/เวลา) หรือไม่ · ไม่ใช่ JPEG = false (ด่าน looksLikeJpeg แยกต่างหาก) · ไม่ throw */
export function findExifApp1(bytes: Uint8Array): boolean {
  return hasApp1(bytes, EXIF_SIG);
}

/** (ตัดสินเอง นอก design) XMP packet ใน APP1 อาจมี exif:GPS* เหมือนกัน — canvas ไม่เคยเขียน XMP จึงไม่กระทบผู้ใช้ปกติ */
export function findXmpApp1(bytes: Uint8Array): boolean {
  return hasApp1(bytes, XMP_SIG);
}

/** ไฟล์ยังมี metadata จากกล้องที่ต้องล้างก่อน (Exif หรือ XMP) */
export function hasCameraMetadata(bytes: Uint8Array): boolean {
  return findExifApp1(bytes) || findXmpApp1(bytes);
}
