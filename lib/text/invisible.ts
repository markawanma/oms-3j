// lib/text/invisible.ts — อักขระล่องหน/bidi/zero-width (leaf module · ไม่มี import · ใช้ได้ทั้งฝั่งออฟฟิศและกราฟสาธารณะของหน้างาน)
// แยกออกมาจาก lib/oem/display.ts (W3 UI): lib/jobs/shop-gems.ts (ตัวตรวจชื่อพลอย) ต้องอยู่ในกราฟหน้า /w/s/ ซึ่งห้ามลาก lib/oem/* (worker-boundary.shop.test)
// lib/oem/display.ts re-export ของเดิมทุกตัว — import เดิมใช้ต่อได้ · ค่า regex ย้ายมาทั้งก้อน ไม่แก้ (มีเทสต์ lib/text/invisible.test.ts เทียบกับที่ฝัง)

/** 0165: อักขระล่องหน/bidi/zero-width ที่ห้ามอยู่ในข้อความที่ขึ้นเอกสาร (ชื่อลูกค้า/ช่องทางติดต่อ/เหตุผลราคาพิเศษ/ชื่อพลอย)
 * ชุดเดียวกับ analytics.oem_text_strip_invisible (0165) — แก้ที่หนึ่งต้องแก้อีกที่ · ไม่รวม U+FE00-FE0F (emoji VS16)
 * ZWJ (U+200D) ผ่านเฉพาะที่คั่นระหว่างสัญลักษณ์/อีโมจิสองตัว (อีโมจิครอบครัว) ZWJ ที่อื่นถือเป็นล่องหน */
export const OEM_INVISIBLE_RE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|(?<![\u2600-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F])\u200D|\u200D(?![\u2600-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}])/u;
const OEM_INVISIBLE_RE_G = new RegExp(OEM_INVISIBLE_RE.source, "gu");

/** 0165 L2: ลบอักขระล่องหน/bidi ออกจากข้อความ (ว่างหลังลบ = ไม่มีเนื้อหา) · ไม่ใช่ string = "" */
export function stripInvisibleText(value: unknown): string {
  return typeof value === "string" ? value.replace(OEM_INVISIBLE_RE_G, "") : "";
}
