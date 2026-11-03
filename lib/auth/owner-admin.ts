// lib/auth/owner-admin.ts — allowlist ของด่านสิทธิ์ (pure · ไม่มี runtime import)
// แยกจาก role.ts โดยตั้งใจ: เทสต์ ~50 ไฟล์ mock "@/lib/auth/role" ด้วย factory ที่มีแค่ getEffectiveRole —
// ถ้า helper อยู่ใน role.ts โดยตรง ทุก action ที่ import มันจะพังใต้ mock ("no export defined on the mock")
// import จากไฟล์นี้เท่านั้น — อย่า re-export จาก role.ts (เทสต์ ~50 ไฟล์ mock role แบบ factory จะได้ undefined)
//
// ทำไม allowlist: เดิมด่านเขียน `=== "staff"` (denylist) — เพิ่มค่าใน enum shop_member_role วันหน้า
// = role ใหม่ผ่านด่าน owner/admin ทุกจุดเงียบๆ · ที่นี่ role อะไรก็ตามที่ไม่ใช่ owner/admin (รวม undefined/ค่าแปลก) = false
import type { DevRole } from "@/lib/dev/context";

export function isOwnerOrAdmin(role: DevRole): boolean {
  return role === "owner" || role === "admin";
}
