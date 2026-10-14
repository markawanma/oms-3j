import { Lock } from "lucide-react";
import { getJobDetail } from "@/lib/actions/job-office";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { currentAppOrigin } from "@/lib/jobs/origin-server";
import { toPrintableJob } from "@/lib/jobs/print";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobPrintClient } from "@/components/domain/jobs/JobPrintClient";

export const dynamic = "force-dynamic";

// /jobs/[id]/print — ใบงาน A5 + QR
// toPrintableJob() คือด่านข้อมูล: JobDetailData มีเหตุผลก่อนมัดจำ/หมายเหตุภายใน/ผู้ถือ/เลขอ้างอิง ที่ห้ามขึ้นกระดาษ (props ของ client ถึงเบราว์เซอร์ทั้งก้อน)
// → ส่งเข้า JobPrintClient เฉพาะ PrintableJob เท่านั้น ห้ามส่ง res.data / res.data.job ตรงๆ
export default async function JobPrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่พิมพ์ใบงานได้" />;
  }
  const { id } = await params;
  let res;
  try {
    res = await getJobDetail(id);
  } catch (err) {
    logJobFailure("JobPrintPage", err);
    return <ErrorState message="โหลดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  if (!res.data) return <EmptyState title="ไม่พบใบงานนี้" />;
  if (res.data.job.status === "done" || res.data.job.status === "cancelled") {
    return <EmptyState title="ใบงานนี้ปิดแล้ว" description="พิมพ์ใบงานที่ปิด/ยกเลิกแล้วไม่ได้" />;
  }
  // ที่อยู่เว็บที่จะฝังใน QR + คำเตือนถ้าพิมพ์จาก preview/dev (security L2) — host ไม่ใช่ความลับ ส่งให้ client แสดงเป็นแถบ print:hidden
  const origin = await currentAppOrigin();
  const qr = origin.ok ? { host: origin.host, warning: origin.warning, error: null } : { host: null, warning: null, error: origin.error };
  return <JobPrintClient job={toPrintableJob(res.data.job, res.data.stages)} qr={qr} />;
}
