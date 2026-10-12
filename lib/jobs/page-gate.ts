// lib/jobs/page-gate.ts — ด่านสิทธิ์ของ "หน้าออฟฟิศ" ระบบใบงาน (คู่กับ requireOwnerAdmin ของ action) · allowlist owner | admin เท่านั้น
// role แปลก/อนาคต/undefined ไม่ผ่านโดยปริยาย (บทเรียน security P1b L3 — เดิมเช็ค "ไม่ใช่ staff" ซึ่งปล่อย role แปลกผ่าน)
// หน้าช่าง /w/ ไม่ใช้ไฟล์นี้ — ไม่มี session แอป ใช้ token + PIN ผ่าน RPC

import "server-only";
import { getEffectiveRole } from "@/lib/auth/role";

export async function canManageJobs(): Promise<boolean> {
  const role = await getEffectiveRole();
  return role === "owner" || role === "admin";
}
