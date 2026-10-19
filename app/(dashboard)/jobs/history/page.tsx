import { Lock } from "lucide-react";
import { getJobHistory } from "@/lib/actions/job-office";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobHistory } from "@/components/domain/jobs/JobHistory";

export const dynamic = "force-dynamic";

// /jobs/history — ประวัติงาน: ใบงานแม่ที่ปิดแล้ว/ยกเลิก (owner/admin เท่านั้น · allowlist) · ค้นหา/กรองฝั่ง client จากข้อมูลที่โหลดครั้งเดียว
export default async function JobsHistoryPage() {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้ระบบใบงานได้" />;
  }
  let res;
  try {
    res = await getJobHistory();
  } catch (err) {
    logJobFailure("JobsHistoryPage", err);
    return <ErrorState message="โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  return <JobHistory data={res.data} />;
}
