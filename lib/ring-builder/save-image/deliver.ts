// lib/ring-builder/save-image/deliver.ts — ส่งไฟล์รูปให้ผู้ใช้ (ux-ring-save-image §3.1) · client-only ไม่มี network/storage
// ลำดับ: A) Web Share พร้อมไฟล์ → ถ้าไม่ได้/ล้ม C) ให้เปิด sheet รูปกดค้างบันทึก (ผู้เรียกทำ) · ไม่มี <a download> ใน v1 (§3.2)
//   shared   = เมนูแชร์ถูกเปิดแล้วปิด (resolve) — 🔴 ไม่ได้แปลว่ารูปลงอัลบั้ม ห้ามขึ้น "บันทึกแล้ว" (S7)
//   aborted  = ผู้ใช้ยกเลิกเมนูแชร์ (AbortError) — ไม่ใช่ error (S8) จบเงียบ
//   needSheet= ใช้ Web Share ไม่ได้ (ไม่มี API · canShare ไม่รับไฟล์ · NotAllowedError เช่น gesture หมดอายุ · ล้มอื่นๆ) → เปิด sheet
// ไม่ส่ง title/text/url ไปกับรูป (ไม่พาลิงก์ไปด้วย)
export type DeliverResult = "shared" | "aborted" | "needSheet";

export interface ShareNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
}

function defaultNav(): ShareNavigator | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as unknown as ShareNavigator);
}

/** เครื่องนี้แชร์ไฟล์นี้ได้ไหม (ไม่ throw) — ใช้ตัดสินว่าปุ่มใน sheet มีประโยชน์ไหม */
export function canShareFile(file: File, nav: ShareNavigator | undefined = defaultNav()): boolean {
  try {
    return typeof nav?.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

/**
 * เรียกจาก click handler: ส่วน sync ก่อน await แรกคือ canShare + เรียก share() — ให้ถูกเรียกใน gesture เดียวกันเมื่อไฟล์พร้อมแล้ว (ปุ่มใน sheet)
 * ไม่ throw ออกนอก
 */
export async function deliverImage(file: File, nav: ShareNavigator | undefined = defaultNav()): Promise<DeliverResult> {
  if (!canShareFile(file, nav)) return "needSheet";
  try {
    await (nav as Required<Pick<ShareNavigator, "share">>).share({ files: [file] });
    return "shared";
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === "AbortError") return "aborted";
    return "needSheet";
  }
}
