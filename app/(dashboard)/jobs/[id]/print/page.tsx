import { Lock } from "lucide-react";
import { getJobDetail } from "@/lib/actions/job-office";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { logJobFailure } from "@/lib/jobs/log";
import { currentAppOrigin } from "@/lib/jobs/origin-server";
import { toPrintableJob, toPrintableSublot } from "@/lib/jobs/print";
import { primaryPhotoMdUrl } from "@/lib/jobs/photos-server";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/jobs/input";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { JobPrintClient } from "@/components/domain/jobs/JobPrintClient";
import { SublotPrintClient } from "@/components/domain/jobs/SublotPrintClient";
import { PrintFileTitle } from "@/components/ui/PrintFileTitle";
import { jobPrintTitle } from "@/lib/jobs/print-title";

export const dynamic = "force-dynamic";

// /jobs/[id]/print — ใบงาน A5 + QR
// toPrintableJob() คือด่านข้อมูล: JobDetailData มีเหตุผลก่อนมัดจำ/หมายเหตุภายใน/ผู้ถือ/เลขอ้างอิง ที่ห้ามขึ้นกระดาษ (props ของ client ถึงเบราว์เซอร์ทั้งก้อน)
// → ส่งเข้า JobPrintClient เฉพาะ PrintableJob เท่านั้น ห้ามส่ง res.data / res.data.job ตรงๆ
export default async function JobPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ lot?: string | string[] }> }) {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่พิมพ์ใบงานได้" />;
  }
  const { id } = await params;
  const lotParam = (await searchParams)?.lot;
  let res;
  try {
    res = await getJobDetail(id);
  } catch (err) {
    logJobFailure("JobPrintPage", err);
    return <ErrorState message="โหลดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  if (!res.data) return <EmptyState title="ไม่พบใบงานนี้" />;
  // 0181: ส่วนย่อยไม่มีหน้าพิมพ์ของตัวเอง (QR ออกให้ใบแม่) → ไปหน้าพิมพ์ใบย่อยของส่วนนี้ที่ใบแม่
  if (res.data.partOf) redirect(`/jobs/${res.data.partOf}/print?lot=${id}`);
  if (res.data.job.status === "done" || res.data.job.status === "cancelled") {
    return <EmptyState title="ใบงานนี้ปิดแล้ว" description="พิมพ์ใบงานที่ปิด/ยกเลิกแล้วไม่ได้" />;
  }
  // ที่อยู่เว็บที่จะฝังใน QR + คำเตือนถ้าพิมพ์จาก preview/dev (security L2) — host ไม่ใช่ความลับ ส่งให้ client แสดงเป็นแถบ print:hidden
  const origin = await currentAppOrigin();
  const qr = origin.ok ? { host: origin.host, warning: origin.warning, error: null } : { host: null, warning: null, error: origin.error };
  // 0182: รูปหลักของใบแม่ (md · signed 15 นาที) — ไม่มีรูป/เซ็นไม่ได้ = null = พิมพ์ต่อแบบเดิมเป๊ะ (ไม่ throw)
  const photoUrl = await primaryPhotoMdUrl(res.data.job.id);
  // 0181: ?lot=<id ส่วนย่อย> = ใบย่อย (ประกอบทีละ field ผ่าน toPrintableSublot) · ไม่ใช่ส่วนย่อยที่ยังเปิด = ไม่พิมพ์
  if (typeof lotParam === "string") {
    if (!isUuid(lotParam)) return <EmptyState title="ไม่พบส่วนย่อยนี้" />;
    const sub = toPrintableSublot(res.data.job, res.data.lots?.parts.find((p) => p.jobId === lotParam), res.data.todayTh, photoUrl);
    if (!sub) return <EmptyState title="พิมพ์ใบย่อยของส่วนนี้ไม่ได้" description="ส่วนนี้ไม่มี หรือปิด/ยกเลิกแล้ว" />;
    // ชื่อไฟล์ PDF: วันเปิดใบแม่ + เลขใบแม่-ส่วนN + ชื่อแบบ (ข้อมูลชุดเดียวกับที่โหลดแล้ว ไม่ query เพิ่ม)
    return (
      <>
        <PrintFileTitle title={jobPrintTitle(res.data.job, sub.lotSeq)} />
        <SublotPrintClient sub={sub} qrTarget={qr} />
      </>
    );
  }
  const splitJob = (res.data.lots?.parts.length ?? 0) > 1;
  // 0190: พลอยของใบ (null = อ่านไม่ได้ → ตารางพลอยไม่ขึ้น · ไม่มี key = ส่วนย่อย) — toPrintableJob ประกอบทีละ field
  // gems === null = อ่านพลอยไม่ได้ (ไม่ใช่ "ไม่มีพลอย") → ส่งแค่ boolean ให้จอเตือน (print:hidden) — ไม่ส่งข้อมูลดิบเข้า client
  return (
    <>
      <PrintFileTitle title={jobPrintTitle(res.data.job)} />
      <JobPrintClient job={toPrintableJob(res.data.job, res.data.stages, photoUrl, res.data.gems)} qr={qr} defaultKeep={splitJob} gemsReadFailed={res.data.gems === null} />
    </>
  );
}
