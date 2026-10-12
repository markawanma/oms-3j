import { Lock } from "lucide-react";
import { getContentPostHistory, getContentTypes } from "@/lib/actions/content";
import { getEffectiveRole } from "@/lib/auth/role";
import { getDevShopId } from "@/lib/dev/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ContentPostHistoryTable } from "@/components/domain/marketing/ContentPostHistoryTable";

export const dynamic = "force-dynamic";

// /marketing/content/history — "ดูย้อนหลัง" (Tech Lead brief 27 ก.ย. 69):
// เจ้าของขอหน้าอ่านย้อนหลังคลิปที่เคยกรอกยอดผ่าน /marketing/content/entry
// ไปแล้ว (ฟอร์มที่นั่นปิดตัวเองทันทีที่กรอกเสร็จ ไม่มีที่ไหนให้ย้อนดูอีก).
// ระดับงาน S — ตารางอ่านอย่างเดียว ไม่มี logic ทางธุรกิจ: ไม่มีกราฟ ไม่มี
// filter/search รอบนี้ (เพิ่มทีหลังถ้าจำเป็นจริง). Same page shape as
// /marketing/content/entry (role gate owner/admin, dynamic = "force-dynamic").
export default async function ContentHistoryPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูประวัติ content ได้"
      />
    );
  }

  try {
    getDevShopId();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  // Independent fetches, same reasoning as /marketing/content/entry's page
  // (M4 fix comment there): a failure loading content types must not block
  // rendering the history table itself — worst case, rows just show
  // "ยังไม่ระบุ" for their type instead of a colored chip.
  const [historyResult, typesResult] = await Promise.all([
    getContentPostHistory().catch((err) => {
      console.error("getContentPostHistory failed (page)", err);
      return { ok: false as const, error: "โหลดประวัติโพสต์ไม่สำเร็จ" };
    }),
    getContentTypes().catch((err) => {
      console.error("getContentTypes failed (page)", err);
      return { ok: false as const, error: "โหลดประเภทเนื้อหาไม่สำเร็จ" };
    }),
  ]);

  if (!historyResult.ok) {
    return <ErrorState message={historyResult.error} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ประวัติยอดโพสต์</h1>
        <p className="text-sm text-zinc-500">คลิปที่เคยบันทึกลิงก์และตัวเลขล่าสุดที่กรอกไว้ ใหม่ไปเก่า</p>
      </div>

      {historyResult.data.length === 0 ? (
        <EmptyState title="ยังไม่มีโพสต์ที่บันทึกไว้" description="วางลิงก์โพสต์แรกได้ที่หน้าอ่านยอด" />
      ) : (
        <ContentPostHistoryTable
          rows={historyResult.data}
          contentTypes={typesResult.ok ? typesResult.data : []}
        />
      )}
    </div>
  );
}
