import { Lock } from "lucide-react";
import { redirect } from "next/navigation";
import { getJobDetail } from "@/lib/actions/job-office";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobDetailClient } from "@/components/domain/jobs/JobDetailClient";

export const dynamic = "force-dynamic";

// /jobs/[id] — หน้าใบงาน (ออฟฟิศ owner/admin): ขั้นตอน · น้ำหนัก · ประวัติ · ปุ่มกรอกแทน/ข้าม/ย้อน/กำหนดส่ง/ปิด/ยกเลิก/พิมพ์
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้ระบบใบงานได้" />;
  }
  const { id } = await params;
  let res;
  try {
    res = await getJobDetail(id);
  } catch (err) {
    logJobFailure("JobDetailPage", err);
    return <ErrorState message="โหลดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  if (!res.data) return <EmptyState title="ไม่พบใบงานนี้" description="ใบงานอาจไม่มีอยู่ หรือเป็นของร้านอื่น" />;
  // 0181: ส่วนย่อยไม่มีหน้าของตัวเอง → ไปใบแม่ เลื่อนมาที่ส่วนนั้น
  if (res.data.partOf) redirect(`/jobs/${res.data.partOf}#part-${id}`);
  return <JobDetailClient data={res.data} />;
}
