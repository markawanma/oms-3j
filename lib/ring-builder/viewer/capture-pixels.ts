// lib/ring-builder/viewer/capture-pixels.ts — แปลงพิกเซลจาก renderer.captureFront() ให้ใช้วาดบน canvas 2D ได้ (pure · ไม่แตะ DOM/WebGL)
// ใช้ร่วมกันของ "บันทึกรูป" และ "แนบรูป LINE" (ห้ามเขียนซ้ำ)
//
// ปัญหาสองอย่างของ readPixels:
//   1) แถวกลับหัว (ล่างขึ้นบน) → พลิกให้บนลงล่าง
//   2) ขอบแหวนเป็นสีแบบ premultiplied: shader เขียน alpha=1 เฉพาะที่ทึบ พื้นล้างเป็น (0,0,0,0) แล้ว MSAA เฉลี่ยพิกเซลขอบ → rgb = สี × ความครอบคลุม, a = ความครอบคลุม
//      ถ้าเอาไป putImageData ตรงๆ (ซึ่งถือว่า rgb เป็น straight) ขอบจะมีขอบดำ/halo → หารด้วย alpha คืนเป็น straight alpha
//
// พิกเซลที่ alpha = 0 ทั้งภาพ = จับไม่ติด (context lost/วาดไม่ออก) → isBlankCapture() ให้ผู้เรียกปฏิเสธ ไม่ส่งภาพว่าง/ดำเป็นรูป

/** ภาพที่ไม่มีพิกเซลใดทึบเลย (alpha ทุกตัว = 0) หรือขนาดบัฟเฟอร์ไม่ตรง w×h·4 */
export function isBlankCapture(rgba: Uint8Array, w: number, h: number): boolean {
  if (rgba.length !== w * h * 4) return true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) return false;
  }
  return true;
}

/**
 * RGBA (readPixels · ล่างขึ้นบน · premultiplied-like) → RGBA (บนลงล่าง · straight alpha) ใน buffer ใหม่
 * ขนาดไม่ตรง w×h·4 = throw (ผู้เรียกจับเป็น "สร้างรูปไม่สำเร็จ")
 */
export function toTopDownStraightRgba(src: Uint8Array, w: number, h: number): Uint8ClampedArray {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || src.length !== w * h * 4) throw new Error("capture-pixels: ขนาดไม่ตรง");
  const out = new Uint8ClampedArray(src.length);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const from = (h - 1 - y) * rowBytes;
    const to = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 4) {
      const a = src[from + x + 3];
      if (a === 0) continue; // โปร่งใสทั้งพิกเซล (out เริ่มที่ 0 อยู่แล้ว)
      if (a === 255) {
        out[to + x] = src[from + x];
        out[to + x + 1] = src[from + x + 1];
        out[to + x + 2] = src[from + x + 2];
        out[to + x + 3] = 255;
      } else {
        // straight = premultiplied ÷ alpha (ปัดใกล้สุด · Uint8ClampedArray ตัดที่ 255 ให้เอง)
        out[to + x] = Math.round((src[from + x] * 255) / a);
        out[to + x + 1] = Math.round((src[from + x + 1] * 255) / a);
        out[to + x + 2] = Math.round((src[from + x + 2] * 255) / a);
        out[to + x + 3] = a;
      }
    }
  }
  return out;
}
