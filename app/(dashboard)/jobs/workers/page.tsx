import { Lock } from "lucide-react";
import { getShopIntakeStatus, getWorkers } from "@/lib/actions/job-workers";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { WorkersClient } from "@/components/domain/jobs/WorkersClient";

export const dynamic = "force-dynamic";

// /jobs/workers — ทะเบียนช่าง (owner/admin): ชื่อ · ขั้นที่ทำ · PIN (แสดงครั้งเดียว) · ปิด/เปิดใช้งาน
export default async function JobWorkersPage() {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการทะเบียนช่างได้" />;
  }
  let res;
  let qr;
  try {
    [res, qr] = await Promise.all([getWorkers(), getShopIntakeStatus()]);
  } catch (err) {
    logJobFailure("JobWorkersPage", err);
    return <ErrorState message="โหลดทะเบียนช่างไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  // W1: สถานะ QR ร้านอ่านไม่ได้ ≠ ทะเบียนช่างพัง — การ์ดขึ้นข้อความของตัวเอง ทะเบียนใช้งานต่อได้
  return <WorkersClient data={res.data} intake={{ status: qr.ok ? qr.data : null, error: qr.ok ? null : "อ่านสถานะ QR ร้านไม่สำเร็จ — โหลดหน้าใหม่แล้วลองอีกครั้ง" }} />;
}
