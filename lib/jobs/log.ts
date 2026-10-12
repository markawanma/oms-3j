// lib/jobs/log.ts — log ความล้มเหลวของระบบใบงานแบบปลอดภัย
// 🔴 ไม่ log ข้อความ error ดิบ/ก้อน error ทั้งก้อน/พารามิเตอร์ใดๆ: parameter ของ RPC ฝั่งช่างมี hash ของ token/session และ PIN ดิบ
//    ข้อความ Postgres บางตัวสะท้อนค่า input กลับมา — จึงเก็บเฉพาะ label + SQLSTATE + hint (ไม่มีข้อมูลผู้ใช้)

import "server-only";
import { safeLogShape } from "@/lib/jobs/messages";

export function logJobFailure(label: string, err: unknown): void {
  console.error(`${label} failed`, safeLogShape(err));
}
