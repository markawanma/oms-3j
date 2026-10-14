// lib/jobs/nav.ts — ความกว้างเนื้อหาของหน้าใบงาน (pure)

/**
 * บอร์ดใบงาน (/jobs เท่านั้น) ขยายความกว้างเนื้อหาเป็น max-w-6xl เท่า marketing — บอร์ดคอลัมน์ต้องการที่
 * exact path: ไม่รวม /jobs/[id] · /jobs/workers · /jobs/[id]/print (คงความกว้างเดิม) · รองรับ "/jobs/" ท้าย slash
 * DashboardShell เรียกคู่กับ isWideMarketingPath (ไม่แก้ของ marketing)
 */
export function isWideJobsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/jobs" || pathname === "/jobs/";
}
