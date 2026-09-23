// scripts/lib/format-error.mjs
//
// Pure helper — ไม่มี side effect, ไม่อ่าน env, ไม่ยิง network. ทำ error
// ให้เป็นข้อความบรรทัดเดียวที่ปลอดภัยพอจะลง log ของสคริปต์ที่รันจาก
// Windows Task Scheduler / CI
//
// 🔴 ทำไมห้าม console.error(err) ทั้งก้อน:
// console.error ของ Node เรียก util.inspect ให้อัตโนมัติ ซึ่งพิมพ์ทั้ง stack
// และ cause chain ออกมาหมด — `fetch failed` ของ undici พ่วง err.cause ที่มี
// host/port/URL ของปลายทางติดมาด้วย สำหรับสคริปต์ชุดนี้คือ Supabase project
// URL (subdomain = project ref) และ endpoint ภายในอื่นๆ ที่ไม่ควรไปนอนอยู่ใน
// log ไฟล์ ของเดิมพิมพ์ทั้งก้อน — เจอตอน security audit 23 ก.ย. 69
// (จัดระดับ Low: log อยู่บนเครื่องเรา แต่ไม่มีเหตุผลให้มันหลุดออกมาตั้งแต่แรก)
//
// 🔴 กับดักที่ทำให้ลอก `${err.name}: ${err.message}` ตรงๆ ไม่พอ:
// supabase-js คืน error เป็น plain object ไม่ใช่ instance ของ Error (ไม่มี
// .name) — และสคริปต์ชุดนี้ `throw error` ตัวนั้นต่อขึ้นมาที่ catch ชั้นบน
// สุดเป็นเคสที่เจอบ่อยที่สุด ถ้าใช้ err.name ตรงๆ จะได้ log ว่า
// "undefined: ..." ซึ่งอ่านแล้วงงกว่าเดิม ฟังก์ชันนี้จึงแยกสองทางให้
//
// ฝั่งแอปมี lib/supabase/postgrest-error.ts (readErrorMessage/readErrorCode)
// ที่อ่าน message/code แบบ structural ด้วยเหตุผลเดียวกัน — ไฟล์นี้ไม่ import
// ตัวนั้นเพราะสคริปต์ใน scripts/ รันด้วย `node` ตรงๆ ไม่ผ่าน bundler จึง
// import .ts ไม่ได้ ถ้าจะแก้กฎการอ่าน error ให้แก้ให้ตรงกันทั้งสองไฟล์
//
// สิ่งที่ยอมให้ออก log: name / message / code (Postgres SQLSTATE) เท่านั้น
// สิ่งที่ไม่ยอม: cause, stack, details, ตัว object ดิบ — details ของ
// PostgrestError เป็น free-form (บางทีมีค่าของแถวที่ชนกัน = ข้อมูลลูกค้า)
// ส่วน stack/cause คือจุดที่ URL หลุด

/**
 * @param {unknown} err  อะไรก็ได้ที่ถูก throw ขึ้นมา
 * @returns {string} ข้อความบรรทัดเดียว ไม่มี URL/stack/cause
 */
export function formatError(err) {
  if (err instanceof Error) {
    // ไม่แตะ err.cause / err.stack โดยตั้งใจ — ดูหัวไฟล์
    return `${err.name}: ${err.message}`;
  }

  if (err !== null && typeof err === "object") {
    // เคส supabase-js / PostgrestError: { message, details, hint, code }
    const message = typeof err.message === "string" && err.message.trim() ? err.message.trim() : null;
    const code = typeof err.code === "string" && err.code.trim() ? err.code.trim() : null;
    if (message && code) return `${code}: ${message}`;
    if (message) return message;
    if (code) return `error code ${code}`;
    // ไม่มีทั้ง message และ code — บอกแค่ชนิด ห้าม JSON.stringify ทั้งก้อน
    // เพราะนั่นคือการพิมพ์ object ดิบที่กำลังจะเลี่ยงอยู่
    return `(error object ไม่มี message/code — ชนิด ${err.constructor?.name ?? "Object"})`;
  }

  // primitive ที่ถูก throw (string/number/undefined) — String() ปลอดภัยอยู่แล้ว
  return String(err);
}
