import { listStock } from "@/lib/actions/stock";
import { StockPageClient } from "@/components/domain/StockPageClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  let result;
  try {
    result = await listStock("");
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-zinc-900">สต็อกกลาง</h1>
      {/* P1b (0131): production_order_done บวกสต็อกเข้าอย่างเดียว ตัวตัดสต็อก
          ขาออกจากยอดขาย (import Shipnity) ยังไม่มี — P1.5 เป็นคนทำ ดู
          docs/3j-jewelry/oms/design-production-order.md มติ Tech Lead ข้อ 3(ข) */}
      <p className="mb-3 text-xs text-amber-700">
        ตัวเลขนี้ยังไม่หักยอดขายจากไฟล์ import — เป็นยอดที่บวกเข้าจากใบผลิต/ปรับสต็อกเท่านั้น
      </p>
      {result.ok ? <StockPageClient initialStock={result.data} /> : <ErrorState message={result.error} />}
    </div>
  );
}
