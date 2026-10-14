import { Lock } from "lucide-react";
import { getJobBoard } from "@/lib/actions/job-office";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobBoard } from "@/components/domain/jobs/JobBoard";

export const dynamic = "force-dynamic";

// /jobs — บอร์ดใบงานผลิต v2 (owner/admin เท่านั้น · allowlist) · ส่วนบน "งานที่วิ่งอยู่" + ตามขั้นตอนการผลิต · รีเฟรชเองทุก 30 วินาที (h1 อยู่ใน JobBoard)
export default async function JobsBoardPage() {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้ระบบใบงานได้" />;
  }
  let res;
  try {
    res = await getJobBoard();
  } catch (err) {
    logJobFailure("JobsBoardPage", err);
    return <ErrorState message="โหลดบอร์ดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  return <JobBoard initial={res.data} />;
}
