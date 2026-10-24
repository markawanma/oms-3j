// ค่า LINE OA ของร้าน — ที่เดียวของทั้งแอป (gem-quiz · public layout · shop)
//
// ที่มา: เจ้าของยืนยัน 24 ต.ค. 69 — LINE OA = @3jjewelry, ลิงก์ https://lin.ee/PzIJl6j
// (ค่าเดียวกับที่เจ้าของให้ไว้ 5 ต.ค. 69 สำหรับ gem-quiz). ค่าเก่าที่แต่งผิดร้านห้ามกลับมา —
// lib/shop/line.test.ts กวาด app/ lib/ components/ ให้ล้มถ้าโผล่อีก.
// อย่า hardcode ค่านี้ที่อื่น: import จากไฟล์นี้.

/** ID ไม่มี "@" — ใช้ประกอบ line.me/R/oaMessage/%40<id>/ */
export const LINE_OA_ID = "3jjewelry";

/** ข้อความที่แสดงให้คนอ่าน */
export const LINE_OA_HANDLE = `@${LINE_OA_ID}`;

/** shortlink ที่เจ้าของให้ — ใช้กับปุ่ม/ลิงก์ "ทักแชท" ทั่วไป (ฝังข้อความไม่ได้) */
export const LINE_OA_URL = "https://lin.ee/PzIJl6j";

/** ลิงก์เปิดแชทพร้อมข้อความเตรียมไว้ (ผู้ใช้กดส่งเอง) — ใช้เมื่อต้องส่งชื่อ/รหัสสินค้าไปด้วย */
export function lineOaMessageUrl(message: string): string {
  return `https://line.me/R/oaMessage/%40${LINE_OA_ID}/?${encodeURIComponent(message)}`;
}
