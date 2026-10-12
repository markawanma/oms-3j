// lib/marketing/page-gate.ts — ด่านสิทธิ์ของ "หน้า" สายงาน content (คู่กับ requireOwnerAdmin ของ action)
// allowlist เท่านั้น: owner | admin — role ที่ไม่รู้จัก/อนาคต/undefined ไม่ผ่านโดยปริยาย (security L3 · เดิมหน้าเช็ค "ไม่ใช่ staff" ซึ่งปล่อย role แปลกผ่าน)

import "server-only";
import { getEffectiveRole } from "@/lib/auth/role";

export async function canUseContentWorkflow(): Promise<boolean> {
  const role = await getEffectiveRole();
  return role === "owner" || role === "admin";
}
