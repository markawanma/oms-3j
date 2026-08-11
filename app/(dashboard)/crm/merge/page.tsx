import { Users2 } from "lucide-react";
import { getCrmMergeCandidates } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { MergeCandidateList } from "@/components/domain/crm/MergeCandidateList";

export const dynamic = "force-dynamic"; // candidate queue shrinks every time someone merges/dismisses — never cache

// /crm/merge (design §3 B2b) — server fetch of analytics.v_merge_candidate,
// client-side interactive review (MergeCandidateList). getCrmMergeCandidates()
// itself returns [] (not an error) for staff — merge is owner/admin only, see
// module header in lib/actions/crm.ts — so the empty state below also covers
// "you don't have access to this page", intentionally without a scary
// permission error.
export default async function CrmMergePage() {
  let result;
  try {
    result = await getCrmMergeCandidates();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">รวมลูกค้าซ้ำ</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          ตรวจทีละคู่ ยืนยันรวมหรือทำเครื่องหมายไม่ใช่คนเดียวกัน · ทำสัปดาห์ละครั้งได้
        </p>
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          icon={Users2}
          title="ไม่มีคู่ที่ต้องตรวจ"
          description="ระบบไม่พบลูกค้าที่น่าจะเป็นคนเดียวกันตอนนี้ — จะกลับมาแสดงใหม่เมื่อมีการนำเข้าออเดอร์เพิ่ม"
        />
      ) : (
        <MergeCandidateList initialRows={result.data} />
      )}
    </div>
  );
}
