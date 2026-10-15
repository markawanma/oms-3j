import { Lock } from "lucide-react";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfilesClient } from "@/components/domain/jobs/ProfilesClient";

export const dynamic = "force-dynamic";

// /jobs/profiles — แบบการบันทึกของใบงาน (owner/admin): กำหนดว่าแต่ละขั้นช่างต้องชั่ง/แจ้งของเสียอะไร · ตั้งค่าเริ่ม (ทั่วไป/ทอง)
// ข้อมูลโหลดฝั่ง client (ProfilesClient) เพื่อให้มี loading/error/ลองใหม่ ครบ — action ตรวจสิทธิ์ซ้ำเองทุกตัว
export default async function JobProfilesPage() {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการแบบการบันทึกได้" />;
  }
  return <ProfilesClient />;
}
