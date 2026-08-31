import { getSilverPriceHistory } from "@/lib/actions/silver-price-history";
import { ErrorState } from "@/components/ui/ErrorState";
import { SilverPriceHistorySection } from "@/components/domain/catalog/SilverPriceHistorySection";

export const dynamic = "force-dynamic"; // price history grows every capture — never cache

// /catalog/silver-price — ประวัติราคาเงินจาก Google Sheet ต้นทาง (supabase/
// migrations/0102_silver_price_history.sql). Owner สั่งไว้ตรงๆ: "สร้าง
// โครงสร้างมาเก็บประวัติราคาเนื้อเงิน ให้เห็นใน localhost ไว้แถวๆ สินค้าของ
// ร้าน" ⇒ อยู่ใต้ /catalog (เหมือน /catalog/sku-prefix).
//
// ไม่มี owner/admin gate (ต่างจาก /catalog หลัก): หน้านี้ read-only ล้วน ไม่มี
// ปุ่มแก้ต้นทุน/margin ใดๆ — ดูเหตุผลเต็มใน lib/actions/silver-price-history.ts
export default async function SilverPriceHistoryPage() {
  let result;
  try {
    result = await getSilverPriceHistory();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return (
    <div className="flex flex-col gap-1">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ประวัติราคาเงิน</h1>
        <p className="text-xs text-zinc-500">
          เก็บจาก Google Sheet ที่ป้อนราคาเข้าเว็บ 3jthailand.com/silver-price ทุกครั้งที่ scheduled task รัน — ใช้คิดต้นทุน/ตัดสินใจแคมเปญ
          ราคาเงินได้ทันที (หน้าเว็บสาธารณะในอนาคตจะโชว์แค่ 14 วันล่าสุด)
        </p>
      </div>
      <SilverPriceHistorySection rows={result.data} />
    </div>
  );
}
