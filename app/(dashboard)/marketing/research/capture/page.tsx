import Link from "next/link";
import { Lock } from "lucide-react";
import { getEffectiveRole } from "@/lib/auth/role";
import { EmptyState } from "@/components/ui/EmptyState";
import { CaptureForm } from "@/components/domain/marketing/research/CaptureForm";

export const dynamic = "force-dynamic";

// /marketing/research/capture — แปะลิงก์ที่เจอ (ข้อมูลสัญญาณหายถาวรทุกสัปดาห์ที่ช้า — Q4)
// ฟอร์มกลางจอ ≤ 560px บน PC · ไม่เปิด/ไม่ดึงลิงก์ที่แปะ
export default async function CapturePage() {
  if ((await getEffectiveRole()) === "staff") {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่แปะลิงก์ได้" />;
  }
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-900">แปะลิงก์ที่เจอ</h1>
        <p className="text-sm text-zinc-700">เจอคลิปที่น่าสนใจ — วางลิงก์ + ประโยคเปิดของคลิป แล้วบันทึก (ระบบไม่เปิดลิงก์นี้)</p>
        <Link href="/marketing/research" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline">
          ดูรายการสัญญาณ
        </Link>
      </header>
      <CaptureForm />
    </div>
  );
}
